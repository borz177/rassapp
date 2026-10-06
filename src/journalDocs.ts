import type {
  Customer, Product, RetailSale, Sale, StockLocation, StockMovement, Supplier,
} from '../types';
import { DEFAULT_WAREHOUSE_ID } from '../types';
import { contractNumbers, escapeHtml, retailRemaining, retailReturnedQty } from './utils';
import { openPrintPreview } from '../components/PrintPreview';

export type DocKind = 'SALE' | 'RETURN' | 'CONTRACT' | 'IN' | 'TRANSFER' | 'WRITE_OFF' | 'INVENTORY';

/** Одна строка состава документа — общая для чека и складской накладной. */
export interface DocLine {
  productId?: string;
  name: string;
  quantity: number;
  price: number;
  unit?: string;
}

/**
 * Документ журнала. Продажа и складская накладная приведены к одному виду
 * намеренно: в журнал заходят с вопросом «что за бумага была такого-то числа»,
 * и заставлять человека помнить, в каком из двух списков её искать, значит
 * отвечать на другой вопрос.
 */
export interface JournalDoc {
  id: string;
  kind: DocKind;
  number: string;
  date: string;
  total: number;
  debt: number;
  from: string;
  to: string;
  lines: DocLine[];
  discount: number;
  note?: string;
  authorId?: string;
  customerId?: string;
  sale?: RetailSale;
  /** Движения складского документа — правка меняет их все разом */
  movements?: StockMovement[];
  supplierId?: string;
  /** Товары документа — по ним история товара находит свои бумаги */
  productIds: string[];
  /** Чек: сколько штук каждого товара уже вернули */
  returned?: Record<string, number>;
  /** Возврат: номер чека, по которому он оформлен */
  returnOfNumber?: string;
}

export const KIND_LABEL: Record<DocKind, string> = {
  SALE: 'Продажа',
  RETURN: 'Возврат',
  CONTRACT: 'Договор',
  IN: 'Приход',
  TRANSFER: 'Перемещение',
  WRITE_OFF: 'Списание',
  INVENTORY: 'Инвентаризация',
};

interface BuildArgs {
  retailSales: RetailSale[];
  movements: StockMovement[];
  products: Product[];
  customers: Customer[];
  warehouses: StockLocation[];
  suppliers: Supplier[];
  company: string;
  /** Договоры рассрочки — по ним у отгрузки появляется имя покупателя. */
  contracts?: Sale[];
}

/**
 * Собирает документы магазина из чеков и складских движений.
 *
 * Живёт отдельно от экрана: те же документы нужны и журналу, и истории товара,
 * а две копии этой сборки разошлись бы на первой же правке — и один экран стал
 * бы показывать не то, что другой.
 */
