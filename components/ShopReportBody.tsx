import React, { useMemo, useState } from 'react';
import type { Product, RetailSale, StockMovement } from '../types';
import TabPill from './TabPill';
import { retailRemaining } from '../src/utils';
import { abcAnalysis, abcSummary, categoryMargins, productFacts, type AbcClass } from '../src/shopAnalytics';

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

const ABC_TONE: Record<AbcClass, { bar: string; soft: string; text: string }> = {
  A: { bar: 'bg-emerald-500', soft: 'bg-emerald-50 dark:bg-emerald-500/15', text: 'text-emerald-700 dark:text-emerald-300' },
  B: { bar: 'bg-amber-500', soft: 'bg-amber-50 dark:bg-amber-500/15', text: 'text-amber-700 dark:text-amber-300' },
  C: { bar: 'bg-slate-400', soft: 'bg-slate-100 dark:bg-slate-700', text: 'text-slate-600 dark:text-slate-300' },
};

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
  const [rank, setRank] = useState<'revenue' | 'profit'>('profit');
  const [abcFilter, setAbcFilter] = useState<'ALL' | AbcClass>('ALL');
  const [showAllAbc, setShowAllAbc] = useState(false);

  const scoped = useMemo(() => {
    const from = periodStart(period).getTime();
    return sales.filter(s => !s.isCancelled && new Date(s.date).getTime() >= from);
  }, [sales, period]);

  const totals = useMemo(() => ({
    revenue: scoped.reduce((s, x) => s + x.total, 0),
    profit: scoped.reduce((s, x) => s + x.profit, 0),
    discount: scoped.reduce((s, x) => s + x.discount, 0),
    // Возврат — не чек: среднюю покупку он бы занизил
    checks: scoped.filter(x => !x.returnOf).length,
    returns: scoped.filter(x => x.returnOf).reduce((s, x) => s + Math.abs(x.total), 0),
    returnsCount: scoped.filter(x => x.returnOf).length,
    units: scoped.reduce((s, x) => s + x.items.reduce((n, i) => n + i.quantity, 0), 0),
    // Долг считаем по чекам периода: это часть выручки, которая ещё
    // не стала деньгами, и без неё цифра выручки вводит в заблуждение.
    debt: scoped.reduce((s, x) => s + retailRemaining(x), 0),
  }), [scoped]);

  const avgCheck = totals.checks ? totals.revenue / totals.checks : 0;
  const margin = totals.revenue ? (totals.profit / totals.revenue) * 100 : 0;

  const facts = useMemo(() => productFacts(scoped, products), [scoped, products]);
  const abc = useMemo(() => abcAnalysis(facts, rank), [facts, rank]);
  const abcSum = useMemo(() => abcSummary(abc, rank), [abc, rank]);
  const categories = useMemo(() => categoryMargins(facts), [facts]);

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
      if (!s.returnOf) cur.checks += 1;
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
        {totals.debt > 0 && (
          <p className="text-sm text-amber-600 dark:text-amber-400 font-bold mt-1">
            из них не получено {money(totals.debt, showCents)} ₽
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: 'Чеков', value: String(totals.checks) },
          { label: 'Средний чек', value: `${money(avgCheck, showCents)} ₽` },
          { label: 'Продано единиц', value: money(totals.units) },
          { label: 'Скидок дано', value: `${money(totals.discount, showCents)} ₽` },
          { label: 'Возвраты', value: totals.returnsCount ? `${money(totals.returns, showCents)} ₽` : '—', sub: totals.returnsCount ? `${totals.returnsCount} шт` : undefined },
          { label: 'Товаров продано', value: String(facts.filter(f => f.qty > 0).length), sub: 'разных' },
        ].map(s => (
          <div key={s.label} className={card}>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">{s.label}</p>
            <p className="text-xl font-bold text-slate-800 dark:text-white">
              {s.value}{s.sub && <span className="ml-1 text-xs font-semibold text-slate-400">{s.sub}</span>}
            </p>
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

      {/* ABC-анализ: какие товары делают деньги. Сводка A/B/C сверху — ответ
          на вопрос «на чём держится магазин» за секунду, список — подробности. */}
      <div className={card}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-bold text-slate-800 dark:text-white">ABC-анализ товаров</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Какие товары дают {rank === 'profit' ? 'прибыль' : 'выручку'}
            </p>
          </div>
          <div className="shrink-0 flex gap-1 p-0.5 rounded-full bg-slate-100 dark:bg-slate-700">
            {([['profit', 'Прибыль'], ['revenue', 'Выручка']] as const).map(([id, label]) => (
              <button key={id} onClick={() => setRank(id)}
                      className={`px-3 py-1 rounded-full text-[11px] font-bold transition-colors ${
                        rank === id ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500'
                      }`}>{label}</button>
            ))}
          </div>
        </div>

        {abc.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-4">За период продаж не было.</p>
        ) : (
          <>
            {/* Полоса: ширина сегмента — доля товаров, подпись — доля денег */}
            <div className="mt-3 flex h-2.5 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-700">
              {abcSum.filter(x => x.count > 0).map(x => (
                <div key={x.cls} className={ABC_TONE[x.cls].bar} style={{ width: `${x.countShare}%` }} />
              ))}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {abcSum.map(x => (
                <button key={x.cls} type="button" onClick={() => setAbcFilter(abcFilter === x.cls ? 'ALL' : x.cls)}
                        className={`text-left rounded-xl p-2.5 ring-1 transition ${abcFilter === x.cls
                          ? `${ABC_TONE[x.cls].soft} ring-current ${ABC_TONE[x.cls].text}`
                          : 'ring-slate-200 dark:ring-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}>
                  <span className="flex items-center gap-1.5">
                    <span className={`w-5 h-5 rounded-md text-[11px] font-extrabold text-white flex items-center justify-center ${ABC_TONE[x.cls].bar}`}>{x.cls}</span>
                    <span className="text-lg font-extrabold text-slate-900 dark:text-white tabular-nums">{x.valueShare.toFixed(0)}%</span>
                  </span>
                  <span className="block mt-1 text-[11px] leading-tight text-slate-500 dark:text-slate-400">
                    {x.count} {x.count === 1 ? 'товар' : x.count < 5 && x.count > 0 ? 'товара' : 'товаров'} · {x.countShare.toFixed(0)}% ассортимента
                  </span>
                </button>
              ))}
            </div>
            {abcSum[0].count > 0 && (
              <p className="mt-3 text-[12px] leading-snug text-slate-600 dark:text-slate-300">
                <b>{abcSum[0].count}</b> из {abc.length} товаров ({abcSum[0].countShare.toFixed(0)}%) приносят{' '}
                <b>{abcSum[0].valueShare.toFixed(0)}%</b> {rank === 'profit' ? 'прибыли' : 'выручки'} — следите, чтобы
                они всегда были в наличии. Класс C — кандидаты на распродажу или замену.
              </p>
            )}

            <div className="mt-3 -mx-4 border-t border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
              {(() => {
                const list = abc.filter(r => abcFilter === 'ALL' || r.cls === abcFilter);
                const shown = showAllAbc ? list : list.slice(0, 12);
                return (
                  <>
                    {shown.map(r => (
                      <div key={r.productId} className="px-4 py-2.5 flex items-center gap-3">
                        <span className={`w-6 h-6 shrink-0 rounded-md text-[11px] font-extrabold flex items-center justify-center ${ABC_TONE[r.cls].soft} ${ABC_TONE[r.cls].text}`}>{r.cls}</span>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-[13px] text-slate-800 dark:text-white truncate">{r.name}</p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {money(r.qty)} ед. · {r.category} · доля {r.share.toFixed(1)}%
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-bold text-[13px] text-slate-800 dark:text-white tabular-nums">{money(r.revenue, showCents)} ₽</p>
                          <p className={`text-[11px] font-bold tabular-nums ${r.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
                            {money(r.profit, showCents)} ₽
                          </p>
                        </div>
                      </div>
                    ))}
                    {list.length > shown.length && (
                      <button type="button" onClick={() => setShowAllAbc(true)}
                              className="w-full py-2.5 text-xs font-bold text-indigo-600 dark:text-indigo-300">
                        Показать все {list.length}
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          </>
        )}
      </div>

      {/* Маржа по категориям: где зарабатываем, а где просто крутим деньги */}
      {categories.length > 0 && (
        <div className={card}>
          <h3 className="font-bold text-slate-800 dark:text-white">Маржа по категориям</h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">Прибыль ÷ выручка. Полоса — доля категории в прибыли</p>
          <div className="space-y-3">
            {categories.map(c => (
              <div key={c.category}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-[13px] font-semibold text-slate-800 dark:text-white">
                    {c.category} <span className="text-[11px] font-medium text-slate-400">· {c.products} тов.</span>
                  </p>
                  <p className={`shrink-0 text-[13px] font-extrabold tabular-nums ${c.margin >= 25 ? 'text-emerald-600 dark:text-emerald-400' : c.margin >= 10 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-500'}`}>
                    {c.margin.toFixed(1)}%
                  </p>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                  <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(2, c.profitShare)}%` }} />
                </div>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                  выручка {money(c.revenue, showCents)} ₽ · прибыль {money(c.profit, showCents)} ₽ · {c.profitShare.toFixed(0)}% всей прибыли
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

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
