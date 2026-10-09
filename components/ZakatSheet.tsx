import React, { useEffect, useMemo, useState } from 'react';
import type { Account, Expense, Investor, Sale, ZakatSettings } from '../types';
import type { TurnoverBreakdown } from '../src/turnoverBreakdown';
import { computeZakat, investorFirstDeposit, isZakatExpense, NISAB_GRAMS, YEAR_DAYS, zakatSettingsWithDefaults, zakatYear } from '../src/zakat';
import { formatCurrency } from '../src/utils';
import { api } from '../services/api';
import GlassSheet, { SheetSection, SheetToggle, SheetSegmented, SheetField, sheetInputClass } from './GlassSheet';

/**
 * Закят с денег в обороте: сколько платить вам, сколько — каждому инвестору,
 * сколько уже выплачено за год. Открывается из окна «В обороте». Как считается —
 * src/zakat.ts; спорные места (наценка, просроченные долги, оценка товара) —
 * переключатели, их выбор сохраняется в настройках (AppSettings.zakat).
 */

type MetalPrices = { gold: number; silver: number; date: string; source: string };

const fmtDate = (t: number | string) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtHijri = (t: number) => {
  try {
    return new Intl.DateTimeFormat('ru-RU-u-ca-islamic', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(t));
  } catch {
    return '';
  }
};

