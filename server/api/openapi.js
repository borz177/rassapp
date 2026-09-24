// Машиночитаемое описание публичного API (OpenAPI 3.0.3), отдаётся по
// /api/v1/openapi.json без ключа. По нему генерируют клиентов, его подсовывают
// в Postman, и по нему же подключается помощник вроде ChatGPT: там схему
// импортируют как «действия» (Actions). Человеческая документация — на /api.
//
// Версия намеренно 3.0.3, а не 3.1: конструктор действий спотыкается о запись
// необязательных полей через список типов ("type": ["string", "null"]), принятую
// в 3.1. Поэтому ниже такие поля описаны парой type + nullable — см. toV30.

const money = (description, example) => ({ type: 'number', format: 'double', description, example });
const str = (description, example) => ({ type: 'string', description, example });

const Error = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: str('Машинный код ошибки', 'validation_error'),
        message: str('Пояснение для человека', 'Проверьте поля запроса.'),
        details: { type: 'array', items: { type: 'object' }, description: 'Что именно не так — по полям' },
      },
      required: ['code', 'message'],
    },
    requestId: str('Идентификатор запроса — назовите его в поддержке'),
  },
};

const Customer = {
  type: 'object',
  properties: {
    id: str('Идентификатор', 'cust_1727100000000_a1b2c3'),
    name: str('Имя клиента', 'Иванов Иван'),
    phone: str('Телефон', '+7 900 000-00-00'),
    email: { type: ['string', 'null'] },
    address: { type: ['string', 'null'] },
    birthDate: { type: ['string', 'null'], description: 'ISO YYYY-MM-DD' },
    passport: {
      type: ['object', 'null'],
      properties: { series: { type: ['string', 'null'] }, number: { type: ['string', 'null'] }, issuedBy: { type: ['string', 'null'] } },
    },
    trustScore: { type: 'integer', minimum: 0, maximum: 100 },
    notes: { type: 'string' },
    createdAt: { type: ['string', 'null'], format: 'date-time' },
  },
};

const ScheduleRow = {
  type: 'object',
  properties: {
    id: str('Идентификатор строки'),
    contractId: str('Договор'),
    amount: money('Сумма', 20000),
    date: { type: 'string', format: 'date-time' },
    isPaid: { type: 'boolean', description: 'Закрыта ли строка деньгами' },
    kind: { type: 'string', enum: ['scheduled', 'payment'], description: 'Плановый месяц графика или фактический платёж' },
    actualDate: { type: ['string', 'null'], format: 'date-time' },
    note: { type: ['string', 'null'] },
  },
};

const Contract = {
  type: 'object',
  properties: {
    id: str('Идентификатор', 'sale_1727100000000_a1b2c3'),
    type: { type: 'string', enum: ['INSTALLMENT', 'CASH'] },
    status: { type: 'string', enum: ['ACTIVE', 'COMPLETED', 'DEFAULTED', 'DRAFT'] },
    customerId: str('Клиент'),
    accountId: str('Счёт, на который приходят деньги'),
    productName: str('Товар', 'Холодильник'),
    productId: { type: ['string', 'null'] },
    buyPrice: money('Закупочная цена', 60000),
    totalAmount: money('Сумма договора с наценкой', 100000),
    downPayment: money('Первый взнос', 20000),
    remainingAmount: money('Остаток долга', 40000),
    collectedAmount: money('Сколько уже получено по договору', 60000),
    overdueAmount: money('Просроченная сумма на сегодня', 0),
    interestRate: { type: 'number' },
    installments: { type: 'integer', description: 'Число платежей графика' },
    startDate: { type: 'string', format: 'date-time' },
    paymentDay: { type: ['integer', 'null'], description: 'День месяца для платежей' },
    notes: { type: 'string' },
    guarantor: { type: ['object', 'null'], properties: { name: { type: ['string', 'null'] }, phone: { type: ['string', 'null'] } } },
    schedule: { type: 'array', items: ScheduleRow, description: 'Только в ответе на запрос одного договора' },
  },
};

const Payment = {
  type: 'object',
  properties: {
    id: str('Идентификатор платежа'),
    contractId: str('Договор'),
    customerId: str('Клиент'),
    amount: money('Сумма', 20000),
    date: { type: 'string', format: 'date-time' },
    kind: { type: 'string', enum: ['down_payment', 'payment'], description: 'Первый взнос или платёж' },
    note: { type: ['string', 'null'] },
  },
};

