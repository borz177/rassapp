const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAssistantRunner } = require('./runAssistant');
const setup = (overrides = {}) => {
  let input, calls = [];
  const run = createAssistantRunner({
    pool: { query: async (sql, params) => { calls.push(sql); return { rows: sql.startsWith('SELECT id, name') ? [{ id: 'u', role: 'manager' }] : [] }; } },
    assistant: { reply: async args => { input = args; return { reply: 'Готово', actions: [{ kind: 'contract_form', auto: true }], usage: {} }; } },
    state: async () => ({ allowedRole: true, consent: true, left: 10, trial: false, settings: {} }),
    subscriptionState: async () => ({ expired: false }), month: () => '2026-10', ...overrides,
  });
  return { run, input: () => input, calls };
};
test('Alice forces confirm mode, strips media and disables all automatic cards', async () => {
  const s = setup(); const r = await s.run({ userId: 'u', channel: 'alice', mode: 'auto', image: 'photo', audio: {} });
  assert.equal(s.input().mode, 'confirm'); assert.equal(s.input().image, null); assert.equal(s.input().audio, null);
  assert.equal(r.actions[0].auto, false);
});
test('read-only OAuth scope blocks writes even with active subscription', async () => {
  const s = setup(); await s.run({ userId: 'u', channel: 'alice', allowWrites: false }); assert.equal(s.input().readOnly, true);
});
test('normal app retains automatic mode and automatic cards', async () => {
  const s = setup(); const r = await s.run({ userId: 'u', mode: 'auto' }); assert.equal(s.input().mode, 'auto'); assert.equal(r.actions[0].auto, true);
});
test('no consent or exhausted quota never invokes model', async () => {
  for (const state of [{ allowedRole: true, consent: false, left: 10 }, { allowedRole: true, consent: true, left: 0 }]) {
    const s = setup({ state: async () => state }); await assert.rejects(s.run({ userId: 'u' })); assert.equal(s.input(), undefined);
  }
});
test('revoked consent blocks replay of a saved answer',async()=>{
  let replayed=false;
  const s=setup({state:async()=>({allowedRole:true,consent:false,left:10}),conversations:{run:async()=>{replayed=true;return {reply:'private'}}}});
  await assert.rejects(s.run({userId:'u',requestId:'old'}),{status:403});
  assert.equal(replayed,false);
});

test('вопросы о сверке и историческом инвесторе распознаются без модели', async () => {
  const {localAuditIntent} = require('./auditQuestions');
  for (const text of ['Проверь мой учёт', 'Сверь весь учет', 'Откуда несоответствия в моём учёте?', 'Есть ли расхождения?', 'Сверь кассу', 'Что не сходится в учёте?']) {
    assert.equal(localAuditIntent({text})?.kind, 'scan', text);
  }
  for (const text of ['Почему в сверке показывает сумму без инвестора?', 'Что значит выплата без инвестора?', 'Откуда сумма без инвестора в учёте?']) {
    assert.equal(localAuditIntent({text})?.kind, 'investor', text);
  }
  assert.deepEqual(localAuditIntent({text:'Проверь учёт по счёту «Общая»'}), {kind:'scan',account:'Общая'});
  assert.equal(localAuditIntent({text:'Откуда минус в кассе?'})?.kind, 'balance');
  assert.equal(localAuditIntent({text:'Почему минус на кассе?'})?.kind, 'balance');
  assert.equal(localAuditIntent({text:'Почему нет закупа в сверке?'})?.kind, 'purchase');
  assert.equal(localAuditIntent({text:'Проверь учёт. Запиши расход'}), null);
  assert.equal(localAuditIntent({text:'Проверь учёт по счёту Общая и запиши расход'}), null);
  assert.equal(localAuditIntent({text:'Проверь учёт',image:'photo'}), null);
  assert.equal(localAuditIntent({text:'Проверь учёт',channel:'alice'}), null);
});

test('формулировки команды ЧС не принимают запросы на чтение, внешние каналы или несколько клиентов', () => {
  const { watchlistIntent } = require('./watchlistIntent');
  for (const text of [
    'Добавь Иванова в ЧС', 'Занеси в ч.с. Иванова', 'Можешь добавить Иванова в чёрный список?',
  ]) assert.deepEqual(watchlistIntent({ text }), { name: 'Иванова' }, text);
  assert.deepEqual(watchlistIntent({ text: 'Добавь его в ЧС' }), { focus: true });
  assert.deepEqual(watchlistIntent({ text: 'Добавь Иванова и Петрова в ЧС' }), { unsupported: true });
  assert.deepEqual(watchlistIntent({ text: 'Добавь в ЧС\nИванова\nПетрова' }), { unsupported: true });
  assert.equal(watchlistIntent({ text: 'Не добавляй Иванова в ЧС' }), null);
  assert.equal(watchlistIntent({ text: 'Как добавить клиента в чёрный список?' }), null);
  assert.equal(watchlistIntent({ text: 'Добавь Иванова в ЧС', channel: 'alice' }), null);
  assert.equal(watchlistIntent({ text: 'Добавь Иванова в ЧС', image: 'photo' }), null);
});

