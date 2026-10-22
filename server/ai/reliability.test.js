const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { createActionStore } = require('./actionStore');
const { createReconciliation, audit, planTransfer } = require('./reconciliation');
const domain = require('../api/domain');
const fixture = () => ({
  accounts: [{ id: 'main', name: 'Основной', type: 'MAIN', initialBalance: -1450 }, { id: 'pool', name: 'Инвесторы', type: 'POOL', initialBalance: 1513900 }],
  customers: [{ id: 'client', name: 'Тестовый клиент' }], retailSales: [],
  sales: [{ id: 'sale', customerId: 'client', type: 'INSTALLMENT', status:'ACTIVE', totalAmount:2696700, remainingAmount:2018350, accountId: 'deleted', buyPrice: 2136000, downPayment: 352600, paymentPlan: [{ id: 'pay', amount: 325750, isPaid: true, isRealPayment: true }] }],
  expenses: [{ id: 'exp_sale_sale', accountId: 'deleted', amount: 2136000 }],
});
test('сверка учитывает отрицательный основной счёт и переносит закуп вместе с договором', async () => {
  await domain.ready;
  const p = planTransfer(fixture(), ['sale'], 'pool');
  assert.equal(p.after.totalCash, 54800);
  assert.equal(p.after.accounts.find(a => a.id === 'pool').balance, 56250);
  assert.equal(audit(fixture()).orphanContracts.length, 1);
  assert.throws(() => planTransfer({ ...fixture(), expenses: [] }, ['sale'], 'pool'), /закуп/);
  assert.throws(() => planTransfer(fixture(), ['sale','sale'], 'pool'));
  assert.throws(() => planTransfer(fixture(), ['sale'], 'foreign'));
});
const url = process.env.DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
test('PostgreSQL: перезапуск, изоляция владельца, параллельные подтверждения, устаревшие данные и перенос', { skip: !local }, async () => {
  const schema = `agent_test_${crypto.randomBytes(8).toString('hex')}`;
  const admin = new Pool({ connectionString: url });
  let pool;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
    await pool.query('CREATE TABLE data_items(id text PRIMARY KEY,user_id text,type text,data jsonb,updated_at timestamptz DEFAULT NOW())');
    for (const [type, items] of Object.entries(fixture())) for (const data of items) await pool.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)', [data.id, 'owner', type, JSON.stringify(data)]);
    const store = createActionStore(pool);
    await store.prepare('a', { userId: 'owner', tool: 'test', args: { contractId: 'sale' }, summary: 'Тест' });
    const restarted = createActionStore(pool);
    assert.equal((await restarted.get('owner', 'a')).status, 'pending');
    assert.equal(await restarted.get('other', 'a'), undefined);
    let calls = 0;
    const perform = async () => { calls++; await new Promise(r => setTimeout(r, 30)); return { ok: true, text: 'Готово' }; };
    await Promise.all([store.run('owner','a',perform), restarted.run('owner','a',perform)]);
    assert.equal(calls, 1);
    assert.equal((await restarted.run('owner','a',perform)).ok, true);
    assert.equal(calls, 1);
    await store.prepare('b', { userId: 'owner', args: { contractId: 'sale' } });
    await pool.query("UPDATE data_items SET data=data || '{\"notes\":\"Новое\"}' WHERE id='sale'");
    assert.equal((await store.run('owner','b',perform)).ok, false);
    assert.equal(calls, 1);
    await store.prepare('c', { userId: 'owner', args: {} });
    await assert.rejects(store.run('owner','c',async () => { throw new Error('crash'); }));
    assert.match((await restarted.run('owner','c',perform)).text, /проверки/);
    assert.equal(calls, 1);
    const service = createReconciliation(pool);
    const plan = await service.preview('owner', { contractIds: ['sale'], accountId: 'pool' });
    assert.equal((await service.transfer('other', { contractIds: ['sale'], accountId: 'pool', fingerprint: plan.fingerprint })).ok, false);
    assert.equal((await service.transfer('owner', { contractIds: ['sale'], accountId: 'pool', fingerprint: plan.fingerprint })).ok, true);
    assert.equal((await service.read('owner')).totalCash, 54800);
    assert.equal((await service.transfer('owner', { contractIds: ['sale'], accountId: 'pool', fingerprint: plan.fingerprint })).ok, false);

    const { createConversations } = require('./conversations');
    const conversations = createConversations(pool);
    let turns = 0;
    const turn = { userId: 'owner', requestId: 'turn', text: 'Проверь кассу', image: 'private-image' };
    const reply = async () => { turns++; return { reply: 'Проверено', actions: [] }; };
    await conversations.run(turn, reply);
    assert.equal((await createConversations(pool).run(turn,reply)).replayed,true);
    assert.equal(turns,1);
    await assert.rejects(conversations.run({ ...turn,text:'Другое' },reply));
    assert.equal((await conversations.list('other')).messages.length,0);
    assert.equal(JSON.stringify((await pool.query('SELECT * FROM ai_turns')).rows).includes('private-image'),false);
    assert.equal((await conversations.list('owner')).messages.length,2);
    const clients = require('./clientActions').createClientActions(pool);
    await conversations.run({userId:'owner',requestId:'client-card',text:'Тест'},async()=>({reply:'Готов черновик',actions:[{id:'client_once',kind:'contract_form'}]}));
    await assert.rejects(clients.claim('other','client_once'));
    const claims=await Promise.all([clients.claim('owner','client_once'),clients.claim('owner','client_once')]);
    assert.equal(claims.filter(c=>c.claimed).length,1);
    await clients.finish('owner','client_once',{ok:true,saleId:'missing'});
    assert.equal((await clients.list('owner'))[0].status,'uncertain');
    assert.equal((await clients.claim('owner','client_once')).claimed,false);
    await conversations.clear('owner',true);
    assert.equal((await conversations.list('owner')).messages.length,0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM ai_turns')).rows[0].n,2);
    await conversations.clear('owner');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM ai_turns')).rows[0].n,0);

    await pool.query("CREATE TABLE users(id text PRIMARY KEY,role text,blocked boolean DEFAULT false,ai_consent_at timestamptz,ai_settings jsonb)");
    await pool.query("INSERT INTO users(id,role,ai_consent_at,ai_settings) VALUES('owner','manager',NOW(),'{\"anomalyAlerts\":true}'),('other','manager',NOW(),'{\"anomalyAlerts\":false}')");
    const notifications=[];
    const monitor=require('./monitor').createMonitor({pool,allowed:role=>role==='manager',createNotification:async(...args)=>notifications.push(args)});
    await monitor.tick();await monitor.tick();
    assert.equal(notifications.length,1);assert.equal(notifications[0][0],'owner');
    const quality=require('./quality')({pool});
    quality.start({staticPrompt:'test',model:'test',callModel:async body=>({choices:[{message:{content:JSON.stringify({decision:require('./lessonValidation').cases.find(c=>c.text===body.messages[1].content).expected})}}]})});
    await quality.report();
    for(let i=0;i<11;i++)await pool.query("INSERT INTO ai_lessons(rule,status) VALUES($1,'active')",[`Existing ${i}`]);
    const candidates=(await pool.query("INSERT INTO ai_lessons(rule) VALUES('Поясняй расчёт'),('Показывай период') RETURNING id")).rows;
    const decisions=await Promise.allSettled(candidates.map(c=>quality.decide(c.id,'apply','owner')));
    assert.equal(decisions.filter(d=>d.status==='fulfilled').length,1);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM ai_lessons WHERE status='active'")).rows[0].n,12);
    assert.equal((await quality.report()).versions.length,1);
    await assert.rejects(quality.setAutoApply(true));

    await pool.query('CREATE TABLE api_idempotency(user_id text,key text,endpoint text,request_hash text,status int,response jsonb,PRIMARY KEY(user_id,key))');
    const express = require('express');
    const atomic = require('../api/atomicWrites').createAtomicWrites(pool);
    const app = express(); app.use(express.json());
    app.use((req,res,next) => { req.apiAuth={ userId: req.get('x-user') || 'owner', scopes:['read','write'],key:{isAgent:true} }; next(); });
    app.use(atomic.middleware);
    let mutations = 0;
    app.post('/write',async (req,res) => {
      try {
        mutations++;
        await atomic.db.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)',[req.body.id,req.apiAuth.userId,'expenses','{}']);
        if (req.body.fail) return res.status(500).json({ error:'test rollback' });
        res.status(201).json({ id:req.body.id });
      } catch { res.status(500).json({ error:'write failed' }); }
    });
    app.use('/api/v1',require('../api/v1').createApiV1Router({pool:atomic.db,checkContractLimit:async()=>true,planLimits:{}}));
    const server = await new Promise(resolve => { const s=app.listen(0,'127.0.0.1',()=>resolve(s)); });
    try {
      const endpoint=`http://127.0.0.1:${server.address().port}/write`;
      const post=(key,body)=>fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});
      const replies=await Promise.all([post('repeat',{id:'once'}),post('repeat',{id:'once'})]);
      assert.deepEqual(replies.map(r=>r.status),[201,201]);
      assert.equal(mutations,1);
      assert.equal((await post('repeat',{id:'different'})).status,409);
      assert.equal((await post('rollback',{id:'rollback',fail:true})).status,500);
      assert.equal((await pool.query("SELECT id FROM data_items WHERE id='rollback'")).rowCount,0);
      assert.equal((await pool.query("SELECT key FROM api_idempotency WHERE key='rollback'")).rowCount,0);
      const paymentUrl=endpoint.replace('/write','/api/v1/payments');
      const pay=()=>fetch(paymentUrl,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'nested-payment'},body:JSON.stringify({contractId:'sale',amount:1000})});
      const first=await pay(); assert.equal(first.status,201); const payment=(await first.json()).data.payment;
      assert.equal((await pay()).status,201);
      const actual=(await pool.query("SELECT data FROM data_items WHERE id='sale'")).rows[0].data;
      assert.equal(actual.paymentPlan.filter(p=>p.id===payment.id).length,1);
      assert.equal(actual.remainingAmount,2017350);
      const undo=await fetch(`${paymentUrl}/${payment.id}`,{method:'DELETE',headers:{'Idempotency-Key':'undo-nested'}});
      assert.equal(undo.status,200);
      assert.equal((await pool.query("SELECT data->>'remainingAmount' AS n FROM data_items WHERE id='sale'")).rows[0].n,'2018350');
    } finally { await new Promise(resolve=>server.close(resolve)); }
  } finally {
    if (pool) await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