const Expense = {
  type: 'object',
  properties: {
    id: str('Идентификатор'),
    accountId: str('Счёт'),
    title: str('Назначение', 'Аренда'),
    amount: money('Сумма', 15000),
    category: str('Категория', 'Аренда'),
    date: { type: 'string', format: 'date-time' },
    description: { type: ['string', 'null'] },
    customerId: { type: ['string', 'null'] },
    supplierId: { type: ['string', 'null'] },
    payoutType: { type: ['string', 'null'] },
  },
};

const Account = {
  type: 'object',
  properties: {
    id: str('Идентификатор'),
    name: str('Название', 'Касса'),
    type: { type: 'string', enum: ['MAIN', 'INVESTOR', 'POOL', 'SHARED'] },
    isMain: { type: 'boolean' },
    ownerInvestorId: { type: ['string', 'null'] },
    balance: money('Остаток по счёту', 125000),
  },
};

const Product = {
  type: 'object',
  properties: {
    id: str('Идентификатор'),
    name: str('Название'),
    sku: { type: ['string', 'null'] },
    barcodes: { type: 'array', items: { type: 'string' } },
    category: { type: ['string', 'null'] },
    price: money('Цена продажи'),
    buyPrice: money('Цена закупа'),
    stock: { type: 'number', description: 'Остаток' },
    unit: { type: ['string', 'null'] },
  },
};

const Investor = {
  type: 'object',
  properties: {
    id: str('Идентификатор'),
    name: str('Имя'),
    initialAmount: money('Вложено'),
    profitPercentage: { type: 'number', description: 'Процент прибыли инвестора' },
    joinedDate: { type: ['string', 'null'], format: 'date-time' },
    exitDate: { type: ['string', 'null'], format: 'date-time' },
  },
};

const listMeta = {
  type: 'object',
  properties: {
    total: { type: 'integer' }, limit: { type: 'integer' }, offset: { type: 'integer' }, hasMore: { type: 'boolean' },
  },
};

const listOf = ref => ({
  type: 'object',
  properties: { data: { type: 'array', items: { $ref: `#/components/schemas/${ref}` } }, meta: listMeta },
});
const itemOf = ref => ({ type: 'object', properties: { data: { $ref: `#/components/schemas/${ref}` } } });

