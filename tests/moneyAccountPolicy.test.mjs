import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({entryPoints:['src/moneyAccountPolicy.ts','src/utils.ts'],bundle:true,platform:'node',format:'esm',write:false,outdir:'unused-tests',logLevel:'silent'});
const [P,U] = await Promise.all(compiled.outputFiles.map(f=>import(`data:text/javascript;base64,${Buffer.from(f.contents).toString('base64')}`)));
const accounts = [
  {id:'main',name:'Мой счёт',type:'MAIN',initialBalance:100000},
  {id:'personal',name:'Личный инвестора',type:'INVESTOR',ownerId:'a',initialBalance:100000},
  {id:'pool',name:'Общая касса',type:'POOL',poolMemberIds:['a','b'],initialBalance:100000},
  {id:'legacy',name:'Совместный',type:'SHARED',partners:['b'],initialBalance:0},
  {id:'foreign',name:'Чужой',type:'INVESTOR',ownerId:'c'},
  {id:'archived',name:'Архивный',type:'INVESTOR',ownerId:'a',isArchived:true},
];
const investors = ['a','b','c','none'].map(id=>({id,name:id,initialAmount:100000,profitPercentage:60,joinedDate:'2025-01-01'}));
const deposit = {type:'INVESTOR_DEPOSIT',amount:5000,investorId:'a',accountId:'personal'};
const withdrawal = {...deposit,type:'INVESTOR_WITHDRAWAL',category:'Выплата инвестора'};
const issue = d=>P.moneyOperationIssue(d,accounts,investors);

test('каждому инвестору доступны только собственные счета и общие кассы с его участием',()=>{
  assert.deepEqual(P.investorMoneyAccounts(accounts,'a').map(a=>a.id),['personal','pool']);
  assert.deepEqual(P.investorMoneyAccounts(accounts,'b').map(a=>a.id),['pool','legacy']);
  assert.deepEqual(P.investorMoneyAccounts(accounts,'none'),[]);
  assert.deepEqual(P.investorMoneyAccounts(accounts,'unknown'),[]);
  assert.deepEqual(P.investorMoneyAccounts(accounts,''),[]);
});
test('архивный счёт остаётся лишь в явно заданном контексте, чужой контекст не открывает доступ',()=>{
  assert.deepEqual(P.investorMoneyAccounts(accounts,'a','archived').map(a=>a.id),['personal','pool','archived']);
  assert(!P.investorMoneyAccounts(accounts,'b','archived').some(a=>a.id==='archived'));
});
test('связанный счёт подставляется автоматически; явный контекст и выбор сохраняются',()=>{
  const linked = P.investorMoneyAccounts(accounts,'a');
  assert.equal(P.resolveInvestorMoneyAccount(linked,''),'personal');
  assert.equal(P.resolveInvestorMoneyAccount(linked,'main'),'personal');
  assert.equal(P.resolveInvestorMoneyAccount(linked,'pool'),'pool');
  assert.equal(P.resolveInvestorMoneyAccount(linked.slice(0,1),'main'),'personal');
  assert.equal(P.resolveInvestorMoneyAccount([],'foreign'),'');
});
test('проверка сохранения блокирует чужие счета и неизвестного инвестора для обоих видов операции',()=>{
  for(const data of [deposit,{...withdrawal,payoutType:'PROFIT'},{...withdrawal,payoutType:'INVESTMENT'}]){
    for(const accountId of ['personal','pool'])assert.equal(issue({...data,accountId}),null);
    for(const accountId of ['foreign','main','legacy'])assert.equal(issue({...data,accountId}),'Выберите счёт этого инвестора.');
    assert.equal(issue({...data,investorId:'deleted'}),'Выберите инвестора.');
    assert.equal(issue({...data,accountId:'deleted'}),'Выберите счёт.');
    for(const amount of [0,-1,NaN,Infinity])assert.equal(issue({...data,amount}),'Введите сумму больше нуля.');
  }
});
test('источник обязателен для выплаты инвестору и себе; произвольное значение тоже отклоняется',()=>{
  for(const payoutType of [undefined,null,'','OTHER'])assert.equal(issue({...withdrawal,payoutType}),'Выберите источник: вложения или прибыль.');
  const own = {type:'OTHER_EXPENSE',category:'Моя выплата',accountId:'main',amount:500};
  for(const managerPayoutSource of [undefined,null,'','OTHER'])assert.equal(issue({...own,managerPayoutSource}),'Выберите источник выплаты.');
  for(const managerPayoutSource of ['PROFIT','CAPITAL'])assert.equal(issue({...own,managerPayoutSource}),null);
});
test('прочий приход скрывает отдельные счета инвесторов; платежи клиентов и поставщикам сохраняют маршрутизацию',()=>{
  assert.deepEqual(accounts.filter(P.allowsOtherIncome).map(a=>a.id),['main','pool','legacy']);
  assert(issue({...deposit,type:'OTHER_INCOME'}));
  assert.equal(issue({...deposit,type:'OTHER_INCOME',accountId:'pool'}),null);
  for (const category of ['Моя выплата','Выплата инвестора']) {
    assert.equal(issue({...deposit,type:'OTHER_INCOME',accountId:'main',category}),null, 'Общая категория прихода не превращает его в выплату');
  }
  for(const type of ['CUSTOMER_PAYMENT','RETAIL_PAYMENT'])assert.equal(issue({...deposit,type}),null);
  assert.equal(issue({type:'OTHER_EXPENSE',category:'Оплата партнёру',accountId:'personal',amount:500}),null);
});
test('удаление связи во время подтверждения не даёт провести выплату; история остаётся прежней',()=>{
  const data = {...withdrawal,payoutType:'PROFIT'};
  const snapshot = JSON.stringify({data,accounts,investors});
  assert.equal(issue(data),null);
  const changed = accounts.map(a=>a.id==='personal'?{...a,ownerId:'b'}:a);
  assert.equal(P.moneyOperationIssue(data,changed,investors),'Выберите счёт этого инвестора.');
  assert.equal(JSON.stringify({data,accounts,investors}),snapshot);
});
test('сохранённые поля пополнения и возврата меняют выбранный счёт и капитал ровно на сумму операции',()=>{
  const a = investors[0], date='2026-11-06T12:00:00Z';
  assert.equal(issue(deposit),null);
  // Те же поля записи прихода и датированное изменение капитала, что в App.
  const income = {id:'income',type:'CASH',customerId:a.id,accountId:'personal',buyPrice:0,totalAmount:5000,downPayment:5000,remainingAmount:0,startDate:date,paymentPlan:[],status:'COMPLETED'};
  const afterDeposit = U.applyCapitalChange(a,5000,date,income.id);
  assert.equal(afterDeposit.initialAmount,105000);
  const before = U.computeAccountBalances(accounts,[],[]);
  const deposited = U.computeAccountBalances(accounts,[income],[]);
  assert.equal(deposited.personal-before.personal,5000);
  assert.equal(deposited.pool,before.pool);
  const expense={...withdrawal,id:'return',amount:2500,date,payoutType:'INVESTMENT'};
  assert.equal(issue(expense),null);
  const afterReturn = U.applyCapitalChange(afterDeposit,-2500,date,expense.id);
  const returned = U.computeAccountBalances(accounts,[income],[expense]);
  assert.equal(afterReturn.initialAmount,102500);
  assert.equal(returned.personal-deposited.personal,-2500);
  assert.equal(returned.pool,before.pool);
  assert.equal(investors[1].initialAmount,100000);
});
