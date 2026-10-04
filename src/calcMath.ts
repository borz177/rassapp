import type { DownDiscount, TermRate } from '../types';

/**
 * Расчёт рассрочки — один для калькулятора менеджера и публичной страницы
 * клиента: клиент должен увидеть ровно ту сумму, которую посчитал продавец.
 *
 * Наценка начисляется:
 *  • markupOnRemainder — только на то, что уходит в рассрочку (цена − взнос):
 *    чем больше взнос, тем меньше наценка;
 *  • иначе — на всю цену, взнос лишь уменьшает остаток к выплате.
 *
 * Округление платежа (шаг и направление) — настройка продавца. Вниз — не ниже
 * одного шага, чтобы на маленьких суммах платёж не стал нулём.
 */
export interface CalcInput {
  price: number;
  down: number;
  months: number;
  /** Ставка за весь срок, % */
  rate: number;
  roundStep?: number;
  roundDir?: 'up' | 'down';
  markupOnRemainder?: boolean;
}

export interface CalcResult {
  markup: number;
  /** Цена + наценка */
  total: number;
  monthly: number;
  /** Платежи × срок + взнос — с учётом округления */
  totalPayable: number;
  /** То же без округления */
  exactTotal: number;
  down: number;
}

export const calcInstallment = (i: CalcInput): CalcResult => {
  const p = Math.max(0, i.price || 0);
  const dp = Math.min(Math.max(0, i.down || 0), p);
  const months = Math.max(0, Math.floor(i.months || 0));
  const rate = (i.rate || 0) / 100;
  const base = i.markupOnRemainder ? p - dp : p;
  const markup = base * rate;
  const remaining = i.markupOnRemainder ? (p - dp) + markup : (p + markup) - dp;
  const monthly = months > 0 ? remaining / months : 0;
  const step = i.roundStep || 0;
  const rounded = step > 0
    ? (i.roundDir === 'down'
        ? Math.max(Math.floor(monthly / step) * step, monthly > 0 ? step : 0)
        : Math.ceil(monthly / step) * step)
    : monthly;
  return {
    markup,
    total: p + markup,
    monthly: rounded,
    totalPayable: rounded * months + dp,
    exactTotal: monthly * months + dp,
    down: dp,
  };
};

/** Ставка для срока: своя для срока, иначе ставка категории, иначе базовая */
export const rateFor = (months: number, rates: TermRate[] | undefined, fallback: number): number =>
  rates?.find(r => r.months === months)?.rate ?? fallback;

/** Даты платежей: первый — через месяц от начала, день месяца сохраняется (31 → 28/30) */
export const scheduleDates = (start: Date, months: number): Date[] => {
  const baseDay = start.getDate();
  return Array.from({ length: Math.max(0, months) }, (_, k) => {
    const d = new Date(start);
    d.setDate(1);
    d.setMonth(d.getMonth() + k + 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(baseDay, last));
    return d;
  });
};

/**
 * Взнос снижает наценку: из правил «от N% взноса — ставка меньше на M%»
 * действует то, где взнос уже набран и порог самый высокий. Ставка не уходит
 * ниже нуля. next — ближайшее следующее правило: подсказать клиенту, сколько
 * добавить к взносу, чтобы наценка стала ещё ниже.
 */
export const applyDownDiscount = (
  rate: number, price: number, down: number, rules: DownDiscount[] | undefined,
): { rate: number; minus: number; rule?: DownDiscount; next?: DownDiscount & { needMore: number } } => {
  const sorted = (rules || []).filter(r => r.fromPercent > 0 && r.minus > 0).sort((a, b) => a.fromPercent - b.fromPercent);
  if (!sorted.length || price <= 0) return { rate, minus: 0 };
  const pct = (Math.min(down, price) / price) * 100;
  // Порог считаем по процентам с допуском на копейки: 20 000 из 100 000 — ровно 20%
  const hit = [...sorted].reverse().find(r => pct + 1e-9 >= r.fromPercent);
  const nextRule = sorted.find(r => pct + 1e-9 < r.fromPercent);
  const minus = hit ? Math.min(hit.minus, rate) : 0;
  return {
    rate: Math.max(0, rate - minus),
    minus,
    rule: hit,
    next: nextRule ? { ...nextRule, needMore: Math.ceil(price * nextRule.fromPercent / 100 - down) } : undefined,
  };
};
