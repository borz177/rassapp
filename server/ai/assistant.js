// ИИ-ассистент в приложении: человек пишет, говорит или присылает фото —
// ассистент отвечает и делает дело в учёте.
//
// Модель — через OpenRouter. Из России OpenRouter не отвечает (403 на
// российские адреса), поэтому запросы идут через наш сервер в Казахстане
// (nginx wa.rassrochka.pro/openrouter/, пускает только основной сервер).
//
// Умения ассистента — те же инструменты, что у MCP-сервера (server/api/mcp.js):
// каждый — вызов нашего же /api/v1 от имени пользователя, с теми же правами и
// проверками. Второй копии расчётов нет.
//
// Чтение выполняется сразу. Всё, что меняет данные (платёж, клиент, расход,
// приход), ассистент только предлагает: сервер откладывает действие и отдаёт
// приложению карточку «Подтвердить». Выполняется оно, когда человек нажал
// кнопку (confirmAction). Модель может ошибиться в имени или сумме — по
// деньгам последнее слово за человеком.
//
// Договор ассистент не создаёт сам: он готовит черновик (prepare_contract), и
// приложение открывает заполненную форму договора — с теми же расчётами,
// закупом, складом и графиком, что при оформлении руками.

const { TOOLS, query } = require('../api/mcp');

const OPENROUTER_BASE = (process.env.OPENROUTER_BASE_URL || 'https://wa.rassrochka.pro/openrouter/v1').replace(/\/$/, '');
const DEFAULT_MODEL = process.env.AI_ASSISTANT_MODEL || 'google/gemini-3.1-flash-lite';
// Сколько раз за одно сообщение модель может сходить за данными
const MAX_TOOL_ROUNDS = 6;
// Ответ инструмента в разговор с моделью — не больше этого (остальное режем)
const MAX_TOOL_RESULT_CHARS = 12000;
// Отложенные действия живут, пока человек думает, но не вечно
const ACTION_TTL_MS = 15 * 60 * 1000;

// Черновик договора: модель собирает поля, приложение открывает форму
const IMAGE_RE = /^data:image\/(jpeg|png|webp);base64,/;

const PREPARE_CONTRACT_TOOL = {
  name: 'prepare_contract',
  description: [
    'Подготовить договор рассрочки: приложение откроет заполненную форму договора,',
    'человек проверит и сохранит её сам. Вызывай, когда просят оформить договор или продажу в рассрочку.',
    'Клиента бери из list_customers (customerId), а если его нет — передай данные нового клиента в newCustomer',
    '(с фото паспорта перепиши поля паспорта точно, как написано). Суммы — в рублях: «закуп 500» почти всегда',
    'значит 500 000 ₽, но если по смыслу неясно — спроси. Срок не назван — не придумывай, оставь пустым.',
  ].join(' '),
  input: {
    customerId: { type: 'string', description: 'id существующего клиента' },
    newCustomer: {
      type: 'object',
      description: 'Новый клиент, если его нет в базе',
      properties: {
        name: { type: 'string', description: 'ФИО полностью' },
        phone: { type: 'string' },
        birthDate: { type: 'string', description: 'ГГГГ-ММ-ДД' },
        passportSeries: { type: 'string' }, passportNumber: { type: 'string' },
        passportIssuedBy: { type: 'string' }, passportIssueDate: { type: 'string', description: 'ГГГГ-ММ-ДД' },
        passportDivisionCode: { type: 'string' }, address: { type: 'string', description: 'Адрес регистрации' },
      },
    },
    productName: { type: 'string', description: 'Товар' },
    buyPrice: { type: 'number', description: 'Закуп, ₽' },
    markupPercent: { type: 'number', description: 'Наценка, %' },
    totalPrice: { type: 'number', description: 'Цена в рассрочку, ₽ — если назвали её, а не наценку' },
    months: { type: 'number', description: 'Срок, месяцев' },
    downPayment: { type: 'number', description: 'Первый взнос, ₽ (0 — без взноса)' },
    accountId: { type: 'string', description: 'Счёт из list_accounts, если назван' },
  },
  required: ['productName'],
};

