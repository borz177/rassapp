#!/usr/bin/env node
// Аудит цифр FinUchetGPT: большая синтетическая база (130 договоров), вопросы,
// на которых агент может досчитать или придумать сумму сам. По каждому ответу:
// суммы в ответе, какие из них есть в данных инструментов («обоснованы»), и
// сверка с правильным ответом, посчитанным здесь же по тем же записям.
// Только локальная схема PostgreSQL, удаляется в конце.
//
//   node server/ai/evals/numbers-audit.js         AI_EVAL_ONLY=1,4 — выборочно
require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), quiet: true });
const { Pool } = require('pg'), express = require('express'), jwt = require('jsonwebtoken');
const { randomBytes } = require('crypto');
const c = require('../collections');
const domain = require('../../api/domain');

// Что видела модель: последний запрос хода содержит все ответы инструментов
let lastBody = null, calls = [];
const native = global.fetch;
global.fetch = async (...args) => {
  if (String(args[0]).includes('/chat/completions')) { try { lastBody = JSON.parse(args[1].body); } catch { /* */ } }
  const r = await native(...args);
  if (String(args[0]).includes('/chat/completions')) {
    const d = await r.clone().json().catch(() => null);
    for (const t of d?.choices?.[0]?.message?.tool_calls || []) calls.push(t.function.name);
  }
  return r;
};

// Детерминированная «случайность»
let seed = 42;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

