import React, { useEffect, useRef, useState } from 'react';
import { useBackInterceptor } from './PagePush';

interface SubPageProps {
  /** Вызывается после того, как анимация ухода доиграла — здесь и снимают состояние. */
  onClose: () => void;
  className?: string;
  children: React.ReactNode | ((requestClose: () => void) => React.ReactNode);
}

const CLOSE_DURATION = 260;

/**
 * Подстраница внутри уже толкнутой страницы: карточка документа в журнале,
 * договор в карточке клиента.
 *
 * Раньше такие экраны подменяли содержимое мгновенно, и переход выбивался из
 * остального приложения — везде страницы выезжают справа, а здесь просто
 * мигало. Отдельным PagePush их не сделать: тот держит единственный слот
 * «текущей толкнутой страницы» для аппаратной кнопки «Назад», и вложенный
 * перезаписал бы слот родителя.
 *
 * Оформление берём у `.page-push-layer` целиком — те же отступы под верхние
 * пузыри, та же кривая и длительность, то же мгновенное появление на десктопе,
 * где переходов нет вовсе. Свой набор чисел рано или поздно разошёлся бы с
 * общим.
 *
 * Список под подстраницей остаётся смонтированным: он не перерисовывается
 * заново и сохраняет позицию прокрутки — при возврате человек оказывается там
 * же, откуда ушёл.
 */
const SubPage: React.FC<SubPageProps> = ({ onClose, className = '', children }) => {
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);
  // Синхронный замок: `closing` обновится только к следующей отрисовке, а
  // второй жест может прийти раньше и перезапустить уход с середины.
  const closingRef = useRef(false);

  useEffect(() => {
    // Два кадра: браузер обязан сначала отрисовать страницу за правым краем и
    // только потом получить новое положение — иначе он схлопнет оба состояния в
    // один кадр и переход не проиграется.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
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

  // Пока подстраница открыта, шаг «назад» принадлежит ей: и свайп, и стрелка,
  // и аппаратная кнопка возвращают к списку, а не закрывают весь раздел.
  useBackInterceptor(true, requestClose);

  const idle = entered && !closing;

  return (
    <div
      className={`page-push-layer bg-slate-50 dark:bg-slate-900 ${className}`}
      style={idle ? undefined : { transform: 'translateX(100%)', willChange: 'transform' }}
    >
      <div className="page-push-scroll page-push-scroll--tight max-w-7xl mx-auto p-4 md:p-10">
        {typeof children === 'function' ? children(requestClose) : children}
      </div>
    </div>
  );
};

export default SubPage;
