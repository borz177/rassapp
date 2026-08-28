import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { Account, Investor, InvestmentPeriod, Sale, Expense, DEFAULT_WAREHOUSE_ID, Product} from '../types';

export const escapeHtml = (str: unknown): string =>
  String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

// Нормализует дату/время к UTC-полуночи того же календарного дня.
// Нужно потому что joinedDate хранится с реальным временем создания (напр. 10:48 UTC),
// а ev.date / cutoff всегда полночь UTC. Без нормализации инвестор, вошедший в 10:48,
// «не видит» убытков того же дня (00:00 < 10:48 → joined > cutoff → excluded).
const dayMs = (d: string | number | Date): number => {
  const dt = new Date(d);
  return Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
};

// Участвовал ли инвестор в пуле на момент cutoff.
// Если задан investmentPeriods — проверяем по списку периодов (поддержка повторного входа).
// Иначе — legacy-поведение: один joinedDate / leftPoolDate.
const isPoolMemberActiveAt = (investor: Investor, cutoff: number): boolean => {
  if (investor.investmentPeriods && investor.investmentPeriods.length > 0) {
    return investor.investmentPeriods.some(p => {
      const joined = dayMs(p.joinedDate);
      const left = p.leftPoolDate ? dayMs(p.leftPoolDate) : Infinity;
      return joined <= cutoff && cutoff < left;
    });
  }
  if (dayMs(investor.joinedDate) > cutoff) return false;
  if (investor.leftPoolDate && dayMs(investor.leftPoolDate) <= cutoff) return false;
  return true;
};

// Сумма вложения инвестора на момент cutoff — из активного периода.
// Нужна при поддержке нескольких периодов (разные суммы в разные периоды).
const getInvestorAmountAt = (investor: Investor, cutoff: number): number => {
  if (investor.investmentPeriods && investor.investmentPeriods.length > 0) {
    const active = investor.investmentPeriods.find(p => {
      const joined = dayMs(p.joinedDate);
      const left = p.leftPoolDate ? dayMs(p.leftPoolDate) : Infinity;
      return joined <= cutoff && cutoff < left;
    });
    return active ? active.initialAmount : 0;
  }
  return investor.initialAmount;
};

// Возвращает активный период инвестора на момент cutoff (или undefined).
export const getActivePeriodAt = (investor: Investor, cutoff: number): InvestmentPeriod | null => {
  if (investor.investmentPeriods && investor.investmentPeriods.length > 0) {
    return investor.investmentPeriods.find(p => {
      const joined = dayMs(p.joinedDate);
      const left = p.leftPoolDate ? dayMs(p.leftPoolDate) : Infinity;
      return joined <= cutoff && cutoff < left;
    }) ?? null;
  }
  const legacy: InvestmentPeriod = {
    id: 'legacy',
    joinedDate: investor.joinedDate,
    leftPoolDate: investor.leftPoolDate,
    initialAmount: investor.initialAmount,
  };
  return isPoolMemberActiveAt(investor, cutoff) ? legacy : null;
};

