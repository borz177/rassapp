import React, { useLayoutEffect, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';

const nativePrivacy = registerPlugin<{ setProtected(options: { enabled: boolean }): Promise<void> }>('FinuchetScreenPrivacy');
const desktopPrivacy = (window as Window & {
  finuchetShell?: { setWatchlistProtection?(enabled: boolean): Promise<void> };
}).finuchetShell?.setWatchlistProtection;
const setProtection = desktopPrivacy ?? (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('FinuchetScreenPrivacy')
  ? (enabled: boolean) => nativePrivacy.setProtected({ enabled }) : undefined);
const enabledViews = new Set<symbol>();
let protection: Promise<void> | undefined;

function protectCopy(event: ClipboardEvent) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return;
  const cards = Array.from(document.querySelectorAll('[data-watchlist-private]'));
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    if (cards.some(card => range.intersectsNode(card))) {
      event.preventDefault();
      return;
    }
  }
}

// Новая загрузка приложения начинает без открытых результатов.
void setProtection?.(false).catch(() => {});
window.addEventListener('pagehide', event => {
  if (!event.persisted && enabledViews.size) void setProtection?.(false).catch(() => {});
});

// Короткий код для идентификации владельца просмотра без телефона или почты.
function accountCode(userId: string) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(userId)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0').slice(-12).toUpperCase();
}

export default function WatchlistPrivateContent({ userId, children, className = '' }: {
  userId: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [view, setView] = useState<{ userId: string; mark: string } | null>(null);
  const [failed, setFailed] = useState(false);

  useLayoutEffect(() => {
    const id = Symbol();
    enabledViews.add(id);
    if (!protection) {
      protection = Promise.resolve().then(() => setProtection?.(true));
      document.addEventListener('copy', protectCopy, true);
    }
    protection.then(() => {
      if (!enabledViews.has(id)) return;
      const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
      setView({ userId, mark: `${accountCode(userId)} · ${timestamp} UTC` });
    }).catch(() => { if (enabledViews.has(id)) setFailed(true); });

    return () => {
      enabledViews.delete(id);
      queueMicrotask(() => {
        if (enabledViews.size || !protection) return;
        document.removeEventListener('copy', protectCopy, true);
        protection = undefined;
        void setProtection?.(false).catch(() => {});
      });
    };
  }, [userId]);

  if (view?.userId !== userId) {
    return failed ? <p role="status" className="text-sm text-slate-500">Защищённый просмотр недоступен.</p> : null;
  }
  return <div data-watchlist-private className={`select-none print:hidden ${className}`}
    onCopy={event => event.preventDefault()} onDragStart={event => event.preventDefault()}>
    {children}
    <div aria-hidden="true" className="mt-2 break-words text-[10px] tabular-nums text-slate-500 dark:text-slate-400">{view.mark}</div>
  </div>;
}
