import type { Account, Expense, Investor, Sale, ZakatSettings } from '../types';
import type { TurnoverBreakdown } from './turnoverBreakdown';

/**
 * Закят с денег в обороте (закят на торговлю).
 *
 * Облагается: деньги на счетах, долг клиентов по рассрочке (надёжный долг),
 * товар на складе; вычитаются долги поставщикам. Ставка 2,5% за лунный год
 * (2,577% — за солнечный), если доля человека не меньше нисаба: 595 г серебра
 * (по умолчанию — так считает Муфтият ЧР: осторожнее, порог ниже), 85 г золота
 * или своя сумма, объявленная муфтиятом.
 *
 * Чей закят — по разбивке «В обороте» (turnoverBreakdown). Капитал и прибыль
 * инвестора — его имущество, закят с них платит он сам. Владелец платит со
 * своих денег в деле и своей прибыли. Товар на складе и долги поставщикам —
 * дело магазина, то есть владельца: инвесторы вкладывают в договоры. Сомнительный
 * долг делим по долям — он и в обороте лежит общим.
 *
 * Это помощь в расчёте, а не фетва: в нисаб и закят входит и имущество вне
 * приложения (наличные, золото, вклады).
 */

export const NISAB_GRAMS = { GOLD: 85, SILVER: 595 } as const;
export const ZAKAT_RATE = { LUNAR: 0.025, SOLAR: 0.02577 } as const;
export const YEAR_DAYS = { LUNAR: 354, SOLAR: 365 } as const;

export interface ZakatParty {
  id: string;
  name: string;
  /** Облагаемая сумма */
  base: number;
  /** Из чего она складывается — для подсказки в строке */
  parts: { label: string; amount: number }[];
  /** Закят к сроку при нынешних суммах (0 — ниже нисаба) */
  zakat: number;
  reachesNisab: boolean;
  /**
   * Первый год закята: с первого взноса. Пока он не прошёл (firstDue в будущем),
   * закят ещё не обязателен — zakat показывают как «к сроку», в итог не берут.
   */
  firstYear?: { since: number; firstDue: number; passed: boolean; startedBelowNisab: boolean };
}

