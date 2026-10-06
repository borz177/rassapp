import React, { useMemo, useState } from 'react';
import type { Product } from '../types';
import Sheet from './Sheet';
import ProductImage from './ProductImage';
import { priceRange, variantLabel } from '../src/variants';

/**
 * Выбор варианта на кассе: по строке на характеристику (размер, цвет, память),
 * значения — кнопками. Значение, которого нет в наличии при уже выбранных
 * остальных, видно, но приглушено: кассир сразу понимает, что 43 чёрного нет,
 * а не ищет его.
 */
const VariantPickSheet: React.FC<{
  base: string;
  items: Product[];
  stockOf: (p: Product) => number;
  allowNegativeStock: boolean;
  inCartQty: (id: string) => number;
  showCents?: boolean;
  onClose: () => void;
  /** Добавить одну штуку. Возвращает текст ошибки или null */
  onAdd: (p: Product) => string | null;
  /** Открыть окно количества и цены для варианта */
  onDetails: (p: Product) => void;
}> = ({ base, items, stockOf, allowNegativeStock, inCartQty, showCents, onClose, onAdd, onDetails }) => {
  const options = useMemo(
    () => (items.find(p => p.variantOptions?.length)?.variantOptions || [])
      // Показываем только значения, у которых есть живой вариант
      .map(o => ({ ...o, values: o.values.filter(v => items.some(p => p.variantAttrs?.[o.name] === v)) }))
      .filter(o => o.values.length > 0),
    [items]);
  const [picked, setPicked] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    options.forEach(o => { if (o.values.length === 1) init[o.name] = o.values[0]; });
    return init;
  });
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const fits = (p: Product, sel: Record<string, string>) =>
    Object.entries(sel).every(([k, v]) => p.variantAttrs?.[k] === v);
  const selected = options.every(o => picked[o.name])
    ? items.find(p => fits(p, picked)) : undefined;
  const money = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: showCents ? 2 : 0, maximumFractionDigits: showCents ? 2 : 0 });
  const range = priceRange(items);
  const cover = selected?.images?.[0] || items.find(p => p.images?.length)?.images?.[0];

  // Сколько в наличии у значения при уже выбранных остальных характеристиках
  const stockFor = (name: string, value: string) => {
    const sel = { ...picked, [name]: value };
    return items.filter(p => fits(p, sel)).reduce((n, p) => n + Math.max(0, stockOf(p)), 0);
  };
  const exists = (name: string, value: string) => items.some(p => fits(p, { ...picked, [name]: value }));

  const add = () => {
    if (!selected) return;
    const err = onAdd(selected);
    setError(err);
    if (!err) {
      setAdded(selected.id);
      window.setTimeout(() => setAdded(a => (a === selected.id ? null : a)), 1200);
    }
  };

  const left = selected ? stockOf(selected) : 0;
  const blocked = !!selected && !allowNegativeStock && inCartQty(selected.id) + 1 > left;

  return (
    <Sheet onClose={onClose} className="sm:max-w-md p-5 space-y-4">
      {(close: () => void) => (
        <>
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 shrink-0 rounded-2xl bg-slate-100 dark:bg-slate-700 overflow-hidden flex items-center justify-center">
              <ProductImage src={cover} className="w-full h-full object-cover" fallback={<span className="text-2xl text-slate-300">📦</span>} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-lg leading-tight text-slate-900 dark:text-white line-clamp-2">{base}</h3>
              <p className="mt-0.5 text-lg font-extrabold text-indigo-600 dark:text-indigo-400 tabular-nums">
                {selected ? `${money(selected.price)} ₽` : range.min === range.max ? `${money(range.min)} ₽` : `от ${money(range.min)} ₽`}
              </p>
            </div>
            <button type="button" onClick={close} aria-label="Закрыть"
                    className="self-start w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 font-bold">×</button>
          </div>

          {options.map(o => (
            <div key={o.name}>
              <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-slate-400">
                {o.name}{picked[o.name] ? <span className="normal-case tracking-normal text-slate-700 dark:text-slate-200"> · {picked[o.name]}</span> : null}
              </p>
              <div className="flex flex-wrap gap-2">
                {o.values.map(v => {
                  const on = picked[o.name] === v;
                  const can = exists(o.name, v);
                  const qty = stockFor(o.name, v);
                  return (
                    <button key={v} type="button" disabled={!can}
                            onClick={() => { setError(null); setPicked(p => (p[o.name] === v ? Object.fromEntries(Object.entries(p).filter(([k]) => k !== o.name)) : { ...p, [o.name]: v })); }}
                            className={`relative min-w-[52px] h-11 px-3.5 rounded-xl text-sm font-bold transition-all ${on
                              ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-md'
                              : can && qty > 0
                                ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white ring-1 ring-slate-200 dark:ring-slate-600 hover:ring-slate-400'
                                : 'bg-slate-50 dark:bg-slate-800/50 text-slate-400 ring-1 ring-dashed ring-slate-200 dark:ring-slate-700 line-through decoration-slate-300'}`}>
                      {v}
                      {can && (
                        <span className={`absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] leading-[18px] font-bold ${qty > 0
                          ? 'bg-emerald-500 text-white' : 'bg-slate-300 dark:bg-slate-600 text-white'}`}>{qty}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="rounded-2xl bg-slate-50 dark:bg-slate-900/60 px-4 py-3 text-sm">
            {selected ? (
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block font-bold text-slate-800 dark:text-white truncate">{variantLabel(selected)}</span>
                  <span className="block text-[12px] text-slate-500 dark:text-slate-400">
                    {selected.sku || 'без артикула'} · на складе {left}{inCartQty(selected.id) ? ` · в корзине ${inCartQty(selected.id)}` : ''}
                  </span>
                </span>
                <button type="button" onClick={() => { close(); onDetails(selected); }}
                        className="shrink-0 text-[12px] font-bold text-indigo-600 dark:text-indigo-300">Кол-во и цена</button>
              </div>
            ) : (
              <span className="text-slate-500 dark:text-slate-400">
                Выберите {options.filter(o => !picked[o.name]).map(o => o.name.toLowerCase()).join(' и ')}
              </span>
            )}
          </div>

          {error && <p className="text-sm font-semibold text-rose-600 dark:text-rose-400">{error}</p>}

          <button type="button" onClick={add} disabled={!selected || blocked}
                  className={`w-full h-13 py-3.5 rounded-2xl font-bold text-white disabled:opacity-40 active:scale-[0.99] transition ${added && added === selected?.id ? 'bg-emerald-600' : 'bg-indigo-600'}`}>
            {added && added === selected?.id ? 'Добавлено ✓' : blocked ? 'Нет на складе' : 'В корзину'}
          </button>
        </>
      )}
    </Sheet>
  );
};

export default VariantPickSheet;
