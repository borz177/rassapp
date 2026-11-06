const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {KIND_LABELS,KIND_GROUPS,qualityGroup}=require('./qualityKinds');
const url=process.env.DATABASE_URL;
const local=url&&['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);

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
  }finally{if(pool)await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
