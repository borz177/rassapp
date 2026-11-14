// whatsapp-reminders.js — полная версия с поддержкой пользовательских шаблонов
require('dotenv').config({ path: '/var/www/env/rassapp.env' });

const { Pool } = require('pg');
const axios = require('axios');

const LOG_PREFIX = '[WHATSAPP REMINDERS]';

// 🔔 Необязательная фича — если пакет ещё не установлен (npm install в server/ не выполнен
// после деплоя), это не должно ронять весь cron-скрипт (иначе перестанут уходить и обычные
// WhatsApp-напоминания, никак не связанные с push).
let webpush = null;
try {
  webpush = require('web-push');
} catch (e) {
  console.warn(`${LOG_PREFIX} ⚠️ Пакет web-push не установлен — push-уведомления отключены`);
}
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const PUSH_ENABLED = !!(webpush && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (PUSH_ENABLED) {
  webpush.setVapidDetails('mailto:support@rassrochka.pro', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// 🔹 Шаблоны по умолчанию (копия из фронтенда)
const { DEFAULT_TEMPLATES, calculateSalePaymentStates, buildCustomerReminderMessage, reminderTrigger } = require('./whatsappReminderContent');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Отправка встроенным WhatsApp (свой сервис) или через Green API — общий модуль
// с ручными напоминаниями сервера
const { createWaTransport } = require('./waTransport');
const waTransport = createWaTransport(pool);

// 🔹 Push всем подпискам пользователя (та же логика, что в server/index.js)
async function sendPushToUser(userId, title, body) {
  if (!PUSH_ENABLED) return;
  try {
    const subsResult = await pool.query(
      `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
      [userId]
    );
    const payload = JSON.stringify({ title, body });
    for (const sub of subsResult.rows) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await pool.query(`DELETE FROM push_subscriptions WHERE id = $1`, [sub.id]);
        } else {
          console.error(`${LOG_PREFIX} ❌ web-push send error:`, err.message);
        }
      }
    }
  } catch (e) {
    console.error(`${LOG_PREFIX} ❌ sendPushToUser error:`, e.message);
  }
}

// 🔹 Уведомление в приложении об отправленном напоминании (учитывает тумблер пользователя)
// Тревога «WhatsApp отключился». Не глушится настройкой «об отправленных
// сообщениях» — только общим выключателем уведомлений.
async function notifyWhatsAppDisconnected(userId) {
  try {
    const settingsResult = await pool.query(
      `SELECT data FROM data_items WHERE id = $1 AND user_id = $2 AND type = 'settings'`,
      [`settings_${userId}`, userId]
    );
    const notifSettings = settingsResult.rows[0]?.data?.notifications;
    if (notifSettings?.enabled === false) return;
    // Проверка каждые 5 минут (waHealth.js) могла уже предупредить сегодня —
    // одна и та же тревога дважды за день только раздражает
    const recent = await pool.query(
      `UPDATE wa_builtin SET health_notified_at = NOW()
       WHERE user_id = $1 AND (health_notified_at IS NULL OR health_notified_at < NOW() - INTERVAL '20 hours')
       RETURNING user_id`,
      [userId]
    );
    if (!recent.rowCount) return;
    const title = 'WhatsApp отключился';
    const body = 'Напоминания клиентам сегодня не ушли. Подключите WhatsApp заново: Настройки → Интеграции.';
    const nid = `notif_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    await pool.query(
      `INSERT INTO notifications (id, user_id, type, title, body, data) VALUES ($1, $2, 'WHATSAPP_SENT', $3, $4, $5)`,
      [nid, userId, title, body, JSON.stringify({ reason: 'whatsapp_disconnected' })]
    );
    if (notifSettings?.pushEnabled !== false) await sendPushToUser(userId, title, body);
  } catch (e) {
    console.error(`${LOG_PREFIX} ❌ notifyWhatsAppDisconnected:`, e.message);
  }
}

// Green API: почему напоминания не ушли и что сделать. Не чаще раза в 20 часов —
// по последнему такому уведомлению (строки wa_builtin у Green API нет).
const GREEN_PROBLEMS = {
  expired: {
    title: 'WhatsApp: закончилась оплата Green API',
    body: 'Напоминания клиентам не уходят: в Green API закончился оплаченный период. Продлите его в личном кабинете Green API или подключите WhatsApp прямо в приложении: Настройки → Интеграции.',
  },
  notAuthorized: {
    title: 'WhatsApp отключился',
    body: 'Напоминания клиентам не уходят: номер отвязан от Green API. Подключите его заново (QR-код в личном кабинете Green API) или подключите WhatsApp прямо в приложении: Настройки → Интеграции.',
  },
  invalidToken: {
    title: 'WhatsApp: ключ Green API не подходит',
    body: 'Напоминания клиентам не уходят: Green API не принимает ключ. Проверьте ID инстанса и токен в Настройки → Интеграции.',
  },
};
async function notifyGreenApiProblem(userId, state) {
  try {
    const problem = GREEN_PROBLEMS[state] || GREEN_PROBLEMS.notAuthorized;
    const settingsResult = await pool.query(
      `SELECT data FROM data_items WHERE id = $1 AND user_id = $2 AND type = 'settings'`,
      [`settings_${userId}`, userId]
    );
    const notifSettings = settingsResult.rows[0]?.data?.notifications;
    if (notifSettings?.enabled === false) return;
    const recent = await pool.query(
      `SELECT 1 FROM notifications WHERE user_id = $1 AND data->>'reason' = 'greenapi_problem'
         AND created_at > NOW() - INTERVAL '20 hours' LIMIT 1`,
      [userId]
    );
    if (recent.rowCount) return;
    const nid = `notif_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    await pool.query(
      `INSERT INTO notifications (id, user_id, type, title, body, data) VALUES ($1, $2, 'WHATSAPP_SENT', $3, $4, $5)`,
      [nid, userId, problem.title, problem.body, JSON.stringify({ reason: 'greenapi_problem', state })]
    );
    if (notifSettings?.pushEnabled !== false) await sendPushToUser(userId, problem.title, problem.body);
  } catch (e) {
    console.error(`${LOG_PREFIX} ❌ notifyGreenApiProblem:`, e.message);
  }
}

async function createWhatsAppSentNotification(userId, title, body, data) {
  try {
    const settingsResult = await pool.query(
      `SELECT data FROM data_items WHERE id = $1 AND user_id = $2 AND type = 'settings'`,
      [`settings_${userId}`, userId]
    );
    const notifSettings = settingsResult.rows[0]?.data?.notifications;
    if (notifSettings?.enabled === false) return;
    if (notifSettings?.events?.whatsappSent === false) return;

    const id = `notif_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    await pool.query(
      `INSERT INTO notifications (id, user_id, type, title, body, data) VALUES ($1, $2, 'WHATSAPP_SENT', $3, $4, $5)`,
      [id, userId, title, body, data ? JSON.stringify(data) : null]
    );

    if (notifSettings?.pushEnabled !== false) {
      await sendPushToUser(userId, title, body);
    }
  } catch (e) {
    console.error(`${LOG_PREFIX} ❌ createWhatsAppSentNotification error:`, e.message);
  }
}


const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function processRemindersForUser(user) {
  const { id, whatsapp_settings } = user;

  if (!(await waTransport.isConfigured(id, whatsapp_settings))) {
    return;
  }

  const settings = whatsapp_settings;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  // Настройки старых аккаунтов могут не содержать этих полей. Без дефолтов обращение
  // к undefined роняло обработку всего менеджера — и ни один его клиент не получал ничего.
  const reminderTime = settings.reminderTime || '10:00';
  const reminderDays = Array.isArray(settings.reminderDays) ? settings.reminderDays : [0];

  // Проверка времени ±5 мин
  const now = new Date();
  const [targetHour, targetMin] = reminderTime.split(':').map(Number);
  const diffMinutes = Math.abs((now.getHours() * 60 + now.getMinutes()) - (targetHour * 60 + targetMin));
  if (diffMinutes > 5) return;

  const state = await waTransport.getState(id, settings);
  if (state && state !== 'authorized') {
    console.warn(`${LOG_PREFIX} [${id}] ⛔ Инстанс не авторизован (${state}) — рассылка пропущена`);
    // Номер отвалился, у Green API кончилась оплата или ключ не подходит — без
    // предупреждения владелец узнал бы об этом только от клиентов. Проверка идёт
    // раз в день, во время рассылки, — значит и уведомление раз в день.
    if (settings.provider === 'builtin') await notifyWhatsAppDisconnected(id);
    else await notifyGreenApiProblem(id, state);
    return;
  }

  const [salesRes, customersRes] = await Promise.all([
    pool.query('SELECT data FROM data_items WHERE user_id = $1 AND type = $2', [id, 'sales']),
    pool.query('SELECT data FROM data_items WHERE user_id = $1 AND type = $2', [id, 'customers'])
  ]);

  const sales = salesRes.rows.map(r => r.data);
  const customers = customersRes.rows.map(r => r.data);

  const customerReminders = {};

  for (const sale of sales) {
    if (sale.status !== 'ACTIVE' && sale.status !== 'DRAFT') continue;
    if (!sale.paymentPlan || sale.paymentPlan.length === 0) continue;

    const customer = customers.find(c => c.id === sale.customerId);
    if (!customer || !customer.phone) continue;
    // ✅ Уважаем тумблер "Разрешить WhatsApp-уведомления" на карточке клиента —
    // раньше эта автоматическая рассылка его вообще не проверяла.
    if (customer.allowWhatsappNotification === false) continue;

    const paymentStates = calculateSalePaymentStates(sale);

    for (const p of paymentStates) {
      const pDate = new Date(p.date);
      pDate.setHours(0, 0, 0, 0);
      const diffDays = Math.ceil((pDate - today) / (1000 * 60 * 60 * 24));

      const isTrigger = reminderTrigger(diffDays, reminderDays);

      const isOverdue = diffDays < 0;
      const isUpcomingOrToday = [0, 1, 3].includes(diffDays);

      if (!isOverdue && !isUpcomingOrToday) continue;
      if (!isTrigger && !isOverdue) continue;

      // По одному платежу — не больше одного напоминания в сутки. Без этой проверки
      // смена времени рассылки в течение дня отправляла клиенту второе сообщение:
      // для «сегодня» и «завтра» дедупликации не было вовсе, а для просрочки она
      // работала только при overdueReminderInterval > 1.
      if (p.lastNotificationDate === todayStr) continue;

      if (isOverdue && settings.overdueReminderInterval > 1) {
        const lastNotif = p.lastNotificationDate ? new Date(p.lastNotificationDate) : null;
        if (lastNotif) {
          const daysSinceLast = Math.floor((today - lastNotif) / (1000 * 60 * 60 * 24));
          if (daysSinceLast < settings.overdueReminderInterval) continue;
        }
      }

      if (!customerReminders[customer.id]) {
        customerReminders[customer.id] = {
          customer,
          items: [],
          totalDueToday: 0,
          totalDueTomorrow: 0,
          totalDueThreeDays: 0,
          totalOverdue: 0,
          paymentsToUpdate: [],
          hasTrigger: false
        };
      }

      const clientData = customerReminders[customer.id];

      if (isTrigger) {
        clientData.hasTrigger = true;
      }

      clientData.items.push({
        saleId: sale.id,
        productName: sale.productName,
        date: p.date,
        remaining: p.remaining,
        originalAmount: p.originalAmount,
        dateObj: p.dateObj,
        diffDays,
        triggerType: isTrigger ? (diffDays === 3 ? 'threeDays' : diffDays === 1 ? 'upcoming' : diffDays === 0 ? 'today' : 'overdue') : 'debt_only'
      });

      if (diffDays < 0) {
        clientData.totalOverdue += p.remaining;
      } else if (diffDays === 0) {
        clientData.totalDueToday += p.remaining;
      } else if (diffDays === 1) {
        clientData.totalDueTomorrow += p.remaining; 
      } else if (diffDays === 3) {
        clientData.totalDueThreeDays += p.remaining;
      }

      if (isTrigger) {
        clientData.paymentsToUpdate.push({ saleId: sale.id, paymentId: p.id, saleRef: sale });
      }
    }
  }

  let sentCount = 0;
  let badPhoneCount = 0;
  let failedCount = 0;
  let isFirstSend = true;

  for (const custId of Object.keys(customerReminders)) {
    const data = customerReminders[custId];

    if (!data.hasTrigger) continue;

    // Один клиент — одно сообщение; новые напоминания за 3 дня отделены
    // от ближайших платежей, чтобы не требовать будущую сумму «сегодня».
    const templates = settings.templates || DEFAULT_TEMPLATES;
    const message = buildCustomerReminderMessage(data, templates);

    // Green API ограничивает частоту отправки: без паузы хвост очереди отбивался ошибками
    if (!isFirstSend) await sleep(1500);
    isFirstSend = false;

    const result = await waTransport.sendText(id, settings, data.customer.phone, message, ` [${id}]`);

    if (!result.ok) {
      if (result.skipped) badPhoneCount++;
      else failedCount++;
      continue;
    }

    // Сообщение уже ушло. Сбой записи отметки не должен обрывать очередь —
    // остальные клиенты этого менеджера иначе остались бы без напоминания.
    for (const ref of data.paymentsToUpdate) {
      const saleInDb = ref.saleRef;
      const payment = saleInDb.paymentPlan.find(p => p.id === ref.paymentId);
      if (!payment) continue;

      payment.lastNotificationDate = todayStr;
      try {
        await pool.query(
          `UPDATE data_items SET data = $1 WHERE id = $2 AND user_id = $3`,
          [JSON.stringify(saleInDb), ref.saleId, id]
        );
      } catch (e) {
        console.error(`${LOG_PREFIX} [${id}] ❌ Не удалось отметить платёж ${ref.paymentId}:`, e.message);
      }
    }
    sentCount++;
  }

  if (sentCount > 0 || badPhoneCount > 0 || failedCount > 0) {
    console.log(
      `${LOG_PREFIX} [${id}] 📊 Отправлено: ${sentCount}` +
      `${badPhoneCount ? `, пропущено по номеру: ${badPhoneCount}` : ''}` +
      `${failedCount ? `, ошибок отправки: ${failedCount}` : ''}`
    );
  }

  if (sentCount > 0 || badPhoneCount > 0) {
    const parts = [`Автоматически отправлено WhatsApp-напоминаний: ${sentCount}`];
    if (badPhoneCount > 0) {
      parts.push(`Не отправлено из-за некорректного номера: ${badPhoneCount} — проверьте карточки клиентов.`);
    }
    await createWhatsAppSentNotification(
      id,
      'Напоминания отправлены',
      parts.join('\n'),
      { sent: sentCount, badPhone: badPhoneCount, failed: failedCount }
    );
  }
}

// 🔔 Напоминания о задачах с наступившим сроком.
// Работает для всех менеджеров на тарифах Бизнес/Бизнес Pro независимо от WhatsApp:
// задачи к рассылке клиентам отношения не имеют, им нужен только push и колокольчик.
async function processTaskReminders() {
  const PLANS_WITH_TASKS = ['BUSINESS', 'BUSINESS_PRO'];
  const nowIso = new Date().toISOString();

  const rows = await pool.query(`
    SELECT d.id, d.user_id, d.data
    FROM data_items d
    JOIN users u ON u.id = d.user_id
    WHERE d.type = 'tasks'
      AND COALESCE((d.data->>'isDone')::boolean, false) = false
      AND d.data->>'dueDate' IS NOT NULL
      AND d.data->>'dueDate' <= $1
      AND d.data->>'notifiedAt' IS NULL
      AND u.subscription->>'plan' = ANY($2)
  `, [nowIso, PLANS_WITH_TASKS]);

  let sent = 0;
  for (const row of rows.rows) {
    const task = row.data;
    // Поручение — исполнителю, личная задача — владельцу
    const recipient = task.assigneeId || row.user_id;

    try {
      const settingsRes = await pool.query(
        `SELECT data FROM data_items WHERE id = $1 AND user_id = $2 AND type = 'settings'`,
        [`settings_${recipient}`, recipient]
      );
      const notif = settingsRes.rows[0]?.data?.notifications;
      const muted = notif?.enabled === false || notif?.events?.taskDue === false;

      if (!muted) {
        const id = `notif_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        await pool.query(
          `INSERT INTO notifications (id, user_id, type, title, body, data)
           VALUES ($1, $2, 'TASK_DUE', $3, $4, $5)`,
          [id, recipient, 'Срок задачи наступил', task.title, JSON.stringify({ taskId: task.id })]
        );
        if (notif?.pushEnabled !== false) {
          await sendPushToUser(recipient, 'Срок задачи наступил', task.title);
        }
        sent++;
      }

      // Отметку ставим даже при выключенных уведомлениях, иначе задача будет
      // перебираться каждые полчаса до самого её выполнения.
      await pool.query(
        `UPDATE data_items SET data = $1 WHERE id = $2 AND user_id = $3`,
        [JSON.stringify({ ...task, notifiedAt: nowIso }), row.id, row.user_id]
      );
    } catch (e) {
      console.error(`${LOG_PREFIX} ❌ Напоминание о задаче ${task.id}:`, e.message);
    }
  }

  if (sent > 0) console.log(`${LOG_PREFIX} 🔔 Напоминаний о задачах: ${sent}`);
}

// Два режима: рассылка клиентам привязана к часу и получасу, поэтому ей хватает запуска
// раз в 30 минут. Срок задачи задаётся с точностью до минуты — её напоминания нужно
// проверять часто, но гонять ради этого опрос WhatsApp-инстансов незачем.
//   --tasks-only  — только напоминания о задачах (частый запуск)
//   --skip-tasks  — только рассылка клиентам
// Без флагов делает и то и другое — чтобы старая строка cron продолжала работать.
const TASKS_ONLY = process.argv.includes('--tasks-only');
const SKIP_TASKS = process.argv.includes('--skip-tasks');

async function runReminders() {
  try {
    if (!TASKS_ONLY) {
      const result = await pool.query(`
        SELECT id, whatsapp_settings
        FROM users
        WHERE role IN ('manager', 'admin')
          AND whatsapp_settings IS NOT NULL
          AND whatsapp_settings->>'enabled' = 'true'
      `);

      for (const user of result.rows) {
        try {
          await processRemindersForUser(user);
        } catch (e) {
          console.error(`${LOG_PREFIX} ❌ Ошибка обработки пользователя ${user.id}:`, e.message);
        }
      }
    }

    // Отдельным блоком: падение напоминаний о задачах не должно ронять рассылку клиентам
    if (!SKIP_TASKS) {
      try {
        await processTaskReminders();
      } catch (e) {
        console.error(`${LOG_PREFIX} ❌ Ошибка напоминаний о задачах:`, e.message);
      }
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} 💥 Критическая ошибка:`, err);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

if (require.main === module) runReminders();
module.exports = { processRemindersForUser };
