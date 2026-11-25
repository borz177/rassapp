import React, { useEffect, useState } from 'react';
import GlassSheet from './GlassSheet';
import WatchlistPrivateContent from './WatchlistPrivateContent';
import { WatchlistError, WatchlistField, wlButton, wlCard, wlInput, wlSecondary } from './WatchlistUI';
import { WATCHLIST_REASONS, WATCHLIST_STATUS, watchlistDateTime } from '../src/watchlist';

type Fields = { name: string; birthDate: string; reason: string; reasonDetails: string; source: string; publishedAt: string };
type Job = { id: string; filename: string; status: 'queued' | 'processing' | 'ready' | 'failed'; progress: number; total: number; error?: string };
type Row = { ordinal: number; version: number; state: 'draft' | 'submitted' | 'removed'; entryStatus?: string; fields?: Fields; errors: string[]; duplicate?: boolean;
  message?: { text: string; messageId: string; publishedAt: string | null; truncated?: boolean } };
type Detail = { job: Job; items: Row[]; hasMore: boolean };
type Revision = { version: number; date: string; action: string; before: Fields; fields: Fields };
const labels: Record<keyof Fields, string> = {
  name: 'ФИО', birthDate: 'Дата рождения', reason: 'Причина', reasonDetails: 'Описание причины', source: 'Источник информации', publishedAt: 'Дата публикации сообщения',
};
const jobStatus = { queued: 'В очереди', processing: 'Обрабатывается', ready: 'Готов к проверке', failed: 'Ошибка обработки' };
const pageSize = 15;
const maxMiB = 9;
const maxFile = maxMiB * 1024 * 1024;
const fieldsOf = <K extends keyof Fields>(fields: Fields, key: K) => key === 'reason' ? WATCHLIST_REASONS[fields[key]] || fields[key] : fields[key];
const rowStatus = (r: Row) => r.state === 'removed' ? 'Удалена' : r.state === 'draft' ? 'Черновик' : WATCHLIST_STATUS[r.entryStatus || 'pending'] || 'На проверке';
const revisionLabels: Record<string,string> = { submitted:'Отправлено на проверку', publish:'Опубликовано', hide:'Скрыто', reject:'Отклонено' };

