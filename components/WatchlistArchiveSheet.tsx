import React, { useEffect, useRef, useState } from 'react';
import { appConfirm } from '../src/dialogs';
import { copyText } from '../src/clipboard';
import { toast } from '../src/toast';
import GlassSheet from './GlassSheet';
import WatchlistPrivateContent from './WatchlistPrivateContent';
import { WatchlistError, WatchlistField, wlButton, wlCard, wlInput, wlSecondary } from './WatchlistUI';
import { WATCHLIST_POLICY_VERSION, WATCHLIST_REASONS, WATCHLIST_STATUS, watchlistDateTime } from '../src/watchlist';

type Fields = { name: string; birthDate: string; reason: string; reasonDetails: string; source: string; publishedAt: string };
type Job = { id: string; filename: string; status: 'queued' | 'processing' | 'ready' | 'failed'; progress: number; total: number; scanned?: number | null; error?: string };
type Selection = { from: string | null; to: string | null; reasons: string[]; includeAny: string[]; excludeAny: string[]; requireReason: boolean };
type Row = { ordinal: number; version: number; state: 'draft' | 'submitted' | 'removed'; entryStatus?: string; fields?: Fields; errors: string[]; duplicate?: boolean; dateFromImport?: boolean; excluded?: boolean;
  reasonMessage?: { text: string; messageId: string; publishedAt: string | null; kind: 'reply' | 'adjacent' };
  message?: { text: string; messageId: string; publishedAt: string | null; truncated?: boolean; part?: number; people?: number } };
type Detail = { job: Job; items: Row[]; hasMore: boolean; draftCount: number; excludedCount: number; canPublish: boolean };
type ArchiveBatch = { published: number; duplicates: number; invalid: number; review: number; next: number | null };
type ReasonBatch = { filled: number; processed: number; next: number | null };
type ArchiveAction = 'publish' | 'fill-reason';
type Revision = { version: number; date: string; action: string; before: Fields; fields: Fields };
async function copyName(name: string) {
  if (await copyText(name.trim())) toast.success('ФИО скопировано');
  else toast.error('Не удалось скопировать ФИО');
}
const labels: Record<keyof Fields, string> = {
  name: 'ФИО', birthDate: 'Дата рождения', reason: 'Причина', reasonDetails: 'Описание причины', source: 'Источник информации', publishedAt: 'Дата публикации сообщения',
};
const jobStatus = { queued: 'В очереди', processing: 'Обрабатывается', ready: 'Готов к проверке', failed: 'Ошибка обработки' };
const pageSize = 15;
const archivePage = (id: string, page: number, excluded = false) =>
  `/archives/${encodeURIComponent(id)}?offset=${page * pageSize}&limit=${pageSize}${excluded ? '&excluded=1' : ''}`;
const maxMiB = 9;
const maxFile = maxMiB * 1024 * 1024;
const defaultSelection: Selection = { from: null, to: null, reasons: [], includeAny: [], excludeAny: [], requireReason: false };
const selectionCount = (job: Job) => job.scanned == null ? `сообщений ${job.total}` : `карточек ${job.total} · сообщений просмотрено ${job.scanned}`;
const fieldsOf = <K extends keyof Fields>(fields: Fields, key: K) => key === 'reason'
  ? fields.reason === 'other' && fields.reasonDetails === '❌' ? '❌' : WATCHLIST_REASONS[fields[key]] || fields[key]
  : fields[key];
const rowStatus = (r: Row) => r.excluded ? 'Исключено из импорта' : r.state === 'removed' ? 'Удалена' : r.state === 'draft' ? 'Черновик' : WATCHLIST_STATUS[r.entryStatus || 'pending'] || 'На проверке';
const revisionLabels: Record<string,string> = { submitted:'Отправлено на проверку', publish:'Опубликовано', hide:'Скрыто', reject:'Отклонено', excluded:'Исключено из импорта', restored:'Возвращено в импорт', reason_filled:'Добавлена общая причина' };

