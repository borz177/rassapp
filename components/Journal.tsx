import React, { useMemo, useState } from 'react';
import type {
  Account, AppSettings, Customer, Expense, Product, RetailSale, Sale, StockLocation, StockMovement, Supplier, User,
} from '../types';
import { DEFAULT_WAREHOUSE_ID } from '../types';
import { DELETABLE_STOCK_DOC_KINDS, formatCurrency, retailPaidAmount, stockDocReversal } from '../src/utils';
import { buildJournalDocs, KIND_LABEL, printJournalDoc, type DocKind, type JournalDoc } from '../src/journalDocs';
import DocumentCard from './DocumentCard';
import TopBarBack from './TopBarBack';
import UnsyncedMark from './UnsyncedMark';
import SubPage from './transitions/SubPage';
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
  /** Договоры рассрочки — по ним отгрузка со склада подписывается покупателем. */
  contracts?: Sale[];
  appSettings: AppSettings;
  user?: User | null;
  onBack: () => void;
  onSelectCustomer?: (id: string) => void;
  onAcceptPayment?: (sale: RetailSale) => void;
  onUpdateSale?: (sale: RetailSale) => Promise<void> | void;
  onUpdateStockDoc?: (movements: StockMovement[]) => Promise<void> | void;
  onAddDocLines?: (docId: string, lines: { productId: string; quantity: number; price: number }[]) => Promise<void> | void;
  /** Удаление розничной продажи: товар вернётся на склад, платежи уйдут вместе с чеком */
  onDeleteSale?: (sale: RetailSale) => Promise<void> | void;
  /** Удаление прихода, списания или инвентаризации: остатки откатываются. true — удалён полностью */
  onDeleteStockDoc?: (movements: StockMovement[]) => Promise<boolean> | boolean;
  /** Оплаты поставщикам — показать, что было привязано к удаляемому приходу */
  expenses?: Expense[];
  /** Продажа в минус разрешена: тогда удаление, уводящее остаток в минус, не запрещаем */
  allowNegativeStock?: boolean;
  /**
   * Открыть документ сразу — переход из другого раздела (поставка в карточке
   * партнёра). Закрытие такого документа возвращает туда, откуда пришли,
   * а не в ленту журнала, которую человек и не открывал.
   */
  initialDocId?: string | null;
}

type PayFilter = 'ALL' | 'DEBT' | 'PAID';

const DELETE_LABEL: Partial<Record<DocKind, string>> = {
  IN: 'Удалить приход',
  WRITE_OFF: 'Удалить списание',
  INVENTORY: 'Удалить инвентаризацию',
};

