import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const compiled=await build({entryPoints:['src/cashProfitLedger.ts','src/turnoverBreakdown.ts'],bundle:true,platform:'node',format:'esm',write:false,outdir:'unused-tests',logLevel:'silent'});
const [L,T]=await Promise.all(compiled.outputFiles.map(f=>import(`data:text/javascript;base64,${Buffer.from(f.contents).toString('base64')}`)));
const account={id:'pool',name:'Общая касса',type:'POOL',poolMemberIds:['inv']};
const investor={id:'inv',name:'Инвестор',initialAmount:100000,profitPercentage:60,joinedDate:'2025-01-01'};
const period={start:'2026-01-01',end:'2026-12-31'};
const customer={id:'client',name:'Клиент'};
const payment={id:'pay',amount:115000,date:'2026-11-05T12:00:00Z',isPaid:true,isRealPayment:true,discountAmount:5000,discountFromProfit:true};
const sale={id:'sale',customerId:'client',accountId:'pool',productName:'Товар',status:'COMPLETED',type:'INSTALLMENT',buyPrice:100000,totalAmount:120000,remainingAmount:0,downPayment:0,startDate:'2026-01-01',paymentPlan:[payment]};
const expense=(id,extra)=>({id,accountId:'pool',date:'2026-11-05T12:30:00Z',amount:1000,category:'Rent',title:id,...extra});
const setup=extra=>({accounts:[account],investors:[investor],customers:[customer],sales:[sale],expenses:[],period,...extra});
const check=l=>assert.equal(l.available,Math.round((l.received-l.paid-l.other-l.discountsDeducted)*100)/100);

