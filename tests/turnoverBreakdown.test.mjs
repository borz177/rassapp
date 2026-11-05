import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({entryPoints:['src/turnoverBreakdown.ts','src/utils.ts','src/funding.ts'],bundle:true,platform:'node',format:'esm',write:false,outdir:'unused-tests',logLevel:'silent'});
const modules = await Promise.all(compiled.outputFiles.map(f=>import(`data:text/javascript;base64,${Buffer.from(f.contents).toString('base64')}`)));
const {turnoverBreakdown} = modules[0], {computeAccountBalances} = modules[1], {expandFundedSales} = modules[2];
const round = n=>Math.round(n*100)/100;
const account = {id:'main',name:'Основной',type:'MAIN',initialBalance:100000};
const sale = (flag=true) => ({id:'sale',accountId:'main',customerId:'client',productName:'Телевизор',type:'INSTALLMENT',status:'COMPLETED',startDate:'2026-01-01',buyPrice:100000,totalAmount:120000,downPayment:0,remainingAmount:0,paymentPlan:[...Array.from({length:6},(_,i)=>({id:`p${i}`,amount:10000,date:'2026-02-01',isPaid:true,isRealPayment:true})),{id:'last',amount:54000,discountAmount:6000,discountFromProfit:flag,date:'2026-07-01',isPaid:true,isRealPayment:true}]});
const purchase = {id:'exp_sale_sale',accountId:'main',amount:100000,title:'Закуп: Телевизор',category:'Закуп',date:'2026-01-01'};
const calculate = (overrides={}) => {
  const input={accounts:[account],accountIds:['main'],sales:[sale()],expenses:[purchase],investors:[],now:Date.parse('2026-11-03T12:00:00Z'),...overrides};
  const result=turnoverBreakdown({...input,accountBalances:overrides.accountBalances || computeAccountBalances(input.accounts,input.sales,input.expenses,input.retailSales || [])});
  assert.equal(round(result.restDetails.entries.reduce((n,e)=>n+e.amount,0)),result.rest,'Строки объясняют весь остаток');
  assert.equal(round(result.restDetails.explained+result.restDetails.difference),result.rest);
  assert.equal(round(result.restDetails.entries.filter(e=>e.review).reduce((n,e)=>n+e.amount,0)),result.restDetails.difference);
  return result;
};
test('скидка из прибыли: прибыль 14000, капитал 100000, ложной разницы 5000 нет',()=>{
  const r=calculate();assert.equal(r.manager.toWithdraw,14000);assert.equal(r.rest,100000);assert.equal(r.restDetails.difference,0);assert(!r.restDetails.entries.some(e=>e.kind==='contract'));
});
test('прежняя скидка сохраняет прежний расчёт и видна в сверке договора',()=>{
  const r=calculate({sales:[sale(false)]});assert.equal(r.manager.toWithdraw,19000);assert.equal(r.rest,95000);assert.equal(r.restDetails.difference,-5000);assert(r.restDetails.entries.find(e=>e.kind==='contract').parts.length>=4);
});
test('обычный расход и изъятие капитала видны, выплата прибыли не списывается дважды',()=>{
  const extra=[{id:'rent',title:'Аренда',amount:2000,accountId:'main',category:'Аренда'},
    {id:'capital',title:'Возврат вложений',amount:3000,accountId:'main',category:'Моя выплата',managerPayoutSource:'CAPITAL'},
    {id:'profit',title:'Прибыль',amount:1000,accountId:'main',category:'Моя выплата',managerPayoutSource:'PROFIT'}];
  const r=calculate({expenses:[purchase,...extra]});assert.equal(r.rest,95000);assert.equal(r.restDetails.difference,0);assert(!r.restDetails.entries.some(e=>e.sourceId==='profit'));
});
test('нет закупа: сумма для проверки, а не автоматически свои вложения',()=>{
  const r=calculate({expenses:[]});assert.equal(r.restDetails.explained,100000);assert.equal(r.restDetails.difference,100000);assert(r.restDetails.entries.find(e=>e.kind==='contract').description.includes('не найден'));
});
test('капитал инвестора, возврат вложений и расходы из прибыли учитываются один раз',()=>{
  const investor={id:'inv',name:'Инвестор',initialAmount:65000,profitPercentage:60,joinedDate:'2025-01-01'};
  const a={...account,type:'INVESTOR',ownerId:'inv'};
  const expenses=[purchase,{id:'return',title:'Возврат',accountId:'main',amount:35000,category:'Выплата инвестору',investorId:'inv',payoutType:'INVESTMENT'},
    {id:'cost',title:'Из прибыли',accountId:'main',amount:1000,category:'Расход',fromProfit:true,date:'2026-08-01'},
    {id:'out',title:'Прибыль инвестору',accountId:'main',amount:500,category:'Выплата инвестору',investorId:'inv',payoutType:'PROFIT'}];
  const r=calculate({accounts:[a],investors:[investor],expenses});assert.equal(r.investorCapital,65000);assert.equal(r.rest,0);assert.equal(r.restDetails.difference,0);assert(!r.restDetails.entries.some(e=>e.sourceId==='cost'||e.sourceId==='out'));
});
test('совместный договор: закуп каждого счёта сопоставляется со своей долей',()=>{
  const a={...account,initialBalance:50000},b={id:'other',name:'Второй',type:'CUSTOM',initialBalance:50000};
  const s={...sale(),funding:[{accountId:'main',amount:50000},{accountId:'other',amount:50000}]};
  const sales=expandFundedSales([s]),expenses=[{...purchase,amount:50000},{...purchase,id:'exp_sale_sale__other',accountId:'other',amount:50000}];
  const r=calculate({accounts:[a,b],accountIds:['main','other'],sales,expenses});assert.equal(r.rest,100000);assert.equal(r.restDetails.difference,0);
  const one=calculate({accounts:[a,b],accountIds:['other'],sales,expenses});assert.equal(one.rest,50000);assert.equal(one.restDetails.difference,0);
});
test('скрытый счёт, плановый платёж и возврат без движения денег не попадают в остаток',()=>{
  const s=sale();s.paymentPlan.push({id:'planned',amount:99999,isPaid:true,isRealPayment:false});
  const hidden={id:'hidden',name:'Архив',type:'CUSTOM',initialBalance:900000,isArchived:true};
  const r=calculate({accounts:[account,hidden],sales:[s],expenses:[purchase,{id:'refund',accountId:'main',amount:99999,isRefund:true}]});assert.equal(r.rest,100000);assert.equal(r.restDetails.difference,0);assert(!r.restDetails.entries.some(e=>e.accountId==='hidden'||e.sourceId==='refund'));
});
test('поступления и наличные продажи показываются по фактическому счёту',()=>{
  const income={id:'income',accountId:'main',customerId:'system_income',productName:'Пополнение',type:'CASH',downPayment:7000,paymentPlan:[],remainingAmount:0};
  const retail=[{id:'r',accountId:'main',total:5000,items:[],payments:[]},{id:'credit',accountId:'other',isCredit:true,total:9000,items:[],payments:[{id:'pm',accountId:'main',amount:2000,date:'2026-11-01'}]},
    {id:'return',accountId:'main',returnOf:'r',total:-1000,refund:1000,items:[]},{id:'cancel',accountId:'main',isCancelled:true,total:90000,items:[]}];
  const r=calculate({sales:[sale(),income],retailSales:retail});assert.equal(r.rest,113000);assert.equal(r.restDetails.difference,0);assert.equal(r.restDetails.entries.filter(e=>e.kind==='retail').reduce((n,e)=>n+e.amount,0),6000);
});
test('расхождение переданного баланса с операциями отмечается для проверки',()=>{
  const r=calculate({accountBalances:{main:114500}});assert.equal(r.restDetails.difference,500);assert(r.restDetails.entries.some(e=>e.kind==='balance'&&e.review));
});
test('проверка нужна и когда несопоставленные суммы взаимно компенсировались',()=>{
  const r=calculate({expenses:[],accountBalances:{main:114000}});assert.equal(r.rest,100000);assert.equal(r.restDetails.difference,0);assert.equal(r.restDetails.entries.filter(e=>e.review).length,2);
});
test('первый взнос и режим прибыли только с платежей не меняют возврат капитала',()=>{
  const s={...sale(),status:'ACTIVE',downPayment:20000,remainingAmount:100000,paymentPlan:[]};
  for (const profitFromPaymentsOnly of [false,true]) {
    const r=calculate({sales:[s],profitFromPaymentsOnly});assert.equal(round(r.manager.toWithdraw+r.manager.expected),20000);assert.equal(r.rest,100000);assert.equal(r.restDetails.difference,0);
  }
});
test('закуп сопоставляется по полному идентификатору импортированного договора',()=>{
  const s={...sale(),id:'imported__sale'};
  const r=calculate({sales:[s],expenses:[{...purchase,id:'exp_sale_imported__sale'}]});assert.equal(r.restDetails.difference,0);
});
test('свои вложения инвестора-владельца не вычитаются как внешний капитал',()=>{
  const owner={id:'owner',name:'Владелец',initialAmount:100000,profitPercentage:100,joinedDate:'2025-01-01',isOwner:true};
  const r=calculate({accounts:[{...account,type:'INVESTOR',ownerId:'owner'}],investors:[owner]});assert.equal(r.investorCapital,0);assert.equal(r.rest,100000);assert.equal(r.restDetails.difference,0);
});
test('склад и поставщик объясняются как отдельный источник закупа, без ложной ошибки',()=>{
  for(const source of [{productId:'product'},{supplierId:'supplier'}]) {
    const r=calculate({sales:[{...sale(),...source}],expenses:[]});assert.equal(r.restDetails.difference,0);assert(r.restDetails.entries.some(e=>e.kind==='contract'&&!e.review));
  }
});
