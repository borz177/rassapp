// whatsapp-reminders.js — КАЖДЫЕ 30 МИНУТ
require('dotenv').config({ path: '/var/www/env/rassapp.env' });

const { Pool } = require('pg');
const axios = require('axios');

const GREEN_API_BASE_URL = 'https://api.green-api.com'; // ← убраны пробелы
const LOG_PREFIX = '[WHATSAPP REMINDERS]';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

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
    console.error(`${LOG_PREFIX} Ошибка отправки WhatsApp на ${phone}:`, err.message);
    return false;
  }
}

function buildPaymentMessage(sale, customer, payment, priorDebt, totalToPay, isDueToday, isOverdue) {
  const dateStr = new Date(payment.date).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  let titleEmoji = '🔔';
  let titleText = 'Напоминание о платеже';

  if (isOverdue) {
    titleEmoji = '⚠️';
    titleText = 'Просроченный платёж';
  } else if (isDueToday) {
    titleEmoji = '📅';
    titleText = 'Сегодня день оплаты';
  }

  let message = `${titleEmoji} *${titleText}*\n\n`;
  message += `Здравствуйте, ${customer.name}!\n`;
  message += `По договору *«${sale.productName}»* `;

  if (isOverdue) {
    message += `просрочен платёж от *${dateStr}*.`;
  } else if (isDueToday) {
    message += `сегодня, *${dateStr}*, необходимо внести платёж.`;
  } else {
    message += `ожидается платёж *${dateStr}*.`;
  }

  message += `\n\n💰 *Сумма платежа:* ${payment.amount.toLocaleString()} ₽`;

  if (priorDebt > 0) {
    message += `\n❗ *Долг за прошлые периоды:* ${priorDebt.toLocaleString()} ₽`;
    message += `\n💳 *Итого к оплате:* ${totalToPay.toLocaleString()} ₽`;
  }

  message += `\n\nБлагодарим за сотрудничество! 🙏`;

  return message;
}

async function processRemindersForUser(user) {
  const { id, whatsapp_settings } = user;

  if (!whatsapp_settings?.enabled || !whatsapp_settings.idInstance || !whatsapp_settings.apiTokenInstance) {
    return;
  }

  const settings = whatsapp_settings;
  const targetTime = settings.reminderTime; // "22:30"

  const now = new Date();
  const currentTime = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;

  // ТОЧНОЕ СРАВНЕНИЕ ВРЕМЕНИ (поддержка :00 и :30)
  if (currentTime !== targetTime) {
    return;
  }

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
      if (payment.isPaid || payment.lastNotificationDate === todayStr) continue;

      const paymentDate = new Date(payment.date);
      paymentDate.setHours(0, 0, 0, 0);
      const daysUntilPayment = Math.ceil((paymentDate - today) / (1000 * 60 * 60 * 24));

      let reminderType;
      if (daysUntilPayment < 0) reminderType = 1;   // просрочка
      else if (daysUntilPayment === 0) reminderType = 0; // сегодня
      else if (daysUntilPayment > 0) reminderType = -1; // за день до

      if (!settings.reminderDays.includes(reminderType)) continue;

      const priorDebt = sale.paymentPlan
        .filter(p => !p.isPaid && new Date(p.date) < paymentDate)
        .reduce((sum, p) => sum + p.amount, 0);

      const totalToPay = payment.amount + priorDebt;
      const isDueToday = daysUntilPayment === 0;
      const isOverdue = daysUntilPayment < 0;

      const message = buildPaymentMessage(
        sale, customer, payment, priorDebt, totalToPay, isDueToday, isOverdue
      );

      const success = await sendWhatsAppMessage(
        settings.idInstance,
        settings.apiTokenInstance,
        customer.phone,
        message
      );

      if (success) {
        payment.lastNotificationDate = todayStr;
        await pool.query(
          `UPDATE data_items SET data = $1 WHERE id = $2 AND user_id = $3`,
          [JSON.stringify(sale), sale.id, id]
        );
        sentCount++;
        console.log(`${LOG_PREFIX} Отправлено напоминание: ${sale.productName}`);
      }
    }
  }

  console.log(`${LOG_PREFIX} Завершено для ${id}: ${sentCount} напоминаний`);
}

async function runReminders() {
  console.log(`${LOG_PREFIX} Запуск...`);

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
        console.error(`${LOG_PREFIX} Ошибка у ${user.id}:`, e.message);
      }
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} Критическая ошибка:`, err);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

runReminders();