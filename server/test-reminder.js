// test-reminder.js — ТЕСТОВАЯ версия с поддержкой пользовательских шаблонов
require('dotenv').config({ path: '/var/www/env/rassapp.env' });

const { Pool } = require('pg');
const axios = require('axios');

const GREEN_API_BASE_URL = 'https://api.green-api.com';

// 🔹 ВСТАВЬТЕ СЮДА ID ПОЛЬЗОВАТЕЛЯ ДЛЯ ТЕСТА
const TEST_USER_ID = 'u_1771237064957'; // Замените на реальный ID из вашей БД

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// 🔹 Шаблоны по умолчанию (синхронизированы с whatsapp-reminders.js)
const DEFAULT_TEMPLATES = {
  upcoming: `🔔 *Напоминание об оплате*\n\n*{имя}!*\n\n📅 *Завтра*, *{дата}* — день оплаты!\n\n🔸 *{товар}*\n   • К оплате: *{сумма} ₽*\n\n{долг_блок}\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``,
  today: `🔔 *Напоминание об оплате*\n\n*{имя}!*\n\n📅 *Сегодня*, *{дата}* — день оплаты!\n\n🔸 *{товар}*\n   • К оплате: *{сумма} ₽*\n\n{долг_блок}\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``,
  overdue: `🔔 *Напоминание о просрочке*\n\n*{имя}!*\n\n⚠️ Оплата по договору просрочена!\n\n🔸 *{товар}*\n   • Ежемесячный платёж: *{сумма} ₽*\n   • Задолженность: *{долг} ₽* ({месяцы} мес.)\n\n💰 *ИТОГО К ОПЛАТЕ: {итого} ₽*\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``
};

async function sendWhatsAppMessage(idInstance, apiTokenInstance, phone, message) {
  const cleanPhone = phone.replace(/\D/g, '');
  let formattedPhone = cleanPhone.startsWith('8') ? '7' + cleanPhone.slice(1) : (cleanPhone.length === 10 ? '7' + cleanPhone : cleanPhone);
  const chatId = `${formattedPhone}@c.us`;

  console.log(`\n📤 Отправка сообщения на: ${formattedPhone}`);
  try {
    const response = await axios.post(
      `${GREEN_API_BASE_URL}/waInstance${idInstance}/sendMessage/${apiTokenInstance}`,
      { chatId, message },
      { timeout: 10000 }
    );
    console.log('✅ Сообщение успешно отправлено! ID:', response.data?.idMessage);
    return true;
  } catch (err) {
    console.error('❌ Ошибка отправки:', err.response?.data || err.message);
    return false;
  }
}

function calculateSalePaymentStates(sale) {
  const realPayments = sale.paymentPlan
    .filter(p => p.isRealPayment === true && !p.isRefund)
    .map(p => ({ ...p, dateObj: new Date(p.date), amount: p.amount }))
    .sort((a, b) => a.dateObj - b.dateObj);

  const scheduled = sale.paymentPlan
    .filter(p => p.isRealPayment !== true)
    .map(p => ({ ...p, dateObj: new Date(p.date), originalAmount: p.amount, remaining: p.amount }))
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

// 🔹 Формирует сообщение на основе шаблона (синхронизировано с whatsapp-reminders.js)
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

  // Формируем {товар}
  let productLines = '';
  for (const [name, data] of Object.entries(products)) {
    productLines += `🔸 *${name}*\n`;
    if (data.currentDue > 0) {
      productLines += `   • К оплате: *${data.currentDue.toLocaleString('ru-RU')} ₽*\n`;
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
        productLines += `   • Ежемесячный платёж: *${data.originalAmount.toLocaleString('ru-RU')} ₽*\n`;
      }
      productLines += `   • Задолженность: *${data.overdueDebt.toLocaleString('ru-RU')} ₽* (${months} мес.)\n`;
    }
    productLines += '\n';
  }
  productLines = productLines.trim();

  // Формируем {долг_блок}
  let debtBlock = '';
  if (hasAnyOverdue) {
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
        debtBlock += `   • Задолженность по ${name}: *${data.overdueDebt.toLocaleString('ru-RU')} ₽* (${months} мес.)\n`;
      }
    }
    debtBlock = debtBlock.trim();
  }

  // Формируем {дата}
  let targetDateStr = '';
  if (hasUpcoming) {
    const targetItem = items.find(i => i.diffDays === 1 || i.diffDays === 0);
    if (targetItem) {
      const targetDate = new Date(targetItem.dateObj);
      targetDateStr = targetDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    }
  }

  // Формируем {долг}
  const totalDebt = Object.values(products).reduce((sum, p) => sum + p.overdueDebt, 0);

  // Формируем {месяцы}
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

  // Формируем {итого_блок}
  let totalBlock = '';
  if (totalToPay > 0 && (hasAnyOverdue || productsWithDue > 1)) {
    totalBlock = `\n💰 *ИТОГО К ОПЛАТЕ: ${totalToPay.toLocaleString('ru-RU')} ₽*`;
  }

  // Подставляем переменные в шаблон
  let message = template
    .replace(/{имя}/g, customer.name || 'Клиент')
    .replace(/{товар}/g, productLines)
    .replace(/{сумма}/g, totalToPay.toLocaleString('ru-RU'))
    .replace(/{дата}/g, targetDateStr)
    .replace(/{долг}/g, totalDebt.toLocaleString('ru-RU'))
    .replace(/{месяцы}/g, maxMonths.toString())
    .replace(/{итого}/g, totalToPay.toLocaleString('ru-RU'))
    .replace(/{долг_блок}/g, debtBlock)
    .replace(/{платеж_блок}/g, productLines)
    .replace(/{итого_блок}/g, totalBlock);

  return message;
}

async function runTest() {
  console.log(`\n🚀 Начало тестирования для пользователя: ${TEST_USER_ID}`);

  const userRes = await pool.query('SELECT id, whatsapp_settings FROM users WHERE id = $1', [TEST_USER_ID]);
  if (userRes.rows.length === 0) {
    console.error('❌ Пользователь не найден! Проверьте TEST_USER_ID.');
    return await pool.end();
  }
  const user = userRes.rows[0];
  console.log('✅ Пользователь найден. WhatsApp включен:', user.whatsapp_settings?.enabled);

  const settings = user.whatsapp_settings;

  // 🔹 Используем шаблоны из настроек или дефолтные
  const templates = settings.templates || DEFAULT_TEMPLATES;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  const [salesRes, customersRes] = await Promise.all([
    pool.query('SELECT data FROM data_items WHERE user_id = $1 AND type = $2', [TEST_USER_ID, 'sales']),
    pool.query('SELECT data FROM data_items WHERE user_id = $1 AND type = $2', [TEST_USER_ID, 'customers'])
  ]);

  const sales = salesRes.rows.map(r => r.data);
  const customers = customersRes.rows.map(r => r.data);
  console.log(`📊 Найдено продаж: ${sales.length}, клиентов: ${customers.length}`);

  const customerReminders = {};

  for (const sale of sales) {
    if (sale.status !== 'ACTIVE' && sale.status !== 'DRAFT') continue;
    if (!sale.paymentPlan || sale.paymentPlan.length === 0) continue;

    const customer = customers.find(c => c.id === sale.customerId);
    if (!customer || !customer.phone) continue;

    const paymentStates = calculateSalePaymentStates(sale);

    for (const p of paymentStates) {
      const pDate = new Date(p.date); pDate.setHours(0, 0, 0, 0);
      const diffDays = Math.ceil((pDate - today) / (1000 * 60 * 60 * 24));

      let isTrigger = false;
      if (diffDays === 1 && settings.reminderDays.includes(-1)) isTrigger = true;
      else if (diffDays === 0 && settings.reminderDays.includes(0)) isTrigger = true;
      else if (diffDays < 0 && settings.reminderDays.includes(1)) isTrigger = true;

      const isOverdue = diffDays < 0;
      const isUpcomingOrToday = diffDays === 0 || diffDays === 1;

      if (!isOverdue && !isUpcomingOrToday) continue;
      if (!isTrigger && !isOverdue) continue;

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

      if (isTrigger) customerReminders[customer.id].hasTrigger = true;

      customerReminders[customer.id].items.push({
        productName: sale.productName,
        date: p.date,
        remaining: p.remaining,
        originalAmount: p.originalAmount,
        dateObj: p.dateObj,
        diffDays
      });

      if (diffDays < 0) customerReminders[customer.id].totalOverdue += p.remaining;
      else if (diffDays === 0) customerReminders[customer.id].totalDueToday += p.remaining;

      if (isTrigger) customerReminders[customer.id].paymentsToUpdate.push({ saleId: sale.id, paymentId: p.id, saleRef: sale });
    }
  }

  let sentCount = 0;
  for (const custId of Object.keys(customerReminders)) {
    const data = customerReminders[custId];

    if (!data.hasTrigger) {
      console.log(`\n⏭️ Клиент ${data.customer.name}: нет активных триггеров для отправки.`);
      continue;
    }

    // 🔹 Определяем тип шаблона (синхронизировано с whatsapp-reminders.js)
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
    const message = buildConsolidatedMessage(data, totalToPay, templates, templateType);

    console.log(`\n==================================================`);
    console.log(`📝 СГЕНЕРИРОВАННОЕ СООБЩЕНИЕ для: ${data.customer.name} (${data.customer.phone})`);
    console.log(`Тип шаблона: ${templateType}`);
    console.log(`==================================================\n`);
    console.log(message);
    console.log(`\n==================================================`);

    const success = await sendWhatsAppMessage(settings.idInstance, settings.apiTokenInstance, data.customer.phone, message);

    if (success) {
      for (const ref of data.paymentsToUpdate) {
        const saleInDb = ref.saleRef;
        const payment = saleInDb.paymentPlan.find(p => p.id === ref.paymentId);
        if (payment) {
          payment.lastNotificationDate = todayStr;
          await pool.query(`UPDATE data_items SET data = $1 WHERE id = $2 AND user_id = $3`, [JSON.stringify(saleInDb), ref.saleId, TEST_USER_ID]);
        }
      }
      sentCount++;
    }
  }

  console.log(`\n🏁 Тест завершён. Успешно отправлено: ${sentCount} сообщений.`);
  await pool.end();
}

runTest().catch(console.error);