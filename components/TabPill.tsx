import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGlassDrop } from './useGlassDrop';

interface TabPillProps {
  /** Номер активной вкладки, с нуля */
  index: number;
  /** Сколько вкладок в ряду */
  count: number;
  /** Внутренний отступ контейнера в пикселях (p-1 = 4, p-1.5 = 6) */
  pad?: number;
}

/**
 * Стеклянная капсула под активной вкладкой — та же капля, что в нижней
 * навигации: под пальцем раздувается в линзу, при смене вкладки едет,
 * вытягиваясь по ходу, и плавно оседает (useGlassDrop).
 *
 * Вкладки во всех рядах flex-1, то есть равной ширины, поэтому позицию считаем
 * в процентах, а не замерами: ширина капсулы — доля контейнера за вычетом его
 * отступов, а сдвиг кратен её собственной ширине. Замеры здесь ломались бы на
 * подгрузке шрифта, как это уже было в нижней навигации.
 *
 * Нажатие слушаем на самом ряду (родитель капсулы): вкладки рисует вызвавший,
 * и так поведение получают все ряды разом, без правок в каждом.
 *
 * Контейнер ряда должен быть position: relative и БЕЗ backdrop-filter: элемент
 * с ним становится «корнем подложки», и капсула перестала бы размывать страницу.
 */
const TabPill: React.FC<TabPillProps> = ({ index, count, pad = 4 }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef(index);
  indexRef.current = index;
  const [held, setHeld] = useState(false);
  const drop = useGlassDrop(held, index);

  // Капсула под широкой вкладкой в разы шире капли нижней панели: раздувать её
  // в те же 1,3 раза значит вылезти за весь ряд. Прибавку держим в пикселях —
  // как у маленькой капли — и пересчитываем в масштаб по реальной ширине.
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const update = () => setWidth(el.offsetWidth);
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [count]);
  const dropVars = width > 0 ? {
    '--sx': (1 + Math.min(0.3, 18 / width)).toFixed(3),
    '--tx': (1 + Math.min(0.42, 30 / width)).toFixed(3),
    '--sy': '1.32',
    '--ty': '1.18',
  } as React.CSSProperties : undefined;

  useEffect(() => {
    const row = trackRef.current?.parentElement;
    if (!row || count < 2) return;
    // Раздувается только под пальцем на активной вкладке. Нажатие на другую
    // сменит вкладку — и капля поедет к ней сама.
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const r = row.getBoundingClientRect();
      const w = (r.width - pad * 2) / count;
      if (Math.floor((e.clientX - r.left - pad) / w) === indexRef.current) setHeld(true);
    };
    // Отпускают нередко уже за пределами ряда, а прокрутка страницы
    // приходит как pointercancel — слушаем окно.
    const up = () => setHeld(false);
    row.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      row.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [count, pad]);

  if (count < 2) return null;
  return (
    <div
      ref={trackRef}
      aria-hidden
      className={`nav-glass-track ${drop.trackClass}`}
      style={{
        left: pad,
        top: pad,
        bottom: pad,
        width: `calc((100% - ${pad * 2}px) / ${count})`,
        transform: `translateX(${index * 100}%)`,
      }}
    >
      <div className={`nav-glass-pill ${drop.pillClass}`} style={{ ...dropVars, ...drop.pillStyle }} />
    </div>
  );
};

export default TabPill;
