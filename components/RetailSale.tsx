import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Account, Customer, Product, RetailSale as RetailSaleType, RetailSaleItem, StockLocation } from '../types';
import TopBarBack from './TopBarBack';
import { maxPickableQty, stockOnWarehouse } from '../src/utils';
import { DEFAULT_WAREHOUSE_ID } from '../types';
import Sheet from './Sheet';
import { SuccessCheck, hapticSuccess } from './feedback';
import SubPage from './transitions/SubPage';
import SelectionList from './SelectionList';
import BarcodeScanner, { ScanButton, type ScanOutcome } from './BarcodeScanner';
import { findProductByCode, productMatchesQuery } from '../src/barcode';
import { useBarcodeScanInput } from '../src/barcodeWedge';
import { scanBeep } from '../src/scanFeedback';
import ProductImage from './ProductImage';

interface RetailSaleProps {
  products: Product[];
  customers: Customer[];
  accounts: Account[];
  /** Счёт склада, с которого идёт торговля; подставляется в чек по умолчанию */
  defaultAccountId?: string;
  /** Склад, с которого продаём: с него же и списывается товар */
  warehouseId?: string;
  /** Склады магазина: по ним остаток основного учитывает товар, заведённый до складов */
  warehouses?: StockLocation[];
  /** Прошлые чеки — нужны только для следующего номера документа */
  existingSales?: RetailSaleType[];
  onSubmit: (sale: RetailSaleType) => Promise<void> | void;
  /** Настройка магазина: можно ли пробить больше, чем лежит на складе */
  allowNegativeStock?: boolean;
  /** Распознавание паспорта в форме нового клиента */
  canScanPassport?: boolean;
  /** Завести клиента прямо из выбора, не уходя из чека */
  /** Клиенты рассрочки: в выборе покупателя они ниже, находятся поиском */
  customerSecondaryIds?: ReadonlySet<string>;
  onQuickAddCustomer?: (data: {
    name: string; phone: string; address?: string;
    passportSeries?: string; passportNumber?: string; passportIssuedBy?: string;
    photo?: string; birthDate?: string;
  }) => Promise<Customer | undefined>;
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
  products, customers, accounts, defaultAccountId, warehouseId = DEFAULT_WAREHOUSE_ID, warehouses = [], onQuickAddCustomer, customerSecondaryIds,
  allowNegativeStock = false, canScanPassport = false,
  existingSales = [], onSubmit, onBack, showCents = false,
}) => {
  const [items, setItems] = useState<RetailSaleItem[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('ALL');
  const [cartOpen, setCartOpen] = useState(false);

  const [customerId, setCustomerId] = useState<string | null>(null);
  // Долг возможен только с названным покупателем: с «розничного покупателя»
  // потом некому спросить. Поэтому выбор клиента и включает долг, и снимается
  // вместе с ним.
  const [isCredit, setIsCredit] = useState(false);
  const [pickCustomer, setPickCustomer] = useState(false);
  // На телефоне «Выбрать клиента» нажимают внутри листа корзины, а страница
  // выбора открывается уровнем ниже — под листом, и её не было видно. Лист на
  // время выбора убираем и после возвращаем.
  const reopenCartRef = useRef(false);
  const openCustomerPicker = () => {
    if (cartOpen) { reopenCartRef.current = true; setCartOpen(false); }
    setPickCustomer(true);
  };
  const closeCustomerPicker = () => {
    setPickCustomer(false);
    if (reopenCartRef.current) { reopenCartRef.current = false; setCartOpen(true); }
  };

  // Счёт склада важнее общего «основного»: магазин сдаёт выручку в свою кассу,
  // и если склад её назвал — спорить с ним незачем.
  const [accountId, setAccountId] = useState<string>(
    (defaultAccountId && accounts.some(a => a.id === defaultAccountId && !a.isArchived) ? defaultAccountId : '')
    || accounts.find(a => a.isMain && !a.isArchived)?.id
    || accounts.find(a => !a.isArchived)?.id
    || ''
  );
  const [discount, setDiscount] = useState('');
  // Скидку называют и рублями, и процентами: «минус пятьсот» и «минус десять
  // процентов» одинаково обычны. Раньше проценты приходилось считать в уме.
  const [discountMode, setDiscountMode] = useState<'RUB' | 'PERCENT'>('RUB');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<RetailSaleType | null>(null);
  const [scanOpen, setScanOpen] = useState(false);

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
    return products
      .filter(p => !p.isArchived)
      .filter(p => category === 'ALL' || p.category === category)
      .filter(p => productMatchesQuery(p, search))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [products, category, search]);

  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  // В чек уходит сумма: проценты — способ её назвать, а не отдельная скидка.
  // Копейки округляем сразу, иначе итог разойдётся с суммой в чеке.
  const discountValue = Math.min(
    discountMode === 'PERCENT'
      ? Math.round(subtotal * Math.min(num(discount), 100)) / 100
      : num(discount),
    subtotal
  );
  const total = subtotal - discountValue;
  const cost = items.reduce((s, i) => s + (i.buyPrice || 0) * i.quantity, 0);
  const profit = total - cost;
  const totalQty = items.reduce((s, i) => s + i.quantity, 0);

  // Остаток берём того склада, с которого продаём, а не суммарный по всем.
  // С суммарным касса молчала бы, когда в торговом зале пусто, а товар лежит в
  // подсобке: чек прошёл бы, а остаток зала ушёл в минус.
  const stockOf = (id: string) => {
    const p = products.find(x => x.id === id);
    return p ? stockOnWarehouse(p, warehouseId, warehouses) : 0;
  };
  const overdrawn = items.filter(i => i.quantity > stockOf(i.productId));

  const openProduct = (p: Product) => {
    // Сообщение от прошлого товара в новой панели только путало бы.
    setError(null);
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

  const applyEditing = (): boolean => {
    if (!editing) return false;
    const pr = num(price);
    const id = editing.product.id;
    // Продажа в минус выключена — дальше остатка не пускаем и говорим почему.
    // Молча урезать количество нельзя: кассир увидел бы в чеке не то, что набрал.
    const left = stockOnWarehouse(editing.product, warehouseId, warehouses);
    if (num(qty) > maxPickableQty(left, allowNegativeStock)) {
      setError(left > 0
        ? `На складе ${money(left)} ${editing.product.unit || 'шт'} — продажа в минус выключена в настройках магазина.`
        : `«${editing.product.name}» нет на складе — продажа в минус выключена в настройках магазина.`);
      return false;
    }
    const q = num(qty);
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
    setError(null);
    return true;
  };

  /**
   * Скан на кассе — плюс одна штука в корзину, без окна количества: так
   * пробивают чек в любом магазине, и окно на каждый товар задержало бы очередь.
   * Цена — из карточки, как при нажатии на плитку; поправить её можно в корзине.
   * Остаток проверяем тем же правилом, что и ручной выбор.
   */
  const addScanned = (code: string): ScanOutcome => {
    const match = findProductByCode(products, code);
    if (!match) return { tone: 'error', title: 'Товар не найден', subtitle: code };
    const p = match.product;
    if (p.isArchived) return { tone: 'error', title: `«${p.name}» в архиве`, subtitle: 'Верните его из архива на складе' };

    const unit = p.unit || 'шт';
    const nextQty = (items.find(i => i.productId === p.id)?.quantity || 0) + 1;
    const left = stockOnWarehouse(p, warehouseId, warehouses);
    if (nextQty > maxPickableQty(left, allowNegativeStock)) {
      return {
        tone: 'error',
        title: left > 0 ? `На складе только ${money(left)} ${unit}` : `«${p.name}» нет на складе`,
        subtitle: 'Продажа в минус выключена в настройках магазина',
      };
    }

    setItems(prev => prev.some(i => i.productId === p.id)
      ? prev.map(i => i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i)
      : [...prev, { productId: p.id, name: p.name, quantity: 1, price: p.price || 0, buyPrice: p.buyPrice, unit }]);
    setError(null);
    const intoMinus = nextQty > left;
    return {
      tone: intoMinus ? 'warn' : 'ok',
      title: `+1 ${p.name}`,
      subtitle: `${money(p.price || 0, showCents)} ₽ · в корзине ${money(nextQty)} ${unit}${intoMinus ? ' · уйдёт в минус' : ''}`,
    };
  };

  // Ручной сканер работает, пока открыта сама касса. Поверх открытого окна
  // количества или выбора клиента код пробился бы незаметно для кассира.
  useBarcodeScanInput(code => {
    const result = addScanned(code);
    scanBeep(result.tone);
    setError(result.tone === 'error' ? `${result.title}${result.subtitle ? `. ${result.subtitle}` : ''}` : null);
  }, !scanOpen && !editing && !done && !pickCustomer);

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
        isCredit: customerId ? isCredit : false,
        note: note.trim() || undefined,
        docNumber: docNumber.trim() || nextDocNumber,
        date: date.toISOString(),
      };
      await onSubmit(sale);
      // Короткий отклик в руку — как при оформлении договора: подтверждение
      // приходит раньше, чем глаз доберётся до галочки.
      hapticSuccess();
      setDone(sale);
      setItems([]); setDiscount(''); setNote(''); setCustomerId(null); setIsCredit(false);
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
  const errorBanner = (
    <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
      {error}
    </div>
  );

  // ± в строке корзины — без окна количества. Те же правила склада, что у
  // окна и сканера: в минус не уходим, если это выключено в настройках.
  const stepQty = (id: string, delta: number) => {
    const item = items.find(i => i.productId === id);
    if (!item) return;
    const next = Math.round((item.quantity + delta) * 1000) / 1000;
    if (next <= 0) { setItems(prev => prev.filter(i => i.productId !== id)); return; }
    const left = stockOf(id);
    if (delta > 0 && next > maxPickableQty(left, allowNegativeStock)) {
      setError(left > 0
        ? `На складе ${money(left)} ${item.unit || 'шт'} — продажа в минус выключена в настройках магазина.`
        : `«${item.name}» нет на складе — продажа в минус выключена в настройках магазина.`);
      return;
    }
    setError(null);
    setItems(prev => prev.map(i => (i.productId === id ? { ...i, quantity: next } : i)));
  };

  // Новая позиция добавляется в конец — докручиваем список к ней
  const prevCount = useRef(items.length);
  useEffect(() => {
    if (items.length > prevCount.current) {
      document.querySelectorAll<HTMLElement>('[data-cart-list]').forEach(el => { el.scrollTop = el.scrollHeight; });
    }
    prevCount.current = items.length;
  }, [items.length, cartOpen]);

  const positionsWord = (n: number) => n % 10 === 1 && n % 100 !== 11 ? 'товар'
    : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'товара' : 'товаров';

  const cartBody = (
    <div className="space-y-3">
      {/* Чек: номер и дата одной строкой — как шапка накладной, но без лишней высоты */}
      <div className="flex items-center gap-2 text-sm">
        <label className="flex items-center gap-1.5 h-9 pl-3 pr-2 rounded-xl bg-slate-100 dark:bg-slate-900 min-w-0 flex-1">
          <span className="text-slate-400 shrink-0">Чек №</span>
          <input value={docNumber} onChange={e => setDocNumber(e.target.value)} placeholder={nextDocNumber}
                 className="w-full min-w-0 bg-transparent outline-none font-bold text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500" />
        </label>
        <input type="date" value={saleDate} onChange={e => setSaleDate(e.target.value)} aria-label="Дата"
               className="h-9 px-2.5 rounded-xl bg-slate-100 dark:bg-slate-900 outline-none font-semibold text-indigo-600 dark:text-indigo-400 text-[13px]" />
      </div>

      {/* Позиции */}
      {items.length === 0 ? (
        <div className="py-10 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-400">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 4h2.2l2.3 11.2a1.5 1.5 0 0 0 1.5 1.2h8.3a1.5 1.5 0 0 0 1.5-1.1L21 8H6" /><circle cx="9.5" cy="20" r="1.3" /><circle cx="17" cy="20" r="1.3" /></svg>
          </div>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Корзина пуста — нажмите на товар</p>
        </div>
      ) : (
        // Список прокручивается внутри своего окна: при многих позициях
        // покупатель, скидка и итог остаются на месте
        <div data-cart-list className="rounded-2xl bg-slate-50 dark:bg-slate-900/60 divide-y divide-slate-200/70 dark:divide-slate-700/70 max-h-[34vh] lg:max-h-[max(8rem,calc(100vh-40rem))] overflow-y-auto overscroll-contain">
          {items.map(i => {
            const short = i.quantity > stockOf(i.productId);
            const product = products.find(p => p.id === i.productId);
            const edit = () => { setCartOpen(false); if (product) openProduct(product); };
            return (
              <div key={i.productId} className="flex items-center gap-2.5 px-2.5 py-2">
                <button type="button" onClick={edit} aria-label="Изменить количество и цену"
                        className="w-10 h-10 rounded-xl bg-white dark:bg-slate-800 overflow-hidden shrink-0 flex items-center justify-center">
                  <ProductImage src={product?.images?.[0]} className="w-full h-full object-cover"
                                fallback={<span className="text-slate-400 text-sm">📦</span>} />
                </button>
                <div className="min-w-0 flex-1">
                  {/* Строка 1: название и сумма; строка 2: цена за единицу и − кол-во + */}
                  <div className="flex items-baseline gap-2">
                    <button type="button" onClick={edit}
                            className="min-w-0 flex-1 text-left font-semibold text-slate-800 dark:text-white text-[13px] leading-tight truncate">{i.name}</button>
                    <span className="shrink-0 font-bold text-slate-900 dark:text-white text-[13px] tabular-nums">{money(i.price * i.quantity, showCents)} ₽</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[11px] text-slate-500 dark:text-slate-400">
                      {money(i.price, showCents)} ₽/{i.unit}
                      {short && <span className="text-amber-600 dark:text-amber-400"> · на складе {money(stockOf(i.productId))}</span>}
                    </span>
                    <div className="shrink-0 flex items-center h-7 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                      <button type="button" onClick={() => stepQty(i.productId, -1)} aria-label="Меньше"
                              className="w-7 h-7 rounded-full flex items-center justify-center text-slate-500 dark:text-slate-300 active:bg-slate-100 dark:active:bg-slate-700">
                        {i.quantity <= 1
                          ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-rose-500" aria-hidden><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
                          : <span className="text-base leading-none font-bold">−</span>}
                      </button>
                      <span className="min-w-[24px] text-center text-[13px] font-bold tabular-nums text-slate-800 dark:text-white">{money(i.quantity)}</span>
                      <button type="button" onClick={() => stepQty(i.productId, 1)} aria-label="Больше"
                              className="w-7 h-7 rounded-full flex items-center justify-center text-indigo-600 dark:text-indigo-300 active:bg-slate-100 dark:active:bg-slate-700">
                        <span className="text-base leading-none font-bold">+</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Покупатель */}
      <div className="rounded-2xl bg-slate-50 dark:bg-slate-900/60 p-2.5">
        <div className="flex items-center gap-3">
          <span className={`w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-sm font-bold ${customer
            ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-400'}`}>
            {customer ? customer.name.charAt(0).toUpperCase() : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Покупатель</p>
            <p className="font-semibold text-slate-800 dark:text-white truncate text-sm">{customer ? customer.name : 'Без клиента'}</p>
          </div>
          <button type="button" onClick={() => { if (customer) { setCustomerId(null); setIsCredit(false); } else openCustomerPicker(); }}
                  className={`shrink-0 h-8 px-3 rounded-full text-xs font-bold ${customer
                    ? 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                    : 'bg-indigo-600 text-white'}`}>
            {customer ? 'Убрать' : 'Выбрать'}
          </button>
        </div>
        {/* Клиента выбирают ровно тогда, когда его нужно потом найти, — то есть
            когда деньги ещё не получены. Поэтому долг по умолчанию, но
            переключить можно: клиент может и заплатить сразу. */}
        {customer && (
          <div className="mt-2.5 flex p-1 rounded-xl bg-white dark:bg-slate-800">
            {([[false, 'Оплачено'], [true, 'В долг']] as const).map(([v, label]) => (
              <button key={label} type="button" onClick={() => setIsCredit(v)}
                      className={`flex-1 min-w-0 py-1.5 rounded-lg text-xs font-bold transition-colors ${isCredit === v
                        ? (v ? 'bg-amber-500 text-white' : 'bg-emerald-600 text-white')
                        : 'text-slate-500 dark:text-slate-400'}`}>{label}</button>
            ))}
          </div>
        )}
        {customer && isCredit && (
          <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400 leading-snug">
            Деньги в кассу не поступают — сумма встаёт долгом за клиентом. Погашение — через «Приход».
          </p>
        )}
      </div>

      {/* Счёт, скидка, комментарий */}
      <label className="flex items-center gap-2 h-10 pl-3 pr-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 text-sm">
        <span className="text-slate-400 shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="2" y="6" width="20" height="14" rx="2" /><path d="M16 13h2M2 10h20" /></svg>
        </span>
        <select value={accountId} onChange={e => setAccountId(e.target.value)}
                className="flex-1 min-w-0 bg-transparent outline-none font-semibold text-slate-700 dark:text-slate-200">
          {liveAccounts.length === 0 && <option value="">Нет счетов</option>}
          {liveAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <div className="relative">
          <input value={discount} onChange={e => setDiscount(e.target.value)} inputMode="decimal"
                 placeholder="Скидка" className="w-full h-10 pl-3 pr-16 rounded-xl bg-slate-50 dark:bg-slate-900/60 text-sm outline-none text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-indigo-400/40" />
          {/* Рубли и проценты — одно поле: лишняя строка в корзине ни к чему */}
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center rounded-lg bg-slate-200/70 dark:bg-slate-700 p-0.5">
            {(['RUB', 'PERCENT'] as const).map(mode => (
              <button key={mode} type="button" onClick={() => setDiscountMode(mode)}
                      aria-label={mode === 'RUB' ? 'Скидка в рублях' : 'Скидка в процентах'}
                      className={`w-6 h-6 rounded-md text-xs font-bold transition-colors ${discountMode === mode
                        ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-400'}`}>
                {mode === 'RUB' ? '₽' : '%'}
              </button>
            ))}
          </div>
        </div>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Комментарий"
               className="w-full h-10 px-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 text-sm outline-none text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-indigo-400/40" />
      </div>

      {/* Итог и кнопка закреплены внизу: позиции прокручиваются над ними */}
      <div className="sticky bottom-0 -mx-4 px-4 pt-2 pb-1 space-y-3 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700/60">
      <div className="space-y-1">
        {discountValue > 0 && (
          <>
            <div className="flex justify-between text-[13px] text-slate-500 dark:text-slate-400">
              <span>{money(totalQty)} ед.</span><span className="tabular-nums">{money(subtotal, showCents)} ₽</span>
            </div>
            <div className="flex justify-between text-[13px] text-rose-500">
              <span>Скидка{discountMode === 'PERCENT' ? ` ${money(Math.min(num(discount), 100))}%` : ''}</span>
              <span className="tabular-nums">−{money(discountValue, showCents)} ₽</span>
            </div>
          </>
        )}
        <div className="flex items-end justify-between">
          <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">Итого</span>
          <span className="text-[28px] leading-none font-extrabold text-slate-900 dark:text-white tabular-nums">
            {money(total, showCents)} <span className="text-lg text-slate-400">₽</span>
          </span>
        </div>
        {cost > 0 && (
          <p className={`text-right text-xs font-bold ${profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
            прибыль {money(profit, showCents)} ₽
          </p>
        )}
      </div>

      {allowNegativeStock && overdrawn.length > 0 && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          По {overdrawn.length} позиц. остаток уйдёт в минус — проверьте приход.
        </p>
      )}

      <button disabled={saving || items.length === 0} onClick={submit}
              className={`w-full h-14 rounded-2xl text-white font-bold disabled:opacity-40 active:scale-[0.99] transition flex items-center justify-center px-5 shadow-lg ${
                customer && isCredit ? 'bg-amber-500 shadow-amber-500/25' : 'bg-emerald-600 shadow-emerald-600/25'
              }`}>
        <span>{saving ? 'Проводим…' : customer && isCredit ? 'Отдать в долг' : 'Провести продажу'}</span>
      </button>
      </div>
    </div>
  );

  /** Шапка корзины: название, число позиций и «Очистить» */
  const cartHeader = (onClose?: () => void) => (
    <div className="flex items-center justify-between gap-3">
      <h3 className="font-bold text-lg text-slate-900 dark:text-white">
        Корзина {items.length > 0 && <span className="text-slate-400 text-sm font-semibold">· {items.length} {positionsWord(items.length)}</span>}
      </h3>
      <div className="flex items-center gap-1">
        {items.length > 0 && (
          <button type="button" onClick={() => { setItems([]); setDiscount(''); }}
                  className="h-8 px-2.5 rounded-full text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-rose-600">Очистить</button>
        )}
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Закрыть"
                  className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 font-bold active:scale-90 transition-transform">×</button>
        )}
      </div>
    </div>
  );

  return (
    <div className={`${items.length > 0 ? 'pb-44' : 'pb-24'} lg:pb-6`}>
      <div className="flex items-center gap-3 mb-3">
        <TopBarBack onClick={onBack} />
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">Касса</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Продажа за наличные</p>
        </div>
      </div>

      {/* На экране кассы сообщение стоит над витриной; внутри листов — своё,
          иначе оно печатается под оверлеем и человек его не видит. */}
      {error && <div className="mb-3">{errorBanner}</div>}

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

          <div className="flex gap-2">
            <input value={search} onChange={e => setSearch(e.target.value)}
                   placeholder="Название, артикул или штрихкод" className={input} />
            <ScanButton onClick={() => setScanOpen(true)} />
          </div>

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
                const stock = stockOnWarehouse(p, warehouseId, warehouses);
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
                      <ProductImage src={p.images?.[0]} className="w-full h-full object-cover" loading="lazy"
                                    fallback={<span className="text-2xl text-slate-300">📦</span>} />
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
          <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 space-y-3 max-h-[calc(100vh-12rem)] overflow-y-auto">
            {cartHeader()}
            {cartBody}
          </div>
        </aside>
      </div>

      {/* Кнопка корзины — только на телефоне: тёмная плашка с миниатюрами,
          суммой и «Оформить». Подпрыгивает при каждом новом товаре. */}
      {items.length > 0 && !cartOpen && !editing && !pickCustomer && (
        <div className="lg:hidden fixed left-3 right-3 z-40" style={{ bottom: 'calc(5.75rem + env(safe-area-inset-bottom, 0px))' }}>
          <button key={totalQty} onClick={() => setCartOpen(true)}
                  className="cart-pop w-full h-16 rounded-[22px] bg-slate-900 dark:bg-slate-800 text-white pl-2.5 pr-2 flex items-center gap-3 shadow-2xl shadow-slate-900/30 ring-1 ring-white/10 active:scale-[0.98] transition-transform">
            <span className="flex -space-x-3 shrink-0">
              {items.slice(-3).reverse().map(i => {
                const product = products.find(p => p.id === i.productId);
                return (
                  <span key={i.productId} className="w-10 h-10 rounded-full ring-2 ring-slate-900 dark:ring-slate-800 bg-slate-700 overflow-hidden flex items-center justify-center">
                    <ProductImage src={product?.images?.[0]} className="w-full h-full object-cover"
                                  fallback={<span className="text-sm">📦</span>} />
                  </span>
                );
              })}
            </span>
            <span className="min-w-0 text-left">
              <span className="block text-[11px] text-slate-400 leading-none">{items.length} {positionsWord(items.length)}</span>
              <span className="block text-lg font-extrabold tabular-nums leading-tight mt-0.5">{money(total, showCents)} ₽</span>
            </span>
            <span className="ml-auto h-12 px-4 rounded-2xl bg-white text-slate-900 font-bold text-sm flex items-center gap-1.5">
              Оформить
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </span>
          </button>
        </div>
      )}

      {/* Корзина листом — только на телефоне */}
      {cartOpen && (
        <Sheet onClose={() => setCartOpen(false)} className="lg:hidden max-h-[92vh] flex flex-col">
          {(close: () => void) => (
            <>
              <div className="px-4 pt-3 pb-2 shrink-0">
                {cartHeader(close)}
              </div>
              <div className="overflow-y-auto px-4 pb-4 pt-1 space-y-3">
                {error && errorBanner}
                {cartBody}
              </div>
            </>
          )}
        </Sheet>
      )}

      {/* Количество и цена */}
      {editing && (
        <Sheet onClose={() => setEditing(null)} className="sm:max-w-sm p-5 space-y-3">
          {(close: () => void) => (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-800 dark:text-white truncate">{editing.product.name}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    На складе {money(stockOnWarehouse(editing.product, warehouseId, warehouses))} {editing.product.unit || 'шт'}
                    {editing.product.buyPrice ? ` · закуп ${money(editing.product.buyPrice, showCents)} ₽` : ''}
                  </p>
                </div>
                {editing.existing && (
                  <button type="button" onClick={() => { setItems(prev => prev.filter(i => i.productId !== editing.product.id)); close(); }}
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

              {error && errorBanner}

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
                <button type="button" onClick={() => { if (applyEditing()) close(); }}
                        className="h-12 rounded-xl bg-indigo-600 text-white font-bold active:scale-95 transition-transform">
                  ✓
                </button>
              </div>
            </>
          )}
        </Sheet>
      )}

      {/* Выбор клиента — та же страница, что и при оформлении рассрочки, и тот же
          выезд справа. Раньше здесь было своё окно с урезанным поиском: нового
          клиента из него завести было нельзя, а список обрывался на сотне.
          Подстраницей, а не отдельным экраном: корзина остаётся смонтированной,
          и набранный чек не теряется на время выбора. */}
      {pickCustomer && (
        <SubPage onClose={closeCustomerPicker}>
          {(close: () => void) => (
            <SelectionList
              title="Выберите клиента"
              canScanPassport={canScanPassport}
              items={customers.map(c => ({ id: c.id, title: c.name, subtitle: c.phone }))}
              secondaryIds={customerSecondaryIds}
              secondaryLabel="Клиенты рассрочки"
              onSelect={id => { setCustomerId(id); setIsCredit(true); close(); }}
              onCancel={close}
              onAddNew={async data => {
                const saved = await onQuickAddCustomer?.(data);
                // Клиента заводят прямо посреди продажи ради этой самой продажи —
                // выбираем его сразу, иначе список пришлось бы листать заново.
                if (saved) { setCustomerId(saved.id); setIsCredit(true); }
                close();
              }}
            />
          )}
        </SubPage>
      )}

      {scanOpen && (
        <BarcodeScanner
          continuous
          title="Касса: сканирование"
          onClose={() => setScanOpen(false)}
          onCode={addScanned}
          footer={items.length > 0
            ? `Корзина: ${money(totalQty)} ед. · ${money(total, showCents)} ₽`
            : 'Наведите камеру на штрихкод товара'}
        />
      )}

      {/* Продажа проведена */}
      {done && (
        <Sheet variant="dialog" onClose={() => setDone(null)} className="p-6 text-center space-y-4">
          {(close: () => void) => (
            <>
              {/* Та же галочка, что после оформления договора и расхода: успех
                  в приложении выглядит одинаково, где бы его ни подтверждали. */}
              <SuccessCheck size={68} />
              <div>
                <h3 className="text-xl font-bold text-slate-800 dark:text-white">Продажа проведена</h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
                  № {done.docNumber} · {money(done.total, showCents)} ₽ · {done.items.length} поз.
                </p>
              </div>
              <button type="button" onClick={close}
                      className="w-full py-3 rounded-2xl bg-indigo-600 text-white font-bold active:scale-95 transition-transform">
                Новая продажа
              </button>
            </>
          )}
        </Sheet>
      )}
    </div>
  );
};

export default RetailSale;
