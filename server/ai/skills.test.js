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
    // Срок не назван, а модель пишет «Черновик готов» — вместо этого вопрос, без задвоенных пометок
    script.push({ tool: 'prepare_contract', args: { ...draftArgs, months: undefined } }, { content: 'Черновик готов — нажмите «Открыть форму договора».\n\n⚠️ В этом ответе ничего не записано и не изменено — если нужно, попросите ещё раз.' });
    r = await assistant.reply({ user, text: '+7 961 885-15-15', history, mode: 'confirm', silent: true });
    assert.equal(r.actions.some(a => a.kind === 'contract_form'), false);
    assert.equal(r.reply, 'Договор ещё не подготовлен — уточните, пожалуйста: срок в месяцах.');
  } finally {
    if (app?.server) await new Promise(r => app.server.close(r));
    await new Promise(r => model.close(r));
    if (pool) await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
