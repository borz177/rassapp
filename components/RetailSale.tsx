import React, { useMemo, useState } from 'react';
import type { Account, Customer, Product, RetailSale as RetailSaleType, RetailSaleItem } from '../types';
import TopBarBack from './TopBarBack';
import ModalPortal from './ModalPortal';

interface RetailSaleProps {
  products: Product[];
  customers: Customer[];
  accounts: Account[];
  /** Прошлые чеки — нужны только для следующего номера документа */
  existingSales?: RetailSaleType[];
  onSubmit: (sale: RetailSaleType) => Promise<void> | void;
  onBack: () => void;
  showCents?: boolean;
}

const money = (v: number, cents = false) =>
  v.toLocaleString('ru-RU', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });

const num = (v: string) => {
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const input = 'w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200 outline-none focus:border-indigo-400';

/**
 * Касса: витрина товаров, корзина, оформление продажи.
 *
 * Устроена как касса, а не как форма: сначала набирают товар, потом смотрят
 * итог. Раскладка разная по назначению, а не ради адаптива — на телефоне
 * корзина живёт за кнопкой со счётчиком и открывается листом, потому что экран
 * один и делить его не на что; на десктопе она стоит колонкой справа и видна
 * постоянно, потому что там место есть и открывать окно на каждый товар —
 * лишний шаг.
 *
 * Покупатель по умолчанию розничный: в магазине человек платит и уходит, и
 * требовать карточку клиента значило бы добавлять шаг ради данных, которые
 * никому не понадобятся.
 */
const RetailSale: React.FC<RetailSaleProps> = ({
  products, customers, accounts, existingSales = [], onSubmit, onBack, showCents = false,
}) => {
  const [items, setItems] = useState<RetailSaleItem[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('ALL');
  const [cartOpen, setCartOpen] = useState(false);

  const [customerId, setCustomerId] = useState<string | null>(null);
  const [pickCustomer, setPickCustomer] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');

  const [accountId, setAccountId] = useState<string>(
    accounts.find(a => a.isMain && !a.isArchived)?.id || accounts.find(a => !a.isArchived)?.id || ''
  );
  const [discount, setDiscount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<RetailSaleType | null>(null);

  // Номер и дата. По умолчанию следующий по порядку и сегодня, но кассир может
  // задать своё — продажу нередко проводят задним числом или по своей нумерации.
  const [docNumber, setDocNumber] = useState('');
  const [saleDate, setSaleDate] = useState(() => new Date().toISOString().slice(0, 10));
  const nextDocNumber = useMemo(
    () => String(existingSales.filter(s => !s.isCancelled).length + 1).padStart(4, '0'),
    [existingSales]
  );

  const [editing, setEditing] = useState<{ product: Product; existing: boolean } | null>(null);
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('0');
  const [field, setField] = useState<'qty' | 'price'>('qty');

  const categories = useMemo(
    () => Array.from(new Set(products.filter(p => !p.isArchived).map(p => p.category).filter(Boolean))).sort(),
    [products]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter(p => !p.isArchived)
      .filter(p => category === 'ALL' || p.category === category)
      .filter(p => !q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [products, category, search]);

  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const discountValue = Math.min(num(discount), subtotal);
  const total = subtotal - discountValue;
  const cost = items.reduce((s, i) => s + (i.buyPrice || 0) * i.quantity, 0);
  const profit = total - cost;
  const totalQty = items.reduce((s, i) => s + i.quantity, 0);

  const stockOf = (id: string) => products.find(p => p.id === id)?.stock ?? 0;
  const overdrawn = items.filter(i => i.quantity > stockOf(i.productId));

  const openProduct = (p: Product) => {
    const inCart = items.find(i => i.productId === p.id);
    setEditing({ product: p, existing: !!inCart });
    setQty(inCart ? String(inCart.quantity) : '1');
    setPrice(String(inCart ? inCart.price : p.price || 0));
    setField('qty');
  };

  // Кнопка «=» считает выражение: на кассе набирают «3*12», когда цену держат
  // в голове за упаковку.
  const press = (key: string) => {
    const set = field === 'qty' ? setQty : setPrice;
    set(prev => {
      if (key === 'C') return '0';
      if (key === 'DEL') return prev.length > 1 ? prev.slice(0, -1) : '0';
      if (key === '=') {
        try {
          const expr = prev.replace(',', '.').replace(/[^0-9+\-*/.]/g, '');
          // eslint-disable-next-line no-new-func
          const res = new Function('return ' + expr)();
          return Number.isFinite(res) ? String(Math.round(res * 100) / 100) : prev;
        } catch { return prev; }
      }
      if (prev === '0' && !['+', '-', '*', '/', ','].includes(key)) return key;
      return prev + key;
    });
  };

  const applyEditing = () => {
    if (!editing) return;
    const q = num(qty);
    const pr = num(price);
    const id = editing.product.id;
    if (q <= 0) {
      setItems(prev => prev.filter(i => i.productId !== id));
    } else {
      setItems(prev => prev.some(i => i.productId === id)
        ? prev.map(i => i.productId === id ? { ...i, quantity: q, price: pr } : i)
        : [...prev, {
            productId: id, name: editing.product.name, quantity: q, price: pr,
            buyPrice: editing.product.buyPrice, unit: editing.product.unit || 'шт',
          }]);
    }
    setEditing(null);
    setError(null);
  };

  const submit = async () => {
    if (items.length === 0) { setError('Корзина пуста'); return; }
    if (!accountId) { setError('Выберите счёт, на который поступят деньги'); return; }
    setSaving(true);
    try {
      // Берём выбранную дату, но текущее время: иначе все чеки за день лягут на
      // полночь и порядок продаж внутри дня потеряется.
      const now = new Date();
      const [y, m, d] = saleDate.split('-').map(Number);
      const date = new Date(y, (m || 1) - 1, d || 1, now.getHours(), now.getMinutes(), now.getSeconds());

      const sale: RetailSaleType = {
        id: crypto.randomUUID(),
        userId: '',
        accountId,
        customerId: customerId || undefined,
        items, subtotal, discount: discountValue, total, cost, profit,
        note: note.trim() || undefined,
        docNumber: docNumber.trim() || nextDocNumber,
        date: date.toISOString(),
      };
      await onSubmit(sale);
      setDone(sale);
      setItems([]); setDiscount(''); setNote(''); setCustomerId(null);
      setDocNumber(''); setSaleDate(new Date().toISOString().slice(0, 10));
      setCartOpen(false);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Не удалось провести продажу');
    } finally {
      setSaving(false);
    }
  };

  const customer = customers.find(c => c.id === customerId);
  const liveAccounts = accounts.filter(a => !a.isArchived || a.id === accountId);

  /** Содержимое корзины. Одно на оба режима — лист на телефоне и колонка на десктопе. */
  const cartBody = (
    <>
      {/* Номер документа и дата — шапкой, как в накладной */}
      <div className="bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-700">
        <div className="flex items-center gap-2 px-3.5 py-2.5">
          <span className="text-slate-400 text-sm shrink-0">№</span>
          <input value={docNumber} onChange={e => setDocNumber(e.target.value)}
                 placeholder={nextDocNumber}
                 className="flex-1 min-w-0 bg-transparent outline-none text-sm font-bold text-slate-800 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-600" />
        </div>
        <div className="flex items-center gap-2 px-3.5 py-2.5">
          <span className="text-slate-400 text-sm shrink-0">Дата</span>
          <input type="date" value={saleDate} onChange={e => setSaleDate(e.target.value)}
                 className="flex-1 min-w-0 bg-transparent outline-none text-sm font-bold text-indigo-600 dark:text-indigo-400 text-right" />
        </div>
      </div>

      {/* Позиции */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700">
        {items.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">Корзина пуста</p>
        ) : items.map(i => {
          const short = i.quantity > stockOf(i.productId);
          const product = products.find(p => p.id === i.productId);
          return (
            <div key={i.productId} className="flex items-center gap-2.5 p-2.5 bg-white dark:bg-slate-800">
              <button onClick={() => { setCartOpen(false); if (product) openProduct(product); }}
                      className="flex items-center gap-2.5 min-w-0 flex-1 text-left">
                <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-700 overflow-hidden shrink-0 flex items-center justify-center">
                  {product?.images?.[0]
                    ? <img src={product.images[0]} alt="" className="w-full h-full object-cover" />
                    : <span className="text-slate-400 text-xs">📦</span>}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 dark:text-white truncate text-sm leading-tight">{i.name}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {money(i.quantity)} {i.unit} × {money(i.price, showCents)} ₽
                  </p>
                  {short && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                      на складе {money(stockOf(i.productId))} — уйдёт в минус
                    </p>
                  )}
                </div>
              </button>
              <p className="font-bold text-slate-800 dark:text-white text-sm shrink-0">
                {money(i.price * i.quantity, showCents)} ₽
              </p>
              <button onClick={() => setItems(prev => prev.filter(x => x.productId !== i.productId))}
                      aria-label="Убрать"
                      className="w-7 h-7 shrink-0 rounded-lg bg-rose-50 dark:bg-rose-900/20 text-rose-500 text-sm font-bold">×</button>
            </div>
          );
        })}
      </div>

      {/* Покупатель и счёт */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Покупатель</p>
          <p className="font-semibold text-slate-800 dark:text-white truncate text-sm">
            {customer ? customer.name : 'Розничный покупатель'}
          </p>
        </div>
        <button onClick={() => customer ? setCustomerId(null) : setPickCustomer(true)}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold">
          {customer ? 'Убрать' : 'Выбрать'}
        </button>
      </div>

      <select value={accountId} onChange={e => setAccountId(e.target.value)} className={input}>
        {liveAccounts.length === 0 && <option value="">Нет счетов</option>}
        {liveAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>

      <div className="grid grid-cols-2 gap-2">
        <input value={discount} onChange={e => setDiscount(e.target.value)} inputMode="decimal"
               placeholder="Скидка, ₽" className={input} />
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Комментарий" className={input} />
      </div>

      {/* Итог */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {money(totalQty)} ед. · {money(subtotal, showCents)} ₽
            {discountValue > 0 ? ` − ${money(discountValue, showCents)} ₽` : ''}
          </p>
          <p className="text-3xl font-extrabold text-slate-900 dark:text-white leading-none">
            {money(total, showCents)} <span className="text-xl text-slate-400">₽</span>
          </p>
        </div>
        {cost > 0 && (
          <p className={`text-sm font-bold ${profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
            прибыль {money(profit, showCents)} ₽
          </p>
        )}
      </div>

      {overdrawn.length > 0 && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          По {overdrawn.length} позиц. остаток уйдёт в минус — проверьте приход.
        </p>
      )}

      <button disabled={saving || items.length === 0} onClick={submit}
              className="w-full py-3.5 rounded-2xl bg-emerald-600 text-white font-bold disabled:opacity-40 active:scale-[0.99] transition-transform">
        Провести продажу
      </button>
    </>
  );

  return (
    <div className="pb-24 lg:pb-6">
      <div className="flex items-center gap-3 mb-3">
        <TopBarBack onClick={onBack} />
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">Касса</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Продажа за наличные</p>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="lg:flex lg:items-start lg:gap-5">
        {/* Витрина */}
        <div className="flex-1 min-w-0 space-y-3">
          {categories.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              <button onClick={() => setCategory('ALL')}
                      className={`shrink-0 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap ${
                        category === 'ALL' ? 'glass-surface text-indigo-600 dark:text-indigo-300'
                                           : 'bg-white/60 dark:bg-slate-800/60 border border-white/70 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                      }`}>Все</button>
              {categories.map(c => (
                <button key={c} onClick={() => setCategory(c)}
                        className={`shrink-0 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap ${
                          category === c ? 'glass-surface text-indigo-600 dark:text-indigo-300'
                                         : 'bg-white/60 dark:bg-slate-800/60 border border-white/70 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                        }`}>{c}</button>
              ))}
            </div>
          )}

          <input value={search} onChange={e => setSearch(e.target.value)}
                 placeholder="Поиск по названию или артикулу" className={input} />

          {visible.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 py-10 text-center">
              {products.length === 0 ? 'Сначала добавьте товары на склад.' : 'Ничего не найдено.'}
            </p>
          ) : (
            // На широком экране плитки мельче и их больше в ряд: карточка размером
            // с телефонную там выглядит непропорционально, а витрина влезает
            // целиком без прокрутки.
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5">
              {visible.map(p => {
                const inCart = items.find(i => i.productId === p.id);
                const stock = p.stock || 0;
                return (
                  <button key={p.id} onClick={() => openProduct(p)}
                          className={`relative bg-white dark:bg-slate-800 rounded-2xl border p-2 text-left active:scale-95 transition-transform overflow-hidden ${
                            inCart ? 'border-indigo-500 border-2' : 'border-slate-100 dark:border-slate-700'
                          }`}>
                    {inCart && (
                      <span className="absolute top-1.5 right-1.5 z-10 bg-indigo-600 text-white text-[10px] font-bold min-w-[22px] h-5 px-1 rounded-full flex items-center justify-center">
                        {money(inCart.quantity)}
                      </span>
                    )}
                    <span className={`absolute top-0 left-0 z-10 px-1.5 py-0.5 rounded-br-lg text-[9px] font-bold ${
                      stock > 0 ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                                : 'bg-rose-50 dark:bg-rose-900/30 text-rose-500'
                    }`}>
                      {money(stock)}
                    </span>

                    <div className="w-full aspect-[4/3] rounded-xl bg-slate-100 dark:bg-slate-700 overflow-hidden mb-1.5 mt-3 flex items-center justify-center">
                      {p.images?.[0]
                        ? <img src={p.images[0]} alt="" className="w-full h-full object-cover" loading="lazy" />
                        : <span className="text-2xl text-slate-300">📦</span>}
                    </div>

                    <p className="font-bold text-slate-800 dark:text-white text-xs leading-tight line-clamp-2">{p.name}</p>
                    <p className="text-sm font-extrabold text-indigo-600 dark:text-indigo-400 mt-0.5">
                      {money(p.price, showCents)} ₽
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Корзина колонкой — только на десктопе */}
        <aside className="hidden lg:block w-[340px] shrink-0 sticky top-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 space-y-3 max-h-[calc(100vh-6rem)] overflow-y-auto">
            <h3 className="font-bold text-slate-800 dark:text-white">
              Корзина <span className="text-slate-400 text-sm font-normal">{items.length}</span>
            </h3>
            {cartBody}
          </div>
        </aside>
      </div>

      {/* Кнопка корзины — только на телефоне */}
      {items.length > 0 && !cartOpen && !editing && (
        <button onClick={() => setCartOpen(true)}
                className="lg:hidden fixed left-4 right-4 z-40 rounded-2xl bg-indigo-600 text-white py-3.5 px-5 shadow-2xl flex items-center justify-between active:scale-[0.98] transition-transform"
                style={{ bottom: 'calc(5.5rem + env(safe-area-inset-bottom, 0px))' }}>
          <span className="flex items-center gap-2 font-bold">
            <span className="bg-white/20 rounded-full min-w-[26px] h-6 px-1.5 flex items-center justify-center text-xs">
              {items.length}
            </span>
            Корзина
          </span>
          <span className="font-extrabold text-lg">{money(total, showCents)} ₽</span>
        </button>
      )}

      {/* Корзина листом — только на телефоне */}
      {cartOpen && (
        <ModalPortal>
          <div className="lg:hidden fixed inset-0 z-modal flex items-end justify-center bg-slate-900/60 backdrop-blur-sm"
               onClick={() => setCartOpen(false)}>
            <div className="bg-white dark:bg-slate-800 w-full rounded-t-3xl shadow-2xl max-h-[92vh] flex flex-col"
                 onClick={e => e.stopPropagation()}>
              <div className="px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between shrink-0">
                <h3 className="font-bold text-slate-800 dark:text-white">
                  Корзина <span className="text-slate-400 text-sm font-normal">{items.length}</span>
                </h3>
                <button onClick={() => setCartOpen(false)}
                        className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 font-bold">×</button>
              </div>
              <div className="overflow-y-auto p-4 space-y-3">
                {cartBody}
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Количество и цена */}
      {editing && (
        <ModalPortal>
          <div className="fixed inset-0 z-modal-top flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm"
               onClick={() => setEditing(null)}>
            <div className="bg-white dark:bg-slate-800 w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 space-y-3"
                 onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-800 dark:text-white truncate">{editing.product.name}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    На складе {money(editing.product.stock || 0)} {editing.product.unit || 'шт'}
                    {editing.product.buyPrice ? ` · закуп ${money(editing.product.buyPrice, showCents)} ₽` : ''}
                  </p>
                </div>
                {editing.existing && (
                  <button onClick={() => { setItems(prev => prev.filter(i => i.productId !== editing.product.id)); setEditing(null); }}
                          className="shrink-0 px-3 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 text-xs font-bold">
                    Убрать
                  </button>
                )}
              </div>

              {(['qty', 'price'] as const).map(f => (
                <button key={f} type="button" onClick={() => setField(f)}
                        className={`w-full p-3.5 rounded-2xl border-2 flex items-center justify-between transition-colors ${
                          field === f ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900'
                        }`}>
                  <span className="text-sm font-bold text-slate-400">
                    {f === 'qty' ? 'Количество' : 'Цена продажи'}
                  </span>
                  <span className="text-xl font-extrabold text-slate-800 dark:text-white">
                    {f === 'qty' ? qty : price}
                  </span>
                </button>
              ))}

              <div className="grid grid-cols-4 gap-2">
                {['1','2','3','DEL','4','5','6','*','7','8','9','=',',','0','C'].map(k => (
                  <button key={k} type="button" onClick={() => press(k)}
                          className={`h-12 rounded-xl font-bold text-lg active:scale-95 transition-transform ${
                            ['DEL','*','=','C'].includes(k)
                              ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'
                              : 'bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 border border-slate-100 dark:border-slate-700'
                          }`}>
                    {k === 'DEL' ? '←' : k}
                  </button>
                ))}
                <button type="button" onClick={applyEditing}
                        className="h-12 rounded-xl bg-indigo-600 text-white font-bold active:scale-95 transition-transform">
                  ✓
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Выбор клиента */}
      {pickCustomer && (
        <ModalPortal>
          <div className="fixed inset-0 z-modal-top flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm"
               onClick={() => setPickCustomer(false)}>
            <div className="bg-white dark:bg-slate-800 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[75vh] flex flex-col"
                 onClick={e => e.stopPropagation()}>
              <div className="p-4 border-b border-slate-100 dark:border-slate-700">
                <h3 className="font-bold text-slate-800 dark:text-white mb-2">Клиент</h3>
                <input value={customerSearch} onChange={e => setCustomerSearch(e.target.value)}
                       placeholder="Поиск по имени или телефону" className={input} />
              </div>
              <div className="overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
                {customers
                  .filter(c => {
                    const q = customerSearch.trim().toLowerCase();
                    return !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q);
                  })
                  .slice(0, 100)
                  .map(c => (
                    <button key={c.id} onClick={() => { setCustomerId(c.id); setPickCustomer(false); }}
                            className="w-full px-4 py-3 text-left active:bg-slate-50 dark:active:bg-slate-700">
                      <p className="font-semibold text-slate-800 dark:text-white truncate">{c.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{c.phone}</p>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Продажа проведена */}
      {done && (
        <ModalPortal>
          <div className="fixed inset-0 z-modal-top flex items-center justify-center p-6 bg-slate-900/70 backdrop-blur-sm"
               onClick={() => setDone(null)}>
            <div className="bg-white dark:bg-slate-800 w-full max-w-xs rounded-3xl shadow-2xl p-6 text-center space-y-4"
                 onClick={e => e.stopPropagation()}>
              <div className="w-16 h-16 rounded-full bg-emerald-500 text-white text-3xl flex items-center justify-center mx-auto">✓</div>
              <div>
                <h3 className="text-xl font-bold text-slate-800 dark:text-white">Продажа проведена</h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
                  № {done.docNumber} · {money(done.total, showCents)} ₽ · {done.items.length} поз.
                </p>
              </div>
              <button onClick={() => setDone(null)}
                      className="w-full py-3 rounded-2xl bg-indigo-600 text-white font-bold">
                Новая продажа
              </button>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};

export default RetailSale;
