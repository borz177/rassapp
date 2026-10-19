// Платёжная дисциплина клиента — для «стоит ли давать ещё в рассрочку».
//
// По каждому договору: для каждой строки графика — когда её на самом деле
// закрыли. Деньги идут по порядку, как в приложении (первый взнос, затем
// строки графика по датам), поэтому строка закрыта в тот день, когда сумма
// поступлений впервые догнала долг «по эту строку включительно». Опоздание —
// дни от даты по графику до этого дня; не закрыта, а срок прошёл — до сегодня.

const DAY = 86400000;
const LATE_DAYS = 3; // пара дней — не опоздание: выходные, перевод в пути

const dayOf = (d) => { const t = new Date(d); t.setHours(0, 0, 0, 0); return t.getTime(); };

/** Опоздания по одному договору: [{ due, paidOn|null, delay }] только по наступившим строкам */
const slotDelays = (sale, today = Date.now()) => {
  const plan = Array.isArray(sale.paymentPlan) ? sale.paymentPlan : [];
  const slots = plan.filter(p => p.isRealPayment !== true && p.date)
    .map(p => ({ due: dayOf(p.date), amount: Number(p.amount) || 0 }))
    .sort((a, b) => a.due - b.due);
  // Поступления: реальные платежи (и оплаченные строки старого формата — у них isRealPayment не задан)
  const money = plan.filter(p => p.isPaid && p.isRealPayment !== false)
    .map(p => ({ on: dayOf(p.actualDate || p.date), amount: (Number(p.amount) || 0) + (Number(p.discountAmount) || 0) }))
    .sort((a, b) => a.on - b.on);
  const now = dayOf(today);
  let owed = Number(sale.downPayment) || 0; // первый взнос внесён при оформлении
  let paid = owed;
  let i = 0;
  const out = [];
  for (const s of slots) {
    if (s.due > now) break;
    owed += s.amount;
    while (paid + 0.5 < owed && i < money.length) paid += money[i++].amount;
    const paidOn = paid + 0.5 >= owed ? (i > 0 ? Math.max(money[i - 1].on, 0) : dayOf(sale.startDate)) : null;
    out.push({ due: s.due, paidOn, delay: Math.max(0, Math.round(((paidOn ?? now) - s.due) / DAY)) });
  }
  return out;
};

/** Сводка по всем договорам клиента */
const customerDiscipline = (sales, today = Date.now()) => {
  const real = sales.filter(s => s.type === 'INSTALLMENT' && !String(s.customerId || '').startsWith('system_'));
  const all = real.flatMap(s => slotDelays(s, today));
  const late = all.filter(x => x.delay > LATE_DAYS);
  const openLate = all.filter(x => x.paidOn === null && x.delay > 0);
  return {
    contracts: real.length,
    active: real.filter(s => s.status === 'ACTIVE' || s.status === 'DRAFT').length,
    completed: real.filter(s => s.status === 'COMPLETED').length,
    paymentsDue: all.length,
    paidLate: late.length,
    maxDelayDays: all.reduce((m, x) => Math.max(m, x.delay), 0),
    avgDelayWhenLate: late.length ? Math.round(late.reduce((n, x) => n + x.delay, 0) / late.length) : 0,
    overdueNowPayments: openLate.length,
  };
};

module.exports = { slotDelays, customerDiscipline, LATE_DAYS };
