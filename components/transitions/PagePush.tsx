import React, { useEffect, useRef, useState } from 'react';

interface PagePushProps {
  /** Called once the close animation has finished — this is where currentView should actually change. */
  onClose: () => void;
  /** Renders a built-in floating back button (for screens with no back UI of their own). */
  showBackButton?: boolean;
  className?: string;
  children: React.ReactNode | ((requestClose: () => void) => React.ReactNode);
}

const CLOSE_DURATION = 260;
const EDGE_ZONE = 28; // px from the left edge where a back-swipe can start
const COMMIT_RATIO = 0.33; // fraction of width dragged to commit the close
const VELOCITY_COMMIT = 0.55; // px/ms flick speed to commit the close regardless of distance

interface DragState {
  startX: number;
  startY: number;
  startT: number;
  active: boolean;
  deciding: boolean;
  locked: boolean;
}

/**
 * Wraps a "pushed" screen with an iOS/Android-style slide-in entrance, a slide-out exit
 * (played fully before the parent actually swaps `currentView`), and an edge-swipe-to-go-back
 * gesture that follows the finger in real time.
 */
const PagePush: React.FC<PagePushProps> = ({ onClose, showBackButton = false, className = '', children }) => {
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState>({ startX: 0, startY: 0, startT: 0, active: false, deciding: false, locked: false });

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(onClose, CLOSE_DURATION);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  const requestClose = () => setClosing(true);

  const setLiveTransform = (px: number, animate: boolean) => {
    const el = rootRef.current;
    if (!el) return;
    el.style.transition = animate ? '' : 'none';
    el.style.transform = `translateX(${px}px)`;
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (closing) return;
    const t = e.touches[0];
    if (t.clientX > EDGE_ZONE) return;
    drag.current = { startX: t.clientX, startY: t.clientY, startT: Date.now(), active: true, deciding: true, locked: false };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const s = drag.current;
    if (!s.active) return;
    const t = e.touches[0];
    const dx = t.clientX - s.startX;
    const dy = t.clientY - s.startY;
    if (s.deciding) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      s.deciding = false;
      s.locked = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.15;
      if (!s.locked) {
        s.active = false;
        return;
      }
    }
    if (!s.locked) return;
    const width = rootRef.current?.offsetWidth || window.innerWidth;
    setLiveTransform(Math.max(0, Math.min(dx, width)), false);
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const s = drag.current;
    if (!s.active || !s.locked) {
      s.active = false;
      return;
    }
    s.active = false;
    const width = rootRef.current?.offsetWidth || window.innerWidth;
    const t = e.changedTouches[0];
    const dx = Math.max(0, t.clientX - s.startX);
    const dt = Math.max(1, Date.now() - s.startT);
    const velocity = dx / dt;
    if (dx > width * COMMIT_RATIO || velocity > VELOCITY_COMMIT) {
      setLiveTransform(width, true);
      setClosing(true);
    } else {
      setLiveTransform(0, true);
    }
  };

  return (
    <div
      ref={rootRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      className={`page-push-layer bg-slate-50 dark:bg-slate-900 ${className}`}
      style={{ transform: closing ? 'translateX(100%)' : entered ? 'translateX(0)' : 'translateX(100%)' }}
    >
      {showBackButton && (
        <button onClick={requestClose} aria-label="Назад" className="page-push-back-btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}
      <div className="page-push-scroll">{typeof children === 'function' ? children(requestClose) : children}</div>
    </div>
  );
};

export default PagePush;
