// Постоянный журнал. Неизвестный результат никогда не повторяем автоматически:
// процесс мог завершиться между записью денег и сохранением ответа.
const { hash } = require('./canonical');
const unavailable = text => ({ ok: false, text });

const createActionStore = pool => {
  let initialized;
  const ready = () => initialized ||= pool.query(`
    CREATE TABLE IF NOT EXISTS ai_actions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', result JSONB, undo_result JSONB,
      undo_data JSONB, before_state JSONB, after_state JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '15 minutes'
    );
    CREATE INDEX IF NOT EXISTS ai_actions_owner ON ai_actions(user_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS ai_actions_running_owner ON ai_actions(user_id) WHERE status IN ('executing','undoing');
  `).catch(e => { initialized = null; throw e; });
  const get = async (userId, id) => {
    await ready();
    return (await pool.query('SELECT * FROM ai_actions WHERE id=$1 AND user_id=$2', [id, userId])).rows[0];
  };
  const snapshot = async (userId, args, undo) => {
    const ids = [...new Set([args?.contractId, args?.customerId, args?.expenseId, args?.accountId,
      undo?.id, undo?.saleId, undo?.customerId, undo?.contractId, undo?.ref].filter(Boolean))];
    const rows = (await pool.query(`SELECT id,type,data FROM data_items WHERE user_id=$1
      AND (id=ANY($2::text[]) OR ($3::text IS NOT NULL AND type='sales' AND data->'paymentPlan' @> $4::jsonb)) ORDER BY id`,
    [userId, ids, args?.paymentId || null, JSON.stringify([{ id: args?.paymentId || '' }])])).rows;
    return { ids, paymentId: args?.paymentId || null, rows: rows.map(r => ({ id: r.id, type: r.type, hash: hash(r.data) })) };
  };
  const same = async (userId, state, db = pool) => {
    if (!state) return true;
    const rows = (await db.query(`SELECT id,type,data FROM data_items WHERE user_id=$1
      AND (id=ANY($2::text[]) OR ($3::text IS NOT NULL AND type='sales' AND data->'paymentPlan' @> $4::jsonb)) ORDER BY id`,
    [userId, state.ids, state.paymentId, JSON.stringify([{ id: state.paymentId || '' }])])).rows;
    return hash(rows.map(r => ({ id: r.id, type: r.type, hash: hash(r.data) }))) === hash(state.rows);
  };
  const prepare = async (id, payload) => {
    await ready();
    const context = require('./conversations').turnContext.getStore();
    payload = { ...payload, turnId: context?.id || null, mediaHash: context?.mediaHash || null };
    const before = await snapshot(payload.userId, payload.args);
    await pool.query(`INSERT INTO ai_actions(id,user_id,payload,before_state) VALUES($1,$2,$3,$4)
      ON CONFLICT(id) DO NOTHING`, [id, payload.userId, JSON.stringify(payload), JSON.stringify(before)]);
  };
  const rememberUndo = async (id, payload) => {
    await ready();
    await pool.query('UPDATE ai_actions SET undo_data=$3 WHERE id=$1 AND user_id=$2 AND status=\'executing\'',
      [id, payload.userId, JSON.stringify(payload)]);
  };
  const run = async (userId, id, perform, { undo = false } = {}) => {
    await ready();
    {
      // После аварии результат неизвестен; не повторяем такую операцию.
      await pool.query("UPDATE ai_actions SET status='uncertain' WHERE user_id=$1 AND status IN ('executing','undoing') AND updated_at<NOW()-INTERVAL '5 minutes'",[userId]);
      const row = await get(userId, id);
      if (!row) return unavailable('Действие не найдено. Попросите агента подготовить его заново.');
      if (undo && row.status === 'undone') return row.undo_result;
      if (!undo && ['done', 'failed', 'stale'].includes(row.status)) return row.result;
      if (['executing', 'undoing', 'uncertain'].includes(row.status)) {
        return unavailable('Результат операции требует проверки. Не повторяйте запись: проверьте договор и платежи в приложении.');
      }
      if (undo ? row.status !== 'done' || !row.undo_data : row.status !== 'pending') return unavailable('Это действие уже недоступно.');
      if (!undo && row.payload.tool === 'create_payment' && row.payload.mediaHash) {
        const duplicate = await pool.query(`SELECT id FROM ai_actions WHERE user_id=$1 AND id<>$2 AND status IN ('done','executing','uncertain')
          AND payload->>'mediaHash'=$3 AND payload->>'tool'='create_payment'
          AND payload->'args'->>'contractId'=$4 AND payload->'args'->>'amount'=$5 LIMIT 1`,
        [userId,id,row.payload.mediaHash,row.payload.args.contractId,String(row.payload.args.amount)]);
        if (duplicate.rowCount) return unavailable('Это фото уже использовано для такого платежа или его результат требует проверки. Проверьте договор и журнал действий.');
      }
      if (undo ? Date.now() - new Date(row.updated_at).getTime() > 30 * 60000 : new Date(row.expires_at) < new Date()) {
        return unavailable(undo ? 'Срок отмены истёк. Исправьте запись в приложении.' : 'Подтверждение устарело. Подготовьте действие заново.');
      }
      if (!await same(userId, undo ? row.after_state : row.before_state)) {
        const result = unavailable('Данные изменились после подготовки операции. Обновите данные и попросите агента проверить действие заново.');
        if (!undo) await pool.query("UPDATE ai_actions SET status='stale',result=$3,updated_at=NOW() WHERE id=$1 AND user_id=$2 AND status='pending'", [id, userId, JSON.stringify(result)]);
        return result;
      }
      try {
        const claimed = await pool.query('UPDATE ai_actions SET status=$3,updated_at=NOW() WHERE id=$1 AND user_id=$2 AND status=$4 RETURNING id', [id, userId, undo ? 'undoing' : 'executing', undo ? 'done' : 'pending']);
        if (!claimed.rowCount) return unavailable('Состояние действия изменилось. Обновите журнал.');
      } catch (e) {
        if (e.code === '23505') return unavailable('Другая операция ещё выполняется. Дождитесь её результата.');
        throw e;
      }
      try {
        const result = await perform(row);
        const saved = await get(userId, id);
        const after = undo ? null : await snapshot(userId, row.payload.args, { ...saved.undo_data?.undo, ref: saved.undo_data?.ref });
        await pool.query(`UPDATE ai_actions SET status=$3, ${undo ? 'undo_result' : 'result'}=$4,
          after_state=COALESCE($5::jsonb,after_state),updated_at=NOW() WHERE id=$1 AND user_id=$2`,
        [id, userId, undo ? (result.ok ? 'undone' : 'done') : result.ok ? 'done' : 'failed', JSON.stringify(result), after && JSON.stringify(after)]);
        return result;
      } catch (e) {
        await pool.query("UPDATE ai_actions SET status='uncertain',updated_at=NOW() WHERE id=$1 AND user_id=$2", [id, userId]).catch(() => {});
        throw e;
      }
    }
  };
  const cancel = async (userId, id) => {
    await ready();
    await pool.query("UPDATE ai_actions SET status='cancelled',updated_at=NOW() WHERE id=$1 AND user_id=$2 AND status='pending'", [id, userId]);
  };
  const list = async userId => {
    await ready();
    return (await pool.query(`SELECT id,status,payload->>'summary' AS summary,payload->>'tool' AS tool,
      result,undo_result,created_at,updated_at,expires_at FROM ai_actions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`, [userId])).rows;
  };
  return { ready, get, prepare, rememberUndo, run, cancel, list, snapshot, same };
};
module.exports = { createActionStore };
