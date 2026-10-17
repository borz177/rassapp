import React, { useEffect, useMemo, useState } from 'react';
import { api, type AdminAiReport } from '../services/api';
import { friendlyError } from '../src/friendlyError';

/**
 * FinUchetGPT в админке: сколько запросов и денег на модель уходит по каждому
 * пользователю за месяц и сколько приносят тарифы ИИ. Отсюда видно, окупается
 * ли ассистент и кто тратит пробные запросы, не покупая тариф.
 * Стоимость модели — в долларах, как её считает OpenRouter.
 */

const usd = (n: number) => `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`;
const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;
const monthName = (m: string) => {
  const [y, mm] = m.split('-').map(Number);
  return new Date(y, mm - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
};

const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: string }> = ({ label, value, hint, tone }) => (
  <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4">
    <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">{label}</div>
    <div className={`mt-1 text-2xl font-bold tabular-nums ${tone || 'text-slate-800 dark:text-white'}`}>{value}</div>
    {hint && <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{hint}</div>}
  </div>
);

const AdminAI: React.FC = () => {
  const [report, setReport] = useState<AdminAiReport | null>(null);
  const [month, setMonth] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = async (m = month) => {
    setLoading(true);
    setError(null);
    try { setReport(await api.adminGetAi(m)); }
    catch (e) { setError(friendlyError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const users = report?.users || [];
  const current = report?.months.find(m => m.month === report.month);
  const totals = useMemo(() => ({
    requests: users.reduce((s, u) => s + u.requests, 0),
    cost: users.reduce((s, u) => s + u.costUsd, 0),
    active: users.filter(u => u.requests > 0).length,
    paid: users.filter(u => u.plan).length,
  }), [users]);
  const q = search.trim().toLowerCase();
  const shown = q ? users.filter(u => `${u.name} ${u.email}`.toLowerCase().includes(q)) : users;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(report?.months || []).map(m => (
          <button key={m.month} onClick={() => { setMonth(m.month); load(m.month); }}
                  className={`px-3.5 py-2 rounded-full text-xs font-bold capitalize transition ${report?.month === m.month
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
            {monthName(m.month)}
          </button>
        ))}
        <button onClick={() => load()} disabled={loading}
                className="ml-auto px-3.5 py-2 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300 disabled:opacity-50">
          {loading ? 'Загрузка…' : 'Обновить'}
        </button>
      </div>

      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Запросов" value={totals.requests.toLocaleString('ru-RU')} hint={report ? monthName(report.month) : ''} />
        <Stat label="Пользовались" value={totals.active} hint={`с тарифом ИИ: ${totals.paid}`} />
        <Stat label="Расход на модель" value={usd(totals.cost)} hint={totals.requests ? `${usd(totals.cost / totals.requests)} за запрос` : ' '} tone="text-rose-600 dark:text-rose-400" />
        <Stat label="Выручка ИИ" value={rub(current?.revenueRub || 0)} hint={`оплат: ${current?.payments || 0}`} tone="text-emerald-600 dark:text-emerald-400" />
        <Stat label="Месяцев в учёте" value={report?.months.length || 0} hint="по месяцам — кнопки выше" />
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по имени или почте"
             className="w-full px-4 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-800 dark:text-white outline-none" />

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-bold uppercase tracking-wide text-slate-400 border-b border-slate-100 dark:border-slate-700">
              <th className="px-4 py-3">Пользователь</th>
              <th className="px-4 py-3">Тариф ИИ</th>
              <th className="px-4 py-3 text-right">Запросы</th>
              <th className="px-4 py-3 text-right">Токены</th>
              <th className="px-4 py-3 text-right">Стоимость</th>
              <th className="px-4 py-3">Настройки</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {shown.map(u => (
              <tr key={u.id} className="align-top">
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-800 dark:text-white">{u.name || '—'}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{u.email}</div>
                  {!u.consent && <div className="text-xs text-amber-600 dark:text-amber-400">без согласия</div>}
                </td>
                <td className="px-4 py-3">
                  {u.plan
                    ? <><div className="font-medium text-violet-700 dark:text-violet-300">{u.plan}</div>
                        <div className="text-xs text-slate-400">до {new Date(u.planExpiresAt!).toLocaleDateString('ru-RU')}</div></>
                    : <div className="text-xs text-slate-500 dark:text-slate-400">пробный: {u.trialUsed} из {u.trialTotal}</div>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-200">{u.requests.toLocaleString('ru-RU')}</td>
                <td className="px-4 py-3 text-right tabular-nums text-xs text-slate-500 dark:text-slate-400">
                  {(u.promptTokens + u.completionTokens).toLocaleString('ru-RU')}
                  <div className="text-[11px] text-slate-400">ответ: {u.completionTokens.toLocaleString('ru-RU')}</div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-800 dark:text-white">{usd(u.costUsd)}</td>
                <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                  <div>порог «Авто»: {u.autoLimit == null ? 'нет' : rub(u.autoLimit)}</div>
                  <div>сводка: {u.morningDigest ? 'вкл' : 'выкл'}</div>
                </td>
              </tr>
            ))}
            {!shown.length && !loading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Никто ещё не пользовался ассистентом</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AdminAI;
