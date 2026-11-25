const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { poolQuestionIntent, answerPoolQuestion } = require('./poolQuestions');
const { createAssistantRunner } = require('./runAssistant');

const today = '2026-11-24';
const now = Date.parse(today + 'T12:00:00+03:00');
const parse = text => poolQuestionIntent({ text }, today);
const url = process.env.DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);

test('пул: прошедшие месяцы, уточнение счёта и команды без записи', () => {
  assert.equal(parse('Сколько получили инвесторы в общем пуле за ноябрь?').month, '2026-11');
  assert.equal(parse('Прибыль общего пула за декабрь').month, '2025-12');
  assert.equal(parse('Прибыль в общем пуле за декабрь 2026 года').month, '2026-12');
  assert.equal(parse('Прибыль в общем пуле за прошлый месяц').month, '2026-10');
  assert.deepEqual(parse('Сравни переход в общем пуле по счёту «Общая»'), { kind: 'migration', account: 'Общая' });
  assert.equal(parse('Что мешает перейти на месячный учёт в общем пуле?').kind, 'migration');
  assert.equal(parse('Почему у инвесторов разная прибыль в общем пуле?').kind, 'basis');
  for (const text of ['Переведи общий пул на месячный учёт', 'Прибыль общего пула; добавь расход',
    'Прибыль в общем пуле по счёту Общий и переведи деньги', 'Ожидаемая прибыль в общем пуле за ноябрь']) assert.equal(parse(text), null);
  assert.equal(poolQuestionIntent({ text: 'Прибыль общего пула', audio: {} }, today), null);
  assert.equal(poolQuestionIntent({ text: 'Прибыль общего пула', channel: 'alice' }, today), null);
});

test('пул: фактический расчёт и предпросмотр из локальной БД без модели и без фиксации месяцев', { skip: !local }, async () => {
  const { Pool } = require('pg');
  const owner = 'owner', other = 'other';
  const schema = `agent_pool_${crypto.randomBytes(6).toString('hex')}`;
  const server = new Pool({ connectionString: url });
  let db;
  try {
    await server.query(`CREATE SCHEMA ${schema}`);
    db = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
    await db.query(`CREATE TABLE users(id text PRIMARY KEY,name text,role text,blocked boolean DEFAULT false);
      CREATE TABLE data_items(id text PRIMARY KEY,user_id text,type text,data jsonb);
      INSERT INTO users(id,name,role) VALUES('owner','Владелец','manager'),('other','Другой владелец','manager');`);
    const terms = { date: '2026-09-01T00:00:00+03:00', members: { inv: { rate: 100, disposition: 'PAYABLE' } } };
    const base = { type: 'POOL', poolMemberIds: ['inv'] };
    const monthly = { ...base, id: 'a', name: 'Основная касса', poolAccounting: {
      version: 1, startMonth: '2026-09', terms: [terms], openingTerms: terms, excludedSaleIds: [],
      closed: [{ month: '2026-09', issues: [], unallocated: 0, carryIn: 0, carryOut: 0, net: 1234.56, gross: 1234.56, costs: 0, allocations: [{ id: 'inv', amount: 1234.56 }] }],
    } };
    const legacy = { ...base, id: 'b', name: 'Старый пул' };
    const investor = { id: 'inv', name: 'Инвестор Тест', initialAmount: 200000, profitPercentage: 100, joinedDate: '2026-09-01' };
    const sale = { id: 'sale', accountId: 'a', type: 'INSTALLMENT', status: 'ACTIVE', buyPrice: 1000, totalAmount: 2000, startDate: '2026-10-01', paymentPlan: [
      { id: 'real', amount: 2000, date: '2026-11-15', isPaid: true, isRealPayment: true },
    ] };
    const payout = { id: 'return', accountId: 'b', investorId: 'inv', date: '2026-10-01', amount: 100, payoutType: 'INVESTMENT' };
    for (const [user, type, item] of [[owner,'accounts',monthly],[owner,'accounts',legacy],[owner,'investors',investor],[owner,'sales',sale],[owner,'expenses',payout],[other,'accounts',{...base,id:'foreign',name:'Чужой счёт'}]]) {
      await db.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)', [item.id, user, type, item]);
    }
    const snapshot = async () => (await db.query('SELECT * FROM data_items ORDER BY id')).rows;
    const before = await snapshot();
    assert.match(await answerPoolQuestion(db, owner, parse('Прибыль общего пула'), now), /Уточните счёт/);
    const report = await answerPoolQuestion(db, owner, parse('Прибыль в общем пуле за ноябрь по счёту «Основная касса»'), now);
    assert.match(report, /Предварительный расчёт/);
    assert.match(report, /Инвестор Тест — 1\s000 ₽/);
    const frozen = await answerPoolQuestion(db, owner, parse('Прибыль в общем пуле за сентябрь по счёту «Основная касса»'), now);
    assert.match(frozen, /Месяц зафиксирован/);
    assert.match(frozen, /1\s234,56 ₽/);
    const comparison = await answerPoolQuestion(db, owner, parse('Сравни переход в общем пуле по счёту «Старый пул»'), now);
    assert.match(comparison, /Полный перенос пока заблокирован/);
    assert.match(comparison, /операций капитала, требующих сверки — 1/);
    assert.match(comparison, /возврат 100 ₽ от 01\.10\.2026/);
    const missing = await answerPoolQuestion(db, owner, parse('Прибыль в общем пуле по счёту «Чужой счёт»'), now);
    assert.match(missing, /не найден/);
    const run = createAssistantRunner({
      pool: db, assistant: { reply: () => assert.fail('Model should not be called') },
      state: async () => ({ allowedRole:true, consent:true, left:0 }),
    });
    const result = await run({ userId: owner, text: 'Как распределяется прибыль в общем пуле по счёту «Основная касса»' });
    assert.deepEqual(result.actions, []);
    assert.equal(result.left, 0);
    assert.equal(result.modelUsed, false);
    assert.match(result.reply, /в пределах месяца планового взноса/);
    assert.deepEqual(await snapshot(), before);
  } finally {
    if (db) await db.end();
    await server.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await server.end();
  }
});
