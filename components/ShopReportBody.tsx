import React, { useMemo, useState } from 'react';
import type { Product, RetailSale, StockMovement } from '../types';
import TabPill from './TabPill';

interface ShopReportBodyProps {
  sales: RetailSale[];
  products: Product[];
  /** Движения по складу — для раздела потерь */
  movements?: StockMovement[];
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
 * Отчёт по рознице — вкладка «Магазин» внутри общих отчётов.
 *
 * Считаем по данным самих чеков, а не по текущим ценам товаров: цена и
 * себестоимость зафиксированы в момент продажи, и пересчёт по нынешним
 * значениям переписывал бы прошлую маржу после каждой переоценки.
 *
 * Свой период, независимый от фильтров рассрочки: у розницы другой горизонт —
 * там смотрят на день и неделю, а не на квартал.
 */
const ShopReportBody: React.FC<ShopReportBodyProps> = ({ sales, products, movements = [], showCents = false }) => {
  const [period, setPeriod] = useState<Period>('MONTH');
  // Самый ходовой товар и самый прибыльный — редко один и тот же, а решения
  // по закупу принимают по второму. Один список с переключателем показывает
  // обе стороны, не заставляя листать два почти одинаковых.
  const [rank, setRank] = useState<'revenue' | 'profit'>('revenue');

  const scoped = useMemo(() => {
    const from = periodStart(period).getTime();
    return sales.filter(s => !s.isCancelled && new Date(s.date).getTime() >= from);
  }, [sales, period]);

  const totals = useMemo(() => ({
    revenue: scoped.reduce((s, x) => s + x.total, 0),
    profit: scoped.reduce((s, x) => s + x.profit, 0),
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
  // Это деньги, лежащие мёртвым грузом, — увидеть их можно только сравнением
  // остатков с продажами, ни в одном из двух списков по отдельности их нет.
  const stale = useMemo(() => {
    const sold = new Set<string>();
    scoped.forEach(s => s.items.forEach(i => sold.add(i.productId)));
    return products
      .filter(p => !p.isArchived && (p.stock || 0) > 0 && !sold.has(p.id))
      .map(p => ({ ...p, frozen: (p.stock || 0) * (p.buyPrice || 0) }))
      .sort((a, b) => b.frozen - a.frozen)
      .slice(0, 10);
  }, [products, scoped]);

  // Динамика: по дням для недели и месяца, по месяцам для всего времени —
  // триста столбиков за год не читаются, а двенадцать отвечают на вопрос
  // «когда торгуем лучше» сразу.
  const byBucket = useMemo(() => {
    const monthly = period === 'ALL';
    const map = new Map<string, { label: string; revenue: number; profit: number; checks: number }>();
    scoped.forEach(s => {
      const d = new Date(s.date);
      const key = monthly
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        : d.toISOString().slice(0, 10);
      const label = monthly
        ? d.toLocaleDateString('ru-RU', { month: 'short' })
        : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
      const cur = map.get(key) || { label, revenue: 0, profit: 0, checks: 0 };
      cur.revenue += s.total;
      cur.profit += s.profit;
      cur.checks += 1;
      map.set(key, cur);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, v]) => ({ key, ...v }))
      .slice(-30);
  }, [scoped, period]);

  const peakBucket = Math.max(1, ...byBucket.map(b => b.revenue));

  // Потери: товар ушёл со склада, но не через кассу. Эти деньги нигде больше не
  // видны — в выручке их нет по определению, а в остатках они уже вычтены.
  const losses = useMemo(() => {
    const from = periodStart(period).getTime();
    const rows = movements.filter(m => m.type === 'WRITE_OFF' && new Date(m.date).getTime() >= from);
    const map = new Map<string, { name: string; qty: number; cost: number; reasons: Set<string> }>();
    rows.forEach(m => {
      const product = products.find(p => p.id === m.productId);
      const cur = map.get(m.productId) || {
        name: product?.name || 'Товар удалён', qty: 0, cost: 0, reasons: new Set<string>(),
      };
      const qty = Math.abs(m.quantity);
      cur.qty += qty;
      cur.cost += qty * (m.unitPrice ?? product?.buyPrice ?? 0);
      if (m.note) cur.reasons.add(m.note.split(' · ')[0]);
      map.set(m.productId, cur);
    });
    const list = Array.from(map.values()).sort((a, b) => b.cost - a.cost);
    return { list, total: list.reduce((s, x) => s + x.cost, 0) };
  }, [movements, products, period]);

  const card = 'bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4';

  return (
    <div className="space-y-4">
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
        <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Выручка розницы</p>
        <p className="text-4xl font-extrabold text-slate-900 dark:text-white leading-none mt-1">
          {money(totals.revenue, showCents)} <span className="text-2xl text-slate-400">₽</span>
        </p>
        <p className="text-sm text-emerald-600 dark:text-emerald-400 font-bold mt-1">
          прибыль {money(totals.profit, showCents)} ₽ · маржа {margin.toFixed(1)}%
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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

      {byBucket.length > 1 && (
        <div className={card}>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-3">
            {period === 'ALL' ? 'Выручка по месяцам' : 'Выручка по дням'}
          </p>
          <div className="flex items-end gap-1 h-28 overflow-x-auto">
            {byBucket.map(b => (
              <div key={b.key} className="flex-1 min-w-[18px] flex flex-col items-center gap-1 group"
                   title={`${b.label}: ${money(b.revenue, showCents)} ₽ · ${b.checks} чеков`}>
                <div className="w-full flex-1 flex items-end">
                  <div className="w-full rounded-t-md bg-gradient-to-t from-emerald-500 to-emerald-400 min-h-[2px]"
                       style={{ height: `${(b.revenue / peakBucket) * 100}%` }} />
                </div>
                <span className="text-[9px] text-slate-400 whitespace-nowrap">{b.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="font-bold text-slate-800 dark:text-white">Товары</h3>
          <div className="flex gap-1 p-0.5 rounded-full bg-slate-100 dark:bg-slate-700">
            {([['revenue', 'По выручке'], ['profit', 'По прибыли']] as const).map(([id, label]) => (
              <button key={id} onClick={() => setRank(id)}
                      className={`px-3 py-1 rounded-full text-[11px] font-bold transition-colors ${
                        rank === id ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500'
                      }`}>{label}</button>
            ))}
          </div>
        </div>
        {byProduct.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-4">За период продаж не было.</p>
        ) : (
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
            {[...byProduct].sort((a, b) => (rank === 'profit' ? b.profit - a.profit : b.revenue - a.revenue)).slice(0, 20).map(p => (
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

      {losses.list.length > 0 && (
        <div>
          <h3 className="font-bold text-slate-800 dark:text-white mb-1">Списано со склада</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
            Товар ушёл не через кассу — на {money(losses.total, showCents)} ₽ по закупу
          </p>
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
            {losses.list.slice(0, 10).map(l => (
              <div key={l.name} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 dark:text-white truncate">{l.name}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {money(l.qty)} ед.{l.reasons.size ? ` · ${Array.from(l.reasons).join(', ')}` : ''}
                  </p>
                </div>
                <p className="text-sm font-bold text-rose-500 shrink-0">−{money(l.cost, showCents)} ₽</p>
              </div>
            ))}
          </div>
        </div>
      )}

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

export default ShopReportBody;
