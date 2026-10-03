import React, { useMemo, useState } from 'react';
import Operations from './Operations';
import Journal from './Journal';
import TabPill from './TabPill';
import DocumentCard from './DocumentCard';
import SubPage from './transitions/SubPage';
import UnsyncedMark from './UnsyncedMark';
import { buildMoneyOperations, type MoneyOperation } from '../src/moneyOperations';
import { buildJournalDocs, KIND_LABEL, type JournalDoc } from '../src/journalDocs';
import { formatCurrency } from '../src/utils';

/**
 * Общая история магазина: деньги и товар на одном экране.
 *
 * С магазином раньше было две истории в разных разделах — «История операций»
 * в Кассе (куда ушли деньги) и «Журнал» в Складе (куда ушёл товар), и чтобы
 * понять, что происходило за день, человек открывал обе. Теперь:
 *
 * — «Все» — одна лента по дням: платежи, расходы, чеки, приходы, списания;
 * — «Деньги» — прежняя история операций со всеми её фильтрами;
 * — «Товар» — прежний журнал документов со всеми его действиями.
 *
 * Две последние — те же самые компоненты, без копий: их правила (отмена
 * расхода, удаление прихода с откатом остатков) живут в одном месте. Лента
 * «Все» строки рисует сама, а открывает их теми же окнами: денежную операцию —
 * окнами Operations (modalsOnly), документ — той же карточкой DocumentCard.
 *
 * Обычный чек — одновременно и деньги, и товар. В ленте «Все» он одной строкой
 * «Продажа №…», а не двумя; оплаты долга по чеку в долг — отдельными строками
 * денег, как и в кассе.
 */

type OperationsProps = React.ComponentProps<typeof Operations>;
type JournalProps = React.ComponentProps<typeof Journal>;
type Tab = 'ALL' | 'MONEY' | 'GOODS';

interface HistoryProps {
  money: OperationsProps;
  goods: JournalProps;
  /** С какой вкладки открыть: из карточки счёта или из поиска — сразу «Деньги» */
  initialTab?: Tab;
}

type FeedItem =
  | { kind: 'money'; id: string; date: string; op: MoneyOperation }
  | { kind: 'doc'; id: string; date: string; doc: JournalDoc };

const TABS: { id: Tab; label: string }[] = [
  { id: 'ALL', label: 'Все' },
  { id: 'MONEY', label: 'Деньги' },
  { id: 'GOODS', label: 'Товар' },
];

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

const History: React.FC<HistoryProps> = ({ money, goods, initialTab = 'ALL' }) => {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [search, setSearch] = useState('');
  // Денежная операция из ленты «Все» открывается окнами Operations
  const [focusOpId, setFocusOpId] = useState<string | null>(null);
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const cents = goods.appSettings.showCents;

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

  const feed = useMemo(() => {
    // Обычный чек уже есть документом «Продажа» — денежную строку того же чека не дублируем
    const saleDocIds = new Set(docs.filter(d => d.kind === 'SALE' && d.sale).map(d => d.sale!.id));
    const q = search.trim().toLowerCase();
    const items: FeedItem[] = [
      ...ops
        .filter(op => !(op.isRetail && saleDocIds.has(op.id)))
        .filter(op => !q
          || op.title.toLowerCase().includes(q)
          || String(op.description || '').toLowerCase().includes(q))
        .map(op => ({ kind: 'money' as const, id: `m_${op.id}`, date: op.date, op })),
      ...docs
        .filter(d => !q
          || d.number.toLowerCase().includes(q)
          || d.to.toLowerCase().includes(q)
          || d.from.toLowerCase().includes(q)
          || d.lines.some(l => l.name.toLowerCase().includes(q)))
        .map(doc => ({ kind: 'doc' as const, id: `d_${doc.id}`, date: doc.date, doc })),
    ];
    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const groups: [string, FeedItem[]][] = [];
    for (const it of items) {
      const key = dayKey(it.date);
      const last = groups[groups.length - 1];
      if (last && last[0] === key) last[1].push(it);
      else groups.push([key, [it]]);
    }
    return { groups, count: items.length };
  }, [ops, docs, search]);

  const openedDoc = docs.find(d => d.id === openDocId) || null;
  const tabIndex = TABS.findIndex(t => t.id === tab);

  return (
    <div className="space-y-4 pb-20 w-full">
      <header className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-slate-800 dark:text-white">История</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Деньги и товар — всё, что происходило</p>
        </div>
      </header>

      <div className="relative flex p-1 rounded-[26px] bg-white/60 dark:bg-slate-800/60 border border-white/70 dark:border-slate-700 shadow-sm">
        <TabPill index={tabIndex} count={TABS.length} pad={4} />
        {TABS.map(t => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
                  className={`relative z-10 flex-1 py-2.5 text-sm font-bold rounded-xl transition-colors ${
                    tab === t.id ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-500'
                  }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'MONEY' && <Operations {...money} embedded />}
      {tab === 'GOODS' && <Journal {...goods} embedded initialDocId={null} />}

      {tab === 'ALL' && (
        <>
          <input value={search} onChange={e => setSearch(e.target.value)}
                 placeholder="Поиск по клиенту, товару или номеру"
                 className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 outline-none focus:border-indigo-400" />

          {feed.groups.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 py-10 text-center">
              {search ? 'Ничего не найдено.' : 'Операций пока нет.'}
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
                      <DocRow key={it.id} doc={it.doc} cents={cents} onOpen={() => setOpenDocId(it.doc.id)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Окна денежной операции — те же, что во вкладке «Деньги» */}
          <Operations {...money} modalsOnly focusOperationId={focusOpId} onFocusHandled={() => setFocusOpId(null)} />
        </>
      )}

      {openedDoc && (
        <SubPage onClose={() => setOpenDocId(null)}>
          {(close: () => void) => (
            <DocumentCard
              doc={openedDoc}
              accounts={goods.accounts}
              appSettings={goods.appSettings}
              employees={goods.employees}
              user={goods.user}
              onBack={close}
              onSelectCustomer={goods.onSelectCustomer}
              onAcceptPayment={goods.onAcceptPayment}
              customers={goods.customers}
              suppliers={goods.suppliers}
              onUpdateSale={goods.onUpdateSale}
              onUpdateStockDoc={goods.onUpdateStockDoc}
              onAddDocLines={goods.onAddDocLines}
              products={goods.products}
            />
          )}
        </SubPage>
      )}
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
      </span>
      <span className={`shrink-0 font-bold tabular-nums ${income ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-800 dark:text-white'}`}>
        {income ? '+' : '−'}{formatCurrency(op.amount, cents)} ₽
      </span>
    </button>
  );
};

const DocRow: React.FC<{ doc: JournalDoc; cents?: boolean; onOpen: () => void }> = ({ doc, cents, onOpen }) => {
  const isSale = doc.kind === 'SALE';
  return (
    <button type="button" onClick={onOpen}
            className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-slate-50 dark:active:bg-slate-700/50 hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition-colors">
      <span className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center ${isSale
        ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
        : 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400'}`}>
        {isSale ? ReceiptIcon : BoxIcon}
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
        ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-800 dark:text-white'}`}>
        {isSale && doc.debt === 0 ? '+' : ''}{formatCurrency(doc.total, cents)} ₽
      </span>
    </button>
  );
};

export default History;
