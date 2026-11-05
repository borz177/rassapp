import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle=await build({entryPoints:['src/expensePreview.ts','src/utils.ts','src/turnoverBreakdown.ts'],bundle:true,platform:'node',format:'esm',write:false,outdir:'unused-tests',logLevel:'silent'});
const [P,U,T]=await Promise.all(bundle.outputFiles.map(f=>import(`data:text/javascript;base64,${Buffer.from(f.contents).toString('base64')}`)));
const account={id:'pool',userId:'owner',name:'Общая касса',type:'POOL',poolMemberIds:['inv'],initialBalance:100000};
const investor={id:'inv',name:'Инвестор',initialAmount:100000,profitPercentage:60,joinedDate:'2025-01-01'};
const sale={id:'sale',customerId:'customer',accountId:'pool',productName:'Товар',type:'INSTALLMENT',status:'COMPLETED',buyPrice:100000,totalAmount:120000,remainingAmount:0,downPayment:0,startDate:'2026-01-01',paymentPlan:[{id:'pay',amount:120000,date:'2026-07-01',isPaid:true,isRealPayment:true}]};
const purchase={id:'exp_sale_sale',accountId:'pool',userId:'owner',amount:100000,category:'Закуп',title:'Закуп',date:'2026-01-01'};
const expense=(extra={})=>({id:'new',userId:'owner',accountId:'pool',amount:5000,title:'Аренда',category:'Rent',date:'2026-11-03T12:00:00Z',fromProfit:true,profitSource:'SHARED',...extra});
const setup=(extra={})=>({accounts:[account],investors:[investor],sales:[sale],expenses:[purchase],now:Date.parse('2026-11-03T15:00:00Z'),...extra});
const rrow=(r,key)=>r.rows.find(r=>r.key===key);
const share=(r,key)=>r.shares.find(r=>r.key===key);
const preview=(e,extra={})=>{
  const input={...setup(extra),expense:e}, untouched=JSON.stringify(input),r=P.expensePreview(input);
  assert.equal(JSON.stringify(input),untouched,'Прогноз не изменяет исходные записи');
  if(!r.errors.length){
    // Имитируем реальное сохранение App: расход + датированное изменение капитала.
    const actualExpense=JSON.parse(JSON.stringify({...e,id:'saved-id'}));
    const actualExpenses=[...input.expenses,actualExpense];
    const actualInvestors=input.investors.map(i=>e.payoutType==='INVESTMENT'&&i.id===e.investorId?U.applyCapitalChange(i,-e.amount,e.date,actualExpense.id):i);
    const cash=U.computeAccountBalances(input.accounts,input.sales,actualExpenses,input.retailSales||[]);
    const actual=T.turnoverBreakdown({...input,investors:actualInvestors,expenses:actualExpenses,accountBalances:cash,accountIds:[e.accountId]});
    assert.equal(rrow(r,'cash').after,actual.cash,'Баланс после записи равен прогнозу');
    const row=rrow(r,'profit')||rrow(r,'manager');
    if(row)assert.equal(row.after,row.key==='manager'?actual.manager.toWithdraw:Math.round((actual.manager.toWithdraw+actual.investors.toPay)*100)/100);
    for(const p of r.shares)assert.equal(p.after,p.key==='manager'?actual.manager.toWithdraw:actual.perInvestor.find(i=>i.id===p.key)?.toPay||0);
  }
  return r;
};
test('общий расход 5000: касса −5000, прибыль 20000→15000, доли 40/60, капитал прежний',()=>{
  const r=preview(expense());assert.deepEqual(rrow(r,'cash'),{key:'cash',label:'На счёте',before:120000,after:115000});
  assert.equal(rrow(r,'profit').before,20000);assert.equal(rrow(r,'profit').after,15000);
  assert.equal(share(r,'manager').after,6000);assert.equal(share(r,'inv').after,9000);assert.equal(rrow(r,'capital').after,100000);assert(!r.warnings.length);
});
test('за мой счёт: прибыль менеджера 8000→3000, инвестору не списывается',()=>{
  const r=preview(expense({profitSource:'MANAGER'}));assert.equal(rrow(r,'manager').before,8000);assert.equal(rrow(r,'manager').after,3000);assert(!share(r,'inv'));assert.equal(rrow(r,'capital').after,100000);
});
test('при нехватке моей прибыли получается минус, капитал не списывается',()=>{
  const paid={id:'paid',accountId:'pool',category:'Моя выплата',managerPayoutSource:'PROFIT',amount:7000,date:'2026-10-01'};
  const r=preview(expense({profitSource:'MANAGER'}),{expenses:[purchase,paid]});assert.equal(rrow(r,'manager').before,1000);assert.equal(rrow(r,'manager').after,-4000);assert(r.warnings.includes('Прибыль уйдёт в минус.'));assert.equal(rrow(r,'capital').after,100000);
});
test('предупреждение учитывает каждую долю, даже когда суммарной прибыли хватает',()=>{
  const paid={id:'paid',accountId:'pool',category:'Моя выплата',managerPayoutSource:'PROFIT',amount:7000,date:'2026-10-01'};
  const r=preview(expense(),{expenses:[purchase,paid]});assert.equal(rrow(r,'profit').before,13000);assert.equal(rrow(r,'profit').after,8000);assert.equal(share(r,'manager').after,-1000);assert(r.warnings.length);
});
test('нет денег и прибыли: два предупреждения, чужие вложения не меняются',()=>{
  const r=preview(expense(),{accounts:[{...account,initialBalance:0}],sales:[],expenses:[]});assert.equal(rrow(r,'cash').after,-5000);assert.equal(rrow(r,'capital').after,100000);assert.equal(r.warnings.length,2);
});
test('выплата прибыли инвестору меняет только его прибыль',()=>{
  const r=preview(expense({fromProfit:undefined,profitSource:undefined,investorId:'inv',payoutType:'PROFIT',category:'Выплата инвестора'}));assert.equal(rrow(r,'inv').before,12000);assert.equal(rrow(r,'inv').after,7000);assert.equal(rrow(r,'capital').after,100000);assert(!share(r,'manager'));
});
test('возврат инвестиций 20000: капитал 100000→80000, прибыль не расходуется',()=>{
  const r=preview(expense({amount:20000,fromProfit:undefined,profitSource:undefined,investorId:'inv',payoutType:'INVESTMENT',category:'Выплата инвестора'}));assert.equal(rrow(r,'cash').after,100000);assert.equal(rrow(r,'capital').before,100000);assert.equal(rrow(r,'capital').after,80000);assert.equal(rrow(r,'profit').after,20000);assert(!r.shares.length);
});
test('вернуть больше вклада или вклад не своего счёта нельзя',()=>{
  const base=expense({fromProfit:undefined,profitSource:undefined,investorId:'inv',payoutType:'INVESTMENT'});
  assert(preview({...base,amount:100001}).errors.includes('Сумма больше вложенного капитала.'));
  assert(preview(base,{accounts:[{...account,poolMemberIds:[]}]}).errors.includes('Инвестор не связан с этим счётом.'));
});
test('свои вложения и своя прибыль — разные выплаты',()=>{
  const extra={accounts:[{...account,type:'MAIN',poolMemberIds:undefined}],investors:[]};
  const capital=preview(expense({amount:20000,category:'Моя выплата',managerPayoutSource:'CAPITAL',fromProfit:undefined,profitSource:undefined}),extra);
  assert.equal(rrow(capital,'capital').after,80000);assert.equal(rrow(capital,'profit').after,20000);
  const profit=preview(expense({category:'Моя выплата',managerPayoutSource:'PROFIT',fromProfit:undefined,profitSource:undefined}),extra);
  assert.equal(rrow(profit,'capital').after,100000);assert.equal(rrow(profit,'manager').after,15000);
  assert(preview(expense({amount:100001,category:'Моя выплата',managerPayoutSource:'CAPITAL',fromProfit:undefined}),extra).errors.length);
});
test('из общего пула нельзя оформить возврат собственных вложений',()=>{
  const r=preview(expense({category:'Моя выплата',managerPayoutSource:'CAPITAL',fromProfit:undefined}));assert(r.errors.includes('С этого счёта нельзя возвращать ваши вложения.'));
});
test('оплата поставщику не превращается в расход из прибыли',()=>{
  const r=preview(expense({category:'Оплата партнёру',fromProfit:undefined,profitSource:undefined,supplierId:'supplier'}));assert.equal(rrow(r,'cash').after,115000);assert.equal(rrow(r,'profit').after,20000);assert.equal(rrow(r,'capital').after,100000);
});
test('датированный возврат доли в пуле: прогноз совпадает с пересчётом после записи',()=>{
  const invs=[{...investor,initialAmount:60000,profitPercentage:50},{id:'b',name:'Б',initialAmount:40000,profitPercentage:50,joinedDate:'2025-01-01'}];
  const r=preview(expense({amount:20000,date:'2026-06-01T12:00:00Z',fromProfit:undefined,profitSource:undefined,investorId:'inv',payoutType:'INVESTMENT'}),{accounts:[{...account,poolMemberIds:['inv','b']}],investors:invs});
  assert.equal(share(r,'inv').before,6000);assert.equal(share(r,'inv').after,5000);assert.equal(share(r,'b').before,4000);assert.equal(share(r,'b').after,5000);
});
test('скидка из прибыли учитывается до расхода; старые расходы не изменяются',()=>{
  const discounted={...sale,paymentPlan:[{id:'p',amount:114000,discountAmount:6000,discountFromProfit:true,date:'2026-07-01',isPaid:true}]};
  const old={id:'legacy',amount:2000,accountId:'pool',category:'Rent',date:'2026-08-01'};
  const r=preview(expense(),{sales:[discounted],expenses:[purchase,old]});assert.equal(rrow(r,'profit').before,14000);assert.equal(rrow(r,'profit').after,9000);assert.equal(old.fromProfit,undefined);
});
test('первый взнос без прибыли, наличные продажи и копейки совпадают с кассой',()=>{
  const s={...sale,downPayment:20000,paymentPlan:[{id:'p',amount:100000,date:'2026-07-01',isPaid:true}]};
  const r=preview(expense({amount:5000.25}),{sales:[s],profitFromPaymentsOnly:true,retailSales:[{id:'r',accountId:'pool',total:3000,items:[]}]});
  assert.equal(rrow(r,'cash').before,123000);assert.equal(rrow(r,'cash').after,117999.75);assert.equal(rrow(r,'profit').after,14999.75);
});
test('некорректные сумма и дата отклоняются без NaN в расчёте',()=>{
  for(const amount of [0,-1,NaN,Infinity])assert(P.expensePreview({...setup(),expense:expense({amount})}).errors.length);
  assert(P.expensePreview({...setup(),expense:expense({date:'bad'})}).errors.length);
});
test('настройка категории изолирована по пользователю и счёту',()=>{
  assert.notEqual(P.expenseChoiceKey('a','pool','Rent'),P.expenseChoiceKey('b','pool','Rent'));
  assert.notEqual(P.expenseChoiceKey('a','pool','Rent'),P.expenseChoiceKey('a','other','Rent'));
  assert.equal(P.expenseChoiceKey(undefined,'pool','Rent'),null);
});
