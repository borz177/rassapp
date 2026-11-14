const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRevocations } = require('./revocations');
const { spawnSync } = require('node:child_process');

test('независимый журнал: восстановление, повторный отзыв, повреждение/отсутствие/неверные права закрывают поиск', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchlist-ledger-')), file = path.join(dir, 'revocations');
  try {
    const a = crypto.randomUUID(), b = crypto.randomUUID();
    const ledger = createRevocations(file); assert.throws(() => ledger.read());
    fs.writeFileSync(file, '', { mode: 0o600 }); ledger.add(a); ledger.add(a); ledger.add(b);
    assert.deepEqual([...createRevocations(file).read()], [a, b]);
    assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 2);
    fs.chmodSync(file, 0o644); assert.throws(() => ledger.read()); fs.chmodSync(file, 0o600);
    fs.appendFileSync(file, 'partial'); assert.throws(() => ledger.read());
    fs.writeFileSync(file, a + '|invalid\n'); assert.throws(() => ledger.read());
    assert.throws(() => ledger.add('not-an-id'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('установка и ротация: секреты только в защищённых файлах; повторный init не заменяет ключи', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchlist-setup-'));
  const setup = path.join(__dirname, 'setup.cjs');
  try {
    const init = spawnSync(process.execPath, [setup, 'init', dir], { encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);
    const c = JSON.parse(fs.readFileSync(path.join(dir, 'keys.json'))), secret = fs.readFileSync(path.join(dir, 'admin-totp'), 'utf8');
    const output = init.stdout + init.stderr;
    assert.ok(!output.includes(c.searchKey)); assert.ok(!output.includes(c.keys.v1)); assert.ok(!output.includes(secret));
    for (const f of fs.readdirSync(dir)) assert.equal(fs.statSync(path.join(dir, f)).mode & 0o777, 0o600);
    const again = spawnSync(process.execPath, [setup, 'init', dir], { encoding: 'utf8' }); assert.notEqual(again.status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'keys.json'))), c);
    const rotated = spawnSync(process.execPath, [setup, 'rotate', dir], { encoding: 'utf8' }); assert.equal(rotated.status, 0, rotated.stderr);
    const next = JSON.parse(fs.readFileSync(path.join(dir, 'keys.json')));
    assert.notEqual(next.activeVersion, c.activeVersion); assert.equal(next.searchKey, c.searchKey); assert.equal(next.keys.v1, c.keys.v1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
