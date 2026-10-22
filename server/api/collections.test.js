const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectionPayments, collectionAmount, isCustomerSale } = require('../../shared/collections.js');
const { fundingPieces } = require('../../shared/funding.js');
const { buildReportRows } = require('../../shared/excelReport.js');
const { digestStats, digestText } = require('../ai/digest');
const domain = require('./domain');

const sale = () => ({
  id: 'contract', type: 'INSTALLMENT', accountId: 'a', customerId: 'customer',
  productName: 'Товар', startDate: '2026-10-20', status: 'ACTIVE',
  totalAmount: 1000, buyPrice: 800, downPayment: 200, remainingAmount: 650,
  paymentPlan: [
    { id: 'real', date: '2026-10-20', amount: 100, isPaid: true, isRealPayment: true },
    { id: 'legacy', date: '2026-10-20', amount: 50, isPaid: true },
    { id: 'planned', date: '2026-10-20', amount: 999, isPaid: true, isRealPayment: false },
    { id: 'unpaid', date: '2026-11-20', amount: 650, isPaid: false, isRealPayment: true },
  ],
});

test('collection mode excludes only the initial installment payment, preserving source records and cash sales', () => {
  const s = sale();
  const original = structuredClone(s);
  assert.equal(collectionAmount(s), 350);
  assert.equal(collectionAmount(s, true), 150);
  assert.deepEqual(collectionPayments(s, true).map(p => p.id), ['real', 'legacy']);
  assert.equal(collectionAmount({ ...s, type: 'CASH', downPayment: 400, paymentPlan: [] }, true), 400);
  assert.equal(collectionAmount({ ...s, downPayment: 0, paymentPlan: undefined }, true), 0);
  assert.deepEqual(s, original);
  assert.equal(isCustomerSale({ customerId: 'system_income' }), false);
  assert.equal(isCustomerSale({ customerId: 'investor' }, new Set(['investor'])), false);
});

test('jointly funded contract collections sum to the same amount before and after the toggle', () => {
  const s = { ...sale(), funding: [{ accountId: 'a', amount: 300 }, { accountId: 'b', amount: 500 }] };
  const pieces = fundingPieces(s);
  for (const mode of [false, true]) {
    assert.equal(pieces.reduce((sum, p) => sum + collectionAmount(p, mode), 0), collectionAmount(s, mode));
  }
});

test('Excel summary, investor totals and payment detail follow the setting; raw debt and contribution stay identical', () => {
  const data = { sales: [sale()], customers: [{ id: 'customer', name: 'Клиент' }], accounts: [], investors: [] };
  const full = buildReportRows(data);
  const filtered = buildReportRows({ ...data, settings: { collectedWithoutDownPayment: true } });
  const total = rows => Number(rows.summaryData.find(r => r['Параметр'].includes('Собрано'))['Значение'].replace(/[^\d.-]/g, ''));
  assert.equal(total(full), 350);
  assert.equal(total(filtered), 150);
  assert.equal(full.investorData[0]['Получено'], 350);
  assert.equal(filtered.investorData[0]['Получено'], 150);
  // Взнос хранится отдельно в обзоре: старые версии импорта не получат дубль оплаты.
  assert.ok(!full.paymentsData.some(r => r['Платёж'] === 'Первый взнос'));
  assert.deepEqual(filtered.paymentsData, full.paymentsData);
  assert.deepEqual(filtered.overviewData, full.overviewData);
  assert.equal(total(buildReportRows({ ...data, settings: { collectedWithoutDownPayment: true } }, { includePlanned: true })), 150);
});

test('morning digest respects collection mode without changing due and overdue calculations', () => {
  const full = digestStats([sale()], [], '2026-10-21');
  const filtered = digestStats([sale()], [], '2026-10-21', true);
  assert.equal(full.receivedYesterday, 350);
  assert.equal(filtered.receivedYesterday, 150);
  assert.match(digestText(filtered), /без первых взносов/);
  assert.equal(filtered.overdueSum, full.overdueSum);
  assert.equal(filtered.dueSum, full.dueSum);
});

test('API summary follows the tenant setting and account/period filters; cash, profit and contract facts stay intact', async () => {
  const express = require('express');
  const { createApiV1Router } = require('./v1');
  let mode = false;
  const fixtures = {
    accounts: [{ id: 'a', initialBalance: 0 }], sales: [sale()], expenses: [], retailSales: [], investors: [],
  };
  const pool = { query: async (sql, args) => {
    assert.equal(args[0], 'owner');
    const values = args[1] === 'settings' ? [{ collectedWithoutDownPayment: mode }] : fixtures[args[1]];
    return { rows: values.map(data => ({ data })) };
  } };
  const app = express();
  app.use((req,res,next) => { req.apiAuth = { userId: 'owner', scopes: ['read'] }; next(); });
  app.use('/api/v1', createApiV1Router({ pool }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  try {
    const get = async path => { const r = await fetch(base + path); assert.equal(r.status, 200); return (await r.json()).data; };
    const full = await get('/reports/summary?from=2026-10-20&to=2026-10-20&accountId=a');
    mode = true;
    const filtered = await get('/reports/summary?from=2026-10-20&to=2026-10-20&accountId=a');
    assert.equal(full.money.collected, 350);
    assert.equal(filtered.money.collected, 150);
    assert.equal(filtered.money.collectedWithoutDownPayment, true);
    for (const key of ['profit', 'cashOnAccounts', 'outstandingDebt', 'overdueDebt']) assert.equal(filtered.money[key], full.money[key]);
    assert.equal((await get('/reports/summary?accountId=other')).money.collected, 0);
    assert.equal((await get('/reports/summary?from=2026-10-21&to=2026-10-21')).money.collected, 0);
    const contract = (await get('/contracts')).items?.[0] || (await get('/contracts'))[0];
    assert.equal(contract.collectedAmount, domain.collected(sale()));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
