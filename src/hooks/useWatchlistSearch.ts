import { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import { WatchlistMatch, WatchlistStatus, watchlistCanSearch, watchlistSearchQuery } from '../watchlist';

type Phase = 'idle' | 'waiting' | 'loading' | 'success' | 'error' | 'expired';
interface Result { key: string; phase: Phase; items: WatchlistMatch[]; limited: boolean; error?: string }
const empty = (key: string, phase: Phase = 'idle'): Result => ({ key, phase, items: [], limited: false });

/** Только память открытого окна. Без кеша, истории запросов и фонового опроса. */
export function useWatchlistSearch({ userId, name, year = '', active, composing = false, status, manual = false }: {
  userId: string; name: string; year?: string; active: boolean; composing?: boolean; status?: WatchlistStatus | null; manual?: boolean;
}) {
  const [visible, setVisible] = useState(() => !document.hidden);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [remote, setRemote] = useState<{ userId: string; status: WatchlistStatus } | null>(null);
  const [result, setResult] = useState<Result>(() => empty(''));
  const [attempt, setAttempt] = useState(0);
  const [requestedKey, setRequestedKey] = useState('');
  const sequence = useRef(0);
  const enabled = active && visible;
  useEffect(() => {
    const visibility = () => {
      setVisible(!document.hidden);
      if (document.hidden) setRequestedKey('');
    };
    const network = () => {
      setOnline(navigator.onLine);
      if (!navigator.onLine) setRequestedKey('');
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', network); window.addEventListener('offline', network);
    return () => { document.removeEventListener('visibilitychange', visibility); window.removeEventListener('online', network); window.removeEventListener('offline', network); };
  }, []);

  // В общем поиске права загружаются при открытии; сама страница передаёт свой status.
  useEffect(() => {
    if (status !== undefined || !enabled) { setRemote(null); return; }
    if (!online) return;
    setRemote(null);
    const controller = new AbortController();
    api.watchlistRequest<WatchlistStatus>('/watchlist/status', { signal: controller.signal })
      .then(s => { if (!controller.signal.aborted) setRemote({ userId, status: s }); })
      .catch(() => {});
    return () => controller.abort();
  }, [enabled, online, userId, status === undefined]);

  const access = status === undefined ? remote?.userId === userId ? remote.status : null : status;
  const allowed = watchlistCanSearch(access);
  const query = composing ? null : watchlistSearchQuery(name, year);
  const eligibleKey = enabled && allowed && query ? JSON.stringify([userId, query.name, query.birthYear]) : '';
  const key = !manual || eligibleKey === requestedKey ? eligibleKey : '';

  useEffect(() => {
    if (requestedKey && requestedKey !== eligibleKey) setRequestedKey('');
  }, [eligibleKey, requestedKey]);

  useEffect(() => {
    const generation = ++sequence.current;
    const controller = new AbortController();
    let expiry: ReturnType<typeof setTimeout> | undefined;
    setResult(empty(key, key ? 'waiting' : 'idle'));
    if (!key || !online) return () => controller.abort();
    const timer = setTimeout(async () => {
      const current = () => !controller.signal.aborted && generation === sequence.current && !document.hidden && navigator.onLine;
      setResult(empty(key, 'loading'));
      try {
        const data = await api.watchlistRequest<{ items: WatchlistMatch[]; limited: boolean }>('/watchlist/search', {
          method: 'POST', body: query, signal: controller.signal,
        });
        if (!current()) return;
        setResult({ key, phase: 'success', items: data.items, limited: data.limited });
        expiry = setTimeout(() => { if (current()) setResult(empty(key, 'expired')); }, 30000);
      } catch (e: any) {
        if (!current()) return;
        setResult({ ...empty(key, 'error'), error: e.status === 429 ? 'Лимит проверок исчерпан. Попробуйте позже.' : e.message || 'Проверка недоступна. Попробуйте позже.' });
      }
    }, manual ? 0 : 1200);
    return () => { controller.abort(); clearTimeout(timer); if (expiry) clearTimeout(expiry); };
    // key содержит нормализованные имя/год. Регистр и лишние пробелы не создают запросов.
  }, [key, online, attempt, manual]);

  const current = key && result.key === key ? result : empty(key, key ? 'waiting' : 'idle');
  return { ...current, key, allowed: enabled && allowed, online,
    canCheck: Boolean(eligibleKey) && online && current.phase !== 'waiting' && current.phase !== 'loading',
    ...(!manual && enabled && allowed && !online ? { phase: 'error' as const, items: [], error: 'Нет интернета. Проверка недоступна.' } : {}),
    retry: () => {
      if (manual) {
        if (!eligibleKey || !online || !navigator.onLine || document.hidden || current.phase === 'waiting' || current.phase === 'loading') return;
        setRequestedKey(eligibleKey);
        setResult(empty(eligibleKey, 'waiting'));
      }
      setAttempt(n => n + 1);
    },
    reset: () => setRequestedKey(''),
  };
}
