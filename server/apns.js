/**
 * Отправка push-уведомлений на iPhone через Apple Push Notification service.
 *
 * Без сторонних библиотек: APNs — это HTTP/2 с JWT-токеном, подписанным ключом
 * .p8 (ES256), и всё это есть в самом Node (http2, crypto).
 *
 * Настройка — переменные окружения (ключ создаётся в аккаунте Apple Developer,
 * раздел Keys, галочка «Apple Push Notifications service»):
 *   APNS_KEY_PATH  — путь к файлу AuthKey_XXXXXXXXXX.p8
 *   APNS_KEY_ID    — Key ID этого ключа
 *   APNS_TEAM_ID   — Team ID аккаунта разработчика
 *   APNS_BUNDLE_ID — необязательно, по умолчанию com.finuchet.app
 * Пока их нет, модуль выключен: enabled === false, send ничего не делает.
 *
 * Два адреса APNs. Сборка из Xcode получает токены «песочницы», TestFlight и
 * App Store — боевые, и с чужого адреса токен отклоняется как BadDeviceToken.
 * Из самого приложения среду не узнать, поэтому пробуем боевой, при отказе —
 * песочницу, и запоминаем, какой подошёл (onEnvironment).
 */

const fs = require('fs');
const http2 = require('http2');
const crypto = require('crypto');

const HOSTS = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
};

// Apple требует обновлять токен не чаще раза в 20 минут и не реже раза в час
const TOKEN_TTL_MS = 50 * 60 * 1000;

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

const createApns = (env = process.env) => {
  const keyPath = env.APNS_KEY_PATH;
  const keyId = env.APNS_KEY_ID;
  const teamId = env.APNS_TEAM_ID;
  const topic = env.APNS_BUNDLE_ID || 'com.finuchet.app';

  let key = null;
  if (keyPath && keyId && teamId) {
    try {
      key = crypto.createPrivateKey(fs.readFileSync(keyPath));
    } catch (e) {
      console.error('❌ APNs: не удалось прочитать ключ', keyPath, '-', e.message);
    }
  } else if (keyPath || keyId || teamId) {
    console.warn('⚠️ APNs: заданы не все переменные (APNS_KEY_PATH, APNS_KEY_ID, APNS_TEAM_ID) — push на iPhone отключены');
  }
  const enabled = !!key;

  let jwt = null;
  let jwtAt = 0;
  const authToken = () => {
    if (jwt && Date.now() - jwtAt < TOKEN_TTL_MS) return jwt;
    const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
    const claims = b64url(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }));
    const signature = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), {
      key, dsaEncoding: 'ieee-p1363',
    });
    jwt = `${header}.${claims}.${b64url(signature)}`;
    jwtAt = Date.now();
    return jwt;
  };

  // Одно соединение на адрес: HTTP/2 гоняет все запросы по нему
  const sessions = {};
  const session = (environment) => {
    const s = sessions[environment];
    if (s && !s.closed && !s.destroyed) return s;
    const created = http2.connect(HOSTS[environment]);
    created.on('error', () => { /* разрыв — при следующей отправке соединимся заново */ });
    created.on('goaway', () => created.close());
    // Простаивающее соединение не держит процесс и не висит вечно
    created.setTimeout(5 * 60 * 1000, () => created.close());
    created.unref();
    sessions[environment] = created;
    return created;
  };

  const request = (environment, deviceToken, payload) => new Promise((resolve) => {
    let req;
    try {
      req = session(environment).request({
        ':method': 'POST',
        ':path': `/3/device/${deviceToken}`,
        authorization: `bearer ${authToken()}`,
        'apns-topic': topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      });
    } catch (e) {
      return resolve({ status: 0, reason: e.message });
    }
    let status = 0;
    let body = '';
    req.setEncoding('utf8');
    req.on('response', (headers) => { status = headers[':status']; });
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let reason = null;
      try { reason = body ? JSON.parse(body).reason : null; } catch { reason = body; }
      resolve({ status, reason });
    });
    req.on('error', (e) => resolve({ status: 0, reason: e.message }));
    req.setTimeout(10000, () => { req.close(); resolve({ status: 0, reason: 'timeout' }); });
    req.end(JSON.stringify(payload));
  });

  /**
   * Отправить уведомление на одно устройство.
   * environment — где токен сработал в прошлый раз (null — не знаем).
   * Возвращает { ok, environment, gone }: gone — токен больше недействителен
   * (приложение удалено или уведомления выключены), его нужно забыть.
   */
  const send = async (deviceToken, { title, body }, environment = null) => {
    if (!enabled) return { ok: false, environment, gone: false };
    const payload = { aps: { alert: { title, body }, sound: 'default' } };
    const order = environment === 'sandbox' ? ['sandbox', 'production'] : ['production', 'sandbox'];

    for (const env of order) {
      const { status, reason } = await request(env, deviceToken, payload);
      if (status === 200) return { ok: true, environment: env, gone: false };
      if (status === 410 || reason === 'Unregistered') return { ok: false, environment: env, gone: true };
      // Токен из другой среды — пробуем вторую. Иначе ошибка не в среде: дальше не идём
      if (reason !== 'BadDeviceToken') {
        console.error(`❌ APNs ${env}: ${status} ${reason}`);
        return { ok: false, environment, gone: false };
      }
    }
    // Ни одна среда токен не приняла
    return { ok: false, environment, gone: true };
  };

  return { enabled, send };
};

module.exports = { createApns };