export const buildJournalDocs = ({
  retailSales, movements, products, customers, warehouses, suppliers, company,
  contracts = [],
}: BuildArgs): JournalDoc[] => {
  const productName = (id: string) => products.find(p => p.id === id)?.name || 'Товар удалён';
  const warehouseName = (id?: string) =>
    warehouses.find(w => w.id === id)?.name
    || (id === DEFAULT_WAREHOUSE_ID || !id ? 'Основной склад' : 'Склад удалён');
  const customerName = (id?: string) =>
    customers.find(c => c.id === id)?.name || (id ? 'Клиент удалён' : 'Розничный покупатель');
  // Отгрузка по договору носит номер самого договора, а не свой собственный:
  // это одна и та же бумага, и два разных номера на неё сбивали бы с толку —
  // в списке договоров пятидесятый, а в журнале первый.
  const contractNo = contracts.length > 0 ? contractNumbers(contracts) : {};

  const list: JournalDoc[] = [];

  retailSales.filter(r => !r.isCancelled).forEach(r => {
    // Возврат — своя бумага: от покупателя обратно в магазин, суммы без минуса
    if (r.returnOf) {
      const original = retailSales.find(x => x.id === r.returnOf);
      list.push({
        id: `sale_${r.id}`,
        kind: 'RETURN',
        number: r.docNumber || r.id.slice(0, 6),
        date: r.date,
        total: Math.abs(r.total),
        debt: 0,
        from: customerName(r.customerId),
        to: company,
        lines: r.items.map(i => ({
          productId: i.productId, name: i.name, quantity: Math.abs(i.quantity), price: i.price, unit: i.unit,
        })),
        discount: Math.abs(r.discount),
        note: r.note,
        authorId: r.createdByUserId,
        customerId: r.customerId,
        sale: r,
        productIds: r.items.map(i => i.productId),
        returnOfNumber: original?.docNumber || original?.id.slice(0, 6),
      });
      return;
    }
    list.push({
      returned: retailReturnedQty(r.id, retailSales),
      id: `sale_${r.id}`,
      kind: 'SALE',
      number: r.docNumber || r.id.slice(0, 6),
      date: r.date,
      total: r.total,
      debt: retailRemaining(r),
      from: company,
      to: customerName(r.customerId),
      lines: r.items.map(i => ({
        productId: i.productId, name: i.name, quantity: i.quantity, price: i.price, unit: i.unit,
      })),
      discount: r.discount,
      note: r.note,
      authorId: r.createdByUserId,
      customerId: r.customerId,
      sale: r,
      productIds: r.items.map(i => i.productId),
    });
  });

  // Складские движения одного документа делят batchId — по нему и собираем.
  // Записи без него остались от одиночных корректировок в карточке товара:
  // каждая такая — сама себе документ.
  const batches = new Map<string, StockMovement[]>();
  movements.forEach(m => {
    const key = m.batchId || `single_${m.id}`;
    batches.set(key, [...(batches.get(key) || []), m]);
  });

  batches.forEach((rows, key) => {
    const head = rows[0];
    // Движения розничного чека документом не становятся: чек уже добавлен выше,
    // и вторая запись о той же продаже была бы дублем. А вот отгрузка по договору
    // рассрочки — самостоятельная бумага: договор живёт в другом разделе, и в
    // журнале иначе не видно, что товар ушёл со склада.
    if (!head || (head.type === 'SALE' && !head.contractId)) return;
    // Движения возврата по чеку — тоже часть своего документа «Возврат»
    if (head.type === 'RETURN' && head.saleId) return;

    const k: DocKind =
      head.contractId ? 'CONTRACT'
      : head.type === 'IN' ? 'IN'
      : head.type === 'TRANSFER' ? 'TRANSFER'
      : head.type === 'WRITE_OFF' ? 'WRITE_OFF'
      : 'INVENTORY';

    // У перемещения две записи на каждый товар — берём только расходную,
    // иначе накладная показала бы удвоенное количество.
    const lineRows = k === 'TRANSFER' ? rows.filter(m => m.quantity < 0) : rows;

    const supplier = suppliers.find(x => x.id === head.supplierId);
    const contract = k === 'CONTRACT' ? contracts.find(c => c.id === head.contractId) : undefined;
    const from = k === 'IN'
      ? (supplier?.name || 'Поставщик не указан')
      : warehouseName(head.warehouseId);
    const to = k === 'IN' ? warehouseName(head.warehouseId)
      // Без списка договоров (карточка товара их не грузит) имени покупателя
      // взять негде — тогда честнее назвать бумагу, чем выдумать получателя.
      : k === 'CONTRACT' ? (contract ? customerName(contract.customerId) : 'Договор рассрочки')
      : k === 'TRANSFER' ? warehouseName(head.toWarehouseId)
      : k === 'WRITE_OFF' ? 'Списание'
      : 'Пересчёт';

    list.push({
      id: `doc_${key}`,
      kind: k,
      number: (k === 'CONTRACT' && head.contractId ? contractNo[head.contractId] : '') || head.docNumber || '',
      date: head.date,
      total: rows.reduce((sum, m) => sum + Math.abs(m.quantity) * (m.unitPrice || 0), 0),
      debt: 0,
      from, to,
      lines: lineRows.map(m => ({
        productId: m.productId,
        name: productName(m.productId),
        quantity: Math.abs(m.quantity),
        price: m.unitPrice || 0,
        unit: products.find(p => p.id === m.productId)?.unit,
      })),
      discount: 0,
      note: head.note,
      authorId: head.createdByUserId,
      customerId: contract?.customerId,
      movements: rows,
      supplierId: head.supplierId,
      productIds: Array.from(new Set(rows.map(m => m.productId))),
    });
  });

  const sorted = list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Документам, заведённым до появления нумерации, номер присваиваем по порядку
  // внутри своего вида — от старых к новым. Иначе в журнале рядом с «Приход
  // №0001» стоял бы «Приход 1a3f9c»: обрывок идентификатора вместо номера.
  const counters: Partial<Record<DocKind, number>> = {};
  [...sorted].reverse().forEach(d => {
    if (d.number) return;
    counters[d.kind] = (counters[d.kind] || 0) + 1;
    d.number = String(counters[d.kind]).padStart(4, '0');
  });

  return sorted;
};

