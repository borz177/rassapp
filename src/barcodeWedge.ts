import { useEffect, useRef } from 'react';

/**
 * Ручной сканер штрихкодов (USB или Bluetooth).
 *
 * Такой сканер притворяется клавиатурой: «печатает» код и жмёт Enter. Отличить
 * его от человека можно только по скорости — между символами у сканера единицы
 * миллисекунд, у самого быстрого наборщика под сотню. Поэтому ловим именно
 * быстрый набор, закончившийся Enter, а всё медленнее считаем обычным вводом.
 *
 * Слушаем всё окно, а не поле поиска: кассир не обязан сперва ставить курсор
 * куда-то — он берёт товар и сканирует. Если курсор всё же стоял в поле, код
 * успевает туда напечататься; его убираем, иначе после скана в поиске висели бы
 * цифры и список сузился до пустого.
 */

export interface WedgeParserOptions {
  /** Самая большая пауза между символами внутри одного скана, мс */
  maxGap?: number;
  /** Средняя пауза по всему коду, мс — быстрый наборщик может выдать пару быстрых нажатий, но не десять подряд */
  maxAvgGap?: number;
  /** Короче не бывает штрихкодов, а случайно столько быстрых нажатий не набрать */
  minLength?: number;
}

export interface WedgeStep {
  /** С этого символа начался новый возможный скан */
  started?: boolean;
  /** Скан завершён — вот код */
  code?: string;
}

export const createWedgeParser = ({ maxGap = 50, maxAvgGap = 30, minLength = 5 }: WedgeParserOptions = {}) => {
  let buffer = '';
  let first = 0;
  let last = 0;
  const reset = () => { buffer = ''; };

  return {
    reset,
    push(key: string, time: number): WedgeStep | null {
      if (key.length === 1) {
        const started = !buffer || time - last > maxGap;
        if (started) { buffer = ''; first = time; }
        buffer += key;
        last = time;
        return started ? { started: true } : null;
      }
      if (key === 'Enter' || key === 'Tab') {
        const code = buffer;
        reset();
        // Enter часть сканеров отправляет с задержкой — ей даём запас побольше,
        // чем паузам между цифрами.
        const fast = code.length >= minLength
          && time - last <= maxGap * 4
          && (last - first) / Math.max(1, code.length - 1) <= maxAvgGap;
        return fast ? { code } : null;
      }
      // Заглавные буквы сканер набирает через Shift — это не конец скана.
      if (key === 'Shift' || key === 'CapsLock') return null;
      reset();
      return null;
    },
  };
};

type ScanHandler = (code: string) => void;

// Стек, а не список: сканирует всегда тот экран, что сверху. Открытый поверх
// каталога выбор товара должен получить код сам, а не отдать его каталогу под собой.
const handlers: { current: ScanHandler }[] = [];
let installed = false;

const isTextField = (el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement =>
  el instanceof HTMLTextAreaElement
  || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'file', 'range', 'color'].includes(el.type));

/**
 * Значение поля «как будто его ввёл человек». Прямое присваивание value React
 * не заметит — состояние поиска так и осталось бы с цифрами скана.
 */
const setFieldValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

const install = () => {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const parser = createWedgeParser();
  let field: HTMLInputElement | HTMLTextAreaElement | null = null;
  let before = '';

  window.addEventListener('keydown', event => {
    if (handlers.length === 0 || event.isComposing) return;
    if (event.ctrlKey || event.metaKey || event.altKey) { parser.reset(); return; }

    const step = parser.push(event.key, event.timeStamp);
    if (step?.started) {
      // Запоминаем поле до первого символа: если это скан, вернём его как было.
      if (isTextField(event.target)) { field = event.target; before = event.target.value; }
      else field = null;
    }
    if (step?.code) {
      event.preventDefault();
      event.stopPropagation();
      if (field?.isConnected) setFieldValue(field, before);
      field = null;
      handlers[handlers.length - 1]?.current(step.code);
    }
  }, true);
};

/**
 * Принимать коды с ручного сканера, пока экран открыт.
 * @param enabled выключить, не размонтируя экран — например, пока открыта форма поверх
 */
export const useBarcodeScanInput = (handler: ScanHandler, enabled = true): void => {
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!enabled) return;
    install();
    const entry = { current: (code: string) => latest.current(code) };
    handlers.push(entry);
    return () => {
      const i = handlers.indexOf(entry);
      if (i >= 0) handlers.splice(i, 1);
    };
  }, [enabled]);
};
