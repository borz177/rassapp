const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const { buildAccountingAudit, createAccountingAudits } = require('./accountingAudit');
const domain = require('../api/domain');
const base = () => ({
  accounts: [
    { id: 'a', name: 'Основной', type: 'MAIN', initialBalance: 100000 },
    { id: 'b', name: 'Другой', type: 'CUSTOM', initialBalance: 0 },
  ],
  customers: [{ id: 'c', name: 'Тестовый Клиент' }],
  investors: [],
  retailSales: [],
  sales: [
    {
      id: 's',
      type: 'INSTALLMENT',
      status: 'ACTIVE',
      customerId: 'c',
      accountId: 'a',
      productName: 'Телефон',
      totalAmount: 120000,
      buyPrice: 100000,
      downPayment: 20000,
      remainingAmount: 90000,
      startDate: '2026-01-01',
      paymentPlan: [
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `row${i}`,
          saleId: 's',
          amount: 10000,
          isRealPayment: false,
          isPaid: i === 0,
          date: `2026-${String(i + 1).padStart(2, '0')}-15`,
        })),
        { id: 'paid', saleId: 's', amount: 10000, isRealPayment: true, isPaid: true, date: '2026-01-15' },
      ],
    },
  ],
  expenses: [{ id: 'exp_sale_s', accountId: 'a', amount: 100000, category: 'Закуп', date: '2026-01-01' }],
});
const run = async (data) => {
  await domain.ready;
  const snapshot = JSON.stringify(data);
  const r = buildAccountingAudit(data);
  assert.equal(JSON.stringify(data), snapshot);
  return r;
};
test('полная сверка не меняет исходные деньги, корректный учёт не объявляется ошибкой', async () => {
  const d = base(),
    r = await run(d);
  assert.equal(r.counts.confirmed, 0);
  assert.equal(r.counts.review, 0);
  assert.equal(r.accounts[0].balance, 30000);
  assert.equal(r.financialDataChanged, false);
  assert.match(r.summary, /расхождений не найдено/);
  d.sales[0].paymentPlan.at(-1).amount = 'не число';
  const malformed = await run(d);
  assert(malformed.findings.some((f) => f.code === 'contract_amount' && f.severity === 'review'));
  assert(!malformed.findings.some((f) => f.code === 'debt_mismatch'));
});
test('закуп не на том счёте, расхождение суммы, отсутствующий счёт и клиент подтверждаются ссылками', async () => {
  const d = base();
  d.expenses[0].accountId = 'b';
  d.expenses[0].amount = 90000;
  d.sales[0].accountId = 'gone';
  d.customers = [];
  const r = await run(d);
  for (const code of ['purchase_account', 'purchase_amount', 'missing_account', 'missing_customer'])
    assert(
      r.findings.some((f) => f.code === code && f.severity === 'confirmed'),
      code
    );
  assert.equal(r.findings.find((f) => f.code === 'purchase_amount').difference, -10000);
  assert(
    r.findings
      .find((f) => f.code === 'purchase_account')
      .sources.some((s) => s.kind === 'expense' && s.id === 'exp_sale_s')
  );
});
test('платежи, скидка и остаток долга считаются по фактическим оплатам, плановые строки не дублируются', async () => {
  const d = base();
  d.sales[0].paymentPlan.at(-1).discountAmount = 2000;
  d.sales[0].remainingAmount = 88000;
  const r = await run(d);
  assert(!r.findings.some((f) => f.code === 'debt_mismatch'));
  d.sales[0].remainingAmount = 90000;
  assert.equal((await run(d)).findings.find((f) => f.code === 'debt_mismatch').difference, 2000);
});
test('одинаковые оплаты — подозрение, а начальный минус, склад, поставщик и импорт не доказательство ошибки', async () => {
  const d = base();
  d.sales[0].paymentPlan.push({
    ...d.sales[0].paymentPlan.at(-1),
    id: 'paid2',
    actualDate: '2026-01-15T15:30:00Z',
  });
  d.sales[0].remainingAmount = 80000;
  d.expenses = [];
  d.sales[0].supplierId = 'supplier';
  d.accounts[0].initialBalance = -1000;
  const r = await run(d);
  assert(r.findings.some((f) => f.code === 'possible_duplicate' && f.severity === 'review'));
  assert(r.findings.some((f) => f.code === 'external_purchase' && f.severity === 'information'));
  assert(!r.findings.some((f) => f.code === 'missing_purchase'));
  assert.equal(r.counts.confirmed, 0);
  delete d.sales[0].supplierId;
  assert((await run(d)).findings.some((f) => f.code === 'missing_purchase' && f.severity === 'review'));
});
test('старые оплаты без флага сохраняют денежный смысл и не превращаются в ложный план', async () => {
  const d = base();
  delete d.sales[0].paymentPlan.at(-1).isRealPayment;
  d.sales[0].paymentPlan = d.sales[0].paymentPlan.filter((p) => p.id !== 'row0');
  const r = await run(d);
  assert.equal(r.counts.confirmed, 0);
  assert.equal(r.counts.review, 0);
  assert(r.findings.some((f) => f.code === 'legacy_schedule'));
});
test('совместный закуп проверяется по частям, источник выплаты и получатель требуют явной связи', async () => {
  const d = base();
  d.sales[0].funding = [
    { accountId: 'a', amount: 60000 },
    { accountId: 'b', amount: 40000 },
  ];
  d.expenses = [
    { id: 'exp_sale_s__a', accountId: 'a', amount: 60000 },
    { id: 'exp_sale_s__b', accountId: 'b', amount: 40000 },
  ];
  let r = await run(d);
  assert.equal(r.counts.confirmed, 0);
  d.expenses[1].amount = 35000;
  d.expenses.push(
    { id: 'own', accountId: 'a', amount: 1000, category: 'Моя выплата' },
    {
      id: 'inv',
      accountId: 'a',
      amount: 1000,
      category: 'Выплата инвестора',
      investorId: 'missing',
      payoutType: 'PROFIT',
    }
  );
  r = await run(d);
  assert(r.findings.some((f) => f.code === 'funding_purchase'));
  assert(r.findings.some((f) => f.code === 'payout_source' && f.severity === 'review'));
  assert(r.findings.some((f) => f.code === 'payout_investor' && f.severity === 'confirmed'));
});
test('область проверки проверяется сервером, общий капитал не размножается по счетам', async () => {
  await domain.ready;
  const d = base();
  assert.throws(() => buildAccountingAudit(d, ['foreign']), /недоступен/);
  assert.throws(() => buildAccountingAudit(d, []), /Выберите/);
  d.investors = [{ id: 'i', name: 'Инвестор', initialAmount: 100000 }];
  d.accounts[0].type = 'POOL';
  d.accounts[0].poolMemberIds = ['i'];
  d.accounts[1].type = 'INVESTOR';
  d.accounts[1].ownerId = 'i';
  const r = buildAccountingAudit(d, ['a']);
  assert(r.findings.some((f) => f.code === 'capital_allocation' && f.severity === 'review'));
  assert.equal(r.scope.label, 'Основной');
});
const url = process.env.DATABASE_URL,
  local = url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
