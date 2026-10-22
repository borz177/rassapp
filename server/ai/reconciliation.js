const crypto = require('node:crypto');
const domain = require('../api/domain');
const round = n => Math.round(n * 100) / 100;
const customerSale = s => s.type === 'INSTALLMENT' && s.customerId && !s.customerId.startsWith('system_');
const fingerprint = rows => crypto.createHash('sha256').update(JSON.stringify(rows.map(r => [r.id, r.type, r.data]).sort((a, b) => a[0].localeCompare(b[0])))).digest('hex');
const group = rows => Object.fromEntries(['sales', 'expenses', 'accounts', 'retailSales', 'customers'].map(type => [type, rows.filter(r => r.type === type).map(r => r.data)]));
const audit = data => {
  const { accounts = [], sales = [], expenses = [], retailSales = [], customers = [] } = data;
  const names = new Map(customers.map(c => [c.id, c.name]));
  const accountIds = new Set(accounts.map(a => a.id));
  const balances = domain.accountBalances(accounts, sales, expenses, retailSales);
  const initial = domain.accountBalances(accounts, [], []);
  const salesOnly = domain.accountBalances(accounts, sales, []);
  const expensesOnly = domain.accountBalances(accounts, [], expenses);
  const retailOnly = domain.accountBalances(accounts, [], [], retailSales);
  const orphanContracts = sales.filter(s => customerSale(s) && (!accountIds.has(s.accountId) || (s.funding || []).some(f => !accountIds.has(f.accountId))))
    .map(s => ({ contractId: s.id, customer: names.get(s.customerId) || 'Клиент', product: s.productName, accountId: s.accountId || null, received: round(domain.collected(s)), purchase: Number(s.buyPrice) || 0, remaining: Number(s.remainingAmount) || 0 }));
  const mismatches = sales.filter(customerSale).flatMap(s => {
    if (s.funding?.length) return [];
    const e = expenses.find(e => e.id === `exp_sale_${s.id}`);
    return e && e.accountId !== s.accountId ? [{ contractId: s.id, product: s.productName, customer: names.get(s.customerId), expenseId: e.id }] : [];
  });
  const duplicatePayments = [];
  for (const sale of sales.filter(customerSale)) {
    const seen = new Map();
    for (const p of sale.paymentPlan || []) {
      if (!p.isPaid || p.isRealPayment === false) continue;
      const key = `${p.actualDate || p.date}:${round(Number(p.amount) || 0)}`;
      if (seen.has(key)) duplicatePayments.push({ contractId: sale.id, customer: names.get(sale.customerId), product: sale.productName, paymentIds: [seen.get(key), p.id], amount: p.amount, date: p.actualDate || p.date, possible: true });
      else seen.set(key, p.id);
    }
  }
  return {
    calculatedAt: new Date().toISOString(), basis: 'Учётные записи приложения; первый взнос входит в остаток кассы независимо от режима отображения собрано.',
    accounts: accounts.map(a => ({ id: a.id, name: a.name, initial: initial[a.id], receipts: round(salesOnly[a.id] - initial[a.id]), expenses: round(initial[a.id] - expensesOnly[a.id]), retailNet: round(retailOnly[a.id] - initial[a.id]), balance: balances[a.id] })),
    totalCash: round(Object.values(balances).reduce((a, b) => a + b, 0)),
    orphanContracts, mismatches, duplicatePayments,
    note: 'Возможный дубль требует проверки: два одинаковых платежа могут быть настоящими. Записи не исправлены автоматически.',
  };
};
const planTransfer = (data, ids, targetId) => {
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || new Set(ids).size !== ids.length) throw new Error('Укажите от 1 до 100 разных договоров.');
  const target = data.accounts.find(a => a.id === targetId && a.type === 'POOL');
  if (!target) throw new Error('Выберите существующий общий пул.');
  const purchases = [], contracts = [];
  for (const id of ids) {
    const s = data.sales.find(s => s.id === id);
    if (!s || !customerSale(s)) throw new Error('Разрешён перенос только существующих клиентских договоров рассрочки.');
    if (s.funding?.length || s.supplierId || s.productId || s.stockItems?.length) throw new Error('Договор связан со складом, поставщиком или совместным финансированием. Нужна отдельная проверка в приложении.');
    const expense = data.expenses.find(e => e.id === `exp_sale_${s.id}`);
    if (!expense || expense.accountId !== s.accountId || round(Number(expense.amount)) !== round(Number(s.buyPrice)) || expense.isRefund || expense.investorId || expense.supplierId) throw new Error('Связанный закуп отсутствует или расходится с договором. Сначала нужна сверка.');
    if (s.accountId === targetId) throw new Error('Один из договоров уже находится в выбранном пуле. Обновите список.');
    contracts.push(s); purchases.push(expense);
  }
  const set = new Set(ids), expenseIds = new Set(purchases.map(e => e.id));
  const before = audit(data);
  const after = audit({ ...data, sales: data.sales.map(s => set.has(s.id) ? { ...s, accountId: targetId } : s), expenses: data.expenses.map(e => expenseIds.has(e.id) ? { ...e, accountId: targetId } : e) });
  return { count: ids.length, target: target.name, contractIds: ids, expenseIds: [...expenseIds],
    receipts: round(contracts.reduce((n, s) => n + domain.collected(s), 0)), purchases: round(purchases.reduce((n, e) => n + Number(e.amount), 0)),
    before: { accounts: before.accounts, totalCash: before.totalCash }, after: { accounts: after.accounts, totalCash: after.totalCash },
    explanation: 'Переносятся договоры и связанные закупы. Вложения инвесторов не переносятся и повторно не создаются.' };
};
const createReconciliation = pool => {
  const load = async (userId, db = pool, lock = false) => {
    // Одно чтение даёт согласованный снимок всех финансовых записей.
    return (await db.query(`SELECT id,type,data FROM data_items WHERE user_id=$1
      AND type=ANY($2::text[]) ORDER BY id ${lock ? 'FOR UPDATE' : ''}`, [userId, ['accounts','sales','expenses','retailSales','customers','investors']])).rows;
  };
  const read = async userId => { await domain.ready; return audit(group(await load(userId))); };
  const preview = async (userId, args) => {
    await domain.ready;
    const rows = await load(userId);
    return { ...planTransfer(group(rows), args.contractIds, args.accountId), fingerprint: fingerprint(rows) };
  };
  const transfer = async (userId, args) => {
    await domain.ready;
    const db = await pool.connect();
    try {
      await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const rows = await load(userId, db, true);
      if (!args.fingerprint || fingerprint(rows) !== args.fingerprint) throw new Error('Данные изменились после расчёта. Запросите новый предварительный расчёт.');
      const plan = planTransfer(group(rows), args.contractIds, args.accountId);
      const ids = [...plan.contractIds, ...plan.expenseIds];
      const changed = await db.query(`UPDATE data_items SET data=data || jsonb_build_object('accountId',$3::text,'updatedAt',NOW()),updated_at=NOW()
        WHERE user_id=$1 AND id=ANY($2::text[]) RETURNING id`, [userId, ids, args.accountId]);
      if (changed.rowCount !== ids.length) throw new Error('Не все записи найдены. Перенос отменён.');
      const result = audit(group(await load(userId, db)));
      if (result.totalCash !== plan.after.totalCash || result.accounts.some(a => a.balance !== plan.after.accounts.find(b => b.id === a.id)?.balance)) throw new Error('Проверка остатков не пройдена. Перенос отменён.');
      // Снимки необходимы для аудита и ручного восстановления связей.
      await db.query(`CREATE TABLE IF NOT EXISTS ai_transfer_audit (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,before_rows JSONB NOT NULL,result JSONB NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW())`);
      await db.query('INSERT INTO ai_transfer_audit(id,user_id,before_rows,result) VALUES($1,$2,$3,$4)', [crypto.randomUUID(),userId,JSON.stringify(rows.filter(r => ids.includes(r.id))),JSON.stringify(plan)]);
      await db.query('COMMIT');
      return { ok: true, text: `Перенесено ${plan.count} договоров вместе с закупами в «${plan.target}». Общий остаток: ${result.totalCash.toLocaleString('ru-RU')} ₽.` };
    } catch (e) { await db.query('ROLLBACK'); return { ok: false, text: e.message }; }
    finally { db.release(); }
  };
  return { read, preview, transfer, load };
};
module.exports = { audit, planTransfer, createReconciliation, fingerprint, group };
