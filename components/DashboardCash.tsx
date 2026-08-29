import React, { useMemo, useState } from 'react';
import type { Customer, Product, RetailSale } from '../types';
import { ICONS } from '../constants';
import { formatCurrency, retailPaidAmount, retailRemaining } from '../src/utils';
import ModalPortal from './ModalPortal';

interface DashboardCashProps {
  retailSales: RetailSale[];
  products: Product[];
  /** Нужны, чтобы показать, кто именно должен */
  customers?: Customer[];
  /** Переход в карточку должника из расшифровки */
  onSelectCustomer?: (id: string) => void;
  onAction: (action: string) => void;
  showCents?: boolean;
}

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const startOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};

/**
 * Вкладка «Наличные» на главном экране.
 *
 * Отвечает на три вопроса, ради которых в магазин заглядывают в течение дня:
 * сколько наторговали, что заканчивается, что пробили последним. Разбор по
 * товарам и периодам живёт в отчётах — здесь он только заслонил бы главное.
 *
 * Прибыль берём из самих чеков: цена и себестоимость зафиксированы в момент
 * продажи, и пересчёт по нынешним значениям переписывал бы прошлую маржу после
 * каждой переоценки.
 */
const DashboardCash: React.FC<DashboardCashProps> = ({ retailSales, products, customers = [], onSelectCustomer, onAction, showCents = false }) => {
  const [debtOpen, setDebtOpen] = useState(false);
  const live = useMemo(() => retailSales.filter(s => !s.isCancelled), [retailSales]);

  const sum = (list: RetailSale[]) => ({
    revenue: list.reduce((s, x) => s + x.total, 0),
    profit: list.reduce((s, x) => s + x.profit, 0),
    checks: list.length,
  });

  const today = useMemo(() => {
    const from = startOfToday();
    return sum(live.filter(s => new Date(s.date).getTime() >= from));
  }, [live]);

  const month = useMemo(() => {
    const from = startOfMonth();
    return sum(live.filter(s => new Date(s.date).getTime() >= from));
  }, [live]);

  const avgCheck = today.checks ? today.revenue / today.checks : 0;

  // Выручка считается по отгрузке, но деньги за долговой чек ещё не пришли.
  // Одна выручка обещала бы деньги, которых в кассе нет, — поэтому долг стоит
  // рядом с ней отдельной карточкой, а не примечанием мелким шрифтом.
  //
  // Группируем по клиенту, а не по чеку: спрашивают долг с человека, и три его
  // чека по отдельности заставляют складывать в уме.
  const debtors = useMemo(() => {
    const map = new Map<string, { name: string; amount: number; sales: RetailSale[] }>();
    live.forEach(s => {
      const left = retailRemaining(s);
      if (left <= 0) return;
      const key = s.customerId || 'unknown';
      const cur = map.get(key) || {
        name: customers.find(c => c.id === s.customerId)?.name || 'Без карточки клиента',
        amount: 0, sales: [] as RetailSale[],
      };
      cur.amount += left;
      cur.sales.push(s);
      map.set(key, cur);
    });
    const rows = Array.from(map.entries())
      .map(([customerId, v]) => ({ customerId, ...v }))
      .sort((a, b) => b.amount - a.amount);
    return { rows, total: rows.reduce((sum, r) => sum + r.amount, 0) };
  }, [live, customers]);

  const recent = useMemo(
    () => [...live].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 6),
    [live]
  );

  // Товар, упавший до минимального остатка. Это единственная цифра на экране,
  // которая требует действия сегодня, — поэтому она рядом с выручкой, а не в
  // отчётах, куда заходят раз в неделю.
  const low = useMemo(
    () => products
      .filter(p => !p.isArchived && p.minStock !== undefined && p.minStock !== null && (p.stock ?? 0) <= p.minStock)
      .sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0))
      .slice(0, 5),
    [products]
  );

  const card = 'bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4';

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      {/* Долг встаёт рядом с выручкой, а не под ней: это две стороны одного
          вопроса «сколько заработали и сколько из этого ещё не получили».
          Карточка появляется только при долге — постоянный ноль ничего не
          сообщает, а возникшая строка заметна. */}
      <div className={`grid gap-3 ${debtors.total > 0 ? 'sm:grid-cols-[1.4fr_1fr]' : ''}`}>
        <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-6 text-center">
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Выручка сегодня</p>
          <p className="text-4xl font-extrabold text-slate-900 dark:text-white leading-none mt-1">
            {formatCurrency(today.revenue, showCents)} <span className="text-2xl text-slate-400">₽</span>
          </p>
          <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-1">
            прибыль {formatCurrency(today.profit, showCents)} ₽
          </p>
        </div>

        {debtors.total > 0 && (
          <button onClick={() => setDebtOpen(true)}
                  className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-3xl border border-amber-200 dark:border-amber-900/50 shadow-sm p-6 text-center active:scale-[0.99] transition-transform">
            <p className="text-[11px] font-bold text-amber-500 dark:text-amber-400/80 uppercase tracking-wider">Нам должны</p>
            <p className="text-3xl font-extrabold text-amber-600 dark:text-amber-400 leading-none mt-1">
              {formatCurrency(debtors.total, showCents)} <span className="text-xl opacity-60">₽</span>
            </p>
            <p className="text-xs font-bold text-slate-400 mt-1">
              {debtors.rows.length} {debtors.rows.length === 1 ? 'клиент' : 'клиентов'} · подробнее
            </p>
          </button>
        )}
      </div>

      {debtOpen && (
        <ModalPortal>
          <div className="fixed inset-0 z-modal flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
               onClick={() => setDebtOpen(false)}>
            <div className="bg-white dark:bg-slate-800 w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[75vh] flex flex-col animate-slide-up-sheet"
                 onClick={e => e.stopPropagation()}>
              <div className="px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-700">
                <h3 className="font-bold text-slate-800 dark:text-white">Нам должны</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  По продажам в долг · {formatCurrency(debtors.total, showCents)} ₽
                </p>
              </div>
              <div className="overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
                {debtors.rows.map(r => (
                  <button key={r.customerId}
                          onClick={() => {
                            if (r.customerId !== 'unknown' && onSelectCustomer) {
                              setDebtOpen(false);
                              onSelectCustomer(r.customerId);
                            }
                          }}
                          className="w-full px-5 py-3 text-left active:bg-slate-50 dark:active:bg-slate-700/50">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-slate-800 dark:text-white truncate">{r.name}</p>
                      <p className="font-bold text-amber-600 dark:text-amber-400 shrink-0">
                        {formatCurrency(r.amount, showCents)} ₽
                      </p>
                    </div>
                    {/* Из чего сложился долг: без этого «12 400 ₽» невозможно
                        ни проверить, ни обсудить с самим должником. */}
                    <div className="mt-1 space-y-0.5">
                      {r.sales.map(sale => (
                        <p key={sale.id} className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {sale.docNumber ? `№${sale.docNumber} · ` : ''}
                          {new Date(sale.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                          {' · '}{formatCurrency(retailRemaining(sale), showCents)} ₽
                          {retailPaidAmount(sale) > 0 ? ` (внесено ${formatCurrency(retailPaidAmount(sale), showCents)} ₽)` : ''}
                        </p>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => onAction('RETAIL_SALE')}
          className="flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white py-4 rounded-2xl font-bold shadow-sm active:scale-95 transition-transform"
        >
          <span className="text-lg">+</span> Продажа
        </button>
        <button
          onClick={() => onAction('WAREHOUSE')}
          className="flex items-center justify-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 py-4 rounded-2xl font-bold active:scale-95 transition-transform"
        >
          <span className="opacity-70">{ICONS.Archive}</span> Склад
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Чеков сегодня', value: String(today.checks) },
          { label: 'Средний чек', value: `${formatCurrency(avgCheck, showCents)} ₽` },
          { label: 'Позиций в каталоге', value: String(products.filter(p => !p.isArchived).length) },
        ].map(s => (
          <div key={s.label} className={card}>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1 leading-tight">{s.label}</p>
            <p className="text-lg font-bold text-slate-800 dark:text-white truncate">{s.value}</p>
          </div>
        ))}
      </div>

      <div className={card}>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">С начала месяца</p>
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-2xl font-bold text-slate-800 dark:text-white">
              {formatCurrency(month.revenue, showCents)} ₽
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{month.checks} чеков</p>
          </div>
          <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
            +{formatCurrency(month.profit, showCents)} ₽
          </p>
        </div>
      </div>

      {low.length > 0 && (
        <div>
          <h3 className="font-bold text-slate-800 dark:text-white mb-2 flex items-center gap-2">
            <span className="w-1 h-5 bg-amber-500 rounded-full" />
            Заканчивается
          </h3>
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
            {low.map(p => (
              <button key={p.id} onClick={() => onAction('WAREHOUSE')}
                      className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left active:bg-slate-50 dark:active:bg-slate-700/50">
                <p className="font-semibold text-slate-800 dark:text-white truncate">{p.name}</p>
                <p className="text-sm font-bold text-amber-600 dark:text-amber-400 shrink-0">
                  {p.stock ?? 0} {p.unit || 'шт'}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="font-bold text-slate-800 dark:text-white mb-2 flex items-center gap-2">
          <span className="w-1 h-5 bg-emerald-500 rounded-full" />
          Последние чеки
        </h3>
        {recent.length === 0 ? (
          <p className={`${card} text-sm text-slate-500 dark:text-slate-400 text-center`}>
            Продаж пока не было. Первый чек — по кнопке «Продажа».
          </p>
        ) : (
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
            {recent.map(s => (
              <div key={s.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 dark:text-white truncate">
                    {s.items.map(i => i.name).join(', ') || 'Продажа'}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {s.docNumber ? `№${s.docNumber} · ` : ''}
                    {new Date(s.date).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <p className="font-bold text-slate-800 dark:text-white shrink-0">
                  {formatCurrency(s.total, showCents)} ₽
                </p>
              </div>
            ))}
          </div>
        )}
        <button onClick={() => onAction('OPERATIONS')}
                className="w-full mt-2 py-2.5 rounded-xl text-sm font-bold text-slate-500 dark:text-slate-400 active:bg-slate-100 dark:active:bg-slate-700/50">
          Все операции
        </button>
      </div>
    </div>
  );
};

export default DashboardCash;