// 🔒 Единая точка расчёта долей прибыли по счёту.
// Обычный счёт инвестора (ownerId) — доля равна его фиксированному profitPercentage, как и раньше.
// Общий пул (type === 'POOL', BUSINESS_PRO) — двухэтапно: (1) прибыль сначала делится между
// участниками ПРОПОРЦИОНАЛЬНО ИХ КАПИТАЛУ (какая часть общей прибыли "приходится" на деньги
// именно этого инвестора), (2) к этой капитал-части применяется ЕГО СОБСТВЕННЫЙ индивидуальный
// процент (Investor.profitPercentage) — у каждого инвестора пула свой процент, единого процента
// на весь пул нет. Итоговая доля инвестора от общей прибыли = (его_капитал / общий_капитал) ×
// его_процент. Доля менеджера — как и для обычного счёта — просто остаток до 100%.
//
// asOfDate — на какую дату считать состав и суммы пула. Участники, чей joinedDate позже
// asOfDate, в расчёт не попадают вовсе (их ещё не было в пуле на тот момент).
// Для прибыли по договору сюда передаётся ДАТА ОФОРМЛЕНИЯ ДОГОВОРА — см. shareDateForSale
// ниже. Для операций, не привязанных к договору (расход из прибыли), — дата операции.
export const getAccountShares = (
  account: Account | undefined,
  investors: Investor[],
  asOfDate?: string | number | Date
): { investor: Investor; percentage: number }[] => {
  if (!account) return [];
  if (account.type === 'POOL') {
    const cutoff = asOfDate ? new Date(asOfDate).getTime() : Date.now();
    const members = (account.poolMemberIds || [])
      .map(id => investors.find(i => i.id === id))
      .filter((i): i is Investor => !!i && isPoolMemberActiveAt(i, cutoff));
    const totalCapital = members.reduce((sum, inv) => sum + getInvestorAmountAt(inv, cutoff), 0);
    if (totalCapital <= 0) {
      // Суммы не заданы — используем profitPercentage как фиксированный процент напрямую
      return members.map(investor => ({ investor, percentage: investor.profitPercentage || 0 }));
    }
    return members.map(investor => {
      const capitalShare = getInvestorAmountAt(investor, cutoff) / totalCapital; // 0..1
      return { investor, percentage: capitalShare * (investor.profitPercentage || 0) };
    });
  }
  if (account.ownerId) {
    const investor = investors.find(i => i.id === account.ownerId);
    return investor ? [{ investor, percentage: investor.profitPercentage || 0 }] : [];
  }
  return [];
};

/**
 * 📅 На какую дату определяются доли прибыли по КОНКРЕТНОМУ договору — на дату его оформления.
 *
 * Прибыль по рассрочке (мурабаха) фиксируется в момент заключения договора: товар куплен
 * и продан, наценка известна, дальше идёт лишь погашение возникшего долга. Поэтому право
 * на эту прибыль принадлежит тем, чей капитал нёс риск при её создании, — участникам пула
 * НА МОМЕНТ ОФОРМЛЕНИЯ, а не тем, кто вошёл позже и застал только платежи.
 *
 * Раньше доли брались на дату каждого платежа: инвестор, вошедший в пул после оформления
 * договора, получал долю прибыли по сделке, которую профинансировали до него.
 *
 * Для обычного счёта инвестора (ownerId) дата ни на что не влияет — там фиксированный
 * процент. Правило работает только для общего пула, где состав и капитал меняются во времени.
 */
export const shareDateForSale = (sale: Pick<Sale, 'startDate'>): string => sale.startDate;

// Остаток % после долей всех инвесторов счёта (на дату asOfDate) — достаётся менеджеру.
// Единая формула для всех типов счёта, включая POOL: доля каждого инвестора там уже учитывает
// и его капитал-долю, и его личный процент (см. getAccountShares), поэтому остаток считается так же просто.
export const getManagerSharePercent = (account: Account | undefined, investors: Investor[], asOfDate?: string | number | Date): number => {
  const totalInvestorShare = getAccountShares(account, investors, asOfDate).reduce((sum, m) => sum + m.percentage, 0);
  return Math.max(0, 100 - totalInvestorShare);
};

// Доля КАПИТАЛА конкретного инвестора в счёте (0..1), в отличие от getAccountShares — без учёта
// его личного процента прибыли. Нужна, когда требуется выделить долю МЕНЕДЖЕРА, относящуюся именно
// к капиталу этого инвестора: profitFromPayment × capitalShare × (100% − его_процент) / 100 —
// см. использование в App.tsx reportData при фильтрации отчёта по одному инвестору из пула.
export const getInvestorCapitalShare = (
  account: Account | undefined,
  investorId: string,
  investors: Investor[],
  asOfDate?: string | number | Date
): number => {
  if (!account) return 0;
  if (account.type === 'POOL') {
    const cutoff = asOfDate ? new Date(asOfDate).getTime() : Date.now();
    const members = (account.poolMemberIds || [])
      .map(id => investors.find(i => i.id === id))
      .filter((i): i is Investor => !!i && isPoolMemberActiveAt(i, cutoff));
    const totalCapital = members.reduce((sum, inv) => sum + getInvestorAmountAt(inv, cutoff), 0);
    if (totalCapital <= 0) return 0;
    const investor = members.find(i => i.id === investorId);
    return investor ? getInvestorAmountAt(investor, cutoff) / totalCapital : 0;
  }
  return account.ownerId === investorId ? 1 : 0;
};

