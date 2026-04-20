// whatsapp-reminders.js — полная версия с корректной логикой напоминаний
require('dotenv').config({ path: '/var/www/env/rassapp.env' });

const { Pool } = require('pg');
const axios = require('axios');

const GREEN_API_BASE_URL = 'https://api.green-api.com';
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
    console.error(`${LOG_PREFIX} Ошибка WhatsApp на ${phone}:`, err.message);
    return false;
  }
}

// 🔹 Функция: рассчитывает остатки по ВСЕМ платежам договора (FIFO)
// Сохраняет оригинальную сумму платежа из графика
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
      originalAmount: p.amount, // Фиксированная сумма из графика
      remaining: p.amount
    }))
    .sort((a, b) => a.dateObj - b.dateObj);

  // FIFO: распределяем реальные оплаты по плановым платежам
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

// 🔹 Формирует объединённое сообщение для клиента
function buildConsolidatedMessage(customerData, totalToPay) {
  const { customer, items } = customerData;
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // Определяем режим сообщения
  const hasUpcoming = items.some(i => i.diffDays === 0 || i.diffDays === 1);
  const isOverdueOnly = !hasUpcoming;

  // Группируем по товарам (без дублей)
  const products = {};
  items.forEach(item => {
    if (!products[item.productName]) {
      products[item.productName] = {
        currentDue: 0,
        overdueDebt: 0,
        firstOverdueDate: null,
        originalAmount: item.originalAmount
      };
    }
    if (item.diffDays >= 0) {
      products[item.productName].currentDue += item.remaining;
    } else {
      products[item.productName].overdueDebt += item.remaining;
      if (!products[item.productName].firstOverdueDate || item.dateObj < products[item.productName].firstOverdueDate) {
        products[item.productName].firstOverdueDate = item.dateObj;
      }
    }
  });

  // Заголовок
  let message = `🔔 *Напоминание ${isOverdueOnly ? 'о просрочке' : 'об оплате'}*\n\n*${customer.name}!*\n\n`;

  // Блок даты (только если есть Сегодня/Завтра)
  if (hasUpcoming) {
    const targetItem = items.find(i => i.diffDays === 1 || i.diffDays === 0);
    const targetDate = new Date(targetItem.dateObj);
    const dateStr = targetDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    const dayWord = targetItem.diffDays === 0 ? 'Сегодня' : 'Завтра';
    message += `📅 *${dayWord}*, *${dateStr}* — день оплаты!\n\n`;
  }

  // Блоки товаров
  for (const [name, data] of Object.entries(products)) {
    message += `🔸 *${name}*\n`;

    if (data.currentDue > 0) {
      message += `   • К оплате: *${data.currentDue.toLocaleString('ru-RU')} ₽*\n`;
    }

    if (data.overdueDebt > 0) {
      let months = 1;
      if (data.firstOverdueDate) {
        months = Math.max(1,
          (today.getFullYear() - data.firstOverdueDate.getFullYear()) * 12 +
          (today.getMonth() - data.firstOverdueDate.getMonth()) +
          (today.getDate() >= data.firstOverdueDate.getDate() ? 1 : 0)
        );
      }

      // В режиме "ТОЛЬКО просрочка" показываем фиксированный платёж
      if (isOverdueOnly) {
        message += `   • ежемесячный платеж: *${data.originalAmount.toLocaleString('ru-RU')} ₽*\n`;
      }

      message += `   • Задолженность: *${data.overdueDebt.toLocaleString('ru-RU')} ₽* (${months} мес.)\n`;
    }
    message += `\n`;
  }

  // ИТОГО
  if (totalToPay > 0) {
    message += `💰 *ИТОГО К ОПЛАТЕ: ${totalToPay.toLocaleString('ru-RU')} ₽*\n\n`;
  }

  message += `\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``;
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

  // Проверка времени ±5 мин
  const now = new Date();
  const [targetHour, targetMin] = settings.reminderTime.split(':').map(Number);
  const diffMinutes = Math.abs((now.getHours() * 60 + now.getMinutes()) - (targetHour * 60 + targetMin));
  if (diffMinutes > 5) return;

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

    const paymentStates = calculateSalePaymentStates(sale);

    for (const p of paymentStates) {
      const pDate = new Date(p.date);
      pDate.setHours(0, 0, 0, 0);
      const diffDays = Math.ceil((pDate - today) / (1000 * 60 * 60 * 24));

      let triggerType = null;
      if (diffDays === 1 && settings.reminderDays.includes(-1)) triggerType = 'upcoming';
      else if (diffDays === 0 && settings.reminderDays.includes(0)) triggerType = 'today';
      else if (diffDays < 0 && settings.reminderDays.includes(1)) triggerType = 'overdue';

      if (!triggerType) continue;

      // Проверка интервала для просроченных
      if (triggerType === 'overdue' && settings.overdueReminderInterval > 1) {
        const lastNotif = p.lastNotificationDate ? new Date(p.lastNotificationDate) : null;
        if (lastNotif) {
          const daysSinceLast = Math.floor((today - lastNotif) / (1000 * 60 * 60 * 24));
          if (daysSinceLast < settings.overdueReminderInterval) continue;
        }
      }

      // Группировка по клиенту
      if (!customerReminders[customer.id]) {
        customerReminders[customer.id] = {
          customer,
          items: [],
          totalDueToday: 0,
          totalOverdue: 0,
          paymentsToUpdate: []
        };
      }

      const clientData = customerReminders[customer.id];
      clientData.items.push({
        productName: sale.productName,
        date: p.date,
        remaining: p.remaining,
        originalAmount: p.originalAmount,
        dateObj: p.dateObj,
        diffDays,
        triggerType
      });

      if (diffDays < 0) {
        clientData.totalOverdue += p.remaining;
      } else if (diffDays === 0) {
        clientData.totalDueToday += p.remaining;
      }

      clientData.paymentsToUpdate.push({ saleId: sale.id, paymentId: p.id, saleRef: sale });
    }
  }

  // Отправка сообщений
  let sentCount = 0;
  for (const custId of Object.keys(customerReminders)) {
    const data = customerReminders[custId];
    const totalToPay = data.totalDueToday + data.totalOverdue;

    // 🔹 ИСПРАВЛЕНО: убран лишний параметр settings
    const message = buildConsolidatedMessage(data, totalToPay);

    const success = await sendWhatsAppMessage(
      settings.idInstance,
      settings.apiTokenInstance,
      data.customer.phone,
      message
    );

    if (success) {
      for (const ref of data.paymentsToUpdate) {
        const saleInDb = ref.saleRef;
        const payment = saleInDb.paymentPlan.find(p => p.id === ref.paymentId);
        if (payment) {
          payment.lastNotificationDate = todayStr;
          await pool.query(
            `UPDATE data_items SET data = $1 WHERE id = $2 AND user_id = $3`,
            [JSON.stringify(saleInDb), ref.saleId, id]
          );
        }
      }
      sentCount++;
    }
  }

  if (sentCount > 0) {
    console.log(`${LOG_PREFIX} 📊 Отправлено объединённых сообщений: ${sentCount}`);
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