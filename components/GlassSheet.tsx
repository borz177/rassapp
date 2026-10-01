import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ModalPortal from './ModalPortal';

/**
 * Лист, как в системных окнах iOS, — общий для форм и списков приложения.
 *
 * На телефоне выезжает снизу и не заходит под чёлку (сверху видно затемнённый
 * экран — понятно, откуда пришли и куда вернёмся), уезжает обратно тем же
 * движением, смахивается вниз за верхнюю панель. Крупный заголовок уходит при
 * прокрутке, а в панели проявляется короткое название; там же кнопки —
 * сверху их не закрывает клавиатура. На компьютере — окно по центру.
 *
 * Закрыть «мимо» действия (кнопкой слева, смахиванием, жестом «назад», Esc)
 * можно запретить через confirmClose — так формы переспрашивают, если есть
 * несохранённые правки.
 */

export interface GlassSheetAction {
  label: string;
  /** Получает close — закрыть лист с анимацией после своего дела */
  onClick?: (close: () => void) => void;
  disabled?: boolean;
  /** Кнопка отправляет форму (лист с onSubmit) */
  submit?: boolean;
}

interface GlassSheetProps {
  /** Крупный заголовок; он же — короткое название в панели при прокрутке */
  title: string;
  subtitle?: React.ReactNode;
  /** Вызывается, когда лист уже уехал */
  onClose: () => void;
  /** Кнопка слева. По умолчанию «Закрыть»; null — без кнопки */
  cancelLabel?: string | null;
  /** Кнопка справа: «Готово», «Сохранить» */
  action?: GlassSheetAction;
  /** Закрытие мимо действия. Вернуть false — остаться на месте */
  confirmClose?: () => boolean;
  /** Задан — лист становится формой (Enter на клавиатуре отправляет) */
  onSubmit?: (close: () => void) => void;
  /** Закреплено внизу, над краем экрана */
  footer?: React.ReactNode | ((close: () => void) => React.ReactNode);
  /** Высота на телефоне: во весь экран или по содержимому */
  fit?: 'full' | 'content';
  /** Слой: листы поверх листа поднимают его */
  zIndex?: number;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
}

// Длительность ухода — совпадает с переходом листа ниже
const OUT_MS = 300;
const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 0.6; // px/мс

const isPhoneWidth = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches;
const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Группа строк карточкой — как секции в настройках iOS */
export const SheetSection: React.FC<{ title?: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; plain?: boolean }> = ({ title, hint, children, plain }) => (
  <section>
    {title && (
      <div className="px-4 pb-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{title}</div>
    )}
    {plain ? children : (
      <div className="rounded-2xl bg-white dark:bg-slate-800 ring-1 ring-slate-200/70 dark:ring-slate-700/70 divide-y divide-slate-100 dark:divide-slate-700/70 overflow-hidden">
        {children}
      </div>
    )}
    {hint && <p className="px-4 pt-1.5 text-[12px] leading-snug text-slate-400 dark:text-slate-500">{hint}</p>}
  </section>
);

