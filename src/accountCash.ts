import type { Customer, Expense, Product, RetailSale, StockLocation, StockMovement, Supplier } from '../types';
import { DEFAULT_WAREHOUSE_ID } from '../types';
import { legacyMainWarehouse, listedWarehouses, retailRemaining, stockOnWarehouse } from './utils';
import { supplierSupplyBalances } from './supplierLedger';

/**
 * Вкладка «Наличные» на странице счёта: магазин глазами кассы.
 *
 * Два разреза, и путать их нельзя.
 *
 * — Торговля считается по складу. Чек принадлежит тому складу, с которого ушёл
 *   товар, а склад привязан к счёту. Так «наторговала точка» не зависит от того,
 *   на какой счёт кассир в конкретном чеке положил деньги.
 *
 * — Деньги считаются по счёту. Платёж лежит там, куда его реально положили, —
 *   ровно по той же формуле, что и баланс (computeAccountBalances). Иначе
 *   раздел, который должен объяснять баланс, сам бы с ним расходился.
 *
 * Долги и товар — состояние на сейчас, период к ним не применяется: «нам должны»
 * за прошлый месяц — вопрос без смысла, должны сегодня.
 */

/** Период включительно, даты в виде YYYY-MM-DD по местному времени */
export interface CashPeriod {
  start: string;
  end: string;
}

