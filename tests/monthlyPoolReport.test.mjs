import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import * as P from '../shared/profit.js';
const files=await build({entryPoints:['src/monthlyPoolReport.ts','src/cashProfitLedger.ts'],bundle:true,write:false,platform:'node',format:'esm',outdir:'unused-tests',logLevel:'silent'});
const [R,L]=await Promise.all(files.outputFiles.map(f=>import('data:text/javascript;base64,'+Buffer.from(f.contents).toString('base64'))));
const now=Date.parse('2026-11-30T20:59:59.999Z'),period={start:'2026-11-01',end:'2026-11-30'};
const clock=fn=>{const old=Date.now;Date.now=()=>now;try{return fn()}finally{Date.now=old}};
function fixture(){const investor={id:'i',name:'Участник',initialAmount:100000,profitPercentage:40,joinedDate:'2025-05-25T00:00:00+03:00'};
 const terms={date:'2026-11-01T00:00:00+03:00',members:{i:{rate:40,disposition:'PAYABLE'}},managerShareSplit:[]};
 const account={id:'pool',name:'Пул',type:'POOL',poolMemberIds:['i'],poolAccounting:{version:1,startMonth:'2026-11',openingTerms:terms,terms:[terms],closed:[],excludedSaleIds:[],reinvestments:[]}};
 const sale={id:'sale',accountId:'pool',customerId:'client',type:'INSTALLMENT',status:'ACTIVE',startDate:'2026-01-01',buyPrice:10000,totalAmount:20000,remainingAmount:0,downPayment:0,paymentPlan:[{id:'p',date:'2026-11-10',amount:20000,isPaid:true,isRealPayment:true}]};
 const expense={id:'cost',accountId:'pool',date:'2026-11-15',amount:5000,fromProfit:true,profitSource:'SHARED',category:'Расход'};
 return {accounts:[account],investors:[investor],sales:[sale],expenses:[expense],period,customers:[]};}
