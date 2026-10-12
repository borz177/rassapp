import { useCallback, useRef } from 'react';

/**
 * Смахивание листа вниз — как в Telegram и системных листах iOS: тянуть можно
 * за любое место листа, а не только за ручку сверху.
 *
 * Внутри листа часто свой список. Если он прокручен вниз, тяга принадлежит ему:
 * лист двигается, только когда список уже у верхнего края (или его нет) и жест
 * с самого начала идёт вниз. Вбок — не наш жест (карусели, смахивание строк).
 *
 * Положение пишется прямо в style, без setState: перерисовывать React на каждый
 * кадр пальца — заметные рывки на длинных листах.
 */

const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
/** С какого сдвига понятно, куда пошёл палец */
const SLOP = 6;
/** Быстрый бросок закрывает лист даже на коротком ходу, px/мс */
const FLING_VELOCITY = 0.45;

/** Разметка листа: корень > [затемнение, панель] */
/**
 * Уход листа (Sheet, GlassSheet), который сняли из кода (родитель просто перестал его рисовать —
 * кнопка внутри окна, сохранение). Разметка уже уходит со страницы, поэтому
 * играем уход на её копии: так любое закрытие выглядит одинаково, и окнам не
 * нужно у себя переделывать каждую кнопку «Закрыть» на анимированную.
 */
export const playGhostExit = (root: HTMLElement, ms: number, isSheet = true) => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ghost = root.cloneNode(true) as HTMLElement;
  ghost.style.pointerEvents = 'none';
  ghost.setAttribute('aria-hidden', 'true');
  const [backdrop, panel] = Array.from(ghost.children) as HTMLElement[];
  if (!backdrop || !panel) return;
  // Копия — новый элемент: без этого заново сыграла бы анимация появления
  backdrop.style.animation = 'none';
  panel.style.animation = 'none';
  document.body.appendChild(ghost);
  const from = panel.style.transform || 'translate3d(0, 0, 0)';
  panel.animate(
    isSheet
      ? [{ transform: from }, { transform: 'translate3d(0, 100%, 0)' }]
      : [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.95) translateY(8px)' }],
    { duration: ms, easing: isSheet ? EASE : 'ease', fill: 'forwards' },
  );
  backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease', fill: 'forwards' });
  setTimeout(() => ghost.remove(), ms + 40);
};

export const isPhoneWidth = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches;

interface SheetDragOptions {
  /** Лист уехал за край — пора снимать его со страницы */
  onDismiss: () => void;
  /**
   * Можно ли закрыть (формы с правками переспрашивают). Пока спрашиваем, лист
   * стоит на месте; false — так и остаётся.
   */
  confirm?: () => boolean | Promise<boolean>;
  /** Выключено — жест не перехватывается (идёт запись, лист не закрываемый) */
  enabled?: boolean;
  /** Затемнение под листом — гаснет по мере того, как лист уезжает */
  backdrop?: () => HTMLElement | null;
}

/** Ближайший прокручиваемый по вертикали блок между точкой касания и листом */
const findScroller = (target: EventTarget | null, panel: HTMLElement): HTMLElement | null => {
  let el = target instanceof Element ? target as HTMLElement : null;
  while (el) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el;
    if (el === panel) return null;
    el = el.parentElement;
  }
  return null;
};

/**
 * Возвращает ref для панели листа. Ref, а не эффект: управляемый лист
 * появляется позже своего компонента, и жест должен подключиться именно тогда.
 */
