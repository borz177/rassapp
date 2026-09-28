import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { AppNotification } from '../types';

/**
 * Лента уведомлений с подгрузкой.
 *
 * Раньше и окно уведомлений, и страница «Все уведомления» брали ровно одну
 * страницу в 30 записей и на этом останавливались — при том, что у большинства
 * пользователей уведомлений заметно больше, а на сервере постраничная выдача
 * была готова. Получалось, что «все» показывало столько же, сколько окно, и
 * старое не открывалось нигде.
 *
 * Здесь одна загрузка на оба экрана: окно просит неделю, страница — всё
 * подряд, а продолжение подтягивается по мере прокрутки.
 */

export interface NotificationFeedOptions {
  /** Архивная лента вместо обычной */
  archived?: boolean;
  /** Только непрочитанные — их показываем независимо от периода */
  unread?: boolean;
  /** ISO-дата: ничего старше не запрашиваем */
  since?: string | null;
  limit?: number;
}

export interface NotificationFeed {
  items: AppNotification[];
  setItems: Dispatch<SetStateAction<AppNotification[]>>;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

export const useNotificationFeed = (
  { archived = false, unread = false, since = null, limit = 30 }: NotificationFeedOptions
): NotificationFeed => {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Вкладки переключают быстрее, чем отвечает сервер: ответ на прошлый запрос
  // не должен подменять список, который уже грузится для новой вкладки.
  const requestId = useRef(0);

  const request = useCallback(
    (cur?: string) => api.getNotifications({
      archived, unread, limit,
      since: since || undefined,
      cursor: cur,
    }),
    [archived, unread, since, limit]
  );

  const reload = useCallback(async () => {
    const id = ++requestId.current;
    setIsLoading(true);
    try {
      const res = await request();
      if (id !== requestId.current) return;
      setItems(res.items);
      setCursor(res.nextCursor);
    } catch (error) {
      console.error('Failed to load notifications:', error);
      if (id !== requestId.current) return;
      setItems([]);
      setCursor(null);
    } finally {
      if (id === requestId.current) setIsLoading(false);
    }
  }, [request]);

  useEffect(() => { reload(); }, [reload]);

  const loadMore = useCallback(async () => {
    if (!cursor || isLoading || isLoadingMore) return;
    const id = requestId.current;
    setIsLoadingMore(true);
    try {
      const res = await request(cursor);
      if (id !== requestId.current) return;
      // Рассылки от администратора приходят из своей таблицы — на стыке страниц
      // одна и та же может попасть дважды, поэтому сверяемся по id.
      setItems(prev => {
        const seen = new Set(prev.map(n => n.id));
        return [...prev, ...res.items.filter(n => !seen.has(n.id))];
      });
      setCursor(res.nextCursor);
    } catch (error) {
      console.error('Failed to load more notifications:', error);
    } finally {
      if (id === requestId.current) setIsLoadingMore(false);
    }
  }, [cursor, isLoading, isLoadingMore, request]);

  return { items, setItems, isLoading, isLoadingMore, hasMore: !!cursor, loadMore, reload };
};

/** Начало недели для окна уведомлений — ISO-строка семидневной давности. */
export const weekAgoIso = () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

export default useNotificationFeed;
