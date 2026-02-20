// whatsapp-reminders.js — с учётом задолженности и цитатой
require('dotenv').config({ path: '/var/www/env/rassapp.env' });

const { Pool } = require('pg');
const axios = require('axios');

const GREEN_API_BASE_URL = 'https://api.green-api.com';
const LOG_PREFIX = '[WHATSAPP REMINDERS]';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Стандартные шаблоны (как в UI)
const DEFAULT_TEMPLATES = {
  today: `🔔 *Напоминание об оплате*\n\n*{имя}!*\n\n📅 Сегодня *{дата}* — день оплаты!\n\n🔸 *{товар}*\n   • К оплате: *{сумма} ₽*\n\n{долг_блок}\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``,
  overdue: `🔔 *Напоминание об оплате*\n\n*{имя}!*\n\n📅 Сегодня *{дата}* — день оплаты!\n\n🔸 *{товар}*\n   • Ежемесячный платёж: *{сумма} ₽*\n   • Задолженность: *{долг} ₽* ({месяцы} мес.)\n\n💰 *ИТОГО К ОПЛАТЕ: {итого} ₽*\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``
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

function buildPaymentMessage(sale, customer, payment, priorDebt, totalToPay, isDueToday, isOverdue, userTemplates) {
  const dateStr = new Date(payment.date).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  // Расчёт количества месяцев просрочки (для долга)
  let monthsDiff = 0;
  if (priorDebt > 0) {
    const now = new Date();
    const paymentDate = new Date(payment.date);
    monthsDiff = Math.max(0, now.getMonth() - paymentDate.getMonth() + (now.getFullYear() - paymentDate.getFullYear()) * 12);
    // Но если платёж был в этом месяце, но не оплачен — это 1 месяц просрочки
    if (monthsDiff === 0 && now.getDate() > paymentDate.getDate()) {
      monthsDiff = 1;
    }
  }

  const currentAmountStr = payment.amount.toLocaleString();
  const debtStr = priorDebt.toLocaleString();
  const totalStr = totalToPay.toLocaleString();
  const monthsStr = monthsDiff.toString();

  const debtBlock = priorDebt > 0
    ? `   • Задолженность: *${debtStr} ₽* (${monthsStr} мес.)\n💰 *ИТОГО К ОПЛАТЕ: ${totalStr} ₽*`
    : '';

  // Выбираем шаблон
  let template = userTemplates?.today || DEFAULT_TEMPLATES.today;
  if (isOverdue && userTemplates?.overdue) {
    template = userTemplates.overdue;
  } else if (isOverdue) {
    template = DEFAULT_TEMPLATES.overdue;
  }

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
      if (payment.isPaid || payment.lastNotificationDate === todayStr) continue;

      const paymentDate = new Date(payment.date);
      paymentDate.setHours(0, 0, 0, 0);
      const diffDays = Math.ceil((paymentDate - today) / (1000 * 60 * 60 * 24));

      // 🔑 Точная логика:
      let shouldSend = false;
      if (diffDays === 0 && settings.reminderDays.includes(0)) {
        shouldSend = true; // В день оплаты
      } else if (diffDays === -1 && settings.reminderDays.includes(-1)) {
        shouldSend = true; // За 1 день до
      } else if (diffDays < 0 && settings.reminderDays.includes(1)) {
        shouldSend = true; // При просрочке
      }

      if (!shouldSend) continue;

      // Расчёт задолженности: сумма всех неплатёжей **до этой даты**
      const priorDebt = sale.paymentPlan
        .filter(p => !p.isPaid && new Date(p.date) < paymentDate)
        .reduce((sum, p) => sum + p.amount, 0);

      const totalToPay = payment.amount + priorDebt;
      const isDueToday = diffDays === 0;
      const isOverdue = diffDays < 0;

      const message = buildPaymentMessage(
        sale, customer, payment, priorDebt, totalToPay,
        isDueToday, isOverdue,
        settings.templates
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
        console.log(`${LOG_PREFIX} Отправлено напоминание: ${sale.productName} (платёж на ${payment.date})`);
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