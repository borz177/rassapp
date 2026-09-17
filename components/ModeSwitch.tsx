import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface ModeSwitchOption<T extends string> {
  id: T;
  label: string;
  icon: React.ReactNode;
}

interface ModeSwitchProps<T extends string> {
  options: ModeSwitchOption<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Подпись группы для экранного диктора */
  ariaLabel?: string;
  className?: string;
}

type Geom = { x: number; y: number; w: number; h: number };

/**
 * Переключатель режимов — один остров со стеклянной капсулой, как нижняя
 * навигация.
 *
 * Раньше это были два отдельных кружка, и подпись появлялась лишь на секунду
 * после нажатия. Два режима — это один выбор, поэтому они собраны в общую
 * капсулу с подписями, а выбранный отмечает то же стекло, что и в нижней панели:
 * его можно зажать и перевести пальцем на соседний режим. Классы острова и
 * капсулы общие с навигацией (src/index.css), так что вид и движение одни и те
 * же во всём приложении.
 *
 * Координаты капсулы берутся из offsetLeft/offsetWidth, а не из
 * getBoundingClientRect: остров на нажатии чуть увеличивается, и замер через
 * прямоугольник съезжал бы на этот масштаб.
 */
function ModeSwitch<T extends string>({
  options, value, onChange, ariaLabel = 'Режим', className = '',
}: ModeSwitchProps<T>) {
  const trackRef = useRef<HTMLDivElement>(null);
  const buttons = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});

  const [pill, setPill] = useState<Geom | null>(null);
  // Первая расстановка — без анимации: иначе капсула при открытии экрана
  // выезжала бы из левого угла.
  const [instant, setInstant] = useState(true);
  const [moving, setMoving] = useState(false);

  // Перетаскивание — тот же жест, что у нижней навигации (Layout.tsx)
  const [pressed, setPressed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragX, setDragX] = useState<number | null>(null);
  const [hover, setHover] = useState<T | null>(null);
  const hoverRef = useRef<T | null>(null);
  // active=false, пока палец не сдвинулся дальше порога: до этого жест ещё
  // может оказаться обычным нажатием.
  const drag = useRef<{ id: number; startX: number; startY: number; baseX: number; active: boolean } | null>(null);
  // После перетаскивания браузер шлёт click по кнопке под пальцем — глотаем его,
  // иначе режим переключился бы дважды.
  const suppressClick = useRef(false);

  const measure = useCallback((id: T): Geom | null => {
    const b = buttons.current[id];
    return b ? { x: b.offsetLeft, y: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight } : null;
  }, []);

  // Капсула встаёт под выбранный режим. Следим и за размером острова: ширина
  // кнопок меняется, когда догружается шрифт, и капсула не должна отстать.
  useLayoutEffect(() => {
    const place = () => {
      const g = measure(value);
      if (g) setPill(prev => (prev && prev.x === g.x && prev.y === g.y && prev.w === g.w && prev.h === g.h ? prev : g));
    };
    place();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    if (ro && trackRef.current) ro.observe(trackRef.current);
    return () => ro?.disconnect();
  }, [value, measure]);

  useEffect(() => {
    if (!pill || !instant) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setInstant(false)); });
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
  }, [pill, instant]);

  // Блик и «перетекание» — только в момент смены режима, не при открытии экрана
  const firstValue = useRef(true);
  useEffect(() => {
    if (firstValue.current) { firstValue.current = false; return; }
    setMoving(true);
    const id = setTimeout(() => setMoving(false), 520);
    return () => clearTimeout(id);
  }, [value]);

  // Палец нередко отпускают уже за пределами острова — слушаем окно, иначе
  // капсула осталась бы увеличенной.
  useEffect(() => {
    if (!pressed) return;
    const release = () => setPressed(false);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, [pressed]);

  // Режим, чей центр ближе всего к центру капсулы
  const nearest = (x: number, w: number): T | null => {
    const center = x + w / 2;
    let best: T | null = null;
    let bestDist = Infinity;
    for (const o of options) {
      const g = measure(o.id);
      if (!g) continue;
      const d = Math.abs(center - (g.x + g.w / 2));
      if (d < bestDist) { bestDist = d; best = o.id; }
    }
    return best;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!pill || !track || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const r = track.getBoundingClientRect();
    const scale = r.width / (track.offsetWidth || r.width) || 1;
    const lx = (e.clientX - r.left) / scale;
    const ly = (e.clientY - r.top) / scale;
    // Зона захвата чуть шире капсулы — в неё легче попасть пальцем
    const grab = 8;
    if (lx < pill.x - grab || lx > pill.x + pill.w + grab || ly < pill.y - grab || ly > pill.y + pill.h + grab) return;
    setPressed(true);
    drag.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, baseX: pill.x, active: false };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !pill) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.active) {
      if (Math.abs(dx) < 6) return;                                   // ещё не тянут — обычное нажатие
      if (Math.abs(dy) > Math.abs(dx)) { drag.current = null; return; } // листают страницу — жест не наш
      d.active = true;
      hoverRef.current = value;
      setHover(value);
      setDragging(true);
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* палец уже отпущен */ }
    }
    const first = measure(options[0].id);
    const last = measure(options[options.length - 1].id);
    let x = d.baseX + dx;
    // За крайними режимами капсула идёт с сопротивлением — видно, что дальше некуда
    if (first && x < first.x) x = first.x - (first.x - x) * 0.3;
    if (last && x > last.x) x = last.x + (x - last.x) * 0.3;
    setDragX(x);
    const near = nearest(x, pill.w);
    if (near && near !== hoverRef.current) {
      hoverRef.current = near;
      setHover(near);
      // Короткий отклик на пересечении режима — как у нативных переключателей
      try { navigator.vibrate?.(8); } catch { /* нет вибромотора */ }
    }
  };

  const endDrag = (commit: boolean) => {
    const d = drag.current;
    const target = commit ? hoverRef.current : null;   // читаем до сброса
    drag.current = null;
    setDragX(null);
    setDragging(false);
    setHover(null);
    hoverRef.current = null;
    if (!d?.active) return;                            // не тянули — кнопка отработает сама
    suppressClick.current = true;
    window.setTimeout(() => { suppressClick.current = false; }, 400);
    if (target && target !== value) onChange(target);
  };

  const handleClickCapture = (e: React.MouseEvent) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  // Стрелки влево/вправо — как у системных переключателей
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = options.findIndex(o => o.id === value);
    const next = options[i + (e.key === 'ArrowRight' ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    onChange(next.id);
    buttons.current[next.id]?.focus();
  };

  // Пока капсулу ведут, подсвечен режим под ней, а не выбранный
  const lit = (id: T) => (hover ?? value) === id;

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label={ariaLabel}
      data-testid="mode-switch"
      // touch-pan-y: вертикальную прокрутку отдаём браузеру, горизонтальное
      // ведение капсулы остаётся нам.
      className={`nav-glass nav-island relative grid grid-flow-col auto-cols-fr p-1 select-none touch-pan-y ${
        pressed || dragging ? 'nav-island--held' : ''
      } ${className}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={e => { if (!drag.current || drag.current.id === e.pointerId) endDrag(true); }}
      onPointerCancel={() => endDrag(false)}
      onClickCapture={handleClickCapture}
      onKeyDown={handleKeyDown}
    >
      {pill && (
        <div
          aria-hidden
          data-testid="mode-switch-pill"
          className={`nav-glass-track ${dragging || instant ? 'nav-glass-track--dragging' : ''}`}
          style={{
            left: 0,
            top: 0,
            width: pill.w,
            height: pill.h,
            transform: `translate3d(${dragX ?? pill.x}px, ${pill.y}px, 0)`,
          }}
        >
          <div className={`nav-glass-pill ${pressed || dragging ? 'nav-glass-pill--held' : moving ? 'nav-glass-pill--moving' : ''}`} />
        </div>
      )}

      {options.map(opt => {
        const selected = opt.id === value;
        return (
          <button
            key={opt.id}
            ref={el => { buttons.current[opt.id] = el; }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(opt.id)}
            className={`relative z-10 flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full px-5 text-sm font-bold outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-indigo-400/60 ${
              lit(opt.id)
                ? 'text-indigo-600 dark:text-indigo-300'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <span className="flex shrink-0 items-center">{opt.icon}</span>
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default ModeSwitch;
