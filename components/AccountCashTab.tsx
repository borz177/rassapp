import React, { useState } from 'react';
import type { AccountCashSummary } from '../src/accountCash';
import { formatCurrency } from '../src/utils';

interface PeriodOption<K extends string> {
  key: K;
  label: string;
}

interface AccountCashTabProps<K extends string> {
  summary: AccountCashSummary;
  showCents?: boolean;
  /** Период — тот же, что у вкладки «Рассрочка»: переключение вкладок его не сбрасывает */
  periodOptions: PeriodOption<K>[];
  periodMode: K;
  onPeriodMode: (mode: K) => void;
  /** Режим, в котором даты вводят руками */
  customKey: K;
  /** Режим «всё время» — для подписи периода */
  allKey: K;
  period: { start: string; end: string };
  onPeriodChange: (period: { start: string; end: string }) => void;
  onOpenDoc?: (docId: string) => void;
  onSelectCustomer?: (customerId: string) => void;
}

const card = 'bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 sm:p-5';
const caption = 'text-[10px] sm:text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide';
const dateInput = 'w-full p-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-700 dark:text-slate-300 font-medium';

/** Сколько строк долгов показывать до «Показать всех» */
const DEBT_ROWS = 5;

/**
 * Вкладка «Наличные» на странице счёта, к которому привязан склад.
 *
 * Порядок блоков — порядок вопросов, с которыми сюда заходят: сколько наторговали,
 * куда делись деньги, кто кому должен, сколько денег лежит в товаре. Расчёт целиком
 * в src/accountCash.ts — здесь только вёрстка.
 */