export function useSheetDrag(options: SheetDragOptions): (panel: HTMLElement | null) => void {
  // Обработчики вешаются один раз — свежие колбэки берём через ref
  const opts = useRef(options);
  opts.current = options;
  const detach = useRef<(() => void) | null>(null);

  return useCallback((panel: HTMLElement | null) => {
    detach.current?.();
    detach.current = null;
    if (!panel || !isPhoneWidth()) return;
    const backdrop = () => opts.current.backdrop?.() ?? null;

    type State = {
      x0: number; y0: number; base: number;
      scroller: HTMLElement | null;
      mode: 'pending' | 'drag' | 'off';
      offset: number;
      samples: { t: number; y: number }[];
    };
    let st: State | null = null;
    let suppressClick = false;
    let busy = false;

    const place = (offset: number, ms: number) => {
      const t = ms ? `transform ${ms}ms ${EASE}` : 'none';
      panel.style.transition = t;
      panel.style.transform = offset ? `translate3d(0, ${offset}px, 0)` : '';
      const b = backdrop();
      if (b) {
        const h = panel.getBoundingClientRect().height || window.innerHeight;
        b.style.transition = ms ? `opacity ${ms}ms ease` : 'none';
        b.style.opacity = offset > 0 ? String(Math.max(0, 1 - offset / h)) : '';
      }
    };

    const leave = (velocity: number) => {
      const h = panel.getBoundingClientRect().height + 40;
      // Брошенный быстро уходит быстрее — как будто доехал по инерции
      const ms = velocity > 1 ? 200 : 280;
      (document.activeElement as HTMLElement | null)?.blur?.();
      place(h, ms);
      setTimeout(() => opts.current.onDismiss(), ms);
    };

    const onStart = (e: TouchEvent) => {
      st = null;
      if (busy || opts.current.enabled === false || e.touches.length !== 1) return;
      const target = e.target as Element | null;
      // Ползунки и места, где палец рисует, жест не отдают
      if (target?.closest('input[type="range"], canvas, [data-sheet-no-drag]')) return;
      const t = e.touches[0];
      st = {
        x0: t.clientX, y0: t.clientY, base: t.clientY,
        scroller: findScroller(target, panel),
        mode: 'pending', offset: 0, samples: [],
      };
    };

    const onMove = (e: TouchEvent) => {
      if (!st || st.mode === 'off') return;
      const t = e.touches[0];
      const dx = t.clientX - st.x0;
      const dy = t.clientY - st.y0;

      if (st.mode === 'pending') {
        const atTop = !st.scroller || st.scroller.scrollTop <= 0;
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) {
          // Не даём браузеру начать «резинку» списка, пока решаем: иначе на
          // iOS прокрутка захватит жест и отменить её будет уже нельзя
          if (dy > 0 && dy >= Math.abs(dx) && atTop && e.cancelable) e.preventDefault();
          return;
        }
        if (Math.abs(dx) > Math.abs(dy) || dy < 0 || !atTop) { st.mode = 'off'; return; }
        st.mode = 'drag';
        st.base = t.clientY;
        // Анимация появления (иная застывает в конце) перекрыла бы
        // inline-transform. Отменяем её, а не пишем animation: none — тот
        // запрет остался бы и не дал сыграть анимации ухода.
        panel.getAnimations?.().forEach(a => a.cancel());
        backdrop()?.getAnimations?.().forEach(a => a.cancel());
      }

      if (e.cancelable) e.preventDefault();
      const raw = t.clientY - st.base;
      st.offset = raw > 0 ? raw : Math.max(-24, raw / 6); // вверх — с сопротивлением
      place(st.offset, 0);
      const now = performance.now();
      st.samples.push({ t: now, y: t.clientY });
      while (st.samples.length > 2 && now - st.samples[0].t > 90) st.samples.shift();
    };

    const onEnd = async () => {
      const s = st;
      st = null;
      if (!s || s.mode !== 'drag') return;
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 350);

      const first = s.samples[0];
      const last = s.samples[s.samples.length - 1];
      const velocity = first && last && last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
      const h = panel.getBoundingClientRect().height;
      const far = s.offset > Math.min(140, h * 0.3);
      const flung = velocity > FLING_VELOCITY && s.offset > 12;
      if (!far && !flung) { place(0, 320); return; }

      const confirm = opts.current.confirm;
      if (confirm) {
        place(0, 320);
        busy = true;
        let ok = false;
        try { ok = await confirm(); } finally { busy = false; }
        if (ok) leave(0);
        return;
      }
      leave(velocity);
    };

    // Отпущенный после тяги палец не должен нажать кнопку под собой
    const onClick = (e: MouseEvent) => {
      if (suppressClick) { e.stopPropagation(); e.preventDefault(); }
    };

    panel.addEventListener('touchstart', onStart, { passive: true });
    panel.addEventListener('touchmove', onMove, { passive: false });
    panel.addEventListener('touchend', onEnd);
    panel.addEventListener('touchcancel', onEnd);
    panel.addEventListener('click', onClick, true);
    detach.current = () => {
      panel.removeEventListener('touchstart', onStart);
      panel.removeEventListener('touchmove', onMove);
      panel.removeEventListener('touchend', onEnd);
      panel.removeEventListener('touchcancel', onEnd);
      panel.removeEventListener('click', onClick, true);
    };
  }, []);
}
