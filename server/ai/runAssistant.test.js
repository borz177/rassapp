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
