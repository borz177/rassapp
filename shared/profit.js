/**
 * Доли прибыли: личный счёт инвестора и общая касса (пул), премия сотрудника.
 *
 * Модуль общий для браузера и сервера — как shared/excelReport.js. Приложение
 * берёт эти функции через src/utils.ts (там к ним добавлены типы), сервер — через
 * getProfitModule в server/index.js (премия сотрудника считается по полным данным
 * менеджера: у самого сотрудника они урезаны по доступным счетам).
 *
 * Раньше здесь была отдельная, упрощённая копия расчёта — и она отстала: доли на
 * дату договора вместо периода платежа, без довложений и выводов. Менеджер и
 * сотрудник видели разную премию. Теперь расчёт один.
 *
 * Только чистая арифметика, без зависимостей: файл одинаково работает и в сборке
 * Vite, и в Node.
 */

/**
 * Момент времени в миллисекундах.
 *
 * Участие в общей кассе считается по ТОЧНОМУ времени, а не по дню: инвестор,
 * вошедший 18.09 в 14:00, не участвует в платеже, пришедшем 18.09 в 9:00, — эти
 * деньги заработаны до его входа. Даты «задним числом» из формы приходят полуночью,
 * поэтому вход и платёж одного прошедшего дня по-прежнему совпадают.
 */
export const at = (d) => new Date(d).getTime();

/**
 * Момент операции — договора, платежа, расхода. Дата без времени («2026-08-19»,
 * так хранится дата договора) означает весь день, а не полночь: вход инвестора
 * 19.08 в 21:07 и договор от 19.08 — один день, и договор считается оформленным
 * при нём, как было всегда. Иначе все договоры дня входа доставались бы
 * менеджеру. День — местный, как его видит пользователь.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
export const txAt = (d) => {
  if (typeof d === 'string' && DATE_ONLY.test(d)) {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day, 23, 59, 59, 999).getTime();
  }
  return new Date(d).getTime();
};

// Период участия действует в момент t: вошёл не позже t и ещё не вышел
export const periodActiveAt = (p, t) =>
  at(p.joinedDate) <= t && (!p.leftPoolDate || t < at(p.leftPoolDate));

// Участвовал ли инвестор в пуле на момент cutoff.
// Если задан investmentPeriods — проверяем по списку периодов (поддержка повторного входа).
// Иначе — legacy-поведение: один joinedDate / leftPoolDate.
export const isPoolMemberActiveAt = (investor, cutoff) => {
  if (investor.investmentPeriods && investor.investmentPeriods.length > 0) {
    return investor.investmentPeriods.some(p => periodActiveAt(p, cutoff));
  }
  return periodActiveAt({ joinedDate: investor.joinedDate, leftPoolDate: investor.leftPoolDate }, cutoff);
};

/**
 * Сколько было вложено в периоде на дату cutoff.
 *
 * initialAmount периода — сумма сейчас, после всех пополнений, возвратов и
 * убытков. Изменения, случившиеся ПОЗЖЕ cutoff, из неё вычитаются: пополнение
 * 18 сентября не должно задним числом менять долю в договоре, оформленном в
 * феврале, — иначе у остальных участников кассы пересчиталась бы прибыль по
 * давно закрытым сделкам. Изменение, сделанное раньше момента платежа, в нём
 * уже учтено; сделанное позже — нет.
 */
const periodAmountAt = (period, cutoff) => {
  const later = (period.capitalChanges || [])
    .filter(c => at(c.date) > cutoff)
    .reduce((sum, c) => sum + (Number(c.delta) || 0), 0);
  return Math.max(0, (Number(period.initialAmount) || 0) - later);
};

// Сумма вложения инвестора на момент cutoff — из активного периода.
// Нужна при поддержке нескольких периодов (разные суммы в разные периоды).
export const getInvestorAmountAt = (investor, cutoff) => {
  if (investor.investmentPeriods && investor.investmentPeriods.length > 0) {
    const active = investor.investmentPeriods.find(p => periodActiveAt(p, cutoff));
    return active ? periodAmountAt(active, cutoff) : 0;
  }
  return Number(investor.initialAmount) || 0;
};

// Участники пула на момент cutoff и их общий капитал
const poolMembersAt = (account, investors, cutoff) => {
  const members = (account.poolMemberIds || [])
    .map(id => investors.find(i => i.id === id))
    .filter(i => !!i && isPoolMemberActiveAt(i, cutoff));
  const totalCapital = members.reduce((sum, inv) => sum + getInvestorAmountAt(inv, cutoff), 0);
  return { members, totalCapital };
};

/**
 * Процент инвестора — не больше 100. Форма больше не даёт ввести 110%, но такие
 * записи уже есть: 110% отдавали инвестору больше прибыли, чем заработала его
 * часть, — разница уходила из чужих денег.
 */
const clampPercent = (p) => Math.min(100, Math.max(0, Number(p) || 0));

// 🔒 Единая точка расчёта долей прибыли по счёту.
// Обычный счёт инвестора (ownerId) — доля равна его фиксированному profitPercentage.
// Общий пул (type === 'POOL') — двухэтапно: (1) прибыль сначала делится между
// участниками ПРОПОРЦИОНАЛЬНО ИХ КАПИТАЛУ, (2) к этой капитал-части применяется ЕГО
// СОБСТВЕННЫЙ процент (Investor.profitPercentage). Итоговая доля инвестора от общей
// прибыли = (его_капитал / общий_капитал) × его_процент.
//
// Остаток до 100% — доля за управление. По умолчанию она менеджера. Если в пуле
// задано managerShareSplit — её получают указанные участники (те, кто ведёт дело:
// «мы даём новичку 80%, а 20% с его денег — нам за работу»), а менеджеру остаётся
// то, что не распределено. Участник, которого в этот момент нет в пуле, своей части
// не получает — она остаётся менеджеру.
//
// asOfDate — на какой момент считать состав и суммы пула. Участники, вошедшие позже
// asOfDate, в расчёт не попадают вовсе (их ещё не было в пуле на тот момент).
// Для прибыли по платежу клиента см. paymentProfitShares ниже; для расхода из
// прибыли и убытка — дата операции.
export const getAccountShares = (account, investors, asOfDate) => {
  if (!account) return [];
  if (account.type === 'POOL') {
    const cutoff = asOfDate ? txAt(asOfDate) : Date.now();
    const terms = poolTermsAt(account, cutoff);
    if (terms) { investors = investors.map(i => terms.members?.[i.id] ? { ...i, profitPercentage: terms.members[i.id].rate } : i); account = { ...account, managerShareSplit: terms.managerShareSplit || [] }; }
    const { members, totalCapital } = poolMembersAt(account, investors, cutoff);
    let shares;
    if (totalCapital <= 0 && isMonthlyPool(account)) {
      shares=members.map(investor=>({investor,percentage:0}));
    } else if (totalCapital <= 0) {
      // Суммы не заданы — используем profitPercentage как фиксированный процент напрямую.
      // Вместе больше 100% прибыли отдать нельзя: 60% + 60% делят её пропорционально.
      const totalPercent = members.reduce((sum, inv) => sum + clampPercent(inv.profitPercentage), 0);
      const scale = totalPercent > 100 ? 100 / totalPercent : 1;
      shares = members.map(investor => ({ investor, percentage: clampPercent(investor.profitPercentage) * scale }));
    } else {
      shares = members.map(investor => ({
        investor,
        percentage: getInvestorAmountAt(investor, cutoff) / totalCapital * clampPercent(investor.profitPercentage),
      }));
    }

    // Доля за управление — участникам, ведущим дело
    const split = (account.managerShareSplit || []).filter(s => Number(s.percent) > 0);
    if (split.length > 0) {
      const rest = Math.max(0, 100 - shares.reduce((sum, s) => sum + s.percentage, 0));
      const splitTotal = split.reduce((sum, s) => sum + Number(s.percent), 0);
      const scale = splitTotal > 100 ? 100 / splitTotal : 1;
      for (const s of split) {
        const row = shares.find(x => x.investor.id === s.investorId);
        if (row) row.percentage += rest * Number(s.percent) * scale / 100;
      }
    }
    return shares;
  }
  if (account.ownerId) {
    const investor = investors.find(i => i.id === account.ownerId);
    return investor ? [{ investor, percentage: clampPercent(investor.profitPercentage) }] : [];
  }
  return [];
};

