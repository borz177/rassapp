// «Почему»: сравнение двух периодов — что изменилось и из-за чего.
//
// Цифры периода — теми же формулами, что сводка /api/v1/reports/summary
// (собрано, прибыль, расходы), а объяснения — из самих записей: какие статьи
// расходов выросли, кто платил раньше и перестал, сколько оформлено новых
// договоров. Модель только пересказывает — сама ничего не досчитывает.

const domain = require('../api/domain');
const { collectionPayments, isCustomerSale } = require('../../shared/collections.js');
const { mskDay, addDays, daysBetween, isDay } = require('./collections');

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
const inDays = (d, p) => { if (!d) return false; const day = mskDay(d); return day >= p.from && day <= p.to; };
const change = (cur, prev) => ({ delta: Math.round(cur - prev), percent: prev ? Math.round((cur - prev) / Math.abs(prev) * 1000) / 10 : null });

/**
 * Периоды по умолчанию. Месяц с первого числа по сегодня — с тем же отрезком
 * прошлого месяца (1–23 октября ↔ 1–23 сентября); иначе — такой же длины сразу
 * перед ним.
 */
const resolvePeriods = ({ from, to, compareFrom, compareTo } = {}, today = mskDay()) => {
  if (from && !isDay(from)) return { error: 'from — дата ГГГГ-ММ-ДД.' };
  if (to && !isDay(to)) return { error: 'to — дата ГГГГ-ММ-ДД.' };
  if (compareFrom && !isDay(compareFrom)) return { error: 'compareFrom — дата ГГГГ-ММ-ДД.' };
  if (compareTo && !isDay(compareTo)) return { error: 'compareTo — дата ГГГГ-ММ-ДД.' };
  const a = { from: from || `${(to || today).slice(0, 8)}01`, to: to || today };
  if (a.from > a.to) return { error: 'Начало периода позже конца.' };
  if (daysBetween(a.from, a.to) > 400) return { error: 'Период длиннее 400 дней — сузьте.' };
  let b;
  if (compareFrom || compareTo) {
    if (!compareFrom || !compareTo) return { error: 'Для периода сравнения нужны обе даты: compareFrom и compareTo.' };
    b = { from: compareFrom, to: compareTo };
    if (b.from > b.to) return { error: 'Начало периода сравнения позже конца.' };
  } else if (a.from.endsWith('-01') && a.from.slice(0, 7) === a.to.slice(0, 7)) {
    // Тот же отрезок прошлого месяца; 31-е — последний день короткого месяца
    const y = Number(a.from.slice(0, 4)), m = Number(a.from.slice(5, 7)) - 1;
    const py = m === 0 ? y - 1 : y, pm = m === 0 ? 12 : m;
    const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
    const pre = `${py}-${String(pm).padStart(2, '0')}`;
    b = { from: `${pre}-01`, to: `${pre}-${String(Math.min(Number(a.to.slice(8, 10)), last)).padStart(2, '0')}` };
  } else {
    const len = daysBetween(a.from, a.to);
    b = { from: addDays(a.from, -len - 1), to: addDays(a.from, -1) };
  }
  return { current: a, previous: b };
};

/**
 * Просрочка на конец дня: сколько должно было прийти по графику к этому дню
 * и сколько пришло. Для прошлых дат — по нынешнему графику (если график потом
 * переносили, цифра это учитывает).
 */
const overdueOn = (sale, day) => {
  if (!sale.startDate || mskDay(sale.startDate) > day) return 0;
  let expected = Number(sale.downPayment) || 0;
  let paid = Number(sale.downPayment) || 0;
  for (const p of sale.paymentPlan || []) {
    if (p.isRealPayment !== true && p.date && mskDay(p.date) <= day) expected += Number(p.amount) || 0;
    if (p.isPaid && p.isRealPayment !== false && mskDay(p.actualDate || p.date) <= day) paid += (Number(p.amount) || 0) + (Number(p.discountAmount) || 0);
  }
  const o = round(expected - paid);
  return o >= 1 ? o : 0;
};

