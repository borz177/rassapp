#!/usr/bin/env node
// Новые умения FinUchetGPT на настоящей модели: прогноз, взыскание и обещания,
// досрочное погашение, реструктуризация, склад. Только синтетические записи в
// отдельной схеме локального PostgreSQL; схема удаляется в конце.
//
//   node server/ai/evals/skills-isolated.js
//   AI_EVAL_ONLY=3,5 — только эти сценарии; AI_EVAL_DEBUG=1 — ответы и вызовы целиком
//
// Нужен ключ OpenRouter в server/.env. Стоимость прогона — несколько центов.
require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), quiet: true });
const { Pool } = require('pg'), express = require('express'), jwt = require('jsonwebtoken');
const { randomBytes } = require('crypto');
const c = require('../collections');

// AI_EVAL_DAYTIME=1 — «сейчас полдень по Москве»: письма должникам проверяются и ночью
// (подменяется только час, который спрашивают с timeZone Europe/Moscow)
if (process.env.AI_EVAL_DAYTIME) {
  const orig = Date.prototype.toLocaleString;
  Date.prototype.toLocaleString = function (locale, opts) {
    return opts && opts.hour && !opts.minute && opts.timeZone === 'Europe/Moscow' ? '12' : orig.call(this, locale, opts);
  };
}
// Какие инструменты вызвала модель — читаем ответы OpenRouter
let calls = [];
const native = global.fetch;
global.fetch = async (...args) => {
  const r = await native(...args);
  if (String(args[0]).includes('/chat/completions')) {
    const d = await r.clone().json().catch(() => null);
    for (const t of d?.choices?.[0]?.message?.tool_calls || []) {
      let a = {};
      try { a = JSON.parse(t.function.arguments || '{}'); } catch { /* пусто */ }
      calls.push({ name: t.function.name, args: a });
    }
  }
  return r;
};

