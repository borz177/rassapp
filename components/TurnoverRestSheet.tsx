import React, { useMemo, useState } from 'react';
import type { Account, Customer, Expense, Investor, RetailSale, Sale } from '../types';
import type { TurnoverBreakdown } from '../src/turnoverBreakdown';
import type { TurnoverRestEntry } from '../src/turnoverRest';
import { formatCurrency, formatDate } from '../src/utils';
import { useProgressiveList } from '../src/hooks/useProgressiveList';
import GlassSheet, { SheetSection } from './GlassSheet';

const kinds: Record<string,string> = {all:'Все причины',review:'Требуют проверки',initial:'Начальные остатки',income:'Поступления',expense:'Расходы и изъятия',capital:'Капитал инвесторов',contract:'Договоры',retail:'Наличные продажи',balance:'Разница остатков',rounding:'Округление'};
const dateLabel = (date?: string) => date && Number.isFinite(new Date(date).getTime()) ? formatDate(date) : 'Без даты';

export default function TurnoverRestSheet({data,accounts,customers,sales,expenses,investors,retailSales=[],showCents,accountName,onViewSale,onClose}: {
  data:TurnoverBreakdown; accounts:Account[]; customers:Customer[]; sales:Sale[]; expenses:Expense[]; investors:Investor[]; retailSales?:RetailSale[];
  showCents?:boolean; accountName?:string; onViewSale:(sale:Sale)=>void; onClose:()=>void;
}) {
  const [filter,setFilter] = useState('all');
  const [expanded,setExpanded] = useState<string|null>(null);
  const {entries,explained,difference} = data.restDetails;
  const reviewCount = entries.filter(e=>e.review).length;
  const money = (n:number) => `${formatCurrency(n,showCents)} ₽`;
  const signed = (n:number) => `${n<0?'−':n>0?'+':''}${money(Math.abs(n))}`;
  const sorted = useMemo(()=>entries.filter(e=>filter==='all'||filter==='review'&&e.review||e.kind===filter)
    .sort((a,b)=>(Date.parse(b.date || '')||0)-(Date.parse(a.date || '')||0)),[entries,filter]);
  const {visible,hasMore,sentinel} = useProgressiveList<TurnoverRestEntry>(sorted,'turnover-rest',`${accountName || 'all'}:${filter}`,40);
  const sumRow = (label:string,amount:number,strong=false) => <div className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-3 ${strong?'font-bold':'text-sm'}`}>
    <span className="text-slate-600 dark:text-slate-300">{label}</span><span className="ml-auto tabular-nums text-slate-900 dark:text-white">{money(amount)}</span>
  </div>;
  const record = (entry:TurnoverRestEntry) => {
    const sale = entry.sourceType==='sale'?sales.find(s=>s.id===entry.sourceId):undefined;
    const expense = entry.sourceType==='expense'?expenses.find(e=>e.id===entry.sourceId):undefined;
    const account = accounts.find(a=>a.id===entry.accountId);
    const investor = entry.sourceType==='investor'?investors.find(i=>i.id===entry.sourceId):undefined;
    const retail = entry.sourceType==='retail'?retailSales.find(r=>r.id===entry.sourceId):undefined;
    const customer = sale && customers.find(c=>c.id===sale.customerId);
    return <div className="px-4 pb-4 space-y-3 text-sm">
      <p className="text-slate-600 dark:text-slate-300">{entry.description}</p>
      {account && <p className="text-xs text-slate-500">Счёт: {account.name}</p>}
      {customer && <p className="text-xs text-slate-500">Клиент: {customer.name}</p>}
      {expense && <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 p-3 text-xs space-y-1 text-slate-600 dark:text-slate-300">
        <p>Сумма записи: {money(expense.amount)}</p><p>Категория: {expense.category}</p>
        {expense.description && <p className="whitespace-pre-wrap">{expense.description}</p>}
        {expense.isRefund && <p>Отметка возврата: сама запись не уменьшает деньги на счёте.</p>}
      </div>}
      {investor && <p className="text-xs text-slate-500">Капитал: {investor.name}. Не является расходной операцией.</p>}
      {retail && <p className="text-xs text-slate-500">{retail.items.map(i=>`${i.name} × ${i.quantity}`).join(', ')}</p>}
      {!!entry.parts?.length && <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 p-3 space-y-2">
        <p className="text-xs font-semibold text-slate-500">Как запись повлияла на остаток</p>
        {entry.parts.map((p,i)=><div key={i} className="flex justify-between gap-3 text-xs"><span className="text-slate-600 dark:text-slate-300">{p.label}</span><span className="tabular-nums shrink-0 text-slate-800 dark:text-slate-100">{signed(p.amount)}</span></div>)}
      </div>}
      {sale && customer && <button type="button" onClick={()=>onViewSale(sale)} className="rounded-xl px-3 py-2 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-300 text-sm font-semibold">Открыть договор</button>}
    </div>;
  };
  return <GlassSheet title="Расшифровка остатка" subtitle={accountName || 'Все счета'} onClose={onClose} cancelLabel="Назад" zIndex={210}>
    <div className="space-y-6">
      <div className="text-center"><p className={`text-3xl font-extrabold tabular-nums ${data.rest<0?'text-rose-600 dark:text-rose-400':'text-slate-900 dark:text-white'}`}>{money(data.rest)}</p>
        <p className="mt-2 text-sm text-slate-500">Сумма, не отнесённая к внешнему капиталу и прибыли.</p></div>
      <SheetSection title="Сопоставление с записями" hint="Начальные остатки, пополнения и расходы могут давать ненулевой остаток даже при согласованном учёте.">
        {sumRow('Объясняется записями',explained)}
        {sumRow('Требует сопоставления',difference,true)}
        <p className={`px-4 pb-3 text-xs leading-relaxed ${reviewCount?'text-amber-700 dark:text-amber-400':'text-slate-500'}`}>
          {reviewCount ? `Записей для проверки: ${reviewCount}. Откройте строки ниже, чтобы увидеть причины.${difference === 0 ? ' Их суммы взаимно компенсировались.' : ''}` : 'Остаток полностью разложен по доступным записям.'}
        </p>
      </SheetSection>
      <details className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700 dark:text-slate-200">Как рассчитан остаток</summary>
        <div className="mt-3">
      <SheetSection title="Расчёт остатка" hint="Прибыль включает полученную, ещё не выведенную часть и ожидаемую с остатка долга.">
        {sumRow('В обороте',data.total)}{sumRow('− Вложения инвесторов',data.investorCapital)}
        {sumRow('− Ваша прибыль',data.manager.toWithdraw+data.manager.expected)}
        {sumRow('− Прибыль инвесторов',data.investors.toPay+data.investors.expected)}{sumRow('Остаток',data.rest,true)}
      </SheetSection>
        </div>
      </details>
      <div className="space-y-3">
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Причины и операции
          <select aria-label="Фильтр причин остатка" value={filter} onChange={e=>{setFilter(e.target.value);setExpanded(null);}} className="mt-2 block w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-3 text-sm normal-case tracking-normal text-slate-900 dark:text-white">
            {Object.entries(kinds).filter(([key])=>key==='all'||key==='review'||entries.some(e=>e.kind===key)).map(([key,label])=><option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <SheetSection hint="Суммы со знаком показывают влияние на остаток. У договора это итог его поступлений, долга, прибыли и связанных расходов; это не отдельный платёж. Нажмите строку, чтобы посмотреть расчёт и исходную запись.">
          {!sorted.length && <p className="p-4 text-sm text-slate-500">{filter==='review'?'Записей для проверки нет.':'В этой группе нет операций, влияющих на остаток.'}</p>}
          {visible.map(entry=><div key={entry.id}>
            <button type="button" aria-expanded={expanded===entry.id} onClick={()=>setExpanded(expanded===entry.id?null:entry.id)} className="w-full text-left px-4 py-3 flex items-center gap-3 active:bg-slate-50 dark:active:bg-slate-700/50">
              <span className="flex-1 min-w-0"><span className="block font-medium text-sm text-slate-800 dark:text-white break-words">{entry.title}</span>
                <span className="block mt-1 text-xs text-slate-500">{entry.date?dateLabel(entry.date):'Расчётная строка'}{entry.accountId?` · ${accounts.find(a=>a.id===entry.accountId)?.name || 'Счёт'}`:''}</span>
                {entry.review && <span className="block mt-1 text-xs text-amber-700 dark:text-amber-400">Проверить связь записей</span>}
              </span>
              <span className={`shrink-0 tabular-nums text-sm font-semibold ${entry.amount<0?'text-rose-600 dark:text-rose-400':'text-slate-800 dark:text-white'}`}>{signed(entry.amount)}</span>
              <span aria-hidden className="text-slate-400">{expanded===entry.id?'⌄':'›'}</span>
            </button>
            {expanded===entry.id && record(entry)}
          </div>)}
          {hasMore && <div ref={sentinel} className="p-4 text-center text-xs text-slate-400">Показано {visible.length} из {sorted.length}</div>}
        </SheetSection>
      </div>
    </div>
  </GlassSheet>;
}
