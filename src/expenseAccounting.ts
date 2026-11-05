import type { Expense } from '../types';

/** Старую запись без источника не переименовываем в расход из прибыли. */
export const hasUnassignedExpenseSource = (e: Expense): boolean =>
  e.fromProfit !== true && !e.isRefund && !e.payoutType && !e.supplierId && !e.supplyDocId
  && e.category !== 'Моя выплата' && e.category !== 'Оплата партнёру'
  && e.category !== 'Себестоимость' && e.category !== 'Закуп'
  && !e.id.startsWith('exp_sale_') && !e.id.startsWith('exp_stock_');
