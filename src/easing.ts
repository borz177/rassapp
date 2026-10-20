/**
 * Плавность движений «как в нативных приложениях».
 *
 * CSS-переход знает кривую сам, а то, что двигаем из кода (прокрутку ленты
 * чата вслед за полем ввода), нужно вести той же кривой и той же длительностью
 * — иначе поле и лента едут по-разному, и это видно. Кривая — та же
 * cubic-bezier, что в CSS (.ai-composer в src/index.css).
 */

/** Функция плавности по точкам cubic-bezier(x1, y1, x2, y2): t ∈ [0..1] → прогресс */
export const cubicBezier = (x1: number, y1: number, x2: number, y2: number) => {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const x = (t: number) => ((ax * t + bx) * t + cx) * t;
  const y = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  // По времени (x) находим параметр t методом Ньютона, затем — прогресс (y)
  return (time: number): number => {
    if (time <= 0) return 0;
    if (time >= 1) return 1;
    let t = time;
    for (let i = 0; i < 8; i++) {
      const err = x(t) - time;
      if (Math.abs(err) < 1e-4) break;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    return y(Math.min(1, Math.max(0, t)));
  };
};

/** Клавиатура iPhone: поле ввода и лента чата едут по ней вместе */
export const KEYBOARD_EASE = cubicBezier(0.38, 0.7, 0.125, 1);
export const KEYBOARD_MS = 250;

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Прокрутить элемент к top по кривой; вернуть «стоп» (палец коснулся ленты —
 * останавливаемся, а не спорим с ним). Уменьшение движения — сразу на место
 */
export const animateScrollTop = (el: HTMLElement, top: number, ms = KEYBOARD_MS, ease = KEYBOARD_EASE): (() => void) => {
  const from = el.scrollTop;
  const to = Math.max(0, Math.min(top, el.scrollHeight - el.clientHeight));
  if (Math.abs(to - from) < 2 || prefersReducedMotion()) { el.scrollTop = to; return () => {}; }
  let raf = 0;
  const t0 = performance.now();
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / ms);
    el.scrollTop = from + (to - from) * ease(p);
    if (p < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
};
