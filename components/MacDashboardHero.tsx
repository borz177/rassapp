import React, { useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Sale } from '../types';
import { formatCurrency } from '../src/utils';

/**
 * Шапка Главной в приложении для Mac: приветствие и график поступлений.
 *
 * Только для Mac (isMacShell): там у содержимого своя карточка и много места по
 * ширине, и Главная может выглядеть как сводка, а не как столбик плиток. На
 * телефоне и на сайте Главная прежняя.
 *
 * График — деньги, реально полученные от клиентов: первые взносы и оплаты по
 * графику, по месяцам. Тот же смысл, что у «Собрано», только во времени.
 */

interface Props {
  /** greeting — приветствие (над вкладками), chart — график (под вкладками и счетами) */
  part: 'greeting' | 'chart';
  userName?: string;
  sales: Sale[];
  showCents?: boolean;
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const RANGES = [
  { id: 6, label: '6 мес' },
  { id: 12, label: 'Год' },
] as const;

const greeting = (h: number) =>
  h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';

const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace('.', ',')} млн`
  : n >= 1000 ? `${Math.round(n / 1000)} тыс` : String(Math.round(n));

const MacDashboardHero: React.FC<Props> = ({ part, userName, sales, showCents }) => {
  const [range, setRange] = useState<6 | 12>(12);
  const now = new Date();
  const firstName = (userName || '').trim().split(/\s+/)[0];

  const data = useMemo(() => {
    const buckets = new Map<string, number>();
    const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
    const months: Date[] = [];
    for (let i = range - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(d);
      buckets.set(key(d), 0);
    }
    const add = (date: string | undefined, amount: number) => {
      if (!date || !(amount > 0)) return;
      const d = new Date(date);
      const k = key(d);
      if (buckets.has(k)) buckets.set(k, (buckets.get(k) || 0) + amount);
    };
    for (const s of sales) {
      if (String(s.customerId || '').startsWith('system_')) continue;
      add(s.startDate, Number(s.downPayment) || 0);
      for (const p of s.paymentPlan || []) {
        if (p.isPaid && p.isRealPayment !== false) add(p.date, Number(p.amount) || 0);
      }
    }
    return months.map(d => ({ label: MONTHS[d.getMonth()], value: buckets.get(key(d)) || 0, full: d }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, range]);

  const thisMonth = data[data.length - 1]?.value || 0;
  const prevMonth = data[data.length - 2]?.value || 0;
  const delta = prevMonth > 0 ? Math.round((thisMonth - prevMonth) / prevMonth * 100) : null;
  const total = data.reduce((s, d) => s + d.value, 0);

  if (part === 'greeting') return (
    <section className="mac-hero">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[30px] leading-tight font-semibold tracking-tight text-slate-900 dark:text-white truncate">
            {greeting(now.getHours())}{firstName ? `, ${firstName}` : ''} <span aria-hidden>👋</span>
          </h1>
          <p className="mt-1 text-[15px] text-slate-500 dark:text-slate-400">
            {now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
      </div>
    </section>
  );

  return (
    <section className="mac-hero">
      <div className="mac-card p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <p className="text-[15px] font-semibold text-slate-900 dark:text-white">Поступления от клиентов</p>
            <div className="mt-2 flex items-baseline gap-3">
              <span className="text-[28px] font-semibold tracking-tight text-slate-900 dark:text-white tabular-nums">
                {formatCurrency(thisMonth, showCents)} <span className="text-[18px] text-slate-400">₽</span>
              </span>
              <span className="text-[13px] text-slate-500 dark:text-slate-400">в этом месяце</span>
              {delta !== null && (
                <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${delta >= 0
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'}`}>
                  {delta >= 0 ? '↑' : '↓'} {Math.abs(delta)}% к прошлому
                </span>
              )}
            </div>
            <p className="mt-1 text-[13px] text-slate-400">За период: {formatCurrency(total, showCents)} ₽</p>
          </div>
          <div className="flex p-1 rounded-full bg-slate-100 dark:bg-white/5 shrink-0">
            {RANGES.map(r => (
              <button key={r.id} type="button" onClick={() => setRange(r.id)}
                      className={`px-3 py-1 rounded-full text-[13px] font-medium transition-colors ${range === r.id
                        ? 'bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="h-[220px] -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="macHeroFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-primary-500, #6366f1)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--color-primary-500, #6366f1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="currentColor" className="text-slate-200 dark:text-white/5" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} />
              <YAxis tickLine={false} axisLine={false} width={76} tick={{ fontSize: 12, fill: '#94a3b8' }} tickFormatter={compact} />
              <Tooltip
                cursor={{ stroke: 'var(--color-primary-400, #818cf8)', strokeDasharray: '4 4' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as { value: number; full: Date };
                  return (
                    <div className="rounded-xl px-3 py-2 bg-white/95 dark:bg-slate-800/95 shadow-lg border border-slate-200/60 dark:border-white/10">
                      <p className="text-[12px] text-slate-500 dark:text-slate-400">
                        {p.full.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
                      </p>
                      <p className="text-[14px] font-semibold text-slate-900 dark:text-white tabular-nums">
                        {formatCurrency(p.value, showCents)} ₽
                      </p>
                    </div>
                  );
                }}
              />
              <Area type="monotone" dataKey="value" stroke="var(--color-primary-500, #6366f1)" strokeWidth={2.5}
                    fill="url(#macHeroFill)" dot={false}
                    activeDot={{ r: 5, strokeWidth: 3, stroke: '#fff', fill: 'var(--color-primary-500, #6366f1)' }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
};

export default MacDashboardHero;
