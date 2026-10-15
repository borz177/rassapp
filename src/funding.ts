/**
 * Совместное финансирование договора — типы поверх shared/funding.js (общий
 * с сервером расчёт). Смысл и правила — там.
 */
import * as F from '../shared/funding.js';
import type { Sale } from '../types';

export type FundedPiece = Sale & { fundingOf?: string; fundingShare?: number };

export const fundingShares = F.fundingShares as (sale: Sale) => { accountId: string; share: number }[] | null;
export const splitByShares = F.splitByShares as (amount: number, shares: { accountId: string; share: number }[]) => number[];
export const saleTouchesAccount = F.saleTouchesAccount as (sale: Sale, accountId: string) => boolean;
export const saleAccountShare = F.saleAccountShare as (sale: Sale, accountId: string) => number;
export const fundingPieces = F.fundingPieces as (sale: Sale) => FundedPiece[];
export const expandFundedSales = F.expandFundedSales as <T extends Sale>(sales: T[]) => T[];

/**
 * Можно ли этому договору совместное финансирование: товар куплен за свои
 * деньги. Со склада он уже оплачен приходом, у поставщика — это долг, а не
 * трата со счёта: делить закуп там не по чему.
 */
export const canCoFund = (sale: Partial<Sale>) =>
  !sale.supplierId && !(sale.stockItems && sale.stockItems.length) && !sale.productId && Number(sale.buyPrice) > 0;

/** Действующее финансирование договора (≥ 2 счетов) или null */
export const activeFunding = (sale: Partial<Sale>) =>
  canCoFund(sale) && fundingShares(sale as Sale) ? (sale.funding as { accountId: string; amount: number }[]) : null;

/**
 * Договор глазами расхода закупа с основного счёта: при совместном
 * финансировании основной счёт тратит только свою часть.
 */
export const primaryPurchaseView = <T extends Partial<Sale>>(sale: T): T => {
  const f = activeFunding(sale);
  return f ? { ...sale, buyPrice: Number(f[0].amount) || 0 } : sale;
};

/** Id расхода закупа совместного счёта */
export const coFundExpenseId = (saleId: string, accountId: string) => `exp_sale_${saleId}__${accountId}`;
export const isCoFundExpenseOf = (expenseId: string, saleId: string) => expenseId.startsWith(`exp_sale_${saleId}__`);

/** Какие расходы закупа должны быть у совместных счетов договора (без основного) */
export const coFundExpenses = (saleId: string, sale: Partial<Sale>) =>
  (activeFunding(sale) || []).slice(1).map(f => ({ id: coFundExpenseId(saleId, f.accountId), accountId: f.accountId, amount: Number(f.amount) || 0 }));
