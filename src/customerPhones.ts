import type { Customer, CustomerPhone } from '../types';

/** Сколько номеров у клиента всего: основной + дополнительные */
export const MAX_CUSTOMER_PHONES = 3;
export const MAX_EXTRA_PHONES = MAX_CUSTOMER_PHONES - 1;

/** Кто это — быстрые подписи к дополнительному номеру */
export const PHONE_LABELS = ['Жена / муж', 'Родственник', 'Родители', 'Друг', 'Работа', 'Поручитель'] as const;

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
/** Один и тот же номер, как бы его ни записали: 8 900…, +7 900…, 900… */
const sameNumber = (a: unknown, b: unknown) => {
  const x = digits(a), y = digits(b);
  return x.length >= 10 && y.length >= 10 ? x.slice(-10) === y.slice(-10) : x !== '' && x === y;
};

/**
 * Дополнительные номера перед сохранением: без пустых, без повторов основного
 * номера и друг друга, не больше MAX_EXTRA_PHONES.
 */
export const cleanExtraPhones = (list: CustomerPhone[] | undefined, mainPhone: string): CustomerPhone[] | undefined => {
  const out: CustomerPhone[] = [];
  for (const item of list || []) {
    const phone = String(item?.phone ?? '').trim().slice(0, 30);
    if (!phone || sameNumber(phone, mainPhone) || out.some(o => sameNumber(o.phone, phone))) continue;
    const label = String(item?.label ?? '').trim().slice(0, 30);
    out.push(label ? { phone, label } : { phone });
    if (out.length >= MAX_EXTRA_PHONES) break;
  }
  return out.length ? out : undefined;
};

/** Все номера клиента: основной первым */
export const allPhones = (c: Pick<Customer, 'phone' | 'extraPhones'> | undefined | null): CustomerPhone[] =>
  !c ? [] : [{ phone: c.phone, label: undefined }, ...(c.extraPhones || [])].filter(p => String(p.phone || '').trim());

/** Цифры всех номеров — для поиска «по любому номеру клиента» */
export const phoneDigitsOf = (c: Pick<Customer, 'phone' | 'extraPhones'>): string[] =>
  allPhones(c).map(p => digits(p.phone)).filter(Boolean);
