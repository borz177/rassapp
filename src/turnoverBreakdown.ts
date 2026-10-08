import type { Account, Expense, Investor, Sale } from '../types';
import {
  expectedProfitShares, getActivePeriodAt, getInvestorProfitDeduction, getManagerProfitDeduction,
  moneyInProfit, paymentProfitShares, saleProfitMargin,
} from './utils';

/**
 * Из чего состоит «В обороте» (деньги на счёте + долг клиентов).
 *
 * Два разреза одной суммы:
 *   • где деньги — на счёте и в долге клиентов, а долг — это возврат закупа и наценка;
 *   • чьи деньги — вложения инвесторов, прибыль менеджера и инвесторов (полученная,
 *     ещё не выведенная, и ожидаемая с остатка долга), и остаток.
 *
 * Правила прибыли и выплат — те же, что в кассе (CashRegister.tsx «Моя прибыль» и
 * разбивка по инвесторам): иначе разбивка не сходилась бы с цифрами на экране кассы.
 * Остаток — всё, что не прибыль и не вложения инвесторов: свои вложения владельца и
 * расходы, не списанные ни с чьей прибыли (налоги, закят без «из прибыли» и т.п.).
 * Он может быть и отрицательным — тогда это расходы сверх вложенного.
 */
export interface TurnoverBreakdown {
  total: number;
  cash: number;
  receivable: number;
  receivableCost: number;
  receivableProfit: number;
  investorCapital: number;
  manager: { toWithdraw: number; expected: number };
  investors: { toPay: number; expected: number };
  rest: number;
}

const isRealCustomerSale = (sale: Sale, investorIds: Set<string>) =>
  !String(sale.customerId).startsWith('system_') && !investorIds.has(sale.customerId);

export const turnoverBreakdown = (args: {
  accounts: Account[];
  accountIds: string[];
  accountBalances: Record<string, number>;
  sales: Sale[];
  expenses: Expense[];
  investors: Investor[];
  profitFromPaymentsOnly?: boolean;
  now?: number;
}): TurnoverBreakdown => {
  const { accounts, accountIds, accountBalances, sales, expenses, investors, profitFromPaymentsOnly = false } = args;
  const now = args.now ?? Date.now();
  const ids = new Set(accountIds);
  const investorIds = new Set(investors.map(i => i.id));
  const accountOf = (id: string) => accounts.find(a => a.id === id);
  // Владелец, отметивший себя инвестором («Это я»), — это вы: его прибыль и выплаты
  // идут в вашу часть, а не в часть инвесторов
  const ownerIds = new Set(investors.filter(i => i.isOwner).map(i => i.id));
  const outsidePct = (shares: { investor: Investor; percentage: number }[]) =>
    shares.filter(x => !ownerIds.has(x.investor.id)).reduce((s, x) => s + x.percentage, 0);

  const cash = accountIds.reduce((sum, id) => sum + (accountBalances[id] || 0), 0);

  let receivable = 0, receivableProfit = 0;
  let mgrEarned = 0, mgrExpected = 0, invEarned = 0, invExpected = 0;

  for (const sale of sales) {
    if (!ids.has(sale.accountId) || !isRealCustomerSale(sale, investorIds)) continue;
    const remaining = Math.max(0, Number(sale.remainingAmount) || 0);
    receivable += remaining;

    const buy = Number(sale.buyPrice) || 0;
    if (buy <= 0 || Number(sale.totalAmount) <= buy) continue;
    const account = accountOf(sale.accountId);
    if (!account || account.type === 'SHARED') continue;
    const margin = saleProfitMargin(sale, profitFromPaymentsOnly);

    // Ожидаемая прибыль — с остатка долга, как «Ожидается» в кассе
    if (sale.status === 'ACTIVE' || sale.status === 'DRAFT') {
      const expected = remaining * margin;
      receivableProfit += expected;
      const invPct = outsidePct(expectedProfitShares(account, investors, sale));
      invExpected += expected * invPct / 100;
      mgrExpected += expected * (100 - invPct) / 100;
    }

    // Полученная прибыль — по каждому поступлению, доли на его дату
    const money = [
      { id: `${sale.id}_dp`, date: sale.startDate, amount: Number(sale.downPayment) || 0 },
      ...(sale.paymentPlan || []).filter(p => p.isPaid && p.isRealPayment !== false)
        .map(p => ({ id: p.id, date: p.date, amount: Number(p.amount) || 0 })),
    ];
    for (const m of money) {
      if (m.amount <= 0) continue;
      const profit = moneyInProfit(sale, m, profitFromPaymentsOnly);
      const invPct = outsidePct(paymentProfitShares(account, investors, sale, m));
      invEarned += profit * invPct / 100;
      mgrEarned += profit * (100 - invPct) / 100;
    }
  }

  // Выплаты и расходы «из прибыли» — как в кассе
  let mgrOut = 0, invOut = 0;
  for (const e of expenses) {
    if (!ids.has(e.accountId)) continue;
    const account = accountOf(e.accountId);
    if (e.category === 'Моя выплата') {
      if (e.managerPayoutSource !== 'CAPITAL') mgrOut += Number(e.amount) || 0;
    } else if (e.fromProfit) {
      mgrOut += getManagerProfitDeduction(e, account, investors);
    }
    if (e.investorId && e.payoutType === 'PROFIT') {
      if (ownerIds.has(e.investorId)) mgrOut += Number(e.amount) || 0;
      else invOut += Number(e.amount) || 0;
    }
    if (e.fromProfit && e.profitSource !== 'MANAGER') {
      for (const inv of investors) {
        const part = getInvestorProfitDeduction(e, account, investors, inv.id);
        if (ownerIds.has(inv.id)) mgrOut += part; else invOut += part;
      }
    }
  }

  // Вложения инвесторов в эти счета — текущие суммы (после довложений и возвратов)
  const capitalOf = (inv: Investor | undefined) => (inv ? getActivePeriodAt(inv, now)?.initialAmount || 0 : 0);
  let investorCapital = 0;
  for (const id of accountIds) {
    const acc = accountOf(id);
    if (!acc) continue;
    if (acc.type === 'POOL') {
      // Владелец («Это я») — не внешний инвестор: его вложения считаем своими (в остатке)
      (acc.poolMemberIds || []).forEach(mid => {
        const inv = investors.find(i => i.id === mid);
        if (inv && !inv.isOwner) investorCapital += capitalOf(inv);
      });
    } else if (acc.ownerId) {
      const inv = investors.find(i => i.id === acc.ownerId);
      if (inv && !inv.isOwner) investorCapital += capitalOf(inv);
    }
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  const total = cash + receivable;
  const manager = { toWithdraw: round(mgrEarned - mgrOut), expected: round(mgrExpected) };
  const investorsPart = { toPay: round(invEarned - invOut), expected: round(invExpected) };
  const rest = total - investorCapital - manager.toWithdraw - manager.expected - investorsPart.toPay - investorsPart.expected;

  return {
    total: round(total),
    cash: round(cash),
    receivable: round(receivable),
    receivableCost: round(receivable - receivableProfit),
    receivableProfit: round(receivableProfit),
    investorCapital: round(investorCapital),
    manager,
    investors: investorsPart,
    rest: round(rest),
  };
};
