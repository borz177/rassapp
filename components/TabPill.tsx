import React from 'react';

interface TabPillProps {
  /** Номер активной вкладки, с нуля */
  index: number;
  /** Сколько вкладок в ряду */
  count: number;
  /** Внутренний отступ контейнера в пикселях (p-1 = 4, p-1.5 = 6) */
  pad?: number;
}

/**
 * Стеклянная капсула под активной вкладкой — та же, что в нижней навигации и на
 * Главной. Переезжает пружиной при смене вкладки.
 *
 * Вкладки во всех рядах flex-1, то есть равной ширины, поэтому позицию считаем
 * в процентах, а не замерами: ширина капсулы — доля контейнера за вычетом его
 * отступов, а сдвиг кратен её собственной ширине. Замеры здесь ломались бы на
 * подгрузке шрифта, как это уже было в нижней навигации.
 *
 * Контейнер ряда должен быть position: relative и БЕЗ backdrop-filter: элемент
 * с ним становится «корнем подложки», и капсула перестала бы размывать страницу.
 */
const TabPill: React.FC<TabPillProps> = ({ index, count, pad = 4 }) => {
  if (count < 2) return null;
  return (
    <div
      aria-hidden
      className="nav-glass-track"
      style={{
        left: pad,
        top: pad,
        bottom: pad,
        width: `calc((100% - ${pad * 2}px) / ${count})`,
        transform: `translateX(${index * 100}%)`,
      }}
    >
      <div className="nav-glass-pill" />
    </div>
  );
};

export default TabPill;
