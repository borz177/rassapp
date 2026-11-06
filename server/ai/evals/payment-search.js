#!/usr/bin/env node
// Настоящая модель, только синтетические записи в отдельной локальной схеме.
// Новое умение поиска по графику + соседние вопросы о долге и фактической оплате.
require('dotenv').config({path:require('path').join(__dirname,'../../.env'),quiet:true});
const {Pool}=require('pg'),express=require('express'),jwt=require('jsonwebtoken'),assert=require('node:assert/strict'),{randomBytes}=require('crypto');
const normalize=t=>String(t).replace(/[\s\u00a0\u202f]/g,'').toLowerCase();
(async()=>{
  const url=new URL(process.env.DATABASE_URL);assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname),'Только локальный PostgreSQL');
  const schema=`eval_payment_search_${randomBytes(6).toString('hex')}`,admin=new Pool({connectionString:url.href});let pool,server;
  try{
    await admin.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString:url.href,options:`-c search_path=${schema}`});
    await pool.query(`CREATE TABLE users(id text PRIMARY KEY,name text,role text,blocked boolean DEFAULT false,subscription jsonb,manager_id text,whatsapp_settings jsonb);
      CREATE TABLE data_items(id text PRIMARY KEY,user_id text,type text,data jsonb,updated_at timestamptz DEFAULT NOW());
      INSERT INTO users(id,name,role) VALUES('eval','Тестовый владелец','admin')`);
    const fixtures={accounts:[{id:'main',name:'Основная касса',type:'MAIN',initialBalance:100000}],customers:[{id:'match',name:'Саидов Муса',phone:'+79000000001'},{id:'paid',name:'Петров Илья',phone:'+79000000002'},{id:'decimal',name:'Керимов Умар',phone:'+79000000003'}],sales:[]};
    const base={type:'INSTALLMENT',status:'ACTIVE',accountId:'main',buyPrice:150000,totalAmount:225000,downPayment:23400,remainingAmount:33600,installments:12};
    for(let i=0;i<170;i++)fixtures.sales.push({...base,id:`noise${i}`,customerId:'paid',productName:`Тестовый товар ${i}`,startDate:'2026-10-01',paymentPlan:[{id:`noise_row${i}`,amount:19700,isPaid:false,isRealPayment:false}]});
    fixtures.sales.push({...base,id:'match_sale',customerId:'match',productName:'Телефон',startDate:'2025-12-30',paymentPlan:[...Array.from({length:12},(_,i)=>({id:`schedule${i}`,amount:16800,isPaid:i<10,isRealPayment:false,date:`2026-${String(i+1).padStart(2,'0')}-15`})),{id:'paid_total',amount:168000,isPaid:true,isRealPayment:true,date:'2026-10-01'}]});
    fixtures.sales.push({...base,id:'actual_payment',customerId:'paid',productName:'Ноутбук',startDate:'2026-10-02',paymentPlan:[{id:'planned_other',amount:19700,isPaid:false,isRealPayment:false,date:'2026-12-01'},{id:'actual16800',amount:16800,isPaid:true,isRealPayment:true,date:'2026-11-01'}]});
    fixtures.sales.push({...base,id:'decimal_sale',customerId:'decimal',productName:'Пылесос',startDate:'2025-01-01',paymentPlan:[{id:'decimal_row',amount:8750.50,isPaid:false,isRealPayment:false,date:'2026-12-01'}]});
    for(const[type,items]of Object.entries(fixtures))for(const item of items)await pool.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)',[item.id,'eval',type,JSON.stringify(item)]);
    const app=express();app.use(express.json());const requests=[];let assistant;
    app.use('/api/v1',(req,res,next)=>{const owner=assistant.verifyAgentToken((req.get('authorization')||'').replace(/^Bearer /,''));if(owner!=='eval')return res.sendStatus(401);requests.push({method:req.method,path:req.path,query:{...req.query}});req.apiAuth={userId:owner,scopes:['read'],key:{isAgent:true},user:{id:owner,role:'admin'}};next();},require('../../api/v1').createApiV1Router({pool,checkContractLimit:async()=>({allowed:true}),planLimits:{}}));
    server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
    assistant=require('../assistant').createAssistant({pool,jwt,jwtSecret:randomBytes(32).toString('hex'),port:server.address().port,checkFeatureAccess:async()=>({allowed:true})});
    const filtered=amount=>requests.some(r=>r.path==='/contracts'&&Number(r.query.scheduledPaymentAmount)===amount);
    const cases=[
      ['Поиск ежемесячного платежа за пределами первой страницы','Какой клиент сейчас платит 16 800 рублей в месяц?',r=>filtered(16800)&&/саидов/i.test(r.reply)&&normalize(r.reply).includes('16800')&&!/петров/i.test(r.reply)],
      ['Исходный запрос с разговорной формулировкой','Какой клиент платит на месяц 16 800?',r=>filtered(16800)&&/саидов/i.test(r.reply)&&normalize(r.reply).includes('16800')],
      ['Платёж с копейками берётся из графика','У кого плановый платёж 8 750,50 рубля?',r=>filtered(8750.5)&&/керимов/i.test(r.reply)&&/8\s?750[.,]5/.test(r.reply)],
      ['Несуществующий плановый платёж не выдумывается','Какой клиент платит 99 991 рубль в месяц?',r=>filtered(99991)&&/нет|не наш|не найден|не удалось найти|не обнаруж/i.test(r.reply)&&!/саидов|петров|керимов/i.test(r.reply)],
      ['Соседний вопрос: долг конкретного клиента','Сколько осталось долга у Саидова Мусы по телефону?',r=>/33\s?600/.test(r.reply)&&!r.reply.includes('Не удалось надёжно')],
      ['Соседний вопрос: фактический платёж не подменяется графиком','Кто внёс платёж 16 800 рублей?',r=>/петров/i.test(r.reply)&&!requests.some(q=>q.query.scheduledPaymentAmount)&&requests.some(q=>q.path==='/payments')],
    ];
    const before=(await pool.query('SELECT id,data FROM data_items ORDER BY id')).rows;let failed=0;
    for(let i=0;i<cases.length;i++){
      const[name,text,check]=cases[i];requests.length=0;const at=Date.now();let r,ok=false;
      try{r=await assistant.reply({user:{id:'eval',name:'Тестовый владелец'},text,readOnly:true,mode:'confirm',silent:true});ok=check(r)&&r.actions.length===0&&requests.every(q=>q.method==='GET');assert.deepEqual((await pool.query('SELECT id,data FROM data_items ORDER BY id')).rows,before);}catch(e){r={reply:e.message};}
      if(!ok)failed++;console.log(`${ok?'✓':'✗'} ${i+1}. ${name}  ${((Date.now()-at)/1000).toFixed(1)} с`);
      if(!ok||process.env.AI_EVAL_DEBUG)console.log(JSON.stringify({reply:r.reply,requests}));
    }
    console.log(`Поиск платежа: ${cases.length-failed} из ${cases.length} прошли`);process.exitCode=failed?1:0;
  }finally{if(server)await new Promise(r=>server.close(r));if(pool)await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
})().catch(e=>{console.error(e);process.exitCode=1});
