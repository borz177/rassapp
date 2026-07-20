import React from 'react';
import { ICONS } from '../constants';
import { AppNotification, NotificationType } from '../types';

export const TYPE_META: Record<NotificationType, { icon: React.ReactNode; bg: string; text: string; label: string }> = {
  PAYMENT: { icon: ICONS.Income, bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-600 dark:text-green-400', label: 'Платёж' },
  NEW_CONTRACT: { icon: ICONS.File, bg: 'bg-indigo-100 dark:bg-indigo-900/30', text: 'text-indigo-600 dark:text-indigo-400', label: 'Новый договор' },
  CONTRACT_CLOSED: { icon: ICONS.CheckCircle, bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-400', label: 'Договор закрыт' },
  EXPENSE: { icon: ICONS.Expense, bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-600 dark:text-red-400', label: 'Расход' },
  WHATSAPP_SENT: { icon: ICONS.Chat, bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-400', label: 'WhatsApp' },
  ADMIN_BROADCAST: { icon: ICONS.Megaphone, bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-400', label: 'От администратора' },
};

export const NOTIFICATION_TYPE_FILTERS: { key: NotificationType | 'all'; label: string }[] = [
  { key: 'all', label: 'Все типы' },
  { key: 'PAYMENT', label: TYPE_META.PAYMENT.label },
  { key: 'NEW_CONTRACT', label: TYPE_META.NEW_CONTRACT.label },
  { key: 'CONTRACT_CLOSED', label: TYPE_META.CONTRACT_CLOSED.label },
  { key: 'EXPENSE', label: TYPE_META.EXPENSE.label },
  { key: 'WHATSAPP_SENT', label: TYPE_META.WHATSAPP_SENT.label },
  { key: 'ADMIN_BROADCAST', label: TYPE_META.ADMIN_BROADCAST.label },
];

export const groupLabel = (dateStr: string): string => {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (isSameDay(date, today)) return 'Сегодня';
  if (isSameDay(date, yesterday)) return 'Вчера';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
};

interface NotificationDetailModalProps {
  notification: AppNotification;
  onClose: () => void;
  onArchiveToggle?: (notification: AppNotification) => void;
}

// z-[70] — выше и панели/страницы уведомлений (z-[60]), и мобильной нижней навигации (z-50)
export const NotificationDetailModal: React.FC<NotificationDetailModalProps> = ({ notification, onClose, onArchiveToggle }) => {
  const meta = TYPE_META[notification.type] || TYPE_META.ADMIN_BROADCAST;
  // Рассылки от администратора архивировать нельзя — у них нет этого понятия на сервере
  const canArchive = onArchiveToggle && notification.type !== 'ADMIN_BROADCAST';

  return (
    <div className="fixed inset-0 z-[70] bg-black bg-opacity-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-2xl shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className={`shrink-0 p-2.5 rounded-xl ${meta.bg} ${meta.text}`}>{meta.icon}</div>
          <div className="min-w-0 flex-1">
            <p className={`text-xs font-semibold uppercase ${meta.text}`}>{meta.label}</p>
            <h3 className="font-bold text-slate-800 dark:text-white mt-0.5">{notification.title}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 -mr-1 -mt-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400">
            {ICONS.Close}
          </button>
        </div>
        {notification.body && (
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-3 whitespace-pre-line">{notification.body}</p>
        )}
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-4">
          {new Date(notification.createdAt).toLocaleString('ru-RU', {
            day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
          })}
        </p>

        {canArchive && (
          <button
            onClick={() => onArchiveToggle!(notification)}
            className="w-full mt-4 py-2.5 rounded-xl text-sm font-medium border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center justify-center gap-2"
          >
            {notification.isArchived ? (
              <>{ICONS.Unarchive} Восстановить из архива</>
            ) : (
              <>{ICONS.Archive} Архивировать</>
            )}
          </button>
        )}
      </div>
    </div>
  );
};