export default function WatchlistArchiveSheet({ userId, onClose, request, onSubmitted }: {
  userId: string; onClose: () => void; request: (path: string, body?: unknown) => Promise<any>; onSubmitted: () => void;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState('');
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [source, setSource] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [selected, setSelected] = useState<Row | null>(null);
  const [fields, setFields] = useState<Fields>();
  const [history, setHistory] = useState<Revision[] | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

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
        const view: Detail = await request(`/archives/${encodeURIComponent(jobId)}?offset=${page * pageSize}&limit=${pageSize}`);
        if (!active) return;
        setDetail(view);
        if (view.job.status === 'queued' || view.job.status === 'processing') timer = setTimeout(load, 2500);
      } catch (e: any) { if (active) setError(e.message); }
    };
    void load();
    return () => { active = false; clearTimeout(timer); };
  }, [jobId, page, request]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError(''); setFeedback('');
    try { await work(); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const openJob = (id: string) => {
    setJobId(id); setPage(0); setDetail(null); setSelected(null); setError(''); setFeedback('');
  };
  const upload = () => run(async () => {
    if (!file) return;
    if (file.size > maxFile) throw new Error(`Размер HTML-файла превышает ${maxMiB} МБ.`);
    const body = new FormData();
    body.append('source', source.trim()); body.append('archive', file, file.name);
    const job: Job = await request('/archives', body);
    setFile(null); setFileKey(key => key + 1); openJob(job.id);
  });
  const select = (r: Row) => { setSelected(r); setFields(r.fields); setConfirmed(false); setHistory(null); setError(''); setFeedback(''); };
  const setField = (key: keyof Fields, value: string) => { setFields(prev => prev ? { ...prev, [key]: value } : prev); setConfirmed(false); };
  const recordPath = selected ? `/archives/${encodeURIComponent(jobId)}/records/${selected.ordinal}` : '';
  const save = (action: 'save' | 'submit') => run(async () => {
    if (!selected || !fields) return;
    await request(recordPath, { action, fields, version: selected.version, confirmed });
    const view: Detail = await request(`/archives/${encodeURIComponent(jobId)}?offset=${page * pageSize}&limit=${pageSize}`);
    setDetail(view);
    const updated = view.items.find(item => item.ordinal === selected.ordinal);
    if (updated) select(updated);
    if (action === 'submit' || selected.state === 'submitted') onSubmitted();
    setFeedback(action === 'submit' ? 'Отправлено на ручную проверку' : 'Изменения сохранены');
  });
  const mayEdit = selected && (selected.state === 'draft' || ['pending', 'hidden'].includes(selected.entryStatus || ''));
  return <GlassSheet title="Импорт из Telegram" onClose={onClose} confirmClose={() => !busy}>
    <div className="space-y-4 p-4">
      <WatchlistError message={error || null} />
      {feedback && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{feedback}</p>}
      {!jobId && <>
        <form className={`${wlCard} space-y-3`} onSubmit={e => { e.preventDefault(); if (!busy) void upload(); }}>
          <WatchlistField label="Название источника"><input className={wlInput} maxLength={200} value={source} onChange={e => setSource(e.target.value)} placeholder="Название группы или канала" /></WatchlistField>
          <WatchlistField label="HTML-файл Telegram"><input key={fileKey} className={wlInput} type="file" accept=".html,.htm,text/html" onChange={e => setFile(e.target.files?.[0] || null)} /></WatchlistField>
          <p className="text-xs text-slate-500">Загружайте файлы messages.html, messages2.html и другие части отдельно. До {maxMiB} МБ на файл.</p>
          <button className={wlButton} disabled={busy || !file || source.trim().length < 2}>{busy ? 'Загружаем…' : 'Загрузить для просмотра'}</button>
        </form>
        {jobs.map(job => <button className={`${wlCard} block w-full text-left`} type="button" key={job.id} onClick={() => openJob(job.id)}>
          <span className="block font-semibold break-words">{job.filename}</span><span className="text-sm text-slate-500">{jobStatus[job.status]}{job.status === 'ready' ? ` · сообщений ${job.total}` : ''}</span>
        </button>)}
      </>}
      {jobId && <button className={wlSecondary} type="button" disabled={busy} onClick={() => selected ? setSelected(null) : openJob('')}>{selected ? 'К сообщениям' : 'К архивам'}</button>}
      {detail && <div className={wlCard}>
        <p className="font-semibold break-words">{detail.job.filename}</p>
        <p className="text-sm text-slate-500">{jobStatus[detail.job.status]}{detail.job.status === 'ready' ? ` · сообщений ${detail.job.total}` : ''}</p>
        {['queued','processing'].includes(detail.job.status) && <div className="mt-2 flex items-center gap-2 text-sm"><progress aria-label="Прогресс обработки" className="w-full" value={detail.job.progress} max={100} /><span>{detail.job.progress}%</span></div>}
        {detail.job.error && <WatchlistError message={detail.job.error} />}
      </div>}
      {detail?.items.length && !selected ? <WatchlistPrivateContent userId={userId} showWatermark={false} className="space-y-3">
        {detail.items.map(row => <button className={`${wlCard} block w-full text-left`} type="button" key={row.ordinal} onClick={() => select(row)} disabled={row.state==='removed'}>
          <span className="block font-semibold break-words">{row.fields?.name || `Сообщение № ${row.ordinal}`}</span>
          <span className="block text-sm text-slate-500">{rowStatus(row)}{row.duplicate ? ' · возможный дубль' : row.errors.length && row.state==='draft' ? ' · проверьте поля' : ''}</span>
          {row.message?.text && <span className="mt-1 block truncate text-xs text-slate-500">{row.message.text}</span>}
        </button>)}
        {(detail.hasMore || page > 0) && <div className="flex justify-between gap-2">
          <button className={wlSecondary} disabled={!page} onClick={() => { setDetail(null); setPage(n => n-1); }}>Назад</button>
          <button className={wlSecondary} disabled={!detail.hasMore} onClick={() => { setDetail(null); setPage(n => n+1); }}>Далее</button>
        </div>}
      </WatchlistPrivateContent> : null}
      {selected && fields && <WatchlistPrivateContent userId={userId} showWatermark={false} className="space-y-3">
        <details className={wlCard} open>
          <summary className="cursor-pointer font-semibold">Исходное сообщение Telegram</summary>
          {selected.message?.publishedAt && <p className="mt-1 text-xs text-slate-500">{watchlistDateTime(selected.message.publishedAt)}</p>}
          <p className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words text-sm">{selected.message?.text}</p>
          {selected.message?.truncated && <p className="mt-2 text-xs text-slate-500">Показана первая часть длинного сообщения.</p>}
        </details>
        <div className={`${wlCard} space-y-3`}>
          <p className="text-sm font-semibold">{rowStatus(selected)}</p>
          {selected.duplicate && <p className="text-sm text-amber-700 dark:text-amber-300">Возможный дубль. Проверьте ФИО и дату рождения.</p>}
          {selected.errors.length > 0 && <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-300">{selected.errors.map(text => <li key={text}>{text}</li>)}</ul>}
          <fieldset disabled={busy || !mayEdit} className="space-y-3">
            <WatchlistField label={labels.name}><input className={wlInput} maxLength={200} value={fields.name} onChange={e => setField('name', e.target.value)} /></WatchlistField>
            <WatchlistField label={labels.birthDate}><input className={wlInput} maxLength={32} placeholder="ДД.ММ.ГГГГ" value={fields.birthDate} onChange={e => setField('birthDate', e.target.value)} /></WatchlistField>
            <WatchlistField label={labels.reason}><select className={wlInput} value={fields.reason} onChange={e => setField('reason', e.target.value)}><option value="">Выберите причину</option>{Object.entries(WATCHLIST_REASONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></WatchlistField>
            {fields.reason==='other' && <WatchlistField label={labels.reasonDetails}><textarea className={wlInput} rows={3} maxLength={1000} placeholder="Описание без паспортных данных и контактов" value={fields.reasonDetails} onChange={e => setField('reasonDetails', e.target.value)} /></WatchlistField>}
            <WatchlistField label={labels.source}><input className={wlInput} maxLength={200} value={fields.source} onChange={e => setField('source', e.target.value)} /></WatchlistField>
            <WatchlistField label={labels.publishedAt}><input className={wlInput} maxLength={80} value={fields.publishedAt} placeholder="ДД.ММ.ГГГГ ЧЧ:ММ (МСК)" onChange={e => setField('publishedAt', e.target.value)} /></WatchlistField>
            {mayEdit && <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Поля сверены с источником</label>}
          </fieldset>
          {mayEdit && <div className="flex flex-wrap gap-2">
            {selected.state==='draft' && <button type="button" className={wlSecondary} disabled={busy} onClick={() => void save('save')}>Сохранить черновик</button>}
            <button type="button" className={wlButton} disabled={busy || !confirmed} onClick={() => void save(selected.state==='draft' ? 'submit' : 'save')}>{selected.state==='draft' ? 'Отправить на проверку' : 'Сохранить исправление'}</button>
          </div>}
          {!mayEdit && selected.entryStatus==='published' && <p className="text-xs text-slate-500">Чтобы исправить опубликованную запись, скройте её в разделе «Записи».</p>}
        </div>
        <button className={wlSecondary} disabled={busy} onClick={() => void run(async () => setHistory((await request(recordPath+'/history')).items))}>История изменений</button>
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
