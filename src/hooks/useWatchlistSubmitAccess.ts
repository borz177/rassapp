import { useContext, useEffect, useState } from 'react';
import { User } from '../../types';
import { api } from '../../services/api';
import { ModalParkContext } from '../../components/transitions/park';
import { WatchlistStatus, watchlistCanSubmit } from '../watchlist';

/** Один запрос на экран, без запросов из каждой строки договора. */
export function useWatchlistStatus(user?: User | null, parked = false): WatchlistStatus | null {
  const userId = user?.id;
  const eligible = !!userId && (user?.role === 'admin' || user?.role === 'manager');
  const [access, setAccess] = useState<{ userId: string; status: WatchlistStatus } | null>(null);
  useEffect(() => {
    setAccess(null);
    if (!eligible || parked) return;
    let controller: AbortController | null = null, disposed = false;
    const refresh = () => {
      controller?.abort();
      if (disposed || document.hidden) return;
      if (!navigator.onLine) { setAccess(null); return; }
      const request = new AbortController(); controller = request;
      api.watchlistRequest<WatchlistStatus>('/watchlist/status', { signal: request.signal })
        .then(status => { if (!disposed && !request.signal.aborted) setAccess({ userId: userId!, status }); })
        .catch(() => { if (!disposed && !request.signal.aborted) setAccess(null); });
    };
    refresh();
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh); window.addEventListener('offline', refresh);
    return () => { disposed = true; controller?.abort(); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', refresh); window.removeEventListener('offline', refresh); };
  }, [userId, user?.role, eligible, parked]);
  return eligible && !parked && access?.userId === userId ? access.status : null;
}

export function useWatchlistSubmitAccess(user?: User | null): boolean {
  const parked = useContext(ModalParkContext);
  return watchlistCanSubmit(useWatchlistStatus(user, parked));
}
