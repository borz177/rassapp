import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['src/turnoverRestInsights.ts','src/turnoverBreakdown.ts','src/utils.ts'],bundle:true,platform:'node',format:'esm',write:false,outdir:'unused-tests',logLevel:'silent'});
const [I,T,U]=await Promise.all(bundle.outputFiles.map(f=>import(`data:text/javascript;base64,${Buffer.from(f.contents).toString('base64')}`)));
const round=n=>Math.round(n*100)/100;
const main={id:'main',name:'Основной',type:'MAIN'},pool={id:'pool',name:'Общая касса',type:'POOL',poolMemberIds:['inv']},personal={id:'personal',name:'Счёт инвестора',type:'INVESTOR',ownerId:'inv'};
const entry=(id,kind,amount,extra={})=>({id,kind,amount,title:id,description:'',review:false,...extra});
const deposit=(extra={})=>({id:'deposit',accountId:'personal',customerId:'system_deposit_inv',type:'CASH',productName:'Внесение инвестора',downPayment:800000,remainingAmount:0,paymentPlan:[],startDate:'2026-01-01',...extra});
const insights=(entries,extra={})=>{
 const input={entries,accounts:[main,pool,personal],accountIds:['pool'],sales:[deposit()],...extra};
 const before=JSON.stringify(input),r=I.turnoverRestInsights(input);assert.equal(JSON.stringify(input),before,'Диагностика не меняет исходные записи');
 assert.equal(round(r.increased+r.decreased),r.total);
 assert.equal(round(r.causes.reduce((n,c)=>n+c.amount,0)),r.total);
 const ids=r.causes.flatMap(c=>c.entryIds);assert.deepEqual([...ids].sort(),entries.map(e=>e.id).sort());assert.equal(new Set(ids).size,entries.length,'Каждая запись принадлежит одной причине');
 return r;
};
test('подтверждённые расходы отделены от капитала: причины локального минуса −397000,01',()=>{
 const entries=[entry('capital:inv','capital',-800000,{sourceId:'inv',sourceType:'investor'}),...Array.from({length:6},(_,i)=>entry('contract:'+i,'contract',[58000,50000,70000,90000,65000,70000][i],{review:true})),entry('rounding','rounding',-.01)];
 const r=insights(entries);assert.equal(r.total,-397000.01);assert.equal(r.increased,403000);assert.equal(r.decreased,-800000.01);
 assert.equal(r.reviewAmount,403000);assert.equal(r.reviewCount,6);
 assert(!r.causes.some(c=>c.section==='operations'));assert.equal(r.causes.find(c=>c.id==='capital').section,'calculation');
 assert.equal(r.causes.find(c=>c.id==='contracts').amount,403000);
 const evidence=r.capitalEvidence.inv;assert.equal(evidence.accounts.length,2);assert.equal(evidence.deposits[0].accountName,'Счёт инвестора');assert.equal(evidence.deposits[0].selected,false);
});
test('расходы −86300 — реальные уменьшающие строки, плюс договора +58000 их не заменяет',()=>{
 const entries=[...[-35000,-35000,-12000,-2500,-1800].map((n,i)=>entry('expense:'+i,'expense',n)),entry('dyson','contract',58000,{review:true})];
 const r=insights(entries);assert.equal(r.causes.find(c=>c.id==='expenses').amount,-86300);assert.equal(r.total,-28300);
 assert.equal(r.causes.find(c=>c.id==='expenses').section,'operations');assert.equal(r.reviewIncreased,58000);assert.equal(r.reviewDecreased,0);
});
test('нулевая разница сверки не скрывает взаимно компенсировавшиеся проблемы',()=>{
 const r=insights([entry('missing','contract',100000,{review:true}),entry('mismatch','balance',-100000,{review:true})]);
 assert.equal(r.reviewAmount,0);assert.equal(r.reviewCount,2);assert.equal(r.reviewIncreased,100000);assert.equal(r.reviewDecreased,-100000);assert.equal(r.causes.filter(c=>c.section==='review').length,2);
 const same=insights([entry('a','contract',100,{review:true}),entry('b','contract',-100,{review:true})]);assert.equal(same.causes.length,1);assert.equal(same.causes[0].amount,0);assert.equal(same.causes[0].entryIds.length,2);
});
test('пополнения и возвраты магазина показаны отдельно, даже если их итог нулевой',()=>{
 const r=insights([entry('check','retail',5980),entry('refund','retail',-5980),entry('own','income',10000)]);
 assert.equal(r.total,10000);assert.equal(r.causes.find(c=>c.id==='retailOut').amount,-5980);assert.equal(r.causes.find(c=>c.id==='retailIn').amount,5980);
});
test('совпадение суммы, названия или начало чужого id не доказывают внесение инвестора',()=>{
 const c=entry('capital:inv','capital',-800000,{sourceId:'inv'});
 const r=insights([c],{sales:[deposit({customerId:'system_income'}),deposit({id:'other',customerId:'system_deposit_inv2'}),deposit({id:'client',customerId:'client',productName:'Внесение инвестора'})]});
 assert.equal(r.capitalEvidence.inv.deposits.length,0);
});
test('одна запись внесения учитывается один раз; архивные и другие счета не добавляются к итогу',()=>{
 const d=deposit(),c=entry('capital:inv','capital',-800000,{sourceId:'inv'});
 const r=insights([c],{sales:[d,{...d},deposit({id:'archived-deposit',accountId:'archive',downPayment:100})],accounts:[pool,personal,{id:'archive',name:'Архив',type:'CUSTOM',isArchived:true}]});
 assert.equal(r.total,-800000);assert.equal(r.capitalEvidence.inv.deposits.length,2);assert(r.capitalEvidence.inv.deposits.every(d=>!d.selected));
 const selected=insights([c],{accountIds:['pool','personal']});assert(selected.capitalEvidence.inv.deposits[0].selected);assert.equal(selected.capitalEvidence.inv.accounts.filter(a=>a.selected).length,2);
});
test('два счёта и капитал одного инвестора: диагностика не распределяет и не удваивает капитал',()=>{
 const investor={id:'inv',name:'Инвестор',initialAmount:800000,profitPercentage:60,joinedDate:'2025-01-01'};
 const input={accounts:[pool,personal],accountIds:['pool','personal'],sales:[deposit()],expenses:[],investors:[investor],now:Date.parse('2026-11-06T12:00:00Z')};
 const data=T.turnoverBreakdown({...input,accountBalances:U.computeAccountBalances(input.accounts,input.sales,[])}),snapshot=JSON.stringify(data);
 const r=insights(data.restDetails.entries,input);assert.equal(data.investorCapital,800000);assert.equal(r.total,0);assert.equal(r.causes.find(c=>c.id==='capital').amount,-800000);assert.equal(JSON.stringify(data),snapshot);
});
test('настоящая выплата прибыли, учтённая в кассе, не становится причиной отрицательного остатка',()=>{
 const account={...main,initialBalance:100000};
 const sale={id:'s',customerId:'client',accountId:'main',type:'INSTALLMENT',status:'COMPLETED',productName:'Товар',buyPrice:100000,totalAmount:120000,downPayment:0,remainingAmount:0,startDate:'2026-01-01',paymentPlan:[{id:'p',date:'2026-02-01',amount:120000,isPaid:true,isRealPayment:true}]};
 const expenses=[{id:'exp_sale_s',accountId:'main',amount:100000,category:'Закуп'},{id:'profit',accountId:'main',amount:5000,category:'Моя выплата',managerPayoutSource:'PROFIT'}];
 const input={accounts:[account],accountIds:['main'],sales:[sale],expenses,investors:[]};
 const data=T.turnoverBreakdown({...input,accountBalances:U.computeAccountBalances(input.accounts,input.sales,expenses)});
 const r=insights(data.restDetails.entries,input);assert.equal(r.total,100000);assert(!r.causes.some(c=>c.id==='expenses'));
});
test('нулевой и положительный остаток: суммы и непроверенные причины сохраняются',()=>{
 assert.equal(insights([]).total,0);
 const r=insights([entry('initial','initial',10000),entry('cost','expense',-1000),entry('external','contract',500,{review:false})]);assert.equal(r.total,9500);assert.equal(r.reviewCount,0);assert.equal(r.causes.find(c=>c.id==='external').section,'calculation');
});
