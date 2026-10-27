// Выписка по счёту (server/ai/analytics.js movements): операции — те же, что считает
// остаток (api/domain.js accountBalances), поэтому начальный остаток + все операции = остаток.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../api/domain');
const { movements } = require('./analytics');

const at = (day, h = 12) => `${day}T${String(h - 3).padStart(2, '0')}:00:00.000Z`; // h — по Москве
const today = '2026-10-22';
const data = {
  accounts: [{ id: 'main', name: 'Основной', initialBalance: 10000 }, { id: 'pool', name: 'Общая касса', initialBalance: 0 }],
  customers: [{ id: 'c1', name: 'Рашид' }, { id: 'c2', name: 'Деши' }],
  investors: [{ id: 'inv1', name: 'Ахмед' }],
  sales: [
    // Договор с первым взносом вчера и двумя платежами (вчера и сегодня)
    { id: 's1', customerId: 'c1', type: 'INSTALLMENT', accountId: 'main', productName: 'iPhone', totalAmount: 60000, downPayment: 5000, startDate: at('2026-10-21'),
      paymentPlan: [{ id: 'p1', amount: 10000, date: at('2026-10-21', 15), isPaid: true, isRealPayment: true },
        { id: 'p2', amount: 17400, date: at(today, 10), isPaid: true, isRealPayment: true },
        { id: 'plan', amount: 9000, date: at('2026-11-21'), isPaid: false, isRealPayment: false }] },
    // Совместный: 60 % основной, 40 % общая касса
    { id: 's2', customerId: 'c2', type: 'INSTALLMENT', accountId: 'main', productName: 'Диван', totalAmount: 100000, downPayment: 0, buyPrice: 50000, startDate: at('2026-10-01'),
      funding: [{ accountId: 'main', amount: 30000 }, { accountId: 'pool', amount: 20000 }],
      paymentPlan: [{ id: 'p3', amount: 62500, date: at(today, 15), isPaid: true, isRealPayment: true }] },
    // Прочий приход и взнос инвестора; взнос внесли сегодня, но датой 10.10 — «задним числом»
    { id: 'inc1', customerId: 'system_income', type: 'CASH', accountId: 'main', productName: 'Возврат долга', totalAmount: 3000, downPayment: 3000, startDate: at(today, 11), paymentPlan: [] },
    { id: 'dep1', customerId: 'inv1', type: 'CASH', accountId: 'main', productName: 'Приход', totalAmount: 290000, downPayment: 290000, startDate: at('2026-10-10'), paymentPlan: [] },
  ],
  expenses: [
    { id: 'exp_sale_s2', accountId: 'main', title: 'Закуп: Диван', amount: 30000, date: at('2026-10-01') },
    { id: 'exp_sale_s2__pool', accountId: 'pool', title: 'Закуп: Диван', amount: 20000, date: at('2026-10-01') },
    { id: 'e1', accountId: 'main', title: 'Аренда', amount: 15000, date: at(today, 9) },
    { id: 'e2', accountId: 'main', title: 'Возврат клиенту', amount: 999, date: at(today), isRefund: true },
  ],
  retailSales: [{ id: 'r1', accountId: 'main', total: 1500, date: at(today, 13) }, { id: 'r2', accountId: 'main', total: 700, date: at(today, 14), isCancelled: true }],
};
const changedAt = new Map([['dep1', at(today, 14)], ['s1', at(today, 10)], ['e1', at(today, 9)]]);

test('выписка: остаток на начало + операции = остаток счёта (как accountBalances), по всем счетам', async () => {
  await domain.ready;
  const balances = domain.accountBalances(data.accounts, data.sales, data.expenses, data.retailSales);
  const r = movements({ ...data, changedAt, today });
  for (const a of r.accounts) assert.equal(a.current, balances[a.id], a.name);
  const main = r.accounts.find(a => a.id === 'main');
  // 10 000 + взнос 290 000 + первый взнос 5 000 + платёж 10 000 − закуп 30 000 = 285 000 на утро
  assert.equal(main.opening, 285000);
  assert.equal(main.in, 17400 + 62500 * 0.6 + 3000 + 1500);
  assert.equal(main.out, 15000);
  assert.equal(main.closing, main.current);
  assert.equal(r.accounts.find(a => a.id === 'pool').in, 62500 * 0.4);
});

test('выписка: виды операций, «задним числом», возврат и отменённый чек не в остатке', async () => {
  await domain.ready;
  const r = movements({ ...data, changedAt, accountId: 'main', today });
  const kinds = r.items.map(i => `${i.kind}:${i.amount}`);
  assert.ok(kinds.includes('Платёж:17400'));
  assert.ok(kinds.includes('Платёж:37500'), 'совместный — доля основного счёта');
  assert.ok(kinds.includes('Приход:3000'));
  assert.ok(kinds.includes('Расход:-15000'));
  assert.ok(kinds.includes('Продажа в магазине:1500'));
  assert.ok(!kinds.some(k => k.includes('999') || k.includes('700')), 'возврат клиенту и отменённый чек не двигают остаток');
  assert.equal(r.items[0].date >= r.items[r.items.length - 1].date, true, 'свежие сверху');
  // Взнос инвестора 290 000 с датой 10.10, внесённый сегодня, — в changedElsewhere; платежи договора s1 — нет
  assert.deepEqual(r.changedElsewhere.map(x => [x.kind, x.title, x.amount]), [['Взнос инвестора', 'Ахмед', 290000]]);
  assert.match(r.note, /Удалённые записи/);
  // Период: 21.10 — первый взнос и платёж того дня
  const y = movements({ ...data, accountId: 'main', from: '2026-10-21', today });
  assert.deepEqual(y.items.map(i => i.kind).sort(), ['Первый взнос', 'Платёж']);
  assert.equal(y.accounts[0].closing, 285000);
  assert.match(movements({ ...data, accountId: 'nope', today }).error, /Счёт не найден/);
  assert.match(movements({ ...data, from: '2026-10-22', to: '2026-10-01', today }).error, /from не позже to/);
});
