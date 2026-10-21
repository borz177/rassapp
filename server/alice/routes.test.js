const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAliceHandler, createWorker } = require('./routes');
const body = (text = 'сколько денег') => ({ version: '1.0', meta: { interfaces: { account_linking: {} } }, session: { skill_id: 'skill', session_id: 'session', message_id: 1, user: { user_id: 'yandex', access_token: 'fu_at_test' } }, request: { type: 'SimpleUtterance', command: text } });
const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(data) { this.data = data; return this; } });
const identity = { userId: 'owner', connectionId: 'connection', scopes: ['read', 'write'] };
const setup = (overrides = {}) => {
  const calls = [];
  const store = { latest: async (userId, key) => { calls.push({ latestUser: userId }); return null; }, enqueue: async job => { calls.push(job); return { job: { status: 'queued' } }; }, ...overrides.store };
  const handler = createAliceHandler({ config: { skillId: 'skill', clientId: 'client' }, connection: async () => identity, available: async () => null, ...overrides, store });
  const invoke = async b => { const res = response(); await handler({ body: b, get: () => undefined }, res); return res; };
  return { invoke, calls };
};
test('missing and invalid OAuth cannot access data or queue work', async () => {
  const s = setup({ connection: async () => null });
  const res = await s.invoke(body()); assert.ok(res.data.start_account_linking); assert.equal(s.calls.length, 0);
  const b = body(); delete b.session.user.access_token;
  assert.ok((await setup().invoke(b)).data.start_account_linking);
});
test('webhook enqueues and returns without waiting for the model', async () => {
  const s = setup(); const r = await s.invoke(body());
  assert.match(r.data.response.text, /Запрос принят/);
  assert.equal(s.calls[1].userId, 'owner'); assert.equal(s.calls[1].connectionId, 'connection');
});
test('poll retrieves same-user result and never enqueues or charges LLM', async () => {
  let n = 0;
  const s = setup({ store: { latest: async u => { assert.equal(u, 'owner'); return { status: 'done', result: { reply: '42 рубля' } }; }, enqueue: async () => { n++; } } });
  assert.equal((await s.invoke(body('готово'))).data.response.text, '42 рубля');
  assert.equal(n, 0);
});
test('worker validates revocation and cannot run as a different owner', async () => {
  let run = 0, failure;
  const w = createWorker({ store: { claim: async () => ({ id: 'job', user_id: 'other', connection_id: 'connection' }), fail: async (_, text) => { failure = text; } }, connectionById: async () => identity, runAssistantTurn: async () => { run++; } });
  await w.processOne(); assert.equal(run, 0); assert.match(failure, /Подключение/);
});
test('worker always uses Alice confirm mode and enforces OAuth read scope', async () => {
  let args, result;
  const w = createWorker({ store: { claim: async () => ({ id: 'job', user_id: 'owner', connection_id: 'connection', question: 'Расход 3000' }), history: async () => [], finish: async (_, r) => { result = r; } }, connectionById: async () => ({ ...identity, scopes: ['read'] }), runAssistantTurn: async a => { args = a; return { reply: 'Ответ' }; } });
  await w.processOne(); assert.equal(args.channel, 'alice'); assert.equal(args.mode, 'confirm'); assert.equal(args.allowWrites, false); assert.equal(result.reply, 'Ответ');
});
test('wrong skill is rejected before OAuth lookup', async () => {
  let checked = false; const s = setup({ connection: async () => { checked = true; return identity; } });
  const b = body(); b.session.skill_id = 'other'; assert.equal((await s.invoke(b)).statusCode, 400); assert.equal(checked, false);
});
