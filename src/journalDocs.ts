import type {
  Customer, Product, RetailSale, Sale, StockLocation, StockMovement, Supplier,
} from '../types';
import { DEFAULT_WAREHOUSE_ID } from '../types';
import { contractNumbers, retailRemaining } from './utils';

export type DocKind = 'SALE' | 'CONTRACT' | 'IN' | 'TRANSFER' | 'WRITE_OFF' | 'INVENTORY';

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
}

export const KIND_LABEL: Record<DocKind, string> = {
  SALE: 'Продажа',
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
    list.push({
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

/**
 * Товарный чек в отдельном окне печати. Собираем разметку строкой, а не прячем
 * блок на странице: у документа своя вёрстка под лист, и её правила не должны
 * спорить с тёмной темой приложения.
 */
export const printJournalDoc = (d: JournalDoc): void => {
  const rows = d.lines.map((l, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${l.name}</td>
      <td class="r">${l.quantity} ${l.unit || 'шт'}</td>
      <td class="r">${l.price.toLocaleString('ru-RU')}</td>
      <td class="r">${(l.quantity * l.price).toLocaleString('ru-RU')}</td>
    </tr>`).join('');

  const win = window.open('', '_blank', 'width=760,height=900');
  if (!win) return;
  win.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8">
    <title>${KIND_LABEL[d.kind]} №${d.number}</title>
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
    <h1>${KIND_LABEL[d.kind]} №${d.number}</h1>
    <p class="muted">${new Date(d.date).toLocaleString('ru-RU')}</p>
    <p class="muted">${d.from} → ${d.to}</p>
    <table>
      <thead><tr><th>№</th><th>Наименование</th><th class="r">Кол-во</th><th class="r">Цена</th><th class="r">Сумма</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${d.discount > 0 ? `<p class="muted r">Скидка −${d.discount.toLocaleString('ru-RU')} ₽</p>` : ''}
    <p class="total">Итого: ${d.total.toLocaleString('ru-RU')} ₽</p>
    ${d.debt > 0 ? `<p class="debt">Долг: ${d.debt.toLocaleString('ru-RU')} ₽</p>` : ''}
    ${d.note ? `<p class="muted">${d.note}</p>` : ''}
  </body></html>`);
  win.document.close();
  win.focus();
  win.print();
};