const ZakatSheet: React.FC<{
  breakdown: TurnoverBreakdown;
  accountName?: string;
  accountIds: string[];
  accounts: Account[];
  expenses: Expense[];
  /** Для даты первого взноса инвесторов — от неё идёт их год закята */
  investors: Investor[];
  sales: Sale[];
  /** Стоимость товара на складе; 0 — товар не учитывается (выбран один счёт) */
  inventory: { buy: number; sell: number };
  supplierDebt: number;
  settings?: ZakatSettings;
  onSaveSettings?: (z: ZakatSettings) => void;
  /** Записать выплату закята: свою (без investorId) или за инвестора */
  onRecordPayment?: (draft: { amount: number; investorId?: string }) => void;
  showCents?: boolean;
  onClose: () => void;
}> = ({ breakdown, accountName, accountIds, accounts, expenses, investors, sales, inventory, supplierDebt, settings, onSaveSettings, onRecordPayment, showCents, onClose }) => {
  const m = (n: number) => `${formatCurrency(n, showCents)} ₽`;
  const [raw, setRaw] = useState<ZakatSettings>(settings || {});
  const st = zakatSettingsWithDefaults(raw);
  const update = (patch: Partial<ZakatSettings>) => {
    const next = { ...raw, ...patch };
    setRaw(next);
    onSaveSettings?.(next);
  };

  // Цена металла нисаба — учётная цена ЦБ; без связи — введённая вручную
  const [prices, setPrices] = useState<MetalPrices | null>(null);
  const [pricesFailed, setPricesFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    api.getMetalPrices()
      .then(p => { if (alive && p && p.gold > 0) setPrices(p); else if (alive) setPricesFailed(true); })
      .catch(() => { if (alive) setPricesFailed(true); });
    return () => { alive = false; };
  }, []);
  // Нисаб по металлу — цена ЦБ на сегодня (без связи — введённая вручную), или своя сумма
  const metal = st.nisabMetal === 'CUSTOM' ? null : st.nisabMetal;
  const cbrPrice = prices && metal ? (metal === 'GOLD' ? prices.gold : prices.silver) : null;
  const metalPrice = cbrPrice ?? (st.manualMetalPrice && st.manualMetalPrice > 0 ? st.manualMetalPrice : null);
  const nisab = st.nisabMetal === 'CUSTOM'
    ? (st.customNisab && st.customNisab > 0 ? st.customNisab : null)
    : metalPrice != null && metal ? NISAB_GRAMS[metal] * metalPrice : null;
  // Для сравнения — нисаб по другим металлам
  const compare = prices
    ? ([['SILVER', 'По серебру', prices.silver], ['GOLD', 'По золоту', prices.gold]] as const)
        .filter(([id]) => id !== st.nisabMetal)
        .map(([id, label, price]) => `${label} — ${m(NISAB_GRAMS[id] * price)}`)
        .join(' · ')
    : '';

  const firstDeposits = useMemo(() => Object.fromEntries(
    breakdown.perInvestor.map(x => {
      const inv = investors.find(i => i.id === x.id);
      return [x.id, inv ? investorFirstDeposit(inv, accounts, sales) : null];
    })
  ), [breakdown, investors, accounts, sales]);

  const result = useMemo(() => computeZakat({
    breakdown, settings: st, nisab, investorFirstDeposit: firstDeposits,
    inventory: st.inventoryPrice === 'SELL' ? inventory.sell : inventory.buy,
    supplierDebt,
  }), [breakdown, raw, nisab, inventory, supplierDebt, firstDeposits]); // eslint-disable-line react-hooks/exhaustive-deps

  // Выплаты закята за текущий год закята по выбранным счетам
  const year = zakatYear(st.hawlStart, st.year);
  const ids = new Set(accountIds);
  const payments = expenses
    .filter(e => ids.has(e.accountId) && isZakatExpense(e))
    .filter(e => new Date(e.date).getTime() >= year.start)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  // Выплата с указанным инвестором — его закят (заплачен из его прибыли), остальное — ваш
  const investorIdSet = new Set(result.investors.map(x => x.id));
  const paidBy = (id: string | null) => payments
    .filter(e => (id ? e.investorId === id : !(e.investorId && investorIdSet.has(e.investorId))))
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const paid = paidBy(null);
  const ownerZakat = result.owner.zakat;
  const left = Math.max(0, ownerZakat - paid);
  // В итог — только те, у кого год закята уже прошёл
  const investorsZakat = result.investors.reduce((s, x) => s + (x.firstYear && !x.firstYear.passed ? 0 : x.zakat), 0);
  const shortDate = (t: number) => new Date(t).toLocaleDateString('ru-RU');
  const daysLeft = (t: number) => Math.max(1, Math.ceil((t - Date.now()) / 86400000));
  const ratePct = `${(result.rate * 100).toLocaleString('ru-RU', { maximumFractionDigits: 3 })}%`;

  const Row: React.FC<{ label: React.ReactNode; hint?: React.ReactNode; value: React.ReactNode; tone?: string; strong?: boolean }> = ({ label, hint, value, tone, strong }) => (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className={`text-[15px] ${strong ? 'font-bold' : 'font-medium'} text-slate-800 dark:text-white`}>{label}</p>
        {hint && <p className="text-[12px] leading-snug text-slate-500 dark:text-slate-400">{hint}</p>}
      </div>
      <p className={`shrink-0 tabular-nums text-[15px] font-bold ${tone || 'text-slate-900 dark:text-white'}`}>{value}</p>
    </div>
  );
  const signed = (n: number) => (n < 0 ? `−${m(-n)}` : m(n));

  return (
    <GlassSheet title="Закят" subtitle={accountName || 'Все счета'} onClose={onClose} cancelLabel="Закрыть" zIndex={210}>
      <div className="space-y-6">
        {/* Итог: ваш закят */}
        <div className="text-center">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Ваш закят</p>
          <p className="mt-1 text-[34px] font-extrabold tabular-nums text-slate-900 dark:text-white leading-none">{m(ownerZakat)}</p>
          <p className="mt-1.5 text-[13px] text-slate-500 dark:text-slate-400">
            {result.owner.reachesNisab
              ? `${ratePct} с ${m(result.owner.base)}`
              : result.nisab != null
                ? `Ваша доля ${m(result.owner.base)} меньше нисаба ${m(result.nisab)}`
                : 'Нет облагаемой суммы'}
          </p>
          {ownerZakat > 0 && (
            <div className="mt-4 mx-auto max-w-xs">
              <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, ownerZakat > 0 ? paid / ownerZakat * 100 : 0)}%` }} />
              </div>
              <p className="mt-1.5 text-[12px] text-slate-500 dark:text-slate-400">
                Выплачено {m(paid)} · {left > 0 ? `осталось ${m(left)}` : 'выплачен полностью'}
              </p>
            </div>
          )}
          {onRecordPayment && ownerZakat > 0 && (left > 0 ? (
            <button type="button" onClick={() => onRecordPayment({ amount: left })}
                    className="btn-press mt-4 h-11 px-6 rounded-full bg-emerald-600 text-white text-[15px] font-semibold active:bg-emerald-700">
              Записать выплату
            </button>
          ) : (
            <p className="mt-3 text-[14px] font-semibold text-emerald-600 dark:text-emerald-400">✓ Закят выплачен</p>
          ))}
          {year.due && (
            <p className="mt-2 text-[12px] text-slate-500 dark:text-slate-400">
              Срок: {fmtDate(year.due)}{fmtHijri(year.due) ? ` · ${fmtHijri(year.due)}` : ''}
            </p>
          )}
        </div>

        <SheetSection title="С чего считается">
          {result.owner.parts.map(p => (
            <Row key={p.label} label={p.label} value={signed(p.amount)}
                 tone={p.amount < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-700 dark:text-slate-200'} />
          ))}
          <Row label="Облагается" value={m(result.owner.base)} strong />
        </SheetSection>

        <SheetSection title="Нисаб"
                      hint="Имущество вне приложения тоже входит в нисаб.">
          <div className="px-4 pt-3 pb-1">
            <SheetSegmented value={st.nisabMetal} onChange={v => update({ nisabMetal: v })}
                            options={[{ id: 'SILVER', label: 'Серебро' }, { id: 'GOLD', label: 'Золото' }, { id: 'CUSTOM', label: 'Своя сумма' }]} />
            <p className="mt-1.5 text-[12px] leading-snug text-slate-500 dark:text-slate-400">
              {st.nisabMetal === 'SILVER' ? '595 г — как у Муфтията ЧР'
                : st.nisabMetal === 'GOLD' ? '85 г золота'
                : 'Сумма, объявленная муфтиятом'}
            </p>
          </div>
          {st.nisabMetal === 'CUSTOM' ? (
            <SheetField label="Сумма нисаба, ₽" hint={compare || undefined}>
              <input key="custom-nisab" type="number" inputMode="decimal" className={sheetInputClass} placeholder="Например, 127700"
                     defaultValue={st.customNisab || ''}
                     onBlur={e => update({ customNisab: Number(e.target.value) || undefined })} />
            </SheetField>
          ) : metalPrice != null && metal ? (
            <Row label={`${metal === 'GOLD' ? 'Золото' : 'Серебро'}, ${NISAB_GRAMS[metal]} г`}
                 hint={<>
                   {cbrPrice != null && prices
                     ? `${m(cbrPrice)} за грамм · ${prices.source} на ${new Date(prices.date).toLocaleDateString('ru-RU')}`
                     : `${m(metalPrice)} за грамм · введено вручную`}
                   {compare && <span className="block">{compare}</span>}
                 </>}
                 value={m(result.nisab || 0)} />
          ) : !pricesFailed ? (
            <Row label="Цена металла" hint="Загружаем цену ЦБ…" value="—" tone="text-slate-400" />
          ) : null}
          {pricesFailed && metal && (
            <SheetField label={`Цена грамма ${metal === 'GOLD' ? 'золота' : 'серебра'}, ₽`}
                        hint="Цена ЦБ недоступна">
              <input key={`manual-${metal}`} type="number" inputMode="decimal" className={sheetInputClass} placeholder="0"
                     defaultValue={st.manualMetalPrice || ''}
                     onBlur={e => update({ manualMetalPrice: Number(e.target.value) || undefined })} />
            </SheetField>
          )}
          <div className="px-4 py-3">
            <p className={`text-[14px] font-semibold ${result.owner.reachesNisab ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
              {result.owner.reachesNisab ? '✓ Ваша доля больше нисаба — закят обязателен' : 'Ваша доля меньше нисаба'}
            </p>
          </div>
        </SheetSection>

        {result.investors.length > 0 && (
          <SheetSection title="Закят инвесторов"
                        hint="Списывается с прибыли инвестора.">
            {result.investors.map(x => {
              const invPaid = paidBy(x.id);
              const fy = x.firstYear;
              // Первый год с первого взноса ещё не прошёл — закят не обязателен
              if (fy && !fy.passed) {
                return (
                  <Row key={x.id} label={x.name}
                       hint={`Год не прошёл · срок не раньше ${shortDate(fy.firstDue)}`}
                       value={`через ${daysLeft(fy.firstDue)} дн.`} tone="text-slate-400 dark:text-slate-500" />
                );
              }
              const invLeft = Math.max(0, x.zakat - invPaid);
              return (
                <div key={x.id}>
                  <Row label={x.name}
                       hint={x.zakat > 0 && invLeft <= 0
                         ? '✓ Выплачен'
                         : `${x.reachesNisab ? `${ratePct} с ${m(x.base)}` : `${m(x.base)} — меньше нисаба`}${invPaid > 0 ? ` · выплачено ${m(invPaid)}` : ''}`}
                       value={m(x.zakat)} tone="text-violet-600 dark:text-violet-400" />
                  {onRecordPayment && invLeft > 0 && (
                    <div className="px-4 pb-3 -mt-1">
                      <button type="button" onClick={() => onRecordPayment({ amount: invLeft, investorId: x.id })}
                              className="btn-press w-full h-10 rounded-xl bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 text-[14px] font-semibold active:bg-violet-100">
                        Записать за инвестора · {m(invLeft)}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </SheetSection>
        )}

        <SheetSection title={`Выплачено за год закята`}
                      hint={`С ${shortDate(year.start)}`}>
          {payments.length === 0 ? (
            <Row label="Выплат пока нет" value="" />
          ) : payments.map(e => (
            <Row key={e.id} label={e.title || 'Закят'}
                 hint={`${fmtDate(e.date)} · ${e.investorId && investorIdSet.has(e.investorId)
                   ? `за инвестора ${result.investors.find(x => x.id === e.investorId)?.name}`
                   : accounts.find(a => a.id === e.accountId)?.name || ''}`}
                 value={m(Number(e.amount) || 0)} tone="text-slate-700 dark:text-slate-200" />
          ))}
        </SheetSection>

        <SheetSection title="Облагаемое имущество">
          <Row label="Деньги на счетах" value={m(result.assets.cash)} />
          <Row label="Долг клиентов" value={m(result.assets.receivable)} />
          {result.assets.excludedMarkup > 0 && <Row label="Без будущей наценки" value={`−${m(result.assets.excludedMarkup)}`} tone="text-slate-500" />}
          {result.assets.excludedDoubtful > 0 && <Row label="Без сомнительных долгов" value={`−${m(result.assets.excludedDoubtful)}`} tone="text-slate-500" />}
          {result.assets.inventory > 0 && <Row label="Товар на складе" value={m(result.assets.inventory)} />}
          {result.assets.supplierDebt > 0 && <Row label="Долги поставщикам" value={`−${m(result.assets.supplierDebt)}`} tone="text-slate-500" />}
          <Row label="Облагается" value={m(result.assets.total)} strong />
          <Row label="Закят всего" hint="Ваш и инвесторов" value={m(ownerZakat + investorsZakat)} strong />
        </SheetSection>

        <SheetSection title="Как считать">
          <div className="px-4 py-3 space-y-3">
            <div>
              <p className="mb-1.5 text-[13px] text-slate-500 dark:text-slate-400">Год закята</p>
              <SheetSegmented value={st.year} onChange={v => update({ year: v })}
                              options={[{ id: 'LUNAR', label: 'Лунный · 2,5%' }, { id: 'SOLAR', label: 'Солнечный · 2,577%' }]} />
            </div>
            {inventory.buy > 0 && (
              <div>
                <p className="mb-1.5 text-[13px] text-slate-500 dark:text-slate-400">Товар на складе</p>
                <SheetSegmented value={st.inventoryPrice} onChange={v => update({ inventoryPrice: v })}
                                options={[{ id: 'BUY', label: 'По закупу' }, { id: 'SELL', label: 'По продаже' }]} />
              </div>
            )}
          </div>
          <SheetToggle label="Без будущей наценки" checked={st.excludeFutureMarkup}
                       onChange={v => update({ excludeFutureMarkup: v })}
                       description="Долг клиентов без незаработанной наценки" />
          <SheetToggle label="Без сомнительных долгов" checked={st.excludeDoubtful}
                       onChange={v => update({ excludeDoubtful: v })}
                       description={breakdown.doubtful.contracts > 0
                         ? `Просрочка больше 90 дней: ${breakdown.doubtful.contracts} шт., ${m(breakdown.doubtful.receivable)}`
                         : 'Просрочки больше 90 дней нет'} />
          {supplierDebt > 0 && (
            <SheetToggle label="Вычитать долги поставщикам" checked={st.deductSupplierDebt}
                         onChange={v => update({ deductSupplierDebt: v })}
                         description={`Вы должны ${m(supplierDebt)}`} />
          )}
          <SheetField label="Дата закята"
                      hint={`Срок — через ${YEAR_DAYS[st.year]} дней`}>
            <input type="date" className={sheetInputClass} value={st.hawlStart ? st.hawlStart.slice(0, 10) : ''}
                   onChange={e => update({ hawlStart: e.target.value || undefined })} />
          </SheetField>
        </SheetSection>

        <p className="px-4 text-[12px] leading-snug text-slate-500 dark:text-slate-400">
          Расчёт — помощь, не фетва.
        </p>
      </div>
    </GlassSheet>
  );
};

export default ZakatSheet;
