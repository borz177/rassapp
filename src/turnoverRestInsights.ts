import type { Account, Sale } from '../types';
import type { TurnoverRestEntry } from './turnoverRest';
import { saleMoneyIn } from './utils';

export type RestCauseSection = 'operations' | 'calculation' | 'review';
export interface RestCause {
  id: string; section: RestCauseSection; title: string; hint: string;
  amount: number; increased: number; decreased: number; entryIds: string[];
}
export interface RestCapitalEvidence {
  accounts: {id:string;name:string;selected:boolean}[];
  deposits: {id:string;title:string;date:string;amount:number;accountId:string;accountName:string;selected:boolean}[];
}
export interface TurnoverRestInsights {
  increased: number; decreased: number; total: number;
  reviewCount: number; reviewAmount: number; reviewIncreased: number; reviewDecreased: number;
  causes: RestCause[]; capitalEvidence: Record<string,RestCapitalEvidence>;
}
const round=(n:number)=>Math.round(n*100)/100;
const definitions: Record<string,{section:RestCauseSection;title:string;hint:string}> = {
  expenses:{section:'operations',title:'Расходы и изъятия',hint:'Влияние сохранённых расходов после учёта списаний из прибыли.'},
  income:{section:'operations',title:'Поступления',hint:'Записанные внесения денег на выбранные счета.'},
  retailIn:{section:'operations',title:'Поступления по чекам',hint:'Оплаты продаж и долга магазина.'},
  retailOut:{section:'operations',title:'Возвраты по чекам',hint:'Деньги, возвращённые по записям магазина.'},
  initial:{section:'calculation',title:'Начальные остатки',hint:'Стартовые суммы счетов, а не отдельные платежи.'},
  capital:{section:'calculation',title:'Капитал инвесторов',hint:'Выделен отдельно. Это не расход.'},
  external:{section:'calculation',title:'Договоры со склада и от поставщиков',hint:'Закуп учитывается отдельными складскими расходами или расчётами с поставщиком.'},
  rounding:{section:'calculation',title:'Округление',hint:'Копеечная разница расчёта.'},
  contracts:{section:'review',title:'Несопоставленные договоры',hint:'Нужно сверить закуп, оплаты и долг.'},
  balance:{section:'review',title:'Расхождения расчёта',hint:'Не все суммы сопоставлены с записями.'},
};

/** Только объясняет готовую расшифровку: ни сумма остатка, ни данные учёта здесь
 * не меняются. Каждая строка входит ровно в одну причину, включая строки сверки. */
export function turnoverRestInsights({entries,accounts,accountIds,sales}: {
  entries:TurnoverRestEntry[]; accounts:Account[]; accountIds:string[]; sales:Sale[];
}): TurnoverRestInsights {
  const groups=new Map<string,RestCause>();
  const classify=(e:TurnoverRestEntry)=>e.review?(e.kind==='contract'?'contracts':'balance')
    :e.kind==='expense'?'expenses':e.kind==='income'?'income':e.kind==='retail'?(e.amount<0?'retailOut':'retailIn')
    :e.kind==='contract'?'external':e.kind==='balance'?'balance':e.kind;
  let increased=0,decreased=0,reviewCount=0,reviewIncreased=0,reviewDecreased=0;
  for(const entry of entries){
    const id=classify(entry),definition=definitions[id];
    let group=groups.get(id);
    if(!group){group={id,...definition,amount:0,increased:0,decreased:0,entryIds:[]};groups.set(id,group);}
    group.entryIds.push(entry.id);group.amount+=entry.amount;
    if(entry.amount>0){increased+=entry.amount;group.increased+=entry.amount;if(entry.review)reviewIncreased+=entry.amount;}
    if(entry.amount<0){decreased+=entry.amount;group.decreased+=entry.amount;if(entry.review)reviewDecreased+=entry.amount;}
    if(entry.review)reviewCount++;
  }
  const causes=[...groups.values()].map(g=>({...g,amount:round(g.amount),increased:round(g.increased),decreased:round(g.decreased)}))
    .sort((a,b)=>Math.max(b.increased,-b.decreased)-Math.max(a.increased,-a.decreased)||a.id.localeCompare(b.id));
  const selected=new Set(accountIds),capitalEvidence:Record<string,RestCapitalEvidence>={};
  for(const entry of entries.filter(e=>e.kind==='capital'&&e.sourceId)){
    const investorId=entry.sourceId!;
    const related=accounts.filter(a=>a.ownerId===investorId||a.poolMemberIds?.includes(investorId));
    const known=new Map(accounts.map(a=>[a.id,a]));
    const deposits:RestCapitalEvidence['deposits']=[];
    const seen=new Set<string>();
    for(const sale of sales){
      // Связь с инвестором явная. Одинаковые суммы и похожие названия её не доказывают.
      if(sale.customerId!==investorId&&sale.customerId!==`system_deposit_${investorId}`)continue;
      const account=known.get(sale.accountId),key=`${sale.id}\0${sale.accountId}`;
      if(!account||seen.has(key))continue;
      const amount=saleMoneyIn(sale).reduce((n,p)=>n+p.amount,0);
      if(amount<=0)continue;
      seen.add(key);
      deposits.push({id:sale.id,title:sale.productName||'Внесение инвестора',date:sale.startDate,amount:round(amount),
        accountId:account.id,accountName:account.name,selected:selected.has(account.id)});
    }
    capitalEvidence[investorId]={accounts:related.map(a=>({id:a.id,name:a.name,selected:selected.has(a.id)})),
      deposits:deposits.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)||a.id.localeCompare(b.id))};
  }
  return {increased:round(increased),decreased:round(decreased),total:round(increased+decreased),
    reviewCount,reviewAmount:round(reviewIncreased+reviewDecreased),reviewIncreased:round(reviewIncreased),reviewDecreased:round(reviewDecreased),causes,capitalEvidence};
}
