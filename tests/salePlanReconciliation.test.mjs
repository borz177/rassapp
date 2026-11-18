import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const compiled=await build({entryPoints:['src/salePlan.ts'],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {reconcileSalePaymentPlan}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].contents).toString('base64'));
const printCompiled=await build({entryPoints:['components/contractPrint.ts'],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent',define:{'import.meta.env':'{}'}});
const {contractDocument}=await import('data:text/javascript;base64,'+Buffer.from(printCompiled.outputFiles[0].contents).toString('base64'));
const fixture=(complete=true)=>({
  id:'synthetic',type:'INSTALLMENT',status:'DRAFT',totalAmount:147000,buyPrice:114000,downPayment:0,remainingAmount:52000,installments:6,startDate:'2026-04-17',paymentDay:17,
  paymentPlan:[
    ...Array.from({length:5},(_,i)=>({id:'old_'+i,saleId:'synthetic',amount:25400,date:`2026-${String(i+6).padStart(2,'0')}-17`,isPaid:i<3,isRealPayment:false,note:'Сохранённая строка'})),
    ...(complete?[{id:'pay_reconcile_test',saleId:'synthetic',amount:24500,date:'2026-11-17',isPaid:false,isRealPayment:false}]:[]),
    ...[20000,20000,10000,20000,25000].map((amount,i)=>({id:'receipt_'+i,saleId:'synthetic',amount,date:`2026-11-${String(i+1).padStart(2,'0')}`,isPaid:true,isRealPayment:true,note:'Полученные деньги'})),
  ],
});
const planned=s=>s.paymentPlan.filter(p=>p.isRealPayment===false);
const receipts=s=>s.paymentPlan.filter(p=>p.isPaid&&p.isRealPayment!==false);

for(const complete of [true,false])test(`старый смешанный график ${complete?'уже полный':'достраивается'}: 6 × 24 500, оплаты и остаток не меняются`,()=>{
  const s=fixture(complete),before=structuredClone(s),r=reconcileSalePaymentPlan(s);
  assert.deepEqual(s,before,'Исходная запись не мутирует');
  assert.deepEqual(planned(r).map(p=>p.amount),Array(6).fill(24500));
  assert.equal(planned(r).reduce((n,p)=>n+p.amount,0),147000);
  assert.deepEqual(receipts(r),receipts(s));assert.equal(r.remainingAmount,52000);assert.equal(r.status,s.status);
  for(const p of planned(s)){const next=r.paymentPlan.find(x=>x.id===p.id);assert.equal(next.date,p.date);assert.equal(next.note,p.note);}
  assert.deepEqual(reconcileSalePaymentPlan(r),r,'Повторное сохранение ничего не меняет');
});

test('согласованный неравномерный и неопознанный ручной график не заменяются равными платежами',()=>{
  const s=fixture();
  planned(s).forEach((p,i)=>{p.amount=[20000,20000,20000,20000,20000,47000][i];});
  assert.deepEqual(planned(reconcileSalePaymentPlan(s)).map(p=>p.amount),planned(s).map(p=>p.amount));
  const unrecognized=fixture();planned(unrecognized).at(-1).id='manual';
  assert.deepEqual(planned(reconcileSalePaymentPlan(unrecognized)).map(p=>p.amount),planned(unrecognized).map(p=>p.amount));
  const uneven=fixture();planned(uneven)[0].amount=25000;
  assert.deepEqual(planned(reconcileSalePaymentPlan(uneven)).map(p=>p.amount),planned(uneven).map(p=>p.amount));
});

test('скидка не отменяется, старые строки с реальными деньгами не пересчитываются',()=>{
  const s=fixture();s.paymentPlan.at(-1).discountAmount=4500;
  const r=reconcileSalePaymentPlan(s);
  assert.deepEqual(receipts(r),receipts(s));assert.equal(r.remainingAmount,47500);
  const legacy=fixture();delete legacy.paymentPlan[0].isRealPayment;
  const old=legacy.paymentPlan[0];
  const after=reconcileSalePaymentPlan(legacy).paymentPlan.find(p=>p.id===old.id);
  assert.equal(after.amount,old.amount);assert.equal(after.date,old.date);
  const discounted=fixture();discounted.paymentPlan.at(-1).discountAmount=1000;
  planned(discounted).forEach((p,i)=>{p.amount=i===5?19000:25400;});
  assert.equal(planned(discounted).reduce((n,p)=>n+p.amount,0),146000);
  assert.deepEqual(planned(reconcileSalePaymentPlan(discounted)).map(p=>p.amount),planned(discounted).map(p=>p.amount));
});

test('копейки сходятся точно; нулевой долг и новые платежи сохраняют денежный смысл',()=>{
  const s=fixture();s.totalAmount=147000.01;
  const r=reconcileSalePaymentPlan(s);
  assert.deepEqual(planned(r).map(p=>p.amount),[24500,24500,24500,24500,24500,24500.01]);
  assert.equal(r.remainingAmount,52000.01);
  const paid=fixture();paid.paymentPlan.push({id:'final',amount:52000,date:'2026-11-17',isPaid:true,isRealPayment:true});
  const done=reconcileSalePaymentPlan(paid);
  assert.equal(done.remainingAmount,0);assert(planned(done).every(p=>p.isPaid));assert.deepEqual(receipts(done),receipts(paid));
});

test('печатная форма после исправления: месяц 24 500, после пяти оплат долг 52 000',()=>{
  const s=reconcileSalePaymentPlan({...fixture(),customerId:'c'});
  const {data}=contractDocument({sale:s,sales:[s],customers:[{id:'c',name:'Тестовый Клиент'}]});
  assert.equal(data.monthlyPayment,24500);
  assert.deepEqual(data.rows.filter(p=>p.paid>0).map(p=>p.remaining),[127000,107000,97000,77000,52000]);
  assert.deepEqual(data.rows.filter(p=>p.paid===0).map(p=>p.date),planned(s).filter(p=>!p.isPaid).map(p=>p.date));
});
