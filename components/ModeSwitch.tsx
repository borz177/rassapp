import React from 'react';

export interface ModeSwitchOption<T extends string> {
  id: T;
  label: string;
  icon: React.ReactNode;
}

interface ModeSwitchProps<T extends string> {
  options: ModeSwitchOption<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}

/**
 * Переключатель разделов, где раскрыта только выбранная кнопка.
 *
 * Две вкладки во всю ширину занимали строку ради слова, которое и так известно:
 * человек только что сам его выбрал. Здесь выбранная кнопка раскрыта с
 * названием, остальные свёрнуты до значка — ряд занимает вдвое меньше места, а
 * что открыто, видно по подписи, а не по оттенку.
 *
 * Ширина едет через flex-grow, а не через width: у кнопок нет фиксированного
 * размера, и любые замеры разъехались бы на подгрузке шрифта — так уже
 * случалось со стеклянной капсулой в нижней навигации. Подпись при этом
 * съезжает по max-width, чтобы текст не перескакивал строку в момент сжатия.
 */
function ModeSwitch<T extends string>({ options, value, onChange, className = '' }: ModeSwitchProps<T>) {
  return (
    <div className={`flex gap-1.5 p-1 rounded-[24px] bg-white/60 dark:bg-slate-800/60 border border-white/70 dark:border-slate-700 shadow-sm ${className}`}>
      {options.map(opt => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            aria-pressed={active}
            aria-label={opt.label}
            title={opt.label}
            style={{
              flexGrow: active ? 1 : 0,
              flexBasis: active ? 0 : '3rem',
              transition: 'flex-grow 0.46s cubic-bezier(0.34, 1.32, 0.52, 1), flex-basis 0.46s cubic-bezier(0.34, 1.32, 0.52, 1), color 0.25s ease',
            }}
            className={`relative shrink-0 overflow-hidden flex items-center justify-center gap-2 h-11 rounded-[20px] text-sm font-bold ${
              active ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400 active:scale-95'
            }`}
          >
            {/* Стекло — тот же слой, что под активной вкладкой в остальных
                рядах, только живёт внутри кнопки: у неё своя ширина, и общей
                переезжающей капсулой её не описать. */}
            {active && <span className="nav-glass-pill" aria-hidden />}
            <span className="relative z-10 shrink-0 flex items-center">{opt.icon}</span>
            <span
              className="relative z-10 whitespace-nowrap overflow-hidden transition-[max-width,opacity,margin] duration-[420ms] ease-out"
              style={{
                maxWidth: active ? '10rem' : 0,
                opacity: active ? 1 : 0,
                marginRight: active ? undefined : '-0.5rem',
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
