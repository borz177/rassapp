import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import * as P from '../shared/profit.js';

const compiled=await build({entryPoints:['src/cashProfitLedger.ts'],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const L=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`);
const now=Date.parse('2026-12-01T00:00:00+03:00');
const cents=rows=>Math.round(rows.reduce((n,r)=>n+r.amount,0)*100);
function fixture(){
  const investors=[{id:'a',name:'Первый',initialAmount:100000,profitPercentage:100,joinedDate:'2026-01-01T00:00:00+03:00'},
    {id:'b',name:'Второй',initialAmount:200000,profitPercentage:40,joinedDate:'2026-11-16T00:00:00+03:00'}];
  const terms={date:'2026-11-01',members:{a:{rate:100},b:{rate:40}},managerShareSplit:[{investorId:'a',percent:20}]};
  const account={id:'pool',name:'Пул',type:'POOL',poolMemberIds:['a','b'],poolAccounting:{version:1,startMonth:'2026-11',openingTerms:terms,terms:[terms],closed:[],excludedSaleIds:[],reinvestments:[]}};
  const sales=[{id:'one',accountId:'pool',customerId:'client',productName:'Телефон',type:'INSTALLMENT',startDate:'2026-10-01',buyPrice:100000,totalAmount:200000,downPayment:0,
    paymentPlan:[{id:'p',amount:200000,date:'2026-11-20',isPaid:true,isRealPayment:true}]}];
  const expenses=[{id:'rent',accountId:'pool',date:'2026-11-18',amount:10000,fromProfit:true,profitSource:'SHARED',title:'Аренда'}];
  const customers=[{id:'client',name:'Тестовый клиент'}];
  return {account,accounts:[account],investors,sales,expenses,customers,period:{start:'2026-11-01',end:'2026-11-30'}};
}
const report=f=>P.poolMonthlyReport(f.account,f.investors,f.sales,f.expenses,'2026-11',now);
const ledger=f=>{const previous=Date.now;Date.now=()=>now-1;try{return L.cashProfitLedgers(f)}finally{Date.now=previous}};

test('расшифровка использует доли на даты оплаты и расхода, включая управление, и сходится с начислением',()=>{
  const f=fixture(),r=report(f),before=JSON.stringify(r);
  for(const a of r.allocations){
    const rows=P.poolAllocationDetails(r,a.id);assert.equal(cents(rows),Math.round(a.amount*100));
    assert.equal(rows.find(x=>x.kind==='income').saleId,'one');assert(rows.find(x=>x.kind==='cost').amount<0);
  }
  assert.equal(P.poolAllocationDetails(r,'a').find(x=>x.kind==='income').amount,41333.33);
  assert.equal(JSON.stringify(r),before);
});
test('покрытие прошлого убытка отражается отдельно и не списывается повторно',()=>{
  const f=fixture();f.account.poolAccounting.closed=[{month:'2026-10',carryOut:5000}];const r=report(f);
  const rows=P.poolAllocationDetails(r,'a');assert.equal(rows.find(x=>x.kind==='carry').amount,-2066.67);
  assert.equal(cents(rows),Math.round(r.allocations.find(x=>x.id==='a').amount*100));
});
test('дробные копейки распределяются стабильно, точная сумма совпадает с начислением',()=>{
  const r={date:'2026-11-30',shares:[{investorId:'a',percentage:100/3}],allocations:[{id:'a',amount:0.01}],sources:[{saleId:'x',paymentId:'p',date:'2026-11-20',amount:0.01},{saleId:'y',paymentId:'p',date:'2026-11-20',amount:0.01}],costRows:[],carryIn:0};
  const a=P.poolAllocationDetails(r,'a');assert.equal(cents(a),1);
  assert.deepEqual(P.poolAllocationDetails({...r,sources:[...r.sources].reverse()},'a').reverse(),a);
  const rounding=P.poolAllocationDetails({...r,allocations:[{id:'a',amount:0}]},'a');assert.equal(cents(rounding),0);assert.equal(rounding.find(x=>x.kind==='rounding').amount,-0.01);
});
test('скидка с нулевым платежом остаётся отрицательной строкой того же договора',()=>{
  const f=fixture();f.sales[0].paymentPlan.push({id:'discount',amount:0,discountAmount:10000,discountFromProfit:true,date:'2026-11-21',isPaid:true,isRealPayment:true});
  const r=report(f),rows=P.poolAllocationDetails(r,'b');assert(rows.find(x=>x.paymentId==='discount').amount<0);
  assert.equal(rows.filter(x=>x.saleId==='one').length,2);assert.equal(cents(rows),Math.round(r.allocations.find(x=>x.id==='b').amount*100));
});
test('касса отдаёт клиента, товар, ссылку на договор и отдельно общие расходы; суммы не меняются',()=>{
  const f=fixture(),before=JSON.stringify(f),r=ledger(f),source=report(f);
  for(const l of [r.manager,...r.investors.values(),...r.managerAccrualsByInvestor.values()]){
    for(const row of l.accruals){assert.equal(row.month,'2026-11');assert.equal(cents(row.details),Math.round(row.amount*100));
      const income=row.details.find(x=>x.kind==='income');assert.equal(income.saleId,'one');assert.equal(income.customerName,'Тестовый клиент');assert.equal(income.productName,'Телефон');}
  }
  assert.equal(Math.round((r.manager.received+[...r.investors.values()].reduce((n,x)=>n+x.received,0))*100),Math.round(source.distributable*100));
  assert.equal(JSON.stringify(f),before);
});
test('закрытый месяц использует сохранённые источники и расходы после изменения текущих данных',()=>{
  const f=fixture(),snapshot=report(f);f.account.poolAccounting.closed=[{...snapshot,status:'CLOSED'}];
  const expected=ledger(f);f.sales[0].paymentPlan[0].amount=1;f.sales[0].productName='Изменённый товар';f.expenses[0].amount=1;f.investors[0].initialAmount=9000000;
  const actual=ledger(f);assert.deepEqual(actual.manager.accruals,expected.manager.accruals);
  assert.equal(actual.manager.accruals[0].details.find(r=>r.kind==='income').productName,'Телефон');
  assert.equal(actual.manager.pending,0);
});
test('удалённый или недоступный договор не получает неработающую ссылку; корректировка сохраняется',()=>{
  const f=fixture();f.account.poolAccounting.adjustments=[{id:'adjust',date:'2026-11-25',amount:1000,reason:'Уточнение'}];
  const snapshot=report(f);f.account.poolAccounting.closed=[{...snapshot,status:'CLOSED'}];f.sales=[];
  const row=ledger(f).manager.accruals[0];assert(row.details.every(r=>!r.saleId));assert(row.details.some(r=>r.title==='Корректировка: Уточнение'));
  assert.equal(cents(row.details),Math.round(row.amount*100));
});
test('отдельный счёт сохраняет прежнюю расшифровку по платежам',()=>{
  const f=fixture();f.account={id:'pool',type:'INVESTOR',ownerId:'b'};f.accounts=[f.account];
  const r=ledger(f);assert.equal(r.manager.accruals[0].saleId,'one');assert.equal(r.manager.accruals[0].details,undefined);
});
