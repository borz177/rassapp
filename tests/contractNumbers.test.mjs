import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({
  entryPoints: ['src/utils.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const N = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`
);
const customers = [{ id: 'client' }];
const contracts = () =>
  Array.from({ length: 531 }, (_, i) => ({
    id: `contract_${String(i + 1).padStart(4, '0')}`,
    customerId: 'client',
    type: 'INSTALLMENT',
    startDate: new Date(Date.UTC(2025, 0, i + 1)).toISOString(),
  }));
test('531 договор и три более ранних взноса: последний номер 0531, а не 0534; ещё один приход его не меняет', () => {
  const sales = [
      ...contracts(),
      ...['system_income', 'system_deposit_investor', 'system_deposit_main'].map((id, i) => ({
        id: 'dep' + i,
        type: 'CASH',
        customerId: id,
        startDate: '2024-01-01',
      })),
    ],
    before = JSON.stringify(sales);
  const numbers = N.contractNumbers(sales, customers);
  assert.equal(Object.keys(numbers).length, 531);
  assert.equal(numbers.contract_0531, '0531');
  assert(!numbers.dep0);
  assert.equal(JSON.stringify(sales), before);
  assert.equal(
    N.contractNumbers(
      [...sales, { id: 'later-deposit', customerId: 'system_income', type: 'CASH', startDate: '2027-01-01' }],
      customers
    ).contract_0531,
    '0531'
  );
});
test('прямой приход инвестора и договор без клиента не нумеруются; настоящая продажа за наличные остаётся договором', () => {
  const sales = [
    { id: 'cash-client', customerId: 'client', type: 'CASH', startDate: '2026-01-01' },
    { id: 'investor-income', customerId: 'investor-id', type: 'CASH', startDate: '2025-01-01' },
    { id: 'orphan', customerId: 'deleted-client', type: 'INSTALLMENT', startDate: '2024-01-01' },
  ];
  assert.deepEqual(N.contractNumbers(sales, customers), { 'cash-client': '0001' });
  assert.equal(N.contractNumberFor(sales, sales[1], customers), undefined);
});
test('добавление нового договора и сортировка сохраняют одно правило номера; массив не мутируется', () => {
  const sales = contracts(),
    next = { id: 'new', customerId: 'client', startDate: '2027-01-01' };
  assert.equal(N.contractNumberFor(sales, next, customers), '0532');
  assert.equal(sales.length, 531);
  const sameDay = [
    { id: 'b', customerId: 'client', startDate: '2026-01-01' },
    { id: 'a', customerId: 'client', startDate: '2026-01-01' },
  ];
  assert.deepEqual(N.contractNumbers(sameDay, customers), { a: '0001', b: '0002' });
  assert.deepEqual(
    sameDay.map((s) => s.id),
    ['b', 'a']
  );
});
test('совместимость старых вызовов без списка клиентов; системные записи всё равно исключаются', () => {
  const rows = [
    { id: 'legacy', startDate: '2026-01-01' },
    { id: 'income', customerId: 'system_income', startDate: '2025-01-01' },
  ];
  assert.deepEqual(N.contractNumbers(rows), { legacy: '0001' });
  assert.equal(N.contractNumberFor(rows, rows[0]), '0001');
});
