import React, { useMemo, useState } from 'react';
import type { Product, RetailSale } from '../types';
import TopBarBack from './TopBarBack';
import TabPill from './TabPill';

interface ShopReportProps {
  sales: RetailSale[];
  products: Product[];
  onBack: () => void;
  showCents?: boolean;
}

type Period = 'TODAY' | 'WEEK' | 'MONTH' | 'ALL';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'TODAY', label: 'Сегодня' },
  { key: 'WEEK', label: 'Неделя' },
  { key: 'MONTH', label: 'Месяц' },
  { key: 'ALL', label: 'Всё время' },
];

const money = (v: number, cents = false) =>
  v.toLocaleString('ru-RU', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });

const periodStart = (p: Period) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (p === 'TODAY') return d;
  if (p === 'WEEK') { d.setDate(d.getDate() - 6); return d; }
  if (p === 'MONTH') { d.setDate(d.getDate() - 29); return d; }
  return new Date(0);
};

/**
 * Отчёты магазина.
 *
 * Считаем по данным самих чеков, а не по текущим ценам товаров: цена и
 * себестоимость зафиксированы в момент продажи, и пересчёт по нынешним
 * значениям задним числом переписал бы прошлую маржу после каждой переоценки.
 */
const ShopReport: React.FC<ShopReportProps> = ({ sales, products, onBack, showCents = false }) => {
  const [period, setPeriod] = useState<Period>('MONTH');

  const scoped = useMemo(() => {
    const from = periodStart(period).getTime();
    return sales.filter(s => !s.isCancelled && new Date(s.date).getTime() >= from);
  }, [sales, period]);

  const totals = useMemo(() => ({
    revenue: scoped.reduce((s, x) => s + x.total, 0),
    profit: scoped.reduce((s, x) => s + x.profit, 0),
    cost: scoped.reduce((s, x) => s + x.cost, 0),
    discount: scoped.reduce((s, x) => s + x.discount, 0),
    checks: scoped.length,
    units: scoped.reduce((s, x) => s + x.items.reduce((n, i) => n + i.quantity, 0), 0),
  }), [scoped]);

  const avgCheck = totals.checks ? totals.revenue / totals.checks : 0;
  const margin = totals.revenue ? (totals.profit / totals.revenue) * 100 : 0;

  const byProduct = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number; profit: number }>();
    scoped.forEach(sale => {
      sale.items.forEach(i => {
        const cur = map.get(i.productId) || { name: i.name, qty: 0, revenue: 0, profit: 0 };
        cur.qty += i.quantity;
        cur.revenue += i.price * i.quantity;
        cur.profit += (i.price - (i.buyPrice || 0)) * i.quantity;
        map.set(i.productId, cur);
      });
    });
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [scoped]);

  // Залежавшийся товар: на складе есть, а за период не продавался ни разу.
  // Это деньги, которые лежат мёртвым грузом, — их видно только таким сравнением.
  const stale = useMemo(() => {
    const sold = new Set<string>();
    scoped.forEach(s => s.items.forEach(i => sold.add(i.productId)));
    return products
      .filter(p => !p.isArchived && (p.stock || 0) > 0 && !sold.has(p.id))
      .map(p => ({ ...p, frozen: (p.stock || 0) * (p.buyPrice || 0) }))
      .sort((a, b) => b.frozen - a.frozen)
      .slice(0, 10);
  }, [products, scoped]);

  const card = 'bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4';

  return (
    <div className="space-y-4 pb-10">
      <div className="flex items-center gap-3">
        <TopBarBack onClick={onBack} />
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">Отчёт магазина</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Розничные продажи и маржа</p>
        </div>
      </div>

      <div className="relative flex p-1 rounded-[22px] bg-white/60 dark:bg-slate-800/60 border border-white/70 dark:border-slate-700 shadow-sm">
        <TabPill index={PERIODS.findIndex(p => p.key === period)} count={PERIODS.length} pad={4} />
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)}
                  className={`relative z-10 flex-1 min-w-0 py-2 text-xs font-bold rounded-xl transition-colors ${
                    period === p.key ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400'
                  }`}>
            <span className="truncate">{p.label}</span>
          </button>
        ))}
      </div>

      <div className={`${card} text-center`}>
        <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Выручка</p>
        <p className="text-4xl font-extrabold text-slate-900 dark:text-white leading-none mt-1">
          {money(totals.revenue, showCents)} <span className="text-2xl text-slate-400">₽</span>
        </p>
        <p className="text-sm text-emerald-600 dark:text-emerald-400 font-bold mt-1">
          прибыль {money(totals.profit, showCents)} ₽ · маржа {margin.toFixed(1)}%
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Чеков', value: String(totals.checks) },
          { label: 'Средний чек', value: `${money(avgCheck, showCents)} ₽` },
          { label: 'Продано единиц', value: money(totals.units) },
          { label: 'Скидок дано', value: `${money(totals.discount, showCents)} ₽` },
        ].map(s => (
          <div key={s.label} className={card}>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">{s.label}</p>
            <p className="text-xl font-bold text-slate-800 dark:text-white">{s.value}</p>
          </div>
        ))}
      </div>

      <div>
        <h3 className="font-bold text-slate-800 dark:text-white mb-2">Товары по выручке</h3>
        {byProduct.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-4">За период продаж не было.</p>
        ) : (
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
            {byProduct.slice(0, 20).map(p => (
              <div key={p.name} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 dark:text-white truncate">{p.name}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{money(p.qty)} ед.</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-slate-800 dark:text-white">{money(p.revenue, showCents)} ₽</p>
                  <p className={`text-[11px] font-bold ${p.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
                    {money(p.profit, showCents)} ₽
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {stale.length > 0 && (
        <div>
          <h3 className="font-bold text-slate-800 dark:text-white mb-1">Не продавалось за период</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
            Товар лежит на складе, деньги в нём заморожены
          </p>
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
            {stale.map(p => (
              <div key={p.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 dark:text-white truncate">{p.name}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {money(p.stock || 0)} {p.unit || 'шт'}
                  </p>
                </div>
                {p.frozen > 0 && (
                  <p className="text-sm font-bold text-amber-600 dark:text-amber-400 shrink-0">
                    {money(p.frozen, showCents)} ₽
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ShopReport;
