// Исправление из сверки: отдельное подтверждение, ограниченный патч графика.
// Модель не выбирает поля, суммы или SQL; реальные оплаты сохраняются.
const crypto = require('node:crypto');
const { hash } = require('./auditReviewIdentity');
const UNDO_MS = 30 * 60 * 1000;
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const patchOf = sale => sale.paymentPlan.filter(p => p.isRealPayment === false)
  .map(p => ({ id: p.id, amount: p.amount, isPaid: p.isPaid }));
const undoUntil = row => row.status === 'done'
  ? new Date(new Date(row.updated_at).getTime() + UNDO_MS).toISOString() : null;
const publicStatus = row => row.status === 'pending' && new Date(row.expires_at).getTime() <= Date.now()
  ? 'expired' : row.status;

function applyPatch(sale, patch) {
  const byId = new Map(patch.map(p => [p.id, p]));
  if (byId.size !== patch.length || patch.length !== sale.paymentPlan.filter(p => p.isRealPayment === false).length)
    fail(409, 'График изменился. Подготовьте исправление заново.');
  return { ...sale, paymentPlan: sale.paymentPlan.map(p => {
    if (p.isRealPayment !== false) return p;
    const change = byId.get(p.id);
    if (!change) fail(409, 'График изменился. Подготовьте исправление заново.');
    return { ...p, amount: change.amount, isPaid: change.isPaid };
  }) };
}

