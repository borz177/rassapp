/**
 * Расчёты договора рассрочки без экрана: цена с наценкой, график, проверка на
 * дубль — и сборка нового договора из черновика FinUchetGPT.
 *
 * Форма договора (components/NewSale.tsx) считает этим же кодом. Договор,
 * который ассистент оформил сам в режиме «Авто», должен получиться ровно таким
 * же, как оформленный руками: та же цена, тот же график, те же поля, — дальше
 * его сохраняет тот же handleSaveSale в App.tsx (закуп, склад, совместные счета).
 */

import type { Payment, Sale } from '../types';
import { addMonthsClamped } from './utils';

// Разбор и вывод даты из <input type="date"> строго в локальном времени.
// new Date('2026-08-15') трактуется как полночь UTC, и обратный toISOString()
// в поясах восточнее/западнее Гринвича легко сдвигает дату на сутки.
export const parseInputDate = (value: string): Date => {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
export const toInputDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
// Дата из поля («2026-11-15») — местная полночь, полная дата ISO — как есть.
// new Date('2026-11-15') — полночь по Гринвичу: западнее него (прод 26.10, телефон
// в поясе США) это ещё 14-е, и выбранный день первого платежа уезжал на сутки раньше.
export const dateFromInput = (value: string | Date): Date =>
  value instanceof Date ? new Date(value) : /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? parseInputDate(String(value)) : new Date(value);
// Обратно в поле: местный календарный день (toISOString().split('T') даёт день по Гринвичу)
export const inputDateOf = (value: string | Date): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value) : toInputDate(new Date(value));

/**
 * Цена в рассрочку: закуп + наценка. Наценка — от закупа или, если так
 * настроено (markupFromNetBuyPrice), от закупа за вычетом первого взноса.
 */
export const markupPrice = (buyPrice: number, downPayment: number, ratePercent: number, fromNetBuyPrice?: boolean): number => {
  const bp = Number(buyPrice) || 0;
  const base = fromNetBuyPrice ? Math.max(0, bp - (Number(downPayment) || 0)) : bp;
  return Math.round(bp + base * ((Number(ratePercent) || 0) / 100));
};

/**
 * Наценка, при которой цена выйдет ровно названной. У нового договора форма
 * всегда пересчитывает цену из закупа и наценки — значит, назвали цену, а не
 * процент, процент должен дать её до рубля. Берём самую короткую запись.
 */
export const rateForPrice = (buyPrice: number, downPayment: number, totalPrice: number, fromNetBuyPrice?: boolean): number => {
  const bp = Number(buyPrice) || 0;
  const base = fromNetBuyPrice ? Math.max(0, bp - (Number(downPayment) || 0)) : bp;
  if (!(base > 0)) return 0;
  const exact = ((Number(totalPrice) - bp) / base) * 100;
  for (const digits of [0, 1, 2, 3, 4]) {
    const r = Number(exact.toFixed(digits));
    if (markupPrice(bp, downPayment, r, fromNetBuyPrice) === Math.round(Number(totalPrice))) return r;
  }
  return Number(exact.toFixed(6));
};

// Оплаченная плановая строка старого формата — до отдельных записей о поступлениях
// деньги лежали прямо в строке графика (isRealPayment не задан). Строка с
// isRealPayment === false — только пометка «закрыта»: в кассе и в долге её не считают
// (computeAccountBalances), не считаем и здесь.
export const isLegacyPaidSlot = (p: Payment) => !!p.isPaid && p.isRealPayment == null;

// Есть ли уже похожий активный договор: тот же клиент, товар, дата и сумма
export const checkDuplicateSale = (
  sales: Sale[] | undefined,
  customerId: string,
  productName: string,
  startDate: string,
  totalAmount: number,
  excludeId?: string
) => {
  if (!Array.isArray(sales) || sales.length === 0) return undefined;
  if (typeof totalAmount !== 'number' || isNaN(totalAmount)) return undefined;

  const saleDate = new Date(startDate).toDateString();

  return sales.find(sale => {
    if (!sale) return false;
    if (excludeId && sale.id === excludeId) return false;
    if ((sale.status as string) === 'DELETED' || sale.status === 'COMPLETED') return false;

    const sameCustomer = sale.customerId === customerId;
    const sameProduct = sale.productName?.toLowerCase() === productName.toLowerCase();
    const sameDate = new Date(sale.startDate).toDateString() === saleDate;
    const sameAmount = Math.abs((sale.totalAmount || 0) - totalAmount) < 0.01;

    return sameCustomer && sameProduct && sameDate && sameAmount;
  });
};

