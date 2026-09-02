import React, { useMemo, useState } from 'react';
import type { Product, SaleStockItem } from '../types';
import { formatCurrency, stockAtWarehouse } from '../src/utils';
import TopBarBack from './TopBarBack';

interface ProductPickerPageProps {
  products: Product[];
  /** Склад, по которому показываем остаток. Пусто — берём суммарный. */
  warehouseId?: string;
  title?: string;
  subtitle?: string;
  showCents?: boolean;
  /** Какую цену показывать и подставлять: продажную, закупочную — решает вызвавший */
  priceOf?: (p: Product) => number;
  /** Закрыть страницу без выбора */
  onClose: () => void;
  /**
   * Одиночный выбор: страница отдаёт товар и закрывается. Дальше вызвавший сам
   * спрашивает количество — там, где это его дело (строка документа, накладная).
   */
  onPick?: (product: Product) => void;
  /** Множественный выбор: счётчики на плитках и подтверждение внизу */
  initial?: SaleStockItem[];
  onApply?: (items: SaleStockItem[]) => void;
  /** Не давать взять больше, чем лежит на складе */
  limitToStock?: boolean;
  /** Подпись кнопки подтверждения, когда ничего не выбрано */
  emptyActionLabel?: string;
}

/**
 * Выбор товара — страницей, а не окном.
 *
 * Товар выбирают глазами: по фотографии его узнают быстрее, чем вычитывают
 * название из списка. В окне на пол-экрана витрина не помещалась — оставался
 * текстовый перечень, где «Айфон 15 128 чёрный» и «Айфон 15 256 чёрный» отличить
 * можно только вчитавшись. Поэтому здесь тот же вид, что в кассе и складских
 * операциях: плитки с фото, остатком и ценой, поиск и категории сверху.
 *
 * Один компонент на все места выбора: у кассы, склада и договора это один и тот
 * же вопрос «какой товар», и три разных ответа на него означали бы, что человек
 * каждый раз заново разбирается в незнакомом экране.
 */
