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
  /** Сколько держать подпись после выбора, мс */
  revealMs?: number;
  /** Подпись группы для экранного диктора */
  ariaLabel?: string;
  className?: string;
}

type Geom = { x: number; y: number; w: number; h: number };

/** Жёсткость и затухание пружины капсулы: лёгкий перелёт, успокаивается за ~0.35 с */
const SPRING_K = 420;
const SPRING_C = 30;

/**
 * Переключатель режимов — один остров со стеклянной капсулой, как нижняя
 * навигация.
 *
 * Режимы собраны в общую капсулу, а выбранный отмечает то же стекло, что и в
 * нижней панели: его можно зажать и перевести пальцем на соседний режим. Классы
 * острова и капсулы общие с навигацией (src/index.css).
 *
 * В покое видны только значки. Подпись раскрывается у только что выбранного
 * режима и через секунду с небольшим уходит: название нужно ровно в момент
 * выбора — подтвердить, куда попал, — а дальше занимало бы строку ради слова,
 * которое человек только что прочитал. На десктопе название всегда есть во
 * всплывающей подсказке.
 *
 * Капсулу ведёт не CSS-переход, а цикл requestAnimationFrame. Пока подпись
 * раскрывается, кнопка растёт, и CSS-переход капсулы перезапускался бы каждый
 * кадр — стекло отставало от кнопки почти на сотню пикселей и доезжало уже после
 * того, как всё остановилось. Теперь ширина капсулы каждый кадр берётся ровно у
 * кнопки, а переезд на другой режим ведёт пружина — с тем же мягким перелётом,
 * что в нижней навигации. Цикл крутится, только пока есть движение.
 *
 * Координаты — из offsetLeft/offsetWidth, а не из прямоугольника: остров на
 * нажатии чуть увеличивается, и getBoundingClientRect съезжал бы на этот масштаб.
 */
