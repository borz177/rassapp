const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createVault, loadVault, totpCounter } = require('./crypto');
const { identity, normalizeName, birthYear } = require('./policy');
const config = () => ({ activeVersion: 'v1', keys: { v1: crypto.randomBytes(32).toString('base64') }, searchKey: crypto.randomBytes(32).toString('base64') });

test('AES-GCM: уникальный nonce, привязка к записи/назначению, подмена и неверный ключ', () => {
  const v = createVault(config()), data = { name: 'Синтетический Тест', birthYear: 1988 };
  const a = v.encrypt('one', 'entry', data), b = v.encrypt('one', 'entry', data);
  assert.notEqual(a.iv, b.iv); assert.deepEqual(v.decrypt('one', 'entry', a), data);
  assert.ok(!JSON.stringify(a).includes(data.name));
  assert.throws(() => v.decrypt('two', 'entry', a));
  assert.throws(() => v.decrypt('one', 'appeal', a));
  assert.throws(() => v.decrypt('one', 'entry', { ...a, tag: crypto.randomBytes(16).toString('base64') }));
  assert.throws(() => v.decrypt('one', 'entry', { ...a, value: a.value.slice(1) }));
  assert.throws(() => createVault(config()).decrypt('one', 'entry', a));
  assert.notEqual(v.index('name', 'a'), v.index('source', 'a'));
  assert.notEqual(v.index('name', 'a'), createVault(config()).index('name', 'a'));
});
test('ключи: отдельный поисковый ключ, права файла, отсутствие ключа, смена версии и восстановление', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchlist-keys-')), file = path.join(dir, 'keys.json');
  try {
    const c = config(), old = createVault(c), encrypted = old.encrypt('x', 'entry', { name: 'Тест' });
    assert.throws(() => createVault({ ...c, searchKey: c.keys.v1 }));
    assert.throws(() => createVault({ ...c, keys: { v1: 'invalid' } }));
    assert.equal(loadVault(file), null);
    fs.writeFileSync(file, JSON.stringify(c), { mode: 0o600 });
    assert.deepEqual(loadVault(file).decrypt('x', 'entry', encrypted), { name: 'Тест' });
    fs.chmodSync(file, 0o644); assert.equal(loadVault(file), null); fs.chmodSync(file, 0o600);
    const rotated = createVault({ ...c, activeVersion: 'v2', keys: { ...c.keys, v2: crypto.randomBytes(32).toString('base64') } });
    assert.deepEqual(rotated.decrypt('x', 'entry', encrypted), { name: 'Тест' });
    assert.equal(rotated.encrypt('x', 'entry', {}).v, 'v2');
    assert.equal(old.index('name', 'Тест'), rotated.index('name', 'Тест'));
    assert.throws(() => createVault({ ...c, activeVersion: 'v2', keys: { v2: crypto.randomBytes(32).toString('base64') } }).decrypt('x', 'entry', encrypted));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('TOTP по RFC 6238, неверный код/секрет и минимальные поисковые данные', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(totpCounter(secret, '287082', 59000), 1);
  assert.equal(totpCounter(secret, '000000', 59000), null);
  assert.equal(totpCounter('bad', '287082', 59000), null);
  assert.equal(normalizeName('  СемЁнов  Тест  Тестович '), 'семенов тест тестович');
  assert.deepEqual(identity({ name: 'Тестов Тест', birthDate: '1988-01-02', passportNumber: 'secret' }), { name: 'Тестов Тест', birthYear: 1988 });
  assert.deepEqual(identity({ name: 'Тестов Тест', birthDate: '02.01.1988' }), { name: 'Тестов Тест', birthYear: 1988 });
  assert.equal(identity({ name: 'Тестов Тест' }).birthYear, null);
  assert.throws(() => normalizeName('Тест123'));
  assert.throws(() => birthYear('1988 OR 1=1'));
});
