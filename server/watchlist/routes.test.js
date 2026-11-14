const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { createVault } = require('./crypto');
const { registerWatchlistRoutes } = require('./routes');
const { POLICY_VERSION } = require('./policy');
const url = process.env.DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
function currentCode() {
  const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = crypto.createHmac('sha1', Buffer.from('12345678901234567890')).update(b).digest(), o = mac[19] & 15;
  return String((mac.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, '0');
}
test('общий список: реальная локальная PostgreSQL, доступ/модерация/изоляция/отзыв/шифрование', { skip: !local }, async t => {
  const schema = `watchlist_${crypto.randomBytes(6).toString('hex')}`, root = new Pool({ connectionString: url });
  let pool, server;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'watchlist-revocations-')), revocationFile = path.join(directory, 'revocations');
  fs.writeFileSync(revocationFile, '', { mode: 0o600 });
  try {
    await root.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
    await pool.query(`CREATE TABLE users(id text PRIMARY KEY,name text,email text,role text,blocked boolean DEFAULT false,password text);
      CREATE TABLE data_items(id text PRIMARY KEY,user_id text,type text,data jsonb);`);
    const hash = await bcrypt.hash('Synthetic-password', 4);
    for (const [u, role] of [['admin', 'admin'], ['owner', 'manager'], ['other', 'manager'], ['employee', 'employee'], ['investor', 'investor'], ['former_admin', 'manager']])
      await pool.query('INSERT INTO users(id,name,email,role,password) VALUES($1,$1,$2,$3,$4)', [u, u + '@synthetic.test', role, hash]);
    const customer = { id: 'client', name: 'Семёнов Тест Тестович', birthDate: '1988-01-02', phone: '79991234567', passportNumber: '003456', address: 'Закрытый адрес' };
    for (const [u, c] of [['owner', customer], ['other', { id: 'other_client', name: 'Другой Тестовый Клиент' }], ['owner', { id: 'no_year', name: customer.name }], ['owner', { id: 'extra_client', name: 'Дополнительный Тестовый Клиент', birthDate: '1991-01-01' }]])
      await pool.query("INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,'customers',$3)", [c.id, u, c]);
    for (const [id, name] of [['auto_client', 'Автоматический Тестовый Клиент'], ['queued_client', 'Очередной Тестовый Клиент'], ['off_client', 'Последующий Тестовый Клиент'], ['delete_client', 'Удаляемый Тестовый Клиент']])
      await pool.query("INSERT INTO data_items(id,user_id,type,data) VALUES($1,'owner','customers',$2)", [id, { id, name, birthDate: '1990-01-01' }]);
    await pool.query(`INSERT INTO data_items(id,user_id,type,data) VALUES('finance','owner','sales','{"totalAmount":100000,"remainingAmount":5000}')`);
    const snapshot = (await pool.query('SELECT * FROM data_items ORDER BY id')).rows;
    await t.test('обновление существующих таблиц: автопубликация выключена, старые замечания сохраняют ручную проверку', async () => {
      const { ensureTables } = require('./schema');
      await ensureTables(pool);
      await pool.query(`ALTER TABLE client_watchlist_settings DROP COLUMN auto_publish;
        ALTER TABLE client_watchlist_entries DROP COLUMN deleted_at;
        ALTER TABLE client_watchlist_entries DROP COLUMN review_required;`);
      const legacyId = crypto.randomUUID();
      await pool.query(`INSERT INTO client_watchlist_entries(id,owner_id,customer_id,status,policy_version) VALUES($1,'owner','legacy_migration','rejected',$2)`, [legacyId, POLICY_VERSION]);
      await ensureTables(pool); await ensureTables(pool);
      assert.equal((await pool.query('SELECT auto_publish FROM client_watchlist_settings')).rows[0].auto_publish, false);
      const row = (await pool.query('SELECT review_required,deleted_at FROM client_watchlist_entries WHERE id=$1', [legacyId])).rows[0];
      assert.equal(row.review_required, true); assert.equal(row.deleted_at, null);
      await pool.query('DELETE FROM client_watchlist_entries WHERE id=$1', [legacyId]);
      assert.deepEqual((await pool.query('SELECT * FROM data_items ORDER BY id')).rows, snapshot);
    });
    const config = { activeVersion: 'test', keys: { test: crypto.randomBytes(32).toString('base64') }, searchKey: crypto.randomBytes(32).toString('base64') }, vault = createVault(config);
    const app = express(); app.use(express.json());
    const auth = (req, res, next) => {
      if (!req.get('x-auth-token')) return res.sendStatus(401);
      // Заведомо устаревшая роль в токене: модуль обязан перепроверить БД.
      req.user = { id: req.get('x-auth-token'), role: 'admin' }; next();
    };
    const service = registerWatchlistRoutes(app, { pool, auth, vault, totpSecret: secret, revocationFile });
    server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    let proof;
    const req = async (user, path, body, expected = 200, withProof = false) => {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/${path}`, { method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', ...(user ? { 'x-auth-token': user } : {}), ...(withProof ? { 'x-watchlist-admin': proof } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      assert.equal(res.status, expected, `${path}: ${JSON.stringify(data)}`);
      if (res.status !== 401) assert.match(res.headers.get('cache-control'), /no-store/);
      return data;
    };
    const adm = (path, body, expected) => req('admin', 'admin/watchlist' + path, body, expected, true);
    const user = (path, body, expected) => req('owner', 'watchlist' + path, body, expected);
    let preview, first, second;
    await t.test('без доступа/с устаревшей ролью данные не выдаются; безопасное выключенное состояние', async () => {
      await req(null, 'watchlist/status', undefined, 401);
      for (const u of ['employee', 'investor', 'missing']) await req(u, 'watchlist/status', undefined, 403);
      await req('former_admin', 'admin/watchlist/lock', undefined, 403);
      const s = await user('/status'); assert.equal(s.access, null); assert.equal(s.enabled, false);
      await user('/search', { name: customer.name }, 403);
      await user('/access-request', {}); await user('/access-request', {});
      assert.equal((await user('/status')).access.status, 'requested');
      await req('other', 'watchlist/accept', { accepted: true, version: POLICY_VERSION }, 403);
      await adm('/entries', undefined, 403);
    });
    await t.test('админ: пароль + TOTP, защита повтора и привязка сессии', async () => {
      await req('admin', 'admin/watchlist/unlock', { password: 'wrong', code: currentCode() }, 403);
      const unlocked = await req('admin', 'admin/watchlist/unlock', { password: 'Synthetic-password', code: currentCode() }); proof = unlocked.proof;
      await req('admin', 'admin/watchlist/unlock', { password: 'Synthetic-password', code: currentCode() }, 403);
      await req('other', 'admin/watchlist/overview', undefined, 403, true);
      const o = await adm('/overview'); assert.equal(o.settings.mode, 'off'); assert.equal(o.protection.encryptionReady, true);
      assert.ok(!JSON.stringify(o).includes(config.searchKey));
    });
    await t.test('ручной допуск, версия правил, отдельное подтверждение основания', async () => {
      const a = (await adm('/access')).items[0]; assert.equal(a.userId, 'owner');
      await adm('/access/owner', { status: 'granted', canSearch: true, canSubmit: true, pilot: true, version: a.version, reason: 'Проверенный тестовый участник' });
      await user('/accept', { accepted: true, version: 'old' }, 400);
      await pool.query('INSERT INTO client_watchlist_acceptances(user_id,version) VALUES($1,$2)', ['owner', '2026-11-10-v1']);
      assert.equal((await user('/status')).accepted, false, 'Новый состав выдачи требует принятия обновлённых правил');
      await user('/search', { name: customer.name }, 403);
      await user('/accept', { accepted: true, version: POLICY_VERSION });
      await user('/preview', { customerId: 'client' }, 403);
      let o = await adm('/overview');
      await adm('/settings', { ...o.settings, mode: 'pilot', legalReady: false, reason: 'Проверка включения' }, 400);
      await adm('/settings', { ...o.settings, mode: 'pilot', legalReady: true, legalReference: 'Синтетическое основание и документы проверены для теста', reason: 'Изолированный тест допуска' });
      assert.equal((await user('/status')).enabled, true);
      await user('/preview', { customerId: 'other_client' }, 404);
      preview = await user('/preview', { customerId: 'client' });
      assert.deepEqual(Object.keys(preview).sort(), ['birthYear', 'customerId', 'fingerprint', 'name']);
    });
    const submit = p => ({ ...p, reason: 'overdue', basis: 'subject_consent', evidence: 'Синтетическое согласие: состав и круг получателей проверяются', note: 'Синтетическая ситуация для модерации', confirmed: true });
    await t.test('короткая форма: без основания и ситуации; описание только для другой причины; проверка администратора сохраняется', async () => {
      const p = await user('/preview', { customerId: 'extra_client' });
      const minimal = { ...p, reason: 'overdue', confirmed: true };
      await user('/entries', { ...minimal, confirmed: false }, 400);
      await user('/entries', { ...minimal, reason: 'unknown' }, 400);
      for (const value of [undefined, '', '  ', null, ['text'], 'x'.repeat(1001)]) {
        await user('/entries', { ...minimal, reason: 'other', reasonDetails: value }, 400);
      }
      // Негативные сценарии занимают лимит попыток. Следующие — отдельный сценарий.
      await pool.query("DELETE FROM client_watchlist_limits WHERE user_id='owner' AND action='submit'");
      const ordinary = await user('/entries', { ...minimal, reasonDetails: 'Старый скрытый текст не сохранять', status: 'published', basisVerified: true });
      assert.equal(ordinary.status, 'pending');
      for (const field of ['basis', 'evidence', 'note', 'reasonDetails', 'basisVerified']) assert.equal(ordinary[field], undefined);
      const encrypted = (await pool.query('SELECT payload FROM client_watchlist_entries WHERE id=$1', [ordinary.id])).rows[0].payload;
      assert.equal(vault.decrypt(ordinary.id, 'entry', encrypted).reasonDetails, undefined);
      await user(`/entries/${ordinary.id}/withdraw`, {});
      const description = 'Синтетическое описание другой причины';
      const other = await user('/entries', { ...minimal, reason: 'other', reasonDetails: description });
      assert.equal(other.reasonDetails, description);
      await adm(`/entries/${other.id}/decision`, { version: other.version, action: 'publish', basisVerified: false, note: 'Без проверки публиковать нельзя' }, 403);
      assert.equal((await user('/search', { name: p.name })).items.length, 0);
      await adm(`/entries/${other.id}/decision`, { version: other.version, action: 'needs_info', note: 'Уточните причину добавления' });
      const waiting = (await user('/mine')).items.find(e => e.id === other.id);
      await user(`/entries/${other.id}/resubmit`, { version: waiting.version, reason: 'other', reasonDetails: description, response: 'Причина уточнена автором заявки', confirmed: true });
      const updated = (await user('/mine')).items.find(e => e.id === other.id);
      assert.equal(updated.status, 'pending'); assert.equal(updated.response, 'Причина уточнена автором заявки');
      await adm(`/entries/${other.id}/decision`, { version: updated.version, action: 'publish', basisVerified: true, note: 'Синтетическая проверка перед публикацией' });
      const matches = (await user('/search', { name: p.name })).items;
      assert.equal(matches.length, 1);
      assert.deepEqual(Object.keys(matches[0]).sort(), ['birthYear', 'id', 'name', 'reason', 'reasonDetails']);
      assert.equal(matches[0].reason, 'other');
      assert.equal(matches[0].reasonDetails, description);
      assert.ok(!JSON.stringify(matches).includes('Причина уточнена автором заявки'));
      await user(`/entries/${other.id}/withdraw`, {});
      await pool.query("DELETE FROM client_watchlist_limits WHERE user_id='owner' AND action='submit'");
    });
    await t.test('заявка: серверный источник, изменения между просмотром и отправкой, защита дублей', async () => {
      await pool.query("UPDATE data_items SET data=jsonb_set(data,'{name}','\"Новое Тестовое Имя\"') WHERE id='client'");
      await user('/entries', submit(preview), 409);
      await pool.query("UPDATE data_items SET data=$1 WHERE id='client'", [customer]);
      const concurrent = await Promise.all([user('/entries', submit(preview)), user('/entries', submit(preview))]);
      first = concurrent[0]; assert.equal(first.status, 'pending'); assert.equal(concurrent[1].id, first.id);
      assert.equal((await user('/entries', submit(preview))).id, first.id);
      assert.equal((await user('/search', { name: customer.name, birthYear: 1988 })).items.length, 0);
      await req('other', `watchlist/entries/${first.id}/withdraw`, {}, 404);
      assert.equal((await req('other', 'watchlist/mine')).items.length, 0);
    });
    await t.test('модерация и поиск: ФИО/год и категория без закрытых полей, тёзки и неизвестный год', async () => {
      await adm(`/entries/${first.id}/decision`, { version: 0, action: 'publish', basisVerified: true, note: 'Проверено для теста' }, 409);
      await adm(`/entries/${first.id}/decision`, { version: first.version, action: 'publish', basisVerified: false, note: 'Проверено для теста' }, 403);
      await adm(`/entries/${first.id}/decision`, { version: first.version, action: 'publish', basisVerified: true, note: 'Проверено для теста' });
      let m = (await user('/search', { name: 'семенов тест тестович', birthYear: 1988 })).items;
      assert.equal(m.length, 1); assert.deepEqual(Object.keys(m[0]).sort(), ['birthYear', 'id', 'name', 'reason']);
      assert.equal(m[0].reason, 'overdue');
      for (const privateText of [customer.phone, customer.passportNumber, 'Синтетическое согласие', 'Синтетическая ситуация', 'Проверено для теста']) {
        if (privateText) assert.ok(!JSON.stringify(m).includes(privateText));
      }
      for (const name of ['СЕМЁНОВ ТЕСТ ТЕСТОВИЧ', '  сЕмЁнОв   ТеСт  тЕсТоВиЧ  ']) {
        const found = (await user('/search', { name, birthYear: 1988 })).items;
        assert.deepEqual(found, m, 'Регистр, Ё/Е и лишние пробелы не меняют результат');
      }
      for (const name of ['СЕМЁНОВ ТЕСТ ТЕСТОВИЧ', 'семенов тест тестович']) {
        const found = (await adm(`/entries?name=${encodeURIComponent(name)}`)).items;
        assert.equal(found.length, 1); assert.equal(found[0].id, first.id);
      }
      assert.equal((await user('/search', { name: customer.name, birthYear: 1989 })).items.length, 0);
      second = await user('/entries', submit(await user('/preview', { customerId: 'no_year' })));
      await adm(`/entries/${second.id}/decision`, { version: second.version, action: 'publish', basisVerified: true, note: 'Проверено без года' });
      m = (await user('/search', { name: customer.name, birthYear: 1989 })).items;
      assert.equal(m.length, 1); assert.equal(m[0].birthYear, null);
      await user('/search', { name: '%' }, 400);
    });
    await t.test('описание выдаётся только для other; служебные поля и старое note не раскрываются', async () => {
      const original = (await pool.query('SELECT payload FROM client_watchlist_entries WHERE id=$1', [first.id])).rows[0].payload;
      const data = vault.decrypt(first.id, 'entry', original);
      try {
        for (const reason of ['unfulfilled', undefined, 'Закрытый произвольный текст']) {
          await pool.query('UPDATE client_watchlist_entries SET payload=$2 WHERE id=$1', [first.id, vault.encrypt(first.id, 'entry', { ...data, reason, reasonDetails: 'Скрыто для стандартной или неизвестной причины' })]);
          const match = (await user('/search', { name: customer.name })).items.find(e => e.id === first.id);
          assert.deepEqual(Object.keys(match).sort(), ['birthYear', 'id', 'name', 'reason']);
          assert.equal(match.reason, reason === 'unfulfilled' ? reason : null);
          assert.ok(!JSON.stringify(match).includes('Закрытый произвольный текст'));
        }
        for (const reasonDetails of [undefined, null, 123, '', '   ', 'Текст <b>как текст</b>', 'x'.repeat(1100)]) {
          await pool.query('UPDATE client_watchlist_entries SET payload=$2 WHERE id=$1', [first.id, vault.encrypt(first.id, 'entry', { ...data, reason: 'other', reasonDetails })]);
          const match = (await user('/search', { name: customer.name })).items.find(e => e.id === first.id);
          assert.equal(match.reason, 'other');
          assert.equal(match.reasonDetails, typeof reasonDetails === 'string' && reasonDetails.trim() ? reasonDetails.trim().slice(0, 1000) : undefined);
          assert.ok(!JSON.stringify(match).includes(data.note), 'Старый приватный комментарий не заменяет описание');
          for (const field of ['note', 'evidence', 'basis', 'decision', 'response', 'customerId', 'ownerId']) assert.equal(match[field], undefined);
        }
      } finally {
        await pool.query('UPDATE client_watchlist_entries SET payload=$2 WHERE id=$1', [first.id, original]);
      }
    });
    await t.test('уточнение заявки, повторная проверка источника, ограничение пилота и истечение админ-сессии', async () => {
      const third = await user('/entries', submit(await user('/preview', { customerId: 'extra_client' })));
      await adm(`/entries/${third.id}/decision`, { version: third.version, action: 'needs_info', note: 'Уточните основание передачи данных' });
      let e = (await user('/mine')).items.find(x => x.id === third.id);
      assert.equal(e.status, 'needs_info'); assert.ok(e.decision);
      await user(`/entries/${e.id}/resubmit`, { version: e.version, confirmed: true, evidence: 'Дополненное синтетическое основание передачи', note: 'Пояснение синтетической ситуации' });
      e = (await user('/mine')).items.find(x => x.id === e.id); assert.equal(e.status, 'pending');
      await pool.query("UPDATE data_items SET data=jsonb_set(data,'{birthDate}','\"1992-01-01\"') WHERE id='extra_client'");
      await adm(`/entries/${e.id}/decision`, { version: e.version, action: 'publish', basisVerified: true, note: 'Проверяем изменение клиента' }, 409);
      await pool.query("UPDATE data_items SET data=jsonb_set(data,'{birthDate}','\"1991-01-01\"') WHERE id='extra_client'");
      await user(`/entries/${e.id}/withdraw`, {});
      await req('other', 'watchlist/access-request', {});
      const a = (await adm('/access')).items.find(x => x.userId === 'other');
      await adm('/access/other', { status: 'granted', canSearch: true, canSubmit: true, pilot: false, version: a.version, reason: 'Допущен только после пилота' });
      await req('other', 'watchlist/accept', { accepted: true, version: POLICY_VERSION });
      assert.equal((await req('other', 'watchlist/status')).enabled, false);
      await req('other', 'watchlist/search', { name: customer.name }, 403);
      await pool.query("UPDATE client_watchlist_admin_sessions SET expires_at=now()-interval '1 second'");
      await adm('/overview', undefined, 403);
      await pool.query("UPDATE client_watchlist_admin_sessions SET expires_at=now()+interval '5 minutes'");
    });
    await t.test('дамп реестра/журнал не содержат персональные поля, нарушение целостности закрывает выдачу', async () => {
      const rows = (await pool.query('SELECT * FROM client_watchlist_entries')).rows;
      const dump = JSON.stringify(rows);
      for (const value of [customer.name, customer.phone, customer.address, '"birthYear":1988', 'Синтетическое согласие']) assert.ok(!dump.includes(value), value);
      const row = rows.find(r => r.id === first.id);
      const tampered = { ...row.payload, tag: crypto.randomBytes(16).toString('base64') };
      await pool.query('UPDATE client_watchlist_entries SET payload=$2 WHERE id=$1', [first.id, tampered]);
      await user('/search', { name: customer.name }, 503);
      await pool.query('UPDATE client_watchlist_entries SET payload=$2 WHERE id=$1', [first.id, row.payload]);
      const restoredVault = createVault(JSON.parse(JSON.stringify(config)));
      assert.equal(restoredVault.decrypt(row.id, 'entry', row.payload).identity.name, customer.name);
      const logs = JSON.stringify((await adm('/events')).items);
      assert.ok(!logs.includes(customer.name)); assert.ok(!logs.includes(customer.passportNumber));
    });
    await t.test('обращения, скрытие, отзыв выигрывает у устаревшего решения', async () => {
      await user('/appeals', { entryId: first.id, message: 'Синтетическое обращение: проверьте сведения' });
      await user('/appeals', { entryId: first.id, message: 'Повторное синтетическое обращение' });
      const a = (await adm('/appeals')).items; assert.equal(a.length, 1);
      const e = (await adm(`/entries?status=published`)).items.find(e => e.id === first.id);
      await adm(`/entries/${first.id}/decision`, { version: e.version, action: 'hide', note: 'Проверка обращения' });
      const m = (await user('/search', { name: customer.name })).items; assert.ok(!m.some(x => x.id === first.id));
      const backupRow = (await pool.query('SELECT * FROM client_watchlist_entries WHERE id=$1', [first.id])).rows[0];
      await user(`/entries/${first.id}/withdraw`, {});
      await adm(`/entries/${first.id}/decision`, { version: e.version, action: 'publish', basisVerified: true, note: 'Устаревшее решение' }, 409);
      const revoked = (await pool.query('SELECT * FROM client_watchlist_entries WHERE id=$1', [first.id])).rows[0];
      assert.equal(revoked.payload, null); assert.equal(revoked.name_index, null);
      // Воспроизводим восстановление старой SQL-копии. Отдельный журнал актуален.
      await pool.query(`UPDATE client_watchlist_entries SET status='published',payload=$2,name_index=$3,year_index=$4,version=$5,source_fingerprint=$6 WHERE id=$1`,
        [first.id, backupRow.payload, backupRow.name_index, backupRow.year_index, backupRow.version, backupRow.source_fingerprint]);
      assert.ok(!(await user('/search', { name: customer.name })).items.some(x => x.id === first.id));
      await service.maintenance();
      assert.equal((await pool.query('SELECT payload FROM client_watchlist_entries WHERE id=$1', [first.id])).rows[0].payload, null);
      await adm(`/appeals/${a[0].id}/decision`, { version: a[0].version, status: 'resolved', outcome: 'publication_stopped', response: 'Публикация отозвана автором, обращение рассмотрено' });
      assert.equal((await user('/appeals/mine')).items[0].status, 'resolved');
    });
    await t.test('автопубликация: только новые заявки, настройка только администратору, замечания не обходятся', async () => {
      await pool.query("DELETE FROM client_watchlist_limits WHERE user_id='owner' AND action='submit'");
      let o = await adm('/overview'); assert.equal(o.settings.autoPublish, false);
      const make = async id => ({ ...(await user('/preview', { customerId: id })), reason: 'overdue', confirmed: true });
      const queuedBody = await make('queued_client'), queued = await user('/entries', queuedBody);
      assert.equal(queued.status, 'pending');
      await req('owner', 'admin/watchlist/settings', { ...o.settings, autoPublish: true, reason: 'Пользователь не меняет режим' }, 403);
      await adm('/settings', { ...o.settings, autoPublish: 'true', reason: 'Проверка типа настройки' }, 400);
      await adm('/settings', { ...o.settings, autoPublish: true, reason: 'Автопубликация синтетических новых записей' });
      assert.equal((await user('/status')).autoPublish, true);
      assert.equal((await user('/entries', queuedBody)).status, 'pending', 'Старая очередь не публикуется повторным запросом');
      const autoBody = await make('auto_client'), automatic = await user('/entries', autoBody);
      assert.equal(automatic.status, 'published'); assert.equal(automatic.publicationMode, 'auto');
      const row = (await pool.query('SELECT * FROM client_watchlist_entries WHERE id=$1', [automatic.id])).rows[0];
      assert.equal(Math.round((new Date(row.expires_at) - new Date(row.published_at)) / 86400000), o.settings.publicationDays);
      assert.equal((await user('/entries', autoBody)).id, automatic.id);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM client_watchlist_events WHERE target_id=$1 AND action='ENTRY_AUTO_PUBLISHED'", [automatic.id])).rows[0].n, 1);
      assert.equal((await user('/search', { name: autoBody.name })).items[0].id, automatic.id);
      o = await adm('/overview'); const oldClientBody = { ...o.settings, reason: 'Старый клиент сохраняет настройки без нового поля' }; delete oldClientBody.autoPublish;
      await adm('/settings', oldClientBody);
      assert.equal((await adm('/overview')).settings.autoPublish, true);
      o = await adm('/overview'); await adm('/settings', { ...o.settings, autoPublish: false, reason: 'Возврат к ручной проверке' });
      const next = await user('/entries', await make('off_client')); assert.equal(next.status, 'pending');
      assert.equal((await user('/search', { name: autoBody.name })).items[0].id, automatic.id, 'Выключение не снимает существующую публикацию');
      o = await adm('/overview'); await adm('/settings', { ...o.settings, autoPublish: true, reason: 'Проверка запретов автоматического возврата' });
      await adm(`/entries/${queued.id}/decision`, { version: queued.version, action: 'needs_info', note: 'Требуется ручное уточнение' });
      let q = (await pool.query('SELECT version FROM client_watchlist_entries WHERE id=$1', [queued.id])).rows[0];
      await user(`/entries/${queued.id}/resubmit`, { version: q.version, response: 'Уточнение тестового клиента', confirmed: true });
      assert.equal((await pool.query('SELECT status FROM client_watchlist_entries WHERE id=$1', [queued.id])).rows[0].status, 'pending');
      await adm(`/entries/${automatic.id}/decision`, { version: automatic.version, action: 'hide', note: 'Скрыто для ручной проверки' });
      assert.equal((await user('/entries', autoBody)).status, 'hidden');
      await user(`/entries/${automatic.id}/withdraw`, {});
      const repeated = await user('/entries', autoBody);
      assert.equal(repeated.status, 'pending', 'Повторная отправка после замечания требует ручной проверки');
      await user(`/entries/${repeated.id}/withdraw`, {});
      await user(`/entries/${next.id}/withdraw`, {});
      await pool.query("DELETE FROM client_watchlist_limits WHERE user_id='owner' AND action='submit'");
    });
    await t.test('удаление администратором: права, версия, очистка, защита от восстановления и повторного авторазмещения', async () => {
      const body = { ...(await user('/preview', { customerId: 'delete_client' })), reason: 'other', reasonDetails: 'Синтетическая удаляемая причина', confirmed: true };
      const published = await user('/entries', body); assert.equal(published.status, 'published');
      const backup = (await pool.query('SELECT * FROM client_watchlist_entries WHERE id=$1', [published.id])).rows[0];
      const deletion = { version: published.version, confirmed: true };
      await req('owner', `admin/watchlist/entries/${published.id}/delete`, deletion, 403);
      await req('former_admin', `admin/watchlist/entries/${published.id}/delete`, deletion, 403, true);
      await req('admin', `admin/watchlist/entries/${published.id}/delete`, deletion, 403);
      await adm(`/entries/${published.id}/delete`, { ...deletion, confirmed: false }, 400);
      await adm(`/entries/${published.id}/delete`, { ...deletion, version: 0 }, 409);
      await adm(`/entries/${published.id}/delete`, deletion);
      const erased = (await pool.query('SELECT * FROM client_watchlist_entries WHERE id=$1', [published.id])).rows[0];
      for (const key of ['payload', 'name_index', 'year_index', 'source_fingerprint']) assert.equal(erased[key], null);
      assert.ok(erased.deleted_at); assert.equal(erased.review_required, true);
      assert.equal((await user('/search', { name: body.name })).items.length, 0);
      const own = (await user('/mine')).items.find(e => e.id === published.id);
      assert.equal(own.status, 'deleted'); assert.notEqual(own.name, body.name);
      assert.ok((await adm('/entries?status=deleted')).items.some(e => e.id === published.id));
      assert.ok(!(await adm('/entries?status=terminated')).items.some(e => e.id === published.id));
      await adm(`/entries/${published.id}/delete`, deletion);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM client_watchlist_events WHERE target_id=$1 AND action='ENTRY_DELETED'", [published.id])).rows[0].n, 1);
      await adm(`/entries/${published.id}/decision`, { version: erased.version, action: 'publish', basisVerified: true, note: 'Удалённую запись вернуть нельзя' }, 409);
      await user(`/entries/${published.id}/withdraw`, {});
      assert.equal((await user('/mine')).items.find(e => e.id === published.id).status, 'deleted');
      const again = await user('/entries', body); assert.equal(again.status, 'pending');
      await user(`/entries/${again.id}/withdraw`, {});
      await pool.query(`UPDATE client_watchlist_entries SET status='published',deleted_at=NULL,payload=$2,name_index=$3,year_index=$4,source_fingerprint=$5,version=$6 WHERE id=$1`,
        [backup.id, backup.payload, backup.name_index, backup.year_index, backup.source_fingerprint, backup.version]);
      assert.equal((await user('/search', { name: body.name })).items.length, 0, 'Старый бэкап не возвращает удалённую публикацию');
      await service.maintenance();
      const queued = (await pool.query("SELECT id,version FROM client_watchlist_entries WHERE customer_id='queued_client' AND status='pending'")).rows[0];
      await adm(`/entries/${queued.id}/delete`, { version: queued.version, confirmed: true });
      assert.equal((await pool.query('SELECT payload FROM client_watchlist_entries WHERE id=$1', [queued.id])).rows[0].payload, null);
      const o = await adm('/overview'); await adm('/settings', { ...o.settings, autoPublish: false, reason: 'Завершение изолированной проверки' });
      await pool.query("DELETE FROM client_watchlist_limits WHERE user_id='owner' AND action='submit'");
    });
    await t.test('повреждение независимого журнала останавливает поиск, но не управление паузой', async () => {
      const saved = fs.readFileSync(revocationFile, 'utf8');
      fs.appendFileSync(revocationFile, 'incomplete');
      await user('/search', { name: customer.name }, 503);
      assert.equal((await user('/status')).enabled, false);
      const o = await adm('/overview');
      await adm('/settings', { ...o.settings, mode: 'off', searchPaused: true, reason: 'Приостановка при повреждении журнала' });
      fs.writeFileSync(revocationFile, saved);
      const n = await adm('/overview'); await adm('/settings', { ...n.settings, mode: 'pilot', searchPaused: false, reason: 'Журнал восстановлен для синтетического теста' });
    });
    await t.test('ограничения не обходятся API; отзыв доступен при паузе/без новых правил; финансы неизменны', async () => {
      let o = await adm('/overview');
      await adm('/settings', { ...o.settings, searchLimit: 1, reason: 'Лимит синтетического теста' });
      await user('/search', { name: customer.name }, 429);
      o = await adm('/overview'); await adm('/settings', { ...o.settings, searchPaused: true, reason: 'Приостановка для теста' });
      await user('/search', { name: customer.name }, 403);
      await pool.query('DELETE FROM client_watchlist_acceptances WHERE user_id=$1', ['owner']);
      await pool.query("UPDATE client_watchlist_access SET status='revoked' WHERE user_id='owner'");
      await user(`/entries/${second.id}/withdraw`, {});
      await user('/preview', { customerId: 'client' }, 403);
      assert.deepEqual((await pool.query('SELECT * FROM data_items ORDER BY id')).rows, snapshot);
      await pool.query("UPDATE users SET role='manager' WHERE id='admin'");
      await adm('/overview', undefined, 403);
    });
    await t.test('отсутствие ключей не создаёт открытого хранения, но отзыв остаётся возможен', async () => {
      const app2 = express(); app2.use(express.json());
      registerWatchlistRoutes(app2, { pool, auth, vault: null, totpSecret: secret, revocationFile });
      const s = await new Promise(r => { const x = app2.listen(0, '127.0.0.1', () => r(x)); });
      try {
        const call = async (path, data) => fetch(`http://127.0.0.1:${s.address().port}/api/watchlist${path}`, { method: 'POST', headers: { 'x-auth-token': 'owner', 'content-type': 'application/json' }, body: JSON.stringify(data) });
        assert.equal((await call('/entries', submit(preview))).status, 503);
        assert.equal((await call(`/entries/${first.id}/withdraw`, {})).status, 200);
      } finally { await new Promise(r => s.close(r)); }
    });
    await service.maintenance();
  } finally {
    if (server) await new Promise(r => server.close(r));
    if (pool) await pool.end();
    await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await root.end();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
