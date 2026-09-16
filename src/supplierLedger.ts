import type { Expense, Product, StockMovement } from '../types';

/**
 * Поставки от партнёра — приходы на склад, оформленные на него.
 *
 * Долг перед поставщиком до сих пор считался только по договорам рассрочки: там
 * товар брали под конкретную продажу, и обязательство висело на ней. С появлением
 * склада товар стали принимать накладной, без всякой продажи, — и такие поставки
 * на карточке партнёра не показывались вовсе, хотя деньги за них должны ровно так
 * же.
 */

export interface SupplyLine {
  productId: string;
  name: string;
  quantity: number;
  price: number;
}

export interface SupplyDoc {
  id: string;
  number: string;
  date: string;
  total: number;
  note?: string;
  lines: SupplyLine[];
}

/** Приходы этого поставщика, собранные в документы. */
export const supplierSupplies = (
  movements: StockMovement[],
  products: Product[],
  supplierId: string
): SupplyDoc[] => {
  // Приход проводится накладной: у всех его строк общий batchId. Без группировки
  // поставка из двадцати позиций выглядела бы двадцатью поставками.
  const batches = new Map<string, StockMovement[]>();
  movements
    .filter(m => m.type === 'IN' && m.supplierId === supplierId)
    .forEach(m => {
      const key = m.batchId || `single_${m.id}`;
      batches.set(key, [...(batches.get(key) || []), m]);
    });

  const docs: SupplyDoc[] = [];
  batches.forEach((rows, key) => {
    const head = rows[0];
    docs.push({
      id: key,
      number: head.docNumber || key.replace('doc_', '').slice(-6),
      date: head.date,
      note: head.note,
      total: rows.reduce((sum, m) => sum + Math.abs(m.quantity) * (m.unitPrice || 0), 0),
      lines: rows.map(m => ({
        productId: m.productId,
        name: products.find(p => p.id === m.productId)?.name || 'Товар удалён',
        quantity: Math.abs(m.quantity),
        price: m.unitPrice || 0,
      })),
    });
  });

  return docs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

/**
 * Оплаты партнёру, не привязанные к договору.
 *
 * Оплата с указанным договором уже уменьшает долг именно по нему — учитывать её
 * второй раз в общем балансе значило бы погасить один платёж дважды. Поэтому в
 * счёт поставок идут только те оплаты, у которых договора нет.
 */
export const supplierGeneralPayments = (expenses: Expense[], supplierId: string): Expense[] =>
  expenses.filter(e =>
    e.supplierId === supplierId
    && e.category === 'Оплата партнёру'
    && !e.saleId
    && e.isRefund !== true
  );

export interface SupplyBalance extends SupplyDoc {
  paid: number;
  remaining: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Оплачено и остаток по каждому приходу.
 *
 * Сначала гасятся приходы, к которым оплату привязали явно. Всё, что к приходу
 * не привязано, — и переплата сверх суммы привязанного прихода — гасит поставки
 * по очереди, от старых к новым: так долг обычно и отдают. Сумма остатков всегда
 * равна supplierSupplyDebt, поэтому общая цифра долга от привязки не меняется —
 * меняется только то, какой приход считается закрытым.
 *
 * Порядок результата — как у supplierSupplies: свежие сверху.
 */
export const supplierSupplyBalances = (
  movements: StockMovement[],
  products: Product[],
  expenses: Expense[],
  supplierId: string
): SupplyBalance[] => {
  const docs = supplierSupplies(movements, products, supplierId);
  const docIds = new Set(docs.map(d => d.id));

  const linked = new Map<string, number>();
  let pool = 0;
  supplierGeneralPayments(expenses, supplierId).forEach(e => {
    const amount = Number(e.amount) || 0;
    if (e.supplyDocId && docIds.has(e.supplyDocId)) {
      linked.set(e.supplyDocId, (linked.get(e.supplyDocId) || 0) + amount);
    } else {
      // Привязка к удалённому приходу теряет смысл — такая оплата гасит по очереди
      pool += amount;
    }
  });

  const oldestFirst = [...docs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const paid = new Map<string, number>();
  oldestFirst.forEach(d => {
    const own = linked.get(d.id) || 0;
    const applied = Math.min(d.total, own);
    paid.set(d.id, applied);
    pool += own - applied;
  });
  oldestFirst.forEach(d => {
    const room = d.total - (paid.get(d.id) || 0);
    const take = Math.max(0, Math.min(room, pool));
    pool -= take;
    paid.set(d.id, (paid.get(d.id) || 0) + take);
  });

  return docs.map(d => ({
    ...d,
    paid: round2(paid.get(d.id) || 0),
    remaining: round2(Math.max(0, d.total - (paid.get(d.id) || 0))),
  }));
};

/** Сколько осталось должны за принятый товар. */
/**
 * Сальдо по поставкам со знаком: плюс — мы должны, минус — отдали больше.
 * Переплата не выдумка: партнёру часто отдают округлённой суммой или вперёд,
 * и эти деньги зачтутся в следующую поставку — прятать их в ноль значит терять
 * след живых денег.
 */
export const supplierSupplyNet = (
  movements: StockMovement[],
  products: Product[],
  expenses: Expense[],
  supplierId: string
): number => {
  const received = supplierSupplies(movements, products, supplierId)
    .reduce((sum, d) => sum + d.total, 0);
  const paid = supplierGeneralPayments(expenses, supplierId)
    .reduce((sum, e) => sum + e.amount, 0);
  return round2(received - paid);
};

/**
 * Сколько мы должны партнёру всего: по договорам рассрочки и по складским
 * поставкам. Минус — переплата.
 *
 * Долг по договору считаем, пока он не закрыт; переплату по нему — всегда:
 * закрытый договор с суммой сверх закупа означает, что деньги ушли, и они
 * такие же настоящие, как долг.
 */
export const supplierBalance = (
  sales: { supplierId?: string; buyPrice?: number; partnerDebtPaidAmount?: number; isPartnerDebtPaid?: boolean }[],
  movements: StockMovement[],
  products: Product[],
  expenses: Expense[],
  supplierId: string
): number => {
  const contract = sales
    .filter(s => s.supplierId === supplierId)
    .reduce((sum, s) => {
      const buy = Number(s.buyPrice) || 0;
      const paid = Number(s.partnerDebtPaidAmount) || 0;
      if (paid > buy) return sum - (paid - buy);
      return sum + (s.isPartnerDebtPaid ? 0 : Math.max(0, buy - paid));
    }, 0);
  return round2(contract + supplierSupplyNet(movements, products, expenses, supplierId));
};

export const supplierSupplyDebt = (
  movements: StockMovement[],
  products: Product[],
  expenses: Expense[],
  supplierId: string
): number => {
  // Долг — неотрицательная часть сальдо; переплату показывает supplierSupplyNet.
  return Math.max(0, supplierSupplyNet(movements, products, expenses, supplierId));
};
