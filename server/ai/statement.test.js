const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseStatement}=require('./statement');
const {matchTransactions}=require('./receiptMatch');
test('CSV: десятичная запятая, кавычки, перенос строки и BOM',()=>{
  const rows=parseStatement('\uFEFFДата;Сумма;Клиент;Номер\r\n22.10.2026;"1 200,50";Иванов;"Оплата ""договора""\n123"');
  assert.deepEqual(rows,[{date:'2026-10-22',amount:1200.5,customer:'Иванов',reference:'Оплата "договора"\n123'}]);
});
test('CSV: неверные даты, суммы, число колонок и лимит строк отклоняются',()=>{
  for(const line of ['2026-02-30;100','2026-99-99;100','2026-10-22;-1','2026-10-22;Infinity','2026-10-22;10;extra'])assert.throws(()=>parseStatement(`Дата;Сумма\n${line}`),/Строка 2/);
  assert.throws(()=>parseStatement('Дата;Сумма\n'+Array(101).fill('2026-10-22;100').join('\n')),/100/);
  assert.throws(()=>parseStatement('Дата;Сумма\n"2026-10-22;100'),/кавычка/);
});
test('Сопоставление не записывает деньги и отличает неоднозначность от возможного повтора',()=>{
  const data={customers:[{id:'c',name:'Иванов Иван'}],sales:['a','b'].map(id=>({id,customerId:'c',type:'INSTALLMENT',status:'ACTIVE',remainingAmount:3000,paymentPlan:[{id:`p_${id}`,amount:1000,isPaid:false,date:'2026-10-22'}]}))};
  const before=JSON.stringify(data);
  assert.equal(matchTransactions(data,[{date:'2026-10-22',amount:1000}])[0].status,'ambiguous');
  assert.equal(matchTransactions(data,[{date:'2026-10-22',amount:1200,customer:'Нет такого'}])[0].status,'not_found');
  assert.equal(JSON.stringify(data),before);
  data.sales[0].paymentPlan.push({id:'real',amount:1000,isPaid:true,isRealPayment:true,actualDate:'2026-10-22T12:00:00Z'});
  const result=matchTransactions(data,[{date:'2026-10-22',amount:1000,customer:'Иванов'}])[0];
  assert.equal(result.status,'check_existing_payment');assert.deepEqual(result.possibleDuplicates[0].paymentIds,['real']);
});
test('Счёт выбирает человек, название из ответа модели не считается выбором',()=>{
  const {needsAccountChoice}=require('./accountChoice');
  const accounts=[{id:'main',name:'Основной счёт',type:'MAIN'},{id:'pool',name:'Общая касса',type:'POOL'}];
  assert(needsAccountChoice(accounts,'main','расход 5000', [{role:'assistant',text:'Основной счёт'}]));
  assert(!needsAccountChoice(accounts,'main','расход 5000 с основного счёта'));
  assert(!needsAccountChoice(accounts,'pool','Общая касса [pool]'));
  assert(needsAccountChoice(accounts,'main','Общая касса [pool]'));
});