const KIND_FILTERS: { id: 'ALL' | DocKind; label: string }[] = [
  { id: 'ALL', label: 'Все' },
  { id: 'SALE', label: 'Продажи' },
  { id: 'CONTRACT', label: 'Договоры' },
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
  employees = [], contracts = [], appSettings, user, onBack, onSelectCustomer, onAcceptPayment,
  onUpdateSale, onUpdateStockDoc, onAddDocLines, onDeleteSale, initialDocId = null,
  onDeleteStockDoc, expenses = [], allowNegativeStock = false,
}) => {
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'ALL' | DocKind>('ALL');
  const [pay, setPay] = useState<PayFilter>('ALL');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(initialDocId);
  const [detailTab, setDetailTab] = useState<'INFO' | 'PAY'>('INFO');
  const [menuFor, setMenuFor] = useState<JournalDoc | null>(null);
  // Чек, который собираются удалить. Спрашиваем отдельным окном: удаление
  // возвращает товар и снимает принятые деньги — это не то, что делают «на всякий».
  const [deleting, setDeleting] = useState<JournalDoc | null>(null);
  const [removing, setRemoving] = useState(false);
  // Складской документ к удалению — своё окно: последствия у него другие,
  // чем у чека, — деньги не трогаются, зато двигаются остатки и долг поставщику.
  const [deletingDoc, setDeletingDoc] = useState<JournalDoc | null>(null);
  // Сотрудник удаляет только с правом на удаление — как и везде в приложении.
  const canDelete = user?.role !== 'employee' || !!user?.permissions?.canDelete;

  const cents = appSettings.showCents;
  const company = appSettings.companyName || 'Магазин';

  const docs = useMemo(
    () => buildJournalDocs({ retailSales, movements, products, customers, warehouses, suppliers, company, contracts }),
    [retailSales, movements, products, customers, warehouses, suppliers, company, contracts]
  );

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

  const docReversal = useMemo(
    () => (deletingDoc ? stockDocReversal(deletingDoc.movements || [], products) : null),
    [deletingDoc, products]
  );
  // Оплаты, привязанные к приходу. id прихода у поставщика — ключ пачки движений,
  // у документа журнала к нему приставлено «doc_».
  const linkedPayments = useMemo(
    () => (deletingDoc?.kind === 'IN'
      ? expenses.filter(e => e.supplyDocId && `doc_${e.supplyDocId}` === deletingDoc.id && e.isRefund !== true)
      : []),
    [deletingDoc, expenses]
  );
  const warehouseLabel = (id: string) =>
    warehouses.find(w => w.id === id)?.name || (id === DEFAULT_WAREHOUSE_ID ? 'Основной склад' : 'Склад удалён');

  const filtersActive = kind !== 'ALL' || pay !== 'ALL';

  // ─── Лента документов ─────────────────────────────────────────────────────
  return (
    <>
    <div className="space-y-3 pb-10">
      <div className="flex items-center gap-3">
        {/* На десктопе стрелка не нужна: раздел виден в сайдбаре, и уходить
            из него некуда — это не подстраница, а сам раздел. */}
        <TopBarBack onClick={onBack} hideOnDesktop />
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
                          <UnsyncedMark id={d.sale?.id || d.movements?.[0]?.id} />
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

      {/* Что именно исчезнет — перечисляем до нажатия, а не после. Удаление
          чека трогает три вещи сразу: остаток склада, выручку и принятые по
          долгу деньги, и «Вы уверены?» об этом не говорит ничего. */}
      {deleting && deleting.sale && (
        <ModalPortal onClose={() => !removing && setDeleting(null)}>
          <div className="fixed inset-0 z-modal-top flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
               onClick={() => !removing && setDeleting(null)}>
            <div className="bg-white dark:bg-slate-800 w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl animate-slide-up-sheet"
                 onClick={e => e.stopPropagation()}>
              <div className="px-5 pt-5 pb-3">
                <h3 className="text-lg font-bold text-slate-800 dark:text-white">Удалить продажу №{deleting.number}?</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  {deleting.to} · {formatCurrency(deleting.total, cents)} ₽
                </p>
              </div>

              <div className="px-5 pb-4 space-y-2 text-sm">
                <div className="flex items-start gap-2.5">
                  <span className="text-emerald-500 shrink-0">↩</span>
                  <span className="text-slate-600 dark:text-slate-300">
                    Товар вернётся на склад: {deleting.lines.length}&nbsp;поз.
                    {' '}({deleting.lines.reduce((n, l) => n + l.quantity, 0)}&nbsp;шт)
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="text-rose-500 shrink-0">−</span>
                  <span className="text-slate-600 dark:text-slate-300">
                    Выручка и прибыль уменьшатся на {formatCurrency(deleting.total, cents)}&nbsp;₽
                  </span>
                </div>
                {retailPaidAmount(deleting.sale) > 0 && (
                  <div className="flex items-start gap-2.5">
                    <span className="text-rose-500 shrink-0">−</span>
                    <span className="text-slate-600 dark:text-slate-300">
                      Принятые платежи ({(deleting.sale.payments || []).length} на{' '}
                      {formatCurrency(retailPaidAmount(deleting.sale), cents)}&nbsp;₽) удалятся вместе с чеком,
                      и эти деньги перестанут числиться на счёте
                    </span>
                  </div>
                )}
                {deleting.debt > 0 && (
                  <div className="flex items-start gap-2.5">
                    <span className="text-amber-500 shrink-0">≡</span>
                    <span className="text-slate-600 dark:text-slate-300">
                      Долг {formatCurrency(deleting.debt, cents)}&nbsp;₽ спишется — покупатель перестанет
                      числиться должником
                    </span>
                  </div>
                )}
                <p className="text-[11px] text-slate-400 dark:text-slate-500 pt-1">
                  Отменить удаление нельзя. Если чек нужен для истории, а товар вернулся, проведите возврат.
                </p>
              </div>

              <div className="p-4 border-t border-slate-100 dark:border-slate-700 flex gap-2">
                <button type="button" disabled={removing} onClick={() => setDeleting(null)}
                        className="flex-1 py-3 rounded-2xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 font-bold text-sm disabled:opacity-50">
                  Отмена
                </button>
                <button
                  type="button"
                  disabled={removing}
                  onClick={async () => {
                    const sale = deleting.sale!;
                    setRemoving(true);
                    try {
                      await onDeleteSale?.(sale);
                      setDeleting(null);
                      // Если удалили открытый документ — закрываем и его карточку.
                      setOpenId(prev => (prev === deleting.id ? null : prev));
                    } finally {
                      setRemoving(false);
                    }
                  }}
                  className="flex-[1.4] py-3 rounded-2xl bg-rose-600 text-white font-bold text-sm disabled:opacity-50 active:scale-95 transition-transform"
                >
                  {removing ? 'Удаляем…' : 'Удалить'}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {deletingDoc && docReversal && (() => {
        const kind = deletingDoc.kind;
        const units = deletingDoc.lines.reduce((n, l) => n + l.quantity, 0);
        const blocked = docReversal.shortages.length > 0 && !allowNegativeStock;
        const paidLinked = linkedPayments.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
        return (
        <ModalPortal onClose={() => !removing && setDeletingDoc(null)}>
          <div className="fixed inset-0 z-modal-top flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
               onClick={() => !removing && setDeletingDoc(null)}>
            <div className="bg-white dark:bg-slate-800 w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl animate-slide-up-sheet max-h-[88vh] overflow-y-auto"
                 onClick={e => e.stopPropagation()}>
              <div className="px-5 pt-5 pb-3">
                <h3 className="text-lg font-bold text-slate-800 dark:text-white">
                  {DELETE_LABEL[kind]} №{deletingDoc.number}?
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  {deletingDoc.from} → {deletingDoc.to} · {new Date(deletingDoc.date).toLocaleDateString('ru-RU')}
                </p>
              </div>

              {/* Что именно сдвинется — перечисляем до нажатия. */}
              <div className="px-5 pb-4 space-y-2 text-sm">
                <div className="flex items-start gap-2.5">
                  <span className="text-emerald-500 shrink-0">↩</span>
                  <span className="text-slate-600 dark:text-slate-300">
                    {kind === 'IN'
                      ? <>Товар спишется со склада «{deletingDoc.to}»: {deletingDoc.lines.length}&nbsp;поз. ({units}&nbsp;ед.)</>
                      : kind === 'WRITE_OFF'
                      ? <>Товар вернётся на склад «{deletingDoc.from}»: {deletingDoc.lines.length}&nbsp;поз. ({units}&nbsp;ед.)</>
                      : <>Остатки вернутся к значениям до пересчёта: недостача вернётся на склад, излишек снимется — {deletingDoc.lines.length}&nbsp;поз.</>}
                  </span>
                </div>
                {kind === 'IN' && deletingDoc.supplierId && deletingDoc.total > 0 && (
                  <div className="flex items-start gap-2.5">
                    <span className="text-rose-500 shrink-0">−</span>
                    <span className="text-slate-600 dark:text-slate-300">
                      Долг перед «{deletingDoc.from}» уменьшится на {formatCurrency(deletingDoc.total, cents)}&nbsp;₽
                    </span>
                  </div>
                )}
                {linkedPayments.length > 0 && (
                  <div className="flex items-start gap-2.5">
                    <span className="text-amber-500 shrink-0">≡</span>
                    <span className="text-slate-600 dark:text-slate-300">
                      К приходу привязаны оплаты поставщику ({linkedPayments.length} на{' '}
                      {formatCurrency(paidLinked, cents)}&nbsp;₽). Они останутся и зачтутся в общий долг поставщика
                    </span>
                  </div>
                )}

                {docReversal.shortages.length > 0 && (
                  <div className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 px-3 py-2.5 space-y-1">
                    <p className="text-xs font-bold text-rose-700 dark:text-rose-300">Остаток уйдёт в минус</p>
                    {docReversal.shortages.map(sh => (
                      <p key={`${sh.productId}_${sh.warehouseId}`} className="text-xs text-rose-700 dark:text-rose-300">
                        {sh.name}: {sh.before} → <b>{sh.after}</b> на «{warehouseLabel(sh.warehouseId)}»
                      </p>
                    ))}
                    <p className="text-[11px] text-rose-600/80 dark:text-rose-300/80 pt-0.5">
                      {blocked
                        ? 'Товар из документа уже продан или списан, а продажа в минус в настройках магазина запрещена. Поправьте остаток инвентаризацией.'
                        : 'Товар из документа уже продан или списан. Минус будет виден в каталоге, пока остаток не поправят.'}
                    </p>
                  </div>
                )}

                <p className="text-[11px] text-slate-400 dark:text-slate-500 pt-1">
                  Отменить удаление нельзя.
                </p>
              </div>

              <div className="p-4 border-t border-slate-100 dark:border-slate-700 flex gap-2">
                <button type="button" disabled={removing} onClick={() => setDeletingDoc(null)}
                        className="flex-1 py-3 rounded-2xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 font-bold text-sm disabled:opacity-50">
                  Отмена
                </button>
                <button
                  type="button"
                  disabled={removing || blocked}
                  onClick={async () => {
                    const doc = deletingDoc;
                    setRemoving(true);
                    try {
                      const done = await onDeleteStockDoc?.(doc.movements || []);
                      if (done) {
                        setDeletingDoc(null);
                        setOpenId(prev => (prev === doc.id ? null : prev));
                      }
                    } finally {
                      setRemoving(false);
                    }
                  }}
                  className="flex-[1.4] py-3 rounded-2xl bg-rose-600 text-white font-bold text-sm disabled:opacity-50 active:scale-95 transition-transform"
                >
                  {removing ? 'Удаляем…' : 'Удалить'}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
        );
      })()}

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
              <button onClick={() => { const d = menuFor; setMenuFor(null); printJournalDoc(d); }}
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
              {/* Отгрузка по договору живёт вместе с договором, а перемещение
                  двигает два склада сразу — их из журнала не удаляем. */}
              {(DELETABLE_STOCK_DOC_KINDS as readonly string[]).includes(menuFor.kind)
                && onDeleteStockDoc && canDelete && (menuFor.movements || []).length > 0 && (
                <button onClick={() => { const d = menuFor; setMenuFor(null); setDeletingDoc(d); }}
                        className="w-full text-left px-4 py-3 rounded-xl font-semibold text-rose-600 dark:text-rose-400 active:bg-rose-50 dark:active:bg-rose-950/40">
                  {DELETE_LABEL[menuFor.kind]}
                </button>
              )}
              {menuFor.kind === 'SALE' && menuFor.sale && onDeleteSale && (
                <button onClick={() => { const d = menuFor; setMenuFor(null); setDeleting(d); }}
                        className="w-full text-left px-4 py-3 rounded-xl font-semibold text-rose-600 dark:text-rose-400 active:bg-rose-50 dark:active:bg-rose-950/40">
                  Удалить продажу
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

    {/* Карточка выезжает справа и уезжает обратно — тем же движением, что и
        остальные страницы приложения. Держится до конца анимации ухода:
        состояние снимается в onClose, когда играть уже нечего. */}
    {opened && (
      <SubPage onClose={() => {
        // Документ открыли переходом извне — назад значит туда, откуда пришли
        if (initialDocId && openId === initialDocId) onBack();
        else setOpenId(null);
      }}>
        {(close: () => void) => (
          <DocumentCard
            doc={opened}
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

export default Journal;
