import React, { useId } from 'react';

/**
 * Иконки нижней панели — свой набор, как в нативных панелях вкладок.
 *
 * Раньше здесь стояли иконки Lucide разного размера (20 и 24) — рядом они
 * выглядели разнокалиберными, а активная вкладка отличалась только цветом.
 * Здесь всё нарисовано по одной сетке 24×24 и одной толщиной линии, и у каждой
 * иконки две формы: контурная — для неактивной вкладки, залитая — для
 * активной (так делают iOS и WhatsApp: выбранное видно по форме, а не только
 * по цвету). Обе формы одного габарита, поэтому при переключении ничего не
 * прыгает.
 *
 * Вырезы в залитых иконках (дверь, застёжка, точки) — маской, а не цветом
 * фона: под иконкой стеклянная капля, и цвет «дырки» заранее неизвестен.
 * У маски stroke="none": иначе её фигуры наследуют обводку иконки, и вместо
 * чистых вырезов выходят кольца с цветным ободком.
 */

export type NavIconName = 'home' | 'cash' | 'customers' | 'more';

const STROKE = 1.8;

interface NavIconProps {
  name: NavIconName;
  active?: boolean;
  size?: number;
}

const NavIcon: React.FC<NavIconProps> = ({ name, active = false, size = 24 }) => {
  // id масок уникален на каждый экземпляр: иконки одного вида стоят на странице не по разу
  const uid = useId().replace(/:/g, '');
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: STROKE,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    shapeRendering: 'geometricPrecision' as const,
    'aria-hidden': true,
  };

  switch (name) {
    case 'home': {
      // Дверь — вырез в самом контуре, поэтому залитый вариант получает её сам
      const house = 'M3.6 10.3 12 3.7l8.4 6.6v8.6a2 2 0 0 1-2 2H15v-5.1a1.1 1.1 0 0 0-1.1-1.1h-3.8A1.1 1.1 0 0 0 9 15.8v5.1H5.6a2 2 0 0 1-2-2z';
      return (
        <svg {...common}>
          <path d={house} fill={active ? 'currentColor' : 'none'} />
        </svg>
      );
    }

    case 'cash': {
      const body = 'M3.6 7.6A2.6 2.6 0 0 1 6.2 5h10.3a1.6 1.6 0 0 1 1.6 1.6v1.6h.3a2 2 0 0 1 2 2v8.2a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2z';
      const clasp = 'M15.4 12.2h5v4.2h-5a2.1 2.1 0 0 1 0-4.2z';
      if (!active) {
        return (
          <svg {...common}>
            <path d={body} />
            <path d="M3.9 8.2h14.2" />
            <path d={clasp} />
            <circle cx="17.4" cy="14.3" r="0.95" fill="currentColor" stroke="none" />
          </svg>
        );
      }
      return (
        <svg {...common}>
          <defs>
            <mask id={`cash-${uid}`} maskUnits="userSpaceOnUse" stroke="none">
              <rect width="24" height="24" fill="white" />
              {/* Застёжка остаётся видна: её край и кнопка вырезаны из заливки */}
              <path d={clasp} fill="none" stroke="black" strokeWidth="1.4" />
              <circle cx="17.4" cy="14.3" r="1.05" fill="black" />
              <path d="M3.9 8.2h14.2" stroke="black" strokeWidth="1.3" />
            </mask>
          </defs>
          <path d={body} fill="currentColor" mask={`url(#cash-${uid})`} />
        </svg>
      );
    }

    case 'customers': {
      // Передний человек целиком, задний выглядывает справа
      const frontHead = { cx: 9.2, cy: 8, r: 3.6 };
      const frontBody = 'M2.8 20c.4-3.6 3.1-6 6.4-6s6 2.4 6.4 6';
      const backHead = 'M15.4 4.6a3.5 3.5 0 0 1 0 6.8';
      const backBody = 'M17.6 14.3c2 .7 3.3 2.8 3.6 5.7';
      if (!active) {
        return (
          <svg {...common}>
            <circle {...frontHead} />
            <path d={frontBody} />
            <path d={backHead} />
            <path d={backBody} />
          </svg>
        );
      }
      const frontBodyFill = 'M2.6 19.4c.6-3.5 3.3-5.8 6.6-5.8s6 2.3 6.6 5.8a1 1 0 0 1-1 1.2H3.6a1 1 0 0 1-1-1.2z';
      return (
        <svg {...common} stroke="none">
          <defs>
            {/* Задний человек отделён от переднего зазором, как в системных иконках */}
            <mask id={`cust-${uid}`} maskUnits="userSpaceOnUse" stroke="none">
              <rect width="24" height="24" fill="white" />
              <circle {...frontHead} r={frontHead.r + 1.4} fill="black" />
              <path d={frontBodyFill} fill="black" stroke="black" strokeWidth="2.8" strokeLinejoin="round" />
            </mask>
          </defs>
          <g fill="currentColor" mask={`url(#cust-${uid})`}>
            <circle cx="15.6" cy="8" r="3.4" />
            <path d="M15.2 13.6c3.4 0 6 2.3 6.5 5.8a1 1 0 0 1-1 1.2h-5.5z" />
          </g>
          <circle {...frontHead} fill="currentColor" />
          <path d={frontBodyFill} fill="currentColor" />
        </svg>
      );
    }

    case 'more': {
      const dots = [7.6, 12, 16.4];
      if (!active) {
        return (
          <svg {...common}>
            <circle cx="12" cy="12" r="8.6" />
            {dots.map(x => <circle key={x} cx={x} cy="12" r="1.25" fill="currentColor" stroke="none" />)}
          </svg>
        );
      }
      return (
        <svg {...common}>
          <defs>
            <mask id={`more-${uid}`} maskUnits="userSpaceOnUse" stroke="none">
              <rect width="24" height="24" fill="white" />
              {dots.map(x => <circle key={x} cx={x} cy="12" r="1.5" fill="black" />)}
            </mask>
          </defs>
          {/* r = 8.6 + половина линии: тот же габарит, что у контурной */}
          <circle cx="12" cy="12" r={8.6 + STROKE / 2} fill="currentColor" stroke="none" mask={`url(#more-${uid})`} />
        </svg>
      );
    }
  }
};

export default NavIcon;
