/**
 * Понятные ошибки вместо технических.
 *
 * При плохой связи человек видел «TIMEOUT: Request to https://… took more than
 * 8000ms», «Failed to fetch» или «Load failed» — текст для разработчика, из
 * которого непонятно ни что случилось, ни что делать. Здесь всё это
 * переводится на человеческий язык: что произошло и как быть.
 */

export const NO_CONNECTION_TEXT = 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';
export const SLOW_CONNECTION_TEXT = 'Сервер не ответил вовремя — похоже, слабый интернет. Попробуйте ещё раз.';
export const SESSION_TEXT = 'Сессия истекла — войдите в аккаунт заново.';
export const SERVER_TEXT = 'Сервер временно недоступен. Попробуйте через минуту.';

const SLOW_RE = /TIMEOUT|timed? ?out|took more than|AbortError|TimeoutError/i;
const NETWORK_RE = /Failed to fetch|NetworkError|Load failed|Network request failed|network connection was lost|ERR_INTERNET|ERR_NETWORK|ERR_CONNECTION|Captive Portal|internet connection appears to be offline/i;
const SERVER_RE = /^HTTP 5\d\d|\b50[0-4]\b|Bad Gateway|Service Unavailable|Internal Server Error/i;
const CYRILLIC = /[А-Яа-яЁё]/;

/** Текст одной ошибки для человека; fallback — что сказать, если причина не ясна */
export const friendlyError = (error: unknown, fallback = 'Что-то пошло не так. Попробуйте ещё раз.'): string => {
  const e = error as { message?: string; name?: string; code?: string } | null | undefined;
  const msg = String(e?.message ?? (typeof error === 'string' ? error : '')).trim();
  if (e?.code === 'TIMEOUT' || e?.name === 'TimeoutError' || e?.name === 'AbortError' || SLOW_RE.test(msg)) {
    return typeof navigator !== 'undefined' && navigator.onLine === false ? NO_CONNECTION_TEXT : SLOW_CONNECTION_TEXT;
  }
  if ((typeof navigator !== 'undefined' && navigator.onLine === false) || NETWORK_RE.test(msg)) return NO_CONNECTION_TEXT;
  if (msg === 'TOKEN_EXPIRED') return SESSION_TEXT;
  if (SERVER_RE.test(msg)) return SERVER_TEXT;
  // Русский текст — это уже объяснение для человека (обычно его прислал сервер)
  if (msg && CYRILLIC.test(msg)) return msg;
  return fallback;
};

/**
 * Очищает готовое сообщение (то, что ушло в alert/плашку): технические строки
 * заменяются понятными, английские служебные — убираются. Русский текст
 * остаётся как есть.
 */
export const humanizeText = (text: string): string => {
  const out: string[] = [];
  const push = (line: string) => { if (!out.includes(line)) out.push(line); };
  for (const raw of text.split('\n')) {
    // Хвост после двоеточия вида «Не удалось сохранить: Failed to fetch»
    const m = /^(.*?[А-Яа-яЁё].*?):\s*(.+)$/.exec(raw);
    // Английская фраза-ошибка после двоеточия: «Failed to save sales», а не адрес или код
    const englishPhrase = (t: string) => /[A-Za-z]{3,}\s+[A-Za-z]{2,}/.test(t) && !/https?:\/\//.test(t);
    if (m && !CYRILLIC.test(m[2]) && (SLOW_RE.test(m[2]) || NETWORK_RE.test(m[2]) || SERVER_RE.test(m[2]) || m[2].trim() === 'TOKEN_EXPIRED' || englishPhrase(m[2]))) {
      const why = friendlyError({ message: m[2] }, '');
      const head = m[1].trim();
      // Голое «Ошибка» перед причиной ничего не добавляет — оставляем только причину
      if (/^(❌\s*)?Ошибка$/i.test(head)) push(why ? `❌ ${why}` : `${head}.`);
      else { push(head.replace(/[.:]$/, '') + '.'); if (why) push(why); }
      continue;
    }
    const line = raw.trim();
    if (!line) { out.push(''); continue; }
    if (CYRILLIC.test(line) && !SLOW_RE.test(line) && !NETWORK_RE.test(line)) { out.push(raw); continue; }
    const why = friendlyError({ message: line }, '');
    // Английская служебная строка без понятной причины («Failed to save sales») — убираем
    if (why) push(why);
    else if (/[А-Яа-яЁё0-9₽]/.test(line) || line.length < 3) out.push(raw);
  }
  const result = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return result || 'Что-то пошло не так. Попробуйте ещё раз.';
};
