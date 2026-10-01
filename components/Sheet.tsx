import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import ModalPortal from './ModalPortal';

interface SheetProps {
  /**
   * Неуправляемый лист: вызывается, когда анимация ухода доиграла.
   * Управляемый (задан open): вызывается сразу — родитель снимает open, а лист
   * доигрывает уход сам.
   */
  onClose: () => void;
  /**
   * Управляемый режим: лист открыт, пока open === true.
   *
   * Нужен там, где окно закрывают не только кнопкой «Отмена», но и из кода —
   * например, после сохранения. В неуправляемом режиме такое закрытие снимает
   * лист мгновенно, мимо анимации: родитель просто перестаёт его отрисовывать.
   * С open лист остаётся на экране, пока уход не доиграет, и показывает всё то
   * же содержимое, каким оно было в момент закрытия.
   */
  open?: boolean;
  /** 'sheet' — лист снизу, 'dialog' — окно по центру */
  variant?: 'sheet' | 'dialog';
  /** Классы самой панели: ширина, отступы, содержимое решает вызвавший */
  className?: string;
  /** Закрывать по нажатию на затемнение. Выключают, когда идёт запись */
  dismissible?: boolean;
  children: React.ReactNode | ((requestClose: () => void) => React.ReactNode);
}

const OUT_MS = { sheet: 280, dialog: 180 };

// Смахивание листа вниз (телефон): дальше или быстрее — закрывается
const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 0.6; // px/мс
const isPhoneWidth = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches;

/**
 * Модальный лист с уходом, а не с исчезновением.
 *
 * Окна кассы появлялись анимацией, а закрывались мгновенным пропаданием: лист
 * выезжал снизу и потом просто исчезал вместе с затемнением. В нативных
 * приложениях лист уезжает обратно тем же движением, и без этого экран кажется
 * дёрганым именно на закрытии — там, где нажимают чаще всего.
 *
 * Уход играется до размонтирования, поэтому состояние снимает не кнопка, а сам
 * лист по окончании анимации. Замок closingRef синхронный: `closing` обновится
 * только к следующей отрисовке, а второй жест приходит раньше и перезапустил бы
 * уход с середины.
 */
