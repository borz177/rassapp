import type { Sale } from '../types';
import { calculateSaleOverdue } from './utils';

/**
 * Показатели договора для списка «Договоры»: сортировки, фильтры, сводки и
 * «Поделиться» в просроченных считают их одинаково.
 *
 * Деньги клиента гасят плановые месяцы по порядку — от раннего к позднему, как
 * в reconcileSalePaymentPlan и expectedPaymentsInPeriod (src/utils.ts). Отсюда:
 * какой месяц ещё не закрыт, с какого дня идёт просрочка, каким платежом и
 * когда закрыт каждый месяц (а значит, платил ли клиент с опозданием).
 *
 * Сумма просрочки — ровно calculateSaleOverdue: число в списке не должно
 * расходиться с тем, что показывает карточка договора.
 */
export interface ContractMetrics {
  /** Сумма просрочки, ₽ */
  overdue: number;
  /** Сколько дней просрочен самый ранний незакрытый платёж */
  overdueDays: number;
  /** Сколько плановых платежей уже прошло и не закрыто */
  missed: number;
  remaining: number;
  /** Сколько выплачено, 0–100 */
  paidPercent: number;
  /** Ближайший незакрытый платёж: дата и сколько по нему осталось */
  nextDue: { date: string; amount: number } | null;
  /** Последний реальный платёж (первый взнос не считается) */
  lastPayment: string | null;
  /** Дата последнего планового платежа */
  endDate: string | null;
  /** Хоть один месяц закрыт позже срока */
  hadLate: boolean;
  /** По договору ещё не внесли ни одного платежа */
  noPayments: boolean;
}

const DAY = 86400000;
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

export const contractMetrics = (sale: Sale, now: Date = new Date()): ContractMetrics => {
  const today = startOfDay(now);
  const plan = sale.paymentPlan || [];
  const payments = plan
    .filter(p => p.isPaid && p.isRealPayment !== false)
    .map(p => ({ date: p.date, amount: (Number(p.amount) || 0) + (Number((p as any).discountAmount) || 0) }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const slots = plan
    .filter(p => p.isRealPayment !== true)
    .slice()
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Проходим месяцы по порядку, «расходуя» платежи в порядке поступления
  let pi = 0;
  let poolLeft = 0;        // остаток текущего платежа, ещё не ушедший на месяцы
  let poolDate: string | null = null;
  let firstOpen: { date: string; amount: number } | null = null;
  let firstOverdueDate: Date | null = null;
  let missed = 0;
  let hadLate = false;

  for (const slot of slots) {
    let need = Number(slot.amount) || 0;
    let coveredAt: string | null = null;
    while (need > 0.01) {
      if (poolLeft <= 0.01) {
        if (pi >= payments.length) break;
        poolLeft = payments[pi].amount;
        poolDate = payments[pi].date;
        pi++;
      }
      const take = Math.min(need, poolLeft);
      need -= take;
      poolLeft -= take;
      coveredAt = poolDate;
    }
    const due = startOfDay(new Date(slot.date));
    if (need <= 0.5) {
      // Закрыт. Позже срока больше чем на день — опоздание
      if (coveredAt && startOfDay(new Date(coveredAt)).getTime() - due.getTime() > DAY) hadLate = true;
      continue;
    }
    if (!firstOpen) firstOpen = { date: slot.date, amount: Math.round(need * 100) / 100 };
    if (due < today) {
      missed++;
      if (!firstOverdueDate) firstOverdueDate = due;
      hadLate = true;
    }
  }

  const overdue = calculateSaleOverdue(sale, today);
  const total = Number(sale.totalAmount) || 0;
  const remaining = Math.max(0, Number(sale.remainingAmount) || 0);
  return {
    overdue,
    overdueDays: overdue > 0 && firstOverdueDate ? Math.round((today.getTime() - firstOverdueDate.getTime()) / DAY) : 0,
    missed: overdue > 0 ? Math.max(1, missed) : 0,
    remaining,
    paidPercent: total > 0 ? Math.max(0, Math.min(100, Math.round((total - remaining) / total * 100))) : 0,
    nextDue: remaining > 0 ? firstOpen : null,
    lastPayment: payments.length ? payments[payments.length - 1].date : null,
    endDate: slots.length ? slots[slots.length - 1].date : null,
    hadLate,
    noPayments: payments.length === 0,
  };
};

/** Корзины срока просрочки — как в банковской отчётности */
export type AgingBucket = 'D30' | 'D60' | 'D90' | 'D90PLUS';
export const AGING: { id: AgingBucket; label: string; test: (days: number) => boolean }[] = [
  { id: 'D30', label: 'до 30 дн.', test: d => d <= 30 },
  { id: 'D60', label: '31–60', test: d => d > 30 && d <= 60 },
  { id: 'D90', label: '61–90', test: d => d > 60 && d <= 90 },
  { id: 'D90PLUS', label: 'больше 90', test: d => d > 90 },
];

export const daysWord = (n: number) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? 'день' : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? 'дня' : 'дней';
};
