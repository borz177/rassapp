import type { Customer, RetailSale, Sale } from '../types';

/**
 * Клиент рассрочки или покупатель розницы.
 *
 * С включённым магазином в одной базе живут и те, кто берёт в рассрочку по
 * договору, и те, кто купил в кассе в долг. При продаже в кассе список из сотни
 * клиентов рассрочки только мешал найти своего покупателя — и наоборот.
 *
 * Раздел определяется историей, а не отметкой в карточке: она не может
 * разойтись с тем, что было на самом деле.
 * — есть договоры — рассрочка;
 * — есть чеки магазина — розница;
 * — и то и другое — клиент обоих разделов;
 * — истории нет — по тому, где завели (segment в карточке), иначе рассрочка.
 */
export type CustomerSegment = 'INSTALLMENT' | 'RETAIL';

export interface SegmentIndex {
  /** В каких разделах клиент */
  of: (id: string) => Set<CustomerSegment>;
  installment: number;
  retail: number;
}

export const buildSegmentIndex = (
  customers: Customer[],
  sales: Sale[],
  retailSales: RetailSale[],
): SegmentIndex => {
  const withContracts = new Set(
    sales.filter(s => s.customerId && !String(s.customerId).startsWith('system_') && (s as any).status !== 'DELETED')
      .map(s => s.customerId));
  const withChecks = new Set(retailSales.filter(r => r.customerId && !r.isCancelled).map(r => r.customerId!));

  const map = new Map<string, Set<CustomerSegment>>();
  let installment = 0, retail = 0;
  for (const c of customers) {
    const set = new Set<CustomerSegment>();
    if (withContracts.has(c.id)) set.add('INSTALLMENT');
    if (withChecks.has(c.id)) set.add('RETAIL');
    if (set.size === 0) set.add(c.segment === 'RETAIL' ? 'RETAIL' : 'INSTALLMENT');
    if (set.has('INSTALLMENT')) installment++;
    if (set.has('RETAIL')) retail++;
    map.set(c.id, set);
  }
  const fallback = new Set<CustomerSegment>(['INSTALLMENT']);
  return { of: id => map.get(id) || fallback, installment, retail };
};
