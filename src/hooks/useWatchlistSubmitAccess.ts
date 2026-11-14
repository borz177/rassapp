import { useContext, useEffect, useState } from 'react';
import { User } from '../../types';
import { api } from '../../services/api';
import { ModalParkContext } from '../../components/transitions/park';
import { WatchlistStatus, watchlistCanSubmit, watchlistUiVisible } from '../watchlist';

/** Один запрос на экран, без запросов из каждой строки договора. */
export function useWatchlistSubmitAccess(user?: User | null): boolean {
  const parked = useContext(ModalParkContext);
  const eligible = watchlistUiVisible(user);
  const [access, setAccess] = useState<{ userId: string; status: WatchlistStatus } | null>(null);
  useEffect(() => {
    setAccess(null);
    if (!eligible || parked) return;
    let controller: AbortController | null = null, disposed = false;
    const refresh = () => {
      controller?.abort(); setAccess(null);
      if (document.hidden || !navigator.onLine || disposed) return;
      const request = new AbortController(); controller = request;
      api.watchlistRequest<WatchlistStatus>('/watchlist/status', { signal: request.signal })
        .then(status => { if (!disposed && !request.signal.aborted) setAccess({ userId: user.id, status }); })
        .catch(() => {});
    };
    refresh();
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh); window.addEventListener('offline', refresh);
    return () => { disposed = true; controller?.abort(); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', refresh); window.removeEventListener('offline', refresh); };
  }, [user?.id, user?.role, eligible, parked]);
  return eligible && !parked && access?.userId === user?.id && watchlistCanSubmit(access?.status);
}
