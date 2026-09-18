import type { Account, Expense, Partnership, Sale, User } from '../types';

/**
 * Перенос всех связей инвестора со старого id на новый.
 *
 * Инвестор без логина живёт под id вида inv_…; когда ему дают логин и пароль,
 * заводится пользователь, и инвестор получает его id. Всё, что было записано на
 * старый id, иначе остаётся у «исчезнувшего» инвестора: вложение пропадает из
 * его карточки, выплаты — из истории, сотрудник теряет к нему доступ.
 *
 * Раньше при активации эту потерю закрывали новым «Начальным депозитом» на ту же
 * сумму — и деньги в кассе удваивались: старый депозит оставался на счёте, а
 * рядом появлялся второй. Здесь ничего не создаётся — только переписываются
 * ссылки, поэтому сумма в кассе не меняется.
 *
 * Возвращает только изменённые записи — их и нужно сохранить.
 */
export interface InvestorRelinkInput {
  sales: Sale[];
  expenses: Expense[];
  accounts: Account[];
  partnerships: Partnership[];
  employees: User[];
}

export interface InvestorRelinkPlan {
  sales: Sale[];
  expenses: Expense[];
  accounts: Account[];
  partnerships: Partnership[];
  employees: User[];
}

const swap = (ids: string[] | undefined, oldId: string, newId: string): string[] | undefined => {
  if (!ids || !ids.includes(oldId)) return undefined;
  // Новый id уже мог оказаться в списке — не дублируем
  return [...new Set(ids.map(id => (id === oldId ? newId : id)))];
};

export const investorRelinkPlan = (
  oldId: string,
  newId: string,
  data: InvestorRelinkInput
): InvestorRelinkPlan => {
  if (!oldId || !newId || oldId === newId) {
    return { sales: [], expenses: [], accounts: [], partnerships: [], employees: [] };
  }
  const oldDeposit = `system_deposit_${oldId}`;
  const newDeposit = `system_deposit_${newId}`;

  // Начальный депозит и пополнения доли записаны на system_deposit_<id>;
  // на совместном счёте партнёров вклад записан прямо на id партнёра.
  const sales = data.sales
    .filter(s => s.customerId === oldDeposit || s.customerId === oldId)
    .map(s => ({ ...s, customerId: s.customerId === oldDeposit ? newDeposit : newId }));

  // Выплаты прибыли, возврат вложений и прочие расходы, адресованные инвестору
  const expenses = data.expenses
    .filter(e => e.investorId === oldId)
    .map(e => ({ ...e, investorId: newId }));

  const accounts = data.accounts.flatMap(a => {
    const ownerChanged = a.ownerId === oldId;
    const pool = swap(a.poolMemberIds, oldId, newId);
    const partners = swap(a.partners, oldId, newId);
    if (!ownerChanged && !pool && !partners) return [];
    return [{
      ...a,
      ...(ownerChanged ? { ownerId: newId } : {}),
      ...(pool ? { poolMemberIds: pool } : {}),
      ...(partners ? { partners } : {}),
    }];
  });

  const partnerships = data.partnerships.flatMap(p => {
    const ids = swap(p.partnerIds, oldId, newId);
    return ids ? [{ ...p, partnerIds: ids }] : [];
  });

  // Сотрудник с доступом к этому инвестору должен сохранить доступ
  const employees = data.employees.flatMap(u => {
    const allowed = swap(u.allowedInvestorIds, oldId, newId);
    const full = swap(u.fullAccessInvestorIds, oldId, newId);
    if (!allowed && !full) return [];
    return [{
      ...u,
      ...(allowed ? { allowedInvestorIds: allowed } : {}),
      ...(full ? { fullAccessInvestorIds: full } : {}),
    }];
  });

  return { sales, expenses, accounts, partnerships, employees };
};
