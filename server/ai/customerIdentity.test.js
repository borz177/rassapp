const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const url = process.env.DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);

test(
  'клиент через агента: паспорт и дата рождения сохраняются при создании, дополнении и отмене',
  { skip: !local },
  async (t) => {
    const { Pool } = require('pg'),
      express = require('express'),
      jwt = require('jsonwebtoken');
    const script = [],
      seen = [],
      apiTokens = [],
      schema = `customer_identity_${crypto.randomBytes(6).toString('hex')}`;
    const previous = { base: process.env.OPENROUTER_BASE_URL, key: process.env.OPENROUTER_API_KEY };
    const model = http.createServer((req, res) => {
      let b = '';
      req.on('data', (d) => (b += d));
      req.on('end', () => {
        const body = JSON.parse(b);
        seen.push(body);
        const next = script.shift() || { content: '' };
        const calls = next.tool
          ? [
              {
                index: 0,
                id: `call_${seen.length}`,
                type: 'function',
                function: { name: next.tool, arguments: JSON.stringify(next.args || {}) },
              },
            ]
          : undefined;
        if (body.stream) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.end(
            `data: ${JSON.stringify({
              choices: [{ delta: { content: next.content || '', tool_calls: calls } }],
              usage: {},
            })}\n\ndata: [DONE]\n\n`
          );
        } else {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              choices: [{ message: { role: 'assistant', content: next.content || '', tool_calls: calls } }],
              usage: {},
            })
          );
        }
      });
    });
    await new Promise((r) => model.listen(0, '127.0.0.1', r));
    process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${model.address().port}`;
    process.env.OPENROUTER_API_KEY = 'test';
    const admin = new Pool({ connectionString: url });
    let pool, server;
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
      await pool.query(`CREATE TABLE users(id text PRIMARY KEY,name text,role text,manager_id text,subscription jsonb,whatsapp_settings jsonb);
      CREATE TABLE data_items(id text PRIMARY KEY,user_id text,type text,data jsonb,updated_at timestamptz DEFAULT NOW());
      CREATE TABLE api_idempotency(user_id text,key text,endpoint text,request_hash text,status int,response jsonb,PRIMARY KEY(user_id,key));
      INSERT INTO users(id,name,role,subscription) VALUES('owner','Владелец','manager','{"plan":"BUSINESS_PRO"}');`);
      const fixtures = {
        accounts: [{ id: 'acc', name: 'Основной счёт', type: 'MAIN', initialBalance: 100000 }],
        customers: [{ id: 'cust', name: 'Тестовый Клиент', phone: '+79001234567' }],
        sales: [
          {
            id: 'loan',
            customerId: 'cust',
            accountId: 'acc',
            productName: 'Телефон',
            type: 'INSTALLMENT',
            status: 'ACTIVE',
            totalAmount: 201600,
            buyPrice: 150000,
            downPayment: 0,
            remainingAmount: 33600,
            installments: 12,
            startDate: '2025-12-30',
            paymentPlan: Array.from({ length: 12 }, (_, i) => ({
              id: `p${i}`,
              amount: 16800,
              date: `2026-${String(i + 1).padStart(2, '0')}-15`,
              isRealPayment: false,
              isPaid: i < 10,
            })),
          },
        ],
      };
      for (const [type, items] of Object.entries(fixtures))
        for (const item of items)
          await pool.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)', [
            item.id,
            'owner',
            type,
            JSON.stringify(item),
          ]);
      const app = express();
      app.use(express.json());
      const secret = 'local-synthetic-secret';
      let assistant;
      app.use(
        '/api/v1',
        (req, res, next) => {
          apiTokens.push(req.get('authorization'));
          const sub = assistant.verifyAgentToken((req.get('authorization') || '').replace(/^Bearer /, ''));
          if (sub !== 'owner') return res.sendStatus(401);
          req.apiAuth = { userId: sub, scopes: ['read', 'write'], key: { isAgent: true } };
          next();
        },
        require('../api/v1').createApiV1Router({
          pool,
          checkContractLimit: async () => ({ allowed: true }),
          planLimits: {},
        })
      );
      server = await new Promise((r) => {
        const s = app.listen(0, '127.0.0.1', () => r(s));
      });
      assistant = require('./assistant').createAssistant({
        pool,
        jwt,
        jwtSecret: secret,
        port: server.address().port,
        checkFeatureAccess: async () => ({ allowed: true }),
      });
      const user = { id: 'owner', name: 'Владелец' };
      const ask = async (text, steps, extra = {}) => {
        assert.equal(script.length, 0, 'Все ответы предыдущего сценария использованы');
        script.push(...steps);
        seen.length = 0;
        return assistant.reply({ user, text, silent: true, ...extra });
      };
      const snapshot = await pool.query('SELECT id,data FROM data_items ORDER BY id');
      const identity = {
        name: 'Тестов Тест Тестович',
        phone: '+79001234568',
        address: 'Тестовый адрес',
        birthDate: '1990-01-02',
        passportSeries: '00 12',
        passportNumber: '003456',
        passportIssuedBy: 'Тестовый отдел',
        passportIssueDate: '2010-02-03',
        passportDivisionCode: '000-001',
      };
      const issued = 'Тестовый отдел, дата выдачи 2010-02-03, код 000-001';
      const read = async (id) =>
        (
          await pool.query(
            "SELECT data FROM data_items WHERE user_id='owner' AND type='customers' AND id=$1",
            [id]
          )
        ).rows[0]?.data;
      const remove = async (id) =>
        pool.query("DELETE FROM data_items WHERE user_id='owner' AND type='customers' AND id=$1", [id]);
      const expectIdentity = (c) => {
        for (const key of ['name', 'phone', 'address', 'birthDate', 'passportSeries', 'passportNumber'])
          assert.equal(c[key], identity[key], key);
        assert.equal(c.passportIssuedBy, issued);
        assert(!('passportIssueDate' in c), 'Дата выдачи совместима с существующим полем кем выдан');
      };
      await t.test(
        'схема инструмента содержит все паспортные поля, создание ждёт подтверждения',
        async () => {
          const { TOOLS } = require('../api/mcp'),
            tool = TOOLS.find((t) => t.name === 'create_customer');
          for (const field of Object.keys(identity)) assert(tool.input[field], field + ' доступно модели');
          const r = await ask(
            'Добавь клиента с данными паспорта, телефон +79001234568',
            [{ tool: 'create_customer', args: identity }, { content: 'Данные клиента — в карточке.' }],
            { image: 'data:image/jpeg;base64,c3ludGhldGlj' }
          );
          const card = r.actions.find((a) => a.tool === 'create_customer');
          assert.equal(card.kind, 'confirm');
          assert.match(card.summary, /003456/);
          assert.match(card.summary, /1990-01-02/);
          assert.match(card.summary, /000-001/);
          assert.equal(
            (await pool.query("SELECT count(*)::int AS n FROM data_items WHERE type='customers'")).rows[0].n,
            1,
            'До подтверждения нового клиента нет'
          );
          const result = await assistant.confirmAction('owner', card.id);
          assert.equal(result.ok, true, result.text);
          const stored = (
            await pool.query("SELECT data FROM data_items WHERE type='customers' AND id<>'cust'")
          ).rows[0].data;
          expectIdentity(stored);
          await assistant.confirmAction('owner', card.id);
          assert.equal(
            (await pool.query("SELECT count(*)::int AS n FROM data_items WHERE type='customers'")).rows[0].n,
            2,
            'Повтор подтверждения не создаёт дубль'
          );
          const response = await fetch(
            `http://127.0.0.1:${server.address().port}/api/v1/customers/${stored.id}`,
            { headers: { authorization: apiTokens.at(-1) } }
          );
          assert.equal(response.status, 200);
          const exposed = (await response.json()).data;
          assert.equal(exposed.passport.number, '003456');
          assert.equal(exposed.passport.issuedBy, issued);
          assert.equal(exposed.birthDate, identity.birthDate);
          await remove(stored.id);
        }
      );
      await t.test('Авто сохраняет ведущие нули и разделяет десять цифр серии/номера', async () => {
        const data = { ...identity, passportSeries: undefined, passportNumber: '0012003456' };
        const r = await ask(
          'Добавь клиента по паспорту, телефон +79001234568',
          [{ tool: 'create_customer', args: data }, { content: 'Данные клиента — в карточке.' }],
          { mode: 'auto' }
        );
        assert.equal(r.actions[0].kind, 'done');
        assert.equal(r.actions[0].ok, true);
        const stored = (await pool.query("SELECT data FROM data_items WHERE type='customers' AND id<>'cust'"))
          .rows[0].data;
        expectIdentity(stored);
        const undone = await assistant.undoAction('owner', r.actions[0].id, { silent: true });
        assert.equal(undone.ok, true, undone.text);
        assert.equal(await read(stored.id), undefined);
      });
      await t.test(
        'дополнение существующего клиента сохраняет паспорт, дату рождения и адрес; отмена возвращает пустые поля',
        async () => {
          const previous = await read('cust'),
            args = { ...identity, customerId: 'cust' };
          delete args.name;
          delete args.phone;
          const r = await ask('Дополни данные клиента по паспорту', [
            { tool: 'update_customer', args },
            { content: 'Данные клиента — в карточке.' },
          ]);
          const schema = seen[0].tools.find((t) => t.function.name === 'update_customer').function.parameters
            .properties;
          for (const key of [
            'birthDate',
            'passportSeries',
            'passportNumber',
            'passportIssuedBy',
            'passportIssueDate',
            'passportDivisionCode',
          ])
            assert(schema[key], key);
          const card = r.actions.find((a) => a.tool === 'update_customer');
          assert(card);
          assert.match(card.summary, /дата рождения/);
          assert.deepEqual(await read('cust'), previous);
          const confirmed = await assistant.confirmAction('owner', card.id);
          assert.equal(confirmed.ok, true, confirmed.text);
          expectIdentity({ ...(await read('cust')), name: identity.name, phone: identity.phone });
          const undo = await assistant.undoAction('owner', card.id, { silent: true });
          assert.equal(undo.ok, true, undo.text);
          assert.deepEqual(await read('cust'), previous);
        }
      );
      await t.test(
        'изменение только кода подразделения не стирает отдел, дату выдачи, номер и телефон',
        async () => {
          const previous = await read('cust');
          await pool.query("UPDATE data_items SET data=data || $1::jsonb WHERE id='cust'", [
            JSON.stringify({ passportIssuedBy: issued, passportNumber: '003456' }),
          ]);
          const r = await ask(
            'Исправь только код подразделения',
            [
              { tool: 'update_customer', args: { customerId: 'cust', passportDivisionCode: '000-002' } },
              { content: 'Данные клиента — в карточке.' },
            ],
            { mode: 'auto' }
          );
          assert.equal(r.actions[0].ok, true);
          const c = await read('cust');
          assert.equal(c.passportIssuedBy, 'Тестовый отдел, дата выдачи 2010-02-03, код 000-002');
          assert.equal(c.passportNumber, '003456');
          assert.equal(c.phone, previous.phone);
          const undo = await assistant.undoAction('owner', r.actions[0].id, { silent: true });
          assert.equal(undo.ok, true, undo.text);
          await pool.query("UPDATE data_items SET data=$1 WHERE id='cust'", [JSON.stringify(previous)]);
        }
      );
      await t.test(
        'неизвестные поля и неверная дата не приводят к частичному сохранению клиента',
        async () => {
          const r = await ask(
            'Добавь клиента, телефон +79001234568',
            [
              { tool: 'create_customer', args: { ...identity, birthDate: 'неизвестно' } },
              { content: 'Дата рождения требует уточнения.' },
            ],
            { mode: 'auto' }
          );
          assert.equal(r.actions[0].ok, false);
          assert.equal(
            (await pool.query("SELECT count(*)::int AS n FROM data_items WHERE type='customers'")).rows[0].n,
            1
          );
          const unknown = await ask(
            'Добавь клиента, телефон +79001234568',
            [
              { tool: 'create_customer', args: { ...identity, unknownPassportField: 'test' } },
              { content: 'Поле требует уточнения.' },
            ],
            { mode: 'auto' }
          );
          assert.equal(unknown.actions[0].ok, false);
          assert.equal(
            (await pool.query("SELECT count(*)::int AS n FROM data_items WHERE type='customers'")).rows[0].n,
            1
          );
        }
      );
      assert.deepEqual(
        (await pool.query('SELECT id,data FROM data_items ORDER BY id')).rows,
        snapshot.rows,
        'После отмены изменений записи полностью совпадают; деньги не затронуты'
      );
    } finally {
      if (server) await new Promise((r) => server.close(r));
      await new Promise((r) => model.close(r));
      if (pool) await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
      if (previous.base === undefined) delete process.env.OPENROUTER_BASE_URL;
      else process.env.OPENROUTER_BASE_URL = previous.base;
      if (previous.key === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previous.key;
    }
  }
);
