// Чистые расчёты и текст напоминаний. Импорт не запускает cron и отправку.
const DEFAULT_TEMPLATES = {
  threeDays: `🔔 *Напоминание об оплате*\n\n*{имя}!*\n\n📅 Через *3 дня*, *{дата}* — день оплаты.\n\n{товары_блок}\n\n{итого_блок}`,
  upcoming: `🔔 *Напоминание об оплате*\n\n*{имя}!*\n\n📅 *Завтра*, *{дата}* — день оплаты!\n\n{товары_блок}\n\n{долг_блок}\n\n{итого_блок}\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``,
  today: `🔔 *Напоминание об оплате*\n\n*{имя}!*\n\n📅 *Сегодня*, *{дата}* — день оплаты!\n\n{товары_блок}\n\n{долг_блок}\n\n{итого_блок}\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``,
  overdue: `🔔 *Напоминание о просрочке*\n\n*{имя}!*\n\n⚠️ Оплата по договору просрочена!\n\n{товары_блок}\n\n{долг_блок}\n\n{итого_блок}\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``
};

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

  // Определяем переменные
  const hasUpcoming = items.some(i => [0, 1, 3].includes(i.diffDays));
  const hasAnyOverdue = Object.values(products).some(p => p.overdueDebt > 0);
  const productsWithDue = Object.values(products).filter(p => p.currentDue > 0).length;

  // 🔹 Формируем {товары_блок} — КАЖДЫЙ ТОВАР В ОТДЕЛЬНОЙ СТРОКЕ
  let productsBlock = '';
  const productEntries = Object.entries(products);

  for (let i = 0; i < productEntries.length; i++) {
    const [key, prod] = productEntries[i]; // ← используем prod вместо data
    const isLast = i === productEntries.length - 1;

    productsBlock += `🔸 *${prod.productName}*\n`;

    if (prod.currentDue > 0) {
      productsBlock += `   • К оплате: *${Math.round(prod.currentDue).toLocaleString('ru-RU')} ₽*\n`;
    }

    if (prod.overdueDebt > 0) {
      // ✅ ИСПРАВЛЕННЫЙ РАСЧЁТ МЕСЯЦЕВ ПРОСРОЧКИ
      let months = 0;
      if (prod.firstOverdueDate) {
        months = (today.getFullYear() - prod.firstOverdueDate.getFullYear()) * 12 +
                 (today.getMonth() - prod.firstOverdueDate.getMonth());

        // Если текущий день месяца ещё не наступил — минус 1 месяц
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

    // Разделитель между товарами (кроме последнего)
    if (!isLast) {
      productsBlock += '\n';
    }
  }
  productsBlock = productsBlock.trim();

  // 🔹 Формируем {товар} — список всех названий через запятую
  const productNames = Object.values(products).map(p => p.productName).join(', ');

  // 🔹 Формируем {дата}
  let targetDateStr = '';
  if (hasUpcoming) {
    const targetItem = items.find(i => [0, 1, 3].includes(i.diffDays));
    if (targetItem) {
      const targetDate = new Date(targetItem.dateObj);
      targetDateStr = targetDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    }
  }

  // 🔹 Формируем {долг} — общая сумма долга
  const totalDebt = Object.values(products).reduce((sum, p) => sum + p.overdueDebt, 0);

  // 🔹 Формируем {месяцы} — максимальное количество месяцев просрочки (для шаблона)
  let maxMonths = 0;
  for (const prod of Object.values(products)) {
    if (prod.overdueDebt > 0 && prod.firstOverdueDate) {
      let m = (today.getFullYear() - prod.firstOverdueDate.getFullYear()) * 12 +
              (today.getMonth() - prod.firstOverdueDate.getMonth());
      if (today.getDate() < prod.firstOverdueDate.getDate()) {
        m = Math.max(0, m - 1);
      }
      m = Math.max(1, m);
      if (m > maxMonths) maxMonths = m;
    }
  }

  // 🔹 Формируем {итого_блок}
  let totalBlock = '';
  if (totalToPay > 0 && (hasAnyOverdue || productsWithDue > 1)) {
    totalBlock = `💰 *ИТОГО К ОПЛАТЕ: ${Math.round(totalToPay).toLocaleString('ru-RU')} ₽*`;
  }

  // 🔹 Формируем {сумма}
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
    .replace(/{долг_блок}/g, '')
    .replace(/{итого_блок}/g, totalBlock);

  // Убираем лишние пустые строки (более 2-х подряд)
  message = message.replace(/\n{3,}/g, '\n\n').trim();

  return message;
}

const reminderTrigger = (diffDays, days) => (diffDays === 3 && days.includes(-3))
  || (diffDays === 1 && days.includes(-1)) || (diffDays === 0 && days.includes(0))
  || (diffDays < 0 && days.includes(1));

const templateForDay = day => day === 3 ? 'threeDays' : day === 1 ? 'upcoming' : day === 0 ? 'today' : 'overdue';
const sumItems = items => items.reduce((n,p) => n + p.remaining,0);
const buildCustomerReminderMessage = (data, templates = {}) => {
  const { items } = data;
  if (items.some(p => p.diffDays === 3)) {
    // У одного человека могут быть платежи сегодня, завтра и через три дня.
    // Каждый срок получает свой шаблон и свою сумму; старый долг указан один раз.
    const debt = items.filter(p => p.diffDays < 0);
    const dates = [0,1,3].filter(day => items.some(p => p.diffDays === day));
    return dates.map((day,index) => {
      const group = [...items.filter(p => p.diffDays === day),...(index === 0 ? debt : [])];
      return buildConsolidatedMessage({ ...data, items: group },sumItems(group),templates,templateForDay(day));
    }).join('\n\n────────\n\n');
  }
  // Для ранее доступных вариантов сохраняем прежние шаблоны и объединение.
  const hasToday = items.some(p => p.diffDays === 0), hasTomorrow = items.some(p => p.diffDays === 1);
  const type = hasToday ? 'today' : hasTomorrow ? 'upcoming' : 'overdue';
  const total = data.totalDueToday + data.totalOverdue + data.totalDueTomorrow;
  return buildConsolidatedMessage(data,total,templates,type);
};

module.exports = { DEFAULT_TEMPLATES, calculateSalePaymentStates, buildConsolidatedMessage, buildCustomerReminderMessage, reminderTrigger };
