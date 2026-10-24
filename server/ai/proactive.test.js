const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const domain = require('../api/domain');
const c = require('./collections');
const proactive = require('./proactive');

const today = c.mskDay();
const at = (offset) => new Date(`${c.addDays(today, offset)}T00:00:00+03:00`).toISOString();
const contract = (id, customerId, first, productName = `Товар ${id}`) => ({
  id, customerId, productName, type: 'INSTALLMENT', status: 'ACTIVE', totalAmount: 120000, downPayment: 0, buyPrice: 100000, remainingAmount: 120000,
  startDate: at(first - 30), paymentPlan: Array.from({ length: 12 }, (_, i) => ({ id: `${id}_${i}`, amount: 10000, date: at(first + i * 30), isPaid: false, isRealPayment: false })),
});
const customers = [
  { id: 'c1', name: 'Петров Иван Сергеевич', phone: '79000000001' },
  { id: 'c2', name: 'Сидоров Пётр', phone: '79000000002' },
  { id: 'c3', name: 'Тихий Клиент', phone: '79000000003', allowWhatsappNotification: false },
];

test('подсказки: сорванное обещание первым, давний долг — официальное письмо, просрочка, склад только с магазином', async () => {
  await domain.ready;
  const sales = [contract('s1', 'c1', -10, 'iPhone 16'), contract('s2', 'c2', -45, 'Samsung S25'), contract('s3', 'c3', -60)];
  const promises = [{ id: 'p', sale_id: 's1', amount: 10000, due_date: c.addDays(today, -1), status: 'active', created_at: at(-3) }];
  const products = [{ id: 'x', name: 'Чехол', stock: 2, minStock: 5 }, { id: 'y', name: 'Кабель', stock: 10, minStock: 5 }];
  const tips = proactive.buildTips({ sales, customers, promises, products, shop: true, today });
  assert.equal(tips[0].label, 'Напиши письмо о долге: Петров Иван, iPhone 16');
  assert.match(tips[0].text, /не сдержал обещание заплатить 10\s000\s₽/);
  assert.equal(tips[1].label, 'Напиши официальное письмо о долге: Сидоров Пётр, Samsung S25');
  assert.ok(tips.some(t => t.label === 'Кому звонить по долгам?'));
  assert.ok(tips.length <= 4);
  // Клиент с отключёнными напоминаниями письмом не предлагается
  assert.ok(!tips.some(t => /Тихий/.test(t.label)));
  const noShop = proactive.buildTips({ sales: [], customers, products, shop: false, today });
  assert.equal(noShop.length, 0);
  const withShop = proactive.buildTips({ sales: [], customers, products, shop: true, today });
  assert.deepEqual(withShop.map(t => t.label), ['Оформи приход: Чехол']);
  assert.match(withShop[0].text, /Чехол — 2 шт/);
});

test('нечего предложить — пусто, без «пустого» сообщения', () => {
  assert.deepEqual(proactive.buildTips({ sales: [], customers: [], today }), []);
});

const url = process.env.DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
test('PostgreSQL: подсказки раз в день, уведомление — только без утренней сводки, выключено — не приходят', { skip: !local }, async () => {
  const { Pool } = require('pg');
  await domain.ready;
  const schema = `agent_tips_${crypto.randomBytes(6).toString('hex')}`;
  const admin = new Pool({ connectionString: url });
  let pool;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
    await pool.query('CREATE TABLE data_items(id text PRIMARY KEY,user_id text,type text,data jsonb,updated_at timestamptz DEFAULT NOW())');
    await pool.query('CREATE TABLE users(id text PRIMARY KEY,role text,ai_subscription jsonb,ai_trial_used int,ai_settings jsonb)');
    await pool.query(`INSERT INTO users VALUES
      ('solo','manager',NULL,0,'{"proactiveTips":true}'),
      ('both','manager',NULL,0,'{"proactiveTips":true,"morningDigest":true}'),
      ('off','manager',NULL,0,'{"proactiveTips":false}'),
      ('spent','manager',NULL,999,'{"proactiveTips":true}')`);
    for (const u of ['solo', 'both', 'off', 'spent']) {
      for (const s of [contract(`${u}_a`, `${u}_c1`, -45), contract(`${u}_b`, `${u}_c2`, -20)]) await pool.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)', [s.id, u, 'sales', JSON.stringify(s)]);
      for (const k of ['c1', 'c2']) await pool.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)', [`${u}_${k}`, u, 'customers', JSON.stringify({ id: `${u}_${k}`, name: `Клиент ${k}`, phone: '79000000000' })]);
    }
    const sent = [];
    const tips = proactive({ pool, createNotification: async (...a) => sent.push(a), aiTrialRequests: 20, aiPlans: {}, checkFeatureAccess: async () => ({ allowed: false }) });
    await tips.tick(true);
    await tips.tick(true);
    const settings = Object.fromEntries((await pool.query('SELECT id, ai_settings FROM users')).rows.map(r => [r.id, r.ai_settings]));
    assert.equal(settings.solo.proactive.date, today);
    assert.ok(settings.solo.proactive.options.length >= 2);
    assert.equal(settings.both.proactive.date, today);
    assert.equal(settings.off.proactive, undefined);
    assert.equal(settings.spent.proactive, undefined, 'пробные запросы кончились — подсказок нет');
    assert.deepEqual(sent.map(s => s[0]), ['solo'], 'одно уведомление: только тому, у кого нет сводки, и только раз');
    assert.equal(sent[0][1], 'AI_DIGEST');
  } finally {
    if (pool) await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
