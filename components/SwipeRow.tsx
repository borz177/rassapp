import React, { useEffect, useRef, useState } from 'react';
import { haptics } from '../src/haptics';

/**
 * Свайп по строке списка — как в «Почте» iPhone.
 *
 * Влево — открываются действия справа (right), вправо — слева (left). Свайп
 * до конца выполняет первое действие стороны, в момент «щелчка» — отклик
 * Taptic Engine. Открыта всегда одна строка: начали тянуть другую — прежняя
 * закрывается. Нажатие по открытой строке её закрывает, а не открывает карточку.
 *
 * Только для пальца: мышью на компьютере эти же действия есть в меню «⋮».
 * Касание у самого левого края экрана не перехватываем — это жест «назад»
 * (components/transitions/PagePush.tsx).
 */

export interface SwipeAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  /** Цвет кнопки */
  tone: 'emerald' | 'sky' | 'indigo' | 'amber' | 'rose' | 'slate' | 'violet';
  onAction: () => void;
}

const TONE: Record<SwipeAction['tone'], string> = {
  emerald: 'bg-emerald-500',
  sky: 'bg-sky-500',
  indigo: 'bg-indigo-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  slate: 'bg-slate-400 dark:bg-slate-600',
  violet: 'bg-violet-500',
};

const BTN = 72;            // ширина кнопки действия
const EDGE = 28;           // зона жеста «назад» у левого края
const OPEN_EVENT = 'finuchet:swiperow-open';
// Насколько дальше кнопок нужно дотянуть, чтобы сработало первое действие
const FULL = 44;
let seq = 0;

const SwipeRow: React.FC<{
  left?: SwipeAction[];
  right?: SwipeAction[];
  /** Скругление контейнера — то же, что у карточки внутри */
  className?: string;
  children: React.ReactNode;
}> = ({ left = [], right = [], className = '', children }) => {
  const id = useRef(++seq);
  const host = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const st = useRef({ x0: 0, y0: 0, base: 0, axis: '' as '' | 'x' | 'y', armed: false, active: false, width: 0 });
  const xRef = useRef(0);
  xRef.current = x;

  const leftW = left.length * BTN;
  const rightW = right.length * BTN;
  // Действия в ref: слушатели касаний вешаются один раз и не пересоздаются на
  // каждой перерисовке посреди жеста
  const acts = useRef({ left, right, leftW, rightW });
  acts.current = { left, right, leftW, rightW };
  const hasActions = left.length > 0 || right.length > 0;

  // Чужая строка открылась — закрываемся
  useEffect(() => {
    const onOpen = (e: Event) => { if ((e as CustomEvent).detail !== id.current) setX(0); };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el || !hasActions) return;

    const start = (e: TouchEvent) => {
      const t = e.touches[0];
      if (e.touches.length !== 1 || t.clientX < EDGE) { st.current.active = false; return; }
      st.current = { x0: t.clientX, y0: t.clientY, base: xRef.current, axis: '', armed: false, active: true, width: el.offsetWidth };
    };
    const move = (e: TouchEvent) => {
      const s = st.current;
      if (!s.active) return;
      const t = e.touches[0];
      const dx = t.clientX - s.x0, dy = t.clientY - s.y0;
      if (!s.axis) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        s.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
        if (s.axis === 'x') {
          setDragging(true);
          window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id.current }));
        }
      }
      if (s.axis !== 'x') return;
      e.preventDefault();               // горизонтальный жест — не прокручиваем список
      const { left, right, leftW, rightW } = acts.current;
      let next = s.base + dx;
      const maxR = left.length ? s.width : 0;
      const maxL = right.length ? -s.width : 0;
      // За краем действий — тянется с сопротивлением, как резинка
      if (next > leftW) next = leftW + (next - leftW) * 0.55;
      if (next < -rightW) next = -rightW + (next + rightW) * 0.55;
      next = Math.max(maxL, Math.min(maxR, next));
      // Порог полного свайпа: дальше — сработает первое действие
      const full = Math.abs(next) > (next > 0 ? leftW : rightW) + FULL;
      if (full !== s.armed) { s.armed = full; haptics[full ? 'medium' : 'light'](); }
      setX(next);
    };
    const end = () => {
      const s = st.current;
      if (!s.active) return;
      s.active = false;
      setDragging(false);
      if (s.axis !== 'x') return;
      const cur = xRef.current;
      const { left, right, leftW, rightW } = acts.current;
      if (s.armed) {
        const action = cur > 0 ? left[0] : right[0];
        setX(0);
        if (action) window.setTimeout(action.onAction, 120);
        return;
      }
      // Открыть, если вытянули больше трети кнопок, иначе — закрыть
      if (cur > 0) setX(cur > leftW * 0.35 ? leftW : 0);
      else setX(-cur > rightW * 0.35 ? -rightW : 0);
    };

    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [hasActions]);

  const renderSide = (actions: SwipeAction[], side: 'left' | 'right') => {
    if (!actions.length) return null;
    const shown = side === 'left' ? Math.max(0, x) : Math.max(0, -x);
    // Тот же порог, что срабатывание: кнопка растянулась — значит, отпустишь и выполнится
    const full = shown > (side === 'left' ? leftW : rightW) + FULL;
    return (
      <div className={`absolute inset-y-0 ${side === 'left' ? 'left-0 flex-row' : 'right-0 flex-row-reverse'} flex`}
           style={{ width: Math.max(shown, 0) }} aria-hidden={shown === 0}>
        {actions.map((a, i) => (
          <button key={a.key} type="button" tabIndex={shown ? 0 : -1}
                  onClick={e => { e.stopPropagation(); setX(0); a.onAction(); }}
                  className={`${TONE[a.tone]} text-white flex flex-col items-center justify-center gap-1 overflow-hidden transition-[flex-grow] duration-150`}
                  style={{ flexGrow: full ? (i === 0 ? 1 : 0) : 1, flexBasis: full && i !== 0 ? 0 : BTN, minWidth: 0 }}>
            <span className="w-6 h-6 flex items-center justify-center">{a.icon}</span>
            <span className="text-[11px] font-semibold leading-none whitespace-nowrap">{a.label}</span>
          </button>
        ))}
      </div>
    );
  };

  return (
    <div ref={host} className={`relative overflow-hidden ${className}`}>
      {renderSide(left, 'left')}
      {renderSide(right, 'right')}
      <div
        onClickCapture={e => { if (xRef.current !== 0) { e.stopPropagation(); e.preventDefault(); setX(0); } }}
        className="relative"
        style={{
          transform: x ? `translate3d(${x}px,0,0)` : undefined,
          transition: dragging ? 'none' : 'transform .32s cubic-bezier(.22,1,.36,1)',
          touchAction: 'pan-y',
        }}
      >
        {children}
      </div>
    </div>
  );
};

export default SwipeRow;
