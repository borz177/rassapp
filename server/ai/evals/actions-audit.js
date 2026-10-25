#!/usr/bin/env node
// Аудит записей FinUchetGPT: просьбы с подвохами (однофамильцы, несколько договоров,
// ошибка в фамилии, «Авто», переплата, скидка, реструктуризация, склад) — и проверка
// не текста, а базы после «Подтвердить»: тот ли договор, та ли сумма и счёт, нет ли
// лишних записей, возвращает ли «Отменить» всё как было. Настоящая модель, синтетические
// записи в отдельной схеме локального PostgreSQL (удаляется в конце).
//
//   node server/ai/evals/actions-audit.js        AI_EVAL_ONLY=1,5   AI_EVAL_DEBUG=1
require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), quiet: true });
const { Pool } = require('pg'), express = require('express'), jwt = require('jsonwebtoken');
const { randomBytes } = require('crypto');
const c = require('../collections');
const domain = require('../../api/domain');

let calls = [];
const native = global.fetch;
global.fetch = async (...args) => {
  const r = await native(...args);
  if (String(args[0]).includes('/chat/completions')) {
    const d = await r.clone().json().catch(() => null);
    for (const t of d?.choices?.[0]?.message?.tool_calls || []) { let a = {}; try { a = JSON.parse(t.function.arguments || '{}'); } catch { /* */ } calls.push({ name: t.function.name, args: a }); }
  }
  return r;
};

