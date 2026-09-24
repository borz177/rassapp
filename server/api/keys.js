// Хранение и проверка API-ключей.
//
// Ключ больше не лежит в базе открытым текстом. В users.api_key он хранился как
// есть: любой дамп базы или доступ админа к таблице — это готовые рабочие ключи
// всех клиентов. Теперь в базе только SHA-256 от ключа и первые символы для
// показа в списке, а сам ключ виден один раз — в ответе на создание.
//
// SHA-256, а не bcrypt: ключ — это 240 случайных бит, перебирать там нечего,
// а bcrypt пришлось бы считать на каждый запрос к API.

const crypto = require('crypto');

const KEY_PREFIX = 'sk_live_';
const PREFIX_SHOWN = 16; // sk_live_ + 8 символов — столько видно в списке ключей

const hashKey = raw => crypto.createHash('sha256').update(String(raw)).digest('hex');

const generateKey = () => {
  const raw = KEY_PREFIX + crypto.randomBytes(30).toString('base64url');
  return { raw, hash: hashKey(raw), prefix: raw.slice(0, PREFIX_SHOWN) };
};

const SCOPES = ['read', 'write'];

const ensureApiTables = async pool => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'Ключ',
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      scopes TEXT[] NOT NULL DEFAULT ARRAY['read']::TEXT[],
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT,
      last_used_at TIMESTAMP,
      last_used_ip TEXT,
      requests_total BIGINT NOT NULL DEFAULT 0,
      revoked_at TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
  `);

  // Ответы на повторённые POST. Повтор после таймаута сети не должен создавать
  // второй платёж — клиент присылает Idempotency-Key, и мы отдаём тот же ответ.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_idempotency (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      status INT NOT NULL,
      response JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, key)
    );
    CREATE INDEX IF NOT EXISTS idx_api_idem_created ON api_idempotency(created_at);
  `);

  // Журнал обращений: по нему видно, кто и что дёргает, и видно перебор ключей.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_request_log (
      id BIGSERIAL PRIMARY KEY,
      key_id TEXT,
      user_id TEXT,
      method TEXT,
      path TEXT,
      status INT,
      duration_ms INT,
      ip TEXT,
      request_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_api_log_created ON api_request_log(created_at);
  `);

  await migratePlainKeys(pool);
};

// Переносим ключи, выданные до этой правки: хеш кладём в api_keys, открытое
// значение из users стираем. Ключи у клиентов при этом продолжают работать —
// в этом и смысл переноса, а не выдачи новых.
const migratePlainKeys = async pool => {
  // Колонки может не быть вовсе: на чистой установке таблицы создаются параллельно,
  // а когда-нибудь её просто уберут. Отсутствие колонки — не ошибка, переносить нечего.
  const column = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'api_key'`);
  if (!column.rows.length) return;

  const { rows } = await pool.query(`SELECT id, api_key FROM users WHERE api_key IS NOT NULL AND api_key <> ''`);
  for (const row of rows) {
    const hash = hashKey(row.api_key);
    await pool.query(
      `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, scopes, created_by)
       VALUES ($1, $2, $3, $4, $5, ARRAY['read','write']::TEXT[], $2)
       ON CONFLICT (key_hash) DO NOTHING`,
      [`key_${crypto.randomUUID()}`, row.id, 'Ключ, выданный ранее', hash, String(row.api_key).slice(0, PREFIX_SHOWN)]
    );
    await pool.query(`UPDATE users SET api_key = NULL WHERE id = $1`, [row.id]);
  }
  if (rows.length) console.log(`🔑 Перенесено ключей в api_keys: ${rows.length}`);
};

const listKeys = async (pool, userId) => {
  const { rows } = await pool.query(
    `SELECT id, name, key_prefix, scopes, created_at, last_used_at, requests_total, revoked_at
     FROM api_keys WHERE user_id = $1 ORDER BY revoked_at NULLS FIRST, created_at DESC`,
    [userId]
  );
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    prefix: r.key_prefix,
    scopes: r.scopes,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    requestsTotal: Number(r.requests_total) || 0,
    revokedAt: r.revoked_at,
  }));
};

const MAX_ACTIVE_KEYS = 10;

const createKey = async (pool, { userId, name, scopes, createdBy }) => {
  const active = await pool.query(`SELECT COUNT(*)::int AS n FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
  if (active.rows[0].n >= MAX_ACTIVE_KEYS) {
    return { error: 'too_many', message: `Больше ${MAX_ACTIVE_KEYS} активных ключей на аккаунт не бывает. Отзовите неиспользуемые.` };
  }
  const key = generateKey();
  const id = `key_${crypto.randomUUID()}`;
  const safeScopes = (Array.isArray(scopes) ? scopes : ['read']).filter(s => SCOPES.includes(s));
  await pool.query(
    `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, scopes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::TEXT[], $7)`,
    [id, userId, (name || 'Ключ').slice(0, 60), key.hash, key.prefix, safeScopes.length ? safeScopes : ['read'], createdBy || userId]
  );
  return { id, key: key.raw, prefix: key.prefix, scopes: safeScopes.length ? safeScopes : ['read'], name: name || 'Ключ' };
};

const revokeKey = async (pool, { userId, keyId }) => {
  const { rowCount } = await pool.query(
    `UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [keyId, userId]
  );
  return rowCount > 0;
};

const findByRawKey = async (pool, raw) => {
  const { rows } = await pool.query(`SELECT * FROM api_keys WHERE key_hash = $1`, [hashKey(raw)]);
  return rows[0] || null;
};

// Отметка об использовании. Пишем не чаще раза в минуту: иначе каждый запрос к
// API превращался бы ещё и в запись в базу.
const TOUCH_EVERY_MS = 60_000;
const touched = new Map();

const touchKey = async (pool, keyRow, ip) => {
  const last = touched.get(keyRow.id) || 0;
  const now = Date.now();
  if (now - last < TOUCH_EVERY_MS) return;
  touched.set(keyRow.id, now);
  try {
    await pool.query(
      `UPDATE api_keys SET last_used_at = NOW(), last_used_ip = $2,
         requests_total = requests_total + $3 WHERE id = $1`,
      [keyRow.id, String(ip || '').slice(0, 45), 1]
    );
  } catch (e) {
    console.error('❌ touchKey:', e.message);
  }
};

module.exports = {
  KEY_PREFIX, SCOPES, MAX_ACTIVE_KEYS,
  hashKey, generateKey, ensureApiTables, migratePlainKeys,
  listKeys, createKey, revokeKey, findByRawKey, touchKey,
};