test('скидка при погашении: доли 40/60, получено уже уменьшено, повторного расхода нет',()=>{
 const input=setup(),before=JSON.stringify(input),r=L.cashProfitLedgers(input),m=r.manager,i=r.investors.get('inv');
 assert.equal(JSON.stringify(input),before);assert.equal(m.received,6000);assert.equal(i.received,9000);
 assert.equal(m.embeddedDiscounts,2000);assert.equal(i.embeddedDiscounts,3000);
 assert.equal(m.deducted,0);assert.equal(m.available,6000);assert.equal(i.available,9000);
 assert.equal(m.expenses[0].fullAmount,5000);assert(m.expenses[0].includedInAccruals);check(m);check(i);
});
test('карточка выплачено: только выплаты; расходы и отдельные скидки уменьшают доступно',()=>{
 const expenses=[expense('my',{category:'Моя выплата',managerPayoutSource:'PROFIT',amount:2000}),
 expense('investor',{payoutType:'PROFIT',investorId:'inv',amount:3000}),expense('shared',{fromProfit:true,profitSource:'SHARED'}),
 expense('personal',{fromProfit:true,profitSource:'MANAGER',amount:500}),expense('discount',{category:'Скидка клиенту',fromProfit:true,customerId:'client',saleId:'sale'}),
 expense('capital',{category:'Моя выплата',managerPayoutSource:'CAPITAL',amount:10000}),expense('inv-capital',{payoutType:'INVESTMENT',investorId:'inv',amount:10000})];
 const r=L.cashProfitLedgers(setup({expenses})),m=r.manager,i=r.investors.get('inv');
 assert.equal(m.paid,2000);assert.equal(m.other,900);assert.equal(m.discountsDeducted,400);assert.equal(m.available,2700);
 assert.equal(i.paid,3000);assert.equal(i.other,600);assert.equal(i.discountsDeducted,600);assert.equal(i.available,4800);
 assert.deepEqual(m.expenses.filter(e=>e.kind==='payout').map(e=>e.title),['my']);
 assert.equal(m.expenses.filter(e=>e.kind==='discount').length,2);check(m);check(i);
});
test('доступно совпадает с прежним расчётом оборота, выплаты отделены от списаний',()=>{
 const input=setup({expenses:[expense('paid',{category:'Моя выплата',amount:1000}),expense('rent',{fromProfit:true,profitSource:'SHARED'})]});
 const r=L.cashProfitLedgers(input),t=T.turnoverBreakdown({...input,accountIds:['pool'],accountBalances:{pool:0}});
 assert.equal(r.manager.available,t.manager.toWithdraw);assert.equal(r.investors.get('inv').available,t.investors.toPay);
 assert.equal(r.manager.paid,1000);assert.equal(r.manager.deducted,1400);
});
test('устаревший fromProfit у адресной выплаты не создаёт второе списание',()=>{
 const r=L.cashProfitLedgers(setup({expenses:[expense('legacy',{investorId:'inv',payoutType:'PROFIT',fromProfit:true,amount:1000})]}));
 assert.equal(r.manager.deducted,0);assert.equal(r.investors.get('inv').paid,1000);assert.equal(r.investors.get('inv').deducted,1000);
});
test('скидка с нулевой оплатой не теряется и может отменить ранее начисленную прибыль',()=>{
 const s={...sale,paymentPlan:[{...payment,id:'first',amount:100000,discountAmount:0,date:'2026-10-05T12:00:00Z'},
  {...payment,id:'last',amount:0,discountAmount:20000}]};
 const r=L.cashProfitLedgers(setup({sales:[s]}));assert.equal(r.manager.received,0);assert.equal(r.investors.get('inv').received,0);
 assert.equal(r.manager.accruals.length,2);assert(r.manager.accruals.some(a=>a.amount<0));assert.equal(r.manager.expenses.length,1);
});
test('старая скидка сохраняет прежний учёт; неподтверждённые строки графика исключены',()=>{
 const s={...sale,paymentPlan:[{...payment,discountFromProfit:undefined},{...payment,id:'plan',amount:120000,isRealPayment:false}]};
 const m=L.cashProfitLedgers(setup({sales:[s]})).manager;assert.equal(m.received,7666.67);assert.equal(m.expenses[0].fullAmount,5000);assert.equal(m.expenses[0].includedInAccruals,true);check(m);
});
test('выбор счёта и инвестора, объединение сумм, уникальные строки совместного договора',()=>{
 const other={id:'own',name:'Мой счёт',type:'MAIN'};
 const shared={...sale,accountId:'own'};
 const r=L.cashProfitLedgers(setup({accounts:[account,other],sales:[sale,shared]}));
 assert.equal(r.manager.accruals.length,2);assert.equal(new Set(r.manager.accruals.map(a=>a.id)).size,2);
 const only=L.cashProfitLedgers(setup({accounts:[account,other],sales:[sale,shared],accountId:'own'}));assert.equal(only.manager.received,15000);assert.equal(only.investors.size,0);
 assert.equal(L.combineCashProfitLedgers([...r.investors.values()]).received,9000);
});
test('в режиме прибыли только с платежей первый взнос не создаёт начисление',()=>{
 const s={...sale,downPayment:20000,paymentPlan:[{...payment,amount:95000}]};
 const m=L.cashProfitLedgers(setup({sales:[s],profitFromPaymentsOnly:true})).manager;
 assert.equal(m.received,6000);assert.equal(m.accruals.length,1);assert(!m.accruals[0].isDownPayment);
});
test('местный день включает ночную оплату, последний момент дня и переход зимнего времени',()=>{
 const old=process.env.TZ;
 try{
  process.env.TZ='Europe/Moscow';const day={start:'2026-11-05',end:'2026-11-05'};
  assert(L.inProfitPeriod('2026-11-04T21:16:39.246Z',day));assert(!L.inProfitPeriod('2026-11-04T20:59:59Z',day));
  assert(L.inProfitPeriod('2026-11-05T20:59:59.999Z',day));assert(!L.inProfitPeriod('2026-11-05T21:00:00Z',day));
  const r=L.cashProfitLedgers(setup({period:day,sales:[{...sale,paymentPlan:[{...payment,date:'2026-11-04T21:16:39.246Z'}]}]}));assert.equal(r.manager.received,6000);
  process.env.TZ='America/New_York';const dst={start:'2026-11-01',end:'2026-11-01'};assert(L.inProfitPeriod('2026-11-01T04:10:00Z',dst));assert(L.inProfitPeriod('2026-11-02T04:50:00Z',dst));assert(!L.inProfitPeriod('2026-11-02T05:00:00Z',dst));
 }finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}
});
