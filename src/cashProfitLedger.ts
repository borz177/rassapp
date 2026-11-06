import type { Account, Customer, Expense, Investor, Sale } from '../types';
import { dateFromInput } from './saleMath';
import {
  CLIENT_DISCOUNT, getAccountShares, getInvestorProfitDeduction, getManagerProfitDeduction,
  isDownPaymentOf, moneyInProfit, paymentManagerPercent, paymentProfitShares, saleMoneyIn, saleProfitMargin,
} from './utils';

export type CashProfitKind = 'payout' | 'discount' | 'other';
export interface CashProfitRow {
  id: string; date: string; amount: number; title: string; accountName: string;
  accountId: string; saleId?: string; customerId?: string; customerName?: string; productName?: string;
  investorId?: string; investorName?: string; note?: string; fullAmount?: number;
  paymentAmount?: number; sharePercent?: number; beforeDiscount?: number;
  discountAmount?: number; discountImpact?: number;
  isDownPayment?: boolean; kind?: CashProfitKind; includedInAccruals?: boolean;
}
export interface CashProfitLedger {
  accruals: CashProfitRow[]; expenses: CashProfitRow[];
  received: number; paid: number; other: number; discountsDeducted: number;
  embeddedDiscounts: number; deducted: number; available: number;
}
const round = (n: number) => Math.round(n * 100) / 100;
const sum = (rows: CashProfitRow[]) => round(rows.reduce((n,r)=>n+r.amount,0));
const sorted = (rows: CashProfitRow[]) => [...rows].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)||a.id.localeCompare(b.id));

/** Календарные границы пользователя: new Date('YYYY-MM-DD') начинал день в 03:00 МСК. */
export function inProfitPeriod(date: string, period: { start: string; end: string }): boolean {
  const value = dateFromInput(date).getTime();
  const start = period.start ? dateFromInput(period.start).getTime() : -Infinity;
  const end = period.end ? dateFromInput(period.end) : null;
  end?.setHours(23,59,59,999);
  return Number.isFinite(value) && value >= start && value <= (end?.getTime() ?? Infinity);
}

/** Отчёт строится из тех же строк, что карточки. Встроенные скидки — пояснение к
 * moneyInProfit, отдельного списания в available они не создают. */
export function combineCashProfitLedgers(ledgers: CashProfitLedger[]): CashProfitLedger {
  const accruals=sorted(ledgers.flatMap(l=>l.accruals)), expenses=sorted(ledgers.flatMap(l=>l.expenses));
  const received=sum(accruals), paid=sum(expenses.filter(e=>e.kind==='payout'));
  const other=sum(expenses.filter(e=>e.kind==='other'));
  const discountsDeducted=sum(expenses.filter(e=>e.kind==='discount'&&!e.includedInAccruals));
  const embeddedDiscounts=sum(expenses.filter(e=>e.includedInAccruals));
  const deducted=round(paid+other+discountsDeducted);
  return {accruals,expenses,received,paid,other,discountsDeducted,embeddedDiscounts,deducted,available:round(received-deducted)};
}
const empty = (): CashProfitLedger => ({accruals:[],expenses:[],received:0,paid:0,other:0,discountsDeducted:0,embeddedDiscounts:0,deducted:0,available:0});