const Sheet: React.FC<SheetProps> = ({
  onClose, open, variant = 'sheet', className = '', dismissible = true, children,
}) => {
  const controlled = open !== undefined;
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  // Управляемый лист остаётся отрисованным, пока уход не доиграет.
  // Состояние меняем в слой-эффекте, а не во время отрисовки: в StrictMode
  // отрисовка выполняется дважды, и такое обновление терялось — лист исчезал
  // мгновенно, мимо анимации.
  const [exiting, setExiting] = useState(false);
  const wasOpen = useRef(!!open);
  useLayoutEffect(() => {
    if (!controlled) return;
    if (open) { wasOpen.current = true; closingRef.current = false; setExiting(false); return; }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    setExiting(true);
    const timer = setTimeout(() => setExiting(false), OUT_MS[variant]);
    return () => clearTimeout(timer);
  }, [open, controlled, variant]);

  // Содержимое на время ухода замораживаем: закрытие обычно снимает и данные
  // окна (выбранный товар, форму), и без этого лист уезжал бы пустым.
  const shown = useRef(children);
  if (!controlled || open) shown.current = children;

  // ── Смахивание вниз за ручку (только лист и только на телефоне) ─────────
  // Как у остальных листов приложения (GlassSheet): ручка сверху, лист идёт за
  // пальцем, затемнение гаснет вместе с ним. Уехавший смахиванием лист больше
  // не играет анимацию ухода — он уже за краем экрана.
  const swipeable = variant === 'sheet' && dismissible && isPhoneWidth();
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [swipedAway, setSwipedAway] = useState(false);
  const drag = useRef<{ y0: number; t0: number; dy: number } | null>(null);
  // Управляемый лист открыли снова — он снова на месте
  useLayoutEffect(() => {
    if (controlled && open) { setSwipedAway(false); setDragY(0); }
  }, [open, controlled]);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    // Управляемый: родитель снимет open, уход доиграется здесь же
    if (controlled) { onClose(); return; }
    setClosing(true);
    setTimeout(onClose, OUT_MS[variant]);
  }, [onClose, variant, controlled]);

  const onDragStart = (e: React.PointerEvent) => {
    if (!swipeable || e.pointerType === 'mouse') return;
    drag.current = { y0: e.clientY, t0: performance.now(), dy: 0 };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const raw = e.clientY - drag.current.y0;
    const dy = raw > 0 ? raw : raw / 6; // вверх — с сопротивлением, как в iOS
    drag.current.dy = dy;
    setDragY(dy);
  };
  const onDragEnd = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d) return;
    const velocity = d.dy / Math.max(1, performance.now() - d.t0);
    if (d.dy > DISMISS_DISTANCE || (d.dy > 24 && velocity > DISMISS_VELOCITY)) {
      if (closingRef.current) return;
      closingRef.current = true;
      setDragY(window.innerHeight);       // доезжает вниз тем же движением
      setTimeout(() => { setSwipedAway(true); onClose(); }, 260);
    } else {
      setDragY(0);
    }
  };

  // wasOpen покрывает отрисовку между закрытием и слой-эффектом: без него лист
  // успевал моргнуть пустотой.
  if (controlled && !open && !exiting && !wasOpen.current) return null;
  if (swipedAway) return null;

  const leaving = controlled ? !open : closing;
  const isSheet = variant === 'sheet';

  return (
    // Шаг «назад» отдаём листу: без onClose он закрыл бы страницу под окном.
    <ModalPortal onClose={requestClose}>
      <div
        className={`fixed inset-0 z-modal-top flex justify-center bg-slate-900/60 backdrop-blur-sm ${
          isSheet ? 'items-end sm:items-center p-0 sm:p-4' : 'items-center p-6'
        } ${leaving ? 'animate-fade-out' : 'animate-modal-fade-in'}`}
        style={swipeable && (dragging || dragY > 0) ? {
          opacity: Math.max(0.3, 1 - dragY / 500),
          transition: dragging ? 'none' : 'opacity 0.26s ease',
        } : undefined}
        onClick={() => { if (dismissible) requestClose(); }}
      >
        <div
          onClick={e => e.stopPropagation()}
          // Лист не заходит под чёлку: сверху остаётся полоска затемнённого экрана
          style={{
            ...(isSheet ? { maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - 10px)' } : null),
            ...(swipeable && (dragging || dragY !== 0) ? {
              transform: `translateY(${dragY}px)`,
              transition: dragging ? 'none' : 'transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)',
            } : null),
          }}
          className={`relative bg-white dark:bg-slate-800 shadow-2xl ${
            isSheet ? 'w-full rounded-t-[28px] sm:rounded-3xl' : 'w-full max-w-xs rounded-3xl'
          } ${
            leaving
              ? (isSheet ? 'animate-slide-down-sheet' : 'animate-dialog-out')
              : (isSheet ? 'animate-sheet-in' : 'animate-dialog-in')
          } ${className}`}
        >
          {/* Ручка: за неё лист смахивается вниз. Поверх содержимого, чтобы
              не сдвигать вёрстку листов, которые её не ждали. */}
          {swipeable && (
            <div
              aria-hidden
              className="absolute inset-x-0 top-0 h-6 z-20 flex justify-center pt-2 touch-none"
              onPointerDown={onDragStart}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragEnd}
            >
              <span className="h-[5px] w-9 rounded-full bg-slate-300 dark:bg-slate-600" />
            </div>
          )}
          {typeof shown.current === 'function' ? shown.current(requestClose) : shown.current}
        </div>
      </div>
    </ModalPortal>
  );
};

export default Sheet;
