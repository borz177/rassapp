import type { Product, RetailSale } from '../types';

/**
 * Аналитика розницы: ABC-анализ товаров и маржа по категориям.
 *
 * Строки чека считаем «чистыми»: скидка всего чека раскладывается по строкам
 * пропорционально сумме, иначе товар, который всегда продают со скидкой,
 * выглядел бы прибыльнее, чем есть. Возвраты (returnOf) — те же строки с
 * минусом: проданное и возвращённое взаимно гасятся простым сложением.
 */
export interface ProductFacts {
  productId: string;
  name: string;
  category: string;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
}

export const NO_CATEGORY = 'Без категории';

export const productFacts = (sales: RetailSale[], products: Product[]): ProductFacts[] => {
  const byId = new Map(products.map(p => [p.id, p]));
  const map = new Map<string, ProductFacts>();
  sales.forEach(sale => {
    if (sale.isCancelled) return;
    const gross = sale.items.reduce((n, i) => n + i.price * i.quantity, 0);
    // Доля «чистой» суммы: total/subtotal. У пустого или нулевого чека — 1
    const ratio = gross !== 0 ? sale.total / gross : 1;
    sale.items.forEach(i => {
      const product = byId.get(i.productId);
      const cur = map.get(i.productId) || {
        productId: i.productId,
        name: product?.name || i.name,
        category: (product?.category || '').trim() || NO_CATEGORY,
        qty: 0, revenue: 0, cost: 0, profit: 0,
      };
      const revenue = i.price * i.quantity * ratio;
      const cost = (i.buyPrice || 0) * i.quantity;
      cur.qty += i.quantity;
      cur.revenue += revenue;
      cur.cost += cost;
      cur.profit += revenue - cost;
      map.set(i.productId, cur);
    });
  });
  return Array.from(map.values()).filter(f => Math.abs(f.qty) > 1e-9 || Math.abs(f.revenue) > 0.005);
};

export type AbcClass = 'A' | 'B' | 'C';

export interface AbcRow extends ProductFacts {
  cls: AbcClass;
  /** Доля товара в итоге выбранного показателя, % */
  share: number;
  /** Накопленная доля с учётом всех товаров выше по списку, % */
  cumulative: number;
}

/**
 * Классический ABC по Парето: товары по убыванию показателя, A — те, что вместе
 * дают первые 80%, B — следующие 15%, C — остальное. Граничный товар относится
 * к тому классу, в котором начинается его доля: иначе при одном-двух товарах в
 * A не попадал бы даже лидер.
 *
 * Товары с нулевым или отрицательным вкладом (продают в минус) — всегда C:
 * в Парето им места нет, но спрятать их нельзя — это сигнал.
 */
export const abcAnalysis = (facts: ProductFacts[], metric: 'profit' | 'revenue'): AbcRow[] => {
  const sorted = [...facts].sort((a, b) => b[metric] - a[metric]);
  const total = sorted.reduce((n, f) => n + Math.max(0, f[metric]), 0);
  let acc = 0;
  return sorted.map(f => {
    const value = Math.max(0, f[metric]);
    const share = total > 0 ? (value / total) * 100 : 0;
    const start = acc;
    acc += share;
    const cls: AbcClass = value <= 0 ? 'C' : start < 80 ? 'A' : start < 95 ? 'B' : 'C';
    return { ...f, cls, share, cumulative: Math.min(100, acc) };
  });
};

export interface AbcSummary {
  cls: AbcClass;
  count: number;
  /** Доля товаров класса от всех товаров, % */
  countShare: number;
  /** Доля показателя, % */
  valueShare: number;
  value: number;
}

export const abcSummary = (rows: AbcRow[], metric: 'profit' | 'revenue'): AbcSummary[] =>
  (['A', 'B', 'C'] as AbcClass[]).map(cls => {
    const own = rows.filter(r => r.cls === cls);
    return {
      cls,
      count: own.length,
      countShare: rows.length ? (own.length / rows.length) * 100 : 0,
      valueShare: own.reduce((n, r) => n + r.share, 0),
      value: own.reduce((n, r) => n + r[metric], 0),
    };
  });

export interface CategoryMargin {
  category: string;
  revenue: number;
  profit: number;
  qty: number;
  products: number;
  /** Маржа: прибыль / выручка, % */
  margin: number;
  /** Доля категории в прибыли, % */
  profitShare: number;
}

export const categoryMargins = (facts: ProductFacts[]): CategoryMargin[] => {
  const map = new Map<string, CategoryMargin>();
  facts.forEach(f => {
    const cur = map.get(f.category) || {
      category: f.category, revenue: 0, profit: 0, qty: 0, products: 0, margin: 0, profitShare: 0,
    };
    cur.revenue += f.revenue;
    cur.profit += f.profit;
    cur.qty += f.qty;
    cur.products += 1;
    map.set(f.category, cur);
  });
  const list = Array.from(map.values());
  const totalProfit = list.reduce((n, c) => n + Math.max(0, c.profit), 0);
  list.forEach(c => {
    c.margin = c.revenue > 0 ? (c.profit / c.revenue) * 100 : 0;
    c.profitShare = totalProfit > 0 ? (Math.max(0, c.profit) / totalProfit) * 100 : 0;
  });
  return list.sort((a, b) => b.profit - a.profit);
};
