import React, { useEffect, useMemo, useState } from 'react';
import { api, type AdminAiQuality } from '../services/api';
import { friendlyError } from '../src/friendlyError';
import { toast } from '../src/toast';

/** Сигналы сервера, проверки ответа и срабатывания защит. Новые правила
 * начинают действовать только после проверок и решения администратора. */
type SignalGroup = 'all' | 'quality' | 'guard' | 'user';
const GROUPS = [
  { key: 'quality', label: 'Проверки ответа', tone: 'bg-rose-500' },
  { key: 'guard', label: 'Сработала защита', tone: 'bg-amber-400' },
  { key: 'user', label: 'Действия пользователя', tone: 'bg-slate-400' },
] as const;
const groupOf = (kind: string, q: AdminAiQuality | null) => q?.kindGroups?.[kind]
  || (kind === 'cant_do' ? 'wish' : kind === 'stop' || kind === 'undo_soon' ? 'user' : kind.startsWith('guard_') ? 'guard' : 'quality');
const toneOf = (kind: string, q: AdminAiQuality | null) => GROUPS.find(g => g.key === groupOf(kind, q))?.tone || 'bg-slate-400';
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }) : '—';

const AdminAIQuality: React.FC = () => {
  const [q, setQ] = useState<AdminAiQuality | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<SignalGroup>('all');
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try { setQ(await api.adminGetAiQuality()); } catch (e) { setError(friendlyError(e)); }
  };
  useEffect(() => { load(); }, []);

  const totals: Record<string, number> = useMemo(() => {
    const t: Record<string, number> = {};
    for (const r of q?.byDay || []) {
      if (groupOf(r.kind, q) !== 'wish') t[r.kind] = (t[r.kind] || 0) + r.n;
    }
    return t;
  }, [q]);
  const days = useMemo(() => {
    const out: { day: string; n: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
      out.push({ day: d, n: (q?.byDay || []).filter(r => r.day === d && groupOf(r.kind, q) !== 'wish' && (group === 'all' || groupOf(r.kind, q) === group)).reduce((s, r) => s + r.n, 0) });
    }
    return out;
  }, [q, group]);
  const max = Math.max(1, ...days.map(d => d.n));

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try { await fn(); if (ok) toast.success(ok); await load(); }
    catch (e) { toast.error('Не получилось', { message: friendlyError(e) }); }
    finally { setBusy(null); }
  };

  const proposed = (q?.lessons || []).filter(l => l.status === 'proposed');
  const active = (q?.lessons || []).filter(l => l.status === 'active');
  const recent = (q?.recent || []).filter(r => group === 'all' || groupOf(r.kind, q) === group);

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">Сигналы качества · 14 дней</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Один запрос может дать несколько сигналов. Защита не означает ошибочную операцию.</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Новые правила — после проверки и вашего решения</span>
            <button disabled={busy === 'review'} onClick={() => act('review', async () => {
              const r = await api.adminAiReview();
              toast.success(r.cases ? `Разобрано случаев: ${r.cases}, новых выводов: ${r.proposed}` : 'Новых случаев нет');
            })} className="px-3.5 py-2 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300 disabled:opacity-50">
              {busy === 'review' ? 'Разбираю…' : `Разобрать сейчас${q?.pendingReview ? ` (${q.pendingReview})` : ''}`}
            </button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Фильтр сигналов">
          <button type="button" aria-pressed={group === 'all'} onClick={() => setGroup('all')}
            className={`px-3 py-2 rounded-xl text-xs font-semibold border ${group === 'all' ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' : 'border-slate-200 dark:border-slate-700 text-slate-500'}`}>Все</button>
          {GROUPS.map(g => <button type="button" key={g.key} aria-pressed={group === g.key} onClick={() => setGroup(g.key)}
            className={`px-3 py-2 rounded-xl text-xs font-semibold border ${group === g.key ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' : 'border-slate-200 dark:border-slate-700 text-slate-500'}`}>
            <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${g.tone}`} />{g.label} · {Object.entries(totals).filter(([kind]) => groupOf(kind, q) === g.key).reduce((sum, [, n]) => sum + n, 0)}
          </button>)}
        </div>
        <div className="mt-4 flex items-end gap-1 h-20">
          {days.map(d => (
            <div key={d.day} className="flex-1 flex flex-col items-center gap-1" title={`${d.day}: ${d.n}`}>
              <div className="w-full rounded-md bg-violet-400/80 dark:bg-violet-500/70" style={{ height: `${Math.max(d.n ? 6 : 2, (d.n / max) * 64)}px`, opacity: d.n ? 1 : 0.25 }} />
              <span className="text-[9px] text-slate-400 tabular-nums">{d.day.slice(8)}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(totals).filter(([k, n]) => n > 0 && (group === 'all' || groupOf(k, q) === group)).map(([k, n]) => (
            <span key={k} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-50 dark:bg-slate-900/60 text-xs text-slate-600 dark:text-slate-300">
              <span className={`w-2 h-2 rounded-full ${toneOf(k, q)}`} />{q?.kinds[k] || 'Другое событие'}: <b className="tabular-nums">{n}</b>
            </span>
          ))}
        </div>
        <div className="mt-2 text-[11px] text-slate-400">Последний разбор: {when(q?.lastReviewAt || null)} · время по Москве</div>
        <p className="mt-1 text-[11px] text-slate-400">Ночной разбор — от {q?.autoReviewMinSignals || 3} сигналов, около 03:00. Кнопкой «Разобрать сейчас» можно запустить раньше.</p>
      </div>

      {proposed.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-amber-200 dark:border-amber-500/30 p-4 space-y-3">
          <div className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wide">Ждут решения · {proposed.length}</div>
          {proposed.map(l => (
            <div key={l.id} className="rounded-xl bg-amber-50/60 dark:bg-amber-500/5 p-3">
              <p className="text-sm font-semibold text-slate-800 dark:text-white">{l.rule}</p>
              {l.why && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{l.why}{l.cases ? ` · случаев: ${l.cases}` : ''}</p>}
              <div className="mt-2 flex gap-2">
                <button disabled={!!busy} onClick={() => act(`a${l.id}`, () => api.adminAiLesson(l.id, 'apply'), 'Вывод применён — агент учитывает его в ответах')}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white dark:bg-white dark:text-slate-900 disabled:opacity-50">Проверить и применить</button>
                <button disabled={!!busy} onClick={() => act(`r${l.id}`, () => api.adminAiLesson(l.id, 'reject'))}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 disabled:opacity-50">Отклонить</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 space-y-2">
        <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">Действующие выводы · {active.length}</div>
        {!active.length && <p className="text-sm text-slate-400">Пока нет — предложенные правила начнут действовать после проверки и вашего решения</p>}
        {active.map(l => (
          <div key={l.id} className="flex items-start justify-between gap-3 py-2 border-t border-slate-100 dark:border-slate-700 first:border-0">
            <div className="min-w-0">
              <p className="text-sm text-slate-800 dark:text-slate-100">{l.rule}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">с {when(l.decided_at)}{l.why ? ` · ${l.why}` : ''}</p>
            </div>
            <button disabled={!!busy} onClick={() => act(`x${l.id}`, () => api.adminAiLesson(l.id, 'remove'), 'Вывод убран')}
                    className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 disabled:opacity-50">Убрать</button>
          </div>
        ))}
      </div>

      {!!q?.versions?.length && <details className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4">
        <summary className="cursor-pointer text-sm font-semibold">История изменений правил</summary>
        <p className="mt-2 text-xs text-slate-500">Ненужное действующее правило можно отключить кнопкой «Убрать».</p>
        {q.versions.map(v => <p key={v.id} className="mt-2 text-xs text-slate-500">
          {when(v.created_at)} · Правило №{v.lesson_id}: {({apply:'применено после проверки',reject:'отклонено',remove:'отключено'} as Record<string,string>)[v.action] || v.action}
        </p>)}
      </details>}

      {/* Не ошибки, а просьбы о новых умениях: в разбор не идут, по ним решают, что добавить агенту */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 space-y-2">
        <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">Просили, но агент не умеет · {(q?.wishes || []).length}</div>
        <div className="text-[11px] text-slate-400">За полгода, данные клиентов скрыты. Повторяется — кандидат в новое умение</div>
        {!(q?.wishes || []).length && <p className="text-sm text-slate-400">Пока не было</p>}
        {(q?.wishes || []).map((w, i) => (
          <div key={i} className="py-2 border-t border-slate-100 dark:border-slate-700 first:border-0 text-xs">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-slate-800 dark:text-slate-100">«{w.question || '—'}»</span>
              <span className="shrink-0 text-slate-400 tabular-nums">{when(w.created_at)}</span>
            </div>
            {w.answer && <div className="text-slate-400 mt-0.5">→ {w.answer}</div>}
            {w.tool && <div className="text-emerald-600 dark:text-emerald-400 mt-0.5">искал умение: {w.tool}</div>}
          </div>
        ))}
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-x-auto">
        <div className="px-4 pt-4 text-xs font-bold text-slate-400 uppercase tracking-wide">Свежие случаи (данные клиентов скрыты)</div>
        <table className="w-full text-sm mt-2">
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {recent.map((r, i) => (
              <tr key={i} className="align-top">
                <td className="px-4 py-2.5 whitespace-nowrap text-xs text-slate-400 tabular-nums">{when(r.created_at)}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                    <span className={`w-2 h-2 rounded-full ${toneOf(r.kind, q)}`} />{q?.kinds[r.kind] || 'Другое событие'}
                  </span>
                  {r.tool && <div className="text-[11px] text-slate-400">{r.tool}</div>}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-300">
                  {r.question && <div>«{r.question}»</div>}
                  {r.answer && <div className="text-slate-400 mt-0.5">→ {r.answer}</div>}
                  {r.detail && <div className="text-rose-500/80 mt-0.5">{r.detail}</div>}
                </td>
              </tr>
            ))}
            {!recent.length && <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-400">В этой группе свежих сигналов нет</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AdminAIQuality;
