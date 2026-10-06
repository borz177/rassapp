import { haptics } from './haptics';

/**
 * Всплывающие уведомления — плашка сверху, как в нативных приложениях.
 *
 * Модальное окно на каждое «Сохранено» останавливало работу: пока не нажмёшь
 * «ОК», дальше не пойдёшь. Короткое сообщение показываем плашкой, которая сама
 * уходит через пару секунд и не мешает. Окно (src/dialogs.ts) остаётся для
 * длинных объяснений и вопросов, на которые нужно ответить.
 */
export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
  action?: { label: string; onClick: () => void };
  duration: number;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export const toastStore = {
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  list: () => items,
  dismiss(id: number) { items = items.filter(t => t.id !== id); emit(); },
};

const DURATION: Record<ToastTone, number> = { success: 2600, info: 3200, warning: 4200, error: 5200 };

const show = (tone: ToastTone, title: string, opts: { message?: string; action?: ToastItem['action']; duration?: number } = {}) => {
  const text = title.trim();
  if (!text) return;
  // Одно и то же подряд (двойное нажатие) — не плодим копии, а продлеваем
  const same = items.find(t => t.title === text && t.message === opts.message);
  if (same) { toastStore.dismiss(same.id); }
  const item: ToastItem = { id: nextId++, tone, title: text, duration: opts.duration ?? DURATION[tone], ...opts };
  // Больше трёх сразу не читается — старые уходят
  items = [...items, item].slice(-3);
  emit();
  if (tone === 'success') haptics.success();
  else if (tone === 'error') haptics.error();
  else if (tone === 'warning') haptics.warning();
  return item.id;
};

export const toast = {
  success: (title: string, opts?: Parameters<typeof show>[2]) => show('success', title, opts),
  error: (title: string, opts?: Parameters<typeof show>[2]) => show('error', title, opts),
  warning: (title: string, opts?: Parameters<typeof show>[2]) => show('warning', title, opts),
  info: (title: string, opts?: Parameters<typeof show>[2]) => show('info', title, opts),
};

/**
 * Разбирает текст старого alert: тон по значку и словам, значок убирает.
 * Длинное объяснение (несколько абзацев) плашкой не показать — вернёт null,
 * и сообщение уйдёт окном.
 */
export const classifyAlert = (raw: string): { tone: ToastTone; title: string; message?: string } | null => {
  let text = raw.trim();
  let tone: ToastTone | null = null;
  const lead = /^(✅|✔️|✓|❌|⛔|🚫|⚠️|⚠|ℹ️|📵|📴|🔒|💾|📋|📤|📨|🎉)\s*/u.exec(text);
  if (lead) {
    const m = lead[1];
    tone = /✅|✔|✓|🎉|💾|📋|📤|📨/u.test(m) ? 'success'
      : /❌|⛔|🚫/u.test(m) ? 'error'
      : /⚠|🔒|📵|📴/u.test(m) ? 'warning' : 'info';
    text = text.slice(lead[0].length).trim();
  }
  if (!tone) {
    tone = /^(ошибка|не удалось|не получилось|сбой|нет связи|нет соединения)/i.test(text) ? 'error'
      : /^(выберите|укажите|заполните|введите|добавьте|сначала|нельзя|недостаточно|превышен|лимит)/i.test(text) ? 'warning'
      : /(сохранен|скопирован|отправлен|удален|добавлен|обновлен|готово|успешно|принят)/i.test(text) ? 'success'
      : 'info';
  }
  // Первая строка — заголовок, остальное — пояснение мелким текстом
  const [first, ...rest] = text.split('\n');
  const message = rest.join('\n').trim() || undefined;
  const long = text.length > 220 || (message?.split('\n').length || 0) > 3 || /\n\s*\n/.test(text) && text.length > 140;
  if (long) return null;
  return { tone, title: first.trim(), message };
};
