const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validRequest, linkAccount, sessionKey, speech, choiceText, isPoll } = require('./protocol');
const request = () => ({ version: '1.0', session: { skill_id: 'skill', session_id: 'session', message_id: 1, user: { user_id: 'alice-user' } }, request: { type: 'SimpleUtterance', command: 'Касса' }, meta: { interfaces: { account_linking: {} } } });

test('protocol rejects wrong skill, malformed commands and message IDs', () => {
  assert.ok(validRequest(request(), 'skill'));
  assert.ok(!validRequest(request(), 'other'));
  for (const bad of [-1, NaN, 1.5, 100000000]) { const b = request(); b.session.message_id = bad; assert.ok(!validRequest(b, 'skill')); }
  const b = request(); b.request.command = {}; assert.ok(!validRequest(b, 'skill'));
});
test('account-linking response never includes response simultaneously', () => {
  const r = linkAccount(request()); assert.deepEqual(r.start_account_linking, {}); assert.equal(r.response, undefined);
  const b = request(); b.meta = {}; assert.match(linkAccount(b).response.text, /телефоне/);
});
test('session key includes the actual Yandex identity', () => {
  const b = request(); const a = sessionKey(b); b.session.user.user_id = 'other'; assert.notEqual(sessionKey(b), a);
});
test('spoken options resolve only from real agent options', () => {
  const result = { actions: [{ kind: 'choices', options: [{ label: 'Основной счёт', ref: 'account-1' }, { label: 'Инвесторы', ref: 'account-2' }] }] };
  assert.equal(choiceText('второй', result), 'Инвесторы [account-2]');
  assert.equal(choiceText('Основной счет', result), 'Основной счёт [account-1]');
  assert.equal(choiceText('третий', result), 'третий');
});
test('voice responses route confirmations to app and fit Alice text limit', () => {
  const r = speech({ reply: 'Нажмите «Подтвердить».', actions: [{ kind: 'confirm' }] });
  assert.match(r, /FinUchet/); assert.match(r, /ничего не проводится/); assert.doesNotMatch(r, /Нажмите/);
  assert.ok(speech({ reply: 'Длинный ответ '.repeat(1000) }).length <= 1024);
  assert.ok(isPoll('Готово?')); assert.ok(!isPoll('Запиши расход'));
});
