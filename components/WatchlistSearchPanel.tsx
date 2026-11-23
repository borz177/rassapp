import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../services/api';
import { WatchlistStatus, WATCHLIST_REASONS, watchlistBirthDateLabel } from '../src/watchlist';
import { useWatchlistSearch } from '../src/hooks/useWatchlistSearch';
import GlassSheet from './GlassSheet';
import WatchlistPrivateContent from './WatchlistPrivateContent';
import { WatchlistError, WatchlistField, WatchlistGuarantors, wlButton, wlCard, wlInput, wlSecondary } from './WatchlistUI';

const WatchlistSearchPanel: React.FC<{
  userId: string; name: string; year?: string; active: boolean; composing?: boolean; status?: WatchlistStatus | null;
  compact?: boolean; onReported?: () => void;
}> = props => {
  const search = useWatchlistSearch(props);
  const [selectedId, setSelectedId] = useState<string | null>(null), [reporting, setReporting] = useState(false);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const request = useRef<AbortController | null>(null);
  const selected = search.items.find(item => item.id === selectedId);
  useEffect(() => {
    setSelectedId(null); setReporting(false); setMessage(''); setError(null); setNotice(''); setBusy(false);
    return () => { request.current?.abort(); request.current = null; };
  }, [search.key, search.phase === 'success']);
  const reason = (item: typeof search.items[number]) => item.reason === 'other' ? item.reasonDetails || 'Описание не указано' : WATCHLIST_REASONS[item.reason || ''] || 'Не указана';
  const report = async () => {
    if (!selected || request.current || message.trim().length < 15) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(null);
    try {
      await api.watchlistRequest('/watchlist/appeals', { method: 'POST', body: { entryId: selected.id, message: message.trim() }, signal: controller.signal });
      if (controller.signal.aborted) return;
      setSelectedId(null); setMessage(''); setReporting(false); setNotice('Обращение передано администратору.'); props.onReported?.();
    } catch (e: any) { if (!controller.signal.aborted) setError(e.message); }
    finally { if (!controller.signal.aborted) { setBusy(false); request.current = null; } }
  };
  if (!search.allowed) return null;
  return <section aria-label="Проверка по чёрному списку" className={props.compact ? 'border-t border-slate-100 px-4 py-3 dark:border-slate-800 space-y-3' : 'space-y-3'}>
    {props.compact && <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Чёрный список</h2>}
    {search.phase === 'idle' && props.name.trim() && <p className="text-sm text-slate-500 dark:text-slate-400">{props.year ? 'Проверьте ФИО и год рождения.' : 'Введите полное ФИО для проверки.'}</p>}
    {(search.phase === 'waiting' || search.phase === 'loading') && <p role="status" className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400"><Loader2 size={16} className="animate-spin" aria-hidden="true" />Проверяем чёрный список…</p>}
    {search.phase === 'error' && <div role="status" className="space-y-2"><p className="text-sm text-amber-700 dark:text-amber-300">{search.error}</p>{search.online && <button type="button" className={wlSecondary} onClick={search.retry}>Повторить проверку</button>}</div>}
    {search.phase === 'expired' && <div className="space-y-2"><p className="text-sm text-slate-500 dark:text-slate-400">Результаты очищены.</p><button type="button" className={wlSecondary} onClick={search.retry}>Повторить проверку</button></div>}
    {notice && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
    {search.phase === 'success' && <>
      <h2 className="font-bold text-slate-900 dark:text-white">{search.items.length ? 'Возможные совпадения' : 'Совпадений в чёрном списке не найдено'}</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400">{search.items.length ? 'Совпадение ФИО не подтверждает личность клиента.' : 'Это не подтверждает платёжеспособность клиента.'}</p>
      {search.items.map(item => <WatchlistPrivateContent userId={props.userId} key={item.id} className={`${wlCard} space-y-2`}>
        <button type="button" className="text-left font-semibold text-slate-900 underline-offset-4 hover:underline dark:text-white break-words" onClick={() => { setSelectedId(item.id); setReporting(false); }} aria-label={`Открыть совпадение: ${item.name}`}>{item.name}</button>
        <p className="text-sm text-slate-500 dark:text-slate-400">{watchlistBirthDateLabel(item)}</p>
        <p className="whitespace-pre-wrap break-words text-sm font-medium text-red-800 dark:text-red-300">Причина со слов автора: {reason(item)}</p>
        <WatchlistGuarantors guarantors={item.guarantors} />
        <button type="button" className="text-sm text-indigo-600 dark:text-indigo-300" onClick={() => { setSelectedId(item.id); setReporting(true); }}>Сообщить об ошибке</button>
      </WatchlistPrivateContent>)}
      {search.limited && <p className="text-sm text-slate-500 dark:text-slate-400">Совпадений много. Уточните год на странице чёрного списка.</p>}
    </>}
    {selected && <GlassSheet title={reporting ? 'Сообщить об ошибке' : 'Возможное совпадение'} zIndex={240} onClose={() => { setSelectedId(null); setReporting(false); setMessage(''); setError(null); }} confirmClose={() => !busy}>
      <div className="space-y-4 p-4"><WatchlistError message={error} />
        <WatchlistPrivateContent userId={props.userId} className="space-y-2">
          <p className="font-semibold break-words">{selected.name}</p>
          <p className="text-sm text-slate-500">{watchlistBirthDateLabel(selected)}</p>
          {!reporting && <p className="whitespace-pre-wrap break-words text-sm font-medium text-red-800 dark:text-red-300">Причина со слов автора: {reason(selected)}</p>}
          {!reporting && <WatchlistGuarantors guarantors={selected.guarantors} />}
        </WatchlistPrivateContent>
        {reporting ? <><WatchlistField label="Что нужно проверить"><textarea className={wlInput} rows={5} maxLength={1500} value={message} onChange={e => setMessage(e.target.value)} placeholder="Опишите ошибку. Не указывайте номер паспорта." /></WatchlistField><button type="button" disabled={busy || message.trim().length < 15} className={wlButton} onClick={report}>Отправить обращение</button></>
          : <><p className="text-sm text-slate-500">Совпадение ФИО не подтверждает личность клиента.</p><button type="button" className={wlSecondary} onClick={() => setReporting(true)}>Сообщить об ошибке</button></>}
      </div>
    </GlassSheet>}
  </section>;
};
export default WatchlistSearchPanel;