const errorResponses = {
  400: { description: 'Некорректные параметры', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  401: { description: 'Нет ключа или ключ неверный', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  403: { description: 'Ключу не хватает прав, тариф не позволяет или аккаунт заблокирован', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  404: { description: 'Не найдено', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  409: { description: 'Конфликт: запись занята связями или повтор с другим телом', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  422: { description: 'Не прошли проверку поля запроса', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  429: { description: 'Превышена частота запросов', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
};

const pagingParams = [
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 }, description: 'Сколько записей вернуть' },
  { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 }, description: 'Сколько пропустить' },
];

const jsonBody = properties => ({
  required: true,
  content: { 'application/json': { schema: { type: 'object', properties } } },
});

const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'FinUchet API',
    version: '1.0.0',
    description: [
      'API учёта рассрочки FinUchet. Ключ передаётся заголовком Authorization: Bearer.',
      'Доступно на тарифах Бизнес и Бизнес Pro. Документация: https://rassrochka.pro/api',
    ].join(' '),
    contact: { name: 'Поддержка FinUchet', url: 'https://rassrochka.pro' },
  },
  servers: [{ url: 'https://rassrochka.pro/api/v1', description: 'Боевой сервер' }],
  security: [{ bearerAuth: [] }],
  tags: [
    { name: 'Аккаунт', description: 'Кто владелец ключа, тариф и лимиты' },
    { name: 'Клиенты' }, { name: 'Договоры' }, { name: 'Платежи' },
    { name: 'Деньги', description: 'Счета, расходы, прочий приход' },
    { name: 'Склад' }, { name: 'Инвесторы' }, { name: 'Отчёты' },
  ],
  paths: {
    '/me': {
      get: {
        tags: ['Аккаунт'], summary: 'Владелец ключа, тариф и лимиты',
        responses: { 200: { description: 'Сведения об аккаунте', content: { 'application/json': { schema: { type: 'object' } } } }, ...errorResponses },
      },
    },
    '/accounts': {
      get: {
        tags: ['Деньги'], summary: 'Счета с остатками',
        responses: { 200: { description: 'Список счетов', content: { 'application/json': { schema: itemOf('Account') } } }, ...errorResponses },
      },
    },
    '/customers': {
      get: {
        tags: ['Клиенты'], summary: 'Список клиентов',
        parameters: [...pagingParams, { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Поиск по имени или телефону' }],
        responses: { 200: { description: 'Клиенты', content: { 'application/json': { schema: listOf('Customer') } } }, ...errorResponses },
      },
      post: {
        tags: ['Клиенты'], summary: 'Создать клиента',
        requestBody: jsonBody({
          name: str('Имя', 'Иванов Иван'), phone: str('Телефон', '+79000000000'),
          email: { type: 'string' }, address: { type: 'string' }, birthDate: { type: 'string' },
          notes: { type: 'string' }, trustScore: { type: 'integer' },
          passportSeries: { type: 'string' }, passportNumber: { type: 'string' }, passportIssuedBy: { type: 'string' },
        }),
        responses: { 201: { description: 'Создан', content: { 'application/json': { schema: itemOf('Customer') } } }, ...errorResponses },
      },
    },
    '/customers/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: { tags: ['Клиенты'], summary: 'Клиент по идентификатору', responses: { 200: { description: 'Клиент', content: { 'application/json': { schema: itemOf('Customer') } } }, ...errorResponses } },
      patch: { tags: ['Клиенты'], summary: 'Изменить клиента', requestBody: jsonBody({ name: { type: 'string' }, phone: { type: 'string' }, notes: { type: 'string' } }), responses: { 200: { description: 'Изменён', content: { 'application/json': { schema: itemOf('Customer') } } }, ...errorResponses } },
      delete: { tags: ['Клиенты'], summary: 'Удалить клиента (только без договоров)', responses: { 204: { description: 'Удалён' }, ...errorResponses } },
    },
    '/contracts': {
      get: {
        tags: ['Договоры'], summary: 'Список договоров',
        parameters: [
          ...pagingParams,
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['ACTIVE', 'COMPLETED', 'DEFAULTED', 'DRAFT'] } },
          { name: 'customerId', in: 'query', schema: { type: 'string' } },
          { name: 'accountId', in: 'query', schema: { type: 'string' } },
          { name: 'overdue', in: 'query', schema: { type: 'boolean' }, description: 'Только просроченные' },
          { name: 'from', in: 'query', schema: { type: 'string' }, description: 'Дата договора от (YYYY-MM-DD)' },
          { name: 'to', in: 'query', schema: { type: 'string' }, description: 'Дата договора до' },
        ],
        responses: { 200: { description: 'Договоры', content: { 'application/json': { schema: listOf('Contract') } } }, ...errorResponses },
      },
      post: {
        tags: ['Договоры'], summary: 'Оформить договор',
        description: 'График платежей строится автоматически по числу месяцев и дню платежа.',
        requestBody: jsonBody({
          customerId: str('Клиент'), accountId: str('Счёт'), productName: str('Товар'),
          totalAmount: money('Сумма договора', 100000), buyPrice: money('Закуп', 60000),
          downPayment: money('Первый взнос', 20000), installments: { type: 'integer', example: 4 },
          interestRate: { type: 'number' }, startDate: { type: 'string' }, paymentDay: { type: 'integer' },
          notes: { type: 'string' }, guarantorName: { type: 'string' }, guarantorPhone: { type: 'string' },
        }),
        responses: { 201: { description: 'Создан', content: { 'application/json': { schema: itemOf('Contract') } } }, ...errorResponses },
      },
    },
    '/contracts/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: { tags: ['Договоры'], summary: 'Договор с графиком', responses: { 200: { description: 'Договор', content: { 'application/json': { schema: itemOf('Contract') } } }, ...errorResponses } },
      patch: { tags: ['Договоры'], summary: 'Изменить примечание, статус, день платежа', requestBody: jsonBody({ status: { type: 'string' }, notes: { type: 'string' }, paymentDay: { type: 'integer' } }), responses: { 200: { description: 'Изменён', content: { 'application/json': { schema: itemOf('Contract') } } }, ...errorResponses } },
      delete: { tags: ['Договоры'], summary: 'Удалить договор (только пока по нему нет денег)', responses: { 204: { description: 'Удалён' }, ...errorResponses } },
    },
    '/payments': {
      get: {
        tags: ['Платежи'], summary: 'Полученные деньги по договорам',
        parameters: [...pagingParams,
          { name: 'contractId', in: 'query', schema: { type: 'string' } },
          { name: 'from', in: 'query', schema: { type: 'string' } },
          { name: 'to', in: 'query', schema: { type: 'string' } }],
        responses: { 200: { description: 'Платежи', content: { 'application/json': { schema: listOf('Payment') } } }, ...errorResponses },
      },
      post: {
        tags: ['Платежи'], summary: 'Принять платёж по договору',
        description: 'Сумма больше остатка долга отклоняется кодом 409 — переплату нужно подтвердить параметром allowOverpay=true. Повтор запроса с тем же Idempotency-Key вернёт прежний ответ и второй платёж не создаст.',
        parameters: [{ name: 'allowOverpay', in: 'query', schema: { type: 'boolean' }, description: 'Разрешить переплату' }],
        requestBody: jsonBody({ contractId: str('Договор'), amount: money('Сумма платежа', 20000), date: { type: 'string' }, note: { type: 'string' } }),
        responses: { 201: { description: 'Платёж принят', content: { 'application/json': { schema: { type: 'object' } } } }, ...errorResponses },
      },
    },
    '/payments/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      delete: { tags: ['Платежи'], summary: 'Отменить платёж', responses: { 200: { description: 'Договор после отмены', content: { 'application/json': { schema: itemOf('Contract') } } }, ...errorResponses } },
    },
    '/expenses': {
      get: {
        tags: ['Деньги'], summary: 'Расходы',
        parameters: [...pagingParams,
          { name: 'accountId', in: 'query', schema: { type: 'string' } },
          { name: 'category', in: 'query', schema: { type: 'string' } },
          { name: 'from', in: 'query', schema: { type: 'string' } },
          { name: 'to', in: 'query', schema: { type: 'string' } }],
        responses: { 200: { description: 'Расходы', content: { 'application/json': { schema: listOf('Expense') } } }, ...errorResponses },
      },
      post: {
        tags: ['Деньги'], summary: 'Записать расход',
        requestBody: jsonBody({ accountId: str('Счёт'), title: str('Назначение'), amount: money('Сумма', 15000), category: { type: 'string' }, date: { type: 'string' }, description: { type: 'string' } }),
        responses: { 201: { description: 'Создан', content: { 'application/json': { schema: itemOf('Expense') } } }, ...errorResponses },
      },
    },
    '/expenses/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: { tags: ['Деньги'], summary: 'Расход по идентификатору', responses: { 200: { description: 'Расход', content: { 'application/json': { schema: itemOf('Expense') } } }, ...errorResponses } },
      patch: { tags: ['Деньги'], summary: 'Изменить расход', requestBody: jsonBody({ title: { type: 'string' }, amount: { type: 'number' }, category: { type: 'string' } }), responses: { 200: { description: 'Изменён', content: { 'application/json': { schema: itemOf('Expense') } } }, ...errorResponses } },
      delete: { tags: ['Деньги'], summary: 'Удалить расход', responses: { 204: { description: 'Удалён' }, ...errorResponses } },
    },
    '/income': {
      post: {
        tags: ['Деньги'], summary: 'Прочий приход в кассу',
        requestBody: jsonBody({ accountId: str('Счёт'), amount: money('Сумма', 5000), note: { type: 'string' }, category: { type: 'string' }, date: { type: 'string' } }),
        responses: { 201: { description: 'Приход записан', content: { 'application/json': { schema: { type: 'object' } } } }, ...errorResponses },
      },
    },
    '/products': {
      get: {
        tags: ['Склад'], summary: 'Каталог товаров с остатками',
        parameters: [...pagingParams,
          { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Название, артикул или штрихкод' },
          { name: 'inStock', in: 'query', schema: { type: 'boolean' }, description: 'Только с остатком' }],
        responses: { 200: { description: 'Товары', content: { 'application/json': { schema: listOf('Product') } } }, ...errorResponses },
      },
    },
    '/products/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: { tags: ['Склад'], summary: 'Товар по идентификатору', responses: { 200: { description: 'Товар', content: { 'application/json': { schema: itemOf('Product') } } }, ...errorResponses } },
    },
    '/warehouses': {
      get: { tags: ['Склад'], summary: 'Склады', responses: { 200: { description: 'Склады', content: { 'application/json': { schema: { type: 'object' } } } }, ...errorResponses } },
    },
    '/retail-sales': {
      get: {
        tags: ['Склад'], summary: 'Розничные продажи',
        parameters: [...pagingParams,
          { name: 'warehouseId', in: 'query', schema: { type: 'string' } },
          { name: 'from', in: 'query', schema: { type: 'string' } },
          { name: 'to', in: 'query', schema: { type: 'string' } }],
        responses: { 200: { description: 'Продажи', content: { 'application/json': { schema: { type: 'object' } } } }, ...errorResponses },
      },
    },
    '/investors': {
      get: { tags: ['Инвесторы'], summary: 'Инвесторы', responses: { 200: { description: 'Инвесторы', content: { 'application/json': { schema: itemOf('Investor') } } }, ...errorResponses } },
    },
    '/investors/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: { tags: ['Инвесторы'], summary: 'Инвестор по идентификатору', responses: { 200: { description: 'Инвестор', content: { 'application/json': { schema: itemOf('Investor') } } }, ...errorResponses } },
    },
    '/reports/summary': {
      get: {
        tags: ['Отчёты'], summary: 'Сводка: договоры, деньги, долги',
        parameters: [
          { name: 'from', in: 'query', schema: { type: 'string' }, description: 'Начало периода (YYYY-MM-DD)' },
          { name: 'to', in: 'query', schema: { type: 'string' }, description: 'Конец периода' },
          { name: 'accountId', in: 'query', schema: { type: 'string' }, description: 'Только по одному счёту' },
        ],
        responses: { 200: { description: 'Сводка', content: { 'application/json': { schema: { type: 'object' } } } }, ...errorResponses },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', description: 'API-ключ вида sk_live_…, выдаётся в настройках приложения' },
    },
    schemas: { Error, Customer, Contract, ScheduleRow, Payment, Expense, Account, Product, Investor },
  },
};

