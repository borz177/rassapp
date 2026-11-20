const {test}=require('node:test');
const assert=require('node:assert/strict');
const {hash,reviewFingerprint}=require('./auditReviewIdentity');
test('отпечаток содержимого устойчив к порядку ключей JSONB, но учитывает значения и порядок строк',()=>{
  assert.equal(hash({b:2,a:{y:4,x:3}}),hash({a:{x:3,y:4},b:2}));
  assert.notEqual(hash({a:1}),hash({a:2}));
  assert.notEqual(hash([1,2]),hash([2,1]));
});
test('отметка договора зависит от самого договора, клиента, счёта и связанных закупов',()=>{
  const finding={code:'schedule_review',sources:[{kind:'contract',id:'s'}],facts:[]};
  const data={sales:[{id:'s',customerId:'c',accountId:'a',totalAmount:100}],customers:[{id:'c',name:'Тест'}],accounts:[{id:'a',name:'Касса'}],expenses:[{id:'exp_sale_s',amount:10},{id:'other',amount:1}]};
  const original=reviewFingerprint(finding,data,2);
  const unrelated=structuredClone(data);unrelated.expenses[1].amount=99;
  assert.equal(original,reviewFingerprint(finding,unrelated,2));
  for(const type of ['sales','customers','accounts','expenses']){
    const changed=structuredClone(data);changed[type][0].note='изменено';
    assert.notEqual(original,reviewFingerprint(finding,changed,2),type);
  }
  assert.notEqual(original,reviewFingerprint(finding,data,3));
});
test('проверка счёта учитывает связанный склад и изменения капитала участников',()=>{
  const finding={code:'balance',sources:[{kind:'account',id:'a'}],facts:[]};
  const data={accounts:[{id:'a',type:'POOL',poolMemberIds:['i']}],investors:[{id:'i',initialAmount:100}],stockMovements:[{id:'m',accountId:'a',quantity:2}]};
  const original=reviewFingerprint(finding,data,2);
  for(const type of ['investors','stockMovements']){const changed=structuredClone(data);changed[type][0].amount=10;assert.notEqual(original,reviewFingerprint(finding,changed,2));}
});
