import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import * as P from '../shared/profit.js';

const compiled=await build({entryPoints:['src/cashProfitLedger.ts'],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const L=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`);
const end=Date.parse('2026-12-01T00:00:00+03:00');
const period={start:'2026-11-01',end:'2026-11-30'};
function fixture(){
 const investors=[{id:'a',name:'Первый',initialAmount:100000,profitPercentage:100,joinedDate:'2026-01-01'},
  {id:'b',name:'Второй',initialAmount:100000,profitPercentage:40,joinedDate:'2026-01-01'}];
 const terms={date:'2026-11-01T00:00:00+03:00',members:{a:{rate:100,disposition:'PAYABLE'},b:{rate:40,disposition:'PAYABLE'}},managerShareSplit:[]};
 const account={id:'pool',name:'Пул',type:'POOL',poolMemberIds:['a','b'],poolAccounting:{version:1,startMonth:'2026-11',openingTerms:terms,terms:[terms],closed:[],excludedSaleIds:[],reinvestments:[]}};
 const sales=[{id:'sale',accountId:'pool',customerId:'client',productName:'Товар',type:'INSTALLMENT',status:'ACTIVE',buyPrice:100000,totalAmount:200000,remainingAmount:0,downPayment:0,startDate:'2026-11-01',paymentPlan:[{id:'paid',amount:200000,date:'2026-11-20',isPaid:true,isRealPayment:true}]}];
 return {account,accounts:[account],investors,sales,expenses:[],customers:[],period};
}
function atEnd(fn){const original=Date.now;Date.now=()=>end-1;try{return fn()}finally{Date.now=original}}
const received=(r,id)=>r.managerAccrualsByInvestor.get(id)?.received||0;

test('100% инвестору: управление с его капитала равно нулю; общие выплаты не приписываются участникам',()=>atEnd(()=>{
 const f=fixture();f.expenses=[{id:'paid-self',accountId:'pool',category:'Моя выплата',amount:10000,date:'2026-11-25',managerPayoutSource:'PROFIT'}];
 const original=JSON.stringify(f),r=L.cashProfitLedgers(f);
 assert.equal(r.manager.received,30000);assert.equal(r.manager.paid,10000);
 assert.equal(received(r,'a'),0);assert.equal(received(r,'b'),30000);
 assert.equal(r.managerAccrualsByInvestor.get('b').paid,0);
 assert.equal(r.managerAccrualsByInvestor.get('b').pending,30000);
 assert.equal(r.manager.available,20000);assert.equal(JSON.stringify(f),original);
 const expected=P.expectedManagerOriginShares(f.account,f.investors,f.sales[0]);
 assert.equal(expected.find(s=>s.investor.id==='a').percentage,0);
 assert.equal(expected.find(s=>s.investor.id==='b').percentage,30);
}));
test('общий расход делится на дату операции, прошлый убыток уменьшает начисления',()=>atEnd(()=>{
 const f=fixture();f.investors[0].profitPercentage=80;f.account.poolAccounting.terms[0].members.a.rate=80;
 f.investors[1].joinedDate='2026-11-16T00:00:00+03:00';
 f.account.poolAccounting.startMonth='2026-10';
 f.account.poolAccounting.openingTerms.date='2026-10-01T00:00:00+03:00';
 f.expenses=[{id:'rent',accountId:'pool',date:'2026-11-20',amount:10000,fromProfit:true,profitSource:'SHARED',category:'Аренда'}];
 f.account.poolAccounting.adjustments=[{id:'loss',date:'2026-10-31',amount:-5000,reason:'Убыток'}];
 const r=L.cashProfitLedgers(f);
 assert.equal(r.manager.received,34000);
 assert.equal(received(r,'a'),8500);assert.equal(received(r,'b'),25500);
 assert.equal(Math.round((received(r,'a')+received(r,'b'))*100),Math.round(r.manager.received*100));
}));
test('бонус за управление не делает капитал получателя источником чужой управленческой прибыли',()=>atEnd(()=>{
 const f=fixture();f.account.poolAccounting.terms[0].managerShareSplit=[{investorId:'a',percent:50}];
 const r=L.cashProfitLedgers(f);
 assert.equal(r.investors.get('a').received,65000);assert.equal(r.manager.received,15000);
 assert.equal(received(r,'a'),0);assert.equal(received(r,'b'),15000);
}));
test('закрытый месяц: источник управления не меняется от текущего капитала и будущих ставок',()=>atEnd(()=>{
 const f=fixture();const report=P.poolMonthlyReport(f.account,f.investors,f.sales,[], '2026-11',end);
 f.account.poolAccounting.closed=[{...report,status:'CLOSED'}];
 f.investors[0].initialAmount=90000000;f.investors[1].profitPercentage=99;
 f.account.poolAccounting.terms.push({date:'2026-12-01T00:00:00+03:00',members:{b:{rate:99,disposition:'PAYABLE'}}});
 const before=JSON.stringify(f.account.poolAccounting.closed),r=L.cashProfitLedgers(f);
 assert.equal(received(r,'a'),0);assert.equal(received(r,'b'),30000);
 assert.equal(r.managerAccrualsByInvestor.get('b').pending,0);assert.equal(r.manager.available,30000);
 assert.equal(JSON.stringify(f.account.poolAccounting.closed),before);
}));
test('старый сохранённый снимок без базовых долей читается по условиям его месяца',()=>atEnd(()=>{
 const f=fixture();f.account.poolAccounting.terms[0].managerShareSplit=[{investorId:'a',percent:50}];
 const report=P.poolMonthlyReport(f.account,f.investors,f.sales,[], '2026-11',end);
 for(const share of report.shares)delete share.basePercentage;
 f.account.poolAccounting.closed=[{...report,status:'CLOSED'}];
 f.investors[0].initialAmount=90000000;f.investors[1].profitPercentage=99;
 const r=L.cashProfitLedgers(f);assert.equal(received(r,'a'),0);assert.equal(received(r,'b'),15000);
}));
test('старый пул: периоды заработка сохраняются, сумма управленческих источников сходится',()=>atEnd(()=>{
 const f=fixture();delete f.account.poolAccounting;
 f.investors[1].joinedDate='2026-11-16T00:00:00+03:00';
 const r=L.cashProfitLedgers(f);assert.equal(received(r,'a'),0);
 assert.equal(received(r,'b'),r.manager.received);
 const expected=P.expectedManagerOriginShares(f.account,f.investors,f.sales[0]);
 assert(Math.abs(expected.reduce((n,x)=>n+x.percentage,0)-P.expectedManagerPercent(f.account,f.investors,f.sales[0]))<1e-8);
}));
test('личные исторические договоры не приписываются капиталу выбранного инвестора',()=>atEnd(()=>{
 const f=fixture();f.account.poolAccounting.excludedSaleIds=['sale'];
 const r=L.cashProfitLedgers(f);assert.equal(r.manager.received,100000);
 assert.equal(received(r,'a'),0);assert.equal(received(r,'b'),0);
 assert.deepEqual(P.expectedManagerOriginShares(f.account,f.investors,f.sales[0]),[]);
}));
test('обычный отдельный счёт сохраняет начисления, выплаты и доступный остаток',()=>atEnd(()=>{
 const f=fixture();f.account={id:'pool',type:'INVESTOR',ownerId:'b'};f.accounts=[f.account];
 const r=L.cashProfitLedgers(f);assert.equal(r.manager.received,60000);assert.equal(r.investors.get('b').received,40000);
 assert.equal(r.manager.available,60000);assert.equal(r.managerAccrualsByInvestor.size,0);
}));
test('дробные копейки не удваиваются при разбиении управленческой прибыли на источники',()=>atEnd(()=>{
 const f=fixture();delete f.account.poolAccounting;for(const i of f.investors)i.profitPercentage=50;
 f.sales=[{...f.sales[0],buyPrice:0.02,totalAmount:0.04,paymentPlan:[{...f.sales[0].paymentPlan[0],amount:0.04}]}];
 const r=L.cashProfitLedgers(f);assert.equal(r.manager.received,0.01);
 assert.equal(received(r,'a')+received(r,'b'),0.01);
}));