export function cashProfitLedgers({sales,expenses,accounts,investors,customers,period,accountId,profitFromPaymentsOnly=false}: {
  sales: Sale[]; expenses: Expense[]; accounts: Account[]; investors: Investor[]; customers: Customer[];
  period: {start:string;end:string}; accountId?: string; profitFromPaymentsOnly?: boolean;
}): {manager:CashProfitLedger; investors:Map<string,CashProfitLedger>} {
  const manager=empty(), per=new Map<string,CashProfitLedger>();
  const investorLedger=(id:string)=>{let l=per.get(id);if(!l){l=empty();per.set(id,l);}return l;};
  const accountOf=new Map(accounts.map(a=>[a.id,a])), customerOf=new Map(customers.map(c=>[c.id,c]));
  const saleOf=new Map(sales.map(s=>[s.id,s]));
  const scoped=(id:string)=>!accountId||accountId==='ALL'||accountId===id;
  for(const sale of sales){
    if(!scoped(sale.accountId)||sale.buyPrice<=0||sale.totalAmount<=sale.buyPrice)continue;
    const account=accountOf.get(sale.accountId);if(account?.type==='SHARED')continue;
    for(const p of saleMoneyIn(sale)){
      const discount=Math.max(0,Number('discountAmount' in p?p.discountAmount:0)||0);
      if((p.amount<=0&&!discount)||!inProfitPeriod(p.date,period))continue;
      const profit=moneyInProfit(sale,p,profitFromPaymentsOnly);
      const cut=discount ? Math.max(0,(p.amount+discount)*saleProfitMargin(sale,profitFromPaymentsOnly)-profit) : 0;
      const common={date:p.date,accountId:sale.accountId,accountName:account?.name||'Без счёта',saleId:sale.id,
        customerId:sale.customerId,customerName:customerOf.get(sale.customerId)?.name||'Неизвестно',
        productName:sale.productName,paymentAmount:p.amount,isDownPayment:isDownPaymentOf(sale,p.id),
        note:sale.paymentPlan?.find(x=>x.id===p.id)?.note};
      const add=(ledger:CashProfitLedger,percent:number,recipient?:Investor)=>{
        if(percent<=0)return;
        const amount=profit*percent/100, impact=cut*percent/100;
        const id=`${sale.id}:${sale.accountId}:${p.id}:${recipient?.id||'manager'}`;
        const detail={...common,sharePercent:percent,investorId:recipient?.id,investorName:recipient?.name};
        if(Math.abs(amount)>0.000001||discount>0)ledger.accruals.push({id,...detail,amount,title:common.customerName,
          ...(discount>0?{discountAmount:discount,discountImpact:impact,beforeDiscount:amount+impact}:{})});
        if(discount>0)ledger.expenses.push({id:`discount:${id}`,...detail,title:'Скидка клиенту',kind:'discount',
          amount:impact,fullAmount:discount,includedInAccruals:true,beforeDiscount:amount+impact});
      };
      add(manager,paymentManagerPercent(account,investors,sale,p));
      if(account)for(const {investor,percentage} of paymentProfitShares(account,investors,sale,p))add(investorLedger(investor.id),percentage,investor);
    }
  }
  for(const e of expenses){
    if(!scoped(e.accountId)||!inProfitPeriod(e.date,period))continue;
    const account=accountOf.get(e.accountId),sale=e.saleId?saleOf.get(e.saleId):undefined;
    const customerId=e.customerId||sale?.customerId;
    const base={date:e.date,title:e.title||e.category||'Расход',accountId:e.accountId,accountName:account?.name||'Без счёта',
      saleId:e.saleId,customerId,customerName:customerId?customerOf.get(customerId)?.name:undefined,
      productName:sale?.productName,note:e.description,fullAmount:Number(e.amount)||0};
    const append=(ledger:CashProfitLedger,amount:number,kind:CashProfitKind,recipient?:Investor)=>{
      if(amount<=0.009)return;
      ledger.expenses.push({id:`expense:${e.id}:${recipient?.id||'manager'}`,...base,amount,kind,
        investorId:recipient?.id,investorName:recipient?.name});
    };
    // Адресная выплата имеет приоритет над устаревшим флагом fromProfit: одна запись — одно списание.
    if(e.payoutType==='PROFIT'&&e.investorId){
      const investor=investors.find(i=>i.id===e.investorId);
      if(investor)append(investorLedger(investor.id),Number(e.amount)||0,'payout',investor);
      continue;
    }
    if(e.category==='Моя выплата'){
      if(e.managerPayoutSource!=='CAPITAL')append(manager,Number(e.amount)||0,'payout');
      continue;
    }
    if(!e.fromProfit||e.payoutType==='INVESTMENT')continue;
    const kind=e.category===CLIENT_DISCOUNT?'discount':'other';
    append(manager,getManagerProfitDeduction(e,account,investors),kind);
    for(const {investor} of getAccountShares(account,investors,e.date))append(investorLedger(investor.id),getInvestorProfitDeduction(e,account,investors,investor.id),kind,investor);
  }
  return {manager:combineCashProfitLedgers([manager]),investors:new Map([...per].map(([id,l])=>[id,combineCashProfitLedgers([l])]))};
}