// Остаток % после долей всех инвесторов счёта (на дату asOfDate) — достаётся менеджеру.
export const getManagerSharePercent = (account, investors, asOfDate) => {
  const totalInvestorShare = getAccountShares(account, investors, asOfDate).reduce((sum, m) => sum + m.percentage, 0);
  return Math.max(0, 100 - totalInvestorShare);
};

// Доля КАПИТАЛА конкретного инвестора в счёте (0..1), без учёта его процента прибыли.
export const getInvestorCapitalShare = (account, investorId, investors, asOfDate) => {
  if (!account) return 0;
  if (account.type === 'POOL') {
    const cutoff = asOfDate ? txAt(asOfDate) : Date.now();
    const { members, totalCapital } = poolMembersAt(account, investors, cutoff);
    if (totalCapital <= 0) return 0;
    const investor = members.find(i => i.id === investorId);
    return investor ? getInvestorAmountAt(investor, cutoff) / totalCapital : 0;
  }
  return account.ownerId === investorId ? 1 : 0;
};

// Доли капитала участников (в процентах) — для распределения убытка
export const getCapitalShares = (account, investors, asOfDate) => {
  if (!account || account.type !== 'POOL') {
    if (account?.ownerId) {
      const inv = investors.find(i => i.id === account.ownerId);
      return inv ? [{ investor: inv, percentage: 100 }] : [];
    }
    return [];
  }
  const cutoff = asOfDate ? txAt(asOfDate) : Date.now();
  const { members, totalCapital } = poolMembersAt(account, investors, cutoff);
  if (totalCapital <= 0) return [];
  return members.map(investor => ({
    investor,
    percentage: getInvestorAmountAt(investor, cutoff) / totalCapital * 100,
  }));
};

/**
 * 📅 Доли прибыли общей кассы (POOL) — единое правило для всех экранов: касса,
 * карточка и кабинет инвестора, отчёты, прибыль менеджера, премия сотрудников.
 *
 * Касса — мушарака/мудараба: прибыль принадлежит тем, чей капитал её заработал,
 * и ровно за то время, пока он работал. Поэтому:
 *   • Прибыль каждой строки графика зарабатывается за её период — от предыдущей
 *     строки (у первой — от оформления договора) до её даты. Прибыль первого
 *     взноса — в момент оформления.
 *   • Внутри периода прибыль делится по «капитал × время»: на каждом отрезке между
 *     событиями кассы (вход, выход, довложение, вывод, убыток) — по составу и
 *     капиталу на этом отрезке.
 *   • Отсюда: вошедший 18.09 не получает прибыль, заработанную до 18.09, даже если
 *     клиент заплатил позже (просрочка). И участвует во всей прибыли, заработанной
 *     после входа, — по новым договорам и по старым, наравне со всеми.
 *   • Делится только реально полученная прибыль. Нет оплаты — нет прибыли.
 *   • Досрочная оплата: часть периода, которая ещё не наступила, делится по
 *     составу на момент оплаты — будущий состав неизвестен.
 *   • Платёж закрывает строки графика по очереди — так же, как в
 *     reconcileSalePaymentPlan / expectedPaymentsInPeriod. Сверх графика — в
 *     момент платежа.
 *
 * Договор, оформленный, когда в кассе не было ни одного инвестора, куплен на
 * деньги менеджера — вся его прибыль менеджера.
 *
 * Личный счёт инвестора — фиксированный процент, время на него не влияет.
 */
const earningCache = new WeakMap();

// За какие периоды заработана прибыль каждого полученного платежа (paid) и
// ещё не полученного остатка (open). Считается один раз на объект договора.
const monthlyEarningCache = new WeakMap();
const saleEarningWindows = (sale, dateAt = txAt) => {
  const monthly = dateAt === poolTime;
  const cache = monthly ? monthlyEarningCache : earningCache;
  const hit = cache.get(sale);
  if (hit) return hit;

  const plan = sale.paymentPlan || [];
  const start = dateAt(sale.startDate);
  const due = plan
    .filter(p => p.isRealPayment !== true)
    .map(p => ({ due: dateAt(p.date), left: Number(p.amount) || 0 }))
    .filter(s => s.left > 0 && !Number.isNaN(s.due))
    .sort((a, b) => a.due - b.due);
  const slots = due.map((s, i) => {
    const prev = i === 0 ? start : due[i - 1].due;
    const from = Number.isNaN(prev) ? s.due : Math.min(prev, s.due);
    const plannedMonth = monthly ? poolMonth(s.due) : undefined;
    return { from, to: s.due, left: s.left, plannedMonth };
  });

  const paid = new Map();
  const payments = plan
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.isPaid && p.isRealPayment !== false)
    .sort((a, b) => dateAt(a.p.date) - dateAt(b.p.date) || a.i - b.i);
  let k = 0;
  for (const { p } of payments) {
    let money = (Number(p.amount) || 0) + (Number(p.discountAmount) || 0);
    const windows = [];
    while (money > 0.005 && k < slots.length) {
      const slot = slots[k];
      const take = Math.min(slot.left, money);
      windows.push({ from: slot.from, to: slot.to, weight: take, plannedMonth: slot.plannedMonth });
      slot.left -= take;
      money -= take;
      // Копеечный допуск — как в expectedPaymentsInPeriod
      if (slot.left <= 0.01) k++;
    }
    if (money > 0.005) { const t = dateAt(p.date); windows.push({ from: t, to: t, weight: money }); }
    paid.set(p.id, windows);
  }
  const open = slots.slice(k)
    .filter(s => s.left > 0.01)
    .map(s => ({ from: s.from, to: s.to, weight: s.left, plannedMonth: s.plannedMonth }));

  const result = { paid, open };
  cache.set(sale, result);
  return result;
};

