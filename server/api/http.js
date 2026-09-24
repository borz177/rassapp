// Единый вид ответов и ошибок публичного API.
//
// Раньше каждый маршрут отвечал по-своему: то массив, то объект, ошибка —
// {msg: 'Server Error'} без кода. Интеграции на таком писать нельзя: клиенту
// приходится разбирать текст сообщения. Здесь один формат на все маршруты:
//   успех-список  → { data: [...], meta: {...} }
//   успех-объект  → { data: {...} }
//   ошибка        → { error: { code, message, details? }, requestId }
// Коды ошибок — латиницей и стабильные (по ним пишут обработку),
// message — по-русски, для человека в логе интеграции.

const { randomUUID } = require('crypto');

const CODES = {
  UNAUTHORIZED: 'unauthorized',
  INVALID_KEY: 'invalid_api_key',
  KEY_REVOKED: 'api_key_revoked',
  FORBIDDEN: 'forbidden',
  SCOPE_REQUIRED: 'insufficient_scope',
  PLAN_REQUIRED: 'plan_required',
  SUBSCRIPTION_EXPIRED: 'subscription_expired',
  ACCOUNT_BLOCKED: 'account_blocked',
  NOT_FOUND: 'not_found',
  VALIDATION: 'validation_error',
  CONFLICT: 'conflict',
  LIMIT_REACHED: 'limit_reached',
  RATE_LIMITED: 'rate_limited',
  PAYLOAD_TOO_LARGE: 'payload_too_large',
  INTERNAL: 'internal_error',
};

// Идентификатор запроса виден и в ответе, и в журнале — по нему разбирают
// обращение в поддержку, не прося «пришлите скриншот».
const requestId = (req, res, next) => {
  req.apiRequestId = req.header('x-request-id')?.slice(0, 64) || randomUUID();
  res.setHeader('X-Request-Id', req.apiRequestId);
  next();
};

const ok = (res, data, meta) => res.json(meta ? { data, meta } : { data });

const created = (res, data, location) => {
  if (location) res.setHeader('Location', location);
  return res.status(201).json({ data });
};

const noContent = res => res.status(204).end();

const fail = (res, status, code, message, details) => {
  const body = { error: { code, message }, requestId: res.req?.apiRequestId };
  if (details) body.error.details = details;
  return res.status(status).json(body);
};

// Оборачивает обработчик: любая необработанная ошибка превращается в 500 с кодом
// и попадает в лог вместе с идентификатором запроса, а не роняет процесс.
const route = handler => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (err) {
    console.error(`[api] ${req.method} ${req.originalUrl} ${req.apiRequestId}:`, err);
    if (res.headersSent) return;
    fail(res, 500, CODES.INTERNAL, 'Внутренняя ошибка сервера. Повторите запрос позже.');
  }
};

// Пагинация: одинаковая у всех списков. limit по умолчанию 50, потолок 200 —
// иначе выгрузка тысяч договоров одним запросом кладёт и сервер, и клиента.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const readPaging = query => {
  const limitRaw = query.limit === undefined ? DEFAULT_LIMIT : Number(query.limit);
  const offsetRaw = query.offset === undefined ? 0 : Number(query.offset);
  const errors = [];
  if (!Number.isFinite(limitRaw) || limitRaw < 1 || limitRaw > MAX_LIMIT) {
    errors.push({ field: 'limit', code: 'out_of_range', message: `limit — целое от 1 до ${MAX_LIMIT}` });
  }
  if (!Number.isFinite(offsetRaw) || offsetRaw < 0) {
    errors.push({ field: 'offset', code: 'out_of_range', message: 'offset — целое от 0' });
  }
  return { limit: Math.trunc(limitRaw), offset: Math.trunc(offsetRaw), errors };
};

// Срез списка + мета. Списки лежат в jsonb, поэтому режем в памяти: у самого
// крупного пользователя 377 договоров — это дешевле, чем усложнять запросы.
const paginate = (items, { limit, offset }) => ({
  page: items.slice(offset, offset + limit),
  meta: { total: items.length, limit, offset, hasMore: offset + limit < items.length },
});

module.exports = { CODES, requestId, ok, created, noContent, fail, route, readPaging, paginate, DEFAULT_LIMIT, MAX_LIMIT };