function createAuditRepairs({ pool, audits, allowed }) {
  let initialized;
  const ready = () => initialized || (initialized = pool.query(`
    CREATE TABLE IF NOT EXISTS ai_accounting_repairs(
      id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      request_id text NOT NULL, report_id text NOT NULL, finding_id text NOT NULL, sale_id text NOT NULL,
      source_hash text NOT NULL, after_hash text, before_patch jsonb NOT NULL, after_patch jsonb NOT NULL,
      preview jsonb NOT NULL, status text NOT NULL DEFAULT 'pending', result jsonb, undo_result jsonb,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes', UNIQUE(user_id,request_id));
    CREATE INDEX IF NOT EXISTS ai_accounting_repairs_owner ON ai_accounting_repairs(user_id,created_at DESC)`
  ).catch(e => { initialized = null; throw e; }));

  const authorize = async (userId, db = pool) => {
    const u = (await db.query('SELECT role,blocked,subscription FROM users WHERE id=$1 FOR SHARE', [userId])).rows[0];
    if (!u || u.blocked || !allowed(u.role)) fail(403, 'Исправление доступно владельцу аккаунта.');
    const subscription = typeof u.subscription === 'string' ? JSON.parse(u.subscription) : u.subscription;
    if (u.role !== 'admin' && subscription?.expiresAt && new Date(subscription.expiresAt) < new Date())
      fail(403, 'Срок подписки приложения истёк — изменения недоступны.');
  };
  const publicPreview = row => ({
    id: row.id, ...row.preview, status: publicStatus(row), expiresAt: row.expires_at, undoUntil: undoUntil(row),
  });

  const prepare = async (userId, reportId, findingId, requestId) => {
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,120}$/.test(requestId)) fail(400, 'Обновите запрос исправления.');
    await ready();
    await authorize(userId);
    const existing = (await pool.query('SELECT * FROM ai_accounting_repairs WHERE user_id=$1 AND request_id=$2', [userId, requestId])).rows[0];
    if (existing) {
      if (existing.report_id !== reportId || existing.finding_id !== findingId) fail(409, 'Этот запрос уже использован.');
      return publicPreview(existing);
    }
    const { finding, data } = await audits.findingInput(userId, reportId, findingId);
    if (finding.code !== 'schedule_review') fail(400, 'Для этой находки автоматическое исправление не предусмотрено.');
    const ref = finding.sources.find(s => s.kind === 'contract');
    const sale = data.sales.find(s => s.id === ref?.id);
    if (!sale) fail(404, 'Договор недоступен.');
    const { repairRebuiltSchedule } = await import(require('url').pathToFileURL(require('path').join(__dirname, '../../shared/saleSchedule.js')).href);
    const repaired = repairRebuiltSchedule(sale);
    if (!repaired) fail(409, 'Безопасная правка не определена. Проверьте договор вручную.');
    const before = patchOf(sale), after = patchOf(repaired);
    const total = rows => Math.round(rows.reduce((n, p) => n + p.amount, 0) * 100) / 100;
    const preview = {
      customer: data.customers.find(c => c.id === sale.customerId)?.name || 'Клиент', product: sale.productName || 'Договор',
      contractId: sale.id, price: sale.totalAmount,
      received: Math.round(require('../api/domain').collected(sale) * 100) / 100, remaining: sale.remainingAmount,
      beforeTotal: total(before), afterTotal: total(after),
      rows: before.map(p => ({ id: p.id, date: sale.paymentPlan.find(x => x.id === p.id).date,
        before: p.amount, after: after.find(x => x.id === p.id).amount })).sort((a, b) => new Date(a.date) - new Date(b.date)),
      actualPaymentsChanged: false,
    };
    const result = await pool.query(`
      INSERT INTO ai_accounting_repairs(id,user_id,request_id,report_id,finding_id,sale_id,source_hash,before_patch,after_patch,preview)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(user_id,request_id) DO NOTHING RETURNING *`,
    [crypto.randomUUID(), userId, requestId, reportId, findingId, sale.id, hash(sale), JSON.stringify(before), JSON.stringify(after), JSON.stringify(preview)]);
    const row = result.rows[0] || (await pool.query('SELECT * FROM ai_accounting_repairs WHERE user_id=$1 AND request_id=$2', [userId, requestId])).rows[0];
    if (row.report_id !== reportId || row.finding_id !== findingId) fail(409, 'Этот запрос уже использован.');
    return publicPreview(row);
  };

  const change = async (userId, id, undo = false) => {
    await ready();
    const db = await pool.connect();
    let finished = false;
    try {
      await db.query('BEGIN');
      await db.query("SET LOCAL lock_timeout='10s'");
      await authorize(userId, db);
      // Один порядок блокировок для всех подтверждений и отмен: владелец, действие, договор.
      const row = (await db.query('SELECT * FROM ai_accounting_repairs WHERE id=$1 AND user_id=$2 FOR UPDATE', [id, userId])).rows[0];
      if (!row) fail(404, 'Исправление недоступно.');
      if ((!undo && row.status === 'done') || (undo && row.status === 'undone')) {
        await db.query('COMMIT'); finished = true;
        return undo ? row.undo_result : row.result;
      }
      if (undo ? row.status !== 'done' : row.status !== 'pending') fail(409, 'Это действие уже недоступно.');
      if (undo ? Date.now() >= new Date(undoUntil(row)).getTime() : new Date(row.expires_at).getTime() <= Date.now())
        fail(409, undo ? 'Срок отмены истёк.' : 'Подтверждение устарело. Подготовьте исправление заново.');
      const sale = (await db.query("SELECT data FROM data_items WHERE user_id=$1 AND type='sales' AND id=$2 FOR UPDATE", [userId, row.sale_id])).rows[0]?.data;
      if (!sale || hash(sale) !== (undo ? row.after_hash : row.source_hash)) {
        if (!undo) await db.query("UPDATE ai_accounting_repairs SET status='stale',updated_at=now() WHERE id=$1", [row.id]);
        await db.query('COMMIT'); finished = true;
        fail(409, 'Договор изменился. Обновите проверку и подготовьте действие заново.');
      }
      const changed = applyPatch(sale, undo ? row.before_patch : row.after_patch);
      const saved = (await db.query("UPDATE data_items SET data=$3::jsonb,updated_at=now() WHERE user_id=$1 AND id=$2 AND type='sales' RETURNING data", [userId, row.sale_id, JSON.stringify(changed)])).rows[0].data;
      const result = { ok: true, text: undo ? 'Исправление графика отменено.' : 'График исправлен. Оплаты и долг сохранены.',
        contractId: row.sale_id, actualPaymentsChanged: false, undoable: !undo,
        undoUntil: undo ? null : new Date(Date.now() + UNDO_MS).toISOString() };
      // Квитанция и патч сохраняются одной транзакцией: при сбое не останется изменения без истории.
      await db.query(`UPDATE ai_accounting_repairs SET status=$2,${undo ? 'undo_result' : 'result'}=$3,after_hash=COALESCE($4,after_hash),updated_at=now() WHERE id=$1`,
        [row.id, undo ? 'undone' : 'done', JSON.stringify(result), undo ? null : hash(saved)]);
      await db.query('COMMIT'); finished = true;
      return result;
    } catch (e) {
      if (!finished) await db.query('ROLLBACK');
      throw e;
    } finally { db.release(); }
  };
  const cancel = async (userId, id) => {
    await ready(); await authorize(userId);
    const r = await pool.query("UPDATE ai_accounting_repairs SET status='cancelled',updated_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('pending','cancelled') RETURNING id", [id, userId]);
    if (!r.rowCount) fail(409, 'Действие уже недоступно для отмены до выполнения.');
    return { ok: true };
  };
  const list = async userId => {
    await ready();
    const rows = (await pool.query(`SELECT id,status,result,undo_result,created_at,updated_at,expires_at,preview
      FROM ai_accounting_repairs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`, [userId])).rows;
    return rows.map(row => ({ id: row.id, status: publicStatus(row), result: row.result, undo_result: row.undo_result,
      created_at: row.created_at, updated_at: row.updated_at, source: 'accounting', summary: `Исправление графика: ${row.preview.product}`,
      undoUntil: undoUntil(row), undoable: row.status === 'done' && Date.now() < new Date(undoUntil(row)).getTime(),
    }));
  };
  return { prepare, confirm: (u, id) => change(u, id), undo: (u, id) => change(u, id, true), cancel, list, ready };
}
module.exports = { createAuditRepairs };
