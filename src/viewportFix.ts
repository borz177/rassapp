/**
 * Обход ошибки iOS у сайта, добавленного на экран «Домой» (PWA).
 *
 * После сворачивания и возврата Safari в режиме standalone иногда держит
 * устаревшую высоту окна: элементы с position: fixed у нижнего края (панель
 * вкладок, плашка корзины) при прокрутке уезжают вверх, а отступы под вырез и
 * «полоску» сбиваются — пока страница не перерисуется сама.
 *
 * Лечим двумя способами:
 * 1. При возврате (visibilitychange, pageshow, поворот, закрытие клавиатуры)
 *    принудительно пересчитываем раскладку — iOS заново сверяет окно с экраном.
 * 2. Если окно раскладки всё равно разошлось с видимой областью, сдвигаем нижние
 *    панели на эту разницу (--vv-shift, класс .vv-anchor): они остаются у
 *    реального низа экрана. Пока открыта клавиатура, не трогаем — там iOS
 *    сдвигает видимую область намеренно.
 */
const isIOS = () =>
  /iP(hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const isStandalone = () =>
  (navigator as Navigator & { standalone?: boolean }).standalone === true
  || window.matchMedia?.('(display-mode: standalone)').matches;

const editing = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

export function installViewportFix() {
  if (typeof window === 'undefined' || !isIOS() || !isStandalone()) return;
  const root = document.documentElement;
  // Сдвиг включаем только здесь: на остальных устройствах панели не трогаем
  root.classList.add('vv-fix');

  const sync = () => {
    const vv = window.visualViewport;
    let shift = 0;
    if (vv && !editing()) {
      // Низ видимой области минус низ окна раскладки: на столько fixed-панели
      // оказались не у края экрана
      shift = Math.round(vv.height + vv.offsetTop - window.innerHeight);
      // Большая разница — это клавиатура или жест, а не наш случай
      if (Math.abs(shift) > 120) shift = 0;
    }
    root.style.setProperty('--vv-shift', `${shift}px`);
  };

  const reflow = () => {
    requestAnimationFrame(() => {
      // Прокрутка «на месте» заставляет iOS заново сверить окно с экраном
      window.scrollTo(window.scrollX, window.scrollY);
      root.classList.add('vv-reflow');
      requestAnimationFrame(() => {
        root.classList.remove('vv-reflow');
        sync();
      });
    });
  };

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reflow(); });
  window.addEventListener('pageshow', reflow);
  window.addEventListener('orientationchange', () => window.setTimeout(reflow, 250));
  window.addEventListener('focusout', () => window.setTimeout(reflow, 80));
  window.visualViewport?.addEventListener('resize', sync);
  window.visualViewport?.addEventListener('scroll', sync);
  window.addEventListener('scroll', sync, { passive: true });
  sync();
}