test('месячный отчёт и касса совпадают после общих расходов; поступление не считается второй раз',()=>clock(()=>{
 const f=fixture(),before=JSON.stringify(f),r=R.monthlyPoolReportIncome(f),l=L.cashProfitLedgers(f);
 assert.deepEqual(r,{manager:3000,investor:2000});assert.equal(r.manager,l.manager.received);assert.equal(r.investor,l.investors.get('i').received);
 assert(R.isMonthlyPoolReportIncome(f.accounts[0],f.sales[0],'2026-11-10'));
 assert.equal(JSON.stringify(f),before);
}));
test('старый пул, отдельный счёт и будущая дата перехода остаются на прежнем пути',()=>clock(()=>{
 const f=fixture();delete f.accounts[0].poolAccounting;
 assert.deepEqual(R.monthlyPoolReportIncome(f),{manager:0,investor:0});assert(!R.isMonthlyPoolReportIncome(f.accounts[0],f.sales[0],'2026-11-10'));
 f.accounts[0]={id:'pool',type:'INVESTOR',ownerId:'i'};assert.deepEqual(R.monthlyPoolReportIncome(f),{manager:0,investor:0});
 const future=fixture();future.accounts[0].poolAccounting.startMonth='2026-12';assert.deepEqual(R.monthlyPoolReportIncome(future),{manager:0,investor:0});assert(!R.isMonthlyPoolReportIncome(future.accounts[0],future.sales[0],'2026-11-10'));
}));
test('поступления до перехода и личные договоры не попадают в месячный результат',()=>clock(()=>{
 const f=fixture();assert(!R.isMonthlyPoolReportIncome(f.accounts[0],f.sales[0],'2026-10-10'));
 f.accounts[0].poolAccounting.excludedSaleIds=['sale'];
 assert(!R.isMonthlyPoolReportIncome(f.accounts[0],f.sales[0],'2026-11-10'));
 assert.deepEqual(R.monthlyPoolReportIncome(f),{manager:0,investor:0});
}));
test('начисления закрытого месяца не пересчитываются по изменённым исходным платежам',()=>clock(()=>{
 const f=fixture();const report=P.poolMonthlyReport(f.accounts[0],f.investors,f.sales,f.expenses,'2026-11',now);
 f.accounts[0].poolAccounting.closed=[{...report,status:'CLOSED'}];f.sales[0].paymentPlan[0].amount=999999;
 const before=JSON.stringify(f.accounts[0].poolAccounting.closed);
 assert.deepEqual(R.monthlyPoolReportIncome(f),{manager:3000,investor:2000});assert.equal(JSON.stringify(f.accounts[0].poolAccounting.closed),before);
}));
test('фильтр счёта и периода исключает чужие начисления',()=>clock(()=>{
 const f=fixture();assert.deepEqual(R.monthlyPoolReportIncome({...f,accountId:'other'}),{manager:0,investor:0});
 assert.deepEqual(R.monthlyPoolReportIncome({...f,period:{start:'2026-10-01',end:'2026-10-31'}}),{manager:0,investor:0});
 assert.deepEqual(R.monthlyPoolReportIncome({...f,accountId:'pool'}),{manager:3000,investor:2000});
}));
test('фактическая выплата не уменьшает начисление повторно; будущий расход исключён',()=>clock(()=>{
 const f=fixture();f.expenses.push({id:'paid',accountId:'pool',date:'2026-11-21',category:'Моя выплата',amount:1000,managerPayoutSource:'PROFIT'},
 {id:'future',accountId:'pool',date:'2026-12-01',category:'Расход',amount:99999,fromProfit:true,profitSource:'SHARED'});
 assert.deepEqual(R.monthlyPoolReportIncome(f),{manager:3000,investor:2000});
 const l=L.cashProfitLedgers(f);assert.equal(l.manager.paid,1000);assert.equal(l.manager.received,3000);
}));
test('убыток месяца не превращается в положительное начисление',()=>clock(()=>{
 const f=fixture();f.expenses[0].amount=15000;
 assert.deepEqual(R.monthlyPoolReportIncome(f),{manager:0,investor:0});
 const report=P.poolMonthlyReport(f.accounts[0],f.investors,f.sales,f.expenses,'2026-11',now);assert.equal(report.carryOut,5000);
}));

test('частичная оплата двух взносов совпадает в кассе, отчёте и деталях инвестора', () => clock(() => {
 const f = fixture();
 const account = f.accounts[0];
 const second = { id: 'second', name: 'Второй участник', initialAmount: 100000, profitPercentage: 100, joinedDate: '2026-10-24T00:00:00+03:00' };
 f.investors[0].profitPercentage = 100;
 f.investors.push(second);
 account.poolMemberIds.push(second.id);
 account.poolAccounting.openingTerms.members.i.rate = 100;
 account.poolAccounting.openingTerms.members[second.id] = { rate: 100, disposition: 'PAYABLE' };
 f.expenses = [];
 Object.assign(f.sales[0], { buyPrice: 100, totalAmount: 200, paymentPlan: [
  { id: 'oct', date: '2026-10-10', amount: 100, isPaid: true, isRealPayment: false },
  { id: 'nov', date: '2026-11-06', amount: 100, isPaid: true, isRealPayment: false },
  { id: 'first', date: '2026-11-01', amount: 150, isPaid: true, isRealPayment: true },
  { id: 'rest', date: '2026-11-03', amount: 50, isPaid: true, isRealPayment: true },
 ] });

 const report = P.poolMonthlyReport(account, f.investors, f.sales, f.expenses, '2026-11', now);
 const ledger = L.cashProfitLedgers(f);
 assert.equal(ledger.investors.get('i').received, 75);
 assert.equal(ledger.investors.get(second.id).received, 25);
 assert.deepEqual(R.monthlyPoolReportIncome(f), { manager: 0, investor: 100 });
 assert.deepEqual(report.sources.map(row => row.earningMonths), [['2026-10', '2026-11'], ['2026-11']]);
 assert.deepEqual(P.poolAllocationDetails(report, second.id).map(row => row.amount), [12.5, 12.5]);
}));