// Участвует ли данный инвестор в этом счёте — как единоличный владелец или как участник пула.
export const isAccountForInvestor = (account: Account, investorId: string): boolean => {
  return account.ownerId === investorId || (account.type === 'POOL' && (account.poolMemberIds || []).includes(investorId));
};

// Счёт, в котором участвует данный инвестор — свой отдельный (ownerId) или общий пул (poolMemberIds).
export const getInvestorAccount = (investorId: string, accounts: Account[]): Account | undefined => {
  return accounts.find(a => isAccountForInvestor(a, investorId));
};

// Просрочка по договору: сколько клиент был должен заплатить к сегодняшнему дню
// (первый взнос + все плановые платежи с прошедшей датой) минус сколько реально внёс.
// Считаем от remainingAmount, а не от флагов isPaid — так учитываются частичные оплаты.
//
// Итог округляется до копеек намеренно. Суммы платежей — это доли вроде 48 100 / 6,
// и в double их сложение расходится с (totalAmount − remainingAmount) на 1e-12.
// Без округления такой договор проходил проверку «просрочка > 0» и попадал во вкладку
// «Просроченные» с суммой 0,00 ₽ — на проде так висело 8 договоров у 6 пользователей.
export const calculateSaleOverdue = (sale: Sale, today?: Date): number => {
  const cutoff = today ?? (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
  let expectedTotal = sale.downPayment;
  (sale.paymentPlan || []).forEach(p => {
    if (!p.isRealPayment && new Date(p.date) < cutoff) expectedTotal += p.amount;
  });
  const totalPaid = sale.totalAmount - sale.remainingAmount;
  const overdue = Math.round((expectedTotal - totalPaid) * 100) / 100;
  // Порог в 1 ₽, а не «больше нуля». Суммы платежей — это доли вроде 48 100 / 6, каждая
  // округлена до копеек, поэтому их сумма расходится с (totalAmount − remainingAmount) на
  // копейки. Такой остаток — не долг, а артефакт округления, но он проходил проверку «> 0»:
  // договор попадал во вкладку «Просроченные», а сумма выводится через Math.round и
  // показывалась как «0 ₽» (на проде так висело 12 договоров с остатком 0,03–0,67 ₽).
  return overdue >= 1 ? overdue : 0;
};

export const formatCurrency = (amount: number | undefined | null, showCents: boolean = true): string => {
  if (amount === undefined || amount === null || isNaN(amount)) {
    return '0';
  }
  return amount.toLocaleString('ru-RU', {
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  });
};

export const formatDate = (dateString: string | undefined | null): string => {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ru-RU');
};

export const getSellerPhone = (user: any): string => {
  // 🔥 Читаем ПРЯМО СЕЙЧАС из localStorage
  const appSettings = JSON.parse(localStorage.getItem('appSettings') || '{}');
  
  // Приоритет: user.phone → appSettings.sellerPhone → appSettings.companyPhone → заглушка
  return user?.phone || 
         appSettings?.sellerPhone || 
         appSettings?.companyPhone || 
         "+7 (___) ___-__-__";
};

// Распределение УБЫТКА пула по принципу аль-гунм биль-гурм (الغنم بالغرم).
// В отличие от getAccountShares, здесь учитывается только КАПИТАЛ (без profitPercentage),
// т.к. по нормам мудараба/мушарака убыток несут вкладчики пропорционально капиталу.
// Менеджер (мудариб) несёт убыток трудом/временем — финансово не входит в расчёт.
export const getCapitalShares = (
  account: Account | undefined,
  investors: Investor[],
  asOfDate?: string | number | Date
): { investor: Investor; percentage: number }[] => {
  if (!account || account.type !== 'POOL') {
    if (account?.ownerId) {
      const inv = investors.find(i => i.id === account.ownerId);
      return inv ? [{ investor: inv, percentage: 100 }] : [];
    }
    return [];
  }
  const cutoff = asOfDate ? new Date(asOfDate).getTime() : Date.now();
  const members = (account.poolMemberIds || [])
    .map(id => investors.find(i => i.id === id))
    .filter((i): i is Investor => !!i && isPoolMemberActiveAt(i, cutoff));
  const totalCapital = members.reduce((sum, inv) => sum + getInvestorAmountAt(inv, cutoff), 0);
  if (totalCapital <= 0) return [];
  return members.map(investor => ({
    investor,
    percentage: getInvestorAmountAt(investor, cutoff) / totalCapital * 100,
  }));
};

/**
 * Сколько из расхода уменьшает прибыль МЕНЕДЖЕРА.
 *
 * Два случая:
 * 1) «Моя выплата» с пометкой «Из Прибыли» — менеджер забирает свою прибыль целиком,
 *    инвесторов это не касается. Раньше поле managerPayoutSource сохранялось в базу,
 *    но не участвовало ни в одном расчёте: переключатель был просто подписью.
 * 2) Общий расход с флагом fromProfit — делится между менеджером и инвесторами
 *    по долям счёта на дату расхода, симметрично начислению прибыли.
 *    Если инвесторов на счёте нет, доля менеджера 100% и расход уходит целиком ему.
 */
export const getManagerProfitDeduction = (
  expense: Expense,
  account: Account | undefined,
  investors: Investor[]
): number => {
  if (expense.category === 'Моя выплата' && expense.managerPayoutSource === 'PROFIT') {
    return expense.amount;
  }
  if (expense.fromProfit) {
    // Расход менеджера (зарплата сотрудника и т.п.) целиком ложится на его долю:
    // сотрудник нанят менеджером, и доли инвесторов от найма меняться не должны.
    // Расход общего дела делится по долям — но только если так договорились заранее.
    if (expense.profitSource === 'MANAGER') return expense.amount;
    return expense.amount * getManagerSharePercent(account, investors, expense.date) / 100;
  }
  return 0;
};

/**
 * Сколько из расхода уменьшает прибыль КОНКРЕТНОГО инвестора.
 *
 * Здесь учитываются только общие расходы с флагом fromProfit. Адресные выплаты
 * инвестору (payoutType === 'PROFIT') считаются отдельно там, где ведётся его баланс,
 * и складывать их сюда значило бы вычесть одну и ту же сумму дважды.
 */
export const getInvestorProfitDeduction = (
  expense: Expense,
  account: Account | undefined,
  investors: Investor[],
  investorId: string
): number => {
  if (!expense.fromProfit) return 0;
  // Расход менеджера инвесторов не касается вовсе.
  if (expense.profitSource === 'MANAGER') return 0;
  const share = getAccountShares(account, investors, expense.date)
    .find(m => m.investor.id === investorId);
  return share ? expense.amount * share.percentage / 100 : 0;
};

/**
 * Начисленная сотруднику доля прибыли за период.
 *
 * Считается от ДОЛИ МЕНЕДЖЕРА в каждом поступившем платеже, а не от валовой прибыли:
 * сотрудник нанят менеджером, и его премия не должна уменьшать долю инвесторов.
 *
 * Начисление идёт по фактическим платежам, а не от суммы договора при оформлении —
 * иначе премия появлялась бы за деньги, которые ещё не пришли, и её пришлось бы
 * отбирать назад при просрочке или расторжении.
 *
 * База зависит от настройки сотрудника (profitBase):
 *  CONTRACTS — платежи по договорам, которые он оформил
 *  PAYMENTS  — платежи, которые он лично провёл
 *  ALL       — все платежи менеджера
 */
export const getEmployeeProfitAccrued = (
  employee: { id: string; profitPercentage?: number; profitBase?: 'CONTRACTS' | 'PAYMENTS' | 'ALL'; profitSource?: 'MANAGER' | 'SHARED'; profitSince?: string },
  sales: Sale[],
  accounts: Account[],
  investors: Investor[],
  range?: { start?: string | number | Date; end?: string | number | Date }
): number => {
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

    const profitMargin = (sale.totalAmount - sale.buyPrice) / sale.totalAmount;
    const account = accounts.find(a => a.id === sale.accountId);

    const payments = [
      { date: sale.startDate, amount: sale.downPayment || 0, recordedByUserId: sale.createdByUserId },
      ...(sale.paymentPlan || []).filter(p => p.isPaid && p.isRealPayment !== false),
    ];

    for (const p of payments) {
      if (!p.amount || p.amount <= 0) continue;
      const t = new Date(p.date).getTime();
      if (t < from || t > to) continue;
      if (base === 'PAYMENTS' && (p as any).recordedByUserId !== employee.id) continue;

      const profitFromPayment = p.amount * profitMargin;
      // По умолчанию премия берётся из доли МЕНЕДЖЕРА (на дату оформления договора).
      // Вариант SHARED — расход общего дела: считается от всей прибыли до распределения
      // и ложится на всех участников. Нужен, когда доля менеджера равна нулю
      // и премию платить попросту не из чего.
      const bonusBase = employee.profitSource === 'SHARED'
        ? profitFromPayment
        : profitFromPayment * getManagerSharePercent(account, investors, shareDateForSale(sale)) / 100;
      accrued += bonusBase * percent / 100;
    }
  }
  return accrued;
};

