/**
 * Совместное финансирование договора: закуп оплачен с нескольких счетов.
 *
 * Пример: закуп 80 000 ₽, на счёте Руслана 60 000, недостающие 20 000 — со
 * счёта Марата. Договор хранит funding: [{accountId, amount}] — сколько закупа
 * дал каждый счёт; доля счёта = amount / сумма. Основной счёт (sale.accountId)
 * — первый в списке.
 *
 * Деньги договора по счетам считаются через «доли» (expandFundedSales): договор
 * раскладывается на части — по одной на счёт — с пропорциональными суммами
 * (первый взнос, платежи, закуп, цена). Всё, что считает деньги ПО СЧЁТУ
 * (баланс, прибыль инвесторов, отчёты, страница инвестора), работает с частями;
 * списки и счётчики договоров — с самими договорами, чтобы договор не задвоился.
 *
 * Договор без funding (все нынешние) даёт ровно одну часть — себя же, тот же
 * объект: старые договоры считаются ровно как раньше.
 *
 * Общий для приложения и сервера (как profit.js): только арифметика, без зависимостей.
 */

const round2 = (n) => Math.round(n * 100) / 100;

/** Доли счетов в договоре, сумма = 1. null — договор на одном счёте */
export const fundingShares = (sale) => {
  const f = sale && Array.isArray(sale.funding) ? sale.funding : null;
  if (!f || f.length < 2) return null;
  const parts = f.map(x => ({ accountId: x.accountId, amount: Math.max(0, Number(x.amount) || 0) }))
    .filter(x => x.accountId);
  const total = parts.reduce((n, x) => n + x.amount, 0);
  if (parts.length < 2 || total <= 0) return null;
  return parts.map(x => ({ accountId: x.accountId, share: x.amount / total }));
};

/**
 * Делит сумму по долям с точностью до копейки: части округлены, а остаток
 * округления уходит первой (основной) — сумма частей всегда равна целому.
 */
export const splitByShares = (amount, shares) => {
  const total = Number(amount) || 0;
  const parts = shares.map(s => round2(total * s.share));
  const rest = round2(total - parts.reduce((n, x) => n + x, 0));
  parts[0] = round2(parts[0] + rest);
  return parts;
};

/** Есть ли у договора доля на этом счёте (основной или совместный) */
export const saleTouchesAccount = (sale, accountId) =>
  !!sale && (sale.accountId === accountId || (fundingShares(sale) || []).some(s => s.accountId === accountId));

/** Доля счёта в договоре: 0…1. Для договора на одном счёте — 1 или 0 */
export const saleAccountShare = (sale, accountId) => {
  const shares = fundingShares(sale);
  if (!shares) return sale && sale.accountId === accountId ? 1 : 0;
  const s = shares.find(x => x.accountId === accountId);
  return s ? s.share : 0;
};

/**
 * Договор → части по счетам. Часть — тот же договор с accountId счёта и
 * пропорциональными суммами; fundingOf/fundingShare — чей кусок и какой.
 * Id части равен id договора (платежи и ссылки на договор остаются рабочими).
 */
export const fundingPieces = (sale) => {
  const shares = fundingShares(sale);
  if (!shares) return [sale];
  const split = (v) => splitByShares(v, shares);
  const down = split(sale.downPayment);
  const buy = split(sale.buyPrice);
  const total = split(sale.totalAmount);
  const remaining = split(sale.remainingAmount);
  const price = sale.price != null ? split(sale.price) : null;
  const plan = (sale.paymentPlan || []).map(p => ({
    p,
    amount: split(p.amount),
    discount: p.discountAmount ? split(p.discountAmount) : null,
  }));
  return shares.map((s, i) => ({
    ...sale,
    accountId: s.accountId,
    downPayment: down[i],
    buyPrice: buy[i],
    totalAmount: total[i],
    remainingAmount: remaining[i],
    ...(price ? { price: price[i] } : {}),
    paymentPlan: plan.map(x => ({ ...x.p, amount: x.amount[i], ...(x.discount ? { discountAmount: x.discount[i] } : {}) })),
    fundingOf: sale.id,
    fundingShare: s.share,
  }));
};

/** Все договоры → части по счетам. Без совместных договоров — тот же массив */
export const expandFundedSales = (sales) => {
  if (!Array.isArray(sales) || !sales.some(s => fundingShares(s))) return sales;
  const out = [];
  for (const s of sales) out.push(...fundingPieces(s));
  return out;
};

/**
 * Что в долях задаёт человек: вторые счета с суммами. Сумма основного выводится
 * из закупа, а сам основной — поле договора, поэтому в ключ не входят: правка
 * закупа или счёта в старой версии приложения — не «изменение долей» (её доли
 * снимет или пересчитает normalizeFunding). null — договор на одном счёте.
 */
export const fundingKey = (sale) => {
  const f = sale && Array.isArray(sale.funding) && sale.funding.length > 1 ? sale.funding : null;
  if (!f) return null;
  return JSON.stringify(f.slice(1).map(x => [x && x.accountId, round2(Number(x && x.amount) || 0)]));
};

/**
 * Приводит funding договора к правилам — сервер делает это перед каждым
 * сохранением. Возвращает { funding, reason }: funding — исправленный список
 * или null (договор на одном счёте), reason — почему доли сняты.
 *
 * Правила: только закуп за свои деньги (без поставщика и склада); первый —
 * основной счёт договора; счета не повторяются; суммы вторых счетов > 0;
 * сумма основного = закуп − вторые и тоже > 0.
 *
 * Старая версия приложения (iPhone, компьютер — обновляются не сразу) о funding
 * не знает, но сохраняет договор целиком, вместе с ним. Сменила закуп — сумма
 * основного пересчитается; сменила счёт, поставила поставщика или закуп стал
 * меньше вторых счетов — доли снимаются, и договор целиком на основном счёте,
 * ровно как его видит и считает старая версия.
 */
export const normalizeFunding = (sale) => {
  const f = sale && Array.isArray(sale.funding) ? sale.funding : null;
  if (!f || f.length < 2) return { funding: null, reason: f && f.length ? 'single' : null };
  if (sale.supplierId || (Array.isArray(sale.stockItems) && sale.stockItems.length) || sale.productId) {
    return { funding: null, reason: 'not_own_purchase' };
  }
  const buy = round2(Number(sale.buyPrice) || 0);
  if (!(buy > 0)) return { funding: null, reason: 'no_purchase' };
  if (!f[0] || f[0].accountId !== sale.accountId) return { funding: null, reason: 'primary_changed' };
  const rest = f.slice(1).map(x => ({
    accountId: x && typeof x.accountId === 'string' ? x.accountId : '',
    amount: round2(Number(x && x.amount) || 0),
  }));
  const ids = [sale.accountId, ...rest.map(x => x.accountId)];
  if (rest.some(x => !x.accountId || !(x.amount > 0)) || new Set(ids).size !== ids.length) {
    return { funding: null, reason: 'invalid' };
  }
  const primary = round2(buy - rest.reduce((n, x) => n + x.amount, 0));
  if (!(primary > 0)) return { funding: null, reason: 'exceeds_purchase' };
  return { funding: [{ accountId: sale.accountId, amount: primary }, ...rest], reason: null };
};
