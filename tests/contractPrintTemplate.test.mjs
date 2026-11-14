import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {normalizeTemplate} from '../shared/contractTemplate.js';
const compiled=await build({entryPoints:['components/contractPrint.ts'],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent',define:{'import.meta.env':'{}'}});
const {contractDocument}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].contents).toString('base64'));
const fixture=()=>{
  const sale={id:'sale',customerId:'customer',productName:'Тестовый товар',startDate:'2026-11-13',type:'INSTALLMENT',status:'ACTIVE',contractTemplateId:'MODERN',totalAmount:18000,buyPrice:15000,downPayment:0,remainingAmount:18000,installments:3,paymentPlan:[{id:'p',date:'2026-12-13',amount:6000,isPaid:false,isRealPayment:false}]};
  return {sale,sales:[sale],customers:[{id:'customer',name:'Тестовый Клиент',passportSeries:'0012',passportNumber:'003456'}],appSettings:{contractTemplate:'CLASSIC'},contractTemplatesAllowed:true};
};
test('печать по настройкам использует Договор 2, даже когда при оформлении был выбран Договор 1',()=>{
  const ctx=fixture(),before=structuredClone(ctx);
  const print=contractDocument({...ctx,templateSource:'settings'}),saved=contractDocument(ctx);
  assert.equal(print.template,'CLASSIC');assert.equal(saved.template,'MODERN');assert.deepEqual(print.data,saved.data);assert.equal(print.number,saved.number);assert.deepEqual(ctx,before);
  assert.equal(contractDocument({...ctx,contractTemplatesAllowed:undefined,templateSource:'settings'}).template,'CLASSIC');
});
test('новый выбор, старый договор без формы и ограничения тарифа учитываются при печати',()=>{
  const ctx=fixture();
  assert.equal(contractDocument({...ctx,sale:{...ctx.sale,contractTemplateId:undefined},templateSource:'settings'}).template,'CLASSIC');
  assert.equal(contractDocument({...ctx,sale:{...ctx.sale,contractTemplateId:'CLASSIC'},appSettings:{contractTemplate:'MODERN'},templateSource:'settings'}).template,'MODERN');
  assert.equal(contractDocument({...ctx,contractTemplatesAllowed:false,templateSource:'settings'}).template,'MODERN');
  assert.equal(contractDocument({...ctx,sale:{...ctx.sale,contractTemplateId:'CLASSIC'},appSettings:undefined,templateSource:'settings'}).template,'CLASSIC');
});
test('сохранённый личный снимок не заменяется выбором встроенного шаблона или изменением библиотеки',()=>{
  const ctx=fixture(),t=normalizeTemplate({id:'ct_'+'a'.repeat(32),name:'Личная версия',text:'ДОГОВОР\nПокупатель {{customerName}}\n{{paymentSchedule}}',fontFamily:'serif',fontSize:12,createdAt:'2026-10-21T00:00:00Z'});
  const sale={...ctx.sale,contractTemplateId:`CUSTOM:${t.id}`,contractTemplateSnapshot:t};
  const result=contractDocument({...ctx,sale,templateSource:'settings',contractTemplatesAllowed:false});
  assert.equal(result.template,`CUSTOM:${t.id}`);assert.deepEqual(result.data.customTemplate,t);
});