/** Сколько сотруднику уже выплачено зарплатой за период. */
export const getEmployeeSalaryPaid = (
  employeeId: string,
  expenses: Expense[],
  range?: { start?: string | number | Date; end?: string | number | Date }
): number => {
  const from = range?.start ? new Date(range.start).getTime() : -Infinity;
  const to = range?.end ? new Date(range.end).setHours(23, 59, 59, 999) : Infinity;
  return expenses
    .filter(e => e.category === 'Salary' && (e as any).employeeId === employeeId)
    .filter(e => { const t = new Date(e.date).getTime(); return t >= from && t <= to; })
    .reduce((sum, e) => sum + (e.amount || 0), 0);
};

/**
 * Сколько прибыли по счёту заработано и сколько из неё уже забрали.
 *
 * Начисление считается так же, как в карточке инвестора и в отчётах: доля прибыли
 * в каждом полученном платеже (платёж × маржа договора). Системные записи и «продажи»,
 * где клиентом выступает инвестор, исключаются — это внутренние движения денег.
 *
 * Забранным считается всё, что уменьшает прибыль: выплаты прибыли инвестору,
 * выплаты менеджеру с пометкой «Из Прибыли» и общие расходы с флагом fromProfit.
 * Остаток нужен, чтобы предупредить, когда из прибыли пытаются списать больше,
 * чем её вообще заработано.
 */