// Ожидаемые платежи по графику за период — среди инструментов API такого нет
// (там полученные деньги), а спрашивают «кто платит сегодня/завтра» чаще всего
const DUE_PAYMENTS_TOOL = {
  name: 'due_payments',
  description: 'Платежи, которые клиенты ДОЛЖНЫ внести по графику за период (ещё не оплаченные), с ФИО, телефоном, товаром и суммой. Для вопросов «кто платит сегодня/завтра/на неделе», «какие платежи ожидаются». Просроченные — с флагом overdue.',
  input: {
    from: { type: 'string', description: 'С какой даты, ГГГГ-ММ-ДД; по умолчанию сегодня' },
    to: { type: 'string', description: 'По какую дату включительно, ГГГГ-ММ-ДД; по умолчанию завтра' },
    includeOverdue: { type: 'boolean', description: 'Добавить и все просроченные до from' },
  },
};

const WRITE_TITLES = {
  create_payment: 'Принять платёж',
  create_customer: 'Завести клиента',
  create_expense: 'Записать расход',
  create_income: 'Записать приход',
};

const DONE_TITLES = {
  create_payment: 'платёж принят',
  create_customer: 'клиент заведён',
  create_expense: 'расход записан',
  create_income: 'приход записан',
};

const toOpenAiTool = (tool) => ({
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description || tool.title || tool.name,
    parameters: {
      type: 'object',
      properties: tool.input || {},
      ...(tool.required ? { required: tool.required } : {}),
    },
  },
});

const money = (n) => `${Math.round(Number(n) || 0).toLocaleString('ru-RU')} ₽`;