export default function WatchlistArchiveSheet({ userId, onClose, request, onSubmitted }: {
  userId: string; onClose: () => void; request: (path: string, body?: unknown) => Promise<any>; onSubmitted: () => void;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState('');
  const [page, setPage] = useState(0);
  const [showExcluded, setShowExcluded] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [source, setSource] = useState('');
  const [instruction, setInstruction] = useState('');
  const [interpretedInstruction, setInterpretedInstruction] = useState('');
  const [selection, setSelection] = useState(defaultSelection);
  const [showSelection, setShowSelection] = useState(false);
  const [includeText, setIncludeText] = useState('');
  const [excludeText, setExcludeText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [selected, setSelected] = useState<Row | null>(null);
  const [fields, setFields] = useState<Fields>();
  const [history, setHistory] = useState<Revision[] | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [archiveAction, setArchiveAction] = useState<ArchiveAction | null>(null);
  const [defaultReason, setDefaultReason] = useState('');
  const [defaultReasonDetails, setDefaultReasonDetails] = useState('');
  const [basisVerified, setBasisVerified] = useState(false);
  const [archiveProgress, setArchiveProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const working = useRef(false);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        if (!jobId) {
          const result = await request('/archives');
          if (active) setJobs(result.items);
          return;
        }
        const view: Detail = await request(archivePage(jobId, page, showExcluded));
        if (!active) return;
        setDetail(view);
        if (view.job.status === 'queued' || view.job.status === 'processing') timer = setTimeout(load, 2500);
      } catch (e: any) { if (active) setError(e.message); }
    };
    void load();
    return () => { active = false; clearTimeout(timer); };
  }, [jobId, page, request, showExcluded]);

  const run = async (work: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true); setError(''); setFeedback('');
    try { await work(); } catch (e: any) { setError(e.message); }
    finally { working.current = false; setBusy(false); }
  };
  const openJob = (id: string) => {
    setJobId(id); setPage(0); setDetail(null); setSelected(null); setError(''); setFeedback('');
    setArchiveAction(null); setBasisVerified(false); setShowExcluded(false);
  };
  const filterReady = !instruction.trim() || interpretedInstruction === instruction.trim();
  const interpret = () => run(async () => {
    const value = instruction.trim();
    setInterpretedInstruction('');
    const result: { selection: Selection } = await request('/archives/selection', { instruction: value });
    setSelection(result.selection);
    setIncludeText(result.selection.includeAny.join('\n'));
    setExcludeText(result.selection.excludeAny.join('\n'));
    setInterpretedInstruction(value);
    setShowSelection(true);
  });
  const upload = () => run(async () => {
    if (!file || !filterReady) return;
    if (file.size > maxFile) throw new Error(`Размер HTML-файла превышает ${maxMiB} МБ.`);
    const body = new FormData();
    const phrases = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean);
    body.append('source', source.trim());
    body.append('selection', JSON.stringify({ ...selection, includeAny: phrases(includeText), excludeAny: phrases(excludeText) }));
    body.append('archive', file, file.name);
    const job: Job = await request('/archives', body);
    setFile(null); setFileKey(key => key + 1); openJob(job.id);
  });
  const select = (r: Row) => { setSelected(r); setFields(r.fields); setConfirmed(false); setHistory(null); setError(''); setFeedback(''); };
  const setField = (key: keyof Fields, value: string) => { setFields(prev => prev ? { ...prev, [key]: value } : prev); setConfirmed(false); };
  const setCardReason = (value: string) => {
    setFields(previous => previous && ({ ...previous, reason: value === 'cross' ? 'other' : value, reasonDetails: value === 'cross' ? '❌' : '' }));
    setConfirmed(false);
  };
  const recordPath = selected ? `/archives/${encodeURIComponent(jobId)}/records/${selected.ordinal}` : '';
  const changeExclusion = () => run(async () => {
    if (!selected) return;
    const action = selected.excluded ? 'restore' : 'exclude';
    await request(recordPath, { action, version: selected.version });
    setSelected(null);
    const view: Detail = await request(archivePage(jobId, page, showExcluded));
    if (!view.items.length && page > 0) setPage(page - 1);
    else setDetail(view);
    setFeedback(action === 'exclude' ? 'Черновик исключён из импорта' : 'Черновик возвращён в импорт');
  });
  const reasonText = defaultReasonDetails.trim();
  const validReason = defaultReason !== 'other' || reasonText === '❌' || reasonText.length >= 3;
  const applyArchiveAction = (action: ArchiveAction) => run(async () => {
    if (!detail?.draftCount || !validReason || (action === 'publish' ? !basisVerified : !defaultReason)) return;
    setArchiveProgress(0);
    const path = `/archives/${encodeURIComponent(jobId)}`;
    const payload = defaultReason === 'cross'
      ? { defaultReason: 'other', defaultReasonDetails: '❌' }
      : { defaultReason, defaultReasonDetails };
    let after: number | null = 0, published = 0, duplicates = 0, invalid = 0, review = 0, filled = 0, processed = 0;
    let finished = false;
    try {
      do {
        if (action === 'fill-reason') {
          const batch: ReasonBatch = await request(path + '/fill-reason', { after, ...payload });
          filled += batch.filled;
          processed += batch.processed;
          after = batch.next;
        } else {
          const batch: ArchiveBatch = await request(path + '/publish', {
            after, ...payload, basisVerified, shownVersion: WATCHLIST_POLICY_VERSION,
          });
          published += batch.published;
          duplicates += batch.duplicates;
          invalid += batch.invalid;
          review += batch.review;
          processed = published + duplicates + invalid + review;
          after = batch.next;
        }
        setArchiveProgress(processed);
      } while (after !== null);
      finished = true;
      setArchiveAction(null);
      setBasisVerified(false);
    } finally {
      setArchiveProgress(null);
      if (finished || processed > 0) {
        setFeedback(action === 'fill-reason' ? `Заполнено причин · ${filled}`
          : `Опубликовано ${published} · Дубли ${duplicates} · Требуют проверки ${invalid + review}`);
      }
      const latest: Detail | null = await request(archivePage(jobId, page)).catch(() => null);
      if (latest) setDetail(latest);
      if (action === 'publish' && (published || (latest && latest.draftCount < detail.draftCount))) onSubmitted();
    }
  });
  const save = (action: 'save' | 'submit') => run(async () => {
    if (!selected || !fields) return;
    await request(recordPath, { action, fields, version: selected.version, confirmed });
    const view: Detail = await request(archivePage(jobId, page));
    setDetail(view);
    const updated = view.items.find(item => item.ordinal === selected.ordinal);
    if (updated) select(updated);
    if (action === 'submit' || selected.state === 'submitted') onSubmitted();
    setFeedback(action === 'submit' ? 'Отправлено на ручную проверку' : 'Изменения сохранены');
  });
  const mayEdit = selected && !selected.excluded && (selected.state === 'draft' || ['pending', 'hidden'].includes(selected.entryStatus || ''));
  const cardReason = fields?.reason === 'other' && fields.reasonDetails === '❌' ? 'cross' : fields?.reason;
  return <GlassSheet title="Импорт из Telegram" onClose={onClose} confirmClose={() => !working.current}>
    <div className="space-y-4 p-4">
      {jobs.length > 0 && <button type="button" className={wlSecondary} disabled={busy} onClick={() => void run(async () => {
        if (!await appConfirm({ title: 'Очистить список импортов?', message: 'Файлы исчезнут из списка, неопубликованные черновики будут удалены. Опубликованные записи ЧС сохранятся.',
            confirmLabel: 'Очистить', cancelLabel: 'Отмена', destructive: true })) return;
        const result = await request('/archives/clear', { confirmed: true });
        setJobs((await request('/archives')).items);
        openJob('');
        setFeedback(result.pending ? 'Список очищен. Обрабатываемые файлы пока оставлены.' : 'Список импортов очищен');
      })}>Очистить список импортов</button>}
      <WatchlistError message={error || null} />
      {feedback && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{feedback}</p>}
      {!jobId && <>
        <form className={`${wlCard} space-y-3`} onSubmit={e => { e.preventDefault(); if (!busy) void upload(); }}>
          <WatchlistField label="Название источника"><input className={wlInput} maxLength={200} value={source} onChange={e => setSource(e.target.value)} placeholder="Название группы или канала" /></WatchlistField>
          <WatchlistField label="HTML-файл Telegram"><input key={fileKey} className={wlInput} type="file" accept=".html,.htm,text/html" onChange={e => setFile(e.target.files?.[0] || null)} /></WatchlistField>
          <p className="text-xs text-slate-500">Загружайте файлы messages.html, messages2.html и другие части отдельно. До {maxMiB} МБ на файл.</p>
          <WatchlistField label="Что отобрать">
            <textarea className={wlInput} rows={3} maxLength={600} disabled={busy} value={instruction}
              onChange={e => { setInstruction(e.target.value); setInterpretedInstruction(''); }}
              placeholder="Например, записи за ноябрь с длительной просрочкой. Пропусти сообщения со словами «долг погашен»." />
          </WatchlistField>
          <p className="text-xs text-slate-500">ИИ получает только инструкцию. Персональные данные оставляйте в архиве.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={wlSecondary} disabled={busy || instruction.trim().length < 8} onClick={() => void interpret()}>Подготовить фильтр с ИИ</button>
            <button type="button" className={wlSecondary} disabled={busy} onClick={() => {
              if (!filterReady) { setInstruction(''); setInterpretedInstruction(''); }
              setShowSelection(value => !filterReady || !value);
            }}>{showSelection && filterReady ? 'Скрыть фильтр' : 'Задать вручную'}</button>
          </div>
          {showSelection && filterReady && <fieldset disabled={busy} className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <legend className="px-1 text-sm font-semibold">Фильтр по дате публикации и содержанию</legend>
            <div className="grid grid-cols-2 gap-2">
              <WatchlistField label="С даты"><input className={wlInput} type="date" aria-label="Начало периода публикации" value={selection.from || ''} onChange={e => setSelection(previous => ({ ...previous, from: e.target.value || null }))} /></WatchlistField>
              <WatchlistField label="По дату"><input className={wlInput} type="date" aria-label="Конец периода публикации" value={selection.to || ''} onChange={e => setSelection(previous => ({ ...previous, to: e.target.value || null }))} /></WatchlistField>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(WATCHLIST_REASONS).map(([key, label]) => <label className="flex items-center gap-1" key={key}>
                <input type="checkbox" checked={selection.reasons.includes(key)} onChange={e => setSelection(previous => ({ ...previous,
                  reasons: e.target.checked ? [...previous.reasons, key] : previous.reasons.filter(reason => reason !== key),
                }))} />{label}
              </label>)}
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selection.requireReason} onChange={e => setSelection(previous => ({ ...previous, requireReason: e.target.checked }))} />Причина обязательна</label>
            <WatchlistField label="Хотя бы одна фраза из списка"><textarea className={wlInput} rows={2} maxLength={500} placeholder="Одна фраза на строку" value={includeText} onChange={e => setIncludeText(e.target.value)} /></WatchlistField>
            <WatchlistField label="Пропустить при любой из этих фраз"><textarea className={wlInput} rows={2} maxLength={500} placeholder="Одна фраза на строку" value={excludeText} onChange={e => setExcludeText(e.target.value)} /></WatchlistField>
          </fieldset>}
          <p className="text-xs text-slate-500">Дата рождения необязательна. Если в сообщении нет даты публикации, подставится день импорта.</p>
          <button className={wlButton} disabled={busy || !file || source.trim().length < 2 || !filterReady}>{busy ? 'Подождите…' : 'Отобрать для проверки'}</button>
        </form>
        {jobs.map(job => <button className={`${wlCard} block w-full text-left`} type="button" key={job.id} onClick={() => openJob(job.id)}>
          <span className="block font-semibold break-words">{job.filename}</span><span className="text-sm text-slate-500">{jobStatus[job.status]}{job.status === 'ready' ? ` · ${selectionCount(job)}` : ''}</span>
        </button>)}
      </>}
      {jobId && <button className={wlSecondary} type="button" disabled={busy} onClick={() => selected ? setSelected(null) : openJob('')}>{selected ? 'К сообщениям' : 'К архивам'}</button>}
      {detail && <div className={wlCard}>
        <p className="font-semibold break-words">{detail.job.filename}</p>
        <p className="text-sm text-slate-500">{jobStatus[detail.job.status]}{detail.job.status === 'ready' ? ` · ${selectionCount(detail.job)}` : ''}</p>
        {detail.job.status === 'ready' && !detail.job.total && <p className="mt-2 text-sm">Подходящих сообщений нет. Загрузите файл с другими условиями отбора.</p>}
        {['queued','processing'].includes(detail.job.status) && <div className="mt-2 flex items-center gap-2 text-sm"><progress aria-label="Прогресс обработки" className="w-full" value={detail.job.progress} max={100} /><span>{detail.job.progress}%</span></div>}
        {detail.job.error && <WatchlistError message={detail.job.error} />}
      </div>}
      {detail?.job.status === 'ready' && !selected && (showExcluded || detail.excludedCount > 0) && <button type="button" className={wlSecondary} disabled={busy}
        onClick={() => { setPage(0); setDetail(null); setShowExcluded(value => !value); setArchiveAction(null); setBasisVerified(false); }}>
        {showExcluded ? 'К списку импорта' : `Исключённые · ${detail.excludedCount}`}
      </button>}
      {showExcluded && detail && !detail.items.length && <p className="text-sm text-slate-500">Исключённых записей нет.</p>}
      {detail?.job.status === 'ready' && detail.draftCount > 0 && !selected && !showExcluded && <div className={`${wlCard} space-y-3`}>
        {!archiveAction ? <div className="flex flex-wrap gap-2">
          <button type="button" className={wlButton} disabled={busy || !detail.canPublish} onClick={() => setArchiveAction('publish')}>Опубликовать все</button>
          <button type="button" className={wlSecondary} disabled={busy} onClick={() => setArchiveAction('fill-reason')}>Заполнить причины</button>
        </div> : <>
          <p className="text-sm font-semibold">Черновики в этом файле · {detail.draftCount}</p>
          <fieldset disabled={busy} className="space-y-3">
            <WatchlistField label="Причина для записей без причины">
              <select className={wlInput} value={defaultReason} onChange={e => { setDefaultReason(e.target.value); setBasisVerified(false); }}>
                <option value="">Выберите причину</option>
                <option value="cross">❌</option>
                {Object.entries(WATCHLIST_REASONS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
              </select>
            </WatchlistField>
            {defaultReason === 'other' && <WatchlistField label="Описание причины"><textarea rows={2} className={wlInput} maxLength={1000} value={defaultReasonDetails}
              onChange={e => { setDefaultReasonDetails(e.target.value); setBasisVerified(false); }} /></WatchlistField>}
            {archiveAction === 'publish' && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={basisVerified}
              onChange={e => setBasisVerified(e.target.checked)} />Записи проверены, основание публикации подтверждаю</label>}
          </fieldset>
          {archiveProgress !== null && <p role="status" className="text-sm">Обработано {archiveProgress} из {detail.draftCount}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={wlButton}
              disabled={busy || !validReason || (archiveAction === 'publish' ? !basisVerified || !detail.canPublish : !defaultReason)}
              onClick={() => void applyArchiveAction(archiveAction)}>{archiveAction === 'publish' ? 'Подтвердить публикацию' : 'Заполнить пустые причины'}</button>
            <button type="button" className={wlSecondary} disabled={busy} onClick={() => { setArchiveAction(null); setBasisVerified(false); }}>Отмена</button>
          </div>
        </>}
        {!detail.canPublish && <p className="text-xs text-slate-500">Публикация недоступна при текущих настройках.</p>}
      </div>}
      {detail?.items.length && !selected ? <WatchlistPrivateContent userId={userId} showWatermark={false} className="space-y-3">
        {detail.items.map(row => <div className={`${wlCard} w-full text-left`} key={row.ordinal}>
          {row.fields?.name ? <button type="button" className="block min-h-11 w-full text-left font-semibold break-words active:opacity-60"
            aria-label={`Скопировать ФИО: ${row.fields.name}`} onClick={() => void copyName(row.fields!.name)}>{row.fields.name}</button>
            : <span className="block font-semibold">Сообщение № {row.ordinal}</span>}
          <button className="block w-full text-left" type="button" onClick={() => select(row)} disabled={row.state==='removed'}>
          {row.fields && <span className="mt-1 block break-words text-sm">
            {row.fields.birthDate && `${row.fields.birthDate} · `}
            {row.fields.reason === 'other' ? row.fields.reasonDetails || 'Причина не указана' : WATCHLIST_REASONS[row.fields.reason] || 'Причина не указана'}
          </span>}
          <span className="block text-sm text-slate-500">{rowStatus(row)}{row.duplicate ? ' · возможный дубль' : row.errors.length && row.state==='draft' ? ' · проверьте поля' : ''}</span>
          </button>
        </div>)}
        {(detail.hasMore || page > 0) && <div className="flex justify-between gap-2">
          <button className={wlSecondary} disabled={!page} onClick={() => { setDetail(null); setPage(n => n-1); }}>Назад</button>
          <button className={wlSecondary} disabled={!detail.hasMore} onClick={() => { setDetail(null); setPage(n => n+1); }}>Далее</button>
        </div>}
      </WatchlistPrivateContent> : null}
      {selected && fields && <WatchlistPrivateContent userId={userId} showWatermark={false} className="space-y-3">
        <details className={wlCard} open>
          <summary className="cursor-pointer font-semibold">{selected.message?.people
            ? `Фрагмент сообщения · ${selected.message.part} из ${selected.message.people}`
            : 'Исходное сообщение Telegram'}</summary>
          {selected.message?.publishedAt && <p className="mt-1 text-xs text-slate-500">{watchlistDateTime(selected.message.publishedAt)}</p>}
          <p className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words text-sm">{selected.message?.text}</p>
          {selected.reasonMessage && <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
            <p className="text-xs font-medium text-slate-500">{selected.reasonMessage.kind === 'reply' ? 'Причина из ответа Telegram' : 'Причина из следующего сообщения · проверьте связь'}</p>
            {selected.reasonMessage.publishedAt && <p className="mt-1 text-xs text-slate-500">{watchlistDateTime(selected.reasonMessage.publishedAt)}</p>}
            <p className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-sm">{selected.reasonMessage.text}</p>
          </div>}
          {selected.message?.truncated && <p className="mt-2 text-xs text-slate-500">Показана первая часть длинного сообщения.</p>}
        </details>
        <div className={`${wlCard} space-y-3`}>
          <p className="text-sm font-semibold">{rowStatus(selected)}</p>
          {selected.duplicate && <p className="text-sm text-amber-700 dark:text-amber-300">Возможный дубль. Проверьте ФИО и дату рождения.</p>}
          {selected.errors.length > 0 && <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-300">{selected.errors.map(text => <li key={text}>{text}</li>)}</ul>}
          <fieldset disabled={busy || !mayEdit} className="space-y-3">
            <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium text-slate-600 dark:text-slate-300">ФИО</span><button type="button" disabled={!fields.name.trim()} onClick={() => void copyName(fields.name)} className="min-h-11 text-sm font-semibold text-indigo-600 disabled:opacity-40 dark:text-indigo-400">Скопировать ФИО</button></div>
            <WatchlistField label={labels.name}><input className={wlInput} maxLength={200} value={fields.name} onChange={e => setField('name', e.target.value)} /></WatchlistField>
            <WatchlistField label="Дата рождения · необязательно"><input className={wlInput} maxLength={32} placeholder="ДД.ММ.ГГГГ или год" value={fields.birthDate} onChange={e => setField('birthDate', e.target.value)} /></WatchlistField>
            <WatchlistField label={labels.reason}><select className={wlInput} value={cardReason} onChange={e => setCardReason(e.target.value)}><option value="">Выберите причину</option><option value="cross">❌</option>{Object.entries(WATCHLIST_REASONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></WatchlistField>
            {cardReason==='other' && <WatchlistField label={labels.reasonDetails}><textarea className={wlInput} rows={3} maxLength={1000} placeholder="Описание без паспортных данных и контактов" value={fields.reasonDetails} onChange={e => setField('reasonDetails', e.target.value)} /></WatchlistField>}
            <WatchlistField label={labels.source}><input className={wlInput} maxLength={200} value={fields.source} onChange={e => setField('source', e.target.value)} /></WatchlistField>
            <WatchlistField label={labels.publishedAt}><input className={wlInput} maxLength={80} value={fields.publishedAt} placeholder="ДД.ММ.ГГГГ ЧЧ:ММ (МСК)" onChange={e => setField('publishedAt', e.target.value)} /></WatchlistField>
            {selected.dateFromImport && fields.publishedAt === selected.fields?.publishedAt && <p className="text-xs text-slate-500">Подставлена дата импорта.</p>}
            {mayEdit && <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Поля сверены с источником</label>}
          </fieldset>
          {mayEdit && <div className="flex flex-wrap gap-2">
            {selected.state==='draft' && <button type="button" className={wlSecondary} disabled={busy} onClick={() => void save('save')}>Сохранить черновик</button>}
            <button type="button" className={wlButton} disabled={busy || !confirmed} onClick={() => void save(selected.state==='draft' ? 'submit' : 'save')}>{selected.state==='draft' ? 'Отправить на проверку' : 'Сохранить исправление'}</button>
          </div>}
          {!mayEdit && selected.entryStatus==='published' && <p className="text-xs text-slate-500">Чтобы исправить опубликованную запись, скройте её в разделе «Записи».</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {selected.state === 'draft' && <button type="button" className={wlSecondary} disabled={busy}
            onClick={() => void changeExclusion()}>{selected.excluded ? 'Вернуть в импорт' : 'Исключить из импорта'}</button>}
          <button className={wlSecondary} disabled={busy} onClick={() => void run(async () => setHistory((await request(recordPath+'/history')).items))}>История изменений</button>
        </div>
        {history && <div className={`${wlCard} space-y-3 text-sm`}>
          {!history.length && <p className="text-slate-500">Изменений ещё нет.</p>}
          {history.map(item => <div className="space-y-1" key={item.version}>
            <p className="font-medium">{watchlistDateTime(item.date)} · {revisionLabels[item.action] || 'Изменено'}</p>
            {(Object.keys(labels) as (keyof Fields)[]).filter(key => item.before[key]!==item.fields[key]).map(key => <p className="break-words" key={key}>{labels[key]} · {fieldsOf(item.before,key) || '—'} → {fieldsOf(item.fields,key) || '—'}</p>)}
          </div>)}
        </div>}
      </WatchlistPrivateContent>}
    </div>
  </GlassSheet>;
}
