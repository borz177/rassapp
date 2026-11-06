import React, { useMemo, useState } from 'react';
import GlassSheet, { SheetSection } from './GlassSheet';
import { useBackInterceptor } from './transitions/PagePush';
import { formatCurrency, formatDate } from '../src/utils';
import type { CashProfitLedger, CashProfitRow } from '../src/cashProfitLedger';

export type CashProfitView = 'received' | 'paid' | 'available';
type Filter = 'all' | 'payout' | 'discount' | 'other';
const filters: {id:Filter;label:string}[] = [
  {id:'all',label:'Все'},{id:'payout',label:'Выплаты'},{id:'discount',label:'Скидки'},{id:'other',label:'Прочие'},
];
interface Props {
  view: CashProfitView; ledger: CashProfitLedger; subtitle: string; periodLabel?: string; showCents?: boolean;
  onClose: ()=>void; onOpenContract?: (saleId:string)=>void;
}

const CashProfitSheet: React.FC<Props> = (props) => {
  const title={received:'Получено прибыли',paid:'Выплаты прибыли',available:'К выводу'}[props.view];
  return <GlassSheet title={title} subtitle={props.subtitle} onClose={props.onClose} zIndex={240}>
    {close=><ProfitContent {...props} close={close} />}
  </GlassSheet>;
};
export default CashProfitSheet;

