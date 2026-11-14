import React, { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { WATCHLIST_REASONS, WatchlistEntry, WatchlistPreview, WatchlistStatus, watchlistCanSubmit } from '../src/watchlist';
import { WatchlistError, WatchlistField, wlButton, wlCard, wlInput, wlSecondary } from './WatchlistUI';

/** Одна форма для списка, карточки клиента и договора. Источник личности — сервер. */
const WatchlistSubmissionForm: React.FC<{
  userId: string; customerId: string; onSaved: (entry: WatchlistEntry) => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void; onChooseAnother?: () => void;
}> = ({ userId, customerId, onSaved, onBusyChange, onChooseAnother }) => {
  const [preview, setPreview] = useState<WatchlistPreview | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null), [saving, setSaving] = useState(false);
  const [reason, setReason] = useState('overdue'), [details, setDetails] = useState(''), [confirmed, setConfirmed] = useState(false);
  const alive = useRef(false), request = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    setPreview(null); setLoading(true); setError(null); setReason('overdue'); setDetails(''); setConfirmed(false);
    (async () => {
      const s = await api.watchlistRequest<WatchlistStatus>('/watchlist/status', { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!watchlistCanSubmit(s)) throw new Error('Добавление недоступно. Проверьте доступ в разделе «Чёрный список».');
      const p = await api.watchlistRequest<WatchlistPreview>('/watchlist/preview', { method: 'POST', body: { customerId }, signal: controller.signal });
      if (!controller.signal.aborted) setPreview(p);
    })().catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { alive.current = false; controller.abort(); request.current?.abort(); request.current = null; };
  }, [userId, customerId]);
  const valid = reason !== 'other' || details.trim().length >= 3;
  const submit = async () => {
    if (!preview || !confirmed || !valid || request.current) return;
    const controller = new AbortController(); request.current = controller; setSaving(true); onBusyChange?.(true); setError(null);
    try {
      const entry = await api.watchlistRequest<WatchlistEntry>('/watchlist/entries', { method: 'POST', signal: controller.signal,
        body: { customerId: preview.customerId, fingerprint: preview.fingerprint, reason, ...(reason === 'other' ? { reasonDetails: details.trim() } : {}), confirmed: true } });
      if (!controller.signal.aborted) await onSaved(entry);
    } catch (e: any) { if (!controller.signal.aborted) setError(e.message); }
    finally { if (alive.current && !controller.signal.aborted) setSaving(false); request.current = null; onBusyChange?.(false); }
  };
  return <div className="space-y-4 p-4"><WatchlistError message={error} />
    {loading && <p role="status" className="text-sm text-slate-500">Загружаем…</p>}
    {preview && <>
      <div className={wlCard}><p className="font-bold break-words">{preview.name}</p><p className="text-sm text-slate-500">{preview.birthYear ? `${preview.birthYear} г.` : 'Год рождения не указан'}</p><p className="mt-2 text-xs text-slate-500">ФИО, год и причина будут видны участникам списка.</p></div>
      <WatchlistField label="Причина"><select disabled={saving} className={wlInput} value={reason} onChange={e => { setReason(e.target.value); if (e.target.value !== 'other') setDetails(''); }}>{Object.entries(WATCHLIST_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></WatchlistField>
      {reason === 'other' && <WatchlistField label="Описание причины"><textarea disabled={saving} className={wlInput} rows={3} minLength={3} maxLength={1000} value={details} onChange={e => setDetails(e.target.value)} placeholder="Описание увидят участники поиска. Без паспортных данных и контактов." /></WatchlistField>}
      <label className="flex gap-3 text-sm"><input type="checkbox" disabled={saving} className="mt-1 shrink-0" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>Подтверждаю</span></label>
      <button type="button" className={`${wlButton} w-full`} disabled={saving || !confirmed || !valid} onClick={submit}>{saving ? 'Отправляем…' : 'Отправить'}</button>
    </>}
    {onChooseAnother && <button type="button" disabled={saving} className={wlSecondary} onClick={onChooseAnother}>Выбрать другого клиента</button>}
  </div>;
};
export default WatchlistSubmissionForm;