test('ЧС распознаёт названную категорию и сохраняет произвольное описание как черновик', () => {
  const { watchlistIntent } = require('./watchlistIntent');
  for (const text of [
    'Давай добавь клиента Иванова в чёрный список за просрочку',
    'Внеси в черный список Иванова за длительную просрочку',
  ]) assert.deepEqual(watchlistIntent({ text }), { name: 'Иванова', draft: { reason: 'overdue' } }, text);
  assert.deepEqual(watchlistIntent({ text: 'Добавь его в ЧС, причина: неисполнение обязательств' }),
    { focus: true, draft: { reason: 'unfulfilled' } });
  for (const text of [
    'Добавь Иванова в ЧС, причина: Не вернул товар после расторжения договора.',
    'Добавь в ЧС Иванова, потому что Не вернул товар после расторжения договора.',
    'Добавь Иванова в ЧС, Не вернул товар после расторжения договора.',
  ]) assert.deepEqual(watchlistIntent({ text }),
    { name: 'Иванова', draft: { reason: 'other', reasonDetails: 'Не вернул товар после расторжения договора.' } }, text);
  assert.deepEqual(watchlistIntent({ text: 'Добавь Иванова и Петрова в ЧС за просрочку' }), { unsupported: true });
});

test('пояснение неподтверждённого инвестора использует сумму одной операции', () => {
  const { auditExplanation } = require('./auditQuestions');
  const reply = auditExplanation({ findings: [{
    code: 'payout_investor', accountName: 'Касса', facts: [{ label: 'Сумма выплаты', value: 12500 }],
  }] }, 'investor');
  assert.match(reply, /выплата на 12\s500 ₽ \(Касса\)/);
  assert.match(reply, /сверьте получателя/);
});

test('сверка по тексту и объяснение карточки не тратят лимит, используют выбранный счёт и проверяют актуальность', async()=>{
  let createdScope, stale=false;
  const report={id:'report',scope:{label:'Общая',accountIds:['account-1']},summary:'Вопросов для уточнения: 1.',findings:[{
    code:'historical_investor_return',severity:'information',accountName:'Общая',facts:[{label:'Сумма внесения',value:500000}],
  }]};
  const queries=[];
  const s=setup({
    state:async()=>({allowedRole:true,consent:true,left:0,trial:true,settings:{}}),
    pool:{query:async(sql)=>{queries.push(sql);return {rows:sql.startsWith('SELECT id, name')?[{id:'u',role:'manager'}]:[{id:'account-1',name:'Общая'},{id:'account-2',name:'Общая резерв'}]};}},
    audits:{create:async(_user,ids)=>{createdScope=ids;return report;},compact:r=>r,get:async()=>({...report,stale})},
  });
  const scoped=await s.run({userId:'u',text:'Проверь учёт по счёту Общая'});
  assert.deepEqual(createdScope,['account-1']);
  assert.equal(scoped.actions[0].kind,'accounting_audit');
  const answer=await s.run({userId:'u',text:'Что значит сумма без инвестора?'});
  assert.match(answer.reply,/внесение и возврат по 500\s000 ₽/);
  assert.match(answer.reply,/разница — 0 ₽/);
  const explanation=await s.run({userId:'u',text:'Объясни эту проверку учёта: что проверить?',auditReportId:'report'});
  assert.equal(explanation.modelUsed,false);
  assert.equal(explanation.left,0);
  assert.equal(s.input(),undefined);
  assert(!queries.some(sql=>/INSERT INTO ai_assistant_usage|UPDATE users/.test(sql)));
  stale=true;
  await assert.rejects(s.run({userId:'u',text:'Объясни эту проверку учёта: что проверить?',auditReportId:'report'}),{status:409,code:'AUDIT_STALE'});
});

test('ЧС: поиск по полному ФИО распознаётся отдельно от добавления', () => {
  const {watchlistIntent}=require('./watchlistIntent');
  for(const text of ['Проверь Иванов Иван Иванович в ЧС','Найди в черном списке Иванов Иван Иванович','Посмотри Иванов Иван Иванович по ЧС','Можешь проверить Иванов Иван Иванович в черном списке','Пожалуйста проверь чёрный список Иванов Иван Иванович']) {
    assert.deepEqual(watchlistIntent({text}),{search:true,name:'Иванов Иван Иванович',birthYear:null},text);
  }
  assert.deepEqual(watchlistIntent({text:'Проверь Иванов Иван Иванович в ЧС 1990'}),{search:true,name:'Иванов Иван Иванович',birthYear:1990});
  assert.equal(watchlistIntent({text:'Проверь Иванов Иван Иванович в ЧС',channel:'alice'}),null);
  assert.equal(watchlistIntent({text:'Проверь баланс'}),null);
  assert.equal(watchlistIntent({text:'Проверь Иванова и Петрова в ЧС'}).unsupported,true);
});
