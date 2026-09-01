import React, { useMemo, useState } from 'react';
import type { Product, SaleStockItem } from '../types';
import { formatCurrency, stockAtWarehouse } from '../src/utils';
import ModalPortal from './ModalPortal';

interface StockPickerProps {
  products: Product[];
  /** Склад, с которого отгружают: остаток берём по нему, а не суммарный */
  warehouseId: string;
  /** Уже выбранное — при повторном открытии счётчики стоят на своих местах */
  initial: SaleStockItem[];
  showCents?: boolean;
  onCancel: () => void;
  onApply: (items: SaleStockItem[]) => void;
}

/**
 * Выбор товаров со склада для договора рассрочки.
 *
 * Цена берётся продажная, а не закупочная: магазин отдаёт товар в рассрочку по
 * той же цене, что и с прилавка, и именно она становится себестоимостью
 * договора — от неё считается наценка. Показываем её в строке явно, чтобы не
 * пришлось гадать, откуда взялась сумма закупа в форме.
 *
 * Остаток — по конкретному складу. Суммарный остаток обманывал бы: товар может
 * лежать на другой точке, откуда сегодня не отгружают.
 */
const StockPicker: React.FC<StockPickerProps> = ({
  products, warehouseId, initial, showCents = false, onCancel, onApply,
}) => {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    initial.forEach(i => { map[i.productId] = i.quantity; });
    return map;
  });

  const available = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter(p => !p.isArchived)
      // Товар с нулевым остатком не прячем, если он уже выбран: иначе строка
      // молча исчезла бы из списка вместе со своим счётчиком.
      .filter(p => stockAtWarehouse(p, warehouseId) > 0 || picked[p.id] > 0)
      .filter(p => !q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [products, warehouseId, search, picked]);

  const items: SaleStockItem[] = useMemo(
    () => (Object.entries(picked) as [string, number][])
      .filter(([, qty]) => qty > 0)
      .map(([productId, quantity]) => {
        const p = products.find(x => x.id === productId);
        return {
          productId,
          name: p?.name || 'Товар удалён',
          quantity,
          price: p?.price || 0,
          unit: p?.unit,
        };
      }),
    [picked, products]
  );

  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const change = (p: Product, delta: number) => {
    setPicked(prev => {
      const max = stockAtWarehouse(p, warehouseId);
      const next = Math.max(0, Math.min(max, (prev[p.id] || 0) + delta));
      return { ...prev, [p.id]: next };
    });
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-modal flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
           onClick={onCancel}>
        <div className="bg-white dark:bg-slate-800 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[85vh] flex flex-col animate-slide-up-sheet"
             onClick={e => e.stopPropagation()}>
          <div className="px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-700 shrink-0">
            <h3 className="font-bold text-slate-800 dark:text-white">Товар со склада</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Сумма выбранного встанет в «Закуп», товар спишется при оформлении
            </p>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск по названию или артикулу"
              className="mt-3 w-full p-2.5 text-sm border border-slate-300 dark:border-slate-600 rounded-xl outline-none bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400"
            />
          </div>

          <div className="overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700 flex-1">
            {available.length === 0 ? (
              <p className="px-5 py-8 text-sm text-center text-slate-400">
                {search ? 'Ничего не нашлось' : 'На складе нет товара с остатком'}
              </p>
            ) : available.map(p => {
              const left = stockAtWarehouse(p, warehouseId);
              const qty = picked[p.id] || 0;
              return (
                <div key={p.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-800 dark:text-white truncate">{p.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {formatCurrency(p.price, showCents)} ₽ · остаток {left} {p.unit || 'шт'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button type="button" onClick={() => change(p, -1)} disabled={qty === 0}
                            className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 font-bold disabled:opacity-40 active:scale-95 transition-transform">
                      −
                    </button>
                    <span className={`w-6 text-center font-bold ${qty > 0 ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-300 dark:text-slate-600'}`}>
                      {qty}
                    </span>
                    {/* Больше, чем лежит на складе, взять нельзя: договор с
                        отрицательным остатком пришлось бы разбирать вручную. */}
                    <button type="button" onClick={() => change(p, 1)} disabled={qty >= left}
                            className="w-8 h-8 rounded-lg bg-indigo-600 text-white font-bold disabled:opacity-40 active:scale-95 transition-transform">
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-4 border-t border-slate-100 dark:border-slate-700 shrink-0 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500 dark:text-slate-400">
                {items.length === 0 ? 'Ничего не выбрано' : `Позиций: ${items.length}`}
              </span>
              <span className="font-bold text-slate-800 dark:text-white">
                {formatCurrency(total, showCents)} ₽
              </span>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onCancel}
                      className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 font-bold text-sm">
                Отмена
              </button>
              {/* Пустой выбор — это «убрать товар со склада из договора», а не
                  ошибка: договор мог быть оформлен по ошибке на складскую позицию. */}
              <button type="button" onClick={() => onApply(items)}
                      className="flex-[1.6] py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm active:scale-95 transition-transform">
                {items.length === 0 ? 'Убрать товар' : 'Добавить'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};

export default StockPicker;
