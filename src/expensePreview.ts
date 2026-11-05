import type { Account, Expense, Investor, RetailSale, Sale } from '../types';
import { accountInvestment, applyCapitalChange, computeAccountBalances, getActivePeriodAt, realAccountType } from './utils';
import { turnoverBreakdown } from './turnoverBreakdown';

export type ExpenseChoice = 'MANAGER' | 'SHARED';
export interface ExpensePreviewRow { key: string; label: string; before: number; after: number }
export interface ExpensePreview {
  rows: ExpensePreviewRow[];
  shares: ExpensePreviewRow[];
  warnings: string[];
  errors: string[];
  signature: string;
}
const round = (n: number) => Math.round(n * 100) / 100;
export const canReturnOwnCapital = (account?: Account) => !!account && ['MAIN','CUSTOM'].includes(realAccountType(account));
export const expenseChoiceKey = (userId: string | undefined, accountId: string, category: string) =>
  userId && accountId ? `finuchet_expense_choice_v1:${JSON.stringify([userId,accountId,category])}` : null;

/** Прогноз использует те же записи и расчёты, что касса и сохранение в App.
 * Нет самостоятельной формулы долей или перераспределения убытка в капитал. */
export function expensePreview({ expense, accounts, sales, expenses, investors, retailSales = [], profitFromPaymentsOnly = false, now = Date.now() }: {
  expense: Expense; accounts: Account[]; sales: Sale[]; expenses: Expense[]; investors: Investor[];
  retailSales?: RetailSale[]; profitFromPaymentsOnly?: boolean; now?: number;
}): ExpensePreview {
  const rows: ExpensePreviewRow[] = [], warnings: string[] = [], errors: string[] = [];
  const account = accounts.find(a=>a.id===expense.accountId);
  const amount = Number(expense.amount);
  if (!account) errors.push('Выберите счёт.');
  if (!Number.isFinite(amount) || amount <= 0) errors.push('Введите сумму больше нуля.');
  if (!Number.isFinite(Date.parse(expense.date))) errors.push('Проверьте дату.');
  if (errors.length) return {rows,shares:[],warnings,errors,signature:JSON.stringify(errors)};
  if (expense.fromProfit && expense.profitSource!=='MANAGER' && realAccountType(account)==='SHARED') errors.push('Сначала настройте доли этого счёта.');
  const investor = investors.find(i=>i.id===expense.investorId);
  let afterInvestors = investors;
  if (expense.payoutType === 'INVESTMENT') {
    const at = Date.parse(expense.date);
    if (!investor) errors.push('Выберите инвестора.');
    else {
      const belongs = account!.ownerId === investor.id || account!.poolMemberIds?.includes(investor.id) || account!.partners?.includes(investor.id);
      if (!belongs) errors.push('Инвестор не связан с этим счётом.');
      const active = getActivePeriodAt(investor,at);
      if (!active) errors.push('На эту дату у инвестора нет действующего вклада.');
      if (amount > (Number(active?.initialAmount) || 0) + 0.005 || amount > (Number(investor.initialAmount) || 0) + 0.005) errors.push('Сумма больше вложенного капитала.');
      afterInvestors = investors.map(i=>i.id===investor.id ? applyCapitalChange(i,-amount,expense.date,expense.id) : i);
    }
  }
  if (expense.category === 'Моя выплата' && expense.managerPayoutSource === 'CAPITAL') {
    if (!canReturnOwnCapital(account)) errors.push('С этого счёта нельзя возвращать ваши вложения.');
    else if (amount > accountInvestment(account,sales,expenses).left + 0.005) errors.push('Сумма больше ваших вложений.');
  }
  if (expense.payoutType === 'PROFIT' && !investor) errors.push('Выберите инвестора.');
  if (expense.payoutType === 'PROFIT' && investor && account!.ownerId!==investor.id && !account!.poolMemberIds?.includes(investor.id) && !account!.partners?.includes(investor.id)) errors.push('Инвестор не связан с этим счётом.');
  const afterExpenses = [...expenses,expense];
  const beforeCash = computeAccountBalances(accounts,sales,expenses,retailSales);
  const afterCash = computeAccountBalances(accounts,sales,afterExpenses,retailSales);
  const base = {accounts,accountIds:[expense.accountId],sales,retailSales,profitFromPaymentsOnly,now};
  const before = turnoverBreakdown({...base,accountBalances:beforeCash,expenses,investors});
  const after = turnoverBreakdown({...base,accountBalances:afterCash,expenses:afterExpenses,investors:afterInvestors});
  const row = (key: string,label: string,b: number,a: number) => ({key,label,before:round(b),after:round(a)});
  rows.push(row('cash','На счёте',before.cash,after.cash));
  const manager = row('manager','Ваша прибыль',before.manager.toWithdraw,after.manager.toWithdraw);
  const shares = [manager,...investors.filter(i=>!i.isOwner).map(i=>row(i.id,i.name,
    before.perInvestor.find(p=>p.id===i.id)?.toPay || 0,after.perInvestor.find(p=>p.id===i.id)?.toPay || 0))];
  if (expense.fromProfit && expense.profitSource === 'MANAGER' || expense.category === 'Моя выплата' && expense.managerPayoutSource !== 'CAPITAL') rows.push(manager);
  else if (expense.payoutType === 'PROFIT' && investor) {
    rows.push(investor.isOwner ? manager : shares.find(r=>r.key===investor.id)!);
  } else rows.push(row('profit','Прибыль дела',before.manager.toWithdraw+before.investors.toPay,after.manager.toWithdraw+after.investors.toPay));
  if (expense.payoutType === 'INVESTMENT' && investor) {
    rows.push(row('capital','Вложения инвестора',Number(investor.initialAmount)||0,Number(afterInvestors.find(i=>i.id===investor.id)?.initialAmount)||0));
  } else if (canReturnOwnCapital(account)) {
    rows.push(row('capital','Ваши вложения',accountInvestment(account,sales,expenses).left,accountInvestment(account,sales,afterExpenses).left));
  } else rows.push(row('capital','Вложения инвесторов',before.investorCapital,after.investorCapital));
  if (after.cash < -0.005 && after.cash < before.cash-0.005) warnings.push('На счёте будет минус.');
  if (shares.some(r=>r.after < -0.005 && r.after < r.before-0.005)) warnings.push('Прибыль уйдёт в минус.');
  const changedShares = shares.filter(r=>Math.abs(r.after-r.before)>=0.01);
  return {rows,shares:changedShares,warnings,errors,signature:JSON.stringify({rows,shares:changedShares,warnings,errors})};
}
