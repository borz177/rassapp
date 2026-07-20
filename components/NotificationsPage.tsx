import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../services/api';
import { ICONS } from '../constants';
import { AppNotification, NotificationType } from '../types';
import { TYPE_META, NOTIFICATION_TYPE_FILTERS, groupLabel, NotificationDetailModal } from './NotificationShared';

interface NotificationsPageProps {
  onBack: () => void;
  onUnreadChange: (count: number) => void;
}

const NotificationsPage: React.FC<NotificationsPageProps> = ({ onBack, onUnreadChange }) => {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [readFilter, setReadFilter] = useState<'all' | 'unread'>('all');
  const [typeFilter, setTypeFilter] = useState<NotificationType | 'all'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [detailNotif, setDetailNotif] = useState<AppNotification | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const res = await api.getNotifications();
      setItems(res.items);
    } catch (error) {
      console.error('Failed to load notifications:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const unreadCount = useMemo(() => items.filter(n => !n.isRead).length, [items]);

  useEffect(() => {
    onUnreadChange(unreadCount);
  }, [unreadCount]);

  const visibleItems = useMemo(() => {
    return items
      .filter(n => (readFilter === 'unread' ? !n.isRead : true))
      .filter(n => (typeFilter === 'all' ? true : n.type === typeFilter));
  }, [items, readFilter, typeFilter]);

  const groups = useMemo(() => {
    const map = new Map<string, AppNotification[]>();
    visibleItems.forEach(item => {
      const label = groupLabel(item.createdAt);
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(item);
    });
    return Array.from(map.entries());
  }, [visibleItems]);

  const markRead = async (notif: AppNotification) => {
    if (notif.isRead) return;
    setItems(prev => prev.map(n => (n.id === notif.id ? { ...n, isRead: true } : n)));
    try {
      await api.markNotificationRead(notif.id);
    } catch (error) {
      console.error('Failed to mark notification read:', error);
    }
  };

  const openNotification = (notif: AppNotification) => {
    markRead(notif);
    setDetailNotif(notif);
  };

  const markAllRead = async () => {
    setItems(prev => prev.map(n => ({ ...n, isRead: true })));
    try {
      await api.markAllNotificationsRead();
    } catch (error) {
      console.error('Failed to mark all notifications read:', error);
    }
  };

  return (
    <div className="space-y-4 animate-fade-in pb-20">
      <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-700 pb-4 bg-slate-50 dark:bg-slate-900 sticky top-0 z-10 pt-2">
        <button onClick={onBack} className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white">{ICONS.Back}</button>
        <h2 className="text-xl font-bold text-slate-800 dark:text-white flex-1">Все уведомления</h2>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="text-sm font-medium text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-900/50 px-3 py-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
          >
            Прочитать все
          </button>
        )}
      </div>

      {/* Read-state tabs */}
      <div className="flex gap-2">
        {(['all', 'unread'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setReadFilter(tab)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              readFilter === tab
                ? 'bg-indigo-600 text-white'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
            }`}
          >
            {tab === 'all' ? 'Все' : `Непрочитанные${unreadCount > 0 ? ` (${unreadCount})` : ''}`}
          </button>
        ))}
      </div>

      {/* Type filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {NOTIFICATION_TYPE_FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setTypeFilter(f.key)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              typeFilter === f.key
                ? 'bg-slate-800 dark:bg-white text-white dark:text-slate-900 border-slate-800 dark:border-white'
                : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="text-center text-slate-400 dark:text-slate-500 py-16 text-sm">Загрузка...</div>
        ) : groups.length === 0 ? (
          <div className="text-center text-slate-400 dark:text-slate-500 py-16">
            <div className="flex justify-center mb-2 opacity-50">{ICONS.Bell}</div>
            <p className="text-sm">Ничего не найдено по этому фильтру</p>
          </div>
        ) : (
          groups.map(([label, groupItems]) => (
            <div key={label}>
              <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase mb-2">{label}</p>
              <div className="space-y-2">
                {groupItems.map(notif => {
                  const meta = TYPE_META[notif.type] || TYPE_META.ADMIN_BROADCAST;
                  return (
                    <button
                      key={notif.id}
                      onClick={() => openNotification(notif)}
                      className={`w-full text-left flex items-start gap-3 p-3 rounded-xl border transition-colors bg-white dark:bg-slate-800 ${
                        notif.isRead
                          ? 'border-slate-100 dark:border-slate-700'
                          : 'border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/40 dark:bg-indigo-900/10'
                      }`}
                    >
                      <div className={`shrink-0 p-2 rounded-lg ${meta.bg} ${meta.text}`}>{meta.icon}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm text-slate-800 dark:text-white truncate">{notif.title}</p>
                          {!notif.isRead && <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />}
                        </div>
                        {notif.body && (
                          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">{notif.body}</p>
                        )}
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                          {new Date(notif.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {detailNotif && (
        <NotificationDetailModal notification={detailNotif} onClose={() => setDetailNotif(null)} />
      )}
    </div>
  );
};

export default NotificationsPage;
