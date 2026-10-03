import type { Payment, Sale } from '../types';
import type { ContractScheduleRow } from './contractTemplates';

/**
 * График платежей для печатного договора и для чека оплаты в WhatsApp.
 *
 * Один расчёт на все три места (печать из списка договоров, печать при
 * оформлении, PDF при приёме платежа). Когда расчётов было три, два из них
 * разошлись: оплаты и непокрытые месяцы сортировались вместе по дате, и
 * просроченный месяц вставал пустой строкой МЕЖДУ двумя оплатами —
 * в документе это читалось как пропущенные поля.
 *
 * Правила:
 * — сначала все фактические поступления по дате, каждое своей строкой;
 * — потом месяцы графика, которые деньги ещё не покрыли, — только дата;
 * — излишек полученных денег над уже отмеченными месяцами гасит ближайшие;
 * — «Остаток» накопительный и уменьшается только на поступлениях.
 *
 * Классификация та же, что на экране договора (CustomerDetails.tsx):
 * поступление — isPaid && isRealPayment !== false (у старых записей поля нет),
 * плановый долг — !isPaid && isRealPayment !== true.
 *
 * `payingNow` — платёж, который принимают прямо сейчас: PDF собирается до
 * сохранения, и без него клиент получил бы чек без только что внесённых денег.
 */
export const contractScheduleRows = (
  sale: Pick<Sale, 'paymentPlan' | 'totalAmount' | 'downPayment'>,
  payingNow?: { date: string; amount: number },
): ContractScheduleRow[] => {
  const plan: Payment[] = sale.paymentPlan || [];
  const byDate = (a: { date: string }, b: { date: string }) =>
    new Date(a.date).getTime() - new Date(b.date).getTime();

  const receipts = [
    ...plan.filter(p => !!p.isPaid && p.isRealPayment !== false).map(p => ({ date: p.date, amount: Number(p.amount) || 0 })),
    ...(payingNow && payingNow.amount > 0 ? [payingNow] : []),
  ].sort(byDate);

  const totalReceived = receipts.reduce((sum, p) => sum + p.amount, 0);
  const totalAllocated = plan
    .filter(p => p.isPaid && p.isRealPayment !== true)
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  let surplus = Math.max(0, totalReceived - totalAllocated);

  const pending = plan
    .filter(p => !p.isPaid && p.isRealPayment !== true)
    .sort(byDate)
    .map(p => {
      const covered = Math.min(p.amount, surplus);
      surplus = Math.max(0, surplus - covered);
      return { date: p.date, due: Math.round((p.amount - covered) * 100) / 100 };
    })
    // Копеечный остаток — артефакт округления долей платежа, а не долг
    .filter(p => p.due >= 1);

  let debt = sale.totalAmount - sale.downPayment;
  return [
    ...receipts.map(p => ({ date: p.date, paid: p.amount })),
    ...pending.map(p => ({ date: p.date, paid: 0 })),
  ].map(p => {
    if (p.paid > 0) debt -= p.paid;
    return { date: p.date, paid: p.paid, remaining: Math.max(0, debt) };
  });
};
