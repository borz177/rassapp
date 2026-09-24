// Маршруты входа «Через FinUchet». Сам порядок и хранение — в api/oauth.js.
//
// Адреса, которые вписывают в помощника:
//   страница входа  https://rassrochka.pro/oauth/authorize
//   обмен токенов   https://rassrochka.pro/api/oauth/token
// Страницу входа рисует приложение, а сервер отдаёт ей сведения о помощнике и
// принимает подтверждение — иначе пришлось бы верстать вторую, чужую по виду.

const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const oauth = require('./oauth');

// Ответы этой части — по стандарту OAuth: { error, error_description }.
// Помощники разбирают именно такой вид, наш обычный конверт им незнаком.
const oauthError = (res, status, error, description) =>
  res.status(status).json({ error, error_description: description });

const tokenLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => oauthError(res, 429, 'temporarily_unavailable', 'Слишком много запросов, повторите позже.'),
});

const registerOAuthRoutes = (app, { pool, auth, adminAuth, getEffectivePlan, planLimits, logAdminAction }) => {
  // Секрет клиента приходит либо в теле, либо в заголовке Basic — поддерживаем оба:
  // конструкторы помощников пользуются то тем, то другим.
  const readClientCredentials = req => {
    const header = req.header('authorization') || '';
    const basic = /^Basic\s+(.+)$/i.exec(header.trim());
    if (basic) {
      const [id, secret] = Buffer.from(basic[1], 'base64').toString('utf8').split(':');
      return { clientId: id, clientSecret: secret };
    }
    return { clientId: req.body?.client_id, clientSecret: req.body?.client_secret };
  };

  const loadClient = async clientId => {
    if (!clientId) return null;
    const { rows } = await pool.query(
      `SELECT * FROM oauth_clients WHERE id = $1 AND disabled_at IS NULL`, [clientId]);
    return rows[0] || null;
  };

  const parseScopes = raw => {
    const asked = String(raw || 'read').split(/[\s,+]+/).filter(Boolean);
    const allowed = asked.filter(s => oauth.SCOPES.includes(s));
    return allowed.length ? [...new Set(allowed)] : ['read'];
  };

  // Доступ к API по подключению — по тем же правилам, что и по ключу.
  const userCanConnect = async user => {
    if (user.role === 'admin') return { allowed: true };
    if (user.role !== 'manager') {
      return { allowed: false, msg: 'Подключать помощника может только владелец аккаунта.' };
    }
    const { rows } = await pool.query(`SELECT subscription FROM users WHERE id = $1`, [user.id]);
    const sub = typeof rows[0]?.subscription === 'string' ? JSON.parse(rows[0].subscription) : rows[0]?.subscription;
    const plan = getEffectivePlan(sub);
    return planLimits?.[plan]?.api
      ? { allowed: true }
      : { allowed: false, msg: 'Подключение помощника доступно на тарифах Бизнес и Бизнес Pro.' };
  };

  // 1. Что за помощник и чего он просит — для страницы согласия.
  app.get('/api/oauth/authorize-info', auth, async (req, res) => {
    try {
      const client = await loadClient(req.query.client_id);
      if (!client) return oauthError(res, 400, 'invalid_client', 'Помощник не найден.');
      const redirectUri = String(req.query.redirect_uri || '');
      if (!client.redirect_uris.includes(redirectUri)) {
        return oauthError(res, 400, 'invalid_request', 'Адрес возврата не совпадает с зарегистрированным.');
      }
      const gate = await userCanConnect(req.user);
      const scopes = parseScopes(req.query.scope);
      res.json({
        app: { name: client.name },
        scopes: scopes.map(key => ({ key, title: oauth.SCOPE_TITLES[key] })),
        allowed: gate.allowed,
        reason: gate.msg || null,
      });
    } catch (e) {
      console.error('oauth authorize-info:', e);
      oauthError(res, 500, 'server_error', 'Не удалось подготовить подключение.');
    }
  });

  // 2. Человек подтвердил — выдаём одноразовый код.
  app.post('/api/oauth/authorize', auth, async (req, res) => {
    try {
      const { client_id, redirect_uri, scope, state, code_challenge, code_challenge_method } = req.body || {};
      const client = await loadClient(client_id);
      if (!client) return oauthError(res, 400, 'invalid_client', 'Помощник не найден.');
      if (!client.redirect_uris.includes(String(redirect_uri || ''))) {
        return oauthError(res, 400, 'invalid_request', 'Адрес возврата не совпадает с зарегистрированным.');
      }
      if (code_challenge && code_challenge_method && code_challenge_method !== 'S256') {
        return oauthError(res, 400, 'invalid_request', 'Поддерживается только code_challenge_method=S256.');
      }
      const gate = await userCanConnect(req.user);
      if (!gate.allowed) return oauthError(res, 403, 'access_denied', gate.msg);

      const scopes = parseScopes(scope);
      const code = oauth.randomToken('fu_ac');
      await pool.query(
        `INSERT INTO oauth_codes (code_hash, client_id, user_id, scopes, redirect_uri, code_challenge, expires_at)
         VALUES ($1, $2, $3, $4::TEXT[], $5, $6, NOW() + INTERVAL '${oauth.CODE_TTL_SEC} seconds')`,
        [oauth.sha256(code), client.id, req.user.id, scopes, redirect_uri, code_challenge || null]
      );

      const url = new URL(redirect_uri);
      url.searchParams.set('code', code);
      if (state) url.searchParams.set('state', state);
      res.json({ redirectTo: url.toString() });
    } catch (e) {
      console.error('oauth authorize:', e);
      oauthError(res, 500, 'server_error', 'Не удалось подтвердить подключение.');
    }
  });

  // 3. Обмен кода на токен и обновление токена. Тело приходит и формой, и JSON.
  app.post('/api/oauth/token', tokenLimiter,
    // Тело принимаем в обоих видах: стандарт требует форму, но часть клиентов
    // шлёт JSON, и отказывать им незачем.
    express.urlencoded({ extended: false }), express.json(),
    async (req, res) => {
    try {
      const { clientId, clientSecret } = readClientCredentials(req);
      const client = await loadClient(clientId);
      if (!client || oauth.sha256(clientSecret || '') !== client.secret_hash) {
        return oauthError(res, 401, 'invalid_client', 'Не сошёлся идентификатор или секрет помощника.');
      }

      const grant = req.body?.grant_type;

      if (grant === 'authorization_code') {
        const { code, redirect_uri, code_verifier } = req.body;
        const { rows } = await pool.query(
          `SELECT * FROM oauth_codes WHERE code_hash = $1`, [oauth.sha256(code || '')]);
        const row = rows[0];
        if (!row || row.client_id !== client.id) {
          return oauthError(res, 400, 'invalid_grant', 'Код не найден.');
        }
        // Повторное использование кода — признак кражи: гасим выданное по нему.
        if (row.used_at) {
          await pool.query(`UPDATE oauth_tokens SET revoked_at = NOW()
                            WHERE user_id = $1 AND client_id = $2 AND revoked_at IS NULL`,
                           [row.user_id, client.id]);
          return oauthError(res, 400, 'invalid_grant', 'Код уже использован.');
        }
        if (new Date(row.expires_at) < new Date()) {
          return oauthError(res, 400, 'invalid_grant', 'Срок действия кода истёк, начните вход заново.');
        }
        if (row.redirect_uri !== String(redirect_uri || '')) {
          return oauthError(res, 400, 'invalid_grant', 'Адрес возврата не совпадает с выданным коду.');
        }
        if (row.code_challenge) {
          const check = crypto.createHash('sha256').update(String(code_verifier || '')).digest('base64url');
          if (check !== row.code_challenge) {
            return oauthError(res, 400, 'invalid_grant', 'Проверочная строка не подошла.');
          }
        }

        await pool.query(`UPDATE oauth_codes SET used_at = NOW() WHERE code_hash = $1`, [oauth.sha256(code)]);
        const tokens = await oauth.issueTokens(pool, {
          clientId: client.id, userId: row.user_id, scopes: row.scopes,
        });
        return res.json({
          access_token: tokens.access,
          token_type: 'bearer',
          expires_in: tokens.expiresIn,
          refresh_token: tokens.refresh,
          scope: row.scopes.join(' '),
        });
      }

      if (grant === 'refresh_token') {
        const { rows } = await pool.query(
          `SELECT * FROM oauth_tokens WHERE refresh_hash = $1 AND revoked_at IS NULL`,
          [oauth.sha256(req.body?.refresh_token || '')]);
        const row = rows[0];
        if (!row || row.client_id !== client.id) {
          return oauthError(res, 400, 'invalid_grant', 'Токен обновления не найден.');
        }
        if (row.refresh_expires_at && new Date(row.refresh_expires_at) < new Date()) {
          return oauthError(res, 400, 'invalid_grant', 'Подключение устарело, войдите заново.');
        }
        const tokens = await oauth.issueTokens(pool, {
          clientId: client.id, userId: row.user_id, scopes: row.scopes, replaceTokenId: row.id,
        });
        return res.json({
          access_token: tokens.access,
          token_type: 'bearer',
          expires_in: tokens.expiresIn,
          refresh_token: tokens.refresh,
          scope: row.scopes.join(' '),
        });
      }

      return oauthError(res, 400, 'unsupported_grant_type', 'Поддерживаются authorization_code и refresh_token.');
    } catch (e) {
      console.error('oauth token:', e);
      oauthError(res, 500, 'server_error', 'Не удалось выдать токен.');
    }
  });

  // 4. Подключения пользователя: посмотреть и отключить.
  app.get('/api/oauth/connections', auth, async (req, res) => {
    try {
      res.json({ connections: await oauth.listConnections(pool, req.user.id) });
    } catch (e) {
      console.error('oauth connections:', e);
      res.status(500).json({ msg: 'Не удалось загрузить подключения' });
    }
  });

  app.delete('/api/oauth/connections/:id', auth, async (req, res) => {
    try {
      const done = await oauth.revokeConnection(pool, { userId: req.user.id, id: req.params.id });
      if (!done) return res.status(404).json({ msg: 'Подключение не найдено' });
      res.json({ success: true });
    } catch (e) {
      console.error('oauth revoke:', e);
      res.status(500).json({ msg: 'Не удалось отключить' });
    }
  });

  // 5. Регистрация помощника — только администратор сервиса.
  app.get('/api/admin/oauth/clients', adminAuth, async (req, res) => {
    try {
      res.json({ clients: await oauth.listClients(pool) });
    } catch (e) {
      console.error('oauth clients list:', e);
      res.status(500).json({ msg: 'Не удалось загрузить список' });
    }
  });

  app.post('/api/admin/oauth/clients', adminAuth, async (req, res) => {
    try {
      const { name, redirectUris } = req.body || {};
      const uris = (Array.isArray(redirectUris) ? redirectUris : [])
        .map(u => String(u).trim()).filter(Boolean);
      if (!uris.length) return res.status(400).json({ msg: 'Нужен хотя бы один адрес возврата' });
      if (uris.some(u => !u.startsWith('https://'))) {
        return res.status(400).json({ msg: 'Адрес возврата должен начинаться с https://' });
      }
      const created = await oauth.createClient(pool, { name, redirectUris: uris, createdBy: req.user.id });
      logAdminAction(req.user.id, 'CREATE_OAUTH_CLIENT', null, { clientId: created.clientId, name });
      res.status(201).json(created);
    } catch (e) {
      console.error('oauth client create:', e);
      res.status(500).json({ msg: 'Не удалось создать помощника' });
    }
  });

  // Адрес возврата конструктор помощника показывает только после сохранения
  // настроек входа — то есть уже после того, как помощник зарегистрирован.
  // Поэтому список адресов можно дополнить позже.
  app.patch('/api/admin/oauth/clients/:id', adminAuth, async (req, res) => {
    try {
      const uris = (Array.isArray(req.body?.redirectUris) ? req.body.redirectUris : [])
        .map(u => String(u).trim()).filter(Boolean);
      if (!uris.length) return res.status(400).json({ msg: 'Нужен хотя бы один адрес возврата' });
      if (uris.some(u => !u.startsWith('https://'))) {
        return res.status(400).json({ msg: 'Адрес возврата должен начинаться с https://' });
      }
      const { rowCount } = await pool.query(
        `UPDATE oauth_clients SET redirect_uris = $2::TEXT[] WHERE id = $1 AND disabled_at IS NULL`,
        [req.params.id, uris]
      );
      if (!rowCount) return res.status(404).json({ msg: 'Помощник не найден' });
      logAdminAction(req.user.id, 'UPDATE_OAUTH_CLIENT', null, { clientId: req.params.id, redirectUris: uris });
      res.json({ success: true, redirectUris: uris });
    } catch (e) {
      console.error('oauth client update:', e);
      res.status(500).json({ msg: 'Не удалось обновить адреса' });
    }
  });

  app.delete('/api/admin/oauth/clients/:id', adminAuth, async (req, res) => {
    try {
      await pool.query(`UPDATE oauth_clients SET disabled_at = NOW() WHERE id = $1`, [req.params.id]);
      await pool.query(`UPDATE oauth_tokens SET revoked_at = NOW() WHERE client_id = $1 AND revoked_at IS NULL`, [req.params.id]);
      logAdminAction(req.user.id, 'DISABLE_OAUTH_CLIENT', null, { clientId: req.params.id });
      res.json({ success: true });
    } catch (e) {
      console.error('oauth client disable:', e);
      res.status(500).json({ msg: 'Не удалось отключить помощника' });
    }
  });
};

module.exports = { registerOAuthRoutes };