/** Что известно о чеке помимо самого документа: для шапки и подвала */
export interface PrintExtra {
  phone?: string;
  cashier?: string;
  accountName?: string;
}

const RECEIPT_FMT_KEY = 'finuchet_receipt_format';

/**
 * Товарный чек — как настоящий: лента 80 или 58 мм для чекового принтера и
 * вариант на A4 с таблицей и подписями. Формат выбирают кнопками над чеком
 * (на печать они не попадают), выбор запоминается на устройстве.
 */
const printReceipt = (d: JournalDoc, extra: PrintExtra): void => {
  const isReturn = d.kind === 'RETURN';
  const sale = d.sale;
  const m2 = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const e = escapeHtml;
  const subtotal = d.lines.reduce((n, l) => n + l.quantity * l.price, 0);
  const when = new Date(d.date);
  const date = when.toLocaleDateString('ru-RU');
  const time = when.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const title = isReturn ? 'Возврат' : 'Товарный чек';
  const buyer = d.customerId ? (isReturn ? d.from : d.to) : '';
  const company = isReturn ? d.to : d.from;
  const paid = sale && sale.isCredit ? (sale.payments || []).reduce((n, p) => n + p.amount, 0) : 0;
  const refund = isReturn ? (sale?.refund ?? d.total) : 0;
  let fmt = '80';
  try { fmt = localStorage.getItem(RECEIPT_FMT_KEY) || '80'; } catch { /* приватный режим */ }

  const items = d.lines.map(l => `
    <div class="it">
      <div class="nm">${e(l.name)}</div>
      <div class="ln"><span>${l.quantity}${l.unit && l.unit !== 'шт' ? ' ' + e(l.unit) : ''} × ${m2(l.price)}</span><b>${m2(l.quantity * l.price)}</b></div>
    </div>`).join('');

  const rowsA4 = d.lines.map((l, i) => `
    <tr><td>${i + 1}</td><td>${e(l.name)}</td><td class="r">${l.quantity} ${e(l.unit || 'шт')}</td>
    <td class="r">${m2(l.price)}</td><td class="r">${m2(l.quantity * l.price)}</td></tr>`).join('');

  const payLines = isReturn
    ? `<div class="kv"><span>Возвращено покупателю</span><b>${m2(refund)} ₽</b></div>
       ${d.total - refund > 0.005 ? `<div class="kv"><span>Списано с долга</span><b>${m2(d.total - refund)} ₽</b></div>` : ''}`
    : sale?.isCredit
      ? `<div class="kv"><span>Продажа в долг</span><b></b></div>
         <div class="kv"><span>Оплачено</span><b>${m2(paid)} ₽</b></div>
         ${d.debt > 0 ? `<div class="kv strong"><span>Долг</span><b>${m2(d.debt)} ₽</b></div>` : ''}`
      : `<div class="kv"><span>Оплачено${extra.accountName ? ` · ${e(extra.accountName)}` : ''}</span><b>${m2(d.total)} ₽</b></div>`;

  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)} №${e(d.number)}</title>
