// Новые умения агента целиком, без настоящей модели: подменная «модель» отвечает
// заранее заданными вызовами инструментов, а дальше — настоящий путь: карточка,
// «Подтвердить», запись в PostgreSQL (отдельная схема), «Отменить».
// Только локальная база (DATABASE_URL на localhost), иначе тест пропускается.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');

const url = process.env.DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);

test('умения: реструктуризация, досрочное погашение, обещание, письмо должнику, склад — подтверждение и отмена', { skip: !local }, async () => {
  const { Pool } = require('pg');
  const express = require('express');
  const jwt = require('jsonwebtoken');
  const c = require('./collections');

  // ── подменная модель ──
  const script = [];
  const seen = [];
  const model = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      seen.push(JSON.parse(body));
      const next = script.shift() || { content: 'Готово.' };
      const message = next.tool
        ? { role: 'assistant', content: '', tool_calls: [{ id: `call_${seen.length}`, type: 'function', function: { name: next.tool, arguments: JSON.stringify(next.args || {}) } }] }
        : { role: 'assistant', content: next.content };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message }], usage: {} }));
    });
  });
  await new Promise(r => model.listen(0, '127.0.0.1', r));
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${model.address().port}`;
  process.env.OPENROUTER_API_KEY = 'test';
  const lastToolResult = () => {
    const msgs = seen[seen.length - 1].messages;
    return msgs.filter(m => m.role === 'tool').pop()?.content || '';
  };

  const schema = `agent_skills_${crypto.randomBytes(6).toString('hex')}`;
  const admin = new Pool({ connectionString: url });
  let pool, app;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
    await pool.query('CREATE TABLE data_items(id text PRIMARY KEY,user_id text,type text,data jsonb,updated_at timestamptz DEFAULT NOW())');
    await pool.query('CREATE TABLE users(id text PRIMARY KEY,role text,manager_id text,subscription jsonb,whatsapp_settings jsonb)');
    await pool.query('CREATE TABLE api_idempotency(user_id text,key text,endpoint text,request_hash text,status int,response jsonb,PRIMARY KEY(user_id,key))');
    await pool.query(`INSERT INTO users(id,role,whatsapp_settings) VALUES('owner','manager','{"enabled":true}')`);

    const today = c.mskDay();
    const at = (offset) => new Date(`${c.addDays(today, offset)}T00:00:00+03:00`).toISOString();
    const sale = (id, { first, paid = 0, remaining }) => {
      const rows = Array.from({ length: 12 }, (_, i) => ({ id: `${id}_r${i}`, saleId: id, amount: 10000, date: at(first + i * 30), isPaid: false, isRealPayment: false }));
      let left = paid;
      for (const r of rows) if (left >= r.amount) { r.isPaid = true; left -= r.amount; }
      return { id, customerId: 'cust', type: 'INSTALLMENT', status: 'ACTIVE', productName: id === 'r' ? 'iPhone 16' : 'Samsung S25', accountId: 'acc',
        totalAmount: 120000, downPayment: 0, buyPrice: 100000, remainingAmount: remaining ?? 120000 - paid, startDate: at(first - 30),
        paymentPlan: [...rows, ...(paid ? [{ id: `${id}_paid`, saleId: id, amount: paid, date: at(-10), actualDate: at(-10), isPaid: true, isRealPayment: true }] : [])] };
    };
    const items = {
      customers: [{ id: 'cust', name: 'Иванов Иван', phone: '79001234567' }],
      accounts: [{ id: 'acc', name: 'Касса' }],
      sales: [sale('r', { first: -45, paid: 15000 }), sale('q', { first: -45, paid: 60000 })],
      products: [{ id: 'p1', userId: 'owner', name: 'Чехол', price: 1500, buyPrice: 500, stock: 10 }],
      suppliers: [{ id: 's1', name: 'ООО Поставка' }],
    };
    for (const [type, list] of Object.entries(items)) for (const d of list) await pool.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)', [d.id, 'owner', type, JSON.stringify(d)]);

    // ── /api/v1 и WhatsApp-заглушка на одном порту, как у сервера ──
    const secret = 'test-secret';
    const sent = [];
    const atomic = require('../api/atomicWrites').createAtomicWrites(pool);
    app = express(); app.use(express.json());
    app.post('/api/integrations/whatsapp/send-reminder', (req, res) => { sent.push(req.body); res.json({ success: true }); });
    app.use('/api/v1', (req, res, next) => {
      const sub = jwt.verify(String(req.get('authorization') || '').replace(/^Bearer fu_agent_/, ''), secret).sub;
      req.apiAuth = { userId: sub, scopes: ['read', 'write'], key: { isAgent: true } };
      next();
    }, atomic.middleware, require('../api/v1').createApiV1Router({ pool: atomic.db, checkContractLimit: async () => ({ allowed: true }), planLimits: {} }));
    const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    app.server = server;

    let shop = true;
    const { createAssistant } = require('./assistant');
    const assistant = createAssistant({ pool, jwt, jwtSecret: secret, port: server.address().port,
      checkFeatureAccess: async (_, key) => ({ allowed: key !== 'shop' || shop }) });
    const user = { id: 'owner', name: 'Владелец' };
    const ask = async (text, steps, mode = 'confirm') => { script.push(...steps); return assistant.reply({ user, text, mode, silent: true }); };
    const row = async (type, id) => (await pool.query('SELECT data FROM data_items WHERE type=$1 AND id=$2', [type, id])).rows[0]?.data;

    // 1. Реструктуризация: карточка без пометки «отменить нельзя», по нажатию — новый график, отмена — прежний
    const start = c.addDays(today, 10);
    let r = await ask('Разбей остаток по айфону на 5 месяцев', [{ tool: 'restructure_contract', args: { contractId: 'r', months: 5, firstPaymentDate: start } }, { content: 'Проверьте и нажмите «Подтвердить».' }], 'auto');
    let card = r.actions.find(a => a.tool === 'restructure_contract');
    assert.equal(card.kind, 'confirm', 'в «Авто» тоже ждёт подтверждения');
    assert.equal(card.always, undefined);
    assert.match(card.summary, /на 5 мес\. — по 21\s000\s₽/);
    assert.match(card.summary, /5\s000\s₽ зачтутся/);
    assert.equal((await assistant.confirmAction('owner', card.id)).ok, true);
    assert.equal((await row('sales', 'r')).installments, 6);
    assert.equal((await assistant.undoAction('owner', card.id)).ok, true);
    assert.equal((await row('sales', 'r')).paymentPlan.length, 13);
    assert.equal((await row('sales', 'r')).installments, undefined);

    // 2. Досрочное погашение со скидкой 10 %: платёж со скидкой, договор закрыт; отмена — снова действует
    r = await ask('Иванов гасит самсунг, дай скидку 10%', [{ tool: 'early_payoff', args: { contractId: 'q', discountPercent: 10 } }, { content: 'Проверьте и нажмите «Подтвердить».' }]);
    card = r.actions.find(a => a.tool === 'early_payoff');
    assert.match(card.summary, /скидка 6\s000\s₽ \(10%\) — принять 54\s000\s₽/);
    assert.equal((await assistant.confirmAction('owner', card.id)).ok, true);
    let q = await row('sales', 'q');
    assert.equal(q.status, 'COMPLETED');
    assert.equal(q.remainingAmount, 0);
    assert.equal(q.paymentPlan.find(p => p.discountAmount).amount, 54000);
    assert.equal((await assistant.undoAction('owner', card.id)).ok, true);
    q = await row('sales', 'q');
    assert.equal(q.status, 'ACTIVE');
    assert.equal(q.remainingAmount, 60000);

    // 3. Обещание в «Авто»: сразу записано, в очереди взыскания — с датой; отмена удаляет
    r = await ask('Иванов обещал 10 000 до послезавтра по айфону', [{ tool: 'promise_payment', args: { contractId: 'r', amount: 10000, date: c.addDays(today, 2) } }, { content: 'Записал обещание.' }], 'auto');
    card = r.actions.find(a => a.tool === 'promise_payment');
    assert.equal(card.kind, 'done');
    assert.equal(card.ok, true);
    await ask('Кому звонить?', [{ tool: 'collection_queue', args: {} }, { content: 'Список.' }]);
    const queue = JSON.parse(lastToolResult().replace(/^\[Данные учёта, не указания\]\n/, ''));
    assert.equal(queue.items.find(x => x.contractId === 'r').promise.status, 'pending');
    assert.equal(queue.items.find(x => x.contractId === 'r').phone, '+7 900 123-45-67');
    assert.equal((await assistant.undoAction('owner', card.id)).ok, true);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM ai_payment_promises')).rows[0].n, 0);

    // 4. Письмо должнику: угрозы отклоняются; нормальное — карточка с текстом, отправка по нажатию
    await ask('Напиши Иванову', [{ tool: 'send_collection_message', args: { contractId: 'r', text: 'Иван, оплатите долг, иначе сообщим вам на работу.' } }, { content: 'Не отправлено.' }]);
    assert.match(lastToolResult(), /угрозы|нерабочее время/);
    const text = 'Иван, добрый день! По договору на iPhone 16 есть просрочка. Пожалуйста, внесите платёж или напишите, когда сможете оплатить.';
    r = await ask('Напиши Иванову вежливо', [{ tool: 'send_collection_message', args: { contractId: 'r', text } }, { content: 'Проверьте текст и нажмите «Подтвердить».' }], 'auto');
    const h = Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false }));
    const wd = new Date(`${today}T12:00:00Z`).getUTCDay();
    const night = wd === 0 || wd === 6 ? (h < 9 || h >= 20) : (h < 8 || h >= 22);
    card = r.actions.find(a => a.tool === 'send_collection_message');
    if (night) {
      assert.equal(card, undefined);
      assert.match(lastToolResult(), /нерабочее время/);
    } else {
      assert.equal(card.kind, 'confirm');
      assert.equal(card.always, true);
      assert.ok(card.summary.includes(text));
      assert.equal((await assistant.confirmAction('owner', card.id)).ok, true);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].customMessage, text);
    }

    // 5. Продажа в магазине в «Авто»: чек, движение, остаток; отмена всё возвращает
    r = await ask('Продал 2 чехла', [{ tool: 'retail_sale', args: { items: [{ productId: 'p1', quantity: 2 }] } }, { content: 'Продажа проведена.' }], 'auto');
    card = r.actions.find(a => a.tool === 'retail_sale');
    assert.equal(card.kind, 'done', card.result);
    assert.equal(card.ok, true, card.result);
    assert.equal((await row('products', 'p1')).stock, 8);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM data_items WHERE type IN ('retailSales','stockMovements')")).rows[0].n, 2);
    assert.equal((await assistant.undoAction('owner', card.id)).ok, true);
    assert.equal((await row('products', 'p1')).stock, 10);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM data_items WHERE type IN ('retailSales','stockMovements')")).rows[0].n, 0);

    // 6. Приход: карточка устаревает, если товар изменился до нажатия; свежий — проводится, отмена возвращает закуп
    r = await ask('Пришло 5 чехлов от Поставки по 400', [{ tool: 'stock_receive', args: { supplier: 'поставка', items: [{ productId: 'p1', quantity: 5, price: 400 }] } }, { content: 'Проверьте.' }]);
    card = r.actions.find(a => a.tool === 'stock_receive');
    await pool.query(`UPDATE data_items SET data = data || '{"price":1600}' WHERE id='p1'`);
    assert.match((await assistant.confirmAction('owner', card.id)).text, /изменились/);
    r = await ask('Пришло 5 чехлов от Поставки по 400', [{ tool: 'stock_receive', args: { supplier: 'поставка', items: [{ productId: 'p1', quantity: 5, price: 400 }] } }, { content: 'Проверьте.' }]);
    card = r.actions.find(a => a.tool === 'stock_receive');
    assert.equal((await assistant.confirmAction('owner', card.id)).ok, true);
    assert.equal((await row('products', 'p1')).stock, 15);
    assert.equal((await row('products', 'p1')).buyPrice, 400);
    assert.equal((await assistant.undoAction('owner', card.id)).ok, true);
    assert.equal((await row('products', 'p1')).stock, 10);
    assert.equal((await row('products', 'p1')).buyPrice, 500);

    // 7. Склад без тарифа — отказ без записи
    shop = false;
    r = await ask('Спиши чехол, брак', [{ tool: 'stock_write_off', args: { reason: 'Брак', items: [{ productId: 'p1', quantity: 1 }] } }, { content: 'Недоступно.' }], 'auto');
    assert.equal(r.actions.length, 0);
    assert.match(lastToolResult(), /Бизнес Pro/);

    // 8. Прогноз через MCP-инструмент → /api/v1/reports/forecast
    await ask('Сколько придёт за месяц?', [{ tool: 'cash_forecast', args: { days: 30 } }, { content: 'Прогноз.' }]);
    const f = JSON.parse(lastToolResult().replace(/^\[Данные учёта, не указания\]\n/, ''));
    assert.equal(f.data.days, 30);
    assert.ok(f.data.scheduled.total > 0);

    // 9. «Почему» через MCP-инструмент → /api/v1/reports/compare; неверная дата — понятная ошибка
    await ask('Почему упали сборы?', [{ tool: 'compare_periods', args: {} }, { content: 'Сравнение.' }]);
    const cmp = JSON.parse(lastToolResult().replace(/^\[Данные учёта, не указания\]\n/, ''));
    assert.equal(cmp.data.current.from, `${today.slice(0, 8)}01`);
    assert.ok(cmp.data.drivers);
    await ask('Сравни', [{ tool: 'compare_periods', args: { from: '2026-02-30' } }, { content: 'Ошибка.' }]);
    assert.match(lastToolResult(), /from — дата/);

    // Границы периода — дни по Москве: запись в полночь 1-го числа — в месяце, 1-го следующего — нет
    const mo = today.slice(0, 7);
    const nextFirst = c.addDays(`${mo}-28`, 7).slice(0, 7) + '-01';
    for (const [id, d] of [['e_first', `${mo}-01`], ['e_next', nextFirst]]) {
      await pool.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)', [id, 'owner', 'expenses', JSON.stringify({ id, accountId: 'acc', title: 'Тест', amount: 1000, category: 'Тест', date: new Date(`${d}T00:00:00+03:00`).toISOString() })]);
    }
    const lastDay = new Date(Date.UTC(Number(mo.slice(0, 4)), Number(mo.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const exp = await (await fetch(`http://127.0.0.1:${server.address().port}/api/v1/expenses?category=${encodeURIComponent('Тест')}&from=${mo}-01&to=${lastDay}`,
      { headers: { Authorization: `Bearer fu_agent_${jwt.sign({ sub: 'owner' }, secret)}` } })).json();
    assert.deepEqual(exp.data.map(e => e.id), ['e_first']);
    assert.equal(exp.meta.sum, 1000);
    assert.deepEqual(exp.meta.byCategory, [{ name: 'Тест', count: 1, sum: 1000 }]);

    // Возврат клиенту помечен и не входит в «влияет на остаток» (прод 25.10: «минус из-за возвратов»)
    await pool.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)', ['e_refund', 'owner', 'expenses', JSON.stringify({ id: 'e_refund', accountId: 'acc', title: 'Возврат клиенту', amount: 500, category: 'Тест', date: new Date(`${mo}-02T10:00:00+03:00`).toISOString(), isRefund: true })]);
    const exp2 = await (await fetch(`http://127.0.0.1:${server.address().port}/api/v1/expenses?category=${encodeURIComponent('Тест')}&from=${mo}-01&to=${lastDay}`,
      { headers: { Authorization: `Bearer fu_agent_${jwt.sign({ sub: 'owner' }, secret)}` } })).json();
    assert.equal(exp2.meta.sum, 1500);
    assert.equal(exp2.meta.refunds, 500);
    assert.equal(exp2.meta.sumAffectingBalance, 1000);
    assert.equal(exp2.data.find(e => e.id === 'e_refund').isRefund, true);

    // Проверка цифр: повтор вернул пустой ответ — человек получает прежний с пометкой, а не «Ничего не сделано» (прод 25.10)
    script.push({ content: 'Пришло 987 654 ₽ за всё время.' }, { content: '' });
    r = await assistant.reply({ user, text: 'Сколько пришло за всё время?', mode: 'confirm', silent: true });
    assert.match(r.reply, /^Пришло 987\s654 ₽ за всё время\./);
    assert.match(r.reply, /сверьте их в приложении/);

    // Несколько платежей одной карточкой: оба записаны, «Отменить» — база как была
    await pool.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)', ['cust2', 'owner', 'customers', JSON.stringify({ id: 'cust2', name: 'Петров Пётр', phone: '79001112233' })]);
    await pool.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)', ['p2', 'owner', 'sales', JSON.stringify({ ...sale('p2', { first: -10 }), customerId: 'cust2', productName: 'Холодильник' })]);
    const dump = async () => (await pool.query("SELECT id, data FROM data_items WHERE type='sales' ORDER BY id")).rows.map(x => JSON.stringify(x)).join('\n');
    const beforeBatch = await dump();
    script.push({ tool: 'record_payments', args: { payments: [{ customer: 'Петров', amount: 4000 }, { customer: 'Иванов', product: 'айфон', amount: 3000 }] } }, { content: 'Проверьте и нажмите «Подтвердить».' });
    r = await assistant.reply({ user, text: 'Петров 4000, Иванов за айфон 3000', mode: 'auto', silent: true });
    card = r.actions.find(a => a.tool === 'record_payments');
    assert.equal(card?.kind, 'confirm', `пачка всегда ждёт «Подтвердить»: ${lastToolResult().replace(/\n/g, " ").slice(0, 500)}`);
    assert.match(card.summary, /2 платежа на 7\s000\s₽: Петров Пётр — Холодильник — 4\s000\s₽; Иванов Иван — iPhone 16 — 3\s000\s₽/);
    assert.equal((await assistant.confirmAction('owner', card.id)).ok, true);
    assert.equal((await row('sales', 'p2')).remainingAmount, 116000);
    assert.equal((await row('sales', 'r')).remainingAmount, 102000);
    const undoBatch = await assistant.undoAction('owner', card.id);
    assert.equal(undoBatch.ok, true, undoBatch.text);
    assert.equal(await dump(), beforeBatch.replace(/"updated_at"[^,]*,?/g, ''));
    // Неясная строка (у Иванова два договора, товар не назван) — карточки нет, ничего не записано
    script.push({ tool: 'record_payments', args: { payments: [{ customer: 'Петров', amount: 4000 }, { customer: 'Иванов', amount: 3000 }] } }, { content: 'Уточните договор Иванова.' });
    r = await assistant.reply({ user, text: 'Петров 4000, Иванов 3000', mode: 'confirm', silent: true });
    assert.equal(r.actions.some(a => a.tool === 'record_payments'), false);
    assert.match(lastToolResult(), /у клиента Иванов Иван несколько договоров/);
    assert.match(lastToolResult(), /iPhone 16 \(id r, остаток 105\s000\s₽\)/);
    assert.match(lastToolResult(), /Samsung S25 \(id q/);
    assert.equal(await dump(), beforeBatch);
    // Данные изменились до нажатия — пачка не записывается
    script.push({ tool: 'record_payments', args: { payments: [{ customer: 'Петров', amount: 1000 }, { contractId: 'q', amount: 2000 }] } }, { content: 'Проверьте.' });
    r = await assistant.reply({ user, text: 'Петров 1000 и по самсунгу 2000', mode: 'confirm', silent: true });
    card = r.actions.find(a => a.tool === 'record_payments');
    await pool.query(`UPDATE data_items SET data = data || '{"notes":"правка"}' WHERE id='p2'`);
    assert.match((await assistant.confirmAction('owner', card.id)).text, /изменились/);
    assert.equal((await row('sales', 'q')).remainingAmount, 60000);

    // Выдуманный id договора (прод 25.10: «sale_1234567890») — карточки нет, ответ «найди через customer_overview»
    script.push({ tool: 'create_payment', args: { contractId: 'sale_1234567890', amount: 7000 } }, { content: 'Проверьте и нажмите «Подтвердить».\n[Подтвердить: Платёж 7 000 ₽ — Иванов]' });
    r = await assistant.reply({ user, text: 'Иванов оплатил 7000', mode: 'confirm', silent: true });
    assert.equal(r.actions.some(a => a.tool === 'create_payment'), false);
    assert.match(lastToolResult(), /id не придумывай/);
    assert.doesNotMatch(r.reply, /\[Подтвердить/);
    // Платёж ждёт «Подтвердить», а просили и чек: обещание «отправлю» убрано, сказано про кнопку
    script.push({ tool: 'create_payment', args: { contractId: 'q', amount: 1000 } }, { content: 'Проверьте и нажмите «Подтвердить». После этого я сразу отправлю чек.' });
    r = await assistant.reply({ user, text: 'Иванов оплатил 1000 по самсунгу и отправь чек', mode: 'confirm', silent: true });
    assert.ok(r.actions.some(a => a.kind === 'confirm' && a.tool === 'create_payment'));
    assert.doesNotMatch(r.reply, /сразу отправлю/);
    assert.match(r.reply, /кнопка «Отправить чек»/);
    await assistant.cancelAction('owner', r.actions.find(a => a.tool === 'create_payment').id);

    // Прод 25.10: «закуп 92300, на год по 12300 в месяц, оплата 12 числа» — товар-заглушка не проходит,
    // цена — из ежемесячного платежа, первый платёж — 12-го следующего месяца
    const said = 'Иванову закуп 92300, на год без первого взноса, каждый месяц по 12300, оплата 12 числа';
    script.push({ tool: 'prepare_contract', args: { customerId: 'cust', productName: 'Товар (рассрочка)', buyPrice: 92300, months: 12, monthlyPayment: 12300, paymentDay: 12 } }, { content: 'Какой товар оформляем?' });
    r = await assistant.reply({ user, text: said, mode: 'confirm', silent: true });
    assert.equal(r.actions.some(a => a.kind === 'contract_form'), false);
    assert.match(lastToolResult(), /не хватает обязательного: товар/);
    assert.equal(r.reply, 'Какой товар оформляем?', 'уточняющий вопрос не подменяется');
    script.push({ tool: 'prepare_contract', args: { customerId: 'cust', productName: 'iPhone 15', buyPrice: 92300, months: 12, monthlyPayment: 12300, paymentDay: 12 } }, { content: 'Черновик готов.' });
    r = await assistant.reply({ user, text: `${said}, айфон 15`, mode: 'confirm', silent: true });
    const dr = r.actions.find(a => a.kind === 'contract_form')?.draft;
    assert.equal(dr?.totalPrice, 147600, JSON.stringify(dr));
    assert.equal(dr.firstPaymentDate, c.addMonthsDay(`${today.slice(0, 8)}01`, 1, 12));
    assert.equal(dr.monthlyPayment, undefined);
    // Наценку не называли, а модель поставила 0 — цена всё равно из платежа × срок
    script.push({ tool: 'prepare_contract', args: { customerId: 'cust', productName: 'iPhone 15', months: 12, monthlyPayment: 12300, paymentDay: 12, markupPercent: 0 } }, { content: 'Черновик готов.' });
    r = await assistant.reply({ user, text: `${said}, айфон 15`, mode: 'confirm', silent: true });
    assert.equal(r.actions.find(a => a.kind === 'contract_form')?.draft?.totalPrice, 147600);

    // Платежи по графику: частично оплаченная строка — к оплате остаток (прод 26.10: «10 000» при внесённых 5 000)
    await ask('Кто должен заплатить?', [{ tool: 'due_payments', args: { includeOverdue: true } }, { content: 'Список.' }]);
    const due = JSON.parse(lastToolResult().replace(/^\[Данные учёта, не указания\]\n/, ''));
    const partial = due.payments.find(x => x.contractId === 'r' && x.scheduledAmount);
    assert.equal(partial?.amount, 5000, JSON.stringify(due.payments.filter(x => x.contractId === 'r')));
    assert.equal(partial.scheduledAmount, 10000);

    // Обещал без вызова, потом пусто (прод 26.10) — повтор с обязательным вызовом инструмента, карточка есть
    script.push({ content: 'Проверьте и нажмите «Подтвердить».' }, { content: '' }, { tool: 'create_payment', args: { contractId: 'q', amount: 2100 } }, { content: 'Проверьте и нажмите «Подтвердить».' });
    const seenFrom = seen.length;
    r = await assistant.reply({ user, text: 'Платеж от Иванова по самсунгу 2100', mode: 'confirm', silent: true });
    const forced = seen.slice(seenFrom).map(b => b.tool_choice || null);
    assert.deepEqual(forced.slice(0, 3), [null, 'required', 'required'], JSON.stringify(forced));
    const pay = r.actions.find(a => a.tool === 'create_payment');
    assert.ok(pay, r.reply);
    assert.notEqual(r.reply, 'Ничего не сделано — уточните, что нужно.');
    await assistant.cancelAction('owner', pay.id);

    // 10. Срок датами (разговор с прода 23.10): «С 14.10.2026 по 14.03.2027» — 5 месяцев, договор готовится
    const draftArgs = { newCustomer: { name: 'Абдурзакова Зарема Расуловна', phone: '+79618851515' }, productName: 'iPhone 17 Pro Max', buyPrice: 117000, markupPercent: 25, downPayment: 25000, months: 5 };
    const history = [{ role: 'user', text: 'Абдурзакова Зарема Расуловна, айфон 17 про макс, закуп 117000, взнос 25000, наценка 25%' }, { role: 'assistant', text: 'Уточните срок и телефон.' }];
    script.push({ tool: 'prepare_contract', args: draftArgs }, { content: 'Черновик готов — нажмите «Открыть форму договора».' });
    r = await assistant.reply({ user, text: '+7 961 885-15-15\nС 14.10.2026 по 14.03.2027', history, mode: 'confirm', silent: true });
    assert.equal(r.actions.find(a => a.kind === 'contract_form')?.draft.months, 5, r.reply);
    // «Да» на «это 5 месяцев — подтвердите»
    const confirmHistory = [...history, { role: 'user', text: '+7 961 885-15-15' }, { role: 'assistant', text: 'Ранее вы указывали даты, это 5 месяцев — подтвердите, пожалуйста.' }];
    script.push({ tool: 'prepare_contract', args: draftArgs }, { content: 'Черновик готов — нажмите «Открыть форму договора».' });
    r = await assistant.reply({ user, text: 'Да', history: confirmHistory, mode: 'confirm', silent: true });
    assert.equal(r.actions.find(a => a.kind === 'contract_form')?.draft.months, 5, r.reply);
    // Число без слова «закуп» при наценке модель положила в цену — это закуп
    script.push({ tool: 'prepare_contract', args: { ...draftArgs, buyPrice: undefined, totalPrice: 117000 } }, { content: 'Черновик готов.' });
    r = await assistant.reply({ user, text: 'Абдурзакова Зарема Расуловна\nАйфон 17\nС 14.10.2026 по 14.03.2027\n117000\n25%\n+7 961 885-15-15', mode: 'confirm', silent: true });
    const fixedDraft = r.actions.find(a => a.kind === 'contract_form')?.draft;
    assert.equal(fixedDraft?.buyPrice, 117000, r.reply);
    assert.equal(fixedDraft?.totalPrice, undefined);
    // Поручитель вместе с новым договором — в черновик, а не к старому договору клиента (прод 23.10)
    script.push(
      { tool: 'prepare_contract', args: { customerId: 'cust', productName: 'iPhone 17 Pro', buyPrice: 110000, markupPercent: 25, months: 5 } },
      { tool: 'set_guarantor', args: { contractId: 'q', name: 'Саламов Салам', phone: '+79281112233' } },
      { content: 'Черновик готов. Также я подготовил добавление поручителя Саламова — нажмите «Подтвердить».' });
    r = await assistant.reply({ user, text: 'Айфон 17 про, закуп 110000, наценка 25%, на 5 месяцев. Поручитель Саламов Салам +7 928 111-22-33', mode: 'confirm', silent: true });
    const gDraft = r.actions.find(a => a.kind === 'contract_form')?.draft;
    assert.equal(gDraft?.guarantorName, 'Саламов Салам', r.reply);
    assert.equal(gDraft?.guarantorPhone, '+79281112233');
    assert.equal(r.actions.some(a => a.tool === 'set_guarantor'), false);
    assert.match(r.reply, /Поручитель Саламов Салам — в черновике нового договора/);
    assert.doesNotMatch(r.reply, /Подтвердить/);
    assert.equal((await row('sales', 'q')).guarantorName, undefined);
    assert.equal((await pool.query("SELECT status FROM ai_actions WHERE payload->>'tool'='set_guarantor' ORDER BY created_at DESC LIMIT 1")).rows[0].status, 'cancelled');
    // Срок не назван, а модель пишет «Черновик готов» — вместо этого вопрос, без задвоенных пометок
    script.push({ tool: 'prepare_contract', args: { ...draftArgs, months: undefined } }, { content: 'Черновик готов — нажмите «Открыть форму договора».\n\n⚠️ В этом ответе ничего не записано и не изменено — если нужно, попросите ещё раз.' });
    r = await assistant.reply({ user, text: '+7 961 885-15-15', history, mode: 'confirm', silent: true });
    assert.equal(r.actions.some(a => a.kind === 'contract_form'), false);
    assert.equal(r.reply, 'Договор ещё не подготовлен — уточните, пожалуйста: срок в месяцах.');

    // 11. Правка договора: товар, закуп, другой клиент — расход закупа следом; отмена — всё как было
    const put = (type, d) => pool.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)', [d.id, 'owner', type, JSON.stringify(d)]);
    await put('customers', { id: 'cust3', name: 'Сидоров Пётр' });
    await put('expenses', { id: 'exp_sale_r', accountId: 'acc', title: 'Закуп: iPhone 16', amount: 100000, category: 'Себестоимость', date: at(-75) });
    const rBefore = await row('sales', 'r');
    r = await ask('В договоре айфона товар iPhone 16 Pro, закуп 95000 и он на Сидорова', [{ tool: 'update_contract', args: { contractId: 'r', productName: 'iPhone 16 Pro', buyPrice: 95000, customerId: 'cust3' } }, { content: 'Проверьте и нажмите «Подтвердить».' }], 'auto');
    card = r.actions.find(a => a.tool === 'update_contract');
    assert.equal(card?.kind, 'confirm', 'в «Авто» тоже ждёт подтверждения');
    assert.match(card.summary, /товар «iPhone 16» → «iPhone 16 Pro»; закуп 100\s000\s₽ → 95\s000\s₽; клиент Иванов Иван → Сидоров Пётр; расход закупа со счёта тоже 95\s000\s₽/);
    assert.equal((await assistant.confirmAction('owner', card.id)).ok, true);
    let edited = await row('sales', 'r');
    assert.deepEqual([edited.productName, edited.buyPrice, edited.customerId], ['iPhone 16 Pro', 95000, 'cust3']);
    assert.deepEqual(edited.paymentPlan, rBefore.paymentPlan, 'график не тронут');
    let buyExp = await row('expenses', 'exp_sale_r');
    assert.deepEqual([buyExp.title, buyExp.amount], ['Закуп: iPhone 16 Pro', 95000]);
    assert.equal((await assistant.undoAction('owner', card.id)).ok, true);
    assert.deepEqual(await row('sales', 'r'), rBefore);
    buyExp = await row('expenses', 'exp_sale_r');
    assert.deepEqual([buyExp.title, buyExp.amount], ['Закуп: iPhone 16', 100000]);
    // Закуп 0 — расход удаляется, отмена возвращает его; у поставщика и со склада — в приложение
    script.push({ tool: 'update_contract', args: { contractId: 'r', buyPrice: 0 } }, { content: 'Проверьте.' });
    card = (await assistant.reply({ user, text: 'закуп по айфону 0', mode: 'confirm', silent: true })).actions.find(a => a.tool === 'update_contract');
    assert.match(card.summary, /удалится — деньги вернутся на счёт/);
    assert.equal((await assistant.confirmAction('owner', card.id)).ok, true);
    assert.equal(await row('expenses', 'exp_sale_r'), undefined);
    assert.equal((await assistant.undoAction('owner', card.id)).ok, true);
    assert.equal((await row('expenses', 'exp_sale_r')).amount, 100000);
    await pool.query(`UPDATE data_items SET data = data || '{"supplierId":"s1"}' WHERE id='q'`);
    await ask('закуп по самсунгу 90000', [{ tool: 'update_contract', args: { contractId: 'q', buyPrice: 90000 } }, { content: 'В приложении.' }]);
    assert.match(lastToolResult(), /у поставщика/);
    await ask('в самсунге всё то же', [{ tool: 'update_contract', args: { contractId: 'q', productName: 'Samsung S25' } }, { content: 'Ок.' }]);
    assert.match(lastToolResult(), /Менять нечего/);
    // Договор выбран кнопкой, а сумму модель спросила текстом — кнопки суммы ставит сервер
    script.push({ content: 'Какую сумму принять от Иванова по договору «iPhone 16»?' });
    r = await assistant.reply({ user, text: 'iPhone 16 · остаток 105 000 ₽ [r]', mode: 'confirm', silent: true });
    assert.deepEqual(r.actions.find(a => a.kind === 'choices')?.options.map(o => o.label.replace(/\u00a0/g, ' ')), ['Платёж по графику — 5 000 ₽', 'Весь остаток — 105 000 ₽']);
    assert.match(r.reply, /Или напишите свою сумму\.$/);
    // Варианты списком в тексте — тоже кнопки, в ответе только вопрос
    script.push({ tool: 'customer_overview', args: { query: 'Иванов' } }, { content: 'Какую сумму принять по айфону?\n\n*   Платёж по графику — 5 000 ₽\n*   Весь остаток — 105 000 ₽' });
    r = await assistant.reply({ user, text: 'iPhone 16 · остаток 105 000 ₽ [r]', mode: 'confirm', silent: true });
    assert.equal(r.actions.find(a => a.kind === 'choices')?.options.length, 2);
    assert.equal(r.reply, 'Какую сумму принять по айфону? Или напишите свою сумму.');
    // Варианты строкой без маркеров
    script.push({ tool: 'customer_overview', args: { query: 'Иванов' } }, { content: 'Какую сумму принять по айфону?\nПо графику — 5 000 ₽, весь остаток — 105 000 ₽.' });
    r = await assistant.reply({ user, text: 'iPhone 16 · остаток 105 000 ₽ [r]', mode: 'confirm', silent: true });
    assert.equal(r.actions.find(a => a.kind === 'choices')?.options.length, 2);
    script.push({ content: 'Какую сумму принять?' });
    r = await assistant.reply({ user, text: 'прими платёж от Иванова', mode: 'confirm', silent: true });
    assert.equal(r.actions.some(a => a.kind === 'choices'), false, 'договор не выбран — не угадываем');
    // База клиентов Excel: карточка «Скачать» с числом клиентов; пусто — без карточки
    r = await ask('выгрузи базу клиентов', [{ tool: 'customers_report', args: {} }, { content: 'Файл готов к скачиванию.' }]);
    const base = r.actions.find(a => a.kind === 'customers_report');
    assert.match(base?.summary || '', /Клиенты все: \d+ — ФИО, телефоны/);
    assert.equal(base.onlyOverdue, false);
    await pool.query(`UPDATE data_items SET data = data || '{"status":"COMPLETED"}' WHERE type = 'sales'`);
    r = await ask('должников в Excel', [{ tool: 'customers_report', args: { onlyOverdue: true } }, { content: 'Должников нет.' }]);
    assert.equal(r.actions.some(a => a.kind === 'customers_report'), false);
    assert.match(lastToolResult(), /Клиентов с просрочкой нет/);
    await pool.query(`UPDATE data_items SET data = data || '{"status":"ACTIVE"}' WHERE type = 'sales'`);
    // Модель зациклилась на инструментах — последний шаг без инструментов, ответ вместо «Не успел закончить»
    const loopFrom = seen.length;
    script.push(...Array.from({ length: 5 }, () => ({ tool: 'due_payments', args: { includeOverdue: true } })), { content: 'Нашёл платежи по графику, откуда остальная сумма — не видно.' });
    r = await assistant.reply({ user, text: 'откуда в кассе столько денег', mode: 'confirm', silent: true });
    assert.equal(seen.slice(loopFrom).pop().tool_choice, 'none');
    assert.equal(r.reply, 'Нашёл платежи по графику, откуда остальная сумма — не видно.');
    // Выключатель AI_DISABLED_TOOLS: модель не видит умение, вызов — «выключено», показанная карточка не выполняется
    script.push({ tool: 'update_contract', args: { contractId: 'r', notes: 'до выключения' } }, { content: 'Проверьте.' });
    const before = (await assistant.reply({ user, text: 'комментарий в айфон', mode: 'confirm', silent: true })).actions.find(a => a.tool === 'update_contract');
    process.env.AI_DISABLED_TOOLS = 'update_contract, stock_receive';
    try {
      await ask('комментарий в айфон: тест', [{ tool: 'update_contract', args: { contractId: 'r', notes: 'тест' } }, { content: 'Выключено.' }]);
      assert.equal(seen[seen.length - 1].tools.some(t => t.function.name === 'update_contract'), false);
      assert.ok(seen[seen.length - 1].tools.some(t => t.function.name === 'restructure_contract'));
      assert.match(lastToolResult(), /сейчас выключено/);
      assert.match((await assistant.confirmAction('owner', before.id)).text, /сейчас выключено/);
      assert.equal((await row('sales', 'r')).notes, undefined);
    } finally { delete process.env.AI_DISABLED_TOOLS; }
    // «Закрывает полностью со скидкой», а модель проводит обычный платёж на сумму со скидкой — не даём, нужен early_payoff
    r = await ask('Иванов закрывает айфон полностью, дай скидку 10%', [{ tool: 'create_payment', args: { contractId: 'r', amount: 94500 } }, { content: 'Ок.' }]);
    assert.equal(r.actions.some(a => a.tool === 'create_payment'), false);
    assert.match(lastToolResult(), /это early_payoff/);
  } finally {
    if (app?.server) await new Promise(r => app.server.close(r));
    await new Promise(r => model.close(r));
    if (pool) await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
