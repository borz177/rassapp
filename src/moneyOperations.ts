import type { Account, Customer, Expense, Investor, RetailSale, Sale } from '../types';
import { manualIncomeKind } from './incomeCancel';

/**
 * Лента движения денег: поступления (продажи, первые взносы, платежи по
 * графику, розничные чеки и оплаты долга по ним) и расходы — со скользящим
 * балансом счёта после каждой операции.
 *
 * Вынесена из «Истории операций», чтобы общая лента (деньги + товар, см.
 * components/History.tsx) показывала ровно те же строки с теми же балансами.
 * Возвращает все операции без фильтров, от новых к старым.
 */
export interface MoneyOperation {
  id: string;
  date: string;
  amount: number;
  title: string;
  description: string;
  accountId: string;
  type: 'INCOME' | 'EXPENSE';
  category: string;
  raw: any;
  isRetail?: boolean;
  manualIncome?: any;
  discountAmount?: number;
  discountPercent?: number;
  note?: string;
  /** Комментарий к расходу (Expense.description) */
  comment?: string;
  balanceBefore?: number;
  balanceAfter?: number;
}

export const buildMoneyOperations = ({ sales, expenses, accounts, customers, investors = [], retailSales = [] }: {
  sales: Sale[];
  expenses: Expense[];
  accounts: Account[];
  customers: Customer[];
  investors?: Investor[];
  retailSales?: RetailSale[];
}): MoneyOperation[] => {
  const getCustomerName = (id: string) => customers.find(c => c.id === id)?.name || 'Системная операция';
  const incomeOps: any[] = [];

  // 🛒 Розничные чеки. Показываем их наравне с остальными поступлениями: для
  // кассы это такие же деньги на счёте, и прятать их в отдельный список
  // значило бы, что история операций перестала отражать движение денег.
  // В описании — состав чека, иначе строка «Продажа 3 400 ₽» ничего не говорит.
  retailSales.forEach(rs => {
    if (rs.isCancelled) return;
    const names = rs.items.map(i => `${i.name} ×${Math.abs(i.quantity)}`).join(', ');
    const who = rs.customerId ? getCustomerName(rs.customerId) : 'Розничный покупатель';

    // Возврат: деньги ушли покупателю. По чеку в долг часть суммы только
    // списала долг — в ленту денег идёт лишь реально отданное (refund).
    if (rs.returnOf) {
      const refund = Math.max(0, Number(rs.refund ?? -rs.total) || 0);
      if (refund > 0) {
        const original = retailSales.find(x => x.id === rs.returnOf);
        incomeOps.push({
          id: rs.id,
          date: rs.date,
          amount: refund,
          title: who,
          description: `Возврат${original?.docNumber ? ` по чеку №${original.docNumber}` : ''}${names ? ` · ${names}` : ''}`,
          accountId: rs.accountId,
          type: 'EXPENSE',
          category: 'Магазин',
          raw: rs,
          isRetail: true,
        });
      }
      return;
    }

    // Чек в долг денег не приносит — ему здесь не место: история операций
    // отражает движение денег, а не отгрузку товара. Вместо него в ленту
    // попадают полученные по нему платежи — каждый в свою дату.
    if (!rs.isCredit) {
      incomeOps.push({
        id: rs.id,
        date: rs.date,
        amount: rs.total,
        title: who,
        description: names || 'Розничная продажа',
        accountId: rs.accountId,
        type: 'INCOME',
        category: 'Магазин',
        raw: rs,
        isRetail: true,
      });
    }

    (rs.payments || []).forEach(pm => {
      incomeOps.push({
        id: pm.id,
        date: pm.date,
        amount: pm.amount,
        title: who,
        description: `Оплата долга${rs.docNumber ? ` по чеку №${rs.docNumber}` : ''}${names ? ` · ${names}` : ''}`,
        accountId: pm.accountId,
        type: 'INCOME',
        category: 'Магазин',
        raw: rs,
        isRetail: true,
      });
    });
  });

  // Process all sales to generate cash-flow based income operations
  sales.forEach(s => {
      const customerName = getCustomerName(s.customerId);

      if (s.type === 'CASH') {
          const manualIncome = manualIncomeKind(s, investors);
          const depositor = manualIncome === 'INVESTOR_DEPOSIT' ? investors.find(i => i.id === s.customerId) : undefined;
          incomeOps.push({
              id: s.id,
              date: s.startDate,
              amount: s.downPayment,
              // Пополнение от инвестора подписываем его именем: в клиентах его нет,
              // и раньше строка называлась «Системная операция»
              title: depositor?.name || customerName,
              manualIncome,
              description: s.productName,
              accountId: s.accountId,
              type: 'INCOME',
              category: s.category || 'Продажа',
              raw: s
          });
      } else { // INSTALLMENT
          // 1. Down payment
          if (s.downPayment > 0) {
              incomeOps.push({
                  id: `${s.id}_dp`,
                  date: s.startDate,
                  amount: s.downPayment,
                  title: customerName,
                  description: `Первый взнос: ${s.productName}`,
                  accountId: s.accountId,
                  type: 'INCOME',
                  category: 'Платеж',
                  raw: s
              });
          }
          // 2. Paid installments
          s.paymentPlan.forEach(p => {
              if (p.isPaid && p.isRealPayment !== false) {
                  // 🆕 Приводим к any, чтобы TS не ругался на новые поля скидки
                  const paymentAny = p as any; 
                  incomeOps.push({
                      id: p.id,
                      date: p.date,
                      amount: p.amount,
                      title: customerName,
                      description: `Платеж: ${s.productName}`,
                      accountId: s.accountId,
                      type: 'INCOME',
                      category: 'Платеж',
                      raw: s,
                      // 🆕 Передаем данные о скидке из платежа
                      discountAmount: paymentAny.discountAmount || 0,
                      discountPercent: paymentAny.discountPercent || 0,
                      note: paymentAny.note || ''
                  });
              }
          });
      }
  });

  const expenseOps = expenses.filter(e => e.isRefund !== true).map(e => ({
      id: e.id,
      date: e.date,
      amount: e.amount,
      title: e.title,
      description: e.category,
      accountId: e.accountId,
      type: 'EXPENSE',
      category: e.category,
      comment: e.description?.trim() || undefined,
      raw: e
  }));

  const all: MoneyOperation[] = [...incomeOps, ...expenseOps] as MoneyOperation[];

  // 🔹 ШАГ 1: Рассчитываем скользящий баланс для каждого счёта
  const sortedForCalc = [...all].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const accountBalances: Record<string, number> = {};

  accounts.forEach(acc => {
      accountBalances[acc.id] = acc.initialBalance || 0;
  });

  sortedForCalc.forEach(op => {
      const currentBalance = accountBalances[op.accountId] || 0;
      const newBalance = op.type === 'INCOME'
          ? currentBalance + op.amount
          : currentBalance - op.amount;

      op.balanceAfter = newBalance;
      op.balanceBefore = currentBalance;
      accountBalances[op.accountId] = newBalance;
  });

  return all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};