const GlassSheet: React.FC<GlassSheetProps> = ({
  title, subtitle, onClose, cancelLabel = 'Закрыть', action, confirmClose, onSubmit,
  footer, fit = 'full', zIndex = 200, children,
}) => {
  const phone = useRef(isPhoneWidth());
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ y0: number; t0: number; dy: number } | null>(null);

  // Уйти с анимацией — после действия (сохранили, выбрали) переспрашивать нечего
  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    (document.activeElement as HTMLElement | null)?.blur?.();
    setClosing(true);
    setTimeout(onClose, reducedMotion() ? 0 : OUT_MS);
  };

  // Закрыть мимо действия — с разрешения формы
  const requestClose = () => {
    if (confirmClose && !confirmClose()) { setDragY(0); return; }
    close();
  };

  const requestRef = useRef(requestClose);
  requestRef.current = requestClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Смахивание — за верхнюю панель: содержимое листается само, и тянуть за
  // него значило бы спорить с прокруткой.
  const onDragStart = (e: React.PointerEvent) => {
    if (!phone.current || e.pointerType === 'mouse') return;
    if ((e.target as HTMLElement).closest('button, input, textarea, select, a')) return;
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
    if (d.dy > DISMISS_DISTANCE || (d.dy > 24 && velocity > DISMISS_VELOCITY)) requestClose();
    else setDragY(0);
  };

  // Крупный заголовок уходит при прокрутке — в панели проявляется короткий
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 44);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Клавиатура перекрывает низ листа — оставляем под содержимым место
  const [keyboardInset, setKeyboardInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setKeyboardInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    update();
    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  }, []);

  const isPhone = phone.current;
  const panelStyle: React.CSSProperties = isPhone
    ? {
        transform: `translateY(${closing ? '105%' : `${dragY}px`})`,
        transition: dragging ? 'none' : `transform ${OUT_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`,
      }
    : {
        transform: closing ? 'scale(0.97)' : undefined,
        opacity: closing ? 0 : undefined,
        transition: 'transform 180ms ease, opacity 180ms ease',
      };
  const backdropStyle: React.CSSProperties = {
    opacity: closing ? 0 : isPhone ? Math.max(0.35, 1 - Math.max(0, dragY) / 500) : 1,
    transition: dragging ? 'none' : `opacity ${OUT_MS}ms ease`,
  };

  const Panel = (onSubmit ? 'form' : 'div') as 'form';
  const content = typeof children === 'function' ? children(close) : children;
  const footerContent = typeof footer === 'function' ? footer(close) : footer;

  return (
    <ModalPortal onClose={requestClose}>
      <div className="fixed inset-0 flex justify-center items-end sm:items-center sm:p-6" style={{ zIndex }}>
        <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px] search-backdrop-in" style={backdropStyle} onClick={requestClose} />

        <Panel
          role="dialog"
          aria-label={title}
          onSubmit={onSubmit ? (e: React.FormEvent) => { e.preventDefault(); onSubmit(close); } : undefined}
          style={panelStyle}
          className={`search-panel-in relative flex flex-col w-full sm:max-w-md overflow-hidden
                      bg-slate-50 dark:bg-slate-900 shadow-2xl rounded-t-[28px] sm:rounded-3xl sm:max-h-[88vh]
                      ${fit === 'full'
                        ? 'h-[calc(100%-env(safe-area-inset-top,0px)-10px)] sm:h-auto'
                        : 'max-h-[calc(100%-env(safe-area-inset-top,0px)-10px)]'}`}
        >
          {/* Панель: ручка, кнопка слева, короткое название, действие. За неё лист смахивается */}
          <div
            className={`shrink-0 touch-none select-none transition-colors duration-200 ${
              scrolled ? 'bg-slate-50/85 dark:bg-slate-900/85 backdrop-blur-xl' : ''
            }`}
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
          >
            <div className="sm:hidden flex justify-center pt-2">
              <span className="h-[5px] w-9 rounded-full bg-slate-300 dark:bg-slate-600" />
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center h-12 px-4">
              {cancelLabel ? (
                <button type="button" onClick={requestClose}
                        className="justify-self-start text-[16px] text-indigo-600 dark:text-indigo-400 active:opacity-60">
                  {cancelLabel}
                </button>
              ) : <span />}
              <span className={`max-w-[50vw] truncate text-[16px] font-semibold text-slate-900 dark:text-white transition-opacity duration-200 ${scrolled ? 'opacity-100' : 'opacity-0'}`}>
                {title}
              </span>
              {action ? (
                <button
                  type={action.submit ? 'submit' : 'button'}
                  disabled={action.disabled}
                  onClick={action.submit ? undefined : () => action.onClick?.(close)}
                  className="justify-self-end text-[16px] font-semibold text-indigo-600 dark:text-indigo-400 disabled:text-slate-300 dark:disabled:text-slate-600 active:opacity-60 transition-colors"
                >
                  {action.label}
                </button>
              ) : <span />}
            </div>
            <div className={`h-px transition-colors duration-200 ${scrolled ? 'bg-slate-200 dark:bg-slate-800' : 'bg-transparent'}`} />
          </div>

          <div
            ref={scrollRef}
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4"
            style={{ paddingBottom: footerContent ? 16 : `calc(${keyboardInset}px + env(safe-area-inset-bottom, 0px) + 24px)` }}
          >
            {/* Крупный заголовок — уезжает вместе с содержимым */}
            <header className="pt-1 pb-5">
              <h2 className="text-[28px] leading-tight font-bold tracking-tight text-slate-900 dark:text-white">{title}</h2>
              {subtitle && <div className="mt-0.5 text-[15px] text-slate-500 dark:text-slate-400 truncate">{subtitle}</div>}
            </header>
            {content}
          </div>

          {footerContent && (
            <div className="shrink-0 px-4 pt-3 border-t border-slate-200/70 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/90 backdrop-blur-xl"
                 style={{ paddingBottom: `calc(${keyboardInset}px + env(safe-area-inset-bottom, 0px) + 12px)` }}>
              {footerContent}
            </div>
          )}
        </Panel>
      </div>
    </ModalPortal>
  );
};

export default GlassSheet;