/**
 * График платежей договора: новый — целиком, при правке — с ЗАЩИТОЙ уже
 * полученных денег (реальные платежи и оплаченные строки старого формата
 * остаются как есть, пересчитываются только будущие).
 */
export const regeneratePaymentPlan = (
  saleData: any,
  newFirstPaymentDate: string,
  existingPayments: Payment[] = []
): Payment[] => {
  // 🔹 1. Сохраняем ВСЕ реальные платежи (историю поступлений)
  // Это платежи с isRealPayment === true (фактически полученные деньги)
  const realPayments = existingPayments.filter(p => p.isRealPayment === true);

  // 🔹 2. Также сохраняем оплаченные плановые платежи старого формата — те, что сами
  // несли деньги (isRealPayment не задан). Плановая строка с isRealPayment === false,
  // отмеченная оплаченной, — лишь пометка «закрыта реальным платежом»: деньги уже в
  // realPayments. Раньше её тоже считали оплатой, и правка даты первого платежа
  // вычитала один и тот же платёж дважды — будущие платежи получались меньше долга
  // (долг 43 200 ₽, а график 27 900 ₽).
  const legacyPaidPayments = existingPayments.filter(isLegacyPaidSlot);

  // 🔹 2.1 Нынешний формат (деньги — только в realPayments): график строим заново
  // целиком от новой даты — installments строк на весь долг после первого взноса,
  // как у нового договора. Какие строки уже закрыты, решает распределение реальных
  // платежей при показе; месяцы с поступлениями не пропускаем — платёж не привязан
  // к месяцу графика.
  if (legacyPaidPayments.length === 0) {
    const totalDue = Math.max(0, saleData.totalAmount - saleData.downPayment);
    const n = Math.max(1, Number(saleData.installments) || 1);
    const base = Math.floor(totalDue / n);
    const last = Math.round((totalDue - base * (n - 1)) * 100) / 100;
    const firstDate = dateFromInput(newFirstPaymentDate);
    const rows: Payment[] = Array.from({ length: n }, (_, i) => ({
      id: `pay_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 6)}`,
      saleId: saleData.id,
      amount: i === n - 1 ? last : base,
      date: addMonthsClamped(firstDate, i).toISOString(),
      isPaid: false,
      isRealPayment: false
    }));
    return [...realPayments, ...rows].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  // 🔹 3. Объединяем сохранённые платежи
  const preservedPayments = [...realPayments, ...legacyPaidPayments];

  // 🔹 4. Считаем, сколько ещё нужно платежей и какую сумму распределять
  const preservedAmount = preservedPayments.reduce((sum, p) => sum + p.amount, 0);
  const remainingInstallments = saleData.installments - preservedPayments.length;

  // 🔹 5. Если все платежи уже сохранены — возвращаем их
  if (remainingInstallments <= 0) {
    return preservedPayments.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  // 🔹 6. Считаем сумму для будущих платежей.
  // 🔥 ВАЖНО: считаем ВСЕГДА от totalAmount/downPayment/preservedAmount, а не берём
  // saleData.remainingAmount "как есть" — это поле обычно равно (totalAmount - downPayment)
  // и НЕ учитывает уже оплаченные платежи по графику (preservedAmount). Раньше это было
  // безопасно, т.к. функция вызывалась только когда preservedAmount === 0, но теперь
  // редактирование пересчитывает график и при наличии оплаченных платежей — тут это критично.
  // 🔒 Защита от отрицательного остатка (не должно происходить — валидируется до вызова,
  // но подстраховываемся на случай прямого вызова функции с некорректными данными).
  const remainingAmount = Math.max(0, saleData.totalAmount - saleData.downPayment - preservedAmount);
  // 🔒 Платежи считаем ЦЕЛЫМИ РУБЛЯМИ, а остаток от деления кладём в ПОСЛЕДНИЙ платёж.
  // Раньше все платежи получали одну сумму с копейками (91 000 / 3 = 30 333,33), и их сумма
  // не сходилась с долгом (30 333,33 × 3 = 90 999,99). А так как принимают платежи целыми
  // рублями, каждый раз недоплачивалось 33 копейки: они копились в остатке долга, из-за чего
  // график показывал 30 333 ₽, а «Остаток долга» — 30 334 ₽, и в графике вылезали строки-хвосты.
  // Теперь 91 000 / 3 → 30 333 + 30 333 + 30 334: сумма сходится точно, копеек нет.
  // Если сама сумма договора с копейками (например, 43 312,50) — они уйдут в последний платёж.
  const baseAmount = remainingInstallments > 0
    ? Math.floor(remainingAmount / remainingInstallments)
    : 0;
  const lastAmount = remainingInstallments > 0
    ? Math.round((remainingAmount - baseAmount * (remainingInstallments - 1)) * 100) / 100
    : 0;

  // 🔹 7. Генерируем новые даты для будущих платежей
  const firstDate = dateFromInput(newFirstPaymentDate);

  // 🔹 8. Пропускаем месяцы, которые уже заняты сохранёнными платежами
  const usedMonths = new Set(preservedPayments.map(p => new Date(p.date).toISOString().slice(0, 7)));

  const futurePayments: Payment[] = [];
  let monthOffset = 0;

  while (futurePayments.length < remainingInstallments) {
    // 🔒 addMonthsClamped, а не pDate.setMonth(...): при дне платежа 29-31 обычный setMonth
    // "переливает" несуществующую дату в следующий месяц (30 февраля → 2 марта). Из-за этого
    // февральский платёж не создавался вовсе — его месяц оказывался занят сбойной мартовской
    // датой, настоящий март отсекался проверкой usedMonths ниже, и весь оставшийся график
    // сдвигался на месяц (в печатном договоре это выглядело как пропущенный месяц).
    const pDate = addMonthsClamped(firstDate, monthOffset);

    const monthKey = pDate.toISOString().slice(0, 7);

    // 🔹 Пропускаем месяцы, которые уже заняты
    if (!usedMonths.has(monthKey)) {
      futurePayments.push({
        id: `pay_${Date.now()}_${futurePayments.length}_${Math.random().toString(36).substr(2, 6)}`,
        saleId: saleData.id,
        // Последнему платежу достаётся остаток от деления, чтобы сумма графика сошлась точно.
        amount: futurePayments.length === remainingInstallments - 1 ? lastAmount : baseAmount,
        date: pDate.toISOString(),
        isPaid: false,
        isRealPayment: false
      });
      usedMonths.add(monthKey);
    }

    monthOffset++;
  }

  // 🔹 9. Объединяем и сортируем по дате
  return [...preservedPayments, ...futurePayments].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
};

/** Черновик договора от FinUchetGPT (prepare_contract в server/ai/assistant.js) */
export interface AssistantContractDraft {
  productName?: string;
  /** Поручитель — ФИО и телефон (если назвали) */
  guarantorName?: string;
  guarantorPhone?: string;
  buyPrice?: number;
  markupPercent?: number;
  totalPrice?: number;
  months?: number;
  downPayment?: number;
  /** Дата первого платежа ГГГГ-ММ-ДД, если назвали («оплата 12 числа») */
  firstPaymentDate?: string;
}

/**
 * Что мешает оформить договор из черновика без формы. null — можно.
 * Те же требования, что у формы, плюс то, что форма молча подставила бы сама
 * (3 месяца, наценка 30 %): договор вышел бы не тем, что просили.
 */
export const assistantSaleProblem = (opts: {
  draft: AssistantContractDraft; customerId?: string; accountId?: string; sales: Sale[]; fromNetBuyPrice?: boolean;
}): string | null => {
  const { draft, customerId, accountId, sales } = opts;
  if (!customerId) return 'Не выбран клиент.';
  if (!accountId) return 'Нет счёта, с которого оформить договор.';
  if (!String(draft.productName || '').trim()) return 'Не указан товар.';
  if (!(Number(draft.buyPrice) > 0)) return 'Не указан закуп.';
  const months = Number(draft.months);
  if (!(Number.isInteger(months) && months >= 1 && months <= 120)) return 'Не указан срок в месяцах.';
  const hasRate = draft.markupPercent != null && Number(draft.markupPercent) >= 0;
  if (!hasRate && !(Number(draft.totalPrice) > 0)) return 'Не указана наценка или цена.';
  const total = draftTotal(draft, opts.fromNetBuyPrice);
  if (!(total > 0)) return 'Цена договора получилась нулевой.';
  if ((Number(draft.downPayment) || 0) >= total) return 'Первый взнос не меньше цены — это не рассрочка.';
  const dup = checkDuplicateSale(sales, customerId, String(draft.productName), new Date().toISOString(), total);
  if (dup) return `Похожий договор уже есть — от ${new Date(dup.startDate).toLocaleDateString('ru-RU')}, на ту же сумму. Проверьте в форме, не дубль ли это.`;
  return null;
};

const draftRate = (d: AssistantContractDraft, fromNet?: boolean) =>
  d.markupPercent != null && Number(d.markupPercent) >= 0
    ? Number(d.markupPercent)
    : rateForPrice(Number(d.buyPrice), Number(d.downPayment) || 0, Number(d.totalPrice), fromNet);

const draftTotal = (d: AssistantContractDraft, fromNet?: boolean) =>
  markupPrice(Number(d.buyPrice), Number(d.downPayment) || 0, draftRate(d, fromNet), fromNet);

/**
 * Новый договор рассрочки из черновика — тем же порядком, что форма при
 * сохранении (NewSale.handleConfirm): дата оформления — сейчас, первый платёж
 * через месяц, без округления, без поставщика и склада. Сохранять — через
 * handleSaveSale, как и форму.
 */
export const buildAssistantSale = (opts: {
  draft: AssistantContractDraft; customerId: string; accountId: string; fromNetBuyPrice?: boolean; now?: Date;
}) => {
  const { draft, customerId, accountId, fromNetBuyPrice } = opts;
  const now = opts.now || new Date();
  const buyPrice = Number(draft.buyPrice);
  const downPayment = Math.max(0, Number(draft.downPayment) || 0);
  const installments = Number(draft.months);
  const interestRate = draftRate(draft, fromNetBuyPrice);
  const totalAmount = markupPrice(buyPrice, downPayment, interestRate, fromNetBuyPrice);
  const id = `sale_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  // Как в форме: дата первого платежа — ровно месяц от даты оформления, если в
  // черновике нет названной («оплата 12 числа»); прошедшую дату не берём
  const named = /^\d{4}-\d{2}-\d{2}$/.test(String(draft.firstPaymentDate || '')) && String(draft.firstPaymentDate) >= toInputDate(now) ? String(draft.firstPaymentDate) : '';
  const paymentDate = named || toInputDate(addMonthsClamped(parseInputDate(toInputDate(now)), 1));
  const base = {
    id,
    customerId,
    productId: '',
    productName: String(draft.productName).trim(),
    buyPrice,
    price: totalAmount,
    accountId,
    startDate: now.toISOString(),
    paymentDate,
    paymentDay: parseInputDate(paymentDate).getDate(),
    downPayment,
    installments,
    interestRate,
    guarantorName: String(draft.guarantorName || '').trim(),
    guarantorPhone: String(draft.guarantorPhone || '').trim(),
    roundingMode: 'NONE' as const,
    roundingStep: 100,
    supplierId: '',
    partnerDebtPaidAmount: 0,
    isPartnerDebtPaid: false,
    stockItems: [],
    stockWarehouseId: undefined,
    funding: undefined,
    fundingExtra: undefined,
    type: 'INSTALLMENT' as const,
    createdVia: 'ai' as const,
    totalAmount,
    remainingAmount: totalAmount - downPayment,
  };
  return {
    ...base,
    paymentPlan: regeneratePaymentPlan(base, paymentDate),
    updatedAt: now.toISOString(),
  };
};
