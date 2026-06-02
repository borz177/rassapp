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
// 🔹 Формирует объединённое сообщение для клиента
// 🔹 Формирует сообщение на основе СОХРАНЁННЫХ шаблонов
// 🔹 Формирует сообщение на основе СОХРАНЁННЫХ шаблонов
function buildConsolidatedMessage(customerData, totalToPay, templates) {
  const { customer, items } = customerData;
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // 🔹 ВАЖНО: обрабатываем экранированные переносы строк из textarea
  // При сохранении из React textarea "\n" превращается в literal "\\n"
  const normalizeTemplate = (tpl) => {
    if (!tpl) return '';
    return tpl
      .replace(/\\n/g, '\n')      // \n → реальный перенос
      .replace(/\\t/g, '\t')      // \t → табуляция
      .replace(/\\\\/g, '\\');    // \\ → одиночный backslash
  };

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

  // 🔹 Выбираем правильный шаблон
  let template;
  if (isOverdueOnly) {
    template = templates.overdue;
  } else {
    const targetItem = items.find(i => i.diffDays === 1 || i.diffDays === 0);
    template = targetItem?.diffDays === 1 ? templates.upcoming : templates.today;
  }

  // 🔹 Нормализуем шаблон (заменяем \n на реальные переносы)
  let message = normalizeTemplate(template);

  // 🔹 Защита: если шаблон пустой — используем дефолтный
  if (!message) {
    console.warn(`${LOG_PREFIX} ⚠️ Шаблон пустой, используем дефолтный`);
    message = `Здравствуйте, *{имя}*! Напоминаем об оплате: *{сумма} ₽* по договору "{товар}".`;
  }

  // Базовые переменные
  message = message.replace(/{имя}/g, customer.name);

  // Если один товар - показываем его название, иначе "Несколько товаров"
  const productNames = Object.keys(products);
  const productNameStr = productNames.length === 1
    ? productNames[0]
    : `${productNames.length} товаров`;
  message = message.replace(/{товар}/g, productNameStr);

  // Переменные для даты
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

  // Переменные для сумм (берём первый товар для простого шаблона)
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

  // Переменные для месяцев просрочки
  let months = 1;
  if (firstProduct?.firstOverdueDate) {
    months = Math.max(1,
      (today.getFullYear() - firstProduct.firstOverdueDate.getFullYear()) * 12 +
      (today.getMonth() - firstProduct.firstOverdueDate.getMonth()) +
      (today.getDate() >= firstProduct.firstOverdueDate.getDate() ? 1 : 0)
    );
  }
  message = message.replace(/{месяцы}/g, months.toString());

  // 🔹 Формируем блок задолженности (для всех товаров)
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

  // 🔹 Формируем блок итого (если нужно)
  const productsWithDue = Object.values(products).filter(p => p.currentDue > 0).length;
  const hasAnyOverdue = Object.values(products).some(p => p.overdueDebt > 0);

  let totalBlock = '';
  if (totalToPay > 0 && (hasAnyOverdue || productsWithDue > 1)) {
    totalBlock = `\n💰 *ИТОГО К ОПЛАТЕ: ${totalToPay.toLocaleString('ru-RU')} ₽*`;
  }
  message = message.replace(/{итого_блок}/g, totalBlock);

  // 🔹 Формируем блок платежа (если нужно)
  let paymentBlock = '';
  if (!isOverdueOnly && firstProduct?.currentDue > 0) {
    paymentBlock = `   • Платёж по плану: *${firstProduct.originalAmount.toLocaleString('ru-RU')} ₽*\n   • Остаток за этот месяц: *${firstProduct.currentDue.toLocaleString('ru-RU')} ₽*\n`;
  }
  message = message.replace(/{платеж_блок}/g, paymentBlock);

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

      // 🔹 ИЗМЕНЕНИЕ: определяем, является ли платёж триггером для отправки
      let isTrigger = false;
      if (diffDays === 1 && settings.reminderDays.includes(-1)) isTrigger = true;
      else if (diffDays === 0 && settings.reminderDays.includes(0)) isTrigger = true;
      else if (diffDays < 0 && settings.reminderDays.includes(1)) isTrigger = true;

      // 🔹 ИЗМЕНЕНИЕ: добавляем ВСЕ просрочки (даже если триггер не включён)
      // и платежи на сегодня/завтра (если они триггеры)
      const isOverdue = diffDays < 0;
      const isUpcomingOrToday = diffDays === 0 || diffDays === 1;

      if (!isOverdue && !isUpcomingOrToday) continue; // Пропускаем будущие платежи
      if (!isTrigger && !isOverdue) continue; // Пропускаем, если не триггер и не просрочка

      // Проверка интервала для просроченных
      if (isOverdue && settings.overdueReminderInterval > 1) {
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
          paymentsToUpdate: [],
          hasTrigger: false // 🔹 Флаг: есть ли триггер для отправки
        };
      }

      const clientData = customerReminders[customer.id];

      // Если это триггер — помечаем
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

      // Обновляем lastNotificationDate только для триггеров
      if (isTrigger) {
        clientData.paymentsToUpdate.push({ saleId: sale.id, paymentId: p.id, saleRef: sale });
      }
    }
  }

  // Отправка сообщений ТОЛЬКО если есть триггер
  let sentCount = 0;
  for (const custId of Object.keys(customerReminders)) {
    const data = customerReminders[custId];

    // 🔹 ИЗМЕНЕНИЕ: отправляем только если есть триггер (сегодня/завтра/просрочка)
    if (!data.hasTrigger) continue;

    const totalToPay = data.totalDueToday + data.totalOverdue;
    // Получаем шаблоны из настроек или используем дефолтные
const templates = settings.templates || {
  upcoming: `🔔 *Напоминание об оплате*\n\n*{имя}!*\n\n📅 *Завтра*, *{дата}* — день оплаты!\n\n🔸 *{товар}*\n   • К оплате: *{сумма} ₽*\n\n{долг_блок}\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``,
  today: `🔔 *Напоминание об оплате*\n\n*{имя}!*\n\n📅 *Сегодня*, *{дата}* — день оплаты!\n\n🔸 *{товар}*\n   • К оплате: *{сумма} ₽*\n\n{долг_блок}\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``,
  overdue: `🔔 *Напоминание о просрочке*\n\n*{имя}!*\n\n⚠️ Оплата по договору просрочена!\n\n🔸 *{товар}*\n   • Ежемесячный платёж: *{сумма} ₽*\n   • Задолженность: *{долг} ₽* ({месяцы} мес.)\n\n💰 *ИТОГО К ОПЛАТЕ: {итого} ₽*\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``
};

const message = buildConsolidatedMessage(data, totalToPay, templates);

    const success = await sendWhatsAppMessage(
      settings.idInstance,
      settings.apiTokenInstance,
      data.customer.phone,
      message
    );

    if (success) {
      // Обновляем даты уведомлений
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