// Моменты событий участников кассы — границы отрезков с неизменными долями
const eventCache = new WeakMap();
const poolEventTimes = (account, investors) => {
  const members = (account.poolMemberIds || []).join(',');
  const byAccount = eventCache.get(investors) || new Map();
  const hit = byAccount.get(account.id);
  if (hit && hit.members === members) return hit.times;
  const times = new Set();
  const add = (d) => { if (d) { const t = at(d); if (!Number.isNaN(t)) times.add(t); } };
  for (const id of account.poolMemberIds || []) {
    const inv = investors.find(i => i.id === id);
    if (!inv) continue;
    add(inv.joinedDate);
    add(inv.leftPoolDate);
    for (const p of inv.investmentPeriods || []) {
      add(p.joinedDate);
      add(p.leftPoolDate);
      (p.capitalChanges || []).forEach(c => add(c.date));
    }
  }
  const sorted = [...times].sort((a, b) => a - b);
  byAccount.set(account.id, { members, times: sorted });
  eventCache.set(investors, byAccount);
  return sorted;
};

// Доли, усреднённые по «капитал × время» внутри периодов заработка. Часть периода
// позже момента now (ещё не наступила) — по составу на now.
const sharesOverWindows = (account, investors, windows, now, sharesAt = getAccountShares) => {
  const sums = new Map();
  let total = 0;
  const add = (time, weight) => {
    if (!(weight > 0)) return;
    total += weight;
    for (const { investor, percentage } of sharesAt(account, investors, time)) {
      const e = sums.get(investor.id) || { investor, sum: 0 };
      e.sum += percentage * weight;
      sums.set(investor.id, e);
    }
  };

  const capitalEvents = poolEventTimes(account, investors);
  const events = account.poolAccounting
    ? [...new Set([...capitalEvents, ...(account.poolAccounting.terms || []).map(term => poolTime(term.date))])].sort((a, b) => a - b)
    : capitalEvents;
  for (const { from, to, weight } of windows) {
    const length = to - from;
    if (!(length > 0) || from >= now) { add(Math.min(to, now), weight); continue; }
    const end = Math.min(to, now);
    const cuts = [from, ...events.filter(t => t > from && t < end), end];
    for (let i = 0; i < cuts.length - 1; i++) add(cuts[i], weight * (cuts[i + 1] - cuts[i]) / length);
    if (to > end) add(now, weight * (to - end) / length);
  }

  if (total <= 0) return sharesAt(account, investors, now);
  return [...sums.values()].map(e => ({ investor: e.investor, percentage: e.sum / total }));
};

// Договор оформлен, когда в кассе не было ни одного инвестора, — он менеджера
const isManagerContract = (account, investors, sale) =>
  getAccountShares(account, investors, sale.startDate).length === 0;

const sharesToManager = (shares) =>
  Math.max(0, 100 - shares.reduce((sum, s) => sum + s.percentage, 0));

// Реальная оплата закрывает строки графика последовательно. Если графика
// нет или оплата превысила его, оставшаяся часть относится к дате поступления.
const monthlyPaymentWindows = (sale, payment) =>
  (payment.id && saleEarningWindows(sale, poolTime).paid.get(payment.id)) || [];

const monthlyProfitWindows = (account, windows, date) => {
  if (poolProfitBasis(account, date) === 'SCHEDULE_PERIOD') return windows;
  // Взнос относится к своему месяцу, даже если предыдущая дата графика была в другом.
  return windows.map(w => w.plannedMonth ? { ...w, from: Math.max(w.from, poolMonthStart(w.plannedMonth)) } : w);
};

const monthlyPaymentShares = (account, investors, sale, payment, sharesAt = getAccountShares) => {
  const time = poolTime(payment.date);
  const windows = monthlyProfitWindows(account, monthlyPaymentWindows(sale, payment), time);
  return windows.length ? sharesOverWindows(account, investors, windows, time, sharesAt) : sharesAt(account, investors, time);
};

/** Доли инвесторов в прибыли полученного платежа (первый взнос или оплата по договору). */
export const paymentProfitShares = (account, investors, sale, payment) => {
  const t = txAt(payment.date);
  if (!account || account.type !== 'POOL' || !sale) return getAccountShares(account, investors, t);
  if (monthlyPoolApplies(account, payment.date)) {
    if ((account.poolAccounting.excludedSaleIds || []).includes(sale.id)) return [];
    return monthlyPaymentShares(account, investors, sale, payment);
  }
  if (isManagerContract(account, investors, sale)) return [];
  if (!payment.id) return getAccountShares(account, investors, t);
  const windows = saleEarningWindows(sale).paid.get(payment.id);
  return windows ? sharesOverWindows(account, investors, windows, t) : getAccountShares(account, investors, t);
};

/** Доля менеджера в прибыли полученного платежа — остаток после долей инвесторов. */
export const paymentManagerPercent = (account, investors, sale, payment) =>
  sharesToManager(paymentProfitShares(account, investors, sale, payment));

/**
 * Доли ОЖИДАЕМОЙ прибыли — с остатка долга по договору. Просроченные строки
 * графика уже заработаны — по составу за их период; будущие — прогноз по
 * текущему составу (кто будет в кассе потом, заранее неизвестно).
 */
export const expectedProfitShares = (account, investors, sale) => {
  const now = Date.now();
  if (!account || account.type !== 'POOL' || !sale) return getAccountShares(account, investors, now);
  if (monthlyPoolApplies(account, now)) return (account.poolAccounting.excludedSaleIds || []).includes(sale.id)
    ? [] : sharesOverWindows(account, investors, monthlyProfitWindows(account, saleEarningWindows(sale, poolTime).open, now), now);
  if (isManagerContract(account, investors, sale)) return [];
  return sharesOverWindows(account, investors, saleEarningWindows(sale).open, now);
};

/** Доля менеджера в ожидаемой прибыли с остатка долга. */
export const expectedManagerPercent = (account, investors, sale) =>
  sharesToManager(expectedProfitShares(account, investors, sale));

