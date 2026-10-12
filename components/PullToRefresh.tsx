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
/** Индикатор — круг 40 px; встаёт в зазор между шапкой и уехавшим вниз контентом. */
const SPINNER = 40;
/** Лепестков в колесе — как у системного индикатора iOS */
const SPOKES = 8;
/** Возврат на место — с мягким торможением в конце, без рывка */
const SETTLE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const SETTLE_MS = 450;

/**
 * Сдвигает контент страницы (Layout помечает его data-ptr-content) за пальцем.
 *
 * Сдвиг — через position: relative + top, а не transform: transform сделал бы
 * контент точкой отсчёта для position: fixed внутри него, и модалки с панелями
 * поехали бы вместе со страницей (из-за этой ловушки в приложении появился
 * ModalPortal). top такой ловушки не создаёт, а перерисовка при нём дешёвая —
 * браузер просто переносит уже разложенный блок.
 */
const moveContent = (px: number, animate: boolean) => {
  const el = document.querySelector<HTMLElement>('[data-ptr-content]');
  if (!el) return;
  el.style.transition = animate ? `top ${SETTLE_MS}ms ${SETTLE}` : 'none';
  if (px > 0) { el.style.top = `${px}px`; return; }
  if (!animate) { el.style.top = ''; return; }
  // К «auto» браузер переход не играет — контент прыгал на место мгновенно.
  // Едем до 0px, а уже потом убираем свойство.
  el.style.top = '0px';
  window.setTimeout(() => { if (el.style.top === '0px') el.style.top = ''; }, SETTLE_MS + 50);
};

/** На планшете и компьютере шапка другая и индикатор скрыт — контент не двигаем. */
const isPhoneWidth = () => window.matchMedia('(max-width: 767px)').matches;

/**
 * Обновление списка потягиванием вниз — как в нативных приложениях.
 *
 * Контент едет за пальцем (moveContent), индикатор встаёт в открывшийся зазор
 * под шапкой; пока идёт обновление, контент держится на пороге.
 *
 * Сопротивление нелинейное: чем дальше тянешь, тем меньше отклик, и у жеста
 * появляется предел. Линейная тяга ощущается как рывок и не даёт понять,
 * докуда тянуть.
 */
