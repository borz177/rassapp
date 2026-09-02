import React, { useMemo, useState } from 'react';
import type {
  Account, AppSettings, Customer, Product, RetailSale, Sale, StockLocation, StockMovement, Supplier, User,
} from '../types';
import { DEFAULT_WAREHOUSE_ID } from '../types';
import { formatCurrency, stockAtWarehouse } from '../src/utils';
import { buildJournalDocs, KIND_LABEL, type JournalDoc } from '../src/journalDocs';
import TopBarBack from './TopBarBack';
import TabPill from './TabPill';
import SubPage from './transitions/SubPage';
import DocumentCard from './DocumentCard';

interface ProductDetailsProps {
  product: Product;
  movements: StockMovement[];
  retailSales: RetailSale[];
  products: Product[];
  customers: Customer[];
  warehouses: StockLocation[];
  suppliers: Supplier[];
  accounts: Account[];
  employees?: User[];
  /** Договоры рассрочки — по ним у отгрузки со склада свой номер и покупатель */
  contracts?: Sale[];
  appSettings: AppSettings;
  user?: User | null;
  onBack: () => void;
  onEdit?: (p: Product) => void;
  onSelectCustomer?: (id: string) => void;
  onAcceptPayment?: (sale: RetailSale) => void;
  onUpdateSale?: (sale: RetailSale) => Promise<void> | void;
  onUpdateStockDoc?: (movements: StockMovement[]) => Promise<void> | void;
  onAddDocLines?: (docId: string, lines: { productId: string; quantity: number; price: number }[]) => Promise<void> | void;
}

const dayTitle = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Сегодня';
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (same(d, yesterday)) return 'Вчера';
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
};

/**
 * Карточка товара: что это за товар и что с ним происходило.
 *
 * Две вкладки, потому что вопросов ровно два и они разные. «Информация» — как
 * товар заведён: цены, коды, остатки по складам. «История» — чем он жил:
 * приходы, продажи, списания, и каким остаток стал после каждой операции.
 *
 * Остаток после операции считаем назад от нынешнего: сохранённого «остатка на
 * момент» у движений нет, а показывать одни только количества значит оставить
 * без ответа главный вопрос истории — откуда взялось то, что лежит сейчас.
 */
