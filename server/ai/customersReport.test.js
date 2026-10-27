// «База клиентов» (shared/excelReport.js buildCustomerRows) — строка на клиента; агент
// (customers_report) считает число клиентов тем же кодом, приложение собирает файл.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'shared', 'excelReport.js')).href);
const now = Date.UTC(2026, 9, 27, 12);
const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 9)).toISOString();

const data = {
  customers: [
    { id: 'c1', name: 'Бацаев Ислам', phone: '+79001112233', extraPhones: [{ phone: '+79004445566', label: 'жена' }, '+79007778899'],
      address: 'Грозный', birthDate: '1990-03-15', passportSeries: '96 15', passportNumber: '482913', passportIssuedBy: 'МВД', notes: 'платит вовремя' },
    { id: 'c2', name: 'Абаев Ахмед', phone: '+79002223344' },
    { id: 'c3', name: 'Вахаев Без Договоров', phone: '' },
    { id: 'system_retail', name: 'Розничный покупатель' },
    { id: 'inv1', name: 'Инвестор как клиент' },
  ],
  investors: [{ id: 'inv1', name: 'Инвестор' }],
  sales: [
    // c1: действующий с просрочкой — 3 строки по 10 000 (две уже прошли), оплачено 10 000
    { id: 's1', customerId: 'c1', type: 'INSTALLMENT', status: 'ACTIVE', totalAmount: 30000, downPayment: 0, startDate: iso(2026, 7, 1),
      paymentPlan: [
        { id: 'p1', amount: 10000, date: iso(2026, 8, 1), isRealPayment: false }, { id: 'p2', amount: 10000, date: iso(2026, 9, 1), isRealPayment: false },
        { id: 'p3', amount: 10000, date: iso(2026, 12, 1), isRealPayment: false },
        { id: 'r1', amount: 10000, date: iso(2026, 8, 1), isPaid: true, isRealPayment: true },
      ] },
    // c1: закрытый — в «Договоров», но не в долге
    { id: 's2', customerId: 'c1', type: 'INSTALLMENT', status: 'COMPLETED', totalAmount: 12000, downPayment: 2000, startDate: iso(2025, 1, 10), paymentPlan: [] },
    // c2: действующий без просрочки, первый платёж впереди
    { id: 's3', customerId: 'c2', type: 'INSTALLMENT', status: 'ACTIVE', totalAmount: 50000, downPayment: 5000, startDate: iso(2026, 10, 20),
      paymentPlan: [{ id: 'p4', amount: 45000, date: iso(2026, 11, 20), isRealPayment: false }] },
    // c2: наличные — договор есть, в сумме рассрочек и долге нет
    { id: 's4', customerId: 'c2', type: 'CASH', status: 'COMPLETED', totalAmount: 9000, startDate: iso(2026, 2, 1), paymentPlan: [] },
    { id: 's5', customerId: 'system_retail', type: 'CASH', status: 'COMPLETED', totalAmount: 500, startDate: iso(2026, 3, 1), paymentPlan: [] },
    { id: 's6', customerId: 'inv1', type: 'INSTALLMENT', status: 'ACTIVE', totalAmount: 1000, startDate: iso(2026, 3, 1), paymentPlan: [] },
  ],
};

test('база клиентов: строка на клиента, без системных и инвесторов; долг и просрочка — как в отчёте', async () => {
  const { buildCustomerRows } = await load();
  const rows = buildCustomerRows(data, { now });
  assert.deepEqual(rows.map(r => r['Клиент']), ['Абаев Ахмед', 'Бацаев Ислам', 'Вахаев Без Договоров'], 'по алфавиту, без системных и инвесторов');
  const b = rows.find(r => r['Клиент'] === 'Бацаев Ислам');
  assert.equal(b['Доп. телефоны'], '+79004445566, +79007778899');
  assert.equal(b['Дата рождения'], '15.03.1990');
  assert.equal(b['Паспорт'], '96 15 482913');
  assert.deepEqual([b['Договоров'], b['Действующих'], b['Сумма договоров'], b['Остаток долга'], b['Просрочка']], [2, 1, 42000, 20000, 10000]);
  assert.equal(b['Первый договор'], new Date(iso(2025, 1, 10)).toLocaleDateString('ru-RU'));
  const a = rows.find(r => r['Клиент'] === 'Абаев Ахмед');
  assert.deepEqual([a['Договоров'], a['Действующих'], a['Сумма договоров'], a['Остаток долга'], a['Просрочка']], [2, 1, 50000, 45000, 0]);
  const v = rows.find(r => r['Клиент'] === 'Вахаев Без Договоров');
  assert.deepEqual([v['Договоров'], v['Остаток долга'], v['Первый договор']], [0, 0, '']);
});

test('база клиентов: фильтры «только действующие» и «только с просрочкой»', async () => {
  const { buildCustomerRows } = await load();
  assert.deepEqual(buildCustomerRows(data, { now, onlyActive: true }).map(r => r['Клиент']), ['Абаев Ахмед', 'Бацаев Ислам']);
  assert.deepEqual(buildCustomerRows(data, { now, onlyOverdue: true }).map(r => r['Клиент']), ['Бацаев Ислам']);
  assert.deepEqual(buildCustomerRows({ customers: [], sales: [] }, { now }), []);
});

test('база клиентов: файл xlsx читается обратно — лист, шапка, деньги числами', async () => {
  const { buildCustomersExcel } = await load();
  const XLSX = require('xlsx');
  const { base64, count } = buildCustomersExcel(XLSX, data, { now });
  assert.equal(count, 3);
  const wb = XLSX.read(base64, { type: 'base64' });
  assert.deepEqual(wb.SheetNames, ['База клиентов']);
  const back = XLSX.utils.sheet_to_json(wb.Sheets['База клиентов']);
  assert.equal(back.length, 3);
  assert.equal(back[1]['Остаток долга'], 20000);
  assert.equal(buildCustomersExcel(XLSX, { customers: [], sales: [] }).base64, null);
});
