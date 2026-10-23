// Склад и магазин для агента: приход от поставщика, списание, розничная продажа.
//
// Записи — те же, что делает приложение (App.tsx: handlePostStockBatch,
// handleRetailSale; components/WarehouseOps.tsx, RetailSale.tsx): движение по
// складу на каждую позицию, остаток товара по складам (warehouseStocks) и общий
// stock как их сумма, номер документа — порядковый своего вида. Здесь только
// расчёт: что записать и что вернуть при отмене; пишет assistant.js.

const crypto = require('node:crypto');

const DEFAULT_WAREHOUSE_ID = 'main';
const WRITE_OFF_REASONS = ['Порча', 'Брак', 'Потеря', 'Недостача', 'Другое'];

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
const norm = (v) => String(v || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

// Как stockAtWarehouse / applyStockDelta в src/utils.ts
const stockAt = (p, warehouseId) => {
  if (p.warehouseStocks) return Number(p.warehouseStocks[warehouseId]) || 0;
  return warehouseId === DEFAULT_WAREHOUSE_ID ? (Number(p.stock) || 0) : 0;
};
const applyDelta = (p, warehouseId, delta, nowIso) => {
  const stocks = { ...(p.warehouseStocks || (p.stock ? { [DEFAULT_WAREHOUSE_ID]: Number(p.stock) } : {})) };
  stocks[warehouseId] = (Number(stocks[warehouseId]) || 0) + delta;
  return { ...p, warehouseStocks: stocks, stock: Object.values(stocks).reduce((s, v) => s + (Number(v) || 0), 0), updatedAt: nowIso };
};

/** Склад: названный, иначе основной; складов нет — 'main', как в приложении */
const pickWarehouse = (warehouses, wanted) => {
  const live = warehouses.filter(w => !w.isArchived);
  if (wanted) {
    const q = norm(wanted);
    const found = live.filter(w => w.id === wanted || norm(w.name) === q || norm(w.name).includes(q));
    if (found.length === 1) return { warehouse: found[0] };
    return { error: found.length ? `Подходит несколько складов: ${found.map(w => w.name).join(', ')} — спроси, какой.` : `Склад «${wanted}» не найден; есть: ${live.map(w => w.name).join(', ') || 'только основной'}.` };
  }
  if (!live.length) return { warehouse: { id: DEFAULT_WAREHOUSE_ID, name: 'Основной склад' } };
  const main = live.find(w => w.isMain);
  if (main) return { warehouse: main };
  if (live.length === 1) return { warehouse: live[0] };
  return { error: `Складов несколько (${live.map(w => w.name).join(', ')}) — спроси, на каком.` };
};

/** Позиции документа: товар из каталога и количество; повтор товара — одной строкой */
const readItems = (products, items) => {
  if (!Array.isArray(items) || !items.length) return { error: 'Нет позиций — какие товары и сколько?' };
  if (items.length > 50) return { error: 'Не больше 50 позиций за раз.' };
  const lines = new Map();
  for (const it of items) {
    const p = products.find(x => x.id === it?.productId);
    if (!p) return { error: `Товар не найден (${it?.productId || 'без id'}) — возьми id из list_products. Нового товара в каталоге нет — его заводят в приложении: Склад → Товары.` };
    if (p.isArchived) return { error: `«${p.name}» в архиве — верните его из архива в приложении.` };
    const qty = Number(it.quantity);
    if (!(qty > 0) || qty > 100000) return { error: `Количество для «${p.name}» должно быть больше нуля.` };
    const price = it.price != null && it.price !== '' ? Number(it.price) : null;
    if (price != null && !(price >= 0)) return { error: `Цена для «${p.name}» не может быть отрицательной.` };
    const prev = lines.get(p.id);
    lines.set(p.id, { product: p, quantity: (prev?.quantity || 0) + qty, price: price ?? prev?.price ?? null });
  }
  return { lines: [...lines.values()] };
};

// Номер документа — порядковый своего вида (WarehouseOps: nextDocNumber)
const nextStockDocNumber = (movements, type) => {
  const docs = new Set();
  movements.forEach(m => { if (m.type === type) docs.add(m.batchId || m.id); });
  return String(docs.size + 1).padStart(4, '0');
};
// RetailSale.tsx: чеки без отменённых и возвратов
const nextReceiptNumber = (retailSales) => String(retailSales.filter(s => !s.isCancelled && !s.returnOf).length + 1).padStart(4, '0');

// Дата документа: выбранный день и текущее время — порядок внутри дня сохраняется
const docDate = (day, now = new Date()) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return now.toISOString();
  const time = now.toLocaleTimeString('en-GB', { timeZone: 'Europe/Moscow', hour12: false });
  const d = new Date(`${day}T${time}+03:00`);
  return isNaN(d.getTime()) ? now.toISOString() : d.toISOString();
};

