// Вход «Через FinUchet» для внешних помощников (OAuth 2.0).
//
// Зачем он, если есть API-ключи. Ключ выдаёт себе владелец аккаунта и вставляет
// в свою программу. Но в опубликованном помощнике — например, в GPT в магазине —
// ключ прописывает автор помощника, то есть мы, и он был бы один на всех
// клиентов. Чтобы каждый видел только своё, помощник отправляет человека на наш
// сайт, тот подтверждает доступ, и помощник получает личный токен.
//
// Сделано по обычному коду авторизации с PKCE:
//   1. помощник ведёт человека на /oauth/authorize (страница согласия);
//   2. человек подтверждает — выдаём одноразовый код на 5 минут;
//   3. помощник меняет код на токен на /api/oauth/token, предъявив секрет и
//      проверочную строку (code_verifier).
// Токены, коды и секреты хранятся хешем — как API-ключи: утёкший дамп базы не
// должен давать доступ к чужим данным.

const crypto = require('crypto');
const { CODES, fail } = require('./http');

const ACCESS_TTL_SEC = 60 * 60;             // час: помощник обновит сам
const REFRESH_TTL_DAYS = 90;                // столько живёт подключение без входа
const CODE_TTL_SEC = 5 * 60;

const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const randomToken = prefix => `${prefix}_${crypto.randomBytes(32).toString('base64url')}`;

const SCOPES = ['read', 'write'];
const SCOPE_TITLES = {
  read: 'Читать договоры, платежи, клиентов, кассу и отчёты',
  write: 'Заводить клиентов и договоры, проводить платежи и расходы',
};

const ensureOAuthTables = async pool => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      secret_hash TEXT NOT NULL,
      redirect_uris TEXT[] NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT,
      disabled_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS oauth_codes (
      code_hash TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      scopes TEXT[] NOT NULL,
      redirect_uri TEXT NOT NULL,
      code_challenge TEXT,
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS oauth_tokens (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      scopes TEXT[] NOT NULL,
      access_hash TEXT UNIQUE,
      refresh_hash TEXT UNIQUE,
      access_expires_at TIMESTAMP,
      refresh_expires_at TIMESTAMP,
      last_used_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      revoked_at TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user ON oauth_tokens(user_id);
  `);
};

// Чистка: просроченные коды и протухшие токены не должны копиться.
const cleanupOAuth = async pool => {
  try {
    await pool.query(`DELETE FROM oauth_codes WHERE expires_at < NOW() - INTERVAL '1 day'`);
    await pool.query(`DELETE FROM oauth_tokens WHERE refresh_expires_at < NOW() - INTERVAL '30 days'`);
  } catch (e) {
    console.error('❌ cleanupOAuth:', e.message);
  }
};

const createClient = async (pool, { name, redirectUris, createdBy }) => {
  const id = `cl_${crypto.randomBytes(12).toString('hex')}`;
  const secret = randomToken('cs');
  await pool.query(
    `INSERT INTO oauth_clients (id, name, secret_hash, redirect_uris, created_by)
     VALUES ($1, $2, $3, $4::TEXT[], $5)`,
    [id, (name || 'Помощник').slice(0, 80), sha256(secret), redirectUris, createdBy || null]
  );
  return { clientId: id, clientSecret: secret, name, redirectUris };
};

const listClients = async pool => {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.redirect_uris, c.created_at, c.disabled_at,
            (SELECT COUNT(*)::int FROM oauth_tokens t WHERE t.client_id = c.id AND t.revoked_at IS NULL) AS connections
     FROM oauth_clients c ORDER BY c.created_at DESC`
  );
  return rows.map(r => ({
    id: r.id, name: r.name, redirectUris: r.redirect_uris,
    createdAt: r.created_at, disabledAt: r.disabled_at, connections: r.connections,
  }));
};

// Подключения одного пользователя — для раздела «Подключённые приложения».
const listConnections = async (pool, userId) => {
  const { rows } = await pool.query(
    `SELECT t.id, t.scopes, t.created_at, t.last_used_at, c.name
     FROM oauth_tokens t JOIN oauth_clients c ON c.id = t.client_id
     WHERE t.user_id = $1 AND t.revoked_at IS NULL
     ORDER BY t.created_at DESC`,
    [userId]
  );
  return rows.map(r => ({
    id: r.id, app: r.name, scopes: r.scopes, createdAt: r.created_at, lastUsedAt: r.last_used_at,
  }));
};

const revokeConnection = async (pool, { userId, id }) => {
  const { rowCount } = await pool.query(
    `UPDATE oauth_tokens SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [id, userId]
  );
  return rowCount > 0;
};

// Токен доступа предъявляется тем же заголовком, что и ключ, поэтому проверка
// живёт рядом: см. makeApiKeyAuth в api/auth.js.
const findByAccessToken = async (pool, raw) => {
  const { rows } = await pool.query(
    `SELECT * FROM oauth_tokens WHERE access_hash = $1 AND revoked_at IS NULL`, [sha256(raw)]);
  const row = rows[0];
  if (!row) return null;
  if (row.access_expires_at && new Date(row.access_expires_at) < new Date()) return { expired: true };
  return row;
};

const issueTokens = async (pool, { clientId, userId, scopes, replaceTokenId }) => {
  const access = randomToken('fu_at');
  const refresh = randomToken('fu_rt');
  const id = replaceTokenId || `tok_${crypto.randomBytes(12).toString('hex')}`;
  const accessExpires = new Date(Date.now() + ACCESS_TTL_SEC * 1000);
  const refreshExpires = new Date(Date.now() + REFRESH_TTL_DAYS * 86400000);

  if (replaceTokenId) {
    // Обновление: старая пара перестаёт работать сразу — иначе украденный
    // refresh жил бы рядом с настоящим.
    await pool.query(
      `UPDATE oauth_tokens SET access_hash = $2, refresh_hash = $3,
        access_expires_at = $4, refresh_expires_at = $5, last_used_at = NOW()
       WHERE id = $1`,
      [id, sha256(access), sha256(refresh), accessExpires, refreshExpires]
    );
  } else {
    await pool.query(
      `INSERT INTO oauth_tokens (id, client_id, user_id, scopes, access_hash, refresh_hash, access_expires_at, refresh_expires_at)
       VALUES ($1, $2, $3, $4::TEXT[], $5, $6, $7, $8)`,
      [id, clientId, userId, scopes, sha256(access), sha256(refresh), accessExpires, refreshExpires]
    );
  }
  return { id, access, refresh, expiresIn: ACCESS_TTL_SEC };
};

const touchToken = async (pool, tokenId) => {
  try {
    await pool.query(`UPDATE oauth_tokens SET last_used_at = NOW() WHERE id = $1`, [tokenId]);
  } catch { /* отметка не важнее ответа */ }
};

module.exports = {
  SCOPES, SCOPE_TITLES, ACCESS_TTL_SEC, REFRESH_TTL_DAYS, CODE_TTL_SEC,
  sha256, randomToken, ensureOAuthTables, cleanupOAuth,
  createClient, listClients, listConnections, revokeConnection,
  findByAccessToken, issueTokens, touchToken,
};
