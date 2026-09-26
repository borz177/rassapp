import React, { useState } from 'react';

/**
 * Документация публичного API — открытая страница /api.
 *
 * Пишется для того, кто подключает FinUchet к сайту, боту или 1С и видит нашу
 * систему впервые. Поэтому здесь не только перечень маршрутов: сначала три шага
 * до первого запроса, потом общие правила (ответы, ошибки, лимиты, повторы),
 * и только затем справочник. Примеры — curl: он есть везде и его можно
 * вставить в терминал не читая остального.
 *
 * Источник истины для машин — /api/v1/openapi.json (server/api/openapi.js).
 * Если маршруты меняются, правятся оба места.
 */

const BASE = 'https://rassrochka.pro/api/v1';

type Param = { name: string; type: string; required?: boolean; desc: string };
type Endpoint = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  title: string;
  desc?: string;
  scope: 'read' | 'write';
  params?: Param[];
  body?: Param[];
  example?: string;
  response?: string;
};
type Group = { id: string; title: string; note?: string; endpoints: Endpoint[] };

const GROUPS: Group[] = [
  {
    id: 'account',
    title: 'Аккаунт',
    endpoints: [
      {
        method: 'GET', path: '/me', scope: 'read',
        title: 'Кто владелец ключа',
        desc: 'Проверка ключа и его прав: аккаунт, тариф, срок подписки, лимиты запросов. Удобно дёрнуть первым — сразу видно, что ключ рабочий.',
        example: `curl ${BASE}/me \\
  -H "Authorization: Bearer sk_live_ВАШ_КЛЮЧ"`,
        response: `{
  "data": {
    "account": { "id": "u_123", "name": "Магазин Ромашка", "email": "shop@example.com", "role": "manager" },
    "plan": "BUSINESS",
    "subscription": { "plan": "BUSINESS", "expiresAt": "2027-01-15T00:00:00.000Z" },
    "key": { "id": "key_…", "name": "Сайт", "prefix": "sk_live_Ab12Cd34", "scopes": ["read", "write"] },
    "limits": { "contracts": -1, "investors": -1, "requestsPerMinute": 120, "requestsPerDay": 20000 }
  }
}`,
      },
    ],
  },
  {
    id: 'customers',
    title: 'Клиенты',
    endpoints: [
      {
        method: 'GET', path: '/customers', scope: 'read',
        title: 'Список клиентов',
        params: [
          { name: 'search', type: 'строка', desc: 'Поиск по имени или телефону (телефон сравнивается по цифрам)' },
          { name: 'limit', type: 'число', desc: 'Сколько вернуть, по умолчанию 50, максимум 200' },
          { name: 'offset', type: 'число', desc: 'Сколько пропустить' },
        ],
        example: `curl "${BASE}/customers?search=иванов&limit=20" \\
  -H "Authorization: Bearer sk_live_ВАШ_КЛЮЧ"`,
        response: `{
  "data": [
    {
      "id": "cust_1727100000000_a1b2c3",
      "name": "Иванов Иван",
      "phone": "+7 900 000-00-00",
      "email": null,
      "address": "г. Грозный, ул. Мира, 1",
      "birthDate": "1990-05-12",
      "passport": { "series": "9600", "number": "123456", "issuedBy": "ОВД …" },
      "trustScore": 50,
      "notes": "",
      "createdAt": "2026-09-01T10:00:00.000Z"
    }
  ],
  "meta": { "total": 137, "limit": 20, "offset": 0, "hasMore": true }
}`,
      },
      {
        method: 'GET', path: '/customers/{id}', scope: 'read',
        title: 'Клиент по идентификатору',
        example: `curl ${BASE}/customers/cust_1727100000000_a1b2c3 \\
  -H "Authorization: Bearer sk_live_ВАШ_КЛЮЧ"`,
      },
      {
        method: 'POST', path: '/customers', scope: 'write',
        title: 'Завести клиента',
        desc: 'Обычный сценарий для заявки с сайта: сначала создаём клиента, получаем id, затем оформляем на него договор.',
        body: [
          { name: 'name', type: 'строка', required: true, desc: 'Имя клиента' },
          { name: 'phone', type: 'строка', required: true, desc: 'Телефон в любом виде' },
          { name: 'email', type: 'строка', desc: 'Почта' },
          { name: 'address', type: 'строка', desc: 'Адрес' },
          { name: 'birthDate', type: 'дата', desc: 'YYYY-MM-DD' },
          { name: 'notes', type: 'строка', desc: 'Заметка для себя' },
          { name: 'trustScore', type: 'число 0–100', desc: 'Оценка надёжности, по умолчанию 50' },
          { name: 'passportSeries', type: 'строка', desc: 'Серия паспорта' },
          { name: 'passportNumber', type: 'строка', desc: 'Номер паспорта' },
          { name: 'passportIssuedBy', type: 'строка', desc: 'Кем выдан' },
        ],
        example: `curl -X POST ${BASE}/customers \\
  -H "Authorization: Bearer sk_live_ВАШ_КЛЮЧ" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Иванов Иван","phone":"+79000000000"}'`,
        response: `HTTP/1.1 201 Created
Location: /api/v1/customers/cust_1727100000000_a1b2c3

{ "data": { "id": "cust_1727100000000_a1b2c3", "name": "Иванов Иван", … } }`,
      },
      {
        method: 'PATCH', path: '/customers/{id}', scope: 'write',
        title: 'Изменить клиента',
        desc: 'Передавайте только те поля, которые меняете. Остальные останутся как были.',
        example: `curl -X PATCH ${BASE}/customers/cust_… \\
  -H "Authorization: Bearer sk_live_ВАШ_КЛЮЧ" \\
  -H "Content-Type: application/json" \\
  -d '{"phone":"+79000000001"}'`,
      },
      {
        method: 'DELETE', path: '/customers/{id}', scope: 'write',
        title: 'Удалить клиента',
        desc: 'Только пока на клиенте нет договоров. Если договоры есть — ответ 409 и их количество: удаление клиента вместе с историей расчётов через API не делается.',
      },
    ],
  },
  {
    id: 'contracts',
    title: 'Договоры',
    note: 'Договор — это рассрочка: сумма, первый взнос и график платежей. Прочий приход в кассу договором не считается и в этот список не попадает.',
    endpoints: [
      {
        method: 'GET', path: '/contracts', scope: 'read',
        title: 'Список договоров',
        params: [
          { name: 'status', type: 'ACTIVE | COMPLETED | DEFAULTED | DRAFT', desc: 'Состояние договора' },
          { name: 'customerId', type: 'строка', desc: 'Только по одному клиенту' },
          { name: 'accountId', type: 'строка', desc: 'Только по одному счёту' },
          { name: 'overdue', type: 'true', desc: 'Только с просрочкой на сегодня' },
          { name: 'from, to', type: 'дата', desc: 'Дата оформления договора в диапазоне' },
          { name: 'limit, offset', type: 'число', desc: 'Постраничный вывод' },
        ],
        example: `curl "${BASE}/contracts?status=ACTIVE&overdue=true" \\
  -H "Authorization: Bearer sk_live_ВАШ_КЛЮЧ"`,
        response: `{
  "data": [
    {
      "id": "sale_1727100000000_a1b2c3",
      "type": "INSTALLMENT",
      "status": "ACTIVE",
      "customerId": "cust_…",
      "accountId": "acc_…",
      "productName": "Холодильник",
      "buyPrice": 60000,
      "totalAmount": 100000,
      "downPayment": 20000,
      "remainingAmount": 40000,
      "collectedAmount": 60000,
      "overdueAmount": 20000,
      "installments": 4,
      "startDate": "2026-05-10T00:00:00.000Z",
      "paymentDay": 10
    }
  ],
  "meta": { "total": 84, "limit": 50, "offset": 0, "hasMore": true }
}`,
      },
      {
        method: 'GET', path: '/contracts/{id}', scope: 'read',
        title: 'Договор с графиком',
        desc: 'К полям договора добавляется schedule — строки графика и фактические платежи. У строки графика kind = "scheduled", у платежа — "payment".',
        example: `curl ${BASE}/contracts/sale_… \\
  -H "Authorization: Bearer sk_live_ВАШ_КЛЮЧ"`,
        response: `{
  "data": {
    "id": "sale_…",
    "remainingAmount": 40000,
    "schedule": [
      { "id": "pay_sale_…_1", "amount": 20000, "date": "2026-06-10T00:00:00.000Z", "isPaid": true,  "kind": "scheduled" },
      { "id": "pay_sale_…_2", "amount": 20000, "date": "2026-07-10T00:00:00.000Z", "isPaid": false, "kind": "scheduled" },
      { "id": "pay_1727…", "amount": 20000, "date": "2026-06-09T12:31:00.000Z", "isPaid": true, "kind": "payment", "note": "Платёж через API" }
    ]
  }
}`,
      },
      {
        method: 'POST', path: '/contracts', scope: 'write',
        title: 'Оформить договор',
        desc: 'График строится сам: долг (сумма минус первый взнос) делится на число месяцев, первый платёж — через месяц от даты договора, день берётся из paymentDay. Последний платёж добирает копейки округления.',
        body: [
          { name: 'customerId', type: 'строка', required: true, desc: 'Клиент из вашего аккаунта' },
          { name: 'accountId', type: 'строка', required: true, desc: 'Счёт, на который придут деньги' },
          { name: 'productName', type: 'строка', required: true, desc: 'Что продаётся' },
          { name: 'totalAmount', type: 'деньги', required: true, desc: 'Сумма договора с наценкой' },
          { name: 'buyPrice', type: 'деньги', desc: 'Закупочная цена — от неё считается прибыль' },
          { name: 'downPayment', type: 'деньги', desc: 'Первый взнос, не больше суммы договора' },
          { name: 'installments', type: 'число', desc: 'Сколько месяцев платить' },
          { name: 'paymentDay', type: 'число 1–31', desc: 'День платежа в месяце' },
          { name: 'startDate', type: 'дата', desc: 'Дата договора, по умолчанию сегодня' },
          { name: 'interestRate', type: 'число', desc: 'Ставка наценки, справочно' },
          { name: 'notes', type: 'строка', desc: 'Примечание' },
          { name: 'guarantorName, guarantorPhone', type: 'строка', desc: 'Поручитель' },
          { name: 'status', type: 'ACTIVE | DRAFT | …', desc: 'По умолчанию ACTIVE' },
        ],
        example: `curl -X POST ${BASE}/contracts \\
  -H "Authorization: Bearer sk_live_ВАШ_КЛЮЧ" \\
  -H "Content-Type: application/json" \\
  -d '{
    "customerId": "cust_…",
    "accountId": "acc_…",
    "productName": "Холодильник",
    "totalAmount": 100000,
    "buyPrice": 60000,
    "downPayment": 20000,
    "installments": 4,
    "paymentDay": 10
  }'`,
      },
      {
        method: 'PATCH', path: '/contracts/{id}', scope: 'write',
        title: 'Изменить договор',
        desc: 'Через API меняются только примечание, статус, название товара, день платежа и поручитель. Суммы и график не меняются намеренно: это пересчёт денег, и делать его вслепую, не видя последствий для кассы и прибыли, опасно — для этого есть приложение.',
      },
      {
        method: 'DELETE', path: '/contracts/{id}', scope: 'write',
        title: 'Удалить договор',
        desc: 'Разрешено, только пока по договору не прошло ни рубля. Если был взнос или платёж — ответ 409: такой договор удаляют в приложении, где видно, что произойдёт с кассой.',
      },
    ],
  },
  {
    id: 'payments',
    title: 'Платежи',
    endpoints: [
      {
        method: 'GET', path: '/payments', scope: 'read',
        title: 'Полученные деньги',
        desc: 'Фактические поступления по договорам: первый взнос (kind = "down_payment") и платежи (kind = "payment"). Плановые месяцы графика сюда не попадают — они в договоре.',
        params: [
          { name: 'contractId', type: 'строка', desc: 'Только по одному договору' },
          { name: 'from, to', type: 'дата', desc: 'Период поступления' },
          { name: 'limit, offset', type: 'число', desc: 'Постраничный вывод' },
        ],
        example: `curl "${BASE}/payments?from=2026-09-01&to=2026-09-30" \\
  -H "Authorization: Bearer sk_live_ВАШ_КЛЮЧ"`,
      },
      {
        method: 'POST', path: '/payments', scope: 'write',
        title: 'Принять платёж',
        desc: 'Платёж уменьшает остаток долга и закрывает месяцы графика — ровно так же, как приём платежа в приложении. Когда долг доходит до нуля, договор становится COMPLETED.',
        body: [
          { name: 'contractId', type: 'строка', required: true, desc: 'Договор' },
          { name: 'amount', type: 'деньги', required: true, desc: 'Сумма платежа, больше нуля' },
          { name: 'date', type: 'дата', desc: 'Дата платежа, по умолчанию сейчас' },
          { name: 'note', type: 'строка', desc: 'Комментарий' },
        ],
        params: [
          { name: 'allowOverpay', type: 'true', desc: 'Разрешить сумму больше остатка долга. Без него переплата отклоняется кодом 409' },
        ],
        example: `curl -X POST ${BASE}/payments \\
  -H "Authorization: Bearer sk_live_ВАШ_КЛЮЧ" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: payment-2026-09-24-0001" \\
  -d '{"contractId":"sale_…","amount":20000}'`,
        response: `{
  "data": {
    "payment": { "id": "pay_…", "contractId": "sale_…", "amount": 20000, "kind": "payment" },
    "contract": { "id": "sale_…", "remainingAmount": 20000, "status": "ACTIVE" }
  }
}`,
      },
      {
        method: 'DELETE', path: '/payments/{id}', scope: 'write',
        title: 'Отменить платёж',
        desc: 'Убирает платёж, возвращает остаток долга и заново открывает закрытые им месяцы. Первый взнос через API не отменяется — он часть договора.',
      },
    ],
  },
  {
    id: 'money',
    title: 'Счета, расходы, приход',
    endpoints: [
      {
        method: 'GET', path: '/accounts', scope: 'read',
        title: 'Счета с остатками',
        desc: 'Остаток считается так же, как на экране кассы: начальный остаток, плюс взносы и платежи по договорам, минус расходы, плюс розница.',
        example: `curl ${BASE}/accounts -H "Authorization: Bearer sk_live_ВАШ_КЛЮЧ"`,
        response: `{
  "data": [
    { "id": "acc_main", "name": "Касса", "type": "MAIN", "isMain": true, "balance": 125000 },
    { "id": "pool_…", "name": "Общая", "type": "POOL", "balance": 480000 }
  ]
}`,
      },
      {
        method: 'GET', path: '/expenses', scope: 'read',
        title: 'Расходы',
        params: [
          { name: 'accountId', type: 'строка', desc: 'Только по одному счёту' },
          { name: 'category', type: 'строка', desc: 'Категория расхода' },
          { name: 'from, to', type: 'дата', desc: 'Период' },
          { name: 'limit, offset', type: 'число', desc: 'Постраничный вывод' },
        ],
      },
      {
        method: 'POST', path: '/expenses', scope: 'write',
        title: 'Записать расход',
        body: [
          { name: 'accountId', type: 'строка', required: true, desc: 'С какого счёта' },
          { name: 'title', type: 'строка', required: true, desc: 'Назначение' },
          { name: 'amount', type: 'деньги', required: true, desc: 'Сумма' },
          { name: 'category', type: 'строка', desc: 'Категория, по умолчанию «Прочее»' },
          { name: 'date', type: 'дата', desc: 'Дата, по умолчанию сегодня' },
          { name: 'description', type: 'строка', desc: 'Подробности' },
        ],
        example: `curl -X POST ${BASE}/expenses \\
  -H "Authorization: Bearer sk_live_ВАШ_КЛЮЧ" \\
  -H "Content-Type: application/json" \\
  -d '{"accountId":"acc_main","title":"Аренда","amount":15000,"category":"Аренда"}'`,
      },
      { method: 'GET', path: '/expenses/{id}', scope: 'read', title: 'Расход по идентификатору' },
      { method: 'PATCH', path: '/expenses/{id}', scope: 'write', title: 'Изменить расход' },
      {
        method: 'DELETE', path: '/expenses/{id}', scope: 'write', title: 'Удалить расход',
        desc: 'Закуп по договору (идентификатор начинается с exp_sale_) через API не удаляется: он повторяет закуп договора и меняется вместе с ним.',
      },
      {
        method: 'POST', path: '/income', scope: 'write',
        title: 'Прочий приход в кассу',
        desc: 'Деньги, не связанные с договором: возврат, пополнение, выручка со стороны.',
        body: [
          { name: 'accountId', type: 'строка', required: true, desc: 'На какой счёт' },
          { name: 'amount', type: 'деньги', required: true, desc: 'Сумма' },
          { name: 'note', type: 'строка', desc: 'Назначение — оно же название в списке операций' },
          { name: 'category', type: 'строка', desc: 'Категория' },
          { name: 'date', type: 'дата', desc: 'Дата' },
        ],
        example: `curl -X POST ${BASE}/income \\
  -H "Authorization: Bearer sk_live_ВАШ_КЛЮЧ" \\
  -H "Content-Type: application/json" \\
  -d '{"accountId":"acc_main","amount":5000,"note":"Возврат от поставщика"}'`,
      },
    ],
  },
  {
    id: 'shop',
    title: 'Склад и магазин',
    note: 'Раздел доступен, если у вас включён магазин (тариф Бизнес Pro). Наружу отдаётся только чтение: изменение остатков затрагивает движения по складу и делается в приложении.',
    endpoints: [
      {
        method: 'GET', path: '/products', scope: 'read',
        title: 'Каталог с остатками',
        params: [
          { name: 'search', type: 'строка', desc: 'Название, артикул или штрихкод' },
          { name: 'inStock', type: 'true', desc: 'Только то, что есть в наличии' },
          { name: 'limit, offset', type: 'число', desc: 'Постраничный вывод' },
        ],
        example: `curl "${BASE}/products?inStock=true" -H "Authorization: Bearer sk_live_ВАШ_КЛЮЧ"`,
      },
      { method: 'GET', path: '/products/{id}', scope: 'read', title: 'Товар по идентификатору' },
      { method: 'GET', path: '/warehouses', scope: 'read', title: 'Склады' },
      {
        method: 'GET', path: '/retail-sales', scope: 'read', title: 'Розничные продажи',
        params: [
          { name: 'warehouseId', type: 'строка', desc: 'Только по одному складу' },
          { name: 'from, to', type: 'дата', desc: 'Период' },
        ],
      },
    ],
  },
  {
    id: 'investors',
    title: 'Инвесторы и отчёты',
    endpoints: [
      { method: 'GET', path: '/investors', scope: 'read', title: 'Инвесторы', desc: 'Имя, вложенная сумма, процент прибыли, даты входа и выхода.' },
      { method: 'GET', path: '/investors/{id}', scope: 'read', title: 'Инвестор по идентификатору' },
      {
        method: 'GET', path: '/reports/summary', scope: 'read',
        title: 'Сводка',
        desc: 'Договоры, полученные деньги, прибыль, расходы и долги за период. Распределение прибыли между инвесторами наружу не отдаётся: оно зависит от состава кассы на каждую дату, и цифра без этого контекста вводит в заблуждение — смотрите её в приложении.',
        params: [
          { name: 'from, to', type: 'дата', desc: 'Период. Без него — за всё время' },
          { name: 'accountId', type: 'строка', desc: 'Только по одному счёту' },
        ],
        example: `curl "${BASE}/reports/summary?from=2026-09-01&to=2026-09-30" \\
  -H "Authorization: Bearer sk_live_ВАШ_КЛЮЧ"`,
        response: `{
  "data": {
    "period": { "from": "2026-09-01", "to": "2026-09-30" },
    "contracts": { "total": 84, "created": 7, "active": 61, "completed": 20, "overdue": 9 },
    "money": {
      "collected": 412000,
      "profit": 96500,
      "expenses": 38000,
      "outstandingDebt": 1840000,
      "overdueDebt": 96000,
      "cashOnAccounts": 265000
    }
  }
}`,
      },
    ],
  },
];

