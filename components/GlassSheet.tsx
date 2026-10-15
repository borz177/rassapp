import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ModalPortal, { ModalParkContext, parkedSheetStyle } from './ModalPortal';
import { isPhoneWidth, playGhostExit, useSheetDrag } from '../src/sheetDrag';

/**
 * Лист, как в системных окнах iOS, — общий для форм и списков приложения.
 *
 * На телефоне выезжает снизу и не заходит под чёлку (сверху видно затемнённый
 * экран — понятно, откуда пришли и куда вернёмся), уезжает обратно тем же
 * движением, смахивается вниз за любое место (src/sheetDrag.ts). Шапка — как в
 * Instagram: ручка и заголовок по центру над полупрозрачной размытой панелью,
 * под которую уходит прокручиваемое содержимое; там же кнопки — сверху их не
 * закрывает клавиатура. На компьютере — окно по центру.
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
  /** Заголовок по центру шапки */
  title: string;
  subtitle?: React.ReactNode;
  /** Вызывается, когда лист уже уехал */
  onClose: () => void;
  /** Кнопка слева. По умолчанию «Закрыть»; null — без кнопки */
  cancelLabel?: string | null;
  /** Кнопка справа: «Готово», «Сохранить» */
  action?: GlassSheetAction;
  /** Закрытие мимо действия. Вернуть false — остаться на месте (можно асинхронно — окном appConfirm) */
  confirmClose?: () => boolean | Promise<boolean>;
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

/** Поле формы: подпись сверху, ввод во всю ширину — длинные ФИО и адреса не режутся */
export const SheetField: React.FC<{ label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ label, hint, children, className = '' }) => (
  <label className={`block px-4 py-2.5 ${className}`}>
    <span className="block text-[12px] font-medium text-slate-500 dark:text-slate-400">{label}</span>
    {children}
    {hint && <span className="block mt-1 text-[12px] leading-snug text-slate-400 dark:text-slate-500">{hint}</span>}
  </label>
);

/** Стиль ввода внутри SheetField: без рамки, 16px — iOS не увеличивает страницу при фокусе */
export const sheetInputClass =
  'mt-0.5 w-full bg-transparent outline-none text-[16px] text-slate-900 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-600';

/** Переключатель строкой — как в настройках iOS */
export const SheetToggle: React.FC<{
  label: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
  tone?: 'indigo' | 'emerald';
}> = ({ label, description, checked, onChange, tone = 'emerald' }) => (
  <label className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer">
    <span className="min-w-0">
      <span className="block text-[16px] text-slate-900 dark:text-white">{label}</span>
      {description && <span className="block mt-0.5 text-[12px] leading-snug text-slate-500 dark:text-slate-400">{description}</span>}
    </span>
    <span className="relative inline-flex shrink-0">
      <input type="checkbox" className="sr-only peer" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className={`w-[51px] h-[31px] rounded-full bg-slate-200 dark:bg-slate-700 transition-colors ${tone === 'indigo' ? 'peer-checked:bg-indigo-600' : 'peer-checked:bg-emerald-500'}`} />
      <span className="absolute top-[2px] left-[2px] w-[27px] h-[27px] rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
    </span>
  </label>
);

/** Строка выбора одного варианта из списка — с галочкой справа, как в настройках iOS */
export const SheetChoice: React.FC<{
  selected: boolean;
  label: React.ReactNode;
  hint?: React.ReactNode;
  onSelect: () => void;
}> = ({ selected, label, hint, onSelect }) => (
  <button type="button" role="radio" aria-checked={selected} onClick={onSelect}
          className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-slate-50 dark:active:bg-slate-700/50 transition-colors">
    <span className="min-w-0 flex-1">
      <span className="block text-[16px] text-slate-900 dark:text-white">{label}</span>
      {hint && <span className="block mt-0.5 text-[12px] leading-snug text-slate-500 dark:text-slate-400">{hint}</span>}
    </span>
    <span className={`shrink-0 transition-opacity ${selected ? 'opacity-100' : 'opacity-0'}`}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-indigo-600 dark:text-indigo-400">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  </button>
);

