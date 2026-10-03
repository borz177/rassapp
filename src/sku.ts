import type { Product } from '../types';

/**
 * Следующий свободный артикул — в том формате, которым уже пользуются.
 *
 * Артикулы заводят по-разному: «RP-1006», «А-12», «00045». Свой формат
 * навязывать нельзя — подхватываем самый частый: тот же префикс, следующий
 * номер, та же ширина с нулями. Артикулов ещё нет — «Т-0001».
 */
const PATTERN = /^(.*?)(\d+)$/;

export const nextSku = (products: Pick<Product, 'sku'>[]): string => {
  const taken = new Set<string>();
  // префикс → { сколько товаров, наибольший номер, ширина номера }
  const groups = new Map<string, { count: number; max: number; width: number }>();
  for (const p of products) {
    const sku = (p.sku || '').trim();
    if (!sku) continue;
    taken.add(sku.toLowerCase());
    const m = PATTERN.exec(sku);
    if (!m) continue;
    const g = groups.get(m[1]) || { count: 0, max: 0, width: m[2].length };
    g.count++;
    g.max = Math.max(g.max, Number(m[2]));
    g.width = Math.max(g.width, m[2].length);
    groups.set(m[1], g);
  }

  let prefix = 'Т-', n = 1, width = 4;
  let best: { count: number; max: number; width: number } | null = null;
  for (const [p, g] of groups) {
    if (!best || g.count > best.count) { best = g; prefix = p; }
  }
  if (best) { n = best.max + 1; width = best.width; }

  // На случай ручных артикулов с тем же префиксом — пропускаем занятые
  let candidate = `${prefix}${String(n).padStart(width, '0')}`;
  while (taken.has(candidate.toLowerCase())) {
    n++;
    candidate = `${prefix}${String(n).padStart(width, '0')}`;
  }
  return candidate;
};

/** Товар, у которого уже есть такой артикул (кроме самого товара) */
export const skuOwner = <T extends Pick<Product, 'id' | 'sku' | 'name'>>(products: T[], sku: string, exceptId?: string): T | undefined => {
  const s = sku.trim().toLowerCase();
  if (!s) return undefined;
  return products.find(p => p.id !== exceptId && (p.sku || '').trim().toLowerCase() === s);
};
