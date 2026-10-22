const rateLimit = require('express-rate-limit');
const oauth = require('../api/oauth');
const { ensureTables, createStore } = require('./store');
const { isPoll, isExit, sessionKey, say, linkAccount, validRequest, speech, choiceText } = require('./protocol');

const greeting = 'FinUchet подключён. Можно спросить про кассы, платежи и просрочки. Изменения подтверждаются в чате ИИ в приложении. Что проверить?';
const waiting = 'Запрос принят. Готовлю ответ. Через несколько секунд спросите: готово?';

const createAliceHandler = ({ config, connection, available, store }) => async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!config.skillId || !config.clientId) return res.status(503).json({ error: 'alice_not_configured' });
  const body = req.body;
  if (!validRequest(body, config.skillId)) return res.status(400).json({ error: 'invalid_alice_request' });
  const header = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '')?.[1];
  const raw = header || body.session.user?.access_token;
  if (!raw) return res.json(linkAccount(body));
  const identity = await connection(raw);
  if (!identity) return res.json(linkAccount(body));
  const gate = await available(identity.userId);
  if (gate) return res.json(say(gate));
  const text = String(body.request?.command || body.request?.original_utterance || '').trim();
  if (isExit(text)) return res.json(say('До встречи в FinUchet.', true));
  if (body.account_linking_complete_event || !text) return res.json(say(greeting));
  const key = sessionKey(body);
  const previous = await store.latest(identity.userId, key);
  if (isPoll(text)) {
    if (!previous) return res.json(say('Пока нет запроса. Спросите, например: сколько денег в кассах?'));
    if (previous.status === 'failed') return res.json(say(previous.error_text || 'Не удалось получить ответ. Повторите запрос.'));
    if (previous.status !== 'done') return res.json(say('Ещё готовлю ответ. Спросите «готово?» немного позже.'));
    return res.json(say(speech(previous.result)));
  }
  const queued = await store.enqueue({
    userId: identity.userId, connectionId: identity.connectionId, key,
    messageId: body.session.message_id,
    question: choiceText(text, previous?.result),
  });
  if (queued.limited) return res.json(say('Слишком много запросов. Подождите минуту.'));
  if (queued.busy) return res.json(say('Предыдущий запрос ещё обрабатывается. Для этой сессии спросите «готово?», либо проверьте чат ИИ в FinUchet.'));
  if (queued.job.status === 'done') return res.json(say(speech(queued.job.result)));
  if (queued.job.status === 'failed') return res.json(say(queued.job.error_text));
  return res.json(say(waiting));
};

const createWorker = ({ store, connectionById, runAssistantTurn, log = console }) => {
  let active = 0;
  let stopped = false;
  const processOne = async () => {
    if (stopped || active >= 2) return;
    active++;
    let job;
    try {
      job = await store.claim();
      if (!job) return;
      const identity = await connectionById(job.connection_id);
      if (!identity || identity.userId !== job.user_id) {
        await store.fail(job.id, 'Подключение отключено или недоступно. Подключите FinUchet заново.');
        return;
      }
      const past = await store.history(job);
      const history = past.flatMap(x => [
        { role: 'user', text: x.question },
        { role: 'assistant', text: x.result?.reply || '' },
      ]);
      const result = await runAssistantTurn({
        userId: job.user_id, requestId: `alice_${job.id}`, sharedHistory: true, text: job.question, history, mode: 'confirm', channel: 'alice',
        allowWrites: identity.scopes.includes('write'), signal: AbortSignal.timeout(180000),
      });
      await store.finish(job.id, result);
    } catch (e) {
      log.error('Alice job failed:', e.code || e.name || 'Error');
      if (job) await store.fail(job.id, e.code === 'AI_CONSENT_REQUIRED' || e.code === 'AI_LIMIT'
        ? e.message : 'Агент сейчас не ответил. Повторите запрос или откройте чат ИИ в FinUchet.').catch(() => {});
    } finally { active--; }
  };
  return {
    processOne,
    start: () => {
      const timer = setInterval(() => { void processOne(); }, 500);
      const cleanup = setInterval(() => { store.cleanup().catch(() => log.error('Alice cleanup failed')); }, 60000);
      timer.unref(); cleanup.unref();
      return () => { stopped = true; clearInterval(timer); clearInterval(cleanup); };
    },
  };
};

