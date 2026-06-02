// whatsapp-reminders.js — полная версия с поддержкой пользовательских шаблонов
require('dotenv').config({ path: '/var/www/env/rassapp.env' });

const { Pool } = require('pg');
const axios = require('axios');

const GREEN_API_BASE_URL = 'https://api.green-api.com';
const LOG_PREFIX = '[WHATSAPP REMINDERS]';

// 🔹 Шаблоны по умолчанию (копия из фронтенда)
const DEFAULT_TEMPLATES = {
  upcoming: `🔔 *Напоминание об оплате*\n\n*{имя}!*\n\n📅 *Завтра*, *{дата}* — день оплаты!\n\n{товары_блок}\n\n{долг_блок}\n\n{итого_блок}\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``,
  today: `🔔 *Напоминание об оплате*\n\n*{имя}!*\n\n📅 *Сегодня*, *{дата}* — день оплаты!\n\n{товары_блок}\n\n{долг_блок}\n\n{итого_блок}\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``,
  overdue: `🔔 *Напоминание о просрочке*\n\n*{имя}!*\n\n⚠️ Оплата по договору просрочена!\n\n{товары_блок}\n\n{долг_блок}\n\n{итого_блок}\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``
};

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

  // Группируем по товарам
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

  // Выбираем шаблон
  const template = templates[templateType] || DEFAULT_TEMPLATES[templateType] || templates.today || DEFAULT_TEMPLATES.today;

  // Определяем переменные
  const hasUpcoming = items.some(i => i.diffDays === 0 || i.diffDays === 1);
  const hasAnyOverdue = Object.values(products).some(p => p.overdueDebt > 0);
  const productsWithDue = Object.values(products).filter(p => p.currentDue > 0).length;

  // 🔹 Формируем {товары_блок} — ПОЛНЫЙ блок со ВСЕМИ товарами
  let productsBlock = '';
  for (const [name, data] of Object.entries(products)) {
    productsBlock += `🔸 *${name}*\n`;
    if (data.currentDue > 0) {
      // 🔹 Math.round() делает число целым
      productsBlock += `   • К оплате: *${Math.round(data.currentDue).toLocaleString('ru-RU')} ₽*\n`;
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
      if (templateType === 'overdue') {
        productsBlock += `   • Ежемесячный платёж: *${Math.round(data.originalAmount).toLocaleString('ru-RU')} ₽*\n`;
      }
      productsBlock += `   • Задолженность: *${Math.round(data.overdueDebt).toLocaleString('ru-RU')} ₽* (${months} мес.)\n`;
    }
    productsBlock += '\n';
  }
  productsBlock = productsBlock.trim();

  // 🔹 Формируем {товар} — список всех названий через запятую
  const productNames = Object.keys(products).join(', ');

  // 🔹 Формируем {долг_блок} — блок с задолженностью по всем товарам
  let debtBlock = '';
  if (hasAnyOverdue) {
    debtBlock = '💳 *Задолженность:*\n';
    for (const [name, data] of Object.entries(products)) {
      if (data.overdueDebt > 0) {
        let months = 1;
        if (data.firstOverdueDate) {
          months = Math.max(1,
            (today.getFullYear() - data.firstOverdueDate.getFullYear()) * 12 +
            (today.getMonth() - data.firstOverdueDate.getMonth()) +
            (today.getDate() >= data.firstOverdueDate.getDate() ? 1 : 0)
          );
        }
        debtBlock += `   • ${name}: *${Math.round(data.overdueDebt).toLocaleString('ru-RU')} ₽* (${months} мес.)\n`;
      }
    }
    debtBlock = debtBlock.trim();
  }

  // 🔹 Формируем {дата}
  let targetDateStr = '';
  if (hasUpcoming) {
    const targetItem = items.find(i => i.diffDays === 1 || i.diffDays === 0);
    if (targetItem) {
      const targetDate = new Date(targetItem.dateObj);
      targetDateStr = targetDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    }
  }

  // 🔹 Формируем {долг} — общая сумма долга (целое число)
  const totalDebt = Object.values(products).reduce((sum, p) => sum + p.overdueDebt, 0);

  // 🔹 Формируем {месяцы} — максимальное количество месяцев просрочки
  let maxMonths = 0;
  for (const data of Object.values(products)) {
    if (data.overdueDebt > 0 && data.firstOverdueDate) {
      const months = Math.max(1,
        (today.getFullYear() - data.firstOverdueDate.getFullYear()) * 12 +
        (today.getMonth() - data.firstOverdueDate.getMonth()) +
        (today.getDate() >= data.firstOverdueDate.getDate() ? 1 : 0)
      );
      if (months > maxMonths) maxMonths = months;
    }
  }

  // 🔹 Формируем {итого_блок}
  let totalBlock = '';
  if (totalToPay > 0 && (hasAnyOverdue || productsWithDue > 1)) {
    totalBlock = `💰 *ИТОГО К ОПЛАТЕ: ${Math.round(totalToPay).toLocaleString('ru-RU')} ₽*`;
  }

  // 🔹 Формируем {сумма} — общая сумма (целое число)
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
    .replace(/{долг_блок}/g, debtBlock)
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

      let isTrigger = false;
      if (diffDays === 1 && settings.reminderDays.includes(-1)) isTrigger = true;
      else if (diffDays === 0 && settings.reminderDays.includes(0)) isTrigger = true;
      else if (diffDays < 0 && settings.reminderDays.includes(1)) isTrigger = true;

      const isOverdue = diffDays < 0;
      const isUpcomingOrToday = diffDays === 0 || diffDays === 1;

      if (!isOverdue && !isUpcomingOrToday) continue;
      if (!isTrigger && !isOverdue) continue;

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
      }

      if (isTrigger) {
        clientData.paymentsToUpdate.push({ saleId: sale.id, paymentId: p.id, saleRef: sale });
      }
    }
  }

  let sentCount = 0;
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

    const totalToPay = data.totalDueToday + data.totalOverdue;

    // 🔹 Используем шаблоны из настроек или дефолтные
    const templates = settings.templates || DEFAULT_TEMPLATES;
    const message = buildConsolidatedMessage(data, totalToPay, templates, templateType);

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