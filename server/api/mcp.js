// MCP-сервер: помощник разговаривает с FinUchet набором инструментов.
//
// Зачем он, если есть REST API. Помощнику нужен не список адресов, а перечень
// умений с описаниями — «показать просрочки», «принять платёж». MCP это и есть:
// договорённость о том, как помощник спрашивает список инструментов и вызывает
// их. Разговор идёт по JSON-RPC: одно тело запроса, один ответ.
//
// Второй копии расчётов здесь нет намеренно: каждый инструмент — это вызов
// нашего же публичного маршрута внутрь себя, с тем же заголовком авторизации.
// Так у MCP и у обычного API один в один совпадают права, проверки полей,
// лимиты частоты и журнал обращений: разойтись им негде.

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'finuchet', title: 'FinUchet', version: '1.0.0' };

// Инструмент: как называется, что делает, какие принимает поля и во что
// превращается. `path` собирает адрес нашего API, `scope` — требуемое право.
const TOOLS = [
  {
    name: 'overdue_contracts',
    title: 'Просроченные договоры',
    description: 'Договоры, по которым есть просрочка на сегодня: клиент, товар, сумма просрочки и остаток долга. Отвечает на вопросы «покажи просрочки», «кто не платит».',
    scope: 'read',
    input: {
      limit: { type: 'integer', description: 'Сколько вернуть, по умолчанию 50, максимум 200' },
    },
    request: args => ({ method: 'GET', path: `/contracts?overdue=true&limit=${args.limit || 50}` }),
  },
  {
    name: 'list_contracts',
    title: 'Договоры',
    description: 'Список договоров рассрочки с фильтрами по состоянию, клиенту, счёту и дате оформления.',
    scope: 'read',
    input: {
      status: { type: 'string', enum: ['ACTIVE', 'COMPLETED', 'DEFAULTED', 'DRAFT'], description: 'Состояние договора' },
      customerId: { type: 'string', description: 'Только по одному клиенту' },
      accountId: { type: 'string', description: 'Только по одному счёту' },
      from: { type: 'string', description: 'Оформлены с даты, YYYY-MM-DD' },
      to: { type: 'string', description: 'Оформлены по дату, YYYY-MM-DD' },
      limit: { type: 'integer' },
      offset: { type: 'integer' },
    },
    request: args => ({ method: 'GET', path: `/contracts?${query(args)}` }),
  },
  {
    name: 'get_contract',
    title: 'Договор с графиком',
    description: 'Один договор целиком: суммы, остаток, просрочка и график платежей с отметками об оплате.',
    scope: 'read',
    input: { id: { type: 'string', description: 'Идентификатор договора' } },
    required: ['id'],
    request: args => ({ method: 'GET', path: `/contracts/${encodeURIComponent(args.id)}` }),
  },
  {
    name: 'list_customers',
    title: 'Клиенты',
    description: 'Список клиентов с поиском по имени или телефону.',
    scope: 'read',
    input: {
      search: { type: 'string', description: 'Имя или телефон' },
      limit: { type: 'integer' }, offset: { type: 'integer' },
    },
    request: args => ({ method: 'GET', path: `/customers?${query(args)}` }),
  },
  {
    name: 'list_payments',
    title: 'Полученные платежи',
    description: 'Деньги, полученные по договорам за период: первый взнос и платежи.',
    scope: 'read',
    input: {
      contractId: { type: 'string' },
      from: { type: 'string', description: 'С даты, YYYY-MM-DD' },
      to: { type: 'string', description: 'По дату, YYYY-MM-DD' },
      limit: { type: 'integer' },
    },
    request: args => ({ method: 'GET', path: `/payments?${query(args)}` }),
  },
  {
    name: 'list_accounts',
    title: 'Счета и остатки',
    description: 'Счета кассы с текущими остатками.',
    scope: 'read',
    input: {},
    request: () => ({ method: 'GET', path: '/accounts' }),
  },
  {
    name: 'list_expenses',
    title: 'Расходы',
    description: 'Расходы за период с фильтром по счёту и категории.',
    scope: 'read',
    input: {
      accountId: { type: 'string' }, category: { type: 'string' },
      from: { type: 'string' }, to: { type: 'string' }, limit: { type: 'integer' },
    },
    request: args => ({ method: 'GET', path: `/expenses?${query(args)}` }),
  },
  {
    name: 'list_products',
    title: 'Товары и остатки',
    description: 'Каталог склада с остатками, поиск по названию, артикулу или штрихкоду.',
    scope: 'read',
    input: { search: { type: 'string' }, inStock: { type: 'boolean' }, limit: { type: 'integer' } },
    request: args => ({ method: 'GET', path: `/products?${query(args)}` }),
  },
  {
    name: 'list_investors',
    title: 'Инвесторы',
    description: 'Инвесторы: вложенные суммы, процент прибыли, даты входа.',
    scope: 'read',
    input: {},
    request: () => ({ method: 'GET', path: '/investors' }),
  },
  {
    name: 'get_summary',
    title: 'Сводка по деньгам',
    description: 'Итоги за период: сколько договоров, сколько собрано, прибыль, расходы, долг и просрочка, остаток по счетам.',
    scope: 'read',
    input: {
      from: { type: 'string', description: 'Начало периода, YYYY-MM-DD' },
      to: { type: 'string', description: 'Конец периода, YYYY-MM-DD' },
      accountId: { type: 'string', description: 'Только по одному счёту' },
    },
    request: args => ({ method: 'GET', path: `/reports/summary?${query(args)}` }),
  },
  {
    name: 'whoami',
    title: 'Чей это аккаунт',
    description: 'Владелец подключения, тариф и ограничения. Полезно, когда нужно убедиться, к чьим данным есть доступ.',
    scope: 'read',
    input: {},
    request: () => ({ method: 'GET', path: '/me' }),
  },

  // ── изменяющие инструменты: только при праве «запись» ─────────────────────
  {
    name: 'create_payment',
    title: 'Принять платёж',
    description: 'Записать платёж по договору. Уменьшает остаток долга и закрывает месяцы графика. Сумма больше остатка отклоняется, если не передать allowOverpay.',
    scope: 'write',
    input: {
      contractId: { type: 'string', description: 'Договор' },
      amount: { type: 'number', description: 'Сумма платежа в рублях' },
      date: { type: 'string', description: 'Дата платежа, YYYY-MM-DD; по умолчанию сегодня' },
      note: { type: 'string', description: 'Комментарий' },
      allowOverpay: { type: 'boolean', description: 'Разрешить сумму больше остатка долга' },
    },
    required: ['contractId', 'amount'],
    request: args => ({
      method: 'POST',
      path: `/payments${args.allowOverpay ? '?allowOverpay=true' : ''}`,
      body: { contractId: args.contractId, amount: args.amount, date: args.date, note: args.note },
    }),
  },
  {
    name: 'create_customer',
    title: 'Завести клиента',
    description: 'Создать карточку клиента.',
    scope: 'write',
    input: {
      name: { type: 'string', description: 'Имя клиента' },
      phone: { type: 'string', description: 'Телефон' },
      address: { type: 'string' }, notes: { type: 'string' },
    },
    required: ['name', 'phone'],
    request: args => ({ method: 'POST', path: '/customers', body: args }),
  },
  {
    name: 'create_expense',
    title: 'Записать расход',
    description: 'Провести расход по счёту.',
    scope: 'write',
    input: {
      accountId: { type: 'string', description: 'Счёт' },
      title: { type: 'string', description: 'Назначение' },
      amount: { type: 'number', description: 'Сумма в рублях' },
      category: { type: 'string' }, date: { type: 'string' },
    },
    required: ['accountId', 'title', 'amount'],
    request: args => ({ method: 'POST', path: '/expenses', body: args }),
  },
  {
    name: 'create_income',
    title: 'Записать приход',
    description: 'Прочий приход денег в кассу, не связанный с договором.',
    scope: 'write',
    input: {
      accountId: { type: 'string', description: 'Счёт' },
      amount: { type: 'number', description: 'Сумма в рублях' },
      note: { type: 'string', description: 'Назначение' },
      date: { type: 'string' },
    },
    required: ['accountId', 'amount'],
    request: args => ({ method: 'POST', path: '/income', body: args }),
  },
];

// Строка запроса из переданных полей: пустые не отправляем, чтобы не спорить
// с проверкой параметров на той стороне.
const query = args => Object.entries(args || {})
  .filter(([, v]) => v !== undefined && v !== null && v !== '')
  .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
  .join('&');

// Описание инструмента в том виде, в каком его ждёт помощник.
const toolSchema = tool => ({
  name: tool.name,
  title: tool.title,
  description: tool.description,
  inputSchema: {
    type: 'object',
    properties: tool.input || {},
    ...(tool.required ? { required: tool.required } : {}),
  },
  annotations: {
    readOnlyHint: tool.scope === 'read',
    // Подсказка помощнику: изменяющие вызовы стоит подтверждать у человека.
    destructiveHint: tool.scope === 'write',
  },
});

module.exports = { PROTOCOL_VERSION, SERVER_INFO, TOOLS, toolSchema, query };
