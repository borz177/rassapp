/**
 * Поступления для показателя «Собрано» и его расшифровок.
 * Настройка скрывает первые взносы по рассрочкам, а не фактические движения
 * денег. Для остатков кассы, долга и прибыли используются полные поступления.
 */
export const isCustomerSale = (sale, investorIds = new Set()) =>
  !String(sale.customerId || '').startsWith('system_') && !investorIds.has(sale.customerId);

export const collectionPayments = (sale, withoutDownPayment = false) => {
  const payments = (sale.paymentPlan || [])
    .filter(p => p.isPaid && p.isRealPayment !== false)
    .map(p => ({ ...p, amount: Number(p.amount) || 0, isRealPayment: true }));
  // У продажи за наличные downPayment — вся оплата товара, а не первый взнос.
  if (!withoutDownPayment || sale.type === 'CASH') {
    payments.unshift({ id: `${sale.id}_dp`, date: sale.startDate, amount: Number(sale.downPayment) || 0,
      isPaid: true, isRealPayment: true, note: sale.type === 'CASH' ? 'Продажа' : 'Первый взнос' });
  }
  return payments;
};

export const collectionAmount = (sale, withoutDownPayment = false) =>
  collectionPayments(sale, withoutDownPayment).reduce((sum, p) => sum + p.amount, 0);
