// Проверка ключа, прав и тарифа на входе в публичное API.
//
// Раньше проверялся только факт существования ключа: заблокированный аккаунт и
// аккаунт с истёкшей подпиской продолжали работать через API, хотя в приложение
// их не пускают. Здесь те же правила, что и в приложении, плюс права ключа.

const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const { CODES, fail } = require('./http');
const { findByRawKey, touchKey } = require('./keys');
const { findByAccessToken, touchToken } = require('./oauth');

// Ключ принимаем и как Authorization: Bearer, и как x-api-key.
// Bearer — то, к чему привыкли интеграторы; x-api-key оставлен ради ключей,
// выданных до этой правки, и документирован как запасной вариант.
const readKey = req => {
  const authHeader = req.header('authorization') || '';
  const bearer = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (bearer) return bearer[1].trim();
  const header = req.header('x-api-key');
  return header ? header.trim() : null;
};

/**
 * @param deps.pool
 * @param deps.getEffectivePlan   (subscription) => план с учётом срока
 * @param deps.planLimits         PLAN_LIMITS из index.js
 */
const makeApiKeyAuth = ({ pool, getEffectivePlan, planLimits }) => async (req, res, next) => {
  const raw = readKey(req);
  if (!raw) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="FinUchet API"');
    return fail(res, 401, CODES.UNAUTHORIZED,
      'Нужен API-ключ. Передайте его заголовком Authorization: Bearer <ключ>.');
  }

  // Заголовок один на два способа: постоянный ключ владельца (sk_live_…) и
  // временный токен помощника, полученный входом «Через FinUchet» (fu_at_…).
  const isAccessToken = raw.startsWith('fu_at_');
  let keyRow;
  if (isAccessToken) {
    const token = await findByAccessToken(pool, raw);
    if (!token) return fail(res, 401, CODES.INVALID_KEY, 'Подключение не найдено или отключено.');
    if (token.expired) {
      return fail(res, 401, CODES.INVALID_KEY, 'Срок действия токена истёк — обновите его по refresh_token.');
    }
    keyRow = {
      id: token.id, user_id: token.user_id, scopes: token.scopes,
      name: 'Подключённый помощник', key_prefix: 'oauth', isConnection: true,
    };
  } else {
    keyRow = await findByRawKey(pool, raw);
    if (!keyRow) return fail(res, 401, CODES.INVALID_KEY, 'Ключ не найден. Проверьте, что скопировали его целиком.');
    if (keyRow.revoked_at) return fail(res, 401, CODES.KEY_REVOKED, 'Этот ключ отозван. Создайте новый в настройках.');
  }

  const { rows } = await pool.query(
    `SELECT id, name, email, role, manager_id, subscription, blocked FROM users WHERE id = $1`,
    [keyRow.user_id]
  );
  const user = rows[0];
  if (!user) return fail(res, 401, CODES.INVALID_KEY, 'Владелец ключа не найден.');
  if (user.blocked) {
    return fail(res, 403, CODES.ACCOUNT_BLOCKED, 'Аккаунт заблокирован. Обратитесь в поддержку.');
  }

  // Ключи выдаются владельцу данных. Сотруднику и инвестору ключ не положен:
  // в приложении их доступ урезан (свои записи, разрешённые счета), а публичное
  // API таких срезов не делает — выдать им ключ значило бы открыть всё разом.
  if (user.role !== 'manager' && user.role !== 'admin') {
    return fail(res, 403, CODES.FORBIDDEN,
      'API доступно владельцу аккаунта. Сотрудникам и инвесторам ключи не выдаются.');
  }

  const subscription = typeof user.subscription === 'string' ? JSON.parse(user.subscription) : user.subscription;
  const effectivePlan = getEffectivePlan(subscription);
  const expired = !!subscription?.plan && effectivePlan !== subscription.plan;
  const allowed = user.role === 'admin' || !!planLimits?.[effectivePlan]?.api;
  if (!allowed) {
    return expired
      ? fail(res, 403, CODES.SUBSCRIPTION_EXPIRED, 'Срок действия подписки истёк — доступ к API приостановлен. Продлите тариф.')
      : fail(res, 403, CODES.PLAN_REQUIRED, 'API доступно на тарифах Бизнес и Бизнес PRO.', { plan: effectivePlan || null });
  }

  req.apiAuth = {
    key: keyRow,
    user,
    userId: user.id,
    scopes: keyRow.scopes || ['read'],
    plan: effectivePlan,
  };
  // Отметка о последнем обращении — без await: она не должна задерживать ответ.
  if (keyRow.isConnection) touchToken(pool, keyRow.id);
  else touchKey(pool, keyRow, req.ip);
  next();
};

// Право на запись отделено от чтения: ключ «только чтение» можно спокойно
// отдать в отчёты или в бота, не боясь, что он что-то испортит.
const requireScope = scope => (req, res, next) => {
  if (req.apiAuth?.scopes?.includes(scope)) return next();
  return fail(res, 403, CODES.SCOPE_REQUIRED,
    `Ключу не хватает права «${scope === 'write' ? 'запись' : 'чтение'}». Создайте ключ с нужными правами.`,
    { required: scope, granted: req.apiAuth?.scopes || [] });
};

const limitHandler = (req, res) => fail(res, 429, CODES.RATE_LIMITED,
  'Слишком много запросов. Подождите и повторите.',
  { retryAfterSeconds: Number(res.getHeader('Retry-After')) || undefined });

// Частота считается по ключу, а не по адресу: за одним адресом может стоять
// несколько клиентов, а один клиент — ходить с разных адресов. Для запросов без
// ключа падаем на адрес, но через ipKeyGenerator: он сводит IPv6 к подсети,
// иначе один клиент обходил бы лимит, меняя адрес внутри своего блока.
const keyOf = req => req.apiAuth?.key?.id || `ip:${ipKeyGenerator(req.ip)}`;

const perMinuteLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: keyOf,
  handler: limitHandler,
});

const perDayLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 20_000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: keyOf,
  handler: limitHandler,
});

// Отдельный заслон от перебора ключей: считаем только неудачные попытки,
// поэтому нормальной интеграции он никогда не мешает.
const authFailureLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: req => `ip:${ipKeyGenerator(req.ip)}`,
  handler: (req, res) => fail(res, 429, CODES.RATE_LIMITED,
    'Слишком много неудачных попыток авторизации. Повторите через 15 минут.'),
});

module.exports = { makeApiKeyAuth, requireScope, perMinuteLimiter, perDayLimiter, authFailureLimiter, readKey };
