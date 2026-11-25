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
  AuditRepairPreview,
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
  onExplainWithAI,
  onRefresh,
  onOpenContract,
  onDataChanged,
  disabled = false,
}: {
  report: AuditSummary;
  onExplain: (id: string) => void;
  onExplainWithAI?: (id: string) => void;
  onRefresh: (accountIds: string[] | null) => Promise<void>;
  onOpenContract: (id: string, customerId?: string) => void | Promise<void>;
  onDataChanged?: () => void;
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
  const [reviewBusy,setReviewBusy]=useState<string|null>(null),[revision,setRevision]=useState(0);
  const [repair,setRepair]=useState<AuditRepairPreview|null>(null),[repairBusy,setRepairBusy]=useState(false),[repairResult,setRepairResult]=useState('');
  const repairLock=useRef(false);
  const repairClosing=useRef(false);
  const reviewLock=useRef(false);
  const [clock,setClock]=useState(Date.now);
  useEffect(()=>{
    setClock(Date.now());
    const deadline=repair?.status==='pending'?repair.expiresAt:repair?.undoUntil;
    if(!deadline)return;
    const delay=new Date(deadline).getTime()-Date.now();
    if(delay<=0)return;
    const timer=setTimeout(()=>setClock(Date.now()),Math.min(delay+10,2147483647));
    return ()=>clearTimeout(timer);
  },[repair]);
  const closeRepair=()=>{
    if(repairLock.current)return;
    const closing=repair;
    setRepair(null);
    repairClosing.current=false;
    if(closing?.status==='pending')void api.aiAssistant.accountingAudit.repairAction(closing.id,'cancel').catch(()=>{});
  };
  const repairOperation=async(fn:()=>Promise<void>)=>{
    if(repairLock.current||repairClosing.current)return;repairLock.current=true;setRepairBusy(true);setError('');
    try{await fn();}catch(e){if(mounted.current)setError(friendlyError(e));}finally{repairLock.current=false;if(mounted.current)setRepairBusy(false);}
  };
  const notifyDataChanged=async()=>{
    try{await onDataChanged?.();}
    catch{if(mounted.current)setError('Изменение сохранено. Обновите данные приложения.');}
  };
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
      .report(report.id, { severity: level==='reviewed'?'':level, status:level==='reviewed'?'reviewed':'open', kind, offset: startOffset, limit: 30 })
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
  }, [report.id, level, kind, startOffset,revision]);
  const more = async () => {
    if (!data || loading) return;
    const n = generation.current;
    setLoading(true);
    try {
      const r = await api.aiAssistant.accountingAudit.report(report.id, {
        severity: level==='reviewed'?'':level,
        status:level==='reviewed'?'reviewed':'open',
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
          Проверка устарела. Обновите её перед объяснением ИИ.
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
        {(!!current.counts.reviewed||level==='reviewed')&&<button className={button} aria-pressed={level==='reviewed'} onClick={()=>{setStartOffset(0);setLevel('reviewed');}}>Проверено · {current.counts.reviewed||0}</button>}
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
                {(f.customer || f.product || f.accountName) && (
                  <span className="block text-xs text-slate-500 mt-1">
                    {f.customer || f.product ? [f.customer, f.product].filter(Boolean).join(' · ') : f.accountName}
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
                  {f.reviewedAt&&<p className="text-xs text-emerald-600">Проверено вами. Это отметка, данные учёта не менялись.</p>}
                  <div className="flex gap-1.5 flex-wrap">
                    {f.repairable&&<button className={button} disabled={stale||disabled||repairBusy} onClick={()=>repairOperation(async()=>{
                      setRepairResult('');const preview=await api.aiAssistant.accountingAudit.prepareRepair(report.id,f.id,crypto.randomUUID());
                      if(mounted.current)setRepair(preview);
                    })}>Подготовить исправление</button>}
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
                    {f.severity!=='confirmed'&&<button className={button} disabled={stale||disabled||!!reviewBusy} onClick={async()=>{
                      if(reviewLock.current)return;reviewLock.current=true;setReviewBusy(f.id);setError('');
                      try{await api.aiAssistant.accountingAudit.review(report.id,f.id,!f.reviewedAt);if(mounted.current){setOpened(null);setStartOffset(0);setRevision(n=>n+1);}}
                      catch(e){if(mounted.current)setError(friendlyError(e));}finally{reviewLock.current=false;if(mounted.current)setReviewBusy(null);}
                    }}>{reviewBusy===f.id?'Сохраняю…':f.reviewedAt?'Вернуть в проверку':'Проверено'}</button>}
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
      {repair&&<GlassSheet title="Исправление графика" cancelLabel={repair.status==='pending'?'Отмена':'Закрыть'} onClose={closeRepair} confirmClose={()=>{if(repairLock.current)return false;repairClosing.current=true;return true;}}>
        <div className="p-4 space-y-4">
          <p className="font-semibold">{repair.customer} · {repair.product}</p>
          <p className="text-sm text-slate-500">Изменится только план. Полученные оплаты и остаток долга сохранятся.</p>
          <div className="rounded-2xl bg-slate-50 dark:bg-slate-800 p-3 text-sm space-y-2">
            <p>Сумма плана: <b>{money(repair.beforeTotal)} → {money(repair.afterTotal)}</b></p>
            <p>Получено: {money(repair.received)} · Долг: {money(repair.remaining)}</p>
          </div>
          <div className="max-h-52 overflow-auto space-y-2 text-sm">{repair.rows.map((row,i)=><div key={row.id} className="flex justify-between gap-3"><span>{i+1}. {new Date(row.date).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'})}</span><span>{money(row.before)} → {money(row.after)}</span></div>)}</div>
          {repairResult&&<p role="status" className="text-sm text-emerald-600">{repairResult}</p>}
          {(repair.status==='expired'||repair.status==='pending'&&new Date(repair.expiresAt).getTime()<=clock)&&<p role="status" className="text-sm text-amber-700 dark:text-amber-300">Срок подтверждения истёк. Подготовьте исправление заново.</p>}
          {error&&<p role="alert" className="text-sm text-rose-600">{error}</p>}
          {repair.status==='pending'&&<button className={`${button} w-full min-h-11`} disabled={repairBusy||disabled||new Date(repair.expiresAt).getTime()<=clock} onClick={()=>repairOperation(async()=>{
            const result=await api.aiAssistant.accountingAudit.repairAction(repair.id,'confirm');
            if(mounted.current){setRepairResult(result.text||'График исправлен.');setRepair({...repair,status:'done',undoUntil:result.undoUntil});setData(old=>old?{...old,stale:true}:old);}
            await notifyDataChanged();
          })}>{repairBusy?'Сохраняю…':'Подтвердить исправление'}</button>}
          {repair.status==='done'&&(!repair.undoUntil||new Date(repair.undoUntil).getTime()>clock)&&<button className={`${button} w-full min-h-11`} disabled={repairBusy||disabled} onClick={()=>repairOperation(async()=>{
            const result=await api.aiAssistant.accountingAudit.repairAction(repair.id,'undo');
            if(mounted.current){setRepairResult(result.text||'Исправление отменено.');setRepair({...repair,status:'undone'});setData(old=>old?{...old,stale:true}:old);}
            await notifyDataChanged();
          })}>Отменить исправление</button>}
          {repair.status==='done'&&<p className="text-xs text-slate-500">Отмена доступна 30 минут, пока договор не изменён. Найти действие можно в журнале.</p>}
        </div>
      </GlassSheet>}
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
          Объяснить результаты
        </button>
        {onExplainWithAI && (
          <button className={button} disabled={stale || disabled || loading || !!error || !data} onClick={() => onExplainWithAI(report.id)}>
            <Sparkles size={13} className="inline mr-1" />
            Подробнее с ИИ
          </button>
        )}
      </div>
      <p className="text-[11px] text-slate-500">
        Сверка и краткое объяснение бесплатны. «Подробнее с ИИ» использует запрос из лимита.
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