const ProductPickerPage: React.FC<ProductPickerPageProps> = ({
  products,
  warehouseId,
  title = 'Товар со склада',
  subtitle,
  showCents = false,
  priceOf = p => p.price || 0,
  onClose,
  onPick,
  initial = [],
  onApply,
  limitToStock = true,
  emptyActionLabel = 'Готово',
}) => {
  const multi = !!onApply;

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('ALL');
  const [picked, setPicked] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    initial.forEach(i => { map[i.productId] = i.quantity; });
    return map;
  });

  const stockOf = (p: Product) => (warehouseId ? stockAtWarehouse(p, warehouseId) : (p.stock || 0));

  const live = useMemo(() => products.filter(p => !p.isArchived), [products]);

  const categories = useMemo(
    () => Array.from(new Set(live.map(p => p.category).filter(Boolean))).sort(),
    [live]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return live
      .filter(p => category === 'ALL' || p.category === category)
      .filter(p => !q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [live, category, search]);

  const items: SaleStockItem[] = useMemo(
    () => (Object.entries(picked) as [string, number][])
      .filter(([, qty]) => qty > 0)
      .map(([productId, quantity]) => {
        const p = products.find(x => x.id === productId);
        return {
          productId,
          name: p?.name || 'Товар удалён',
          quantity,
          price: p ? priceOf(p) : 0,
          unit: p?.unit,
        };
      }),
    [picked, products, priceOf]
  );

  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const change = (p: Product, delta: number) => {
    setPicked(prev => {
      const current = prev[p.id] || 0;
      const max = limitToStock ? stockOf(p) : Number.MAX_SAFE_INTEGER;
      // Товар, которого нет на складе, добавить нельзя: договор с отрицательным
      // остатком потом пришлось бы разбирать вручную.
      const next = Math.max(0, Math.min(max, current + delta));
      return { ...prev, [p.id]: next };
    });
  };

  const tap = (p: Product) => {
    if (!multi) { onPick?.(p); return; }
    change(p, 1);
  };

  return (
    <div className={multi ? 'pb-28' : 'pb-6'}>
      <div className="flex items-center gap-3 mb-3">
        <TopBarBack onClick={onClose} />
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-slate-800 dark:text-white truncate">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{subtitle}</p>}
        </div>
      </div>

      <div className="space-y-3">
        {categories.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            <button type="button" onClick={() => setCategory('ALL')}
                    className={`shrink-0 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap ${
                      category === 'ALL' ? 'glass-surface text-indigo-600 dark:text-indigo-300'
                                         : 'bg-white/60 dark:bg-slate-800/60 border border-white/70 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}>Все</button>
            {categories.map(c => (
              <button type="button" key={c} onClick={() => setCategory(c)}
                      className={`shrink-0 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap ${
                        category === c ? 'glass-surface text-indigo-600 dark:text-indigo-300'
                                       : 'bg-white/60 dark:bg-slate-800/60 border border-white/70 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                      }`}>{c}</button>
            ))}
          </div>
        )}

        <input value={search} onChange={e => setSearch(e.target.value)}
               placeholder="Поиск по названию или артикулу"
               className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400 outline-none" />

        {visible.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-10 text-center">
            {live.length === 0 ? 'Сначала добавьте товары на склад.' : 'Ничего не найдено.'}
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5">
            {visible.map(p => {
              const qty = picked[p.id] || 0;
              const left = stockOf(p);
              return (
                <button type="button" key={p.id} onClick={() => tap(p)}
                        className={`relative bg-white dark:bg-slate-800 rounded-2xl border p-2 text-left active:scale-95 transition-transform overflow-hidden ${
                          qty > 0 ? 'border-indigo-500 border-2' : 'border-slate-100 dark:border-slate-700'
                        }`}>
                  <span className={`absolute top-0 left-0 z-10 px-1.5 py-0.5 rounded-br-lg text-[9px] font-bold ${
                    left > 0 ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                             : 'bg-rose-50 dark:bg-rose-900/30 text-rose-500'
                  }`}>
                    {left}
                  </span>

                  {qty > 0 && (
                    <>
                      <span className="absolute top-1.5 right-1.5 z-10 bg-indigo-600 text-white text-[10px] font-bold min-w-[22px] h-5 px-1 rounded-full flex items-center justify-center">
                        {qty}
                      </span>
                      {/* Убавить — отдельной кнопкой поверх плитки: нажатие на саму
                          плитку прибавляет, и без «минуса» лишнюю штуку было бы не снять. */}
                      <span
                        role="button"
                        tabIndex={-1}
                        onClick={e => { e.stopPropagation(); change(p, -1); }}
                        className="absolute bottom-1.5 right-1.5 z-10 w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 text-base font-bold flex items-center justify-center active:scale-90 transition-transform"
                      >
                        −
                      </span>
                    </>
                  )}

                  <div className="w-full aspect-[4/3] rounded-xl bg-slate-100 dark:bg-slate-700 overflow-hidden mb-1.5 mt-3 flex items-center justify-center">
                    {p.images?.[0]
                      ? <img src={p.images[0]} alt="" className="w-full h-full object-cover" loading="lazy" />
                      : <span className="text-2xl text-slate-300">📦</span>}
                  </div>

                  <p className="font-bold text-slate-800 dark:text-white text-xs leading-tight line-clamp-2">{p.name}</p>
                  {p.sku && <p className="text-[10px] text-slate-400 truncate">{p.sku}</p>}
                  <p className="text-sm font-extrabold text-indigo-600 dark:text-indigo-400 mt-0.5">
                    {formatCurrency(priceOf(p), showCents)} ₽
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Итог выбора внизу — как корзина в кассе: видно, что набрал, не
          прокручивая обратно наверх.

          Полоса идёт по ширине самого содержимого, а не пузырём в углу: в углу
          она налезала на кнопку поддержки, и сумма уходила под неё. Отступ
          справа на десктопе как раз под этот пузырь, а снизу на телефоне —
          выше нижней навигации, за которой кнопка пряталась целиком. */}
      {multi && (
        <div className="fixed left-0 right-0 md:left-64 z-40 px-4 md:px-10 pointer-events-none
                        bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] md:bottom-6">
          <div className="max-w-7xl mx-auto md:pr-24 pointer-events-auto">
          <button type="button" onClick={() => onApply?.(items)}
                  className="w-full rounded-2xl bg-indigo-600 text-white py-3.5 px-5 shadow-2xl flex items-center justify-between active:scale-[0.98] transition-transform">
            <span className="flex items-center gap-2 font-bold">
              {items.length > 0 && (
                <span className="bg-white/20 rounded-full min-w-[26px] h-6 px-1.5 flex items-center justify-center text-xs">
                  {items.length}
                </span>
              )}
              {items.length === 0 ? emptyActionLabel : 'Добавить'}
            </span>
            {items.length > 0 && (
              <span className="font-extrabold text-lg">{formatCurrency(total, showCents)} ₽</span>
            )}
          </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductPickerPage;
