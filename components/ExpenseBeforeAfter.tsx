import React from 'react';
import type { ExpensePreview, ExpensePreviewRow } from '../src/expensePreview';
import { formatCurrency } from '../src/utils';

export default function ExpenseBeforeAfter({preview,showCents}: {preview:ExpensePreview;showCents?:boolean}) {
  const money=(n:number)=>`${formatCurrency(n,showCents)} ₽`;
  const row=(r:ExpensePreviewRow)=><React.Fragment key={r.key}>
    <span className="min-w-0 text-slate-600 dark:text-slate-300">{r.label}</span>
    <span className="min-w-0 text-right tabular-nums break-words text-slate-500 dark:text-slate-400">{money(r.before)}</span>
    <span className={`min-w-0 text-right tabular-nums break-words font-semibold ${r.after<0?'text-rose-600 dark:text-rose-400':'text-slate-900 dark:text-white'}`}>{money(r.after)}</span>
  </React.Fragment>;
  return <section aria-label="Расчёт до и после" className="rounded-xl bg-slate-50 dark:bg-slate-900/50 p-3 space-y-3">
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 gap-y-2 text-xs sm:text-sm">
      <span className="font-semibold text-slate-700 dark:text-slate-200">Расчёт</span>
      <span className="text-right text-xs text-slate-400">Было</span><span className="text-right text-xs text-slate-400">Станет</span>
      {preview.rows.map(row)}
    </div>
    {preview.shares.length>1 && <details>
      <summary className="cursor-pointer text-xs font-medium text-blue-600 dark:text-blue-400">По участникам</summary>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 text-xs">{preview.shares.map(row)}</div>
    </details>}
    {!!preview.errors.length && <div role="alert" className="text-xs text-rose-600 dark:text-rose-400 space-y-1">{preview.errors.map(e=><p key={e}>{e}</p>)}</div>}
    {!!preview.warnings.length && !preview.errors.length && <div className="text-xs text-amber-700 dark:text-amber-400 space-y-1">
      {preview.warnings.map(w=><p key={w}>{w}</p>)}
      {preview.shares.filter(r=>r.after<0&&r.after<r.before).map(r=><p key={r.key}>{r.label}: {money(r.after)}</p>)}
    </div>}
  </section>;
}
