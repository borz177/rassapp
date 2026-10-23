const { test } = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../api/domain');
const c = require('./collections');
const stock = require('./stock');

const today = c.mskDay();
const at = (offset) => new Date(`${c.addDays(today, offset)}T00:00:00+03:00`).toISOString();
// Договор на 120 000 ₽ без взноса, 12 платежей по 10 000 ₽ раз в месяц (каждые 30 дней от first)
const contract = (id, customerId, { first = -45, paid = [], buyPrice = 100000 } = {}) => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: `${id}_r${i}`, saleId: id, amount: 10000, date: at(first + i * 30), isPaid: false, isRealPayment: false }));
  const real = paid.map(([amount, offset], i) => ({ id: `${id}_p${i}`, saleId: id, amount, date: at(offset), actualDate: at(offset), isPaid: true, isRealPayment: true }));
  const sum = paid.reduce((n, [a]) => n + a, 0);
  let left = sum;
  for (const r of rows) { if (left >= r.amount) { r.isPaid = true; left -= r.amount; } }
  return { id, customerId, type: 'INSTALLMENT', status: 'ACTIVE', productName: `Товар ${id}`, totalAmount: 120000, downPayment: 0, buyPrice,
    remainingAmount: 120000 - sum, startDate: at(first - 30), paymentPlan: [...rows, ...real] };
};

test('строки графика: частично оплаченная строка остаётся открытой на недостающую часть', () => {
  const s = contract('a', 'c1', { paid: [[15000, -40]] });
  const open = c.openRows(s);
  assert.equal(open[0].open, 5000);
  assert.equal(open.length, 11);
});

test('месяцы: 31-е в коротком месяце — последний день', () => {
  assert.equal(c.addMonthsDay('2026-01-31', 1), '2026-02-28');
  assert.equal(c.addMonthsDay('2026-11-15', 2), '2027-01-15');
});

test('прогноз: по неделям, реалистично ниже ожидаемого у опаздывающих, просрочка отдельно', async () => {
  await domain.ready;
  // Аккуратный: три наступивших платежа оплачены в срок; опаздывающий — три наступивших не оплачены
  const good = contract('g', 'cg', { first: -80, paid: [[10000, -80], [10000, -50], [10000, -20]] });
  const bad = contract('b', 'cb', { first: -80 });
  const income = { id: 'inc', customerId: 'system_income', type: 'CASH', status: 'COMPLETED', totalAmount: 5000, remainingAmount: 0, paymentPlan: [] };
  const inv = contract('i', 'investor1', { first: -80 });
  const f = c.forecast({ sales: [good, bad, income, inv], customers: [{ id: 'cg', name: 'Аккуратов' }, { id: 'cb', name: 'Опаздывающий' }], investors: [{ id: 'investor1' }], today, days: 30 });
  assert.equal(f.scheduled.count, 2);
  assert.equal(f.scheduled.total, 20000);
  assert.ok(f.realistic < f.scheduled.total && f.realistic >= 10000);
  assert.equal(f.byWeek.reduce((n, w) => n + w.total, 0), 20000);
  assert.equal(f.overdueNow.contracts, 1);
  assert.equal(f.overdueNow.total, 30000);
  assert.deepEqual(f.risky.map(r => r.customer), ['Опаздывающий']);
});

