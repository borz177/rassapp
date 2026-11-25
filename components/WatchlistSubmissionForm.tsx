import React, { useEffect, useRef, useState } from 'react';
import { ShieldAlert, UserPlus, X } from 'lucide-react';
import { api } from '../services/api';
import { WATCHLIST_REASONS, WatchlistPreview, WatchlistReasonDraft, WatchlistStatus, WatchlistSubmissionResult, watchlistCanSearch, watchlistCanSubmit, watchlistDate } from '../src/watchlist';
import { WatchlistError, WatchlistField, wlButton, wlCard, wlInput, wlSecondary } from './WatchlistUI';
import WatchlistPrivateContent from './WatchlistPrivateContent';

/** Одна форма для списка, карточки клиента и договора. Источник личности — сервер. */
const WatchlistSubmissionForm: React.FC<{
  userId: string; customerId: string; onSaved: (entry: WatchlistSubmissionResult) => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void; onChooseAnother?: () => void; initialReason?: WatchlistReasonDraft;
}> = ({ userId, customerId, onSaved, onBusyChange, onChooseAnother, initialReason }) => {
  const initialCategory = initialReason?.reason ?? 'overdue';
  const initialDetails = initialReason?.reasonDetails ?? '';
  const [preview, setPreview] = useState<WatchlistPreview | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null), [saving, setSaving] = useState(false);
  const [reason, setReason] = useState<string>(initialCategory), [details, setDetails] = useState(initialDetails), [confirmed, setConfirmed] = useState(false);
  const [guarantorSaleId, setGuarantorSaleId] = useState(''), [guarantorReason, setGuarantorReason] = useState('');
  const alive = useRef(false), request = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    setPreview(null); setLoading(true); setError(null); setReason(initialCategory); setDetails(initialDetails); setConfirmed(false);
    setGuarantorSaleId(''); setGuarantorReason('');
    (async () => {
      const s = await api.watchlistRequest<WatchlistStatus>('/watchlist/status', { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!watchlistCanSubmit(s)) throw new Error('Добавление недоступно. Проверьте доступ в разделе «Чёрный список».');
      const p = await api.watchlistRequest<WatchlistPreview>('/watchlist/preview', {
        method: 'POST', body: { customerId, checkPublishedName: watchlistCanSearch(s), includeGuarantors: true }, signal: controller.signal,
      });
      if (!controller.signal.aborted) setPreview(p);
    })().catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { alive.current = false; controller.abort(); request.current?.abort(); request.current = null; };
  }, [userId, customerId, initialCategory, initialDetails]);
  const guarantors = preview?.guarantors ?? [];
  const guarantor = guarantors.find(item => item.saleId === guarantorSaleId);
  const selectGuarantor = (saleId: string) => {
    setGuarantorSaleId(saleId); setGuarantorReason(''); setConfirmed(false);
  };
  const valid = (reason !== 'other' || details.trim().length >= 3) &&
    (!guarantor || guarantorReason.trim().length >= 3);
  const submit = async () => {
    if (!preview || !confirmed || !valid || request.current) return;
    const controller = new AbortController(); request.current = controller; setSaving(true); onBusyChange?.(true); setError(null);
    try {
      const entry = await api.watchlistRequest<WatchlistSubmissionResult>('/watchlist/entries', { method: 'POST', signal: controller.signal,
        body: { customerId: preview.customerId, fingerprint: preview.fingerprint, reason, ...(reason === 'other' ? { reasonDetails: details.trim() } : {}), confirmed: true,
          ...(guarantor ? { guarantor: { saleId: guarantor.saleId, fingerprint: guarantor.fingerprint, reasonDetails: guarantorReason.trim() } } : {}) } });
      if (!controller.signal.aborted) await onSaved(entry);
    } catch (e: any) { if (!controller.signal.aborted) setError(e.message); }
    finally { if (alive.current && !controller.signal.aborted) setSaving(false); request.current = null; onBusyChange?.(false); }
  };
  return <div className="space-y-4 p-4"><WatchlistError message={error} />
    {loading && <p role="status" className="text-sm text-slate-500">Загружаем…</p>}
    {preview && <>
      <div className={wlCard}><p className="font-bold break-words">{preview.name}</p><p className="text-sm text-slate-500">{preview.birthYear ? `${preview.birthYear} г.` : 'Год рождения не указан'}</p><p className="mt-2 text-xs text-slate-500">ФИО, год и причина будут видны участникам списка.</p></div>
      {preview.hasPublishedNameMatch && <WatchlistPrivateContent userId={userId} showWatermark={false}
        className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
        <div role="status" className="flex items-start gap-2">
          <ShieldAlert size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">В ЧС уже есть запись с таким ФИО</p>
            <p className="mt-0.5 text-xs">Возможно, это тёзка. Сверьте данные перед отправкой.</p>
          </div>
        </div>
      </WatchlistPrivateContent>}
      <WatchlistField label="Причина"><select disabled={saving} className={wlInput} value={reason} onChange={e => { setReason(e.target.value); setConfirmed(false); if (e.target.value !== 'other') setDetails(''); }}>{Object.entries(WATCHLIST_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></WatchlistField>
      {reason === 'other' && <WatchlistField label="Описание причины"><textarea disabled={saving} className={wlInput} rows={3} minLength={3} maxLength={1000} value={details} onChange={e => { setDetails(e.target.value); setConfirmed(false); }} placeholder="Описание увидят участники поиска. Без паспортных данных и контактов." /></WatchlistField>}
      {guarantor ? <section className={`${wlCard} space-y-3`} aria-label="Поручитель">
        <div className="flex items-center justify-between gap-2">
          <h3 className="min-w-0 break-words text-sm font-semibold">Поручитель{guarantors.length === 1 ? ` · ${guarantor.name}` : ''}</h3>
          <button type="button" aria-label="Убрать поручителя" title="Убрать поручителя" disabled={saving}
            className="flex size-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
            onClick={() => selectGuarantor('')}><X size={18} aria-hidden="true" /></button>
        </div>
        {guarantors.length > 1 && <WatchlistField label="Поручитель и договор"><select disabled={saving} className={wlInput} value={guarantorSaleId} onChange={e => selectGuarantor(e.target.value)}>
          {guarantors.map(item => <option key={item.saleId} value={item.saleId}>{[item.name, item.product, item.startDate && Number.isFinite(Date.parse(item.startDate)) ? watchlistDate(item.startDate) : null].filter(Boolean).join(' · ')}</option>)}
        </select></WatchlistField>}
        <WatchlistField label="Причина по поручителю"><textarea disabled={saving} className={wlInput} rows={2} minLength={3} maxLength={1000} value={guarantorReason} onChange={e => setGuarantorReason(e.target.value)} placeholder="Что нарушил поручитель по договору?" /></WatchlistField>
        <p className="text-xs text-slate-500 dark:text-slate-400">После публикации ФИО поручителя будет видно в поиске по клиенту.</p>
      </section> : guarantors.length > 0 && <button type="button" disabled={saving} onClick={() => selectGuarantor(guarantors[0].saleId)}
        className={`${wlSecondary} flex min-h-10 items-center gap-2`}><UserPlus size={17} aria-hidden="true" />Добавить поручителя</button>}
      <label className="flex gap-3 text-sm"><input type="checkbox" disabled={saving} className="mt-1 shrink-0" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>{guarantor ? 'Подтверждаю отправку обеих записей' : 'Подтверждаю'}</span></label>
      <button type="button" className={`${wlButton} w-full`} disabled={saving || !confirmed || !valid} onClick={submit}>{saving ? 'Отправляем…' : 'Отправить'}</button>
    </>}
    {onChooseAnother && <button type="button" disabled={saving} className={wlSecondary} onClick={onChooseAnother}>Выбрать другого клиента</button>}
  </div>;
};
export default WatchlistSubmissionForm;
