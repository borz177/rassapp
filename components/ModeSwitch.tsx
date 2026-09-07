import React, { useEffect, useRef, useState } from 'react';

export interface ModeSwitchOption<T extends string> {
  id: T;
  label: string;
  icon: React.ReactNode;
}

interface ModeSwitchProps<T extends string> {
  options: ModeSwitchOption<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Сколько держать подпись после нажатия, мс */
  revealMs?: number;
  className?: string;
}

/**
 * Переключатель разделов значками: подпись показывается только что нажатой
 * вкладке и через секунду с небольшим уходит.
 *
 * Название нужно ровно в момент выбора — подтвердить, куда попал. Дальше оно
 * занимает строку ради слова, которое человек только что прочитал сам, поэтому
 * ряд возвращается к значкам. Какая вкладка открыта, видно по стеклу и цвету, а
 * на десктопе название всегда доступно всплывающей подсказкой.
 *
 * Ширина едет через flex-grow, а не через width: у кнопок нет фиксированного
 * размера, и любые замеры разъехались бы на подгрузке шрифта — так уже
 * случалось со стеклянной капсулой в нижней навигации. Подпись при этом
 * съезжает по max-width, чтобы текст не перескакивал строку в момент сжатия.
 */
function ModeSwitch<T extends string>({
  options, value, onChange, revealMs = 1600, className = '',
}: ModeSwitchProps<T>) {
  const [revealed, setRevealed] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Таймер снимаем и при уходе со страницы, и при повторном нажатии: иначе
  // прежний отсчёт погасил бы подпись раньше времени.
  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => clear, []);

  const pick = (id: T) => {
    onChange(id);
    setRevealed(id);
    clear();
    timer.current = setTimeout(() => setRevealed(null), revealMs);
  };

  return (
    // Общей рамки вокруг двух кружков нет: она обводила пустоту между ними и
    // читалась как недорисованная карточка. Каждая кнопка — самостоятельная
    // поверхность, а выбранную отмечает то же стекло, что и везде.
    <div className={`flex items-center gap-2 ${className}`}>
      {options.map(opt => {
        const active = opt.id === value;
        const open = revealed === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => pick(opt.id)}
            aria-pressed={active}
            aria-label={opt.label}
            title={opt.label}
            style={{
              // Ширину не задаём вовсе: кнопка растёт за своим содержимым, а
              // плавность даёт раскрывающаяся подпись. Раньше здесь стояло
              // flex-basis: 0 с ростом — в ряду по ширине содержимого такой
              // кнопке доставалось меньше, чем нужно тексту, и он обрезался.
              paddingLeft: open ? '1.05rem' : 0,
              paddingRight: open ? '1.05rem' : 0,
              transition: 'padding 0.42s ease-out, color 0.25s ease',
            }}
            // rounded-full, а не своё скругление: стеклянная подложка внутри
            // скруглена полностью, и при 20px её углы срезались краем кнопки —
            // с этого капсула и «барахлила».
            // Без gap: он остаётся и при пустой подписи, и значок съезжал бы с
            // центра кружка. Отступ живёт на самой подписи и появляется вместе
            // с ней. min-w-11 равен высоте — в свёрнутом виде это ровный круг.
            className={`relative shrink-0 overflow-hidden flex items-center justify-center min-w-11 h-11 rounded-full border text-sm font-bold ${
              active
                ? 'text-indigo-600 dark:text-indigo-300 border-white/70 dark:border-slate-700'
                : 'text-slate-500 dark:text-slate-400 bg-white/60 dark:bg-slate-800/60 border-white/70 dark:border-slate-700 shadow-sm active:scale-95'
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
