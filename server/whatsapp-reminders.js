// whatsapp-reminders.js
require('dotenv').config({ path: '/var/www/env/rassapp.env' });
const { Pool } = require('pg');
const axios = require('axios');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Вспомогательная функция отправки WhatsApp (минималистичная версия)
async function sendWhatsAppMessage(idInstance, apiTokenInstance, phone, message) {
  const cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length < 10) return false;

  const chatId = `${cleanPhone}@c.us`;
  try {
    const response = await axios.post(
      `https://api.green-api.com/waInstance${idInstance}/sendMessage/${apiTokenInstance}`,
      { chatId, message },
      { headers: { 'Content-Type': 'application/json' } }
    );
    return !!response.data?.idMessage;
  } catch (err) {
    console.error(`Failed to send WhatsApp to ${phone}:`, err.message);
    return false;
  }
}

// Основная логика напоминаний
async function processRemindersForUser(user) {
  // 1. Загрузить продажи и клиентов пользователя
  const [salesRes, customersRes] = await Promise.all([
    pool.query('SELECT * FROM data_items WHERE user_id = $1 AND type = $2', [user.id, 'sales']),
    pool.query('SELECT * FROM data_items WHERE user_id = $1 AND type = $2', [user.id, 'customers'])
  ]);

  const sales = salesRes.rows.map(r => r.data);
  const customers = customersRes.rows.map(r => r.data);

  // 2. Парсим настройки WhatsApp
  const settings = typeof user.whatsapp_settings === 'string'
    ? JSON.parse(user.whatsapp_settings)
    : user.whatsapp_settings;

  if (!settings?.enabled || !settings.idInstance || !settings.apiTokenInstance) return;

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const [remHour, remMinute] = settings.reminderTime.split(':').map(Number);
  const now = new Date();
  const reminderTime = new Date();
  reminderTime.setHours(remHour, remMinute, 0, 0);

  if (now < reminderTime) return; // ещё не время

  let updatedSales = [];

  for (const sale of sales) {
    if (sale.status !== 'ACTIVE') continue;
    const customer = customers.find(c => c.id === sale.customerId);
    if (!customer) continue;

    let saleModified = false;
    for (const payment of sale.paymentPlan) {
      if (payment.isPaid || payment.lastNotificationDate === todayStr) continue;

      const paymentDate = new Date(payment.date);
      const diffDays = Math.ceil((paymentDate - today) / (1000 * 60 * 60 * 24));

      if (settings.reminderDays.includes(diffDays)) {
        const message = `Напоминание по договору "${sale.productName}"...`; // ваш шаблон
        const success = await sendWhatsAppMessage(
          settings.idInstance,
          settings.apiTokenInstance,
          customer.phone,
          message
        );

        if (success) {
          payment.lastNotificationDate = todayStr;
          saleModified = true;
        }
      }
    }

    if (saleModified) {
      updatedSales.push(sale);
    }
  }

  // 3. Сохранить обновлённые продажи
  for (const sale of updatedSales) {
    await pool.query(
      `UPDATE data_items SET data = $1 WHERE id = $2 AND user_id = $3`,
      [JSON.stringify(sale), sale.id, user.id]
    );
  }

  console.log(`✅ Processed reminders for user ${user.id}, sent: ${updatedSales.length}`);
}

// Главная функция
async function runReminders() {
  console.log('[WHATSAPP REMINDERS] Starting daily reminder job...');

  try {
    const users = await pool.query(`
      SELECT id, whatsapp_settings FROM users 
      WHERE role IN ('manager', 'admin') AND whatsapp_settings IS NOT NULL
    `);

    for (const user of users.rows) {
      try {
        await processRemindersForUser(user);
      } catch (e) {
        console.error('Error processing reminders for user', user.id, e);
      }
    }

    console.log('[WHATSAPP REMINDERS] Job completed successfully.');
  } catch (err) {
    console.error('[WHATSAPP REMINDERS] Fatal error:', err);
  } finally {
    await pool.end(); // закрыть соединение с БД
    process.exit(0); // завершить скрипт
  }
}

// Запуск
runReminders();