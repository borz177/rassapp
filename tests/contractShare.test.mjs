import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({
  entryPoints: ['src/contractShare.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const S = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`
);
const base = () => ({
  contractNo: '303',
  managerPhone: '89280006271',
  remaining: 28600,
  overdue: 0,
  customer: {
    id: 'c',
    name: 'Тестовый клиент',
    birthDate: '1990-01-02',
    phone: '+79001234567',
    passportNumber: '003456',
  },
  sale: {
    id: 's',
    customerId: 'c',
    type: 'INSTALLMENT',
    status: 'ACTIVE',
    startDate: '2026-11-07',
    productName: '№896 СТИРАЛЬНАЯ МАШИНА',
    totalAmount: 28600,
    downPayment: 0,
    remainingAmount: 28600,
    paymentDay: 10,
    installments: 4,
    paymentPlan: Array.from({ length: 4 }, (_, i) => ({
      id: 'p' + i,
      amount: 7150,
      isRealPayment: false,
      isPaid: false,
      date: `2027-${String(i + 1).padStart(2, '0')}-10`,
    })),
  },
});
const normal = (t) => t.replace(/[\u00a0\u202f]/g, ' ');
const MESSAGE_PREFS = {
  ...S.CONTRACT_SHARE_DEFAULTS,
  product: true,
  total: true,
  downPayment: true,
  monthly: true,
  paymentDay: true,
  remaining: true,
  manager: true,
  customer: false,
  birth: false,
};
test('по умолчанию только ФИО, дата рождения, дата и номер; сохранённый выбор сохраняет приоритет', () => {
  const prefs = S.normalizeContractSharePrefs(null);
  assert.deepEqual(
    Object.keys(prefs)
      .filter((k) => prefs[k])
      .sort(),
    ['birth', 'customer', 'date', 'number']
  );
  const text = S.contractShareText(base(), prefs, false);
  assert.match(text, /Договор № \*303\* от 07\.11\.2026/);
  assert.match(text, /Тестовый клиент/);
  assert.match(text, /02\.01\.1990/);
  assert(!text.includes('Товар:'));
  assert(!text.includes(' ₽'));
  assert(!text.includes('wa.me'));
  assert(!text.includes('Телефон клиента'));
  assert.deepEqual(S.normalizeContractSharePrefs({ ...prefs, total: true, birth: false }), {
    ...prefs,
    total: true,
    birth: false,
  });
});

test('включённые условия: сообщение по примеру, нулевой взнос и платёж графика; паспорт не отправляется', () => {
  const data = base(),
    before = JSON.stringify(data);
  data.sale.paymentPlan.push({
    id: 'real',
    amount: 20000,
    isPaid: true,
    isRealPayment: true,
    date: '2026-11-08',
  });
  const t = normal(S.contractShareText(data, MESSAGE_PREFS, false));
  assert.match(t, /Договор № \*303\* от 07\.11\.2026/);
  assert.match(t, /№896 СТИРАЛЬНАЯ МАШИНА/);
  assert.match(t, /Сумма договора: \*28 600 ₽\*/);
  assert.match(t, /Первоначальный взнос: \*0 ₽\*/);
  assert.match(t, /Ежемесячный платёж: \*7 150 ₽\*/);
  assert.match(t, /\*10-го числа\* каждого месяца/);
  assert.match(t, /Остаток долга: \*28 600 ₽\*/);
  assert.match(t, /https:\/\/wa.me\/79280006271$/);
  assert(!t.includes('Тестовый клиент'));
  assert(!t.includes('003456'));
  assert(!t.includes('20 000'));
  data.sale.paymentPlan.pop();
  assert.equal(JSON.stringify(data), before, 'Формирование сообщения не меняет учёт');
});
test('каждое поле выключается, выбор не подмешивает персональные данные; испорченные настройки читаются безопасно', () => {
  const off = Object.fromEntries(Object.keys(S.CONTRACT_SHARE_DEFAULTS).map((k) => [k, false]));
  const text = S.contractShareText(base(), off, false);
  assert.equal(text, '✅ Оформлена рассрочка');
  const explicit = { ...off, customer: true, birth: true, phone: true };
  const t = S.contractShareText(base(), explicit, false);
  assert.match(t, /Тестовый клиент/);
  assert.match(t, /02\.01\.1990/);
  assert.match(t, /\+79001234567/);
  assert(!t.includes('wa.me'));
  assert.deepEqual(S.normalizeContractSharePrefs({ total: 'false', phone: true, unknown: true }), {
    ...S.CONTRACT_SHARE_DEFAULTS,
    phone: true,
  });
  assert.deepEqual(S.normalizeContractSharePrefs(null), S.CONTRACT_SHARE_DEFAULTS);
});
test('переменный график не заменяется делением цены на срок или произвольной фактической оплатой', () => {
  const d = base();
  d.sale.paymentPlan[0].amount = 1000;
  d.sale.paymentPlan[1].amount = 2000;
  d.sale.paymentPlan[2].amount = 3000;
  const t = S.contractShareText(d, MESSAGE_PREFS);
  assert.match(t, /индивидуальному графику/);
  assert(!t.includes('Ежемесячный платёж:'));
  assert.equal(S.contractShareSchedule(d.sale).monthly, null);
  d.sale.paymentPlan = [{ id: 'real', isRealPayment: true, isPaid: true, amount: 19000, date: '2026-01-01' }];
  assert.equal(S.contractShareSchedule(d.sale).monthly, null);
  assert(!S.contractShareText(d, MESSAGE_PREFS).includes('Ежемесячный платёж:'));
});
test('отдельный последний платёж указан явно; одиночная оплата не названа ежемесячной', () => {
  const d = base();
  d.sale.paymentPlan[3].amount = 6500;
  const t = normal(S.contractShareText(d, MESSAGE_PREFS));
  assert.match(t, /Ежемесячный платёж: \*7 150 ₽\*/);
  assert.match(t, /Последний платёж: \*6 500 ₽\*/);
  d.sale.paymentPlan = d.sale.paymentPlan.slice(0, 1);
  const single = S.contractShareText(d, MESSAGE_PREFS);
  assert.match(single, /Платёж по графику/);
  assert(!single.includes('Ежемесячный'));
});
test('даты по Москве, конец короткого месяца и отсутствие выдуманного постоянного дня у нерегулярного графика', () => {
  const d = base();
  delete d.sale.paymentDay;
  d.sale.paymentPlan = [
    ['2027-01-31', 31],
    ['2027-02-28', 28],
    ['2027-03-31', 31],
  ].map(([date], i) => ({ id: 'p' + i, date, amount: 100, isRealPayment: false, isPaid: false }));
  assert.equal(S.contractShareSchedule(d.sale).paymentDay, 31);
  d.sale.paymentPlan[1].date = '2027-02-15';
  assert.equal(S.contractShareSchedule(d.sale).paymentDay, null);
  assert.equal(S.shareDate('2026-11-06T21:00:00Z'), '07.11.2026');
  assert.equal(S.shareDate('invalid'), '');
});
test('остаток и просрочка — текущие готовые суммы, закрытый договор и черновик подписаны правильно', () => {
  const d = base();
  d.remaining = 1234.56;
  d.overdue = 234.56;
  d.sale.status = 'ACTIVE';
  const t = normal(S.contractShareText(d, { ...MESSAGE_PREFS, overdue: true }, true));
  assert.match(t, /Оформлена рассрочка/);
  assert.match(t, /Остаток долга: \*1 234,56 ₽\*/);
  assert.match(t, /Просрочено: \*234,56 ₽\*/);
  d.sale.status = 'COMPLETED';
  assert(!S.contractShareText(d, MESSAGE_PREFS).includes('погашена'));
  d.remaining = 0;
  assert.match(S.contractShareText(d, MESSAGE_PREFS), /Рассрочка погашена/);
  d.sale.status = 'DRAFT';
  assert.match(S.contractShareText(d, MESSAGE_PREFS), /^📝 Черновик/);
  d.sale.type = 'CASH';
  d.sale.status = 'COMPLETED';
  const cash = S.contractShareText(d, MESSAGE_PREFS);
  assert.match(cash, /Оформлена продажа/);
  assert(!cash.includes('Ежемесячный'));
  assert(!cash.includes('Первоначальный'));
  assert(!cash.includes('каждого месяца'));
});
test('нет номера менеджера — нет выдуманной ссылки; переносы в товаре не склеивают разделы', () => {
  const d = base();
  d.managerPhone = '';
  d.sale.productName = 'Телефон\n\t модель';
  const text = S.contractShareText(d, MESSAGE_PREFS);
  assert(!text.includes('wa.me'));
  assert.match(text, /Товар: Телефон модель\n\n💳/);
});