const ProductDetails: React.FC<ProductDetailsProps> = ({
  product, movements, retailSales, products, customers, warehouses, suppliers, accounts,
  employees = [], contracts = [], appSettings, user, onBack, onEdit, onSelectCustomer, onAcceptPayment,
  onUpdateSale, onUpdateStockDoc, onAddDocLines,
}) => {
  const [tab, setTab] = useState<'INFO' | 'HISTORY'>('INFO');
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const cents = appSettings.showCents;

  const docs = useMemo(
    () => buildJournalDocs({
      retailSales, movements, products, customers, warehouses, suppliers, contracts,
      company: appSettings.companyName || 'Магазин',
    }),
    [retailSales, movements, products, customers, warehouses, suppliers, contracts, appSettings.companyName]
  );

  // Документ ищем по товару, а не по движению: строка истории должна открывать
  // ту же бумагу, что и журнал, иначе из карточки товара и из журнала виден
  // разный документ на одну операцию.
  const docFor = (m: StockMovement): JournalDoc | undefined =>
    docs.find(d => (m.saleId && !m.contractId
      // Отгрузка по договору рассрочки — складская бумага, а не чек: у неё есть
      // saleId, но искать её надо по документу, иначе строка истории не открылась бы.
      ? d.sale?.id === m.saleId
      : d.id === `doc_${m.batchId || `single_${m.id}`}`));

  const history = useMemo(() => {
    const rows = movements
      .filter(m => m.productId === product.id)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Идём от свежих к старым и «отматываем» остаток назад — так после каждой
    // строки видно, сколько оставалось на тот момент.
    let running = product.stock || 0;
    return rows.map(m => {
      const after = running;
      running -= m.quantity;
      return { movement: m, stockAfter: after };
    });
  }, [movements, product.id, product.stock]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof history>();
    history.forEach(row => {
      const key = new Date(row.movement.date).toISOString().slice(0, 10);
      map.set(key, [...(map.get(key) || []), row]);
    });
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [history]);

  const openedDoc = docs.find(d => d.id === openDocId) || null;

  const stocks = warehouses.filter(w => !w.isArchived);
  const perWarehouse = (stocks.length ? stocks : [{ id: DEFAULT_WAREHOUSE_ID, name: 'Основной склад' } as StockLocation])
    .map(w => ({ name: w.name, qty: stockAtWarehouse(product, w.id) }))
    .filter(x => x.qty !== 0);

  const margin = product.buyPrice && product.price
    ? ((product.price - product.buyPrice) / product.price) * 100
    : null;

  const infoRow = (label: string, value: React.ReactNode, accent = false) => (
    <div className="px-4 py-3 flex items-center justify-between gap-3">
      <span className="text-sm text-slate-500 dark:text-slate-400 shrink-0">{label}</span>
      <span className={`text-sm font-semibold text-right truncate ${
        accent ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-800 dark:text-white'
      }`}>{value}</span>
    </div>
  );

  const card = 'bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700';

  return (
    <>
      <div className="space-y-4 pb-10">
        <div className="flex items-center gap-3">
          <TopBarBack onClick={onBack} />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-slate-800 dark:text-white truncate">{product.name}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Товар</p>
          </div>
          {onEdit && (
            <button onClick={() => onEdit(product)}
                    className="shrink-0 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm font-bold">
              Изменить
            </button>
          )}
        </div>

        {product.images?.[0] && (
          <div className="rounded-3xl overflow-hidden bg-slate-100 dark:bg-slate-800 aspect-[16/10]">
            <img src={product.images[0]} alt="" className="w-full h-full object-contain" />
          </div>
        )}

        <div className="relative flex p-1 rounded-[24px] bg-white/60 dark:bg-slate-800/60 border border-white/70 dark:border-slate-700 shadow-sm">
          <TabPill index={tab === 'INFO' ? 0 : 1} count={2} pad={4} />
          {([['INFO', 'Информация'], ['HISTORY', 'История']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
                    className={`relative z-10 flex-1 min-w-0 py-2.5 text-sm font-bold rounded-xl transition-colors ${
                      tab === id ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400'
                    }`}>{label}</button>
          ))}
        </div>

        {tab === 'INFO' && (
          <div className="space-y-4">
            <div className={card}>
              {product.updatedAt && infoRow('Изменён', new Date(product.updatedAt).toLocaleString('ru-RU', {
                day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
              }))}
              {infoRow('Артикул', product.sku || '—')}
              {infoRow('Категория', product.category || 'Общее')}
              {infoRow('Единица', product.unit || 'шт')}
            </div>

            <div>
              <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2 px-1">Цены</p>
              <div className={card}>
                {infoRow('Цена продажи', `${formatCurrency(product.price || 0, cents)} ₽`, true)}
                {infoRow('Цена закупки', product.buyPrice ? `${formatCurrency(product.buyPrice, cents)} ₽` : '—', true)}
                {/* Маржа считается, а не хранится: цены правят по одной, и
                    сохранённое значение разошлось бы с ними в тот же день. */}
                {margin !== null && infoRow('Наценка', `${margin.toFixed(1)}%`)}
              </div>
            </div>

            <div>
              <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2 px-1">Остатки</p>
              <div className={card}>
                {infoRow('Всего', `${product.stock || 0} ${product.unit || 'шт'}`)}
                {perWarehouse.map(w => infoRow(w.name, `${w.qty} ${product.unit || 'шт'}`))}
                {product.minStock !== undefined && product.minStock !== null &&
                  infoRow('Минимальный остаток', `${product.minStock} ${product.unit || 'шт'}`)}
                {product.buyPrice ? infoRow('В закупе', `${formatCurrency((product.stock || 0) * product.buyPrice, cents)} ₽`) : null}
              </div>
            </div>

            {product.description && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Описание</p>
                <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{product.description}</p>
              </div>
            )}
          </div>
        )}

        {tab === 'HISTORY' && (
          grouped.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 py-10 text-center">
              Движений по товару пока не было.
            </p>
          ) : (
            <div className="space-y-4">
              {grouped.map(([key, rows]) => (
                <div key={key}>
                  <div className="sticky top-0 z-10 -mx-1 px-1 py-1.5 bg-slate-50/90 dark:bg-slate-900/90 backdrop-blur-sm">
                    <p className="text-sm font-bold text-slate-500 dark:text-slate-400">{dayTitle(rows[0].movement.date)}</p>
                  </div>
                  <div className={card}>
                    {rows.map(({ movement: m, stockAfter }) => {
                      const doc = docFor(m);
                      const label = m.type === 'SALE' ? 'Продажа' : KIND_LABEL[
                        m.type === 'IN' ? 'IN'
                        : m.type === 'TRANSFER' ? 'TRANSFER'
                        : m.type === 'WRITE_OFF' ? 'WRITE_OFF'
                        : 'INVENTORY'
                      ];
                      const positive = m.quantity >= 0;
                      return (
                        <button key={m.id}
                                onClick={() => doc && setOpenDocId(doc.id)}
                                disabled={!doc}
                                className="w-full text-left px-4 py-3 active:bg-slate-50 dark:active:bg-slate-700/50 disabled:active:bg-transparent">
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-bold text-slate-800 dark:text-white truncate">
                              {label}{doc ? ` №${doc.number}` : ''}
                            </p>
                            <p className="text-xs text-slate-400 shrink-0">
                              {new Date(m.date).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                          <div className="grid grid-cols-4 gap-2 mt-1.5">
                            <div>
                              <p className="text-[10px] text-slate-400">Цена</p>
                              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                                {m.unitPrice ? formatCurrency(m.unitPrice, cents) : '—'}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-400">Сумма</p>
                              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                                {m.unitPrice ? formatCurrency(Math.abs(m.quantity) * m.unitPrice, cents) : '—'}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-400">Количество</p>
                              <p className={`text-sm font-bold ${positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
                                {positive ? '▲' : '▼'} {Math.abs(m.quantity)}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-400">Остаток</p>
                              <p className={`text-sm font-bold ${stockAfter < 0 ? 'text-rose-500' : 'text-slate-700 dark:text-slate-200'}`}>
                                {stockAfter}
                              </p>
                            </div>
                          </div>
                          {m.note && (
                            <p className="text-[11px] text-slate-400 truncate mt-1">{m.note}</p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* Документ поверх карточки товара — тем же выездом, что и везде. Шаг
          «назад» он забирает себе, поэтому свайп вернёт к истории, а не закроет
          товар целиком. */}
      {openedDoc && (
        <SubPage onClose={() => setOpenDocId(null)}>
          {(close: () => void) => (
            <DocumentCard
              doc={openedDoc}
              accounts={accounts}
              appSettings={appSettings}
              employees={employees}
              user={user}
              onBack={close}
              onSelectCustomer={onSelectCustomer}
              onAcceptPayment={onAcceptPayment}
              customers={customers}
              suppliers={suppliers}
              onUpdateSale={onUpdateSale}
              onUpdateStockDoc={onUpdateStockDoc}
              onAddDocLines={onAddDocLines}
              products={products}
            />
          )}
        </SubPage>
      )}
    </>
  );
};

export default ProductDetails;
