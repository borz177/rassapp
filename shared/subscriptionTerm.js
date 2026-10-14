/**
 * До какого числа будет действовать подписка после оплаты.
 *
 * Общий для сервера (вебхук оплаты в server/index.js) и окна оплаты
 * (components/Tariffs.tsx): человек заранее видит ровно ту дату, которую потом
 * запишет сервер.
 *
 * Раньше купленные месяцы просто прибавлялись к остатку, а тариф всего срока
 * менялся на новый. Переход «Стандарт → Бизнес» за день до конца оплаченного
 * месяца «Стандарта» превращал этот месяц в «Бизнес» бесплатно, а переход вниз
 * так же обесценивал остаток дорогого тарифа. Теперь остаток старого тарифа
 * пересчитывается в дни нового по цене: 44 дня «Стандарта» (1 490 ₽) — это
 * 29 дней «Бизнеса» (2 290 ₽), а 30 дней «Бизнеса» — 46 дней «Стандарта».
 *
 * Пробный период платным не был — его остаток, как и раньше, просто
 * переносится. Тот же тариф — обычное продление.
 *
 * Только арифметика, без зависимостей: файл одинаково работает в Vite и в Node.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Прибавить месяцы, не «переливаясь» в следующий месяц: 31 января + 1 месяц —
 * 28/29 февраля, а не 3 марта. Время суток сохраняется.
 */
export const addMonthsClamped = (date, months) => {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1,
    date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
  const daysInTarget = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), daysInTarget));
  return target;
};

/**
 * @param {object} p
 * @param {{plan?: string, expiresAt?: string}|null|undefined} p.current — подписка сейчас
 * @param {string} p.plan — покупаемый тариф
 * @param {number} p.months — на сколько месяцев
 * @param {Record<string, number>} p.prices — цены за месяц без скидок (PLAN_PRICES)
 * @param {Date} [p.now]
 * @returns {{ expiresAt: Date, credit: null | { fromPlan: string, fromDays: number, toDays: number } }}
 *   credit — остаток другого тарифа, пересчитанный в дни нового (для показа)
 */
export const termAfterPayment = ({ current, plan, months, prices, now = new Date() }) => {
  const nowMs = now.getTime();
  const endMs = current?.expiresAt ? new Date(current.expiresAt).getTime() : NaN;
  const remainingMs = Number.isFinite(endMs) && endMs > nowMs ? endMs - nowMs : 0;

  let creditMs = remainingMs;
  let credit = null;
  const fromPlan = current?.plan;
  if (remainingMs > 0 && fromPlan && fromPlan !== plan && fromPlan !== 'TRIAL') {
    const oldPrice = Number(prices?.[fromPlan]);
    const newPrice = Number(prices?.[plan]);
    // Тариф без цены (выданный вручную, снятый с продажи) пересчитать не с чем —
    // переносим остаток как есть, как было раньше
    if (oldPrice > 0 && newPrice > 0) {
      creditMs = remainingMs * oldPrice / newPrice;
      credit = { fromPlan, fromDays: remainingMs / DAY_MS, toDays: creditMs / DAY_MS };
    }
  }

  return { expiresAt: addMonthsClamped(new Date(nowMs + creditMs), Number(months)), credit };
};
