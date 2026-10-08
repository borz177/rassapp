import React, { useMemo, useState } from 'react';
import Operations from './Operations';
import Journal from './Journal';
import GlassSheet, { SheetSection, SheetSegmented } from './GlassSheet';
import { FilterChip, ChipGroup } from './FilterChips';
import UnsyncedMark from './UnsyncedMark';
import { buildMoneyOperations, type MoneyOperation } from '../src/moneyOperations';
import { buildJournalDocs, KIND_LABEL, type DocKind, type JournalDoc } from '../src/journalDocs';
import { formatCurrency } from '../src/utils';

/**
 * Общая история магазина: деньги и товар одной лентой.
 *
 * С магазином раньше было две истории в разных разделах — «История операций»
 * в Кассе (куда ушли деньги) и «Журнал» в Складе (куда ушёл товар), и чтобы
 * понять, что происходило за день, человек открывал обе. Теперь это одна лента
 * по дням — платежи, расходы, чеки, приходы, списания — и одна кнопка фильтра,
 * в которой собраны и денежные отборы (счёт, категория, сотрудник, приход или
 * расход), и складские (тип документа, долг).
 *
 * Строки лента рисует сама, а открывает их окнами самих Operations и Journal
 * (режим modalsOnly): отмена расхода, печать, приём оплаты и удаление с
 * откатом остатков работают ровно так же, как на их собственных экранах, и
 * живут в одном месте.
 *
 * Обычный чек — одновременно и деньги, и товар: здесь он одной строкой
 * «Продажа №…», а не двумя. Оплаты долга по чеку в долг — строками денег.
 */

type OperationsProps = React.ComponentProps<typeof Operations>;
type JournalProps = React.ComponentProps<typeof Journal>;

interface HistoryProps {
  money: OperationsProps;
  goods: JournalProps;
}

type FeedItem =
  | { kind: 'money'; id: string; date: string; op: MoneyOperation }
  | { kind: 'doc'; id: string; date: string; doc: JournalDoc };

type TypeFilter = 'ALL' | 'MONEY_IN' | 'MONEY_OUT' | DocKind;
type PayFilter = 'ALL' | 'DEBT' | 'PAID';

const TYPE_FILTERS: { id: TypeFilter; label: string; group?: 'money' | 'goods' }[] = [
  { id: 'ALL', label: 'Все' },
  { id: 'MONEY_IN', label: 'Поступления', group: 'money' },
  { id: 'MONEY_OUT', label: 'Расходы', group: 'money' },
  { id: 'SALE', label: 'Продажи', group: 'goods' },
  { id: 'RETURN', label: 'Возвраты', group: 'goods' },
  { id: 'CONTRACT', label: 'Договоры', group: 'goods' },
  { id: 'IN', label: 'Приход товара', group: 'goods' },
  { id: 'TRANSFER', label: 'Перемещение', group: 'goods' },
  { id: 'WRITE_OFF', label: 'Списание', group: 'goods' },
  { id: 'INVENTORY', label: 'Инвентаризация', group: 'goods' },
];

// Те же подписи категорий, что в истории операций
const CATEGORY_LABEL: Record<string, string> = {
  General: 'Общее', Rent: 'Аренда', Salary: 'Зарплата', Marketing: 'Маркетинг', Taxes: 'Налоги',
  Equipment: 'Оборудование', 'Investment Return': 'Выплата инвестора', 'Себестоимость': 'Закуп', 'Продажа': 'Приход',
};
const categoryLabel = (c: string) => CATEGORY_LABEL[c] || c;

const dayKey = (d: string) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

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

const timeOf = (d: string) => new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

// Строки — тот же язык, что в обеих лентах: зелёное пришло, красное ушло,
// документы склада — своим цветом, потому что это движение товара, а не денег.
const ArrowIn = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></svg>
);
const ArrowOut = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
);
const BoxIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" /><path d="m3 8 9 5 9-5" /><path d="M12 13v8" /></svg>
);
const ReceiptIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 2v20l3-2 3 2 2-2 2 2 3-2 3 2V2l-3 2-3-2-2 2-2-2-3 2Z" /><path d="M8 9h8M8 13h6" /></svg>
);