// Аналитический источник управленческой доли: чей капитал её заработал.
// Дополнительная доля за управление у получателя не меняет источник капитала.
// Выплаты себе не имеют такой привязки и через этот разрез не распределяются.
export const managerOriginSharesAt = (account, investors, date = Date.now()) => {
  if (!account) return [];
  if (account.type !== 'POOL') {
    const investor = investors.find(i => i.id === account.ownerId);
    return investor ? [{ investor, percentage: getManagerSharePercent(account, investors, date) }] : [];
  }
  const capital = getCapitalShares(account, investors, date);
  if (!capital.length) return [];
  const terms = poolTermsAt(account, date);
  const withoutSplit = { ...account, managerShareSplit: [], ...(terms ? { poolAccounting: {
    ...account.poolAccounting, openingTerms: { ...terms, managerShareSplit: [] }, terms: [],
  } } : {}) };
  const base = getAccountShares(withoutSplit, investors, date);
  const origins = capital.map(row => ({ investor: row.investor,
    percentage: Math.max(0, row.percentage - (base.find(s => s.investor.id === row.investor.id)?.percentage || 0)) }));
  const total = origins.reduce((n, row) => n + row.percentage, 0);
  const retained = getManagerSharePercent(account, investors, date);
  return origins.map(row => ({ ...row, percentage: total > 0 ? row.percentage / total * retained : 0 }));
};
export const paymentManagerOriginShares = (account, investors, sale, payment) => {
  if (!account || account.type !== 'POOL' || !sale) return managerOriginSharesAt(account, investors, payment.date);
  if (monthlyPoolApplies(account, payment.date)) return (account.poolAccounting.excludedSaleIds || []).includes(sale.id)
    ? [] : monthlyPaymentShares(account, investors, sale, payment, managerOriginSharesAt);
  if (isManagerContract(account, investors, sale)) return [];
  const windows = payment.id && saleEarningWindows(sale).paid.get(payment.id), time = txAt(payment.date);
  return windows ? sharesOverWindows(account, investors, windows, time, managerOriginSharesAt) : managerOriginSharesAt(account, investors, time);
};
export const expectedManagerOriginShares = (account, investors, sale) => {
  const now = Date.now();
  if (!account || account.type !== 'POOL' || !sale) return managerOriginSharesAt(account, investors, now);
  if (monthlyPoolApplies(account, now)) return (account.poolAccounting.excludedSaleIds || []).includes(sale.id)
    ? [] : sharesOverWindows(account, investors, monthlyProfitWindows(account, saleEarningWindows(sale, poolTime).open, now), now, managerOriginSharesAt);
  if (isManagerContract(account, investors, sale)) return [];
  return sharesOverWindows(account, investors, saleEarningWindows(sale).open, now, managerOriginSharesAt);
};

/**
 * Доля прибыли в каждом рубле, полученном по договору.
 *
 * По умолчанию прибыль «размазана» по всей сумме договора: первый взнос
 * приносит её так же, как платежи. С настройкой «прибыль только с платежей»
 * первый взнос прибыли не несёт: его считают возвратом закупа, а вся наценка
 * распределяется по платежам графика.
 */
export const saleProfitMargin = (sale, paymentsOnly = false) => {
  const total = Number(sale.totalAmount) || 0;
  const profit = total - (Number(sale.buyPrice) || 0);
  if (profit === 0) return 0;
  // Убыточный договор даёт отрицательную наценку — так честнее: каждый полученный
  // рубль уводит прибыль в минус. Экраны, которые убыток не показывают, отсеивают
  // его сами проверкой margin <= 0.
  const base = paymentsOnly ? total - (Number(sale.downPayment) || 0) : total;
  return base > 0 ? profit / base : 0;
};

/** Первый взнос договора — у него особый порядковый номер поступления. */
export const isDownPaymentOf = (sale, moneyId) => !!moneyId && moneyId === `${sale.id}_dp`;

/**
 * Скидка поступления, которая идёт из прибыли. Только у платежей с пометкой
 * discountFromProfit (ставится при записи с 28.10.2026): решение владельца — прежние
 * скидки считаются как раньше, чтобы не сдвинуть уже начисленное и выплаченное.
 */
export const profitDiscount = (money) =>
  money && money.discountFromProfit ? Math.max(0, Number(money.discountAmount) || 0) : 0;

/**
 * Прибыль одного поступления: платежа или первого взноса.
 *
 * Скидка из прибыли (profitDiscount): уступку клиенту оплачивает прибыль, а не
 * вложенное — платёж со скидкой приносит (сумма + скидка) × наценку − скидку, и её
 * делят инвесторы и менеджер по своим процентам, как саму прибыль. Раньше прибыль
 * уменьшалась только на скидку × наценку, остальное молча ложилось на капитал (касса
 * недосчитывалась вложенного). Ниже нуля по договору прибыль не уходит: скидка сверх
 * всей наценки (договор ниже закупа) уменьшает вложенное, как и раньше. Договор в
 * убыток (наценка ≤ 0) считается по-старому.
 */
export const moneyInProfit = (sale, money, paymentsOnly = false) => {
  if (paymentsOnly && isDownPaymentOf(sale, money.id)) return 0;
  const margin = saleProfitMargin(sale, paymentsOnly);
  const base = (Number(money.amount) || 0) * margin;
  const discount = profitDiscount(money);
  if (!discount || margin <= 0) return base;
  const withDiscount = base + discount * margin - discount;
  // Прибыль остальных поступлений договора — нижняя граница этого
  const others = (paymentsOnly ? 0 : Number(sale.downPayment) || 0) + (sale.paymentPlan || [])
    .filter(p => p.isPaid && p.isRealPayment !== false && p.id !== money.id)
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  return Math.max(withDiscount, -others * margin);
};

/**
 * Начисления прибыли инвестору: каждое поступление по договорам его счёта
 * (первый взнос и оплаты) × его доля в прибыли этого поступления. Этим
 * считают экран инвестора и FinUchetGPT — две копии разошлись бы.
 * sales — уже разложенные по совместному финансированию (expandFundedSales).
 */
export const investorProfitAccruals = (account, investors, sales, investorId, paymentsOnly = false, expenses = [], asOf = Date.now()) => {
  if (!account) return [];
  if(isMonthlyPool(account)) paymentsOnly=account.poolAccounting.profitFromPaymentsOnly??paymentsOnly;
  /** @type {any[]} */
  const out = [];
  sales.filter(s => s.accountId === account.id && s.buyPrice > 0).forEach(sale => {
    if (sale.totalAmount <= 0 || sale.totalAmount - sale.buyPrice <= 0) return;
    const money = [
      { date: sale.startDate, amount: sale.downPayment, id: `${sale.id}_dp`, isRealPayment: true },
      ...(sale.paymentPlan || []).filter(p => p.isPaid && p.isRealPayment !== false),
    ];
    money.forEach(p => {
      if (isMonthlyPool(account) && poolTime(p.date) > asOf) return;
      if (monthlyPoolApplies(account, p.date)) return;
      if (!(p.amount > 0)) return;
      const share = paymentProfitShares(account, investors, sale, p).find(m => m.investor.id === investorId);
      const percent = share ? share.percentage : 0;
      if (percent <= 0) return;
      const amount = moneyInProfit(sale, p, paymentsOnly) * percent / 100;
      // С настройкой «только с платежей» первый взнос прибыли не приносит — без строки «+0 ₽»
      if (amount <= 0) return;
      out.push({ id: p.id, date: p.date, amount, sale, paymentAmount: p.amount, isDownPayment: isDownPaymentOf(sale, p.id) });
    });
  });
  if (isMonthlyPool(account)) for (const report of poolMonthlyReports(account, investors, sales, expenses, asOf, paymentsOnly)) {
    const amount = report.allocations.find(r => r.id === investorId)?.amount || 0;
    if (amount) out.push({ id: `pool_month_${account.id}_${report.month}`, date: report.date, amount,
      sale: { id: `pool_month_${report.month}`, productName: `Прибыль за ${report.month}`, customerId: '', accountId: account.id },
      paymentAmount: report.gross, isDownPayment: false, poolMonth: report.month, preliminary: report.status !== 'CLOSED' });
  }
  return out;
};

