// Чеки самозанятого в «Мой налог» — автоматически после оплаты подписки.
//
// ЮKassa чеки самозанятых больше не формирует («в ЮKassa эта опция
// недоступна»), а открытого API у ФНС для одиночного самозанятого нет. Работаем
// через внутренний API веб-кабинета lknpd.nalog.ru — тот же, что у самого сайта
// (так же устроены открытые библиотеки shoman4eg/moy-nalog, alexstep/moy-nalog).
// API неофициальный: если ФНС его поменяет, чеки перестанут выбиваться — об этом
// придёт уведомление, а оплаты и подписки не пострадают (чеки можно выбить вручную).
//
// Устройство:
//   • вход — по СМС из админки, пароль не храним; ключи доступа шифруются (secretBox);
//     ключ привязан к устройству и адресу, поэтому все запросы идут с сервера с
//     постоянным sourceDeviceId;
//   • после оплаты (вебхук ЮKassa) — чек «Подписка FinUchet…», ссылка в журнал оплат
//     и в письмо человеку; выключатель в админке (enabled), чеки — только для оплат
//     после включения: прошлые могли быть выбиты вручную, задвоить их нельзя;
//   • сбой «Мой налог» (ответ с ошибкой) — повтор позже; ответа нет вовсе (таймаут) —
//     чек мог уже создаться, поэтому НЕ повторяем, а помечаем «проверить вручную»;
//   • полный возврат денег — чек аннулируется («Возврат средств»).
const axios = require('axios');
const crypto = require('crypto');
const { createSecretBox } = require('./secretBox');

const API = 'https://lknpd.nalog.ru/api';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TIMEOUT = 20000;
const MAX_ATTEMPTS = 6;
const box = createSecretBox('finuchet-npd', 'NPD_TOKEN_KEY');

const PLAN_TITLES = { START: 'Старт', STANDARD: 'Стандарт', BUSINESS: 'Бизнес', BUSINESS_PRO: 'Бизнес Pro', TRIAL: 'Пробный', AI_START: 'ИИ Старт', AI_PRO: 'ИИ Про' };

/** Дата в формате «Мой налог»: 2026-10-14T13:05:00+03:00 (без миллисекунд, по Москве) */
const mskIso = (d) => {
  const t = new Date(new Date(d).getTime() + 3 * 3600 * 1000);
  return t.toISOString().slice(0, 19) + '+03:00';
};

const receiptPrintUrl = (inn, uuid) => `${API}/v1/receipt/${inn}/${uuid}/print`;

/** Запрос ушёл, а ответа не было — чек мог создаться, повторять вслепую нельзя */
const isNoResponse = (e) => !!e.sent && !e.response;

const errText = (e) => {
  const d = e.response?.data;
  const msg = d?.message || d?.exceptionMessage || d?.code || (typeof d === 'string' ? d.slice(0, 200) : '');
  return `${e.response ? `HTTP ${e.response.status}` : e.code || e.message}${msg ? `: ${msg}` : ''}`;
};

