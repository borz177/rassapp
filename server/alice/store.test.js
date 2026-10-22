const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { Pool } = require('pg');
const { ensureTables, createStore } = require('./store');

const url = process.env.DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname);
test('PostgreSQL queue: deduplication, serialization, ownership and delivery acknowledgement', { skip: !local }, async () => {
  const schema = `alice_test_${crypto.randomBytes(8).toString('hex')}`;
  const admin = new Pool({ connectionString: url });
  let pool;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    // OAuth хранит TIMESTAMP без часового пояса: тестовая БД и Node должны
    // интерпретировать время одинаково (на production оба работают в UTC).
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema} -c timezone=${timezone}` });
    await ensureTables(pool);
    const store = createStore(pool);
    const job = { userId: 'one', connectionId: 'connection', key: 'session', messageId: 1, question: 'Касса' };
    const [a, b] = await Promise.all([store.enqueue(job), store.enqueue(job)]);
    assert.equal(a.job.id, b.job.id);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM alice_jobs')).rows[0].n, 1);
    assert.equal((await store.enqueue({ ...job, messageId: 2 })).busy, true);
    assert.equal(await store.latest('other', 'session'), undefined);
    const [claimed, alsoClaimed] = await Promise.all([store.claim(), store.claim()]);
    assert.equal([claimed, alsoClaimed].filter(Boolean).length, 1);
    await store.finish(a.job.id, { reply: '42 рубля', actions: [] });
    assert.equal((await store.inbox('one')).length, 1);
    await store.acknowledge('other', [a.job.id]);
    assert.equal((await store.inbox('one')).length, 1);
    await store.acknowledge('one', [a.job.id]);
    assert.equal((await store.inbox('one')).length, 0);
    const next = (await store.enqueue({ ...job, messageId: 2 })).job;
    assert.equal((await store.history(next)).length, 1);
    await pool.query("UPDATE alice_jobs SET updated_at=NOW()-INTERVAL '5 minutes' WHERE id=$1", [next.id]);
    await store.cleanup();
    assert.equal((await store.latest('one', 'session')).status, 'failed');

    // Проверяем полный HTTP-маршрут с настоящей проверкой OAuth, но без платного LLM.
    const express = require('express');
    const oauth = require('../api/oauth');
    const { registerAliceRoutes } = require('./routes');
    await oauth.ensureOAuthTables(pool);
    await pool.query('CREATE TABLE users (id text PRIMARY KEY, role text, blocked boolean DEFAULT false, subscription jsonb)');
    await pool.query("INSERT INTO users (id,role,subscription) VALUES ('voice-owner','manager','{}'),('other-owner','manager','{}')");
    const client = await oauth.createClient(pool, { name: 'Alice test', redirectUris: ['https://social.yandex.net/broker/redirect'] });
    const token = await oauth.issueTokens(pool, { clientId: client.clientId, userId: 'voice-owner', scopes: ['read', 'write'] });
    const other = await oauth.issueTokens(pool, { clientId: client.clientId, userId: 'other-owner', scopes: ['read'] });
    const savedEnv = [process.env.ALICE_SKILL_ID, process.env.ALICE_OAUTH_CLIENT_ID, process.env.ALICE_ALLOWED_USER_IDS];
    process.env.ALICE_SKILL_ID = 'test-skill'; process.env.ALICE_OAUTH_CLIENT_ID = client.clientId; process.env.ALICE_ALLOWED_USER_IDS = '';
    const app = express(); app.use(express.json());
    const { registerOAuthRoutes } = require('../api/oauthRoutes');
    registerOAuthRoutes(app, {
      pool, auth: (req,res,next) => { req.user = { id: 'voice-owner', role: 'manager' }; next(); },
      adminAuth: (req,res) => res.sendStatus(403),
      getEffectivePlan: () => 'BUSINESS', planLimits: { BUSINESS: { api: true } }, logAdminAction: () => {},
    });
    let modelCalls = 0;
    const channel = registerAliceRoutes(app, {
      pool, auth: (req,res,next) => { req.user = { id: req.get('x-test-user') || 'voice-owner' }; next(); },
      runAssistantTurn: async args => { modelCalls++; assert.equal(args.mode, 'confirm'); return { reply: 'В кассе 42 рубля.', actions: [] }; },
      aiAssistantState: async () => ({ allowedRole: true, consent: true }),
      getEffectivePlan: () => 'BUSINESS', planLimits: { BUSINESS: { api: true } },
    });
    await channel.ready;
    const server = await new Promise(resolve => { const srv = app.listen(0, '127.0.0.1', () => resolve(srv)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const payload = text => ({ version: '1.0', meta: { interfaces: { account_linking: {} } },
      session: { skill_id: 'test-skill', session_id: 'session', message_id: 1, user: { user_id: 'yandex', access_token: token.access } },
      request: { type: 'SimpleUtterance', command: text } });
    const post = async b => (await fetch(`${base}/api/alice/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
    try {
      // Формат Яндекса и стандартный OAuth сохраняют оба разрешения до выдачи токена.
      for (const scope of ['read&write', 'read write']) {
        const request = { client_id: client.clientId, redirect_uri: 'https://social.yandex.net/broker/redirect', scope, state: 'oauth-test' };
        const info = await (await fetch(`${base}/api/oauth/authorize-info?${new URLSearchParams(request)}`)).json();
        assert.deepEqual(info.scopes.map(s => s.key), ['read', 'write']);
        const approved = await (await fetch(`${base}/api/oauth/authorize`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
        })).json();
        const callback = new URL(approved.redirectTo);
        assert.equal(callback.searchParams.get('state'), 'oauth-test');
        const issued = await (await fetch(`${base}/api/oauth/token`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret,
            grant_type: 'authorization_code', code: callback.searchParams.get('code'), redirect_uri: request.redirect_uri }),
        })).json();
        assert.equal(issued.error, undefined, issued.error_description);
        assert.equal(issued.scope, 'read write');
        assert.deepEqual((await oauth.findByAccessToken(pool, issued.access_token)).scopes, ['read', 'write']);
      }
      const bad = payload('касса'); bad.session.user.access_token = 'fu_at_invalid';
      assert.ok((await post(bad)).start_account_linking);
      const accepted = await post(payload('касса')); assert.match(accepted.response.text, /Запрос принят/);
      await post(payload('касса')); // повтор доставки с тем же message_id
      const deadline = Date.now() + 3000;
      let answer;
      do { answer = await post(payload('готово')); if (/42/.test(answer.response.text)) break; await new Promise(r => setTimeout(r, 50)); } while (Date.now() < deadline);
      assert.match(answer.response.text, /42/); assert.equal(modelCalls, 1);
      const otherPoll = payload('готово'); otherPoll.session.user.access_token = other.access;
      assert.doesNotMatch((await post(otherPoll)).response.text, /42/);
      const inbox = await (await fetch(`${base}/api/ai/assistant/alice/inbox`)).json();
      assert.equal(inbox.messages.length, 1);
      const otherInbox = await (await fetch(`${base}/api/ai/assistant/alice/inbox`, { headers: { 'x-test-user': 'other-owner' } })).json();
      assert.equal(otherInbox.messages.length, 0);
      await oauth.revokeConnection(pool, { userId: 'voice-owner', id: token.id });
      assert.ok((await post(payload('готово'))).start_account_linking);
    } finally {
      channel.stop(); await new Promise(resolve => server.close(resolve));
      for (const [i,key] of ['ALICE_SKILL_ID','ALICE_OAUTH_CLIENT_ID','ALICE_ALLOWED_USER_IDS'].entries()) {
        if (savedEnv[i] === undefined) delete process.env[key]; else process.env[key] = savedEnv[i];
      }
    }
  } finally {
    if (pool) await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
