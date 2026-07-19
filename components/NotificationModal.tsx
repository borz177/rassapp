import React, { useEffect } from 'react';
import { ICONS } from '../constants';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  type?: NotificationType;
  actionLabel?: string;
  onAction?: () => void;
  cancelLabel?: string;
  showClose?: boolean;
}

export const NotificationModal: React.FC<NotificationModalProps> = ({
  isOpen,
  onClose,
  title,
  message,
  type = 'info',
  actionLabel,
  onAction,
  cancelLabel,
  showClose = true
}) => {
  // Закрытие по Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Стили по типу уведомления
  const styles = {
    success: {
      bg: 'bg-emerald-50 dark:bg-emerald-900/30',
      border: 'border-emerald-200 dark:border-emerald-900/50',
      text: 'text-emerald-800 dark:text-emerald-400',
      icon: 'text-emerald-600 dark:text-emerald-400',
      iconBg: 'bg-emerald-100 dark:bg-emerald-900/50',
      button: 'bg-emerald-600 hover:bg-emerald-700'
    },
    error: {
      bg: 'bg-red-50 dark:bg-red-900/30',
      border: 'border-red-200 dark:border-red-900/50',
      text: 'text-red-800 dark:text-red-400',
      icon: 'text-red-600 dark:text-red-400',
      iconBg: 'bg-red-100 dark:bg-red-900/50',
      button: 'bg-red-600 hover:bg-red-700'
    },
    warning: {
      bg: 'bg-amber-50 dark:bg-amber-900/30',
      border: 'border-amber-200 dark:border-amber-900/50',
      text: 'text-amber-800 dark:text-amber-400',
      icon: 'text-amber-600 dark:text-amber-400',
      iconBg: 'bg-amber-100 dark:bg-amber-900/50',
      button: 'bg-amber-600 hover:bg-amber-700'
    },
    info: {
      bg: 'bg-indigo-50 dark:bg-indigo-900/30',
      border: 'border-indigo-200 dark:border-indigo-900/50',
      text: 'text-indigo-800 dark:text-indigo-400',
      icon: 'text-indigo-600 dark:text-indigo-400',
      iconBg: 'bg-indigo-100 dark:bg-indigo-900/50',
      button: 'bg-indigo-600 hover:bg-indigo-700'
    }
  };

  const style = styles[type];
  const icon = {
    success: ICONS.Check,
    error: ICONS.Alert,
    warning: ICONS.Alert,
    info: ICONS.Info
  }[type];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-md rounded-2xl shadow-2xl p-6 space-y-4 ${style.bg} ${style.border} border animate-scale-in`}
        onClick={e => e.stopPropagation()}
      >
        {/* Заголовок с иконкой */}
        <div className="flex items-start gap-4">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${style.iconBg} ${style.icon}`}>
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className={`text-lg font-bold ${style.text}`}>{title}</h3>
            {showClose && (
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
              >
                {ICONS.Close}
              </button>
            )}
          </div>
        </div>

        {/* Сообщение */}
        <div className={`text-sm ${style.text} whitespace-pre-wrap leading-relaxed`}>
          {message}
        </div>

        {/* Кнопки действий */}
        <div className="flex gap-3 pt-2">
          {actionLabel && onAction && (
            <button
              onClick={() => { onAction(); onClose(); }}
              className={`flex-1 py-3 text-white font-bold rounded-xl transition-colors ${style.button}`}
            >
              {actionLabel}
            </button>
          )}
          <button
            onClick={onClose}
            className={`flex-1 py-3 font-bold rounded-xl transition-colors ${
              actionLabel ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600' : `${style.button} text-white`
            }`}
          >
            {actionLabel ? (cancelLabel || 'Закрыть') : 'Понятно'}
          </button>
        </div>
      </div>
    </div>
  );
};