test('очередь взыскания: сорвавший обещание первым, ждущий оплаты по обещанию — последним, стадии по дням', async () => {
  await domain.ready;
  const big = contract('big', 'c1', { first: -100 });       // 4 месяца просрочки
  const broken = contract('brk', 'c2', { first: -5 });      // 5 дней
  const waiting = contract('wait', 'c3', { first: -20 });   // 20 дней
  const promises = [
    { id: 'p1', sale_id: 'brk', amount: 10000, due_date: c.addDays(today, -1), status: 'active', created_at: at(-3) },
    { id: 'p2', sale_id: 'wait', amount: 10000, due_date: c.addDays(today, 3), status: 'active', created_at: at(-1) },
  ];
  const q = c.collectionQueue({ sales: [big, broken, waiting], customers: [{ id: 'c1', name: 'Первый' }, { id: 'c2', name: 'Второй' }, { id: 'c3', name: 'Третий' }], promises, today });
  assert.deepEqual(q.items.map(x => x.contractId), ['brk', 'big', 'wait']);
  assert.equal(q.items[0].promise.status, 'broken');
  assert.equal(q.items[2].promise.status, 'pending');
  assert.deepEqual(q.items.map(x => x.stage), ['soft', 'final', 'firm']);
});

test('обещание сдержано, если после него пришёл платёж на эту сумму', () => {
  const s = contract('k', 'c', { first: -20, paid: [[10000, 0]] });
  assert.equal(c.promiseStatus({ amount: 10000, due_date: c.addDays(today, 2), created_at: at(-1) }, s, today).status, 'kept');
  assert.equal(c.promiseStatus({ amount: 10000, due_date: c.addDays(today, -1), created_at: at(1) }, s, today).status, 'broken');
  const d = c.promiseDigest({ promises: [{ sale_id: 'k', amount: 5000, due_date: today, created_at: at(1) }], sales: [s], customers: [{ id: 'c', name: 'Клиент' }], today });
  assert.deepEqual(d.dueToday, [{ name: 'Клиент', amount: 5000 }]);
});

test('досрочное погашение: скидка от остатка и предел — наценка в остатке', () => {
  const s = contract('q', 'c', { paid: [[60000, -10]] });
  const q = c.payoffQuote(s, { discountPercent: 10 });
  assert.equal(q.remaining, 60000);
  assert.equal(q.markupInRemaining, 10000); // наценка 20 000 из 120 000 — 1/6 каждого рубля
  assert.equal(q.discount, 6000);
  assert.equal(q.toPay, 54000);
  assert.equal(q.belowPurchase, false);
  assert.equal(c.payoffQuote(s, { discountAmount: 15000 }).belowPurchase, true);
});

test('реструктуризация: закрытые месяцы и деньги остаются, остаток делится, внесённая часть строки — в первый новый', async () => {
  await domain.ready;
  const s = contract('r', 'c', { first: -45, paid: [[25000, -10]] });
  const start = c.addDays(today, 10);
  const p = c.restructurePlan(s, 5, start, today, 1);
  assert.equal(p.error, undefined);
  const plan = p.sale.paymentPlan.filter(x => x.isRealPayment !== true);
  assert.equal(p.sale.installments, 7);
  assert.equal(plan.length, 7);
  assert.equal(plan.reduce((n, x) => n + x.amount, 0), 120000);
  assert.equal(p.partialCarried, 5000);
  assert.deepEqual(c.openRows(p.sale).map(r => r.open), [19000, 19000, 19000, 19000, 19000]);
  assert.equal(c.openRows(p.sale)[0].day, start);
  assert.equal(p.sale.paymentPlan.filter(x => x.isRealPayment === true).length, 1);
  assert.equal(domain.overdueAmount(p.sale), 0);
  assert.equal(p.sale.remainingAmount, 95000);
  assert.match(c.restructurePlan(s, 5, c.addDays(today, -1), today).error, /прошла/);
  assert.match(c.restructurePlan(s, 0, start, today).error, /от 1 до 60/);
  assert.match(c.restructurePlan({ ...s, remainingAmount: 0 }, 3, start, today).error, /оплачен/);
});

// ── склад ───────────────────────────────────────────────────────────────────
const products = () => [
  { id: 'p1', userId: 'o', name: 'Чехол', price: 1500, buyPrice: 500, stock: 10, unit: 'шт' },
  { id: 'p2', userId: 'o', name: 'Зарядка', price: 2500, buyPrice: 1200, stock: 3, warehouseStocks: { main: 1, w2: 2 } },
  { id: 'p3', userId: 'o', name: 'Старый', price: 100, stock: 0, isArchived: true },
];

