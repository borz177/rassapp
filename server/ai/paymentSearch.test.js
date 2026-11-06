const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { scheduledPaymentAmounts, matchingScheduledPayments } = require('../api/scheduledPayments');
const { createApiV1Router } = require('../api/v1');

test('поиск использует строки графика: копейки, оплата и старые записи не подменяют план', () => {
  const sale = { paymentPlan: [
    { amount: 16800, isRealPayment: false, isPaid: true },
    { amount: '16800', isRealPayment: false, isPaid: false },
    { amount: 16800.01, isRealPayment: false, isPaid: false },
    { amount: 99000, isRealPayment: true, isPaid: true },
    { amount: 77700, isPaid: true }, // старая фактическая оплата без флага
    { amount: 12300, isPaid: false }, // старый неоплаченный график
    { amount: 0, isRealPayment: false }, { amount: 'broken', isRealPayment: false },
  ] };
  const snapshot = JSON.stringify(sale);
  assert.deepEqual(scheduledPaymentAmounts(sale), [12300, 16800, 16800.01]);
  assert.deepEqual(matchingScheduledPayments(sale, 16800), { amount: 16800, count: 2, unpaidCount: 1 });
  assert.equal(matchingScheduledPayments(sale, 16800.01).count, 1);
  assert.equal(matchingScheduledPayments(sale, 99000).count, 0);
  assert.equal(matchingScheduledPayments(sale, 77700).count, 0);
  assert.deepEqual(scheduledPaymentAmounts({}), []);
  assert.equal(JSON.stringify(sale), snapshot);
});

test('HTTP/MCP: точный поиск по всем договорам до пагинации, имя клиента, фильтры и изоляция владельца', async () => {
  const makeSale = (id, extra = {}) => ({ id, type:'INSTALLMENT', status:'ACTIVE', customerId:'c', accountId:'a', productName:'Товар',
    totalAmount:201600, downPayment:0, remainingAmount:33600, startDate:'2026-01-01', paymentPlan:[{amount:25000,isRealPayment:false,isPaid:false}], ...extra });
  const target = makeSale('target', { startDate:'2025-01-01', paymentPlan:Array.from({length:12}, (_,i)=>({amount:16800,isRealPayment:false,isPaid:i<10})) });
  const fixtures = { sales:[target,...Array.from({length:170}, (_,i)=>makeSale(`s${i}`)),
    makeSale('real-only',{paymentPlan:[{amount:16800,isRealPayment:true,isPaid:true}]}),
    makeSale('cash',{type:'CASH',paymentPlan:[{amount:16800,isRealPayment:false,isPaid:false}]})], customers:[{id:'c',name:'Тестовый клиент'}] };
  const foreign = { sales:[makeSale('foreign',{paymentPlan:[{amount:16800,isRealPayment:false,isPaid:false}]})],customers:[{id:'c',name:'Чужой клиент'}] };
  const before = JSON.stringify(fixtures);
  const pool = { query: async (sql,args) => {
    assert.match(sql,/^SELECT/,'Поиск не пишет в базу');
    const data = (args[0]==='other'?foreign:fixtures)[args[1]] || [];
    return {rows:data.map(data=>({data}))};
  } };
  const app=express();app.use((req,res,next)=>{req.apiAuth={userId:req.get('x-owner')||'owner',scopes:['read']};next();});
  app.use('/api/v1',createApiV1Router({pool}));
  const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
  const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  const get=async(path,status=200,headers={})=>{const r=await fetch(base+path,{headers});assert.equal(r.status,status,path);return r.json();};
  try {
    const found=await get('/contracts?scheduledPaymentAmount=16800&limit=1');
    assert.equal(found.meta.total,1);assert.equal(found.data[0].id,'target');assert.equal(found.data[0].customerName,'Тестовый клиент');
    assert.deepEqual(found.data[0].scheduledPaymentAmounts,[16800]);
    assert.deepEqual(found.data[0].matchingScheduledPayments,{amount:16800,count:12,unpaidCount:2});
    assert.equal(found.meta.sums.remainingAmount,33600);
    assert.equal((await get('/contracts?scheduledPaymentAmount=16800&offset=1')).data.length,0);
    for(const suffix of ['&accountId=other','&customerId=missing','&status=COMPLETED','&from=2026-01-01','&search=ноутбук']) {
      assert.equal((await get('/contracts?scheduledPaymentAmount=16800'+suffix)).meta.total,0);
    }
    assert.equal((await get('/contracts?scheduledPaymentAmount=16800&search=Тестовый&to=2025-12-31')).meta.total,1);
    assert.equal((await get('/contracts?scheduledPaymentAmount=16800.01')).meta.total,0);
    const other=await get('/contracts?scheduledPaymentAmount=16800',200,{'x-owner':'other'});
    assert.deepEqual(other.data.map(s=>s.id),['foreign']);assert.equal(other.data[0].customerName,'Чужой клиент');
    for(const value of ['', '0','-1','NaN','Infinity','0x10','1.001','1e4','10000000000000000000','16800&scheduledPaymentAmount=1']) {
      const bad=await get('/contracts?scheduledPaymentAmount='+value,400);assert.equal(bad.error.code,'validation_error');
    }
    const unfiltered=await get('/contracts?limit=200');assert.equal(unfiltered.meta.total,173);
    assert.equal(unfiltered.data.find(s=>s.id==='s0').totalAmount,201600);
    assert(!unfiltered.data.some(s=>s.matchingScheduledPayments));assert.equal(JSON.stringify(fixtures),before);
    const tool=require('../api/mcp').TOOLS.find(t=>t.name==='list_contracts');
    const request=tool.request({scheduledPaymentAmount:16800,status:'ACTIVE'});
    assert.equal(new URL('http://test'+request.path).searchParams.get('scheduledPaymentAmount'),'16800');
    assert.equal(tool.input.scheduledPaymentAmount.type,'number');
  } finally { await new Promise(r=>server.close(r)); }
});