function createMoyNalog({ pool, notifyAdmins, sendPaymentEmail }) {
  const ensureTables = async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS npd_account (
        id                INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        inn               TEXT,
        phone             TEXT,
        display_name      TEXT,
        device_id         TEXT,
        token             TEXT,
        token_expires_at  TIMESTAMPTZ,
        refresh_token     TEXT,
        enabled           BOOLEAN NOT NULL DEFAULT FALSE,
        enabled_since     TIMESTAMPTZ,
        connected_at      TIMESTAMPTZ,
        needs_login       BOOLEAN NOT NULL DEFAULT FALSE,
        challenge_token   TEXT,
        challenge_phone   TEXT,
        challenge_expires TIMESTAMPTZ,
        last_error        TEXT,
        last_error_at     TIMESTAMPTZ,
        last_alert_at     TIMESTAMPTZ,
        updated_at        TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`INSERT INTO npd_account (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    // Состояние чека у оплаты: issuing | issued | error | unknown | canceled
    await pool.query(`ALTER TABLE subscription_payments
      ADD COLUMN IF NOT EXISTS receipt_status   TEXT,
      ADD COLUMN IF NOT EXISTS receipt_error    TEXT,
      ADD COLUMN IF NOT EXISTS receipt_attempts INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS receipt_at       TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS receipt_auto     BOOLEAN`);
  };

  const account = async () => (await pool.query('SELECT * FROM npd_account WHERE id = 1')).rows[0];

  const deviceInfo = (deviceId) => ({
    sourceType: 'WEB',
    sourceDeviceId: deviceId,
    appVersion: '1.0.0',
    metaDetails: { userAgent: USER_AGENT },
  });

  const http = (method, url, data, token) => axios({
    method, url, data, timeout: TIMEOUT,
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'ru-RU,ru;q=0.9',
      Referer: 'https://lknpd.nalog.ru/',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  /** Постоянный идентификатор «устройства» — новый при каждом запросе ФНС блокирует */
  const ensureDeviceId = async () => {
    const acc = await account();
    if (acc.device_id) return acc.device_id;
    const id = crypto.randomBytes(16).toString('base64').replace(/[+/=]/g, '').slice(0, 21).toLowerCase();
    await pool.query('UPDATE npd_account SET device_id = $1 WHERE id = 1', [id]);
    return id;
  };

  const recordError = async (text) => {
    await pool.query('UPDATE npd_account SET last_error = $1, last_error_at = NOW(), updated_at = NOW() WHERE id = 1', [text]);
  };

  // Тревога администраторам — не чаще раза в 6 часов, чтобы сбой не засыпал уведомлениями
  const alert = async (title, body) => {
    const r = await pool.query(
      `UPDATE npd_account SET last_alert_at = NOW()
        WHERE id = 1 AND (last_alert_at IS NULL OR last_alert_at < NOW() - INTERVAL '6 hours') RETURNING 1`);
    if (r.rowCount) await notifyAdmins(title, body);
  };

  const saveTokens = async (data) => {
    const expires = data.tokenExpireIn ? new Date(data.tokenExpireIn) : new Date(Date.now() + 50 * 60 * 1000);
    await pool.query(
      `UPDATE npd_account SET token = $1, token_expires_at = $2,
              refresh_token = COALESCE($3, refresh_token), needs_login = FALSE, updated_at = NOW()
        WHERE id = 1`,
      [box.seal(data.token), isNaN(expires) ? null : expires, data.refreshToken ? box.seal(data.refreshToken) : null]
    );
  };

  // ── Вход по СМС ──────────────────────────────────────────────────────────
  const startSms = async (rawPhone) => {
    const phone = String(rawPhone || '').replace(/\D/g, '').replace(/^8(?=\d{10}$)/, '7');
    if (!/^7\d{10}$/.test(phone)) throw Object.assign(new Error('Укажите номер в формате +7 999 123-45-67'), { status: 400 });
    let data;
    try {
      // Библиотеки ходят сюда через v2; на случай отличий — запасной v1
      data = (await http('post', `${API}/v2/auth/challenge/sms/start`, { phone, requireTpToBeActive: true })).data;
    } catch (e) {
      if (e.response?.status !== 404) throw e;
      data = (await http('post', `${API}/v1/auth/challenge/sms/start`, { phone, requireTpToBeActive: true })).data;
    }
    if (!data?.challengeToken) throw new Error('«Мой налог» не прислал код');
    await pool.query(
      `UPDATE npd_account SET challenge_token = $1, challenge_phone = $2,
              challenge_expires = NOW() + make_interval(secs => $3), updated_at = NOW() WHERE id = 1`,
      [data.challengeToken, phone, Number(data.expireIn) || 120]
    );
    return { expireIn: Number(data.expireIn) || 120 };
  };

  const verifySms = async (code) => {
    const acc = await account();
    if (!acc.challenge_token) throw Object.assign(new Error('Сначала запросите код'), { status: 400 });
    const deviceId = await ensureDeviceId();
    const { data } = await http('post', `${API}/v1/auth/challenge/sms/verify`, {
      phone: acc.challenge_phone, code: String(code || '').trim(), challengeToken: acc.challenge_token,
      deviceInfo: deviceInfo(deviceId),
    });
    if (!data?.token || !data?.refreshToken) throw new Error(data?.message || 'Не удалось войти в «Мой налог»');
    await saveTokens(data);
    await pool.query(
      `UPDATE npd_account SET inn = $1, phone = $2, display_name = $3, connected_at = NOW(),
              challenge_token = NULL, challenge_phone = NULL, challenge_expires = NULL,
              last_error = NULL, last_error_at = NULL, updated_at = NOW()
        WHERE id = 1`,
      [data.profile?.inn || null, acc.challenge_phone, data.profile?.displayName || data.profile?.fio || null]
    );
    return { inn: data.profile?.inn || null };
  };

  const disconnect = async () => {
    await pool.query(
      `UPDATE npd_account SET token = NULL, refresh_token = NULL, token_expires_at = NULL,
              enabled = FALSE, connected_at = NULL, needs_login = FALSE, updated_at = NOW()
        WHERE id = 1`);
  };

  const setEnabled = async (on) => {
    const acc = await account();
    if (on && !acc.refresh_token) throw Object.assign(new Error('Сначала подключите «Мой налог»'), { status: 400 });
    // enabled_since — с этого момента чеки выбиваются сами; прошлые оплаты не трогаем
    await pool.query(
      `UPDATE npd_account SET enabled = $1,
              enabled_since = CASE WHEN $1 AND NOT enabled THEN NOW() ELSE enabled_since END,
              updated_at = NOW()
        WHERE id = 1`, [!!on]);
  };

  // ── Запросы с ключом доступа ─────────────────────────────────────────────
  const refresh = async () => {
    const acc = await account();
    const refreshToken = box.open(acc.refresh_token);
    if (!refreshToken) throw Object.assign(new Error('«Мой налог» не подключён'), { needsLogin: true });
    try {
      const { data } = await http('post', `${API}/v1/auth/token`, { deviceInfo: deviceInfo(acc.device_id), refreshToken });
      if (!data?.token) throw new Error('пустой ответ');
      await saveTokens(data);
      return data.token;
    } catch (e) {
      if (e.response && e.response.status < 500) {
        await pool.query('UPDATE npd_account SET needs_login = TRUE, updated_at = NOW() WHERE id = 1');
        await alert('«Мой налог»: нужно войти заново',
          'Ключ доступа больше не принимается — чеки не выбиваются. Админ-панель → Оплаты → «Подключить «Мой налог»».');
        throw Object.assign(new Error('Нужно войти в «Мой налог» заново'), { needsLogin: true });
      }
      throw e;
    }
  };

  const authed = async (method, path, body) => {
    const acc = await account();
    let token = box.open(acc.token);
    const expires = acc.token_expires_at ? new Date(acc.token_expires_at).getTime() : 0;
    if (!token || expires - Date.now() < 60 * 1000) token = await refresh();
    // sent — запрос ушёл в «Мой налог»: если ответа нет, действие могло выполниться
    const send = async (t) => {
      try { return (await http(method, `${API}/v1${path}`, body, t)).data; }
      catch (e) { e.sent = true; throw e; }
    };
    try {
      return await send(token);
    } catch (e) {
      if (e.response?.status !== 401) throw e;
      token = await refresh();
      return await send(token);
    }
  };

  // ── Чеки ─────────────────────────────────────────────────────────────────
  const serviceName = (p) =>
    `Подписка FinUchet — тариф «${PLAN_TITLES[p.plan] || p.plan}», ${p.months} мес.`;

  /**
   * Выбить чек по оплате. Захват строки (issuing) — защита от двойного чека,
   * если вебхук, очередь и кнопка в админке сработают одновременно.
   */
  const issueReceipt = async (paymentId, { manual = false } = {}) => {
    const acc = await account();
    if (!acc.refresh_token || !acc.inn) throw Object.assign(new Error('«Мой налог» не подключён'), { status: 400 });
    const claimed = await pool.query(
      `UPDATE subscription_payments
          SET receipt_status = 'issuing', receipt_attempts = receipt_attempts + 1
        WHERE id = $1 AND receipt_number IS NULL AND refunded_at IS NULL
          AND (receipt_status IS NULL OR receipt_status = 'error' ${manual ? "OR receipt_status = 'unknown'" : ''})
        RETURNING id, amount, plan, months, paid_at::timestamptz AS paid_at`,
      [paymentId]
    );
    const p = claimed.rows[0];
    if (!p) return { skipped: true };

    const amount = Math.round(Number(p.amount) * 100) / 100;
    try {
      const data = await authed('post', '/income', {
        operationTime: mskIso(p.paid_at),
        requestTime: mskIso(new Date()),
        services: [{ name: serviceName(p), amount, quantity: 1 }],
        totalAmount: amount.toFixed(2),
        client: { contactPhone: null, displayName: null, incomeType: 'FROM_INDIVIDUAL', inn: null },
        paymentType: 'CASH',
        ignoreMaxTotalIncomeRestriction: false,
      });
      const uuid = data?.approvedReceiptUuid;
      if (!uuid) throw Object.assign(new Error('«Мой налог» не вернул номер чека'), { response: { status: 0, data } });
      await pool.query(
        `UPDATE subscription_payments
            SET receipt_number = $2, receipt_url = $3, receipt_status = 'issued', receipt_error = NULL,
                receipt_at = NOW(), receipt_auto = $4
          WHERE id = $1`,
        [p.id, uuid, receiptPrintUrl(acc.inn, uuid), !manual]
      );
      await pool.query('UPDATE npd_account SET last_error = NULL, last_error_at = NULL WHERE id = 1');
      console.log(`🧾 Чек НПД ${uuid}: ${p.id}, ${amount} ₽`);
      return { issued: true, uuid };
    } catch (e) {
      const unknown = isNoResponse(e) && !e.needsLogin;
      const text = e.needsLogin ? e.message : errText(e);
      await pool.query(
        `UPDATE subscription_payments SET receipt_status = $2, receipt_error = $3 WHERE id = $1`,
        [p.id, unknown ? 'unknown' : 'error', text]
      );
      await recordError(text);
      console.error(`⚠️ Чек НПД не выбит (${p.id}): ${text}`);
      if (unknown) {
        await alert('Чек «Мой налог»: проверьте вручную',
          `Оплата ${amount} ₽: «Мой налог» не ответил — чек мог создаться. Проверьте в «Мой налог» и отметьте в Админ-панели → Оплаты.`);
      }
      throw Object.assign(new Error(unknown ? 'Нет ответа от «Мой налог» — проверьте, не создался ли чек' : text), { status: 502 });
    }
  };

  /** После оплаты: с чеком письмо уходит уже с ним; без автоматики — обычное письмо */
  const afterPayment = async (paymentId) => {
    try {
      // Сравнение — в базе: paid_at хранится без пояса, и в JS оно сдвигалось бы
      // на разницу поясов сервера и базы
      const { rows } = await pool.query(
        `SELECT a.enabled AND a.refresh_token IS NOT NULL AND NOT a.needs_login
                AND a.enabled_since IS NOT NULL AND p.paid_at >= a.enabled_since AS auto
           FROM subscription_payments p, npd_account a
          WHERE p.id = $1 AND a.id = 1`, [paymentId]);
      const auto = !!rows[0]?.auto;
      if (auto) {
        try { await issueReceipt(paymentId); } catch { /* повторит очередь; письмо — без чека */ }
      }
    } catch (e) {
      console.error('⚠️ Чек после оплаты:', e.message);
    }
    await sendPaymentEmail(paymentId);
  };

  const cancelReceipt = async (paymentId, reason = 'Возврат средств') => {
    if (!['Возврат средств', 'Чек сформирован ошибочно'].includes(reason)) {
      throw Object.assign(new Error('Причина: «Возврат средств» или «Чек сформирован ошибочно»'), { status: 400 });
    }
    const p = (await pool.query('SELECT id, receipt_number, receipt_status FROM subscription_payments WHERE id = $1', [paymentId])).rows[0];
    if (!p?.receipt_number) throw Object.assign(new Error('У оплаты нет чека'), { status: 400 });
    await authed('post', '/cancel', {
      operationTime: mskIso(new Date()),
      requestTime: mskIso(new Date()),
      comment: reason,
      receiptUuid: p.receipt_number,
      partnerCode: null,
    });
    await pool.query(`UPDATE subscription_payments SET receipt_status = 'canceled', receipt_error = NULL WHERE id = $1`, [paymentId]);
    console.log(`🧾 Чек НПД ${p.receipt_number} аннулирован (${reason})`);
  };

  // ── Очередь: повторы и напоминание о сроке ───────────────────────────────
  const tick = async () => {
    const acc = await account();
    if (!acc.enabled || !acc.refresh_token || acc.needs_login || !acc.enabled_since) return;

    // Повтор ошибок «Мой налог» — с паузой, растущей с каждой попыткой
    const due = await pool.query(
      `SELECT id FROM subscription_payments
        WHERE receipt_number IS NULL AND refunded_at IS NULL AND paid_at >= $1
          AND (receipt_status IS NULL OR receipt_status = 'error')
          AND receipt_attempts < $2
          AND paid_at < NOW() - INTERVAL '2 minutes'
        ORDER BY paid_at LIMIT 20`,
      [acc.enabled_since, MAX_ATTEMPTS]
    );
    for (const { id } of due.rows) {
      try { await issueReceipt(id); } catch { /* ошибка записана у оплаты */ }
    }

    // Чек за безналичную оплату — до 9-го числа следующего месяца
    const day = Number(new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(8, 10));
    if (day >= 3 && day <= 9) {
      const missing = await pool.query(
        `SELECT count(*)::int n FROM subscription_payments
          WHERE receipt_number IS NULL AND refunded_at IS NULL AND paid_at >= $1
            AND paid_at < date_trunc('month', NOW() AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'Europe/Moscow'`,
        [acc.enabled_since]
      );
      if (missing.rows[0].n > 0) {
        await alert('Чеки «Мой налог»: срок до 9-го числа',
          `За прошлый месяц без чека оплат: ${missing.rows[0].n}. Админ-панель → Оплаты → «Выбить чек».`);
      }
    }
  };

  const start = () => {
    ensureTables().catch(e => console.error('❌ npd tables:', e.message));
    const run = () => tick().catch(e => console.error('⚠️ Очередь чеков НПД:', e.message));
    setTimeout(run, 90 * 1000);
    setInterval(run, 10 * 60 * 1000);
  };

  /** Для админки: состояние подключения и сводка */
  const status = async () => {
    const acc = await account();
    const year = await pool.query(
      `SELECT COALESCE(SUM(amount), 0)::float total FROM subscription_payments
        WHERE refunded_at IS NULL AND paid_at >= date_trunc('year', NOW())`);
    const pending = await pool.query(
      `SELECT count(*)::int n FROM subscription_payments
        WHERE receipt_number IS NULL AND refunded_at IS NULL
          AND paid_at >= COALESCE($1, NOW())`, [acc.enabled_since]);
    return {
      connected: !!acc.refresh_token,
      needsLogin: acc.needs_login,
      inn: acc.inn,
      phone: acc.phone,
      displayName: acc.display_name,
      enabled: acc.enabled,
      enabledSince: acc.enabled_since,
      connectedAt: acc.connected_at,
      lastError: acc.last_error,
      lastErrorAt: acc.last_error_at,
      codeSentTo: acc.challenge_token && acc.challenge_expires && new Date(acc.challenge_expires) > new Date() ? acc.challenge_phone : null,
      pendingSinceEnabled: pending.rows[0].n,
      yearIncome: year.rows[0].total,
      yearLimit: 2400000,
    };
  };

  return { start, status, startSms, verifySms, disconnect, setEnabled, issueReceipt, cancelReceipt, afterPayment, errText };
}

module.exports = { createMoyNalog, mskIso };