(async () => {
  const url = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw Error('Только локальный PostgreSQL');
  const schema = `agent_skills_eval_${randomBytes(6).toString('hex')}`, secret = randomBytes(32).toString('hex');
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
    const at = (offset) => new Date(`${c.addDays(today, offset)}T00:00:00+03:00`).toISOString();
    const contract = (id, customerId, productName, first, paid, paidAt = first) => {
      const rows = Array.from({ length: 12 }, (_, i) => ({ id: `${id}_r${i}`, saleId: id, amount: 10000, date: at(first + i * 30), isPaid: false, isRealPayment: false }));
      let left = paid;
      for (const r of rows) if (left >= r.amount) { r.isPaid = true; left -= r.amount; }
      return { id, customerId, productName, type: 'INSTALLMENT', status: 'ACTIVE', accountId: 'main', totalAmount: 120000, downPayment: 0, buyPrice: 100000,
        remainingAmount: 120000 - paid, startDate: at(first - 30),
        paymentPlan: [...rows, ...(paid ? [{ id: `${id}_paid`, saleId: id, amount: paid, date: at(paidAt), actualDate: at(paidAt), isPaid: true, isRealPayment: true }] : [])] };
    };
    const data = {
      customers: [{ id: 'cust_a', name: 'Ахмадов Ахмад', phone: '+79000000001' }, { id: 'cust_d', name: 'Дудаева Марьям', phone: '+79000000002' }],
      accounts: [{ id: 'main', name: 'Основной счёт', type: 'MAIN', initialBalance: 100000 }],
      sales: [contract('sale_a', 'cust_a', 'Телевизор Samsung', -45, 15000, -20), contract('sale_d', 'cust_d', 'Диван', -10, 0)],
      products: [{ id: 'prod_case', userId: 'eval', name: 'Чехол для телефона', price: 1500, buyPrice: 300, stock: 20, unit: 'шт' }],
      suppliers: [{ id: 'sup_1', name: 'ООО Поставка' }],
    };
    for (const [type, items] of Object.entries(data)) for (const item of items) await pool.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)', [item.id, 'eval', type, JSON.stringify(item)]);

    const app = express(); app.use(express.json({ limit: '5mb' }));
    const atomic = require('../../api/atomicWrites').createAtomicWrites(pool);
    let assistant;
    app.post('/api/integrations/whatsapp/send-reminder', (req, res) => res.json({ success: true }));
    app.use('/api/v1', (req, res, next) => {
      const owner = assistant.verifyAgentToken((req.get('authorization') || '').replace(/^Bearer /, ''));
      if (owner !== 'eval') return res.sendStatus(401);
      req.apiAuth = { userId: owner, scopes: ['read', 'write'], key: { isAgent: true }, user: { id: owner, role: 'admin' } }; next();
    }, atomic.middleware, require('../../api/v1').createApiV1Router({ pool: atomic.db, checkContractLimit: async () => true, planLimits: {} }));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    assistant = require('../assistant').createAssistant({ pool, jwt, jwtSecret: secret, port: server.address().port, checkFeatureAccess: async () => ({ allowed: true }) });
    const user = { id: 'eval', name: 'Тестовый владелец' };
    const say = async (text, mode = 'confirm', history = []) => { calls = []; const r = await assistant.reply({ user, text, mode, history, silent: true }); r.calls = calls; return r; };
    const used = (r, name) => r.calls.some(x => x.name === name);
    const card = (r, tool) => (r.actions || []).find(a => a.tool === tool);
    const noIds = (r) => !/\b(cust|sale|prod|sup|acc|pay)_[\w-]+/.test(r.reply || '');
    const cancel = async (r) => { for (const a of r.actions || []) if (a.kind === 'confirm') await assistant.cancelAction('eval', a.id); };
    const undo = async (r) => { for (const a of r.actions || []) if (a.undoable) await assistant.undoAction('eval', a.id, { silent: true }); };
    const friday = (() => { let d = today; while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 5 || d === today) d = c.addDays(d, 1); return d; })();
    const night = (() => {
      const h = Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false }));
      const wd = new Date(`${today}T12:00:00Z`).getUTCDay();
      return wd === 0 || wd === 6 ? (h < 9 || h >= 20) : (h < 8 || h >= 22);
    })();

    const scenarios = [
      ['«Кому звонить?» → очередь взыскания, оба должника по ФИО, без id', async () => {
        const r = await say('кому мне сегодня звонить по долгам?');
        return used(r, 'collection_queue') && /Ахмадов/.test(r.reply) && /Дудаев/.test(r.reply) && noIds(r);
      }],
      ['«Обещал до пятницы» → карточка обещания с суммой и ближайшей пятницей', async () => {
        const r = await say('Ахмадов обещал заплатить 10 000 до пятницы');
        const a = card(r, 'promise_payment');
        await cancel(r);
        // В пятницу «до пятницы» — и сегодня, и через неделю: оба прочтения допустимы
        const days = [friday, ...(new Date(`${today}T12:00:00Z`).getUTCDay() === 5 ? [today] : [])].map(d => d.split('-').reverse().join('.'));
        return !!a && a.kind === 'confirm' && /10\s000/.test(a.summary) && days.some(d => a.summary.includes(d));
      }],
      ['«Сколько придёт за неделю» → прогноз, а не список платежей вручную', async () => {
        const r = await say('сколько денег придёт на этой неделе и в этом месяце?');
        return used(r, 'cash_forecast') && /\d/.test(r.reply) && noIds(r);
      }],
      ['«Сколько закрыть досрочно со скидкой» → расчёт без записи', async () => {
        const r = await say('сколько Ахмадову надо заплатить, чтобы закрыть телевизор досрочно, если дам скидку 10%?');
        return used(r, 'payoff_quote') && !card(r, 'early_payoff') && /94\s?500/.test(r.reply.replace(/ | /g, ' '));
      }],
      ['«Закрывает полностью, скидка 5000» → карточка досрочного закрытия', async () => {
        const r = await say('Ахмадов закрывает телевизор полностью, дай ему скидку 5000 рублей');
        const a = card(r, 'early_payoff');
        await cancel(r);
        return !!a && a.kind === 'confirm' && /скидка 5\s000/.test(a.summary) && /100\s000/.test(a.summary);
      }],
      ['«Разбей остаток на 6 месяцев» → реструктуризация, не перенос даты', async () => {
        const r = await say(`разбей остаток Дудаевой за диван на 6 месяцев, первый платёж ${c.addDays(today, 20).split('-').reverse().join('.')}`, 'auto');
        const a = card(r, 'restructure_contract');
        await cancel(r);
        return !!a && a.kind === 'confirm' && /на 6 мес/.test(a.summary) && !(r.actions || []).some(x => x.kind === 'reschedule');
      }],
      ['«Перенеси платёж на …» → перенос даты, не реструктуризация', async () => {
        const r = await say(`перенеси Дудаевой первый платёж за диван на ${c.addDays(today, 25).split('-').reverse().join('.')}`);
        return (r.actions || []).some(x => x.kind === 'reschedule') && !card(r, 'restructure_contract');
      }],
      ['«Напиши должнику вежливо» → письмо по стадии, без угроз, ждёт «Подтвердить»', async () => {
        const r = await say('напиши Ахмадову в ватсап вежливое напоминание о долге за телевизор');
        const a = card(r, 'send_collection_message');
        await cancel(r);
        // Ночью письмо не уходит: агент говорит об этом или сразу ставит задачу на утро
        if (night) return !a && (/утр|днём|нерабоч|8|9/i.test(r.reply) || !!card(r, 'create_task'));
        return !!a && a.kind === 'confirm' && /Ахмад/.test(a.summary) && !/полици|коллектор|суд/i.test(a.summary);
      }],
      ['«Пришло 10 чехлов от Поставки по 300» → приход с поставщиком и ценой', async () => {
        const r = await say('пришло 10 чехлов от ООО Поставка по 300 рублей');
        const a = card(r, 'stock_receive');
        await cancel(r);
        return !!a && /Поставка/.test(a.summary) && /10 шт/.test(a.summary);
      }],
      ['«Продал 2 чехла» в «Авто» → чек проведён, остаток уменьшился, отмена вернула', async () => {
        const r = await say('продал 2 чехла за наличные', 'auto');
        const a = card(r, 'retail_sale');
        const stockAfter = (await pool.query("SELECT (data->>'stock')::int AS n FROM data_items WHERE id='prod_case'")).rows[0].n;
        await undo(r);
        const stockBack = (await pool.query("SELECT (data->>'stock')::int AS n FROM data_items WHERE id='prod_case'")).rows[0].n;
        return !!a && a.ok && stockAfter === 18 && stockBack === 20;
      }],
      ['«Почему упали сборы» → сравнение периодов, причина — кто перестал платить', async () => {
        const r = await say('почему у меня упали сборы за последние две недели по сравнению с двумя неделями до этого?');
        return used(r, 'compare_periods') && /Ахмадов/.test(r.reply) && noIds(r);
      }],
      ['«Сравни сентябрь с августом» → полные месяцы в обоих периодах', async () => {
        const r = await say('сравни сентябрь с августом этого года по прибыли и расходам');
        const a = r.calls.find(x => x.name === 'compare_periods')?.args || {};
        const y = today.slice(0, 4);
        return a.from === `${y}-09-01` && a.to === `${y}-09-30` && a.compareFrom === `${y}-08-01` && a.compareTo === `${y}-08-31`;
      }],
      // Разговор с прода 23.10: срок датами — договор не оформлялся пять минут
      ['Срок датами «С 14.10.2026 по 14.03.2027» в ответ на вопрос → черновик на 5 месяцев', async () => {
        const history = [
          { role: 'user', text: 'Оформи договор' },
          { role: 'assistant', text: 'Для оформления договора нужны: ФИО клиента, товар, закуп, срок и наценка.' },
          { role: 'user', text: 'Абдурзакова Зарема Расуловна, айфон 17 про макс 256, закуп 117000, взнос 25000, наценка 25%' },
          { role: 'assistant', text: 'Уточните срок рассрочки в месяцах и телефон клиента.' },
        ];
        const r = await say('+7 961 885 15 15\nС 14.10.2026 по 14.03.2027', 'confirm', history);
        const d = (r.actions || []).find(a => a.kind === 'contract_form')?.draft;
        return !!d && Number(d.months) === 5 && Number(d.buyPrice) === 117000 && !/ничего не записано/.test(r.reply);
      }],
      ['Всё одним сообщением, срок датами → черновик сразу', async () => {
        const r = await say('Абдурзакова Зарема Расуловна\nАйфон 17 pro max silver\nС 14.10.2026 по 14.03.2027\n117000\n25%\nСо взносом 25000\n+7 961 885 15 15');
        const d = (r.actions || []).find(a => a.kind === 'contract_form')?.draft;
        return !!d && Number(d.months) === 5 && !/ничего не записано/.test(r.reply);
      }],
      ['«Можно добавить свой образец договора?» → да, как это сделать', async () => {
        const r = await say('Можно добавить свой образец договора?');
        return /фото|Печатная форма|шаблон/i.test(r.reply) && !/не могу|не умею|только стандарт/i.test(r.reply);
      }],
      // Кнопки подсказок агента (server/ai/proactive.js) — нажатие отправляет ровно эту фразу
      ['Кнопка «Напиши письмо о долге: …» → письмо должнику, а не шаблон', async () => {
        const r = await say('Напиши письмо о долге: Ахмадов Ахмад, Телевизор Samsung');
        const a = card(r, 'send_collection_message');
        await cancel(r);
        if (night) return !a;
        return !!a && a.kind === 'confirm' && !(r.actions || []).some(x => x.tool === 'send_reminder');
      }],
      ['Кнопка «Напиши официальное письмо о долге: …» → письмо, без суда до 30 дней', async () => {
        const r = await say('Напиши официальное письмо о долге: Ахмадов Ахмад, Телевизор Samsung');
        const a = card(r, 'send_collection_message');
        await cancel(r);
        if (night) return !a;
        return !!a && !/(^|[^а-яё])суд(?!я)/i.test(a.summary);
      }],
      ['Кнопка «Оформи приход: Чехол для телефона» → спрашивает поставщика и количество, ничего не проводит', async () => {
        const r = await say('Оформи приход: Чехол для телефона');
        return !(r.actions || []).some(x => x.kind === 'done') && /поставщ|сколько|количеств/i.test(r.reply);
      }],
      // Прод 23–24.10: агент выдумал месяцы сверх 180 дней, не знал ожидаемую прибыль, «чат в разделе Задачи», закят «не по делу»
      ['«Распиши по месяцам до конца договоров» → все месяцы из учёта, последний — настоящий', async () => {
        const r = await say('распиши по месяцам сколько я получу от клиентов, пока не закончатся все договоры');
        const f = r.calls.find(x => x.name === 'cash_forecast');
        const plan = c.forecast({ sales: data.sales, customers: data.customers, today, untilEnd: true });
        const last = plan.byMonth[plan.byMonth.length - 1];
        const MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма[йя]', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
        const stem = MONTHS[Number(last.month.slice(5, 7)) - 1];
        const lastSaid = new RegExp(stem, 'i').test(r.reply) || r.reply.includes(last.month.slice(5, 7) + '.' + last.month.slice(0, 4));
        return !!f && f.args.untilEnd === true && lastSaid && r.reply.replace(/[\s  ]/g, '').includes(String(last.total));
      }],
      ['«Точно все расписал?» → считает заново, а не «перепроверил» по памяти', async () => {
        const history = [{ role: 'user', text: 'распиши по месяцам сколько я получу' }, { role: 'assistant', text: 'Ноябрь: 20 000 ₽, декабрь: 20 000 ₽.' }];
        const r = await say('ты точно все договоры расписал? у меня рассрочки почти на год', 'confirm', history);
        return r.calls.some(x => x.name === 'cash_forecast');
      }],
      ['«Ожидаемая прибыль в ноябре» → цифра из прогноза, а не отчёт Excel', async () => {
        const r = await say('какая ожидаемая прибыль с платежей в ноябре?');
        const plan = c.forecast({ sales: data.sales, customers: data.customers, today, untilEnd: true });
        const nov = plan.byMonth.find(m => m.month.endsWith('-11'));
        return r.calls.some(x => x.name === 'cash_forecast') && !!nov && r.reply.replace(/[\s  ]/g, '').includes(String(nov.profit)) && !(r.actions || []).some(a => a.kind === 'report');
      }],
      ['«Не могу найти чат с тобой» → шар в шапке, без выдуманных разделов', async () => {
        const r = await say('чат с вами не могу иногда найти, где вы находитесь?');
        return /шар|шапк/i.test(r.reply) && !/Задач|Сообщени/i.test(r.reply);
      }],
      ['«Где найти закят» → Главная → «В обороте», не «вопрос не по делу»', async () => {
        const r = await say('где найти закят?');
        return /В обороте/i.test(r.reply) && !/по делу|не связан/i.test(r.reply);
      }],
      ['«Спиши чехол» без причины → спрашивает причину, ничего не списывает', async () => {
        const r = await say('спиши один чехол');
        return !card(r, 'stock_write_off') || card(r, 'stock_write_off').kind !== 'done'
          ? ((r.actions || []).some(x => x.kind === 'choices') || /причин|брак|порч/i.test(r.reply)) && !(r.actions || []).some(x => x.kind === 'done')
          : false;
      }],
    ];

    const only = process.env.AI_EVAL_ONLY ? new Set(process.env.AI_EVAL_ONLY.split(',').map(Number)) : null;
    let failed = 0, ran = 0;
    for (let i = 0; i < scenarios.length; i++) {
      if (only && !only.has(i + 1)) continue;
      const [name, fn] = scenarios[i];
      const t = Date.now();
      let ok = false, err = '';
      try { ok = await fn(); } catch (e) { err = e.message; }
      ran++; if (!ok) failed++;
      console.log(`${ok ? '✓' : '✗'} ${String(i + 1).padStart(2)}. ${name}  ${((Date.now() - t) / 1000).toFixed(1)} с${err ? `  — ${err}` : ''}`);
      if ((!ok || process.env.AI_EVAL_DEBUG) && calls.length) console.log(`     вызовы: ${calls.map(x => `${x.name} ${JSON.stringify(x.args)}`).join(' | ').slice(0, 900)}`);
    }
    console.log(`\n${ran - failed} из ${ran} прошли`);
    process.exitCode = failed ? 1 : 0;
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
