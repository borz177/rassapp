import type {Account, Expense, Investor, Sale} from '../types';
import {isMonthlyPool, monthlyPoolApplies, poolMonthlyReports, inPoolProfitPeriod} from '../shared/profit.js';

/** Поступление уже входит в месячный результат; второй раз делить его нельзя. */
export function isMonthlyPoolReportIncome(account: Account | undefined, sale: Sale, date: string): boolean {
  return monthlyPoolApplies(account,date)&&!(account?.poolAccounting?.excludedSaleIds||[]).includes(sale.id);
}

/** Начисления из того же месячного расчёта, который используется в кассе.
 * Личные исторические договоры и старый метод обрабатываются прежним путём.
 * Общие расходы уже учтены в базе месяца; выплаты и личные расходы — отдельно. */
export function monthlyPoolReportIncome({accounts,investors,sales,expenses,period,accountId,profitFromPaymentsOnly=false}: {
  accounts:Account[];investors:Investor[];sales:Sale[];expenses:Expense[];
  period:{start:string;end:string};accountId?:string;profitFromPaymentsOnly?:boolean;
}) {
  let manager=0,investor=0;
  for(const account of accounts){
    if(!isMonthlyPool(account)||accountId&&accountId!=='ALL'&&accountId!==account.id)continue;
    for(const report of poolMonthlyReports(account,investors,sales,expenses,Date.now(),profitFromPaymentsOnly)){
      if(!inPoolProfitPeriod(report.date,period))continue;
      for(const allocation of report.allocations){
        if(allocation.id==='__manager__')manager+=allocation.amount;
        else investor+=allocation.amount;
      }
    }
  }
  return {manager:Math.round(manager*100)/100,investor:Math.round(investor*100)/100};
}
