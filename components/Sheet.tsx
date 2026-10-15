import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import ModalPortal, { ModalParkContext, parkedSheetStyle } from './ModalPortal';
import { isPhoneWidth, playGhostExit, useSheetDrag } from '../src/sheetDrag';

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
  /** Слой, если лист открывают поверх другого окна с высоким z-index */
  zIndex?: number;
  /**
   * Сюда лист кладёт свой «закрыть с уходом» — для кода окна вне разметки
   * (обработчики, которые после дела закрывают окно).
   */
  closeRef?: React.MutableRefObject<() => void>;
  children: React.ReactNode | ((requestClose: () => void) => React.ReactNode);
}

const OUT_MS = { sheet: 280, dialog: 180 };



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
  onClose, open, variant = 'sheet', className = '', dismissible = true, zIndex, closeRef, children,
}) => {
  const controlled = open !== undefined;
  // Отложен под страницей, открытой из него (см. ModalParkContext)
  const parked = React.useContext(ModalParkContext);
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

  // ── Смахивание вниз (только лист и только на телефоне) ─────────────────
  // За любое место листа, как в Telegram (src/sheetDrag.ts). Уехавший
  // смахиванием лист больше не играет анимацию ухода — он уже за краем экрана.
  const swipeable = variant === 'sheet' && dismissible && isPhoneWidth();
  const [swipedAway, setSwipedAway] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Виден ли лист сейчас: только такой при снятии доигрывает уход на копии
  const visibleRef = useRef(false);
  const isSheetRef = useRef(variant === 'sheet');
  useLayoutEffect(() => () => {
    if (visibleRef.current && rootRef.current) playGhostExit(rootRef.current, isSheetRef.current ? OUT_MS.sheet : OUT_MS.dialog, isSheetRef.current);
  }, []);
  // Управляемый лист открыли снова — он снова на месте
  useLayoutEffect(() => {
    if (controlled && open) setSwipedAway(false);
  }, [open, controlled]);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    // Управляемый: родитель снимет open, уход доиграется здесь же
    if (controlled) { onClose(); return; }
    setClosing(true);
    setTimeout(onClose, OUT_MS[variant]);
  }, [onClose, variant, controlled]);
  if (closeRef) closeRef.current = requestClose;

  // Клавиатура на телефоне закрывает низ листа — поднимаем лист на её высоту,
  // чтобы поле и кнопки под ним оставались видны
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !isSheetRef.current || !isPhoneWidth()) return;
    const sync = () => setKeyboard(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => { vv.removeEventListener('resize', sync); vv.removeEventListener('scroll', sync); };
  }, []);

  const panelRef = useSheetDrag({
    enabled: swipeable,
    backdrop: () => backdropRef.current,
    onDismiss: () => {
      if (closingRef.current) return;
      closingRef.current = true;
      visibleRef.current = false; // лист уже за краем — копия для ухода не нужна
      setSwipedAway(true);
      onClose();
    },
  });

  // wasOpen покрывает отрисовку между закрытием и слой-эффектом: без него лист
  // успевал моргнуть пустотой.
  if (controlled && !open && !exiting && !wasOpen.current) { visibleRef.current = false; return null; }
  if (swipedAway) { visibleRef.current = false; return null; }

  const leaving = controlled ? !open : closing;
  const isSheet = variant === 'sheet';
  // Отложенный лист снимают вместе со страницей под ним — копия для ухода не нужна
  visibleRef.current = !leaving && !parked;
  isSheetRef.current = isSheet;

  return (
    // Шаг «назад» отдаём листу: без onClose он закрыл бы страницу под окном.
    <ModalPortal onClose={requestClose}>
      <div
        ref={rootRef}
        className={`fixed inset-0 z-modal-top flex justify-center ${
          isSheet ? 'items-end sm:items-center p-0 sm:p-4' : 'items-center p-6'
        }`}
        // Рамку сверху под статус-бар (.z-modal-top) убираем: внутри неё не
        // доставало затемнение, и над листом оставалась светлая полоса. Под
        // статус-бар лист не заходит и так — его высота ограничена ниже.
        style={{ borderTopWidth: 0, ...(zIndex ? { zIndex } : null), ...(parked ? parkedSheetStyle() : null) }}
        // Портал не отменяет всплытия по дереву React: без этого нажатие в листе
        // доходило бы до карточки, из которой его открыли, и открывало её
        onClick={e => e.stopPropagation()}
      >
        {/* Затемнение отдельным слоем: при смахивании гаснет оно, а не лист */}
        <div
          ref={backdropRef}
          className={`absolute inset-0 bg-slate-900/60 backdrop-blur-sm ${leaving ? 'animate-fade-out' : 'animate-modal-fade-in'}`}
          onClick={() => { if (dismissible) requestClose(); }}
        />
        <div
          ref={panelRef}
          // Лист не заходит под чёлку: сверху остаётся полоска затемнённого экрана
          style={isSheet ? {
            maxHeight: `calc(100dvh - env(safe-area-inset-top, 0px) - 10px - ${keyboard}px)`,
            ...(keyboard > 0 ? { marginBottom: keyboard, borderBottomWidth: 0, transition: 'margin-bottom 0.18s ease-out' } : null),
          } : undefined}
          className={`relative bg-white dark:bg-slate-800 shadow-2xl ${
            isSheet ? 'w-full rounded-t-[38px] sm:rounded-3xl' : 'w-full max-w-xs rounded-3xl'
          } ${
            leaving
              ? (isSheet ? 'animate-slide-down-sheet' : 'animate-dialog-out')
              : (isSheet ? 'animate-sheet-in' : 'animate-dialog-in')
          } ${className}`}
        >
          {/* Ручка — подсказка, что лист смахивается. Поверх содержимого, чтобы
              не сдвигать вёрстку листов, которые её не ждали. */}
          {swipeable && (
            <div aria-hidden className="absolute inset-x-0 top-0 h-6 z-20 flex justify-center pt-2.5 pointer-events-none">
              <span className="h-[5px] w-10 rounded-full bg-slate-300 dark:bg-slate-600" />
            </div>
          )}
          {typeof shown.current === 'function' ? shown.current(requestClose) : shown.current}
        </div>
      </div>
    </ModalPortal>
  );
};

export default Sheet;
