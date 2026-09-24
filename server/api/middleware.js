// Повторы запросов и журнал обращений.

const crypto = require('crypto');
const { CODES, fail } = require('./http');

const IDEMPOTENCY_TTL_HOURS = 24;

/**
 * Идемпотентность создающих запросов.
 *
 * Сеть рвётся посреди запроса чаще, чем кажется: клиент не дождался ответа,
 * повторил — и в кассе два одинаковых платежа. Если клиент прислал заголовок
 * Idempotency-Key, первый ответ запоминается на сутки и повторный запрос
 * получает его же, ничего не создавая. Тот же ключ с другим телом — 409:
 * это почти всегда ошибка на стороне интеграции.
 */
const makeIdempotency = pool => async (req, res, next) => {
  const key = req.header('idempotency-key');
  if (!key) return next();
  if (key.length > 200) {
    return fail(res, 400, CODES.VALIDATION, 'Idempotency-Key длиннее 200 символов.');
  }

  const userId = req.apiAuth.userId;
  const endpoint = `${req.method} ${req.baseUrl}${req.path}`;
  const requestHash = crypto.createHash('sha256')
    .update(endpoint + JSON.stringify(req.body ?? null)).digest('hex');

  const { rows } = await pool.query(
    `SELECT endpoint, request_hash, status, response FROM api_idempotency
     WHERE user_id = $1 AND key = $2 AND created_at > NOW() - INTERVAL '${IDEMPOTENCY_TTL_HOURS} hours'`,
    [userId, key]
  );
  const saved = rows[0];
  if (saved) {
    if (saved.request_hash !== requestHash) {
      return fail(res, 409, CODES.CONFLICT,
        'Этот Idempotency-Key уже использован с другим телом запроса. Для нового запроса возьмите новый ключ.');
    }
    res.setHeader('Idempotent-Replay', 'true');
    return res.status(saved.status).json(saved.response);
  }

  // Перехватываем ответ, чтобы запомнить удачный результат.
  const originalJson = res.json.bind(res);
  res.json = body => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      pool.query(
        `INSERT INTO api_idempotency (user_id, key, endpoint, request_hash, status, response)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, key) DO NOTHING`,
        [userId, key, endpoint, requestHash, res.statusCode, JSON.stringify(body)]
      ).catch(e => console.error('❌ idempotency save:', e.message));
    }
    return originalJson(body);
  };
  next();
};

// Журнал обращений: кто, куда, с каким кодом и сколько миллисекунд. По нему
// видно и перебор ключей, и сломанную интеграцию, которая молотит в 500.
const makeRequestLog = pool => (req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    pool.query(
      `INSERT INTO api_request_log (key_id, user_id, method, path, status, duration_ms, ip, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        req.apiAuth?.key?.id || null,
        req.apiAuth?.userId || null,
        req.method,
        `${req.baseUrl}${req.path}`.slice(0, 200),
        res.statusCode,
        Date.now() - started,
        String(req.ip || '').slice(0, 45),
        req.apiRequestId || null,
      ]
    ).catch(e => console.error('❌ api log:', e.message));
  });
  next();
};

// Чистка: ответы идемпотентности живут сутки, журнал — месяц.
const cleanupApiTables = async pool => {
  try {
    await pool.query(`DELETE FROM api_idempotency WHERE created_at < NOW() - INTERVAL '${IDEMPOTENCY_TTL_HOURS} hours'`);
    await pool.query(`DELETE FROM api_request_log WHERE created_at < NOW() - INTERVAL '30 days'`);
  } catch (e) {
    console.error('❌ cleanupApiTables:', e.message);
  }
};

module.exports = { makeIdempotency, makeRequestLog, cleanupApiTables, IDEMPOTENCY_TTL_HOURS };
