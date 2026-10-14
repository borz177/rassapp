/**
 * Платёж за тариф, ушедший в ЮKassa и ещё не разобранный приложением.
 *
 * Вернуться из оплаты можно не только кнопкой «Вернуться в магазин» (она ведёт
 * на ?payment=success): человек закрывает вкладку ЮKassa или просто
 * переключается обратно из приложения банка после СБП. Тогда страница остаётся
 * как была — окно оплаты висело в «Переходе к оплате…», а прошла ли оплата,
 * никто не проверял. Номер платежа запоминаем перед уходом и при возвращении
 * спрашиваем его статус (App.tsx, resolvePendingPayment).
 */

const KEY = 'finuchet_pending_payment';
// Неоплаченный платёж ЮKassa отменяет примерно через час — дольше ждать нечего
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

/** Событие для окна оплаты: чем закончился платёж (detail — статус ЮKassa) */
export const PAYMENT_RESOLVED_EVENT = 'finuchet:payment-resolved';

export const rememberPendingPayment = (id: string) => {
  try { localStorage.setItem(KEY, JSON.stringify({ id, at: Date.now() })); } catch { /* приватный режим */ }
};

export const getPendingPayment = (): string | null => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { id, at } = JSON.parse(raw);
    if (!id || Date.now() - at > MAX_AGE_MS) { localStorage.removeItem(KEY); return null; }
    return id;
  } catch { return null; }
};

export const clearPendingPayment = () => {
  try { localStorage.removeItem(KEY); } catch { /* приватный режим */ }
};
