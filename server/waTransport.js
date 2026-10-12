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

const isBuiltin = (settings) => settings?.provider === 'builtin';
const builtinAvailable = () => !!(WA_URL && WA_ADMIN);

// Ответ WuzAPI обёрнут в { code, data, success } — отдаём data
const unwrap = (res) => (res && res.data && res.data.data !== undefined ? res.data.data : res && res.data);

const wuz = async (method, path, token, body, timeout = 20000) =>
  unwrap(await axios({ method, url: WA_URL + path, headers: { Token: token }, data: body, timeout }));
const wuzAdmin = async (method, path, body) =>
  unwrap(await axios({ method, url: WA_URL + path, headers: { Authorization: WA_ADMIN }, data: body, timeout: 15000 }));

const errText = (e) => {
  const status = e.response?.status;
  const body = e.response?.data ? JSON.stringify(e.response.data).slice(0, 300) : '';
  return `${e.message}${status ? ` | HTTP ${status}` : ''}${body ? ` | ${body}` : ''}`;
};

function createWaTransport(pool) {
  const ensureTable = () => pool.query(`
    CREATE TABLE IF NOT EXISTS wa_builtin (
      user_id    TEXT PRIMARY KEY,
      token      TEXT NOT NULL,
      wuz_id     TEXT,
      phone      TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);

  const getBuiltin = async (userId) =>
    (await pool.query('SELECT token, wuz_id, phone FROM wa_builtin WHERE user_id = $1', [userId])).rows[0] || null;

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
      [userId, token, wuzId == null ? null : String(wuzId)]
    );
    return getBuiltin(userId);
  };

  /** Отвязать номер и удалить сессию — чтобы не висела на сервере */
  const removeBuiltinSession = async (userId) => {
    const row = await getBuiltin(userId);
    if (!row) return;
    try { await wuz('post', '/session/logout', row.token); } catch { /* уже не в сети — не важно */ }
    if (row.wuz_id) {
      try { await wuzAdmin('delete', `/admin/users/${row.wuz_id}`); } catch (e) { console.warn('⚠️ WA builtin delete user:', errText(e)); }
    }
    await pool.query('DELETE FROM wa_builtin WHERE user_id = $1', [userId]);
  };

  /** Состояние: 'authorized' | 'notAuthorized' | null (проверить не удалось) */
  const getState = async (userId, settings) => {
    try {
      if (isBuiltin(settings)) {
        const row = await getBuiltin(userId);
        if (!row || !builtinAvailable()) return 'notAuthorized';
        const st = await wuz('get', '/session/status', row.token, undefined, 10000);
        return st?.LoggedIn ? 'authorized' : 'notAuthorized';
      }
      const r = await axios.get(
        `${GREEN_API}/waInstance${settings.idInstance}/getStateInstance/${settings.apiTokenInstance}`,
        { timeout: 10000 }
      );
      return r.data?.stateInstance || null;
    } catch (e) {
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
    if (!message) return { ok: false, skipped: true, reason: 'пустое сообщение' };
    const { phone, reason } = normalizePhone(rawPhone);
    if (!phone) return { ok: false, skipped: true, reason };

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        if (isBuiltin(settings)) {
          const row = await getBuiltin(userId);
          if (!row) return { ok: false, skipped: true, reason: 'встроенный WhatsApp не подключён' };
          const r = await wuz('post', '/chat/send/text', row.token, { Phone: phone, Body: message });
          return r?.Id || r?.Details ? { ok: true, skipped: false, reason: null } : { ok: false, skipped: false, reason: 'ответ без Id' };
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
    const { phone, reason } = normalizePhone(rawPhone);
    if (!phone) return { ok: false, reason };
    const row = await getBuiltin(userId);
    if (!row) return { ok: false, reason: 'встроенный WhatsApp не подключён' };
    try {
      const r = await wuz('post', '/chat/send/document', row.token,
        { Phone: phone, FileName: fileName, Document: `data:${mime};base64,${base64}` }, 60000);
      return r?.Id || r?.Details ? { ok: true } : { ok: false, reason: 'ответ без Id' };
    } catch (e) {
      console.error(`🔴 WhatsApp документ → ${phone}: ${errText(e)}`);
      return { ok: false, reason: `HTTP ${e.response?.status || 'network'}` };
    }
  };

  return {
    ensureTable, builtinAvailable, getBuiltin, ensureBuiltinSession, removeBuiltinSession,
    getState, isConfigured, sendText, sendDocument,
    // Сессия встроенного сервиса — для экрана подключения
    builtin: {
      connect: (token) => wuz('post', '/session/connect', token, { Subscribe: [], Immediate: true }),
      status: (token) => wuz('get', '/session/status', token, undefined, 10000),
      qr: (token) => wuz('get', '/session/qr', token, undefined, 15000),
      pairPhone: (token, phone) => wuz('post', '/session/pairphone', token, { Phone: phone }, 30000),
    },
  };
}

module.exports = { createWaTransport, isBuiltin };