const periodStats = ({ contracts, moneyContracts, expenses, period, withoutDownPayment }) => {
  let collected = 0, profit = 0;
  const paidBy = new Map();
  for (const s of moneyContracts) {
    for (const m of domain.moneyIn(s)) if (inDays(m.date, period)) profit += domain.moneyInProfit(s, m, false);
    for (const m of collectionPayments(s, withoutDownPayment)) {
      if (!inDays(m.actualDate || m.date, period)) continue;
      collected += m.amount;
      // Кто сколько внёс по графику (первый взнос — не про дисциплину)
      if (m.id !== `${s.id}_dp`) paidBy.set(s.customerId, (paidBy.get(s.customerId) || 0) + m.amount);
    }
  }
  const exp = expenses.filter(e => inDays(e.date, period));
  const purchases = exp.filter(e => String(e.id).startsWith('exp_sale_'));
  const other = exp.filter(e => !String(e.id).startsWith('exp_sale_'));
  const byCategory = new Map();
  for (const e of other) byCategory.set(e.category || 'Прочее', (byCategory.get(e.category || 'Прочее') || 0) + (Number(e.amount) || 0));
  const fresh = contracts.filter(s => inDays(s.startDate, period));
  return {
    from: period.from, to: period.to,
    collected: Math.round(collected), profit: Math.round(profit),
    expenses: Math.round(exp.reduce((n, e) => n + (Number(e.amount) || 0), 0)),
    purchases: Math.round(purchases.reduce((n, e) => n + (Number(e.amount) || 0), 0)),
    otherExpenses: Math.round(other.reduce((n, e) => n + (Number(e.amount) || 0), 0)),
    newContracts: { count: fresh.length, total: Math.round(fresh.reduce((n, s) => n + (Number(s.totalAmount) || 0), 0)),
      markup: Math.round(fresh.reduce((n, s) => n + (Number(s.totalAmount) || 0) - (Number(s.buyPrice) || 0), 0)) },
    overdueAtEnd: Math.round(moneyContracts.reduce((n, s) => n + overdueOn(s, period.to), 0)),
    _byCategory: byCategory, _paidBy: paidBy, _other: other,
  };
};

/** Сравнение периодов: цифры обоих, разница и что её объясняет */
const comparePeriods = ({ sales, expenses, customers = [], investors = [], withoutDownPayment = false, accountId = null, periods }) => {
  const investorIds = new Set(investors.map(i => i.id));
  const isContract = s => isCustomerSale(s, investorIds) && s.type === 'INSTALLMENT';
  const contracts = sales.filter(s => (!accountId || domain.saleTouchesAccount(s, accountId)) && isContract(s));
  const moneyContracts = domain.expandFundedSales(sales).filter(s => (!accountId || s.accountId === accountId) && isContract(s));
  const exp = expenses.filter(e => !accountId || e.accountId === accountId);
  const names = new Map(customers.map(c => [c.id, c.name || 'Клиент']));
  const cur = periodStats({ contracts, moneyContracts, expenses: exp, period: periods.current, withoutDownPayment });
  const prev = periodStats({ contracts, moneyContracts, expenses: exp, period: periods.previous, withoutDownPayment });

  const categories = [...new Set([...cur._byCategory.keys(), ...prev._byCategory.keys()])]
    .map(category => ({ category, current: Math.round(cur._byCategory.get(category) || 0), previous: Math.round(prev._byCategory.get(category) || 0) }))
    .map(x => ({ ...x, delta: x.current - x.previous }))
    .filter(x => x.delta).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5);
  // Платили в прошлом периоде и не платили в этом, хотя долг остался
  const owing = new Set(contracts.filter(s => s.status === 'ACTIVE' && Number(s.remainingAmount) >= 1).map(s => s.customerId));
  const stopped = [...prev._paidBy].filter(([id, n]) => n >= 1 && !(cur._paidBy.get(id) >= 1) && owing.has(id))
    .map(([id, n]) => ({ customer: names.get(id) || 'Клиент', previousPaid: Math.round(n) })).sort((a, b) => b.previousPaid - a.previousPaid);
  const shifts = [...new Set([...cur._paidBy.keys(), ...prev._paidBy.keys()])]
    .map(id => ({ customer: names.get(id) || 'Клиент', current: Math.round(cur._paidBy.get(id) || 0), previous: Math.round(prev._paidBy.get(id) || 0) }))
    .map(x => ({ ...x, delta: x.current - x.previous })).filter(x => x.delta);
  const strip = ({ _byCategory, _paidBy, _other, ...x }) => x;
  const keys = ['collected', 'profit', 'expenses', 'purchases', 'otherExpenses', 'overdueAtEnd'];
  return {
    current: strip(cur), previous: strip(prev),
    change: { ...Object.fromEntries(keys.map(k => [k, change(cur[k], prev[k])])), newContracts: change(cur.newContracts.count, prev.newContracts.count) },
    drivers: {
      expenseCategories: categories,
      biggestExpenses: cur._other.sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0)).slice(0, 3)
        .map(e => ({ title: e.title || e.category || 'Расход', category: e.category || 'Прочее', amount: Math.round(Number(e.amount) || 0), date: mskDay(e.date) })),
      stoppedPaying: { count: stopped.length, total: stopped.reduce((n, x) => n + x.previousPaid, 0), customers: stopped.slice(0, 5) },
      paidMore: shifts.filter(x => x.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3),
      paidLess: shifts.filter(x => x.delta < 0 && x.current > 0).sort((a, b) => a.delta - b.delta).slice(0, 3),
    },
    basis: 'Собрано, прибыль и расходы — как в сводке приложения. Закуп — расходы на товар по новым договорам. Просрочка на конец периода — по нынешнему графику платежей.',
  };
};

module.exports = { resolvePeriods, overdueOn, comparePeriods };
