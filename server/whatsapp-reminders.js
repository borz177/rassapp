// whatsapp-reminders.js — полная версия с корректной логикой напоминаний
require('dotenv').config({ path: '/var/www/env/rassapp.env' });

const { Pool } = require('pg');
const axios = require('axios');

const GREEN_API_BASE_URL = 'https://api.green-api.com';
const LOG_PREFIX = '[WHATSAPP REMINDERS]';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// 🔹 ШАБЛОНЫ С ЦИТАТОЙ ИЗ КОРАНА
// Логика отображения:
// - Без задолженности: только "К оплате: {сумма} ₽"
// - С задолженностью: "Ежемесячный платёж" + "Задолженность" + "ИТОГО К ОПЛАТЕ"
const DEFAULT_TEMPLATES = {
  // 🔹 ЗАРАНЕЕ: за 1 день до оплаты (diffDays = 1)
  upcoming: `🔔 *Напоминание об оплате*\n\n*{имя}!*\n\n📅 *Завтра*, *{дата}* — день оплаты!\n\n🔸 *{товар}*\n{платеж_блок}\n{долг_блок}{итого_блок}\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``,

  // 🔹 СЕГОДНЯ: в день оплаты (diffDays = 0)
  today: `🔔 *Напоминание об оплате*\n\n*{имя}!*\n\n📅 *Сегодня*, *{дата}* — день оплаты!\n\n🔸 *{товар}*\n{платеж_блок}\n{долг_блок}{итого_блок}\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``,

  // 🔹 ПРОСРОЧКА: после даты оплаты (diffDays < 0)
  overdue: `🔔 *Напоминание о просрочке*\n\n*{имя}!*\n\n⚠️ Оплата по договору просрочена!\n\n🔸 *{товар}*\n   • Ежемесячный платёж: *{сумма} ₽*\n   • Задолженность: *{долг} ₽* ({месяцы} мес.)\n\n💰 *ИТОГО К ОПЛАТЕ: {итого} ₽*\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``
};

// 🔹 Маппинг дней напоминаний на ключи шаблонов
const REMINDER_DAY_TO_TEMPLATE = {
  '-1': 'upcoming',  // За 1 день
  '0': 'today',      // В день оплаты
  '1': 'overdue'     // При просрочке
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
    .replace(/{платеж_блок}/g, data.платеж_блок || '')
    .replace(/{долг_блок}/g, data.долг_блок || '')
    .replace(/{итого_блок}/g, data.итого_блок || '');
}

// 🔹 Выбирает шаблон по reminderDay
function getTemplateByReminderDay(reminderDay, userTemplates) {
  const templateKey = REMINDER_DAY_TO_TEMPLATE[reminderDay] || 'today';

  return userTemplates?.[templateKey]
    || DEFAULT_TEMPLATES[templateKey]
    || DEFAULT_TEMPLATES.today;
}

function buildPaymentMessage(sale, customer, payment, priorDebt, totalToPay, reminderDay, userTemplates) {
  const dateStr = new Date(payment.date).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  const currentAmountStr = payment.amount.toLocaleString('ru-RU');
  const debtStr = priorDebt.toLocaleString('ru-RU');
  const totalStr = totalToPay.toLocaleString('ru-RU');

  // Считаем месяцы просрочки "на лету", если не передали
  let monthsStr = '0';
  if (priorDebt > 0) {
    // Простая эвристика: если долг есть, считаем от первой просрочки
    const overdue = sale.paymentPlan
      .filter(p => p.isRealPayment !== true && !p.isPaid && new Date(p.date) < new Date())
      .sort((a,b) => new Date(a.date) - new Date(b.date))[0];
    if (overdue) {
      const diffMonths = Math.floor((new Date() - new Date(overdue.date)) / (1000*60*60*24*30));
      monthsStr = Math.max(1, diffMonths).toString();
    }
  }

  // 🔹 Формируем блоки
  const hasDebt = priorDebt > 0;

  // Если сумма к показу меньше плановой — значит, есть частичная оплата
  const isPartial = payment.amount < (sale.paymentPlan.find(p => p.id === payment.id)?.amount || payment.amount);

  let paymentBlock = '';
  if (hasDebt || isPartial) {
    paymentBlock = `   • Платёж по графику: *${currentAmountStr} ₽*\n`;
    if (isPartial) {
      paymentBlock += `   • ⚠️ Остаток к доплате: *${payment.amount} ₽*\n`;
    }
  } else {
    paymentBlock = `   • К оплате: *${currentAmountStr} ₽*\n`;
  }

  const debtBlock = hasDebt
    ? `   • Задолженность: *${debtStr} ₽* (${monthsStr} мес.)\n`
    : '';

  // 🔹 ИТОГО показываем, если есть хоть какой-то долг
  const totalBlock = totalToPay > 0
    ? `\n💰 *ИТОГО К ОПЛАТЕ: ${totalStr} ₽*`
    : '';

  const template = getTemplateByReminderDay(reminderDay, userTemplates);

  return formatTemplate(template, {
    customerName: customer.name,
    productName: sale.productName,
    currentAmountStr,
    dateStr,
    debtStr,
    totalStr,
    monthsStr,
    платеж_блок: paymentBlock,
    долг_блок: debtBlock,
    итого_блок: totalBlock
  });
}



// 🔹 Функция "умного" расчёта остатка без поля paidAmount
// Распределяет реальные оплаты (isRealPayment: true) по плановым платежам хронологически
function calculateEffectiveRemaining(sale, targetPaymentId) {
  const now = new Date();

  // 1. Собираем ВСЕ реальные поступления (деньги, которые клиент фактически внёс)
  const realPayments = sale.paymentPlan
    .filter(p => p.isRealPayment === true && !p.isRefund)
    .map(p => ({ ...p, dateObj: new Date(p.date), allocated: 0 }))
    .sort((a, b) => a.dateObj - b.dateObj); // Сортируем по дате: старые сначала

  // 2. Собираем плановые платежи (график)
  const scheduledPayments = sale.paymentPlan
    .filter(p => p.isRealPayment !== true)
    .map(p => ({ ...p, dateObj: new Date(p.date), remaining: p.amount }))
    .sort((a, b) => a.dateObj - b.dateObj);

  // 3. Алгоритм FIFO: "гасим" старые долги новыми деньгами
  for (const real of realPayments) {
    let moneyLeft = real.amount;

    for (const plan of scheduledPayments) {
      if (moneyLeft <= 0) break;
      if (plan.remaining <= 0) continue;

      // Сколько можем погасить этим платежом
      const pay = Math.min(moneyLeft, plan.remaining);
      plan.remaining -= pay;
      moneyLeft -= pay;
    }
  }

  // 4. Находим целевой платёж (по которому отправляем напоминание)
  const target = scheduledPayments.find(p => p.id === targetPaymentId);
  if (!target) return { currentRemaining: 0, priorDebt: 0, totalToPay: 0 };

  const currentRemaining = Math.max(0, target.remaining);

  // 5. Считаем задолженность по ПРОШЛЫМ платежам (дата < сегодня)
  let priorDebt = 0;
  let firstOverdueDate = null;

  for (const p of scheduledPayments) {
    if (p.id === targetPaymentId) continue; // Сам текущий платёж не включаем в "долг"

    if (p.dateObj < now && p.remaining > 0.01) {
      priorDebt += p.remaining;
      if (!firstOverdueDate || p.dateObj < firstOverdueDate) {
        firstOverdueDate = p.dateObj;
      }
    }
  }

  // 6. ИТОГО = текущий остаток + старый долг
  return {
    currentRemaining,
    priorDebt,
    totalToPay: currentRemaining + priorDebt,
    firstOverdueDate
  };
}



// 🔹 Функция 1: Рассчитывает остатки по ВСЕМ платежам договора (FIFO)
// Возвращает массив плановых платежей с актуальным полем remaining
// 🔹 1. Рассчитывает остатки, но сохраняет ОРИГИНАЛЬНУЮ сумму платежа
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
      originalAmount: p.amount, // 🔹 Сохраняем фиксированную сумму из графика
      remaining: p.amount 
    }))
    .sort((a, b) => a.dateObj - b.dateObj);

  // FIFO
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

// 🔹 2. Формирует сообщение ТОЧНО по вашему шаблону
function buildConsolidatedMessage(customerData, totalToPay) {
  const { customer, items } = customerData;
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // 🔹 1. Определяем режим сообщения
  const hasUpcoming = items.some(i => i.diffDays === 0 || i.diffDays === 1);
  const isOverdueOnly = !hasUpcoming; // true, если в списке ТОЛЬКО просроченные платежи

  // 🔹 2. Группируем по товарам (чтобы не было дублей)
  const products = {};
  items.forEach(item => {
    if (!products[item.productName]) {
      products[item.productName] = {
        currentDue: 0,           // Сумма на сегодня/завтра
        overdueDebt: 0,          // Сумма просрочки
        firstOverdueDate: null,  // Дата самой первой просрочки (для расчёта месяцев)
        originalAmount: item.originalAmount // Фиксированный платёж из графика
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

  // 🔹 3. Заголовок (меняется динамически)
  let message = `🔔 *Напоминание ${isOverdueOnly ? 'о просрочке' : 'об оплате'}*\n\n*${customer.name}!*\n\n`;

  // 🔹 4. Блок даты (показывается ТОЛЬКО если есть Сегодня/Завтра)
  if (hasUpcoming) {
    const targetItem = items.find(i => i.diffDays === 1 || i.diffDays === 0);
    const targetDate = new Date(targetItem.dateObj);
    const dateStr = targetDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    const dayWord = targetItem.diffDays === 0 ? 'Сегодня' : 'Завтра';
    message += `📅 *${dayWord}*, *${dateStr}* — день оплаты!\n\n`;
  }

  // 🔹 5. Блоки товаров
  for (const [name, data] of Object.entries(products)) {
    message += `🔸 *${name}*\n`;

    // Если платёж на сегодня/завтра → показываем "К оплате"
    if (data.currentDue > 0) {
      message += `   • К оплате: *${data.currentDue.toLocaleString('ru-RU')} ₽*\n`;
    }

    // Если есть просрочка → всегда показываем долг
    if (data.overdueDebt > 0) {
      let months = 1;
      if (data.firstOverdueDate) {
        months = Math.max(1,
          (today.getFullYear() - data.firstOverdueDate.getFullYear()) * 12 +
          (today.getMonth() - data.firstOverdueDate.getMonth()) +
          (today.getDate() >= data.firstOverdueDate.getDate() ? 1 : 0)
        );
      }

      // В режиме "ТОЛЬКО просрочка" добавляем строку с фиксированным платежом
      if (isOverdueOnly) {
        message += `   • ежемесячный платеж: *${data.originalAmount.toLocaleString('ru-RU')} ₽*\n`;
      }

      message += `   • Задолженность: *${data.overdueDebt.toLocaleString('ru-RU')} ₽* (${months} мес.)\n`;
    }
    message += `\n`;
  }

  // 🔹 6. ИТОГО (всегда показывает полную сумму к оплате)
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

  // 🔹 Проверка времени ±5 мин
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

  // 🔹 Хранилище для группировки по клиентам
  const customerReminders = {};

  for (const sale of sales) {
    if (sale.status !== 'ACTIVE' && sale.status !== 'DRAFT') continue;
    if (!sale.paymentPlan || sale.paymentPlan.length === 0) continue;

    const customer = customers.find(c => c.id === sale.customerId);
    if (!customer || !customer.phone) continue;

    // 1. Рассчитываем актуальные остатки по всем платежам этого договора
    const paymentStates = calculateSalePaymentStates(sale);

    // 2. Находим платежи, подходящие под текущие настройки напоминаний
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

      // 3. Группируем данные по клиенту
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
        originalAmount: p.originalAmount, // 🔹 Добавлено
        dateObj: p.dateObj,
        diffDays,
        triggerType
      });

      // Считаем суммы для ИТОГО
      if (diffDays < 0) {
        clientData.totalOverdue += p.remaining;
      } else if (diffDays === 0) {
        clientData.totalDueToday += p.remaining;
      }

      // Сохраняем ссылки для обновления lastNotificationDate
      clientData.paymentsToUpdate.push({ saleId: sale.id, paymentId: p.id, saleRef: sale });
    }
  }

  // 🔹 Отправляем ОДНО сообщение на каждого клиента
  let sentCount = 0;
  for (const custId of Object.keys(customerReminders)) {
    const data = customerReminders[custId];

    // ✅ КЛЮЧЕВОЕ: ИТОГО = Сегодняшний платёж + Вся просрочка
    const totalToPay = data.totalDueToday + data.totalOverdue;

    const message = buildConsolidatedMessage(data, totalToPay, settings);
    const success = await sendWhatsAppMessage(
      settings.idInstance,
      settings.apiTokenInstance,
      data.customer.phone,
      message
    );

    if (success) {
      // Обновляем даты уведомлений в БД
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