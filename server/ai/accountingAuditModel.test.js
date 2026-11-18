const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const url = process.env.DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);

test(
  'сверка учёта: модель не может записывать данные, читать чужой отчёт или выдать сверку за исправление',
  { skip: !local },
  async (t) => {
    const { Pool } = require('pg'),
      express = require('express'),
      jwt = require('jsonwebtoken');
    const script = [],
      seen = [],
      schema = `accounting_model_${crypto.randomBytes(6).toString('hex')}`;
    const previous = { base: process.env.OPENROUTER_BASE_URL, key: process.env.OPENROUTER_API_KEY };
    const model = http.createServer((req, res) => {
      let b = '';
      req.on('data', (d) => (b += d));
      req.on('end', () => {
        const body = JSON.parse(b);
        seen.push(body);
        const next = script.shift() || { content: '' };
        const calls = next.tools
          ? next.tools.map((v, i) => ({
              index: i,
              id: `call_${seen.length}_${i}`,
              type: 'function',
              function: { name: v.tool, arguments: JSON.stringify(v.args || {}) },
            }))
          : next.tool
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
      const audits = require('./accountingAudit').createAccountingAudits(pool);
      const report = await audits.page('owner', (await audits.create('owner')).id, { limit: 10 });
      await t.test('явное объяснение: только подробности текущего отчёта, даже в Авто', async () => {
        const r = await ask(
          'Объясни проверку',
          [
            {
              tools: [
                { tool: 'create_task', args: { title: 'Не записывать' } },
                { tool: 'accounting_audit_findings', args: { reportId: 'foreign' } },
              ],
            },
            { tool: 'accounting_audit_findings', args: { reportId: report.id, limit: 10 } },
            { content: 'Результаты проверки готовы. Источник закупа нужно уточнить.' },
          ],
          {
            analysisOnly: true,
            auditContext: report,
            mode: 'auto',
            history: [{ role: 'user', text: 'Секретная старая история' }],
          }
        );
        assert.deepEqual(r.actions, []);
        assert(seen.every((b) => b.tools.every((t) => t.function.name === 'accounting_audit_findings')));
        assert(!JSON.stringify(seen[0].messages).includes('Секретная старая история'));
        assert.match(JSON.stringify(seen[0].messages), /Импорт без истории закупа в information не называй ошибкой/);
        const toolTexts = seen
          .at(-1)
          .messages.filter((m) => m.role === 'tool')
          .map((m) => m.content)
          .join(' ');
        assert.match(toolTexts, /разрешено только чтение/);
        assert.match(toolTexts, /только текущего отчёта/);
        assert.equal(
          (await pool.query("SELECT count(*)::int AS n FROM data_items WHERE type='tasks'")).rows[0].n,
          0
        );
      });
      await t.test(
        'обычный запрос сверки формирует карточку и блокирует запись в той же пачке вызовов',
        async () => {
          const r = await ask(
            'Проверь учёт целиком',
            [
              {
                tools: [
                  { tool: 'accounting_audit' },
                  { tool: 'create_task', args: { title: 'Не записывать' } },
                ],
              },
              { tool: 'create_payment', args: { contractId: 'loan', amount: 1000 } },
              { content: 'Проверка готова. Записи не изменены.' },
            ],
            { mode: 'auto' }
          );
          assert.equal(r.actions.length, 1);
          assert.equal(r.actions[0].kind, 'accounting_audit');
          assert.equal(r.actions[0].report.id, report.id);
          assert(
            seen.slice(1).every((b) => b.tools.every((t) => t.function.name === 'accounting_audit_findings'))
          );
          assert.equal(
            (await pool.query("SELECT count(*)::int AS n FROM data_items WHERE type='tasks'")).rows[0].n,
            0
          );
        }
      );
      await t.test('карточка проверки не подтверждает выдуманную запись денег', async () => {
        const r = await ask('Проверь учёт целиком', [
          { tool: 'accounting_audit' },
          { content: 'Я записал платёж.' },
        ]);
        assert(!r.reply.includes('Я записал'));
        assert.equal(r.actions[0].kind, 'accounting_audit');
        assert.equal(seen.length, 2, 'Исправление текста не требует ещё одного вызова модели');
        assert.match(r.reply, /Финансовые записи не изменены/);
      });
      await t.test('режим анализа не прилипает к следующей обычной просьбе', async () => {
        const r = await ask('Добавь задачу проверить кассу', [
          { tool: 'create_task', args: { title: 'Проверить кассу' } },
          { content: 'Задача готова к подтверждению.' },
        ]);
        assert.equal(r.actions[0].kind, 'confirm');
        assert(seen[0].tools.some((t) => t.function.name === 'create_task'));
      });
      assert.deepEqual(
        (await pool.query('SELECT id,data FROM data_items ORDER BY id')).rows,
        snapshot.rows,
        'Просмотры не меняют финансовые записи'
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
