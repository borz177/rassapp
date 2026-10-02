/**
 * Что прокручивается у основных разделов (Главная, Клиенты…).
 *
 * Обычно — само окно. В приложении для Mac с парящими панелями (.shell-floating,
 * см. src/index.css) содержимое — отдельная карточка и листается внутри себя:
 * иначе её скруглённые края уезжали бы вместе со страницей. Тогда это <main>.
 */
export const rootScroller = (): HTMLElement | null => {
  if (typeof document === 'undefined') return null;
  if (!document.documentElement.classList.contains('shell-floating')) return null;
  const main = document.querySelector<HTMLElement>('main.shell-main');
  // На узком окне (телефонная раскладка) карточки нет — листается окно
  return main && getComputedStyle(main).overflowY === 'auto' ? main : null;
};

export const rootScrollTop = (): number => rootScroller()?.scrollTop ?? window.scrollY;

export const rootScrollTo = (y: number): void => {
  const el = rootScroller();
  if (el) el.scrollTop = y;
  else window.scrollTo(0, y);
};
