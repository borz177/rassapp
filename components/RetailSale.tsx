import React, { useMemo, useState } from 'react';
import type { Account, Customer, Product, RetailSale as RetailSaleType, RetailSaleItem } from '../types';
import TopBarBack from './TopBarBack';
import ModalPortal from './ModalPortal';

interface RetailSaleProps {
  products: Product[];
  customers: Customer[];
  accounts: Account[];
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

/**
 * Розничная продажа за наличные.
 *
 * Отличается от продажи в рассрочку не только сроком: здесь корзина из
 * нескольких позиций с количеством, а покупатель по умолчанию безымянный —
 * в рознице человек платит и уходит, и требовать карточку клиента значило бы
 * добавлять шаг ради данных, которые никому не понадобятся. Выбрать клиента
 * можно, когда он действительно нужен: постоянный покупатель, возврат, гарантия.
 *
 * Старая форма продажи за наличные (тип CASH) не тронута — ей пользуются 59
 * человек, и переучивать их насильно незачем.
 */
const RetailSale: React.FC<RetailSaleProps> = ({
  products, customers, accounts, onSubmit, onBack, showCents = false,
}) => {
  const [items, setItems] = useState<RetailSaleItem[]>([]);
  const [search, setSearch] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string>(
    accounts.find(a => a.isMain && !a.isArchived)?.id || accounts.find(a => !a.isArchived)?.id || ''
  );
  const [discount, setDiscount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickCustomer, setPickCustomer] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');

  const available = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter(p => !p.isArchived)
      .filter(p => !q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      .slice(0, 40);
  }, [products, search]);

