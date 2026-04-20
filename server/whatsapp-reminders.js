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

async function processRemindersForUser(user) {
  const { id, whatsapp_settings } = user;

  if (!whatsapp_settings?.enabled || !whatsapp_settings.idInstance || !whatsapp_settings.apiTokenInstance) {
    return;
  }

  const settings = whatsapp_settings;
  const targetTime = settings.reminderTime;

  // 🔹 1. СНАЧАЛА определяем даты
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  // 🔹 2. Проверяем время с окном ±5 минут
  const now = new Date();
  const [targetHour, targetMin] = targetTime.split(':').map(Number);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const targetMinutes = targetHour * 60 + targetMin;
  const diffMinutes = Math.abs(nowMinutes - targetMinutes);

  // ✅ Если разница больше 5 минут — пропускаем
  if (diffMinutes > 5) return;

  const [salesRes, customersRes] = await Promise.all([
    pool.query('SELECT data FROM data_items WHERE user_id = $1 AND type = $2', [id, 'sales']),
    pool.query('SELECT data FROM data_items WHERE user_id = $1 AND type = $2', [id, 'customers'])
  ]);

  const sales = salesRes.rows.map(r => r.data);
  const customers = customersRes.rows.map(r => r.data);

  let sentCount = 0;

  // 🔹 ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ: умный расчёт остатков (FIFO)
  // Распределяет реальные оплаты по плановым платежам хронологически
  const calculateEffectiveRemaining = (sale, targetPaymentId) => {
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
    if (!target) return { currentRemaining: 0, priorDebt: 0, totalToPay: 0, firstOverdueDate: null };

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
  };

  for (const sale of sales) {
    if (sale.status !== 'ACTIVE' && sale.status !== 'DRAFT') continue;

    const customer = customers.find(c => c.id === sale.customerId);
    if (!customer || !customer.phone) continue;

    for (const payment of sale.paymentPlan) {
      // 🔹 Пропускаем оплаченные и уже уведомлённые сегодня
       if (payment.isPaid || payment.isRealPayment === true || payment.lastNotificationDate === todayStr) {
    continue;
  }

      const paymentDate = new Date(payment.date);
      paymentDate.setHours(0, 0, 0, 0);

      // 🔹 Рассчитываем разницу в днях
      const diffDays = Math.ceil((paymentDate - today) / (1000 * 60 * 60 * 24));

      // 🔹 Определяем, нужно ли отправлять напоминание
      let shouldSend = false;
      let reminderDay = null;

      if (diffDays === 1 && settings.reminderDays.includes(-1)) {
        shouldSend = true;
        reminderDay = -1;
      }
      else if (diffDays === 0 && settings.reminderDays.includes(0)) {
        shouldSend = true;
        reminderDay = 0;
      }
      else if (diffDays < 0 && settings.reminderDays.includes(1)) {
        shouldSend = true;
        reminderDay = 1;
      }

      if (!shouldSend || reminderDay === null) continue;

      // 🔹 Проверка интервала для просроченных
      if (reminderDay === 1 && settings.overdueReminderInterval > 1) {
        const lastNotif = payment.lastNotificationDate ? new Date(payment.lastNotificationDate) : null;
        if (lastNotif) {
          const daysSinceLast = Math.floor((today - lastNotif) / (1000 * 60 * 60 * 24));
          if (daysSinceLast < settings.overdueReminderInterval) {
            console.log(`${LOG_PREFIX} ⏭ Пропуск: интервал ${settings.overdueReminderInterval}д, прошло ${daysSinceLast}д`);
            continue;
          }
        }
      }

      // 🔹 === НОВЫЙ РАСЧЁТ С УЧЁТОМ ЧАСТИЧНЫХ ОПЛАТ ===
      const { currentRemaining, priorDebt, totalToPay, firstOverdueDate } =
        calculateEffectiveRemaining(sale, payment.id);

      // 🔹 Считаем месяцы просрочки
      let monthsDiff = 0;
      if (priorDebt > 0 && firstOverdueDate) {
        monthsDiff = Math.max(1,
          (today.getFullYear() - firstOverdueDate.getFullYear()) * 12 +
          (today.getMonth() - firstOverdueDate.getMonth()) +
          (today.getDate() >= firstOverdueDate.getDate() ? 1 : 0)
        );
      }

      // 🔹 Определяем сумму для отображения в сообщении
      // Если есть частичная оплата — показываем остаток, иначе полную сумму
      const displayAmount = (currentRemaining > 0 && currentRemaining < payment.amount)
        ? currentRemaining
        : payment.amount;

      // 🔹 Формируем сообщение с правильными цифрами
      const message = buildPaymentMessage(
        sale,
        customer,
        { ...payment, amount: displayAmount }, // Подменяем сумму для отображения
        priorDebt,
        totalToPay,
        reminderDay,
        settings.templates
      );

      const success = await sendWhatsAppMessage(
        settings.idInstance,
        settings.apiTokenInstance,
        customer.phone,
        message
      );

      if (success) {
        // 🔹 Обновляем дату последнего уведомления
        payment.lastNotificationDate = todayStr;
        await pool.query(
          `UPDATE data_items SET data = $1 WHERE id = $2 AND user_id = $3`,
          [JSON.stringify(sale), sale.id, id]
        );
        sentCount++;

        const logType = reminderDay === -1 ? 'заранее' : reminderDay === 0 ? 'сегодня' : 'просрочка';
        const debtInfo = priorDebt > 0 ? ` (долг: ${priorDebt}₽)` : '';
        console.log(`${LOG_PREFIX} ✅ Отправлено ${logType} ${customer.phone} ${debtInfo}`);
      }
    }
  }

  if (sentCount > 0) {
    console.log(`${LOG_PREFIX} 📊 Всего отправлено: ${sentCount}`);
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