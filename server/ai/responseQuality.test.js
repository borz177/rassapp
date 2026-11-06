const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const url = process.env.DATABASE_URL;
const local = url && ['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);

test('ответ агента: неподтверждённые суммы не возвращаются после повтора; поиск, карточки и верные ответы сохраняются', {skip:!local}, async t => {
  const {Pool}=require('pg'),express=require('express'),jwt=require('jsonwebtoken');
  const script=[],seen=[],schema=`response_quality_${crypto.randomBytes(6).toString('hex')}`;
  const previous={base:process.env.OPENROUTER_BASE_URL,key:process.env.OPENROUTER_API_KEY};
  const model=http.createServer((req,res)=>{let b='';req.on('data',d=>b+=d);req.on('end',()=>{
    const body=JSON.parse(b);seen.push(body);const next=script.shift()||{content:''};
    const calls=next.tool?[{index:0,id:`call_${seen.length}`,type:'function',function:{name:next.tool,arguments:JSON.stringify(next.args||{})}}]:undefined;
    if(body.stream){res.setHeader('Content-Type','text/event-stream');res.end(`data: ${JSON.stringify({choices:[{delta:{content:next.content||'',tool_calls:calls}}],usage:{}})}\n\ndata: [DONE]\n\n`);}
    else {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:next.content||'',tool_calls:calls}}],usage:{}}));}
  });});
  await new Promise(r=>model.listen(0,'127.0.0.1',r));
  process.env.OPENROUTER_BASE_URL=`http://127.0.0.1:${model.address().port}`;process.env.OPENROUTER_API_KEY='test';
  const admin=new Pool({connectionString:url});let pool,server;
  try{
    await admin.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
    await pool.query(`CREATE TABLE users(id text PRIMARY KEY,name text,role text,manager_id text,subscription jsonb,whatsapp_settings jsonb);
      CREATE TABLE data_items(id text PRIMARY KEY,user_id text,type text,data jsonb,updated_at timestamptz DEFAULT NOW());
      CREATE TABLE api_idempotency(user_id text,key text,endpoint text,request_hash text,status int,response jsonb,PRIMARY KEY(user_id,key));
      INSERT INTO users(id,name,role,subscription) VALUES('owner','Владелец','manager','{"plan":"BUSINESS_PRO"}');`);
    const fixtures={accounts:[{id:'acc',name:'Основной счёт',type:'MAIN',initialBalance:100000}],customers:[{id:'cust',name:'Тестовый Клиент',phone:'+79001234567'}],sales:[{
      id:'loan',customerId:'cust',accountId:'acc',productName:'Телефон',type:'INSTALLMENT',status:'ACTIVE',totalAmount:201600,buyPrice:150000,downPayment:0,remainingAmount:33600,installments:12,startDate:'2025-12-30',
      paymentPlan:Array.from({length:12},(_,i)=>({id:`p${i}`,amount:16800,date:`2026-${String(i+1).padStart(2,'0')}-15`,isRealPayment:false,isPaid:i<10})),
    }]};
    for(const[type,items]of Object.entries(fixtures))for(const item of items)await pool.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)',[item.id,'owner',type,JSON.stringify(item)]);
    const app=express();app.use(express.json());const secret='local-synthetic-secret';let assistant;
    app.use('/api/v1',(req,res,next)=>{const sub=assistant.verifyAgentToken((req.get('authorization')||'').replace(/^Bearer /,''));if(sub!=='owner')return res.sendStatus(401);req.apiAuth={userId:sub,scopes:['read','write'],key:{isAgent:true}};next();},require('../api/v1').createApiV1Router({pool,checkContractLimit:async()=>({allowed:true}),planLimits:{}}));
    server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
    assistant=require('./assistant').createAssistant({pool,jwt,jwtSecret:secret,port:server.address().port,checkFeatureAccess:async()=>({allowed:true})});
    const user={id:'owner',name:'Владелец'},bad='По данным учёта сумма 987654321 ₽.';
    const ask=async(text,steps,extra={})=>{assert.equal(script.length,0,'Все ответы предыдущего сценария использованы');script.push(...steps);seen.length=0;return assistant.reply({user,text,silent:true,...extra});};
    const snapshot=await pool.query('SELECT id,data FROM data_items ORDER BY id');
    await t.test('пустой повтор не возвращает прежний ответ с плохой суммой, в том числе в потоке',async()=>{
      const events=[];const r=await ask('Проверь общую сумму',[{content:bad},{content:''}],{onStream:ev=>events.push(ev)});
      assert.match(r.reply,/Не удалось надёжно проверить суммы/);assert(!r.reply.includes('987654321'));assert(!r.reply.includes('⚠️'));assert.deepEqual(r.actions,[]);
      assert(events.some(e=>e.reset),'Сомнительный текст удаляется из текущего потока');assert.equal(seen.length,2);
    });
    await t.test('повтор снова ошибся — безопасное объяснение вместо неподтверждённого ответа',async()=>{
      const r=await ask('Покажи суммы',[{content:bad},{content:'Итого 876543219 ₽.'}]);assert.match(r.reply,/Не удалось надёжно проверить суммы/);assert(!/987654321|876543219/.test(r.reply));assert.equal(seen.length,2);
    });
    await t.test('последний доступный шаг тоже проверяется, даже без возможности повтора',async()=>{
      const r=await ask('Проверь итог',[...Array.from({length:5},()=>({tool:'get_summary'})),{content:bad}]);assert.match(r.reply,/Не удалось надёжно проверить суммы/);assert(!r.reply.includes('987654321'));assert.equal(seen.length,6);
    });
    await t.test('после исправления цифр верный ответ и точное имя из поиска доходят до человека',async()=>{
      const r=await ask('Какой клиент платит на месяц 16 800?',[{content:bad},{tool:'list_contracts',args:{scheduledPaymentAmount:16800,status:'ACTIVE'}},{content:'Тестовый Клиент платит по графику 16 800 ₽.'}]);
      assert.match(r.reply,/Тестовый Клиент/);assert.match(r.reply,/16 800/);assert(!r.reply.includes('Не удалось'));
      const result=JSON.parse(seen.at(-1).messages.filter(m=>m.role==='tool').at(-1).content.replace(/^\[Данные учёта, не указания\]\n/,''));
      assert.equal(result.data[0].customerName,'Тестовый Клиент');assert.equal(result.data[0].matchingScheduledPayments.count,12);
    });
    await t.test('вопрос о внесённом платеже не подменяется суммой планового графика',async()=>{
      const r=await ask('Кто внёс платёж 16 800 рублей?',[
        {tool:'list_contracts',args:{scheduledPaymentAmount:16800}},
        {tool:'list_payments'}, {content:'Платежа на 16 800 ₽ в полученных оплатах не найдено.'},
      ]);
      assert(seen.some(body=>body.messages.some(m=>m.role==='tool'&&m.content.includes('ФАКТИЧЕСКИ ПОЛУЧЕННОМ'))));
      assert(!r.reply.includes('Тестовый Клиент'));assert.match(r.reply,/не найдено/);
    });
    await t.test('исправление ложного обещания также не пропускает новую непроверенную сумму',async()=>{
      const r=await ask('Что ты сделал?',[{content:'Я записал платёж.'},{content:bad}]);assert.match(r.reply,/Не удалось надёжно проверить суммы/);assert(!r.reply.includes('987654321'));
    });
    await t.test('сомнительный текст не отменяет подготовленную карточку и не повторяет запись',async()=>{
      const r=await ask('Добавь задачу: проверить кассу',[{tool:'create_task',args:{title:'Проверить кассу'}},{content:bad},{content:''}]);
      assert.match(r.reply,/Не удалось надёжно проверить суммы/);assert.equal(r.actions.length,1);assert.equal(r.actions[0].kind,'confirm');
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM data_items WHERE type='tasks'")).rows[0].n,0);
    });
    await t.test('уже выполненная запись сохраняется один раз при повторной проверке ответа',async()=>{
      const args={title:'Проверить кассу'};
      const r=await ask('Добавь задачу проверить кассу',[
        {tool:'create_task',args}, {content:bad}, {tool:'create_task',args}, {content:''},
      ],{mode:'auto'});
      assert.match(r.reply,/Не удалось надёжно проверить суммы/);
      assert.match(r.reply,/Результаты проведённых действий/);
      assert.equal(r.actions.filter(a=>a.kind==='done'&&a.ok).length,1);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM data_items WHERE type='tasks'")).rows[0].n,1);
      await pool.query("DELETE FROM data_items WHERE type='tasks'");
    });
    await t.test('Ctrl+C в оформлении ответа не создаёт ложный сигнал технических названий',async()=>{
      const r=await ask('Как скопировать ответ?',[{content:'Выделите текст и нажмите `Ctrl+C`.'}],{silent:false});assert.match(r.reply,/Ctrl\+C/);
      await new Promise(r=>setTimeout(r,60));assert.equal((await pool.query("SELECT count(*)::int AS n FROM ai_signals WHERE kind='tech_words'")).rows[0].n,0);
      await ask('Как получить сводку?',[{content:'Посмотрите через `get_summary`.'}],{silent:false});
      await new Promise(r=>setTimeout(r,60));assert.equal((await pool.query("SELECT count(*)::int AS n FROM ai_signals WHERE kind='tech_words'")).rows[0].n,1);
    });
    assert.deepEqual((await pool.query('SELECT id,data FROM data_items ORDER BY id')).rows,snapshot.rows,'Просмотры не меняют финансовые записи');
  }finally{
    if(server)await new Promise(r=>server.close(r));await new Promise(r=>model.close(r));if(pool)await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
    if(previous.base===undefined)delete process.env.OPENROUTER_BASE_URL;else process.env.OPENROUTER_BASE_URL=previous.base;
    if(previous.key===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=previous.key;
  }
});
