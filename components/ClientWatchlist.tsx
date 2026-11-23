import React, { useEffect, useId, useRef, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { Customer } from '../types';
import { api } from '../services/api';
import GlassSheet from './GlassSheet';
import { ModalParkContext } from './ModalPortal';
import PassportScan from './PassportScan';
import WatchlistSearchPanel from './WatchlistSearchPanel';
import WatchlistSubmissionForm from './WatchlistSubmissionForm';
import { appConfirm } from '../src/dialogs';
import { WATCHLIST_REASONS, WATCHLIST_STATUS, WatchlistEntry, WatchlistPage, WatchlistStatus, watchlistDate, watchlistSearchText } from '../src/watchlist';
import { WatchlistError, WatchlistField, WatchlistRules, wlButton, wlCard, wlInput, wlSecondary } from './WatchlistUI';

const ClientWatchlist: React.FC<{ customers: Customer[]; userId: string }> = ({ customers, userId }) => {
  const nameInputId = useId();
  const parentParked = React.useContext(ModalParkContext);
  const [status, setStatus] = useState<WatchlistStatus | null>(null), [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [mineOpen, setMineOpen] = useState(false);
  const [accepted, setAccepted] = useState(false), [name, setName] = useState(''), [year, setYear] = useState('');
  const [composing, setComposing] = useState(false);
  const [mine, setMine] = useState<WatchlistEntry[]>([]), [hasMore, setHasMore] = useState(false), [page, setPage] = useState(0);
  const [add, setAdd] = useState(false), [clientQuery, setClientQuery] = useState(''), [draftCustomerId, setDraftCustomerId] = useState<string | null>(null);
  const [reason, setReason] = useState('overdue'), [reasonDetails, setReasonDetails] = useState(''), [response, setResponse] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [selected, setSelected] = useState<WatchlistEntry | null>(null);
  const [notice, setNotice] = useState<string | null>(null), [reports, setReports] = useState<any[]>([]);
  const alive = useRef(true), actionLock = useRef(false);
  const read = async () => {
    if (!alive.current || document.hidden) return;
    const [s, m, a] = await Promise.all([
      api.watchlistRequest<WatchlistStatus>('/watchlist/status'),
      api.watchlistRequest<WatchlistPage<WatchlistEntry>>('/watchlist/mine'),
      api.watchlistRequest<WatchlistPage<any>>('/watchlist/appeals/mine'),
    ]);
    if (alive.current && !document.hidden) { setStatus(s); setMine(m.items); setHasMore(m.hasMore); setPage(0); setReports(a.items); }
  };
  useEffect(() => {
    alive.current = true;
    read().catch(e => alive.current && setError(e.message)).finally(() => alive.current && setLoading(false));
    const clear = () => { setName(''); setYear(''); setDraftCustomerId(null); setAdd(false); setMineOpen(false); setSelected(null); setMine([]); setReports([]); };
    const hidden = () => { if (document.hidden) clear(); else read().catch(() => {}); };
    document.addEventListener('visibilitychange', hidden);
    return () => { alive.current = false; document.removeEventListener('visibilitychange', hidden); };
  }, [userId]);
  const run = async (fn: () => Promise<void>) => {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setError(null); setNotice(null);
    try { await fn(); } catch (e: any) { if (alive.current) setError(e.message); }
    finally { actionLock.current = false; if (alive.current) setBusy(false); }
  };
  const granted = status?.access?.status === 'granted';
  const canSearch = granted && status?.accepted && status.enabled && status.access?.canSearch && !status.searchPaused;
  const canAdd = granted && status?.accepted && status.enabled && status.access?.canSubmit && !status.submissionsPaused;
  const resetAdd = () => { setAdd(false); setDraftCustomerId(null); setClientQuery(''); setReason('overdue'); setReasonDetails(''); setResponse(''); setConfirmed(false); };
  const changeReason = (value: string) => { setReason(value); if (value !== 'other') setReasonDetails(''); };
  const reasonValid = reason !== 'other' || reasonDetails.trim().length >= 3;
  const choose = (customer: Customer) => setDraftCustomerId(customer.id);
  const withdraw = (entry: WatchlistEntry) => run(async () => {
    if (!await appConfirm('Убрать публикацию из общего списка? Клиент и договоры сохранятся.')) return;
    await api.watchlistRequest(`/watchlist/entries/${encodeURIComponent(entry.id)}/withdraw`, { method: 'POST' });
    setSelected(null); await read(); setNotice('Публикация отозвана.');
  });
  const selectEntry = (entry: WatchlistEntry) => { setSelected(entry); setReason(entry.reason || 'overdue'); setReasonDetails(entry.reasonDetails || (entry.reason === 'other' ? entry.note || '' : '')); setResponse(''); setConfirmed(false); };
  const clientNeedle = watchlistSearchText(clientQuery);
  return <div className="mx-auto max-w-3xl space-y-5 p-4 pb-24 text-slate-900 dark:text-white">
    <div className="flex flex-wrap items-start justify-between gap-3 sm:items-center"><div className="min-w-0 flex-1 basis-48"><h1 className="text-xl font-bold sm:text-2xl">Чёрный список</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Проверка клиента перед договором</p></div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {!loading && status && <button type="button" aria-label="Мои записи" title="Мои записи" aria-haspopup="dialog" disabled={busy}
          className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          onClick={() => { setSelected(null); setMineOpen(true); run(read); }}>
          <ClipboardList size={21} aria-hidden="true" />
          {!!mine.length && <span aria-hidden="true" className="absolute -right-1 -top-1 min-w-4 rounded-full bg-indigo-600 px-1 text-center text-[10px] font-semibold leading-4 text-white">{hasMore ? `${mine.length}+` : mine.length}</span>}
        </button>}
        {canAdd && <button className={`${wlButton} shrink-0 whitespace-nowrap`} onClick={() => { resetAdd(); setMineOpen(false); setSelected(null); setAdd(true); }}>+ Добавить</button>}
      </div>
    </div>
    {status?.adminOnly && <p className="text-sm text-slate-500 dark:text-slate-400">Доступ администратора. Общий доступ выключен; новые записи сохраняются на проверку.</p>}
    <WatchlistError message={error} />
    {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">{notice}</p>}
    {loading ? <p className="py-10 text-center text-slate-500">Загружаем…</p> : !status ? <button className={wlSecondary} disabled={busy} onClick={() => run(read)}>Повторить</button> : <>
      {!granted && <div className={`${wlCard} space-y-3 text-center py-8`}>
        <div className="text-3xl" aria-hidden>🔒</div><h2 className="text-lg font-bold">Доступ по запросу</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Здесь можно проверить клиента и отправить запись на рассмотрение.</p>
        {!status.access ? <button className={wlButton} disabled={busy} onClick={() => run(async () => { await api.watchlistRequest('/watchlist/access-request', { method: 'POST' }); await read(); })}>Запросить доступ</button>
          : <p className="text-sm font-medium">{status.access.status === 'requested' ? 'Заявка отправлена. Ожидайте решения администратора.' : 'Доступ не предоставлен. Для уточнения обратитесь в поддержку.'}</p>}
      </div>}
      {granted && !status.accepted && <section className={`${wlCard} space-y-4`}><h2 className="text-lg font-bold">Перед началом</h2><WatchlistRules compact />
        <p className="text-xs text-slate-400">Версия правил: {status.policyVersion}</p>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={accepted} onChange={e => setAccepted(e.target.checked)} /><span>Ознакомился с правилами раздела и политикой обработки персональных данных.</span></label>
        <a className="block text-sm text-indigo-600 underline dark:text-indigo-300" href="/privacy" target="_blank" rel="noopener noreferrer">Политика обработки данных</a>
        <a className="block text-sm text-indigo-600 underline dark:text-indigo-300" href="/watchlist-rules" target="_blank" rel="noopener noreferrer">Полные правила раздела</a>
        <button className={wlButton} disabled={!accepted || busy} onClick={() => run(async () => { await api.watchlistRequest('/watchlist/accept', { method: 'POST', body: { accepted: true, version: status.policyVersion } }); await read(); })}>Принять и продолжить</button>
      </section>}
      {granted && status.accepted && !status.enabled && <p className={wlCard}>Раздел готовится к запуску. Администратор сообщит, когда проверка станет доступна.</p>}
      {canSearch && <div className={`${wlCard} space-y-4`}>
        <div className="space-y-1.5">
          <label htmlFor={nameInputId} className="block text-sm font-medium text-slate-600 dark:text-slate-300"><span>Полное ФИО</span></label>
          <div className="relative">
            <input id={nameInputId} className={`${wlInput} min-h-12 pr-14`} value={name} autoComplete="off" maxLength={200} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} onChange={e => { setName(e.target.value); }} />
            <PassportScan variant="icon" minimalIdentity onApply={f => { setName(f.name || ''); const m = f.birthDate?.match(/^(\d{4})-/) || f.birthDate?.match(/\.(\d{4})$/); setYear(m?.[1] || ''); }} />
          </div>
        </div>
        <WatchlistField label="Год рождения · необязательно"><input className={wlInput} value={year} inputMode="numeric" maxLength={4} pattern="[0-9]{4}" placeholder="Например, 1988" onChange={e => { setYear(e.target.value.replace(/\D/g, '')); }} /></WatchlistField>
      </div>}
      {granted && status.accepted && status.enabled && !canSearch && <p className={wlCard}>{status.searchPaused ? 'Общий поиск временно приостановлен.' : 'Поиск ограничен администратором.'}</p>}
      <WatchlistSearchPanel userId={userId} name={name} year={year} composing={composing} status={status} active={!!canSearch && !mineOpen && !add && !selected && !parentParked} onReported={() => run(read)} />
    </>}

    <ModalParkContext.Provider value={parentParked || !!selected}>
    {mineOpen && <GlassSheet title="Мои записи" onClose={() => setMineOpen(false)} confirmClose={() => !busy}><section className="space-y-3 p-4">
        <WatchlistError message={error} />
        {notice && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
        <p className="text-sm text-slate-500">Ваши публикации можно отозвать, даже если общий доступ приостановлен.</p>
        {!mine.length && <p className={wlCard}>Вы ещё не отправляли клиентов на проверку.</p>}
        {mine.map(item => <button key={item.id} className={`${wlCard} w-full text-left space-y-2`} onClick={() => selectEntry(item)}><span className="block font-semibold break-words">{item.name}</span><span className="block text-sm text-slate-500">{item.birthYear ? `${item.birthYear} г. · ` : ''}{WATCHLIST_STATUS[item.status]} · {watchlistDate(item.createdAt)}</span></button>)}
        {hasMore && <button className={wlSecondary} disabled={busy} onClick={() => run(async () => { const next = page + 1, m = await api.watchlistRequest<WatchlistPage<WatchlistEntry>>(`/watchlist/mine?offset=${next * 20}`); setMine(x => [...x, ...m.items]); setPage(next); setHasMore(m.hasMore); })}>Показать ещё</button>}
        {!!reports.length && <div className="space-y-2 pt-3"><h2 className="font-bold">Мои обращения</h2>{reports.map(r => <div key={r.id} className={`${wlCard} text-sm space-y-2`}><p>{r.status === 'resolved' ? 'Рассмотрено' : 'На рассмотрении'} · {watchlistDate(r.createdAt)}</p><p className="whitespace-pre-wrap break-words">{r.message}</p>{r.response && <p className="whitespace-pre-wrap break-words">Ответ: {r.response}</p>}</div>)}</div>}
      </section></GlassSheet>}
    </ModalParkContext.Provider>

    {add && <GlassSheet title={draftCustomerId ? 'В чёрный список' : 'Выберите своего клиента'} onClose={resetAdd} confirmClose={() => !busy}>
      {draftCustomerId ? <WatchlistSubmissionForm userId={userId} customerId={draftCustomerId} onBusyChange={setBusy} onChooseAnother={() => setDraftCustomerId(null)} onSaved={async result => {
        resetAdd(); await read(); setMineOpen(true); setNotice(result.status === 'published' ? 'Клиент в общем списке.' : result.status === 'needs_info' ? 'Заявка уже существует. Откройте её в «Моих записях».' : 'Заявка отправлена на проверку. В общем поиске её пока нет.');
      }} /> : <div className="space-y-4 p-4"><WatchlistError message={error} />
        <input aria-label="Поиск своих клиентов" className={wlInput} placeholder="ФИО или телефон" value={clientQuery} onChange={e => setClientQuery(e.target.value)} />
        <p className="text-xs text-slate-500">Показано до 30 клиентов. Для остальных уточните поиск.</p>
        {customers.filter(c => !c.id.startsWith('system_') && watchlistSearchText(`${c.name} ${c.phone || ''}`).includes(clientNeedle)).slice(0, 30).map(c => <button key={c.id} disabled={busy} className={`${wlCard} w-full text-left`} onClick={() => choose(c)}><span className="block font-semibold">{c.name}</span><span className="text-sm text-slate-500">{c.phone}</span></button>)}
      </div>}
    </GlassSheet>}
    {selected && <GlassSheet title="Моя запись" subtitle={WATCHLIST_STATUS[selected.status]} zIndex={220} onClose={() => setSelected(null)} confirmClose={() => !busy}><div className="p-4 space-y-4"><WatchlistError message={error} />
      <h2 className="text-lg font-bold break-words">{selected.name}</h2><p className="text-sm text-slate-500">{selected.birthYear ? `${selected.birthYear} г. · ` : ''}Отправлено {watchlistDate(selected.createdAt)}</p>
      {selected.reason && <p className="text-sm">Причина: {WATCHLIST_REASONS[selected.reason]}</p>}
      {selected.reasonDetails && <p className="whitespace-pre-wrap break-words text-sm">{selected.reasonDetails}</p>}
      {selected.status === 'published' && selected.publicationMode === 'auto' && <p className="text-sm text-indigo-600 dark:text-indigo-300">Опубликовано автоматически</p>}
      {selected.decision && <p className={`${wlCard} whitespace-pre-wrap break-words text-sm`}>Решение администратора: {selected.decision}</p>}
      {selected.status === 'published' && <p className="text-sm text-slate-500">{selected.expiresAt ? `Публикация до ${watchlistDate(selected.expiresAt)}` : 'Публикация до удаления'}</p>}
      {selected.status === 'needs_info' && canAdd && <><WatchlistField label="Причина"><select className={wlInput} value={reason} onChange={e => changeReason(e.target.value)}>{Object.entries(WATCHLIST_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></WatchlistField>{reason === 'other' && <WatchlistField label="Описание причины"><textarea className={wlInput} rows={3} minLength={3} maxLength={1000} value={reasonDetails} onChange={e => setReasonDetails(e.target.value)} /></WatchlistField>}<WatchlistField label="Ответ администратору"><textarea className={wlInput} rows={3} minLength={3} maxLength={1500} value={response} onChange={e => setResponse(e.target.value)} /></WatchlistField><label className="flex gap-3 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Подтверждаю</label><button className={wlButton} disabled={busy || !confirmed || !reasonValid || response.trim().length < 3} onClick={() => run(async () => { await api.watchlistRequest(`/watchlist/entries/${selected.id}/resubmit`, { method: 'POST', body: { version: selected.version, reason, ...(reason === 'other' ? { reasonDetails: reasonDetails.trim() } : {}), response: response.trim(), confirmed } }); setSelected(null); await read(); })}>Отправить дополнение</button></>}
      {!['withdrawn', 'terminated', 'deleted'].includes(selected.status) && <button className={`${wlSecondary} text-red-600 dark:text-red-300`} disabled={busy} onClick={() => withdraw(selected)}>Убрать из общего списка</button>}
      <p className="text-xs text-slate-400 break-all">Запись: {selected.id}</p>
    </div></GlassSheet>}

  </div>;
};
export default ClientWatchlist;
