import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { useWatchlistSearch } from '../src/hooks/useWatchlistSearch';
import { WATCHLIST_REASONS, watchlistBirthDateLabel, type WatchlistStatus } from '../src/watchlist';
import WatchlistPrivateContent from './WatchlistPrivateContent';
import { WatchlistGuarantors } from './WatchlistUI';

export type WatchlistCheckAccess = { userId: string; status: WatchlistStatus };

export const watchlistBirthYear = (birthDate?: string) =>
  birthDate?.match(/^(\d{4})-\d{2}-\d{2}(?:T.*)?$/)?.[1]
  || birthDate?.match(/^\d{2}\.\d{2}\.(\d{4})$/)?.[1] || '';

type Props = {
  access: WatchlistCheckAccess;
  name: string;
  birthDate?: string;
  active?: boolean;
};

export default function CustomerWatchlistHint({ access, name, birthDate, active = true }: Props) {
  const year = watchlistBirthYear(birthDate);
  const result = useWatchlistSearch({ userId: access.userId, status: access.status, name, year, active });
  return <CustomerWatchlistResult result={result} year={year} userId={access.userId} showWatermark={false} />;
}

export function CustomerWatchlistResult({ result, year, userId, manual = false, showWatermark = true }: {
  result: ReturnType<typeof useWatchlistSearch>;
  year: string;
  userId: string;
  manual?: boolean;
  showWatermark?: boolean;
}) {
  const message = manual && (result.phase === 'waiting' || result.phase === 'loading'
    ? 'Проверяем чёрный список…'
    : result.phase === 'error' ? result.error || 'Проверка недоступна. Попробуйте ещё раз.'
    : result.phase === 'success' && !result.items.length ? 'Совпадений в ЧС не найдено.' : '');
  if (message) return <p role="status" className="mt-2 text-xs text-slate-600 dark:text-slate-300">{message}</p>;
  if (result.phase !== 'success' || !result.items.length) return null;

  const sameYear = year !== '' && result.items.some(item => item.birthYear === Number(year));
  return <div role="status" className="mt-2">
    <WatchlistPrivateContent userId={userId} key={result.key} showWatermark={showWatermark}>
    <details className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
      <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <ShieldAlert size={16} className="shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 font-medium">{sameYear ? 'Совпали ФИО и год рождения в ЧС' : 'Возможное совпадение по ФИО в ЧС'}</span>
        <span className="shrink-0 text-xs underline underline-offset-2">Подробнее</span>
      </summary>
      <div className="mt-2 space-y-2 border-t border-amber-200 pt-2 dark:border-amber-700/60">
        {result.items.map(item => <div key={item.id} className="break-words">
          <p className="font-medium">{item.name} · {watchlistBirthDateLabel(item)}</p>
          <p className="whitespace-pre-wrap text-xs font-medium text-red-800 dark:text-red-300">Причина со слов автора: {item.reason === 'other'
            ? item.reasonDetails || 'Описание не указано'
            : WATCHLIST_REASONS[item.reason || ''] || 'Не указана'}</p>
          <WatchlistGuarantors guarantors={item.guarantors} />
        </div>)}
        <p className="text-xs">Сверьте данные клиента. Совпадение не подтверждает его личность.</p>
      </div>
    </details>
    </WatchlistPrivateContent>
  </div>;
}