export const getAccountProfitBalance = (
  accountId: string,
  sales: Sale[],
  expenses: Expense[],
  investors: Investor[]
): { earned: number; withdrawn: number; available: number } => {
  const investorIds = new Set(investors.map(i => i.id));

  let earned = 0;
  sales.forEach(sale => {
    if (sale.accountId !== accountId) return;
    if (String(sale.customerId || '').startsWith('system_')) return;
    if (investorIds.has(sale.customerId)) return;
    if (!sale.buyPrice || sale.buyPrice <= 0 || sale.totalAmount <= sale.buyPrice) return;

    const profitMargin = (sale.totalAmount - sale.buyPrice) / sale.totalAmount;
    const collected = (sale.downPayment || 0) + (sale.paymentPlan || [])
      .filter(p => p.isPaid && p.isRealPayment !== false)
      .reduce((sum, p) => sum + (p.amount || 0), 0);
    earned += collected * profitMargin;
  });

  const withdrawn = expenses
    .filter(e => e.accountId === accountId)
    .filter(e =>
      e.fromProfit === true ||
      e.payoutType === 'PROFIT' ||
      (e.category === 'Моя выплата' && e.managerPayoutSource === 'PROFIT')
    )
    .reduce((sum, e) => sum + (e.amount || 0), 0);

  return { earned, withdrawn, available: earned - withdrawn };
};