function AccountCashTab<K extends string>({
  summary, showCents = false, periodOptions, periodMode, onPeriodMode, customKey, allKey,
  period, onPeriodChange, onOpenDoc, onSelectCustomer,
}: AccountCashTabProps<K>) {
  const [allCustomers, setAllCustomers] = useState(false);
  const [allSuppliers, setAllSuppliers] = useState(false);
  const money = (n: number) => `${formatCurrency(n, showCents)} ₽`;
  const { sales, money: flow, customerDebt, supplierDebt, stock, recent } = summary;

  const periodCaption = (() => {
    if (periodMode === allKey) return 'За всё время';
    const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('ru-RU');
    if (!period.start) return `по ${fmt(period.end)}`;
    if (!period.end) return `с ${fmt(period.start)}`;
    return period.start === period.end ? fmt(period.start) : `${fmt(period.start)} — ${fmt(period.end)}`;
  })();

  return (
    <div className="space-y-4">
      {/* Период. Относится к продажам и деньгам; долги и товар — на сегодня. */}
      <div className={`${card} space-y-3`}>
        <div className="flex flex-wrap gap-2">
          {periodOptions.map(({ key, label }) => (
            <button key={key} type="button" onClick={() => onPeriodMode(key)}
                    className={`flex-1 min-w-[64px] py-2 rounded-xl text-xs font-bold transition-colors ${
                      periodMode === key
                        ? 'glass-surface text-indigo-600 dark:text-indigo-300'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}>
              {label}
            </button>
          ))}
        </div>
        {periodMode === customKey && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={`${caption} mb-1 block`}>Начало</span>
              <input type="date" className={dateInput} value={period.start}
                     onChange={e => onPeriodChange({ ...period, start: e.target.value })} />
            </label>
            <label className="block">
              <span className={`${caption} mb-1 block`}>Конец</span>
              <input type="date" className={dateInput} value={period.end}
                     onChange={e => onPeriodChange({ ...period, end: e.target.value })} />
            </label>
          </div>
        )}
        <p className="text-[11px] text-center text-slate-400 dark:text-slate-500">{periodCaption}</p>
      </div>

      {/* ── Продажи ── */}
      <section className={card} aria-label="Продажи">
        <p className={caption}>Выручка</p>
        <p className="text-3xl font-extrabold text-slate-900 dark:text-white leading-tight" data-testid="cash-revenue">
          {money(sales.revenue)}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
          <Stat label="Оплачено" value={money(sales.paid)} tone="emerald" testId="cash-paid" />
          <Stat label="В долг" value={money(sales.credit)} tone={sales.credit > 0 ? 'amber' : undefined} testId="cash-credit" />
          <Stat label="Прибыль" value={money(sales.profit)} tone="emerald" testId="cash-profit" />
          <Stat label="Чеков" value={String(sales.checks)} testId="cash-checks" />
          <Stat label="Средний чек" value={money(sales.avgCheck)} testId="cash-avg" />
        </div>
        {sales.byWarehouse.length > 0 && (
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700 space-y-1.5">
            {sales.byWarehouse.map(w => (
              <div key={w.warehouseId} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-600 dark:text-slate-300 truncate">{w.name}</span>
                <span className="shrink-0 font-semibold text-slate-700 dark:text-slate-200">
                  {money(w.revenue)} <span className="text-xs text-slate-400">· {w.checks} чек.</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Деньги магазина по счёту ── */}
      <section className={card} aria-label="Деньги магазина">
        <p className="font-bold text-slate-800 dark:text-white mb-3">Деньги магазина по счёту</p>
        <div className="space-y-2 text-sm">
          <FlowRow label="Оплата чеков" value={flow.salesIn} sign="+" money={money} testId="cash-sales-in" />
          <FlowRow label="Погашение долгов" value={flow.debtIn} sign="+" money={money} testId="cash-debt-in" />
          <FlowRow label="Оплаты поставщикам" value={flow.supplierOut} sign="−" money={money} testId="cash-supplier-out" />
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-700">
            <span className="font-bold text-slate-700 dark:text-slate-200">Итог</span>
            <span data-testid="cash-net"
                  className={`font-extrabold ${flow.net < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {flow.net < 0 ? '−' : flow.net > 0 ? '+' : ''}{money(Math.abs(flow.net))}
            </span>
          </div>
        </div>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-3">
          Деньги считаются на том счёте, куда их положили. Рассрочка и прочие расходы — во вкладке «Рассрочка» и в операциях.
        </p>
      </section>

      {/* ── Долги: на сегодня ── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <section className={card} aria-label="Нам должны">
          <p className={caption}>Нам должны · сейчас</p>
          <p className="text-2xl font-extrabold text-amber-600 dark:text-amber-400" data-testid="cash-customer-debt">
            {money(customerDebt.total)}
          </p>
          {customerDebt.rows.length === 0 ? (
            <p className="text-sm text-slate-400 mt-2">Долгов по чекам нет</p>
          ) : (
            <div className="mt-3 space-y-1">
              {(allCustomers ? customerDebt.rows : customerDebt.rows.slice(0, DEBT_ROWS)).map(row => {
                const clickable = !!row.customerId && !!onSelectCustomer;
                const content = (
                  <>
                    <span className="min-w-0 truncate text-slate-600 dark:text-slate-300">
                      {row.name} <span className="text-xs text-slate-400">· {row.checks} чек.</span>
                    </span>
                    <span className="shrink-0 font-semibold text-slate-700 dark:text-slate-200">{money(row.amount)}</span>
                  </>
                );
                return clickable ? (
                  <button key={row.customerId} type="button" onClick={() => onSelectCustomer!(row.customerId!)}
                          className="w-full flex items-center justify-between gap-3 text-sm py-1.5 text-left rounded-lg active:bg-slate-50 dark:active:bg-slate-700">
                    {content}
                  </button>
                ) : (
                  <div key={row.customerId || 'anonymous'} className="flex items-center justify-between gap-3 text-sm py-1.5">{content}</div>
                );
              })}
              {customerDebt.rows.length > DEBT_ROWS && (
                <button type="button" onClick={() => setAllCustomers(v => !v)}
                        className="text-xs font-bold text-indigo-600 dark:text-indigo-300 pt-1">
                  {allCustomers ? 'Свернуть' : `Показать всех · ${customerDebt.rows.length}`}
                </button>
              )}
            </div>
          )}
        </section>

        <section className={card} aria-label="Мы должны">
          <p className={caption}>Мы должны · сейчас</p>
          <p className="text-2xl font-extrabold text-rose-600 dark:text-rose-400" data-testid="cash-supplier-debt">
            {money(supplierDebt.total)}
          </p>
          {supplierDebt.rows.length === 0 ? (
            <p className="text-sm text-slate-400 mt-2">Поставщикам за приходы не должны</p>
          ) : (
            <div className="mt-3 space-y-1">
              {(allSuppliers ? supplierDebt.rows : supplierDebt.rows.slice(0, DEBT_ROWS)).map(row => (
                <div key={row.supplierId} className="flex items-center justify-between gap-3 text-sm py-1.5">
                  <span className="min-w-0 truncate text-slate-600 dark:text-slate-300">{row.name}</span>
                  <span className="shrink-0 font-semibold text-slate-700 dark:text-slate-200">{money(row.amount)}</span>
                </div>
              ))}
              {supplierDebt.rows.length > DEBT_ROWS && (
                <button type="button" onClick={() => setAllSuppliers(v => !v)}
                        className="text-xs font-bold text-indigo-600 dark:text-indigo-300 pt-1">
                  {allSuppliers ? 'Свернуть' : `Показать всех · ${supplierDebt.rows.length}`}
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      {/* ── Товар на складе: на сегодня ── */}
      <section className={card} aria-label="Товар на складе">
        <p className={caption}>Товар на складе · в закупе</p>
        <p className="text-2xl font-extrabold text-slate-900 dark:text-white" data-testid="cash-stock-cost">{money(stock.cost)}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{stock.positions} поз. · {formatCurrency(stock.units, false)} ед.</p>
        {stock.byWarehouse.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 space-y-1.5">
            {stock.byWarehouse.map(w => (
              <div key={w.warehouseId} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-600 dark:text-slate-300 truncate">{w.name}</span>
                <span className="shrink-0 font-semibold text-slate-700 dark:text-slate-200">
                  {money(w.cost)} <span className="text-xs text-slate-400">· {w.positions} поз.</span>
                </span>
              </div>
            ))}
          </div>
        )}
        {stock.low.length > 0 && (
          <div className="mt-3 rounded-xl bg-amber-50 dark:bg-amber-900/15 border border-amber-100 dark:border-amber-900/40 px-3 py-2.5">
            <p className="text-xs font-bold text-amber-700 dark:text-amber-400 mb-1" data-testid="cash-low-count">
              Заканчивается · {stock.low.length}
            </p>
            {stock.low.slice(0, 5).map(item => (
              <p key={`${item.productId}_${item.warehouseName}`} className="text-xs text-amber-800 dark:text-amber-300 truncate">
                {item.name}: {formatCurrency(item.qty, false)} из мин. {formatCurrency(item.minStock, false)}
                {summary.warehouses.length > 1 ? ` · ${item.warehouseName}` : ''}
              </p>
            ))}
          </div>
        )}
      </section>

      {/* ── Последние чеки ── */}
      <section className={card} aria-label="Последние чеки">
        <p className="font-bold text-slate-800 dark:text-white mb-2">Последние чеки</p>
        {recent.length === 0 ? (
          <p className="text-sm text-slate-400">Чеков с этого склада ещё не было</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {recent.map(r => (
              <button key={r.id} type="button" disabled={!onOpenDoc} onClick={() => onOpenDoc?.(r.docId)}
                      className="w-full flex items-center justify-between gap-3 py-2.5 text-left disabled:cursor-default">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">
                    Продажа №{r.number} · {r.customerName}
                  </span>
                  <span className="block text-xs text-slate-400">
                    {new Date(r.date).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-bold text-slate-800 dark:text-white">{money(r.total)}</span>
                  {r.debt > 0 && <span className="block text-[11px] font-bold text-amber-600 dark:text-amber-400">долг {money(r.debt)}</span>}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const TONES: Record<string, string> = {
  emerald: 'text-emerald-600 dark:text-emerald-400',
  amber: 'text-amber-600 dark:text-amber-400',
};

const Stat: React.FC<{ label: string; value: string; tone?: 'emerald' | 'amber'; testId?: string }> = ({ label, value, tone, testId }) => (
  <div className="min-w-0">
    <p className={caption}>{label}</p>
    <p data-testid={testId} className={`text-base sm:text-lg font-bold truncate ${tone ? TONES[tone] : 'text-slate-800 dark:text-white'}`}>{value}</p>
  </div>
);

const FlowRow: React.FC<{ label: string; value: number; sign: '+' | '−'; money: (n: number) => string; testId?: string }> = ({ label, value, sign, money, testId }) => (
  <div className="flex items-center justify-between gap-3">
    <span className="text-slate-600 dark:text-slate-300">{label}</span>
    <span data-testid={testId} className={`font-semibold ${
      value === 0 ? 'text-slate-400' : sign === '+' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
    }`}>
      {value === 0 ? money(0) : `${sign}${money(value)}`}
    </span>
  </div>
);

export default AccountCashTab;
