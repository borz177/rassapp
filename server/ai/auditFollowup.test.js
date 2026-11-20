const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fixture=()=>({
  accounts:[{id:'a',name:'Основной',type:'MAIN',initialBalance:1000000},{id:'b',name:'Другой',type:'CUSTOM',initialBalance:1000000}],
  customers:[{id:'c',name:'Тестовый Клиент'}],
  sales:[{id:'s',type:'INSTALLMENT',status:'DRAFT',customerId:'c',accountId:'a',productName:'Тестовый телефон',totalAmount:147000,buyPrice:114000,downPayment:0,remainingAmount:52000,installments:6,startDate:'2026-04-17',paymentDay:17,
    paymentPlan:[...Array.from({length:5},(_,i)=>({id:'old_'+i,saleId:'s',amount:25400,date:`2026-${String(i+6).padStart(2,'0')}-17`,isPaid:i<3,isRealPayment:false})),
      {id:'pay_reconcile_test',saleId:'s',amount:24500,date:'2026-11-17',isPaid:false,isRealPayment:false},
      ...[20000,20000,10000,20000,25000].map((amount,i)=>({id:'real_'+i,saleId:'s',amount,date:`2026-11-${String(i+1).padStart(2,'0')}`,isPaid:true,isRealPayment:true}))]}],
  expenses:[{id:'exp_sale_s',accountId:'a',category:'Закуп',amount:114000,date:'2026-04-17'}],
});
test('действия из сверки: реальные HTTP/PostgreSQL, права, отметки, подтверждение, повторы и отмена',async t=>{
  assert(process.env.DATABASE_URL,'Нужна локальная DATABASE_URL');const url=new URL(process.env.DATABASE_URL);assert(['localhost','127.0.0.1'].includes(url.hostname),'Только локальная БД');
  const {Pool}=require('pg'),express=require('express');const root=new Pool({connectionString:process.env.DATABASE_URL}),schema='audit_followup_'+crypto.randomBytes(6).toString('hex');let pool,server;
  try{
    await root.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`,max:12});
    await pool.query(`CREATE TABLE users(id text PRIMARY KEY,role text NOT NULL DEFAULT 'manager',blocked boolean NOT NULL DEFAULT false,subscription jsonb);
      CREATE TABLE data_items(id text PRIMARY KEY,user_id text,type text,data jsonb,updated_at timestamptz DEFAULT now());
      INSERT INTO users(id) VALUES('owner'),('other');INSERT INTO users(id,role) VALUES('investor','investor');`);
    await require('../api/domain').ready;
    const app=express();app.use(express.json());
    const audits=require('./accountingAuditRoutes').registerAccountingAuditRoutes(app,{pool,auth:(req,res,next)=>{req.user={id:req.get('x-owner')||'owner',role:'manager'};next();},allowed:r=>['manager','admin'].includes(r),conversations:{run:(_,fn)=>fn()}});
    await audits.ready();await audits.repairs.ready();
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base='http://127.0.0.1:'+server.address().port+'/api/ai/assistant/accounting-audit';
    const call=async(path,body,status=200,user='owner')=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-owner':user},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;};
    const snapshot=async()=> (await pool.query('SELECT id,user_id,type,data FROM data_items ORDER BY id')).rows;
    const sale=async()=> (await pool.query("SELECT data FROM data_items WHERE id='s'")).rows[0].data;
    const reset=async()=>{
      await pool.query('TRUNCATE ai_accounting_repairs,ai_accounting_reviews,ai_accounting_reports,data_items');
      await pool.query("UPDATE users SET role='manager',blocked=false,subscription=NULL WHERE id='owner'");
      for(const [type,items]of Object.entries(fixture()))for(const item of items)await pool.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)',[item.id,'owner',type,JSON.stringify(item)]);
      const report=await audits.create('owner');return{report,finding:report.findings.find(f=>f.code==='schedule_review')};
    };
    const prepare=async(report,finding,requestId=crypto.randomUUID())=>call(`/${report.id}/findings/${finding.id}/repair`,{requestId});
    await t.test('отметка обратима, не меняет деньги; чужой доступ и подтверждённые ошибки защищены',async()=>{
      const {report,finding}=await reset(),before=await snapshot(),path=`/${report.id}/findings/${finding.id}/review`;
      await call(path,{checked:'yes'},400);await call(path,{checked:true},404,'other');await call(path,{checked:true},403,'investor');
      await call(path,{checked:true});const repeated=await call(path,{checked:true});assert.equal(repeated.financialDataChanged,false);
      const page=await call('/'+report.id);assert.equal(page.counts.reviewed,1);assert(!page.findings.some(f=>f.id===finding.id));
      const checked=await call('/'+report.id+'?status=reviewed');assert.equal(checked.findings[0].id,finding.id);assert(checked.findings[0].reviewedAt);
      assert.equal((await audits.create('owner')).counts.reviewed,1,'Кеш не возвращает старые отметки');
      await call(path,{checked:false});assert((await call('/'+report.id)).findings.some(f=>f.id===finding.id));
      assert.deepEqual(await snapshot(),before);
      await pool.query("UPDATE data_items SET data=data||'{\"accountId\":\"b\"}'::jsonb WHERE id='exp_sale_s'");
      const wrong=await audits.create('owner'),confirmed=wrong.findings.find(f=>f.code==='purchase_account');
      await call(`/${wrong.id}/findings/${confirmed.id}/review`,{checked:true},409);
    });
    await t.test('проверенное сохраняется при постороннем изменении и возвращается при изменении договора',async()=>{
      const {report,finding}=await reset();await call(`/${report.id}/findings/${finding.id}/review`,{checked:true});
      await pool.query("INSERT INTO data_items(id,user_id,type,data) VALUES('unrelated','owner','expenses',$1)",[JSON.stringify({id:'unrelated',accountId:'b',category:'Прочее',amount:100})]);
      await call(`/${report.id}/findings/${finding.id}/review`,{checked:true},409);
      const fresh=await audits.create('owner');assert(fresh.findings.find(f=>f.id===finding.id).reviewedAt);
      await pool.query("UPDATE data_items SET data=jsonb_set(data,'{productName}',to_jsonb('Другой товар'::text)) WHERE id='s'");
      const changed=await audits.create('owner');assert.equal(changed.findings.find(f=>f.id===finding.id).reviewedAt,null);
      assert((await audits.page('owner',changed.id)).findings.some(f=>f.id===finding.id));
    });
    await t.test('предпросмотр не записывает деньги; подтверждение конкурентно и повторяемо, отмена атомарна',async()=>{
      const {report,finding}=await reset(),before=await snapshot(),requestId=crypto.randomUUID();
      const preview=await prepare(report,finding,requestId);assert.equal(preview.beforeTotal,151500);assert.equal(preview.afterTotal,147000);assert.equal(preview.remaining,52000);
      assert.equal((await prepare(report,finding,requestId)).id,preview.id);assert.deepEqual(await snapshot(),before);
      const path='/repairs/'+preview.id;
      await call(path+'/confirm',{confirmed:false},400);await call(path+'/confirm',{confirmed:true},404,'other');
      await Promise.all(Array.from({length:8},()=>call(path+'/confirm',{confirmed:true,afterTotal:0,saleId:'foreign'})));
      const changed=await sale(),old=before.find(r=>r.id==='s').data;
      assert.deepEqual(changed.paymentPlan.filter(p=>p.isRealPayment===false).map(p=>p.amount),Array(6).fill(24500));
      assert.deepEqual(changed.paymentPlan.filter(p=>p.isRealPayment===true),old.paymentPlan.filter(p=>p.isRealPayment===true));
      const {paymentPlan:a,...oldFields}=old,{paymentPlan:b,...newFields}=changed;assert.deepEqual(oldFields,newFields);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM ai_accounting_repairs WHERE status='done'")).rows[0].n,1);
      assert.equal((await audits.get('owner',report.id)).stale,true);
      assert((await audits.repairs.list('owner')).some(r=>r.id===preview.id&&r.status==='done'));
      await Promise.all(Array.from({length:4},()=>call(path+'/undo',{confirmed:true})));
      assert.deepEqual(await snapshot(),before,'Отмена возвращает только свой патч');
      await call(path+'/confirm',{confirmed:true},409);
    });
    await t.test('устаревание, истечение срока, блокировка и смена роли не обходятся старой карточкой',async()=>{
      let {report,finding}=await reset(),preview=await prepare(report,finding),before=await snapshot();
      await pool.query("UPDATE users SET role='investor' WHERE id='owner'");await call('/repairs/'+preview.id+'/confirm',{confirmed:true},403);await pool.query("UPDATE users SET role='manager',blocked=true WHERE id='owner'");
      await call('/repairs/'+preview.id+'/confirm',{confirmed:true},403);await pool.query("UPDATE users SET blocked=false,subscription='{\"expiresAt\":\"2000-01-01\"}' WHERE id='owner'");await call('/repairs/'+preview.id+'/confirm',{confirmed:true},403);
      assert.deepEqual(await snapshot(),before);await pool.query("UPDATE users SET subscription=NULL WHERE id='owner'");
      await pool.query("UPDATE ai_accounting_repairs SET expires_at=now()-interval '1 minute' WHERE id=$1",[preview.id]);await call('/repairs/'+preview.id+'/confirm',{confirmed:true},409);
      preview=await prepare(report,finding);await pool.query("UPDATE data_items SET data=data||'{\"notes\":\"Изменено после предпросмотра\"}'::jsonb WHERE id='s'");before=await snapshot();
      await call('/repairs/'+preview.id+'/confirm',{confirmed:true},409);assert.deepEqual(await snapshot(),before);
      await call(`/${report.id}/findings/${finding.id}/repair`,{requestId:crypto.randomUUID()},409);
    });
    await t.test('две разные карточки не исправляют одну запись дважды; новые оплаты защищают отмену',async()=>{
      const {report,finding}=await reset(),first=await prepare(report,finding),second=await prepare(report,finding);
      await call('/repairs/'+first.id+'/confirm',{confirmed:true});await call('/repairs/'+second.id+'/confirm',{confirmed:true},409);
      const s=await sale();s.paymentPlan.push({id:'later',amount:1000,date:'2026-11-18',isPaid:true,isRealPayment:true});s.remainingAmount-=1000;
      await pool.query("UPDATE data_items SET data=$1 WHERE id='s'",[JSON.stringify(s)]);const before=await snapshot();
      await call('/repairs/'+first.id+'/undo',{confirmed:true},409);assert.deepEqual(await snapshot(),before);
    });
    await t.test('ошибка сохранения квитанции откатывает патч; отменённое и ручной график не выполняются',async()=>{
      const {report,finding}=await reset(),preview=await prepare(report,finding),before=await snapshot();
      const brokenPool={query:pool.query.bind(pool),connect:async()=>{const db=await pool.connect();return{release:()=>db.release(),query:(sql,args)=>String(sql).startsWith('UPDATE ai_accounting_repairs SET status=$2')?Promise.reject(Error('Synthetic ledger failure')):db.query(sql,args)};}};
      const broken=require('./auditRepairs').createAuditRepairs({pool:brokenPool,audits,allowed:r=>r==='manager'});
      await assert.rejects(()=>broken.confirm('owner',preview.id),/Synthetic ledger failure/);assert.deepEqual(await snapshot(),before);
      await call('/repairs/'+preview.id+'/cancel',{});await call('/repairs/'+preview.id+'/confirm',{confirmed:true},409);
      const s=await sale();s.paymentPlan.find(p=>p.id==='pay_reconcile_test').id='manual';await pool.query("UPDATE data_items SET data=$1 WHERE id='s'",[JSON.stringify(s)]);
      const current=await audits.create('owner'),manual=current.findings.find(f=>f.code==='schedule_review');assert.equal(manual.repairable,false);
      await call(`/${current.id}/findings/${manual.id}/repair`,{requestId:crypto.randomUUID()},409);
    });
    await t.test('повтор подготовки создаёт одну карточку; истёкшие подтверждения и отмены отражаются в журнале',async()=>{
      let {report,finding}=await reset();const requestId=crypto.randomUUID();
      const previews=await Promise.all(Array.from({length:8},()=>prepare(report,finding,requestId)));
      assert.equal(new Set(previews.map(p=>p.id)).size,1);
      await call(`/${report.id}/findings/not-the-same-finding/repair`,{requestId},409);
      await pool.query("UPDATE ai_accounting_repairs SET expires_at=now()-interval '1 minute' WHERE id=$1",[previews[0].id]);
      assert.equal((await prepare(report,finding,requestId)).status,'expired');
      assert.equal((await audits.repairs.list('owner'))[0].status,'expired');
      await call('/'+report.id+'?status=unknown',undefined,400);
      ({report,finding}=await reset());const preview=await prepare(report,finding);
      const results=await Promise.all(Array.from({length:3},()=>call('/repairs/'+preview.id+'/confirm',{confirmed:true})));
      assert.deepEqual(results[0],results[1]);assert(results[0].undoUntil);
      assert.equal((await audits.repairs.list('owner'))[0].undoable,true);
      await pool.query("UPDATE ai_accounting_repairs SET updated_at=now()-interval '31 minutes' WHERE id=$1",[preview.id]);
      const before=await snapshot();await call('/repairs/'+preview.id+'/undo',{confirmed:true},409);
      assert.deepEqual(await snapshot(),before);assert.equal((await audits.repairs.list('owner'))[0].undoable,false);
      ({report,finding}=await reset());const pending=await prepare(report,finding);
      await Promise.all(Array.from({length:4},()=>call('/repairs/'+pending.id+'/cancel',{})));
      assert.equal((await audits.repairs.list('owner'))[0].status,'cancelled');
    });
    await t.test('новый связанный закуп снимает отметку; чужие изменения на неё не влияют',async()=>{
      const {report,finding}=await reset();await call(`/${report.id}/findings/${finding.id}/review`,{checked:true});
      await pool.query("INSERT INTO data_items(id,user_id,type,data) VALUES('other-owner','other','expenses',$1)",[JSON.stringify({id:'other-owner',saleId:'s',amount:100})]);
      assert.equal((await audits.create('owner')).counts.reviewed,1);
      await pool.query("INSERT INTO data_items(id,user_id,type,data) VALUES('new-purchase','owner','expenses',$1)",[JSON.stringify({id:'new-purchase',saleId:'s',accountId:'a',category:'Закуп',amount:100})]);
      assert.equal((await audits.create('owner')).findings.find(f=>f.id===finding.id).reviewedAt,null);
    });
    await t.test('изменение договора во время ожидания блокировки не теряется при подтверждении',async()=>{
      const {report,finding}=await reset(),preview=await prepare(report,finding),editor=await pool.connect();
      let confirm;
      try{
        await editor.query('BEGIN');await editor.query("SELECT id FROM data_items WHERE id='s' FOR UPDATE");
        confirm=call('/repairs/'+preview.id+'/confirm',{confirmed:true},409);
        await editor.query("UPDATE data_items SET data=data||'{\"notes\":\"Одновременная правка\"}'::jsonb WHERE id='s'");
        await editor.query('COMMIT');
      }finally{editor.release();}
      const before=await snapshot();await confirm;assert.deepEqual(await snapshot(),before);
      assert.equal((await audits.repairs.list('owner'))[0].status,'stale');
    });
  }finally{if(server)await new Promise(r=>server.close(r));if(pool)await pool.end();await root.query(`DROP SCHEMA ${schema} CASCADE`);await root.end();}
});
