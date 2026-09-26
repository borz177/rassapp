// Транспорт MCP: приём вызовов помощника и ответы по JSON-RPC.
//
// Адрес для помощника: https://rassrochka.pro/api/mcp
//
// Почему под /api, а не просто /mcp: на боевом сервере nginx отдаёт бэкенду
// только пути, начинающиеся с /api/ — всё остальное уходит в раздачу
// приложения. Короткий адрес /mcp тоже объявлен: он заработает, если в nginx
// добавят для него проксирование, и тогда его можно будет давать как основной.
// Авторизация — тот же Bearer, что и у API: постоянный ключ владельца или
// токен подключения, полученный входом «Через FinUchet».
//
// Инструмент выполняется вызовом нашего же публичного маршрута внутрь себя
// (127.0.0.1), с тем же заголовком. Это осознанно: так у MCP и у REST один и
// тот же разбор полей, права, лимиты и журнал — разойтись им негде.

const express = require('express');
const rateLimit = require('express-rate-limit');
const { PROTOCOL_VERSION, SERVER_INFO, TOOLS, toolSchema } = require('./mcp');
const oauth = require('./oauth');

// Ответ помощнику не должен быть бесконечным: обрезаем длинные выгрузки,
// прямо говоря об этом, чтобы он попросил меньший период, а не гадал.
const MAX_RESULT_CHARS = 40_000;

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message, data) => ({
  jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) },
});