function createAssistant({ pool, jwt, jwtSecret, port }) {
  const v1Base = `http://127.0.0.1:${port}/api/v1`;
  const pending = new Map(); // id → { userId, tool, args, summary, at }

  // ── Пропуск ассистента в /api/v1 (см. server/api/auth.js, fu_agent_) ─────
  const agentToken = (userId) => `fu_agent_${jwt.sign({ sub: userId, typ: 'agent' }, jwtSecret, { expiresIn: 120 })}`;
  const verifyAgentToken = (raw) => {
    try {
      const p = jwt.verify(String(raw).slice('fu_agent_'.length), jwtSecret);
      return p?.typ === 'agent' && p.sub ? p.sub : null;
    } catch { return null; }
  };

  // Дата строки графика по Москве: строки хранятся как полночь по Москве в UTC
  const mskDate = (iso) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
  const duePayments = async (userId, args) => {
    const today = mskDate(new Date().toISOString());
    const from = /^\d{4}-\d{2}-\d{2}$/.test(args.from || '') ? args.from : today;
    const tomorrow = mskDate(new Date(Date.now() + 864e5).toISOString());
    const to = /^\d{4}-\d{2}-\d{2}$/.test(args.to || '') ? args.to : tomorrow;
    const { rows } = await pool.query(
      `SELECT s.data AS sale, c.data AS customer FROM data_items s
       LEFT JOIN data_items c ON c.user_id = s.user_id AND c.type = 'customers' AND c.id = s.data->>'customerId'
       WHERE s.user_id = $1 AND s.type = 'sales' AND s.data->>'status' = 'ACTIVE'`, [userId]);
    const out = [];
    for (const { sale, customer } of rows) {
      for (const p of sale.paymentPlan || []) {
        if (p.isRealPayment === true || p.isPaid || !p.date) continue;
        const d = mskDate(p.date);
        const overdue = d < today;
        if ((d >= from && d <= to) || (args.includeOverdue && overdue && d < from)) {
          out.push({ date: d, overdue, amount: Number(p.amount) || 0, customer: customer?.name || '—', phone: customer?.phone || null, product: sale.productName || '', contractId: sale.id });
        }
      }
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    const total = Math.round(out.reduce((n, x) => n + x.amount, 0));
    return JSON.stringify({ from, to, count: out.length, total, payments: out.slice(0, 60) });
  };

  const callV1 = async (userId, tool, args) => {
    const { method, path, body } = tool.request(args || {});
    const r = await fetch(`${v1Base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${agentToken(userId)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await r.json().catch(() => null);
    if (!r.ok) {
      const msg = payload?.error?.message || `Запрос не прошёл (${r.status})`;
      const details = payload?.error?.details ? ` ${JSON.stringify(payload.error.details)}` : '';
      return { ok: false, text: `${msg}${details}` };
    }
    let text = JSON.stringify(payload);
    if (text.length > MAX_TOOL_RESULT_CHARS) text = `${text.slice(0, MAX_TOOL_RESULT_CHARS)}… (обрезано — сузьте запрос)`;
    return { ok: true, text, data: payload };
  };

  // ── Отложенные действия ──────────────────────────────────────────────────
  const sweep = () => {
    const now = Date.now();
    for (const [id, a] of pending) if (now - a.at > ACTION_TTL_MS) pending.delete(id);
  };
  const newActionId = () => `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  /** Человеческое описание действия для карточки «Подтвердить» */
  const describe = (name, args) => {
    switch (name) {
      case 'create_payment': return `${money(args.amount)} по договору${args.date ? `, дата ${args.date}` : ''}${args.note ? ` — ${args.note}` : ''}`;
      case 'create_customer': return `${args.name || ''}${args.phone ? `, ${args.phone}` : ''}`;
      case 'create_expense': return `${money(args.amount)} — ${args.title || ''}${args.category ? ` (${args.category})` : ''}`;
      case 'create_income': return `${money(args.amount)}${args.note ? ` — ${args.note}` : ''}`;
      default: return '';
    }
  };

  // Платёж в карточке — с клиентом, товаром и остатком после него: по одной
  // сумме не понять, тот ли договор нашёл ассистент
  const paymentSummary = async (userId, args) => {
    const base = describe('create_payment', args);
    try {
      const { rows } = await pool.query(
        `SELECT s.data AS sale, c.data AS customer FROM data_items s
         LEFT JOIN data_items c ON c.user_id = s.user_id AND c.type = 'customers' AND c.id = s.data->>'customerId'
         WHERE s.user_id = $1 AND s.type = 'sales' AND s.id = $2`, [userId, args.contractId]);
      const sale = rows[0]?.sale;
      if (!sale) return base;
      const left = Math.max(0, (Number(sale.remainingAmount) || 0) - (Number(args.amount) || 0));
      return `${money(args.amount)} — ${rows[0].customer?.name || 'клиент'}, ${sale.productName || 'договор'}. Остаток станет ${money(left)}`;
    } catch { return base; }
  };

  // Расход и приход — с названием счёта: «3 000 ₽ — бензин» без счёта не проверить
  const accountSummary = async (userId, name, args) => {
    const base = describe(name, args);
    if (!args.accountId) return base;
    try {
      const { rows } = await pool.query(`SELECT data->>'name' AS n FROM data_items WHERE user_id = $1 AND type = 'accounts' AND id = $2`, [userId, args.accountId]);
      return rows[0]?.n ? `${base} · счёт «${rows[0].n}»` : base;
    } catch { return base; }
  };

  const confirmAction = async (userId, actionId) => {
    sweep();
    const a = pending.get(actionId);
    if (!a || a.userId !== userId) return { ok: false, text: 'Действие устарело — попросите ассистента ещё раз.' };
    pending.delete(actionId);
    const tool = TOOLS.find(t => t.name === a.tool);
    const r = await callV1(userId, tool, a.args);
    return r.ok ? { ok: true, text: `Готово: ${DONE_TITLES[a.tool] || 'сделано'} — ${a.summary.replace('Остаток станет', 'остаток теперь')}.`, data: r.data } : r;
  };
  const cancelAction = (userId, actionId) => {
    const a = pending.get(actionId);
    if (a && a.userId === userId) pending.delete(actionId);
  };

  // ── Разговор с моделью ───────────────────────────────────────────────────
  const callModel = async (body) => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw Object.assign(new Error('Ассистент ещё не настроен'), { status: 503 });
    const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://rassrochka.pro',
        'X-Title': 'FinUchet',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data?.choices?.[0]) {
      const msg = data?.error?.message || `модель не ответила (${r.status})`;
      throw Object.assign(new Error(msg), { status: 502 });
    }
    return data;
  };

  const systemPrompt = ({ userName, companyName, today }) => [
    `Ты — FinUchetGPT, ИИ-ассистент в FinUchet, программе учёта продаж в рассрочку. Владелец: ${userName || 'пользователь'}${companyName ? `, компания «${companyName}»` : ''}.`,
    `Сегодня ${today} (Москва). Отвечай по-русски, коротко и по делу, как опытный помощник бухгалтера. Суммы — в рублях с пробелами между тысячами.`,
    'Все цифры бери только из инструментов, ничего не досчитывай и не выдумывай. Не знаешь — скажи и предложи, где посмотреть.',
    'Клиента, договор или счёт сначала найди инструментом (list_customers, list_contracts, list_accounts), не угадывай id.',
    'Никогда не показывай человеку технические идентификаторы (cust_…, sale_…, acc_… и любые id): клиента называй по ФИО, договор — по товару, счёт — по названию. Если в данных только id клиента — найди его ФИО через list_customers.',
    '«Платежи сегодня/завтра/на неделе», «кто должен заплатить» — это ожидаемые по графику платежи: бери due_payments. Полученные деньги — list_payments.',
    'Списки оформляй коротко: по строке на позицию (ФИО — товар — сумма), в конце итог.',
    'Принять платёж, завести клиента, записать расход или приход — вызывай соответствующий инструмент: действие не выполнится сразу, под твоим ответом появится карточка с кнопкой «Подтвердить». Скажи одной фразой: «Проверьте и нажмите «Подтвердить»». Не говори про формы и окна.',
    'Расход и приход проводятся по счёту: если счёт не назван, а счетов несколько — спроси, с какого (list_accounts); если счёт один — бери его.',
    'Оформить договор — вызывай prepare_contract: под ответом появится карточка с кнопкой «Открыть форму договора», человек проверит и сохранит. Скажи именно так, не говори, что форма уже открыта. Если на фото паспорт — перепиши данные паспорта в newCustomer точно, буква в букву.',
    'Люди, о которых шла речь в этом разговоре («он», «она», «этот клиент», «первый клиент», «тот, что на фото»), — это клиенты из разговора: фото паспортов и пометки [Черновик договора …] в истории. Если такого клиента ещё нет в базе (черновик не сохранён) — снова передай его данные в newCustomer, переписав их с фото или из пометки. Никогда не бери клиента из базы по порядку в списке или наугад: не уверен, о ком речь, — спроси.',
    'Для черновика договора телефон, адрес и счёт не обязательны: их допишут в форме. Не задерживай черновик вопросами о них.',
    'Прислали фото паспорта без задания — коротко назови, кого распознал (ФИО), и спроси, что оформить.',
    'Если в просьбе не хватает важного (какой клиент, какая сумма) — уточни одним коротким вопросом.',
    'Не обсуждай темы, не связанные с учётом, — вежливо верни разговор к делу.',
  ].join('\n');

  /**
   * В карточке черновика — названия, а не id: ФИО клиента из базы и счёт.
   * Счёта, которого нет у владельца, в черновике быть не должно — убираем.
   */
  const nameDraftRefs = async (userId, actions) => {
    const drafts = actions.filter(a => a.kind === 'contract_form' && a.draft).map(a => a.draft);
    const ids = drafts.flatMap(d => [d.customerId, d.accountId]).filter(Boolean);
    if (!ids.length) return;
    const { rows } = await pool.query(
      `SELECT id, type, data->>'name' AS name FROM data_items WHERE user_id = $1 AND type IN ('customers', 'accounts') AND id = ANY($2)`,
      [userId, ids]);
    const byId = new Map(rows.map(r => [`${r.type}:${r.id}`, r.name]));
    for (const d of drafts) {
      if (d.customerId) d.customerName = byId.get(`customers:${d.customerId}`) || undefined;
      if (d.accountId) {
        const name = byId.get(`accounts:${d.accountId}`);
        if (name) d.accountName = name; else delete d.accountId;
      }
    }
  };

  /**
   * Прошлые реплики для модели. Фото в историю попадают только последние два
   * (приложение присылает их снова): иначе «оформи на неё ещё один» после
   * паспорта модель уже не видит, чей это паспорт. Остальные фото — пометкой.
   */
  const historyMessages = (history) => {
    const items = history.slice(-12).filter(m => m && (m.text || m.image));
    let photosLeft = 2;
    const withPhoto = new Set();
    for (let i = items.length - 1; i >= 0; i--) {
      const img = items[i].role !== 'assistant' && typeof items[i].image === 'string' && IMAGE_RE.test(items[i].image) && items[i].image.length < 3_000_000;
      if (img && photosLeft > 0) { withPhoto.add(i); photosLeft--; }
    }
    return items.map((m, i) => {
      const text = String(m.text || '').slice(0, 4000);
      if (m.role === 'assistant') return { role: 'assistant', content: text || '…' };
      if (withPhoto.has(i)) return { role: 'user', content: [{ type: 'text', text: text || '(фото без подписи)' }, { type: 'image_url', image_url: { url: m.image } }] };
      return { role: 'user', content: m.image ? `${text || ''} (было фото)`.trim() : text };
    });
  };

  /**
   * Одно сообщение пользователя → ответ ассистента и, возможно, карточки действий.
   * history — прошлые реплики [{role:'user'|'assistant', text, image?}] (фото — см. historyMessages).
   * image — data:image/jpeg;base64,…; audio — { data: base64, format: 'mp3'|'wav'|… }.
   */
  const reply = async ({ user, history = [], text = '', image = null, audio = null, companyName = '' }) => {
    sweep();
    const today = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' });
    const content = [];
    if (text) content.push({ type: 'text', text });
    if (image) content.push({ type: 'image_url', image_url: { url: image } });
    if (audio) content.push({ type: 'input_audio', input_audio: { data: audio.data, format: audio.format } });
    if (audio && !text) content.unshift({ type: 'text', text: 'Это голосовое сообщение пользователя — выполни то, что он говорит.' });
    if (image && !text && !audio) content.unshift({ type: 'text', text: '(фото без подписи)' });
    if (!content.length) return { reply: 'Напишите или скажите, что сделать.', actions: [] };

    const messages = [
      { role: 'system', content: systemPrompt({ userName: user.name, companyName, today }) },
      ...historyMessages(history),
      { role: 'user', content },
    ];
    const tools = [...TOOLS.map(toOpenAiTool), toOpenAiTool(PREPARE_CONTRACT_TOOL), toOpenAiTool(DUE_PAYMENTS_TOOL)];
    const actions = [];
    const usage = { prompt: 0, completion: 0, cost: 0 };

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const data = await callModel({ model: DEFAULT_MODEL, messages, tools, temperature: 0.2, max_tokens: 1200, usage: { include: true } });
      usage.prompt += data.usage?.prompt_tokens || 0;
      usage.completion += data.usage?.completion_tokens || 0;
      usage.cost += Number(data.usage?.cost) || 0;
      const msg = data.choices[0].message || {};
      const calls = msg.tool_calls || [];
      if (!calls.length) {
        // Служебные пометки истории (см. draftNote в AIAssistant.tsx) модель иногда повторяет — человеку они не нужны
        let text = (msg.content || '').replace(/^\s*\[Черновик договора:[^\]]*\]\s*$/gm, '').trim() || 'Готово.';
        // У черновика договора кнопка своя — модель иногда по привычке зовёт
        // «Подтвердить», которого на карточке договора нет
        if (actions.some(a => a.kind === 'contract_form') && !actions.some(a => a.kind === 'confirm')) {
          text = text.replace(/[^.!?\n]*«?Подтвердить»?[^.!?\n]*[.!?]?/g, '').trim();
          if (!/Открыть форму договора/.test(text)) text = `${text ? `${text}\n` : ''}Черновик договора готов — нажмите «Открыть форму договора», проверьте и сохраните.`;
        }
        await nameDraftRefs(user.id, actions);
        // Пустые поля, которые модель заполнила словами («не указан»)
        for (const a of actions) {
          const nc = a.kind === 'contract_form' && a.draft?.newCustomer;
          if (nc) for (const k of Object.keys(nc)) if (typeof nc[k] === 'string' && /^(не\s*указан[аоы]?|нет|неизвестно|—|-)$/i.test(nc[k].trim())) delete nc[k];
          if (nc?.phone && !/\d{5,}/.test(nc.phone)) delete nc.phone;
        }
        return { reply: text, actions, usage };
      }
      messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
      for (const call of calls) {
        const name = call.function?.name;
        let args = {};
        try { args = JSON.parse(call.function?.arguments || '{}'); } catch { /* пустые аргументы */ }
        let result;
        if (name === 'due_payments') {
          result = await duePayments(user.id, args);
        } else if (name === 'prepare_contract') {
          actions.push({ id: newActionId(), kind: 'contract_form', title: 'Оформить договор', draft: args });
          result = 'Черновик договора передан в приложение: человек увидит заполненную форму и сохранит её сам.';
        } else {
          const tool = TOOLS.find(t => t.name === name);
          if (!tool) {
            result = `Инструмента ${name} нет.`;
          } else if (tool.scope === 'write') {
            const id = newActionId();
            const summary = name === 'create_payment' ? await paymentSummary(user.id, args)
              : (name === 'create_expense' || name === 'create_income') ? await accountSummary(user.id, name, args)
              : describe(name, args);
            pending.set(id, { userId: user.id, tool: name, args, summary, at: Date.now() });
            actions.push({ id, kind: 'confirm', tool: name, title: WRITE_TITLES[name] || tool.title, summary, args });
            result = 'Действие подготовлено и ждёт, пока человек нажмёт «Подтвердить». Не повторяй вызов.';
          } else {
            const r = await callV1(user.id, tool, args);
            result = r.text;
          }
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: result });
      }
    }
    return { reply: 'Не успел закончить — попробуйте сформулировать короче.', actions, usage };
  };

  return { reply, confirmAction, cancelAction, verifyAgentToken, model: DEFAULT_MODEL, query };
}

module.exports = { createAssistant };
