// Отправка в WhatsApp двумя способами — общий для ручных напоминаний (index.js)
// и автоматической рассылки (whatsapp-reminders.js):
//   • встроенный (settings.provider === 'builtin') — свой сервис WuzAPI на
//     отдельном сервере (WA_BUILTIN_URL). Пользователь подключает номер прямо в
//     приложении, ключ его сессии хранится только здесь, в таблице wa_builtin, и
//     в приложение не попадает;
//   • Green API — ключи инстанса, которые пользователь сам ввёл в настройках.
const crypto = require('crypto');
const axios = require('axios');
const { normalizePhone } = require('./phone-utils');

const GREEN_API = 'https://api.green-api.com';
const WA_URL = (process.env.WA_BUILTIN_URL || '').replace(/\/+$/, '');
const WA_ADMIN = process.env.WA_BUILTIN_ADMIN_TOKEN || '';

// Ключ сессии в wa_builtin хранится зашифрованным (AES-256-GCM): по нему можно
// писать от имени номера, а база попадает в резервные копии и дампы. Ключ
// шифрования — WA_TOKEN_KEY, а если его нет — выводится из JWT_SECRET. Сменили
// секрет — старые ключи не расшифруются, и номера придётся подключить заново.
const TOKEN_PREFIX = 'enc1:';
const TOKEN_SECRET = process.env.WA_TOKEN_KEY || process.env.JWT_SECRET || '';
const tokenKey = TOKEN_SECRET
  ? Buffer.from(crypto.hkdfSync('sha256', TOKEN_SECRET, 'finuchet-wa-builtin', 'session-token', 32))
  : null;

const sealToken = (plain) => {
  if (!tokenKey || !plain) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return TOKEN_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
};

