import type { Product, VariantOption } from '../types';

/**
 * Варианты товара: размер, цвет, память.
 *
 * Вариант — обычный товар (см. Product.variantGroupId). Здесь — только то, что
 * собирает их в модель: подпись варианта, группировка списка, перебор сочетаний.
 */

export const OPTION_PRESETS: { name: string; values: string[] }[] = [
  { name: 'Размер', values: ['S', 'M', 'L', 'XL'] },
  { name: 'Цвет', values: ['Чёрный', 'Белый'] },
  { name: 'Память', values: ['128 ГБ', '256 ГБ'] },
  { name: 'Объём', values: [] },
];

export const isVariant = (p: Pick<Product, 'variantGroupId'>): boolean => !!p.variantGroupId;

/** «42 · Чёрный» — значения в порядке характеристик модели */
export const variantLabel = (p: Pick<Product, 'variantAttrs' | 'variantOptions' | 'name'>): string => {
  const attrs = p.variantAttrs || {};
  const order = (p.variantOptions || []).map(o => o.name);
  const keys = [...order.filter(k => k in attrs), ...Object.keys(attrs).filter(k => !order.includes(k))];
  const label = keys.map(k => attrs[k]).filter(Boolean).join(' · ');
  return label || p.name;
};

/** Полное название варианта для чеков и старых версий: «Кроссовки 42 Чёрный» */
export const variantName = (base: string, options: VariantOption[], attrs: Record<string, string>): string =>
  [base.trim(), ...options.map(o => attrs[o.name]).filter(Boolean)].join(' ');

/** Ключ сочетания — для сравнения «такой вариант уже есть» */
export const comboKey = (options: VariantOption[], attrs: Record<string, string>): string =>
  options.map(o => `${o.name}=${(attrs[o.name] || '').toLowerCase()}`).join('|');

/** Все сочетания значений: 2 размера × 3 цвета = 6 вариантов */
export const combinations = (options: VariantOption[]): Record<string, string>[] => {
  const used = options.filter(o => o.name.trim() && o.values.length > 0);
  if (used.length === 0) return [];
  return used.reduce<Record<string, string>[]>(
    (acc, o) => acc.flatMap(a => o.values.map(v => ({ ...a, [o.name]: v }))),
    [{}],
  );
};

export type CatalogEntry =
  | { kind: 'single'; product: Product }
  | { kind: 'group'; groupId: string; base: string; items: Product[] };

/**
 * Список товаров с вариантами, собранными в модели. Модель встаёт на место
 * первого своего варианта — порядок списка (ручной, по алфавиту, по остатку)
 * сохраняется. Если от модели в отборе остался один вариант, он идёт обычной
 * строкой: карточка «1 вариант» только прятала бы нужный товар.
 */
export const groupCatalog = (list: Product[]): CatalogEntry[] => {
  const groups = new Map<string, Product[]>();
  list.forEach(p => {
    if (!p.variantGroupId) return;
    groups.set(p.variantGroupId, [...(groups.get(p.variantGroupId) || []), p]);
  });
  const placed = new Set<string>();
  const out: CatalogEntry[] = [];
  list.forEach(p => {
    const gid = p.variantGroupId;
    const items = gid ? groups.get(gid) || [] : [];
    if (!gid || items.length < 2) { out.push({ kind: 'single', product: p }); return; }
    if (placed.has(gid)) return;
    placed.add(gid);
    out.push({ kind: 'group', groupId: gid, base: p.variantBase || p.name, items: sortVariants(items) });
  });
  return out;
};

/** Варианты по порядку значений характеристик (S, M, L — а не по алфавиту) */
export const sortVariants = (items: Product[]): Product[] => {
  const options = items.find(p => p.variantOptions?.length)?.variantOptions || [];
  const rank = (p: Product) => options.map(o => {
    const i = o.values.indexOf(p.variantAttrs?.[o.name] || '');
    return i < 0 ? 999 : i;
  });
  return [...items].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return a.name.localeCompare(b.name, 'ru');
  });
};

/** Все варианты модели (включая архивные) из полного каталога */
export const variantsOf = (products: Product[], groupId: string): Product[] =>
  sortVariants(products.filter(p => p.variantGroupId === groupId));

export const priceRange = (items: Product[]): { min: number; max: number } => {
  const prices = items.map(p => Number(p.price) || 0);
  return { min: Math.min(...prices), max: Math.max(...prices) };
};