function ProfitContent({view,ledger,periodLabel,showCents,onOpenContract,close}:Props & {close:()=>void}) {
  useBackInterceptor(true,close);
  const [tab,setTab]=useState<'accruals'|'expenses'>('accruals');
  const [filter,setFilter]=useState<Filter>('all');
  const [expanded,setExpanded]=useState<string|null>(null);
  const [query,setQuery]=useState('');
  const [limit,setLimit]=useState(35);
  const money=(n:number)=>`${formatCurrency(n,showCents)} ₽`;
  const negative=(n:number)=>`${n>0?'−':''}${money(n)}`;
  const expenses=view==='paid'||view==='available'&&tab==='expenses';
  const choose=(next:'accruals'|'expenses',f:Filter='all')=>{setTab(next);setFilter(f);setExpanded(null);setQuery('');setLimit(35);};
  const source=expenses?ledger.expenses:ledger.accruals;
  const filtered=useMemo(()=>source.filter(r=>
    (view!=='paid'||r.kind==='payout')&&
    (view!=='available'||!expenses||filter==='all'||r.kind===filter)&&
    (!query.trim()||[r.title,r.customerName,r.productName,r.investorName,r.note].some(v=>v?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
  ),[source,view,expenses,filter,query]);
  const hero=view==='received'?ledger.received:view==='paid'?ledger.paid:ledger.available;
  const row=(label:string,amount:number,onClick:()=>void)=>
    <button type="button" onClick={onClick} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-sm text-left active:bg-slate-50 dark:active:bg-slate-700/50">
      <span className="text-slate-600 dark:text-slate-300">{label}</span>
      <span className="ml-auto tabular-nums font-medium text-slate-900 dark:text-white">{amount<0?negative(-amount):money(amount)}</span>
      <span aria-hidden className="text-slate-400">›</span>
    </button>;
  const detail=(label:string,value:React.ReactNode)=>value!=null&&value!==''&&<div className="flex justify-between gap-4 text-xs"><span className="text-slate-500 dark:text-slate-400">{label}</span><span className="text-right font-medium text-slate-800 dark:text-slate-200 break-words min-w-0">{value}</span></div>;
  const renderRow=(r:CashProfitRow)=>{
    const opened=expanded===r.id;
    return <div key={r.id} className="rounded-2xl bg-white dark:bg-slate-800 ring-1 ring-slate-200/70 dark:ring-slate-700/70 overflow-hidden">
      <button type="button" aria-expanded={opened} onClick={()=>setExpanded(opened?null:r.id)} className="w-full text-left px-4 py-3.5 flex items-start gap-3 active:bg-slate-50 dark:active:bg-slate-700/50">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900 dark:text-white break-words">{r.kind==='discount'?'Скидка клиенту':r.title}</span>
          {(r.productName||r.customerName&&expenses) && <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400 break-words">{[expenses?r.customerName:undefined,r.productName].filter(Boolean).join(' · ')}</span>}
          {r.kind==='discount'&&r.fullAmount!=null&&<span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">Общая скидка: {money(r.fullAmount)}</span>}
          <span className="mt-1 block text-[11px] text-slate-400">{formatDate(r.date)}{r.investorName?` · ${r.investorName}`:''}{r.isDownPayment&&!expenses?' · Первый взнос':''}</span>
          {r.includedInAccruals&&<span className="mt-1.5 inline-block rounded-md bg-amber-50 dark:bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">Учтено в начислениях</span>}
        </span>
        <span className={`shrink-0 tabular-nums text-sm font-bold ${expenses||r.amount<0?'text-rose-600 dark:text-rose-400':'text-emerald-600 dark:text-emerald-400'}`}>{expenses?negative(r.amount):`${r.amount>0?'+':''}${money(r.amount)}`}</span>
        <span aria-hidden className={`text-slate-400 transition-transform motion-reduce:transition-none ${opened?'rotate-90':''}`}>›</span>
      </button>
      <div aria-hidden={!opened} inert={!opened} className={`grid transition-[grid-template-rows,opacity] duration-200 motion-reduce:transition-none ${opened?'grid-rows-[1fr] opacity-100':'grid-rows-[0fr] opacity-0'}`}>
        <div className="min-h-0 overflow-hidden"><div className="px-4 pb-4 pt-1 space-y-2.5 border-t border-slate-100 dark:border-slate-700">
          {detail('Счёт',r.accountName)}
          {expenses&&detail('Клиент',r.customerName)}
          {detail('Договор',r.productName)}
          {detail('Получено от клиента',r.paymentAmount!=null?money(r.paymentAmount):undefined)}
          {detail('Скидка клиенту',r.kind==='discount'&&r.fullAmount!=null?money(r.fullAmount):r.discountAmount!=null?money(r.discountAmount):undefined)}
          {detail('Прибыль до скидки',r.beforeDiscount!=null?money(r.beforeDiscount):undefined)}
          {detail(r.kind==='discount'?'Влияние на прибыль':'Сумма записи',r.fullAmount!=null&&r.kind!=='discount'?money(r.fullAmount):r.kind==='discount'?negative(r.amount):undefined)}
          {detail('Влияние скидки',r.discountImpact!=null?negative(r.discountImpact):undefined)}
          {detail('Начислено прибыли',!expenses?money(r.amount):undefined)}
          {detail('Доля прибыли',r.sharePercent!=null?`${formatCurrency(r.sharePercent,true)}%`:undefined)}
          {(r.includedInAccruals||r.discountAmount!=null)&&<p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">Скидка уже уменьшила «Получено». Повторного списания нет.</p>}
          {r.note&&<p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-words">{r.note}</p>}
          {r.saleId&&onOpenContract&&<button type="button" onClick={()=>onOpenContract(r.saleId!)} className="rounded-xl bg-indigo-50 dark:bg-indigo-500/10 px-3 py-2 text-xs font-semibold text-indigo-600 dark:text-indigo-300">Открыть договор</button>}
        </div></div>
      </div>
    </div>;
  };
  return <div className="space-y-5" data-cash-profit-view={view}>
    <div className="text-center py-1"><p className={`text-3xl font-extrabold tabular-nums tracking-tight ${hero<0?'text-rose-600 dark:text-rose-400':'text-slate-900 dark:text-white'}`}>{money(hero)}</p>
      <p className="mt-1.5 text-xs text-slate-400">{periodLabel||(view==='received'?'Начислено за выбранный период':view==='paid'?'Только выплаты прибыли':'С учётом выплат и расходов')}</p>
    </div>
    {view==='available'&&<SheetSection title="Как получилась сумма">
      {row('Получено прибыли',ledger.received,()=>choose('accruals'))}
      {row('Выплачено',-ledger.paid,()=>choose('expenses','payout'))}
      {row('Прочие расходы',-ledger.other,()=>choose('expenses','other'))}
      {ledger.discountsDeducted>0&&row('Скидки из прибыли',-ledger.discountsDeducted,()=>choose('expenses','discount'))}
      <div className="px-4 py-3 flex justify-between gap-3 font-bold text-sm text-slate-900 dark:text-white"><span>К выводу</span><span className="tabular-nums">{money(ledger.available)}</span></div>
    </SheetSection>}
    {view==='available'&&<div role="tablist" aria-label="Движение прибыли" className="flex gap-1 rounded-xl bg-slate-200/60 dark:bg-slate-800 p-1">
      {([{id:'accruals',label:'Начисления'},{id:'expenses',label:'Расходы'}] as const).map(t=><button key={t.id} type="button" role="tab" aria-selected={tab===t.id} aria-controls="cash-profit-rows" onClick={()=>choose(t.id)} className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition-colors ${tab===t.id?'bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm':'text-slate-500 dark:text-slate-400'}`}>{t.label}</button>)}
    </div>}
    {view==='available'&&expenses&&<div role="group" aria-label="Фильтры расходов" className="flex gap-1.5">
      {filters.map(f=><button type="button" key={f.id} aria-pressed={filter===f.id} onClick={()=>{setFilter(f.id);setExpanded(null);setLimit(35);}} className={`flex-1 min-w-0 rounded-full px-2 py-2 text-xs font-semibold transition-colors ${filter===f.id?'bg-indigo-600 text-white':'bg-slate-200/60 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>{f.label}</button>)}
    </div>}
    {source.length>8&&<input aria-label="Поиск операций прибыли" placeholder="Клиент или назначение" value={query} onChange={e=>{setQuery(e.target.value);setExpanded(null);setLimit(35);}} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-900 dark:text-white" />}
    {expenses&&filtered.some(r=>r.includedInAccruals)&&<p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">Скидки с пометкой уже учтены в «Получено».</p>}
    <div id="cash-profit-rows" role={view==='available'?'tabpanel':undefined} className="space-y-2.5">
      {filtered.slice(0,limit).map(renderRow)}
      {!filtered.length&&<div className="py-10 text-center text-sm text-slate-400">{query.trim()?'Ничего не найдено':expenses?'Нет операций за этот период':'Нет начислений за этот период'}</div>}
      {filtered.length>limit&&<button type="button" onClick={()=>setLimit(n=>n+35)} className="w-full rounded-xl py-3 text-sm font-semibold text-indigo-600 dark:text-indigo-300">Показать ещё · {filtered.length-limit}</button>}
    </div>
  </div>;
}
