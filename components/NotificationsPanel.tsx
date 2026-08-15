import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../services/api';
import { ICONS } from '../constants';
import { AppNotification } from '../types';
import { TYPE_META, groupLabel, NotificationDetailModal } from './NotificationShared';

interface NotificationsPanelProps {
  onClose: () => void;
  onUnreadChange: (count: number) => void;
  onOpenSettings: () => void;
  onOpenAll: () => void;
}

const NotificationsPanel: React.FC<NotificationsPanelProps> = ({ onClose, onUnreadChange, onOpenSettings, onOpenAll }) => {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [detailNotif, setDetailNotif] = useState<AppNotification | null>(null);

  // Даём закрывающей анимации доиграть (280мс = длительность animate-slide-down-sheet)
  // перед тем как реально снять панель с рендера.
  const [isClosing, setIsClosing] = useState(false);
  const handleClose = () => {
    setIsClosing(true);
    setTimeout(onClose, 280);
  };

  const loadData = async () => {
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

  const visibleItems = useMemo(
    () => (filter === 'unread' ? items.filter(n => !n.isRead) : items),
    [items, filter]
  );

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

  // Панель показывает только неархивную ленту — заархивированное уведомление просто исчезает из списка
  const handleArchiveToggle = async (notif: AppNotification) => {
    setItems(prev => prev.filter(n => n.id !== notif.id));
    setDetailNotif(null);
    try {
      await api.archiveNotification(notif.id);
    } catch (error) {
      console.error('Failed to archive notification:', error);
    }
  };

  return (
    <div
      className={`fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-modal ${isClosing ? 'animate-fade-out' : 'animate-modal-fade-in'}`}
      onClick={handleClose}
    >
      <div
        className={`bg-white dark:bg-slate-800 w-full sm:w-[440px] h-[85vh] sm:h-[640px] rounded-t-3xl sm:rounded-3xl flex flex-col shadow-2xl ${isClosing ? 'animate-slide-down-sheet' : 'animate-slide-up-sheet'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b dark:border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 p-2 rounded-lg">{ICONS.Bell}</div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-white">Уведомления</h2>
            {unreadCount > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 px-1.5 flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                Прочитать все
              </button>
            )}
            <button onClick={handleClose} className="p-2 -mr-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full text-slate-500 dark:text-slate-400">
              {ICONS.Close}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 px-4 pt-3">
          {(['all', 'unread'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                filter === tab
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              {tab === 'all' ? 'Все' : `Непрочитанные${unreadCount > 0 ? ` (${unreadCount})` : ''}`}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isLoading ? (
            <div className="text-center text-slate-400 dark:text-slate-500 py-10 text-sm">Загрузка...</div>
          ) : groups.length === 0 ? (
            <div className="text-center text-slate-400 dark:text-slate-500 py-10">
              <div className="flex justify-center mb-2 opacity-50">{ICONS.Bell}</div>
              <p className="text-sm">{filter === 'unread' ? 'Нет непрочитанных уведомлений' : 'Пока нет уведомлений'}</p>
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
                        className={`w-full text-left flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                          notif.isRead
                            ? 'border-transparent bg-slate-50 dark:bg-slate-700/30'
                            : 'border-indigo-100 dark:border-indigo-900/50 bg-indigo-50/60 dark:bg-indigo-900/10'
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

        {/* Footer */}
        <div className="p-3 border-t dark:border-slate-700 flex items-center justify-center gap-2 shrink-0 safe-area-pb">
          <button
            onClick={onOpenAll}
            className="flex-1 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center justify-center gap-1.5"
          >
            {ICONS.List} Все уведомления
          </button>
          <div className="w-px h-6 bg-slate-200 dark:bg-slate-700" />
          <button
            onClick={onOpenSettings}
            className="flex-1 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center justify-center gap-1.5"
          >
            {ICONS.Settings} Настройки
          </button>
        </div>
      </div>

      {detailNotif && (
        <NotificationDetailModal
          notification={detailNotif}
          onClose={() => setDetailNotif(null)}
          onArchiveToggle={handleArchiveToggle}
        />
      )}
    </div>
  );
};

export default NotificationsPanel;
