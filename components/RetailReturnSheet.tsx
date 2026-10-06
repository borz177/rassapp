import React, { useMemo, useState } from 'react';
import type { Account, RetailSale } from '../types';
import GlassSheet, { SheetField, SheetSection, sheetInputClass } from './GlassSheet';
import { buildRetailReturn, formatCurrency, retailReturnedQty } from '../src/utils';

/**
 * Возврат по чеку: какие товары и сколько вернули, с какого счёта отдать деньги.
 *
 * Сумму считает та же buildRetailReturn, что проводит документ, — человек видит
 * ровно ту цифру, что уйдёт со счёта, а не приблизительную.
 */
const REASONS = ['Брак', 'Не подошёл', 'Передумал'];

const RetailReturnSheet: React.FC<{
  sale: RetailSale;
  allSales: RetailSale[];
  accounts: Account[];
  showCents?: boolean;
  onClose: () => void;
  onSubmit: (
    lines: { productId: string; quantity: number }[],
    meta: { accountId: string; date: string; note?: string },
  ) => Promise<boolean>;
}> = ({ sale, allSales, accounts, showCents, onClose, onSubmit }) => {
  const returned = useMemo(() => retailReturnedQty(sale.id, allSales), [sale.id, allSales]);
  const rows = sale.items
    .map(i => ({ ...i, left: Math.max(0, i.quantity - (returned[i.productId] || 0)) }))
    .filter(i => i.left > 0);

  // Чаще всего возвращают одну позицию из чека — поэтому по умолчанию одна
  // строка уже выбрана, если она в чеке единственная, а иначе ничего.
  const [qty, setQty] = useState<Record<string, number>>(
    () => (rows.length === 1 ? { [rows[0].productId]: rows[0].left } : {}));
  const liveAccounts = accounts.filter(a => !a.isArchived);
  const [accountId, setAccountId] = useState(
    liveAccounts.some(a => a.id === sale.accountId) ? sale.accountId : liveAccounts[0]?.id || sale.accountId);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const lines = rows.filter(r => (qty[r.productId] || 0) > 0)
    .map(r => ({ productId: r.productId, quantity: qty[r.productId] }));
  const preview = useMemo(() => buildRetailReturn(sale, lines, allSales, {
    id: 'preview', accountId, date, userId: sale.userId,
  }), [sale, allSales, accountId, date, JSON.stringify(lines)]);
  const amount = Math.abs(preview.record.total);
  const refund = preview.record.refund || 0;
  const allPicked = rows.length > 0 && rows.every(r => (qty[r.productId] || 0) >= r.left);

  const step = (id: string, delta: number, max: number) =>
    setQty(q => ({ ...q, [id]: Math.min(max, Math.max(0, Math.round(((q[id] || 0) + delta) * 1000) / 1000)) }));

  const submit = async (close: () => void) => {
    if (lines.length === 0 || saving) return;
    setSaving(true);
    // Время — текущее: возвраты одного дня должны стоять в журнале по порядку
    const now = new Date();
    const [y, m, d] = date.split('-').map(Number);
    const at = new Date(y, (m || 1) - 1, d || 1, now.getHours(), now.getMinutes(), now.getSeconds()).toISOString();
    const ok = await onSubmit(lines, { accountId, date: at, note: reason.trim() || undefined });
    setSaving(false);
    if (ok) close();
  };

  const money = (n: number) => `${formatCurrency(n, showCents)} ₽`;

  return (
    <GlassSheet
      title="Возврат"
      subtitle={`по чеку №${sale.docNumber || sale.id.slice(0, 6)}`}
      onClose={onClose}
      cancelLabel="Отмена"
      action={{ label: saving ? 'Проводим…' : 'Оформить', onClick: submit, disabled: lines.length === 0 || saving }}
    >
      {close => (
        <div className="space-y-6">
          {rows.length === 0 ? (
            <p className="px-4 text-sm text-slate-500 dark:text-slate-400">Весь товар по этому чеку уже возвращён.</p>
          ) : (
            <SheetSection
              title={
                <span className="flex items-center justify-between">
                  <span>Что возвращают</span>
                  <button type="button"
                          onClick={() => setQty(allPicked ? {} : Object.fromEntries(rows.map(r => [r.productId, r.left])))}
                          className="normal-case tracking-normal text-[13px] font-semibold text-indigo-600 dark:text-indigo-300">
                    {allPicked ? 'Снять всё' : 'Вернуть всё'}
                  </button>
                </span>
              }
              hint={Object.keys(returned).length > 0 ? 'Уже возвращённое по этому чеку здесь не показано.' : undefined}
            >
              {rows.map(r => {
                const q = qty[r.productId] || 0;
                return (
                  <div key={r.productId} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className={`text-[15px] font-semibold truncate ${q > 0 ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>{r.name}</p>
                      <p className="text-[12px] text-slate-500 dark:text-slate-400">
                        {money(r.price)} · куплено {r.quantity}{returned[r.productId] ? `, вернули ${returned[r.productId]}` : ''}
                      </p>
                    </div>
                    <div className={`shrink-0 flex items-center h-9 rounded-full border transition-colors ${q > 0
                      ? 'border-rose-300 dark:border-rose-500/50 bg-rose-50 dark:bg-rose-500/10'
                      : 'border-slate-200 dark:border-slate-700'}`}>
                      <button type="button" onClick={() => step(r.productId, -1, r.left)} aria-label="Меньше" disabled={q <= 0}
                              className="w-9 h-9 rounded-full text-lg font-bold text-slate-500 dark:text-slate-300 disabled:opacity-30">−</button>
                      <span className="min-w-[44px] text-center text-sm font-bold tabular-nums text-slate-800 dark:text-white">
                        {q}<span className="text-slate-400 font-medium">/{r.left}</span>
                      </span>
                      <button type="button" onClick={() => step(r.productId, 1, r.left)} aria-label="Больше" disabled={q >= r.left}
                              className="w-9 h-9 rounded-full text-lg font-bold text-rose-600 dark:text-rose-300 disabled:opacity-30">+</button>
                    </div>
                  </div>
                );
              })}
            </SheetSection>
          )}

          <SheetSection title="Причина">
            <div className="px-4 py-3 space-y-2.5">
              <div className="flex flex-wrap gap-2">
                {REASONS.map(r => (
                  <button key={r} type="button" onClick={() => setReason(reason === r ? '' : r)}
                          className={`h-8 px-3 rounded-full text-[13px] font-semibold transition-colors ${reason === r
                            ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                            : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>{r}</button>
                ))}
              </div>
              <input value={REASONS.includes(reason) ? '' : reason} onChange={e => setReason(e.target.value)}
                     placeholder="Или напишите свою" className={sheetInputClass} />
            </div>
          </SheetSection>

          <SheetSection title="Деньги">
            <SheetField label={refund > 0 ? 'Отдать со счёта' : 'Счёт'}>
              <select value={accountId} onChange={e => setAccountId(e.target.value)} className={sheetInputClass}>
                {liveAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </SheetField>
            <SheetField label="Дата возврата">
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={sheetInputClass} />
            </SheetField>
          </SheetSection>

          {/* Итог: сколько отдать на руки и сколько спишется долга */}
          <div className="rounded-2xl bg-rose-50 dark:bg-rose-500/10 ring-1 ring-rose-200/70 dark:ring-rose-500/20 p-4">
            <div className="flex items-end justify-between gap-3">
              <span className="text-sm font-semibold text-rose-700 dark:text-rose-300">Вернуть покупателю</span>
              <span className="text-[26px] leading-none font-extrabold tabular-nums text-rose-700 dark:text-rose-200">{money(refund)}</span>
            </div>
            {preview.debt > 0 && (
              <p className="mt-2 text-[13px] text-rose-700/80 dark:text-rose-300/80">
                Ещё {money(preview.debt)} спишется с долга покупателя по этому чеку.
              </p>
            )}
            {sale.discount > 0 && amount > 0 && (
              <p className="mt-2 text-[12px] text-rose-700/70 dark:text-rose-300/70">Скидка чека учтена пропорционально.</p>
            )}
            <button type="button" onClick={() => submit(close)} disabled={lines.length === 0 || saving}
                    className="mt-4 w-full h-12 rounded-2xl bg-rose-600 text-white font-bold disabled:opacity-40 active:scale-[0.99] transition">
              {saving ? 'Проводим…' : lines.length === 0 ? 'Выберите товар' : 'Оформить возврат'}
            </button>
          </div>
        </div>
      )}
    </GlassSheet>
  );
};

export default RetailReturnSheet;