test('приход: нужен поставщик, остаток по складу растёт, закуп — по приходу, номер — следующий', () => {
  const ctx = { products: products(), warehouses: [], suppliers: [{ id: 's1', name: 'ООО Поставка' }], movements: [{ id: 'm', type: 'IN', batchId: 'doc_1' }], ownerId: 'o' };
  assert.match(stock.planReceive({ ...ctx, args: { items: [{ productId: 'p1', quantity: 5 }] } }).error, /поставщик/i);
  assert.match(stock.planReceive({ ...ctx, args: { supplier: 'поставка', items: [{ productId: 'p3', quantity: 1 }] } }).error, /архиве/);
  const r = stock.planReceive({ ...ctx, args: { supplier: 'поставка', items: [{ productId: 'p1', quantity: 5, price: 450 }, { productId: 'p1', quantity: 1 }] } });
  assert.equal(r.movements.length, 1);
  assert.equal(r.movements[0].quantity, 6);
  assert.equal(r.movements[0].docNumber, '0002');
  assert.equal(r.movements[0].supplierId, 's1');
  assert.equal(r.products[0].stock, 16);
  assert.deepEqual(r.products[0].warehouseStocks, { main: 16 });
  assert.equal(r.products[0].buyPrice, 450);
});

test('списание: не больше остатка на складе и с причиной', () => {
  const ctx = { products: products(), warehouses: [{ id: 'main', name: 'Основной', isMain: true }, { id: 'w2', name: 'Магазин' }], movements: [], ownerId: 'o' };
  assert.match(stock.planWriteOff({ ...ctx, args: { reason: 'Брак', items: [{ productId: 'p2', quantity: 2 }] } }).error, /больше, чем есть/);
  assert.match(stock.planWriteOff({ ...ctx, args: { items: [{ productId: 'p2', quantity: 1 }] } }).error, /причина/);
  const r = stock.planWriteOff({ ...ctx, args: { reason: 'брак', warehouse: 'магазин', items: [{ productId: 'p2', quantity: 2 }] } });
  assert.equal(r.movements[0].quantity, -2);
  assert.equal(r.movements[0].note, 'Брак');
  assert.deepEqual(r.products[0].warehouseStocks, { main: 1, w2: 0 });
  assert.equal(r.products[0].stock, 1);
});

test('продажа в магазине: счёт склада, итоги чека, нехватка товара; отмена возвращает остатки', () => {
  const ctx = { products: products(), warehouses: [{ id: 'main', name: 'Основной', isMain: true, accountId: 'acc2' }],
    accounts: [{ id: 'acc1', name: 'Касса' }, { id: 'acc2', name: 'Магазин' }], retailSales: [{ id: 'x' }, { id: 'y', isCancelled: true }], customers: [], ownerId: 'o' };
  assert.match(stock.planRetailSale({ ...ctx, args: { items: [{ productId: 'p2', quantity: 2 }] } }).error, /Не хватает/);
  const r = stock.planRetailSale({ ...ctx, args: { items: [{ productId: 'p1', quantity: 2 }, { productId: 'p2', quantity: 1, price: 2000 }], discount: 500 } });
  assert.equal(r.sale.accountId, 'acc2');
  assert.equal(r.sale.subtotal, 5000);
  assert.equal(r.sale.total, 4500);
  assert.equal(r.sale.cost, 2200);
  assert.equal(r.sale.profit, 2300);
  assert.equal(r.sale.docNumber, '0002');
  assert.ok(r.movements.every(m => m.type === 'SALE' && m.saleId === r.sale.id));
  const back = stock.reverseDeltas(r.products, r.movements, 'now');
  assert.equal(back.find(p => p.id === 'p1').stock, 10);
  assert.equal(back.find(p => p.id === 'p2').warehouseStocks.main, 1);
  const noAccount = stock.planRetailSale({ ...ctx, warehouses: [], args: { items: [{ productId: 'p1', quantity: 1 }] } });
  assert.match(noAccount.error, /счёт/);
});

