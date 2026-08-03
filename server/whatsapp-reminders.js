// whatsapp-reminders.js — полная версия с поддержкой пользовательских шаблонов
require('dotenv').config({ path: '/var/www/env/rassapp.env' });

const { Pool } = require('pg');
const axios = require('axios');

const GREEN_API_BASE_URL = 'https://api.green-api.com';
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
const DEFAULT_TEMPLATES = {
  upcoming: `🔔 *Напоминание об оплате*\n\n*{имя}!*\n\n📅 *Завтра*, *{дата}* — день оплаты!\n\n{товары_блок}\n\n{долг_блок}\n\n{итого_блок}\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``,
  today: `🔔 *Напоминание об оплате*\n\n*{имя}!*\n\n📅 *Сегодня*, *{дата}* — день оплаты!\n\n{товары_блок}\n\n{долг_блок}\n\n{итого_блок}\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``,
  overdue: `🔔 *Напоминание о просрочке*\n\n*{имя}!*\n\n⚠️ Оплата по договору просрочена!\n\n{товары_блок}\n\n{долг_блок}\n\n{итого_блок}\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

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

const { normalizePhone } = require('./phone-utils');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// { ok, skipped, reason } — skipped означает «не отправляли», а не «ошибка отправки»
async function sendWhatsAppMessage(idInstance, apiTokenInstance, phone, message, logTag = '') {
  if (!message) return { ok: false, skipped: true, reason: 'пустое сообщение' };

  const { phone: formattedPhone, reason } = normalizePhone(phone);
  if (!formattedPhone) {
    console.warn(`${LOG_PREFIX}${logTag} ⚠️ Пропуск, некорректный номер "${phone}": ${reason}`);
    return { ok: false, skipped: true, reason };
  }

  const chatId = `${formattedPhone}@c.us`;
  const url = `${GREEN_API_BASE_URL}/waInstance${idInstance}/sendMessage/${apiTokenInstance}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await axios.post(url, { chatId, message }, { timeout: 15000 });
      if (response.data?.idMessage) return { ok: true, skipped: false, reason: null };
      return { ok: false, skipped: false, reason: 'ответ без idMessage' };
    } catch (err) {
      const status = err.response?.status;
      const body = err.response?.data ? JSON.stringify(err.response.data).slice(0, 300) : '';

      // 4xx — запрос не примут и со второй попытки, повтор только для сети и 5xx
      const retriable = !status || status >= 500;
      if (retriable && attempt === 1) {
        console.warn(`${LOG_PREFIX}${logTag} ↻ Повтор для ${formattedPhone} (${err.message})`);
        await sleep(3000);
        continue;
      }

      console.error(
        `${LOG_PREFIX}${logTag} ❌ Ошибка WhatsApp на ${phone} → ${formattedPhone}: ` +
        `${err.message}${status ? ` | HTTP ${status}` : ''}${body ? ` | ${body}` : ''}`
      );
      return { ok: false, skipped: false, reason: `HTTP ${status || 'network'}` };
    }
  }

  return { ok: false, skipped: false, reason: 'исчерпаны попытки' };
}

// Состояние инстанса. null — проверить не удалось (тогда рассылку не блокируем).
async function getInstanceState(idInstance, apiTokenInstance) {
  try {
    const response = await axios.get(
      `${GREEN_API_BASE_URL}/waInstance${idInstance}/getStateInstance/${apiTokenInstance}`,
      { timeout: 10000 }
    );
    return response.data?.stateInstance || null;
  } catch (err) {
    console.warn(`${LOG_PREFIX} ⚠️ Не удалось проверить инстанс ${idInstance}: ${err.message}`);
    return null;
  }
}

// 🔹 Функция: рассчитывает остатки по ВСЕМ платежам договора (FIFO)
function calculateSalePaymentStates(sale) {
  const realPayments = sale.paymentPlan
    .filter(p => p.isRealPayment === true && !p.isRefund)
    .map(p => ({ ...p, dateObj: new Date(p.date), amount: p.amount }))
    .sort((a, b) => a.dateObj - b.dateObj);

  const scheduled = sale.paymentPlan
    .filter(p => p.isRealPayment !== true)
    .map(p => ({
      ...p,
      dateObj: new Date(p.date),
      originalAmount: p.amount,
      remaining: p.amount
    }))
    .sort((a, b) => a.dateObj - b.dateObj);

  for (const real of realPayments) {
    let moneyLeft = real.amount;
    for (const plan of scheduled) {
      if (moneyLeft <= 0 || plan.remaining <= 0) continue;
      const pay = Math.min(moneyLeft, plan.remaining);
      plan.remaining -= pay;
      moneyLeft -= pay;
    }
  }

  return scheduled.filter(p => p.remaining > 0.01);
}

