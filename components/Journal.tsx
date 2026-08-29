import React, { useMemo, useState } from 'react';
import type {
  Account, AppSettings, Customer, Product, RetailSale, StockLocation, StockMovement, Supplier, User,
} from '../types';
import { DEFAULT_WAREHOUSE_ID } from '../types';
import { formatCurrency, retailPaidAmount, retailRemaining } from '../src/utils';
import TopBarBack from './TopBarBack';
import { useBackInterceptor } from './transitions/PagePush';
import ModalPortal from './ModalPortal';
import TabPill from './TabPill';

interface JournalProps {
  retailSales: RetailSale[];
  movements: StockMovement[];
  products: Product[];
  customers: Customer[];
  warehouses: StockLocation[];
  suppliers: Supplier[];
  accounts: Account[];
  employees?: User[];
  appSettings: AppSettings;
  user?: User | null;
  onBack: () => void;
  onSelectCustomer?: (id: string) => void;
  onAcceptPayment?: (sale: RetailSale) => void;
}

type DocKind = 'SALE' | 'IN' | 'TRANSFER' | 'WRITE_OFF' | 'INVENTORY';
type PayFilter = 'ALL' | 'DEBT' | 'PAID';

/** Одна строка состава документа — общая для чека и складской накладной. */
interface DocLine {
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
interface JournalDoc {
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
}

const KIND_LABEL: Record<DocKind, string> = {
  SALE: 'Продажа',
  IN: 'Приход',
  TRANSFER: 'Перемещение',
  WRITE_OFF: 'Списание',
  INVENTORY: 'Инвентаризация',
};

const KIND_FILTERS: { id: 'ALL' | DocKind; label: string }[] = [
  { id: 'ALL', label: 'Все' },
  { id: 'SALE', label: 'Продажи' },
  { id: 'IN', label: 'Приход' },
  { id: 'TRANSFER', label: 'Перемещение' },
  { id: 'WRITE_OFF', label: 'Списание' },
  { id: 'INVENTORY', label: 'Инвентаризация' },
];

const dayKey = (d: string) => new Date(d).toISOString().slice(0, 10);

const dayTitle = (key: string) => {
  const d = new Date(`${key}T12:00:00`);
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
};

const timeOf = (d: string) =>
  new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

/**
 * Журнал документов магазина.
 *
 * Собирает в одну ленту то, что до сих пор было разложено по экранам: чеки
 * лежали в кассе и отчётах, складские накладные — только внутри операций, и
 * увидеть «что происходило 17 июля» было негде.
 *
 * Складские движения собираются в документы по batchId — так их и проводили,
 * одной накладной. Строка на каждое движение превратила бы приход из двадцати
 * позиций в двадцать записей журнала.
 */
const Journal: React.FC<JournalProps> = ({
  retailSales, movements, products, customers, warehouses, suppliers, accounts,
  employees = [], appSettings, user, onBack, onSelectCustomer, onAcceptPayment,
}) => {
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'ALL' | DocKind>('ALL');
  const [pay, setPay] = useState<PayFilter>('ALL');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'INFO' | 'PAY'>('INFO');
  const [menuFor, setMenuFor] = useState<JournalDoc | null>(null);

  const cents = appSettings.showCents;
  const company = appSettings.companyName || 'Магазин';

  const productName = (id: string) => products.find(p => p.id === id)?.name || 'Товар удалён';
  const warehouseName = (id?: string) =>
    warehouses.find(w => w.id === id)?.name
    || (id === DEFAULT_WAREHOUSE_ID || !id ? 'Основной склад' : 'Склад удалён');
  const customerName = (id?: string) =>
    customers.find(c => c.id === id)?.name || (id ? 'Клиент удалён' : 'Розничный покупатель');
  const authorName = (id?: string) => {
    if (!id) return null;
    if (id === user?.id) return user?.name || null;
    return employees.find(e => e.id === id)?.name || null;
  };

  const docs = useMemo<JournalDoc[]>(() => {
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
        lines: r.items.map(i => ({ name: i.name, quantity: i.quantity, price: i.price, unit: i.unit })),
        discount: r.discount,
        note: r.note,
        authorId: r.createdByUserId,
        customerId: r.customerId,
        sale: r,
      });
    });

    // Складские движения одного документа делят batchId — по нему и собираем.
    // Записи без него остались от одиночных корректировок в карточке товара:
    // каждая такая — сама себе документ.
    const batches = new Map<string, StockMovement[]>();
    movements.forEach(m => {
      const key = m.batchId || `single_${m.id}`;
      const arr = batches.get(key) || [];
      arr.push(m);
      batches.set(key, arr);
    });

    batches.forEach((rows, key) => {
      const head = rows[0];
      if (!head || head.type === 'SALE') return;

      const kindOf = (): DocKind =>
        head.type === 'IN' ? 'IN'
        : head.type === 'TRANSFER' ? 'TRANSFER'
        : head.type === 'WRITE_OFF' ? 'WRITE_OFF'
        : 'INVENTORY';
      const k = kindOf();

      // У перемещения две записи на каждый товар — берём только расходную,
      // иначе накладная показала бы удвоенное количество.
      const lineRows = k === 'TRANSFER' ? rows.filter(m => m.quantity < 0) : rows;

      const supplier = suppliers.find(x => x.id === head.supplierId);
      const from = k === 'IN'
        ? (supplier?.name || 'Поставщик не указан')
        : warehouseName(head.warehouseId);
      const to = k === 'IN' ? warehouseName(head.warehouseId)
        : k === 'TRANSFER' ? warehouseName(head.toWarehouseId)
        : k === 'WRITE_OFF' ? 'Списание'
        : 'Пересчёт';

      list.push({
        id: `doc_${key}`,
        kind: k,
        number: head.batchId ? head.batchId.replace('doc_', '').slice(-6) : head.id.slice(0, 6),
        date: head.date,
        total: rows.reduce((sum, m) => sum + Math.abs(m.quantity) * (m.unitPrice || 0), 0),
        debt: 0,
        from, to,
        lines: lineRows.map(m => ({
          name: productName(m.productId),
          quantity: Math.abs(m.quantity),
          price: m.unitPrice || 0,
          unit: products.find(p => p.id === m.productId)?.unit,
        })),
        discount: 0,
        note: head.note,
        authorId: head.createdByUserId,
      });
    });

    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [retailSales, movements, products, customers, warehouses, suppliers, company, user, employees]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs
      .filter(d => kind === 'ALL' || d.kind === kind)
      .filter(d => pay === 'ALL' || (pay === 'DEBT' ? d.debt > 0 : d.debt === 0))
      .filter(d => !q
        || d.number.toLowerCase().includes(q)
        || d.to.toLowerCase().includes(q)
        || d.from.toLowerCase().includes(q)
        || (d.note || '').toLowerCase().includes(q)
        || d.lines.some(l => l.name.toLowerCase().includes(q)));
  }, [docs, kind, pay, search]);

  const groups = useMemo(() => {
    const map = new Map<string, JournalDoc[]>();
    visible.forEach(d => {
      const key = dayKey(d.date);
      map.set(key, [...(map.get(key) || []), d]);
    });
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [visible]);

  const totals = useMemo(() => ({
    count: visible.length,
    debt: visible.reduce((sum, d) => sum + d.debt, 0),
  }), [visible]);

  const opened = docs.find(d => d.id === openId) || null;

  // Пока открыт документ, «назад» возвращает к ленте, а не закрывает журнал.
  useBackInterceptor(!!opened, () => setOpenId(null));

  const filtersActive = kind !== 'ALL' || pay !== 'ALL';

  /**
   * Товарный чек в отдельном окне печати. Собирать разметку строкой, а не
   * прятать блок на странице: у документа своя вёрстка под лист, и её правила
   * не должны спорить с тёмной темой приложения.
   */
  const printDoc = (d: JournalDoc) => {
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

  // ─── Карточка документа ───────────────────────────────────────────────────
  if (opened) {
    const paid = opened.sale ? retailPaidAmount(opened.sale) : 0;
    const author = authorName(opened.authorId);
    const accountName = opened.sale
      ? accounts.find(a => a.id === opened.sale!.accountId)?.name || 'Счёт удалён'
      : null;

    const row = (label: string, value: React.ReactNode, sub?: string) => (
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="font-semibold text-slate-800 dark:text-white truncate">{value}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{sub || label}</p>
        </div>
      </div>
    );

    return (
      <div className="space-y-4 pb-10">
        <div className="flex items-center gap-3">
          <TopBarBack onClick={() => setOpenId(null)} />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-slate-800 dark:text-white truncate">
              {KIND_LABEL[opened.kind]} №{opened.number}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {new Date(opened.date).toLocaleString('ru-RU', {
                day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
            </p>
          </div>
          <button onClick={() => printDoc(opened)}
                  className="shrink-0 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm font-bold">
            Печать
          </button>
        </div>

        {/* Вкладка оплаты нужна только там, где деньги вообще есть: у списания
            или перемещения она была бы пустой страницей с прочерками. */}
        {opened.kind === 'SALE' ? (
          <div className="relative flex p-1 rounded-[24px] bg-white/60 dark:bg-slate-800/60 border border-white/70 dark:border-slate-700 shadow-sm">
            <TabPill index={detailTab === 'INFO' ? 0 : 1} count={2} pad={4} />
            {([['INFO', 'Информация'], ['PAY', 'Оплата']] as const).map(([id, label]) => (
              <button key={id} onClick={() => setDetailTab(id)}
                      className={`relative z-10 flex-1 min-w-0 py-2.5 text-sm font-bold rounded-xl transition-colors ${
                        detailTab === id ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400'
                      }`}>{label}</button>
            ))}
          </div>
        ) : null}

        {(opened.kind !== 'SALE' || detailTab === 'INFO') && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center text-white ${
                  opened.debt > 0 ? 'bg-amber-500' : 'bg-emerald-500'
                }`}>✓</div>
                <div>
                  <p className="font-semibold text-slate-800 dark:text-white">
                    {opened.debt > 0 ? 'Проведён, есть долг' : 'Проведён'}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Статус документа</p>
                </div>
              </div>
              {author && row('Автор', author)}
            </div>

            <div>
              <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2 px-1">Контрагенты</p>
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
                {row(opened.kind === 'IN' ? 'Поставщик' : 'Откуда', opened.from,
                     opened.kind === 'IN' ? 'Поставщик' : opened.kind === 'SALE' ? 'Продавец' : 'Откуда')}
                {opened.customerId && onSelectCustomer ? (
                  <button onClick={() => onSelectCustomer(opened.customerId!)}
                          className="w-full text-left active:bg-slate-50 dark:active:bg-slate-700/50">
                    {row('Клиент', opened.to, 'Клиент · открыть карточку')}
                  </button>
                ) : row('Куда', opened.to, opened.kind === 'SALE' ? 'Покупатель' : 'Куда')}
                {accountName && row('Счёт', accountName, 'Счёт')}
              </div>
            </div>

            <div>
              <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2 px-1">Товары</p>
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
                {opened.lines.map((l, i) => (
                  <div key={`${l.name}_${i}`} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800 dark:text-white truncate">{l.name}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {l.quantity} {l.unit || 'шт'}{l.price > 0 ? ` × ${formatCurrency(l.price, cents)} ₽` : ''}
                      </p>
                    </div>
                    {l.price > 0 && (
                      <p className="font-bold text-slate-800 dark:text-white shrink-0">
                        {formatCurrency(l.quantity * l.price, cents)} ₽
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4">
              {opened.discount > 0 && (
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-500 dark:text-slate-400">Скидка</span>
                  <span className="font-semibold text-amber-600 dark:text-amber-400">
                    −{formatCurrency(opened.discount, cents)} ₽
                  </span>
                </div>
              )}
              <div className="flex justify-between items-end">
                <span className="text-slate-500 dark:text-slate-400 text-sm">Итого</span>
                <span className="text-2xl font-extrabold text-slate-800 dark:text-white">
                  {formatCurrency(opened.total, cents)} ₽
                </span>
              </div>
            </div>

            {opened.note && (
              <p className="text-sm text-slate-500 dark:text-slate-400 px-1">{opened.note}</p>
            )}
          </div>
        )}

        {opened.kind === 'SALE' && detailTab === 'PAY' && opened.sale && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 dark:text-slate-400">Сумма документа</span>
                <span className="font-bold text-slate-800 dark:text-white">{formatCurrency(opened.total, cents)} ₽</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 dark:text-slate-400">Оплачено</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(opened.sale.isCredit ? paid : opened.total, cents)} ₽
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 dark:text-slate-400">Долг</span>
                <span className={`font-bold ${opened.debt > 0 ? 'text-rose-500' : 'text-slate-400'}`}>
                  {formatCurrency(opened.debt, cents)} ₽
                </span>
              </div>
            </div>

            {opened.sale.isCredit ? (
              <div>
                <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2 px-1">Поступления</p>
                {(opened.sale.payments || []).length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400 px-1">Оплат пока не было.</p>
                ) : (
                  <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
                    {opened.sale.payments!.map(pm => (
                      <div key={pm.id} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-emerald-600 dark:text-emerald-400">
                            +{formatCurrency(pm.amount, cents)} ₽
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {new Date(pm.date).toLocaleDateString('ru-RU')}
                            {' · '}{accounts.find(a => a.id === pm.accountId)?.name || 'Счёт удалён'}
                            {pm.note ? ` · ${pm.note}` : ''}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400 px-1">
                Оплачено при продаже — деньги поступили на счёт сразу.
              </p>
            )}

            {opened.debt > 0 && onAcceptPayment && (
              <button onClick={() => onAcceptPayment(opened.sale!)}
                      className="w-full py-3.5 rounded-2xl bg-amber-600 text-white font-bold active:scale-[0.99] transition-transform">
                Принять оплату
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ─── Лента документов ─────────────────────────────────────────────────────
  return (
    <div className="space-y-3 pb-10">
      <div className="flex items-center gap-3">
        <TopBarBack onClick={onBack} />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">Журнал</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {totals.count} докум.{totals.debt > 0 ? ` · долг ${formatCurrency(totals.debt, cents)} ₽` : ''}
          </p>
        </div>
        <button onClick={() => setFiltersOpen(true)}
                className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                  filtersActive
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'
                }`}
                aria-label="Фильтры">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
          </svg>
        </button>
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)}
             placeholder="Поиск по номеру, клиенту или товару"
             className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200 outline-none focus:border-indigo-400" />

      {groups.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 py-10 text-center">
          {docs.length === 0 ? 'Документов пока нет.' : 'Ничего не найдено.'}
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map(([key, items]) => (
            <div key={key}>
              {/* Заголовок дня липкий: в длинной ленте иначе теряется, за какое
                  число сейчас идут строки. */}
              <div className="sticky top-0 z-10 -mx-1 px-1 py-1.5 bg-slate-50/90 dark:bg-slate-900/90 backdrop-blur-sm">
                <p className="text-sm font-bold text-slate-500 dark:text-slate-400">{dayTitle(key)}</p>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700 overflow-hidden">
                {items.map(d => (
                  <div key={d.id} className="flex items-stretch">
                    <button onClick={() => { setOpenId(d.id); setDetailTab('INFO'); }}
                            className="flex-1 min-w-0 text-left px-4 py-3 active:bg-slate-50 dark:active:bg-slate-700/50">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`w-2.5 h-2.5 shrink-0 rounded-full ${
                            d.debt > 0 ? 'bg-amber-500' : 'bg-emerald-500'
                          }`} />
                          <p className="font-bold text-slate-800 dark:text-white truncate">
                            {KIND_LABEL[d.kind]} №{d.number}
                          </p>
                        </div>
                        <p className="font-bold text-slate-800 dark:text-white shrink-0">
                          {formatCurrency(d.total, cents)} ₽
                        </p>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5 pl-[18px]">
                        {timeOf(d.date)} · {d.from} › {d.to}
                      </p>
                      {d.debt > 0 && (
                        <p className="text-[11px] font-bold text-rose-500 mt-0.5 pl-[18px]">
                          Долг {formatCurrency(d.debt, cents)} ₽
                        </p>
                      )}
                    </button>
                    <button onClick={() => setMenuFor(d)}
                            aria-label="Действия"
                            className="shrink-0 px-3 text-slate-400 active:bg-slate-50 dark:active:bg-slate-700/50">
                      ⋮
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {filtersOpen && (
        <ModalPortal>
          <div className="fixed inset-0 z-modal flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm"
               onClick={() => setFiltersOpen(false)}>
            <div className="bg-white dark:bg-slate-800 w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 space-y-4"
                 onClick={e => e.stopPropagation()}>
              <h3 className="font-bold text-slate-800 dark:text-white">Фильтры</h3>

              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Тип документа</p>
                <div className="flex flex-wrap gap-2">
                  {KIND_FILTERS.map(f => (
                    <button key={f.id} onClick={() => setKind(f.id)}
                            className={`px-3.5 py-2 rounded-full text-xs font-bold ${
                              kind === f.id
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                            }`}>{f.label}</button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Оплата</p>
                <div className="flex gap-2">
                  {([['ALL', 'Все'], ['DEBT', 'С долгом'], ['PAID', 'Без долга']] as const).map(([id, label]) => (
                    <button key={id} onClick={() => setPay(id)}
                            className={`flex-1 py-2 rounded-xl text-xs font-bold ${
                              pay === id
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                            }`}>{label}</button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button onClick={() => { setKind('ALL'); setPay('ALL'); }}
                        className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-sm">
                  Сбросить
                </button>
                <button onClick={() => setFiltersOpen(false)}
                        className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm">
                  Показать
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {menuFor && (
        <ModalPortal>
          <div className="fixed inset-0 z-modal flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm"
               onClick={() => setMenuFor(null)}>
            <div className="bg-white dark:bg-slate-800 w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-2"
                 onClick={e => e.stopPropagation()}>
              <p className="px-4 pt-3 pb-2 text-sm font-bold text-slate-500 dark:text-slate-400">
                {KIND_LABEL[menuFor.kind]} №{menuFor.number}
              </p>
              <button onClick={() => { const d = menuFor; setMenuFor(null); setOpenId(d.id); setDetailTab('INFO'); }}
                      className="w-full text-left px-4 py-3 rounded-xl font-semibold text-slate-700 dark:text-slate-200 active:bg-slate-50 dark:active:bg-slate-700">
                Открыть документ
              </button>
              <button onClick={() => { const d = menuFor; setMenuFor(null); printDoc(d); }}
                      className="w-full text-left px-4 py-3 rounded-xl font-semibold text-slate-700 dark:text-slate-200 active:bg-slate-50 dark:active:bg-slate-700">
                Товарный чек · печать
              </button>
              {menuFor.debt > 0 && onAcceptPayment && menuFor.sale && (
                <button onClick={() => { const d = menuFor; setMenuFor(null); onAcceptPayment(d.sale!); }}
                        className="w-full text-left px-4 py-3 rounded-xl font-semibold text-amber-600 dark:text-amber-400 active:bg-slate-50 dark:active:bg-slate-700">
                  Принять оплату
                </button>
              )}
              {menuFor.customerId && onSelectCustomer && (
                <button onClick={() => { const d = menuFor; setMenuFor(null); onSelectCustomer(d.customerId!); }}
                        className="w-full text-left px-4 py-3 rounded-xl font-semibold text-slate-700 dark:text-slate-200 active:bg-slate-50 dark:active:bg-slate-700">
                  Открыть клиента
                </button>
              )}
              <button onClick={() => setMenuFor(null)}
                      className="w-full text-left px-4 py-3 rounded-xl font-semibold text-slate-400 active:bg-slate-50 dark:active:bg-slate-700">
                Отмена
              </button>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};

export default Journal;
