import React, { useMemo, useState } from 'react';
import type { Account, Customer, Product, RetailSale } from '../types';
import { ICONS } from '../constants';
import { formatCurrency, retailPaidAmount, retailRemaining } from '../src/utils';
import AccountHead from './AccountHead';
import Sheet from './Sheet';

interface DashboardCashProps {
  retailSales: RetailSale[];
  products: Product[];
  /** Нужны, чтобы показать, кто именно должен */
  customers?: Customer[];
  /** Счёт магазина: остаток, кнопки прихода и расхода, фильтр цифр */
  accounts?: Account[];
  accountBalances?: Record<string, number>;
  selectedAccountId?: string | null;
  onSelectAccount?: (id: string | null) => void;
  hideBalance?: boolean;
  onToggleHideBalance?: () => void;
  canMoveMoney?: boolean;
  /** Переход в карточку должника из расшифровки */
  onSelectCustomer?: (id: string) => void;
  onAction: (action: string, payload?: any) => void;
  showCents?: boolean;
  /** Долг за товар, принятый на склад накладной. К рассрочке отношения не имеет. */
  supplierDebt?: { rows: { supplierId: string; name: string; amount: number }[]; total: number };
}

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const startOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};

const plural = (n: number, one: string, few: string, many: string) => {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};

/**
 * Вкладка «Наличные» на главном экране.
 *
 * Отвечает на вопросы, ради которых в магазин заглядывают в течение дня:
 * сколько в кассе, сколько наторговали, кто остался должен, что заканчивается и
 * что пробили последним. Разбор по товарам и периодам живёт в отчётах — здесь
 * он только заслонил бы главное.
 *
 * Слово «чек» из подписей убрано: чек — это бумажка, а считаем мы продажи и
 * выручку. «Средняя продажа» понятнее «среднего чека» тому, кто не работал в
 * рознице, и не путается с печатью чека.
 *
 * Прибыль берём из самих продаж: цена и себестоимость зафиксированы в момент
 * продажи, и пересчёт по нынешним значениям переписывал бы прошлую маржу после
 * каждой переоценки.
 */
