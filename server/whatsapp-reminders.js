// whatsapp-reminders.js — с поддержкой 3 шаблонов и корректной логикой
require('dotenv').config({ path: '/var/www/env/rassapp.env' });

const { Pool } = require('pg');
const axios = require('axios');

const GREEN_API_BASE_URL = 'https://api.green-api.com';
const LOG_PREFIX = '[WHATSAPP REMINDERS]';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// 🔹 ОБНОВЛЁННЫЕ ШАБЛОНЫ: 3 варианта с цитатой из Корана
// Маппинг reminderDay → шаблон:
// -1 = upcoming ("Завтра"), 0 = today ("Сегодня"), 1 = overdue ("Просрочка")
const DEFAULT_TEMPLATES = {
  // 🔹 ЗАРАНЕЕ: напоминание за 1 день до оплаты
  upcoming: `🔔 *Напоминание об оплате*\n\n*{имя}!*\n\n📅 *Завтра*, *{дата}* — день оплаты!\n\n🔸 *{товар}*\n   • К оплате: *{сумма} ₽*\n\n{долг_блок}\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``,

  // 🔹 СЕГОДНЯ: оплата в день платежа
  today: `🔔 *Напоминание об оплате*\n\n*{имя}!*\n\n📅 *Сегодня*, *{дата}* — день оплаты!\n\n🔸 *{товар}*\n   • К оплате: *{сумма} ₽*\n\n{долг_блок}\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``,

  // 🔹 ПРОСРОЧКА: уведомление о задолженности
  overdue: `🔔 *Напоминание о просрочке*\n\n*{имя}!*\n\n⚠️ Оплата по договору просрочена!\n\n🔸 *{товар}*\n   • Ежемесячный платёж: *{сумма} ₽*\n   • Задолженность: *{долг} ₽* ({месяцы} мес.)\n\n💰 *ИТОГО К ОПЛАТЕ: {итого} ₽*\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``
};

// 🔹 Маппинг дней напоминаний на ключи шаблонов
const REMINDER_DAY_TO_TEMPLATE = {
  '-1': 'upcoming',  // За 1 день
  '0': 'today',      // В день оплаты
  '1': 'overdue'     // При просрочке
};

async function sendWhatsAppMessage(idInstance, apiTokenInstance, phone, message) {
  if (!phone || !message) return false;

  const cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length < 10) {
    console.warn(`${LOG_PREFIX} Некорректный номер: ${phone}`);
    return false;
  }

  let formattedPhone = cleanPhone;
  if (formattedPhone.startsWith('8')) {
    formattedPhone = '7' + formattedPhone.slice(1);
  } else if (formattedPhone.length === 10) {
    formattedPhone = '7' + formattedPhone;
  }

  const chatId = `${formattedPhone}@c.us`;

  try {
    const response = await axios.post(
      `${GREEN_API_BASE_URL}/waInstance${idInstance}/sendMessage/${apiTokenInstance}`,
      { chatId, message },
      { timeout: 10000 }
    );
    return !!response.data?.idMessage;
  } catch (err) {
    console.error(`${LOG_PREFIX} Ошибка WhatsApp на ${phone}:`, err.message);
    return false;
  }
}

function formatTemplate(template, data) {
  return template
    .replace(/{имя}/g, data.customerName || '')
    .replace(/{товар}/g, data.productName || '')
    .replace(/{сумма}/g, data.currentAmountStr || '')
    .replace(/{дата}/g, data.dateStr || '')
    .replace(/{долг}/g, data.debtStr || '0')
    .replace(/{итого}/g, data.totalStr || '0')
    .replace(/{месяцы}/g, data.monthsStr || '0')
    .replace(/{долг_блок}/g, data.debtBlock || '');
}

// 🔹 ОБНОВЛЁННАЯ функция: выбирает шаблон по reminderDay
function getTemplateByReminderDay(reminderDay, userTemplates) {
  const templateKey = REMINDER_DAY_TO_TEMPLATE[reminderDay] || 'today';

  // Приоритет: пользовательский шаблон → дефолтный для типа → fallback на today
  return userTemplates?.[templateKey]
    || DEFAULT_TEMPLATES[templateKey]
    || DEFAULT_TEMPLATES.today;
}

function buildPaymentMessage(sale, customer, payment, priorDebt, totalToPay, reminderDay, userTemplates) {
  const dateStr = new Date(payment.date).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  // 🔹 Рассчитываем количество месяцев просрочки
  let monthsDiff = 0;
  if (priorDebt > 0) {
    const now = new Date();
    const paymentDate = new Date(payment.date);
    monthsDiff = Math.max(0,
      (now.getFullYear() - paymentDate.getFullYear()) * 12 +
      (now.getMonth() - paymentDate.getMonth())
    );
    if (monthsDiff === 0 && now.getDate() > paymentDate.getDate()) {
      monthsDiff = 1;
    }
  }

  const currentAmountStr = payment.amount.toLocaleString('ru-RU');
  const debtStr = priorDebt.toLocaleString('ru-RU');
  const totalStr = totalToPay.toLocaleString('ru-RU');
  const monthsStr = monthsDiff.toString();

  // 🔹 Формируем блок задолженности (показывается в upcoming/today, если есть долг)
  const debtBlock = priorDebt > 0
    ? `⚠️ *Задолженность: ${debtStr} ₽* (${monthsStr} мес.)\n`
    : '';

  // 🔹 Выбираем шаблон по reminderDay (-1/0/1)
  const template = getTemplateByReminderDay(reminderDay, userTemplates);

  const data = {
    customerName: customer.name,
    productName: sale.productName,
    currentAmountStr,
    dateStr,
    debtStr,
    totalStr,
    monthsStr,
    debtBlock
  };

  return formatTemplate(template, data);
}

async function processRemindersForUser(user) {
  const { id, whatsapp_settings } = user;

  if (!whatsapp_settings?.enabled || !whatsapp_settings.idInstance || !whatsapp_settings.apiTokenInstance) {
    return;
  }

  const settings = whatsapp_settings;
  const targetTime = settings.reminderTime;
  const now = new Date();
  const currentTime = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;

  // 🔹 Проверяем время запуска (точное совпадение)
  if (currentTime !== targetTime) return;

  console.log(`${LOG_PREFIX} Обработка напоминаний для пользователя ${id} в ${targetTime}`);

  const [salesRes, customersRes] = await Promise.all([
    pool.query('SELECT data FROM data_items WHERE user_id = $1 AND type = $2', [id, 'sales']),
    pool.query('SELECT data FROM data_items WHERE user_id = $1 AND type = $2', [id, 'customers'])
  ]);

  const sales = salesRes.rows.map(r => r.data);
  const customers = customersRes.rows.map(r => r.data);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  let sentCount = 0;

  for (const sale of sales) {
    if (sale.status !== 'ACTIVE') continue;

    const customer = customers.find(c => c.id === sale.customerId);
    if (!customer || !customer.phone) continue;

    for (const payment of sale.paymentPlan) {
      // 🔹 Пропускаем оплаченные и уже уведомлённые сегодня
      if (payment.isPaid || payment.lastNotificationDate === todayStr) continue;

      const paymentDate = new Date(payment.date);
      paymentDate.setHours(0, 0, 0, 0);

      // 🔹 Рассчитываем разницу в днях:
      // diffDays = 0 → сегодня, -1 → завтра, <0 → просрочено
      const diffDays = Math.ceil((paymentDate - today) / (1000 * 60 * 60 * 24));

      // 🔹 Определяем, нужно ли отправлять напоминание
      let shouldSend = false;
      let reminderDay = null;

      if (diffDays === -1 && settings.reminderDays.includes(-1)) {
        // 🔹 ЗАРАНЕЕ: завтра день оплаты
        shouldSend = true;
        reminderDay = -1;
      } else if (diffDays === 0 && settings.reminderDays.includes(0)) {
        // 🔹 СЕГОДНЯ: день оплаты
        shouldSend = true;
        reminderDay = 0;
      } else if (diffDays < 0 && settings.reminderDays.includes(1)) {
        // 🔹 ПРОСРОЧКА: платеж уже просрочен
        shouldSend = true;
        reminderDay = 1;
      }

      if (!shouldSend || reminderDay === null) continue;

      // 🔹 Рассчитываем задолженность (все неоплаченные платежи до текущего)
      const priorDebt = sale.paymentPlan
        .filter(p => !p.isPaid && new Date(p.date) < paymentDate)
        .reduce((sum, p) => sum + p.amount, 0);

      const totalToPay = payment.amount + priorDebt;

      // 🔹 Формируем сообщение с правильным шаблоном
      const message = buildPaymentMessage(
        sale,
        customer,
        payment,
        priorDebt,
        totalToPay,
        reminderDay,  // 🔹 Передаём -1/0/1 для выбора шаблона
        settings.templates
      );

      const success = await sendWhatsAppMessage(
        settings.idInstance,
        settings.apiTokenInstance,
        customer.phone,
        message
      );

      if (success) {
        // 🔹 Обновляем дату последнего уведомления, чтобы не спамить
        payment.lastNotificationDate = todayStr;
        await pool.query(
          `UPDATE data_items SET data = $1 WHERE id = $2 AND user_id = $3`,
          [JSON.stringify(sale), sale.id, id]
        );
        sentCount++;
        console.log(`${LOG_PREFIX} ✅ Отправлено (${reminderDay === -1 ? 'заранее' : reminderDay === 0 ? 'сегодня' : 'просрочка'}): ${customer.name} — ${sale.productName}`);
      }
    }
  }

  console.log(`${LOG_PREFIX} Завершено для ${id}: ${sentCount} напоминаний отправлено`);
}

async function runReminders() {
  console.log(`${LOG_PREFIX} 🚀 Запуск скрипта напоминаний...`);

  try {
    const result = await pool.query(`
      SELECT id, whatsapp_settings
      FROM users
      WHERE role IN ('manager', 'admin')
        AND whatsapp_settings IS NOT NULL
        AND whatsapp_settings->>'enabled' = 'true'
    `);

    console.log(`${LOG_PREFIX} Найдено ${result.rows.length} пользователей с включёнными напоминаниями`);

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
    console.log(`${LOG_PREFIX} 🏁 Скрипт завершён`);
    process.exit(0);
  }
}

runReminders();