<style id="page"></style>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #eef0f4; color: #111; font: 13px/1.45 -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
         font-variant-numeric: tabular-nums; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .bar { position: sticky; top: 0; z-index: 2; display: flex; justify-content: center; gap: 6px; padding: 12px; background: #eef0f4; }
  .bar button { border: 0; border-radius: 999px; padding: 7px 14px; font: 600 13px/1 inherit; background: #fff; color: #475569; cursor: pointer;
                box-shadow: 0 1px 2px rgba(0,0,0,.08); }
  .bar button.on { background: #111827; color: #fff; }
  .wrap { display: flex; justify-content: center; padding: 8px 12px 40px; }

  /* Лента */
  .paper { width: 80mm; background: #fff; padding: 18px 14px 26px; position: relative;
           box-shadow: 0 10px 30px rgba(15,23,42,.12); border-radius: 4px 4px 0 0; }
  .paper::after { content: ""; position: absolute; left: 0; right: 0; bottom: -8px; height: 8px;
    background: linear-gradient(-45deg, transparent 6px, #fff 0) 0 0/12px 8px repeat-x,
                linear-gradient(45deg, transparent 6px, #fff 0) 0 0/12px 8px repeat-x; }
  .f58 .paper { width: 58mm; padding: 14px 8px 22px; font-size: 11.5px; }
  .co { text-align: center; font-size: 17px; font-weight: 800; letter-spacing: .2px; line-height: 1.2; }
  .f58 .co { font-size: 14px; }
  .sub { text-align: center; color: #555; font-size: 11.5px; margin-top: 3px; }
  .ttl { text-align: center; margin: 12px 0 2px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; font-size: 12px; }
  .ret { color: #b91c1c; }
  .meta { text-align: center; color: #555; font-size: 11.5px; }
  .hr { border: 0; border-top: 1px dashed #9ca3af; margin: 10px 0; }
  .kv { display: flex; justify-content: space-between; gap: 8px; margin: 2px 0; }
  .kv span { color: #444; }
  .kv.strong span, .kv.strong b { color: #b45309; }
  .it { margin: 0 0 7px; }
  .nm { font-weight: 600; word-break: break-word; }
  .ln { display: flex; justify-content: space-between; gap: 8px; color: #444; }
  .ln b { color: #111; }
  .tot { display: flex; justify-content: space-between; align-items: baseline; margin: 6px 0 4px; }
  .tot span { font-weight: 800; letter-spacing: 1px; text-transform: uppercase; }
  .tot b { font-size: 22px; font-weight: 800; }
  .f58 .tot b { font-size: 18px; }
  .thanks { text-align: center; margin-top: 14px; font-weight: 700; }
  .fine { text-align: center; color: #888; font-size: 10px; margin-top: 4px; }
  .note { color: #444; font-style: italic; margin-top: 6px; word-break: break-word; }

  /* A4 */
  .a4 { display: none; width: 100%; max-width: 190mm; background: #fff; padding: 16mm 14mm; box-shadow: 0 10px 30px rgba(15,23,42,.12); }
  .fa4 .paper { display: none; } .fa4 .a4 { display: block; }
  .a4 .hd { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 10px; }
  .a4 h1 { margin: 0; font-size: 22px; } .a4 .muted { color: #555; font-size: 12px; }
  .a4 table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12.5px; }
  .a4 th, .a4 td { border-bottom: 1px solid #ddd; padding: 7px 6px; text-align: left; }
  .a4 th { font-size: 11px; text-transform: uppercase; color: #666; letter-spacing: .5px; }
  .a4 .r { text-align: right; }
  .a4 .sum { margin-left: auto; width: 260px; margin-top: 12px; }
  .a4 .sum .tot b { font-size: 20px; }
  .a4 .sign { display: flex; gap: 40px; margin-top: 46px; font-size: 12px; color: #444; }
  .a4 .sign div { flex: 1; border-top: 1px solid #999; padding-top: 4px; }

  @media print {
    body { background: #fff; }
    .bar { display: none; }
    .wrap { padding: 0; display: block; }
    .paper { box-shadow: none; border-radius: 0; margin: 0; }
    .paper::after { display: none; }
    .a4 { box-shadow: none; padding: 0; max-width: none; }
  }
</style></head>
<body class="f${fmt === '58' ? '58' : fmt === 'a4' ? 'a4' : '80'}">
  <div class="bar">
    <button data-f="80">Лента 80 мм</button><button data-f="58">58 мм</button><button data-f="a4">A4</button>
  </div>
  <div class="wrap">
    <div class="paper">
      <div class="co">${e(company)}</div>
      ${extra.phone ? `<div class="sub">${e(extra.phone)}</div>` : ''}
      <div class="ttl ${isReturn ? 'ret' : ''}">${e(title)} № ${e(d.number)}</div>
      ${isReturn && d.returnOfNumber ? `<div class="meta">по чеку № ${e(d.returnOfNumber)}</div>` : ''}
      <div class="meta">${date} · ${time}</div>
      <hr class="hr">
      ${extra.cashier ? `<div class="kv"><span>Кассир</span><b>${e(extra.cashier)}</b></div>` : ''}
      ${buyer ? `<div class="kv"><span>Покупатель</span><b>${e(buyer)}</b></div>` : ''}
      ${extra.cashier || buyer ? '<hr class="hr">' : ''}
      ${items}
      <hr class="hr">
      ${d.discount > 0.005 ? `<div class="kv"><span>Сумма</span><b>${m2(subtotal)}</b></div>
        <div class="kv"><span>Скидка</span><b>−${m2(d.discount)}</b></div>` : ''}
      <div class="tot"><span>${isReturn ? 'К возврату' : 'Итого'}</span><b>${m2(d.total)} ₽</b></div>
      ${payLines}
      ${d.note ? `<div class="note">${e(d.note)}</div>` : ''}
      <hr class="hr">
      <div class="thanks">${isReturn ? 'Возврат оформлен' : 'Спасибо за покупку!'}</div>
      <div class="fine">Товарный чек · не является кассовым чеком</div>
    </div>

    <div class="a4">
      <div class="hd">
        <div><h1 class="${isReturn ? 'ret' : ''}">${e(title)} № ${e(d.number)}</h1>
          <div class="muted">от ${date} ${time}${isReturn && d.returnOfNumber ? ` · по чеку № ${e(d.returnOfNumber)}` : ''}</div></div>
        <div style="text-align:right"><b>${e(company)}</b>${extra.phone ? `<div class="muted">${e(extra.phone)}</div>` : ''}</div>
      </div>
      ${buyer ? `<p class="muted" style="margin-top:10px">Покупатель: <b style="color:#111">${e(buyer)}</b></p>` : ''}
      <table>
        <thead><tr><th>№</th><th>Наименование</th><th class="r">Кол-во</th><th class="r">Цена, ₽</th><th class="r">Сумма, ₽</th></tr></thead>
        <tbody>${rowsA4}</tbody>
      </table>
      <div class="sum">
        ${d.discount > 0.005 ? `<div class="kv"><span>Сумма</span><b>${m2(subtotal)} ₽</b></div>
          <div class="kv"><span>Скидка</span><b>−${m2(d.discount)} ₽</b></div>` : ''}
        <div class="tot"><span>${isReturn ? 'К возврату' : 'Итого'}</span><b>${m2(d.total)} ₽</b></div>
        ${payLines}
      </div>
      ${d.note ? `<p class="note">${e(d.note)}</p>` : ''}
      <div class="sign"><div>${isReturn ? 'Принял' : 'Продавец'}${extra.cashier ? ` · ${e(extra.cashier)}` : ''}</div><div>${isReturn ? 'Получил покупатель' : 'Покупатель'}</div></div>
    </div>
  </div>
<script>
  (function () {
    var KEY = '${RECEIPT_FMT_KEY}';
    var page = document.getElementById('page');
    function apply(f) {
      document.body.className = 'f' + f;
      page.textContent = f === 'a4' ? '@page { size: A4; margin: 12mm; }' : '@page { margin: 0; }';
      Array.prototype.forEach.call(document.querySelectorAll('.bar button'), function (b) {
        b.className = b.getAttribute('data-f') === f ? 'on' : '';
      });
      try { localStorage.setItem(KEY, f); } catch (e) {}
    }
    Array.prototype.forEach.call(document.querySelectorAll('.bar button'), function (b) {
      b.addEventListener('click', function () { apply(b.getAttribute('data-f')); });
    });
    apply('${fmt === '58' || fmt === 'a4' ? fmt : '80'}');
  })();
</script>
</body></html>`;

  openPrintPreview(html, { title: `${title} №${d.number}` });
};

/**
 * Документ в окне печати. Чек и возврат — товарным чеком (лента или A4),
 * складские бумаги — накладной на лист. Разметка строкой, а не блоком на
 * странице: у документа своя вёрстка, и её правила не должны спорить с тёмной
 * темой приложения.
 */
export const printJournalDoc = (d: JournalDoc, extra: PrintExtra = {}): void => {
  if (d.kind === 'SALE' || d.kind === 'RETURN') { printReceipt(d, extra); return; }
  // Всё, что ввёл человек, — через escapeHtml. Документ открывается во фрейме
  // того же сайта, и название товара вида «<img onerror=…>» иначе выполнилось
  // бы как код внутри приложения.
  const rows = d.lines.map((l, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(l.name)}</td>
      <td class="r">${l.quantity} ${escapeHtml(l.unit || 'шт')}</td>
      <td class="r">${l.price.toLocaleString('ru-RU')}</td>
      <td class="r">${(l.quantity * l.price).toLocaleString('ru-RU')}</td>
    </tr>`).join('');

  const title = `${KIND_LABEL[d.kind]} №${escapeHtml(d.number)}`;
  // Просмотром поверх приложения, а не новым окном: в приложении с экрана
  // «Домой» и в APK у окна нет кнопки «назад», и выйти можно было только перезапуском.
  openPrintPreview(`<!doctype html><html lang="ru"><head><meta charset="utf-8">
    <title>${title}</title>
    <style>
      body { font: 14px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; color: #111; padding: 32px; }
      h1 { font-size: 20px; margin: 0 0 4px; }
      .muted { color: #666; font-size: 13px; }
      table { width: 100%; border-collapse: collapse; margin-top: 20px; }
      th, td { border-bottom: 1px solid #ddd; padding: 8px 6px; text-align: left; }
      th { font-size: 12px; text-transform: uppercase; color: #666; }
      .r { text-align: right; }
      .total { margin-top: 16px; text-align: right; font-size: 18px; font-weight: 700; }
      .debt { text-align: right; color: #b45309; font-weight: 700; }
    </style></head><body>
    <h1>${title}</h1>
    <p class="muted">${new Date(d.date).toLocaleString('ru-RU')}</p>
    <p class="muted">${escapeHtml(d.from)} → ${escapeHtml(d.to)}</p>
    <table>
      <thead><tr><th>№</th><th>Наименование</th><th class="r">Кол-во</th><th class="r">Цена</th><th class="r">Сумма</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${d.discount > 0 ? `<p class="muted r">Скидка −${d.discount.toLocaleString('ru-RU')} ₽</p>` : ''}
    <p class="total">Итого: ${d.total.toLocaleString('ru-RU')} ₽</p>
    ${d.debt > 0 ? `<p class="debt">Долг: ${d.debt.toLocaleString('ru-RU')} ₽</p>` : ''}
    ${d.note ? `<p class="muted">${escapeHtml(d.note)}</p>` : ''}
  </body></html>`, { title: `${KIND_LABEL[d.kind]} №${d.number}` });
};
