import React, { useEffect, useRef, useState } from 'react';
import GlassSheet from './GlassSheet';
import WatchlistPrivateContent from './WatchlistPrivateContent';
import { WatchlistError, WatchlistField, wlButton, wlInput, wlSecondary } from './WatchlistUI';
import { WATCHLIST_POLICY_VERSION, WATCHLIST_REASONS, watchlistBirthDateLabel } from '../src/watchlist';

type ImportRow = { number: number; error: string } | {
  number: number; name: string; birthDate?: string; birthYear: number | null; reason: string; reasonDetails?: string;
  duplicate: boolean; review: boolean;
};
type Preview = { canPublish: boolean; rows: ImportRow[] };
export type BulkImportResult = { published: number; pending: number; skipped: number };

export default function WatchlistBulkImportSheet({ userId, request, onClose, onSaved }: {
  userId: string;
  request: (path: string, body: object) => Promise<unknown>;
  onClose: () => void;
  onSaved: (result: BulkImportResult) => void;
}) {
  const [text, setText] = useState('');
  const [defaultReason, setDefaultReason] = useState('');
  const [defaultReasonDetails, setDefaultReasonDetails] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [action, setAction] = useState<'pending' | 'publish'>('pending');
  const [basisVerified, setBasisVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const working = useRef(false);
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const resetPreview = () => { setPreview(null); setAction('pending'); setBasisVerified(false); setError(null); };
  const payload = { text, defaultReason, defaultReasonDetails };
  const check = async (save: boolean) => {
    if (working.current) return;
    working.current = true; setBusy(true); setError(null);
    try {
      if (save) {
        const result = await request('/entries/import', { ...payload, action, basisVerified, shownVersion: WATCHLIST_POLICY_VERSION }) as BulkImportResult;
        if (alive.current) onSaved(result);
      } else {
        const result = await request('/entries/import/preview', payload) as Preview;
        if (alive.current) setPreview(result);
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Не удалось загрузить записи.');
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const rows = preview?.rows ?? [];
  const errors = rows.filter(row => 'error' in row).length;
  const duplicates = rows.filter(row => 'duplicate' in row && row.duplicate).length;
  const ready = rows.length - errors - duplicates;
  const publishesBirthDates = rows.some(row => 'birthDate' in row && row.birthDate && !row.duplicate && !row.review);

  return <GlassSheet title="Массовое добавление в ЧС" onClose={onClose} confirmClose={() => !working.current}>
    <div className="space-y-4 p-4 print:hidden">
      <WatchlistError message={error} />
      {!preview ? <>
        <WatchlistField label="Вставьте список">
          <textarea className={wlInput} value={text} rows={7} maxLength={120000} disabled={busy} spellCheck={false} autoComplete="off"
            placeholder="Иванов Иван Иванович 17.04.1988 Длительная просрочка"
            onChange={e => { setText(e.target.value); resetPreview(); }} />
        </WatchlistField>
        <p className="text-xs text-slate-500 dark:text-slate-400">До 100 строк. Вставьте из Excel или напишите через пробелы. Порядок полей — ФИО, дата рождения, причина.</p>
        <WatchlistField label="Причина для строк без причины">
          <select className={wlInput} value={defaultReason} disabled={busy} onChange={e => { setDefaultReason(e.target.value); resetPreview(); }}>
            <option value="">Не задана</option>
            {Object.entries(WATCHLIST_REASONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </WatchlistField>
        {defaultReason === 'other' && <WatchlistField label="Описание общей причины">
          <textarea className={wlInput} rows={2} maxLength={1000} value={defaultReasonDetails} disabled={busy}
            onChange={e => { setDefaultReasonDetails(e.target.value); resetPreview(); }} />
        </WatchlistField>}
        <button type="button" className={`${wlButton} w-full`} disabled={busy || !text.trim()} onClick={() => void check(false)}>{busy ? 'Проверяем…' : 'Предпросмотр'}</button>
      </> : <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="status" className="text-sm font-medium">Готово {ready} · Повторы {duplicates} · Ошибки {errors}</p>
          <button type="button" className={wlSecondary} disabled={busy} onClick={resetPreview}>Исправить список</button>
        </div>
        <WatchlistPrivateContent userId={userId}>
          <ul className="max-h-64 divide-y divide-slate-200 overflow-auto rounded-xl border border-slate-200 text-sm dark:divide-slate-700 dark:border-slate-700">
            {rows.map(row => <li key={row.number} className="space-y-1 break-words px-3 py-2">
              {'error' in row ? <p className="text-red-700 dark:text-red-300">Строка {row.number} · {row.error}</p> : <>
                <p className="font-medium">{row.name}{row.birthYear && ` · ${watchlistBirthDateLabel(row)}`}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{row.reason === 'other' ? row.reasonDetails : WATCHLIST_REASONS[row.reason]}</p>
                {row.duplicate && <p className="text-xs text-amber-700 dark:text-amber-300">Совпали ФИО и дата или год рождения. Строка будет пропущена.</p>}
                {!row.duplicate && row.review && <p className="text-xs text-amber-700 dark:text-amber-300">Запись требует проверки из-за предыдущего решения.</p>}
              </>}
            </li>)}
          </ul>
        </WatchlistPrivateContent>
        <WatchlistField label="Действие">
          <select className={wlInput} value={action} disabled={busy} onChange={e => { setAction(e.target.value === 'publish' ? 'publish' : 'pending'); setBasisVerified(false); }}>
            <option value="pending">Добавить на проверку</option>
            {preview.canPublish && <option value="publish">Опубликовать</option>}
          </select>
        </WatchlistField>
        {action === 'publish' && <label className="flex gap-3 text-sm">
          <input type="checkbox" checked={basisVerified} disabled={busy} onChange={e => setBasisVerified(e.target.checked)} />
          {publishesBirthDates ? 'Основание публикации проверено, включая полные даты рождения' : 'Основание передачи проверено для всех записей'}
        </label>}
        <button type="button" className={`${wlButton} w-full`} disabled={busy || errors > 0 || !ready || (action === 'publish' && !basisVerified)}
          onClick={() => void check(true)}>{busy ? 'Добавляем…' : action === 'publish' ? 'Опубликовать записи' : 'Добавить записи'}</button>
      </>}
    </div>
  </GlassSheet>;
}