const registerMcpRoutes = (app, { pool, apiKeyAuth, port, publicUrl, logAdminAction }) => {
  const base = `http://127.0.0.1:${port}/api/v1`;

  // ── описание для клиентов, которые сами настраивают вход ─────────────────
  // По этим двум документам помощник узнаёт, где авторизоваться, и может
  // зарегистрироваться сам — без выданных вручную идентификатора и секрета.
  const protectedResource = {
    resource: `${publicUrl}/api/mcp`,
    authorization_servers: [publicUrl],
    scopes_supported: oauth.SCOPES,
    bearer_methods_supported: ['header'],
    resource_documentation: `${publicUrl}/api`,
  };
  const authorizationServer = {
    issuer: publicUrl,
    authorization_endpoint: `${publicUrl}/oauth/authorize`,
    token_endpoint: `${publicUrl}/api/oauth/token`,
    registration_endpoint: `${publicUrl}/api/oauth/register`,
    scopes_supported: oauth.SCOPES,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
  };

  const serveJson = body => (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.json(body);
  };
  for (const path of [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
    '/.well-known/oauth-protected-resource/api/mcp',
    '/api/.well-known/oauth-protected-resource',
  ]) app.get(path, serveJson(protectedResource));

  for (const path of [
    '/.well-known/oauth-authorization-server',
    '/api/.well-known/oauth-authorization-server',
  ]) app.get(path, serveJson(authorizationServer));

  // ── самостоятельная регистрация помощника (RFC 7591) ─────────────────────
  // Клиенты MCP обычно не знают заранее ни идентификатора, ни секрета: им дают
  // только адрес. Поэтому регистрация открыта, но ограничена по частоте, а
  // выданный так помощник виден в админке наравне с остальными.
  const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({
      error: 'temporarily_unavailable',
      error_description: 'Слишком много регистраций с этого адреса, повторите позже.',
    }),
  });

  app.post('/api/oauth/register', registerLimiter, express.json(), async (req, res) => {
    try {
      const uris = (Array.isArray(req.body?.redirect_uris) ? req.body.redirect_uris : [])
        .map(u => String(u).trim()).filter(Boolean);
      if (!uris.length) {
        return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'Нужен хотя бы один redirect_uris.' });
      }
      if (uris.some(u => !u.startsWith('https://'))) {
        return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'Адрес возврата должен начинаться с https://.' });
      }
      const name = String(req.body?.client_name || 'Помощник').slice(0, 80);
      const created = await oauth.createClient(pool, { name, redirectUris: uris, createdBy: 'self-registration' });
      res.status(201).json({
        client_id: created.clientId,
        client_secret: created.clientSecret,
        client_name: name,
        redirect_uris: uris,
        grant_types: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_method: 'client_secret_post',
      });
    } catch (e) {
      console.error('oauth register:', e);
      res.status(500).json({ error: 'server_error', error_description: 'Не удалось зарегистрировать помощника.' });
    }
  });

  // ── сам MCP ──────────────────────────────────────────────────────────────
  // Клиенту, пришедшему без токена, нужно подсказать, где авторизоваться:
  // по этой ссылке он находит адреса входа и регистрируется сам.
  const pointToAuth = (req, res, next) => {
    const status = res.status.bind(res);
    res.status = code => {
      if (code === 401) {
        res.setHeader('WWW-Authenticate',
          `Bearer resource_metadata="${publicUrl}/api/.well-known/oauth-protected-resource"`);
      }
      return status(code);
    };
    next();
  };

  // Поток от сервера к клиенту нам не нужен: все ответы умещаются в ответ на
  // запрос. Клиентам, которые пытаются открыть поток, честно отвечаем отказом.
  for (const path of ['/mcp', '/api/mcp']) {
    app.get(path, (req, res) => {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ error: 'method_not_allowed', error_description: 'MCP здесь работает через POST.' });
    });
  }

  const callTool = async (req, name, args) => {
    const tool = TOOLS.find(t => t.name === name);
    if (!tool) return { isError: true, text: `Инструмента «${name}» нет. Список — в tools/list.` };
    if (!req.apiAuth.scopes.includes(tool.scope)) {
      return {
        isError: true,
        text: tool.scope === 'write'
          ? 'Этому подключению разрешено только чтение. Чтобы записывать, владелец аккаунта должен выдать доступ с правом «запись».'
          : 'Подключению не хватает прав на чтение.',
      };
    }

    const { method, path, body } = tool.request(args || {});
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: req.header('authorization') || '',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.error?.message || 'Запрос не прошёл.';
      const details = payload?.error?.details ? ` ${JSON.stringify(payload.error.details)}` : '';
      return { isError: true, text: `${message}${details}` };
    }

    let text = JSON.stringify(payload, null, 2);
    if (text.length > MAX_RESULT_CHARS) {
      text = `${text.slice(0, MAX_RESULT_CHARS)}\n…\nОтвет обрезан. Сузьте период или уменьшите limit.`;
    }
    return { isError: false, text, structured: payload };
  };

  const handleRpc = async (req, message) => {
    const { id, method, params } = message || {};

    switch (method) {
      case 'initialize':
        return rpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: [
            'Данные учёта рассрочки FinUchet: договоры, платежи, клиенты, касса, склад и сводки.',
            'Суммы в рублях. Даты в виде ГГГГ-ММ-ДД.',
            'Цифры бери только из ответов инструментов, не досчитывай сам.',
          ].join(' '),
        });

      case 'ping':
        return rpcResult(id, {});

      case 'tools/list':
        // Показываем только то, что этому подключению разрешено: иначе помощник
        // предложит человеку действие, которое всё равно закончится отказом.
        return rpcResult(id, {
          tools: TOOLS.filter(t => req.apiAuth.scopes.includes(t.scope)).map(toolSchema),
        });

      case 'tools/call': {
        const result = await callTool(req, params?.name, params?.arguments);
        return rpcResult(id, {
          content: [{ type: 'text', text: result.text }],
          ...(result.structured && !result.isError ? { structuredContent: result.structured } : {}),
          isError: result.isError,
        });
      }

      default:
        return rpcError(id, -32601, `Метод ${method} не поддерживается.`);
    }
  };

  const handleMcpPost = async (req, res) => {
    try {
      const body = req.body;
      const messages = Array.isArray(body) ? body : [body];

      // Уведомления ответа не требуют: в них нет id.
      const answerable = messages.filter(m => m && m.id !== undefined && m.id !== null);
      if (!answerable.length) return res.status(202).end();

      const answers = [];
      for (const message of answerable) answers.push(await handleRpc(req, message));
      res.json(Array.isArray(body) ? answers : answers[0]);
    } catch (e) {
      console.error('[mcp]', e);
      res.status(500).json(rpcError(req.body?.id ?? null, -32603, 'Внутренняя ошибка сервера.'));
    }
  };

  for (const path of ['/mcp', '/api/mcp']) {
    app.post(path, pointToAuth, apiKeyAuth, handleMcpPost);
  }
};

module.exports = { registerMcpRoutes };