const History: React.FC<HistoryProps> = ({ money, goods }) => {
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [type, setType] = useState<TypeFilter>('ALL');
  // Из карточки счёта приходят с уже выбранным счётом
  const [accountId, setAccountId] = useState<string>(money.initialAccountId || '');
  const [category, setCategory] = useState('ALL');
  const [employeeId, setEmployeeId] = useState('');
  const [pay, setPay] = useState<PayFilter>('ALL');
  // Запросы окнам Operations / Journal
  const [focusOpId, setFocusOpId] = useState<string | null>(null);
  const [docOpenId, setDocOpenId] = useState<string | null>(null);
  const [docMenuId, setDocMenuId] = useState<string | null>(null);
  const cents = goods.appSettings.showCents;
  const employees = money.employees || [];

  const ops = useMemo(() => buildMoneyOperations({
    sales: money.sales, expenses: money.expenses, accounts: money.accounts, customers: money.customers,
    investors: money.investors, retailSales: money.retailSales,
  }), [money.sales, money.expenses, money.accounts, money.customers, money.investors, money.retailSales]);

  const docs = useMemo(() => buildJournalDocs({
    retailSales: goods.retailSales, movements: goods.movements, products: goods.products,
    customers: goods.customers, warehouses: goods.warehouses, suppliers: goods.suppliers,
    company: goods.appSettings.companyName || 'Магазин', contracts: goods.contracts,
  }), [goods.retailSales, goods.movements, goods.products, goods.customers, goods.warehouses,
    goods.suppliers, goods.appSettings.companyName, goods.contracts]);

  const categories = useMemo(
    () => Array.from(new Set(ops.map(o => o.category).filter(Boolean))).sort(),
    [ops]);

  const feed = useMemo(() => {
    // Обычный чек уже есть документом «Продажа» — денежную строку того же чека не дублируем
    const saleDocIds = new Set(docs.filter(d => (d.kind === 'SALE' || d.kind === 'RETURN') && d.sale).map(d => d.sale!.id));
    const q = search.trim().toLowerCase();
    const moneyType = type === 'ALL' || type === 'MONEY_IN' || type === 'MONEY_OUT';
    const docType = type === 'ALL' || !moneyType;

    const moneyItems = !moneyType || pay !== 'ALL' ? [] : ops
      .filter(op => !(op.isRetail && saleDocIds.has(op.id)))
      .filter(op => type !== 'MONEY_IN' || op.type === 'INCOME')
      .filter(op => type !== 'MONEY_OUT' || op.type === 'EXPENSE')
      .filter(op => !accountId || op.accountId === accountId)
      .filter(op => category === 'ALL' || op.category === category)
      .filter(op => !employeeId || op.raw?.createdByUserId === employeeId)
      .filter(op => !q
        || op.title.toLowerCase().includes(q)
        || String(op.description || '').toLowerCase().includes(q)
        || String(op.comment || '').toLowerCase().includes(q));

    // Категория — понятие денег: выбрана — документы склада не показываем.
    // Счёт есть только у чека; складские накладные к счёту не привязаны.
    const docItems = !docType || category !== 'ALL' ? [] : docs
      .filter(d => type === 'ALL' || d.kind === type)
      .filter(d => !accountId || d.sale?.accountId === accountId)
      .filter(d => !employeeId || d.authorId === employeeId)
      .filter(d => pay === 'ALL' || (pay === 'DEBT' ? d.debt > 0 : d.debt === 0))
      .filter(d => !q
        || d.number.toLowerCase().includes(q)
        || d.to.toLowerCase().includes(q)
        || d.from.toLowerCase().includes(q)
        || d.lines.some(l => l.name.toLowerCase().includes(q)));

    const items: FeedItem[] = [
      ...moneyItems.map(op => ({ kind: 'money' as const, id: `m_${op.id}`, date: op.date, op })),
      ...docItems.map(doc => ({ kind: 'doc' as const, id: `d_${doc.id}`, date: doc.date, doc })),
    ];
    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const groups: [string, FeedItem[]][] = [];
    for (const it of items) {
      const key = dayKey(it.date);
      const last = groups[groups.length - 1];
      if (last && last[0] === key) last[1].push(it);
      else groups.push([key, [it]]);
    }
    // Деньги по текущему отбору: продажа за наличные — тоже поступление
    const income = moneyItems.filter(o => o.type === 'INCOME').reduce((s, o) => s + o.amount, 0)
      + docItems.filter(d => d.kind === 'SALE' && d.sale && !d.sale.isCredit).reduce((s, d) => s + d.total, 0);
    // Возврат — деньги ушли покупателю (только реально отданное, без списанного долга)
    const expense = moneyItems.filter(o => o.type === 'EXPENSE').reduce((s, o) => s + o.amount, 0)
      + docItems.filter(d => d.kind === 'RETURN' && d.sale).reduce((s, d) => s + (d.sale!.refund ?? d.total), 0);
    return { groups, count: items.length, income, expense };
  }, [ops, docs, search, type, accountId, category, employeeId, pay]);

  const filtersActive = type !== 'ALL' || !!accountId || category !== 'ALL' || !!employeeId || pay !== 'ALL';
  const resetFilters = () => { setType('ALL'); setAccountId(''); setCategory('ALL'); setEmployeeId(''); setPay('ALL'); };
  const activeLabels = [
    type !== 'ALL' && TYPE_FILTERS.find(t => t.id === type)?.label,
    accountId && (money.accounts.find(a => a.id === accountId)?.name || 'Счёт'),
    category !== 'ALL' && categoryLabel(category),
    employeeId && employees.find(e => e.id === employeeId)?.name,
    pay === 'DEBT' ? 'С долгом' : pay === 'PAID' ? 'Без долга' : '',
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-4 pb-20 w-full">
      <header className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Журнал</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 truncate">
            {feed.count} {feed.count % 10 === 1 && feed.count % 100 !== 11 ? 'операция'
              : [2, 3, 4].includes(feed.count % 10) && ![12, 13, 14].includes(feed.count % 100) ? 'операции' : 'операций'}
          </p>
        </div>
        <button type="button" onClick={() => setFiltersOpen(true)}
                className={`relative shrink-0 w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
                  filtersActive
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300'
                }`}
                aria-label="Фильтры" title="Фильтры">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
          </svg>
        </button>
      </header>

      {/* Пришло и ушло по текущему отбору — меняются вместе с фильтром */}
      {(feed.income > 0 || feed.expense > 0) && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-3.5 sm:p-4 min-w-0">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">{ArrowIn}</span>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">Пришло</p>
            </div>
            <p className="mt-2 text-lg sm:text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums truncate">
              +{formatCurrency(feed.income, cents)} ₽
            </p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-3.5 sm:p-4 min-w-0">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">{ArrowOut}</span>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">Ушло</p>
            </div>
            <p className="mt-2 text-lg sm:text-2xl font-extrabold text-rose-600 dark:text-rose-400 tabular-nums truncate">
              −{formatCurrency(feed.expense, cents)} ₽
            </p>
          </div>
        </div>
      )}

      <input value={search} onChange={e => setSearch(e.target.value)}
             placeholder="Поиск по клиенту, товару или номеру"
             className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 outline-none focus:border-indigo-400" />

      {/* Что сейчас отобрано — видно без открытия фильтра */}
      {filtersActive && (
        <div className="flex flex-wrap items-center gap-2 -mt-1">
          {activeLabels.map(l => (
            <span key={l} className="px-3 py-1 rounded-full text-xs font-semibold bg-indigo-600 text-white">{l}</span>
          ))}
          <button type="button" onClick={resetFilters}
                  className="px-2 py-1 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-rose-600">
            ✕ Сбросить
          </button>
        </div>
      )}

      {feed.groups.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 py-10 text-center">
          {search || filtersActive ? 'Ничего не найдено.' : 'Операций пока нет.'}
        </p>
      ) : (
        <div className="space-y-4">
          {feed.groups.map(([key, items]) => (
            <div key={key}>
              <p className="px-1 pb-2 text-sm font-bold text-slate-500 dark:text-slate-400">{dayTitle(key)}</p>
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700 overflow-hidden">
                {items.map(it => it.kind === 'money' ? (
                  <MoneyRow key={it.id} op={it.op} cents={cents} onOpen={() => setFocusOpId(it.op.id)} />
                ) : (
                  <DocRow key={it.id} doc={it.doc} cents={cents}
                          onOpen={() => setDocOpenId(it.doc.id)} onMenu={() => setDocMenuId(it.doc.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {filtersOpen && (
        <GlassSheet
          title="Фильтры"
          subtitle={`Найдётся ${feed.count}`}
          onClose={() => setFiltersOpen(false)}
          cancelLabel="Закрыть"
          action={{ label: 'Показать', onClick: close => close() }}
        >
          <div className="space-y-6">
            {/* Что показать — двумя группами: деньги и товар. Так видно, что
                это одна лента из двух источников, а не десяток разрозненных типов. */}
            <SheetSection title="Что показать">
              <div className="px-4 py-3.5 space-y-3">
                <FilterChip on={type === 'ALL'} onClick={() => setType('ALL')}>Всё подряд</FilterChip>
                <ChipGroup label="Деньги">
                  {TYPE_FILTERS.filter(f => f.group === 'money').map(f => (
                    <FilterChip key={f.id} on={type === f.id} onClick={() => setType(type === f.id ? 'ALL' : f.id)}>{f.label}</FilterChip>
                  ))}
                </ChipGroup>
                <ChipGroup label="Товар">
                  {TYPE_FILTERS.filter(f => f.group === 'goods').map(f => (
                    <FilterChip key={f.id} on={type === f.id} onClick={() => setType(type === f.id ? 'ALL' : f.id)}>{f.label}</FilterChip>
                  ))}
                </ChipGroup>
              </div>
            </SheetSection>

            {money.accounts.length > 1 && (
              <SheetSection title="Счёт">
                <div className="px-4 py-3.5 flex flex-wrap gap-2">
                  <FilterChip on={!accountId} onClick={() => setAccountId('')}>Все счета</FilterChip>
                  {money.accounts.filter(a => !a.isArchived || a.id === accountId).map(a => (
                    <FilterChip key={a.id} on={accountId === a.id} onClick={() => setAccountId(accountId === a.id ? '' : a.id)}>{a.name}</FilterChip>
                  ))}
                </div>
              </SheetSection>
            )}

            {categories.length > 0 && (
              <SheetSection title="Категория" hint="Категории есть только у денег — с выбранной категорией документы склада скрываются.">
                <div className="px-4 py-3.5 flex flex-wrap gap-2">
                  <FilterChip on={category === 'ALL'} onClick={() => setCategory('ALL')}>Все</FilterChip>
                  {categories.map(c => (
                    <FilterChip key={c} on={category === c} onClick={() => setCategory(category === c ? 'ALL' : c)}>{categoryLabel(c)}</FilterChip>
                  ))}
                </div>
              </SheetSection>
            )}

            {/* Сотрудник — инструмент менеджера, как и в истории операций */}
            {employees.length > 0 && money.canFilterByEmployee && (
              <SheetSection title="Кто провёл">
                <div className="px-4 py-3.5 flex flex-wrap gap-2">
                  <FilterChip on={!employeeId} onClick={() => setEmployeeId('')}>Все</FilterChip>
                  {employees.map(e => (
                    <FilterChip key={e.id} on={employeeId === e.id} onClick={() => setEmployeeId(employeeId === e.id ? '' : e.id)}>{e.name}</FilterChip>
                  ))}
                </div>
              </SheetSection>
            )}

            <SheetSection title="Долг по документу">
              <div className="px-4 py-3">
                <SheetSegmented value={pay} onChange={setPay}
                  options={[{ id: 'ALL', label: 'Все' }, { id: 'DEBT', label: 'С долгом' }, { id: 'PAID', label: 'Без долга' }]} />
              </div>
            </SheetSection>

            {filtersActive && (
              <button type="button" onClick={resetFilters}
                      className="w-full py-3 rounded-2xl text-[15px] font-semibold text-rose-600 dark:text-rose-400 bg-white/70 dark:bg-white/5 active:opacity-70">
                Сбросить все фильтры
              </button>
            )}
          </div>
        </GlassSheet>
      )}

      {/* Окна денежной операции и документа — те же, что на их собственных экранах */}
      <Operations {...money} initialAccountId={null} modalsOnly
                  focusOperationId={focusOpId || money.focusOperationId}
                  onFocusHandled={() => { setFocusOpId(null); money.onFocusHandled?.(); }} />
      <Journal {...goods} modalsOnly initialDocId={null}
               requestOpenId={docOpenId} requestMenuId={docMenuId}
               onRequestHandled={() => { setDocOpenId(null); setDocMenuId(null); }} />
    </div>
  );
};

const MoneyRow: React.FC<{ op: MoneyOperation; cents?: boolean; onOpen: () => void }> = ({ op, cents, onOpen }) => {
  const income = op.type === 'INCOME';
  return (
    <button type="button" onClick={onOpen}
            className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-slate-50 dark:active:bg-slate-700/50 hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition-colors">
      <span className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center ${income
        ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
        : 'bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400'}`}>
        {income ? ArrowIn : ArrowOut}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <UnsyncedMark id={op.raw?.id} />
          <span className="font-semibold text-[15px] text-slate-800 dark:text-white truncate">{op.title}</span>
        </span>
        <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">
          {timeOf(op.date)} · {op.description}
        </span>
        {op.comment && (
          <span className="block text-xs text-slate-600 dark:text-slate-300 mt-0.5 line-clamp-2 break-words">
            💬 {op.comment}
          </span>
        )}
      </span>
      <span className={`shrink-0 font-bold tabular-nums ${income ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-800 dark:text-white'}`}>
        {income ? '+' : '−'}{formatCurrency(op.amount, cents)} ₽
      </span>
    </button>
  );
};

const DocRow: React.FC<{ doc: JournalDoc; cents?: boolean; onOpen: () => void; onMenu: () => void }> = ({ doc, cents, onOpen, onMenu }) => {
  const isSale = doc.kind === 'SALE';
  const isReturn = doc.kind === 'RETURN';
  return (
    <div className="flex items-stretch">
      <button type="button" onClick={onOpen}
              className="flex-1 min-w-0 flex items-center gap-3 pl-4 pr-2 py-3 text-left active:bg-slate-50 dark:active:bg-slate-700/50 hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition-colors">
        <span className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center ${isSale
          ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
          : isReturn ? 'bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400'
          : 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400'}`}>
          {isSale || isReturn ? ReceiptIcon : BoxIcon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <UnsyncedMark id={doc.sale?.id || doc.movements?.[0]?.id} />
            <span className="font-semibold text-[15px] text-slate-800 dark:text-white truncate">
              {KIND_LABEL[doc.kind]} №{doc.number}
            </span>
          </span>
          <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">
            {timeOf(doc.date)} · {doc.from} › {doc.to}
          </span>
          {doc.debt > 0 && (
            <span className="block text-[11px] font-bold text-rose-500 mt-0.5">Долг {formatCurrency(doc.debt, cents)} ₽</span>
          )}
        </span>
        <span className={`shrink-0 font-bold tabular-nums ${isSale && doc.debt === 0
          ? 'text-emerald-600 dark:text-emerald-400' : isReturn ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-white'}`}>
          {isSale && doc.debt === 0 ? '+' : isReturn ? '−' : ''}{formatCurrency(doc.total, cents)} ₽
        </span>
      </button>
      {/* Печать, приём оплаты, удаление — то же меню, что в журнале */}
      <button type="button" onClick={onMenu} aria-label="Действия" title="Действия"
              className="shrink-0 w-10 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 active:bg-slate-50 dark:active:bg-slate-700/50">
        ⋮
      </button>
    </div>
  );
};

export default History;
