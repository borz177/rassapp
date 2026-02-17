// whatsapp-reminders.js
require('dotenv').config({ path: '/var/www/env/rassapp.env' });

const { Pool } = require('pg');
const axios = require('axios');

// === Настройки ===
const GREEN_API_BASE_URL = 'https://api.green-api.com';
const LOG_PREFIX = '[WHATSAPP REMINDERS]';

// === Инициализация БД ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// === Вспомогательные функции ===

/**
 * Отправка WhatsApp-сообщения через Green API
 */
async function sendWhatsAppMessage(idInstance, apiTokenInstance, phone, message) {
  if (!phone || !message) return false;

  // Очистка номера: оставляем только цифры
  const cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length < 10) {
    console.warn(`${LOG_PREFIX} Некорректный номер: ${phone}`);
    return false;
  }

  // Приведение к формату 79XXXXXXXXX (для РФ/КЗ)
  let formattedPhone = cleanPhone;
  if (formattedPhone.startsWith('8')) {
    formattedPhone = '7' + formattedPhone.slice(1);
  } else if (formattedPhone.startsWith('7') || formattedPhone.startsWith('3')) {
    // Оставляем как есть (предполагаем корректный международный формат)
  } else if (formattedPhone.length === 10) {
    // Добавляем код страны по умолчанию (РФ)
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

/**
 * Формирование сообщения о платеже
 */
function buildPaymentMessage(sale, customer, payment, priorDebt, totalToPay, companyName, isDueToday, isOverdue) {
  const dateStr = new Date(payment.date).toLocaleDateString('ru-RU');
  let message = `Здравствуйте, ${customer.name}!`;

  if (isOverdue) {
    message += ` У вас просрочен платёж по договору "${sale.productName}". Дата была: ${dateStr}. Сумма: ${payment.amount.toLocaleString()} ₽.`;
  } else if (isDueToday) {
    message += ` Напоминаем, что сегодня (${dateStr}) день оплаты по договору "${sale.productName}". Сумма текущего платежа: ${payment.amount.toLocaleString()} ₽.`;
  } else {
    message += ` Напоминаем о предстоящем платеже по договору "${sale.productName}". Дата: ${dateStr}. Сумма: ${payment.amount.toLocaleString()} ₽.`;
  }

  if (priorDebt > 0) {
    message += `\n⚠️ Также есть долг за прошлые периоды: ${priorDebt.toLocaleString()} ₽.\n*Всего к оплате: ${totalToPay.toLocaleString()} ₽*.`;
  }

  return message;
}

/**
 * Обработка напоминаний для одного пользователя
 */
async function processRemindersForUser(user) {
  const { id, whatsapp_settings } = user;

  if (!whatsapp_settings?.enabled || !whatsapp_settings.idInstance || !whatsapp_settings.apiTokenInstance) {
    return;
  }

  const settings = whatsapp_settings;
  const [targetHour] = settings.reminderTime.split(':').map(Number); // Используем только час

  // Текущий час по серверному времени (MSK)
  const currentHour = new Date().getHours();

  // Отправляем напоминания ТОЛЬКО в указанный час
  if (currentHour !== targetHour) {
    return;
  }

  console.log(`${LOG_PREFIX} Обработка напоминаний для пользователя ${id} в ${settings.reminderTime}`);

  // Загрузка данных
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
      const diffDays = Math.ceil((paymentDate - today) / (1000 * 60 * 60 * 24));

      if (!settings.reminderDays.includes(diffDays)) continue;

      // Расчёт долга за предыдущие периоды
      const priorDebt = sale.paymentPlan
        .filter(p => !p.isPaid && new Date(p.date) < paymentDate)
        .reduce((sum, p) => sum + p.amount, 0);

      const totalToPay = payment.amount + priorDebt;
      const isDueToday = diffDays === 0;
      const isOverdue = diffDays < 0;

      const message = buildPaymentMessage(
        sale, customer, payment, priorDebt, totalToPay, companyName, isDueToday, isOverdue
      );

      const success = await sendWhatsAppMessage(
        settings.idInstance,
        settings.apiTokenInstance,
        customer.phone,
        message
      );

      if (success) {
        payment.lastNotificationDate = todayStr;
        // Сохраняем обновлённый платёж
        await pool.query(
          `UPDATE data_items SET data = $1 WHERE id = $2 AND user_id = $3`,
          [JSON.stringify(sale), sale.id, id]
        );
        sentCount++;
        console.log(`${LOG_PREFIX} Отправлено напоминание пользователю ${id}, договор: ${sale.productName}`);
      }
    }
  }

  console.log(`${LOG_PREFIX} Завершено для пользователя ${id}: отправлено ${sentCount} напоминаний`);
}

// === Основная функция ===
async function runReminders() {
  console.log(`${LOG_PREFIX} Запуск ежечасной проверки напоминаний...`);

  try {
    const result = await pool.query(`
      SELECT id, whatsapp_settings
      FROM users
      WHERE role IN ('manager', 'admin')
        AND whatsapp_settings IS NOT NULL
        AND whatsapp_settings->>'enabled' = 'true'
    `);

    const users = result.rows;
    console.log(`${LOG_PREFIX} Найдено пользователей с WhatsApp: ${users.length}`);

    for (const user of users) {
      try {
        await processRemindersForUser(user);
      } catch (e) {
        console.error(`${LOG_PREFIX} Ошибка при обработке пользователя ${user.id}:`, e.message);
      }
    }

    console.log(`${LOG_PREFIX} Проверка завершена.`);
  } catch (err) {
    console.error(`${LOG_PREFIX} Критическая ошибка:`, err);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

// === Запуск ===
runReminders();