const PullToRefresh: React.FC<PullToRefreshProps> = ({ onRefresh }) => {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Индикатор после возврата ещё немного виден — гаснет, а не пропадает
  const [hiding, setHiding] = useState(false);

  // Всё, что меняется в обработчиках событий, живёт в ref: слушатели вешаются
  // один раз, и через замыкание они видели бы состояние на момент подписки.
  const startY = useRef(0);
  const startX = useRef(0);
  const active = useRef(false);
  const engaged = useRef(false);
  const passed = useRef(false);
  const refreshingRef = useRef(false);
  const shiftContent = useRef(false);
  // Положение применяется раз в кадр: touchmove приходит чаще, чем экран
  // успевает отрисовать, и лишние перекладки дёргали контент на слабых телефонах
  const frame = useRef(0);
  const pending = useRef(0);
  // onRefresh из App пересоздаётся при каждом рендере, а обновление само
  // вызывает рендер: с ним в зависимостях эффект перевешивал слушатели посреди
  // жеста, и очистка возвращала контент на место, пока крутится индикатор.
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    const flush = () => {
      frame.current = 0;
      setPull(pending.current);
      if (shiftContent.current) moveContent(pending.current, false);
    };
    const follow = (distance: number) => {
      pending.current = distance;
      if (!frame.current) frame.current = requestAnimationFrame(flush);
    };
    /** Вернуть всё на место: контент плавно едет вверх, индикатор гаснет */
    const settle = (to: number) => {
      if (frame.current) { cancelAnimationFrame(frame.current); frame.current = 0; }
      setPull(to);
      if (shiftContent.current) moveContent(to, true);
      if (to === 0) {
        setHiding(true);
        window.setTimeout(() => setHiding(false), SETTLE_MS);
      }
    };

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
      shiftContent.current = isPhoneWidth();
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
        // Отсчёт — с места, где жест распознан: иначе контент сразу прыгал
        // на те 8 px, что палец прошёл, пока мы решали, чей это жест
        startY.current = e.touches[0].clientY;
      }

      // Экспоненциальное затухание: у тяги появляется потолок, и палец сам
      // чувствует, что дальше некуда.
      const pulled = Math.max(0, e.touches[0].clientY - startY.current);
      const distance = MAX_PULL * (1 - Math.exp(-pulled / MAX_PULL));
      follow(distance);

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

      if (!passed.current) { settle(0); return; }

      passed.current = false;
      refreshingRef.current = true;
      setRefreshing(true);
      // Пока крутится колесо, значок синхронизации у названия компании прячем
      // (.ptr-refreshing в index.css) — иначе на экране два индикатора сразу
      document.documentElement.classList.add('ptr-refreshing');
      settle(THRESHOLD);

      const startedAt = Date.now();
      try {
        await onRefreshRef.current();
      } catch {
        // Отказ обновления — не повод ломать жест: индикатор просто уедет.
      } finally {
        const spent = Date.now() - startedAt;
        if (spent < MIN_SPIN_MS) await new Promise(r => setTimeout(r, MIN_SPIN_MS - spent));
        refreshingRef.current = false;
        setRefreshing(false);
        document.documentElement.classList.remove('ptr-refreshing');
        settle(0);
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
      if (frame.current) cancelAnimationFrame(frame.current);
      document.documentElement.classList.remove('ptr-refreshing');
      moveContent(0, false);
    };
  }, []);

  if (pull <= 0 && !refreshing && !hiding) return null;

  const progress = Math.min(1, pull / THRESHOLD);
  // Уходит на место: колесо целиком, гаснет и чуть уменьшается
  const leaving = hiding && pull === 0 && !refreshing;

  return (
    <div
      aria-hidden
      className="md:hidden fixed left-0 right-0 z-40 flex justify-center pointer-events-none"
      style={{
        // Низ шапки — там же, где начинается контент (.mobile-main-offset)
        top: 'calc(env(safe-area-inset-top, 0px) + 4rem)',
        transform: `translateY(${Math.max(0, (pull - SPINNER) / 2)}px) scale(${leaving ? 0.6 : 1})`,
        // Пока палец на экране — никаких переходов: индикатор должен идти
        // ровно за пальцем. Плавность включается на возврате.
        transition: refreshing || pull === 0 || pull === THRESHOLD
          ? `transform ${SETTLE_MS}ms ${SETTLE}, opacity 250ms ease` : 'none',
        opacity: refreshing ? 1 : leaving ? 0 : Math.min(1, progress * 1.4),
      }}
    >
      <div className="w-10 h-10 flex items-center justify-center">
        {/* Колесо из 8 лепестков, как системный индикатор iOS. Пока тянут —
            лепестки появляются по кругу по мере хода пальца; при обновлении
            колесо крутится шагами по лепестку, хвост затухает. */}
        <svg
          width="28" height="28" viewBox="0 0 28 28"
          className={`text-slate-500 dark:text-slate-400 ${refreshing ? 'ptr-ios-spin' : ''}`}
        >
          {Array.from({ length: SPOKES }, (_, i) => {
            const shown = refreshing || leaving ? 1 : Math.min(1, Math.max(0, progress * SPOKES - i));
            // Ярче всех верхний лепесток, хвост затухает против часовой — колесо
            // крутится по часовой, как в iOS
            const fade = refreshing ? 1 - ((SPOKES - i) % SPOKES) * 0.1 : 1;
            return (
              <line key={i} x1="14" y1="2.5" x2="14" y2="8.5"
                    stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
                    transform={`rotate(${i * (360 / SPOKES)} 14 14)`}
                    opacity={shown * fade} />
            );
          })}
        </svg>
      </div>
    </div>
  );
};

export default PullToRefresh;
