import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { dialogStore, DialogItem } from '../src/dialogs';

/**
 * Окна подтверждения и сообщений приложения (src/dialogs.ts) — по одному,
 * поверх всего, в виде системного диалога iOS: заголовок, текст и кнопки
 * в ряд. Монтируется один раз в index.tsx.
 */

const OUT_MS = 160;

const DialogCard: React.FC<{ item: DialogItem }> = ({ item }) => {
  const [leaving, setLeaving] = useState(false);
  const done = useRef(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const finish = (ok: boolean) => {
    if (done.current) return;
    done.current = true;
    setLeaving(true);
    setTimeout(() => dialogStore.resolve(item.id, ok), OUT_MS);
  };

  useEffect(() => {
    // Фокус на действии: Enter подтверждает, Esc отменяет — как у системных окон
    confirmRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(item.kind === 'alert'); }
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Заголовок — первая строка, если его не дали отдельно и текст из двух частей
  let title = item.title;
  let message = item.message || '';
  if (!title && /\n\s*\n/.test(message)) {
    const [head, ...rest] = message.split(/\n\s*\n/);
    if (head.length <= 80) { title = head; message = rest.join('\n\n'); }
  }

  const isConfirm = item.kind === 'confirm';

  return (
    <div
      className={`fixed inset-0 z-[100000] flex items-center justify-center p-8 bg-slate-900/40 backdrop-blur-[2px] ${leaving ? 'animate-fade-out' : 'animate-modal-fade-in'}`}
      style={leaving ? { animationDuration: `${OUT_MS}ms` } : undefined}
      // Нажатие мимо окна: у сообщения — закрыть, у подтверждения — ничего,
      // чтобы случайное касание не решало за человека
      onClick={() => { if (!isConfirm) finish(true); }}
    >
      <div
        role={isConfirm ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        onClick={e => e.stopPropagation()}
        className={`w-full max-w-[300px] rounded-[22px] overflow-hidden bg-white/95 dark:bg-slate-800/95 backdrop-blur-xl shadow-2xl ring-1 ring-black/5 dark:ring-white/10 ${
          leaving ? 'animate-dialog-out' : 'animate-dialog-in'
        }`}
      >
        <div className="px-5 pt-5 pb-4 text-center">
          {title && <p className="text-[17px] font-semibold leading-snug text-slate-900 dark:text-white whitespace-pre-line">{title}</p>}
          {message && (
            <p className={`${title ? 'mt-1.5' : ''} text-[14px] leading-snug whitespace-pre-line ${
              title ? 'text-slate-500 dark:text-slate-400' : 'text-slate-800 dark:text-slate-100'
            }`}>
              {message}
            </p>
          )}
        </div>
        <div className={`grid border-t border-slate-200/80 dark:border-slate-700/80 ${isConfirm ? 'grid-cols-2 divide-x divide-slate-200/80 dark:divide-slate-700/80' : ''}`}>
          {isConfirm && (
            <button type="button" onClick={() => finish(false)}
                    className="h-12 text-[16px] text-indigo-600 dark:text-indigo-400 active:bg-slate-100 dark:active:bg-slate-700 transition-colors">
              {item.cancelLabel || 'Отмена'}
            </button>
          )}
          <button ref={confirmRef} type="button" onClick={() => finish(true)}
                  className={`h-12 text-[16px] font-semibold outline-none active:bg-slate-100 dark:active:bg-slate-700 transition-colors ${
                    item.destructive ? 'text-rose-600 dark:text-rose-400' : 'text-indigo-600 dark:text-indigo-400'
                  }`}>
            {item.confirmLabel || 'ОК'}
          </button>
        </div>
      </div>
    </div>
  );
};

const AppDialogs: React.FC = () => {
  const current = useSyncExternalStore(dialogStore.subscribe, dialogStore.current, dialogStore.current);
  if (!current || typeof document === 'undefined') return null;
  // key — новое окно монтируется заново со своей анимацией появления
  return createPortal(<DialogCard key={current.id} item={current} />, document.body);
};

export default AppDialogs;