  const add = (p: Product) => {
    setItems(prev => {
      const found = prev.find(i => i.productId === p.id);
      if (found) {
        return prev.map(i => i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, {
        productId: p.id,
        name: p.name,
        quantity: 1,
        price: p.price || 0,
        buyPrice: p.buyPrice,
        unit: p.unit || 'шт',
      }];
    });
    setError(null);
  };

  const setQty = (productId: string, qty: number) =>
    setItems(prev => qty <= 0
      ? prev.filter(i => i.productId !== productId)
      : prev.map(i => i.productId === productId ? { ...i, quantity: qty } : i));

  const setPrice = (productId: string, price: number) =>
    setItems(prev => prev.map(i => i.productId === productId ? { ...i, price } : i));

  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const discountValue = Math.min(num(discount), subtotal);
  const total = subtotal - discountValue;
  const cost = items.reduce((s, i) => s + (i.buyPrice || 0) * i.quantity, 0);
  const profit = total - cost;

  const stockOf = (productId: string) => products.find(p => p.id === productId)?.stock ?? 0;
  // Продажу в минус не запрещаем — на практике товар часто оприходуют задним
  // числом. Но предупреждаем: молча уйти в минус хуже, чем видеть, что уходишь.
  const overdrawn = items.filter(i => i.quantity > stockOf(i.productId));

  const submit = async () => {
    if (items.length === 0) { setError('Добавьте хотя бы один товар'); return; }
    if (!accountId) { setError('Выберите счёт, на который поступят деньги'); return; }
    setSaving(true);
    try {
      await onSubmit({
        id: crypto.randomUUID(),
        userId: '',
        accountId,
        customerId: customerId || undefined,
        items,
        subtotal,
        discount: discountValue,
        total,
        cost,
        profit,
        note: note.trim() || undefined,
        date: new Date().toISOString(),
      });
      setItems([]); setDiscount(''); setNote(''); setCustomerId(null);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Не удалось провести продажу');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200 outline-none focus:border-indigo-400';
  const customer = customers.find(c => c.id === customerId);
  const liveAccounts = accounts.filter(a => !a.isArchived || a.id === accountId);

  return (
    <div className="space-y-4 pb-40">
      <div className="flex items-center gap-3">
        <TopBarBack onClick={onBack} />
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">Продажа за наличные</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Розничный чек с несколькими позициями</p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Корзина */}
      {items.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
          {items.map(i => {
            const short = i.quantity > stockOf(i.productId);
            return (
              <div key={i.productId} className="p-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-800 dark:text-white truncate">{i.name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      value={String(i.price)} onChange={e => setPrice(i.productId, num(e.target.value))}
                      inputMode="decimal"
                      className="w-24 p-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-xs text-slate-700 dark:text-slate-200"
                    />
                    <span className="text-xs text-slate-400">₽ ×</span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setQty(i.productId, i.quantity - 1)}
                              className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold">−</button>
                      <input
                        value={String(i.quantity)} onChange={e => setQty(i.productId, num(e.target.value))}
                        inputMode="decimal"
                        className="w-14 p-1.5 text-center rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-xs text-slate-700 dark:text-slate-200"
                      />
                      <button onClick={() => setQty(i.productId, i.quantity + 1)}
                              className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold">+</button>
                    </div>
                    <span className="text-xs text-slate-400">{i.unit}</span>
                  </div>
                  {short && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                      На складе {money(stockOf(i.productId))} — остаток уйдёт в минус
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-slate-800 dark:text-white">{money(i.price * i.quantity, showCents)} ₽</p>
                  <button onClick={() => setQty(i.productId, 0)} className="text-[11px] text-rose-500">убрать</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Выбор товара */}
      <input value={search} onChange={e => setSearch(e.target.value)}
             placeholder="Поиск товара по названию или артикулу" className={inputCls} />

      <div className="grid gap-2">
        {available.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center">
            {products.length === 0 ? 'Сначала добавьте товары на склад.' : 'Ничего не найдено.'}
          </p>
        ) : available.map(p => (
          <button key={p.id} onClick={() => add(p)}
                  className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-2.5 flex items-center gap-3 text-left active:scale-[0.99] transition-transform">
            <div className="w-11 h-11 rounded-lg bg-slate-100 dark:bg-slate-700 overflow-hidden shrink-0 flex items-center justify-center">
              {p.images?.[0]
                ? <img src={p.images[0]} alt="" className="w-full h-full object-cover" loading="lazy" />
                : <span className="text-slate-400">📦</span>}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-800 dark:text-white truncate text-sm">{p.name}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {money(p.price, showCents)} ₽ · на складе {money(p.stock || 0)} {p.unit || 'шт'}
              </p>
            </div>
            <span className="text-indigo-600 dark:text-indigo-400 font-bold shrink-0">+</span>
          </button>
        ))}
      </div>

      {/* Покупатель, счёт, скидка */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Покупатель</p>
            <p className="font-semibold text-slate-800 dark:text-white truncate">
              {customer ? customer.name : 'Розничный покупатель'}
            </p>
          </div>
          {customer ? (
            <button onClick={() => setCustomerId(null)}
                    className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold shrink-0">
              Убрать
            </button>
          ) : (
            <button onClick={() => setPickCustomer(true)}
                    className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold shrink-0">
              Выбрать клиента
            </button>
          )}
        </div>

        <div>
          <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">Счёт</p>
          <select value={accountId} onChange={e => setAccountId(e.target.value)} className={inputCls}>
            {liveAccounts.length === 0 && <option value="">Нет счетов</option>}
            {liveAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <input value={discount} onChange={e => setDiscount(e.target.value)} inputMode="decimal"
                 placeholder="Скидка, ₽" className={inputCls} />
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Комментарий" className={inputCls} />
        </div>
      </div>

      {/* Итог и кнопка — липкие снизу, чтобы не искать их под длинным списком */}
      {items.length > 0 && (
        <div className="sticky bottom-0 -mx-4 px-4 pt-3 pb-4 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur border-t border-slate-200 dark:border-slate-700">
          <div className="flex items-end justify-between mb-2">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {items.length} поз. · {money(subtotal, showCents)} ₽
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
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-2">
              По {overdrawn.length} позиц. остаток уйдёт в минус — проверьте приход.
            </p>
          )}
          <button disabled={saving} onClick={submit}
                  className="w-full py-3.5 rounded-2xl bg-emerald-600 text-white font-bold disabled:opacity-50 active:scale-[0.99] transition-transform">
            Провести продажу
          </button>
        </div>
      )}

      {pickCustomer && (
        <ModalPortal>
          <div className="fixed inset-0 z-modal flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm"
               onClick={() => setPickCustomer(false)}>
            <div className="bg-white dark:bg-slate-800 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[75vh] flex flex-col"
                 onClick={e => e.stopPropagation()}>
              <div className="p-4 border-b border-slate-100 dark:border-slate-700">
                <h3 className="font-bold text-slate-800 dark:text-white mb-2">Клиент</h3>
                <input value={customerSearch} onChange={e => setCustomerSearch(e.target.value)}
                       placeholder="Поиск по имени или телефону" className={inputCls} />
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
              <div className="p-4 border-t border-slate-100 dark:border-slate-700">
                <button onClick={() => setPickCustomer(false)}
                        className="w-full py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-sm">
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};

export default RetailSale;