const DashboardCash: React.FC<DashboardCashProps> = ({
  retailSales, products, customers = [], accounts = [], accountBalances = {},
  selectedAccountId = null, onSelectAccount, hideBalance = false, onToggleHideBalance,
  canMoveMoney = true, onSelectCustomer, onAction, showCents = false, supplierDebt,
}) => {
  const [debtOpen, setDebtOpen] = useState(false);
  const [supplierDebtOpen, setSupplierDebtOpen] = useState(false);

  // Выбранный счёт — это выбранная касса: цифры показываем по ней же, иначе
  // остаток относился бы к одной точке, а выручка — ко всем сразу.
  const live = useMemo(
    () => retailSales.filter(s => !s.isCancelled && (!selectedAccountId || s.accountId === selectedAccountId)),
    [retailSales, selectedAccountId]
  );

  const sum = (list: RetailSale[]) => ({
    revenue: list.reduce((s, x) => s + x.total, 0),
    profit: list.reduce((s, x) => s + x.profit, 0),
    count: list.length,
  });

  const today = useMemo(() => {
    const from = startOfToday();
    return sum(live.filter(s => new Date(s.date).getTime() >= from));
  }, [live]);

  const month = useMemo(() => {
    const from = startOfMonth();
    return sum(live.filter(s => new Date(s.date).getTime() >= from));
  }, [live]);

  const avgSale = today.count ? today.revenue / today.count : 0;

  // Выручка считается по отгрузке, но деньги за продажу в долг ещё не пришли.
  // Одна выручка обещала бы деньги, которых в кассе нет, — поэтому долг стоит
  // рядом с ней отдельной карточкой, а не примечанием мелким шрифтом.
  //
  // Группируем по клиенту, а не по продаже: спрашивают долг с человека, и три
  // его продажи по отдельности заставляют складывать в уме.
  const debtors = useMemo(() => {
    const map = new Map<string, { name: string; amount: number; sales: RetailSale[] }>();
    live.forEach(s => {
      const left = retailRemaining(s);
      if (left <= 0) return;
      const key = s.customerId || 'unknown';
      const cur = map.get(key) || {
        name: customers.find(c => c.id === s.customerId)?.name || 'Без карточки клиента',
        amount: 0, sales: [] as RetailSale[],
      };
      cur.amount += left;
      cur.sales.push(s);
      map.set(key, cur);
    });
    const rows = Array.from(map.entries())
      .map(([customerId, v]) => ({ customerId, ...v }))
      .sort((a, b) => b.amount - a.amount);
    return { rows, total: rows.reduce((sum, r) => sum + r.amount, 0) };
  }, [live, customers]);

  const recent = useMemo(
    () => [...live].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 6),
    [live]
  );

  // Товар, упавший до минимального остатка. Это единственная цифра на экране,
  // которая требует действия сегодня, — поэтому она рядом с выручкой, а не в
  // отчётах, куда заходят раз в неделю.
  const low = useMemo(
    () => products
      .filter(p => !p.isArchived && p.minStock !== undefined && p.minStock !== null && (p.stock ?? 0) <= p.minStock)
      .sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0))
      .slice(0, 5),
    [products]
  );

  const card = 'bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4';
  const sectionTitle = 'font-bold text-slate-800 dark:text-white mb-2 flex items-center gap-2';

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      {/* Сколько сейчас в кассе и что можно с этим сделать — то же, что на
          вкладке «Рассрочка»: продавцу незачем уходить на другой экран, чтобы
          записать приход или посмотреть операции магазина. */}
      {onSelectAccount && (
        <AccountHead
          accounts={accounts}
          accountBalances={accountBalances}
          selectedAccountId={selectedAccountId}
          onSelectAccount={onSelectAccount}
          hideBalance={hideBalance}
          onToggleHideBalance={onToggleHideBalance || (() => {})}
          canMoveMoney={canMoveMoney}
          onAction={onAction}
          showCents={showCents}
        />
      )}

      {/* Долг встаёт рядом с выручкой, а не под ней: это две стороны одного
          вопроса «сколько заработали и сколько из этого ещё не получили».
          Карточка появляется только при долге — постоянный ноль ничего не
          сообщает, а возникшая строка заметна. */}
      <div className={`grid gap-3 ${debtors.total > 0 ? 'sm:grid-cols-[1.4fr_1fr]' : ''}`}>
        <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-6 text-center">
          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Выручка сегодня</p>
          <p className="text-4xl font-extrabold text-slate-900 dark:text-white leading-none mt-1">
            {formatCurrency(today.revenue, showCents)} <span className="text-2xl text-slate-400">₽</span>
          </p>
          <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-1">
            прибыль {formatCurrency(today.profit, showCents)} ₽
          </p>
        </div>

        {debtors.total > 0 && (
          <button onClick={() => setDebtOpen(true)}
                  className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-3xl border border-amber-200 dark:border-amber-900/50 shadow-sm p-6 text-center active:scale-[0.99] transition-transform">
            <p className="text-[11px] font-bold text-amber-500 dark:text-amber-400/80 uppercase tracking-wider">Нам должны</p>
            <p className="text-3xl font-extrabold text-amber-600 dark:text-amber-400 leading-none mt-1">
              {formatCurrency(debtors.total, showCents)} <span className="text-xl opacity-60">₽</span>
            </p>
            <p className="text-xs font-bold text-slate-400 mt-1">
              {debtors.rows.length} {plural(debtors.rows.length, 'клиент', 'клиента', 'клиентов')} · подробнее
            </p>
          </button>
        )}
      </div>

      <Sheet open={debtOpen} onClose={() => setDebtOpen(false)} className="sm:max-w-sm max-h-[75vh] flex flex-col">
        <div className="px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-700 shrink-0">
          <h3 className="font-bold text-slate-800 dark:text-white">Нам должны</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            По продажам в долг · {formatCurrency(debtors.total, showCents)} ₽
          </p>
        </div>
        <div className="overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
          {debtors.rows.map(r => (
            <button key={r.customerId}
                    onClick={() => {
                      if (r.customerId !== 'unknown' && onSelectCustomer) {
                        setDebtOpen(false);
                        onSelectCustomer(r.customerId);
                      }
                    }}
                    className="w-full px-5 py-3 text-left active:bg-slate-50 dark:active:bg-slate-700/50">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-slate-800 dark:text-white truncate">{r.name}</p>
                <p className="font-bold text-amber-600 dark:text-amber-400 shrink-0">
                  {formatCurrency(r.amount, showCents)} ₽
                </p>
              </div>
              {/* Из чего сложился долг: без этого «12 400 ₽» невозможно
                  ни проверить, ни обсудить с самим должником. */}
              <div className="mt-1 space-y-0.5">
                {r.sales.map(sale => (
                  <p key={sale.id} className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {sale.docNumber ? `№${sale.docNumber} · ` : ''}
                    {new Date(sale.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                    {' · '}{formatCurrency(retailRemaining(sale), showCents)} ₽
                    {retailPaidAmount(sale) > 0 ? ` (внесено ${formatCurrency(retailPaidAmount(sale), showCents)} ₽)` : ''}
                  </p>
                ))}
              </div>
            </button>
          ))}
        </div>
      </Sheet>

      {/* Мы должны — за товар, принятый на склад накладной. Договора у такой
          поставки нет, поэтому на вкладке «Рассрочка» ей не место: там долг
          считается по конкретным договорам. Стоит после выручки и перед
          действиями — сначала сколько заработали, потом сколько из этого чужое. */}
      {supplierDebt && supplierDebt.total > 0 && (
        <button
          onClick={() => setSupplierDebtOpen(true)}
          className="w-full text-left bg-white dark:bg-slate-800 p-4 rounded-2xl border border-rose-200 dark:border-rose-900/50 shadow-sm active:scale-[0.99] transition-transform flex items-center gap-4"
        >
          <div className="w-11 h-11 shrink-0 rounded-xl bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 flex items-center justify-center">
            {ICONS.Suppliers}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Мы должны</p>
            <p className="text-xl font-bold text-slate-800 dark:text-white leading-tight">
              {formatCurrency(supplierDebt.total, showCents)} ₽
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              за товар на складе · {supplierDebt.rows.length} {plural(supplierDebt.rows.length, 'партнёр', 'партнёра', 'партнёров')}
            </p>
          </div>
          <span className="text-slate-300 dark:text-slate-600 shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </span>
        </button>
      )}

      <Sheet open={supplierDebtOpen && !!supplierDebt} onClose={() => setSupplierDebtOpen(false)}
             className="sm:max-w-sm max-h-[75vh] flex flex-col">
        <div className="px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-700 shrink-0">
          <h3 className="font-bold text-slate-800 dark:text-white">Мы должны</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            За товар, принятый на склад · {formatCurrency(supplierDebt?.total || 0, showCents)} ₽
          </p>
        </div>
        <div className="overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
          {(supplierDebt?.rows || []).map(r => (
            <div key={r.supplierId} className="px-5 py-3 flex items-center justify-between gap-3">
              <p className="font-semibold text-slate-800 dark:text-white truncate">{r.name}</p>
              <p className="font-bold text-rose-500 shrink-0">
                {formatCurrency(r.amount, showCents)} ₽
              </p>
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-slate-100 dark:border-slate-700 shrink-0">
          <button onClick={() => { setSupplierDebtOpen(false); onAction('SUPPLIERS'); }}
                  className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm">
            Открыть партнёров
          </button>
        </div>
      </Sheet>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => onAction('RETAIL_SALE')}
          className="flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white py-4 rounded-2xl font-bold shadow-sm active:scale-95 transition-transform"
        >
          <span className="text-lg">+</span> Продажа
        </button>
        <button
          onClick={() => onAction('WAREHOUSE')}
          className="flex items-center justify-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 py-4 rounded-2xl font-bold active:scale-95 transition-transform"
        >
          <span className="opacity-70">{ICONS.Archive}</span> Склад
        </button>
      </div>

      {/* Три цифры дня: сколько продали, на сколько в среднем и сколько товара
          в работе. Под каждой — пояснение вместо голого числа. */}
      {/* На телефоне в три колонки подписи ломались на три строки, а подсказки
          обрезались на полуслове — здесь две, третья карточка во всю ширину. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: 'Продаж сегодня', value: String(today.count), hint: today.count ? `в среднем ${formatCurrency(avgSale, false)} ₽` : 'пока ни одной' },
          { label: 'Прибыль сегодня', value: `${formatCurrency(today.profit, showCents)} ₽`,
            hint: today.revenue > 0 ? `${Math.round(today.profit / today.revenue * 100)}% от выручки` : 'нет продаж',
            tone: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Товаров в каталоге', value: String(products.filter(p => !p.isArchived).length),
            hint: low.length ? `${low.length} заканчива${low.length === 1 ? 'ется' : 'ются'}` : 'остатки в норме' },
        ].map((s, i) => (
          <div key={s.label} className={`${card} ${i === 2 ? 'col-span-2 sm:col-span-1' : ''}`}>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1 leading-tight">{s.label}</p>
            <p className={`text-lg font-bold truncate ${s.tone || 'text-slate-800 dark:text-white'}`}>{s.value}</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate mt-0.5">{s.hint}</p>
          </div>
        ))}
      </div>

      <div className={card}>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">С начала месяца</p>
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-2xl font-bold text-slate-800 dark:text-white">
              {formatCurrency(month.revenue, showCents)} ₽
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {month.count} {plural(month.count, 'продажа', 'продажи', 'продаж')}
            </p>
          </div>
          <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
            +{formatCurrency(month.profit, showCents)} ₽
          </p>
        </div>
      </div>

      {low.length > 0 && (
        <div>
          <h3 className={sectionTitle}>
            <span className="w-1 h-5 bg-amber-500 rounded-full" />
            Заканчивается
          </h3>
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
            {low.map(p => (
              <button key={p.id} onClick={() => onAction('WAREHOUSE')}
                      className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left active:bg-slate-50 dark:active:bg-slate-700/50">
                <p className="font-semibold text-slate-800 dark:text-white truncate">{p.name}</p>
                <p className="text-sm font-bold text-amber-600 dark:text-amber-400 shrink-0">
                  {p.stock ?? 0} {p.unit || 'шт'}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className={sectionTitle}>
          <span className="w-1 h-5 bg-emerald-500 rounded-full" />
          Последние продажи
        </h3>
        {recent.length === 0 ? (
          <p className={`${card} text-sm text-slate-500 dark:text-slate-400 text-center`}>
            Продаж пока не было. Первая — по кнопке «Продажа».
          </p>
        ) : (
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
            {recent.map(s => {
              const left = retailRemaining(s);
              return (
                <div key={s.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 dark:text-white truncate">
                      {s.items.map(i => i.name).join(', ') || 'Продажа'}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {s.docNumber ? `№${s.docNumber} · ` : ''}
                      {new Date(s.date).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-bold text-slate-800 dark:text-white">
                      {formatCurrency(s.total, showCents)} ₽
                    </p>
                    {/* Долг по продаже виден сразу: иначе «5 000 ₽» в ленте
                        выглядят полученными деньгами, которых в кассе нет. */}
                    {left > 0 && (
                      <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
                        долг {formatCurrency(left, showCents)} ₽
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <button onClick={() => onAction('OPERATIONS')}
                className="w-full mt-2 py-2.5 rounded-xl text-sm font-bold text-slate-500 dark:text-slate-400 active:bg-slate-100 dark:active:bg-slate-700/50">
          Все операции
        </button>
      </div>
    </div>
  );
};

export default DashboardCash;
