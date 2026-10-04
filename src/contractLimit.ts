import { PLAN_CONTRACT_LIMITS } from '../types';
import type { Sale } from '../types';

/**
 * Лимит договоров по тарифу — то же правило, что checkContractLimit в
 * server/index.js. Здесь — для проверки до отправки и без связи.
 *
 * На «Старте» считаются ВСЕ договоры (кроме удалённых и служебных приходов):
 * 100 договоров за всё время. На «Стандарте» — только договоры в работе
 * (активные и черновики): закрыл договор — место освободилось.
 */
export const COUNTS_ALL_CONTRACTS: Record<string, boolean> = { START: true };

const isRealContract = (s: Pick<Sale, 'id' | 'customerId' | 'status'>) =>
  (s.status as string) !== 'DELETED'
  && !String(s.customerId || '').startsWith('system_')
  && !String(s.id || '').startsWith('inc_');

export const contractsTowardLimit = (plan: string, sales: Pick<Sale, 'id' | 'customerId' | 'status'>[]): number =>
  COUNTS_ALL_CONTRACTS[plan]
    ? sales.filter(isRealContract).length
    : sales.filter(s => isRealContract(s) && (s.status === 'ACTIVE' || s.status === 'DRAFT')).length;

export const contractLimitOf = (plan: string): number => PLAN_CONTRACT_LIMITS[plan] ?? 0;
