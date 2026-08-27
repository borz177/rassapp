import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import TopBarBack from '../TopBarBack';
import { useScrollRestoration } from '../../src/hooks/useScrollRestoration';

interface PagePushProps {
  /** Called once the close animation has finished — this is where currentView should actually change. */
  onClose: () => void;
  /** Renders a built-in floating back button (for screens with no back UI of their own). */
  showBackButton?: boolean;
  /**
   * Показывать стрелку и на десктопе. Обычным толкнутым страницам она там не
   * нужна — из сайдбара видно, где ты. Но подстраницам вроде счёта в «Кассе»
   * сайдбар не помогает: его пункт ведёт на тот же раздел, и без стрелки
   * страница не закрывается вовсе.
   */
  backOnDesktop?: boolean;
  className?: string;
  /** Запоминает и восстанавливает прокрутку под этим ключом — как при возврате на список
      в мобильном приложении. Не передавайте, если у страницы нет смысла помнить позицию
      (короткие формы, разовые экраны). */
  scrollKey?: string;
  children: React.ReactNode | ((requestClose: () => void) => React.ReactNode);
}

// 🔹 В любой момент реально смонтирован максимум один PagePush (текущий `currentView` рендерит
// либо обычный экран, либо один "выехавший" поверх него) — поэтому достаточно единственного
// слота, а не полноценного стека. Используется хендлером аппаратной кнопки/жеста "Назад" на
// Android (см. App.tsx), чтобы он закрывал текущую выехавшую страницу тем же способом, что и
// свайп/кнопка "Назад" на экране, а не сразу выходил из приложения.
let activeRequestClose: (() => void) | null = null;
export function triggerPagePushBack(): boolean {
  if (activeRequestClose) {
    activeRequestClose();
    return true;
  }
  return false;
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
const PagePush: React.FC<PagePushProps> = ({ onClose, showBackButton = false, backOnDesktop = false, className = '', scrollKey, children }) => {
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useScrollRestoration(scrollKey, rootRef);
  // Synchronous guard (unlike the `closing` state, which only updates on the next render) so a
  // rapid second gesture during the close animation can never restart/interfere with it.
  const closingRef = useRef(false);
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

  const requestClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
  };

  useEffect(() => {
    activeRequestClose = requestClose;
    return () => {
      if (activeRequestClose === requestClose) activeRequestClose = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clamps to [0, width] every time — the page can never be dragged past fully-open or
  // fully-closed, regardless of how far or fast the finger keeps moving.
  const setLiveTransform = (px: number, width: number, animate: boolean) => {
    const el = rootRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(px, width));
    el.style.willChange = 'transform';
    el.style.transition = animate ? '' : 'none';
    el.style.transform = `translateX(${clamped}px)`;
  };

  // `transform` (and `will-change: transform`) makes this element the containing block for any
  // `position: fixed` descendant (e.g. a modal rendered inside this pushed page), which would
  // anchor it to this scrolling layer instead of the viewport. Drop both once an in-progress
  // drag/animation has settled back to idle so fixed-position children behave normally again.
  const clearInlineTransform = () => {
    const el = rootRef.current;
    if (!el) return;
    // will-change снимаем всегда, даже во время закрытия: это подсказка
    // композитору, к картинке она отношения не имеет, а оставленная навсегда
    // делает слой отдельным и, что важнее, точкой отсчёта для position: fixed
    // внутри него.
    el.style.willChange = '';
    if (closingRef.current) return;
    el.style.transform = '';
    el.style.transition = '';
  };

  // Сброс при смене страницы. Слой закрывается с inline-трансформом
  // translateX(ширина) — снять его тогда нельзя, иначе страница прыгнет на место
  // вместо того чтобы уехать. Но узел DOM переиспользуется: React видит тот же
  // <PagePush> на том же месте дерева и просто меняет содержимое. Следующая
  // страница въезжала бы в уже сдвинутый слой — отсюда половина одного экрана и
  // половина другого.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    el.style.transform = '';
    el.style.transition = '';
    el.style.willChange = '';
    closingRef.current = false;
    // entered здесь НЕ сбрасываем: анимация въезда запускается разово при
    // монтировании, и сброшенный флаг оставил бы новую страницу за краем экрана
    // навсегда. Закрытие снимаем, иначе таймер прошлой страницы закрыл бы новую.
    setClosing(false);
  }, [scrollKey]);

  // И на размонтировании — узел могут переиспользовать после нас
  useEffect(() => () => {
    const el = rootRef.current;
    if (el) {
      el.style.transform = '';
      el.style.transition = '';
      el.style.willChange = '';
    }
  }, []);

  const resetDrag = () => {
    drag.current.active = false;
    drag.current.deciding = false;
    drag.current.locked = false;
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (closingRef.current) return;
    if (drag.current.active) return; // a gesture is already being tracked — ignore stray extra touchstarts
    if (e.touches.length !== 1) return; // ignore multi-touch (pinch etc.)
    const t = e.touches[0];
    if (t.clientX > EDGE_ZONE) return;
    drag.current = { startX: t.clientX, startY: t.clientY, startT: Date.now(), active: true, deciding: true, locked: false };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const s = drag.current;
    if (!s.active || closingRef.current) return;
    if (e.touches.length !== 1) {
      // A second finger joined mid-drag — abandon the gesture and snap back rather than
      // leaving the page stranded mid-way with no active touch left to finish the drag.
      const wasLocked = s.locked;
      resetDrag();
      if (wasLocked) {
        const width = rootRef.current?.offsetWidth || window.innerWidth;
        setLiveTransform(0, width, true);
        window.setTimeout(clearInlineTransform, CLOSE_DURATION);
      }
      return;
    }
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
    setLiveTransform(dx, width, false);
  };

  const finishDrag = (clientX: number, startT: number, startX: number, commitEligible: boolean) => {
    const width = rootRef.current?.offsetWidth || window.innerWidth;
    const dx = Math.max(0, Math.min(clientX - startX, width));
    const dt = Math.max(1, Date.now() - startT);
    const velocity = dx / dt;
    if (commitEligible && (dx > width * COMMIT_RATIO || velocity > VELOCITY_COMMIT)) {
      setLiveTransform(width, width, true);
      closingRef.current = true;
      setClosing(true);
    } else {
      setLiveTransform(0, width, true);
      window.setTimeout(clearInlineTransform, CLOSE_DURATION);
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const s = drag.current;
    const wasLocked = s.active && s.locked;
    const { startX, startT } = s;
    s.active = false;
    if (!wasLocked || closingRef.current) return;
    const t = e.changedTouches[0];
    finishDrag(t.clientX, startT, startX, true);
  };

  const onTouchCancel = () => {
    const s = drag.current;
    const wasLocked = s.active && s.locked;
    s.active = false;
    // A cancelled gesture (e.g. the OS took over) never commits a close — always snap back.
    if (!wasLocked || closingRef.current) return;
    const width = rootRef.current?.offsetWidth || window.innerWidth;
    setLiveTransform(0, width, true);
    window.setTimeout(clearInlineTransform, CLOSE_DURATION);
  };

  const idle = entered && !closing;

  // Стрелка «назад» живёт не в самой странице, а в верхней панели — отдельным
  // пузырём перед названием компании. На десктопе её нет: там постоянный сайдбар.

  return (
    <div
      ref={rootRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      className={`page-push-layer bg-slate-50 dark:bg-slate-900 ${className}`}
      style={idle ? undefined : { transform: 'translateX(100%)', willChange: 'transform' }}
    >
      {showBackButton && <TopBarBack onClick={requestClose} hideOnDesktop={!backOnDesktop} standalone />}
      <div className={`page-push-scroll max-w-7xl mx-auto p-4 md:p-10${showBackButton ? ' page-push-scroll--tight' : ''}`}>{typeof children === 'function' ? children(requestClose) : children}</div>
    </div>
  );
};

export default PagePush;