/** Выбор одного из нескольких — сегменты, как UISegmentedControl */
export function SheetSegmented<T extends string>({ value, options, onChange }: {
  value: T;
  options: { id: T; label: React.ReactNode }[];
  onChange: (id: T) => void;
}) {
  return (
    <div className="grid gap-1 p-1 rounded-xl bg-slate-200/70 dark:bg-slate-800" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(o => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)}
                className={`h-9 rounded-[9px] text-[13px] font-semibold transition-all ${
                  value === o.id
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white'
                    : 'text-slate-500 dark:text-slate-400'
                }`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const GlassSheet: React.FC<GlassSheetProps> = ({
  title, subtitle, onClose, cancelLabel = 'Закрыть', action, confirmClose, onSubmit,
  footer, fit = 'full', zIndex = 200, children,
}) => {
  const phone = useRef(isPhoneWidth());
  // Отложен под страницей, открытой из него (см. ModalParkContext)
  const parked = React.useContext(ModalParkContext);
  const parkedRef = useRef(parked);
  parkedRef.current = parked;
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  // Уйти с анимацией — после действия (сохранили, выбрали) переспрашивать нечего
  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    (document.activeElement as HTMLElement | null)?.blur?.();
    setClosing(true);
    setTimeout(onClose, reducedMotion() ? 0 : OUT_MS);
  };

  // Закрыть мимо действия — с разрешения формы
  const asking = useRef(false);
  const requestClose = async () => {
    if (asking.current || closingRef.current) return;
    if (confirmClose) {
      asking.current = true;
      const ok = await confirmClose();
      asking.current = false;
      if (!ok) return;
    }
    close();
  };

  const requestRef = useRef(requestClose);
  requestRef.current = requestClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !parkedRef.current) requestRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Смахивание — за любое место листа. Уехавший пальцем лист уже за краем:
  // анимацию ухода не повторяем, сразу снимаем.
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useSheetDrag({
    backdrop: () => backdropRef.current,
    confirm: confirmClose,
    onDismiss: () => {
      if (closingRef.current) return;
      closingRef.current = true;
      onClose();
    },
  });

  // Лист сняли из кода (родитель перестал его рисовать) — уход доигрывает копия.
  // Закрытый кнопкой или смахнутый лист уже ушёл сам: closingRef.
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => () => {
    if (!closingRef.current && !parkedRef.current && rootRef.current) playGhostExit(rootRef.current, OUT_MS, phone.current);
  }, []);

  // Шапка лежит поверх содержимого (оно прокручивается под ней и просвечивает
  // размытым) — поэтому сверху у содержимого отступ ровно на её высоту
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(64);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const sync = () => setHeaderHeight(el.offsetHeight);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
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
    ? (closing ? {
        transform: 'translateY(105%)',
        transition: `transform ${OUT_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`,
      } : {})
    : {
        transform: closing ? 'scale(0.97)' : undefined,
        opacity: closing ? 0 : undefined,
        transition: 'transform 180ms ease, opacity 180ms ease',
      };
  const backdropStyle: React.CSSProperties = closing
    ? { opacity: 0, transition: `opacity ${OUT_MS}ms ease` }
    : {};

  const Panel = (onSubmit ? 'form' : 'div') as 'form';
  const content = typeof children === 'function' ? children(close) : children;
  const footerContent = typeof footer === 'function' ? footer(close) : footer;

  return (
    <ModalPortal onClose={requestClose}>
      <div ref={rootRef} className="fixed inset-0 flex justify-center items-end sm:items-center sm:p-6" style={parked ? parkedSheetStyle() : { zIndex }}>
        <div ref={backdropRef} className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px] search-backdrop-in" style={backdropStyle} onClick={requestClose} />

        <Panel
          ref={panelRef as React.Ref<HTMLFormElement>}
          role="dialog"
          aria-label={title}
          onSubmit={onSubmit ? (e: React.FormEvent) => { e.preventDefault(); onSubmit(close); } : undefined}
          style={panelStyle}
          className={`search-panel-in relative flex flex-col w-full sm:max-w-md overflow-hidden
                      bg-slate-50 dark:bg-slate-900 shadow-2xl rounded-t-[38px] sm:rounded-3xl sm:max-h-[88vh]
                      ${fit === 'full'
                        ? 'h-[calc(100%-env(safe-area-inset-top,0px)-10px)] sm:h-auto'
                        : 'max-h-[calc(100%-env(safe-area-inset-top,0px)-10px)]'}`}
        >
          {/* Шапка: ручка, заголовок по центру, кнопки по краям. Поверх
              содержимого, полупрозрачная с размытием — как в Instagram */}
          <div
            ref={headerRef}
            className="absolute inset-x-0 top-0 z-10 select-none bg-slate-50/75 dark:bg-slate-900/75 backdrop-blur-2xl backdrop-saturate-150"
          >
            <div className="sm:hidden flex justify-center pt-2.5">
              <span className="h-[5px] w-10 rounded-full bg-slate-300 dark:bg-slate-600" />
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 min-h-[52px] px-4 py-1.5">
              {cancelLabel ? (
                <button type="button" onClick={requestClose}
                        className="justify-self-start text-[16px] text-indigo-600 dark:text-indigo-400 active:opacity-60">
                  {cancelLabel}
                </button>
              ) : <span />}
              <div className="max-w-[56vw] sm:max-w-[260px] text-center min-w-0">
                <h2 className="truncate text-[18px] leading-tight font-bold tracking-tight text-slate-900 dark:text-white">{title}</h2>
                {subtitle && <div className="mt-0.5 truncate text-[13px] text-slate-500 dark:text-slate-400">{subtitle}</div>}
              </div>
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
          </div>

          <div
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4"
            style={{
              paddingTop: headerHeight + 8,
              paddingBottom: footerContent ? 16 : `calc(${keyboardInset}px + env(safe-area-inset-bottom, 0px) + 24px)`,
            }}
          >
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