// Необязательные поля в 3.1 пишутся как type: ['string', 'null'], а в 3.0 —
// как type: 'string' + nullable: true. Переписываем рекурсивно, чтобы описания
// выше оставались читаемыми.
const toV30 = node => {
  if (Array.isArray(node)) return node.map(toV30);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type' && Array.isArray(value)) {
      const types = value.filter(t => t !== 'null');
      out.type = types[0] || 'string';
      if (types.length !== value.length) out.nullable = true;
    } else {
      out[key] = toV30(value);
    }
  }
  return out;
};

// Уникальное имя операции. Помощник показывает его как название инструмента
// («listContracts»), а генераторы клиентов делают из него имя метода. Без него
// конструктор действий ChatGPT схему не принимает.
const OPERATION_IDS = {
  'get /me': 'getMe',
  'get /accounts': 'listAccounts',
  'get /customers': 'listCustomers',
  'post /customers': 'createCustomer',
  'get /customers/{id}': 'getCustomer',
  'patch /customers/{id}': 'updateCustomer',
  'delete /customers/{id}': 'deleteCustomer',
  'get /contracts': 'listContracts',
  'post /contracts': 'createContract',
  'get /contracts/{id}': 'getContract',
  'patch /contracts/{id}': 'updateContract',
  'delete /contracts/{id}': 'deleteContract',
  'get /payments': 'listPayments',
  'post /payments': 'createPayment',
  'delete /payments/{id}': 'cancelPayment',
  'get /expenses': 'listExpenses',
  'post /expenses': 'createExpense',
  'get /expenses/{id}': 'getExpense',
  'patch /expenses/{id}': 'updateExpense',
  'delete /expenses/{id}': 'deleteExpense',
  'post /income': 'createIncome',
  'get /products': 'listProducts',
  'get /products/{id}': 'getProduct',
  'get /warehouses': 'listWarehouses',
  'get /retail-sales': 'listRetailSales',
  'get /investors': 'listInvestors',
  'get /investors/{id}': 'getInvestor',
  'get /reports/summary': 'getSummary',
};

const fallbackId = (method, path) =>
  method + path.replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '');

for (const [path, item] of Object.entries(openApiSpec.paths)) {
  for (const method of ['get', 'post', 'patch', 'delete']) {
    if (!item[method]) continue;
    // Новый маршрут без записи в списке получит имя автоматически: пусть будет
    // некрасивое, но схема останется рабочей.
    item[method].operationId = OPERATION_IDS[`${method} ${path}`] || fallbackId(method, path);
  }
}

const specV30 = toV30(openApiSpec);

module.exports = { openApiSpec: specV30 };
