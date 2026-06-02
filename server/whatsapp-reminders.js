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

// 🔹 НОРМАЛИЗАЦИЯ шаблона: превращает literal "\n" в реальные переносы
function normalizeTemplate(tpl) {
  if (!tpl) return '';
  return tpl
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

// 🔹 Формирует объединённое сообщение для клиента
// 🔹 ИЗМЕНЕНИЕ: добавлен параметр templates
function buildConsolidatedMessage(customerData, totalToPay, templates) {
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

  // 🔹 ИЗМЕНЕНИЕ: выбираем шаблон и подставляем переменные
  let template;
  if (isOverdueOnly) {
    template = templates?.overdue;
  } else {
    const targetItem = items.find(i => i.diffDays === 1 || i.diffDays === 0);
    template = targetItem?.diffDays === 1 ? templates?.upcoming : templates?.today;
  }

  let message = normalizeTemplate(template);

  // Если шаблон есть — подставляем переменные
  if (message) {
    // Базовые переменные
    message = message.replace(/{имя}/g, customer.name);

    const productNames = Object.keys(products);
    const productNameStr = productNames.length === 1
      ? productNames[0]
      : `${productNames.length} товаров`;
    message = message.replace(/{товар}/g, productNameStr);

    // Дата
    if (!isOverdueOnly) {
      const targetItem = items.find(i => i.diffDays === 1 || i.diffDays === 0);
      const targetDate = new Date(targetItem.dateObj);
      const dateStr = targetDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
      const dayWord = targetItem.diffDays === 0 ? 'Сегодня' : 'Завтра';
      message = message.replace(/{дата}/g, dateStr);
      message = message.replace(/{день}/g, dayWord);
    } else {
      message = message.replace(/{дата}/g, '');
      message = message.replace(/{день}/g, '');
    }

    // Суммы
    const firstProduct = Object.values(products)[0];
    const sumStr = firstProduct?.currentDue > 0
      ? firstProduct.currentDue.toLocaleString('ru-RU')
      : firstProduct?.originalAmount?.toLocaleString('ru-RU') || '0';
    message = message.replace(/{сумма}/g, sumStr);

    const debtStr = firstProduct?.overdueDebt > 0
      ? firstProduct.overdueDebt.toLocaleString('ru-RU')
      : '0';
    message = message.replace(/{долг}/g, debtStr);
    message = message.replace(/{итого}/g, totalToPay.toLocaleString('ru-RU'));

    // Месяцы просрочки
    let months = 1;
    if (firstProduct?.firstOverdueDate) {
      months = Math.max(1,
        (today.getFullYear() - firstProduct.firstOverdueDate.getFullYear()) * 12 +
        (today.getMonth() - firstProduct.firstOverdueDate.getMonth()) +
        (today.getDate() >= firstProduct.firstOverdueDate.getDate() ? 1 : 0)
      );
    }
    message = message.replace(/{месяцы}/g, months.toString());

    // Блок задолженности
    let debtBlock = '';
    for (const [name, data] of Object.entries(products)) {
      if (data.overdueDebt > 0) {
        let itemMonths = 1;
        if (data.firstOverdueDate) {
          itemMonths = Math.max(1,
            (today.getFullYear() - data.firstOverdueDate.getFullYear()) * 12 +
            (today.getMonth() - data.firstOverdueDate.getMonth()) +
            (today.getDate() >= data.firstOverdueDate.getDate() ? 1 : 0)
          );
        }
        debtBlock += `   • ${name}: *${data.overdueDebt.toLocaleString('ru-RU')} ₽* (${itemMonths} мес.)\n`;
      }
    }
    message = message.replace(/{долг_блок}/g, debtBlock || '');

    // Блок итого
    const productsWithDue = Object.values(products).filter(p => p.currentDue > 0).length;
    const hasAnyOverdue = Object.values(products).some(p => p.overdueDebt > 0);
    let totalBlock = '';
    if (totalToPay > 0 && (hasAnyOverdue || productsWithDue > 1)) {
      totalBlock = `\n💰 *ИТОГО К ОПЛАТЕ: ${totalToPay.toLocaleString('ru-RU')} ₽*`;
    }
    message = message.replace(/{итого_блок}/g, totalBlock);

    // Блок платежа
    let paymentBlock = '';
    if (!isOverdueOnly && firstProduct?.currentDue > 0) {
      paymentBlock = `   • Платёж по плану: *${firstProduct.originalAmount.toLocaleString('ru-RU')} ₽*\n   • Остаток за этот месяц: *${firstProduct.currentDue.toLocaleString('ru-RU')} ₽*\n`;
    }
    message = message.replace(/{платеж_блок}/g, paymentBlock);

    return message;
  }

  // 🔹 FALLBACK: если шаблона нет — используем старую логику
  message = `🔔 *Напоминание ${isOverdueOnly ? 'о просрочке' : 'об оплате'}*\n\n*${customer.name}!*\n\n`;

  if (hasUpcoming) {
    const targetItem = items.find(i => i.diffDays === 1 || i.diffDays === 0);
    const targetDate = new Date(targetItem.dateObj);
    const dateStr = targetDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    const dayWord = targetItem.diffDays === 0 ? 'Сегодня' : 'Завтра';
    message += `📅 *${dayWord}*, *${dateStr}* — день оплаты!\n\n`;
  }

  if (isOverdueOnly) {
    message += `⚠️ Оплата по договору просрочена!\n\n`;
  }

  for (const [name, data] of Object.entries(products)) {
    message += `🔸 *${name}*\n`;

    if (data.currentDue > 0) {
      message += `   • К оплате: *${data.currentDue.toLocaleString('ru-RU')} ₽*\n\n`;
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

      if (isOverdueOnly) {
        message += `   • Ежемесячный платёж: *${data.originalAmount.toLocaleString('ru-RU')} ₽*\n`;
      }

      message += `   • Задолженность: *${data.overdueDebt.toLocaleString('ru-RU')} ₽* (${months} мес.)\n`;
    }
    message += `\n`;
  }

  const productsWithDue = Object.values(products).filter(p => p.currentDue > 0).length;
  const hasAnyOverdue = Object.values(products).some(p => p.overdueDebt > 0);

  if (totalToPay > 0 && (hasAnyOverdue || productsWithDue > 1)) {
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

  // 🔹 ИЗМЕНЕНИЕ: безопасная проверка времени (защита от undefined)
  const reminderTime = settings.reminderTime || '10:00';
  const now = new Date();
  const [targetHour, targetMin] = reminderTime.split(':').map(Number);
  const diffMinutes = Math.abs((now.getHours() * 60 + now.getMinutes()) - (targetHour * 60 + targetMin));
  if (diffMinutes > 5) return;

  const [salesRes, customersRes] = await Promise.all([
    pool.query('SELECT data FROM data_items WHERE user_id = $1 AND type = $2', [id, 'sales']),
    pool.query('SELECT data FROM data_items WHERE user_id = $1 AND type = $2', [id, 'customers'])
  ]);

  const sales = salesRes.rows.map(r => r.data);
  const customers = customersRes.rows.map(r => r.data);

  const customerReminders = {};

  // 🔹 ИЗМЕНЕНИЕ: безопасное получение reminderDays
  const reminderDays = settings.reminderDays || [0];
  const overdueInterval = settings.overdueReminderInterval || 1;

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
      if (diffDays === 1 && reminderDays.includes(-1)) isTrigger = true;
      else if (diffDays === 0 && reminderDays.includes(0)) isTrigger = true;
      else if (diffDays < 0 && reminderDays.includes(1)) isTrigger = true;

      const isOverdue = diffDays < 0;
      const isUpcomingOrToday = diffDays === 0 || diffDays === 1;

      if (!isOverdue && !isUpcomingOrToday) continue;
      if (!isTrigger && !isOverdue) continue;

      if (isOverdue && overdueInterval > 1) {
        const lastNotif = p.lastNotificationDate ? new Date(p.lastNotificationDate) : null;
        if (lastNotif) {
          const daysSinceLast = Math.floor((today - lastNotif) / (1000 * 60 * 60 * 24));
          if (daysSinceLast < overdueInterval) continue;
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

    const totalToPay = data.totalDueToday + data.totalOverdue;

    // 🔹 ИЗМЕНЕНИЕ: передаём шаблоны из настроек пользователя
    const message = buildConsolidatedMessage(data, totalToPay, settings.templates);

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
    // 🔹 ИЗМЕНЕНИЕ: поддержка ID пользователя из аргументов
    const specificUserId = process.argv[2];

    let query = `
      SELECT id, whatsapp_settings
      FROM users
      WHERE role IN ('manager', 'admin')
        AND whatsapp_settings IS NOT NULL
        AND whatsapp_settings->>'enabled' = 'true'
    `;

    const params = [];

    if (specificUserId) {
      query += ` AND id = $1`;
      params.push(specificUserId);
      console.log(`${LOG_PREFIX} 🎯 ЗАПУСК ДЛЯ ПОЛЬЗОВАТЕЛЯ: ${specificUserId}`);
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      console.log(`${LOG_PREFIX} ⚠️ Пользователи не найдены`);
      return;
    }

    console.log(`${LOG_PREFIX} 👥 Найдено пользователей: ${result.rows.length}`);

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