/**
 * Начисленная сотруднику премия за период.
 * profitBase: CONTRACTS — договоры, которые он оформил; PAYMENTS — платежи,
 * которые он принял; ALL — всё. profitSource: MANAGER — из доли менеджера,
 * SHARED — из всей прибыли (расход общего дела).
 */
export const getEmployeeProfitAccrued = (employee, sales, accounts, investors, range, profitFromPaymentsOnly = false) => {
  const percent = Number(employee.profitPercentage) || 0;
  if (percent <= 0) return 0;
  const base = employee.profitBase || 'CONTRACTS';

  // Премия считается только с даты её установки: платежи, поступившие раньше,
  // сотруднику не полагаются — иначе при включении процента ему разом начислялась бы
  // премия за всю прошлую историю.
  const sinceTs = employee.profitSince ? new Date(employee.profitSince).setHours(0, 0, 0, 0) : -Infinity;
  const from = Math.max(range?.start ? new Date(range.start).getTime() : -Infinity, sinceTs);
  const to = range?.end ? new Date(range.end).setHours(23, 59, 59, 999) : Infinity;
  const investorIds = new Set(investors.map(i => i.id));

  let accrued = 0;
  for (const sale of sales) {
    if (String(sale.customerId || '').startsWith('system_')) continue;
    if (investorIds.has(sale.customerId)) continue;
    if (!sale.buyPrice || sale.buyPrice <= 0 || sale.totalAmount <= sale.buyPrice) continue;
    if (base === 'CONTRACTS' && sale.createdByUserId !== employee.id) continue;

    const account = accounts.find(a => a.id === sale.accountId);

    const payments = [
      { date: sale.startDate, amount: sale.downPayment || 0, id: `${sale.id}_dp`, recordedByUserId: sale.createdByUserId },
      ...(sale.paymentPlan || []).filter(p => p.isPaid && p.isRealPayment !== false),
    ];

    for (const p of payments) {
      if (!p.amount || p.amount <= 0) continue;
      const t = new Date(p.date).getTime();
      if (t < from || t > to) continue;
      if (base === 'PAYMENTS' && p.recordedByUserId !== employee.id) continue;

      const profitFromPayment = moneyInProfit(sale, p, profitFromPaymentsOnly);
      // По умолчанию премия берётся из доли МЕНЕДЖЕРА — на момент этого платежа.
      // Вариант SHARED — расход общего дела: считается от всей прибыли до распределения.
      const bonusBase = employee.profitSource === 'SHARED'
        ? profitFromPayment
        : profitFromPayment * paymentManagerPercent(account, investors, sale, p) / 100;
      accrued += bonusBase * percent / 100;
    }
  }
  return accrued;
};

/** Сколько сотруднику уже выплачено расходами категории «Зарплата». */
export const getEmployeeSalaryPaid = (employeeId, expenses, range) => {
  const from = range?.start ? new Date(range.start).getTime() : -Infinity;
  const to = range?.end ? new Date(range.end).setHours(23, 59, 59, 999) : Infinity;
  return expenses
    .filter(e => e.category === 'Salary' && e.employeeId === employeeId)
    .filter(e => { const t = new Date(e.date).getTime(); return t >= from && t <= to; })
    .reduce((sum, e) => sum + (e.amount || 0), 0);
};

// ── Общий пул: месячный учёт. Старые счета без poolAccounting не меняются. ──
export const isMonthlyPool = a => a?.type === 'POOL' && a.poolAccounting?.version === 1;
// Финансовые месяцы едины для всех устройств: Europe/Moscow (UTC+3).
export const poolTime = d => typeof d === 'string' && DATE_ONLY.test(d) ? Date.parse(`${d}T00:00:00+03:00`) : txAt(d);
export const poolMonth = d => new Date(poolTime(d) + 10800000).toISOString().slice(0, 7);
export const poolMonthStart = month => Date.parse(`${month}-01T00:00:00+03:00`);
export const nextPoolMonth = month => {
    const [y, m] = month.split('-').map(Number);
    return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;
};
export const monthlyPoolApplies = (a, date) => isMonthlyPool(a) && poolTime(date) >= poolMonthStart(a.poolAccounting.startMonth);
export const poolTermsAt = (a, date) => {
    if (!a?.poolAccounting)
        return undefined;
    const t = poolTime(date), opening = a.poolAccounting.openingTerms;
    return [...(a.poolAccounting.terms || [])].filter(x => at(x.date) <= t).sort((x, y) => at(x.date) - at(y.date))
        .reduce((state, patch) => ({ ...state, ...patch, members: { ...state.members, ...patch.members } }), { ...opening, members: { ...opening?.members } });
};
export const poolProfitDisposition = (a, id, date = Date.now()) => poolTermsAt(a, date)?.members?.[id]?.disposition || 'PAYABLE';
/** @returns {'MONTH' | 'SCHEDULE_PERIOD'} */
export const poolProfitBasis = (account, date = Date.now()) => poolTermsAt(account, date)?.profitBasis === 'SCHEDULE_PERIOD' ? 'SCHEDULE_PERIOD' : 'MONTH';
// Все суммы распределяются в целых копейках. Остаток — по наибольшим дробям,
// при равенстве стабильно по id. Сумма строк ВСЕГДА равна исходной сумме.
export const allocatePoolMoney = (amount, weights) => {
    const cents = Math.round(Number(amount) * 100), sign = cents < 0 ? -1 : 1, total = weights.reduce((n, w) => n + Math.max(0, w.weight), 0);
    const rows = weights.map(w => { const raw = total > 0 ? Math.abs(cents) * Math.max(0, w.weight) / total : 0; return { ...w, cents: Math.floor(raw), fraction: raw - Math.floor(raw) }; });
    let rest = Math.abs(cents) - rows.reduce((n, w) => n + w.cents, 0);
    if (total > 0)
        for (const w of [...rows].sort((a, b) => b.fraction - a.fraction || a.id.localeCompare(b.id))) {
            if (rest-- <= 0)
                break;
            w.cents++;
        }
    return rows.map(w => ({ id: w.id, amount: sign * w.cents / 100 }));
};
export const monthlyPoolShares = (account, investors, month, now = Date.now()) => {
    const closed = account.poolAccounting?.closed?.find(c => c.month === month);
    if (closed)
        return closed.shares.map(s => ({ ...s, investor: investors.find(i => i.id === s.investorId) || { id: s.investorId, name: s.name } }));
    const from = poolMonthStart(month), to = Math.min(poolMonthStart(nextPoolMonth(month)), Number(now));
    if (to <= from)
        return [];
    const members = (account.poolMemberIds || []).map(id => investors.find(i => i.id === id)).filter(Boolean);
    const events = new Set([from, to]);
    for (const i of members)
        for (const p of i.investmentPeriods?.length ? i.investmentPeriods : [i])
            for (const d of [p.joinedDate, p.leftPoolDate, ...(p.capitalChanges || []).map(c => c.date)]) {
                const t = at(d);
                if (t > from && t < to)
                    events.add(t);
            }
    for (const term of account.poolAccounting?.terms || []) {
        const t = at(term.date);
        if (t > from && t < to)
            events.add(t);
    }
    const times = [...events].sort((a, b) => a - b), capital = new Map(members.map(i => [i.id, 0])), rated = new Map(members.map(i => [i.id, 0]));
    let total = 0;
    for (let n = 1; n < times.length; n++) {
        const mid = (times[n] + times[n - 1]) / 2, days = (times[n] - times[n - 1]) / 86400000, terms = poolTermsAt(account, mid);
        for (const i of members)
            if (isPoolMemberActiveAt(i, mid)) {
                const value = getInvestorAmountAt(i, mid) * days, rate = terms?.members?.[i.id]?.rate ?? i.profitPercentage;
                capital.set(i.id, capital.get(i.id) + value);
                rated.set(i.id, rated.get(i.id) + value * clampPercent(rate) / 100);
                total += value;
            }
    }
    const rows = members.map(investor => ({ investor, investorId: investor.id, name: investor.name, capitalDays: capital.get(investor.id),
        capitalPercentage: total > 0 ? capital.get(investor.id) / total * 100 : 0,
        basePercentage: total > 0 ? rated.get(investor.id) / total * 100 : 0,
        percentage: total > 0 ? rated.get(investor.id) / total * 100 : 0 }));
    // Управленческие условия фиксируются на начало месяца. Смена — со следующего.
    const split = poolTermsAt(account, from)?.managerShareSplit || [], rest = Math.max(0, 100 - rows.reduce((n, r) => n + r.percentage, 0));
    const scale = Math.max(100, split.reduce((n, s) => n + Number(s.percent), 0));
    for (const s of split) {
        const row = rows.find(r => r.investorId === s.investorId);
        if (row?.capitalDays > 0)
            row.percentage += rest * Math.max(0, Number(s.percent)) / scale;
    }
    return rows;
};
// Для закрытого месяца используем сохранённые капитал-дни и базовые доли.
// У снимков старого формата базовая доля восстанавливается из датированных условий.
export const monthlyManagerOriginShares = (account, investors, month, now = Date.now()) => {
    const shares = monthlyPoolShares(account, investors, month, now);
    const date = Math.min(poolMonthStart(nextPoolMonth(month)) - 1, Number(now));
    const terms = poolTermsAt(account, date);
    const origins = shares.map(row => ({ investor: row.investor,
        percentage: Math.max(0, row.capitalPercentage - (row.basePercentage ?? row.capitalPercentage * clampPercent(terms?.members?.[row.investorId]?.rate ?? row.investor.profitPercentage) / 100)) }));
    const total = origins.reduce((n, row) => n + row.percentage, 0);
    const retained = Math.max(0, 100 - shares.reduce((n, row) => n + row.percentage, 0));
    return origins.map(row => ({ ...row, percentage: total > 0 ? row.percentage / total * retained : 0 }));
};
export const poolMoneyIn = sale => [
    { id: `${sale.id}_dp`, date: sale.startDate, amount: Number(sale.downPayment) || 0 },
    ...(sale.paymentPlan || []).filter(p => p.isPaid && p.isRealPayment !== false),
];
const profitParts = (shares, origins) => {
    const manager = sharesToManager(shares);
    return {
        weights: [...shares.map(s => ({ id: s.investor.id, weight: s.percentage })), { id: '__manager__', weight: manager }],
        originWeights: origins.map(s => ({ id: s.investor.id, weight: s.percentage })),
    };
};