const registerAliceRoutes = (app, { pool, auth, runAssistantTurn, aiAssistantState, getEffectivePlan, planLimits }) => {
  const config = { skillId: process.env.ALICE_SKILL_ID || '', clientId: process.env.ALICE_OAUTH_CLIENT_ID || '' };
  const enabled = !!(config.skillId && config.clientId);
  const allowedUsers = (process.env.ALICE_ALLOWED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const store = createStore(pool);
  let ready = !enabled;
  const validate = async token => {
    if (!token || token.expired || token.client_id !== config.clientId || !token.scopes?.includes('read')) return null;
    if (allowedUsers.length && !allowedUsers.includes(token.user_id)) return null;
    const client = (await pool.query('SELECT id FROM oauth_clients WHERE id=$1 AND disabled_at IS NULL', [config.clientId])).rows[0];
    if (!client) return null;
    const user = (await pool.query('SELECT role,blocked,subscription FROM users WHERE id=$1', [token.user_id])).rows[0];
    if (!user || user.blocked || !['admin', 'manager'].includes(user.role)) return null;
    const sub = typeof user.subscription === 'string' ? JSON.parse(user.subscription) : user.subscription;
    if (user.role !== 'admin' && !planLimits[getEffectivePlan(sub)]?.api) return null;
    return { userId: token.user_id, connectionId: token.id, scopes: token.scopes };
  };
  const connection = async raw => typeof raw === 'string' && raw.startsWith('fu_at_') && raw.length < 2048
    ? validate(await oauth.findByAccessToken(pool, raw)) : null;
  const connectionById = async id => validate((await pool.query(`SELECT * FROM oauth_tokens
    WHERE id=$1 AND revoked_at IS NULL AND (refresh_expires_at IS NULL OR refresh_expires_at > NOW())`, [id])).rows[0]);
  const available = async userId => {
    const s = await aiAssistantState(userId);
    if (!s?.allowedRole) return 'Агент пока недоступен этому аккаунту.';
    if (!s.consent) return 'Откройте чат ИИ в FinUchet и подтвердите согласие на обработку данных.';
    // Уже подготовленный ответ доступен даже после последнего платного запроса.
    return null;
  };
  const handler = createAliceHandler({ config, connection, available, store });
  app.post('/api/alice/webhook', rateLimit({ windowMs: 60000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false }), async (req, res) => {
    if (!enabled) return res.status(503).json({ error: 'alice_not_configured' });
    if (!ready) return res.json(say('Подключение запускается. Повторите через несколько секунд.'));
    // Даже при медленной БД не нарушаем лимит Алисы 4,5 секунды. Это не результат операции.
    const deadline = setTimeout(() => { if (!res.headersSent) res.json(say('Сервис отвечает медленно. Повторите запрос через несколько секунд.')); }, 3000);
    const original = res.json.bind(res);
    res.json = value => res.headersSent ? res : original(value);
    try { await handler(req, res); }
    catch (e) { console.error('Alice webhook failed:', e.code || e.name); res.json(say('FinUchet сейчас недоступен. Повторите запрос позже.')); }
    finally { clearTimeout(deadline); }
  });

  app.get('/api/ai/assistant/alice/inbox', auth, async (req, res) => {
    if (!enabled || !ready) return res.json({ messages: [] });
    try {
      if (!(await aiAssistantState(req.user.id))?.allowedRole) return res.status(403).json({ msg: 'Недоступно' });
      const messages = (await store.inbox(req.user.id)).map(job => {
        const expired = Date.now() - new Date(job.updated_at).getTime() > 14 * 60000;
        const actions = (job.result?.actions || []).filter(a => !(expired && a.kind === 'confirm')).map(a => ({ ...a, auto: false }));
        return { id: job.id, question: job.question, reply: job.result?.reply || '', actions,
          expired: expired && actions.length !== (job.result?.actions || []).length };
      });
      res.json({ messages });
    } catch (e) { res.status(503).json({ msg: 'Не удалось получить ответы Алисы' }); }
  });
  app.post('/api/ai/assistant/alice/inbox/ack', auth, async (req, res) => {
    if (!enabled || !ready) return res.json({ ok: true });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(id => typeof id === 'string').slice(0, 10) : [];
    try { await store.acknowledge(req.user.id, ids); res.json({ ok: true }); }
    catch (e) { res.status(503).json({ msg: 'Не удалось отметить ответы' }); }
  });
  let stopWorker = () => {};
  const initialized = enabled ? ensureTables(pool).then(() => store.cleanup()).then(() => {
      ready = true;
      stopWorker = createWorker({ store, connectionById, runAssistantTurn }).start();
    }).catch(e => console.error('Alice initialization failed:', e.code || e.name)) : Promise.resolve();
  return { ready: initialized, stop: () => stopWorker() };
};
module.exports = { registerAliceRoutes, createAliceHandler, createWorker };
