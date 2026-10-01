import { useEffect, useRef, useState } from 'react';

/**
 * Поведение стеклянной капли для переключателей внутри экранов (TabPill,
 * ModeSwitch) — то же, что у капли нижней навигации (Layout.tsx):
 *
 *  - под пальцем раздувается в прозрачную линзу;
 *  - отпустили — плавно сдувается, без покачиваний (nav-glass-pill--settle);
 *  - сменили вкладку нажатием — раздувается, едет, вытягиваясь по ходу, и
 *    оседает на новом месте (nav-glass-pill--travel, nav-glass-track--travel).
 *
 * Стили и длительности общие — в src/index.css рядом с нижней панелью. Если
 * вкладку сменили перетаскиванием, переезда нет: капля уже под пальцем и только
 * оседает.
 */

// Совпадают с анимациями в src/index.css (nav-pill-travel, nav-pill-settle)
export const DROP_TRAVEL_MS = 910;
const DROP_SETTLE_MS = 600;
// Смена вкладки сразу после отпускания — это конец перетаскивания, а не нажатие
const AFTER_DRAG_MS = 250;

/** Размер раздутой капли — из CSS-переменных капли (--sx/--sy, src/index.css) */
export const DROP_HELD_SCALE = 'scale(var(--sx), var(--sy))';

export function useGlassDrop(held: boolean, target: unknown) {
  const [settling, setSettling] = useState(false);
  const [traveling, setTraveling] = useState(false);
  const wasHeld = useRef(false);
  const releasedAt = useRef(0);

  useEffect(() => {
    if (held) { wasHeld.current = true; setSettling(false); return; }
    if (!wasHeld.current) return;
    wasHeld.current = false;
    releasedAt.current = performance.now();
    setSettling(true);
    const timer = window.setTimeout(() => setSettling(false), DROP_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [held]);

  const prev = useRef(target);
  useEffect(() => {
    const from = prev.current;
    prev.current = target;
    if (Object.is(from, target)) return;
    // Предыдущий переезд мог оборваться на полпути — его таймер снят очисткой
    // эффекта, поэтому состояние сбрасываем явно, а не ждём.
    if (held || performance.now() - releasedAt.current < AFTER_DRAG_MS) { setTraveling(false); return; }
    setTraveling(true);
    const timer = window.setTimeout(() => setTraveling(false), DROP_TRAVEL_MS);
    return () => window.clearTimeout(timer);
  }, [target]);

  return {
    /** Классы для .nav-glass-pill */
    pillClass: held ? 'nav-glass-pill--held' : settling ? 'nav-glass-pill--settle' : traveling ? 'nav-glass-pill--travel' : '',
    /** Размер капли: раздутая под пальцем, обычная в остальное время */
    pillStyle: { transform: held ? DROP_HELD_SCALE : 'scale(1, 1)' } as const,
    /** Класс для .nav-glass-track — плавный переезд вместо пружинного */
    trackClass: traveling ? 'nav-glass-track--travel' : '',
    /** Капля сейчас линза — вкладку под ней стоит увеличить */
    lens: held || traveling,
    traveling,
  };
}