/** Старые записи без префикса — открытый текст (до шифрования) */
const openToken = (stored) => {
  if (!stored || !stored.startsWith(TOKEN_PREFIX)) return stored;
  if (!tokenKey) throw new Error('WA token key is not configured');
  const raw = Buffer.from(stored.slice(TOKEN_PREFIX.length), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', tokenKey, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
};

const isBuiltin = (settings) => settings?.provider === 'builtin';
const builtinAvailable = () => !!(WA_URL && WA_ADMIN);

// Ответ WuzAPI обёрнут в { code, data, success } — отдаём data
const unwrap = (res) => (res && res.data && res.data.data !== undefined ? res.data.data : res && res.data);

/**
 * Поле ответа без учёта регистра: версии WuzAPI отдают то LoggedIn, то loggedIn.
 * Из-за этого привязанный номер считался непривязанным.
 */
const field = (obj, name) => {
  if (!obj || typeof obj !== 'object') return undefined;
  if (obj[name] !== undefined) return obj[name];
  const lower = name.toLowerCase();
  const key = Object.keys(obj).find(k => k.toLowerCase() === lower);
  return key === undefined ? undefined : obj[key];
};

const wuz = async (method, path, token, body, timeout = 20000) =>
  unwrap(await axios({ method, url: WA_URL + path, headers: { Token: token }, data: body, timeout }));
const wuzAdmin = async (method, path, body) =>
  unwrap(await axios({ method, url: WA_URL + path, headers: { Authorization: WA_ADMIN }, data: body, timeout: 15000 }));

// ── Бережная отправка встроенным способом ────────────────────────────────
// WhatsApp ограничивает номера, которые шлют много, быстро, однотипно и тем,
// у кого WhatsApp нет. Поэтому для встроенного способа:
//   • дневной лимит, растущий с «возрастом» подключения (прогрев номера);
//   • пауза между сообщениями со случайным разбросом;
//   • «печатает…» перед отправкой — как у живого человека;
//   • номера без WhatsApp пропускаем, а не шлём в пустоту.
// Green API своих ограничений не получает — у него свои правила.
const dailyLimitFor = (ageDays) => (ageDays < 3 ? 40 : ageDays < 7 ? 100 : 250);
const PACE_MIN_MS = 4000;
const PACE_MAX_MS = 9000;
const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const lastSendAt = new Map();        // userId → время последней отправки (в этом процессе)
const onWhatsAppCache = new Map();   // номер → { ok, at }
const ON_WA_TTL_MS = 7 * 24 * 3600 * 1000;

const errText = (e) => {
  const status = e.response?.status;
  const body = e.response?.data ? JSON.stringify(e.response.data).slice(0, 300) : '';
  return `${e.message}${status ? ` | HTTP ${status}` : ''}${body ? ` | ${body}` : ''}`;
};

function createWaTransport(pool) {
  const ensureTable = async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wa_builtin (
        user_id    TEXT PRIMARY KEY,
        token      TEXT NOT NULL,
        wuz_id     TEXT,
        phone      TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    // Сколько отправлено по дням — для лимита и для админ-панели (оба способа)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wa_daily (
        user_id    TEXT NOT NULL,
        day        DATE NOT NULL DEFAULT CURRENT_DATE,
        provider   TEXT,
        sent       INTEGER NOT NULL DEFAULT 0,
        failed     INTEGER NOT NULL DEFAULT 0,
        skipped    INTEGER NOT NULL DEFAULT 0,
        last_at    TIMESTAMPTZ,
        last_error TEXT,
        PRIMARY KEY (user_id, day)
      )`);
    // Состояние номера по последней проверке (waHealth.js) и когда владельца
    // последний раз предупреждали — чтобы не слать «отключился» каждые 5 минут
    await pool.query(`ALTER TABLE wa_builtin
      ADD COLUMN IF NOT EXISTS health_state TEXT,
      ADD COLUMN IF NOT EXISTS health_since TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS health_notified_at TIMESTAMPTZ`);
    // Ключи, сохранённые до шифрования, — шифруем на месте
    if (tokenKey) {
      const plain = await pool.query(`SELECT user_id, token FROM wa_builtin WHERE token NOT LIKE '${TOKEN_PREFIX}%'`);
      for (const r of plain.rows) {
        await pool.query('UPDATE wa_builtin SET token = $2 WHERE user_id = $1 AND token = $3',
          [r.user_id, sealToken(r.token), r.token]);
      }
      if (plain.rows.length) console.log(`🔐 wa_builtin: зашифровано ключей сессий: ${plain.rows.length}`);
    }
  };

  /** Учёт отправки: sent | failed | skipped */
  const record = async (userId, settings, outcome, error = null) => {
    try {
      await pool.query(
        `INSERT INTO wa_daily (user_id, day, provider, sent, failed, skipped, last_at, last_error)
         VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, NOW(), $6)
         ON CONFLICT (user_id, day) DO UPDATE SET
           provider = EXCLUDED.provider,
           sent = wa_daily.sent + EXCLUDED.sent,
           failed = wa_daily.failed + EXCLUDED.failed,
           skipped = wa_daily.skipped + EXCLUDED.skipped,
           last_at = NOW(),
           last_error = COALESCE(EXCLUDED.last_error, wa_daily.last_error)`,
        [userId, isBuiltin(settings) ? 'builtin' : 'greenapi',
          outcome === 'sent' ? 1 : 0, outcome === 'failed' ? 1 : 0, outcome === 'skipped' ? 1 : 0,
          error ? String(error).slice(0, 200) : null]
      );
    } catch (e) { console.warn('⚠️ wa_daily:', e.message); }
  };

  /** Лимит на сегодня для встроенного способа и сколько уже ушло */
  const builtinQuota = async (userId, createdAt) => {
    const ageDays = createdAt ? (Date.now() - new Date(createdAt).getTime()) / 86400000 : 0;
    const limit = dailyLimitFor(ageDays);
    const r = await pool.query('SELECT sent FROM wa_daily WHERE user_id = $1 AND day = CURRENT_DATE', [userId]);
    const sent = r.rows[0]?.sent || 0;
    return { limit, sent, left: Math.max(0, limit - sent) };
  };

  /** Есть ли у номера WhatsApp. Не удалось проверить — считаем, что есть */
  const onWhatsApp = async (token, phone) => {
    const cached = onWhatsAppCache.get(phone);
    if (cached && Date.now() - cached.at < ON_WA_TTL_MS) return cached.ok;
    try {
      const r = await wuz('post', '/user/check', token, { Phone: [phone] }, 15000);
      const users = field(r, 'Users') || [];
      const ok = users.length ? !!field(users[0], 'IsInWhatsapp') : true;
      onWhatsAppCache.set(phone, { ok, at: Date.now() });
      return ok;
    } catch { return true; }
  };

  /** Пауза между сообщениями одного номера и «печатает…» перед отправкой */
  const humanize = async (userId, token, phone, message) => {
    const last = lastSendAt.get(userId) || 0;
    const wait = last + rand(PACE_MIN_MS, PACE_MAX_MS) - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      await wuz('post', '/chat/presence', token, { Phone: phone, State: 'composing', Media: '' }, 10000);
      await sleep(Math.min(4000, 1200 + (message || '').length * 8) + rand(0, 800));
    } catch { /* без «печатает…» тоже отправим */ }
  };

  const getBuiltin = async (userId) => {
    const row = (await pool.query('SELECT token, wuz_id, phone, created_at FROM wa_builtin WHERE user_id = $1', [userId])).rows[0];
    return row ? { ...row, token: openToken(row.token) } : null;
  };

  /** Сессия пользователя во встроенном сервисе — создаём при первом подключении */
  const ensureBuiltinSession = async (userId) => {
    const existing = await getBuiltin(userId);
    if (existing) return existing;
    const token = crypto.randomBytes(32).toString('hex');
    const created = await wuzAdmin('post', '/admin/users', { name: `finuchet_${userId}`, token, events: '' });
    const wuzId = created?.id ?? created?.data?.id ?? null;
    await pool.query(
      `INSERT INTO wa_builtin (user_id, token, wuz_id) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, sealToken(token), wuzId == null ? null : String(wuzId)]
    );
    return getBuiltin(userId);
  };

  /** Отвязать номер и удалить сессию — чтобы не висела на сервере */
  const removeBuiltinSession = async (userId) => {
    const row = await getBuiltin(userId);
    if (!row) return;
    try { await wuz('post', '/session/logout', row.token); } catch { /* уже не в сети — не важно */ }
    if (row.wuz_id) {
      // Полное удаление: выход из WhatsApp, данные устройства, сессия в памяти.
      // Простое удаление оставляло старое устройство, и новое подключение
      // WhatsApp сразу выкидывал («logged out from another device»).
      try { await wuzAdmin('delete', `/admin/users/${row.wuz_id}/full`); }
      catch (e) {
        console.warn('⚠️ WA builtin full delete:', errText(e));
        try { await wuzAdmin('delete', `/admin/users/${row.wuz_id}`); } catch { /* уже нет */ }
      }
    }
    await pool.query('DELETE FROM wa_builtin WHERE user_id = $1', [userId]);
  };

  /**
   * Состояние: 'authorized' | 'notAuthorized' | null (проверить не удалось), а
   * у Green API ещё 'expired' (кончилась оплата инстанса — шлюз отвечает 400
   * «Instance account is expired») и 'invalidToken' (401/403: ключ сменили или
   * инстанс удалён). Раньше оба последних давали null — «не знаем», — и рассылка
   * шла, хотя ни одно сообщение уйти не могло.
   */
  const getState = async (userId, settings) => {
    try {
      if (isBuiltin(settings)) {
        const row = await getBuiltin(userId);
        if (!row || !builtinAvailable()) return 'notAuthorized';
        const st = await wuz('get', '/session/status', row.token, undefined, 10000);
        return field(st, 'LoggedIn') ? 'authorized' : 'notAuthorized';
      }
      const r = await axios.get(
        `${GREEN_API}/waInstance${settings.idInstance}/getStateInstance/${settings.apiTokenInstance}`,
        { timeout: 10000 }
      );
      return r.data?.stateInstance || null;
    } catch (e) {
      const status = e.response?.status;
      const text = JSON.stringify(e.response?.data || '');
      if (!isBuiltin(settings) && status === 400 && /expired/i.test(text)) return 'expired';
      if (!isBuiltin(settings) && (status === 401 || status === 403)) return 'invalidToken';
      console.warn(`⚠️ WhatsApp: не удалось проверить состояние (${userId}): ${e.message}`);
      return null;
    }
  };

  /** Настроен ли способ отправки у пользователя (сам WhatsApp не проверяем) */
  const isConfigured = async (userId, settings) => {
    if (!settings?.enabled) return false;
    if (isBuiltin(settings)) return builtinAvailable() && !!(await getBuiltin(userId));
    return !!(settings.idInstance && settings.apiTokenInstance);
  };

  /**
   * Текстовое сообщение. { ok, skipped, reason }: skipped — не отправляли
   * (пустой текст, плохой номер), а не ошибка доставки.
   */
  const sendText = async (userId, settings, rawPhone, message, logTag = '') => {
    const result = await sendTextRaw(userId, settings, rawPhone, message, logTag);
    await record(userId, settings, result.ok ? 'sent' : result.skipped ? 'skipped' : 'failed', result.ok ? null : result.reason);
    return result;
  };

  const sendTextRaw = async (userId, settings, rawPhone, message, logTag = '') => {
    if (!message) return { ok: false, skipped: true, reason: 'пустое сообщение' };
    const { phone, reason } = normalizePhone(rawPhone);
    if (!phone) return { ok: false, skipped: true, reason };

    if (isBuiltin(settings)) {
      const row = await getBuiltin(userId);
      if (!row) return { ok: false, skipped: true, reason: 'встроенный WhatsApp не подключён' };
      const quota = await builtinQuota(userId, row.created_at);
      if (quota.left <= 0) return { ok: false, skipped: true, reason: `дневной лимит ${quota.limit}` };
      if (!(await onWhatsApp(row.token, phone))) return { ok: false, skipped: true, reason: 'у номера нет WhatsApp' };
      await humanize(userId, row.token, phone, message);
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        if (isBuiltin(settings)) {
          const row = await getBuiltin(userId);
          const r = await wuz('post', '/chat/send/text', row.token, { Phone: phone, Body: message });
          lastSendAt.set(userId, Date.now());
          return field(r, 'Id') || field(r, 'Details') ? { ok: true, skipped: false, reason: null } : { ok: false, skipped: false, reason: 'ответ без Id' };
        }
        const r = await axios.post(
          `${GREEN_API}/waInstance${settings.idInstance}/sendMessage/${settings.apiTokenInstance}`,
          { chatId: `${phone}@c.us`, message },
          { timeout: 15000 }
        );
        return r.data?.idMessage ? { ok: true, skipped: false, reason: null } : { ok: false, skipped: false, reason: 'ответ без idMessage' };
      } catch (e) {
        const status = e.response?.status;
        // 4xx не примут и со второй попытки — повтор только для сети и 5xx
        if ((!status || status >= 500) && attempt === 1) {
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        console.error(`🔴 WhatsApp${logTag} → ${phone}: ${errText(e)}`);
        return { ok: false, skipped: false, reason: `HTTP ${status || 'network'}` };
      }
    }
    return { ok: false, skipped: false, reason: 'исчерпаны попытки' };
  };

  /** Документ (PDF договора, истории платежей) — только встроенный способ */
  const sendDocument = async (userId, rawPhone, base64, fileName, mime = 'application/pdf') => {
    const settings = { provider: 'builtin' };
    const { phone, reason } = normalizePhone(rawPhone);
    if (!phone) { await record(userId, settings, 'skipped', reason); return { ok: false, reason }; }
    const row = await getBuiltin(userId);
    if (!row) return { ok: false, reason: 'встроенный WhatsApp не подключён' };
    const quota = await builtinQuota(userId, row.created_at);
    if (quota.left <= 0) { await record(userId, settings, 'skipped', 'дневной лимит'); return { ok: false, reason: `дневной лимит ${quota.limit}` }; }
    if (!(await onWhatsApp(row.token, phone))) { await record(userId, settings, 'skipped', 'нет WhatsApp'); return { ok: false, reason: 'у номера нет WhatsApp' }; }
    try {
      const r = await wuz('post', '/chat/send/document', row.token,
        { Phone: phone, FileName: fileName, Document: `data:${mime};base64,${base64}` }, 60000);
      const ok = !!(field(r, 'Id') || field(r, 'Details'));
      lastSendAt.set(userId, Date.now());
      await record(userId, settings, ok ? 'sent' : 'failed', ok ? null : 'ответ без Id');
      return ok ? { ok: true } : { ok: false, reason: 'ответ без Id' };
    } catch (e) {
      console.error(`🔴 WhatsApp документ → ${phone}: ${errText(e)}`);
      await record(userId, settings, 'failed', `HTTP ${e.response?.status || 'network'}`);
      return { ok: false, reason: `HTTP ${e.response?.status || 'network'}` };
    }
  };

  return {
    ensureTable, builtinAvailable, getBuiltin, ensureBuiltinSession, removeBuiltinSession,
    getState, isConfigured, sendText, sendDocument, builtinQuota,
    // Сессия встроенного сервиса — для экрана подключения
    builtin: {
      /** Все сессии сервиса с состоянием — для проверки здоровья (waHealth.js) */
      sessions: () => wuzAdmin('get', '/admin/users'),
      /** Итог последнего обновления сервиса: { ok, message, commit, at } */
      updateStatus: async () => (await axios.get(WA_URL + '/_update-status', { timeout: 10000 })).data,
      connect: (token) => wuz('post', '/session/connect', token, { Subscribe: [], Immediate: true }),
      disconnect: (token) => wuz('post', '/session/disconnect', token),
      status: (token) => wuz('get', '/session/status', token, undefined, 10000),
      qr: (token) => wuz('get', '/session/qr', token, undefined, 15000),
      pairPhone: (token, phone) => wuz('post', '/session/pairphone', token, { Phone: phone }, 30000),
    },
  };
}

module.exports = { createWaTransport, isBuiltin, waField: field };