const money = (n) => `${Math.round(Number(n) || 0).toLocaleString('ru-RU')} ₽`;
const qtyText = (q, p) => `${Number(q).toLocaleString('ru-RU')} ${p.unit || 'шт'}`;

/** Приход от поставщика (WarehouseOps, вкладка «Приход»): поставщик обязателен */
const planReceive = ({ products, warehouses, suppliers, movements, ownerId, args, now = new Date() }) => {
  const wh = pickWarehouse(warehouses, args.warehouse);
  if (wh.error) return wh;
  const q = norm(args.supplier);
  if (!q) return { error: `Нужен поставщик — от кого товар? Есть: ${suppliers.map(s => s.name).join(', ') || 'поставщиков нет — заведите в приложении (Партнёры)'}.` };
  const found = suppliers.filter(s => s.id === args.supplier || norm(s.name) === q || norm(s.name).includes(q));
  if (found.length !== 1) {
    return { error: found.length ? `Подходит несколько поставщиков: ${found.map(s => s.name).join(', ')} — спроси через ask_choice.`
      : `Поставщик «${args.supplier}» не найден; есть: ${suppliers.map(s => s.name).join(', ') || 'никого — заведите в приложении (Партнёры)'}.` };
  }
  const supplier = found[0];
  const r = readItems(products, args.items);
  if (r.error) return r;
  const warehouseId = wh.warehouse.id;
  const date = docDate(args.date, now);
  const batchId = `doc_${now.getTime()}`;
  const docNumber = nextStockDocNumber(movements, 'IN');
  const nowIso = now.toISOString();
  const out = { movements: [], products: [] };
  for (const { product, quantity, price } of r.lines) {
    const cost = price != null ? price : (Number(product.buyPrice) || 0);
    out.movements.push({
      id: crypto.randomUUID(), userId: product.userId || ownerId, productId: product.id, type: 'IN',
      quantity, unitPrice: cost, warehouseId, supplierId: supplier.id, batchId, docNumber, date,
      ...(args.note ? { note: String(args.note).slice(0, 300) } : {}), createdByUserId: ownerId, createdVia: 'ai',
    });
    let next = applyDelta(product, warehouseId, quantity, nowIso);
    // Цена закупа — по последнему приходу (как в приложении)
    if (cost > 0) next = { ...next, buyPrice: cost };
    out.products.push(next);
  }
  const total = r.lines.reduce((n, l) => n + l.quantity * (l.price != null ? l.price : (Number(l.product.buyPrice) || 0)), 0);
  out.summary = `Приход №${docNumber} от «${supplier.name}» на «${wh.warehouse.name}»: ${r.lines.map(l => `${l.product.name} — ${qtyText(l.quantity, l.product)}`).join('; ')}${total > 0 ? `. Сумма ${money(total)}` : ''}`;
  return out;
};

/** Списание (WarehouseOps, вкладка «Списание»): причина из того же списка */
const planWriteOff = ({ products, warehouses, movements, ownerId, args, now = new Date() }) => {
  const wh = pickWarehouse(warehouses, args.warehouse);
  if (wh.error) return wh;
  const reason = WRITE_OFF_REASONS.find(x => norm(x) === norm(args.reason)) || null;
  if (!reason) return { error: `Нужна причина списания: ${WRITE_OFF_REASONS.join(', ')}.` };
  const r = readItems(products, args.items);
  if (r.error) return r;
  const warehouseId = wh.warehouse.id;
  const short = r.lines.filter(l => stockAt(l.product, warehouseId) - l.quantity < 0);
  if (short.length) return { error: `Списать больше, чем есть, нельзя: ${short.map(l => `${l.product.name} — на складе ${qtyText(stockAt(l.product, warehouseId), l.product)}`).join('; ')}.` };
  const date = docDate(args.date, now);
  const batchId = `doc_${now.getTime()}`;
  const docNumber = nextStockDocNumber(movements, 'WRITE_OFF');
  const nowIso = now.toISOString();
  const note = [reason, String(args.note || '').trim().slice(0, 300)].filter(Boolean).join(' · ');
  const out = { movements: [], products: [] };
  for (const { product, quantity } of r.lines) {
    out.movements.push({
      id: crypto.randomUUID(), userId: product.userId || ownerId, productId: product.id, type: 'WRITE_OFF',
      quantity: -quantity, warehouseId, batchId, docNumber, date, note, createdByUserId: ownerId, createdVia: 'ai',
    });
    out.products.push(applyDelta(product, warehouseId, -quantity, nowIso));
  }
  out.summary = `Списание №${docNumber} (${reason}) со склада «${wh.warehouse.name}»: ${r.lines.map(l => `${l.product.name} — ${qtyText(l.quantity, l.product)}`).join('; ')}`;
  return out;
};