function buildConsolidatedMessage(customerData, totalToPay, templates, templateType) {
  const { customer, items } = customerData;
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // 🔹 ГРУППИРУЕМ по УНИКАЛЬНОЙ комбинации: saleId + productName
  const products = {};
  items.forEach(item => {
    const uniqueKey = `${item.saleId || ''}_${item.productName}`;
    
    if (!products[uniqueKey]) {
      products[uniqueKey] = {
        productName: item.productName,
        saleId: item.saleId,
        currentDue: 0,
        overdueDebt: 0,
        firstOverdueDate: null,
        originalAmount: item.originalAmount,
        dates: []
      };
    }
    
    if (item.diffDays >= 0) {
      products[uniqueKey].currentDue += item.remaining;
    } else {
      products[uniqueKey].overdueDebt += item.remaining;
      if (!products[uniqueKey].firstOverdueDate || item.dateObj < products[uniqueKey].firstOverdueDate) {
        products[uniqueKey].firstOverdueDate = item.dateObj;
      }
    }
    products[uniqueKey].dates.push(item.date);
  });

  // Выбираем шаблон
  const template = templates[templateType] || DEFAULT_TEMPLATES[templateType] || templates.today || DEFAULT_TEMPLATES.today;

  // Определяем переменные
  const hasUpcoming = items.some(i => i.diffDays === 0 || i.diffDays === 1);
  const hasAnyOverdue = Object.values(products).some(p => p.overdueDebt > 0);
  const productsWithDue = Object.values(products).filter(p => p.currentDue > 0).length;

  // 🔹 Формируем {товары_блок} — КАЖДЫЙ ТОВАР В ОТДЕЛЬНОЙ СТРОКЕ
  let productsBlock = '';
  const productEntries = Object.entries(products);
  
  for (let i = 0; i < productEntries.length; i++) {
    const [key, prod] = productEntries[i]; // ← используем prod вместо data
    const isLast = i === productEntries.length - 1;
    
    productsBlock += `🔸 *${prod.productName}*\n`;
    
    if (prod.currentDue > 0) {
      productsBlock += `   • К оплате: *${Math.round(prod.currentDue).toLocaleString('ru-RU')} ₽*\n`;
    }
    
    if (prod.overdueDebt > 0) {
      // ✅ ИСПРАВЛЕННЫЙ РАСЧЁТ МЕСЯЦЕВ ПРОСРОЧКИ
      let months = 0;
      if (prod.firstOverdueDate) {
        months = (today.getFullYear() - prod.firstOverdueDate.getFullYear()) * 12 +
                 (today.getMonth() - prod.firstOverdueDate.getMonth());
        
        // Если текущий день месяца ещё не наступил — минус 1 месяц
        if (today.getDate() < prod.firstOverdueDate.getDate()) {
          months = Math.max(0, months - 1);
        }
      }
      months = Math.max(1, months); // Минимум 1 месяц, если есть долг

      if (templateType === 'overdue') {
        productsBlock += `   • Ежемесячный платёж: *${Math.round(prod.originalAmount).toLocaleString('ru-RU')} ₽*\n`;
      }
      productsBlock += `   • Задолженность: *${Math.round(prod.overdueDebt).toLocaleString('ru-RU')} ₽* (${months} мес.)\n`;
    }
    
    // Разделитель между товарами (кроме последнего)
    if (!isLast) {
      productsBlock += '\n';
    }
  }
  productsBlock = productsBlock.trim();

  // 🔹 Формируем {товар} — список всех названий через запятую
  const productNames = Object.values(products).map(p => p.productName).join(', ');

  // 🔹 Формируем {дата}
  let targetDateStr = '';
  if (hasUpcoming) {
    const targetItem = items.find(i => i.diffDays === 1 || i.diffDays === 0);
    if (targetItem) {
      const targetDate = new Date(targetItem.dateObj);
      targetDateStr = targetDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    }
  }

  // 🔹 Формируем {долг} — общая сумма долга
  const totalDebt = Object.values(products).reduce((sum, p) => sum + p.overdueDebt, 0);

  // 🔹 Формируем {месяцы} — максимальное количество месяцев просрочки (для шаблона)
  let maxMonths = 0;
  for (const prod of Object.values(products)) {
    if (prod.overdueDebt > 0 && prod.firstOverdueDate) {
      let m = (today.getFullYear() - prod.firstOverdueDate.getFullYear()) * 12 +
              (today.getMonth() - prod.firstOverdueDate.getMonth());
      if (today.getDate() < prod.firstOverdueDate.getDate()) {
        m = Math.max(0, m - 1);
      }
      m = Math.max(1, m);
      if (m > maxMonths) maxMonths = m;
    }
  }

  // 🔹 Формируем {итого_блок}
  let totalBlock = '';
  if (totalToPay > 0 && (hasAnyOverdue || productsWithDue > 1)) {
    totalBlock = `💰 *ИТОГО К ОПЛАТЕ: ${Math.round(totalToPay).toLocaleString('ru-RU')} ₽*`;
  }

  // 🔹 Формируем {сумма}
  const totalAmount = Math.round(totalToPay).toLocaleString('ru-RU');

  // 🔹 Подставляем переменные в шаблон
  let message = template
    .replace(/{имя}/g, customer.name || 'Клиент')
    .replace(/{товар}/g, productNames)
    .replace(/{сумма}/g, totalAmount)
    .replace(/{дата}/g, targetDateStr)
    .replace(/{долг}/g, Math.round(totalDebt).toLocaleString('ru-RU'))
    .replace(/{месяцы}/g, maxMonths.toString())
    .replace(/{итого}/g, Math.round(totalToPay).toLocaleString('ru-RU'))
    .replace(/{товары_блок}/g, productsBlock)
    .replace(/{долг_блок}/g, '')
    .replace(/{итого_блок}/g, totalBlock);

  // Убираем лишние пустые строки (более 2-х подряд)
  message = message.replace(/\n{3,}/g, '\n\n').trim();

  return message;
}
async function processRemindersForUser(user) {
  const { id, whatsapp_settings } = user;

  if (!whatsapp_settings?.enabled || !whatsapp_settings.idInstance || !whatsapp_settings.apiTokenInstance) {
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

  const state = await getInstanceState(settings.idInstance, settings.apiTokenInstance);
  if (state && state !== 'authorized') {
    console.warn(`${LOG_PREFIX} [${id}] ⛔ Инстанс не авторизован (${state}) — рассылка пропущена`);
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

      let isTrigger = false;
      if (diffDays === 1 && reminderDays.includes(-1)) isTrigger = true;
      else if (diffDays === 0 && reminderDays.includes(0)) isTrigger = true;
      else if (diffDays < 0 && reminderDays.includes(1)) isTrigger = true;

      const isOverdue = diffDays < 0;
      const isUpcomingOrToday = diffDays === 0 || diffDays === 1;

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
        triggerType: isTrigger ? (diffDays === 1 ? 'upcoming' : diffDays === 0 ? 'today' : 'overdue') : 'debt_only'
      });

      if (diffDays < 0) {
        clientData.totalOverdue += p.remaining;
      } else if (diffDays === 0) {
        clientData.totalDueToday += p.remaining;
      } else if (diffDays === 1) {
        clientData.totalDueTomorrow += p.remaining; 
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

    // 🔹 Определяем тип шаблона
    let templateType = 'today';
    const hasToday = data.items.some(i => i.diffDays === 0);
    const hasUpcoming = data.items.some(i => i.diffDays === 1);
    const hasOverdue = data.items.some(i => i.diffDays < 0);

    if (hasOverdue && !hasToday && !hasUpcoming) {
      templateType = 'overdue';
    } else if (hasToday) {
      templateType = 'today';
    } else if (hasUpcoming) {
      templateType = 'upcoming';
    }

    const totalToPay = data.totalDueToday + data.totalOverdue + data.totalDueTomorrow;

    // 🔹 Используем шаблоны из настроек или дефолтные
    const templates = settings.templates || DEFAULT_TEMPLATES;
    const message = buildConsolidatedMessage(data, totalToPay, templates, templateType);

    // Green API ограничивает частоту отправки: без паузы хвост очереди отбивался ошибками
    if (!isFirstSend) await sleep(1500);
    isFirstSend = false;

    const result = await sendWhatsAppMessage(
      settings.idInstance,
      settings.apiTokenInstance,
      data.customer.phone,
      message,
      ` [${id}]`
    );

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

async function runReminders() {
  try {
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
  } catch (err) {
    console.error(`${LOG_PREFIX} 💥 Критическая ошибка:`, err);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

runReminders();