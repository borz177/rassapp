/**
 * Сквозной поиск по своим данным.
 *
 * Ищем в памяти, а не на сервере: приложение и так держит клиентов, договоры,
 * товары и операции в состоянии (см. App.tsx) и повторяет их в браузере для
 * работы без сети. Значит выдача появляется мгновенно и в офлайне, а сервер
 * ничего не считает. Заодно это решает вопрос прав: сотруднику сюда попадает
 * ровно то, что ему и так открыто, — других данных у него на руках нет.
 *
 * Правило одно: ищем так, как человек помнит. Телефон он диктует в любом виде,
 * договор называет номером, товар — словом с коробки, а сумму — «сорок тысяч».
 */

import { Customer, Sale, Product, Expense } from '../types';
import { contractNumberFor } from './utils';

export type SearchKind = 'customer' | 'contract' | 'product' | 'operation';

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  /** Чем меньше, тем выше в списке */
  rank: number;
  /** Для перехода: у договора и операции нужен ещё и клиент */
  customerId?: string;
}

export interface SearchData {
  customers: Customer[];
  sales: Sale[];
  products?: Product[];
  expenses?: Expense[];
}

const KIND_ORDER: Record<SearchKind, number> = { customer: 0, contract: 1, product: 2, operation: 3 };

/** Только цифры — телефон человек диктует как придётся. */
const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');

const lower = (value: unknown) => String(value ?? '').toLowerCase().trim();

/**
 * Ключ телефона для сравнения — последние десять цифр.
 *
 * Один и тот же номер записывают и как +7 965…, и как 8 965…, и вовсе без кода
 * страны. Первая цифра у восьмёрки и семёрки разная, поэтому сравнивать номера
 * целиком нельзя: продавец набирает «8965…», а в карточке «+7 965…» — и клиент
 * «не находится», хотя он есть.
 */
const phoneKey = (value: unknown) => {
  const d = digits(value);
  return d.length >= 10 ? d.slice(-10) : d;
};

/**
 * Совпадение по тексту. Начало слова ценнее середины: «иван» должен сперва
 * показать Иванова, а уже потом Селиванова.
 */
const textRank = (haystack: string, needle: string): number | null => {
  if (!needle) return null;
  const at = haystack.indexOf(needle);
  if (at < 0) return null;
  if (at === 0) return 0;
  return /\s/.test(haystack[at - 1]) ? 1 : 2;
};

const money = (value: unknown) => Math.round(Number(value) || 0);

/** Человеческая дата без года, если он текущий: «14 мар» или «14 мар 2025». */
const shortDate = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'short',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
};

const amount = (value: number) => value.toLocaleString('ru-RU');

export interface SearchOptions {
  /** Сколько показать в каждой группе */
  perKind?: number;
  /** Искать ли в расходах и прочих приходах: их много, и в выдаче они шумят */
  includeOperations?: boolean;
}

/**
 * Что вообще ищем в этом запросе.
 *
 * Строка «14» — это и номер договора, и сумма, и кусок телефона. Разбираться
 * заранее не нужно: проверяем все толкования, а порядок наводит rank.
 */
