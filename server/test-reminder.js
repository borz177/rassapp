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
  upcoming: `🔔 *Напоминание об оплате*\n\n*{имя}!*\n\n📅 *Завтра*, *{дата}* — день оплаты!\n\n{товары_блок}\n\n{долг_блок}\n\n{итого_блок}\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``,
  today: `🔔 *Напоминание об оплате*\n\n*{имя}!*\n\n📅 *Сегодня*, *{дата}* — день оплаты!\n\n{товары_блок}\n\n{долг_блок}\n\n{итого_блок}\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``,
  overdue: `🔔 *Напоминание о просрочке*\n\n*{имя}!*\n\n⚠️ Оплата по договору просрочена!\n\n{товары_блок}\n\n{долг_блок}\n\n{итого_блок}\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``
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

// 🔹 ИСПРАВЛЕННАЯ ФУНКЦИЯ: каждый товар в отдельной строке
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

  const hasUpcoming = items.some(i => i.diffDays === 0 || i.diffDays === 1);
  const hasAnyOverdue = Object.values(products).some(p => p.overdueDebt > 0);
  const productsWithDue = Object.values(products).filter(p => p.currentDue > 0).length;

  // 🔹 Формируем {товары_блок}
  let productsBlock = '';
  const productEntries = Object.entries(products);
  
  for (let i = 0; i < productEntries.length; i++) {
    const [key, prod] = productEntries[i]; // ← заменили data на prod
    const isLast = i === productEntries.length - 1;
    
    productsBlock += `🔸 *${prod.productName}*\n`;
    
    if (prod.currentDue > 0) {
      productsBlock += `   • К оплате: *${Math.round(prod.currentDue).toLocaleString('ru-RU')} ₽*\n`;
    }
    
    if (prod.overdueDebt > 0) {
      // ✅ ИСПРАВЛЕННЫЙ РАСЧЁТ МЕСЯЦЕВ
      let months = 0;
      if (prod.firstOverdueDate) {
        months = (today.getFullYear() - prod.firstOverdueDate.getFullYear()) * 12 +
                 (today.getMonth() - prod.firstOverdueDate.getMonth());
        
        // Если текущий день месяца ещё не наступил относительно дня просрочки
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
    
    if (!isLast) productsBlock += '\n';
  }
  productsBlock = productsBlock.trim();

  // Переменные для шаблона
  const productNames = Object.values(products).map(p => p.productName).join(', ');
  
  let targetDateStr = '';
  if (hasUpcoming) {
    const targetItem = items.find(i => i.diffDays === 1 || i.diffDays === 0);
    if (targetItem) {
      targetDateStr = new Date(targetItem.dateObj).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    }
  }

  const totalDebt = Object.values(products).reduce((sum, p) => sum + p.overdueDebt, 0);

  // 🔹 Максимальные месяцы просрочки для {месяцы}
  let maxMonths = 0;
  for (const prod of Object.values(products)) { // ← заменили data на prod
    if (prod.overdueDebt > 0 && prod.firstOverdueDate) {
      let m = (today.getFullYear() - prod.firstOverdueDate.getFullYear()) * 12 +
              (today.getMonth() - prod.firstOverdueDate.getMonth());
      if (today.getDate() < prod.firstOverdueDate.getDate()) m = Math.max(0, m - 1);
      m = Math.max(1, m);
      if (m > maxMonths) maxMonths = m;
    }
  }

  let totalBlock = '';
  if (totalToPay > 0 && (hasAnyOverdue || productsWithDue > 1)) {
    totalBlock = `💰 *ИТОГО К ОПЛАТЕ: ${Math.round(totalToPay).toLocaleString('ru-RU')} ₽*`;
  }

  const totalAmount = Math.round(totalToPay).toLocaleString('ru-RU');

  // Подстановка в шаблон
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

  return message.replace(/\n{3,}/g, '\n\n').trim();
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

      // 🔹 ДОБАВЛЕНО: saleId для уникальной идентификации товара
      customerReminders[customer.id].items.push({
        saleId: sale.id,  // ← КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ
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