const datedProfitParts = (account, investors, date) => {
    const time = poolTime(date);
    return profitParts(getAccountShares(account, investors, time), managerOriginSharesAt(account, investors, time));
};

// Доли фиксируются для каждой операции. Месяц складывает эти начисления и
// вычитает общие расходы по составу на дату расхода. Если часть долей ушла в
// минус, остаток общего результата делится пропорционально положительным долям.
const settleMonthlyAllocations = (sources, costs, carryIn, distributable, participantIds) => {
    const totals = new Map(participantIds.map(id => [id, 0]));
    const originTotals = new Map();
    const add = (row, amount) => {
        row.parts = allocatePoolMoney(amount, row.weights);
        const manager = row.parts.find(p => p.id === '__manager__')?.amount || 0;
        row.managerOrigins = allocatePoolMoney(manager, row.originWeights).filter(p => p.amount !== 0);
        for (const part of row.parts) totals.set(part.id, (totals.get(part.id) || 0) + Math.round(part.amount * 100));
        for (const part of row.managerOrigins) originTotals.set(part.id, (originTotals.get(part.id) || 0) + Math.round(part.amount * 100));
        row.parts = row.parts.filter(p => p.amount !== 0);
        delete row.weights;
        delete row.originWeights;
    };
    for (const row of sources) add(row, row.amount);
    for (const row of costs) add(row, -row.amount);

    const positive = [...totals].map(([id, cents]) => ({ id, weight: Math.max(0, cents) }));
    const carryParts = allocatePoolMoney(-carryIn, positive).filter(p => p.amount !== 0);
    const carryById = new Map(carryParts.map(part => [part.id, Math.round(part.amount * 100)]));
    const allocations = allocatePoolMoney(distributable, positive.map(row => ({
        ...row, weight: Math.max(0, row.weight + (carryById.get(row.id) || 0)),
    })));
    const managerAmount = allocations.find(row => row.id === '__manager__')?.amount || 0;
    const attributed = [...originTotals].map(([id, cents]) => ({ id, weight: Math.max(0, cents) }));
    // Прибыль управляющего без источника капитала, например от раннего договора,
    // сохраняется в общей карточке, но не приписывается выбранному инвестору.
    const attributedTotal = attributed.reduce((sum, row) => sum + row.weight, 0);
    const ownWeight = Math.max(0, (totals.get('__manager__') || 0) - attributedTotal);
    const managerAllocations = allocatePoolMoney(managerAmount, [...attributed, { id: '__unattributed__', weight: ownWeight }])
        .filter(row => row.id !== '__unattributed__' && row.amount > 0);
    const managerCarry = carryParts.find(row => row.id === '__manager__')?.amount || 0;
    const managerCarryParts = allocatePoolMoney(managerCarry, [...attributed, { id: '__unattributed__', weight: ownWeight }])
        .filter(row => row.id !== '__unattributed__' && row.amount !== 0);
    return { allocations, carryParts, managerAllocations, managerCarryParts };
};

const applyEntryDateParts = (rows, adjustments, key) => {
    const cents = new Map(rows.map(row => [row.id, Math.round(row.amount * 100)]));
    for (const adjustment of adjustments)
        for (const part of adjustment[key])
            cents.set(part.id, (cents.get(part.id) || 0) + Math.round(part.amount * 100));
    return Array.from(cents, ([id, amount]) => ({ id, amount: amount / 100 }));
};