/**
 * Приводит телефон к виду, который понимает ссылка https://wa.me/<номер> — только цифры,
 * с кодом страны и без плюса. Возвращает null, если из строки вообще нечего собрать.
 *
 * Раньше эта логика была написана в проекте четыре раза по-своему, и две копии были
 * сломаны на самых частых российских форматах:
 *
 * 1) В CustomerDetails вызывался parsePhoneNumberFromString(phone) БЕЗ страны по умолчанию.
 *    Без неё libphonenumber понимает только международную запись (с «+»), поэтому номера
 *    вида 89001234567 и 9001234567 давали null — и он молча подставлялся в адрес,
 *    из-за чего WhatsApp открывался с ошибкой «Имя пользователя null не зарегистрировано».
 *    На боевой базе так записана почти половина клиентов.
 * 2) В Contracts номер склеивался как phone.startsWith('7') ? phone : '7' + phone,
 *    и 89001234567 превращался в 789001234567 — лишняя восьмёрка внутри номера.
 *
 * Поэтому здесь: сначала честный разбор с подсказкой страны, а если номер записан
 * с опечаткой или в формате, которого нет в справочнике, — запасной путь по цифрам.
 * Открыть WhatsApp с очищенным номером всё равно полезнее, чем отправить туда «null».
 */
export const normalizePhoneForWhatsApp = (
  phone?: string | null,
  defaultCountry: CountryCode = 'RU'
): string | null => {
  const raw = (phone || '').trim();
  if (!raw) return null;

  // Номер уже в международной записи разбираем как есть; локальный — с подсказкой страны.
  const parsed = parsePhoneNumberFromString(raw, raw.startsWith('+') ? undefined : defaultCountry);
  if (parsed?.isValid()) return parsed.number.replace('+', '');

  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) return '7' + digits.slice(1);
  if (digits.length === 10) return defaultCountry === 'RU' ? '7' + digits : digits;
  if (digits.length >= 10) return digits;
  return null;
};
// 🔒 Безопасное прибавление месяцев к дате. Обычный `date.setMonth(date.getMonth()+n)` при дне
// месяца 29-31 "переливается" в следующий месяц, если в целевом месяце столько дней нет —
// например, 30 февраля не существует, и JS превращает его в 2 марта. При построении графика
// платежей это приводило к тому, что февральский платёж не создавался вовсе (его месяц
// "занимал" мартовский), а весь дальнейший ряд сдвигался на месяц.
// Здесь день месяца всегда КЛАМПится до последнего реального дня целевого месяца.
export const addMonthsClamped = (date: Date, months: number): Date => {
  const targetFirst = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const daysInTargetMonth = new Date(targetFirst.getFullYear(), targetFirst.getMonth() + 1, 0).getDate();
  targetFirst.setDate(Math.min(date.getDate(), daysInTargetMonth));
  return targetFirst;
};


// ─── Остатки по складам ────────────────────────────────────────────────────
// Product.stock — сумма по всем складам, warehouseStocks — разбивка. Итог держим
// рядом намеренно: на него опираются витрина кассы, отчёты и пометка «мало на
// складе», и пересчитывать их все по разбивке было бы куда рискованнее.

/** Остаток товара на конкретном складе. */
export const stockAtWarehouse = (p: Product, warehouseId: string): number => {
  if (p.warehouseStocks) return p.warehouseStocks[warehouseId] || 0;
  // Товары, заведённые до появления складов, целиком лежат на основном.
  return warehouseId === DEFAULT_WAREHOUSE_ID ? (p.stock || 0) : 0;
};

/** Применяет изменение к складу и пересчитывает общий остаток как сумму. */
export const applyStockDelta = (p: Product, warehouseId: string, delta: number): Product => {
  const stocks = { ...(p.warehouseStocks || (p.stock ? { [DEFAULT_WAREHOUSE_ID]: p.stock } : {})) };
  stocks[warehouseId] = (stocks[warehouseId] || 0) + delta;
  return {
    ...p,
    warehouseStocks: stocks,
    stock: Object.values(stocks).reduce((sum, v) => sum + v, 0),
    updatedAt: new Date().toISOString(),
  };
};