test(
  'HTTP, PostgreSQL и общая история: бесплатная сверка, кеш, устаревание, источники, права и отсутствие записи денег',
  { skip: !local },
  async () => {
    const { Pool } = require('pg'),
      express = require('express'),
      schema = `account_audit_${crypto.randomBytes(6).toString('hex')}`,
      admin = new Pool({ connectionString: url });
    let pool, server;
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
      await pool.query(
        "CREATE TABLE users(id text PRIMARY KEY); CREATE TABLE data_items(id text PRIMARY KEY,user_id text,type text,data jsonb,updated_at timestamptz DEFAULT NOW()); INSERT INTO users(id) VALUES('owner'),('other')"
      );
      const d = base();
      d.expenses[0].accountId = 'b';
      for (const [type, items] of Object.entries(d))
        for (const item of items)
          await pool.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)', [
            item.id,
            'owner',
            type,
            JSON.stringify(item),
          ]);
      const before = (await pool.query('SELECT * FROM data_items ORDER BY id')).rows;
      const app = express();
      app.use(express.json());
      const auth = (req, res, next) => {
        req.user = { id: req.get('x-owner') || 'owner', role: req.get('x-role') || 'manager' };
        next();
      };
      const conv = require('./conversations').createConversations(pool);
      require('./accountingAuditRoutes').registerAccountingAuditRoutes(app, {
        pool,
        auth,
        allowed: (r) => r === 'manager',
        conversations: conv,
      });
      app.use(
        '/api/v1',
        (req, res, next) => {
          req.apiAuth = { userId: req.get('x-owner') || 'owner', scopes: ['read'] };
          next();
        },
        require('../api/v1').createApiV1Router({ pool })
      );
      server = await new Promise((r) => {
        const s = app.listen(0, '127.0.0.1', () => r(s));
      });
      const root = `http://127.0.0.1:${server.address().port}`;
      const call = async (path, body, status = 200, headers = {}) => {
        const r = await fetch(root + path, {
          method: body ? 'POST' : 'GET',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: body ? JSON.stringify(body) : undefined,
        });
        assert.equal(r.status, status, await r.clone().text());
        return r.json();
      };
      const prefix = '/api/ai/assistant/accounting-audit';
      const result = await call(prefix, { accountIds: ['a'], requestId: 'free-audit-0001' });
      assert.equal(result.modelUsed, false);
      const id = result.actions[0].report.id;
      const again = await call(prefix, { accountIds: ['a'], requestId: 'free-audit-0001' });
      assert.equal(again.replayed, true);
      assert.equal((await conv.list('owner')).messages.length, 2);
      let runnerInput = null,
        usageWrites = 0;
      const runner = require('./runAssistant').createAssistantRunner({
        pool: {
          query: async (sql, args) => {
            if (sql.startsWith('SELECT id, name'))
              return { rows: [{ id: 'owner', name: 'Владелец', role: 'manager', blocked: false }] };
            if (sql.includes("type = 'settings'")) return { rows: [] };
            if (sql.includes('INSERT INTO ai_assistant_usage')) {
              usageWrites++;
              return { rows: [] };
            }
            return pool.query(sql, args);
          },
        },
        assistant: {
          reply: async (args) => {
            runnerInput = args;
            return { reply: 'Объяснение', usage: {}, actions: [] };
          },
        },
        state: async () => ({ allowedRole: true, consent: true, left: 5, trial: false, settings: {} }),
        subscriptionState: async () => ({ expired: false }),
        month: () => '2026-11',
      });
      await runner({
        userId: 'owner',
        text: 'Объясни',
        auditReportId: id,
        image: 'private-photo',
        images: ['private-photo'],
        audio: { data: 'private-audio' },
        history: [{ role: 'user', text: 'private-history' }],
      });
      assert.equal(runnerInput.analysisOnly, true);
      assert.equal(runnerInput.readOnly, false, 'анализ не означает истёкшую подписку');
      assert.deepEqual(runnerInput.history, []);
      assert.equal(runnerInput.image, null);
      assert.equal(runnerInput.images, null);
      assert.equal(runnerInput.audio, null);
      assert.equal(usageWrites, 1, 'только явное объяснение использует квоту');
      let report = await call(`${prefix}/${id}`);
      assert.equal(report.stale, false);
      assert(report.findings.some((f) => f.code === 'purchase_account'));
      const publicReport = await call(`/api/v1/reports/accounting-audit?accountIds=a`);
      assert.equal(publicReport.data.id, id, 'общий результат через приложение и API');
      await call(`${prefix}/${id}`, null, 404, { 'x-owner': 'other' });
      await call(prefix, { accountIds: ['a'], requestId: 'not-allowed' }, 403, { 'x-role': 'investor' });
      await call(prefix, { accountIds: ['foreign'], requestId: 'not-owned-account' }, 403);
      const exp = await call(`${prefix}/${id}/source?kind=expense&id=exp_sale_s`);
      assert.equal(exp.amount, 100000);
      const accountSource = await call(`${prefix}/${id}/source?kind=account&id=a`);
      assert.equal(accountSource.accountName, 'Основной');
      assert.equal(accountSource.amount, 130000);
      assert(!('passport' in exp));
      await call(`${prefix}/${id}/source?kind=expense&id=unknown`, null, 403);
      const limited = await call(`${prefix}/${id}?limit=1`);
      assert.equal(limited.findings.length, 1);
      assert(limited.hasMore);
      assert.equal(
        (await call(`${prefix}/${id}?severity=confirmed`)).findings.every((f) => f.severity === 'confirmed'),
        true
      );
      assert.deepEqual(
        (await pool.query('SELECT * FROM data_items ORDER BY id')).rows,
        before,
        'Сверка и просмотры не меняют финансовые строки'
      );
      await pool.query(
        "UPDATE data_items SET data=data || '{\"amount\":90000}'::jsonb WHERE id='exp_sale_s'"
      );
      report = await call(`${prefix}/${id}`);
      assert.equal(report.stale, true);
      runnerInput = null;
      await assert.rejects(runner({ userId: 'owner', text: 'Объясни', auditReportId: id }), {
        status: 409,
        code: 'AUDIT_STALE',
      });
      assert.equal(runnerInput, null);
      assert.equal(usageWrites, 1);
      const fresh = await call(prefix, { accountIds: ['a'], requestId: 'free-audit-0002' });
      assert.notEqual(fresh.actions[0].report.id, id);
      await pool.query("DELETE FROM data_items WHERE id='exp_sale_s'");
      await call(`${prefix}/${id}/source?kind=expense&id=exp_sale_s`, null, 404);
    } finally {
      if (server) await new Promise((r) => server.close(r));
      if (pool) await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  }
);