const ERRORS: { code: string; status: number; desc: string }[] = [
  { code: 'unauthorized', status: 401, desc: 'Ключ не передан. Заголовок Authorization: Bearer …' },
  { code: 'invalid_api_key', status: 401, desc: 'Ключ не найден — проверьте, что скопирован целиком' },
  { code: 'api_key_revoked', status: 401, desc: 'Ключ отозван в настройках' },
  { code: 'insufficient_scope', status: 403, desc: 'Ключу не хватает права «запись»' },
  { code: 'plan_required', status: 403, desc: 'Тариф не включает API' },
  { code: 'subscription_expired', status: 403, desc: 'Срок подписки истёк' },
  { code: 'account_blocked', status: 403, desc: 'Аккаунт заблокирован' },
  { code: 'forbidden', status: 403, desc: 'Ключи выдаются владельцу аккаунта, не сотруднику' },
  { code: 'not_found', status: 404, desc: 'Записи с таким идентификатором нет' },
  { code: 'validation_error', status: 422, desc: 'Поля запроса не прошли проверку — подробности в details' },
  { code: 'conflict', status: 409, desc: 'Переплата, связанные записи или повтор Idempotency-Key с другим телом' },
  { code: 'limit_reached', status: 403, desc: 'Достигнут лимит договоров по тарифу' },
  { code: 'rate_limited', status: 429, desc: 'Слишком много запросов' },
  { code: 'internal_error', status: 500, desc: 'Ошибка на нашей стороне — сообщите requestId в поддержку' },
];

