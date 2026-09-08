import React, { useCallback, useRef, useState } from 'react';
import ModalPortal from './ModalPortal';

interface SheetProps {
  /** Вызывается после того, как анимация ухода доиграла */
  onClose: () => void;
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
  onClose, variant = 'sheet', className = '', dismissible = true, children,
}) => {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setTimeout(onClose, OUT_MS[variant]);
  }, [onClose, variant]);

  const isSheet = variant === 'sheet';

  return (
    // Шаг «назад» отдаём листу: без onClose он закрыл бы страницу под окном.
    <ModalPortal onClose={requestClose}>
      <div
        className={`fixed inset-0 z-modal-top flex justify-center bg-slate-900/60 backdrop-blur-sm ${
          isSheet ? 'items-end sm:items-center p-0 sm:p-4' : 'items-center p-6'
        } ${closing ? 'animate-fade-out' : 'animate-modal-fade-in'}`}
        onClick={() => { if (dismissible) requestClose(); }}
      >
        <div
          onClick={e => e.stopPropagation()}
          className={`bg-white dark:bg-slate-800 shadow-2xl ${
            isSheet ? 'w-full rounded-t-3xl sm:rounded-3xl' : 'w-full max-w-xs rounded-3xl'
          } ${
            closing
              ? (isSheet ? 'animate-slide-down-sheet' : 'animate-dialog-out')
              : (isSheet ? 'animate-slide-up-sheet' : 'animate-dialog-in')
          } ${className}`}
        >
          {typeof children === 'function' ? children(requestClose) : children}
        </div>
      </div>
    </ModalPortal>
  );
};

export default Sheet;