(async () => {
  await domain.ready;
  const url = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw Error('Только локальный PostgreSQL');
  const schema = `agent_actions_${randomBytes(6).toString('hex')}`, secret = randomBytes(32).toString('hex');
  const admin = new Pool({ connectionString: url.href });
  let pool, server;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: url.href, options: `-c search_path=${schema}` });
    await pool.query(`CREATE TABLE users(id text PRIMARY KEY,name text,role text,blocked boolean DEFAULT false,subscription jsonb,manager_id text,whatsapp_settings jsonb);
      CREATE TABLE data_items(id text PRIMARY KEY,user_id text,type text,data jsonb,updated_at timestamptz DEFAULT NOW());
      CREATE TABLE api_idempotency(user_id text,key text,endpoint text,request_hash text,status int,response jsonb,PRIMARY KEY(user_id,key));
      INSERT INTO users(id,name,role,whatsapp_settings) VALUES('eval','Тестовый владелец','admin','{"enabled":true}');`);

    const today = c.mskDay();
    const at = (o) => new Date(`${c.addDays(today, o)}T00:00:00+03:00`).toISOString();
    // Договор: n платежей по each раз в 30 дней с first; paid — [[сумма, день]]
    const make = (id, customerId, productName, n, each, first, paid = [], buy) => {
      const total = n * each;
      const rows = Array.from({ length: n }, (_, i) => ({ id: `${id}_r${i}`, saleId: id, amount: each, date: at(first + 30 * i), isPaid: false, isRealPayment: false }));
      const real = paid.map(([a, d], i) => ({ id: `${id}_p${i}`, saleId: id, amount: a, date: at(d), actualDate: at(d), isPaid: true, isRealPayment: true }));
      let cover = paid.reduce((s, [a]) => s + a, 0);
      for (const r of rows) if (cover >= r.amount) { r.isPaid = true; cover -= r.amount; }
      return { id, customerId, productName, type: 'INSTALLMENT', status: 'ACTIVE', accountId: 'main', totalAmount: total, downPayment: 0, buyPrice: buy ?? Math.round(total / 1.25),
        installments: n, remainingAmount: total - paid.reduce((s, [a]) => s + a, 0), startDate: at(first - 30), paymentPlan: [...rows, ...real] };
    };
    const data = {
      customers: [
        { id: 'c_ai', name: 'Ахмадов Ислам Русланович', phone: '+79000000001' },
        { id: 'c_ar', name: 'Ахмадов Руслан Исаевич', phone: '+79000000002' },
        { id: 'c_da', name: 'Дудаев Адам Магомедович', phone: '+79000000003' },
        { id: 'c_is', name: 'Исаев Хасан Алиевич', phone: '+79000000004' },
        { id: 'c_ma', name: 'Магомедов Зелимхан Умарович', phone: '+79000000005' },
      ],
      accounts: [{ id: 'main', name: 'Основной счёт', type: 'MAIN', isMain: true, initialBalance: 200000 }, { id: 'cash2', name: 'Касса магазина', type: 'MAIN', initialBalance: 30000 }],
      sales: [
        make('s_ai', 'c_ai', 'iPhone 15 128GB', 6, 10000, -60, [[10000, -60], [10000, -30]]),
        make('s_ar', 'c_ar', 'Samsung Galaxy S25', 9, 10000, -10),
        make('s_da1', 'c_da', 'iPhone 16 Pro', 12, 10000, -40, [[10000, -40], [10000, -10]]),
        make('s_da2', 'c_da', 'Телевизор LG 55', 6, 10000, -20, [[10000, -20]]),
        make('s_da3', 'c_da', 'Диван угловой', 5, 9000, -5),
        make('s_is', 'c_is', 'MacBook Air M3', 10, 15000, -150, [[15000, -150], [15000, -120], [15000, -90], [15000, -60], [15000, -35], [10000, -5]]),
        make('s_ma', 'c_ma', 'Холодильник Bosch', 8, 10000, -150, [[10000, -150], [10000, -120], [10000, -90], [10000, -60], [10000, -30]], 60000),
      ],
      products: [{ id: 'prod_case', userId: 'eval', name: 'Чехол для телефона', price: 1500, buyPrice: 300, stock: 20, unit: 'шт' }],
      suppliers: [{ id: 'sup_1', name: 'ООО Поставка' }],
    };
    for (const [type, items] of Object.entries(data)) for (const it of items) await pool.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)', [it.id, 'eval', type, JSON.stringify(it)]);

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

    // ── помощники ──
    const say = async (text, mode = 'confirm', history = []) => { calls = []; const r = await assistant.reply({ user, text, mode, history, silent: true }); r.calls = calls; return r; };
    const sale = async (id) => (await pool.query("SELECT data FROM data_items WHERE id=$1", [id])).rows[0]?.data;
    const realPays = (s) => (s.paymentPlan || []).filter(p => p.isRealPayment === true);
    const snapshot = async () => (await pool.query("SELECT id, data FROM data_items ORDER BY id")).rows.map(r => JSON.stringify(r)).join('\n');
    const card = (r, tool) => (r.actions || []).find(a => a.tool === tool);
    const choices = (r) => (r.actions || []).find(a => a.kind === 'choices');
    const cancelAll = async (r) => { for (const a of r.actions || []) if (a.kind === 'confirm') await assistant.cancelAction('eval', a.id); };
    const fail = (why) => { throw new Error(why); };
    const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

    // История после подтверждённой пачки — как её пишет приложение (AIAssistant.tsx: actionNote)
    const batchHistory = [
      { role: 'user', text: 'Сегодня заплатили: Ахмадов Руслан 5000, Исаев 3000, Дудаев за телевизор 10000' },
      { role: 'assistant', text: 'Проверьте и нажмите «Подтвердить».\n[Выполнено: 3 платежа на 18 000 ₽: Ахмадов Руслан Исаевич — Samsung Galaxy S25 — 5 000 ₽; Исаев Хасан Алиевич — MacBook Air M3 — 3 000 ₽; Дудаев Адам Магомедович — Телевизор LG 55 — 10 000 ₽]' },
    ];
    const scenarios = [
      ['Однофамильцы: «Ахмадов Руслан оплатил 5000» → платёж Руслану, не Исламу; отмена убирает', async () => {
        const before = await snapshot();
        const r = await say('Ахмадов Руслан оплатил 5000');
        const a = card(r, 'create_payment') || fail(`нет карточки платежа: ${r.reply}`);
        if (a.args.contractId !== 's_ar') fail(`платёж не на тот договор: ${a.args.contractId}`);
        if (!near(a.args.amount, 5000)) fail(`сумма ${a.args.amount}`);
        if ((await assistant.confirmAction('eval', a.id)).ok !== true) fail('подтверждение не прошло');
        const s = await sale('s_ar');
        if (realPays(s).length !== 1 || !near(realPays(s)[0].amount, 5000) || !near(s.remainingAmount, 85000)) fail(`в базе: платежей ${realPays(s).length}, остаток ${s.remainingAmount}`);
        if (realPays(await sale('s_ai')).length !== 2) fail('задет договор однофамильца');
        if ((await assistant.undoAction('eval', a.id)).ok !== true) fail('отмена не прошла');
        if (await snapshot() !== before) fail('после отмены база не как была');
      }],
      ['Неоднозначно: «Ахмадов оплатил 5000» → вопрос, какой Ахмадов, ничего не записано', async () => {
        const before = await snapshot();
        const r = await say('Ахмадов оплатил 5000', 'auto');
        if (!choices(r) && !/какой|кто из|уточн/i.test(r.reply)) fail(`не спросил: ${r.reply}`);
        if ((r.actions || []).some(x => x.kind === 'done')) fail('записал наугад');
        if (await snapshot() !== before) fail('база изменилась');
      }],
      ['Три договора: «Дудаев оплатил 10000 за телевизор» → договор телевизора', async () => {
        const r = await say('Дудаев оплатил 10000 за телевизор');
        const a = card(r, 'create_payment') || fail(`нет карточки: ${r.reply}`);
        if (a.args.contractId !== 's_da2') fail(`не тот договор: ${a.args.contractId}`);
        await cancelAll(r);
      }],
      ['Три договора без товара: «Дудаев оплатил 10000» → выбор договора кнопками', async () => {
        const r = await say('Дудаев оплатил 10000');
        const ch = choices(r) || fail(`нет выбора: ${r.reply}`);
        if (ch.options.length < 3) fail(`вариантов ${ch.options.length}`);
        if (card(r, 'create_payment')) fail('карточка без выбора');
      }],
      ['Ошибка в фамилии: «Ахмадов Рускан оплатил 2000» → Руслан или вопрос, но не Ислам', async () => {
        const r = await say('Ахмадов Рускан оплатил 2000');
        const a = card(r, 'create_payment');
        if (a && a.args.contractId !== 's_ar') fail(`записал не тому: ${a.args.contractId}`);
        if (!a && !choices(r) && !/Руслан/i.test(r.reply)) fail(`ни карточки, ни вопроса: ${r.reply}`);
        await cancelAll(r);
      }],
      ['«Авто»: «Исаев оплатил 3000» → записано сразу, остаток −3000; отмена возвращает', async () => {
        const before = await snapshot();
        const r = await say('Исаев оплатил 3000', 'auto');
        const a = (r.actions || []).find(x => x.kind === 'done' && x.tool === 'create_payment') || fail(`не записал: ${r.reply}`);
        const s = await sale('s_is');
        // 150 000 − 85 000 оплачено = 65 000; после 3 000 — 62 000
        const wrong = !near(s.remainingAmount, 62000) || realPays(s).length !== 7 ? `остаток ${s.remainingAmount}, платежей ${realPays(s).length}` : '';
        if ((await assistant.undoAction('eval', a.id)).ok !== true) fail('отмена не прошла');
        if (wrong) fail(wrong);
        if (await snapshot() !== before) fail('после отмены база не как была');
      }],
      ['Переплата: «Исаев оплатил 999 999» в «Авто» → ничего не записано', async () => {
        const before = await snapshot();
        const r = await say('Исаев оплатил 999999', 'auto');
        if ((r.actions || []).some(x => x.kind === 'done' && x.ok)) fail('записал переплату');
        if (await snapshot() !== before) fail('база изменилась');
      }],
      ['Досрочно со скидкой 10%: договор закрыт, скидка от остатка; отмена — снова действует', async () => {
        const before = await snapshot();
        const r = await say('Магомедов закрывает холодильник полностью, дай скидку 10%');
        const a = card(r, 'early_payoff') || fail(`нет карточки: ${r.reply}`);
        if ((await assistant.confirmAction('eval', a.id)).ok !== true) fail('подтверждение не прошло');
        const s = await sale('s_ma');
        const p = realPays(s).find(x => x.discountAmount);
        if (s.status !== 'COMPLETED' || !near(s.remainingAmount, 0) || !p || !near(p.amount, 27000) || !near(p.discountAmount, 3000)) fail(`статус ${s.status}, остаток ${s.remainingAmount}, платёж ${p?.amount}/${p?.discountAmount}`);
        if ((await assistant.undoAction('eval', a.id)).ok !== true) fail('отмена не прошла');
        const back = await sale('s_ma');
        if (back.status !== 'ACTIVE' || !near(back.remainingAmount, 30000)) fail(`после отмены ${back.status} ${back.remainingAmount}`);
        if (await snapshot() !== before) fail('после отмены база не как была');
      }],
      ['Реструктуризация дивана на 4 месяца: открытые платежи = остаток; отмена — прежний график', async () => {
        const before = await snapshot();
        const start = c.addDays(today, 20);
        const r = await say(`Разбей остаток Дудаева за диван на 4 месяца, первый платёж ${start.split('-').reverse().join('.')}`);
        const a = card(r, 'restructure_contract') || fail(`нет карточки: ${r.reply}`);
        if (a.args.contractId !== 's_da3') fail(`не тот договор: ${a.args.contractId}`);
        if ((await assistant.confirmAction('eval', a.id)).ok !== true) fail('подтверждение не прошло');
        const s = await sale('s_da3');
        const open = c.openRows(s);
        if (open.length !== 4 || !near(open.reduce((n, x) => n + x.open, 0), s.remainingAmount) || open[0].day !== start) fail(`строк ${open.length}, сумма ${open.reduce((n, x) => n + x.open, 0)} / ${s.remainingAmount}, первый ${open[0]?.day}`);
        if ((await assistant.undoAction('eval', a.id)).ok !== true) fail('отмена не прошла');
        if (await snapshot() !== before) fail('после отмены база не как была');
      }],
      ['Расход без счёта при двух счетах → выбор счёта; после выбора — расход на этот счёт', async () => {
        const r = await say('Запиши расход бензин 2500');
        const ch = choices(r) || fail(`не спросил счёт: ${r.reply}`);
        const opt = ch.options.find(o => /Касса магазина/.test(o.label)) || fail('нет варианта «Касса магазина»');
        const r2 = await say(`${opt.label} [${opt.ref}]`, 'confirm', [{ role: 'user', text: 'Запиши расход бензин 2500' }, { role: 'assistant', text: r.reply }]);
        const a = card(r2, 'create_expense') || fail(`нет карточки расхода: ${r2.reply}`);
        if (a.args.accountId !== 'cash2' || !near(a.args.amount, 2500)) fail(`счёт ${a.args.accountId}, сумма ${a.args.amount}`);
        if ((await assistant.confirmAction('eval', a.id)).ok !== true) fail('подтверждение не прошло');
        const e = (await pool.query("SELECT data FROM data_items WHERE type='expenses' AND data->>'accountId'='cash2'")).rows.map(x => x.data);
        if (e.length !== 1 || !near(e[0].amount, 2500)) fail(`расходов в базе ${e.length}`);
        if ((await assistant.undoAction('eval', a.id)).ok !== true) fail('отмена не прошла');
      }],
      ['«Удали последний платёж Исаева» → удаляется именно последний (10 000 от −5 дней); отмена возвращает', async () => {
        const before = await snapshot();
        const r = await say('удали последний платёж Исаева, записан по ошибке');
        const a = card(r, 'delete_payment') || fail(`нет карточки: ${r.reply}`);
        if (a.args.paymentId !== 's_is_p5') fail(`не тот платёж: ${a.args.paymentId}`);
        if ((await assistant.confirmAction('eval', a.id)).ok !== true) fail('подтверждение не прошло');
        const s = await sale('s_is');
        const wrong = realPays(s).some(p => p.id === 's_is_p5') || !near(s.remainingAmount, 75000) ? `остаток ${s.remainingAmount}` : '';
        if ((await assistant.undoAction('eval', a.id)).ok !== true) fail('отмена не прошла');
        if (wrong) fail(wrong);
        const back = await sale('s_is');
        if (!near(back.remainingAmount, 65000) || realPays(back).length !== 6) fail(`после отмены остаток ${back.remainingAmount}`);
        void before;
      }],
      ['Обещание «Исаев обещал 5000 до 30 числа» → сумма и дата 30-го (этого или следующего месяца)', async () => {
        const r = await say('Исаев обещал заплатить 5000 до 30 числа', 'auto');
        const a = (r.actions || []).find(x => x.tool === 'promise_payment') || fail(`нет обещания: ${r.reply}`);
        const args = calls.filter(x => x.name === 'promise_payment').pop()?.args || {};
        if (a.kind === 'done' && a.undoable) await assistant.undoAction('eval', a.id); else await cancelAll(r);
        if (!near(args.amount, 5000) || !/-30$/.test(args.date) || args.date < today || args.contractId !== 's_is') fail(`сумма ${args.amount}, дата ${args.date}, договор ${args.contractId}`);
        const left = Number((await pool.query('SELECT count(*) FROM ai_payment_promises')).rows[0].count);
        if (left !== 0) fail('после отмены обещание осталось');
      }],
      ['Продажа в «Авто»: «продал 3 чехла» → остаток 17, чек 4 500; отмена → 20', async () => {
        const before = await snapshot();
        // Счетов два, у склада счёт не задан — агент должен спросить; отвечаем кнопкой
        let r = await say('продал 3 чехла за наличные', 'auto');
        const ch = choices(r);
        if (ch) {
          const opt = ch.options.find(o => /Касса магазина/.test(o.label)) || fail('нет варианта «Касса магазина»');
          r = await say(`${opt.label} [${opt.ref}]`, 'auto', [{ role: 'user', text: 'продал 3 чехла за наличные' }, { role: 'assistant', text: r.reply }]);
        }
        const a = (r.actions || []).find(x => x.tool === 'retail_sale' && x.kind === 'done') || fail(`не провёл: ${r.reply}`);
        const p = (await pool.query("SELECT data FROM data_items WHERE id='prod_case'")).rows[0].data;
        const chk = (await pool.query("SELECT data FROM data_items WHERE type='retailSales'")).rows.map(x => x.data);
        if (p.stock !== 17 || chk.length !== 1 || !near(chk[0].total, 4500) || chk[0].accountId !== 'cash2') fail(`остаток ${p.stock}, чеков ${chk.length}, сумма ${chk[0]?.total}, счёт ${chk[0]?.accountId}`);
        if ((await assistant.undoAction('eval', a.id)).ok !== true) fail('отмена не прошла');
        // Товар после отмены: тот же остаток; разбивка {main: 20} и updatedAt — так пишет и приложение
        const prod = (await pool.query("SELECT data FROM data_items WHERE id='prod_case'")).rows[0].data;
        if (prod.stock !== 20 || (prod.warehouseStocks && prod.warehouseStocks.main !== 20)) fail(`остаток после отмены ${prod.stock}`);
        const strip = (t) => t.split('\n').filter(x => !x.startsWith('{"id":"prod_case"')).join('\n');
        const after = strip(await snapshot());
        if (after !== strip(before)) {
          const b = new Set(strip(before).split('\n')), d = after.split('\n').filter(x => !b.has(x));
          const a2 = new Set(after.split('\n')), g = strip(before).split('\n').filter(x => !a2.has(x));
          fail(`после отмены база не как была. Было: ${g.join(' | ').slice(0, 300)} || Стало: ${d.join(' | ').slice(0, 300)}`);
        }
      }],
      ['Платёж с датой «вчера»: «Ахмадов Ислам заплатил вчера 10000» → дата вчерашняя', async () => {
        const r = await say('Ахмадов Ислам заплатил вчера 10000');
        const a = card(r, 'create_payment') || fail(`нет карточки: ${r.reply}`);
        if (a.args.contractId !== 's_ai' || !near(a.args.amount, 10000)) fail(`договор ${a.args.contractId}, сумма ${a.args.amount}`);
        if (String(a.args.date || '').slice(0, 10) !== c.addDays(today, -1)) fail(`дата ${a.args.date || 'не передана'} вместо ${c.addDays(today, -1)}`);
        await cancelAll(r);
      }],
      // ── несколько платежей одной карточкой (record_payments) ──
      ['Список: «Ахмадов Руслан 5000, Исаев 3000, Дудаев за телевизор 10000» → одна карточка, 3 платежа на нужные договоры; отмена — как было', async () => {
        const before = await snapshot();
        const r = await say('Сегодня заплатили: Ахмадов Руслан 5000, Исаев 3000, Дудаев за телевизор 10000', 'auto');
        const a = card(r, 'record_payments') || fail(`нет карточки пачки: ${r.reply}`);
        if (a.kind !== 'confirm') fail('пачка записана без «Подтвердить»');
        if (card(r, 'create_payment')) fail('вместе с пачкой — отдельные платежи');
        if ((await assistant.confirmAction('eval', a.id)).ok !== true) fail('подтверждение не прошло');
        const got = { s_ar: (await sale('s_ar')).remainingAmount, s_is: (await sale('s_is')).remainingAmount, s_da2: (await sale('s_da2')).remainingAmount };
        const want = { s_ar: 85000, s_is: 62000, s_da2: 40000 };
        const wrong = Object.keys(want).filter(k => !near(got[k], want[k]));
        const untouched = realPays(await sale('s_da1')).length === 2 && realPays(await sale('s_ai')).length === 2;
        if ((await assistant.undoAction('eval', a.id)).ok !== true) fail('отмена не прошла');
        if (wrong.length) fail(`остатки: ${JSON.stringify(got)}`);
        if (!untouched) fail('задеты чужие договоры');
        if (await snapshot() !== before) fail('после отмены база не как была');
      }],
      ['Список с однофамильцем: «Ахмадов 5000, Исаев 3000» → вопрос про Ахмадова, ничего не записано; ответ «Руслан» → карточка на двоих', async () => {
        const before = await snapshot();
        const q = 'Ахмадов 5000, Исаев 3000 — запиши платежи';
        const r = await say(q, 'auto');
        if (card(r, 'record_payments') || (r.actions || []).some(x => x.kind === 'done')) fail('записал, не уточнив Ахмадова');
        if (!/Ахмадов/.test(r.reply + JSON.stringify(r.actions || []))) fail(`не спросил про Ахмадова: ${r.reply}`);
        if (await snapshot() !== before) fail('база изменилась');
        const ch = choices(r);
        const answer = ch ? ch.options.find(o => /Ахмадов Руслан/.test(o.label)) : null;
        const r2 = await say(answer ? `${answer.label}${answer.ref ? ` [${answer.ref}]` : ''}` : 'Руслан', 'confirm', [{ role: 'user', text: q }, { role: 'assistant', text: r.reply }]);
        const a = card(r2, 'record_payments') || fail(`после уточнения нет карточки: ${r2.reply}`);
        if (!/Ахмадов Руслан[^;]*5\s000/.test(a.summary) || !/Исаев[^;]*3\s000/.test(a.summary)) fail(`карточка: ${a.summary}`);
        await cancelAll(r2);
      }],
      ['Список словами: «Магомедов пять тысяч, Исаев две тысячи» → 5 000 и 2 000', async () => {
        const r = await say('запиши платежи: Магомедов пять тысяч, Исаев две тысячи');
        const a = card(r, 'record_payments') || fail(`нет карточки: ${r.reply}`);
        if (!/Магомедов[^;]*5\s000/.test(a.summary) || !/Исаев[^;]*2\s000/.test(a.summary)) fail(`карточка: ${a.summary}`);
        await cancelAll(r);
      }],
      ['Переплата в строке: «Исаев 999 999, Магомедов 5000» → карточки нет, сказано про остаток', async () => {
        const before = await snapshot();
        const r = await say('Исаев 999999, Магомедов 5000 — запиши', 'auto');
        if (card(r, 'record_payments') || (r.actions || []).some(x => x.kind === 'done' && x.ok)) fail('записал переплату');
        if (!/остат|больше/i.test(r.reply)) fail(`не объяснил: ${r.reply}`);
        if (await snapshot() !== before) fail('база изменилась');
      }],
      ['Один платёж — по-прежнему обычная карточка, не пачка', async () => {
        const r = await say('Магомедов оплатил 5000');
        if (card(r, 'record_payments')) fail('один платёж ушёл пачкой');
        if (!card(r, 'create_payment')) fail(`нет карточки платежа: ${r.reply}`);
        await cancelAll(r);
      }],
      // ── чек после пачки: всем, одному или вопрос ──
      ['После пачки «отправь чеки всем» → чек каждому из пачки, и только им', async () => {
        const r = await say('отправь чеки всем', 'confirm', batchHistory);
        const sends = (r.actions || []).filter(x => x.kind === 'send_doc');
        const got = sends.map(x => `${x.saleId}:${x.doc}`).sort().join(',');
        if (got !== 's_ar:receipt,s_da2:receipt,s_is:receipt') fail(`отправки: ${got || 'нет'} — ${r.reply}`);
      }],
      ['После пачки «отправь чек Исаеву» → только Исаеву', async () => {
        const r = await say('отправь чек Исаеву', 'confirm', batchHistory);
        const got = (r.actions || []).filter(x => x.kind === 'send_doc').map(x => `${x.saleId}:${x.doc}`).join(',');
        if (got !== 's_is:receipt') fail(`отправки: ${got || 'нет'} — ${r.reply}`);
      }],
      ['После пачки просто «отправь чек» → спросить кому (всем или кому-то), не слать наугад одному', async () => {
        const r = await say('отправь чек', 'confirm', batchHistory);
        const sends = (r.actions || []).filter(x => x.kind === 'send_doc');
        const asked = !!choices(r) || /кому|всем|кого/i.test(r.reply);
        if (sends.length === 1) fail(`отправил одному наугад: ${sends[0].saleId}`);
        if (!asked && sends.length !== 3) fail(`ни вопроса, ни всех трёх: ${r.reply}`);
      }],
      ['После вопроса «кому» нажали «Всем (3)» → три чека; нажали «Исаев Хасан Алиевич» → один', async () => {
        const asked = [...batchHistory, { role: 'user', text: 'отправь чек' }, { role: 'assistant', text: 'Кому отправить чек?' }];
        const all = await say('Всем (3)', 'confirm', asked);
        const a = (all.actions || []).filter(x => x.kind === 'send_doc').map(x => x.saleId).sort().join(',');
        if (a !== 's_ar,s_da2,s_is') fail(`«Всем»: ${a || 'нет'} — ${all.reply}`);
        const one = await say('Исаев Хасан Алиевич', 'confirm', asked);
        const o = (one.actions || []).filter(x => x.kind === 'send_doc').map(x => x.saleId).join(',');
        if (o !== 's_is') fail(`по имени: ${o || 'нет'} — ${one.reply}`);
      }],
      // ── договоры после пачки и «все договоры» без пачки ──
      ['После пачки «отправь договоры всем» → договор каждому из пачки, и только им', async () => {
        const r = await say('отправь договоры всем', 'confirm', batchHistory);
        const got = (r.actions || []).filter(x => x.kind === 'send_doc').map(x => `${x.saleId}:${x.doc}`).sort().join(',');
        if (got !== 's_ar:contract,s_da2:contract,s_is:contract') fail(`отправки: ${got || 'нет'} — ${r.reply}`);
      }],
      ['После пачки просто «отправь договор» → спросить кому', async () => {
        const r = await say('отправь договор', 'confirm', batchHistory);
        const sends = (r.actions || []).filter(x => x.kind === 'send_doc');
        if (sends.length) fail(`отправил без вопроса: ${sends.map(x => x.saleId).join(',')}`);
        const ch = choices(r);
        if (!(ch && /договор/i.test(ch.title)) && !/какого клиента|кому|кого/i.test(r.reply)) fail(`не спросил, кому: ${ch?.title || r.reply}`);
      }],
      ['Без пачки «отправь все договоры клиентам» в «Авто» → не рассылает всем подряд', async () => {
        const r = await say('отправь все договоры клиентам', 'auto');
        const sends = (r.actions || []).filter(x => x.kind === 'send_doc');
        if (sends.length > 3) fail(`подготовил ${sends.length} договоров: ${sends.map(x => x.saleId).join(',')}`);
        if (sends.length > 1 && sends.some(x => x.auto)) fail('несколько договоров ушли бы сами, без «Отправить»');
      }],
    ];

    const only = process.env.AI_EVAL_ONLY ? new Set(process.env.AI_EVAL_ONLY.split(',').map(Number)) : null;
    let failed = 0, ran = 0;
    for (let i = 0; i < scenarios.length; i++) {
      if (only && !only.has(i + 1)) continue;
      const [name, fn] = scenarios[i];
      const t = Date.now();
      let err = '';
      try { await fn(); } catch (e) { err = e.message; }
      ran++; if (err) failed++;
      console.log(`${err ? '✗' : '✓'} ${String(i + 1).padStart(2)}. ${name}  ${((Date.now() - t) / 1000).toFixed(1)} с${err ? `\n     — ${err}` : ''}`);
      if ((err || process.env.AI_EVAL_DEBUG) && calls.length) console.log(`     вызовы: ${calls.map(x => `${x.name} ${JSON.stringify(x.args)}`).join(' | ').slice(0, 700)}`);
    }
    console.log(`\n${ran - failed} из ${ran} прошли`);
    process.exitCode = failed ? 1 : 0;
  } finally {
    if (server) await new Promise(r => server.close(r));
    if (pool) await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