export const poolMonthlyReport = (account, investors, sales, expenses, month, now = Date.now(), paymentsOnly = false) => {
    const frozen = account.poolAccounting?.closed?.find(c => c.month === month);
    if (frozen)
        return { ...frozen, status: 'CLOSED' };
    paymentsOnly = account.poolAccounting.profitFromPaymentsOnly ?? paymentsOnly;
    const from = poolMonthStart(month), end = poolMonthStart(nextPoolMonth(month)), to = Math.min(end, Number(now));
    const shares = monthlyPoolShares(account, investors, month, now), sources = [], issues = [];
    if (new Set(account.poolMemberIds || []).size !== (account.poolMemberIds || []).length)
        issues.push('Участник указан в пуле дважды.');
    for (const id of account.poolMemberIds || []) {
        const investor = investors.find(i => i.id === id);
        if (!investor) {
            issues.push('Не найден участник пула.');
            continue;
        }
        const periods = [...(investor.investmentPeriods?.length ? investor.investmentPeriods : [investor])].sort((a, b) => at(a.joinedDate) - at(b.joinedDate));
        if (!Number.isFinite(Number(investor.initialAmount)) || Number(investor.initialAmount) < 0)
            issues.push(`${investor.name}: проверьте капитал.`);
        for (let n = 0; n < periods.length; n++) {
            const p = periods[n];
            if (!Number.isFinite(at(p.joinedDate)) || p.leftPoolDate && (!Number.isFinite(at(p.leftPoolDate)) || at(p.leftPoolDate) < at(p.joinedDate)) || n && (!periods[n - 1].leftPoolDate || at(periods[n - 1].leftPoolDate) > at(p.joinedDate)))
                issues.push(`${investor.name}: проверьте периоды участия.`);
            if (!Number.isFinite(Number(p.initialAmount)) || Number(p.initialAmount) < 0 || (p.capitalChanges || []).some(c => !Number.isFinite(at(c.date)) || !Number.isFinite(Number(c.delta))))
                issues.push(`${investor.name}: проверьте историю капитала.`);
        }
    }
    for (const s of sales) {
        if (s.accountId !== account.id)
            continue;
        if (s.type === 'INSTALLMENT' && (!Number.isFinite(Number(s.buyPrice)) || !Number.isFinite(Number(s.totalAmount))))
            issues.push(`${s.productName || s.id}: проверьте суммы договора.`);
        if (!(Number(s.buyPrice) > 0) || !(Number(s.totalAmount) > 0))
            continue;
        if ((account.poolAccounting.excludedSaleIds || []).includes(s.id))
            continue;
        const ids = new Set();
        for (const p of poolMoneyIn(s)) {
            const time = poolTime(p.date);
            if (!Number.isFinite(time)) {
                issues.push(`${s.productName || s.id}: проверьте дату платежа.`);
                continue;
            }
            if (time < from || time >= end || time > to)
                continue;
            if (!Number.isFinite(Number(p.amount)) || Number(p.amount) < 0 || !Number.isFinite(Number(p.discountAmount || 0))) {
                issues.push(`${s.productName || s.id}: проверьте сумму платежа.`);
                continue;
            }
            if (ids.has(p.id))
                issues.push(`${s.productName || s.id}: повторяется запись платежа.`);
            ids.add(p.id);
            if (!(p.amount > 0) && !(Number(p.discountAmount) > 0))
                continue;
            const amount = moneyInProfit(s, p, paymentsOnly);
            const earningMonths = [...new Set(monthlyPaymentWindows(s, p).map(w => w.plannedMonth).filter(Boolean))];
            sources.push({
                saleId: s.id, paymentId: p.id, date: p.date, amount, customerId: s.customerId, productName: s.productName,
                earningMonths,
                ...profitParts(monthlyPaymentShares(account, investors, s, p), monthlyPaymentShares(account, investors, s, p, managerOriginSharesAt)),
            });
        }
    }
    for (const e of expenses.filter(e => e.accountId === account.id && e.fromProfit)) {
        if (!Number.isFinite(poolTime(e.date)))
            issues.push('Проверьте дату общего расхода.');
        else if (poolTime(e.date) >= from && poolTime(e.date) < end && !Number.isFinite(Number(e.amount)))
            issues.push('Проверьте сумму общего расхода.');
    }
    const costRows = expenses.filter(e => e.accountId === account.id && e.fromProfit && e.profitSource !== 'MANAGER' && e.category !== 'Моя выплата' && e.payoutType !== 'PROFIT' && e.payoutType !== 'INVESTMENT' && poolTime(e.date) >= from && poolTime(e.date) < end && poolTime(e.date) <= to)
        .map(e => ({ id: e.id, date: e.date, amount: Number(e.amount) || 0, title: e.title || e.category || 'Общий расход', ...datedProfitParts(account, investors, e.date) }));
    for (const adjustment of account.poolAccounting.adjustments || []) {
        const time = poolTime(adjustment.date);
        if (time < from || time >= end || time > to)
            continue;
        if (adjustment.amount < 0)
            costRows.push({ id: adjustment.id, date: adjustment.date, amount: -adjustment.amount, title: `Корректировка: ${adjustment.reason}`, ...datedProfitParts(account, investors, adjustment.date) });
        else
            sources.push({ saleId: adjustment.saleId || `pool_adjustment_${adjustment.id}`, paymentId: adjustment.id, date: adjustment.date, amount: adjustment.amount, productName: `Корректировка: ${adjustment.reason}`, ...datedProfitParts(account, investors, adjustment.date) });
    }
    const round = n => Math.round(n * 100) / 100 || 0, gross = round(sources.reduce((n, s) => n + s.amount, 0)), costs = round(costRows.reduce((n, e) => n + e.amount, 0));
    const roundedSources=roundPoolProfitRows(sources);
    sources.forEach((source,index)=>{source.amount=roundedSources[index].amount;});
    const prior = [...(account.poolAccounting.closed || [])].filter(c => c.month < month).sort((a, b) => a.month.localeCompare(b.month)).at(-1);
    const carryIn = Number(prior?.carryOut) || 0, net = round(gross - costs - carryIn), distributable = Math.max(0, net), carryOut = Math.max(0, -net);
    const hasCapital = shares.some(s => s.capitalDays > 0)
        || sources.some(row => row.originWeights.some(part => part.weight > 0)
            || row.weights.some(part => part.id !== '__manager__' && part.weight > 0));
    const participantIds = [...shares.map(row => row.investorId), '__manager__'];
    const { allocations, carryParts, managerAllocations, managerCarryParts } = settleMonthlyAllocations(
        sources, costRows, carryIn, hasCapital ? distributable : 0, participantIds,
    );
    if (shares.some(s => !Number.isFinite(s.percentage) || s.percentage < 0) || hasCapital && Math.round(allocations.reduce((n, r) => n + r.amount, 0) * 100) !== Math.round(distributable * 100))
        issues.push('Проверьте условия распределения: суммы не сходятся.');
    const entryDateAdjustments = (account.poolAccounting.entryDateAdjustments || []).filter(adjustment => {
        const time = poolTime(adjustment.date);
        return time >= from && time < end && time <= to && adjustment.months.length;
    });
    const corrected = entryDateAdjustments.length ? {
        allocations: applyEntryDateParts(allocations, entryDateAdjustments, 'parts'),
        managerAllocations: applyEntryDateParts(managerAllocations, entryDateAdjustments, 'managerOrigins'),
        entryDateAdjustments,
    } : { allocations, managerAllocations };
    return { month, status: 'PRELIMINARY', issues: [...new Set(issues)], date: new Date(Math.max(from, to - 1)).toISOString(), asOf: new Date(to).toISOString(), gross, costs, carryIn, carryOut, net, distributable,
        unallocated: hasCapital ? 0 : distributable, shares: shares.map(({ investor, ...s }) => s), ...corrected, sources, costRows, carryParts, managerCarryParts };
};
export const poolMonthlyReports = (account, investors, sales, expenses = [], now = Date.now(), paymentsOnly = false) => {
    if (!isMonthlyPool(account))
        return [];
    const out = [], through = poolMonth(now);
    let month = account.poolAccounting.startMonth, carry = 0;
    for (let n = 0; month <= through && n < 1200; n++, month = nextPoolMonth(month)) {
        const frozen = account.poolAccounting.closed?.find(c => c.month === month);
        const copy = { ...account, poolAccounting: { ...account.poolAccounting, closed: [{ month: '0000-00', carryOut: carry }] } };
        const report = frozen ? { ...frozen, status: 'CLOSED' } : poolMonthlyReport(copy, investors, sales, expenses, month, now, paymentsOnly);
        out.push(report);
        carry = report.carryOut;
    }
    return out;
};
export const poolReinvested = (account, id, from = -Infinity, to = Infinity) => (account?.poolAccounting?.reinvestments || [])
    .filter(r => r.investorId === id && at(r.date) >= from && at(r.date) <= to).reduce((n, r) => n + Number(r.amount), 0);
