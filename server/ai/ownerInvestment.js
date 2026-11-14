// Отчёт только по личным деньгам владельца. Это не баланс кассы и не прибыль.
const shared = import('../../shared/accountInvestment.js');
const round = n => Math.round(n * 100) / 100;

const ownerInvestment = async ({ accounts, sales, expenses, accountId = null }) => {
  const { accountInvestment, realAccountType } = await shared;
  const own = a => !['INVESTOR', 'POOL', 'SHARED'].includes(realAccountType(a));
  const selected = accounts.filter(a => !accountId || a.id === accountId);
  if (accountId && !selected.length) return { error: 'Счёт не найден.', status: 404 };
  if (accountId && !own(selected[0])) return { error: 'Это счёт инвестора, пула или партнёров. Он не относится к личным вложениям владельца.', status: 400 };
  const personal = selected.filter(own);
  const ids = new Set(personal.map(a => a.id));
  const rows = personal.map(a => {
    const r = accountInvestment(a, sales, expenses);
    return { accountId: a.id, accountName: a.name || 'Счёт', type: realAccountType(a), ...Object.fromEntries(Object.entries(r).map(([k,v]) => [k,round(v)])), net: round(r.invested - r.returned) };
  });
  const totals = Object.fromEntries(['initial','deposits','invested','returned','left','net'].map(k => [k, round(rows.reduce((n,r) => n + r[k],0))]));
  const uncertain = expenses.filter(e => ids.has(e.accountId) && e.category === 'Моя выплата' && !e.managerPayoutSource && e.isRefund !== true);
  const orphanDeposits = accountId ? [] : sales.filter(s => s.customerId === 'system_income' && !accounts.some(a => a.id === s.accountId));
  return {
    scope: 'owner', period: 'all_time', totals, accounts: rows,
    excludedAccounts: selected.length - personal.length,
    uncertainty: { withdrawalsWithoutSource: { count: uncertain.length, amount: round(uncertain.reduce((n,e) => n + (Number(e.amount)||0),0)) }, depositsWithoutAccount: { count: orphanDeposits.length, amount: round(orphanDeposits.reduce((n,s) => n + (Number(s.downPayment)||0),0)) } },
    basis: 'За всё время: стартовый баланс личных счетов + приход «Прочее» − выплаты себе с источником «Из инвестиций». Прибыль, деньги инвесторов, пулов и партнёров не включены. Старые выплаты без источника не вычитаются: их назначение неизвестно. net — разность, left — сумма оставшихся вложений по счетам без отрицательных значений, как в карточке счёта. Это не доступные наличные.',
  };
};
module.exports = { ownerInvestment };
