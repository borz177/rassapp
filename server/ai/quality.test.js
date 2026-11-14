const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {KIND_LABELS,KIND_GROUPS,qualityGroup}=require('./qualityKinds');
const url=process.env.DATABASE_URL;
const local=url&&['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);

test('медленная диагностика не задерживает ответ агента',{timeout:2000},async()=>{
  let release;const delayed=new Promise(resolve=>{release=resolve;});let updated=false;
  const pool={query:async sql=>{
    if(sql.startsWith('INSERT INTO ai_signals')){await delayed;return {rows:[{id:1}]};}
    if(sql.startsWith('UPDATE ai_signals'))updated=true;
    return {rows:[]};
  }};
  const quality=require('./quality')({pool});
  const reply=quality.trackReply(async()=>{quality.signal(null,'honesty_fix');quality.resolve(['honesty_fix'],'corrected');return {reply:'Ответ готов'};});
  try{assert.equal((await reply({})).reply,'Ответ готов');assert.equal(updated,false);}
  finally{release();await quality.flush();}
  assert.equal(updated,true);
});

test('виды сигналов: понятные названия, защиты и действия пользователя отделены от проверок ответа',()=>{
  for(const kind of ['ungrounded_number','ungrounded_after_retry','empty_reply','tool_rounds_exhausted','honesty_fix','tech_words','model_fallback','tool_error']){
    assert.match(KIND_LABELS[kind],/[А-Яа-я]/);assert.equal(KIND_GROUPS[kind],'quality');
  }
  for(const kind of Object.keys(KIND_LABELS).filter(k=>k.startsWith('guard_')))assert.equal(KIND_GROUPS[kind],'guard');
  for(const kind of ['stop','undo_soon'])assert.equal(KIND_GROUPS[kind],'user');
  assert.equal(KIND_GROUPS.cant_do,'wish');assert.equal(qualityGroup('guard_future'),'guard');assert.equal(qualityGroup('future_error'),'quality');
});

test('админский отчёт: календарные дни и время по Москве, предложения без автоприменения, ручной разбор малой выборки',{skip:!local},async()=>{
  const {Pool}=require('pg'),admin=new Pool({connectionString:url});
  const schema=`quality_report_${crypto.randomBytes(6).toString('hex')}`;let pool;
  try{
    await admin.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString:url,options:`-c search_path=${schema} -c timezone=UTC`});
    await pool.query('CREATE TABLE users(id text PRIMARY KEY)');
    const quality=require('./quality')({pool});await quality.report();
    const at=new Date(Date.now()-86400000);at.setUTCHours(22,15,0,0);
    for(const kind of ['ungrounded_number','guard_bad_customer','cant_do'])await pool.query("INSERT INTO ai_signals(kind,created_at) VALUES($1,$2::timestamptz AT TIME ZONE 'UTC')",[kind,at.toISOString()]);
    await pool.query("INSERT INTO ai_signals(kind,reviewed,created_at) VALUES('tool_error',true,NOW()-INTERVAL '20 days')");
    await pool.query("INSERT INTO ai_lessons(rule,status,created_at) VALUES('Проверяй цифры','proposed',$1::timestamptz AT TIME ZONE 'UTC')",[at.toISOString()]);
    await pool.query("UPDATE ai_quality_settings SET last_review_at=$1::timestamptz AT TIME ZONE 'UTC',auto_apply=true",[at.toISOString()]);
    const report=await quality.report(),day=at.toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'});
    assert.equal(report.byDay.reduce((sum,r)=>sum+r.n,0),3);
    assert(report.byDay.every(r=>r.day===day),'События после 21:00 UTC относятся к следующему московскому дню');
    assert.equal(report.recent.find(r=>r.kind==='ungrounded_number').created_at.toISOString(),at.toISOString());
    assert.equal(report.wishes[0].created_at.toISOString(),at.toISOString());assert.equal(report.lessons[0].created_at.toISOString(),at.toISOString());
    assert.equal(report.lastReviewAt.toISOString(),at.toISOString());assert.equal(report.autoApply,false);assert.equal(report.autoReviewMinSignals,3);
    assert.equal(report.pendingReview,2);assert.equal(report.lessons[0].status,'proposed');assert.equal(report.kindGroups.guard_bad_customer,'guard');
    let calls=0;const args={staticPrompt:'Тест',callModel:async()=>{calls++;return{choices:[{message:{content:'{"lessons":[]}'}}]};}};
    const skipped=await quality.review(args);assert.equal(skipped.skipped,true);assert.equal(skipped.cases,2);assert.equal(calls,0);
    const manual=await quality.review({...args,force:true});assert.equal(manual.cases,2);assert.equal(calls,1);assert.equal((await quality.report()).pendingReview,0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM ai_lessons WHERE status='active'")).rows[0].n,0);

    assert((await quality.report()).recent.every(r=>r.outcome==='unknown'),'Старые сигналы не переоцениваются');
    const tracked=quality.trackReply(async({user,kind})=>{
      quality.signal(user.id,'honesty_fix',{question:kind});
      await new Promise(r=>setTimeout(r,kind==='fixed'?15:1));
      if(kind==='failed')throw new Error('Synthetic failure');
      if(kind==='cancelled')return {cancelled:true,reply:''};
      quality.resolve(['honesty_fix'],kind==='fixed'?'corrected':'blocked');
      return {reply:'Проверено'};
    });
    await pool.query("INSERT INTO users(id) VALUES('test')");
    await Promise.all([tracked({user:{id:'test'},kind:'fixed'}),tracked({user:{id:'test'},kind:'blocked'}),tracked({user:{id:'test'},kind:'cancelled'})]);
    await assert.rejects(tracked({user:{id:'test'},kind:'failed'}));
    await quality.flush();
    const outcomes=(await pool.query("SELECT question,outcome,run_id FROM ai_signals WHERE user_id='test' AND kind='honesty_fix'")).rows;
    assert.deepEqual(Object.fromEntries(outcomes.map(r=>[r.question,r.outcome])),{fixed:'corrected',blocked:'blocked',cancelled:'cancelled',failed:'failed'});
    assert.equal(new Set(outcomes.map(r=>r.run_id)).size,4,'Параллельные запросы не смешиваются');
    assert.equal((await pool.query("SELECT outcome FROM ai_signals WHERE kind='request_error'")).rows[0].outcome,'failed');
    quality.resolve(['honesty_fix'],'failed');
    assert.equal((await pool.query("SELECT outcome FROM ai_signals WHERE question='fixed' LIMIT 1")).rows[0].outcome,'corrected');
  }finally{if(pool)await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});


test('похожие правила отмечаются без изменения решений',()=>{
  const {markDuplicates,similar}=require('./qualityRules');
  const rows=[{id:1,status:'proposed',rule:'Если инструмент не был вызван, не сообщай о выполнении.'},{id:2,status:'proposed',rule:'Если инструмент не был вызван — не сообщай о выполнении!'}];
  const before=structuredClone(rows),marked=markDuplicates(rows);assert.equal(marked[1].similarTo,1);assert.equal(marked[0].similarTo,null);assert.deepEqual(rows,before);
  assert.equal(similar('Показывай итог за месяц','Не записывай платёж без подтверждения'),false);
  assert.equal(similar('Сообщай о выполнении действия без инструмента','Не сообщай о выполнении действия без инструмента'),false);
  assert.equal(similar('Если инструмент не был вызван, не сообщай о его выполнении или готовности.','Никогда не сообщай о выполнении действия, если соответствующий инструмент не был вызван или не вернул результат.'),true);
});

test('новые правила: только два подтверждённых запроса, без дублей и одновременных разборов',{skip:!local},async()=>{
  const {Pool}=require('pg'),admin=new Pool({connectionString:url});
  const schema=`quality_rules_${crypto.randomBytes(6).toString('hex')}`;let pool;
  try{
    await admin.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
    await pool.query('CREATE TABLE users(id text PRIMARY KEY)');
    const quality=require('./quality')({pool});await quality.report();
    const insert=async run=>(await pool.query("INSERT INTO ai_signals(kind,run_id) VALUES('honesty_fix',$1) RETURNING id",[run])).rows[0].id;
    const a=await insert('same'),b=await insert('same'),c=await insert('other');
    let calls=0;
    const callModel=async()=>{calls++;await new Promise(r=>setTimeout(r,20));return {choices:[{message:{content:JSON.stringify({lessons:[
      {rule:'Не объявляй действие выполненным без вызова инструмента.',signalIds:[a,b]},
      {rule:'Если инструмент не был вызван, не сообщай о выполнении.',signalIds:[a,c]},
      {rule:'Если инструмент не был вызван — не сообщай о выполнении!',signalIds:[a,c]},
    ]})}}]};};
    const results=await Promise.all([quality.review({callModel,staticPrompt:'test'}),quality.review({callModel,staticPrompt:'test'})]);
    assert.equal(calls,1);assert(results.every(r=>r.proposed===1));
    assert.deepEqual((await pool.query('SELECT status,cases,kinds FROM ai_lessons')).rows,[{status:'proposed',cases:2,kinds:'honesty_fix'}]);
  }finally{if(pool)await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
