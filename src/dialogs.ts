/**
 * Окна подтверждения и сообщения — в стиле приложения вместо системных
 * window.confirm / window.alert.
 *
 * Системные окна выглядели чужими (серая плашка браузера с адресом сайта
 * в заголовке), а в приложении на iPhone — как отладочное окно WebView. Эти
 * рисует components/AppDialogs.tsx, смонтированный один раз в index.tsx.
 *
 * appConfirm возвращает Promise<boolean>: системный confirm останавливал код
 * до ответа, поэтому места вызова переписаны на await. window.alert заменён
 * целиком (installAlertOverride): сообщение ничего не возвращает, и код после
 * него может идти дальше сразу — кроме случаев, где следом перезагрузка или
 * переход: там ждут закрытия (await appAlert).
 */

import { classifyAlert, toast } from './toast';

export interface DialogOptions {
  title?: string;
  message?: string;
  /** Текст кнопки действия. По умолчанию «ОК» */
  confirmLabel?: string;
  /** Текст кнопки отмены (только у подтверждения). По умолчанию «Отмена» */
  cancelLabel?: string;
  /** Опасное действие — кнопка красная (удалить, сбросить) */
  destructive?: boolean;
}

export interface DialogItem extends DialogOptions {
  id: number;
  kind: 'confirm' | 'alert';
  resolve: (ok: boolean) => void;
}

let queue: DialogItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export const dialogStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  /** Окно, которое видно сейчас (очередь — по одному) */
  current: (): DialogItem | undefined => queue[0],
  resolve(id: number, ok: boolean) {
    const item = queue.find(d => d.id === id);
    if (!item) return;
    queue = queue.filter(d => d.id !== id);
    emit();
    item.resolve(ok);
  },
};

const normalize = (input: string | DialogOptions): DialogOptions =>
  typeof input === 'string' ? { message: input } : input;

// Опасное действие узнаём по словам — чтобы кнопка была красной и называлась
// самим действием, а не безликим «ОК», без правки каждого места вызова.
const DESTRUCTIVE_LABELS: [RegExp, string][] = [
  [/удал|стереть/i, 'Удалить'],
  [/сброс/i, 'Сбросить'],
  [/отозв/i, 'Отозвать'],
  [/аннулир/i, 'Аннулировать'],
  [/отмен(ить|ит|а) (операц|платеж|платёж|приход|расход|договор|чек)/i, 'Отменить'],
];
const destructiveLabel = (text: string) => DESTRUCTIVE_LABELS.find(([re]) => re.test(text))?.[1];

export function appConfirm(input: string | DialogOptions): Promise<boolean> {
  const opts = normalize(input);
  const text = `${opts.title || ''} ${opts.message || ''}`;
  const label = destructiveLabel(text);
  const destructive = opts.destructive ?? !!label;
  return new Promise(resolve => {
    queue = [...queue, {
      id: nextId++,
      kind: 'confirm',
      confirmLabel: (destructive && label) || 'ОК',
      cancelLabel: 'Отмена',
      ...opts,
      destructive,
      resolve,
    }];
    emit();
  });
}

export function appAlert(input: string | DialogOptions): Promise<void> {
  const opts = normalize(input);
  return new Promise(resolve => {
    queue = [...queue, { id: nextId++, kind: 'alert', confirmLabel: 'ОК', ...opts, resolve: () => resolve() }];
    emit();
  });
}

/**
 * Заменить window.alert на окно приложения. Вызывается один раз до отрисовки.
 * Пустые и повторяющиеся подряд сообщения не плодят очередь окон.
 */
export function installAlertOverride() {
  if (typeof window === 'undefined') return;
  window.alert = (message?: unknown) => {
    const text = String(message ?? '').trim();
    if (!text) return;
    // Короткое сообщение — плашкой сверху, работа не останавливается.
    // Длинное объяснение — окном: его надо прочитать, а не поймать взглядом.
    const asToast = classifyAlert(text);
    if (asToast) {
      const { tone, title, message: sub } = asToast;
      toast[tone](title, { message: sub });
      return;
    }
    const last = queue[queue.length - 1];
    if (last?.kind === 'alert' && last.message === text) return;
    void appAlert(text);
  };
}
