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
const { POLICY_VERSION, PREVIOUS_POLICY_VERSION } = require('./policy');
const acceptRules = { accepted: true, version: POLICY_VERSION, shownVersion: POLICY_VERSION };
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
    await pool.query(`CREATE TABLE users(id text PRIMARY KEY,name text,email text,role text,blocked boolean DEFAULT false,password text,subscription jsonb DEFAULT '{"plan":"BUSINESS","expiresAt":"2099-01-01T00:00:00Z"}');
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
      await req('other', 'watchlist/accept', acceptRules, 403);
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
    await t.test('администратор входит без заявки; закрытый режим не открывает доступ участникам и не публикует записи', async () => {
      const status = await req('admin','watchlist/status');
      assert.equal(status.adminAccess,true);assert.equal(status.adminOnly,true);assert.equal(status.enabled,true);assert.equal(status.access.status,'granted');assert.equal(status.accepted,false);
      await req('admin','watchlist/access-request',{});
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM client_watchlist_access WHERE user_id='admin'")).rows[0].n,0);
      await req('admin','watchlist/search',{name:customer.name},403);
      await req('admin','watchlist/accept',acceptRules);
      const found=await req('admin','watchlist/search',{name:customer.name});assert.deepEqual(found.items,[]);
      await pool.query("INSERT INTO data_items(id,user_id,type,data) VALUES('admin_client','admin','customers',$1)",[JSON.stringify({id:'admin_client',name:'Административный Тестовый Клиент',birthDate:'1990-01-01'})]);
      const p=await req('admin','watchlist/preview',{customerId:'admin_client'});
      // Даже если старый флаг автопубликации включён, режим off/нет основания
      // не должны превратить административную подготовку в общую публикацию.
      await pool.query('UPDATE client_watchlist_settings SET auto_publish=true WHERE id=1');
      const submitted=await req('admin','watchlist/entries',{customerId:p.customerId,fingerprint:p.fingerprint,reason:'overdue',confirmed:true});
      assert.equal(submitted.status,'pending');assert.equal(submitted.publicationMode,undefined);
      await adm(`/entries/${submitted.id}/decision`,{action:'publish',version:submitted.version,basisVerified:true,note:'Проверка запрета публикации'},403);
      const normal=await user('/status');assert.equal(normal.adminAccess,false);assert.equal(normal.enabled,false);
      await user('/search',{name:customer.name},403);
      await req('admin','watchlist/preview',{customerId:'client'},404);
      await pool.query("UPDATE users SET role='manager' WHERE id='admin'");
      const downgraded=await req('admin','watchlist/status');assert.equal(downgraded.adminAccess,false);assert.equal(downgraded.access,null);
      await req('admin','watchlist/search',{name:customer.name},403);
      await pool.query("UPDATE users SET role='admin' WHERE id='admin'");
      await pool.query("UPDATE users SET blocked=true WHERE id='admin'");await req('admin','watchlist/status',undefined,403);
      await pool.query("UPDATE users SET blocked=false WHERE id='admin'");
      await pool.query('DELETE FROM client_watchlist_entries WHERE id=$1',[submitted.id]);
      await pool.query("DELETE FROM data_items WHERE id='admin_client'");
      await pool.query('UPDATE client_watchlist_settings SET auto_publish=false WHERE id=1');
      assert.deepEqual((await pool.query('SELECT * FROM data_items ORDER BY id')).rows,snapshot);
    });
    await t.test('ручной допуск, версия правил, отдельное подтверждение основания', async () => {
      const a = (await adm('/access')).items[0]; assert.equal(a.userId, 'owner');
      await adm('/access/owner', { status: 'granted', canSearch: true, canSubmit: true, pilot: true, version: a.version, reason: 'Проверенный тестовый участник' });
      await user('/accept', { accepted: true, version: 'old' }, 400);
      await user('/accept', { accepted: true, version: POLICY_VERSION }, 400);
      await pool.query('INSERT INTO client_watchlist_acceptances(user_id,version) VALUES($1,$2)', ['owner', PREVIOUS_POLICY_VERSION]);
      assert.equal((await user('/status')).accepted, false, 'Новый состав выдачи требует принятия обновлённых правил');
      await user('/search', { name: customer.name }, 403);
      await user('/accept', acceptRules);
      await user('/preview', { customerId: 'client' }, 403);
      let o = await adm('/overview');
      await adm('/settings', { ...o.settings, mode: 'pilot', legalReady: false, reason: 'Проверка включения' }, 400);
      await adm('/settings', { ...o.settings, mode: 'pilot', legalReady: true, legalReference: 'Синтетическое основание и документы проверены для теста', reason: 'Изолированный тест допуска' });
      assert.equal((await user('/status')).enabled, true);
      await user('/preview', { customerId: 'other_client' }, 404);
      preview = await user('/preview', { customerId: 'client' });
      assert.deepEqual(Object.keys(preview).sort(), ['birthYear', 'customerId', 'fingerprint', 'name']);
    });
    await t.test('поиск по странице и агенту требует действующий тариф помимо допуска', async () => {
      for(const subscription of [null, {plan:'BUSINESS',expiresAt:'2020-01-01'}, {plan:'BUSINESS',expiresAt:'invalid'}]) {
        await pool.query("UPDATE users SET subscription=$1 WHERE id='owner'",[subscription]);
        await user('/search',{name:customer.name},403);
        await assert.rejects(service.searchForAgent('owner',{name:customer.name}),error=>error.status===403&&/подписка/.test(error.message));
      }
      await pool.query("UPDATE users SET subscription=$1 WHERE id='owner'",[{plan:'BUSINESS',expiresAt:'2099-01-01'}]);
      assert.deepEqual((await service.searchForAgent('owner',{name:customer.name})).items,[]);
      await user('/search',{name:customer.name});
      await assert.rejects(service.searchForAgent('other',{name:customer.name}),{status:403});
    });
    const submit = p => ({ ...p, reason: 'overdue', basis: 'subject_consent', evidence: 'Синтетическое согласие: состав и круг получателей проверяются', note: 'Синтетическая ситуация для модерации', confirmed: true });
    await t.test('агент готовит форму в пределах своего аккаунта и текущего допуска без запроса к модели', async () => {
      const jwt = require('jsonwebtoken');
      const assistant = require('../ai/assistant').createAssistant({
        pool, jwt, jwtSecret: 'synthetic-watchlist', port: server.address().port, checkWatchlistSubmission: service.checkSubmissionAccess,
      });
      const run = require('../ai/runAssistant').createAssistantRunner({
        pool, assistant, state: async () => ({ allowedRole: true, consent: true, left: 0 }), month: () => '2026-11',
      });
      const ask = (text, userId = 'owner', options = {}) => run({ userId, text, mode: 'auto', ...options });
      const entriesBefore = (await pool.query('SELECT id FROM client_watchlist_entries ORDER BY id')).rows;
      const denied = await ask('Добавь Дополнительного в ЧС', 'other');
      assert.deepEqual(denied.actions, []);
      assert.match(denied.reply, /доступ администратора/);
      const ready = await ask('Занеси дополнительного тестового клиента в чёрный список: не вернул товар');
      assert.equal(ready.left, 0);
      assert.equal(ready.modelUsed, false);
      assert.deepEqual(ready.actions.map(({ kind, customerId }) => ({ kind, customerId })), [{ kind: 'watchlist_prepare', customerId: 'extra_client' }]);
      assert.deepEqual(ready.actions[0].watchlistReason, { reason: 'other', reasonDetails: 'не вернул товар' });
      assert.deepEqual((await ask('Добавь Семёнова в ЧС')).actions, [], 'Одинаковые ФИО требуют перехода на нужную карточку');
      const ambiguous = await ask('Добавь тестового в ЧС за длительную просрочку');
      assert.equal(ambiguous.actions[0].kind, 'choices');
      assert.deepEqual(ambiguous.actions[0].watchlistReason, { reason: 'overdue' });
      const option = ambiguous.actions[0].options.find(o => o.ref === 'watchlist:extra_client');
      assert.equal((await ask(`${option.label} [${option.ref}]`)).actions[0].customerId, 'extra_client');
      assert.deepEqual((await ask('Чужой клиент [watchlist:other_client]')).actions, []);
      assert.deepEqual((await ask('Добавь в ЧС всех клиентов')).actions, []);
      assert.deepEqual((await ask('Добавь Дополнительного в ЧС', 'owner', { allowWrites: false })).actions, []);
      try {
        await pool.query('UPDATE client_watchlist_settings SET submissions_paused=true WHERE id=1');
        assert.match((await ask(`${option.label} [${option.ref}]`)).reply, /временно приостановлен/);
      } finally {
        await pool.query('UPDATE client_watchlist_settings SET submissions_paused=false WHERE id=1');
      }
      assert.deepEqual((await pool.query('SELECT id FROM client_watchlist_entries ORDER BY id')).rows, entriesBefore);
      assert.deepEqual((await pool.query('SELECT * FROM data_items ORDER BY id')).rows, snapshot);
    });
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
      assert.deepEqual(Object.keys(matches[0]).sort(), ['birthYear', 'id', 'name', 'publishedAt', 'reason', 'reasonDetails']);
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
      assert.equal(m.length, 1); assert.deepEqual(Object.keys(m[0]).sort(), ['birthYear', 'id', 'name', 'publishedAt', 'reason']);
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
    await t.test('предпросмотр предупреждает о совпадении ФИО из другого аккаунта только при доступном поиске', async () => {
      const customerId = 'other_client';
      const original = (await pool.query('SELECT data FROM data_items WHERE id=$1', [customerId])).rows[0].data;
      const check = () => req('other', 'watchlist/preview', { customerId, checkPublishedName: true });
      const settings = (await pool.query('SELECT search_limit,search_paused FROM client_watchlist_settings WHERE id=1')).rows[0];
      try {
        await pool.query("INSERT INTO client_watchlist_access(user_id,status,can_search,pilot) VALUES('other','granted',false,true)");
        await req('other', 'watchlist/accept', acceptRules);
        await pool.query('UPDATE data_items SET data=$1 WHERE id=$2',
          [{ ...original, name: 'СЕМЕНОВ  ТЕСТ ТЕСТОВИЧ', birthDate: '1995-03-02' }, customerId]);
        assert.equal((await check()).hasPublishedNameMatch, undefined);
        await pool.query("UPDATE client_watchlist_access SET can_search=true WHERE user_id='other'");
        const matched = await check();
        assert.equal(matched.hasPublishedNameMatch, true);
        assert.deepEqual(Object.keys(matched).sort(), ['birthYear', 'customerId', 'fingerprint', 'hasPublishedNameMatch', 'name']);
        assert.equal(matched.birthYear, 1995);
        assert.equal((await req('other', 'watchlist/preview', { customerId })).hasPublishedNameMatch, undefined);
        await req('other', 'watchlist/preview', { customerId: 'client', checkPublishedName: true }, 404);
        await pool.query('UPDATE client_watchlist_settings SET search_paused=true WHERE id=1');
        assert.equal((await check()).hasPublishedNameMatch, undefined);
        await pool.query('UPDATE client_watchlist_settings SET search_paused=false,search_limit=1 WHERE id=1');
        assert.equal((await check()).hasPublishedNameMatch, undefined);
        await req('other', 'watchlist/search', { name: original.name }, 429);
        await pool.query("DELETE FROM client_watchlist_limits WHERE user_id='other' AND action='search'");
        await pool.query('UPDATE data_items SET data=$1 WHERE id=$2', [original, customerId]);
        assert.equal((await check()).hasPublishedNameMatch, false);
      } finally {
        await pool.query('UPDATE data_items SET data=$1 WHERE id=$2', [original, customerId]);
        await pool.query('UPDATE client_watchlist_settings SET search_limit=$1,search_paused=$2 WHERE id=1', [settings.search_limit, settings.search_paused]);
        await pool.query("DELETE FROM client_watchlist_limits WHERE user_id='other' AND action='search'");
        await pool.query("DELETE FROM client_watchlist_acceptances WHERE user_id='other'");
        await pool.query("DELETE FROM client_watchlist_access WHERE user_id='other'");
      }
    });
    await t.test('описание выдаётся только для other; служебные поля и старое note не раскрываются', async () => {
      const original = (await pool.query('SELECT payload FROM client_watchlist_entries WHERE id=$1', [first.id])).rows[0].payload;
      const data = vault.decrypt(first.id, 'entry', original);
      try {
        for (const reason of ['unfulfilled', undefined, 'Закрытый произвольный текст']) {
          await pool.query('UPDATE client_watchlist_entries SET payload=$2 WHERE id=$1', [first.id, vault.encrypt(first.id, 'entry', { ...data, reason, reasonDetails: 'Скрыто для стандартной или неизвестной причины' })]);
          const match = (await user('/search', { name: customer.name })).items.find(e => e.id === first.id);
          assert.deepEqual(Object.keys(match).sort(), ['birthYear', 'id', 'name', 'publishedAt', 'reason']);
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
      await req('other', 'watchlist/accept', acceptRules);
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
    await t.test('публикация до удаления: поиск и обращения после 120 дней, продление активных и запрет восстановления', async () => {
      await pool.query("DELETE FROM client_watchlist_limits WHERE user_id='owner' AND action IN ('submit','search')");
      const originalSettings=(await adm('/overview')).settings, ids=[];
      const sourceIds=['term_client','term_auto_client'];
      try {
        for(const cid of sourceIds)await pool.query("INSERT INTO data_items(id,user_id,type,data) VALUES($1,'owner','customers',$2)",[cid,JSON.stringify({id:cid,name:cid==='term_client'?'Срочный Тестовый Клиент':'Бессрочный Тестовый Клиент',birthDate:'1992-01-01'})]);
        let o=await adm('/overview');await adm('/settings',{...o.settings,autoPublish:false,reason:'Ручная публикация для проверки срока'});
        const initial=await user('/entries',submit(await user('/preview',{customerId:sourceIds[0]})));ids.push(initial.id);
        await adm(`/entries/${initial.id}/decision`,{action:'publish',version:initial.version,basisVerified:true,note:'Синтетическое проверенное основание'});
        const finite=(await pool.query('SELECT * FROM client_watchlist_entries WHERE id=$1',[initial.id])).rows[0];assert(finite.expires_at);
        const copies={};
        for(const state of ['hidden','expired','revoked','overdue']){
          const eid=crypto.randomUUID();ids.push(eid);copies[state]=eid;
          await pool.query(`INSERT INTO client_watchlist_entries(id,owner_id,customer_id,payload,name_index,year_index,source_fingerprint,status,policy_version,published_at,expires_at)
            VALUES($1,'owner',$2,$3,$4,$5,$6,$7,$8,now(),now()+interval '90 days')`,[eid,'term_'+state,vault.encrypt(eid,'entry',vault.decrypt(finite.id,'entry',finite.payload)),finite.name_index,finite.year_index,finite.source_fingerprint,['revoked','overdue'].includes(state)?'published':state,POLICY_VERSION]);
          if(state==='revoked')require('./revocations').createRevocations(revocationFile).add(eid);
          if(state==='overdue')await pool.query("UPDATE client_watchlist_entries SET expires_at=now()-interval '1 day' WHERE id=$1",[eid]);
        }
        o=await adm('/overview');await adm('/settings',{...o.settings,publicationUntilRemoved:'true',reason:'Неверный тип режима'},400);
        await adm('/settings',{...o.settings,publicationUntilRemoved:true,reason:'Публикации до ручного удаления'});
        const rows=(await pool.query('SELECT id,expires_at,status,payload FROM client_watchlist_entries WHERE id=ANY($1::text[])',[ids])).rows;
        assert.equal(rows.find(r=>r.id===initial.id).expires_at,null);assert.deepEqual(rows.find(r=>r.id===initial.id).payload,finite.payload);
        assert.equal(rows.find(r=>r.id===copies.hidden).expires_at,null);
        assert(rows.find(r=>r.id===copies.expired).expires_at);assert(rows.find(r=>r.id===copies.revoked).expires_at);
        assert(rows.find(r=>r.id===copies.overdue).expires_at,'Истёкшую дату не продлеваем даже до фонового снятия публикации');
        await pool.query("UPDATE client_watchlist_entries SET published_at=now()-interval '120 days',updated_at=now()-interval '120 days' WHERE id=$1",[initial.id]);
        await service.maintenance();
        const live=(await pool.query('SELECT status,payload,expires_at FROM client_watchlist_entries WHERE id=$1',[initial.id])).rows[0];assert.equal(live.status,'published');assert(live.payload);assert.equal(live.expires_at,null);
        const found=await user('/search',{name:'Срочный Тестовый Клиент'});assert(found.items.some(r=>r.id===initial.id));assert(!found.items.some(r=>r.id===copies.revoked));
        const own=(await user('/mine')).items.find(r=>r.id===initial.id);assert.equal(own.status,'published');assert.equal(own.expiresAt,null);
        await req('other','watchlist/appeals',{entryId:initial.id,message:'Синтетическое обращение о бессрочной публикации'});
        o=await adm('/overview');assert.equal(o.settings.publicationUntilRemoved,true);
        const oldClient={...o.settings,autoPublish:true,reason:'Старая версия сохраняет остальные настройки'};delete oldClient.publicationUntilRemoved;
        await adm('/settings',oldClient);assert.equal((await adm('/overview')).settings.publicationUntilRemoved,true);
        const automatic=await user('/entries',submit(await user('/preview',{customerId:sourceIds[1]})));ids.push(automatic.id);assert.equal(automatic.status,'published');assert.equal(automatic.expiresAt,null);
        o=await adm('/overview');await adm('/settings',{...o.settings,publicationUntilRemoved:false,reason:'Ограниченный срок только для следующих публикаций'});
        assert.equal((await pool.query('SELECT expires_at FROM client_watchlist_entries WHERE id=$1',[automatic.id])).rows[0].expires_at,null,'Сохранённая бессрочная публикация не получает срок задним числом');
        await user(`/entries/${initial.id}/withdraw`,{});assert(!(await user('/search',{name:'Срочный Тестовый Клиент'})).items.some(r=>r.id===initial.id));
      } finally {
        await pool.query('DELETE FROM client_watchlist_entries WHERE id=ANY($1::text[])',[ids]);
        await pool.query('DELETE FROM data_items WHERE id=ANY($1::text[])', [sourceIds]);
        const o=await adm('/overview');await adm('/settings',{...o.settings,publicationUntilRemoved:originalSettings.publicationUntilRemoved,autoPublish:originalSettings.autoPublish,reason:'Завершение проверки срока публикации'});
      }
      assert.deepEqual((await pool.query('SELECT * FROM data_items ORDER BY id')).rows,snapshot);
    });
    await t.test('общие правила публикации и показ опубликованного поручителя рядом с клиентом', async () => {
      const customerId = 'guarantor_test_client', saleId = 'guarantor_test_sale', foreignSale = 'guarantor_test_foreign';
      const buyer = { id: customerId, name: 'Покупатель Тест Новый' };
      const sale = { type: 'INSTALLMENT', customerId, status: 'ACTIVE', startDate: '2026-01-02', productName: 'Тестовый товар',
        guarantorName: 'Поручитель Тест Новый', guarantorPhone: '79990000000', guarantorPassportNumber: '001234' };
      const original = (await adm('/overview')).settings;
      const ids = [];
      const clearQuota = () => pool.query("DELETE FROM client_watchlist_limits WHERE user_id='owner' AND action='submit'");
      try {
        await clearQuota();
        await pool.query("INSERT INTO data_items(id,user_id,type,data) VALUES($1,'owner','customers',$2),($3,'owner','sales',$4),($5,'other','sales',$4)",
          [customerId, buyer, saleId, sale, foreignSale]);
        await adm('/settings', { ...original, autoPublish: false, reason: 'Проверка ручного режима для обеих записей' });
        const p = await user('/preview', { customerId, includeGuarantors: true });
        assert.equal(p.guarantors.length, 1);
        const g = p.guarantors[0];
        assert.equal(g.saleId, saleId);
        assert.deepEqual(Object.keys(g).sort(), ['fingerprint', 'name', 'product', 'saleId', 'startDate']);
        const body = { customerId, fingerprint: p.fingerprint, confirmed: true, reason: 'overdue',
          guarantor: { saleId, fingerprint: g.fingerprint, reasonDetails: 'Описание нарушения поручителя' } };
        await user('/entries', { ...body, guarantor: { ...body.guarantor, saleId: foreignSale } }, 409);
        await user('/entries', { ...body, guarantor: { ...body.guarantor, reasonDetails: '' } }, 400);
        assert.equal((await pool.query('SELECT id FROM client_watchlist_entries WHERE customer_id=$1', [customerId])).rowCount, 0);
        const pending = await user('/entries', body);
        ids.push(pending.id, pending.guarantorEntry.id);
        assert.equal(pending.status, 'pending');
        assert.equal(pending.guarantorEntry.status, 'pending');
        await user(`/entries/${pending.id}/withdraw`, {});
        await user(`/entries/${pending.guarantorEntry.id}/withdraw`, {});
        await adm('/settings', { ...(await adm('/overview')).settings, autoPublish: true, reason: 'Проверка автоматического режима для обеих записей' });
        await clearQuota();
        const result = await user('/entries', body), guarantor = result.guarantorEntry;
        ids.push(result.id, guarantor.id);
        assert.equal(result.status, 'published');
        assert.equal(guarantor.status, 'published');
        assert.equal(guarantor.publicationMode, 'auto');
        assert.equal(guarantor.subjectKind, 'guarantor');
        assert.equal(guarantor.birthYear, null);
        assert.equal(guarantor.reasonDetails, body.guarantor.reasonDetails);
        const repeated = await user('/entries', body);
        assert.equal(repeated.id, result.id);
        assert.equal(repeated.guarantorEntry.id, guarantor.id);
        assert.equal((await pool.query("SELECT count FROM client_watchlist_limits WHERE user_id='owner' AND action='submit'")).rows[0].count, 4);
        const listed = (await adm(`/entries?id=${guarantor.id}`)).items[0];
        assert.equal(listed.subjectKind, 'guarantor');
        const searchBuyer = async () => (await user('/search', { name: buyer.name })).items.find(item => item.id === result.id);
        assert.deepEqual((await searchBuyer()).guarantors, [{ id: guarantor.id, name: sale.guarantorName }]);
        await adm(`/entries/${guarantor.id}/decision`, { version: guarantor.version, action: 'hide', note: 'Скрытие поручителя в тесте' });
        assert.equal((await searchBuyer()).guarantors, undefined);
        const decision = { version: guarantor.version + 1, action: 'publish', basisVerified: true, note: 'Проверено модератором в тесте' };
        await pool.query('UPDATE data_items SET data=$1 WHERE id=$2', [{ ...sale, guarantorName: 'Заменённый Тестовый Поручитель' }, saleId]);
        await adm(`/entries/${guarantor.id}/decision`, decision, 409);
        await pool.query('UPDATE data_items SET data=$1 WHERE id=$2', [sale, saleId]);
        await adm(`/entries/${guarantor.id}/decision`, decision);
        const { items } = await user('/search', { name: sale.guarantorName });
        assert.deepEqual(items, [{ id: guarantor.id, name: sale.guarantorName, birthYear: null, publishedAt: (await pool.query('SELECT published_at FROM client_watchlist_entries WHERE id=$1',[guarantor.id])).rows[0].published_at.toISOString(), reason: 'other', reasonDetails: body.guarantor.reasonDetails }]);
        await user(`/entries/${guarantor.id}/withdraw`, {});
        assert.equal((await searchBuyer()).guarantors, undefined);
        assert.equal((await pool.query('SELECT related_client_index FROM client_watchlist_entries WHERE id=$1', [guarantor.id])).rows[0].related_client_index, null);
      } finally {
        await pool.query('DELETE FROM client_watchlist_entries WHERE id=ANY($1::text[])', [ids]);
        await pool.query('DELETE FROM data_items WHERE id=ANY($1::text[])', [[customerId, saleId, foreignSale]]);
        await adm('/settings', { ...(await adm('/overview')).settings, autoPublish: original.autoPublish, reason: 'Завершение проверки поручителя' });
        await clearQuota();
      }
    });
    await t.test('массовое добавление администратором: предпросмотр, защита, публикация и повторы без карточек клиентов', async () => {
      const path = '/entries/import';
      const importBody = {
        text: 'ФИО\tДата рождения\tПричина\r\nСписков Тест Импортович 17.04.1991 Длительная просрочка\r\nсписков  тест импортович\t1991-04-17\tДлительная просрочка\r\nПримеров Тест Импортович\t\tСинтетическое описание',
        defaultReason: 'overdue',
      };
      const old = (await adm('/overview')).settings;
      const created = [];
      try {
        await req('owner', 'admin/watchlist' + path + '/preview', importBody, 403, true);
        await req('admin', 'admin/watchlist' + path + '/preview', importBody, 403);
        const preview = await adm(path + '/preview', importBody);
        assert.equal(preview.canPublish, true);
        assert.equal(preview.rows.length, 3);
        assert.deepEqual(preview.rows.map(row => row.duplicate), [false, true, false]);
        assert.equal(preview.rows[0].birthDate, '1991-04-17');
        assert.equal(preview.rows[0].birthYear, 1991);
        assert.equal(preview.rows[2].birthYear, null);
        assert.equal(preview.rows[2].reason, 'other');
        assert.ok(!('key' in preview.rows[0]) && !('customerId' in preview.rows[0]));
        await adm(path, { ...importBody, action: 'publish', basisVerified: false }, 403);
        const bad = { ...importBody, text: importBody.text + '\nОшибка Строки 31.02.1991' };
        assert.match((await adm(path + '/preview', bad)).rows.at(-1).error, /дату рождения/);
        await adm(path, { ...bad, action: 'pending' }, 400);
        await adm(path + '/preview', { text: ('Группа Тест Импортович\n').repeat(101), defaultReason: 'overdue' }, 400);
        assert.equal((await adm('/entries?name=' + encodeURIComponent('Списков Тест Импортович'))).items.length, 0);
        const saved = await Promise.all([adm(path, { ...importBody, action: 'pending' }), adm(path, { ...importBody, action: 'pending' })]);
        assert.deepEqual(saved.map(row => row.pending).sort(), [0, 2]);
        assert.deepEqual(saved.map(row => row.skipped).sort(), [1, 3]);
        const found = (await adm('/entries?name=' + encodeURIComponent('Списков Тест Импортович'))).items[0];
        const other = (await adm('/entries?name=' + encodeURIComponent('Примеров Тест Импортович'))).items[0];
        created.push(found.id, other.id);
        assert.equal(found.adminImport, true);
        assert.equal(found.status, 'pending');
        assert.equal(found.birthDate, '1991-04-17');
        assert.equal((await req('admin', 'watchlist/mine')).items.find(row => row.id === found.id).birthDate, undefined);
        assert.equal((await user('/search', { name: found.name })).items.length, 0);
        const decision = { version: found.version, action: 'publish', basisVerified: true, note: 'Проверено основание синтетической записи' };
        await adm(`/entries/${found.id}/decision`, decision, 400);
        await pool.query('UPDATE client_watchlist_entries SET policy_version=$2 WHERE id=$1', [found.id, PREVIOUS_POLICY_VERSION]);
        await adm(`/entries/${found.id}/decision`, { ...decision, shownVersion: POLICY_VERSION });
        const match = (await user('/search', { name: found.name })).items[0];
        const publishedDate = (await pool.query('SELECT published_at FROM client_watchlist_entries WHERE id=$1',[found.id])).rows[0].published_at.toISOString();
        assert.deepEqual(match, { id: found.id, name: found.name, birthYear: found.birthYear, birthDate: '1991-04-17', publishedAt: publishedDate, reason: 'overdue' });
        await req('employee', 'watchlist/search', { name: found.name }, 403);
        await pool.query('UPDATE client_watchlist_entries SET policy_version=$2 WHERE id=$1', [found.id, PREVIOUS_POLICY_VERSION]);
        assert.equal((await user('/search', { name: found.name })).items[0].birthDate, undefined);
        await pool.query('UPDATE client_watchlist_entries SET policy_version=$2 WHERE id=$1', [found.id, POLICY_VERSION]);
        const publishBody = { text: 'Новый Тест Импортович\t1990', defaultReason: 'unfulfilled', action: 'publish', basisVerified: true };
        assert.deepEqual(await adm(path, publishBody), { published: 1, pending: 0, skipped: 0 });
        const published = (await adm('/entries?name=' + encodeURIComponent('Новый Тест Импортович'))).items[0];
        created.push(published.id);
        assert.equal(published.publicationMode, 'manual');
        const stored = (await pool.query('SELECT payload FROM client_watchlist_entries WHERE id=$1', [published.id])).rows[0];
        assert.ok(!JSON.stringify(stored).includes(published.name));
        assert.equal(vault.decrypt(published.id, 'entry', stored.payload).adminImport, true);
        const namesakeBody = { ...publishBody, text: 'Списков Тест Импортович 18.04.1991 Неисполнение обязательств' };
        await adm(path, namesakeBody, 400);
        const namesake = await adm(path, { ...namesakeBody, shownVersion: POLICY_VERSION });
        assert.deepEqual(namesake, { published: 1, pending: 0, skipped: 0 });
        const namesakes = (await adm('/entries?name=' + encodeURIComponent(found.name))).items;
        created.push(...namesakes.filter(item => item.id !== found.id).map(item => item.id));
        assert.deepEqual(namesakes.map(item => item.birthDate).sort(), ['1991-04-17', '1991-04-18']);
        const publicMatches = (await user('/search', { name: found.name, birthYear: 1991 })).items;
        assert.equal(publicMatches.length, 2);
        assert.deepEqual(publicMatches.map(item => item.birthDate).sort(), ['1991-04-17', '1991-04-18']);
        const yearOnly = await adm(path + '/preview', { text: 'Списков Тест Импортович 1991', defaultReason: 'overdue' });
        assert.equal(yearOnly.rows[0].duplicate, true);
        assert.deepEqual((await pool.query('SELECT * FROM data_items ORDER BY id')).rows, snapshot);
      } finally {
        await pool.query('DELETE FROM client_watchlist_entries WHERE id=ANY($1::text[])', [created]);
      }
    });
    await t.test('Telegram HTML: очередь, изоляция, исправления, дубликаты и отдельная ручная публикация', async () => {
      const name='Архивов Пример Тестович';
      const message=(id)=>`<div class="message default clearfix" id="message${id}"><div class="body">
        <div class="pull_right date details" title="01.04.2026 12:30:15 UTC+03:00">12:30</div>
        <div class="text"><b>ФИО:</b> ${name}<br>Дата рождения: 17.04.1991<br>Причина: Длительная просрочка
        <script>secretScript()</script><img src="https://example.invalid/archive"><a href="https://example.invalid/source">Текст &amp; символ</a></div></div></div>`;
      const html='<html><body>'+message(50)+'<div class="message service" id="message51">Системное</div>'+message(52)+'</body></html>';
      const upload=async (content, userId='admin', token=proof, expected=200, selection) => {
        const body=new FormData();
        body.append('source','Тестовый канал');
        if (selection !== undefined) body.append('selection', JSON.stringify(selection));
        body.append('archive',new Blob([content],{type:'text/html'}),'messages.html');
        const res=await fetch(`http://127.0.0.1:${server.address().port}/api/admin/watchlist/archives`,{
          method:'POST',headers:{'x-auth-token':userId,'x-watchlist-admin':token},body,
        });
        const json=await res.json();
        assert.equal(res.status,expected,JSON.stringify(json));
        return json;
      };
      async function waitArchive(id) {
        for (let attempt = 0; attempt < 75; attempt++) {
          const detail = await adm(`/archives/${id}`);
          if (['ready', 'failed'].includes(detail.job.status)) return detail;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.fail('Очередь импорта не завершилась');
      }
      await pool.query("INSERT INTO users(id,name,email,role,password) VALUES('archive_admin','Второй админ','archive@synthetic.test','admin',$1)",[hash]);
      const otherProof=(await req('archive_admin','admin/watchlist/unlock',{password:'Synthetic-password',code:currentCode()})).proof;
      const existing=(await adm('/overview')).settings;
      let entryId;
      try {
        await adm('/settings',{...existing,autoPublish:true,reason:'Синтетическая проверка запрета автопубликации'});
        await upload(html,'owner',proof,403);
        const job=await upload(html);
        assert.equal(job.status,'queued');
        assert.equal((await upload(html)).id,job.id);
        const denied=await fetch(`http://127.0.0.1:${server.address().port}/api/admin/watchlist/archives/${job.id}`,
          {headers:{'x-auth-token':'archive_admin','x-watchlist-admin':otherProof}});
        assert.equal(denied.status,404);
        let detail;
        for(let attempt=0;attempt<75;attempt++) {
          detail=await adm(`/archives/${job.id}?limit=1&offset=0`);
          if(detail.job.status==='ready' || detail.job.status==='failed') break;
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        assert.equal(detail.job.status,'ready',detail.job.error);
        assert.equal(detail.job.progress,100);
        assert.equal(detail.job.total,2);
        assert.equal(detail.hasMore,true);
        assert.equal(detail.items[0].duplicate,true,'Дубль обнаружен за пределами первой страницы');
        const row=detail.items[0];
        assert.match(row.message.text,/Текст & символ/);
        assert.doesNotMatch(row.message.text,/secretScript|example.invalid/);
        assert.equal(row.message.publishedAt,'2026-04-01T09:30:15.000Z');
        assert.equal(row.fields.name,name);
        assert.equal(row.fields.birthDate,'17.04.1991');
        const stored=(await pool.query('SELECT payload FROM client_watchlist_archive_records WHERE job_id=$1 AND ordinal=1',[job.id])).rows[0];
        assert(!JSON.stringify(stored).includes(name));
        assert.equal((await pool.query('SELECT archive FROM client_watchlist_archive_jobs WHERE id=$1',[job.id])).rows[0].archive,null);
        assert.equal((await adm('/entries?name='+encodeURIComponent(name))).items.length,0);
        const record=`/archives/${job.id}/records/1`;
        const submission={version:row.version,fields:{...row.fields,reason:'unfulfilled'},action:'submit',confirmed:true};
        await adm(record,{...submission,fields:{...submission.fields,birthDate:'31.02.1991'}},400);
        await adm(record,{...submission,confirmed:false},400);
        assert.equal((await adm(record,submission)).state,'submitted');
        assert.equal((await adm(record,submission)).state,'submitted','Повтор отправки идемпотентен');
        const entry=(await adm('/entries?name='+encodeURIComponent(name))).items[0];
        entryId=entry.id;
        assert.equal(entry.status,'pending');
        assert.equal(entry.telegramSource.source,'Тестовый канал');
        assert.equal((await user('/search',{name})).items.length,0);
        const [duplicate]=(await adm(`/archives/${job.id}?limit=1&offset=1`)).items;
        await adm(`/archives/${job.id}/records/2`,{...submission,version:duplicate.version,fields:duplicate.fields},409);
        const review=(await adm(`/archives/${job.id}`)).items[0];
        const edited=await adm(record,{...submission,version:review.version,action:'save',fields:{...submission.fields,reason:'overdue'}});
        assert.equal(edited.version,review.version+1);
        await adm(record,{...submission,version:review.version,action:'save'},409);
        const changes=(await adm(record+'/history')).items;
        assert.deepEqual(changes.map(change=>change.action),['corrected','submitted']);
        assert.equal(changes[0].before.reason,'unfulfilled');
        assert.equal(changes[0].fields.reason,'overdue');
        const fresh=(await adm('/entries?name='+encodeURIComponent(name))).items[0];
        await adm(`/entries/${fresh.id}/decision`,{version:fresh.version,action:'publish',basisVerified:true,shownVersion:POLICY_VERSION,note:'Проверено в синтетическом тесте'});
        const published=(await user('/search',{name})).items[0];
        assert.equal(published.id,entryId);
        assert.equal(published.telegramSource,undefined);
        assert.equal(published.publishedAt,'2026-04-01T09:30:15.000Z');
        assert.equal((await adm(record+'/history')).items[0].action,'publish');
        await adm(record,{...submission,version:edited.version+1,action:'save'},409);
        const active=(await adm('/entries?name='+encodeURIComponent(name))).items[0];
        assert.equal(active.publishedAt,'2026-04-01T09:30:15.000Z');
        const storedPublication=(await pool.query('SELECT published_at FROM client_watchlist_entries WHERE id=$1',[active.id])).rows[0].published_at;
        assert(Date.parse(storedPublication)>Date.parse(active.publishedAt),'Фактическая дата публикации сохраняется отдельно');
        await adm(`/entries/${active.id}/delete`,{version:active.version,confirmed:true});
        assert.equal((await adm(`/archives/${job.id}`)).items[0].state,'removed');
        assert.deepEqual((await adm(record+'/history')).items,[]);
        const originalBase = process.env.OPENROUTER_BASE_URL, originalKey = process.env.OPENROUTER_API_KEY;
        const filter = { from: '2026-04-01', to: '2026-04-01', reasons: ['overdue'], includeAny: ['ёлка'], excludeAny: ['долг погашен'], requireReason: true };
        const instruction = 'Возьми только сообщения первого апреля с длительной просрочкой и фразой ёлка, кроме погашенных долгов.';
        const model = express();
        model.use(express.json());
        const requests = [];
        model.post('/chat/completions', (request, response) => {
          requests.push(request.body);
          const value = request.body.messages.at(-1).content === instruction ? filter : { unsupported: true };
          response.json({ choices: [{ message: { content: JSON.stringify(value) } }] });
        });
        const stub = await new Promise(resolve => { const handle = model.listen(0, '127.0.0.1', () => resolve(handle)); });
        try {
          process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${stub.address().port}`;
          process.env.OPENROUTER_API_KEY = 'local-synthetic';
          await req('admin', 'admin/watchlist/archives/selection', { instruction }, 403);
          await req('owner', 'admin/watchlist/archives/selection', { instruction }, 403, true);
          const interpreted = (await adm('/archives/selection', { instruction })).selection;
          assert.deepEqual(interpreted, { ...filter, includeAny: ['елка'] });
          assert.deepEqual(requests[0].messages.filter(row => row.role === 'user'), [{ role: 'user', content: instruction }]);
          assert.equal(requests[0].provider.data_collection, 'deny');
          await adm('/archives/selection', { instruction: 'Определи поведение человека по переписке' }, 422);
          assert.equal(requests.length, 2);
          const post = (number, date, content) => `<div class="message default" id="message${number}"><div class="date details" title="${date}"></div><div class="text">${content}</div></div>`;
          const complete = 'Синтетический Тестовый Пример<br>17.04.1991<br>Причина: Длительная просрочка<br>ЁЛКА';
          const mixed = [
            post(100, '31.03.2026 21:00:00 UTC+00:00', complete),
            post(101, '01.04.2026 12:00:00 UTC+03:00', complete + '<br>Долг погашен'),
            post(102, '02.04.2026 12:00:00 UTC+03:00', complete),
            post(103, '01.04.2026 12:00:00 UTC+03:00', 'Обсуждение без карточки, ЁЛКА'),
            post(104, '01.04.2026 12:00:00 UTC+03:00', complete.replace('Длительная просрочка', 'Неисполнение обязательств')),
          ].join('');
          await upload(mixed, 'admin', proof, 400, { ...interpreted, from: '2026-04-31' });
          const selected = await upload(mixed, 'admin', proof, 200, interpreted);
          const result = await waitArchive(selected.id);
          assert.equal(result.job.status, 'ready', result.job.error);
          assert.deepEqual([result.job.scanned, result.job.total, result.items[0].message.messageId], [5, 1, '100']);
          assert.equal((await upload(mixed, 'admin', proof, 200, interpreted)).id, selected.id);
          const none = await upload(mixed, 'admin', proof, 200, { ...interpreted, includeAny: ['несуществующая фраза'] });
          const empty = await waitArchive(none.id);
          assert.notEqual(none.id, selected.id);
          assert.deepEqual([empty.job.status, empty.job.scanned, empty.job.total, empty.items.length], ['ready', 5, 0, 0]);
          assert.equal((await adm('/entries?name='+encodeURIComponent('Синтетический Тестовый Пример'))).items.length, 0);
          assert.equal(requests.length, 2, 'Архив и сообщения остаются внутри сервера');
        } finally {
          await new Promise(resolve => stub.close(resolve));
          if (originalBase === undefined) delete process.env.OPENROUTER_BASE_URL; else process.env.OPENROUTER_BASE_URL = originalBase;
          if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey;
        }
        const post = (number, text, date = '') => `<div class="message default" id="message${number}"><div class="date details" title="${date}"></div><div class="text">${text}</div></div>`;
        const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0,10);
        const anonymousDate = 'Карандашов Образец Тестович';
        const taggedName = 'Известный Учебный Тестович';
        const mixed = [
          post(200,`ФИО: ${anonymousDate}<br>Дата рождения: не указана<br>Причина: —`),
          post(201,`ФИО: ${taggedName} (06.02.1990)<br>Причина: Длительная просрочка`,'02.04.2026 10:00:00 UTC+03:00'),
          post(202,`ФИО: ${taggedName}`),
          post(203,'Проверьте сообщение в соседнем канале'),
          post(204,'ФИО: Ошибочный Учебный Тестович<br>Дата рождения: 31.02.1991'),
          ...Array.from({ length:99 }, (_, i) => post(300+i,`ФИО: Синтетический Образец Тестович${String.fromCharCode(1072+Math.floor(i/26),1072+i%26)}`)),
        ].join('');
        const bulkJob = await upload(mixed);
        const ready = await waitArchive(bulkJob.id);
        assert.deepEqual([ready.job.total, ready.job.scanned, ready.draftCount, ready.canPublish], [103,104,103,true]);
        assert.equal(ready.items[0].dateFromImport, true);
        assert.equal(new Date(Date.parse(ready.items[0].fields.publishedAt)+3*3600000).toISOString().slice(0,10),today);
        assert.equal(ready.items[0].message.publishedAt, null);
        assert.equal(ready.items[1].fields.birthDate,'06.02.1990');
        const publishPath = `/archives/${bulkJob.id}/publish`;
        const defaults = { basisVerified:true, shownVersion:POLICY_VERSION, defaultReason:'other', defaultReasonDetails:'Основание из сверенного источника' };
        await adm(publishPath, { ...defaults,basisVerified:false },403);
        await adm(publishPath, { ...defaults,shownVersion:'stale' },400);
        await adm(publishPath, { ...defaults,defaultReasonDetails:'' },400);
        const foreign = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/watchlist${publishPath}`,{
          method:'POST',headers:{'content-type':'application/json','x-auth-token':'archive_admin','x-watchlist-admin':otherProof},body:JSON.stringify(defaults),
        });
        assert.equal(foreign.status,404);
        await adm('/settings',{...(await adm('/overview')).settings,submissionsPaused:true,reason:'Проверка паузы синтетической публикации'});
        assert.equal((await adm(`/archives/${bulkJob.id}`)).canPublish,false);
        await adm(publishPath,defaults,403);
        await adm('/settings',{...(await adm('/overview')).settings,submissionsPaused:false,reason:'Восстановление после проверки паузы'});
        const allPath = `/archives/${bulkJob.id}`;
        const lastDraft = (await adm(allPath+'?offset=102&limit=1')).items[0];
        const excludePath = allPath+`/records/${lastDraft.ordinal}`;
        const excluded = await adm(excludePath,{action:'exclude',version:lastDraft.version});
        assert.equal(excluded.excluded,true);
        assert.equal((await adm(excludePath,{action:'exclude',version:lastDraft.version})).version,excluded.version);
        assert.equal((await adm(allPath+'?offset=102&limit=1')).items.length,0);
        const excludedList = await adm(allPath+'?excluded=1');
        assert.deepEqual([excludedList.excludedCount,excludedList.draftCount,excludedList.items[0].ordinal],[1,102,lastDraft.ordinal]);
        await adm(excludePath,{action:'restore',version:lastDraft.version},409);
        await adm(excludePath,{action:'submit',version:excluded.version,confirmed:true,fields:lastDraft.fields},409);
        const firstPage = await adm(publishPath,defaults);
        assert.deepEqual(firstPage,{published:98,duplicates:1,invalid:1,review:0,next:100});
        const lastPage = await adm(publishPath,{ ...defaults,after:firstPage.next });
        assert.deepEqual(lastPage,{published:2,duplicates:0,invalid:0,review:0,next:null});
        assert.equal((await adm(publishPath,defaults)).published,0);
        assert.equal((await adm('/entries?name='+encodeURIComponent(lastDraft.fields.name))).items.length,0);
        const [noBirth] = (await adm('/entries?name='+encodeURIComponent(anonymousDate))).items;
        assert.equal(noBirth.birthDate,undefined);
        assert.equal(noBirth.birthYear,null);
        assert.equal(noBirth.status,'published');
        assert.equal(noBirth.reason,'other');
        assert.equal(noBirth.reasonDetails,defaults.defaultReasonDetails);
        assert.equal(noBirth.telegramSource.dateFromImport,true);
        const actualPublication=(await pool.query('SELECT published_at FROM client_watchlist_entries WHERE id=$1',[noBirth.id])).rows[0].published_at;
        assert.equal(new Date(noBirth.publishedAt).getTime(),new Date(actualPublication).getTime());
        const [publicNoDate] = (await user('/search',{name:anonymousDate})).items;
        assert.equal(publicNoDate.publishedAt,noBirth.publishedAt);
        const [retained] = (await adm('/entries?name='+encodeURIComponent(taggedName))).items;
        assert.equal(retained.reason,'overdue');
        assert.equal(retained.telegramSource.dateFromImport,undefined);
        assert.equal((await adm(`/archives/${bulkJob.id}/records/1/history`)).items[0].action,'publish');
        const afterPublish = await adm(`/archives/${bulkJob.id}`);
        assert.equal(afterPublish.draftCount,2);
        assert.match(afterPublish.items[3].errors.join(' '),/дату рождения/);
        const restored = await adm(excludePath,{action:'restore',version:excluded.version});
        assert.equal(restored.excluded,false);
        assert.deepEqual((await adm(excludePath+'/history')).items.map(item=>item.action),['restored','excluded']);
        assert.equal((await adm(publishPath,defaults)).published,1);
        await adm(excludePath,{action:'exclude',version:restored.version+1},409);
        const rejectedName = 'Отклонённый Учебный Тестович';
        await adm('/entries/import',{text:`${rejectedName} 10.10.1990 Длительная просрочка`,action:'pending'});
        const [moderated] = (await adm('/entries?name='+encodeURIComponent(rejectedName))).items;
        await adm(`/entries/${moderated.id}/decision`,{version:moderated.version,action:'reject',note:'Синтетическое отклонение'});
        const rejectedArchive = await upload(post(501,`ФИО: ${rejectedName}`));
        await waitArchive(rejectedArchive.id);
        assert.deepEqual(await adm(`/archives/${rejectedArchive.id}/publish`,defaults),{published:0,duplicates:0,invalid:0,review:1,next:null});
        const peopleDate = '02.04.2026 10:00:00 UTC+03:00';
        const group = [
          'ФИО: Парный Первый Учебный<br>Дата рождения: 04.04.1991<br>Причина: Длительная просрочка',
          'ФИО: Парный Второй Учебный<br>Дата рождения: 05.04.1991<br>Причина: Неисполнение обязательств',
          'ФИО: Парный Третий Учебный<br>Дата рождения: 06.04.1991<br>Причина: Длительная просрочка',
        ];
        const oldJob = await upload(post(700,group[0],peopleDate));
        await waitArchive(oldJob.id);
        assert.equal((await adm(`/archives/${oldJob.id}/publish`,defaults)).published,1);
        const splitJob = await upload(post(700,group.join('<br><br>'),peopleDate));
        const split = await waitArchive(splitJob.id);
        assert.deepEqual([split.job.scanned,split.job.total],[1,3]);
        assert.deepEqual(split.items.map(row=>[row.message.messageId,row.message.part,row.fields.birthDate,row.fields.reason]),[
          ['700',1,'04.04.1991','overdue'],['700',2,'05.04.1991','unfulfilled'],['700',3,'06.04.1991','overdue'],
        ]);
        const one = split.items[1];
        assert.equal((await adm(`/archives/${splitJob.id}/records/${one.ordinal}`,{action:'submit',confirmed:true,version:one.version,fields:one.fields})).state,'submitted');
        assert.deepEqual(await adm(`/archives/${splitJob.id}/publish`,defaults),{published:1,duplicates:1,invalid:0,review:0,next:null});
        const republish = await upload(post(700,group.join('<br><br>'),peopleDate),'admin',proof,200,{from:null,to:null,reasons:['overdue'],includeAny:[],excludeAny:[],requireReason:true});
        await waitArchive(republish.id);
        assert.equal((await adm(`/archives/${republish.id}/publish`,defaults)).published,0);
        const crossName = 'Отмеченный Учебный Тестович';
        const fillJob = await upload([
          post(801,`ФИО: ${crossName}\n❌`,peopleDate),
          post(802,'ФИО: Незаданный Учебный Тестович',peopleDate),
          post(803,'ФИО: Исключенный Учебный Тестович',peopleDate),
        ].join(''));
        const beforeFill = await waitArchive(fillJob.id);
        assert.equal(beforeFill.items[0].fields.reasonDetails,'❌');
        await adm(`/archives/${fillJob.id}/records/3`,{action:'exclude',version:beforeFill.items[2].version});
        const fillPath = `/archives/${fillJob.id}/fill-reason`;
        await adm(fillPath,{defaultReason:'other',defaultReasonDetails:'×'},400);
        const filled = await adm(fillPath,{defaultReason:'overdue'});
        assert.deepEqual(filled,{filled:1,processed:2,next:null});
        assert.deepEqual(await adm(fillPath,{defaultReason:'unfulfilled'}),{filled:0,processed:2,next:null});
        const afterFill = await adm(`/archives/${fillJob.id}`);
        assert.deepEqual(afterFill.items.map(row=>[row.state,row.fields.reason,row.fields.reasonDetails]),[
          ['draft','other','❌'],['draft','overdue',''],
        ]);
        assert.equal((await adm(`/archives/${fillJob.id}?excluded=1`)).items[0].fields.reason,'');
        assert.equal((await adm(`/archives/${fillJob.id}/records/2/history`)).items[0].action,'reason_filled');
        assert.equal((await adm('/entries?name='+encodeURIComponent(crossName))).items.length,0);
        assert.equal((await adm(`/archives/${fillJob.id}/publish`,defaults)).published,2);
        assert.equal((await user('/search',{name:crossName})).items[0].reasonDetails,'❌');
        const entriesBeforeClear=(await pool.query('SELECT id,status,payload FROM client_watchlist_entries ORDER BY id')).rows;
        const foreignJob='foreign_clear_test';
        await pool.query("INSERT INTO client_watchlist_archive_jobs(id,owner_id,filename,file_index,state) VALUES($1,'other','messages.html',$1,'ready')",[foreignJob]);
        await adm('/archives/clear',{confirmed:false},400);
        const cleared=await adm('/archives/clear',{confirmed:true});
        assert(cleared.cleared>0);
        assert.deepEqual((await adm('/archives')).items,[]);
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM client_watchlist_archive_records WHERE owner_id='admin' AND state='draft'")).rows[0].n,0);
        assert.deepEqual((await pool.query('SELECT id,status,payload FROM client_watchlist_entries ORDER BY id')).rows,entriesBeforeClear);
        assert.equal((await pool.query('SELECT cleared_at FROM client_watchlist_archive_jobs WHERE id=$1',[foreignJob])).rows[0].cleared_at,null);
        assert((await pool.query("SELECT count(*)::int AS n FROM client_watchlist_archive_records WHERE owner_id='admin' AND state='submitted'")).rows[0].n>0);
        const reloaded=await upload(mixed);
        assert.notEqual(reloaded.id,bulkJob.id);
        await waitArchive(reloaded.id);
      } finally {
        if(entryId) await pool.query('DELETE FROM client_watchlist_entries WHERE id=$1',[entryId]);
        await adm('/settings',{...(await adm('/overview')).settings,autoPublish:existing.autoPublish,submissionsPaused:existing.submissionsPaused,reason:'Восстановление настроек теста'});
      }
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
