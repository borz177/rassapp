import React, { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import GlassSheet from './GlassSheet';
import { appConfirm } from '../src/dialogs';
import { WATCHLIST_BASES, WATCHLIST_REASONS, WATCHLIST_STATUS, watchlistDate } from '../src/watchlist';
import { WatchlistError, WatchlistField, wlButton, wlCard, wlInput, wlSecondary } from './WatchlistUI';

type Tab = 'entries' | 'appeals' | 'access' | 'settings' | 'events';
const labels: Record<Tab, string> = { entries: 'Записи', appeals: 'Обращения', access: 'Доступ', settings: 'Настройки', events: 'Журнал' };
const EVENT_NAMES: Record<string, string> = {
  ACCESS_REQUESTED: 'Запрошен доступ', ACCESS_GRANTED: 'Выдан доступ', ACCESS_REJECTED: 'Отказ в доступе', ACCESS_REVOKED: 'Доступ отозван',
  RULES_ACCEPTED: 'Приняты правила', SEARCH: 'Выполнен поиск', ENTRY_SUBMITTED: 'Подана заявка', ENTRY_RESUBMITTED: 'Дополнена заявка',
  ENTRY_WITHDRAWN: 'Публикация отозвана', ENTRY_PUBLISH: 'Опубликовано', ENTRY_HIDE: 'Скрыто на проверку', ENTRY_TERMINATE: 'Публикация прекращена',
  ENTRY_REJECT: 'Заявка отклонена', ENTRY_NEEDS_INFO: 'Запрошены сведения', APPEAL_SUBMITTED: 'Подано обращение',
  EXTERNAL_APPEAL_REGISTERED: 'Зарегистрировано внешнее обращение', APPEAL_REVIEWING: 'Обращение рассматривается', APPEAL_RESOLVED: 'Обращение рассмотрено',
  ADMIN_VERIFIED: 'Подтверждён вход', ADMIN_OVERVIEW_READ: 'Просмотрена сводка', ADMIN_ACCESS_READ: 'Просмотрены права',
  ADMIN_ENTRIES_READ: 'Просмотрены записи', ADMIN_ENTRY_READ: 'Прочитаны материалы записи', ADMIN_APPEALS_READ: 'Просмотрены обращения', SETTINGS_CHANGED: 'Изменены настройки',
  ENTRY_AUTO_PUBLISHED: 'Запись опубликована автоматически', ENTRY_DELETED: 'Запись удалена администратором',
  AUTO_PUBLICATION_ENABLED: 'Автопубликация включена', AUTO_PUBLICATION_DISABLED: 'Автопубликация выключена',
};
const AdminClientWatchlist: React.FC = () => {
  const [lock, setLock] = useState<{ configured: boolean; encryptionReady: boolean } | null>(null);
  const [proof, setProof] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>('entries'), [filter, setFilter] = useState('pending'), [offset, setOffset] = useState(0);
  const [overview, setOverview] = useState<any>(null), [items, setItems] = useState<any[]>([]), [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<any>(null), [action, setAction] = useState(''), [note, setNote] = useState(''), [verified, setVerified] = useState(false);
  const [canSearch, setCanSearch] = useState(true), [canSubmit, setCanSubmit] = useState(true), [pilot, setPilot] = useState(false);
  const [draft, setDraft] = useState<any>(null), [settingsReason, setSettingsReason] = useState(''), [target, setTarget] = useState('');
  const [external, setExternal] = useState(false), [externalId, setExternalId] = useState(''), [externalMessage, setExternalMessage] = useState(''), [externalReference, setExternalReference] = useState('');
  const alive = useRef(true), sequence = useRef(0), actionLock = useRef(false), expires = useRef<number>(0), proofRef = useRef('');
  const releaseProof = () => {
    const token = proofRef.current; proofRef.current = '';
    if (token) void api.watchlistRequest('/admin/watchlist/lock', { method: 'POST', body: {}, proof: token }).catch(() => {});
  };
  const clear = () => { releaseProof(); sequence.current++; setProof(''); setPassword(''); setCode(''); setItems([]); setOverview(null); setSelected(null); setDraft(null); setExternal(false); setNote(''); setExternalMessage(''); setExternalReference(''); };
  useEffect(() => {
    alive.current = true;
    api.watchlistRequest<typeof lock>('/admin/watchlist/lock').then(r => alive.current && setLock(r)).catch(e => alive.current && setError(e.message));
    const hidden = () => { if (document.hidden) clear(); };
    document.addEventListener('visibilitychange', hidden);
    return () => { alive.current = false; sequence.current++; releaseProof(); document.removeEventListener('visibilitychange', hidden); };
  }, []);
  useEffect(() => {
    if (!proof) return;
    const timer = setTimeout(clear, Math.max(0, expires.current - Date.now()));
    return () => clearTimeout(timer);
  }, [proof]);
  const request = async (path: string, body?: any, token = proof) => {
    try { return await api.watchlistRequest(`/admin/watchlist${path}`, { method: body === undefined ? 'GET' : 'POST', body, proof: token }); }
    catch (e: any) { if (e.status === 403 && e.message.includes('Подтвердите административный вход')) clear(); throw e; }
  };
  const load = async (token = proof, nextTab = tab, nextFilter = filter, nextOffset = offset, entryId = target) => {
    if (!alive.current || document.hidden) return;
    const seq = ++sequence.current;
    setLoading(true); setItems([]); setError(null);
    try {
      const search = entryId ? (/^[a-f0-9-]{36}$/.test(entryId) ? `&id=${encodeURIComponent(entryId)}` : `&name=${encodeURIComponent(entryId)}`) : '';
      const [o, list] = await Promise.all([request('/overview', undefined, token), ['settings'].includes(nextTab) ? Promise.resolve(null) : request(`/${nextTab}?offset=${nextOffset}${nextTab === 'events' ? '' : `&status=${encodeURIComponent(nextFilter)}`}${nextTab === 'entries' ? search : ''}`, undefined, token)]);
      if (!alive.current || seq !== sequence.current) return;
      setOverview(o); setDraft(o.settings); setSettingsReason(''); setItems(list?.items || []); setHasMore(!!list?.hasMore);
    } finally { if (alive.current && seq === sequence.current) setLoading(false); }
  };
  const run = async (fn: () => Promise<void>) => {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setError(null);
    try { await fn(); } catch (e: any) { if (alive.current) setError(e.message); }
    finally { actionLock.current = false; if (alive.current) setBusy(false); }
  };
  const change = (nextTab: Tab, nextFilter?: string) => {
    const value = nextFilter || ({ entries: 'pending', appeals: 'new', access: 'requested', settings: '', events: '' }[nextTab]);
    setTab(nextTab); setFilter(value); setOffset(0); setTarget(''); setSelected(null);
    void run(() => load(proof, nextTab, value, 0, ''));
  };
  const open = (item: any) => {
    setSelected(item); setNote(''); setVerified(false); setCanSearch(item.canSearch ?? true); setCanSubmit(item.canSubmit ?? true); setPilot(!!item.pilot);
    setAction(tab === 'access' ? (item.status === 'requested' ? 'granted' : item.status) : tab === 'appeals' ? 'reviewing' : entryActions[item.status]?.[0]?.id || '');
  };
  const decide = async () => {
    if (!selected) return;
    if (action === 'publish' && !await appConfirm('Опубликовать ФИО, год и причину для допущенных участников? Для «Другой причины» будет показано её описание. Подтверждение основания проверено отдельно.')) return;
    if (tab === 'access') await request(`/access/${encodeURIComponent(selected.userId)}`, { version: selected.version, status: action, canSearch, canSubmit, pilot, reason: note });
    else if (tab === 'appeals') await request(`/appeals/${selected.id}/decision`, { version: selected.version, status: action === 'reviewing' ? 'reviewing' : 'resolved', outcome: action === 'reviewing' ? null : action, response: note, identityVerified: verified });
    else await request(`/entries/${selected.id}/decision`, { version: selected.version, action, note, basisVerified: verified });
    setSelected(null); await load();
  };
  const deleteSelected = async () => {
    if (!selected || !await appConfirm('Удалить запись из чёрного списка? ФИО, причина и описание публикации будут удалены. Клиент и договоры сохранятся.')) return;
    await request(`/entries/${selected.id}/delete`, { version: selected.version, confirmed: true });
    setSelected(null); await load();
  };
  const entryActions: Record<string, { id: string; label: string }[]> = {
    pending: [{ id: 'publish', label: 'Опубликовать' }, { id: 'needs_info', label: 'Запросить сведения' }, { id: 'reject', label: 'Отклонить' }],
    needs_info: [{ id: 'reject', label: 'Отклонить' }], published: [{ id: 'hide', label: 'Скрыть на время проверки' }, { id: 'terminate', label: 'Прекратить публикацию' }],
    hidden: [{ id: 'publish', label: 'Вернуть после проверки' }, { id: 'terminate', label: 'Прекратить публикацию' }], expired: [{ id: 'terminate', label: 'Прекратить публикацию' }],
  };
  return <div className="space-y-5 text-slate-900 dark:text-white">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">Чёрный список</h2><p className="text-sm text-slate-500 dark:text-slate-400">Заявки, обращения и доступ участников</p></div>{proof && <button className={wlSecondary} onClick={() => run(async () => { await request('/lock', {}); clear(); })}>Закрыть доступ</button>}</div>
    <WatchlistError message={error} />
    {!proof ? <form className={`${wlCard} max-w-lg space-y-4`} onSubmit={e => { e.preventDefault(); run(async () => {
      const seq = sequence.current;
      const result = await request('/unlock', { password, code }, '');
      if (!alive.current || document.hidden || seq !== sequence.current) return;
      setPassword(''); setCode(''); expires.current = new Date(result.expiresAt).getTime(); proofRef.current = result.proof; setProof(result.proof); await load(result.proof);
    }); }}><h3 className="font-bold">Подтвердите вход</h3><p className="text-sm text-slate-500">Пароль и код из приложения-аутентификатора. Доступ действует 10 минут и закрывается при уходе с окна.</p>
      {lock && !lock.configured ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Сначала настройте второй фактор общего списка на сервере. Инструкция: docs/client-watchlist-operations.md.</p> : <>
        <WatchlistField label="Пароль администратора"><input type="password" autoComplete="current-password" className={wlInput} value={password} onChange={e => setPassword(e.target.value)} maxLength={200} required /></WatchlistField>
        <WatchlistField label="Одноразовый код"><input className={wlInput} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} pattern="[0-9]{6}" required /></WatchlistField>
        <button className={wlButton} disabled={busy || !lock || code.length !== 6 || !password}>{busy ? 'Проверяем…' : 'Открыть управление'}</button>
      </>}
      {lock && !lock.encryptionReady && <p className="text-sm text-slate-500">Ключи шифрования ещё не настроены. Общий поиск останется выключен.</p>}
    </form> : <>
      {overview && <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[
        { label: 'Заявки на доступ', count: overview.counts.access, tab: 'access' as Tab }, { label: 'На проверке', count: overview.counts.pending, tab: 'entries' as Tab },
        { label: 'Обращения', count: overview.counts.appeals, tab: 'appeals' as Tab }, { label: 'Опубликовано', count: overview.counts.published, tab: 'entries' as Tab, filter: 'published' },
      ].map(c => <button key={c.label} disabled={busy} className={`${wlCard} text-left`} onClick={() => change(c.tab, c.filter)}><span className="block text-xs text-slate-500">{c.label}</span><span className="mt-1 block text-2xl font-bold tabular-nums">{c.count}</span></button>)}</div>}
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Управление общим списком">{(Object.keys(labels) as Tab[]).map(t => <button role="tab" aria-selected={tab === t} disabled={busy} className={`shrink-0 ${tab === t ? wlButton : wlSecondary}`} key={t} onClick={() => change(t)}>{labels[t]}</button>)}</div>
      {tab !== 'settings' && tab !== 'events' && <div className="flex flex-wrap items-center gap-2"><select aria-label="Статус записей" className={`${wlInput} max-w-xs`} disabled={busy} value={filter} onChange={e => change(tab, e.target.value)}>
        {(tab === 'entries' ? ['pending', 'needs_info', 'published', 'hidden', 'rejected', 'withdrawn', 'terminated', 'expired', 'deleted'] : tab === 'access' ? ['requested', 'granted', 'rejected', 'revoked'] : ['new', 'reviewing', 'resolved']).map(k => <option key={k} value={k}>{WATCHLIST_STATUS[k] || ({ new: 'Новые', reviewing: 'Рассматриваются', resolved: 'Рассмотрены' }[k])}</option>)}
      </select><button className={wlSecondary} disabled={busy} onClick={() => run(() => load())}>Обновить</button>{tab === 'appeals' && <button className={wlSecondary} onClick={() => { setExternal(true); setExternalId(''); setExternalMessage(''); setExternalReference(''); }}>Обращение из почты</button>}</div>}
      {tab === 'entries' && <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); setOffset(0); run(() => load(proof, tab, filter, 0, target.trim())); }}><input aria-label="ФИО или идентификатор записи" className={`${wlInput} min-w-0 flex-1`} value={target} maxLength={200} onChange={e => setTarget(e.target.value)} placeholder="Полное ФИО или идентификатор записи" /><button className={wlSecondary} disabled={busy}>Найти</button></form>}
      {loading && <p role="status" className="py-8 text-center text-slate-500">Загружаем…</p>}
      {!loading && tab !== 'settings' && !items.length && <p className={`${wlCard} text-sm text-slate-500`}>В этом разделе записей пока нет.</p>}
      {!loading && tab !== 'settings' && <div className="space-y-3">{items.map(item => tab === 'events' ? <div key={item.id} className={`${wlCard} text-sm space-y-1`}><p className="font-semibold">{EVENT_NAMES[item.action] || item.action}</p><p className="text-xs text-slate-500">{new Date(item.createdAt).toLocaleString('ru-RU')}</p><p className="text-xs text-slate-400 break-all">Пользователь: {item.actorId || '—'}{item.targetId ? ` · Запись: ${item.targetId}` : ''}</p></div> :
        <button key={item.id || item.userId} className={`${wlCard} w-full text-left space-y-2`} onClick={() => open(item)}><p className="font-semibold break-words">{tab === 'access' ? item.name : tab === 'appeals' ? (item.entry?.name || 'Публикация') : item.name}</p>
          <p className="text-sm text-slate-500 break-words">{tab === 'access' ? item.email : tab === 'appeals' ? (item.channel === 'external' ? 'Обращение клиента из почты' : item.reporterEmail) : `${item.birthYear || 'Год не указан'} · ${item.ownerEmail}`}</p>
          <p className="text-xs text-slate-400">{WATCHLIST_STATUS[item.status] || ({ new: 'Новое обращение', reviewing: 'Рассматривается', resolved: 'Рассмотрено' }[item.status])} · {watchlistDate(item.createdAt || item.requestedAt)}</p>
        </button>)}</div>}
      {tab !== 'settings' && (offset > 0 || hasMore) && <div className="flex gap-2"><button disabled={busy || offset === 0} className={wlSecondary} onClick={() => { const n = Math.max(0, offset - 20); setOffset(n); run(() => load(proof, tab, filter, n)); }}>Назад</button><button disabled={busy || !hasMore} className={wlSecondary} onClick={() => { const n = offset + 20; setOffset(n); run(() => load(proof, tab, filter, n)); }}>Далее</button></div>}
      {tab === 'settings' && draft && <form className="space-y-4" onSubmit={e => { e.preventDefault(); run(async () => {
        if (!await appConfirm(draft.mode === 'off' ? 'Сохранить настройки общего списка?' : 'Сохранить настройки допуска? Убедитесь, что основание и документы проверены.')) return;
        await request('/settings', { ...draft, reason: settingsReason }); await load();
      }); }}><section className={`${wlCard} space-y-4`}><h3 className="font-bold">Запуск и ограничения</h3>
        <WatchlistField label="Режим"><select className={wlInput} value={draft.mode} onChange={e => setDraft({ ...draft, mode: e.target.value })}><option value="off">Выключено</option><option value="pilot">Только допущенные к пилоту</option><option value="on">Допущенные участники</option></select></WatchlistField>
        <label className="flex gap-3 text-sm"><input type="checkbox" checked={draft.searchPaused} onChange={e => setDraft({ ...draft, searchPaused: e.target.checked })} />Приостановить общий поиск</label>
        <label className="flex gap-3 text-sm"><input type="checkbox" checked={draft.submissionsPaused} onChange={e => setDraft({ ...draft, submissionsPaused: e.target.checked })} />Приостановить новые заявки</label>
        <p className="text-xs text-slate-500">Отзыв публикаций и рассмотрение обращений остаются доступны.</p>
        <label className="flex gap-3 text-sm"><input type="checkbox" checked={!!draft.autoPublish} onChange={e => setDraft({ ...draft, autoPublish: e.target.checked })} />Публиковать новые записи автоматически</label>
        <p className="text-xs text-slate-500 dark:text-slate-400">Без отдельного одобрения. Уже поданные заявки и записи с замечаниями проходят ручную проверку.</p>
        <WatchlistField label="Поисков в час на пользователя"><input type="number" min={1} max={100} className={wlInput} value={draft.searchLimit} onChange={e => setDraft({ ...draft, searchLimit: Number(e.target.value) })} required /></WatchlistField>
        <WatchlistField label="Срок новой публикации, дней"><input type="number" min={7} max={90} className={wlInput} value={draft.publicationDays} onChange={e => setDraft({ ...draft, publicationDays: Number(e.target.value) })} required /></WatchlistField>
      </section><section className={`${wlCard} space-y-4`}><h3 className="font-bold">Основание и правила</h3><p className="text-sm text-slate-500">Версия: {overview.policyVersion}. Галочка участника не заменяет согласия его клиента. Перед включением нужны проверенное основание передачи и согласованные документы.</p>
        <label className="flex gap-3 text-sm"><input type="checkbox" checked={draft.legalReady} onChange={e => setDraft({ ...draft, legalReady: e.target.checked })} />Основание, круг получателей и документы проверены</label>
        <WatchlistField label="Документ, дата и результат проверки"><textarea className={wlInput} maxLength={1500} minLength={20} rows={4} required={draft.legalReady} value={draft.legalReference} onChange={e => setDraft({ ...draft, legalReference: e.target.value })} /></WatchlistField>
      </section><section className={`${wlCard} space-y-2 text-sm`}><h3 className="font-bold">Защита</h3><p>Шифрование: {overview.protection.encryptionReady ? `настроено · ключ ${overview.protection.keyVersion}` : 'не настроено'}</p><p>Журнал отзыва: {overview.protection.revocationsReady ? 'подключён' : 'недоступен · общий поиск закрыт'}</p><p>Второй фактор: вход подтверждён</p><p>Восстановление резервной копии: не подтверждено для этого сервера</p><p className="text-xs text-slate-500">Ключи и паспорта в панели не показываются. Настройка ключей не подтверждает безопасность всего сервера.</p></section>
        <WatchlistField label="Причина изменения"><input className={wlInput} value={settingsReason} minLength={5} maxLength={500} required onChange={e => setSettingsReason(e.target.value)} /></WatchlistField><button className={wlButton} disabled={busy || settingsReason.trim().length < 5}>Сохранить настройки</button>
      </form>}
    </>}
    {proof && selected && <GlassSheet title={tab === 'access' ? 'Доступ участника' : tab === 'appeals' ? 'Обращение' : 'Проверка записи'} onClose={() => setSelected(null)} confirmClose={() => !busy}><div className="space-y-4 p-4"><WatchlistError message={error} />
      <h3 className="text-lg font-bold break-words">{selected.name || selected.entry?.name}</h3>
      <p className="text-sm text-slate-500 break-words">{selected.ownerEmail || selected.email || selected.reporterEmail}</p>
      {tab === 'entries' && <div className="space-y-3 text-sm"><p>{selected.birthYear ? `${selected.birthYear} г.` : 'Год не указан'} · {WATCHLIST_STATUS[selected.status]}</p>
        {selected.status === 'published' && selected.publicationMode === 'auto' && <p className="text-indigo-600 dark:text-indigo-300">Опубликовано автоматически</p>}
        <p>Причина: {WATCHLIST_REASONS[selected.reason] || '—'}</p>{selected.reasonDetails && <p className="whitespace-pre-wrap break-words">{selected.reasonDetails}</p>}{selected.response && <p className="whitespace-pre-wrap break-words">Ответ автора: {selected.response}</p>}{selected.basis && <p>Основание: {WATCHLIST_BASES[selected.basis] || '—'}</p>}{selected.evidence && <p className="whitespace-pre-wrap break-words">{selected.evidence}</p>}{selected.note && <p className="whitespace-pre-wrap break-words">{selected.note}</p>}{selected.decision && <p className="whitespace-pre-wrap break-words">Предыдущее решение: {selected.decision}</p>}<p className="text-xs text-slate-400 break-all">Запись: {selected.id}</p></div>}
      {tab === 'appeals' && <div className="space-y-3 text-sm"><p className="whitespace-pre-wrap break-words">{selected.message}</p>{selected.reference && <p className="whitespace-pre-wrap break-words">Источник: {selected.reference}</p>}{selected.response && <p className="whitespace-pre-wrap break-words">Ответ: {selected.response}</p>}
        {selected.entry?.status === 'published' && <button className={wlSecondary} disabled={busy} onClick={() => run(async () => { await request(`/entries/${selected.entryId}/decision`, { version: selected.entry.version, action: 'hide', note: 'Временное скрытие на период рассмотрения обращения' }); setSelected(null); await load(); })}>Скрыть запись на время проверки</button>}
      </div>}
      {tab === 'access' && <div className="space-y-3 text-sm">{[{ key: 'search', label: 'Разрешить поиск', value: canSearch, setter: setCanSearch }, { key: 'submit', label: 'Разрешить отправку записей', value: canSubmit, setter: setCanSubmit }, { key: 'pilot', label: 'Допустить к пилоту', value: pilot, setter: setPilot }].map(t => <label key={t.key} className="flex gap-3"><input type="checkbox" checked={t.value} onChange={e => t.setter(e.target.checked)} />{t.label}</label>)}</div>}
      {(tab === 'access' || (tab === 'appeals' && selected.status !== 'resolved') || (tab === 'entries' && entryActions[selected.status]?.length)) && <>
        <WatchlistField label="Решение"><select className={wlInput} value={action} onChange={e => setAction(e.target.value)}>
          {(tab === 'access' ? [{ id: 'granted', label: 'Предоставить / сохранить доступ' }, { id: 'rejected', label: 'Отказать' }, { id: 'revoked', label: 'Отозвать доступ' }] : tab === 'appeals' ? [{ id: 'reviewing', label: 'Взять в работу' }, { id: 'publication_stopped', label: 'Завершить и прекратить публикацию' }, { id: 'author_correction', label: 'Завершить: исправлено автором' }, { id: 'not_confirmed', label: 'Завершить: ошибка не подтверждена' }] : entryActions[selected.status]).map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select></WatchlistField>
        {((tab === 'entries' && action === 'publish') || tab === 'appeals') && <label className="flex gap-3 text-sm"><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} /><span>{tab === 'appeals' ? 'Личность заявителя проверена по установленной процедуре' : 'Основание передачи, допустимые данные и круг получателей проверены'}</span></label>}
        <WatchlistField label={tab === 'appeals' ? 'Ответ и результат проверки' : 'Пояснение решения'}><textarea className={wlInput} rows={4} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} /></WatchlistField>
        <button className={`${wlButton} w-full`} disabled={busy || note.trim().length < (tab === 'appeals' ? 10 : 5) || (tab === 'entries' && action === 'publish' && !verified)} onClick={() => run(decide)}>Сохранить решение</button>
      </>}
      {tab === 'entries' && selected.status !== 'deleted' && <button className="w-full rounded-xl bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600 transition active:scale-[.98] disabled:opacity-50 dark:bg-red-950/40 dark:text-red-300" disabled={busy} onClick={() => run(deleteSelected)}>Удалить запись</button>}
    </div></GlassSheet>}
    {proof && external && <GlassSheet title="Обращение клиента из почты" onClose={() => setExternal(false)} confirmClose={() => !busy}><div className="space-y-4 p-4"><WatchlistError message={error} /><p className="text-sm text-slate-500">Для обращения человека без аккаунта. Паспорт и полный адрес сюда не копируйте.</p>
      <WatchlistField label="Идентификатор публикации"><input className={wlInput} maxLength={36} value={externalId} onChange={e => setExternalId(e.target.value.trim())} /></WatchlistField>
      <WatchlistField label="Номер обращения и дата"><input className={wlInput} maxLength={500} value={externalReference} onChange={e => setExternalReference(e.target.value)} /></WatchlistField>
      <WatchlistField label="Суть обращения"><textarea className={wlInput} rows={5} maxLength={1500} value={externalMessage} onChange={e => setExternalMessage(e.target.value)} /></WatchlistField>
      <button className={wlButton} disabled={busy || externalId.length !== 36 || externalReference.trim().length < 10 || externalMessage.trim().length < 15} onClick={() => run(async () => { await request('/appeals', { entryId: externalId, message: externalMessage, reference: externalReference }); setExternal(false); setExternalMessage(''); setExternalReference(''); await load(); })}>Зарегистрировать обращение</button>
    </div></GlassSheet>}
  </div>;
};
export default AdminClientWatchlist;