// ── сравнение периодов («почему») ────────────────────────────────────────────
const analytics = require('./analytics');

test('периоды: месяц по сегодня — тот же отрезок прошлого месяца; иначе — такой же длины перед ним', () => {
  assert.deepEqual(analytics.resolvePeriods({}, '2026-10-23'), { current: { from: '2026-10-01', to: '2026-10-23' }, previous: { from: '2026-09-01', to: '2026-09-23' } });
  assert.deepEqual(analytics.resolvePeriods({ from: '2026-03-01', to: '2026-03-31' }, '2026-10-23').previous, { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(analytics.resolvePeriods({ from: '2026-01-01', to: '2026-01-15' }, '2026-10-23').previous, { from: '2025-12-01', to: '2025-12-15' });
  assert.deepEqual(analytics.resolvePeriods({ from: '2026-10-10', to: '2026-10-16' }, '2026-10-23').previous, { from: '2026-10-03', to: '2026-10-09' });
  assert.match(analytics.resolvePeriods({ compareFrom: '2026-09-01' }).error, /обе даты/);
  assert.match(analytics.resolvePeriods({ from: '2026-13-01' }).error, /from/);
});

test('просрочка на прошлую дату — по платежам до этой даты', () => {
  const s = contract('o', 'c', { first: -45, paid: [[10000, -5]] });
  assert.equal(analytics.overdueOn(s, c.addDays(today, -10)), 20000); // наступило два платежа, денег ещё нет
  assert.equal(analytics.overdueOn(s, c.addDays(today, -1)), 10000);  // заплатил один, а наступило уже два
  assert.equal(analytics.overdueOn(s, c.addDays(today, -100)), 0);    // договора ещё не было
});

test('сравнение: падение сборов объясняется тем, кто перестал платить, и ростом статьи расходов', async () => {
  await domain.ready;
  const periods = { current: { from: c.addDays(today, -9), to: today }, previous: { from: c.addDays(today, -19), to: c.addDays(today, -10) } };
  const stopped = contract('s1', 'c1', { first: -80, paid: [[10000, -15]] });
  const steady = contract('s2', 'c2', { first: -80, paid: [[10000, -15], [10000, -3]] });
  const fresh = { ...contract('s3', 'c3', { first: 25 }), startDate: at(-2) };
  const expenses = [
    { id: 'e1', category: 'Аренда', amount: 30000, date: at(-3), title: 'Аренда офиса' },
    { id: 'e2', category: 'Аренда', amount: 20000, date: at(-12) },
    { id: 'exp_sale_s3', category: 'Закуп', amount: 100000, date: at(-2) },
  ];
  const r = analytics.comparePeriods({ sales: [stopped, steady, fresh], expenses, periods,
    customers: [{ id: 'c1', name: 'Перестал' }, { id: 'c2', name: 'Платит' }, { id: 'c3', name: 'Новый' }] });
  assert.equal(r.current.collected, 10000);
  assert.equal(r.previous.collected, 20000);
  assert.deepEqual(r.change.collected, { delta: -10000, percent: -50 });
  assert.deepEqual(r.drivers.stoppedPaying.customers, [{ customer: 'Перестал', previousPaid: 10000 }]);
  assert.equal(r.current.purchases, 100000);
  assert.equal(r.current.otherExpenses, 30000);
  assert.deepEqual(r.drivers.expenseCategories[0], { category: 'Аренда', current: 30000, previous: 20000, delta: 10000 });
  assert.equal(r.current.newContracts.count, 1);
  assert.equal(r.drivers.biggestExpenses[0].title, 'Аренда офиса');
});
