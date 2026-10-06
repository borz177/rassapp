import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { toastStore, type ToastItem, type ToastTone } from '../src/toast';

/**
 * Плашки уведомлений (src/toast.ts) — сверху под вырезом экрана, как системные
 * баннеры iOS. Уходят сами; смахнуть вверх или нажать — закрыть сразу. Пока
 * палец или курсор на плашке, таймер стоит: дочитать можно не торопясь.
 */

const ICON: Record<ToastTone, { bg: string; path: React.ReactNode }> = {
  success: { bg: 'bg-emerald-500', path: <path d="m6 12.5 4 4 8-9" /> },
  error: { bg: 'bg-rose-500', path: <path d="M8 8l8 8M16 8l-8 8" /> },
  warning: { bg: 'bg-amber-500', path: <><path d="M12 7v6" /><path d="M12 17h.01" /></> },
  info: { bg: 'bg-indigo-500', path: <><path d="M12 11v6" /><path d="M12 7h.01" /></> },
};

const OUT_MS = 220;

const Toast: React.FC<{ item: ToastItem }> = ({ item }) => {
  const [leaving, setLeaving] = useState(false);
  const [dy, setDy] = useState(0);
  const start = useRef<number | null>(null);
  const paused = useRef(false);
  const left = useRef(item.duration);
  const since = useRef(Date.now());

  const close = () => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(() => toastStore.dismiss(item.id), OUT_MS);
  };

  useEffect(() => {
    const tick = window.setInterval(() => {
      if (paused.current) { since.current = Date.now(); return; }
      const now = Date.now();
      left.current -= now - since.current;
      since.current = now;
      if (left.current <= 0) { window.clearInterval(tick); close(); }
    }, 200);
    return () => window.clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const icon = ICON[item.tone];
  return (
    <div
      role={item.tone === 'error' ? 'alert' : 'status'}
      onPointerEnter={() => { paused.current = true; }}
      onPointerLeave={() => { paused.current = false; start.current = null; setDy(0); }}
      onPointerDown={e => { paused.current = true; start.current = e.clientY; }}
      onPointerMove={e => { if (start.current !== null) setDy(Math.min(0, e.clientY - start.current)); }}
      onPointerUp={() => {
        paused.current = false;
        if (dy < -24) close(); else setDy(0);
        start.current = null;
      }}
      onClick={() => { if (dy === 0 && !item.action) close(); }}
      style={{ transform: dy ? `translateY(${dy}px)` : undefined, opacity: dy ? Math.max(0.2, 1 + dy / 80) : undefined }}
      className={`pointer-events-auto w-full flex items-start gap-3 pl-3 pr-3.5 py-3 rounded-[20px] bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl shadow-[0_10px_40px_-8px_rgba(15,23,42,0.35)] ring-1 ring-black/5 dark:ring-white/10 select-none touch-none cursor-default ${
        leaving ? 'animate-toast-out' : 'animate-toast-in'}`}
    >
      <span className={`mt-0.5 w-6 h-6 shrink-0 rounded-full ${icon.bg} text-white flex items-center justify-center`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{icon.path}</svg>
      </span>
      <span className="min-w-0 flex-1 py-0.5">
        <span className="block text-[14px] font-semibold leading-snug text-slate-900 dark:text-white break-words">{item.title}</span>
        {item.message && (
          <span className="block mt-0.5 text-[12.5px] leading-snug text-slate-500 dark:text-slate-400 whitespace-pre-line break-words">{item.message}</span>
        )}
      </span>
      {item.action && (
        <button type="button"
                onClick={e => { e.stopPropagation(); item.action!.onClick(); close(); }}
                className="shrink-0 self-center h-8 px-3 rounded-full bg-slate-900/5 dark:bg-white/10 text-[13px] font-bold text-indigo-600 dark:text-indigo-300">
          {item.action.label}
        </button>
      )}
    </div>
  );
};

const Toaster: React.FC = () => {
  const list = useSyncExternalStore(toastStore.subscribe, toastStore.list, toastStore.list);
  if (typeof document === 'undefined' || list.length === 0) return null;
  return createPortal(
    <div className="fixed inset-x-0 top-0 z-[100001] pointer-events-none flex flex-col items-center gap-2 px-3"
         style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}>
      <div className="w-full max-w-[420px] flex flex-col gap-2">
        {list.map(t => <Toast key={t.id} item={t} />)}
      </div>
    </div>,
    document.body,
  );
};

export default Toaster;
