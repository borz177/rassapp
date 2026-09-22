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

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    // Управляемый: родитель снимет open, уход доиграется здесь же
    if (controlled) { onClose(); return; }
    setClosing(true);
    setTimeout(onClose, OUT_MS[variant]);
  }, [onClose, variant, controlled]);

  // wasOpen покрывает отрисовку между закрытием и слой-эффектом: без него лист
  // успевал моргнуть пустотой.
  if (controlled && !open && !exiting && !wasOpen.current) return null;

  const leaving = controlled ? !open : closing;
  const isSheet = variant === 'sheet';

  return (
    // Шаг «назад» отдаём листу: без onClose он закрыл бы страницу под окном.
    <ModalPortal onClose={requestClose}>
      <div
        className={`fixed inset-0 z-modal-top flex justify-center bg-slate-900/60 backdrop-blur-sm ${
          isSheet ? 'items-end sm:items-center p-0 sm:p-4' : 'items-center p-6'
        } ${leaving ? 'animate-fade-out' : 'animate-modal-fade-in'}`}
        onClick={() => { if (dismissible) requestClose(); }}
      >
        <div
          onClick={e => e.stopPropagation()}
          className={`bg-white dark:bg-slate-800 shadow-2xl ${
            isSheet ? 'w-full rounded-t-3xl sm:rounded-3xl' : 'w-full max-w-xs rounded-3xl'
          } ${
            leaving
              ? (isSheet ? 'animate-slide-down-sheet' : 'animate-dialog-out')
              : (isSheet ? 'animate-slide-up-sheet' : 'animate-dialog-in')
          } ${className}`}
        >
          {typeof shown.current === 'function' ? shown.current(requestClose) : shown.current}
        </div>
      </div>
    </ModalPortal>
  );
};

export default Sheet;
