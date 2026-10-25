// Деньги, которые должны прийти: прогноз поступлений, очередь взыскания,
// обещания клиентов, досрочное погашение и реструктуризация графика.
//
// Всё здесь — чистые расчёты над записями учёта (без базы и без модели): цифры
// агенту даёт сервер, модель их только пересказывает. Остаток и просрочка —
// теми же формулами, что экраны приложения (api/domain.js), опоздания — как
// «стоит ли давать» (discipline.js).

const domain = require('../api/domain');
const { customerDiscipline } = require('./discipline');

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
const mskDay = (d = new Date()) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 864e5);
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !isNaN(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;
// Строки графика хранятся полночью по Москве (так их пишет приложение)
const mskMidnight = (day) => new Date(`${day}T00:00:00+03:00`).toISOString();

/** День того же числа через k месяцев; 31-е в коротком месяце — последний день */
const addMonthsDay = (day, k, dom = Number(day.slice(8, 10))) => {
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7)) - 1 + k;
  const ty = y + Math.floor(m / 12), tm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(Math.min(dom, last)).padStart(2, '0')}`;
};

// Договор клиента в рассрочку: не «прочий приход» и не вложение инвестора
const isContract = (s, investorIds = new Set()) =>
  s && s.type === 'INSTALLMENT' && !String(s.customerId || '').startsWith('system_') && !investorIds.has(s.customerId);

/**
 * Строки графика с непогашенной частью. Полученные деньги (всё, что снято с
 * долга, вместе со скидками) закрывают строки по порядку дат — как в
 * приложении: строка частично оплачена, пока сумма не догнала её целиком.
 */
const openRows = (sale) => {
  const totalDue = Math.max(0, (Number(sale.totalAmount) || 0) - (Number(sale.downPayment) || 0));
  let cover = Math.max(0, totalDue - (Number(sale.remainingAmount) || 0));
  const rows = (sale.paymentPlan || []).filter(p => p.isRealPayment !== true && p.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const out = [];
  for (const p of rows) {
    const amount = Number(p.amount) || 0;
    const covered = Math.min(amount, cover);
    cover = round(cover - covered);
    const open = round(amount - covered);
    if (open >= 1) out.push({ id: p.id, day: mskDay(p.date), amount, open });
  }
  return out;
};

/** Доля платежей без опоздания — null, если истории мало (меньше трёх наступивших) */
const onTimeRate = (d) => (d.paymentsDue >= 3 ? 1 - d.paidLate / d.paymentsDue : null);

/**
 * Прогноз поступлений на days дней вперёд (с сегодняшнего): сколько должны
 * внести по графику и сколько, судя по истории оплат, внесут вовремя; по
 * неделям (первые 13) и по месяцам, с наценкой в этих деньгах (ожидаемая
 * прибыль — как отчёты прибыли: доля прибыли в каждом рубле договора).
 * untilEnd — до последнего платежа по всем договорам («распиши до конца»).
 */
const MAX_DAYS = 1100;
const forecast = ({ sales, customers = [], investors = [], today = mskDay(), days = 30, untilEnd = false, month = null }) => {
  const investorIds = new Set(investors.map(i => i.id));
  const contracts = sales.filter(s => isContract(s, investorIds));
  let n = Math.min(Math.max(Math.round(Number(days) || 30), 1), MAX_DAYS);
  // Названный месяц — целиком (текущий — с сегодня): «в ноябре» не должно быть «до 22 ноября»
  if (/^\d{4}-\d{2}$/.test(String(month || ''))) {
    const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
    if (last < today) return { error: 'Этот месяц уже прошёл — для прошедших месяцев monthly_report.' };
    const from = `${month}-01` > today ? `${month}-01` : today;
    const f = forecast({ sales, customers, investors, today, days: daysBetween(today, last) + 1 });
    const m = f.byMonth.find(x => x.month === month) || { month, count: 0, customers: 0, total: 0, realistic: 0, profit: 0, from, to: last, fullMonth: from === `${month}-01` };
    return { month, from, to: last, ...m, overdueNow: f.overdueNow, basis: f.basis };
  }
  if (untilEnd) {
    const last = contracts.filter(s => s.status === 'ACTIVE').flatMap(s => openRows(s).map(r => r.day)).filter(d => d >= today).sort().pop();
    n = last ? Math.min(daysBetween(today, last) + 1, MAX_DAYS) : 1;
  }
  const end = addDays(today, n - 1);
  const names = new Map(customers.map(c => [c.id, c.name || '']));
  const byCustomer = new Map();
  for (const s of contracts) {
    if (!byCustomer.has(s.customerId)) byCustomer.set(s.customerId, []);
    byCustomer.get(s.customerId).push(s);
  }
  const rate = new Map([...byCustomer].map(([id, list]) => {
    const d = customerDiscipline(list);
    return [id, { rate: onTimeRate(d), d }];
  }));
  // Без своей истории — средняя аккуратность по всем клиентам с историей
  const known = [...rate.values()].filter(x => x.rate != null);
  const avg = known.length ? known.reduce((n, x) => n + x.rate, 0) / known.length : 1;

  const weeks = [];
  for (let from = today; from <= end && weeks.length < 13; from = addDays(from, 7)) {
    const to = addDays(from, 6) < end ? addDays(from, 6) : end;
    weeks.push({ from, to, count: 0, total: 0 });
  }
  const months = new Map();
  let count = 0, total = 0, realistic = 0, profit = 0, overdueNow = 0, overdueContracts = 0;
  // count — платежей (строк графика); клиентов меньше: у одного бывает несколько договоров
  const payers = new Set();
  const risky = new Map();
  for (const s of contracts) {
    if (s.status !== 'ACTIVE') continue;
    const o = domain.overdueAmount(s);
    if (o > 0) { overdueNow += o; overdueContracts++; }
    const r = rate.get(s.customerId);
    const p = r.rate ?? avg;
    const margin = domain.profitMargin(s);
    for (const row of openRows(s)) {
      if (row.day < today || row.day > end) continue;
      count++; total += row.open; realistic += row.open * p; profit += row.open * margin; payers.add(s.customerId);
      const w = weeks.find(x => row.day >= x.from && row.day <= x.to);
      if (w) { w.count++; w.total += row.open; }
      const m = months.get(row.day.slice(0, 7)) || { month: row.day.slice(0, 7), count: 0, total: 0, realistic: 0, profit: 0, payers: new Set() };
      m.count++; m.total += row.open; m.realistic += row.open * p; m.profit += row.open * margin; m.payers.add(s.customerId);
      months.set(m.month, m);
      if (r.rate != null && r.rate < 0.6) {
        const k = risky.get(s.customerId) || { customer: names.get(s.customerId) || 'Клиент', amount: 0, onTimePercent: Math.round(r.rate * 100), maxDelayDays: r.d.maxDelayDays };
        k.amount += row.open;
        risky.set(s.customerId, k);
      }
    }
  }
  return {
    from: today, to: end, days: n,
    scheduled: { count, customers: payers.size, total: Math.round(total) },
    // Оценка: каждый платёж умножен на долю платежей, внесённых клиентом без опоздания
    realistic: Math.round(realistic),
    // Наценка в ожидаемых деньгах — прибыль, если всё заплатят по графику
    expectedProfit: Math.round(profit),
    basis: 'Ожидаемо — непогашенные строки графика за период. Реалистично — с учётом того, какую долю платежей каждый клиент вносил без опоздания (новые клиенты — по средней аккуратности). Ожидаемая прибыль — наценка в этих платежах. Месяцев за пределами периода здесь нет — их не называть.',
    byWeek: weeks.map(w => ({ ...w, total: Math.round(w.total) })),
    // Текущий месяц — с сегодняшнего дня
    // fullMonth: false — месяц обрезан началом (сегодня) или концом периода: не называть это «за месяц»
    byMonth: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map(m => {
      const first = `${m.month}-01`, last = new Date(Date.UTC(Number(m.month.slice(0, 4)), Number(m.month.slice(5, 7)), 0)).toISOString().slice(0, 10);
      const from = first < today ? today : first, to = last > end ? end : last;
      return { month: m.month, from, to, fullMonth: from === first && to === last, count: m.count, customers: m.payers.size, total: Math.round(m.total), realistic: Math.round(m.realistic), profit: Math.round(m.profit) };
    }),
    overdueNow: { contracts: overdueContracts, total: Math.round(overdueNow) },
    risky: [...risky.values()].map(x => ({ ...x, amount: Math.round(x.amount) })).sort((a, b) => b.amount - a.amount).slice(0, 5),
  };
};

/** Сколько клиент внёс по договору начиная с дня обещания (включительно) */
const paidSince = (sale, day) => (sale?.paymentPlan || [])
  .filter(p => p.isPaid && p.isRealPayment === true && mskDay(p.actualDate || p.date) >= day)
  .reduce((n, p) => n + (Number(p.amount) || 0) + (Number(p.discountAmount) || 0), 0);

/** Обещание клиента: kept — внёс, broken — срок прошёл, pending — ждём */
const promiseStatus = (promise, sale, today = mskDay()) => {
  const paid = round(paidSince(sale, mskDay(promise.created_at || promise.createdAt)));
  const amount = Number(promise.amount) || 0;
  const status = paid + 0.5 >= amount || (sale && !(Number(sale.remainingAmount) > 0)) ? 'kept'
    : promise.due_date < today || promise.dueDate < today ? 'broken' : 'pending';
  return { status, paid };
};

// Стадия взыскания по сроку: тон напоминания и порядок действий
const stageOf = (days) => (days <= 7 ? 'soft' : days <= 30 ? 'firm' : 'final');

/**
 * Очередь взыскания: кому звонить и писать в первую очередь. Сначала —
 * нарушившие обещание, потом без обещания, в конце — кто обещал и срок ещё не
 * прошёл. Внутри — по сумме просрочки с поправкой на её давность.
 */
const collectionQueue = ({ sales, customers = [], investors = [], promises = [], today = mskDay(), limit = 25 }) => {
  const investorIds = new Set(investors.map(i => i.id));
  const byId = new Map(customers.map(c => [c.id, c]));
  const contracts = sales.filter(s => isContract(s, investorIds));
  const items = [];
  for (const s of contracts) {
    if (s.status !== 'ACTIVE' && s.status !== 'DRAFT') continue;
    const overdue = domain.overdueAmount(s);
    if (overdue < 1) continue;
    const late = openRows(s).filter(r => r.day < today);
    const days = late.length ? daysBetween(late[0].day, today) : 0;
    const c = byId.get(s.customerId) || {};
    const d = customerDiscipline(contracts.filter(x => x.customerId === s.customerId));
    const last = promises.filter(p => p.sale_id === s.id && p.status !== 'cancelled')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    const ps = last ? promiseStatus(last, s, today) : null;
    const promise = last && ps.status !== 'kept'
      ? { amount: Math.round(Number(last.amount)), date: last.due_date, status: ps.status, paidSince: Math.round(ps.paid) } : null;
    const group = promise?.status === 'broken' ? 0 : promise?.status === 'pending' ? 2 : 1;
    items.push({
      contractId: s.id, customer: c.name || 'Клиент', phone: c.phone || null, product: s.productName || '',
      overdue: Math.round(overdue), daysOverdue: days, monthsOverdue: late.length, stage: stageOf(days),
      monthlyPayment: Math.round(Number((s.paymentPlan || []).find(p => p.isRealPayment !== true)?.amount) || 0),
      remaining: Math.round(Number(s.remainingAmount) || 0),
      history: { paymentsDue: d.paymentsDue, paidLate: d.paidLate, maxDelayDays: d.maxDelayDays },
      remindersMuted: c.allowWhatsappNotification === false || undefined,
      promise,
      score: group * -1e12 + overdue * (1 + days / 30),
    });
  }
  items.sort((a, b) => b.score - a.score);
  const total = items.reduce((n, x) => n + x.overdue, 0);
  return {
    today, count: items.length, totalOverdue: Math.round(total),
    stages: { soft: 'до 7 дней — мягкое напоминание', firm: '8–30 дней — настойчиво, просим назвать дату оплаты', final: 'больше 30 дней — официально, претензия' },
    items: items.slice(0, limit).map(({ score, ...x }) => x),
  };
};

/** Обещания на сегодня и сорванные вчера — для утренней сводки */
const promiseDigest = ({ promises, sales, customers = [], today = mskDay() }) => {
  const byId = new Map(sales.map(s => [s.id, s]));
  const names = new Map(customers.map(c => [c.id, c.name || 'Клиент']));
  const yesterday = addDays(today, -1);
  const dueToday = [], broken = [];
  for (const p of promises) {
    if (p.status === 'cancelled') continue;
    const sale = byId.get(p.sale_id);
    if (!sale) continue;
    const st = promiseStatus(p, sale, today);
    if (st.status === 'kept') continue;
    if (p.due_date === today) dueToday.push({ name: names.get(sale.customerId), amount: Number(p.amount) - st.paid });
    if (p.due_date === yesterday) broken.push(names.get(sale.customerId));
  }
  return { dueToday, broken: [...new Set(broken)] };
};

/**
 * Досрочное погашение: остаток долга и скидка. Скидку считаем от остатка, как
 * окно «Принять платёж»; наценка в остатке — сколько можно уступить, не уходя
 * ниже закупа (доля прибыли в каждом рубле — как в отчётах прибыли).
 */
const payoffQuote = (sale, { discountPercent, discountAmount } = {}) => {
  const remaining = round(sale.remainingAmount);
  const margin = Math.max(0, domain.profitMargin(sale));
  const markupInRemaining = Math.floor(remaining * margin);
  let discount = 0;
  if (Number(discountAmount) > 0) discount = Math.min(remaining, Number(discountAmount));
  else if (Number(discountPercent) > 0) discount = Math.min(remaining, remaining * Number(discountPercent) / 100);
  discount = Math.round(discount);
  return {
    remaining, markupInRemaining,
    discount, discountPercent: remaining > 0 ? round(discount / remaining * 100) : 0,
    toPay: round(remaining - discount),
    belowPurchase: discount > markupInRemaining,
  };
};

/**
 * Реструктуризация: остаток долга заново на months месяцев от firstDay.
 * Уже закрытые строки графика и все полученные деньги остаются как есть;
 * частично оплаченная строка растворяется в новом графике — её оплаченная
 * часть ложится на первую новую строку, и та показывает «частично».
 * Возвращает новый договор или { error }.
 */
const restructurePlan = (sale, months, firstDay, today = mskDay(), now = Date.now()) => {
  const n = Number(months);
  if (!Number.isInteger(n) || n < 1 || n > 60) return { error: 'Срок — целое число месяцев от 1 до 60.' };
  if (!isDay(firstDay)) return { error: 'Нужна дата первого платежа в виде ГГГГ-ММ-ДД.' };
  if (firstDay < today) return { error: 'Дата первого платежа уже прошла — нужна сегодняшняя или будущая.' };
  if (firstDay > addDays(today, 366)) return { error: 'Первый платёж больше чем через год — уточните дату.' };
  const remaining = round(sale.remainingAmount);
  if (!(remaining >= 1)) return { error: 'Договор уже полностью оплачен — перестраивать нечего.' };
  const plan = sale.paymentPlan || [];
  const real = plan.filter(p => p.isRealPayment === true);
  const scheduled = plan.filter(p => p.isRealPayment !== true && p.date).sort((a, b) => new Date(a.date) - new Date(b.date));
  const totalDue = Math.max(0, (Number(sale.totalAmount) || 0) - (Number(sale.downPayment) || 0));
  let cover = Math.max(0, round(totalDue - remaining));
  const kept = [];
  for (const p of scheduled) {
    const amount = Number(p.amount) || 0;
    if (amount > cover + 0.01) break;
    kept.push({ ...p, isPaid: true });
    cover = round(cover - amount);
  }
  // Оплаченные строки старого формата сами несут деньги — их нельзя выбросить
  const legacyLost = scheduled.some(p => p.isPaid && p.isRealPayment == null && !kept.some(k => k.id === p.id));
  if (legacyLost) return { error: 'График договора в старом формате — перестройте его в приложении (правка договора).' };
  const lastKept = kept.length ? mskDay(kept[kept.length - 1].date) : null;
  if (lastKept && firstDay <= lastKept) return { error: `Первый новый платёж должен быть позже последнего закрытого (${lastKept.split('-').reverse().join('.')}).` };
  const base = Math.floor(remaining / n);
  const last = round(remaining - base * (n - 1));
  const dom = Number(firstDay.slice(8, 10));
  const fresh = Array.from({ length: n }, (_, i) => ({
    id: `pay_${now}_${i}_${Math.random().toString(36).slice(2, 8)}`,
    saleId: sale.id,
    amount: round((i === n - 1 ? last : base) + (i === 0 ? cover : 0)),
    date: mskMidnight(addMonthsDay(firstDay, i, dom)),
    isPaid: false, isRealPayment: false,
  }));
  return {
    sale: {
      ...sale,
      paymentPlan: [...kept, ...fresh, ...real].sort((a, b) => new Date(a.date) - new Date(b.date)),
      installments: kept.length + n,
      paymentDay: dom,
      remainingAmount: remaining,
    },
    monthly: base, last, partialCarried: cover, keptRows: kept.length,
  };
};

module.exports = {
  mskDay, addDays, daysBetween, isDay, addMonthsDay, openRows, forecast,
  promiseStatus, stageOf, collectionQueue, promiseDigest, payoffQuote, restructurePlan,
};
