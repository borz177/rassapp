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
    const { members, totalCapital } = poolMembersAt(account, investors, cutoff);
    let shares;
    if (totalCapital <= 0) {
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
const saleEarningWindows = (sale) => {
  const hit = earningCache.get(sale);
  if (hit) return hit;

  const plan = sale.paymentPlan || [];
  const start = txAt(sale.startDate);
  const due = plan
    .filter(p => p.isRealPayment !== true)
    .map(p => ({ due: txAt(p.date), left: Number(p.amount) || 0 }))
    .filter(s => s.left > 0 && !Number.isNaN(s.due))
    .sort((a, b) => a.due - b.due);
  const slots = due.map((s, i) => {
    const prev = i === 0 ? start : due[i - 1].due;
    return { from: Number.isNaN(prev) ? s.due : Math.min(prev, s.due), to: s.due, left: s.left };
  });

  const paid = new Map();
  const payments = plan
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.isPaid && p.isRealPayment !== false)
    .sort((a, b) => txAt(a.p.date) - txAt(b.p.date) || a.i - b.i);
  let k = 0;
  for (const { p } of payments) {
    let money = (Number(p.amount) || 0) + (Number(p.discountAmount) || 0);
    const windows = [];
    while (money > 0.005 && k < slots.length) {
      const slot = slots[k];
      const take = Math.min(slot.left, money);
      windows.push({ from: slot.from, to: slot.to, weight: take });
      slot.left -= take;
      money -= take;
      // Копеечный допуск — как в expectedPaymentsInPeriod
      if (slot.left <= 0.01) k++;
    }
    if (money > 0.005) { const t = txAt(p.date); windows.push({ from: t, to: t, weight: money }); }
    paid.set(p.id, windows);
  }
  const open = slots.slice(k)
    .filter(s => s.left > 0.01)
    .map(s => ({ from: s.from, to: s.to, weight: s.left }));

  const result = { paid, open };
  earningCache.set(sale, result);
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
const sharesOverWindows = (account, investors, windows, now) => {
  const sums = new Map();
  let total = 0;
  const add = (time, weight) => {
    if (!(weight > 0)) return;
    total += weight;
    for (const { investor, percentage } of getAccountShares(account, investors, time)) {
      const e = sums.get(investor.id) || { investor, sum: 0 };
      e.sum += percentage * weight;
      sums.set(investor.id, e);
    }
  };

  const events = poolEventTimes(account, investors);
  for (const { from, to, weight } of windows) {
    const length = to - from;
    if (!(length > 0) || from >= now) { add(Math.min(to, now), weight); continue; }
    const end = Math.min(to, now);
    const cuts = [from, ...events.filter(t => t > from && t < end), end];
    for (let i = 0; i < cuts.length - 1; i++) add(cuts[i], weight * (cuts[i + 1] - cuts[i]) / length);
    if (to > end) add(now, weight * (to - end) / length);
  }

  if (total <= 0) return getAccountShares(account, investors, now);
  return [...sums.values()].map(e => ({ investor: e.investor, percentage: e.sum / total }));
};

// Договор оформлен, когда в кассе не было ни одного инвестора, — он менеджера
const isManagerContract = (account, investors, sale) =>
  getAccountShares(account, investors, sale.startDate).length === 0;

const sharesToManager = (shares) =>
  Math.max(0, 100 - shares.reduce((sum, s) => sum + s.percentage, 0));

/** Доли инвесторов в прибыли полученного платежа (первый взнос или оплата по договору). */
export const paymentProfitShares = (account, investors, sale, payment) => {
  const t = txAt(payment.date);
  if (!account || account.type !== 'POOL' || !sale) return getAccountShares(account, investors, t);
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
  if (isManagerContract(account, investors, sale)) return [];
  return sharesOverWindows(account, investors, saleEarningWindows(sale).open, now);
};

/** Доля менеджера в ожидаемой прибыли с остатка долга. */
export const expectedManagerPercent = (account, investors, sale) =>
  sharesToManager(expectedProfitShares(account, investors, sale));

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

/** Прибыль одного поступления: платежа или первого взноса. */
export const moneyInProfit = (sale, money, paymentsOnly = false) => {
  if (paymentsOnly && isDownPaymentOf(sale, money.id)) return 0;
  return (Number(money.amount) || 0) * saleProfitMargin(sale, paymentsOnly);
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
