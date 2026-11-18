import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

const require = createRequire(import.meta.url);
const domain = require('../server/api/domain.js');
const {buildAccountingAudit} = require('../server/ai/accountingAudit.js');
const compiled = await build({entryPoints:['src/finpayImport.ts'],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {buildFinpayRecords} = await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].contents).toString('base64'));
await domain.ready;

const fixture = () => ({
  exported_at:'2026-11-14T00:00:00Z',version:1,
  clients:[{id:'client',full_name:'Тестовый Клиент'}],
  installments:[{id:'contract',installment_number:1,client_id:'client',funding_account_id:'original',product_name:'Тестовый товар',total_price_cents:12000000,cash_price_cents:10000000,down_payment_cents:2000000,signing_date:'2026-01-01',status:'active',paid_amount_cents:3000000,remaining_amount_cents:9000000}],
  payments:[
    {id:'down',installment_id:'contract',payment_number:0,due_date:'2026-01-01',expected_amount_cents:2000000,paid_amount_cents:2000000,is_paid:true,status:'paid',paid_date:'2026-01-01'},
    {id:'part',installment_id:'contract',payment_number:1,due_date:'2026-02-01',expected_amount_cents:10000000,paid_amount_cents:1000000,is_paid:false,status:'partial',paid_date:'2026-02-01'},
  ],
});
const accounts = [{id:'a',name:'Тестовый счёт',type:'MAIN',initialBalance:200000}];
const records = withPurchaseExpenses => buildFinpayRecords(fixture(),{userId:'synthetic',accountMap:{original:'a'},withPurchaseExpenses,importedAt:'2026-11-14T00:00:00Z'});

test('реальный импорт FinPay без закупов: простое пояснение в особенностях, баланс и долг не меняются', () => {
  const original=fixture(), input=structuredClone(original);
  const built=buildFinpayRecords(input,{userId:'synthetic',accountMap:{original:'a'},withPurchaseExpenses:false,importedAt:'2026-11-14T00:00:00Z'});
  assert.deepEqual(input,original);
  assert.equal(built.sales[0].importInfo.purchaseMode,'WITHOUT_EXPENSE');
  assert.equal(built.expenses.length,0);
  assert.equal(built.sales[0].remainingAmount,90000);
  const before=structuredClone(built),audit=buildAccountingAudit({...built,accounts});
  assert.deepEqual(built,before);
  assert.equal(audit.counts.confirmed,0);assert.equal(audit.counts.review,0);
  assert.equal(audit.findings.find(f=>f.code==='import_purchase_history').severity,'information');
  assert(!audit.findings.some(f=>f.code==='missing_purchase'));
  assert.match(audit.summary,/расхождений не найдено/);
  const unmarked={...built,sales:built.sales.map(({importInfo,...sale})=>sale)};
  assert.deepEqual(audit.accounts,buildAccountingAudit({...unmarked,accounts}).accounts);
});

test('реальный импорт FinPay с закупами: связь явная, частичный сбой не прячется, повтор не меняет id', () => {
  const built=records(true),again=records(true);
  assert.deepEqual(built.expenses.map(e=>e.id),again.expenses.map(e=>e.id));
  assert.equal(built.sales[0].importInfo.purchaseMode,'WITH_EXPENSE');
  assert.equal(built.expenses[0].saleId,built.sales[0].id);
  assert.equal(built.expenses[0].id,`exp_sale_${built.sales[0].id}`);
  const audit=buildAccountingAudit({...built,accounts});
  assert.equal(audit.counts.confirmed,0);assert.equal(audit.counts.review,0);
  assert(!audit.findings.some(f=>f.code==='import_purchase_history'));
  const failed=buildAccountingAudit({...built,expenses:[],accounts});
  assert(failed.findings.some(f=>f.code==='missing_purchase'&&f.severity==='review'));
  assert(!failed.findings.some(f=>f.code==='import_purchase_history'));
  const unmarked={...built,sales:built.sales.map(({importInfo,...sale})=>sale),expenses:built.expenses.map(({saleId,...expense})=>expense)};
  assert.deepEqual(audit.accounts,buildAccountingAudit({...unmarked,accounts}).accounts);
});
