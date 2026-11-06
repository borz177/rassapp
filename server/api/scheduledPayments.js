// Поиск по записанному графику, без деления цены на срок и без фактических
// платежей. Старые оплаченные строки без флага считаются фактической оплатой
// так же, как в domain.moneyIn, и не доказывают сумму планового платежа.
const cents = value => Math.round(Number(value) * 100);
const scheduledRows = sale => (Array.isArray(sale.paymentPlan) ? sale.paymentPlan : [])
  .filter(p => p && (p.isRealPayment === false || p.isRealPayment == null && !p.isPaid)
    && Number.isFinite(Number(p.amount)) && Number(p.amount) > 0);
const scheduledPaymentAmounts = sale => [...new Set(scheduledRows(sale).map(p => cents(p.amount)))]
  .sort((a, b) => a - b).map(n => n / 100);
const matchingScheduledPayments = (sale, amount) => {
  const rows = scheduledRows(sale).filter(p => cents(p.amount) === cents(amount));
  return { amount, count: rows.length, unpaidCount: rows.filter(p => !p.isPaid).length };
};
module.exports = { scheduledPaymentAmounts, matchingScheduledPayments };