const METHOD_TONE: Record<string, string> = {
  GET: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  POST: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  PATCH: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  DELETE: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
};

const Code: React.FC<{ children: string; label?: string }> = ({ children, label }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* буфер недоступен — текст виден целиком, его можно выделить */ }
  };
  return (
    <div className="relative group">
      {label && <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">{label}</p>}
      <pre className="overflow-x-auto rounded-xl bg-slate-900 text-slate-100 text-[12.5px] leading-relaxed p-4 border border-slate-800">
        <code>{children}</code>
      </pre>
      <button
        onClick={copy}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-[11px] font-bold bg-slate-700 hover:bg-slate-600 text-white rounded-lg px-2 py-1"
      >
        {copied ? 'Скопировано' : 'Копировать'}
      </button>
    </div>
  );
};

const ParamTable: React.FC<{ title: string; rows: Param[] }> = ({ title, rows }) => (
  <div className="mt-4">
    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">{title}</p>
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <tbody>
          {rows.map(r => (
            <tr key={r.name} className="border-b border-slate-200 dark:border-slate-700 last:border-0 align-top">
              <td className="py-2 pr-3 font-mono text-[12.5px] text-slate-800 dark:text-slate-100 whitespace-nowrap">
                {r.name}
                {r.required && <span className="ml-1 text-rose-500" title="обязательное">*</span>}
              </td>
              <td className="py-2 pr-3 text-[12px] text-slate-400 whitespace-nowrap">{r.type}</td>
              <td className="py-2 text-slate-600 dark:text-slate-300">{r.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const EndpointCard: React.FC<{ e: Endpoint }> = ({ e }) => (
  <article className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-5 sm:p-6">
    <div className="flex flex-wrap items-center gap-2">
      <span className={`text-[11px] font-black px-2 py-1 rounded-lg ${METHOD_TONE[e.method]}`}>{e.method}</span>
      <code className="text-sm font-mono text-slate-800 dark:text-slate-100 break-all">{e.path}</code>
      <span className="text-[11px] text-slate-400 ml-auto">право: {e.scope === 'write' ? 'запись' : 'чтение'}</span>
    </div>
    <h4 className="mt-3 font-bold text-slate-900 dark:text-white">{e.title}</h4>
    {e.desc && <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{e.desc}</p>}
    {e.params && <ParamTable title="Параметры запроса" rows={e.params} />}
    {e.body && <ParamTable title="Поля тела" rows={e.body} />}
    {e.example && <div className="mt-4"><Code label="Пример">{e.example}</Code></div>}
    {e.response && <div className="mt-3"><Code label="Ответ">{e.response}</Code></div>}
  </article>
);

const Section: React.FC<{ id: string; title: string; children: React.ReactNode }> = ({ id, title, children }) => (
  <section id={id} className="scroll-mt-24">
    <h2 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">{title}</h2>
    <div className="mt-4 space-y-4">{children}</div>
  </section>
);

const P: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-[15px] leading-relaxed text-slate-600 dark:text-slate-300">{children}</p>
);

const ApiDocs: React.FC = () => {
  const nav = [
    { id: 'start', title: 'С чего начать' },
    { id: 'auth', title: 'Ключ и права' },
    { id: 'format', title: 'Формат ответов' },
    { id: 'errors', title: 'Ошибки' },
    { id: 'paging', title: 'Постраничный вывод' },
    { id: 'limits', title: 'Ограничения частоты' },
    { id: 'idempotency', title: 'Повторы запросов' },
    { id: 'security', title: 'Безопасность' },
    { id: 'assistant', title: 'Подключить помощника' },
    ...GROUPS.map(g => ({ id: g.id, title: g.title })),
    { id: 'recipes', title: 'Готовые сценарии' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <header className="sticky top-0 z-30 backdrop-blur bg-white/80 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between gap-4">
          <a href="/" className="font-black text-slate-900 dark:text-white">FinUchet<span className="text-indigo-600"> API</span></a>
          <div className="flex items-center gap-4 text-sm">
            <a href="/api/v1/openapi.json" className="text-slate-500 dark:text-slate-400 hover:text-indigo-600 hidden sm:inline">OpenAPI</a>
            <a href="/" className="font-bold text-indigo-600 dark:text-indigo-400">На сайт</a>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-5 py-10 flex gap-10">
        <aside className="hidden lg:block w-56 shrink-0">
          <nav className="sticky top-20 space-y-1">
            {nav.map(n => (
              <a key={n.id} href={`#${n.id}`}
                 className="block text-sm text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 py-1">
                {n.title}
              </a>
            ))}
          </nav>
        </aside>

        <main className="flex-1 min-w-0 space-y-14">
          <div>
            <h1 className="text-4xl sm:text-5xl font-black text-slate-900 dark:text-white leading-tight">
              API FinUchet
            </h1>
            <p className="mt-4 text-lg text-slate-600 dark:text-slate-300 leading-relaxed">
              Доступ к своим данным из любой программы: сайт заводит клиента, бот принимает платёж,
              1С забирает договоры, а отчёт собирается сам каждую ночь. Всё, что делает приложение
              с деньгами, доступно и по ключу.
            </p>
            <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-2.5">
              Доступно на тарифах Бизнес и Бизнес&nbsp;Pro
            </div>
          </div>

          <Section id="start" title="С чего начать">
            <P>Три шага до первого запроса.</P>
            <ol className="space-y-3 text-[15px] text-slate-600 dark:text-slate-300">
              <li><b className="text-slate-900 dark:text-white">1.</b> В приложении откройте «Настройки → Интеграции → API-ключи» и создайте ключ. Выберите права: только чтение или чтение и запись.</li>
              <li><b className="text-slate-900 dark:text-white">2.</b> Скопируйте ключ сразу — он показывается один раз. У нас хранится только его отпечаток, восстановить ключ нельзя.</li>
              <li><b className="text-slate-900 dark:text-white">3.</b> Проверьте его запросом ниже: он вернёт ваш аккаунт, тариф и лимиты.</li>
            </ol>
            <Code label="Проверка ключа">{`curl ${BASE}/me \\
  -H "Authorization: Bearer sk_live_ВАШ_КЛЮЧ"`}</Code>
            <P>Все адреса начинаются с <code className="font-mono text-[13px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">{BASE}</code>. Номер версии в адресе меняется только при несовместимых изменениях — v1 продолжит работать.</P>
          </Section>

          <Section id="auth" title="Ключ и права">
            <P>Ключ передаётся заголовком <code className="font-mono text-[13px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">Authorization: Bearer sk_live_…</code>. Ключи, выданные раньше, продолжают работать и через заголовок <code className="font-mono text-[13px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">x-api-key</code>.</P>
            <P>У ключа два набора прав. <b>Только чтение</b> — выгрузка данных, ничего изменить нельзя: такой ключ спокойно отдают в отчёты, витрину или бота, который только показывает остаток долга. <b>Чтение и запись</b> — плюс создание клиентов, договоров, платежей и расходов. Запрос на запись ключом с правом чтения получает 403 и код <code className="font-mono text-[13px]">insufficient_scope</code>.</P>
            <P>Ключ принадлежит владельцу аккаунта. Сотрудникам и инвесторам ключи не выдаются: в приложении их доступ ограничен своими записями и разрешёнными счетами, а API таких ограничений не делает.</P>
          </Section>

          <Section id="format" title="Формат ответов">
            <P>Успешный ответ всегда объект. Одна запись лежит в <code className="font-mono text-[13px]">data</code>, список — в <code className="font-mono text-[13px]">data</code> плюс <code className="font-mono text-[13px]">meta</code> со сведениями о странице.</P>
            <Code>{`{ "data": { … } }

{ "data": [ … ], "meta": { "total": 137, "limit": 50, "offset": 0, "hasMore": true } }`}</Code>
            <P>Деньги — числа с двумя знаками после запятой, без разделителей и знака валюты. Даты — ISO: <code className="font-mono text-[13px]">2026-09-24</code> или полное время с часовым поясом. Создание отвечает кодом 201 и заголовком <code className="font-mono text-[13px]">Location</code>, удаление — 204 без тела.</P>
            <P>В каждом ответе есть заголовок <code className="font-mono text-[13px]">X-Request-Id</code>. Сохраняйте его в своём журнале: по нему мы находим запрос в поддержке.</P>
          </Section>

          <Section id="errors" title="Ошибки">
            <P>У ошибки всегда одинаковая форма: машинный код для обработки и текст для человека. У проверки полей в <code className="font-mono text-[13px]">details</code> перечислено, что именно не так.</P>
            <Code>{`{
  "error": {
    "code": "validation_error",
    "message": "Проверьте поля запроса.",
    "details": [
      { "field": "amount", "code": "min", "message": "не меньше 0.01" },
      { "field": "amout", "code": "unknown_field", "message": "неизвестное поле" }
    ]
  },
  "requestId": "0f2c…"
}`}</Code>
            <P>Неизвестное поле — это ошибка, а не мелочь: опечатка в названии иначе тихо потерялась бы, и человек искал бы пропавшие деньги.</P>
            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 dark:bg-slate-800">
                  <tr>
                    <th className="text-left font-bold text-slate-600 dark:text-slate-300 px-4 py-2.5">Код</th>
                    <th className="text-left font-bold text-slate-600 dark:text-slate-300 px-4 py-2.5">HTTP</th>
                    <th className="text-left font-bold text-slate-600 dark:text-slate-300 px-4 py-2.5">Когда</th>
                  </tr>
                </thead>
                <tbody>
                  {ERRORS.map(e => (
                    <tr key={e.code} className="border-t border-slate-200 dark:border-slate-700">
                      <td className="px-4 py-2.5 font-mono text-[12.5px] text-slate-800 dark:text-slate-100 whitespace-nowrap">{e.code}</td>
                      <td className="px-4 py-2.5 text-slate-500">{e.status}</td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{e.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="paging" title="Постраничный вывод">
            <P>Списки возвращают 50 записей за раз, максимум 200. Следующая страница — увеличением <code className="font-mono text-[13px]">offset</code>. Когда <code className="font-mono text-[13px]">meta.hasMore</code> становится false, данные кончились.</P>
            <Code>{`curl "${BASE}/contracts?limit=200&offset=0" -H "Authorization: Bearer sk_live_…"
curl "${BASE}/contracts?limit=200&offset=200" -H "Authorization: Bearer sk_live_…"`}</Code>
          </Section>

          <Section id="limits" title="Ограничения частоты">
            <P>120 запросов в минуту и 20 000 в сутки на ключ. Счёт идёт по ключу, а не по адресу: несколько программ с одного сервера друг другу не мешают, если у каждой свой ключ.</P>
            <P>При превышении — код 429 и заголовок <code className="font-mono text-[13px]">Retry-After</code> с числом секунд. Правильная реакция — подождать указанное время и повторить, а не слать запрос заново сразу.</P>
            <P>Для ночных выгрузок берите <code className="font-mono text-[13px]">limit=200</code>: 20 000 договоров укладываются в сотню запросов.</P>
          </Section>

          <Section id="idempotency" title="Повторы запросов">
            <P>Сеть рвётся посреди запроса чаще, чем кажется: ответ не дошёл, программа повторила — и в кассе два одинаковых платежа. Чтобы этого не случилось, передавайте в создающих запросах заголовок <code className="font-mono text-[13px]">Idempotency-Key</code> — любую строку, уникальную для этой операции.</P>
            <Code>{`curl -X POST ${BASE}/payments \\
  -H "Authorization: Bearer sk_live_…" \\
  -H "Idempotency-Key: payment-2026-09-24-0001" \\
  -H "Content-Type: application/json" \\
  -d '{"contractId":"sale_…","amount":20000}'`}</Code>
            <P>Повтор с тем же ключом в течение суток вернёт тот же ответ и заголовок <code className="font-mono text-[13px]">Idempotent-Replay: true</code>, ничего не создавая. Тот же ключ с другим телом — ошибка 409: это почти всегда ошибка в программе.</P>
          </Section>

          <Section id="security" title="Безопасность">
            <P><b>Ключ — это пароль от ваших денег.</b> Держите его на сервере, в переменной окружения или в хранилище секретов. Не кладите в код на сайте, в мобильное приложение и в репозиторий: всё, что попало в браузер, можно прочитать.</P>
            <P><b>Давайте минимум прав.</b> Если программа только показывает данные — ключ «только чтение». Отдельная программа — отдельный ключ: тогда при утечке отзывается один, а не все.</P>
            <P><b>Ключ утёк — отзовите его</b> в «Настройки → Интеграции → API-ключи». Отзыв действует сразу; создайте новый и подставьте его в программу. Мы храним только отпечаток ключа, поэтому подсказать «какой это был ключ» не сможем — ориентируйтесь на название и первые символы.</P>
            <P><b>Что мы делаем со своей стороны:</b> ключ хранится хешем, а не открытым текстом; обращения по ключу записываются в журнал; неудачные попытки авторизации с одного адреса ограничены; заблокированный аккаунт и истёкшая подписка закрывают доступ так же, как в приложении.</P>
            <P>Запросы принимаются только по HTTPS. Данные клиентов — персональные данные: передавая их в свою систему, вы отвечаете за их хранение по 152-ФЗ.</P>
          </Section>

          <Section id="assistant" title="Подключить помощника (ChatGPT)">
            <P>
              Помощнику не нужен отдельный «плагин»: он читает то же описание API, что и любая
              другая программа, и сам решает, какой запрос сделать. Вопрос «покажи просрочки»
              превращается в запрос списка договоров с признаком просрочки.
            </P>
            <ol className="space-y-3 text-[15px] text-slate-600 dark:text-slate-300">
              <li><b className="text-slate-900 dark:text-white">1.</b> В ChatGPT создайте своего GPT (нужна платная подписка) и откройте «Configure → Actions → Create new action».</li>
              <li><b className="text-slate-900 dark:text-white">2.</b> Нажмите «Import from URL» и вставьте адрес описания:</li>
            </ol>
            <Code>{`https://rassrochka.pro/api/v1/openapi.json`}</Code>
            <ol start={3} className="space-y-3 text-[15px] text-slate-600 dark:text-slate-300">
              <li><b className="text-slate-900 dark:text-white">3.</b> В «Authentication» выберите «API Key», тип «Bearer» и вставьте свой ключ — он передаётся тем же заголовком, что и в обычных запросах.</li>
              <li><b className="text-slate-900 dark:text-white">4.</b> Проверьте в предпросмотре: «покажи просроченные договоры», «сколько собрали за сентябрь», «остаток по кассе».</li>
            </ol>
            <P>
              <b>Берите ключ «только чтение».</b> Помощник ошибается в выборе действия чаще, чем
              человек, и ключ с записью однажды заведёт лишний договор или проведёт платёж, которого
              не было. Для вопросов о делах чтения достаточно.
            </P>
            <P>
              <b>Помните, куда уходят данные.</b> В ответах есть имена, телефоны и паспортные данные
              ваших покупателей, а помощник — зарубежный сервис: это передача персональных данных за
              границу, и отвечаете за неё вы. Если такой задачи нет, спрашивайте только сводки
              (<code className="font-mono text-[13px]">/reports/summary</code>) — там цифры без людей.
            </P>
            <P>
              Тот же порядок подходит любому помощнику, который умеет работать по описанию OpenAPI.
            </P>

            <h3 className="text-lg font-bold text-slate-900 dark:text-white pt-2">Помощник по MCP</h3>
            <P>
              Помощники, которые подключаются не схемой, а протоколом MCP, ждут один адрес:
            </P>
            <Code>{`https://rassrochka.pro/mcp`}</Code>
            <P>
              Больше от вас ничего не нужно: помощник сам найдёт, где авторизоваться, при
              необходимости зарегистрируется и отправит человека на страницу входа FinUchet.
              Дальше он видит готовые умения — «просроченные договоры», «договор с графиком»,
              «полученные платежи», «счета и остатки», «расходы», «товары и остатки»,
              «инвесторы», «сводка по деньгам». С правом «запись» добавляются «принять платёж»,
              «завести клиента», «записать расход» и «записать приход».
            </P>
            <P>
              Под капотом это те же маршруты, что описаны ниже: одинаковые проверки полей, права,
              ограничения частоты и журнал. Ключ на чтение и здесь не даст ничего изменить — такие
              умения помощнику просто не показываются.
            </P>

            <h3 className="text-lg font-bold text-slate-900 dark:text-white pt-2">Вход «Через FinUchet» — для готового помощника</h3>
            <P>
              Ключ подходит, когда помощник ваш собственный. Если помощника делают для многих
              компаний сразу, ключ в него не вложить: он был бы один на всех. Тогда помощник
              отправляет человека на нашу страницу входа, тот подтверждает доступ, и помощник
              получает личный токен этого аккаунта.
            </P>
            <P>Адреса для настроек такого помощника:</P>
            <Code>{`страница входа   https://rassrochka.pro/oauth/authorize
обмен токенов    https://rassrochka.pro/api/oauth/token
права            read  или  read write`}</Code>
            <P>
              Порядок обычный: код авторизации с проверочной строкой (PKCE, S256). Код живёт
              5 минут и годится один раз, токен доступа — час, обновляется по refresh_token.
              Пара «идентификатор и секрет» выдаётся владельцем сервиса — напишите в поддержку.
            </P>
            <P>
              Пользователю ничего настраивать не нужно: он нажимает «Войти» внутри помощника.
              Все выданные разрешения видны в приложении — «Настройки → Интеграции → Подключённые
              помощники», там же их отключают одним нажатием.
            </P>
          </Section>

          {GROUPS.map(g => (
            <Section key={g.id} id={g.id} title={g.title}>
              {g.note && <P>{g.note}</P>}
              <div className="space-y-4">
                {g.endpoints.map(e => <EndpointCard key={`${e.method}${e.path}`} e={e} />)}
              </div>
            </Section>
          ))}

          <Section id="recipes" title="Готовые сценарии">
            <P><b>Заявка с сайта превращается в договор.</b> Создаём клиента, берём его id, оформляем договор — график построится сам.</P>
            <Code>{`# 1. клиент
CUSTOMER=$(curl -s -X POST ${BASE}/customers \\
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"name":"Иванов Иван","phone":"+79000000000"}' | jq -r .data.id)

# 2. договор на 6 месяцев
curl -X POST ${BASE}/contracts \\
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d "{\\"customerId\\":\\"$CUSTOMER\\",\\"accountId\\":\\"acc_main\\",\\"productName\\":\\"Телефон\\",
       \\"totalAmount\\":90000,\\"buyPrice\\":60000,\\"downPayment\\":15000,\\"installments\\":6,\\"paymentDay\\":10}"`}</Code>
            <P><b>Бот принимает платёж.</b> Ключ Idempotency-Key берём из идентификатора сообщения — повтор не создаст второй платёж.</P>
            <Code>{`curl -X POST ${BASE}/payments \\
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -H "Idempotency-Key: tg-message-84712" \\
  -d '{"contractId":"sale_…","amount":15000,"note":"Оплата через бота"}'`}</Code>
            <P><b>Ночная выгрузка должников.</b> Один запрос — и список тех, кому пора звонить.</P>
            <Code>{`curl -s "${BASE}/contracts?overdue=true&limit=200" \\
  -H "Authorization: Bearer $KEY" \\
  | jq -r '.data[] | [.customerId, .productName, .overdueAmount] | @tsv'`}</Code>
          </Section>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-6">
            <h3 className="font-bold text-slate-900 dark:text-white">Не получается?</h3>
            <p className="mt-2 text-[15px] text-slate-600 dark:text-slate-300 leading-relaxed">
              Напишите в поддержку прямо из приложения и приложите <code className="font-mono text-[13px]">X-Request-Id</code> из ответа —
              по нему видно, что именно пришло на сервер. Машиночитаемое описание всех маршрутов:{' '}
              <a href="/api/v1/openapi.json" className="text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">openapi.json</a>.
            </p>
          </div>
        </main>
      </div>

      <footer className="border-t border-slate-200 dark:border-slate-800 py-8 text-center text-sm text-slate-400">
        FinUchet · <a href="/" className="hover:text-indigo-600">rassrochka.pro</a>
      </footer>
    </div>
  );
};

export default ApiDocs;
