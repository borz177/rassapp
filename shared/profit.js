/**
 * Расчёт долей прибыли и премии сотрудника.
 *
 * Модуль общий для браузера и сервера — как shared/excelReport.js.
 * Понадобился из-за сотрудников: их данные сервер фильтрует по доступным счетам,
 * и в браузере у сотрудника просто нет полной картины. Например, в общем пуле
 * он видит только «своего» инвестора, из-за чего капитал-доля считается как 100%
 * вместо реальных 60%, и премия выходит неверной. Поэтому премию сотруднику
 * считает сервер по полным данным — этими же функциями, что и интерфейс менеджера.
 *
 * Здесь только чистая арифметика, без зависимостей: файл одинаково работает
 * и в сборке Vite, и в Node.
 */

// Нормализует дату к UTC-полуночи того же календарного дня: joinedDate хранится
// с реальным временем создания, а cutoff всегда полночь — без этого инвестор,
// вошедший в 10:48, «не участвует» в событиях того же дня.
const dayMs = (d) => {
  const dt = new Date(d);
  return Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
};

const isPoolMemberActiveAt = (investor, cutoff) => {
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

const getInvestorAmountAt = (investor, cutoff) => {
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

/**
 * Доли прибыли по счёту на дату asOfDate.
 * Обычный счёт (ownerId) — фиксированный процент инвестора.
 * Пул — доля = (его капитал / общий капитал) × его собственный процент.
 */
export const getAccountShares = (account, investors, asOfDate) => {
  if (!account) return [];
  if (account.type === 'POOL') {
    const cutoff = asOfDate ? new Date(asOfDate).getTime() : Date.now();
    const members = (account.poolMemberIds || [])
      .map(id => investors.find(i => i.id === id))
      .filter(i => !!i && isPoolMemberActiveAt(i, cutoff));
    const totalCapital = members.reduce((sum, inv) => sum + getInvestorAmountAt(inv, cutoff), 0);
    if (totalCapital <= 0) {
      return members.map(investor => ({ investor, percentage: investor.profitPercentage || 0 }));
    }
    return members.map(investor => {
      const capitalShare = getInvestorAmountAt(investor, cutoff) / totalCapital;
      return { investor, percentage: capitalShare * (investor.profitPercentage || 0) };
    });
  }
  if (account.ownerId) {
    const investor = investors.find(i => i.id === account.ownerId);
    return investor ? [{ investor, percentage: investor.profitPercentage || 0 }] : [];
  }
  return [];
};

/** Остаток после долей инвесторов — достаётся менеджеру. */
export const getManagerSharePercent = (account, investors, asOfDate) => {
  const total = getAccountShares(account, investors, asOfDate).reduce((s, m) => s + m.percentage, 0);
  return Math.max(0, 100 - total);
};

/**
 * Доли по договору берутся на дату его ОФОРМЛЕНИЯ: прибыль по рассрочке
 * фиксируется при заключении сделки и принадлежит тем, чей капитал её профинансировал.
 */
export const shareDateForSale = (sale) => sale.startDate;

/**
 * Начисленная сотруднику премия за период.
 * profitBase: CONTRACTS — договоры, которые он оформил; PAYMENTS — платежи,
 * которые он принял; ALL — всё. profitSource: MANAGER — из доли менеджера,
 * SHARED — из всей прибыли (расход общего дела).
 * profitSince — платежи раньше этой даты не учитываются.
 */
export const getEmployeeProfitAccrued = (employee, sales, accounts, investors, range) => {
  const percent = Number(employee.profitPercentage) || 0;
  if (percent <= 0) return 0;
  const base = employee.profitBase || 'CONTRACTS';

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
      if (base === 'PAYMENTS' && p.recordedByUserId !== employee.id) continue;

      const profitFromPayment = p.amount * profitMargin;
      const bonusBase = employee.profitSource === 'SHARED'
        ? profitFromPayment
        : profitFromPayment * getManagerSharePercent(account, investors, shareDateForSale(sale)) / 100;
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
