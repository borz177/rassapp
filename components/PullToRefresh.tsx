import React, { useEffect, useRef, useState } from 'react';
import { hasBackInterceptor } from './transitions/PagePush';
import { haptic } from './feedback';

interface PullToRefreshProps {
  /** Что делать по отпусканию. Индикатор крутится, пока обещание не выполнится. */
  onRefresh: () => Promise<void> | void;
}

/**
 * Порог и потолок подобраны по ходу пальца, а не по числу на глаз: с таким
 * затуханием обновление срабатывает примерно на 74 px движения — как в нативных
 * списках. С прежними 72/110 требовалось протянуть на 117 px, и жест ощущался
 * тяжёлым: человек отпускал раньше, чем срабатывало.
 */
const THRESHOLD = 56;
const MAX_PULL = 130;
/** Сколько держать индикатор минимум: иначе быстрый ответ мигает и читается как сбой. */
const MIN_SPIN_MS = 450;

/**
 * Обновление списка потягиванием вниз — как в нативных приложениях.
 *
 * Содержимое страницы намеренно не сдвигается: двигается только индикатор.
 * Сдвиг делается через transform, а элемент с transform становится точкой
 * отсчёта для position: fixed внутри себя — в этом приложении на такие ловушки
 * уже наступали, из-за них появился ModalPortal. Ради красоты жеста ломать
 * позиционирование всех модалок и панелей нельзя.
 *
 * Сопротивление нелинейное: чем дальше тянешь, тем меньше отклик, и у жеста
 * появляется предел. Линейная тяга ощущается как рывок и не даёт понять,
 * докуда тянуть.
 */
const PullToRefresh: React.FC<PullToRefreshProps> = ({ onRefresh }) => {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Всё, что меняется в обработчиках событий, живёт в ref: слушатели вешаются
  // один раз, и через замыкание они видели бы состояние на момент подписки.
  const startY = useRef(0);
  const startX = useRef(0);
  const active = useRef(false);
  const engaged = useRef(false);
  const passed = useRef(false);
  const refreshingRef = useRef(false);

  useEffect(() => {
    /**
     * Есть ли между целью касания и корнем прокручиваемый блок, который уже
     * прокручен вниз. Внутри такого списка тяга принадлежит ему, а не странице:
     * без этой проверки жест перехватывал бы прокрутку в корзине и в модалках.
     */
    const insideScrolledArea = (target: EventTarget | null): boolean => {
      let el = target as HTMLElement | null;
      while (el && el !== document.body) {
        if (el.scrollTop > 0) {
          const overflow = getComputedStyle(el).overflowY;
          if (overflow === 'auto' || overflow === 'scroll') return true;
        }
        el = el.parentElement;
      }
      return false;
    };

    const onStart = (e: TouchEvent) => {
      active.current = false;
      engaged.current = false;
      passed.current = false;

      if (refreshingRef.current) return;
      // Открытая модалка или подстраница забирают жест себе — там свои списки
      // и свои шаги «назад».
      if (hasBackInterceptor()) return;
      if (e.touches.length !== 1) return;
      if (window.scrollY > 0) return;
      if (insideScrolledArea(e.target)) return;

      active.current = true;
      startY.current = e.touches[0].clientY;
      startX.current = e.touches[0].clientX;
    };

    const onMove = (e: TouchEvent) => {
      if (!active.current || refreshingRef.current) return;

      const dy = e.touches[0].clientY - startY.current;
      const dx = e.touches[0].clientX - startX.current;

      if (!engaged.current) {
        // Вверх — обычная прокрутка, вбок — шаг назад свайпом. Забираем жест
        // себе, только когда он отчётливо вертикальный и направлен вниз.
        if (dy <= 8 || dy < Math.abs(dx) * 1.5) {
          if (Math.abs(dx) > 12 || dy < -8) active.current = false;
          return;
        }
        engaged.current = true;
      }

      // Экспоненциальное затухание: у тяги появляется потолок, и палец сам
      // чувствует, что дальше некуда.
      const distance = MAX_PULL * (1 - Math.exp(-dy / MAX_PULL));
      setPull(distance);

      if (!passed.current && distance >= THRESHOLD) {
        passed.current = true;
        haptic(); // отдача ровно в тот момент, когда отпускать уже можно
      } else if (passed.current && distance < THRESHOLD) {
        passed.current = false;
      }

      // Гасим прокрутку страницы, пока тянем: иначе жест дерётся с браузером.
      if (e.cancelable) e.preventDefault();
    };

    const onEnd = async () => {
      if (!active.current || !engaged.current) { active.current = false; return; }
      active.current = false;
      engaged.current = false;

      if (!passed.current) { setPull(0); return; }

      passed.current = false;
      refreshingRef.current = true;
      setRefreshing(true);
      setPull(THRESHOLD);

      const startedAt = Date.now();
      try {
        await onRefresh();
      } catch {
        // Отказ обновления — не повод ломать жест: индикатор просто уедет.
      } finally {
        const spent = Date.now() - startedAt;
        if (spent < MIN_SPIN_MS) await new Promise(r => setTimeout(r, MIN_SPIN_MS - spent));
        refreshingRef.current = false;
        setRefreshing(false);
        setPull(0);
      }
    };

    // passive: false у move — иначе браузер не даст отменить прокрутку.
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [onRefresh]);

  if (pull <= 0 && !refreshing) return null;

  const progress = Math.min(1, pull / THRESHOLD);

  return (
    <div
      aria-hidden
      className="md:hidden fixed left-0 right-0 z-40 flex justify-center pointer-events-none"
      style={{
        top: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)',
        transform: `translateY(${pull * 0.55}px)`,
        // Пока палец на экране — никаких переходов: индикатор должен идти
        // ровно за пальцем. Плавность включается на возврате.
        transition: refreshing || pull === 0 ? 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)' : 'none',
        opacity: refreshing ? 1 : Math.min(1, progress * 1.4),
      }}
    >
      <div className="glass-surface w-10 h-10 rounded-full flex items-center justify-center shadow-lg">
        <svg
          width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          className={`text-indigo-600 dark:text-indigo-300 ${refreshing ? 'animate-spin' : ''}`}
          style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)` }}
        >
          {/* Незамкнутая дуга: в покое она читается как стрелка обновления, в
              движении — как обычный индикатор загрузки. */}
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          {!refreshing && <polyline points="21 3 21 9 15 9" />}
        </svg>
      </div>
    </div>
  );
};

export default PullToRefresh;