export interface ZakatResult {
  rate: number;
  nisab: number | null;
  /** Облагаемые активы целиком */
  assets: {
    cash: number;
    receivable: number;
    excludedMarkup: number;
    excludedDoubtful: number;
    inventory: number;
    supplierDebt: number;
    total: number;
  };
  owner: ZakatParty;
  investors: ZakatParty[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export const zakatSettingsWithDefaults = (z: ZakatSettings | undefined) => ({
  year: z?.year || 'LUNAR' as const,
  nisabMetal: z?.nisabMetal || 'SILVER' as const,
  customNisab: z?.customNisab,
  excludeFutureMarkup: !!z?.excludeFutureMarkup,
  excludeDoubtful: !!z?.excludeDoubtful,
  deductSupplierDebt: z?.deductSupplierDebt !== false,
  inventoryPrice: z?.inventoryPrice || 'BUY' as const,
  hawlStart: z?.hawlStart,
  manualMetalPrice: z?.manualMetalPrice,
});

export const computeZakat = (args: {
  breakdown: TurnoverBreakdown;
  settings: ReturnType<typeof zakatSettingsWithDefaults>;
  /** Нисаб, ₽; null — неизвестен (нет цены металла) */
  nisab: number | null;
  inventory: number;
  supplierDebt: number;
  /** Первый взнос каждого инвестора — от него идёт его год закята */
  investorFirstDeposit?: Record<string, { date: number; amount: number } | null>;
  now?: number;
}): ZakatResult => {
  const { breakdown: b, settings: st } = args;
  const rate = ZAKAT_RATE[st.year];
  const nisab = args.nisab && args.nisab > 0 ? args.nisab : null;

  // Доли участников в обороте — те же, что в «Чьи деньги»
  const ownerProfitExpected = st.excludeFutureMarkup ? 0 : b.manager.expected;
  const owner = {
    own: b.rest,
    toWithdraw: b.manager.toWithdraw,
    expected: ownerProfitExpected,
  };
  const inv = b.perInvestor.map(x => ({
    ...x, expected: st.excludeFutureMarkup ? 0 : x.expected,
  }));
  const ownerTotal = () => owner.own + owner.toWithdraw + owner.expected;
  const invTotal = (x: typeof inv[number]) => x.capital + x.toPay + x.expected;
  const sharesTotal = ownerTotal() + inv.reduce((s, x) => s + invTotal(x), 0);

  // Сомнительный долг: без наценки, если она уже не облагается
  const doubtful = st.excludeDoubtful
    ? b.doubtful.receivable - (st.excludeFutureMarkup ? b.doubtful.profit : 0)
    : 0;
  const inventory = Math.max(0, args.inventory);
  const supplierDebt = st.deductSupplierDebt ? Math.max(0, args.supplierDebt) : 0;
  const shareOf = (amount: number) => (sharesTotal > 0 ? Math.max(0, amount) / sharesTotal : 0);

  const party = (id: string, name: string, parts: { label: string; amount: number }[], total: number, isOwner: boolean): ZakatParty => {
    const doubtfulPart = -doubtful * shareOf(total);
    const all = [
      ...parts,
      ...(isOwner ? [{ label: 'Товар на складе', amount: inventory }, { label: 'Долги поставщикам', amount: -supplierDebt }] : []),
      { label: isOwner ? 'Сомнительные долги — ваша доля' : 'Сомнительные долги — его доля', amount: doubtfulPart },
    ].filter(p => Math.abs(p.amount) >= 0.5);
    const base = Math.max(0, total + doubtfulPart + (isOwner ? inventory - supplierDebt : 0));
    const reachesNisab = nisab == null ? base > 0 : base >= nisab;
    return { id, name, base: r2(base), parts: all.map(p => ({ ...p, amount: r2(p.amount) })), zakat: reachesNisab ? r2(base * rate) : 0, reachesNisab };
  };

  return {
    rate,
    nisab: nisab == null ? null : r2(nisab),
    assets: {
      cash: b.cash,
      receivable: b.receivable,
      excludedMarkup: st.excludeFutureMarkup ? b.receivableProfit : 0,
      excludedDoubtful: r2(doubtful),
      inventory: r2(inventory),
      supplierDebt: r2(supplierDebt),
      total: r2(b.total - (st.excludeFutureMarkup ? b.receivableProfit : 0) - doubtful + inventory - supplierDebt),
    },
    owner: party('owner', 'Вы', [
      { label: 'Свои деньги в деле', amount: owner.own },
      { label: 'Прибыль к выводу', amount: owner.toWithdraw },
      { label: 'Ожидаемая прибыль', amount: owner.expected },
    ], ownerTotal(), true),
    investors: inv.map(x => {
      const p = party(x.id, x.name, [
        { label: 'Вложения', amount: x.capital },
        { label: 'Прибыль к выплате', amount: x.toPay },
        { label: 'Ожидаемая прибыль', amount: x.expected },
      ], invTotal(x), false);
      const first = args.investorFirstDeposit?.[x.id];
      if (!first) return p;
      const firstDue = first.date + YEAR_DAYS[st.year] * 86400000;
      return { ...p, firstYear: {
        since: first.date, firstDue, passed: firstDue <= (args.now ?? Date.now()),
        startedBelowNisab: nisab != null && first.amount < nisab,
      } };
    }),
  };
};

/** Расход — выплата закята: категория «Закят» или слово в названии или комментарии */
export const isZakatExpense = (e: Pick<Expense, 'category' | 'title' | 'description'>) =>
  e.category === 'Закят' || /зак[яа]т/i.test(`${e.title || ''} ${e.description || ''}`);

/** Текущий год закята: от даты начала, сдвинутой на целое число лет, до следующего срока */
export const zakatYear = (hawlStart: string | undefined, year: 'LUNAR' | 'SOLAR', now = Date.now()) => {
  const len = YEAR_DAYS[year] * 86400000;
  if (!hawlStart) return { start: now - len, due: null as number | null };
  let start = new Date(hawlStart).getTime();
  if (!Number.isFinite(start)) return { start: now - len, due: null as number | null };
  while (start + len <= now) start += len;
  while (start > now) start -= len;
  return { start, due: start + len };
};

/**
 * Первый взнос инвестора: самая ранняя из дат — вход в дело (joinedDate, периоды
 * участия) и пополнения от него (приход с его id, системный депозит, «Пополнение
 * от инвестора» на его личном счёте — так записаны и взносы до смены id).
 */
export const investorFirstDeposit = (
  inv: Investor,
  accounts: Account[],
  sales: Sale[]
): { date: number; amount: number } | null => {
  const own = new Set(accounts.filter(a => a.ownerId === inv.id).map(a => a.id));
  const found: { date: number; amount: number }[] = [];
  const add = (date: string | undefined, amount: number) => {
    const t = date ? new Date(date).getTime() : NaN;
    if (Number.isFinite(t)) found.push({ date: t, amount });
  };
  sales.forEach(s => {
    const isDeposit = s.customerId === inv.id || s.customerId === `system_deposit_${inv.id}`
      || (own.has(s.accountId) && /пополнение от инвестора/i.test(s.productName || ''));
    if (isDeposit) add(s.startDate, Number(s.totalAmount) || 0);
  });
  (inv.investmentPeriods || []).forEach(p => add(p.joinedDate, Number(p.initialAmount) || 0));
  if (!found.length) add(inv.joinedDate, Number(inv.initialAmount) || 0);
  if (!found.length) return null;
  return found.reduce((a, b) => (b.date < a.date ? b : a));
};
