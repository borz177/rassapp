import type { Account, Investor } from '../types';

/** Связь проверяем по идентификаторам, включая старые совместные счета. */
export function investorOwnsAccount(account: Account, investorId: string): boolean {
  return !!investorId && (account.ownerId === investorId
    || account.type === 'POOL' && !!account.poolMemberIds?.includes(investorId)
    || account.type === 'SHARED' && !!account.partners?.includes(investorId));
}

export function investorMoneyAccounts(accounts: Account[], investorId: string, contextAccountId?: string): Account[] {
  return accounts.filter(a => (!a.isArchived || a.id === contextAccountId) && investorOwnsAccount(a, investorId));
}

/** Прочий приход не должен заменять пополнение личного вклада. Общие кассы
 * остаются доступны для обычных поступлений, не меняющих капитал участников. */
export function allowsOtherIncome(account: Account): boolean {
  return account.type === 'POOL' || account.type === 'SHARED' || account.type !== 'INVESTOR' && !account.ownerId;
}

export function resolveInvestorMoneyAccount(accounts: Account[], currentId: string): string {
  return accounts.some(a => a.id === currentId) ? currentId : accounts[0]?.id || '';
}

interface MoneyOperation {
  type?: string;
  amount?: number;
  accountId?: string;
  investorId?: string;
  category?: string;
  payoutType?: string | null;
  managerPayoutSource?: string | null;
}

/** Проверка новых операций перед подтверждением и записью в App.
 * История, платежи клиентов и расчёт капитала здесь не изменяются. */
export function moneyOperationIssue(data: MoneyOperation, accounts: Account[], investors: Investor[]): string | null {
  if (data.type === 'CUSTOMER_PAYMENT' || data.type === 'RETAIL_PAYMENT') return null;
  const expense = data.type === 'OTHER_EXPENSE' || data.type === 'INVESTOR_WITHDRAWAL' || !data.type;
  const investorPayout = data.type === 'INVESTOR_WITHDRAWAL' || expense && data.category === 'Выплата инвестора';
  const investorOperation = data.type === 'INVESTOR_DEPOSIT' || investorPayout;
  const ownPayout = expense && data.category === 'Моя выплата';
  const otherIncome = data.type === 'OTHER_INCOME';
  if (!investorOperation && !ownPayout && !otherIncome) return null;
  if (!Number.isFinite(data.amount) || Number(data.amount) <= 0) return 'Введите сумму больше нуля.';
  const account = accounts.find(a => a.id === data.accountId);
  if (!account) return 'Выберите счёт.';
  if (investorOperation) {
    if (!investors.some(i => i.id === data.investorId)) return 'Выберите инвестора.';
    if (!investorOwnsAccount(account, data.investorId!)) return 'Выберите счёт этого инвестора.';
    if (investorPayout && data.payoutType !== 'PROFIT' && data.payoutType !== 'INVESTMENT') {
      return 'Выберите источник: вложения или прибыль.';
    }
  }
  if (ownPayout && data.managerPayoutSource !== 'PROFIT' && data.managerPayoutSource !== 'CAPITAL') {
    return 'Выберите источник выплаты.';
  }
  if (otherIncome && !allowsOtherIncome(account)) return 'Пополнение инвестора оформляется во вкладке «Инвестор».';
  return null;
}
