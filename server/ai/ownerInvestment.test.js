const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ownerInvestment}=require('./ownerInvestment');
const {isOwnerInvestmentQuestion,guardActionReply}=require('./replySafety');

const fixture=()=>({
  accounts:[{id:'main',name:'Основной',type:'MAIN',initialBalance:100000.25},{id:'extra',type:'CUSTOM',initialBalance:-1450},{id:'inv',type:'CUSTOM',ownerId:'investor',initialBalance:900000},{id:'pool',type:'CUSTOM',poolMemberIds:['investor'],initialBalance:1000000},{id:'shared',type:'CUSTOM',partners:[{investorId:'investor'}],initialBalance:300000}],
  sales:[{id:'income',accountId:'main',customerId:'system_income',downPayment:50000.75},{id:'sale',accountId:'main',customerId:'customer',downPayment:40000},{id:'income_inv',accountId:'inv',customerId:'system_income',downPayment:500000},{id:'unlinked',accountId:'deleted',customerId:'system_income',downPayment:3000}],
  expenses:[{id:'capital',accountId:'main',category:'Моя выплата',managerPayoutSource:'CAPITAL',amount:30000.5},{id:'profit',accountId:'main',category:'Моя выплата',managerPayoutSource:'PROFIT',amount:9000},{id:'legacy',accountId:'main',category:'Моя выплата',amount:1200},{id:'refund',accountId:'main',category:'Моя выплата',managerPayoutSource:'CAPITAL',amount:100,isRefund:true},{id:'purchase',accountId:'main',category:'Закуп',amount:70000}],
});
test('личные вложения: единая формула с экраном, копейки, минус, чужие средства и неопределённые старые записи',async()=>{
  const f=fixture(),before=structuredClone(f),r=await ownerInvestment(f),shared=await import('../../shared/accountInvestment.js');
  assert.equal(r.totals.invested,148551);assert.equal(r.totals.returned,30000.5);assert.equal(r.totals.net,118550.5);assert.equal(r.totals.left,120000.5);
  assert.equal(r.excludedAccounts,3);assert.equal(r.uncertainty.withdrawalsWithoutSource.amount,1200);assert.equal(r.uncertainty.depositsWithoutAccount.amount,3000);
  for(const row of r.accounts){const expected=shared.accountInvestment(f.accounts.find(a=>a.id===row.accountId),f.sales,f.expenses);for(const k of Object.keys(expected))assert.equal(row[k],expected[k]);}
  assert.deepEqual(f,before,'Отчёт ничего не меняет');
  assert.equal((await ownerInvestment({...f,accountId:'main'})).totals.net,120000.5);
  assert.equal((await ownerInvestment({...f,accountId:'foreign'})).status,404);
  assert.equal((await ownerInvestment({...f,accountId:'pool'})).status,400);
  assert.deepEqual((await ownerInvestment({accounts:[],sales:[],expenses:[]})).totals,{initial:0,deposits:0,invested:0,returned:0,left:0,net:0});
});
test('вложения владельца не смешиваются с инвестором, периодом, прибылью и счётом',()=>{
  for(const q of ['Скажи сколько я вложил чистыми?','Сколько я вложила?','Покажи мои личные вложения','Сколько своих денег в деле?'])assert.equal(isOwnerInvestmentQuestion(q),true,q);
  for(const q of ['Сколько вложил Хасан?','Сколько я вложил в этом месяце?','Мои вложения на счету А','Сколько я вложил за год?','Прибыль инвестора','Сколько своих средств через год?'])assert.equal(isOwnerInvestmentQuestion(q),false,q);
});
test('слова о готовности и выполнении зависят от настоящих карточек, включая смешанный результат',()=>{
  const check=(text,actions,extra={})=>guardActionReply({text,actions,claimsDone:true,promisesAction:false,...extra});
  assert.match(check('Я записал платёж',[]).text,/не подготовлено и не выполнено/);
  assert.match(check('Я записал платёж',[{kind:'confirm'}]).text,/Пока оно не выполнено/);
  assert.match(check('Договор оформлен',[{kind:'contract_form',auto:true}]).text,/ещё не оформлен/);
  assert.equal(check('Я записал платёж',[{kind:'report'}]).text,'Отчёт подготовлен — откройте файл в карточке.');
  const mixed=check('Все платежи записаны',[{kind:'done',ok:true},{kind:'confirm'},{kind:'done',ok:false}]);
  assert.match(mixed.text,/Пока оно не выполнено/);assert.match(mixed.text,/Часть действий не выполнена/);
  assert.equal(check('Я записал платёж',[{kind:'done',ok:true}]).replaced,false);
  assert.equal(check('Ранее я добавил клиента',[],{hasPastActions:true}).replaced,false);
  for(const kind of ['report','customers_report','delete_contract','reschedule','template_draft','send_doc'])assert(!check('Подготовил',[{kind}]).text.includes('не подготовлено'),kind);
});

const url=process.env.DATABASE_URL;
const local=url&&['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
test('API вложений: изоляция владельца, права чтения, строгие параметры и отсутствие записей',{skip:!local},async()=>{
  const {Pool}=require('pg'),express=require('express'),crypto=require('node:crypto');
  const schema=`owner_investment_${crypto.randomBytes(6).toString('hex')}`,admin=new Pool({connectionString:url});let pool,server;
  try{
    await admin.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
    await pool.query('CREATE TABLE data_items(id text PRIMARY KEY,user_id text,type text,data jsonb,updated_at timestamptz DEFAULT NOW())');
    for(const [type,items] of Object.entries(fixture()))for(const item of items)await pool.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)',[item.id,'owner',type,JSON.stringify(item)]);
    await pool.query("INSERT INTO data_items(id,user_id,type,data) VALUES('foreign','other','accounts','{\"id\":\"foreign\",\"type\":\"MAIN\",\"initialBalance\":77777777}')");
    const before=(await pool.query('SELECT * FROM data_items ORDER BY id')).rows;
    const app=express();app.use((req,res,next)=>{req.apiAuth={userId:req.get('x-user')||'owner',scopes:req.get('x-write-only')?['write']:['read']};next();});
    app.use('/api/v1',require('../api/v1').createApiV1Router({pool,planLimits:{}}));
    server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
    const base=`http://127.0.0.1:${server.address().port}/api/v1`;
    const get=(path,headers={})=>fetch(base+path,{headers});
    const all=await get('/reports/owner-investment');assert.equal(all.status,200);assert.equal((await all.json()).data.totals.net,118550.5);
    const other=await get('/reports/owner-investment',{'x-user':'other'});assert.equal((await other.json()).data.totals.net,77777777);
    for(const path of ['/reports/owner-investment?accountId=foreign','/reports/owner-investment?accountId=missing'])assert.equal((await get(path)).status,404);
    for(const path of ['/reports/owner-investment?accountId=pool','/reports/owner-investment?from=2026-01-01','/reports/owner-investment?accountId=','/reports/owner-investment?accountId=main&accountId=extra'])assert.equal((await get(path)).status,400);
    assert.equal((await get('/reports/owner-investment',{'x-write-only':'1'})).status,403);
    assert.equal((await get('/help/agent?topic=watchlist')).status,200);assert.equal((await get('/help/agent?topic=__proto__')).status,400);
    assert.deepEqual((await pool.query('SELECT * FROM data_items ORDER BY id')).rows,before);
  }finally{
    if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}if(pool)await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
  }
});
