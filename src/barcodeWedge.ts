import { useEffect, useRef } from 'react';
import { extractProductCode } from './barcode';
import { scanBeep } from './scanFeedback';

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
  /** Через столько тишины считаем, что сканер без Enter уже всё «напечатал», мс */
  idleGap?: number;
  /** Средняя пауза для скана без Enter — строже: подтверждения нет, ошибиться нельзя */
  idleAvgGap?: number;
  /** Средняя пауза для длинного цифрового кода с Enter — медленные Bluetooth-сканеры */
  slowAvgGap?: number;
}

export interface WedgeStep {
  /** С этого символа начался новый возможный скан */
  started?: boolean;
  /** Скан завершён — вот код */
  code?: string;
}

export const createWedgeParser = ({
  // Пороги рассчитаны на медленный конец линейки: дешёвый USB-сканер в «тихом»
  // режиме и Bluetooth с низкой скоростью передачи выдают до 60-80 мс на символ,
  // а человек и на пике держит 100+ мс и не удерживает темп всю строку.
  maxGap = 90, maxAvgGap = 45, minLength = 5, idleGap = 120, idleAvgGap = 30, slowAvgGap = 75,
}: WedgeParserOptions = {}) => {
  let buffer = '';
  let first = 0;
  let last = 0;
  const reset = () => { buffer = ''; };

  const avgGap = (code: string) => (last - first) / Math.max(1, code.length - 1);

  /** Похоже ли набранное на скан: длина и темп. */
  const looksScanned = (code: string, avgLimit: number) =>
    code.length >= minLength && avgGap(code) <= avgLimit;

  return {
    reset,
    /** Сколько ждать тишины, чтобы закрыть скан без Enter */
    idleGap,
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
        // Медленный Bluetooth-сканер выдаёт до 70 мс на символ. Такому темпу
        // верим только на длинном цифровом коде: короткое число человек за это
        // время наберёт сам, а тринадцать цифр подряд и с Enter — уже сканер.
        const slowButLong = avgGap(code) <= slowAvgGap && code.length >= 8 && /^\d+$/.test(code);
        const fast = code.length >= minLength
          && time - last <= maxGap * 4
          && (avgGap(code) <= maxAvgGap || slowButLong);
        return fast ? { code } : null;
      }
      // Заглавные буквы сканер набирает через Shift — это не конец скана.
      if (key === 'Shift' || key === 'CapsLock') return null;
      reset();
      return null;
    },
    /**
     * Скан без завершающего Enter. Половина сканеров приезжает с завода без
     * суффикса, и такой код иначе просто оставался бы в буфере: символы пришли,
     * а закрыть их нечем. Закрываем тишиной — но темп требуем строже, чем с
     * Enter: подтверждения от сканера здесь нет.
     */
    flush(time: number): WedgeStep | null {
      const code = buffer;
      if (!code || time - last < idleGap) return null;
      reset();
      return looksScanned(code, idleAvgGap) ? { code } : null;
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
  let idleTimer = 0;

  const stopIdle = () => { if (idleTimer) { window.clearTimeout(idleTimer); idleTimer = 0; } };

  /** Вернуть поле в то состояние, в котором его застал сканер. */
  const restoreField = () => {
    if (field?.isConnected) setFieldValue(field, before);
    field = null;
  };

  // Ручной сканер тоже читает QR со ссылкой и «Честный знак» — в экран уходит
  // только код товара, ссылка отбивается сигналом ошибки.
  const productCode = (code: string): string | null => {
    const extracted = extractProductCode(code);
    return 'error' in extracted ? null : extracted.code;
  };

  window.addEventListener('keydown', event => {
    if (handlers.length === 0 || event.isComposing) return;
    if (event.ctrlKey || event.metaKey || event.altKey) { stopIdle(); parser.reset(); return; }
    // Зажатая клавиша выдаёт такой же ровный поток символов, что и сканер.
    // Автоповтор сканом не считаем — иначе удержанная «1» открывала бы товар.
    if (event.repeat) { stopIdle(); parser.reset(); return; }

    stopIdle();
    const step = parser.push(event.key, event.timeStamp);
    if (step?.started) {
      // Запоминаем поле до первого символа: если это скан, вернём его как было.
      if (isTextField(event.target)) { field = event.target; before = event.target.value; }
      else field = null;
    }
    if (step?.code) {
      event.preventDefault();
      event.stopPropagation();
      restoreField();
      const code = productCode(step.code);
      if (!code) { scanBeep('error'); return; }
      handlers[handlers.length - 1]?.current(code);
      return;
    }
    // Сканер без суффикса ничего больше не пришлёт — закрываем скан тишиной.
    if (parser.idleGap > 0) {
      idleTimer = window.setTimeout(() => {
        idleTimer = 0;
        const done = parser.flush(performance.now());
        if (!done?.code) return;
        // Здесь Enter не подтверждал скан, поэтому чужой текст не трогаем:
        // поле чистим и код отдаём экрану только если это действительно код.
        const code = productCode(done.code);
        if (!code) { field = null; return; }
        restoreField();
        handlers[handlers.length - 1]?.current(code);
      }, parser.idleGap + 10);
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
