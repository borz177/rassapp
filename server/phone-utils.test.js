const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhone } = require('./phone-utils');

test('номера на +7 — ровно 11 цифр; лишние цифры — ошибка, а не отправка в никуда (прод 24.10: 14 цифр, «no LID found»)', () => {
  assert.equal(normalizePhone('+7 928 765-43-21').phone, '79287654321');
  assert.equal(normalizePhone('8 928 765 43 21').phone, '79287654321');
  assert.equal(normalizePhone('9287654321').phone, '79287654321');
  assert.equal(normalizePhone('+7 (491) 762-49-48-473').phone, null);
  assert.match(normalizePhone('74917624948473').reason, /14 цифр/);
  assert.equal(normalizePhone('+7 928 765 43 21, +7 928 111 22 33').phone, null);   // два номера слитно
  assert.equal(normalizePhone('+375 29 123-45-67').phone, '375291234567');           // другие страны — как раньше
  assert.equal(normalizePhone('+998 90 123 45 67').phone, '998901234567');
  assert.equal(normalizePhone('12345').phone, null);
});