export const search = (query: string, data: SearchData, options: SearchOptions = {}): SearchHit[] => {
  const perKind = options.perKind ?? 5;
  const text = lower(query);
  if (text.length < 2) return [];

  const queryDigits = digits(query);
  // Телефон узнаём по длине: 4 цифры — это ещё и номер договора, и сумма,
  // а вот 6 подряд человек набирает, когда ищет именно по номеру.
  const asPhone = queryDigits.length >= 6 ? phoneKey(query) : '';
  const asNumber = /^\d+$/.test(text) ? Number(text) : null;

  const customers = data.customers || [];
  const sales = data.sales || [];
  const byId = new Map(customers.map(c => [c.id, c]));
  const hits: SearchHit[] = [];

  // ── клиенты ──────────────────────────────────────────────────────────────
  for (const customer of customers) {
    const name = lower(customer.name);
    const phone = phoneKey(customer.phone);
    let rank = textRank(name, text);
    if (rank === null && asPhone && phone.includes(asPhone)) rank = 0;
    // Короткий хвост номера тоже узнаваем: «0077» — как запомнил продавец.
    if (rank === null && queryDigits.length >= 3 && phone.endsWith(queryDigits)) rank = 1;
    if (rank === null) continue;

    const contracts = sales.filter(s => s.customerId === customer.id && !String(s.customerId).startsWith('system_'));
    const debt = contracts.reduce((sum, s) => sum + (Number(s.remainingAmount) || 0), 0);
    hits.push({
      kind: 'customer',
      id: customer.id,
      title: customer.name || 'Без имени',
      subtitle: [
        customer.phone,
        contracts.length ? `договоров: ${contracts.length}` : 'без договоров',
        debt > 0 ? `долг ${amount(money(debt))} ₽` : '',
      ].filter(Boolean).join(' · '),
      rank,
      customerId: customer.id,
    });
  }

  // ── договоры ─────────────────────────────────────────────────────────────
  for (const sale of sales) {
    // Прочий приход хранится записью того же вида, но договором не является.
    if (String(sale.customerId || '').startsWith('system_')) continue;

    const customer = byId.get(sale.customerId);
    const product = lower(sale.productName);
    const customerName = lower(customer?.name);
    const number = contractNumberFor(sales, sale) || '';

    let rank = textRank(product, text);
    if (rank === null) {
      const byName = textRank(customerName, text);
      // Договор по имени клиента — ниже самого клиента, иначе выдача заполнена
      // одним человеком.
      if (byName !== null) rank = byName + 1;
    }
    if (rank === null && asNumber !== null && number && Number(number) === asNumber) rank = 0;
    if (rank === null && asNumber !== null && money(sale.totalAmount) === asNumber) rank = 2;
    if (rank === null && asPhone && phoneKey(customer?.phone).includes(asPhone)) rank = 2;
    if (rank === null) continue;

    const remaining = money(sale.remainingAmount);
    hits.push({
      kind: 'contract',
      id: sale.id,
      title: number ? `№${number} · ${sale.productName || 'Без названия'}` : (sale.productName || 'Без названия'),
      subtitle: [
        customer?.name,
        sale.status === 'COMPLETED' ? 'закрыт' : remaining > 0 ? `долг ${amount(remaining)} ₽` : 'оплачен',
        shortDate(sale.startDate),
      ].filter(Boolean).join(' · '),
      rank,
      customerId: sale.customerId,
    });
  }

  // ── товары ───────────────────────────────────────────────────────────────
  for (const product of data.products || []) {
    const name = lower(product.name);
    const sku = lower(product.sku);
    let rank = textRank(name, text);
    if (rank === null && sku && sku === text) rank = 0;
    // Штрихкод сравниваем целиком: отсканированный код совпадает точно, а
    // «похожие» коды — это другой товар.
    if (rank === null && queryDigits && (product.barcodes || []).some(b => digits(b) === queryDigits)) rank = 0;
    if (rank === null) continue;

    hits.push({
      kind: 'product',
      id: product.id,
      title: product.name || 'Без названия',
      subtitle: [
        `остаток ${Number(product.stock) || 0}`,
        product.price ? `${amount(money(product.price))} ₽` : '',
        product.sku ? `арт. ${product.sku}` : '',
      ].filter(Boolean).join(' · '),
      rank,
    });
  }

  // ── расходы и прочий приход ──────────────────────────────────────────────
  if (options.includeOperations) {
    for (const expense of data.expenses || []) {
      const title = lower(expense.title);
      let rank = textRank(title, text);
      if (rank === null && asNumber !== null && money(expense.amount) === asNumber) rank = 1;
      if (rank === null) continue;
      hits.push({
        kind: 'operation',
        id: expense.id,
        title: expense.title || 'Расход',
        subtitle: [`− ${amount(money(expense.amount))} ₽`, expense.category, shortDate(expense.date)]
          .filter(Boolean).join(' · '),
        rank: rank + 1,
      });
    }

    for (const sale of sales) {
      if (!String(sale.customerId || '').startsWith('system_')) continue;
      const title = lower(sale.productName);
      let rank = textRank(title, text);
      if (rank === null && asNumber !== null && money(sale.totalAmount) === asNumber) rank = 1;
      if (rank === null) continue;
      hits.push({
        kind: 'operation',
        id: sale.id,
        title: sale.productName || 'Приход',
        subtitle: [`+ ${amount(money(sale.totalAmount))} ₽`, shortDate(sale.startDate)]
          .filter(Boolean).join(' · '),
        rank: rank + 1,
      });
    }
  }

  // Сортировка: сначала по совпадению, потом по виду записи, потом по алфавиту —
  // чтобы при равных условиях порядок не прыгал от запроса к запросу.
  hits.sort((a, b) =>
    a.rank - b.rank ||
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    a.title.localeCompare(b.title, 'ru'));

  // Ограничиваем каждую группу: длинная простыня мешает не меньше, чем пустая.
  const shown: Record<string, number> = {};
  return hits.filter(hit => {
    shown[hit.kind] = (shown[hit.kind] || 0) + 1;
    return shown[hit.kind] <= perKind;
  });
};

export const KIND_TITLES: Record<SearchKind, string> = {
  customer: 'Клиенты',
  contract: 'Договоры',
  product: 'Товары',
  operation: 'Операции',
};

/** Разложить выдачу по группам, сохранив порядок внутри. */
export const groupHits = (hits: SearchHit[]): { kind: SearchKind; items: SearchHit[] }[] => {
  const order: SearchKind[] = ['customer', 'contract', 'product', 'operation'];
  return order
    .map(kind => ({ kind, items: hits.filter(h => h.kind === kind) }))
    .filter(group => group.items.length > 0);
};
