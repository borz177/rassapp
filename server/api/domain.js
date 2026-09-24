// Расчёты, которые API отдаёт наружу: остаток счёта, просрочка, прибыль.
//
// Это перенос формул из src/utils.ts на сервер — в приложении они живут на
// TypeScript, и подключить их сюда нельзя. Расхождение между API и экраном было
// бы хуже отсутствия цифры вовсе, поэтому перенос дословный, а тест
// api_domain_parity сверяет обе реализации на боевых данных.

// Все поступления денег по договору: первый взнос + оплаченные строки графика.
// isRealPayment === false — плановая строка, денег по ней ещё нет.
const moneyIn = sale => [
  { id: `${sale.id}_dp`, date: sale.startDate, amount: Number(sale.downPayment) || 0 },
  ...(sale.paymentPlan || [])
    .filter(p => p.isPaid && p.isRealPayment !== false)
    .map(p => ({ id: p.id, date: p.date, amount: Number(p.amount) || 0 })),
];

const collected = sale => moneyIn(sale).reduce((sum, p) => sum + p.amount, 0);

// Доля прибыли в каждом полученном рубле. Убыточный договор даёт отрицательную
// наценку — так же, как в приложении (см. saleProfitMargin в src/utils.ts).
const profitMargin = (sale, paymentsOnly = false) => {
  const total = Number(sale.totalAmount) || 0;
  const profit = total - (Number(sale.buyPrice) || 0);
  if (profit === 0) return 0;
  const base = paymentsOnly ? total - (Number(sale.downPayment) || 0) : total;
  return base > 0 ? profit / base : 0;
};

const moneyInProfit = (sale, money, paymentsOnly = false) => {
  if (paymentsOnly && money.id === `${sale.id}_dp`) return 0;
  return (Number(money.amount) || 0) * profitMargin(sale, paymentsOnly);
};

const receivedProfit = (sale, paymentsOnly = false) =>
  moneyIn(sale).reduce((sum, p) => sum + moneyInProfit(sale, p, paymentsOnly), 0);

// Просрочка по договору на дату. Порог в 1 ₽ — против копеечных хвостов
// округления, из-за которых договор иначе висит «просроченным» на 0,03 ₽.
const overdueAmount = (sale, today) => {
  const cutoff = today || (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
  let expected = Number(sale.downPayment) || 0;
  (sale.paymentPlan || []).forEach(p => {
    if (!p.isRealPayment && new Date(p.date) < cutoff) expected += Number(p.amount) || 0;
  });
  const paid = (Number(sale.totalAmount) || 0) - (Number(sale.remainingAmount) || 0);
  const overdue = Math.round((expected - paid) * 100) / 100;
  return overdue >= 1 ? overdue : 0;
};

// Остаток счёта. Порядок слагаемых тот же, что в computeAccountBalances:
// начальный остаток + взносы и платежи по договорам − расходы (кроме возвратов)
// + розница (долговой чек денег не приносит, приносят платежи по нему).
const accountBalances = (accounts, sales, expenses, retailSales = []) => {
  const balances = {};
  accounts.forEach(acc => {
    let total = Number(acc.initialBalance) || 0;

    sales.filter(s => s.accountId === acc.id).forEach(s => {
      total += Number(s.downPayment) || 0;
      (s.paymentPlan || [])
        .filter(p => p.isPaid && p.isRealPayment !== false)
        .forEach(p => { total += Number(p.amount) || 0; });
    });

    total -= expenses
      .filter(e => e.accountId === acc.id && e.isRefund !== true)
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    (retailSales || []).filter(r => !r.isCancelled).forEach(r => {
      if (!r.isCredit && r.accountId === acc.id) total += Number(r.total) || 0;
      (r.payments || []).forEach(pm => { if (pm.accountId === acc.id) total += Number(pm.amount) || 0; });
    });

    balances[acc.id] = Math.round(total * 100) / 100;
  });
  return balances;
};

module.exports = { moneyIn, collected, profitMargin, moneyInProfit, receivedProfit, overdueAmount, accountBalances };