export const poolInvestorRate = (account, investor, date = Date.now()) => poolTermsAt(account, date)?.members?.[investor.id]?.rate ?? investor.profitPercentage;
/** Границы отчёта нового пула — московские календарные дни на любом устройстве. */
export const inPoolProfitPeriod = (date, period) => {
    const value = poolTime(date), start = period.start ? poolTime(period.start) : -Infinity;
    const end = period.end ? poolTime(period.end) + (DATE_ONLY.test(period.end) ? 86400000 - 1 : 0) : Infinity;
    return Number.isFinite(value) && value >= start && value <= end;
};

/** В формах пула день остаётся стабильной частью запроса при повторе отправки.
 * Точное время сегодняшнего вложения назначает сервер; прошедший день — 00:00 МСК. */
export const poolEntryDate = (date, now=Date.now()) => {
    if (!date) return new Date(now).toISOString();
    if (typeof date !== 'string') return 'Invalid Date';
    if (!DATE_ONLY.test(date)) return date;
    const time=poolTime(date);
    if (!Number.isFinite(time)||new Date(time+10800000).toISOString().slice(0,10)!==date) return 'Invalid Date';
    if (date===new Date(Number(now)+10800000).toISOString().slice(0,10)) return new Date(now).toISOString();
    return new Date(time).toISOString();
};

export const poolDay = (date=Date.now()) => new Date(poolTime(date)+10800000).toISOString().slice(0,10);

/** Округление строк прибыли согласовано с округлением общего итога.
 * Целые копейки не меняются; дробные остатки распределяются стабильно по источнику. */
export const roundPoolProfitRows = rows => {
    const units=rows.map((row,index)=>{
        let raw=Number(row.amount)*100;
        if(Math.abs(raw-Math.round(raw))<Math.max(1e-7,Number.EPSILON*Math.abs(raw)*4))raw=Math.round(raw);
        const cents=Math.trunc(raw);
        return {index,key:`${row.saleId||row.id||''}:${row.paymentId||row.id||''}`,cents,fraction:raw-cents};
    });
    const target=Math.round(rows.reduce((n,r)=>n+Number(r.amount),0)*100);
    const rest=target-units.reduce((n,r)=>n+r.cents,0),direction=Math.sign(rest);
    const ranked=[...units].sort((a,b)=>direction*(b.fraction-a.fraction)||a.key.localeCompare(b.key));
    for(let n=0;n<Math.abs(rest);n++)ranked[n].cents+=direction;
    return rows.map((row,index)=>({...row,amount:units[index].cents/100||0}));
};

/** Расшифровка начисления из того же месячного снимка. Расходы и перенос
 * убытка показаны отдельно: прибыль клиента не подменяется итогом всего пула.
 * Округление сверяется с уже рассчитанным начислением, не меняя его. */
export const poolAllocationDetails = (report, recipientId, amountOverride, percentageOverride, originId) => {
    const amount = amountOverride ?? report.allocations.find(r => r.id === recipientId)?.amount ?? 0;
    if (report.carryParts) {
        const valueFor = row => {
            const parts = originId ? row.managerOrigins : row.parts;
            return parts?.find(part => part.id === (originId || recipientId))?.amount || 0;
        };
        const carry = (originId ? report.managerCarryParts : report.carryParts)
            ?.find(part => part.id === (originId || recipientId))?.amount || 0;
        const rows = [
            ...(report.sources || []).map(({ parts, managerOrigins, ...row }) => ({
                ...row, id: `income:${row.saleId}:${row.paymentId}`, kind: 'income', amount: valueFor({ parts, managerOrigins }),
            })),
            ...(report.costRows || []).map(({ parts, managerOrigins, ...row }) => ({
                ...row, id: `cost:${row.id}`, kind: 'cost', amount: valueFor({ parts, managerOrigins }),
            })),
            ...(report.entryDateAdjustments || []).map(row => ({
                id: row.id, date: row.date, title: 'Исправление даты входа инвестора', kind: 'cost', amount: valueFor(row),
            })),
        ];
        if (carry) rows.push({ id: 'carry', date: report.date, title: 'Покрытие прошлого убытка', kind: 'carry', amount: carry });
        const delta = Math.round(amount * 100) - rows.reduce((sum, row) => sum + Math.round(row.amount * 100), 0);
        if (delta) rows.push({ id: 'pool-net', date: report.date, title: 'Распределение чистого результата пула', kind: 'cost', amount: delta / 100 });
        return rows.filter(row => row.amount !== 0);
    }
    const percentage = percentageOverride ?? (recipientId === '__manager__'
        ? Math.max(0, 100 - report.shares.reduce((n, r) => n + r.percentage, 0))
        : report.shares.find(r => r.investorId === recipientId)?.percentage ?? 0);
    const factor = percentage / 100;
    const rows = [
        ...(report.sources || []).map(s => ({ ...s, id: `income:${s.saleId}:${s.paymentId}`, kind: 'income', amount: s.amount * factor })),
        ...(report.costRows || []).map(e => ({ ...e, id: `cost:${e.id}`, kind: 'cost', amount: -e.amount * factor })),
        ...(report.carryIn > 0 ? [{ id: 'carry', date: report.date, title: 'Покрытие прошлого убытка', kind: 'carry', amount: -report.carryIn * factor }] : []),
    ];
    const rounded = roundPoolProfitRows(rows);
    const delta = Math.round((amount - rounded.reduce((n, r) => n + r.amount, 0)) * 100) / 100;
    if (delta) rounded.push({ id: 'rounding', date: report.date, title: 'Округление', kind: 'rounding', amount: delta });
    return rounded.filter(r => r.amount !== 0);
};
