import React, { useEffect, useState } from 'react';
import type { AppSettings } from '../types';
import { api } from '../services/api';

/**
 * Плашка на главной, если встроенный WhatsApp не работает: номер отвязался
 * (сменили телефон, удалили связанное устройство) или на сегодня исчерпан
 * лимит. Без неё напоминания перестают уходить молча — владелец узнавал об
 * этом от клиентов. Проверяем один раз при открытии главной.
 */
const WhatsAppAlertBanner: React.FC<{ appSettings: AppSettings; onOpen: () => void }> = ({ appSettings, onOpen }) => {
  const builtin = appSettings.whatsapp?.provider === 'builtin' && appSettings.whatsapp?.enabled;
  const [problem, setProblem] = useState<'disconnected' | 'limit' | null>(null);

  useEffect(() => {
    if (!builtin) { setProblem(null); return; }
    let cancelled = false;
    api.waBuiltin.status()
      .then(st => {
        if (cancelled) return;
        if (!st.loggedIn) setProblem('disconnected');
        else if (st.quota && st.quota.left === 0) setProblem('limit');
        else setProblem(null);
      })
      .catch(() => { /* сервер недоступен — не пугаем плашкой */ });
    return () => { cancelled = true; };
  }, [builtin]);

  if (!problem) return null;
  const disconnected = problem === 'disconnected';

  return (
    <div className={`flex items-center gap-3 rounded-2xl px-4 py-3 border ${
      disconnected
        ? 'bg-rose-50 border-rose-100 dark:bg-rose-500/10 dark:border-rose-500/20'
        : 'bg-amber-50 border-amber-100 dark:bg-amber-500/10 dark:border-amber-500/20'
    }`}>
      <span className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${
        disconnected ? 'bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300' : 'bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300'
      }`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-[14px] font-semibold ${disconnected ? 'text-rose-800 dark:text-rose-200' : 'text-amber-800 dark:text-amber-200'}`}>
          {disconnected ? 'WhatsApp отключился' : 'Дневной лимит WhatsApp исчерпан'}
        </p>
        <p className={`text-[12px] leading-snug ${disconnected ? 'text-rose-700/80 dark:text-rose-300/80' : 'text-amber-700/80 dark:text-amber-300/80'}`}>
          {disconnected
            ? 'Напоминания клиентам не уходят, пока номер не привязан снова'
            : 'Остальные напоминания уйдут завтра — так WhatsApp не ограничит номер'}
        </p>
      </div>
      {disconnected && (
        <button type="button" onClick={onOpen}
                className="shrink-0 h-9 px-3 rounded-xl bg-rose-600 text-white text-[13px] font-semibold active:opacity-80">
          Подключить
        </button>
      )}
    </div>
  );
};

export default WhatsAppAlertBanner;
