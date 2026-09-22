/**
 * Возврат клавиатуры приложению.
 *
 * Клавиатура принадлежит не странице, а фокусу, и фокус умеет уходить из
 * документа совсем: в фрейм печати, который потом удалили вместе с просмотром,
 * или в соседнюю вкладку, открытую ссылкой на WhatsApp. После этого
 * document.hasFocus() === false: поля видно, курсор в них ставится, а буквы не
 * приходят никуда. На компьютере это лечилось только тем, что окно сворачивали
 * и открывали заново.
 *
 * Возвращать фокус силой каждый раз нельзя — окно чужое, — но в моменты, когда
 * человек явно работает с приложением (открыл окно, нажал мышью), это ровно то,
 * чего он и хочет.
 */
export const restoreWindowFocus = (): void => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (document.hasFocus?.()) return;
  try { window.focus(); } catch { /* окно могли закрыть — не наша забота */ }
};

/** Глобальная страховка: нажатие мышью возвращает клавиатуру, если её потеряли. */
export const watchWindowFocus = (): (() => void) => {
  if (typeof window === 'undefined') return () => {};
  const onPointerDown = () => restoreWindowFocus();
  window.addEventListener('pointerdown', onPointerDown, true);
  return () => window.removeEventListener('pointerdown', onPointerDown, true);
};