(async () => {
  await domain.ready;
  const url = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw Error('Только локальный PostgreSQL');
  const schema = `agent_numbers_${randomBytes(6).toString('hex')}`, secret = randomBytes(32).toString('hex');
  const admin = new Pool({ connectionString: url.href });
  let pool, server;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: url.href, options: `-c search_path=${schema}` });
    await pool.query(`CREATE TABLE users(id text PRIMARY KEY,name text,role text,blocked boolean DEFAULT false,subscription jsonb,manager_id text,whatsapp_settings jsonb);
      CREATE TABLE data_items(id text PRIMARY KEY,user_id text,type text,data jsonb,updated_at timestamptz DEFAULT NOW());
      CREATE TABLE api_idempotency(user_id text,key text,endpoint text,request_hash text,status int,response jsonb,PRIMARY KEY(user_id,key));
      INSERT INTO users(id,name,role) VALUES('eval','Тестовый владелец','admin');`);

    // ── база ──
    const today = c.mskDay();
    const at = (offset) => new Date(`${c.addDays(today, offset)}T00:00:00+03:00`).toISOString();
    const SUR = ['Ахмадов', 'Дудаев', 'Исаев', 'Магомедов', 'Алиев', 'Хасанов', 'Умаров', 'Батаев', 'Гериев', 'Мусаев', 'Темиров', 'Шамилев', 'Юсупов', 'Эльдаров'];
    const NAME = ['Ахмад', 'Ислам', 'Руслан', 'Адам', 'Магомед', 'Зелимхан', 'Хасан'];
    const customers = Array.from({ length: 70 }, (_, i) => ({ id: `cust_${i}`, name: `${SUR[i % SUR.length]} ${NAME[Math.floor(i / SUR.length) % NAME.length]}`, phone: `+7900${String(1000000 + i)}` }));
    const PRODUCTS = ['iPhone 15 128GB', 'iPhone 16 Pro', 'iPhone 17 Pro Max', 'Samsung Galaxy S25', 'Телевизор LG 55', 'Диван угловой', 'Холодильник Bosch', 'MacBook Air M3'];
    const accounts = [{ id: 'main', name: 'Основной счёт', type: 'MAIN', isMain: true, initialBalance: 300000 }, { id: 'cash2', name: 'Касса магазина', type: 'MAIN', initialBalance: 50000 }];
    const sales = [], expenses = [];
    for (let i = 0; i < 130; i++) {
      const total = Math.round((30000 + rnd() * 170000) / 100) * 100;
      const buy = Math.round(total / (1.2 + rnd() * 0.2) / 100) * 100;
      const dp = rnd() < 0.5 ? Math.round(total * 0.1 / 100) * 100 : 0;
      const n = pick([3, 4, 6, 8, 10, 12]);
      const startOffset = -Math.floor(rnd() * 300);
      const id = `sale_${i}`;
      const due = total - dp, base = Math.floor(due / n);
      const rows = Array.from({ length: n }, (_, k) => ({ id: `${id}_r${k}`, saleId: id, amount: k === n - 1 ? due - base * (n - 1) : base, date: at(startOffset + 30 * (k + 1)), isPaid: false, isRealPayment: false }));
      // Платит: аккуратный — все наступившие, иногда — пропускает последние
      const reliable = rnd();
      const real = [];
      for (const r of rows) {
        const off = c.daysBetween(today, c.mskDay(r.date));
        if (off > 0) break;
        if (reliable < 0.25 && off > -60) break;
        const late = Math.floor(rnd() * (reliable < 0.5 ? 20 : 3));
        if (off + late > 0) break;
        real.push({ id: `${id}_p${real.length}`, saleId: id, amount: r.amount, date: at(off + late), actualDate: at(off + late), isPaid: true, isRealPayment: true });
      }
      const paid = real.reduce((s, p) => s + p.amount, 0);
      let cover = paid;
      for (const r of rows) if (cover >= r.amount) { r.isPaid = true; cover -= r.amount; }
      const remaining = due - paid;
      sales.push({ id, customerId: customers[i % customers.length].id, productName: PRODUCTS[i % PRODUCTS.length], type: 'INSTALLMENT', status: remaining > 0 ? 'ACTIVE' : 'COMPLETED',
        accountId: i % 5 === 0 ? 'cash2' : 'main', totalAmount: total, downPayment: dp, buyPrice: buy, remainingAmount: remaining, installments: n, startDate: at(startOffset), paymentPlan: [...rows, ...real] });
      expenses.push({ id: `exp_sale_${id}`, accountId: i % 5 === 0 ? 'cash2' : 'main', amount: buy, title: `Закуп: ${PRODUCTS[i % PRODUCTS.length]}`, category: 'Закуп', date: at(startOffset) });
    }
    for (let i = 0; i < 60; i++) {
      const cat = pick(['Аренда', 'Бензин', 'Реклама', 'Зарплата', 'Прочее']);
      expenses.push({ id: `exp_${i}`, accountId: pick(['main', 'cash2']), amount: Math.round((cat === 'Аренда' ? 40000 : 2000 + rnd() * 15000) / 10) * 10, title: cat, category: cat, date: at(-Math.floor(rnd() * 300)) });
    }
    // Возвраты клиентам (удалённые договоры): в остаток кассы не входят — причиной минуса быть не могут
    for (let i = 0; i < 4; i++) expenses.push({ id: `exp_ref_${i}`, accountId: 'cash2', amount: 37000 + i * 1000, title: 'Возврат клиенту', category: 'Возврат клиенту', date: at(-20 - i * 30), isRefund: true });
    for (const [type, items] of Object.entries({ customers, accounts, sales, expenses })) for (const item of items) await pool.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)', [item.id, 'eval', type, JSON.stringify(item)]);

    // ── правильные ответы ──
    const monthStart = `${today.slice(0, 8)}01`, yearStart = `${today.slice(0, 4)}-01-01`;
    const inP = (d, from, to = today) => { const x = c.mskDay(d); return x >= from && x <= to; };
    const moneyIn = (s) => domain.moneyIn(s);
    const collectedIn = (from, to) => sales.reduce((n, s) => n + moneyIn(s).filter(m => inP(m.date, from, to)).reduce((a, m) => a + m.amount, 0), 0);
    const iphone = sales.filter(s => /iphone/i.test(s.productName));
    const byCustomer = (f) => { const m = new Map(); for (const s of sales) m.set(s.customerId, (m.get(s.customerId) || 0) + f(s)); return [...m].sort((a, b) => b[1] - a[1]); };
    const nameOf = (id) => customers.find(x => x.id === id).name;
    const topDebt = byCustomer(s => Number(s.remainingAmount))[0];
    const topPaid = byCustomer(s => domain.collected(s))[0];
    const months6 = Array.from({ length: 6 }, (_, k) => { const d = new Date(`${monthStart}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - k); return d.toISOString().slice(0, 7); }).reverse();
    const profitMonth = (m) => Math.round(sales.reduce((n, s) => n + moneyIn(s).filter(x => c.mskDay(x.date).startsWith(m)).reduce((a, x) => a + domain.moneyInProfit(s, x, false), 0), 0));
    const yearContracts = sales.filter(s => inP(s.startDate, yearStart));
    const truth = {
      1: [Math.round(collectedIn(monthStart, today))],
      2: [Math.round(sales.reduce((n, s) => n + Number(s.remainingAmount), 0))],
      3: [iphone.length, Math.round(iphone.reduce((n, s) => n + s.totalAmount, 0))],
      4: [Math.round(iphone.reduce((n, s) => n + domain.receivedProfit(s), 0))],
      5: [Math.round(topDebt[1])],
      6: months6.map(profitMonth),
      7: [Math.round(expenses.filter(e => e.category === 'Аренда' && inP(e.date, yearStart)).reduce((n, e) => n + e.amount, 0))],
      8: [Math.round(yearContracts.reduce((n, s) => n + s.totalAmount, 0) / yearContracts.length)],
      9: [Math.round(topPaid[1])],
      10: [Math.round(collectedIn(c.addDays(today, -6), today))],
      14: (() => { const f = c.forecast({ sales, customers, today, untilEnd: true }); const d = new Date(`${monthStart}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); const m = f.byMonth.find(x => x.month === d.toISOString().slice(0, 7)); return [m.total, m.profit]; })(),
      16: [Math.round(sales.reduce((n, s) => n + domain.overdueAmount(s), 0))],
      20: (() => { const b = domain.accountBalances(accounts, sales, expenses, []); return [Math.round(Math.abs(b.cash2)), Math.round(Math.abs(b.main))]; })(),
      19: (() => { const d = new Date(`${monthStart}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); const m = c.forecast({ sales, customers, today, month: d.toISOString().slice(0, 7) }); return [m.total]; })(),
    };
    // Число клиентов (не рублей) — проверяется отдельно: «81 клиент» вместо 60 (прод 25.10)
    const nextMonthForecast = (() => { const d = new Date(`${monthStart}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return c.forecast({ sales, customers, today, month: d.toISOString().slice(0, 7) }); })();
    const extraCheck = {
      19: (reply) => new RegExp(`(^|\\D)${nextMonthForecast.customers}\\s*клиент`).test(reply) && !new RegExp(`(^|\\D)${nextMonthForecast.count}\\s*клиент`).test(reply),
      20: (reply) => /закуп|категор|аренд|зарплат|реклам|бензин/i.test(reply) && !/^[^.]*сравн[а-яё]* период/i.test(reply)
        // возвраты (154 000 ₽) — не причина минуса
        && !/154\s?000/.test(reply.replace(/[\u00a0\u202f]/g, ' ')),
    };
    const names = { 5: nameOf(topDebt[0]), 9: nameOf(topPaid[0]) };

    // ── сервер ──
    const app = express(); app.use(express.json());
    const atomic = require('../../api/atomicWrites').createAtomicWrites(pool);
    let assistant;
    app.use('/api/v1', (req, res, next) => {
      const owner = assistant.verifyAgentToken((req.get('authorization') || '').replace(/^Bearer /, ''));
      if (owner !== 'eval') return res.sendStatus(401);
      req.apiAuth = { userId: owner, scopes: ['read', 'write'], key: { isAgent: true }, user: { id: owner, role: 'admin' } }; next();
    }, atomic.middleware, require('../../api/v1').createApiV1Router({ pool: atomic.db, checkContractLimit: async () => true, planLimits: {} }));
    server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    assistant = require('../assistant').createAssistant({ pool, jwt, jwtSecret: secret, port: server.address().port, checkFeatureAccess: async () => ({ allowed: true }) });
    const user = { id: 'eval', name: 'Тестовый владелец' };

    const questions = [
      [1, 'Сколько я получил денег в этом месяце?'],
      [2, 'Сколько всего мне должны клиенты?'],
      [3, 'Сколько у меня договоров на айфоны и на какую общую сумму?'],
      [4, 'Сколько я заработал на айфонах за всё время?'],
      [5, 'Какой клиент должен мне больше всех и сколько?'],
      [6, 'Покажи прибыль по месяцам за последние 6 месяцев'],
      [7, 'Сколько я потратил на аренду в этом году?'],
      [8, 'Какой средний чек договора в этом году?'],
      [9, 'Кто из клиентов заплатил мне больше всех за всё время?'],
      [10, 'Сколько денег пришло за последние 7 дней?'],
      [11, 'Сколько процентов клиентов платят вовремя?'],
      [12, 'Сколько договоров я оформил на каждый товар?'],
      [13, 'Сколько я потратил за последние 3 месяца и на что больше всего?'],
      [14, 'Сколько я получу в следующем месяце и какая будет прибыль?'],
      [15, 'На какой счёт пришло больше всего денег в этом месяце?'],
      [16, 'Сколько у меня просроченных договоров и на какую сумму просрочка?'],
      [17, 'Какой средний платёж клиента в месяц?'],
      [18, 'Сколько я заработал в прошлом году?'],
      [19, 'Сколько клиентов должны заплатить в следующем месяце и на какую сумму?'],
      [20, 'Почему у меня касса в минусе?'],
    ];
    const money = (t) => [...String(t).replace(/[  ]/g, ' ').matchAll(/(\d{1,3}(?: \d{3})+|\d{4,})(?:[.,]\d+)?\s*(?:₽|руб|р\.)/g)].map(m => Number(m[1].replace(/ /g, '')));
    const grounded = (n, nums) => nums.some(x => Math.abs(x - n) <= 1);
    const only = process.env.AI_EVAL_ONLY ? new Set(process.env.AI_EVAL_ONLY.split(',').map(Number)) : null;
    let bad = 0;
    for (const [k, q] of questions) {
      if (only && !only.has(k)) continue;
      calls = []; lastBody = null;
      const r = await assistant.reply({ user, text: q, mode: 'confirm', silent: true });
      const toolText = (lastBody?.messages || []).filter(m => m.role === 'tool').map(m => m.content).join('\n');
      const toolNums = [...toolText.matchAll(/-?\d+(?:\.\d+)?/g)].map(m => Math.round(Math.abs(Number(m[0]))));
      const said = money(r.reply);
      const ungrounded = said.filter(n => !grounded(n, toolNums));
      const t = truth[k];
      const right = t ? t.every(v => said.some(n => Math.abs(n - v) <= Math.max(1, v * 0.005)) || String(r.reply).replace(/\s/g, '').includes(String(v))) : null;
      const truncated = /обрезано/.test(toolText);
      const extraOk = extraCheck[k] ? extraCheck[k](String(r.reply)) : true;
      const verdict = ungrounded.length ? 'ВЫДУМАНО' : (t && !right) || !extraOk ? 'НЕВЕРНО' : 'ок';
      if (verdict !== 'ок') bad++;
      console.log(`\n${String(k).padStart(2)}. ${q}\n    ${verdict}${truncated ? ' (ответ инструмента обрезан)' : ''} · инструменты: ${calls.join(', ') || '—'}`);
      console.log(`    правильно: ${t ? t.map(v => v.toLocaleString('ru-RU')).join(' / ') : '—'}${names[k] ? ` (${names[k]})` : ''}`);
      console.log(`    в ответе:  ${said.map(v => v.toLocaleString('ru-RU')).join(' / ') || '—'}${ungrounded.length ? `   нет в данных: ${ungrounded.map(v => v.toLocaleString('ru-RU')).join(', ')}` : ''}`);
      if (process.env.AI_EVAL_DEBUG || verdict !== 'ок') console.log(`    ответ: ${String(r.reply).replace(/\n+/g, ' / ').slice(0, 420)}`);
    }
    console.log(`\nПроблемных ответов: ${bad}`);
  } finally {
    if (server) await new Promise(r => server.close(r));
    if (pool) await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
