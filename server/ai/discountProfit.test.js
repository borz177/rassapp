// Скидка из прибыли (shared/profit.js moneyInProfit и его серверный перенос api/domain.js):
// новые платежи со скидкой (discountFromProfit) уменьшают прибыль на всю скидку, вложенное
// возвращается полностью; прежние (без пометки) считаются как раньше.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const domain = require('../api/domain');

const load = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'shared', 'profit.js')).href);
// 120 000 в рассрочку, закуп 100 000 (наценка 1/6), 6 × 10 000 оплачено, остаток 60 000 закрыт за 54 000 со скидкой 6 000
const sale = (flag, discount = 6000) => ({
  id: 's', totalAmount: 120000, buyPrice: 100000, downPayment: 0, paymentPlan: [
    ...Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, amount: 10000, date: `2026-0${i + 1}-15`, isPaid: true, isRealPayment: true })),
    { id: 'payoff', amount: 60000 - discount, discountAmount: discount, ...(flag ? { discountFromProfit: true } : {}), date: '2026-07-15', isPaid: true, isRealPayment: true },
  ],
});
const total = (fn, s) => s.paymentPlan.reduce((n, p) => n + fn(s, p, false), 0) + 0; // + 0 — без «минус нуля»

test('скидка из прибыли: прибыль 20 000 − 6 000 = 14 000, вложенное 100 000 вернулось полностью', async () => {
  const { moneyInProfit } = await load();
  const s = sale(true);
  const profit = total(moneyInProfit, s);
  assert.equal(Math.round(profit), 14000);
  const received = s.paymentPlan.reduce((n, p) => n + p.amount, 0);
  assert.equal(Math.round(received - profit), 100000, 'возврат вложенного');
  assert.equal(Math.round(total(domain.moneyInProfit, s)), 14000, 'сервер считает так же');
});

test('прежние скидки без пометки — как раньше: прибыль 19 000', async () => {
  const { moneyInProfit } = await load();
  assert.equal(Math.round(total(moneyInProfit, sale(false))), 19000);
  assert.equal(Math.round(total(domain.moneyInProfit, sale(false))), 19000);
});

test('скидка больше всей наценки: прибыль по договору 0, не в минус; убыточный договор — по-старому', async () => {
  const { moneyInProfit } = await load();
  const s = sale(true, 30000);
  assert.equal(Math.round(total(moneyInProfit, s)) + 0, 0);
  assert.equal(Math.round(total(domain.moneyInProfit, s)) + 0, 0);
  const loss = { ...sale(true), buyPrice: 130000 };
  const lossOld = { ...sale(false), buyPrice: 130000 };
  assert.equal(Math.round(total(moneyInProfit, loss)), Math.round(total(moneyInProfit, lossOld)));
});

test('скидка делится по процентам: у инвестора 60 % — 60 % от прибыли со скидкой', async () => {
  const { investorProfitAccruals } = await load();
  const account = { id: 'acc', type: 'INVESTOR', ownerId: 'inv', managerProfitPercent: 40 };
  const investors = [{ id: 'inv', name: 'Инвестор', profitPercentage: 60, initialAmount: 100000, joinedDate: '2025-01-01' }];
  const s = { ...sale(true), accountId: 'acc', startDate: '2025-12-15' };
  const got = investorProfitAccruals(account, investors, [s], 'inv').reduce((n, a) => n + a.amount, 0);
  assert.equal(Math.round(got), Math.round(14000 * 0.6));
});
