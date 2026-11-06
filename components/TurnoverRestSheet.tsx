import React, { useMemo, useRef, useState } from 'react';
import type { Account, Customer, Expense, Investor, RetailSale, Sale } from '../types';
import type { TurnoverBreakdown } from '../src/turnoverBreakdown';
import type { TurnoverRestEntry } from '../src/turnoverRest';
import { turnoverRestInsights, type RestCauseSection } from '../src/turnoverRestInsights';
import { formatCurrency, formatDate } from '../src/utils';
import { useProgressiveList } from '../src/hooks/useProgressiveList';
import GlassSheet, { SheetSection } from './GlassSheet';

const kinds: Record<string,string> = {all:'Все причины',negative:'Уменьшили остаток',positive:'Увеличили остаток',review:'Требуют проверки',initial:'Начальные остатки',income:'Поступления',expense:'Расходы и изъятия',capital:'Капитал инвесторов',contract:'Договоры',retail:'Наличные продажи',balance:'Разница остатков',rounding:'Округление'};
const dateLabel = (date?: string) => date && Number.isFinite(new Date(date).getTime()) ? formatDate(date) : 'Без даты';

export default function TurnoverRestSheet({data,accounts,accountIds,customers,sales,expenses,investors,retailSales=[],showCents,accountName,onViewSale,onClose}: {
  data:TurnoverBreakdown; accounts:Account[]; accountIds:string[]; customers:Customer[]; sales:Sale[]; expenses:Expense[]; investors:Investor[]; retailSales?:RetailSale[];
  showCents?:boolean; accountName?:string; onViewSale:(sale:Sale)=>void; onClose:()=>void;
}) {
  const [filter,setFilter] = useState('all');
  const [expanded,setExpanded] = useState<string|null>(null);
  const recordsRef = useRef<HTMLDivElement>(null);
  const {entries,explained,difference} = data.restDetails;
  const insights = useMemo(()=>turnoverRestInsights({entries,accounts,accountIds,sales}),[entries,accounts,accountIds,sales]);
  const reviewCount = insights.reviewCount;
  const money = (n:number) => `${formatCurrency(n,showCents)} ₽`;
  const signed = (n:number) => `${n<0?'−':n>0?'+':''}${money(Math.abs(n))}`;
  const cause = insights.causes.find(c=>`cause:${c.id}`===filter);
  const activeFilter = filter.startsWith('cause:')&&!cause?'all':filter;
  const sorted = useMemo(()=>{
    const matched=cause?new Set(cause.entryIds):null;
    return entries.filter(e=>matched?matched.has(e.id):activeFilter==='all'||activeFilter==='review'&&e.review
      ||activeFilter==='negative'&&e.amount<0||activeFilter==='positive'&&e.amount>0||e.kind===activeFilter)
      .sort((a,b)=>(Date.parse(b.date || '')||0)-(Date.parse(a.date || '')||0));
  },[entries,activeFilter,cause]);
  const {visible,hasMore,sentinel} = useProgressiveList<TurnoverRestEntry>(sorted,'turnover-rest',`${accountName || 'all'}:${activeFilter}`,40);
  const goTo = (value:string,entryIds?:string[]) => {
    setFilter(value);setExpanded(entryIds?.length===1?entryIds[0]:null);
    requestAnimationFrame(()=>recordsRef.current?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'}));
  };
  const sumRow = (label:string,amount:number,strong=false) => <div className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-3 ${strong?'font-bold':'text-sm'}`}>
    <span className="text-slate-600 dark:text-slate-300">{label}</span><span className="ml-auto tabular-nums text-slate-900 dark:text-white">{money(amount)}</span>
  </div>;
  const record = (entry:TurnoverRestEntry) => {
    const sale = entry.sourceType==='sale'?sales.find(s=>s.id===entry.sourceId):undefined;
    const expense = entry.sourceType==='expense'?expenses.find(e=>e.id===entry.sourceId):undefined;
    const account = accounts.find(a=>a.id===entry.accountId);
    const investor = entry.sourceType==='investor'?investors.find(i=>i.id===entry.sourceId):undefined;
    const capital = entry.kind==='capital'&&entry.sourceId?insights.capitalEvidence[entry.sourceId]:undefined;
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
      {capital && <div className="space-y-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 p-3 text-xs">
        {capital.accounts.length>1&&<p className="text-slate-600 dark:text-slate-300">{capital.accounts.filter(a=>a.selected).length>1?'Инвестор связан с несколькими выбранными счетами. Капитал в этом расчёте учтён один раз.':'Инвестор связан и с другими счетами. Сверьте распределение капитала.'}</p>}
        {!capital.deposits.some(d=>d.selected)&&<p className="text-amber-700 dark:text-amber-400">Явная запись внесения этого инвестора в выбранные счета не найдена.</p>}
        {!!capital.deposits.length&&<div className="space-y-2">
          <p className="font-semibold text-slate-600 dark:text-slate-300">Связанные внесения</p>
          {capital.deposits.map(d=><details key={`${d.id}:${d.accountId}`} className="rounded-lg border border-slate-200 dark:border-slate-700 p-2.5">
            <summary className="cursor-pointer text-slate-700 dark:text-slate-200 break-words">{d.accountName} · {money(d.amount)}{!d.selected?' · другой счёт':''}</summary>
            <div className="mt-2 space-y-1 text-slate-500 dark:text-slate-400"><p>{d.title}</p><p>Дата: {dateLabel(d.date)}</p><p>Сумма внесения: {money(d.amount)}</p></div>
          </details>)}
          {capital.deposits.some(d=>!d.selected)&&<p className="text-slate-500 dark:text-slate-400">Запись внесения в другом счёте сама по себе не подтверждает перевод в выбранную кассу.</p>}
        </div>}
      </div>}
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
      <section aria-label={data.rest<0?'Почему получился минус':'Причины остатка'} className="space-y-4">
        <h3 className="px-1 text-base font-bold text-slate-900 dark:text-white">{data.rest<0?'Почему получился минус':'Что повлияло на остаток'}</h3>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" data-rest-direction="positive" onClick={()=>goTo('positive')} className="rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 p-3 text-left">
            <span className="block text-xs text-emerald-700 dark:text-emerald-400">Увеличили остаток</span><span className="mt-1 block font-bold tabular-nums text-sm text-emerald-700 dark:text-emerald-300 break-words">{signed(insights.increased)}</span>
          </button>
          <button type="button" data-rest-direction="negative" onClick={()=>goTo('negative')} className="rounded-2xl bg-rose-50 dark:bg-rose-500/10 p-3 text-left">
            <span className="block text-xs text-rose-700 dark:text-rose-400">Уменьшили остаток</span><span className="mt-1 block font-bold tabular-nums text-sm text-rose-700 dark:text-rose-300 break-words">{signed(insights.decreased)}</span>
          </button>
        </div>
        {data.rest<0&&<p className="px-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">Минус в расчёте сам по себе не означает убыток.</p>}
        {([
          ['operations','Подтверждено записями'],['calculation','В расчёте отдельно'],['review','Требуют сверки'],
        ] as [RestCauseSection,string][]).filter(([section])=>insights.causes.some(c=>c.section===section)).map(([section,title])=><SheetSection key={section} title={title}>
          {insights.causes.filter(c=>c.section===section).map(c=><button type="button" key={c.id} data-rest-cause={c.id} onClick={()=>goTo(`cause:${c.id}`,c.entryIds)} className="w-full px-4 py-3 text-left flex items-center gap-3 active:bg-slate-50 dark:active:bg-slate-700/50">
            <span className="flex-1 min-w-0"><span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{c.title}</span>
              <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">Записей: {c.entryIds.length}{c.increased>0&&c.decreased<0?` · ${signed(c.increased)} и ${signed(c.decreased)}`:''}</span>
              {(c.id==='capital'||section==='review')&&<span className={`mt-1 block text-xs leading-relaxed ${section==='review'?'text-amber-700 dark:text-amber-400':'text-slate-500 dark:text-slate-400'}`}>{c.hint}</span>}
            </span>
            <span className={`shrink-0 font-semibold tabular-nums text-sm ${c.amount<0&&section==='operations'?'text-rose-600 dark:text-rose-400':'text-slate-900 dark:text-white'}`}>{signed(c.amount)}</span>
            <span aria-hidden className="text-slate-400">›</span>
          </button>)}
        </SheetSection>)}
        {!!reviewCount&&<p className="px-1 text-xs leading-relaxed text-amber-700 dark:text-amber-400">Записей для сверки: {reviewCount}.{insights.reviewIncreased>0&&insights.reviewDecreased<0?' Плюсы и минусы в них могут компенсироваться.':''}</p>}
      </section>
      <details className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700 dark:text-slate-200">Как рассчитан остаток</summary>
        <div className="mt-3">
      <SheetSection title="Расчёт остатка" hint="Прибыль включает полученную, ещё не выведенную часть и ожидаемую с остатка долга.">
        {sumRow('В обороте',data.total)}{sumRow('− Вложения инвесторов',data.investorCapital)}
        {sumRow('− Ваша прибыль',data.manager.toWithdraw+data.manager.expected)}
        {sumRow('− Прибыль инвесторов',data.investors.toPay+data.investors.expected)}{sumRow('Остаток',data.rest,true)}
      </SheetSection>
      <SheetSection title="Сопоставление с записями">
        {sumRow('Объясняется записями',explained)}{sumRow('Требует сопоставления',difference,true)}
      </SheetSection>
        </div>
      </details>
      <div ref={recordsRef} className="space-y-3 scroll-mt-24">
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Причины и операции
          <select aria-label="Фильтр причин остатка" value={activeFilter} onChange={e=>{setFilter(e.target.value);setExpanded(null);}} className="mt-2 block w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-3 text-sm normal-case tracking-normal text-slate-900 dark:text-white">
            {Object.entries(kinds).filter(([key])=>['all','review','positive','negative'].includes(key)||entries.some(e=>e.kind===key)).map(([key,label])=><option key={key} value={key}>{label}</option>)}
            <optgroup label="По причинам">{insights.causes.map(c=><option key={c.id} value={`cause:${c.id}`}>{c.title}</option>)}</optgroup>
          </select>
        </label>
        <SheetSection hint="Суммы со знаком показывают влияние на остаток. У договора это итог его поступлений, долга, прибыли и связанных расходов; это не отдельный платёж. Нажмите строку, чтобы посмотреть расчёт и исходную запись.">
          {!sorted.length && <p className="p-4 text-sm text-slate-500">{activeFilter==='review'?'Записей для проверки нет.':'В этой группе нет операций, влияющих на остаток.'}</p>}
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