export interface AccountCashSummary {
  warehouses: StockLocation[];
  sales: {
    revenue: number;
    /** Сколько из выручки уже оплачено — сразу или погашением долга */
    paid: number;
    /** Остаток долга по чекам периода */
    credit: number;
    profit: number;
    checks: number;
    avgCheck: number;
    /** Разбивка по складам — когда к счёту привязано больше одного */
    byWarehouse: { warehouseId: string; name: string; revenue: number; checks: number }[];
  };
  money: {
    /** Чеки, оплаченные сразу на этот счёт */
    salesIn: number;
    /** Погашение долгов, пришедшее на этот счёт */
    debtIn: number;
    /** Оплаты поставщикам за товар с этого счёта */
    supplierOut: number;
    net: number;
  };
  customerDebt: {
    total: number;
    rows: { customerId?: string; name: string; amount: number; checks: number }[];
  };
  supplierDebt: {
    total: number;
    rows: { supplierId: string; name: string; amount: number }[];
  };
  stock: {
    /** Деньги в товаре по закупочной цене */
    cost: number;
    units: number;
    positions: number;
    low: { productId: string; name: string; warehouseName: string; qty: number; minStock: number }[];
    byWarehouse: { warehouseId: string; name: string; cost: number; positions: number }[];
  };
  recent: { id: string; docId: string; number: string; date: string; total: number; debt: number; customerName: string }[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * День записи по местному времени. Дата без времени — это уже день: new Date
 * прочитал бы её как полночь по UTC и в западных часовых поясах сдвинул бы на
 * сутки назад.
 */
export const localDay = (value: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const inCashPeriod = (value: string, period: CashPeriod): boolean => {
  const day = localDay(value);
  return day >= period.start && day <= period.end;
};

/**
 * Границы периода по местному календарю.
 *
 * Кнопки периода кассы пишут даты через toISOString — по UTC. Ночью в России
 * «сегодня» по UTC ещё вчерашнее число, и сегодняшние чеки не попадали бы в
 * «Сегодня» (на Дальнем Востоке — до десяти утра). Для магазина день считаем
 * сами. «Свой» период — даты из полей ввода, это и есть местный календарь.
 */
export const cashPeriodFor = (mode: string, custom: CashPeriod, now: Date = new Date()): CashPeriod => {
  const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = day(now);
  switch (mode) {
    case 'TODAY':
      return { start: today, end: today };
    case 'WEEK': {
      const from = new Date(now);
      from.setDate(from.getDate() - 7);
      return { start: day(from), end: today };
    }
    case 'MONTH':
      return { start: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, end: today };
    case 'CUSTOM':
      return { start: custom.start || '0000-01-01', end: custom.end || '9999-12-31' };
    default:
      return { start: '0000-01-01', end: '9999-12-31' };
  }
};

/** Склады, чья выручка идёт на этот счёт. Подставной основной без счёта сюда не попадает. */
export const accountWarehouses = (accountId: string, warehouses: StockLocation[]): StockLocation[] =>
  listedWarehouses(warehouses).filter(w => w.accountId === accountId);

const SUPPLIER_PAYMENT = 'Оплата партнёру';

export const accountCashSummary = ({
  accountId, warehouses, retailSales, movements, products, expenses, customers, suppliers, period,
}: {
  accountId: string;
  warehouses: StockLocation[];
  retailSales: RetailSale[];
  movements: StockMovement[];
  products: Product[];
  expenses: Expense[];
  customers: Customer[];
  suppliers: Supplier[];
  period: CashPeriod;
}): AccountCashSummary => {
  const listed = listedWarehouses(warehouses);
  const linked = listed.filter(w => w.accountId === accountId);
  const linkedIds = new Set(linked.map(w => w.id));
  // Движения без склада и ячейка «main» принадлежат основному складу —
  // так же, как их считают каталог и касса.
  const legacyMain = legacyMainWarehouse(listed);
  const resolveWarehouse = (id?: string) => {
    const raw = id || DEFAULT_WAREHOUSE_ID;
    return raw === DEFAULT_WAREHOUSE_ID && legacyMain ? legacyMain : raw;
  };
  const live = retailSales.filter(s => !s.isCancelled);

  // Склад чека — по движению продажи. Отгрузка по договору (contractId) к чекам не относится.
  const warehouseBySale = new Map<string, string>();
  movements.forEach(m => {
    if (m.saleId && m.type === 'SALE' && !m.contractId && !warehouseBySale.has(m.saleId)) {
      warehouseBySale.set(m.saleId, resolveWarehouse(m.warehouseId));
    }
  });
  // Чек без движений (записан до складов или без позиций со склада) узнаём по
  // счёту: деньги ушли в эту кассу — значит, продавала эта точка.
  const shopWarehouseOf = (s: RetailSale): string | null => {
    const wh = warehouseBySale.get(s.id);
    if (wh) return linkedIds.has(wh) ? wh : null;
    return s.accountId === accountId ? (linked[0]?.id ?? null) : null;
  };
  const shopSales = live.filter(s => shopWarehouseOf(s) !== null);

  // ── Торговля за период ──
  const periodSales = shopSales.filter(s => inCashPeriod(s.date, period));
  const revenue = periodSales.reduce((sum, s) => sum + s.total, 0);
  const credit = periodSales.reduce((sum, s) => sum + retailRemaining(s), 0);
  const checks = periodSales.length;
  const byWarehouse = linked.length > 1
    ? linked.map(w => {
        const own = periodSales.filter(s => shopWarehouseOf(s) === w.id);
        return { warehouseId: w.id, name: w.name, revenue: own.reduce((sum, s) => sum + s.total, 0), checks: own.length };
      })
    : [];

  // ── Деньги по счёту за период: та же формула, что у баланса ──
  const salesIn = live
    .filter(s => !s.isCredit && s.accountId === accountId && inCashPeriod(s.date, period))
    .reduce((sum, s) => sum + s.total, 0);
  const debtIn = live.reduce((sum, s) => sum + (s.payments || [])
    .filter(pm => pm.accountId === accountId && inCashPeriod(pm.date, period))
    .reduce((acc, pm) => acc + pm.amount, 0), 0);
  // Оплата по договору рассрочки (saleId) — дело вкладки «Рассрочка», возврат
  // баланс не уменьшает.
  const supplierOut = expenses
    .filter(e => e.accountId === accountId && e.category === SUPPLIER_PAYMENT && !e.saleId
      && e.isRefund !== true && inCashPeriod(e.date, period))
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  // ── Нам должны: покупатели по чекам этих складов ──
  const debtMap = new Map<string, { customerId?: string; name: string; amount: number; checks: number }>();
  shopSales.forEach(s => {
    const left = retailRemaining(s);
    if (left <= 0) return;
    const key = s.customerId || '__anonymous';
    const row = debtMap.get(key) || {
      customerId: s.customerId,
      name: s.customerId
        ? customers.find(c => c.id === s.customerId)?.name || 'Клиент удалён'
        : 'Покупатель без карточки',
      amount: 0,
      checks: 0,
    };
    row.amount += left;
    row.checks += 1;
    debtMap.set(key, row);
  });
  const customerRows = Array.from(debtMap.values()).sort((a, b) => b.amount - a.amount);

  // ── Мы должны: поставщикам за приходы на эти склады ──
  // Оплаты гасят приходы поставщика в целом (привязанные — свой приход, остальные
  // по очереди), а сюда берём остаток только тех приходов, что легли на эти склады.
  const warehouseByDoc = new Map<string, string>();
  movements.forEach(m => {
    if (m.type !== 'IN' || !m.supplierId) return;
    const key = m.batchId || `single_${m.id}`;
    if (!warehouseByDoc.has(key)) warehouseByDoc.set(key, resolveWarehouse(m.warehouseId));
  });
  const supplierRows = suppliers
    .map(sup => ({
      supplierId: sup.id,
      name: sup.name,
      amount: supplierSupplyBalances(movements, products, expenses, sup.id)
        .filter(doc => linkedIds.has(warehouseByDoc.get(doc.id) || ''))
        .reduce((sum, doc) => sum + doc.remaining, 0),
    }))
    .filter(r => r.amount > 0.005)
    .sort((a, b) => b.amount - a.amount);

  // ── Товар на складах ──
  const liveProducts = products.filter(p => !p.isArchived);
  const stockByWarehouse = linked.map(w => {
    let cost = 0;
    let positions = 0;
    let units = 0;
    liveProducts.forEach(p => {
      const qty = stockOnWarehouse(p, w.id, listed);
      // Минус — недостача, а не деньги: в стоимость товара её не складываем.
      if (qty <= 0) return;
      cost += qty * (p.buyPrice || 0);
      units += qty;
      positions += 1;
    });
    return { warehouseId: w.id, name: w.name, cost, positions, units };
  });
  const low: AccountCashSummary['stock']['low'] = [];
  linked.forEach(w => {
    liveProducts.forEach(p => {
      if (p.minStock === undefined || p.minStock === null) return;
      const qty = stockOnWarehouse(p, w.id, listed);
      // Товар, которого на этом складе никогда не было, «заканчивающимся» не считаем:
      // иначе каждая точка тянула бы в список весь каталог.
      const tracked = qty !== 0
        || (!!p.warehouseStocks && Object.prototype.hasOwnProperty.call(p.warehouseStocks, w.id));
      if (tracked && qty <= p.minStock) {
        low.push({ productId: p.id, name: p.name, warehouseName: w.name, qty, minStock: p.minStock });
      }
    });
  });
  low.sort((a, b) => (a.qty - a.minStock) - (b.qty - b.minStock));

  // ── Последние чеки ──
  const recent = [...shopSales]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5)
    .map(s => ({
      id: s.id,
      docId: `sale_${s.id}`,
      // Номер — как в журнале, чтобы чек узнавался в обоих местах
      number: s.docNumber || s.id.slice(0, 6),
      date: s.date,
      total: s.total,
      debt: retailRemaining(s),
      customerName: s.customerId
        ? customers.find(c => c.id === s.customerId)?.name || 'Клиент удалён'
        : 'Розничный покупатель',
    }));

  const round = (n: number) => Math.round(n * 100) / 100;

  return {
    warehouses: linked,
    sales: {
      revenue: round(revenue),
      paid: round(revenue - credit),
      credit: round(credit),
      profit: round(periodSales.reduce((sum, s) => sum + (s.profit || 0), 0)),
      checks,
      avgCheck: checks ? round(revenue / checks) : 0,
      byWarehouse,
    },
    money: {
      salesIn: round(salesIn),
      debtIn: round(debtIn),
      supplierOut: round(supplierOut),
      net: round(salesIn + debtIn - supplierOut),
    },
    customerDebt: {
      total: round(customerRows.reduce((sum, r) => sum + r.amount, 0)),
      rows: customerRows,
    },
    supplierDebt: {
      total: round(supplierRows.reduce((sum, r) => sum + r.amount, 0)),
      rows: supplierRows,
    },
    stock: {
      cost: round(stockByWarehouse.reduce((sum, w) => sum + w.cost, 0)),
      units: stockByWarehouse.reduce((sum, w) => sum + w.units, 0),
      positions: stockByWarehouse.reduce((sum, w) => sum + w.positions, 0),
      low,
      byWarehouse: linked.length > 1
        ? stockByWarehouse.map(({ warehouseId, name, cost, positions }) => ({ warehouseId, name, cost, positions }))
        : [],
    },
    recent,
  };
};

export { localDay as cashLocalDay };
