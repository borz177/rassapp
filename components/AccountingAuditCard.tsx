import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileSearch, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import GlassSheet from './GlassSheet';
import { api } from '../services/api';
import { friendlyError } from '../src/friendlyError';
import type {
  AuditReport,
  AuditSeverity,
  AuditSource,
  AuditSourceRef,
  AuditSummary,
} from '../src/accountingAudit';
const money = (n: number) => `${n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
const levels: { key: AuditSeverity; label: string; color: string }[] = [
  { key: 'confirmed', label: 'Несоответствия', color: 'text-rose-600 dark:text-rose-400' },
  { key: 'review', label: 'Уточнить', color: 'text-amber-600 dark:text-amber-400' },
  { key: 'information', label: 'Особенности', color: 'text-slate-500 dark:text-slate-400' },
];
const button =
  'px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-50 aria-pressed:border-violet-500 aria-pressed:ring-1 aria-pressed:ring-violet-500';
export default function AccountingAuditCard({
  report,
  onExplain,
  onRefresh,
  onOpenContract,
  disabled = false,
}: {
  report: AuditSummary;
  onExplain: (id: string) => void;
  onRefresh: (accountIds: string[] | null) => Promise<void>;
  onOpenContract: (id: string, customerId?: string) => void | Promise<void>;
  disabled?: boolean;
}) {
  const key = `finuchet_audit_view_${report.id}`;
  const saved = () => {
    try {
      return JSON.parse(sessionStorage.getItem(key) || '{}');
    } catch {
      return {};
    }
  };
  const [startOffset, setStartOffset] = useState(() => Math.max(0, Math.floor(Number(saved().offset) || 0)));
  const [level, setLevel] = useState<string>(() => saved().level || ''),
    [kind, setKind] = useState<string>(() => saved().kind || ''),
    [opened, setOpened] = useState<string | null>(() => saved().opened || null);
  const [data, setData] = useState<AuditReport | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [source, setSource] = useState<AuditSource | null>(null),
    [sourceBusy, setSourceBusy] = useState<string | null>(null),
    [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(
        key,
        JSON.stringify({
          level,
          kind,
          opened,
          offset:
            data && opened && data.findings.some((f) => f.id === opened)
              ? data.offset + Math.floor(data.findings.findIndex((f) => f.id === opened) / 30) * 30
              : data?.offset ?? startOffset,
        })
      );
    } catch {}
  }, [key, level, kind, opened, data, startOffset]);
  useEffect(() => {
    let alive = true;
    const n = ++generation.current;
    setLoading(true);
    setError('');
    setData(null);
    api.aiAssistant.accountingAudit
      .report(report.id, { severity: level, kind, offset: startOffset, limit: 30 })
      .then((r) => {
        if (alive && n === generation.current) setData(r);
      })
      .catch((e) => {
        if (alive) setError(friendlyError(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [report.id, level, kind, startOffset]);
  const more = async () => {
    if (!data || loading) return;
    const n = generation.current;
    setLoading(true);
    try {
      const r = await api.aiAssistant.accountingAudit.report(report.id, {
        severity: level,
        kind,
        offset: data.offset + data.findings.length,
        limit: 30,
      });
      if (mounted.current && n === generation.current)
        setData((prev) =>
          prev ? { ...r, offset: prev.offset, findings: [...prev.findings, ...r.findings] } : r
        );
    } catch (e) {
      if (mounted.current) setError(friendlyError(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  };
  const open = async (s: AuditSourceRef) => {
    if (sourceBusy) return;
    setSourceBusy(s.kind + s.id);
    setError('');
    try {
      const live = await api.aiAssistant.accountingAudit.source(report.id, s);
      if (!mounted.current) return;
      if (s.kind === 'contract') await onOpenContract(live.contractId || live.id, live.customerId);
      else setSource(live);
    } catch (e) {
      if (mounted.current) setError(friendlyError(e));
    } finally {
      if (mounted.current) setSourceBusy(null);
    }
  };
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh(report.scope.accountIds);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  };
  const current = data || report,
    stale = !!current.stale;
  return (
    <div
      className="rounded-3xl border border-violet-200 dark:border-violet-500/30 bg-violet-50/60 dark:bg-violet-500/10 p-4 space-y-3"
      aria-label="Проверка учёта"
    >
      <div className="flex items-start gap-2">
        <FileSearch className="shrink-0 text-violet-600 mt-0.5" size={19} />
        <div className="min-w-0">
          <h3 className="font-bold text-slate-900 dark:text-white">Проверка учёта</h3>
          <p className="text-xs text-slate-500 break-words">
            {current.scope.label}
            {current.scope.includesArchived ? ' · включая архивные' : ''}
          </p>
        </div>
      </div>
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{current.summary}</p>
      <p className="text-[11px] text-slate-500">
        {new Date(current.calculatedAt).toLocaleString('ru-RU', {
          timeZone: 'Europe/Moscow',
          dateStyle: 'short',
          timeStyle: 'short',
        })}{' '}
        · по Москве
      </p>
      <p className="text-xs text-slate-500">
        Счетов: {current.checked.accounts} · договоров: {current.checked.contracts} · оплат:{' '}
        {current.checked.payments} · расходов: {current.checked.expenses}
      </p>
      {stale && (
        <p
          role="status"
          className="rounded-xl p-3 text-xs text-amber-800 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-300"
        >
          Учёт изменился. Это результат прошлой проверки — обновите его перед объяснением ИИ.
        </p>
      )}
      <div className="flex flex-wrap gap-1.5" aria-label="Вид проверки">
        <button
          className={button}
          aria-pressed={!level}
          onClick={() => {
            setStartOffset(0);
            setLevel('');
          }}
        >
          Все
        </button>
        {levels.map((l) => (
          <button
            key={l.key}
            className={`${button} ${l.color}`}
            aria-pressed={level === l.key}
            onClick={() => {
              setStartOffset(0);
              setLevel(l.key);
            }}
          >
            {l.label} · {current.counts[l.key]}
          </button>
        ))}
      </div>
      <select
        aria-label="Тип записи"
        value={kind}
        onChange={(e) => {
          setStartOffset(0);
          setKind(e.target.value);
        }}
        className="w-full rounded-xl p-2 text-xs border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
      >
        <option value="">Все записи</option>
        <option value="contract">Договоры</option>
        <option value="payment">Платежи</option>
        <option value="expense">Расходы</option>
        <option value="income">Внесения</option>
        <option value="account">Счета</option>
      </select>
      {error && (
        <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
      <div className="max-h-72 overflow-y-auto overscroll-contain space-y-2" aria-label="Записи проверки">
        {data?.findings.map((f) => (
          <div
            key={f.id}
            className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden"
          >
            <button
              type="button"
              onClick={() => setOpened(opened === f.id ? null : f.id)}
              aria-expanded={opened === f.id}
              className="w-full text-left p-3 flex gap-2 justify-between"
            >
              <span className="min-w-0">
                <span
                  className={`block text-[10px] font-bold uppercase ${
                    levels.find((l) => l.key === f.severity)?.color
                  }`}
                >
                  {levels.find((l) => l.key === f.severity)?.label}
                </span>
                <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {f.title}
                </span>
                {(f.customer || f.product) && (
                  <span className="block text-xs text-slate-500 mt-1">
                    {[f.customer, f.product].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
              <ChevronDown
                size={16}
                className={`shrink-0 mt-1 text-slate-400 transition-transform ${
                  opened === f.id ? 'rotate-180' : ''
                }`}
              />
            </button>
            <div
              className="grid transition-[grid-template-rows] duration-200"
              style={{ gridTemplateRows: opened === f.id ? '1fr' : '0fr' }}
            >
              <div className="overflow-hidden" inert={opened !== f.id} aria-hidden={opened !== f.id}>
                <div className="px-3 pb-3 space-y-2">
                  <p className="text-xs text-slate-600 dark:text-slate-300">{f.explanation}</p>
                  {!!f.facts.length && (
                    <dl className="rounded-xl bg-slate-50 dark:bg-slate-900 p-2 space-y-1">
                      {f.facts.map((v, i) => (
                        <div key={i} className="flex justify-between gap-3 text-xs">
                          <dt className="text-slate-500">{v.label}</dt>
                          <dd className="text-right text-slate-800 dark:text-slate-200 break-words">
                            {v.format === 'money' ? money(Number(v.value)) : String(v.value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {f.difference !== undefined && (
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                      Разница этого сравнения: {money(f.difference)}
                    </p>
                  )}
                  <p className="text-xs text-slate-500">{f.nextStep}</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {f.sources.map((s, i) => (
                      <button
                        key={s.kind + s.id + i}
                        disabled={!!sourceBusy}
                        className={button}
                        onClick={() => open(s)}
                      >
                        {sourceBusy === s.kind + s.id ? 'Открываю…' : s.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      {loading && (
        <p role="status" className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 size={14} className="animate-spin" />
          Читаю записи…
        </p>
      )}
      {data && !data.findings.length && !loading && (
        <p className="text-xs text-slate-500">В этой группе записей нет.</p>
      )}
      {data && data.offset > 0 && (
        <button
          disabled={loading}
          className={`${button} w-full`}
          onClick={() => setStartOffset(Math.max(0, data.offset - 30))}
        >
          Предыдущие записи
        </button>
      )}
      {data?.hasMore && (
        <button disabled={loading} className={`${button} w-full`} onClick={more}>
          Показать ещё
        </button>
      )}
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={refreshing || disabled} onClick={refresh}>
          <RefreshCw size={13} className={`inline mr-1 ${refreshing ? 'animate-spin' : ''}`} />
          Обновить проверку
        </button>
        <button
          className={button}
          disabled={stale || disabled || loading || !!error || !data}
          onClick={() => onExplain(report.id)}
        >
          <Sparkles size={13} className="inline mr-1" />
          Объяснить с ИИ
        </button>
      </div>
      <p className="text-[11px] text-slate-500">
        Сверка и просмотр записей — без обращения к модели. Объяснение ИИ использует запрос агента.
      </p>
      <details className="text-[11px] text-slate-500">
        <summary className="cursor-pointer">Что проверено</summary>
        <ul className="mt-1 space-y-1">
          {(data?.limitations || []).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </details>
      {source && (
        <GlassSheet
          title={source.title}
          subtitle={source.customer || source.accountName}
          onClose={() => setSource(null)}
          cancelLabel="Закрыть"
        >
          <div className="space-y-3 text-sm">
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{money(source.amount)}</p>
            <p className="text-slate-500">{source.accountName}</p>
            {source.date && (
              <p className="text-slate-500">
                {new Date(source.date).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}
              </p>
            )}
            {source.category && <p className="text-slate-600 dark:text-slate-300">{source.category}</p>}
            {source.discountAmount > 0 && <p>Скидка: {money(source.discountAmount)}</p>}
            {source.remainingAmount !== undefined && <p>Долг по договору: {money(source.remainingAmount)}</p>}
            {source.stale && (
              <p className="text-xs text-amber-600">Показана текущая запись. После отчёта учёт изменился.</p>
            )}
            {source.contractId && (
              <button
                className={button}
                onClick={async () => {
                  try {
                    await onOpenContract(source.contractId!, source.customerId);
                    setSource(null);
                  } catch (e) {
                    setError(friendlyError(e));
                    setSource(null);
                  }
                }}
              >
                Открыть договор
              </button>
            )}
          </div>
        </GlassSheet>
      )}
    </div>
  );
}