function ModeSwitch<T extends string>({
  options, value, onChange, revealMs = 1600, ariaLabel = 'Режим', className = '',
}: ModeSwitchProps<T>) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const buttons = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const valueRef = useRef(value);
  valueRef.current = value;

  const [moving, setMoving] = useState(false);

  // Подпись у только что выбранного режима
  const [revealed, setRevealed] = useState<T | null>(null);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Перетаскивание — тот же жест, что у нижней навигации (Layout.tsx)
  const [pressed, setPressed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<T | null>(null);
  const hoverRef = useRef<T | null>(null);
  const dragXRef = useRef<number | null>(null);
  // active=false, пока палец не сдвинулся дальше порога: до этого жест ещё
  // может оказаться обычным нажатием.
  const drag = useRef<{ id: number; startX: number; startY: number; baseX: number; active: boolean } | null>(null);
  // После перетаскивания браузер шлёт click по кнопке под пальцем — глотаем его,
  // иначе режим переключился бы дважды.
  const suppressClick = useRef(false);

  // ─── Пружина капсулы ──────────────────────────────────────────────────────
  // gx — где была цель на прошлом кадре: по нему считается её скорость
  const sim = useRef({ x: 0, y: 0, w: 0, h: 0, vx: 0, gx: 0, ready: false });
  const raf = useRef(0);
  // Цикл держим живым ещё немного после последнего толчка: раскрытие подписи
  // начинается на кадр позже изменения состояния, и без запаса пружина успела бы
  // «успокоиться» до того, как кнопка начала расти.
  const aliveUntil = useRef(0);
  const reducedMotion = useRef(false);
  useEffect(() => {
    reducedMotion.current = typeof window !== 'undefined'
      && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const measure = useCallback((id: T): Geom | null => {
    const b = buttons.current[id];
    return b ? { x: b.offsetLeft, y: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight } : null;
  }, []);

  /** Один шаг пружины; true — капсула стоит на месте */
  const step = useCallback((dt: number): boolean => {
    const el = pillRef.current;
    const g = measure(valueRef.current);
    if (!el || !g) return true;
    const s = sim.current;
    const dragX = dragXRef.current;

    if (!s.ready || reducedMotion.current) {
      s.x = dragX ?? g.x; s.vx = 0; s.ready = true;
    } else if (dt > 0) {
      // Скорость цели: если кнопка сдвигается плавно, пружина учитывает эту
      // скорость и идёт вплотную, а не догоняет. Скачок на десятки пикселей —
      // смена режима: это не скорость, а новая точка, туда капсула едет пружиной
      // с перелётом.
      const JUMP = 20;
      const MAX_V = 2000;
      const clampV = (v: number) => Math.max(-MAX_V, Math.min(MAX_V, v));
      const gvx = Math.abs(g.x - s.gx) > JUMP ? 0 : clampV((g.x - s.gx) / dt);

      // Длинный кадр (подгрузка, занятый поток) проходим мелкими шагами: одним
      // большим шагом пружина либо отстала бы, либо раскачалась.
      const n = Math.max(1, Math.ceil(dt / 0.008));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        if (dragX !== null) {
          // Под пальцем — без пружины: любая задержка ощущается как залипание
          s.x = dragX; s.vx = 0;
        } else {
          s.vx += (SPRING_K * (g.x - s.x) + SPRING_C * (gvx - s.vx)) * h;
          s.x += s.vx * h;
        }
      }
    }
    // Ширина — ровно как у кнопки, без пружины: кнопка и так растёт плавно
    // (подпись раскрывается CSS-переходом), а своя анимация ширины только
    // отставала бы от неё.
    s.w = g.w;
    s.gx = g.x;
    s.y = g.y; s.h = g.h;

    const settled = dragX === null && Math.abs(g.x - s.x) < 0.25 && Math.abs(s.vx) < 0.5;
    if (settled) { s.x = g.x; s.vx = 0; }

    el.style.transform = `translate3d(${s.x}px, ${s.y}px, 0)`;
    el.style.width = `${s.w}px`;
    el.style.height = `${s.h}px`;
    el.style.opacity = '1';
    return settled;
  }, [measure]);

  /** Разбудить пружину: что-то сдвинулось или изменило размер */
  const kick = useCallback((holdMs = 480) => {
    aliveUntil.current = Math.max(aliveUntil.current, performance.now() + holdMs);
    if (raf.current) return;
    let last = performance.now();
    const tick = (now: number) => {
      // Не больше двух кадров времени за шаг. Смена режима перерисовывает
      // тяжёлый экран, и первый кадр после нажатия бывает долгим — догоняя его,
      // пружина проскакивала почти весь путь разом, и капсула не ехала, а
      // перескакивала. Так после подвисания движение просто продолжается.
      const dt = Math.min(1 / 30, Math.max(0.001, (now - last) / 1000));
      last = now;
      const settled = step(dt);
      raf.current = settled && now > aliveUntil.current && dragXRef.current === null
        ? 0
        : requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [step]);

  // Ссылку на цикл обнуляем, а не только отменяем кадр. React в режиме
  // разработки (StrictMode) снимает компонент и тут же монтирует снова, а ref при
  // этом сохраняется: с отменённым, но не обнулённым номером kick() считал, что
  // цикл уже идёт, и больше его не запускал — капсула застывала под первым
  // режимом и не ехала за выбором.
  useEffect(() => () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
  }, []);

  // Первая расстановка — до отрисовки и без анимации, чтобы капсула не выезжала
  // из угла. Дальше — толчок на каждую смену режима и изменение размеров.
  useLayoutEffect(() => {
    if (!sim.current.ready) step(0);
    else kick();
  }, [value, step, kick]);

  useEffect(() => { kick(); }, [revealed, kick]);

  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => kick(120));
    if (trackRef.current) ro.observe(trackRef.current);
    options.forEach(o => { const b = buttons.current[o.id]; if (b) ro.observe(b); });
    return () => ro.disconnect();
    // Набор кнопок меняется только вместе с их id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kick, options.map(o => o.id).join('|')]);

  // ─── Подпись ──────────────────────────────────────────────────────────────
  // Таймер снимаем и при уходе со страницы, и при повторном выборе: иначе
  // прежний отсчёт погасил бы подпись раньше времени.
  const clearReveal = () => {
    if (revealTimer.current) { clearTimeout(revealTimer.current); revealTimer.current = null; }
  };
  useEffect(() => clearReveal, []);

  const reveal = (id: T) => {
    setRevealed(id);
    clearReveal();
    revealTimer.current = setTimeout(() => setRevealed(null), revealMs);
  };

  const pick = (id: T) => {
    if (id !== value) onChange(id);
    reveal(id);
  };

  // Блик и «перетекание» — только в момент смены режима, не при открытии экрана
  const firstValue = useRef(true);
  useEffect(() => {
    if (firstValue.current) { firstValue.current = false; return; }
    setMoving(true);
    const id = setTimeout(() => setMoving(false), 520);
    return () => clearTimeout(id);
  }, [value]);

  // ─── Перетаскивание ───────────────────────────────────────────────────────
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
    for (const o of optionsRef.current) {
      const g = measure(o.id);
      if (!g) continue;
      const d = Math.abs(center - (g.x + g.w / 2));
      if (d < bestDist) { bestDist = d; best = o.id; }
    }
    return best;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    const s = sim.current;
    if (!s.ready || !track || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const r = track.getBoundingClientRect();
    const scale = r.width / (track.offsetWidth || r.width) || 1;
    const lx = (e.clientX - r.left) / scale;
    const ly = (e.clientY - r.top) / scale;
    // Зона захвата чуть шире капсулы — в неё легче попасть пальцем
    const grab = 8;
    if (lx < s.x - grab || lx > s.x + s.w + grab || ly < s.y - grab || ly > s.y + s.h + grab) return;
    setPressed(true);
    drag.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, baseX: s.x, active: false };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
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
    const opts = optionsRef.current;
    const first = measure(opts[0].id);
    const last = measure(opts[opts.length - 1].id);
    const w = sim.current.w;
    let x = d.baseX + dx;
    // За крайними режимами капсула идёт с сопротивлением — видно, что дальше некуда
    if (first && x < first.x) x = first.x - (first.x - x) * 0.3;
    if (last && x + w > last.x + last.w) x = last.x + last.w - w + (x + w - (last.x + last.w)) * 0.3;
    dragXRef.current = x;
    kick();
    const near = nearest(x, w);
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
    dragXRef.current = null;
    setDragging(false);
    setHover(null);
    hoverRef.current = null;
    kick();
    if (!d?.active) return;                            // не тянули — кнопка отработает сама
    suppressClick.current = true;
    window.setTimeout(() => { suppressClick.current = false; }, 400);
    if (target) pick(target);
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
    pick(next.id);
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
      className={`nav-glass nav-island relative flex items-center gap-1 p-1 select-none touch-pan-y ${
        pressed || dragging ? 'nav-island--held' : ''
      } ${className}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={e => { if (!drag.current || drag.current.id === e.pointerId) endDrag(true); }}
      onPointerCancel={() => endDrag(false)}
      onClickCapture={handleClickCapture}
      onKeyDown={handleKeyDown}
    >
      {/* Положение и размер пишет пружина напрямую в стиль — без перерисовки
          React на каждый кадр. CSS-переходы дорожки выключены: движение целиком
          её, иначе переход и пружина тянули бы капсулу каждый в свою сторону. */}
      <div
        ref={pillRef}
        aria-hidden
        data-testid="mode-switch-pill"
        className="nav-glass-track"
        style={{ left: 0, top: 0, opacity: 0, transition: 'opacity 0.2s ease' }}
      >
        <div className={`nav-glass-pill ${pressed || dragging ? 'nav-glass-pill--held' : moving ? 'nav-glass-pill--moving' : ''}`} />
      </div>

      {options.map(opt => {
        const selected = opt.id === value;
        const open = revealed === opt.id;
        return (
          <button
            key={opt.id}
            ref={el => { buttons.current[opt.id] = el; }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={opt.label}
            title={opt.label}
            tabIndex={selected ? 0 : -1}
            onClick={() => pick(opt.id)}
            // Ширину не задаём: кнопка растёт за раскрывающейся подписью.
            // min-w-10 равен высоте — в свёрнутом виде это ровный круг.
            style={{
              paddingLeft: open ? '1rem' : 0,
              paddingRight: open ? '1rem' : 0,
              transition: 'padding 0.42s ease-out, color 0.25s ease',
            }}
            className={`relative z-10 flex h-10 min-w-10 items-center justify-center rounded-full text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 ${
              lit(opt.id)
                ? 'text-indigo-600 dark:text-indigo-300'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <span className="flex shrink-0 items-center">{opt.icon}</span>
            <span
              className="overflow-hidden whitespace-nowrap transition-[max-width,opacity,margin] duration-[420ms] ease-out"
              style={{
                maxWidth: open ? '12rem' : 0,
                opacity: open ? 1 : 0,
                marginLeft: open ? '0.5rem' : 0,
              }}
            >
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default ModeSwitch;