/**
 * Розничная продажа за наличные (касса): чек, движения SALE и остатки.
 * В долг агент не продаёт — долг по чеку ведут в кассе приложения.
 */
const planRetailSale = ({ products, warehouses, accounts, retailSales, customers, ownerId, args, now = new Date() }) => {
  const wh = pickWarehouse(warehouses, args.warehouse);
  if (wh.error) return wh;
  const r = readItems(products, args.items);
  if (r.error) return r;
  const warehouseId = wh.warehouse.id;
  const live = accounts.filter(a => !a.isArchived);
  let account = args.accountId ? live.find(a => a.id === args.accountId) : null;
  if (args.accountId && !account) return { error: 'Счёт не найден — возьми id из list_accounts.' };
  if (!account && wh.warehouse.accountId) account = live.find(a => a.id === wh.warehouse.accountId) || null;
  if (!account && live.length === 1) account = live[0];
  if (!account) return { error: `На какой счёт деньги? Счета: ${live.map(a => a.name).join(', ')} — спроси (list_accounts).` };
  let customer = null;
  if (args.customerId) {
    customer = customers.find(c => c.id === args.customerId);
    if (!customer) return { error: 'Клиент не найден — найди через customer_overview или продай без клиента.' };
  }
  const noPrice = r.lines.filter(l => l.price == null && !(Number(l.product.price) > 0));
  if (noPrice.length) return { error: `Нет цены продажи у: ${noPrice.map(l => l.product.name).join(', ')} — спроси цену.` };
  const short = r.lines.filter(l => stockAt(l.product, warehouseId) - l.quantity < 0);
  if (short.length) return { error: `Не хватает на складе «${wh.warehouse.name}»: ${short.map(l => `${l.product.name} — есть ${qtyText(stockAt(l.product, warehouseId), l.product)}`).join('; ')}.` };
  const items = r.lines.map(l => ({
    productId: l.product.id, name: l.product.name, quantity: l.quantity,
    price: round(l.price != null ? l.price : l.product.price), buyPrice: Number(l.product.buyPrice) || 0, unit: l.product.unit || 'шт',
  }));
  const subtotal = round(items.reduce((n, i) => n + i.price * i.quantity, 0));
  const discount = Math.min(subtotal, Math.max(0, round(args.discount)));
  const total = round(Math.max(0, subtotal - discount));
  const cost = round(items.reduce((n, i) => n + (i.buyPrice || 0) * i.quantity, 0));
  const date = docDate(args.date, now);
  const nowIso = now.toISOString();
  const sale = {
    id: crypto.randomUUID(), userId: ownerId, accountId: account.id,
    ...(customer ? { customerId: customer.id } : {}),
    items, subtotal, discount, total, cost, profit: round(total - cost), isCredit: false,
    ...(args.note ? { note: String(args.note).slice(0, 300) } : {}),
    docNumber: nextReceiptNumber(retailSales), date, createdByUserId: ownerId, createdVia: 'ai',
  };
  const out = { sale, movements: [], products: [] };
  for (const i of items) {
    const product = r.lines.find(l => l.product.id === i.productId).product;
    out.movements.push({
      id: crypto.randomUUID(), userId: ownerId, productId: i.productId, type: 'SALE',
      quantity: -i.quantity, unitPrice: i.price, saleId: sale.id, warehouseId, date, createdByUserId: ownerId,
    });
    out.products.push(applyDelta(product, warehouseId, -i.quantity, nowIso));
  }
  out.summary = `Чек №${sale.docNumber}: ${items.map(i => `${i.name} × ${i.quantity} по ${money(i.price)}`).join('; ')}${discount ? `, скидка ${money(discount)}` : ''} — итого ${money(total)} на счёт «${account.name}»${customer ? `, клиент ${customer.name}` : ''}`;
  return out;
};

/** Отмена: остатки назад на величину каждого движения */
const reverseDeltas = (products, movements, nowIso) => {
  const byId = new Map(products.map(p => [p.id, p]));
  for (const m of movements) {
    const p = byId.get(m.productId);
    if (p) byId.set(p.id, applyDelta(p, m.warehouseId || DEFAULT_WAREHOUSE_ID, -Number(m.quantity), nowIso));
  }
  return [...new Set(movements.map(m => m.productId))].map(id => byId.get(id)).filter(Boolean);
};

module.exports = {
  DEFAULT_WAREHOUSE_ID, WRITE_OFF_REASONS, stockAt, applyDelta, pickWarehouse,
  nextStockDocNumber, nextReceiptNumber, planReceive, planWriteOff, planRetailSale, reverseDeltas,
};
