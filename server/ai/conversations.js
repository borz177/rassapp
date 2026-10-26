const { randomUUID } = require('node:crypto');
const { hash } = require('./canonical');
const { AsyncLocalStorage } = require('node:async_hooks');
const turnContext = new AsyncLocalStorage();
const createConversations = pool => {
  const actionStore = require('./actionStore').createActionStore(pool);
  const clientActions = require('./clientActions').createClientActions(pool);
  const memory = require('./memory').createMemory(pool);
  let initialized;
  const ready = () => initialized ||= pool.query(`
    CREATE TABLE IF NOT EXISTS ai_threads(user_id TEXT PRIMARY KEY,id TEXT NOT NULL,updated_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS ai_turns(
      user_id TEXT NOT NULL,id TEXT NOT NULL,thread_id TEXT NOT NULL,input_hash TEXT NOT NULL,
      question TEXT NOT NULL,channel TEXT NOT NULL,status TEXT NOT NULL,step TEXT,
      result JSONB,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW(),PRIMARY KEY(user_id,id)
    );
    CREATE INDEX IF NOT EXISTS ai_turns_thread ON ai_turns(user_id,thread_id,created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS ai_turns_running_owner ON ai_turns(user_id) WHERE status='running';
    ALTER TABLE ai_turns ADD COLUMN IF NOT EXISTS plan JSONB NOT NULL DEFAULT '[]';
  `).catch(e => { initialized = null; throw e; });
  const thread = async userId => {
    await ready();
    return (await pool.query(`INSERT INTO ai_threads(user_id,id) VALUES($1,$2)
      ON CONFLICT(user_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING id`, [userId, randomUUID()])).rows[0].id;
  };
  const rows = async (userId, threadId) => (await pool.query(`SELECT * FROM (SELECT * FROM ai_turns WHERE user_id=$1 AND thread_id=$2 ORDER BY created_at DESC LIMIT 40) t ORDER BY created_at`, [userId,threadId])).rows;
  const history = async (userId, threadId) => {
    const past = (await rows(userId,threadId)).filter(r => r.status === 'done');
    const ids = past.flatMap(r => (r.result?.actions || []).map(a => a.id));
    await actionStore.ready();
    await clientActions.ready();
    const ledger = new Map((await pool.query('SELECT id,status,result,undo_result FROM ai_actions WHERE user_id=$1 AND id=ANY($2::text[])',[userId,ids])).rows.map(a=>[a.id,a]));
    const clients = new Map((await pool.query('SELECT id,status,result FROM ai_client_actions WHERE user_id=$1 AND id=ANY($2::text[])',[userId,ids])).rows.map(a=>[a.id,a]));
    const note = a => {
      const record = ledger.get(a.id) || clients.get(a.id);
      if (record?.status === 'done') return `[Выполнено: ${record.result?.text || a.title}${record.result?.saleId ? `; договор ${record.result.saleId}` : ''}]`;
      if (record?.status === 'undone') return `[Отменено: ${record.undo_result?.text || a.title}]`;
      if (record && record.status !== 'pending') return `[Не повторять без проверки: ${a.title}; состояние ${record.status}]`;
      if (a.kind === 'contract_form') return `[Черновик договора: ${JSON.stringify(a.draft)}]`;
      if (a.kind === 'choices') return `[Варианты: ${JSON.stringify(a.options)}]`;
      if (a.kind === 'confirm') return `[Ждёт подтверждения: ${a.summary}]`;
      return '';
    };
    return past.flatMap(r => [
      { role:'user', text:[r.question,r.result?.heard].filter(Boolean).join('\n') },
      { role:'assistant',text:[r.result?.reply || '',...(r.result?.actions || []).map(note)].filter(Boolean).join('\n') },
    ]).slice(-12);
  };
  const list = async userId => {
    const threadId = await thread(userId);
    const list = await rows(userId, threadId);
    return { threadId, messages: list.flatMap(r => [
      { id: r.id, role: 'user', text: r.question, ...(r.result?.heard ? { heard: r.result.heard } : {}), note: r.channel === 'alice' ? 'Запрос с колонки Алиса' : undefined },
      { id: `reply_${r.id}`, role: 'assistant', text: r.result?.reply || (r.status === 'running' ? `Задача выполняется: ${r.step || 'обработка запроса'}` : 'Запрос прервался. Проверьте журнал действий перед повтором.'),
        actions: (r.result?.actions || []).map(a => ({ ...a, auto: false })), workflow: { id: r.id, status: r.status, step: r.step, plan: r.plan }, error: r.status === 'failed' },
    ]) };
  };
  const run = async (args, execute) => {
    await ready();
    const id = String(args.requestId || randomUUID()).slice(0, 120);
    const inputHash = hash({ text: args.text || '', image: args.image || null, images: args.images || null, audio: args.audio || null, mode: args.mode || 'confirm', channel: args.channel || 'app' });
    {
      await pool.query("UPDATE ai_turns SET status='failed',step='Нужна проверка результата' WHERE user_id=$1 AND status='running' AND updated_at<NOW()-INTERVAL '10 minutes'",[args.userId]);
      const previous = (await pool.query('SELECT * FROM ai_turns WHERE user_id=$1 AND id=$2', [args.userId,id])).rows[0];
      if (previous) {
        if (previous.input_hash !== inputHash) throw Object.assign(new Error('Этот запрос уже использован с другими данными.'), { status: 409, code: 'AI_REQUEST_CONFLICT' });
        if (previous.status === 'done') return { ...previous.result, replayed: true };
        throw Object.assign(new Error('Предыдущий запуск прервался или ещё выполняется. Проверьте журнал действий перед повтором.'), { status: 409, code: 'AI_REQUEST_UNCERTAIN' });
      }
      let threadId = await thread(args.userId);
      const claim = await pool.connect();
      try {
        await claim.query('BEGIN');
        threadId = (await claim.query('SELECT id FROM ai_threads WHERE user_id=$1 FOR UPDATE',[args.userId])).rows[0].id;
      await claim.query(`INSERT INTO ai_turns(user_id,id,thread_id,input_hash,question,channel,status) VALUES($1,$2,$3,$4,$5,$6,'running')`, [args.userId,id,threadId,inputHash,String(args.text || (args.audio ? '(Голосовое сообщение)' : args.image || args.images?.length ? '(Фотография)' : '')).slice(0,4000),args.channel || 'app']);
        await claim.query('COMMIT');
      } catch (e) { await claim.query('ROLLBACK'); if (e.code === '23505') throw Object.assign(new Error('Предыдущий запрос ещё выполняется. Дождитесь ответа.'), { status: 409, code: 'AI_BUSY' }); throw e; }
      finally { claim.release(); }
      const past = await history(args.userId,threadId);
      try {
        const media = args.images?.length ? args.images : args.image ? [args.image] : [];
        const deadline = AbortSignal.timeout(180000);
        const result = await turnContext.run({ id, userId: args.userId, threadId, mediaHash: media.length ? hash(media) : null }, () => execute({ ...args, signal: args.signal ? AbortSignal.any([args.signal,deadline]) : deadline,
          // Старые клиенты передают локальную историю. Новые используют общую.
          history: args.sharedHistory ? past : (args.history || []),
          onStep: step => { args.onStep?.(step); void pool.query("UPDATE ai_turns SET step=$3,updated_at=NOW() WHERE user_id=$1 AND id=$2", [args.userId,id,String(step).slice(0,200)]).catch(() => {}); },
        }));
        const out = { ...result, requestId: id, threadId };
        await pool.query("UPDATE ai_turns SET status='done',result=$3,step='Завершено',updated_at=NOW() WHERE user_id=$1 AND id=$2", [args.userId,id,JSON.stringify(out)]);
        return out;
      } catch (e) {
        await pool.query("UPDATE ai_turns SET status='failed',step='Нужна проверка результата',updated_at=NOW() WHERE user_id=$1 AND id=$2", [args.userId,id]).catch(() => {});
        throw e;
      }
    }
  };
  const clear = async (userId, archive = false) => {
    await ready();
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT id FROM ai_threads WHERE user_id=$1 FOR UPDATE',[userId]);
      if ((await db.query("SELECT id FROM ai_turns WHERE user_id=$1 AND status='running'",[userId])).rowCount) throw new Error('Дождитесь завершения запроса.');
      if (!archive) await db.query('DELETE FROM ai_turns WHERE user_id=$1',[userId]);
      await db.query('UPDATE ai_threads SET id=$2,updated_at=NOW() WHERE user_id=$1',[userId,randomUUID()]);
      await db.query('COMMIT');
    } catch (e) { await db.query('ROLLBACK'); throw e; }
    finally { db.release(); }
    // Память разговора привязана к ветке: новая ветка и так начинается с нуля, старую убираем
    await memory.clear(userId).catch(e => console.warn('AI: память разговора не очищена:', e.message));
  };
  const setPlan = async (userId, steps) => {
    const current = turnContext.getStore();
    if (!current || current.userId !== userId) throw new Error('Нет активной задачи.');
    if (!Array.isArray(steps) || !steps.length || steps.length > 10) throw new Error('План должен содержать от 1 до 10 шагов.');
    const plan = steps.map(s => ({ title: String(s.title || '').slice(0,180), status: ['pending','done','blocked'].includes(s.status) ? s.status : 'pending' }));
    if (plan.some(s => !s.title)) throw new Error('У каждого шага должно быть название.');
    await ready();
    await pool.query('UPDATE ai_turns SET plan=$3,updated_at=NOW() WHERE user_id=$1 AND id=$2',[userId,current.id,JSON.stringify(plan)]);
    return { plan, note: 'План сохранён. Отметка шага не доказывает проведение операции; результат записи проверяется по журналу действий.' };
  };
  const task = async (userId, id) => {
    await ready();
    const row = (await pool.query(`SELECT id,question,status,step,plan,result FROM ai_turns WHERE user_id=$1
      AND ($2::text IS NULL OR id=$2) AND id<>$3 ORDER BY created_at DESC LIMIT 1`,[userId,id || null,turnContext.getStore()?.id || ''])).rows[0];
    if (!row) return { found: false };
    const actions = (await pool.query(`SELECT id,status,result,payload->>'summary' AS summary FROM ai_actions WHERE user_id=$1 AND payload->>'turnId'=$2 ORDER BY created_at`,[userId,row.id])).rows;
    return { ...row, actions, note: 'Выполненные действия не повторять. executing, undoing, uncertain требуют проверки записи, а не повторного выполнения. Продолжать только невыполненные шаги по просьбе владельца.' };
  };
  return { ready, thread, history, list, run, clear, setPlan, task };
};
module.exports = { createConversations, turnContext };
