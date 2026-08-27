// В проде переменные лежат в /var/www/env/rassapp.env; локально (Windows/dev) такого пути нет —
// в этом случае просто откатываемся к обычному поиску .env рядом с проектом (server/.env).
require('dotenv').config(
  require('fs').existsSync('/var/www/env/rassapp.env')
    ? { path: '/var/www/env/rassapp.env' }
    : {}
);
// FORCE TIMEZONE TO MOSCOW
process.env.TZ = 'Europe/Moscow';

console.log('Server Timezone:', new Date().toString());

const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');
const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const axios = require('axios');
const { normalizePhone } = require('./phone-utils');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const fsPromises = fs.promises;
const sharp = require('sharp');

// 🔔 Push-уведомления на устройство (Web Push) — необязательная фича, и пакет, и ключи могут
// отсутствовать (например, сразу после деплоя нового кода до `npm install` на сервере).
// require() и настройка обёрнуты так, чтобы это НИКОГДА не роняло весь бэкенд — раньше
// отсутствующий пакет валил весь процесс на старте (MODULE_NOT_FOUND), из-за чего переставали
// работать вообще все эндпоинты, включая регистрацию/логин, до ручного npm install.
let webpush = null;
try {
  webpush = require('web-push');
} catch (e) {
  console.warn('⚠️ Пакет web-push не установлен (npm install в server/) — push-уведомления отключены');
}
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const PUSH_ENABLED = !!(webpush && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (PUSH_ENABLED) {
  webpush.setVapidDetails('mailto:support@rassrochka.pro', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else if (webpush) {
  console.warn('⚠️ VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY не заданы — push-уведомления отключены');
}


const app = express();


const compression = require('compression');
app.use(compression());
app.set('trust proxy', 1);


// 🔹 ТАЙМАУТЫ СЕРВЕРА (защита от зависших запросов)
const serverTimeout = 30000;
app.use((req, res, next) => {
  req.setTimeout(serverTimeout, () => {
    console.warn(`⏱️ Request timeout: ${req.method} ${req.url}`);
    if (!res.headersSent) {
      res.status(504).json({ error: 'Request timeout' });
    }
  });
  next();
});


// ✅ БЕЛЫЙ СПИСОК ТИПОВ ДАННЫХ (защита от инъекций)
const VALID_DATA_TYPES = ['customers', 'products', 'sales', 'expenses', 'accounts', 'investors', 'partnerships', 'suppliers', 'settings', 'tasks'];

// ✅ ХЕЛПЕР: Определение целевого пользователя для загрузки данных
const getTargetUserId = (user) => {
  // Сотрудники видят данные своего менеджера
  if (user.role === 'employee') {
    return user.managerId;
  }
  // Инвесторы, менеджеры и админы видят СВОИ данные
  return user.id;
};


// ✅ КОНФИГУРАЦИЯ ЛИМИТОВ ТАРИФОВ
// ИИ-функции отключены во всех тарифах: обращения к Google Gemini означали бы
// трансграничную передачу персональных данных в США, требующую отдельного
// уведомления Роскомнадзора (ч. 3 ст. 12 152-ФЗ) и приостановки передачи на
// 10 рабочих дней. Функция в интерфейсе не использовалась, поэтому выключена.
const PLAN_LIMITS = {
  TRIAL:        { contracts: 1000,  investors: 1,  employees: 0,  whatsapp: false, ai: false,  suppliers: true, investorPools: true, notifications: true,  tasks: true },
  START:        { contracts: 100, investors: 1,  employees: 0,  whatsapp: false, ai: false, suppliers: false, investorPools: false, notifications: false, tasks: false },
  STANDARD:     { contracts: 500, investors: 5,  employees: 0,  whatsapp: true,  ai: false, suppliers: false, investorPools: false, notifications: true,  tasks: false },
  BUSINESS:     { contracts: -1,  investors: -1, employees: -1, whatsapp: true,  ai: false,  suppliers: false, investorPools: false, notifications: true,  tasks: true  },
  BUSINESS_PRO: { contracts: -1,  investors: -1, employees: -1, whatsapp: true,  ai: false,  suppliers: true,  investorPools: true,  notifications: true,  tasks: true  },
};


// 🔹 Фильтрация данных для сотрудника по allowed_investor_ids
// 🔥 По умолчанию сотрудник видит только СВОИ записи (createdByUserId === employeeId).
//    Если счёт/инвестор входит в fullAccessInvestorIds — сотрудник видит ВСЕ записи по нему.
// Чьи уведомления показываем.
// Менеджер и админ — только свой ящик.
// Сотрудник всегда видит адресованное лично ему (поручения), а события по общим данным
// менеджера — лишь если ему открыт полный доступ хотя бы к одному счёту или инвестору
// (галочка «Видит все данные по этому счёту», поле full_access_investor_ids).
// Без неё сотрудник ограничен своими записями, и показывать ему чужие платежи,
// расходы и договоры в колокольчике было бы шире, чем его доступ к самим данным.
const notificationAudience = async (user) => {
  const target = getTargetUserId(user);
  if (target === user.id) return [target];

  try {
    const res = await pool.query(
      `SELECT full_access_investor_ids FROM users WHERE id = $1`,
      [user.id]
    );
    const full = res.rows[0]?.full_access_investor_ids;
    const hasFullAccess = Array.isArray(full) && full.length > 0;
    return hasFullAccess ? [target, user.id] : [user.id];
  } catch (e) {
    // При сбое базы показываем только личные — безопаснее, чем открыть лишнее
    console.error('❌ notificationAudience error:', e);
    return [user.id];
  }
};

const filterDataForEmployee = (dataByType, allowedInvestorIds, fullAccessInvestorIds, employeeId) => {
    // 🔥 Если доступов нет вообще — возвращаем пустоту (безопасность)
    if (!allowedInvestorIds || allowedInvestorIds.length === 0) {
        return {
            ...dataByType,
            investors: [],
            accounts: [],
            sales: [],
            expenses: [],
            customers: [], // Сотрудник без прав не видит никого
            // Поручения приходят лично, поэтому доступны и без прав на инвесторов
            tasks: (dataByType.tasks || []).filter(t => t.assigneeId === employeeId)
        };
    }

    const filtered = { ...dataByType };

    // 0. Задачи: сотруднику видны только назначенные ему лично.
    // Личные задачи менеджера и поручения другим сотрудникам скрыты.
    filtered.tasks = (filtered.tasks || []).filter(t => t.assigneeId === employeeId);
    const hasMainAccess = allowedInvestorIds.includes('MAIN_ACCOUNT');
    const investorIds = allowedInvestorIds.filter(id => id !== 'MAIN_ACCOUNT');

    // 🔒 Полный доступ считаем только по тем пунктам, на которые есть базовый доступ
    const safeFullAccessIds = (fullAccessInvestorIds || []).filter(id => allowedInvestorIds.includes(id));
    const hasFullMainAccess = safeFullAccessIds.includes('MAIN_ACCOUNT');
    const fullAccessInvestorIdsSet = new Set(safeFullAccessIds.filter(id => id !== 'MAIN_ACCOUNT'));

    // 1. Инвесторы: только явно разрешенные
    filtered.investors = (filtered.investors || []).filter(inv => investorIds.includes(inv.id));

    // 🔒 Принадлежность счёта инвестору: и обычный счёт (ownerId), и общий пул
    // (poolMemberIds). Раньше проверялся только ownerId — а у пула его нет, участники
    // лежат в poolMemberIds. Из-за этого пул подпадал под условие «нет ownerId → основной
    // счёт», и сотрудник с доступом к участнику пула не видел ни сам пул, ни договоры
    // в нём, сколько бы прав ему ни выдали.
    const accountBelongsTo = (acc, ids) =>
        (acc.ownerId && ids.includes(acc.ownerId)) ||
        (acc.type === 'POOL' && (acc.poolMemberIds || []).some(id => ids.includes(id)));

    // Основным считаем счёт без владельца И не являющийся пулом.
    const isMainAccount = (acc) => acc.type === 'MAIN' || (!acc.ownerId && acc.type !== 'POOL');

    // 2. Счета: Основной (если есть доступ) ИЛИ счета разрешенных инвесторов / пулы с ними
    filtered.accounts = (filtered.accounts || []).filter(acc => {
        if (isMainAccount(acc) && hasMainAccess) return true;
        return accountBelongsTo(acc, investorIds);
    });

    // 2.1 Счета с полным доступом (видны ВСЕ записи, не только свои)
    const fullAccessAccountIds = new Set(
        filtered.accounts
            .filter(acc => {
                if (isMainAccount(acc) && hasFullMainAccess) return true;
                return accountBelongsTo(acc, [...fullAccessInvestorIdsSet]);
            })
            .map(acc => acc.id)
    );

    // 3. Продажи и расходы: СТРОГО по разрешенным счетам,
    //    и только свои — если по счёту не выдан полный доступ
    const allowedAccountIds = new Set(filtered.accounts.map(acc => acc.id));
    const canSeeRecord = (record) => {
        if (!record.accountId || !allowedAccountIds.has(record.accountId)) return false;
        if (fullAccessAccountIds.has(record.accountId)) return true;
        return record.createdByUserId === employeeId;
    };
    filtered.sales = (filtered.sales || []).filter(canSeeRecord);
    filtered.expenses = (filtered.expenses || []).filter(canSeeRecord);

    // 4. 🔥 КЛИЕНТЫ: те, у кого есть продажи на разрешенных счетах, + клиенты, которых сотрудник
    // сам добавил (иначе только что созданный клиент без договора «пропадает» из списка).
    const allowedCustomerIds = new Set(filtered.sales.map(s => s.customerId));
    filtered.customers = (filtered.customers || []).filter(cust => allowedCustomerIds.has(cust.id) || cust.createdByUserId === employeeId);

    return filtered;
};

/**
 * 🔒 Проверка прав сотрудника при ЗАПИСИ данных.
 *
 * Права canCreate/canEdit/canDelete и список доступных счетов раньше существовали
 * только в интерфейсе: сервер их не смотрел вовсе, поэтому сотрудник без права
 * на удаление спокойно удалял записи прямым запросом к API, а имея id чужого
 * счёта — проводил по нему расходы, хотя сам этот счёт даже не видел.
 * Чтение фильтровалось (filterDataForEmployee), запись — нет.
 *
 * @returns {Promise<{ok: true} | {ok: false, status: number, body: object}>}
 */
const checkEmployeeWriteAccess = async ({ user, type, itemId, accountId, isDelete }) => {
  if (user.role !== 'employee') return { ok: true };
  // Настройки сотрудник правит свои собственные — сюда не относится.
  if (type === 'settings') return { ok: true };

  const res = await pool.query(
    'SELECT permissions, allowed_investor_ids, full_access_investor_ids FROM users WHERE id = $1',
    [user.id]
  );
  const row = res.rows[0];
  if (!row) return { ok: false, status: 403, body: { msg: 'Профиль сотрудника не найден' } };

  const perms = (typeof row.permissions === 'string' ? JSON.parse(row.permissions) : row.permissions) || {};

  // 1. Права на действие. Создание отличаем от правки по факту существования записи.
  if (isDelete) {
    if (!perms.canDelete) {
      return { ok: false, status: 403, body: { msg: 'Нет прав на удаление' } };
    }
  } else {
    const existing = await pool.query('SELECT 1 FROM data_items WHERE id = $1', [itemId]);
    const isNew = existing.rowCount === 0;
    if (isNew && !perms.canCreate) {
      return { ok: false, status: 403, body: { msg: 'Нет прав на создание записей' } };
    }
    if (!isNew && !perms.canEdit) {
      return { ok: false, status: 403, body: { msg: 'Нет прав на изменение записей' } };
    }
  }

  // 2. Область счетов: писать можно только по счетам, к которым выдан доступ.
  //    Сопоставление такое же, как при чтении, — с поддержкой пулов.
  if (accountId) {
    const allowedIds = parseAllowedInvestorIds(row.allowed_investor_ids);
    if (allowedIds.length === 0) {
      return { ok: false, status: 403, body: { msg: 'Нет доступа ни к одному счёту' } };
    }
    const hasMainAccess = allowedIds.includes('MAIN_ACCOUNT');
    const investorIds = allowedIds.filter(id => id !== 'MAIN_ACCOUNT');

    const accRes = await pool.query(
      `SELECT data FROM data_items WHERE type = 'accounts' AND data->>'id' = $1 LIMIT 1`,
      [accountId]
    );
    const acc = accRes.rows[0]?.data;
    if (!acc) return { ok: false, status: 403, body: { msg: 'Счёт не найден' } };

    const isMain = acc.type === 'MAIN' || (!acc.ownerId && acc.type !== 'POOL');
    const belongs = (acc.ownerId && investorIds.includes(acc.ownerId)) ||
      (acc.type === 'POOL' && (acc.poolMemberIds || []).some(id => investorIds.includes(id)));

    if (!((isMain && hasMainAccess) || belongs)) {
      return { ok: false, status: 403, body: { msg: 'Нет доступа к этому счёту' } };
    }
  }

  return { ok: true };
};

// 🔹 ХЕЛПЕР: Парсинг allowed_investor_ids (может быть строкой JSON или массивом)
const parseAllowedInvestorIds = (ids) => {
  if (!ids) return [];
  if (Array.isArray(ids)) return ids;
  if (typeof ids === 'string') {
    try {
      const parsed = JSON.parse(ids);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

// ✅ ХЕЛПЕР: Проверка платежа на дубликат
const checkPaymentDuplicate = async (saleData, amount, date, excludePaymentId = null) => {
  const paymentPlan = saleData.paymentPlan || [];
  const paymentDate = new Date(date);

  return paymentPlan.some(p => {
    // Пропускаем платеж, который обновляем (для edit-режима)
    if (excludePaymentId && p.id === excludePaymentId) return false;

    // Проверяем только реальные оплаченные платежи
    if (!p.isPaid || !p.isRealPayment) return false;

    // Сравниваем сумму с допуском 0.01
    const sameAmount = Math.abs((p.amount || 0) - amount) < 0.01;

    // Сравниваем даты по дням (игнорируем время)
    const pDate = new Date(p.date || p.actualDate);
    const sameDate =
      pDate.getDate() === paymentDate.getDate() &&
      pDate.getMonth() === paymentDate.getMonth() &&
      pDate.getFullYear() === paymentDate.getFullYear();

    return sameAmount && sameDate;
  });
};

const uploadDir = '/var/www/rassapp/server/uploads/documents';
const upload = multer({
  // 🔹 Временное хранение в памяти для обработки
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

    const ext = path.extname(file.originalname).toLowerCase();
    const isExtAllowed = allowedExts.includes(ext);
    const isMimeAllowed = allowedMimes.includes(file.mimetype);

    if (isExtAllowed && isMimeAllowed) {
      cb(null, true);
    } else {
      cb(new Error('Недопустимый формат. Разрешены: JPG, PNG, WEBP, PDF'));
    }
  }
});




// ✅ ХЕЛПЕР: Проверка прав доступа
const canAccessUserData = (currentUser, targetUserId) => {
  if (currentUser.role === 'admin') return true;
  if (currentUser.role === 'manager' && targetUserId === currentUser.id) return true;
  if (currentUser.role === 'employee' && targetUserId === currentUser.managerId) return true;
  if (currentUser.role === 'investor' && targetUserId === currentUser.id) return true;
  return false;
};

// ✅ Проверка доступа к платному модулю (например "suppliers" — модуль "Партнеры", тариф BUSINESS_PRO)
// Тариф действует только до даты окончания. Раньше проверки читали лишь subscription.plan,
// поэтому у не продлившего пользователя в базе навсегда оставался, например, BUSINESS —
// и все его возможности продолжали работать бесплатно. Теперь по истечении срока
// пользователь получает возможности START, пока не оплатит снова.
const EXPIRED_FALLBACK_PLAN = 'START';

const getEffectivePlan = (subscription) => {
  if (!subscription?.plan) return null;
  const expiresAt = subscription.expiresAt ? new Date(subscription.expiresAt) : null;
  if (expiresAt && !isNaN(expiresAt) && expiresAt < new Date()) return EXPIRED_FALLBACK_PLAN;
  return subscription.plan;
};

// Активна ли подписка. Админы и сотрудники не привязаны к собственному тарифу:
// сотрудник работает в данных менеджера, и его подписка проверяется по менеджеру.
const getSubscriptionState = async (userId) => {
  try {
    const res = await pool.query(`SELECT role, subscription FROM users WHERE id = $1`, [userId]);
    const row = res.rows[0];
    if (!row) return { expired: false };
    if (row.role === 'admin') return { expired: false };

    const sub = typeof row.subscription === 'string' ? JSON.parse(row.subscription) : row.subscription;
    if (!sub?.expiresAt) return { expired: false, plan: sub?.plan };

    const expiresAt = new Date(sub.expiresAt);
    if (isNaN(expiresAt)) return { expired: false, plan: sub.plan };
    return { expired: expiresAt < new Date(), plan: sub.plan, expiresAt: sub.expiresAt };
  } catch (e) {
    // При сбое базы не запираем пользователя — иначе временная ошибка остановит всю работу
    console.error('❌ getSubscriptionState error:', e);
    return { expired: false };
  }
};

const SUBSCRIPTION_EXPIRED_MESSAGE = {
  msg: 'Срок действия подписки истёк.',
  hint: 'Продлите тариф, чтобы снова пользоваться функциями своего плана.'
};

const FEATURE_DENIED_MESSAGES = {
  suppliers: { msg: 'Модуль «Партнеры» доступен только на тарифе Бизнес Pro.', hint: 'Оформите тариф Бизнес Pro для работы с поставщиками.' },
  investorPools: { msg: 'Общий инвестиционный пул доступен только на тарифе Бизнес Pro.', hint: 'Оформите тариф Бизнес Pro для распределения дохода между инвесторами в одном пуле.' },
  notifications: { msg: 'Уведомления доступны начиная с тарифа Стандарт.', hint: 'Оформите тариф Стандарт для доступа к уведомлениям о событиях.' },
  tasks: { msg: 'Задачи доступны на тарифах Бизнес и Бизнес Pro.', hint: 'Оформите тариф Бизнес для работы с задачами и поручениями сотрудникам.' },
};
// 🔒 Лимит инвесторов по тарифу.
//
// Раньше он проверялся только при создании ЛОГИНА инвестора (/api/users/manage), то есть
// считал строки в users. Но инвестор без e-mail логина не получает и в users не попадает —
// он живёт только записью в data_items. Из-за этого на тарифе «Старт» с лимитом 1 можно
// было завести сколько угодно инвесторов, просто не заполняя почту.
//
// Считаем по data_items — это и есть настоящий список инвесторов.
//
// При понижении тарифа лишние инвесторы НЕ удаляются: данные и история расчётов должны
// остаться нетронутыми. Вместо этого те, что сверх лимита, блокируются до повышения тарифа.
// Кого оставить — определяем по created_at (порядок создания), а не по joinedDate: дату
// вступления пользователь может отредактировать и тем самым менять состав разрешённых.
const getInvestorLimitState = async (userId) => {
  const userResult = await pool.query(`SELECT role, subscription FROM users WHERE id = $1`, [userId]);
  // Во всех ранних возвратах поля те же, что и в основном: вызывающий код обращается
  // к lockedAccountIds напрямую, и undefined уронил бы сохранение данных.
  if (userResult.rows.length === 0) return { limit: -1, lockedIds: [], lockedAccountIds: [], plan: null };

  const user = userResult.rows[0];
  if (user.role === 'admin') return { limit: -1, lockedIds: [], lockedAccountIds: [], plan: 'ADMIN' };

  const subscription = typeof user.subscription === 'string'
    ? JSON.parse(user.subscription) : user.subscription;
  const plan = getEffectivePlan(subscription) || 'TRIAL';
  const limit = PLAN_LIMITS?.[plan]?.investors ?? -1;

  if (limit === -1) return { limit, lockedIds: [], lockedAccountIds: [], plan };

  const rows = await pool.query(
    `SELECT id FROM data_items WHERE user_id = $1 AND type = 'investors'
      ORDER BY created_at ASC, id ASC`,
    [userId]
  );
  const lockedIds = rows.rows.slice(limit).map(r => r.id);
  if (lockedIds.length === 0) return { limit, plan, lockedIds, lockedAccountIds: [] };

  // Счета заблокированных инвесторов закрываем вместе с ними — иначе деньги можно
  // продолжать проводить через счёт, просто не указывая инвестора.
  //
  // Общий пул закрываем ТОЛЬКО если заблокированы все его участники: у пула бывают
  // и разрешённые инвесторы, и они не должны страдать из-за соседа сверх лимита.
  const accRes = await pool.query(
    `SELECT data FROM data_items WHERE user_id = $1 AND type = 'accounts'`,
    [userId]
  );
  const locked = new Set(lockedIds);
  const lockedAccountIds = accRes.rows
    .map(r => r.data)
    .filter(acc => {
      if (!acc) return false;
      if (acc.type === 'POOL') {
        const members = acc.poolMemberIds || [];
        return members.length > 0 && members.every(id => locked.has(id));
      }
      return !!acc.ownerId && locked.has(acc.ownerId);
    })
    .map(acc => acc.id);

  return { limit, plan, lockedIds, lockedAccountIds };
};

const checkFeatureAccess = async (userId, featureKey) => {
  try {
    const userResult = await pool.query(`SELECT role, subscription FROM users WHERE id = $1`, [userId]);
    if (userResult.rows.length === 0) {
      return { allowed: false, msg: 'Пользователь не найден' };
    }
    const user = userResult.rows[0];
    if (user.role === 'admin' || user.role === 'employee') {
      return { allowed: true };
    }
    const subscription = typeof user.subscription === 'string'
      ? JSON.parse(user.subscription)
      : user.subscription;
    const effectivePlan = getEffectivePlan(subscription);
    const isExpired = effectivePlan !== subscription?.plan;
    const limits = PLAN_LIMITS?.[effectivePlan];
    if (!limits?.[featureKey]) {
      // Истёкшей подписке объясняем причину прямо, а не предлагаем тариф, который уже был оплачен
      const denied = isExpired
        ? SUBSCRIPTION_EXPIRED_MESSAGE
        : (FEATURE_DENIED_MESSAGES[featureKey] || FEATURE_DENIED_MESSAGES.suppliers);
      return { allowed: false, ...denied };
    }
    return { allowed: true };
  } catch (e) {
    console.error('❌ checkFeatureAccess error:', e);
    return { allowed: false, msg: 'Ошибка проверки доступа' };
  }
};

// ✅ УВЕДОМЛЕНИЯ: дефолтные настройки + создание записи (с учётом тумблеров пользователя)
const NOTIFICATION_DEFAULT_SETTINGS = {
  enabled: true,
  events: {
    payment: true,
    newContract: true,
    contractClosed: true,
    expense: true,
    whatsappSent: true,
    adminBroadcast: true,
    supportMessage: true,
  },
};
const NOTIFICATION_EVENT_TOGGLE_KEYS = {
  PAYMENT: 'payment',
  NEW_CONTRACT: 'newContract',
  CONTRACT_CLOSED: 'contractClosed',
  EXPENSE: 'expense',
  WHATSAPP_SENT: 'whatsappSent',
  SUPPORT_MESSAGE: 'supportMessage',
  // Все события задач подчиняются одному тумблеру «Напоминания о задачах»
  TASK_DUE: 'taskDue',
  TASK_ASSIGNED: 'taskDue',
  TASK_DONE: 'taskDue',
};
// 🔔 Отправка Web Push всем подпискам пользователя (с автоочисткой протухших подписок)
const sendPushToUser = async (userId, title, body) => {
  if (!PUSH_ENABLED) return;
  try {
    const subsResult = await pool.query(
      `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
      [userId]
    );
    const payload = JSON.stringify({ title, body });
    for (const sub of subsResult.rows) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await pool.query(`DELETE FROM push_subscriptions WHERE id = $1`, [sub.id]);
        } else {
          console.error('❌ web-push send error:', err.message);
        }
      }
    }
  } catch (e) {
    console.error('❌ sendPushToUser error:', e);
  }
};

const createNotification = async (userId, type, title, body, data = null) => {
  try {
    const settingsResult = await pool.query(
      `SELECT data FROM data_items WHERE id = $1 AND user_id = $2 AND type = 'settings'`,
      [`settings_${userId}`, userId]
    );
    const notifSettings = settingsResult.rows[0]?.data?.notifications || NOTIFICATION_DEFAULT_SETTINGS;
    if (notifSettings.enabled === false) return;
    const eventKey = NOTIFICATION_EVENT_TOGGLE_KEYS[type];
    if (eventKey && notifSettings.events?.[eventKey] === false) return;

    const id = `notif_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    await pool.query(
      `INSERT INTO notifications (id, user_id, type, title, body, data) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, userId, type, title, body, data ? JSON.stringify(data) : null]
    );

    if (notifSettings.pushEnabled !== false) {
      await sendPushToUser(userId, title, body);
    }
  } catch (e) {
    console.error('❌ createNotification error:', e);
  }
};

// 🔔 Уведомить ВСЕХ админов о новом сообщении от пользователя в техподдержку
// (каждый админ сам решает, получать ли это, через свой тумблер "Сообщения от пользователей").
const notifyAdminsOfSupportMessage = async (fromUserId, title, body, data) => {
  try {
    const admins = await pool.query(`SELECT id FROM users WHERE role = 'admin'`);
    for (const admin of admins.rows) {
      if (admin.id === fromUserId) continue; // на случай если сообщение оставил сам админ
      await createNotification(admin.id, 'SUPPORT_MESSAGE', title, body, data);
    }
  } catch (e) {
    console.error('❌ notifyAdminsOfSupportMessage error:', e);
  }
};

// ✅ ПРОДАКШЕН-ВЕРСИЯ: checkContractLimit
const checkContractLimit = async (userId, action = 'create', itemData = null) => {
  try {
    // 1. Получаем пользователя
    const userResult = await pool.query(
      `SELECT id, role, subscription FROM users WHERE id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return { allowed: false, msg: 'Пользователь не найден' };
    }

    const user = userResult.rows[0];

    // 2. Админы и сотрудники — без ограничений
    if (user.role === 'admin' || user.role === 'employee') {
      return { allowed: true };
    }

    // 3. Парсим подписку
    const subscription = typeof user.subscription === 'string'
      ? JSON.parse(user.subscription)
      : user.subscription;

    if (!subscription?.plan) {
      return { allowed: false, msg: 'Нет активной подписки' };
    }

    // 🔹 Безопасное получение лимитов (защита от undefined).
    // По истечении подписки действуют лимиты START, а не последнего оплаченного тарифа.
    const effectivePlan = getEffectivePlan(subscription);
    const limits = PLAN_LIMITS?.[effectivePlan];
    if (!limits || typeof limits.contracts !== 'number') {
      console.error(`⚠️ Invalid plan limits for plan: ${effectivePlan}`);
      return { allowed: false, msg: 'Ошибка конфигурации тарифа' };
    }

    // 4. Безлимитные тарифы
    if (limits.contracts === -1) {
      return { allowed: true };
    }

    // 5. 🔥 РАЗНАЯ ЛОГИКА ДЛЯ РАЗНЫХ ДЕЙСТВИЙ

    // ✅ УДАЛЕНИЕ: всегда разрешено
    if (action === 'delete') {
      return { allowed: true };
    }

    // ✅ ОБНОВЛЕНИЕ существующего
    if (action === 'update' && itemData?.id) {
      const exists = await pool.query(
        `SELECT 1 FROM data_items WHERE id = $1 AND user_id = $2 AND type = 'sales'`,
        [itemData.id, userId]
      );
      if (exists.rows.length > 0) {
        return { allowed: true };
      }
      // Если не существует — считаем как создание
    }

    // 🔥 СОЗДАНИЕ нового: строгая проверка
    if (action === 'create') {
      const countResult = await pool.query(
        `SELECT COUNT(*) as count FROM data_items 
         WHERE user_id = $1 AND type = 'sales' 
         AND (data->>'status' = 'ACTIVE' OR data->>'status' = 'DRAFT')`,
        [userId]
      );

      // 🔹 Безопасное парсинг числа
      const currentCount = parseInt(countResult.rows[0]?.count || '0', 10);

      if (currentCount >= limits.contracts) {
        // 🔹 Логируем попытку превышения для аналитики
        const expired = effectivePlan !== subscription.plan;
        console.log(`🚫 LIMIT_HIT: user=${userId}, plan=${effectivePlan}${expired ? ` (истёк ${subscription.plan})` : ''}, count=${currentCount}, limit=${limits.contracts}`);

        return {
          allowed: false,
          msg: expired
            ? `Срок действия подписки истёк, действует лимит тарифа "${effectivePlan}". Максимум: ${limits.contracts}.`
            : `Превышен лимит договоров для тарифа "${subscription.plan}". Максимум: ${limits.contracts}.`,
          details: { current: currentCount, limit: limits.contracts },
          hint: expired
            ? 'Продлите подписку, чтобы снова оформлять договоры без ограничений.'
            : 'Удалите ненужные договоры или оформите подписку выше.'
        };
      }
    }

    return { allowed: true };

  } catch (err) {
    // 🔐 ПРОДАКШЕН: логируем в мониторинг, но не блокируем пользователя
    console.error('❌ checkContractLimit DB error:', {
      userId,
      action,
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });

    // 🔹 Опционально: отправить алерт в Sentry/Telegram
    // if (process.env.SENTRY_DSN) { Sentry.captureException(err); }

    // Fail-safe: разрешаем при ошибке БД, но с предупреждением в ответе
    return {
      allowed: true,
      warning: 'Временная ошибка проверки. Если проблема повторится — обратитесь в поддержку.'
    };
  }
};



// 🔹 Раньше один и тот же лимитер (5 запросов/15 мин) висел сразу на send-code, register
// и reset-password — то есть делил ОДИН общий счётчик на все три. Обычный сценарий
// регистрации (запросить код → код не пришёл/устарел → переотправить → пару раз ошибиться
// при вводе) легко съедал весь лимит за пару минут, и пользователь упирался в 429 без
// возможности вообще завершить регистрацию. Плюс тело ответа лимитера отдавало { error: ... },
// а фронтенд везде читает { msg: ... } — из-за этого вместо "Слишком много попыток" человек
// видел безликую "Ошибка регистрации" и не понимал, в чём дело.
// Теперь у каждого шага свой счётчик и разумный запас на опечатки/повторную отправку кода.
const makeAuthLimiter = (max) => rateLimit({
  windowMs: 15 * 60 * 1000,
  max,
  message: { msg: 'Слишком много попыток. Попробуйте снова через 15 минут.' },
  standardHeaders: true,
  legacyHeaders: false,
});
const sendCodeLimiter = makeAuthLimiter(8);
const registerLimiter = makeAuthLimiter(10);
const resetPasswordLimiter = makeAuthLimiter(10);



const compressImage = async (inputBuffer, mimetype, maxWidth = 1920, quality = 80) => {
  try {
    const image = sharp(inputBuffer);
    const metadata = await image.metadata();

    // 🔹 Если изображение шире maxWidth — ресайзим
    let pipeline = image;
    if (metadata.width && metadata.width > maxWidth) {
      pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
    }

    // 🔹 Конвертируем в JPEG для максимальной совместимости
    // (можно оставить оригинальный формат, если нужно)
    const outputBuffer = await pipeline
      .jpeg({ quality, progressive: true }) // 👈 меняйте quality: 60-90
      .toBuffer();

    return {
      buffer: outputBuffer,
      ext: '.jpg',
      mimetype: 'image/jpeg'
    };
  } catch (err) {
    console.error('❌ Compression error:', err);
    // 🔹 Фолбэк: возвращаем оригинал, если сжатие не удалось
    return { buffer: inputBuffer, ext: path.extname(inputBuffer), mimetype };
  }
};


// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['https://rassrochka.pro'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token', 'x-api-key']
}));




// ✅ Файлы для скачивания (APK/EXE) отдаются отсюда, а не из public/downloads.
// Раньше они лежали в public/, которую Vite бандлит в dist/, а Capacitor копирует
// в саму Android-сборку — из-за этого APK на каждом релизе упаковывал сам себя
// (и все предыдущие версии) как «веб-ресурс», раздуваясь без предела. Эта папка
// вне пайплайна Vite/Capacitor — сборки её больше не увидят.
app.use('/downloads', express.static(path.join(__dirname, 'downloads'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.apk')) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
    } else if (filePath.endsWith('.exe')) {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
    }
  }
}));

app.use(express.json({
  limit: '15mb',
  type: (req) => {
    if (req.url.startsWith('/api/payment/webhook')) return false;
    if (req.url.startsWith('/api/upload-image')) return false;
    if (req.url.startsWith('/api/upload')) return false;
    if (req.url.startsWith('/api/integrations/whatsapp/webhook')) return false;
    return true;
  }
}));


// ✅ Helmet — безопасность заголовков
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      // blob: — документы клиентов больше не отдаются по прямой ссылке, клиент качает их
      // с токеном и показывает через URL.createObjectURL(). Без blob: в этой директиве
      // браузер блокирует такую картинку молча, в консоли остаётся только ошибка CSP.
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      connectSrc: ["'self'", 'https://api.yookassa.ru', 'https://api.green-api.com'],
      frameSrc: ["'self'", 'https://yoomoney.ru','blob:'],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    },
  },
  xFrameOptions: { action: 'sameorigin' },
  hsts: process.env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  permissionsPolicy: {
    camera: [],
    microphone: [],
    geolocation: []
  }
}));


// Logging Middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ✅ RATE LIMITING для защиты от подбора пароля
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 10, // 5 попыток
  message: { error: 'Слишком много попыток входа, попробуйте позже' },
  standardHeaders: true,
  legacyHeaders: false,
});

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('❌ JWT_SECRET not set or too weak!');
  process.exit(1); // Остановить сервер в продакшене
}

// Nodemailer Transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || undefined,
});

// Force Postgres Session Timezone
pool.on('connect', (client) => {
  client.query("SET TIME ZONE 'Europe/Moscow'", (err) => {
    if(err) console.error("Error setting DB timezone", err);
  });
});

// Initialize Database Tables
const initDB = async () => {
  try {
    // === ОСНОВНЫЕ ТАБЛИЦЫ ===

    // Users Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'manager',
        manager_id TEXT,
        permissions JSONB,
        allowed_investor_ids JSONB,
        phone TEXT,
        subscription JSONB,
        whatsapp_settings JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure subscription column exists (Migration for existing DBs)
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='subscription') THEN
          ALTER TABLE users ADD COLUMN subscription JSONB;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='whatsapp_settings') THEN
          ALTER TABLE users ADD COLUMN whatsapp_settings JSONB;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='api_key') THEN
          ALTER TABLE users ADD COLUMN api_key TEXT UNIQUE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='full_access_investor_ids') THEN
          ALTER TABLE users ADD COLUMN full_access_investor_ids JSONB;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='blocked') THEN
          ALTER TABLE users ADD COLUMN blocked BOOLEAN DEFAULT FALSE;
        END IF;
        -- 💰 Процент от прибыли для сотрудника (мотивация).
        -- profit_base — от чего считается: договоры, которые он оформил (CONTRACTS),
        -- платежи, которые он принял (PAYMENTS), или вся прибыль менеджера (ALL).
        -- profit_reduces_manager — уменьшать ли прибыль менеджера сразу при начислении
        -- или только когда зарплата фактически выплачена.
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='profit_percentage') THEN
          ALTER TABLE users ADD COLUMN profit_percentage NUMERIC;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='profit_base') THEN
          ALTER TABLE users ADD COLUMN profit_base TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='profit_reduces_manager') THEN
          ALTER TABLE users ADD COLUMN profit_reduces_manager BOOLEAN DEFAULT TRUE;
        END IF;
        -- Из чьей прибыли платится премия: MANAGER (доля менеджера) или SHARED (общее дело)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='profit_source') THEN
          ALTER TABLE users ADD COLUMN profit_source TEXT;
        END IF;
        -- С какой даты начисляется премия (платежи раньше неё не учитываются)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='profit_since') THEN
          ALTER TABLE users ADD COLUMN profit_since DATE;
        END IF;
        -- 🤝 Бизнес-партнёрство: процент с оплат приведённых клиентов.
        -- Отдельно от реферальной программы (та даёт дни и срабатывает один раз
        -- за клиента) — здесь начисление идёт с КАЖДОЙ оплаты.
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='partner_percent') THEN
          ALTER TABLE users ADD COLUMN partner_percent NUMERIC(5,2);
        END IF;
        -- С какой даты начисляем. Без неё включение партнёрства сегодня создало бы
        -- долг за всю прошлую историю клиентов.
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='partner_since') THEN
          ALTER TABLE users ADD COLUMN partner_since TIMESTAMP;
        END IF;
        -- Сколько месяцев с РЕГИСТРАЦИИ клиента действует процент.
        -- NULL — бессрочно. Считаем от регистрации, а не от платежа: иначе срок
        -- обнулялся бы с каждым продлением и никогда не заканчивался.
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='partner_term_months') THEN
          ALTER TABLE users ADD COLUMN partner_term_months INTEGER;
        END IF;
        -- 🎁 Реферальная программа
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='referral_code') THEN
          ALTER TABLE users ADD COLUMN referral_code TEXT UNIQUE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='referred_by') THEN
          ALTER TABLE users ADD COLUMN referred_by TEXT;
        END IF;
        -- Награда выдаётся ОДИН раз за приглашённого — при его первой оплате.
        -- Без этого флага повторные платежи начисляли бы рефереру дни снова и снова.
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='referral_rewarded_at') THEN
          ALTER TABLE users ADD COLUMN referral_rewarded_at TIMESTAMP;
        END IF;
        -- referral_rewarded_at = «обработано» (в т.ч. отказ при самоприглашении),
        -- а этот флаг = награда действительно начислена. Считать статистику надо по нему.
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='referral_reward_granted') THEN
          ALTER TABLE users ADD COLUMN referral_reward_granted BOOLEAN DEFAULT FALSE;
        END IF;
        -- Когда пригласивший в последний раз видел поздравление о начислении
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='referral_seen_at') THEN
          ALTER TABLE users ADD COLUMN referral_seen_at TIMESTAMP;
        END IF;
      END $$;
    `);

    // Код нужен всем существующим пользователям, иначе они не смогут никого пригласить
    await pool.query(`
      UPDATE users SET referral_code = UPPER(SUBSTRING(MD5(id || 'finuchet-ref') FROM 1 FOR 8))
       WHERE referral_code IS NULL
    `);

    // Data Items Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS data_items (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);



// 🔹 B-tree индексы для точных совпадений (ещё быстрее для простых запросов)
await pool.query(`
  CREATE INDEX IF NOT EXISTS idx_subscription_payments_user ON subscription_payments(user_id);
  CREATE INDEX IF NOT EXISTS idx_partner_commissions_partner ON partner_commissions(partner_id, status);
  CREATE INDEX IF NOT EXISTS idx_partner_payouts_partner ON partner_payouts(partner_id);

  CREATE INDEX IF NOT EXISTS idx_data_items_data_user_id_btree 
  ON data_items ((data->>'userId'))
`);

await pool.query(`
  CREATE INDEX IF NOT EXISTS idx_data_items_data_owner_id_btree 
  ON data_items ((data->>'ownerId'))
`);

await pool.query(`
  CREATE INDEX IF NOT EXISTS idx_data_items_data_account_id_btree 
  ON data_items ((data->>'accountId'))
`);

    // Verification Codes Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS verification_codes (
        email TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        attempts INTEGER DEFAULT 0
      );
    `);

    // Indexes
    // Indexes
await pool.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower 
  ON users (LOWER(email))
`);

// 🔹 Обычные индексы для производительности
await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_manager_id ON users(manager_id);`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_data_items_user_id ON data_items(user_id);`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_data_items_type ON data_items(type);`);

    // === ТАБЛИЦЫ ТЕХПОДДЕРЖКИ ===

// Тикеты поддержки
await pool.query(`
  CREATE TABLE IF NOT EXISTS support_tickets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT DEFAULT 'OPEN',
    priority TEXT DEFAULT 'NORMAL',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP,
    assigned_admin_id TEXT
  );
`);

// Сообщения тикетов
await pool.query(`
  CREATE TABLE IF NOT EXISTS support_messages (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    message TEXT NOT NULL,
    is_from_user BOOLEAN DEFAULT TRUE,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES support_tickets(id)
  );
`);

// Массовые уведомления (broadcast)
await pool.query(`
  CREATE TABLE IF NOT EXISTS broadcast_messages (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    target_role TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_by_users JSONB DEFAULT '[]'
  );
`);

// Индексы для производительности
await pool.query(`CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON support_tickets(user_id);`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_id ON support_messages(ticket_id);`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_support_messages_is_read ON support_messages(is_read);`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_broadcast_messages_is_active ON broadcast_messages(is_active);`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_broadcast_messages_target_role ON broadcast_messages(target_role);`);

// Уведомления (события: платёж, договор, расход, whatsapp и т.д.)
await pool.query(`
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    data JSONB,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read);`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);`);
await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user_archived ON notifications(user_id, is_archived);`);

// Push-подписки устройств (Web Push)
await pool.query(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);`);

// === ЖУРНАЛ ДЕЙСТВИЙ АДМИНА ===
await pool.query(`
  CREATE TABLE IF NOT EXISTS admin_audit_log (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_user_id TEXT,
    details JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at ON admin_audit_log(created_at DESC);`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target_user_id ON admin_audit_log(target_user_id);`);

// === РЕЗЕРВНОЕ КОПИРОВАНИЕ НА ПОЧТУ ===
// Отдельная таблица, а не поле в settings: клиент сохраняет настройки целиком
// (PUT со всем объектом AppSettings) и затирал бы служебные отметки планировщика —
// next_run_at/last_run_at. Из-за этого копия либо ушла бы повторно, либо не ушла вовсе.
await pool.query(`
  -- 💳 Журнал оплат подписки. Раньше нигде не сохранялся: вебхук продлевал
  -- подписку и забывал платёж. Без журнала нельзя ни посчитать долю партнёра,
  -- ни свести выручку, ни разобрать спорную оплату.
  -- id — идентификатор платежа ЮKassa: вебхук может прийти дважды, и первичный
  -- ключ по нему делает повторную запись невозможной.
  CREATE TABLE IF NOT EXISTS subscription_payments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(12,2) NOT NULL,
    plan TEXT NOT NULL,
    months INTEGER NOT NULL,
    paid_at TIMESTAMP NOT NULL DEFAULT NOW(),
    refunded_at TIMESTAMP
  );

  -- 🤝 Начисления партнёру. Процент и срок КОПИРУЮТСЯ в строку начисления, а не
  -- берутся из настроек партнёра при показе: иначе изменение процента переписало
  -- бы задним числом всю историю, включая уже выплаченное.
  -- payment_id UNIQUE — на один платёж не больше одного начисления.
  CREATE TABLE IF NOT EXISTS partner_commissions (
    id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payment_id TEXT NOT NULL UNIQUE REFERENCES subscription_payments(id) ON DELETE CASCADE,
    base_amount NUMERIC(12,2) NOT NULL,
    percent NUMERIC(5,2) NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'accrued',
    payout_id TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- 💸 Выплаты партнёру. receipt — номер чека самозанятого: единственное
  -- подтверждение, что перевод был за услугу, а не подарок.
  CREATE TABLE IF NOT EXISTS partner_payouts (
    id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(12,2) NOT NULL,
    method TEXT,
    receipt TEXT,
    note TEXT,
    created_by TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS backup_settings (
    user_id TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    frequency TEXT NOT NULL DEFAULT 'MONTHLY',
    extra_email TEXT,
    extra_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    extra_email_pending TEXT,
    extra_email_code TEXT,
    extra_email_code_expires TIMESTAMP,
    next_run_at TIMESTAMP,
    last_run_at TIMESTAMP,
    last_status TEXT,
    last_error TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);
// Планировщик каждые 15 минут выбирает «кому пора» — без индекса это seq scan
// по всей таблице пользователей на каждом тике.
await pool.query(`CREATE INDEX IF NOT EXISTS idx_backup_settings_due ON backup_settings(next_run_at) WHERE enabled = TRUE;`);

    initSuperAdmin();

  } catch (err) {
    console.error('❌ Error initializing database:', err);
  }
};

const initSuperAdmin = async () => {
  const adminEmail = process.env.SUPER_ADMIN_EMAIL;
  const adminPass = process.env.SUPER_ADMIN_PASSWORD;
  if (!adminEmail || !adminPass) {
    console.error('❌ SUPER_ADMIN_EMAIL и SUPER_ADMIN_PASSWORD должны быть заданы в .env');
    return;
  }
  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(adminPass, salt);
    // Upsert Admin User
    await pool.query(`
      INSERT INTO users (id, name, email, password, role, subscription)
      VALUES ('super_admin', 'Super Admin', $1, $2, 'admin', '{"plan":"BUSINESS","expiresAt":"2099-12-31T23:59:59.999Z"}')
      ON CONFLICT (email) DO UPDATE SET
        role = 'admin',
        password = $2
    `, [adminEmail, hashedPassword]);

  } catch (e) {
    console.error('Failed to init super admin', e);
  }
};

// Вызов функции
initDB();

// --- MIDDLEWARE ---
const auth = (req, res, next) => {
  const token = req.header('x-auth-token');
  if (!token) return res.status(401).json({ code: 'NO_TOKEN', msg: 'Нет токена' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    // В middleware auth на сервере:
if (e.name === 'TokenExpiredError') {
  return res.status(401).json({
    msg: 'Сессия истекла',
    code: 'TOKEN_EXPIRED'
  });
}
    return res.status(401).json({ code: 'INVALID_TOKEN', msg: 'Невалидный токен' });
  }
};

const adminAuth = (req, res, next) => {
  auth(req, res, () => {
    if (req.user.role === 'admin') {
      next();
    } else {
      res.status(403).json({ msg: 'Access denied: Admins only' });
    }
  });
};

// ✅ Журнал действий администратора (используется вкладкой "Логи" в Админ-панели)
const logAdminAction = async (adminId, action, targetUserId, details) => {
  try {
    await pool.query(
      `INSERT INTO admin_audit_log (id, admin_id, action, target_user_id, details) VALUES ($1, $2, $3, $4, $5)`,
      [`log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, adminId, action, targetUserId || null, details ? JSON.stringify(details) : null]
    );
  } catch (e) {
    console.error('❌ Failed to write admin audit log:', e);
  }
};

// --- HELPER FUNCTIONS ---
// Безопасное прибавление месяцев. Обычный setMonth на 29-31 числе «переливается»
// в следующий месяц: 31 января + 1 месяц даёт 3 марта, потому что 31 февраля не
// существует. Для подписки это лишние дни доступа, оплаченные как один месяц.
// Тот же расчёт во фронте — addMonthsClamped в src/utils.ts.
const addMonthsClamped = (date, months) => {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1,
                          date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
  const daysInTarget = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), daysInTarget));
  return target;
};

// Колонка типа DATE приходит из pg объектом Date в ЛОКАЛЬНОЙ полуночи. toISOString()
// переводит её в UTC и в поясах восточнее Гринвича сдвигает дату на сутки назад:
// 2026-06-01 превращалось в 2026-05-31. Собираем строку по локальным компонентам.
// Общий модуль расчёта прибыли (тот же, что использует интерфейс) — ESM,
// поэтому подключается динамическим импортом, как shared/excelReport.js.
let profitModulePromise = null;
const getProfitModule = () => {
  if (!profitModulePromise) {
    const url = require('url').pathToFileURL(require('path').join(__dirname, '..', 'shared', 'profit.js')).href;
    profitModulePromise = import(url);
  }
  return profitModulePromise;
};

const toDateString = (value) => {
  if (!value) return undefined;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return undefined;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();

const sendEmail = async (email, subject, text, html = null) => {
  // 🔐 Если SMTP не настроен — симулируем успех (для разработки)
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return true;
  }

  try {
    await transporter.sendMail({
      from: `"FinUchet" <${process.env.SMTP_USER}>`,
      to: email,
      subject,
      text,
      html: html || text,

      // 📬 Опционально: заголовки для улучшения доставляемости
      headers: {
        'X-Priority': '3',
        'X-Mailer': 'FinUchet Auth System'
      }
    });

    console.log(`✅ Email sent to ${email}`);
    return true;

  } catch (error) {
    console.error('❌ Email send error:', error.message);
    return false;
  }
};

// --- ROUTES ---

// Health Check
app.get('/', (req, res) => {
  res.send('InstallMate API is running');
});

// --- INTEGRATIONS ---
app.post('/api/integrations/whatsapp/create', auth, async (req, res) => {

  const { phoneNumber } = req.body;
  const partnerToken = process.env.GREEN_API_PARTNER_TOKEN ? process.env.GREEN_API_PARTNER_TOKEN.trim() : null;
  
  if (!partnerToken) {
    console.error("Partner Token Missing on Server");
    return res.status(500).json({ msg: 'Partner Token not configured on server' });
  }
  
  try {

    const cleanPhone = phoneNumber ? phoneNumber.replace(/\D/g, '') : '';
    
    const response = await axios.post('https://api.green-api.com/partner/createInstance', {
      type: "whatsapp",
      mark: `User ${req.user.email} (ID: ${req.user.id}) ${cleanPhone ? `[Phone: ${cleanPhone}]` : ''}`
    }, {
      headers: {
        'Authorization': `Bearer ${partnerToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'InstallMate/1.0 (NodeJS)'
      }
    });
    

    res.json(response.data);
  } catch (error) {
    let errorDetails = error.message;
    if (error.response) {
      console.error('Green API Response Status:', error.response.status);
      console.error('Green API Response Headers:', JSON.stringify(error.response.headers));
      errorDetails = error.response.data;
      if (typeof errorDetails === 'string' && errorDetails.trim().startsWith('<html')) {
        console.error('Green API returned HTML error (likely WAF or 403 Forbidden):', errorDetails.substring(0, 200));
        errorDetails = `Green API returned HTML error (${error.response.status}). Check Partner Token and permissions.`;
      }
    } else {
      console.error('Green API Network Error:', error.message);
    }
    res.status(500).json({
      msg: 'Failed to create WhatsApp instance',
      details: typeof errorDetails === 'object' ? JSON.stringify(errorDetails) : errorDetails
    });
  }
});



// =====================================================
// === 📅 WHATSAPP: СРОК ПОДПИСКИ ИНСТАНСА =============
// =====================================================

// Партнёрский метод отдаёт СРАЗУ ВСЕ инстансы партнёра, а не один. Дёргать его
// на каждое открытие настроек — качать весь список ради одной строки, поэтому
// держим короткий кэш в памяти: срок меняется раз в месяц, минута погрешности
// роли не играет.
let greenApiInstancesCache = { at: 0, list: null };
const GREEN_API_CACHE_MS = 5 * 60 * 1000;

async function getGreenApiInstances() {
  const now = Date.now();
  if (greenApiInstancesCache.list && now - greenApiInstancesCache.at < GREEN_API_CACHE_MS) {
    return greenApiInstancesCache.list;
  }
  const partnerToken = process.env.GREEN_API_PARTNER_TOKEN ? process.env.GREEN_API_PARTNER_TOKEN.trim() : null;
  if (!partnerToken) return null;

  const url = `https://api.green-api.com/partner/getInstances/${partnerToken}`;
  const { data } = await axios.get(url, {
    timeout: 10000,
    headers: { 'User-Agent': 'InstallMate/1.0 (NodeJS)' }
  });
  const list = Array.isArray(data) ? data : [];
  greenApiInstancesCache = { at: now, list };
  return list;
}

app.get('/api/integrations/whatsapp/subscription', auth, async (req, res) => {
  try {
    const targetId = getTargetUserId(req.user);
    // idInstance берём из настроек на сервере, а не из запроса: партнёрский
    // список общий на всех, и по чужому номеру клиент увидел бы чужой срок.
    const result = await pool.query(
      `SELECT data FROM data_items WHERE id = $1 AND user_id = $2 AND type = 'settings'`,
      [`settings_${targetId}`, targetId]
    );
    const wa = result.rows[0]?.data?.whatsapp;
    const idInstance = wa?.idInstance ? String(wa.idInstance).trim() : '';
    if (!idInstance) return res.json({ connected: false });

    const list = await getGreenApiInstances();
    if (!list) return res.json({ connected: true, available: false, reason: 'no_partner_token' });

    const found = list.find(i => String(i.idInstance) === idInstance);
    if (!found) {
      // Инстанс заведён мимо нашего партнёрского аккаунта. Точный срок Green API
      // по нему не отдаёт — эти данные видит только владелец в своём кабинете.
      // Но по коду ответа можно отличить исчерпанный тариф от живого инстанса:
      // 466 — кончился лимит тарифа, 401/403 — инстанс недоступен.
      let planIssue = null;
      const token = wa?.apiTokenInstance ? String(wa.apiTokenInstance).trim() : '';
      if (token) {
        try {
          const probe = await axios.get(
            `https://api.green-api.com/waInstance${idInstance}/getStateInstance/${token}`,
            { timeout: 8000, validateStatus: () => true }
          );
          if (probe.status === 466) planIssue = 'quota';
          else if (probe.status === 401 || probe.status === 403) planIssue = 'unavailable';
        } catch { /* сеть недоступна — просто не показываем предупреждение */ }
      }
      return res.json({ connected: true, available: false, reason: 'not_partner_instance', planIssue });
    }

    let daysLeft = null;
    if (found.expirationDate) {
      const end = new Date(found.expirationDate).getTime();
      if (!Number.isNaN(end)) {
        daysLeft = Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000));
      }
    }

    res.json({
      connected: true,
      available: true,
      expirationDate: found.expirationDate || null,
      isExpired: !!found.isExpired,
      isFree: !!found.isFree,
      tariff: found.tariff || null,
      daysLeft
    });
  } catch (e) {
    console.warn('⚠️ Не удалось получить срок подписки Green API:', e.message);
    // Настройки не должны падать из-за недоступности стороннего сервиса
    res.json({ connected: true, available: false, reason: 'request_failed' });
  }
});

// =====================================================
// === 🔔 WHATSAPP: ОТПРАВКА НАПОМИНАНИЯ О ПРОСРОЧКЕ ===
// =====================================================

// Состояние инстанса. null — проверить не удалось (тогда отправку не блокируем).
async function getGreenApiState(idInstance, apiTokenInstance) {
  try {
    const stateUrl = `https://api.green-api.com/waInstance${idInstance}/getStateInstance/${apiTokenInstance}`;
    const stateResponse = await axios.get(stateUrl, { timeout: 5000 });
    return stateResponse.data?.stateInstance || null;
  } catch (e) {
    console.warn(`⚠️ Не удалось проверить инстанс ${idInstance}: ${e.message}`);
    return null;
  }
}

// skipStateCheck — для массовой рассылки, где состояние проверяется один раз до цикла.
// Раньше проверка шла перед каждым сообщением и удваивала число запросов к Green API,
// из-за чего рассылка упиралась в лимит частоты и получала 429.
async function sendGreenApiMessage(idInstance, apiTokenInstance, phone, message, options = {}) {
  const { phone: formattedPhone, reason } = normalizePhone(phone);
  if (!formattedPhone) {
    console.warn(`⚠️ Пропуск, некорректный номер "${phone}": ${reason}`);
    return false;
  }

  try {
    const chatId = `${formattedPhone}@c.us`;

    if (!options.skipStateCheck) {
      const state = await getGreenApiState(idInstance, apiTokenInstance);
      if (state && state !== 'authorized') {
        console.warn(`⚠️ Инстанс ${idInstance} не авторизован (${state})`);
        return false;
      }
    }

    const sendUrl = `https://api.green-api.com/waInstance${idInstance}/sendMessage/${apiTokenInstance}`;
    const response = await axios.post(
      sendUrl,
      { chatId, message },
      { timeout: 15000 }
    );

    console.log(`📱 Sent to ${formattedPhone}`);
    return !!response.data?.idMessage;
  } catch (e) {
    const status = e.response?.status;
    const body = e.response?.data ? JSON.stringify(e.response.data).slice(0, 300) : '';
    console.error(
      `🔴 Green API send error → ${formattedPhone}: ${e.message}` +
      `${status ? ` | HTTP ${status}` : ''}${body ? ` | ${body}` : ''}`
    );
    return false;
  }
}
/**
 * POST /api/integrations/whatsapp/send-reminder
 * Отправка напоминания о просрочке одному клиенту
 */


const reminderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 20, // максимум 20 напоминаний
  message: { error: 'Слишком много запросов, попробуйте позже' },
  standardHeaders: true,
  legacyHeaders: false,
});



const massReminderLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 часа
  max: 1, // 1 запрос
  message: {
    error: 'Массовая рассылка доступна только 1 раз в 24 часа',
    nextAttempt: 'Попробуйте завтра'
  },
  standardHeaders: true,
  legacyHeaders: false,
 
});

/**
 * POST /api/integrations/whatsapp/send-reminder
 * Отправка напоминания о просрочке одному клиенту
 */
app.post('/api/integrations/whatsapp/send-reminder', auth, reminderLimiter, async (req, res) => {
  try {
    const {
      customerId,
      phone,
      customerName,
      productName,
      overdueAmount,      // Реальный долг (после частичных оплат)
      monthlyPayment,     // Фиксированный платёж из графика
      monthsOverdue,
      template = 'overdue'
      // 🔹 totalToPay больше не нужен — ИТОГО = только долг
    } = req.body;

    const userId = req.user.id;

    // 🔹 1. Валидация
    if (!phone || !customerName || overdueAmount === undefined) {
      return res.status(400).json({ error: 'Missing required fields: phone, customerName, overdueAmount' });
    }

    // ✅ Уважаем тумблер "Разрешить WhatsApp-уведомления" на карточке клиента —
    // раньше этот эндпоинт слепо отправлял всё, что пришло от фронтенда, не сверяясь
    // с клиентом в базе вообще.
    if (customerId) {
      const customerRes = await pool.query(
        `SELECT data FROM data_items WHERE id = $1 AND user_id = $2 AND type = 'customers'`,
        [customerId, userId]
      );
      const customerData = customerRes.rows[0]?.data;
      if (customerData?.allowWhatsappNotification === false) {
        return res.status(403).json({ error: 'Клиент отключил WhatsApp-уведомления', code: 'NOTIFICATIONS_DISABLED' });
      }
    }

    // 🔹 2. Получаем настройки пользователя
    const userRes = await pool.query(
      `SELECT id, name, whatsapp_settings FROM users WHERE id = $1`,
      [userId]
    );

    const user = userRes.rows[0];
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const settings = typeof user.whatsapp_settings === 'string'
      ? JSON.parse(user.whatsapp_settings)
      : user.whatsapp_settings;

    if (!settings?.enabled || !settings.idInstance || !settings.apiTokenInstance) {
      return res.status(400).json({ error: 'WhatsApp not configured for this user' });
    }

    // 🔹 3. Формируем сообщение
    // 🔹 3. Формируем сообщение
const defaultOverdueTemplate =
  `🔔 *Напоминание о просрочке*\n\n` +
  `*{имя}!*\n\n` +
  `⚠️ Оплата по договору просрочена!\n\n` +
  `{товары_блок}\n\n` +
  `{итого_блок}\n\n` +
  `\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``;

const rawTemplate = settings.templates?.[template] || defaultOverdueTemplate;

// 🔹 4. Заменяем переменные
const monthlyPaymentValue = monthlyPayment !== undefined ? monthlyPayment : overdueAmount;

const monthlyPaymentText = monthlyPaymentValue.toLocaleString('ru-RU');
const overdueAmountText = overdueAmount.toLocaleString('ru-RU');
const monthsText = String(monthsOverdue || 0);

const productsBlock =
  `🔸 *${productName || ''}*\n` +
  `   • Ежемесячный платёж: *${monthlyPaymentText} ₽*\n` +
  `   • Задолженность: *${overdueAmountText} ₽* (${monthsText} мес.)`;

const totalBlock =
  `💰 *ИТОГО К ОПЛАТЕ: ${overdueAmountText} ₽*`;

const message = rawTemplate
  .replace(/{имя}/g, customerName)
  .replace(/{товар}/g, productName || '')
  .replace(/{сумма}/g, monthlyPaymentText)
  .replace(/{долг}/g, overdueAmountText)
  .replace(/{итого}/g, overdueAmountText)
  .replace(/{месяцы}/g, monthsText)
  .replace(
    /{дата}/g,
    new Date().toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    })
  )
  .replace(/{товары_блок}/g, productsBlock)
  .replace(/{платеж_блок}/g, `   • Ежемесячный платёж: *${monthlyPaymentText} ₽*\n`)
  .replace(/{долг_блок}/g, '')
  .replace(/{итого_блок}/g, totalBlock)
  .replace(/\n{3,}/g, '\n\n')
  .trim();

// 🔹 5. Отправка через Green API
const sent = await sendGreenApiMessage(
  settings.idInstance,
  settings.apiTokenInstance,
  phone,
  message
);

if (sent) {
  console.log(`✅ Reminder sent to ${customerName} (${phone}) by user ${userId}`);
  await createNotification(
    userId,
    'WHATSAPP_SENT',
    'Напоминание отправлено',
    `WhatsApp-напоминание отправлено клиенту ${customerName}`,
    { customerId: customerId || null }
  );
  return res.json({ success: true, message: 'Reminder sent successfully' });
} else {
  return res.status(502).json({ error: 'Failed to send via Green API' });
}

  } catch (err) {
    console.error('💥 /send-reminder error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/integrations/whatsapp/send-reminder-all
 * Массовая отправка напоминаний всем просроченным клиентам
 */
app.post('/api/integrations/whatsapp/send-reminder-all', auth, massReminderLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const { template = 'overdue' } = req.body;

    // 🔹 1. Получаем настройки WhatsApp
    const userRes = await pool.query(
      `SELECT id, name, whatsapp_settings FROM users WHERE id = $1`,
      [userId]
    );

    const user = userRes.rows[0];
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const settings = typeof user.whatsapp_settings === 'string'
      ? JSON.parse(user.whatsapp_settings)
      : user.whatsapp_settings;

    if (!settings?.enabled || !settings.idInstance || !settings.apiTokenInstance) {
      return res.status(400).json({ error: 'WhatsApp not configured' });
    }

    // 🔹 2. Получаем ВСЕ договоры пользователя
    const salesRes = await pool.query(
      `SELECT data FROM data_items WHERE user_id = $1 AND type = 'sales'`,
      [userId]
    );
    const sales = salesRes.rows.map(r => r.data);

    // 🔹 3. Получаем всех клиентов
    const customersRes = await pool.query(
      `SELECT data FROM data_items WHERE user_id = $1 AND type = 'customers'`,
      [userId]
    );
    const customers = customersRes.rows.map(r => r.data);

    // 🔹 4. Фильтруем только ПРОСРОЧЕННЫЕ договоры
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdueSales = [];

    for (const sale of sales) {
      if (sale.status !== 'ACTIVE' && sale.status !== 'DRAFT') continue;

      // 🔹 Считаем задолженность (FIFO-логика)
      let expectedTotal = sale.downPayment || 0;
      for (const p of (sale.paymentPlan || [])) {
        if (!p.isRealPayment && new Date(p.date) < today) {
          expectedTotal += (p.amount || 0);
        }
      }
      const totalPaid = (sale.totalAmount || 0) - (sale.remainingAmount || 0);
      // Округляем до копеек: суммы вроде 48100/6 в double дают расхождение ~1e-12,
      // и без округления договор без долга проходил проверку «> 0». Клиенту при этом
      // уходило сообщение «Оплата просрочена, задолженность 0 ₽» — то же расхождение
      // ломало и вкладку «Просроченные». См. calculateSaleOverdue в src/utils.ts.
      const overdueAmount = Math.round((expectedTotal - totalPaid) * 100) / 100;

      // Порог в 1 ₽: остаток в копейки — артефакт округления долей платежа, а не долг.
      // Иначе клиенту уходило напоминание о «задолженности» в 0,33 ₽.
      if (overdueAmount >= 1) {
        const overduePayments = (sale.paymentPlan || []).filter(p =>
          !p.isPaid && !p.isRealPayment && new Date(p.date) < today
        );
        const customer = customers.find(c => c.id === sale.customerId);

        // ✅ Уважаем тумблер "Разрешить WhatsApp-уведомления" на карточке клиента —
        // раньше этот флаг нигде не проверялся, поэтому массовая рассылка писала
        // даже тем, кто явно отключил уведомления.
        if (customer && customer.phone && customer.allowWhatsappNotification !== false) {
          // 🔹 НОВОЕ: считаем фиксированный ежемесячный платёж из графика
          const monthlyPayment = (sale.paymentPlan || [])
            .filter(p => !p.isRealPayment)
            .map(p => p.amount)[0] || 0;

          overdueSales.push({
            sale,
            customer,
            overdueAmount,              // Реальный долг (после частичных оплат)
            monthlyPayment,             // Фиксированный платёж из графика
            monthsOverdue: overduePayments.length
          });
        }
      }
    }

    // 🔹 5. Отправляем сообщения
    const results = { total: overdueSales.length, sent: 0, failed: 0, errors: [] };
    const defaultOverdueTemplate = `🔔 *Напоминание о просрочке*\n\n*{имя}!*\n\n⚠️ Оплата по договору просрочена!\n\n🔸 *{товар}*\n   • Ежемесячный платёж: *{сумма} ₽*\n   • Задолженность: *{долг} ₽* ({месяцы} мес.)\n\n💰 *ИТОГО К ОПЛАТЕ: {итого} ₽*\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``;

    const rawTemplate = settings.templates?.[template] || defaultOverdueTemplate;

    // Состояние инстанса проверяем один раз на всю рассылку, а не перед каждым сообщением
    const instanceState = await getGreenApiState(settings.idInstance, settings.apiTokenInstance);
    if (instanceState && instanceState !== 'authorized') {
      return res.status(400).json({
        error: 'WhatsApp не подключён',
        msg: `Инстанс не авторизован (${instanceState}). Переподключите WhatsApp в настройках.`
      });
    }

    for (const item of overdueSales) {
  try {
    const monthlyPaymentText = item.monthlyPayment.toLocaleString('ru-RU');
    const overdueAmountText = item.overdueAmount.toLocaleString('ru-RU');
    const monthsText = String(item.monthsOverdue || 0);

    const productsBlock =
      `🔸 *${item.sale.productName || ''}*\n` +
      `   • Ежемесячный платёж: *${monthlyPaymentText} ₽*\n` +
      `   • Задолженность: *${overdueAmountText} ₽* (${monthsText} мес.)`;

    const totalBlock =
      `💰 *ИТОГО К ОПЛАТЕ: ${overdueAmountText} ₽*`;

    const message = rawTemplate
      .replace(/{имя}/g, item.customer.name)
      .replace(/{товар}/g, item.sale.productName || '')
      .replace(/{сумма}/g, monthlyPaymentText)
      .replace(/{долг}/g, overdueAmountText)
      .replace(/{итого}/g, overdueAmountText)
      .replace(/{месяцы}/g, monthsText)
      .replace(
        /{дата}/g,
        new Date().toLocaleDateString('ru-RU', {
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        })
      )
      .replace(/{товары_блок}/g, productsBlock)
      .replace(/{платеж_блок}/g, `   • Ежемесячный платёж: *${monthlyPaymentText} ₽*\n`)
      .replace(/{долг_блок}/g, '')
      .replace(/{итого_блок}/g, totalBlock)
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const sent = await sendGreenApiMessage(
      settings.idInstance,
      settings.apiTokenInstance,
      item.customer.phone,
      message,
      { skipStateCheck: true }
    );

    if (sent) {
      results.sent++;
    } else {
      results.failed++;
      results.errors.push({
        customer: item.customer.name,
        error: 'Green API failed'
      });
    }

    // Green API ограничивает частоту: с паузой 300 мс рассылка ловила 429 и теряла клиентов
    await new Promise(resolve => setTimeout(resolve, 1500));

  } catch (err) {
    results.failed++;
    results.errors.push({
      customer: item.customer.name,
      error: err.message
    });
    console.error(`❌ Failed to send to ${item.customer.name}:`, err.message);
  }
}


    if (results.sent > 0) {
      await createNotification(
        userId,
        'WHATSAPP_SENT',
        'Напоминания отправлены',
        `Отправлено WhatsApp-напоминаний: ${results.sent} из ${results.total}`,
        { sent: results.sent, total: results.total }
      );
    }

    return res.json({ success: true, results });

  } catch (err) {
    console.error('💥 /send-reminder-all error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});



// --- WHATSAPP WEBHOOK ---
// Ключ для сопоставления входящего сообщения с карточкой клиента.
// Отдаёт строку: нормализованный номер, а если номер непригоден — просто его цифры,
// чтобы сравнение всё равно могло сойтись.
const phoneKey = (phone) =>
  normalizePhone(phone).phone || String(phone || '').replace(/\D/g, '');

async function sendMessage(idInstance, apiTokenInstance, chatId, message) {
  try {
    const stateUrl = `https://api.green-api.com/waInstance${idInstance}/getStateInstance/${apiTokenInstance}`;
    const stateResponse = await axios.get(stateUrl, { timeout: 5000 });

    if (stateResponse.data?.stateInstance !== 'authorized') {
      return false;
    }

    const sendUrl = `https://api.green-api.com/waInstance${idInstance}/sendMessage/${apiTokenInstance}`;
    const response = await axios.post(
      sendUrl,
      { chatId, message },
      { timeout: 10000 }
    );

    return !!response.data?.idMessage;

  } catch (e) {
    return false;
  }
}

app.post(
  '/api/integrations/whatsapp/webhook',
  (req, res, next) => {

    express.json({ limit: '15mb' })(req, res, (err) => {
      if (err) {
        console.warn('⚠️ Webhook получил не-JSON данные. Игнорируем.');
        return res.status(200).send('OK');
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const body = req.body;
      const { typeWebhook, senderData, messageData, instanceData } = body;

      res.status(200).send('OK');
      if (!senderData?.chatId || typeWebhook !== 'incomingMessageReceived') return;
      if (messageData?.typeMessage !== 'textMessage') return;

      const chatId = senderData.chatId;
      if (chatId.includes('@g.us')) return;

      const rawPhone = chatId.replace('@c.us', '');
      const senderPhone = phoneKey(rawPhone);
      const text = (messageData.textMessageData.textMessage || '').trim().toLowerCase();

      const instanceId = String(instanceData?.idInstance || instanceData?.instanceId || body?.idInstance || '');
      if (!instanceId) return;

      // Поиск менеджера
      const managerResult = await pool.query(`
        SELECT id, name, whatsapp_settings
        FROM users
        WHERE whatsapp_settings->>'idInstance' = $1
        AND (whatsapp_settings->>'botEnabled')::boolean = true
        LIMIT 1
      `, [instanceId]);

      if (managerResult.rows.length === 0) return;

      const manager = managerResult.rows[0];
      const { id: managerId, name: managerName, whatsapp_settings: settings } = manager;
      const parsedSettings = typeof settings === 'string' ? JSON.parse(settings) : settings;
      if (!parsedSettings?.botEnabled) return;
      const companyName = parsedSettings?.companyName || 'Наша Компания';

      // Поиск клиента
      const customersResult = await pool.query(`
        SELECT id, data FROM data_items
        WHERE type = 'customers' AND user_id = $1
      `, [managerId]);

      const customerRow = customersResult.rows.find(row =>
        phoneKey(row.data?.phone || '') === senderPhone
      );

      if (!customerRow) return;

      const customerId = customerRow.id;
      let customerData = customerRow.data;

      if (customerData.lastBotResponse === undefined) customerData.lastBotResponse = null;
      if (customerData.lastNoContractsMessage === undefined) customerData.lastNoContractsMessage = null;

      // Поиск договоров
      const salesResult = await pool.query(`
        SELECT data FROM data_items
        WHERE user_id = $1 AND type = 'sales'
        AND data->>'customerId' = $2
        AND (data->>'status' = 'ACTIVE' OR data->>'status' = 'DRAFT')
      `, [managerId, String(customerId)]);

      const activeSales = salesResult.rows.map(r => r.data);

      const formatMoney = (amount) => Number(amount).toLocaleString('ru-RU').replace(',', ' ');
      const formatDate = (dateStr) => new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });

      // Проверка команд — теперь идёт ПЕРВОЙ: раньше бот отвечал "у вас нет
      // активных договоров" на ЛЮБОЕ входящее сообщение (если нет команды —
      // тоже), просто не чаще раза в сутки. Теперь бот вообще не реагирует на
      // произвольный текст — только на распознанные команды ниже.
      let command = null;
      if (text.includes('история') || text.includes('остаток') || text.includes('долг')) command = 'history';
      else if (text.includes('условия')) command = 'conditions';

      if (!command) return;

      // Проверка: нет договоров (тоже не чаще раза в сутки, но теперь только
      // в ответ на распознанную команду, а не на любое слово)
      if (activeSales.length === 0) {
        const now = Date.now();
        const lastMsg = customerData.lastNoContractsMessage || 0;
        if (!customerData.lastNoContractsMessage || (now - lastMsg) > (24 * 60 * 60 * 1000)) {
          await sendMessage(parsedSettings.idInstance, parsedSettings.apiTokenInstance, chatId,
            `Здравствуйте 👋 Я ассистент ${managerName}. У вас нет активных договоров.`);
          customerData.lastNoContractsMessage = now;
          await pool.query(`UPDATE data_items SET data = $1 WHERE id = $2`, [JSON.stringify({ ...customerData, lastNoContractsMessage: now }), customerId]);
        }
        return;
      }

      {
          if (customerData.lastCommandTime === undefined) {
    customerData.lastCommandTime = null;
  }
  if (customerData.lastCommand === undefined) {
    customerData.lastCommand = null;
  }

  // 🔥 ЗАЩИТА ОТ СПАМА: 30 секунд между одинаковыми командами
  const now = Date.now();
  const lastCommandTime = customerData.lastCommandTime || 0;
  const lastCommand = customerData.lastCommand;

  if (lastCommand === command && (now - lastCommandTime) < 30000) {
    const secondsLeft = Math.ceil((30000 - (now - lastCommandTime)) / 1000);
    // Можно отправить сообщение клиенту (опционально):
     await sendMessage(parsedSettings.idInstance, parsedSettings.apiTokenInstance, chatId,
     `⏳ Пожалуйста, подождите ${secondsLeft} сек. перед повторным запросом.`);
    return;
  }

        let responseText = '';

        if (command === 'history') {
  let totalDebt = 0;
  let totalMonthly = 0;
  const productsMap = new Map();

  for (const sale of activeSales) {
    const productName = sale.productName || sale.product || `Товар #${sale.id}`;

    if (!productsMap.has(productName)) {
      productsMap.set(productName, { name: productName, debt: 0, monthly: 0, payments: [] });
    }

    const productData = productsMap.get(productName);
    const paymentPlan = sale.paymentPlan || [];

    // 🔥 ЛОГИКА РАСЧЁТА ДОЛГА (как в React)
    const totalPlanAmount = paymentPlan.reduce((sum, p) => sum + (parseFloat(p.amount || p.sum || 0) || 0), 0);

    const totalRealMoney = paymentPlan
      .filter(p => p.isRealPayment === true)
      .reduce((sum, p) => sum + (parseFloat(p.amount || p.sum || 0) || 0), 0);

    const totalAllocated = paymentPlan
      .filter(p => p.isPaid && p.isRealPayment !== true)
      .reduce((sum, p) => sum + (parseFloat(p.amount || p.sum || 0) || 0), 0);

    let surplus = Math.max(0, totalRealMoney - totalAllocated);
    let currentDebt = 0;

    paymentPlan.forEach(p => {
      if (!p.isPaid && p.isRealPayment !== true) {
        const amountDue = parseFloat(p.amount || p.sum || 0) || 0;
        const covered = Math.min(amountDue, surplus);
        surplus = Math.max(0, surplus - covered);
        currentDebt += (amountDue - covered);
      }
    });
    currentDebt = Math.max(0, currentDebt);

    const monthly = parseFloat(sale.monthlyPayment || paymentPlan[0]?.amount || 0) || 0;
    productData.debt += currentDebt;
    productData.monthly += monthly;

    // История платежей
    const paidHistory = paymentPlan
      .filter(p => p.isPaid && p.isRealPayment !== false)
      .map(p => ({
        date: new Date(p.actualDate || p.date),
        amount: parseFloat(p.amount || p.sum || 0) || 0
      }))
      .filter(p => !isNaN(p.date.getTime()) && p.amount > 0);

    productData.payments.push(...paidHistory);
  }

  // 🔥 Формируем ответ
  responseText = `╔══════════════╗\n     *📋 Детали договоров*\n╚══════════════╝\n\n`;

  for (const [productName, data] of productsMap) {
    totalDebt += data.debt;
    totalMonthly += data.monthly;

    responseText += `━━━━━━━━━━━━━━━━━\n`;
    responseText += `🔹 *${productName}*\n`;
    responseText += `• Ежемесячный платёж: *${formatMoney(data.monthly)} ₽*\n`;

    if (data.debt > 0.01) {
      responseText += `• 🔴 Остаток долга: *${formatMoney(data.debt)} ₽*\n`;
    } else {
      responseText += `• ✅ Погашен полностью\n`;
    }

    if (data.payments.length > 0) {
      const uniquePayments = data.payments
        .sort((a, b) => b.date - a.date)
        .filter((p, i, arr) => {
          const prev = arr[i - 1];
          if (!prev) return true;
          return p.date.toISOString() !== prev.date.toISOString() || p.amount !== prev.amount;
        })
        .slice(0, 10);

      responseText += `\n📜 *История платежей:*\n`;
      for (const p of uniquePayments) {
        responseText += `   • ${formatDate(p.date)} — *${formatMoney(p.amount)} ₽* ✅\n`;
      }
    }
    responseText += `\n`;
  }

  // 🔥 ПОКАЗЫВАЕМ ОБЩИЙ ИТОГ ТОЛЬКО ЕСЛИ ТОВАРОВ > 1
  if (productsMap.size > 1) {
    responseText += `━━━━━━━━━━━━━━━━━\n`;
    responseText += `📊 *ОБЩИЙ ИТОГ:*\n`;
    responseText += `• Ежемесячно: *${formatMoney(totalMonthly)} ₽*\n`;
    responseText += `• Общий долг: *${formatMoney(totalDebt)} ₽*\n`;
  }
}
       else if (command === 'conditions') {
  const cleanCompany = (companyName || 'НашаКомпания').trim().replace(/\s+/g, '-');
  const baseUrl = 'https://rassrochka.pro';

  // 🔥 Читаем настройки калькулятора
  const calcSettings = parsedSettings?.calculator || {
    defaultInterestRate: 30,
    maxMonths: 12,
    termRates: []
  };

  const defaultRate = calcSettings.defaultInterestRate || 30;
  const maxMonths = calcSettings.maxMonths || 12;
  const termRates = calcSettings.termRates || [];

  // 🔥 Кодируем специальные ставки в короткий формат: 4:25,5:25,6:30
  const shortRules = termRates.length > 0
    ? termRates.map(r => `${r.months}:${r.rate}`).join(',')
    : null;

  // 🔥 Формируем ссылку с параметрами
  let calculatorUrl = `${baseUrl}/calc/${cleanCompany}?r=${defaultRate}`;
  if (shortRules) {
    calculatorUrl += `&l=${encodeURIComponent(shortRules)}`;
  }



  // Формируем красивое сообщение
  responseText = `╔════════════════╗
   *📝 Условия рассрочки*
╚════════════════╝\n\n`;

  responseText += `🏢 *${companyName}*\n\n`;
  responseText += `━━━━━━━━━━━━━━━━━\n\n`;
  responseText += `🔗 *Рассчитайте платёж онлайн:*\n`;
  responseText += `${calculatorUrl}\n\n`;
  responseText += `_(Нажмите на ссылку выше)_`;
}

        await sendMessage(parsedSettings.idInstance, parsedSettings.apiTokenInstance, chatId, responseText);

        const updatedCustomer = { ...customerData, lastBotResponse: command, lastCommand: command,              // ← Для защиты от повторов
          lastCommandTime: now, lastNoContractsMessage: customerData.lastNoContractsMessage };
        await pool.query(`UPDATE data_items SET data = $1 WHERE id = $2`, [JSON.stringify(updatedCustomer), customerId]);
        return;
      }

    } catch (error) {
      console.error('❌ Ошибка в вебхуке WhatsApp:', error.message);

    }
  }
);

// Send Verification Code
app.post('/api/auth/send-code', sendCodeLimiter, async (req, res) => {
  const { email, type } = req.body;

  const normalizedEmail = email.toLowerCase().trim();
  try {
    const userCheck = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
    const userExists = userCheck.rows.length > 0;

    if (type === 'REGISTER' && userExists) {
      return res.status(400).json({ msg: 'Пользователь с таким Email уже существует' });
    }
    if (type === 'RESET' && !userExists) {
      return res.status(400).json({ msg: 'Пользователь не найден' });
    }

    const code = generateCode();
    // 🔹 Было 10 минут — часть реальных ошибок регистрации оказалась "Код истёк" из-за
    // задержки доставки письма (почтовые провайдеры/мобильные сети). 15 минут даёт запас.
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

   await pool.query(`
      INSERT INTO verification_codes (email, code, expires_at, attempts)
      VALUES ($1, $2, $3, 0)
      ON CONFLICT (email)
      DO UPDATE SET code = $2, expires_at = $3, attempts = 0
    `, [normalizedEmail, code, expiresAt]);

    const subject = type === 'REGISTER'
      ? '🔐 Код подтверждения регистрации — FinUchet'
      : '🔄 Код восстановления пароля — FinUchet';

    // 🎨 Простой шаблон с инлайн-стилями (работает во всех почтовиках)
    const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc">
  <div style="max-width:480px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08)">
    
    <!-- Шапка с градиентом -->
    <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:24px;text-align:center">
      <div style="color:#fff;font-size:20px;font-weight:600;margin-bottom:4px">FinUchet</div>
      <div style="color:rgba(255,255,255,0.9);font-size:16px">
        ${type === 'REGISTER' ? 'Добро пожаловать!' : 'Восстановление доступа'}
      </div>
    </div>
    
    <!-- Контент -->
    <div style="padding:28px 24px">
      <p style="margin:0 0 20px;color:#334155;font-size:15px;line-height:1.5">
        Здравствуйте!<br><br>
        ${type === 'REGISTER' 
          ? 'Подтвердите ваш email для завершения регистрации в FinUchet.' 
          : 'Используйте код ниже для сброса пароля.'}
      </p>
      
      <!-- Блок с кодом -->
      <div style="background:#f1f5f9;border:2px dashed:#cbd5e1;border-radius:10px;padding:20px;text-align:center;margin:24px 0">
        <div style="font-size:28px;font-weight:700;color:#1e293b;letter-spacing:6px;font-family:monospace">
          ${code}
        </div>
        <div style="color:#64748b;font-size:13px;margin-top:8px">⏱ Действителен 15 минут</div>
      </div>
      
      <p style="margin:0;color:#64748b;font-size:14px">
        💡  ${type === 'REGISTER' 
          ? 'Если вы не регистрировались, просто проигнорируйте это письмо.' 
          : 'Если вы не запрашивали сброс пароля, проигнорируйте это письмо.'}
      </p>
    </div>
    
    <!-- Футер -->
    <div style="background:#f8fafc;padding:16px 24px;text-align:center;border-top:1px solid #e2e8f0">
      
      <p style="margin:8px 0 0;color:#94a3b8;font-size:13px">
        © ${new Date().getFullYear()} FinUchet • <a href="https://rassrochka.pro" style="color:#4f46e5;text-decoration:none">rassrochka.pro</a>
      </p>
    </div>
    
  </div>
</body>
</html>
    `;

    // Текстовая версия для фолбэка
    const text = `Ваш код подтверждения для FinUchet: ${code}. Код действителен 15 минут.`;

    // 📧 Отправка с поддержкой HTML
    await sendEmail(normalizedEmail, subject, text, html);

    res.json({ msg: 'Код отправлен' });

  } catch (err) {
    console.error('Send Code Error:', err);
    res.status(500).json({ msg: 'Ошибка сервера при отправке кода' });
  }
});

app.post('/api/auth/register', registerLimiter, async (req, res) => {
  const { name, email, password, code, permissions, allowedInvestorIds } = req.body;
  const normalizedEmail = email.toLowerCase().trim();

  // 🔒 Открытая регистрация создаёт ТОЛЬКО менеджера — role и managerId из тела запроса
  // игнорируются. Сотрудники и инвесторы заводятся авторизованным менеджером через
  // /api/users/manage, где managerId берётся из его сессии и проверяются лимиты тарифа.
  //
  // Раньше их принимали снаружи: в БД роль уже подменялась на 'manager', но JWT всё равно
  // выписывался с ролью из запроса — а доступ строится на роли из токена (см. adminAuth),
  // поэтому role:'admin' открывал данные всех тенантов. Второе следствие — role:'employee'
  // с чужим managerId давал доступ к данным чужого менеджера через getTargetUserId.
  const safeRole = 'manager';
  const safeManagerId = null;

  try {
    // 1. Verify Code
    const codeCheck = await pool.query('SELECT * FROM verification_codes WHERE email = $1', [normalizedEmail]);
    if (codeCheck.rows.length === 0) {
      return res.status(400).json({ msg: 'Сначала запросите код' });
    }
    const record = codeCheck.rows[0];
    if (new Date() > new Date(record.expires_at)) {
      return res.status(400).json({ msg: 'Код истек' });
    }
    if (record.code !== code) {
      return res.status(400).json({ msg: 'Неверный код' });
    }

    // 2. Check User Existence
    const userCheck = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ msg: 'Пользователь уже существует' });
    }

    const id = safeRole === 'investor' ? `u_inv_${Date.now()}` : (safeRole === 'employee' ? `u_emp_${Date.now()}` : `u_${Date.now()}`);
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Initial Subscription (3 Days Trial) for Managers
    let subscription = null;
    if (safeRole === 'manager') {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 3);
      subscription = {
        plan: 'TRIAL',
        expiresAt: expiresAt.toISOString()
      };
    }
    
    // 🎁 Реферальная программа. Код выдаётся только менеджерам: сотрудники и инвесторы —
    // подчинённые учётные записи, приглашать они никого не могут.
    const referralCode = safeRole === 'manager'
      ? crypto.createHash('md5').update(id + 'finuchet-ref').digest('hex').slice(0, 8).toUpperCase()
      : null;

    // Кто пригласил. Проверяем существование кода на сервере, а не доверяем клиенту.
    let referredBy = null;
    if (safeRole === 'manager' && req.body.referralCode) {
      const ref = await pool.query(
        `SELECT id FROM users WHERE referral_code = $1 AND role = 'manager' LIMIT 1`,
        [String(req.body.referralCode).trim().toUpperCase()]
      );
      // Пригласить самого себя нельзя: id нового пользователя ещё не существует,
      // но код мог быть подставлен от уже существующего аккаунта того же человека —
      // на этот случай ниже, при начислении награды, стоит проверка по e-mail и телефону.
      if (ref.rowCount > 0 && ref.rows[0].id !== id) {
        referredBy = ref.rows[0].id;
      }
    }

    // Insert User
    await pool.query(
      `INSERT INTO users (id, name, email, password, role, manager_id, permissions, allowed_investor_ids, subscription, referral_code, referred_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        name,
        normalizedEmail,
        hashedPassword,
        safeRole,
        safeManagerId,
        JSON.stringify(permissions || {}),
        JSON.stringify(allowedInvestorIds || []),
        subscription ? JSON.stringify(subscription) : null,
        referralCode,
        referredBy
      ]
    );
    
    // Clean up code
      await pool.query('DELETE FROM verification_codes WHERE email = $1', [normalizedEmail]);
    
    // Create default account for managers
    if (safeRole === 'manager') {
      const accId = `acc_main_${id}`;
      const accData = { id: accId, userId: id, name: 'Основной счет', type: 'MAIN' };
      await pool.query(
        `INSERT INTO data_items (id, user_id, type, data) VALUES ($1, $2, $3, $4)`,
        [accId, id, 'accounts', JSON.stringify(accData)]
      );
    }
    
    // Токен выписываем строго по safeRole: именно из него берётся роль при проверке доступа
    const token = jwt.sign({ id, role: safeRole, managerId: safeManagerId }, JWT_SECRET, { expiresIn: '90d' });
    res.json({ token, user: { id, name, email: normalizedEmail, role: safeRole, managerId: safeManagerId, permissions, allowedInvestorIds, subscription } });
  } catch (err) {
    console.error('Register Error:', err);
    res.status(500).send('Server error');
  }
});

app.post('/api/auth/reset-password', resetPasswordLimiter, async (req, res) => {
  const { email, code, newPassword } = req.body;
  const normalizedEmail = email.toLowerCase().trim();
  try {
    // 1. Verify Code
    const codeCheck = await pool.query('SELECT * FROM verification_codes WHERE email = $1', [normalizedEmail]);
    if (codeCheck.rows.length === 0) {
      return res.status(400).json({ msg: 'Сначала запросите код' });
    }
    const record = codeCheck.rows[0];
    if (new Date() > new Date(record.expires_at)) {
      return res.status(400).json({ msg: 'Код истек' });
    }
    if (record.code !== code) {
      return res.status(400).json({ msg: 'Неверный код' });
    }
    
    // 2. Update Password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    await pool.query('UPDATE users SET password = $1, updated_at = NOW() WHERE email = $2', [hashedPassword, normalizedEmail]);
    
    // Clean up code
    await pool.query('DELETE FROM verification_codes WHERE email = $1', [normalizedEmail]);
    res.json({ msg: 'Пароль успешно изменен' });
  } catch (err) {
    console.error('Reset Password Error:', err);
    res.status(500).send('Server error');
  }
});

// ✅ ИСПРАВЛЕННЫЙ ЛОГИН С RATE LIMITING
app.post('/api/auth/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ msg: 'Email и пароль обязательны' });
    }
    const normalizedEmail = email.toLowerCase().trim();

    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
        if (result.rows.length === 0) return res.status(400).json({ msg: 'Неверные учетные данные' });
        
        const user = result.rows[0];

        if (user.blocked) {
            return res.status(403).json({ msg: 'Аккаунт заблокирован. Обратитесь в поддержку.', code: 'BLOCKED' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ msg: 'Неверные учетные данные' });

        // 🔥 Подставляем подписку владельца для сотрудника
        let subscription = user.subscription;
        if (user.role === 'employee' && user.manager_id) {
            const managerRes = await pool.query('SELECT subscription FROM users WHERE id = $1', [user.manager_id]);
            if (managerRes.rows.length > 0 && managerRes.rows[0].subscription) {
                subscription = managerRes.rows[0].subscription;
            }
        }

        const token = jwt.sign({ id: user.id, role: user.role, managerId: user.manager_id }, JWT_SECRET, { expiresIn: '90d' });
        
        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                role: user.role,
                managerId: user.manager_id,
                permissions: user.permissions,
                allowedInvestorIds: user.allowed_investor_ids,
                fullAccessInvestorIds: user.full_access_investor_ids,
                profitPercentage: user.profit_percentage !== null && user.profit_percentage !== undefined ? Number(user.profit_percentage) : undefined,
                profitBase: user.profit_base || undefined,
                profitReducesManager: user.profit_reduces_manager !== false,
            profitSource: user.profit_source || undefined,
            profitSince: toDateString(user.profit_since),
                profitSource: user.profit_source || undefined,
                profitSince: toDateString(user.profit_since),
                subscription: subscription, // <- Передаем подписку владельца!
                whatsapp_settings: user.whatsapp_settings
            }
        });
    } catch (err) {
        console.error('Login Error:', err);
        res.status(500).send('Server error');
    }
});

// Get current user
app.get('/api/auth/me', auth, async (req, res) => {
    try {
        // 🔥 ДОБАВИЛИ permissions и allowed_investor_ids в SELECT
        const result = await pool.query(
            'SELECT id, name, email, phone, role, manager_id, subscription, whatsapp_settings, api_key, permissions, allowed_investor_ids, full_access_investor_ids, blocked FROM users WHERE id = $1',
            [req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ msg: 'User not found' });
        const user = result.rows[0];

        if (user.blocked) {
            return res.status(403).json({ msg: 'Аккаунт заблокирован. Обратитесь в поддержку.', code: 'BLOCKED' });
        }

        // 🔥 НАСЛЕДОВАНИЕ ТАРИФА: Если это сотрудник, подставляем подписку менеджера
        let subscription = user.subscription;
        if (user.role === 'employee' && user.manager_id) {
            const managerRes = await pool.query('SELECT subscription FROM users WHERE id = $1', [user.manager_id]);
            if (managerRes.rows.length > 0 && managerRes.rows[0].subscription) {
                subscription = managerRes.rows[0].subscription;
            }
        }

        res.json({
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            role: user.role,
            managerId: user.manager_id,
            subscription: subscription, // <- Подписка владельца
            whatsapp_settings: user.whatsapp_settings,
            permissions: user.permissions, // 🔥 ВОЗВРАЩАЕМ ПРАВА (canEdit, canDelete)
            allowedInvestorIds: user.allowed_investor_ids, // 🔥 ВОЗВРАЩАЕМ СПИСОК ИНВЕСТОРОВ
            fullAccessInvestorIds: user.full_access_investor_ids,
            profitPercentage: user.profit_percentage !== null && user.profit_percentage !== undefined ? Number(user.profit_percentage) : undefined,
            profitBase: user.profit_base || undefined,
            profitReducesManager: user.profit_reduces_manager !== false,
            apiKey: user.role === 'admin' ? user.api_key : undefined
        });
    } catch (err) {
        console.error('Me Error:', err);
        res.status(500).send('Server error');
    }
});

// Update WhatsApp Settings
app.post('/api/user/whatsapp', auth, async (req, res) => {
  const settings = req.body;
  try {
    await pool.query('UPDATE users SET whatsapp_settings = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(settings), req.user.id]
    );
    res.json({ success: true });
  } catch (e) {
    console.error("WhatsApp settings update error:", e);
    res.status(500).send('Server Error');
  }
});

// Subscription Management (только admin — обновление через UI не поддерживается, используется webhook)
app.post('/api/user/subscription', auth, async (req, res) => {
  const { plan, months } = req.body;

  if (req.user.role !== 'admin') {
    return res.status(403).json({ msg: 'Forbidden' });
  }

  const VALID_PLANS = ['TRIAL', 'START', 'STANDARD', 'BUSINESS'];
  if (!VALID_PLANS.includes(plan)) {
    return res.status(400).json({ msg: 'Invalid plan' });
  }
  if (!months || months < 1 || months > 24) {
    return res.status(400).json({ msg: 'Invalid months (1–24)' });
  }
  
  try {
    const userResult = await pool.query('SELECT subscription FROM users WHERE id = $1', [req.user.id]);
    let currentSub = userResult.rows[0]?.subscription || { plan: 'TRIAL', expiresAt: new Date().toISOString() };
    
    let newExpiresAt = new Date(currentSub.expiresAt);
    if (newExpiresAt < new Date()) {
      newExpiresAt = new Date();
    }
    newExpiresAt = addMonthsClamped(newExpiresAt, Number(months));
    
    const updatedSub = {
      plan: plan,
      expiresAt: newExpiresAt.toISOString()
    };
    
    await pool.query('UPDATE users SET subscription = $1 WHERE id = $2', [JSON.stringify(updatedSub), req.user.id]);
    res.json({ subscription: updatedSub });
  } catch (e) {
    console.error("Subscription update error:", e);
    res.status(500).send('Server Error');
  }
});


app.get('/api/data', auth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);

    if (!canAccessUserData(req.user, targetUserId)) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    let query;
    let params;

    // 🔹 ОПТИМИЗИРОВАННЫЕ ЗАПРОСЫ (без вложенных подзапросов)
    if (req.user.role === 'manager' || req.user.role === 'admin') {
      // 🔑 Используем UNION вместо OR — работает в 10-50 раз быстрее
      query = `
        SELECT * FROM data_items WHERE user_id = $1
        UNION
        SELECT * FROM data_items WHERE type = 'investors' AND data->>'userId' = $1
        UNION
        SELECT d.* FROM data_items d
        INNER JOIN data_items inv ON d.data->>'ownerId' = inv.data->>'id'
        WHERE d.type IN ('accounts') AND inv.type = 'investors' AND inv.data->>'userId' = $1
        UNION
        SELECT d.* FROM data_items d
        INNER JOIN data_items acc ON d.data->>'accountId' = acc.data->>'id'
        INNER JOIN data_items inv ON acc.data->>'ownerId' = inv.data->>'id'
        WHERE d.type IN ('sales', 'expenses') AND inv.type = 'investors' AND inv.data->>'userId' = $1
      `;
      params = [targetUserId];
    } else if (req.user.role === 'investor') {
      query = `
        SELECT * FROM data_items WHERE user_id = $1
        UNION
        SELECT * FROM data_items WHERE type = 'investors' AND data->>'id' = $1
        UNION
        SELECT * FROM data_items WHERE type = 'accounts' AND data->>'ownerId' = $1
        UNION
        SELECT d.* FROM data_items d
        INNER JOIN data_items acc ON d.data->>'accountId' = acc.data->>'id'
        WHERE d.type IN ('sales', 'expenses') AND acc.type = 'accounts' AND acc.data->>'ownerId' = $1
      `;
      params = [targetUserId];
    } else {
      // Для сотрудников и остальных — простой запрос
      query = 'SELECT * FROM data_items WHERE user_id = $1';
      params = [targetUserId];
    }

    const itemsResult = await pool.query(query, params);

    const result = {
      customers: [], products: [], sales: [], expenses: [],
      accounts: [], investors: [], partnerships: [], suppliers: [], tasks: [], settings: null
    };

    itemsResult.rows.forEach(row => {
      if (row.type === 'settings') {
        result.settings = row.data;
      } else if (result[row.type]) {
        // 🔑 Для инвесторов: менеджер видит только своих
        if (row.type === 'investors' && (req.user.role === 'manager' || req.user.role === 'admin')) {
          if (row.data.userId === req.user.id || row.data.userId === undefined) {
            result[row.type].push(row.data);
          }
        } else {
          result[row.type].push(row.data);
        }
      }
    });

    // Fetch Employees
    let employees = [];
    if (req.user.role === 'manager' || req.user.role === 'admin') {
      const usersResult = await pool.query(
        'SELECT * FROM users WHERE manager_id = $1 AND role = $2',
        [req.user.id, 'employee']
      );
      employees = usersResult.rows.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        permissions: u.permissions,
        allowedInvestorIds: u.allowed_investor_ids,
        fullAccessInvestorIds: u.full_access_investor_ids,
        // Мотивация сотрудника: процент, база расчёта и влияние на прибыль менеджера
        profitPercentage: u.profit_percentage !== null && u.profit_percentage !== undefined ? Number(u.profit_percentage) : undefined,
        profitBase: u.profit_base || undefined,
        profitReducesManager: u.profit_reduces_manager !== false,
        profitSource: u.profit_source || undefined,
        profitSince: toDateString(u.profit_since)
      }));
    }

    let finalResult = { ...result, employees };

    // 🔥 ИСПРАВЛЕНО: allowed_investor_ids отсутствовал в JWT (там только id/role/managerId),
    // поэтому фильтрация раньше никогда не срабатывала — сотрудник видел весь датасет менеджера.
    // Теперь берём актуальные права доступа прямо из БД.
    if (req.user.role === 'employee') {
      const empResult = await pool.query(
        'SELECT allowed_investor_ids, full_access_investor_ids FROM users WHERE id = $1',
        [req.user.id]
      );
      const allowedIds = parseAllowedInvestorIds(empResult.rows[0]?.allowed_investor_ids);
      const fullAccessIds = parseAllowedInvestorIds(empResult.rows[0]?.full_access_investor_ids);
      finalResult = filterDataForEmployee(finalResult, allowedIds, fullAccessIds, req.user.id);
    }

    // 🔒 Кто из инвесторов сверх лимита тарифа. Считаем на сервере и отдаём готовым списком,
    // чтобы интерфейс и проверки при записи опирались на одно и то же правило и не разошлись.
    try {
      const { limit, lockedIds, lockedAccountIds } = await getInvestorLimitState(targetUserId);
      finalResult.investorLimit = limit;
      finalResult.lockedInvestorIds = lockedIds;
      finalResult.lockedAccountIds = lockedAccountIds || [];
    } catch (e) {
      console.error('⚠️ Не удалось вычислить лимит инвесторов:', e.message);
      finalResult.lockedInvestorIds = [];
      finalResult.lockedAccountIds = [];
    }

    res.json(finalResult);
  } catch (err) {
    console.error('❌ /api/data error:', err);
    res.status(500).send('Server Error');
  }
});





app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ✅ Версия Android-приложения (APK), которую нужно предлагать пользователям для установки.
// Увеличивать при каждом релизе, требующем обновления APK (изменения на нативном уровне —
// новые Capacitor-плагины, права и т.п.), синхронно с versionCode в android/app/build.gradle.
// Обычные правки веб-кода сами подхватываются WebView с каждым открытием приложения — версию
// бампать для них не нужно.
const LATEST_ANDROID_VERSION_CODE = 3;

app.get('/api/app-version', (req, res) => {
  res.json({
    androidVersionCode: LATEST_ANDROID_VERSION_CODE,
    apkUrl: '/downloads/finuchet.apk'
  });
});

// 🔹 Явная поддержка HEAD (для быстрого пинга без тела ответа)
app.head('/api/health', (req, res) => {
  res.status(200).end();
});


app.post('/api/data/:type', auth, async (req, res) => {
  try {
    const { type } = req.params;
    if (!VALID_DATA_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Недопустимый тип данных' });
    }

    const itemData = req.body;

    // 🔹 ЗАЩИТА: проверяем, что данные — объект, а не массив или пустота
    if (!itemData || typeof itemData !== 'object' || Array.isArray(itemData)) {
      return res.status(400).json({
        error: 'Неверный формат данных. Ожидался объект с полем id.'
      });
    }

    if (!itemData.id) {
      return res.status(400).json({ error: 'Отсутствует ID элемента' });
    }

    let targetUserId = getTargetUserId(req.user);

    if (!canAccessUserData(req.user, targetUserId)) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    // 🔒 Без активной подписки запись данных закрыта полностью: ни новых договоров,
    // ни платежей, ни правок. Раньше это проверялось только на клиенте (checkAccess('WRITE')),
    // то есть пряталось в интерфейсе, но запрос к API всё равно проходил.
    // Настройки оставляем доступными — иначе нельзя выключить, например, авторассылку,
    // которая продолжает писать клиентам от имени пользователя.
    if (type !== 'settings') {
      const sub = await getSubscriptionState(targetUserId);
      if (sub.expired) {
        return res.status(403).json({
          code: 'SUBSCRIPTION_EXPIRED',
          msg: 'Срок действия подписки истёк.',
          hint: 'Продлите тариф, чтобы снова вести учёт: создавать договоры и проводить платежи.'
        });
      }
    }

    // 🔒 Права сотрудника и его область счетов — проверяются здесь, а не только в интерфейсе
    const empCheck = await checkEmployeeWriteAccess({
      user: req.user, type, itemId: itemData.id, accountId: itemData.accountId, isDelete: false
    });
    if (!empCheck.ok) return res.status(empCheck.status).json(empCheck.body);

    // 🔒 Модуль "Партнеры" (поставщики) — только тариф BUSINESS_PRO
    if (type === 'suppliers' || (type === 'sales' && itemData.supplierId) || (type === 'expenses' && itemData.supplierId)) {
      const featureAccess = await checkFeatureAccess(targetUserId, 'suppliers');
      if (!featureAccess.allowed) {
        return res.status(403).json({ msg: featureAccess.msg, hint: featureAccess.hint });
      }
    }

    // 🔒 Лимит инвесторов по тарифу. Проверяем ЗДЕСЬ, а не только при заведении логина:
    // инвестор без e-mail логина не создаёт, и раньше лимит обходился простым незаполнением
    // почты. Правка уже существующего инвестора разрешена всегда — иначе пользователь,
    // оказавшийся сверх лимита после понижения тарифа, не смог бы ничего исправить.
    if (type === 'investors') {
      const { limit, lockedIds, plan } = await getInvestorLimitState(targetUserId);
      if (limit !== -1) {
        const existsRes = await pool.query(
          `SELECT 1 FROM data_items WHERE id = $1 AND user_id = $2 AND type = 'investors'`,
          [itemData.id, targetUserId]
        );
        const isNew = existsRes.rowCount === 0;

        if (isNew) {
          const countRes = await pool.query(
            `SELECT COUNT(*)::int AS c FROM data_items WHERE user_id = $1 AND type = 'investors'`,
            [targetUserId]
          );
          if (countRes.rows[0].c >= limit) {
            console.log(`🚫 LIMIT_HIT investors: user=${targetUserId}, plan=${plan}, current=${countRes.rows[0].c}, limit=${limit}`);
            return res.status(403).json({
              code: 'INVESTOR_LIMIT',
              msg: `На тарифе «${plan}» доступен ${limit === 1 ? 'только 1 инвестор' : `${limit} инвесторов`}. Сейчас у вас ${countRes.rows[0].c}.`,
              hint: 'Повысьте тариф, чтобы добавить больше инвесторов.',
              details: { current: countRes.rows[0].c, limit, plan }
            });
          }
        } else if (lockedIds.includes(itemData.id)) {
          // Заблокированного инвестора менять нельзя — иначе через правку доли можно
          // продолжать им пользоваться в обход лимита
          return res.status(403).json({
            code: 'INVESTOR_LOCKED',
            msg: 'Этот инвестор заблокирован: он сверх лимита вашего тарифа.',
            hint: 'Повысьте тариф, чтобы снова работать с ним.'
          });
        }
      }
    }

    // 🔒 Операции с заблокированным инвестором и по его счёту закрыты до повышения тарифа.
    // Сами данные и история расчётов при этом сохраняются нетронутыми.
    //
    // Счёт проверяем отдельно от инвестора: без этого деньги можно было бы проводить
    // через тот же счёт, просто не указывая инвестора в операции.
    if (type === 'expenses' || type === 'sales' || type === 'accounts') {
      const { lockedIds, lockedAccountIds } = await getInvestorLimitState(targetUserId);

      if (itemData.investorId && lockedIds.includes(itemData.investorId)) {
        return res.status(403).json({
          code: 'INVESTOR_LOCKED',
          msg: 'Инвестор заблокирован: он сверх лимита вашего тарифа.',
          hint: 'Повысьте тариф, чтобы проводить операции с этим инвестором.'
        });
      }

      // Для самого счёта проверяем его id, для операций — счёт, по которому они идут
      const touchedAccount = type === 'accounts' ? itemData.id : itemData.accountId;
      if (touchedAccount && lockedAccountIds.includes(touchedAccount)) {
        return res.status(403).json({
          code: 'ACCOUNT_LOCKED',
          msg: 'Счёт заблокирован: он принадлежит инвестору сверх лимита вашего тарифа.',
          hint: 'Повысьте тариф, чтобы снова проводить операции по этому счёту.'
        });
      }
    }

    // 🔒 Общий инвестиционный пул (Account.type === 'POOL') — только тариф BUSINESS_PRO.
    // Проценты участников пула независимы друг от друга (каждый применяется только к части
    // прибыли, приходящейся на капитал именно этого инвестора — см. getAccountShares в
    // src/utils.ts), поэтому проверять их сумму на превышение 100% не нужно.
    if (type === 'accounts' && itemData.type === 'POOL') {
      const featureAccess = await checkFeatureAccess(targetUserId, 'investorPools');
      if (!featureAccess.allowed) {
        return res.status(403).json({ msg: featureAccess.msg, hint: featureAccess.hint });
      }
    }

    // 🔒 Задачи — тарифы Бизнес и Бизнес Pro. Плюс сотрудник вправе трогать только то,
    // что назначено лично ему: без этой проверки он мог бы переписать любую задачу
    // менеджера, ведь пишет он в данные менеджера (targetUserId).
    let taskNotifyContext = null;
    if (type === 'tasks') {
      const featureAccess = await checkFeatureAccess(targetUserId, 'tasks');
      if (!featureAccess.allowed) {
        return res.status(403).json({ msg: featureAccess.msg, hint: featureAccess.hint });
      }

      const existingTaskRes = await pool.query(
        `SELECT data FROM data_items WHERE id = $1 AND user_id = $2 AND type = 'tasks'`,
        [itemData.id, targetUserId]
      );
      const existingTask = existingTaskRes.rows[0]?.data || null;

      if (req.user.role === 'employee') {
        const ownsIt = itemData.assigneeId === req.user.id
          && (!existingTask || existingTask.assigneeId === req.user.id);
        if (!ownsIt) {
          return res.status(403).json({ error: 'Можно изменять только свои задачи' });
        }
      }

      taskNotifyContext = { existingTask, isNew: !existingTask };
    }

    // 🔔 Контекст для уведомлений о событиях (новый договор / платёж / закрытие / расход)
    let saleNotifyContext = null;
    let expenseIsNew = false;
    if (type === 'expenses') {
      const existsExpense = await pool.query(
        `SELECT 1 FROM data_items WHERE id = $1 AND type = 'expenses'`,
        [itemData.id]
      );
      expenseIsNew = existsExpense.rows.length === 0;
    }

    // 🔥 Проверка лимита договоров
    if (type === 'sales' && itemData.status !== 'DELETED') {
      const exists = await pool.query(
        `SELECT data FROM data_items WHERE id = $1 AND type = 'sales'`,
        [itemData.id]
      );
      const action = exists.rows.length > 0 ? 'update' : 'create';
      saleNotifyContext = { action, existingSale: exists.rows[0]?.data || null };

      const limitCheck = await checkContractLimit(targetUserId, action, itemData);
      if (!limitCheck.allowed) {
        return res.status(403).json({
          msg: limitCheck.msg,
          details: limitCheck.details,
          hint: limitCheck.hint
        });
      }

      // 🔥 Проверка на дубликат платежа
      if (itemData.type === 'CUSTOMER_PAYMENT' || itemData.paymentPlan) {
        const existingSaleResult = await pool.query(
          `SELECT data FROM data_items WHERE id = $1 AND user_id = $2 AND type = 'sales'`,
          [itemData.id, targetUserId]
        );

        if (existingSaleResult.rows.length > 0 && itemData.paymentPlan) {
          const existingSale = existingSaleResult.rows[0].data;

          const newPayments = (itemData.paymentPlan || []).filter(newP => {
            const wasAlreadyPaid = (existingSale.paymentPlan || []).some(
              oldP => oldP.id === newP.id && oldP.isPaid
            );
            return newP.isPaid && newP.isRealPayment && !wasAlreadyPaid;
          });

          for (const newPayment of newPayments) {
            const isDuplicate = await checkPaymentDuplicate(
              existingSale,
              newPayment.amount,
              newPayment.date,
              newPayment.id
            );

            if (isDuplicate) {
              return res.status(409).json({
                error: 'Дубликат платежа',
                msg: `Платёж на сумму ${newPayment.amount} ₽ от ${new Date(newPayment.date).toLocaleDateString('ru-RU')} уже был зачислен`,
                details: {
                  amount: newPayment.amount,
                  date: newPayment.date,
                  saleId: itemData.id
                }
              });
            }
          }
        }
      }
    }

    const id = itemData.id;

    // 🔹 ИСПРАВЛЕННЫЙ ON CONFLICT — НЕ перезаписываем type и user_id!
    await pool.query(`
      INSERT INTO data_items (id, user_id, type, data, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (id) DO UPDATE SET
        data = EXCLUDED.data,
        updated_at = NOW()
      WHERE data_items.user_id = $2  -- 🔒 Защита: обновляем только свои данные
    `, [id, targetUserId, type, JSON.stringify(itemData)]);

    // 🔹 Возвращаем сохранённые данные (с серверными полями)
    const savedResult = await pool.query(
      'SELECT data, updated_at FROM data_items WHERE id = $1',
      [id]
    );

    // 🔔 Уведомления о событиях (ошибки внутри createNotification не пробрасываются наружу)
    if (type === 'sales' && saleNotifyContext) {
      const { action, existingSale: oldSale } = saleNotifyContext;
      const amountStr = (n) => Number(n || 0).toLocaleString('ru-RU');

      // 🔹 У Sale нет поля customerName (только customerId) — раньше текст уведомления
      // всегда падал в дефолт "клиентом"/"клиента". Подтягиваем реальное имя.
      let customerName = null;
      if (itemData.customerId) {
        const customerRes = await pool.query(
          `SELECT data->>'name' as name FROM data_items WHERE id = $1 AND type = 'customers'`,
          [itemData.customerId]
        );
        customerName = customerRes.rows[0]?.name || null;
      }

      if (action === 'create') {
        await createNotification(
          targetUserId,
          'NEW_CONTRACT',
          'Новый договор',
          `Оформлен договор с ${customerName || 'клиентом'} на сумму ${amountStr(itemData.totalAmount)} ₽`,
          { saleId: itemData.id }
        );
      } else if (oldSale) {
        const newPaidPayments = (itemData.paymentPlan || []).filter(newP => {
          const wasAlreadyPaid = (oldSale.paymentPlan || []).some(oldP => oldP.id === newP.id && oldP.isPaid);
          return newP.isPaid && newP.isRealPayment !== false && !wasAlreadyPaid;
        });
        for (const p of newPaidPayments) {
          await createNotification(
            targetUserId,
            'PAYMENT',
            'Новый платёж',
            `Зачислен платёж ${amountStr(p.amount)} ₽ от ${customerName || 'клиента'}`,
            { saleId: itemData.id, amount: p.amount }
          );
        }
        if (oldSale.status !== 'COMPLETED' && itemData.status === 'COMPLETED') {
          await createNotification(
            targetUserId,
            'CONTRACT_CLOSED',
            'Договор закрыт',
            `Договор с ${customerName || 'клиентом'} полностью оплачен`,
            { saleId: itemData.id }
          );
        }
      }
    } else if (type === 'expenses' && expenseIsNew) {
      await createNotification(
        targetUserId,
        'EXPENSE',
        'Новый расход',
        `${itemData.title || 'Расход'}: ${Number(itemData.amount || 0).toLocaleString('ru-RU')} ₽`,
        { expenseId: itemData.id }
      );
    } else if (type === 'tasks' && taskNotifyContext) {
      const { existingTask } = taskNotifyContext;
      const assignee = itemData.assigneeId || null;
      const wasAssignee = existingTask?.assigneeId || null;

      // 1. Поручение назначено (или переназначено) — уведомляем исполнителя
      if (assignee && assignee !== wasAssignee && assignee !== req.user.id) {
        await createNotification(
          assignee,
          'TASK_ASSIGNED',
          'Новая задача',
          itemData.title,
          { taskId: itemData.id, dueDate: itemData.dueDate || null }
        );
      }

      // 2. Сотрудник выполнил поручение — уведомляем менеджера.
      // targetUserId здесь и есть менеджер (данные сотрудника лежат у него).
      const justCompleted = itemData.isDone && !existingTask?.isDone;
      if (justCompleted && req.user.id !== targetUserId) {
        const doerRes = await pool.query('SELECT name FROM users WHERE id = $1', [req.user.id]);
        const doerName = doerRes.rows[0]?.name || 'Сотрудник';
        await createNotification(
          targetUserId,
          'TASK_DONE',
          'Задача выполнена',
          `${doerName}: ${itemData.title}`,
          { taskId: itemData.id }
        );
      }
    }

    res.json(savedResult.rows[0]?.data || itemData);
  } catch (err) {
    console.error('❌ POST /api/data/:type error:', err);
    res.status(500).send('Server Error');
  }
});



// ✅ ИСПРАВЛЕННЫЙ DELETE /api/data/:type/:id
app.delete('/api/data/:type/:id', auth, async (req, res) => {
  try {
    const { id, type } = req.params;

    if (!VALID_DATA_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Недопустимый тип данных' });
    }

    let targetUserId = getTargetUserId(req.user);

    // ✅ Для инвесторов: удаляем только свои данные
    if (type === 'investors' && req.user.role === 'investor') {
      targetUserId = req.user.id;
    }

    if (!canAccessUserData(req.user, targetUserId)) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    // 🔒 Права сотрудника: удаление требует canDelete и доступа к счёту записи
    const existingRow = await pool.query('SELECT data FROM data_items WHERE id = $1', [id]);
    const delCheck = await checkEmployeeWriteAccess({
      user: req.user, type, itemId: id,
      accountId: existingRow.rows[0]?.data?.accountId, isDelete: true
    });
    if (!delCheck.ok) return res.status(delCheck.status).json(delCheck.body);

    // 🔒 Та же проверка, что и при записи (POST /api/data/:type): без активной подписки
    // менять данные нельзя. Удаление сюда изначально не попало — получалось, что
    // создать договор нельзя, а удалить можно. Это хуже обычной несогласованности:
    // восстановить удалённое человек не сможет до оплаты, потому что создание
    // ему как раз закрыто. Настройки исключены по той же причине, что и в POST.
    if (type !== 'settings') {
      const sub = await getSubscriptionState(targetUserId);
      if (sub.expired) {
        return res.status(403).json({
          code: 'SUBSCRIPTION_EXPIRED',
          msg: 'Срок действия подписки истёк.',
          hint: 'Продлите тариф, чтобы снова вести учёт: создавать, изменять и удалять записи.'
        });
      }
    }

    await pool.query('DELETE FROM data_items WHERE id = $1 AND user_id = $2', [id, targetUserId]);
    res.json({ success: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// 🔒 Полное удаление учётной записи и всех связанных данных.
//
// Требование ст. 14 152-ФЗ (право на прекращение обработки и уничтожение данных) и
// прямое обещание, данное в Согласии на обработку и в Публичной оферте: «отзыв согласия
// через интерфейс удаления аккаунта». Раньше такой возможности не существовало —
// документы ссылались на несуществующую функцию.
//
// Удаляет всё разом, в одной транзакции: данные учёта, загруженные файлы, уведомления,
// подписки на push, переписку с поддержкой, подчинённые учётные записи (сотрудники и
// инвесторы) и самого пользователя.
app.delete('/api/user/account', auth, async (req, res) => {
  // Удалять аккаунт может только его владелец: сотрудник или инвестор снесли бы
  // данные менеджера, к которым getTargetUserId дал бы им доступ.
  if (req.user.role !== 'manager' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Удалить учётную запись может только её владелец' });
  }

  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Требуется пароль' });

  const client = await pool.connect();
  try {
    const userRes = await client.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
    if (userRes.rowCount === 0) return res.status(404).json({ error: 'Пользователь не найден' });

    // Пароль подтверждает, что удаление инициировал владелец, а не тот, кто получил
    // доступ к незаблокированному устройству.
    const ok = await bcrypt.compare(password, userRes.rows[0].password);
    if (!ok) return res.status(401).json({ error: 'Неверный пароль' });

    const userId = req.user.id;

    // Файлы документов удаляем ДО транзакции: снести их внутри неё нельзя — откат
    // вернёт записи в БД, но не вернёт файлы с диска.
    let filesDeleted = 0;
    try {
      const docs = await client.query(
        `SELECT doc->>'fileUrl' AS url
           FROM data_items d, jsonb_array_elements(COALESCE(d.data->'documents','[]'::jsonb)) doc
          WHERE d.user_id = $1 AND doc->>'fileUrl' LIKE '/uploads/documents/%'`,
        [userId]
      );
      for (const row of docs.rows) {
        try {
          await fs.promises.unlink(path.join(uploadDir, path.basename(row.url)));
          filesDeleted++;
        } catch (e) { if (e.code !== 'ENOENT') console.error('unlink failed:', e.message); }
      }
    } catch (e) {
      console.error('❌ Не удалось собрать файлы для удаления:', e);
    }

    await client.query('BEGIN');

    // Подчинённые учётные записи — их данные хранятся под user_id менеджера,
    // но сами записи в users надо снести, иначе останутся «висячие» логины.
    const subs = await client.query('SELECT id FROM users WHERE manager_id = $1', [userId]);
    const allIds = [userId, ...subs.rows.map(r => r.id)];

    await client.query('DELETE FROM data_items WHERE user_id = ANY($1)', [allIds]);
    await client.query('DELETE FROM notifications WHERE user_id = ANY($1)', [allIds]);
    await client.query('DELETE FROM push_subscriptions WHERE user_id = ANY($1)', [allIds]);
    await client.query(
      'DELETE FROM support_messages WHERE ticket_id IN (SELECT id FROM support_tickets WHERE user_id = ANY($1))',
      [allIds]
    );
    await client.query('DELETE FROM support_tickets WHERE user_id = ANY($1)', [allIds]);
    await client.query('DELETE FROM verification_codes WHERE email IN (SELECT email FROM users WHERE id = ANY($1))', [allIds]);
    await client.query('DELETE FROM users WHERE id = ANY($1)', [allIds]);

    await client.query('COMMIT');

    console.log(`🗑 Аккаунт удалён: ${userId} (учётных записей: ${allIds.length}, файлов: ${filesDeleted})`);
    return res.json({ success: true, deletedAccounts: allIds.length, deletedFiles: filesDeleted });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Account deletion failed:', e);
    return res.status(500).json({ error: 'Не удалось удалить учётную запись' });
  } finally {
    client.release();
  }
});

// Wipe User Data (Reset)
app.delete('/api/user/data', auth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);

    if (!canAccessUserData(req.user, targetUserId)) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    await pool.query('DELETE FROM data_items WHERE user_id = $1', [targetUserId]);

    const accId = `acc_main_${targetUserId}`;
    const accData = { id: accId, userId: targetUserId, name: 'Основной счет', type: 'MAIN' };
    await pool.query(
      `INSERT INTO data_items (id, user_id, type, data) VALUES ($1, $2, $3, $4)`,
      [accId, targetUserId, 'accounts', JSON.stringify(accData)]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Reset Data Error:", err);
    res.status(500).send('Server Error');
  }
});








// 🔹 Эндпоинт загрузки документа
app.post('/api/upload/document', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не выбран' });
    }

    let fileBuffer = req.file.buffer;
    let fileExt = path.extname(req.file.originalname).toLowerCase();
    let mimeType = req.file.mimetype;
    let originalSize = req.file.size;

    // 🔹 СЖАТИЕ ИЗОБРАЖЕНИЙ
    if (mimeType.startsWith('image/')) {
      const compressed = await compressImage(fileBuffer, mimeType, 1920, 80);
      fileBuffer = compressed.buffer;
      fileExt = compressed.ext;
      mimeType = compressed.mimetype;
    }

    // 🔹 Генерация имени файла
    const safeName = req.file.originalname
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9а-яА-яЁё\-_]/g, '-')
      .substring(0, 50);
    const filename = `${Date.now()}-${crypto.randomUUID().slice(0,8)}-${safeName}${fileExt}`;

    // 🔹 Сохранение на диск
    const uploadPath = path.join(uploadDir, filename);
    await fs.promises.writeFile(uploadPath, fileBuffer);

    // 🔹 Ответ клиенту
    res.json({
      success: true,
      fileUrl: `/uploads/documents/${filename}`,
      fileName: req.file.originalname,
      fileSize: fileBuffer.length, // размер ПОСЛЕ сжатия
      originalSize,                // размер ДО сжатия (для статистики)
      fileType: mimeType.includes('pdf') ? 'pdf' : 'image',
      mimeType,
      compressed: mimeType.startsWith('image/') // флаг: было ли сжатие
    });

  } catch (error) {
    console.error('❌ Upload error:', error);
    res.status(500).json({ error: 'Ошибка сервера при загрузке файла' });
  }
});

// 🔒 Принадлежит ли файл этому пользователю. Владелец определяется по записи в БД,
// в документах которой есть ссылка на файл.
//
// Раньше на отдаче стояла проверка `filename.includes(req.user.id)`, но имена файлов
// генерируются как `<timestamp>-<uuid8>-<name>` и id пользователя не содержат никогда —
// то есть проверка не могла пройти ни у кого. Значение это имело лишь теоретическое:
// nginx перехватывал /uploads/ своим `location` и отдавал файлы с диска напрямую, вообще
// не доходя до Node, — паспорта клиентов лежали в открытом доступе по прямой ссылке.
const userOwnsDocument = async (user, filename) => {
  if (user.role === 'admin') return true;
  const targetUserId = getTargetUserId(user);
  if (!targetUserId) return false;

  // jsonb-путь надёжнее подстроки по всему объекту: имя файла не может случайно
  // совпасть с текстом заметки или названием товара.
  const owner = await pool.query(
    `SELECT 1 FROM data_items d,
            jsonb_array_elements(COALESCE(d.data->'documents', '[]'::jsonb)) doc
      WHERE d.user_id = $1
        AND doc->>'fileUrl' = $2
      LIMIT 1`,
    [targetUserId, `/uploads/documents/${filename}`]
  );
  return owner.rowCount > 0;
};

// 🔹 Отдача файлов (защищённая)
app.get('/uploads/documents/:filename', auth, async (req, res) => {
  const filename = path.basename(req.params.filename); // защита от path traversal
  const filePath = path.join(uploadDir, filename);
  if (!filePath.startsWith(uploadDir)) {
    return res.status(400).json({ error: 'Недопустимый путь' });
  }

  try {
    if (!(await userOwnsDocument(req.user, filename))) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }
  } catch (e) {
    console.error('❌ Document access check failed:', e);
    return res.status(500).json({ error: 'Ошибка проверки доступа' });
  }

  res.sendFile(filePath, (err) => {
    if (err) res.status(404).json({ error: 'Файл не найден' });
  });
});

// 🔹 Удаление файла документа
//
// Вызывается ПЕРЕД тем, как документ убирают из карточки клиента: пока ссылка на файл
// ещё есть в записи, по ней проверяются права. Без этого эндпоинта файл оставался на
// диске навсегда — на проде так накопилось 16 «сирот», в том числе присланные клиентами
// фотографии паспортов, недоступные уже никому, но лежащие на диске.
app.delete('/api/upload/document', auth, async (req, res) => {
  const { fileUrl } = req.body || {};
  if (!fileUrl || typeof fileUrl !== 'string') {
    return res.status(400).json({ error: 'Не указан файл' });
  }
  // Офлайновые и старые base64-документы файла на сервере не имеют — удалять нечего
  if (!fileUrl.startsWith('/uploads/documents/')) {
    return res.json({ success: true, skipped: true });
  }

  const filename = path.basename(fileUrl);
  const filePath = path.join(uploadDir, filename);
  if (!filePath.startsWith(uploadDir)) {
    return res.status(400).json({ error: 'Недопустимый путь' });
  }

  try {
    if (!(await userOwnsDocument(req.user, filename))) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }
    await fs.promises.unlink(filePath);
    return res.json({ success: true });
  } catch (e) {
    // Файла уже нет — цель достигнута, ошибкой это не считаем
    if (e.code === 'ENOENT') return res.json({ success: true, alreadyGone: true });
    console.error('❌ Document delete failed:', e);
    return res.status(500).json({ error: 'Не удалось удалить файл' });
  }
});



// User Management (Create / Update / Delete for Sub-users)
app.post('/api/users/manage', auth, async (req, res) => {
  const { action, userData } = req.body;

  if (req.user.role !== 'manager' && req.user.role !== 'admin') {
    return res.status(403).json({ msg: 'Permission denied' });
  }

  try {
    // ========================================
    // 🔹 ACTION: CREATE
    // ========================================
    if (action === 'create') {
      const { name, email, password, role, permissions, allowedInvestorIds, fullAccessInvestorIds, phone, profitPercentage, profitBase, profitReducesManager, profitSource, profitSince } = userData;


       if (role === 'employee' || role === 'investor') {
    try {
      // Получаем подписку менеджера
      const managerSubRes = await pool.query(
        'SELECT subscription FROM users WHERE id = $1',
        [req.user.id]
      );

      if (managerSubRes.rows.length > 0) {
        const managerSubRaw = managerSubRes.rows[0].subscription;
        const managerSub = typeof managerSubRaw === 'string'
          ? JSON.parse(managerSubRaw)
          : managerSubRaw;

        // После окончания подписки действуют лимиты START, а не оплаченного ранее тарифа
        const plan = getEffectivePlan(managerSub) || 'TRIAL';
        const limits = PLAN_LIMITS[plan];

        if (limits) {
          // 🔹 Определяем тип лимита по роли
          const limitType = role === 'employee' ? 'employees' : 'investors';
          const limitValue = limits[limitType];

          // 🔹 -1 = безлимит, пропускаем проверку
          if (limitValue !== -1) {
            // Считаем текущее количество
            const countRes = await pool.query(
              `SELECT COUNT(*) as count FROM users 
               WHERE manager_id = $1 AND role = $2`,
              [req.user.id, role]
            );
            const currentCount = parseInt(countRes.rows[0].count, 10);

            if (currentCount >= limitValue) {
              // 🔹 Логируем попытку превышения
              console.log(`🚫 LIMIT_HIT: manager=${req.user.id}, type=${limitType}, plan=${plan}, current=${currentCount}, limit=${limitValue}`);

              const roleNames = {
                'employee': 'сотрудников',
                'investor': 'инвесторов'
              };

              return res.status(403).json({
                msg: `Превышен лимит ${roleNames[role]} для тарифа "${plan}". Максимум: ${limitValue}. У вас сейчас: ${currentCount}.`,
                details: { 
                  current: currentCount, 
                  limit: limitValue,
                  type: limitType,
                  plan: plan
                },
                hint: role === 'employee' 
                  ? 'Оформите подписку Бизнес для неограниченного количества сотрудников.'
                  : 'Оформите подписку выше для увеличения лимита инвесторов.'
              });
            }
          }
        }
      }
    } catch (err) {
      // 🔹 При ошибке проверки — НЕ блокируем пользователя (fail-safe)
      console.error('❌ Limit check error:', err.message);
      // Продолжаем создание, но логируем
    }
  }

      // 🔹 Проверка email (регистронезависимая)
      const userCheck = await pool.query(
        'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
        [email]
      );
      if (userCheck.rows.length > 0) {
        return res.status(400).json({
          msg: 'Пользователь с таким Email уже существует',
          existingUserId: userCheck.rows[0].id
        });
      }

      // 🔹 Создаём ID
      const id = role === 'investor' ? `u_inv_${Date.now()}` : `u_emp_${Date.now()}`;

      // 🔹 Хэшируем пароль
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // 🔹 Создаём пользователя
      await pool.query(
        `INSERT INTO users (id, name, email, password, role, manager_id, permissions, allowed_investor_ids, full_access_investor_ids, phone, profit_percentage, profit_base, profit_reduces_manager, profit_source, profit_since)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          id,
          name,
          email,
          hashedPassword,
          role,
          req.user.id,
          JSON.stringify(permissions || {}),
          JSON.stringify(allowedInvestorIds || []),
          JSON.stringify(fullAccessInvestorIds || []),
          phone || null,
          Number.isFinite(Number(profitPercentage)) ? Number(profitPercentage) : null,
          profitBase || null,
          profitReducesManager !== false,
          profitSource || null,
          // Если процент задан, а дата начала не пришла — считаем с сегодняшнего дня.
          // Без этого сотруднику разом начислялась бы премия за всю прошлую историю.
          (Number(profitPercentage) > 0 ? (profitSince || new Date().toISOString().slice(0, 10)) : null)
        ]
      );

      // 🔹 🔥 НОВОЕ: Если это инвестор — создаём профиль в data_items
      if (role === 'investor') {
        const investorData = {
          id: id,  // 🔑 Тот же ID, что у пользователя
          userId: req.user.id,  // ID менеджера-создателя
          name,
          email,
          phone: phone || '',
          initialAmount: 0,
          profitPercentage: 0,
          joinedDate: new Date().toISOString(),
          permissions: permissions || {},
          allowedInvestorIds: allowedInvestorIds || []
        };

        await pool.query(`
          INSERT INTO data_items (id, user_id, type, data, updated_at)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (id) DO UPDATE 
          SET data = EXCLUDED.data, updated_at = NOW()
        `, [id, req.user.id, 'investors', JSON.stringify(investorData)]);
      }

      return res.json({
        id, name, email, role, managerId: req.user.id, permissions, allowedInvestorIds, fullAccessInvestorIds, phone
      });
    }

    if (action === 'delete') {
  const investorId = userData.id;
  const managerId = req.user.id;

  // 1. Удаляем из users (всегда под manager_id)
  await pool.query('DELETE FROM users WHERE id = $1 AND manager_id = $2', [investorId, managerId]);

  // 2. ✅ Удаляем профиль инвестора (ищем в обоих местах)
  await pool.query(`
    DELETE FROM data_items 
    WHERE type = 'investors' 
    AND data->>'id' = $1 
    AND (user_id = $2 OR user_id = $1)  -- ← Проверяем и manager_id, и investor_id
  `, [investorId, managerId]);

  // 3. ✅ Удаляем счёт инвестора (ищем в обоих местах)
  await pool.query(`
    DELETE FROM data_items 
    WHERE type = 'accounts' 
    AND data->>'ownerId' = $1 
    AND (user_id = $2 OR user_id = $1)
  `, [investorId, managerId]);

  // 4. ✅ Удаляем операции инвестора (универсальный поиск)
  await pool.query(`
    DELETE FROM data_items 
    WHERE (user_id = $1 OR user_id = $2)  -- ← Проверяем оба user_id
    AND type IN ('sales', 'expenses')
    AND (
      data->>'accountId' = ANY(
        SELECT data->>'id' FROM data_items 
        WHERE type = 'accounts' AND data->>'ownerId' = $3
      )
      OR data->>'customerId' = $3
    )
  `, [managerId, investorId, investorId]);

  return res.json({ success: true, id: investorId });
}

   if (action === 'update') {
  const { id, name, email, permissions, allowedInvestorIds, fullAccessInvestorIds, password, phone, profitPercentage, profitBase, profitReducesManager, profitSource, profitSince } = userData;
  const isSelfUpdate = (id === req.user.id);

  try {
    // Безопасная сериализация JSON
    const permJson = permissions !== undefined ? JSON.stringify(permissions) : null;
    const allowedJson = allowedInvestorIds !== undefined ? JSON.stringify(allowedInvestorIds) : null;
    const fullAccessJson = fullAccessInvestorIds !== undefined ? JSON.stringify(fullAccessInvestorIds) : null;

    // 🔹 Преобразуем пустые строки в NULL, чтобы COALESCE корректно очищал поля
    const safeName = name?.trim() || null;
    const safeEmail = email?.trim() || null;
    const safePhone = phone?.trim() || null;

    // 🔹 COALESCE сохраняет старое значение, если пришло null
    let query = `UPDATE users SET
      name = COALESCE($1, name),
      email = COALESCE($2, email),
      permissions = COALESCE($3, permissions),
      allowed_investor_ids = COALESCE($4, allowed_investor_ids),
      full_access_investor_ids = COALESCE($5, full_access_investor_ids),
      phone = COALESCE($6, phone),
      profit_percentage = COALESCE($8, profit_percentage),
      profit_base = COALESCE($9, profit_base),
      profit_reduces_manager = COALESCE($10, profit_reduces_manager),
      profit_source = COALESCE($11, profit_source),
      profit_since = COALESCE($12, profit_since),
      updated_at = NOW()
      WHERE id = $7`;

    let params = [
      safeName,
      safeEmail,
      permJson,
      allowedJson,
      fullAccessJson,
      safePhone,  // ✅ Пустая строка → NULL → телефон очистится
      id,
      profitPercentage === undefined || profitPercentage === null || profitPercentage === ''
        ? null : Number(profitPercentage),
      profitBase || null,
      typeof profitReducesManager === 'boolean' ? profitReducesManager : null,
      profitSource || null,
      // Дата начала: пришла явно — берём её; иначе, если процент включают впервые,
      // проставляем сегодняшний день (COALESCE не тронет уже заполненное значение).
      profitSince || (Number(profitPercentage) > 0 ? new Date().toISOString().slice(0, 10) : null)
    ];

    // Проверка manager_id только для чужих профилей
    if (!isSelfUpdate) {
      query += ` AND manager_id = $13`;
      params.push(req.user.id);
    }

    await pool.query(query, params);

    // 🔹 Смена пароля (отдельно, без COALESCE)
    if (password && password.trim().length > 0) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      // Менять пароль можно только своему пользователю или самому себе
      await pool.query(
        'UPDATE users SET password = $1 WHERE id = $2 AND (manager_id = $3 OR id = $3)',
        [hashedPassword, id, req.user.id]
      );
    }

    // 🔥 ПОЛУЧАЕМ ОБНОВЛЁННОГО ПОЛЬЗОВАТЕЛЯ С СЕРВЕРА
    const updatedUserResult = await pool.query(
      `SELECT
        id, name, email, phone, role, manager_id,
        permissions, allowed_investor_ids, full_access_investor_ids, subscription,
        created_at, updated_at
       FROM users WHERE id = $1`,
      [id]
    );

    if (updatedUserResult.rows.length === 0) {
      return res.status(404).json({ msg: 'User not found after update' });
    }

    const updatedUser = updatedUserResult.rows[0];

    // 🔥 ВОЗВРАЩАЕМ ПОЛНОГО ПОЛЬЗОВАТЕЛЯ (фронтенд обновит стейт)
    return res.json({
      success: true,
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        role: updatedUser.role,
        managerId: updatedUser.manager_id,
        permissions: updatedUser.permissions,
        allowedInvestorIds: updatedUser.allowed_investor_ids,
        fullAccessInvestorIds: updatedUser.full_access_investor_ids,
        profitPercentage: updatedUser.profit_percentage !== null && updatedUser.profit_percentage !== undefined ? Number(updatedUser.profit_percentage) : undefined,
        profitBase: updatedUser.profit_base || undefined,
        profitReducesManager: updatedUser.profit_reduces_manager !== false,
        profitSource: updatedUser.profit_source || undefined,
        profitSince: toDateString(updatedUser.profit_since),
        subscription: updatedUser.subscription,
        createdAt: updatedUser.created_at,
        updatedAt: updatedUser.updated_at
      }
    });

  } catch (err) {
    console.error('❌ Database error:', err.message);
    return res.status(500).json({ msg: 'Update failed', error: err.message });
  }
}

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).send('Server Error');
  }
});

// --- ADMIN ROUTES ---
app.get('/api/admin/users', adminAuth, async (req, res) => {
  try {
    const query = `
      SELECT
        u.id, u.name, u.email, u.role, u.phone, u.subscription, u.created_at, u.api_key, u.blocked,
        (SELECT COUNT(*) FROM data_items WHERE user_id = u.id AND type = 'sales') as sales_count
      FROM users u
      ORDER BY u.created_at DESC
    `;
    const result = await pool.query(query);

    const users = result.rows.map(r => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      phone: r.phone,
      subscription: r.subscription,
      salesCount: parseInt(r.sales_count || '0'),
      createdAt: r.created_at,
      apiKey: r.api_key,
      blocked: !!r.blocked
    }));

    res.json(users);
  } catch (e) {
    console.error("Admin fetch users error", e);
    res.status(500).send("Server Error");
  }
});

app.post('/api/admin/set-subscription', adminAuth, async (req, res) => {
  // 🔹 unit: 'days' | 'months' (по умолчанию 'months' для обратной совместимости).
  //    unlimited: true — выставляет срок на 50 лет вперёд вместо расчёта по unit/amount.
  const { userId, plan, months, unit, amount, unlimited } = req.body;

  if (!userId || !plan) {
    return res.status(400).json({ msg: 'userId и plan обязательны' });
  }

  try {
    // let, а не const: ветка с месяцами присваивает новое значение через addMonthsClamped
    let expiresAt = new Date();
    const resolvedUnit = unit || 'months';
    const resolvedAmount = Number(amount ?? months);

    if (unlimited) {
      expiresAt.setFullYear(expiresAt.getFullYear() + 50);
    } else if (!Number.isFinite(resolvedAmount) || resolvedAmount <= 0) {
      return res.status(400).json({ msg: 'Некорректный срок действия' });
    } else if (resolvedUnit === 'days') {
      expiresAt.setDate(expiresAt.getDate() + resolvedAmount);
    } else {
      expiresAt = addMonthsClamped(expiresAt, resolvedAmount);
    }

    const subscription = {
      plan,
      expiresAt: expiresAt.toISOString()
    };

    await pool.query('UPDATE users SET subscription = $1, updated_at = NOW() WHERE id = $2', [JSON.stringify(subscription), userId]);
    logAdminAction(req.user.id, 'SET_SUBSCRIPTION', userId, { plan, unit: unlimited ? 'unlimited' : resolvedUnit, amount: unlimited ? null : resolvedAmount, expiresAt: subscription.expiresAt });
    res.json({ success: true, subscription });
  } catch (e) {
    console.error("Admin set sub error", e);
    res.status(500).send("Server Error");
  }
});

app.post('/api/admin/generate-user-api-key', adminAuth, async (req, res) => {
  const { userId } = req.body;
  try {
    const newKey = `sk_${uuidv4().replace(/-/g, '')}`;
    await pool.query('UPDATE users SET api_key = $1 WHERE id = $2', [newKey, userId]);
    logAdminAction(req.user.id, 'GENERATE_API_KEY', userId, null);
    res.json({ apiKey: newKey });
  } catch (err) {
    console.error("Admin Generate API Key Error:", err);
    res.status(500).send('Server Error');
  }
});



// === АДМИН: СТАТИСТИКА ===
app.get('/api/admin/stats', adminAuth, async (req, res) => {
  try {
    // Всего пользователей
    const usersCount = await pool.query(
      `SELECT COUNT(*) as count FROM users WHERE role != 'admin'`
    );

    // Активные подписки
    const activeSubs = await pool.query(
      `SELECT COUNT(*) as count FROM users
       WHERE subscription IS NOT NULL
       AND (subscription->>'expiresAt')::timestamp > NOW()`
    );

    // Всего договоров
    const contractsCount = await pool.query(
      `SELECT COUNT(*) as count FROM data_items WHERE type = 'sales'`
    );

    // 🔹 Разбивка по тарифам (среди пользователей с активной подпиской)
    const planBreakdownResult = await pool.query(
      `SELECT subscription->>'plan' as plan, COUNT(*) as count FROM users
       WHERE role != 'admin' AND subscription IS NOT NULL
       AND (subscription->>'expiresAt')::timestamp > NOW()
       GROUP BY subscription->>'plan'`
    );

    // 🔹 Подписки, истекающие в ближайшие 3 дня
    const expiringSoon = await pool.query(
      `SELECT COUNT(*) as count FROM users
       WHERE role != 'admin' AND subscription IS NOT NULL
       AND (subscription->>'expiresAt')::timestamp BETWEEN NOW() AND NOW() + INTERVAL '3 days'`
    );

    // 🔹 Новые пользователи за последние 7 дней
    const newUsers = await pool.query(
      `SELECT COUNT(*) as count FROM users WHERE role != 'admin' AND created_at > NOW() - INTERVAL '7 days'`
    );

    res.json({
      totalUsers: parseInt(usersCount.rows[0].count),
      activeSubscriptions: parseInt(activeSubs.rows[0].count),
      totalContracts: parseInt(contractsCount.rows[0].count),
      planBreakdown: planBreakdownResult.rows.reduce((acc, r) => {
        if (r.plan) acc[r.plan] = parseInt(r.count);
        return acc;
      }, {}),
      expiringSoon: parseInt(expiringSoon.rows[0].count),
      newUsersLast7Days: parseInt(newUsers.rows[0].count)
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// === АДМИН: ЖУРНАЛ ДЕЙСТВИЙ ===
app.get('/api/admin/audit-log', adminAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 300);
    const result = await pool.query(
      `SELECT
         l.id, l.action, l.details, l.created_at,
         admin_u.name as admin_name, admin_u.email as admin_email,
         target_u.name as target_name, target_u.email as target_email
       FROM admin_audit_log l
       LEFT JOIN users admin_u ON admin_u.id = l.admin_id
       LEFT JOIN users target_u ON target_u.id = l.target_user_id
       ORDER BY l.created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json(result.rows.map(r => ({
      id: r.id,
      action: r.action,
      details: r.details,
      createdAt: r.created_at,
      adminName: r.admin_name || 'Неизвестно',
      adminEmail: r.admin_email,
      targetName: r.target_name,
      targetEmail: r.target_email
    })));
  } catch (err) {
    console.error('Admin audit log error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// === АДМИН: БЛОКИРОВКА ПОЛЬЗОВАТЕЛЯ ===
app.patch('/api/admin/users/:userId/status', adminAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { blocked } = req.body;

    // Добавляем колонку blocked если нет
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='users' AND column_name='blocked'
        ) THEN
          ALTER TABLE users ADD COLUMN blocked BOOLEAN DEFAULT FALSE;
        END IF;
      END $$;
    `);

    await pool.query(
      `UPDATE users SET blocked = $1, updated_at = NOW() WHERE id = $2`,
      [blocked, userId]
    );

    logAdminAction(req.user.id, blocked ? 'BLOCK_USER' : 'UNBLOCK_USER', userId, null);
    res.json({ success: true });
  } catch (err) {
    console.error('Update user status error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// === АДМИН: СБРОС ПАРОЛЯ ===
// =====================================================
// === 🤝 БИЗНЕС-ПАРТНЁРЫ: АДМИНКА =====================
// =====================================================

// Включение/выключение партнёрства и его условия.
app.patch('/api/admin/users/:userId/partner', adminAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { enabled, percent, termMonths } = req.body;

    if (!enabled) {
      // Процент обнуляем, но partner_since и уже сделанные начисления оставляем:
      // выключение партнёрства не должно стирать долг перед человеком.
      await pool.query(
        `UPDATE users SET partner_percent = NULL, updated_at = NOW() WHERE id = $1`,
        [userId]
      );
      logAdminAction(req.user.id, 'PARTNER_DISABLE', userId, null);
      return res.json({ success: true });
    }

    const pct = Number(percent);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      return res.status(400).json({ msg: 'Процент должен быть числом от 0 до 100' });
    }
    const term = termMonths === null || termMonths === undefined || termMonths === ''
      ? null
      : Number(termMonths);
    if (term !== null && (!Number.isInteger(term) || term <= 0)) {
      return res.status(400).json({ msg: 'Срок — целое число месяцев или пусто (бессрочно)' });
    }

    // partner_since ставим только при ПЕРВОМ включении: повторное сохранение с
    // новым процентом не должно сдвигать дату и обнулять историю начислений.
    await pool.query(
      `UPDATE users
          SET partner_percent = $1,
              partner_term_months = $2,
              partner_since = COALESCE(partner_since, NOW()),
              updated_at = NOW()
        WHERE id = $3`,
      [pct, term, userId]
    );
    logAdminAction(req.user.id, 'PARTNER_ENABLE', userId, { percent: pct, termMonths: term });
    res.json({ success: true });
  } catch (err) {
    console.error('Partner update error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Список партнёров с итогами. Заработано / выплачено / к выплате считаем из
// начислений, а не из выплат: выплата может быть округлена или разбита на части.
app.get('/api/admin/partners', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.name, u.email, u.phone, u.referral_code,
             u.partner_percent, u.partner_since, u.partner_term_months,
             COALESCE(c.total, 0)   AS earned,
             COALESCE(c.paid, 0)    AS paid,
             COALESCE(c.pending, 0) AS pending,
             COALESCE(c.clients, 0) AS clients
        FROM users u
        LEFT JOIN (
          SELECT partner_id,
                 SUM(amount) FILTER (WHERE status <> 'cancelled') AS total,
                 SUM(amount) FILTER (WHERE status = 'paid')       AS paid,
                 SUM(amount) FILTER (WHERE status = 'accrued')    AS pending,
                 COUNT(DISTINCT client_id)                        AS clients
            FROM partner_commissions
           GROUP BY partner_id
        ) c ON c.partner_id = u.id
       WHERE u.partner_percent IS NOT NULL OR u.partner_since IS NOT NULL
       ORDER BY COALESCE(c.pending, 0) DESC, u.name
    `);
    res.json(rows);
  } catch (err) {
    console.error('Partners list error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Отметить выплату. Деньги переводятся вне системы (перевод по СБП, чек от
// самозанятого), здесь фиксируется факт: сумма, способ, номер чека.
app.post('/api/admin/partners/:partnerId/payout', adminAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { partnerId } = req.params;
    const { amount, method, receipt, note } = req.body;
    const sum = Number(amount);
    if (!Number.isFinite(sum) || sum <= 0) {
      return res.status(400).json({ msg: 'Сумма выплаты должна быть положительной' });
    }

    await client.query('BEGIN');

    const pendingRes = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS pending
         FROM partner_commissions WHERE partner_id = $1 AND status = 'accrued'`,
      [partnerId]
    );
    const pending = Number(pendingRes.rows[0].pending);
    if (sum > pending + 0.01) {
      await client.query('ROLLBACK');
      return res.status(400).json({ msg: 'К выплате доступно ' + pending.toFixed(2) + ' руб.' });
    }

    const payoutId = 'po_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    await client.query(
      `INSERT INTO partner_payouts (id, partner_id, amount, method, receipt, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [payoutId, partnerId, sum, method || null, receipt || null, note || null, req.user.id]
    );

    // Гасим начисления по очереди, от самых старых. Так «к выплате» всегда
    // совпадает с суммой непогашенных строк, и видно, за какие именно платежи
    // деньги уже отданы.
    const open = await client.query(
      `SELECT id, amount FROM partner_commissions
        WHERE partner_id = $1 AND status = 'accrued'
        ORDER BY created_at`,
      [partnerId]
    );
    let left = sum;
    for (const row of open.rows) {
      if (left < 0.01) break;
      const amt = Number(row.amount);
      if (amt > left + 0.01) break;   // частично начисление не гасим
      await client.query(
        `UPDATE partner_commissions SET status = 'paid', payout_id = $1 WHERE id = $2`,
        [payoutId, row.id]
      );
      left -= amt;
    }

    await client.query('COMMIT');
    logAdminAction(req.user.id, 'PARTNER_PAYOUT', partnerId, { amount: sum, method, receipt });
    res.json({ success: true, payoutId, unallocated: Math.round(left * 100) / 100 });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Partner payout error:', err);
    res.status(500).json({ msg: 'Server error' });
  } finally {
    client.release();
  }
});

// =====================================================
// === 🤝 БИЗНЕС-ПАРТНЁР: СВОЯ СТАТИСТИКА ==============
// =====================================================

app.get('/api/partner/summary', auth, async (req, res) => {
  try {
    const me = await pool.query(
      `SELECT partner_percent, partner_since, partner_term_months FROM users WHERE id = $1`,
      [req.user.id]
    );
    const row = me.rows[0];
    if (!row || !row.partner_percent) return res.json({ isPartner: false });

    // Имя клиента показываем, почту и телефон — нет: партнёр и так знает, кого
    // привёл, а система не должна раздавать контакты.
    const commissions = await pool.query(
      `SELECT c.id, c.amount, c.base_amount, c.percent, c.status, c.created_at,
              p.plan, p.months, u.name AS client_name
         FROM partner_commissions c
         JOIN subscription_payments p ON p.id = c.payment_id
         LEFT JOIN users u ON u.id = c.client_id
        WHERE c.partner_id = $1
        ORDER BY c.created_at DESC
        LIMIT 200`,
      [req.user.id]
    );
    const payouts = await pool.query(
      `SELECT id, amount, method, receipt, note, created_at
         FROM partner_payouts WHERE partner_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    const totals = await pool.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE status <> 'cancelled'), 0) AS earned,
              COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)       AS paid,
              COALESCE(SUM(amount) FILTER (WHERE status = 'accrued'), 0)    AS pending,
              COUNT(DISTINCT client_id)                                     AS clients
         FROM partner_commissions WHERE partner_id = $1`,
      [req.user.id]
    );

    res.json({
      isPartner: true,
      percent: Number(row.partner_percent),
      since: row.partner_since,
      termMonths: row.partner_term_months,
      totals: {
        earned: Number(totals.rows[0].earned),
        paid: Number(totals.rows[0].paid),
        pending: Number(totals.rows[0].pending),
        clients: Number(totals.rows[0].clients)
      },
      commissions: commissions.rows,
      payouts: payouts.rows
    });
  } catch (err) {
    console.error('Partner summary error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

app.post('/api/admin/users/:userId/reset-password', adminAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ msg: 'Пароль должен быть минимум 6 символов' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await pool.query(
      `UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2`,
      [hashedPassword, userId]
    );

    logAdminAction(req.user.id, 'RESET_PASSWORD', userId, null);
    res.json({ success: true });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});




// --- PAYMENTS (YooKassa) ---
// === ТАРИФНАЯ СЕТКА — ЕДИНСТВЕННЫЙ ИСТОЧНИК ПРАВДЫ ПО ЦЕНАМ ===
// Раньше сумма платежа приходила с клиента (req.body.amount) и нигде не проверялась,
// а webhook активировал тариф только по plan/months из метаданных, не сверяясь с тем,
// сколько человек реально заплатил. То есть запрос с amount = 1 и plan = BUSINESS_PRO
// давал год максимального тарифа за рубль. Теперь цену считает только сервер,
// клиент присылает исключительно plan и months, а webhook сверяет фактическую оплату.
const PLAN_PRICES = {
  START: 990,
  STANDARD: 1490,
  BUSINESS: 1990,
  BUSINESS_PRO: 2990,
};

// Скидки за длительный период. Дублируются в components/Tariffs.tsx только для
// отображения — деньги считаются здесь, поэтому расхождение не приведёт к неверному списанию.
const DURATION_DISCOUNTS = { 1: 0, 3: 0.03, 6: 0.05, 12: 0.10 };

const ALLOWED_MONTHS = Object.keys(DURATION_DISCOUNTS).map(Number);

/**
 * Стоимость подписки. Округление вверх помесячно — ровно так же, как показывает
 * интерфейс (Math.ceil на цене месяца), иначе итог в окне оплаты и реальный счёт
 * разошлись бы на несколько рублей.
 * @returns {number|null} сумма в рублях либо null, если план/срок недопустимы
 */
const calculateSubscriptionAmount = (plan, months) => {
  const base = PLAN_PRICES[plan];
  const discount = DURATION_DISCOUNTS[months];
  if (!base || discount === undefined) return null;
  return Math.ceil(base * (1 - discount)) * months;
};

// Клиент берёт цены отсюда, чтобы витрина и счёт считались по одним и тем же числам.
// Лимиты отдаём тем же запросом: на их основе интерфейс показывает, что именно
// человек теряет при понижении тарифа. Считать это по отдельной копии таблицы
// на клиенте нельзя — предупреждение обязано совпадать с тем, что реально
// применит сервер (PLAN_LIMITS выше).
app.get('/api/payment/pricing', (req, res) => {
  res.json({ prices: PLAN_PRICES, discounts: DURATION_DISCOUNTS, limits: PLAN_LIMITS });
});

app.post('/api/payment/create', auth, async (req, res) => {
  const { description, returnUrl, plan, months } = req.body;
  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secretKey = process.env.YOOKASSA_SECRET_KEY;

  // 🔒 Сумма НИКОГДА не берётся из запроса — только считается здесь.
  const monthsNum = Number(months);
  if (!ALLOWED_MONTHS.includes(monthsNum)) {
    return res.status(400).json({ msg: 'Недопустимый период подписки' });
  }
  const amount = calculateSubscriptionAmount(plan, monthsNum);
  if (amount === null) {
    return res.status(400).json({ msg: 'Недопустимый тариф' });
  }

  if (!shopId || !secretKey) {

    return res.json({
      id: `mock_pay_${Date.now()}`,
      status: 'pending',
      confirmationUrl: returnUrl || 'https://yoomoney.ru'
    });
  }

  try {

    const idempotenceKey = uuidv4();
    const response = await axios.post('https://api.yookassa.ru/v3/payments', {
      amount: {
        value: amount.toFixed(2),
        currency: 'RUB'
      },
      capture: true,
      confirmation: {
        type: 'redirect',
        return_url: returnUrl
      },
      // Описание тоже собираем сами: оно попадает в чек, и подставлять туда
      // произвольный текст из запроса не стоит.
      description: `Оплата тарифа ${plan} на ${monthsNum} мес.`,
      metadata: {
        userId: req.user.id,
        plan: plan,
        months: monthsNum
      }
    }, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${shopId}:${secretKey}`).toString('base64'),
        'Idempotence-Key': idempotenceKey,
        'Content-Type': 'application/json'
      }
    });
    
    res.json({
      id: response.data.id,
      status: response.data.status,
      confirmationUrl: response.data.confirmation.confirmation_url
    });
  } catch (error) {
    console.error('YooKassa Error:', error.response?.data || error.message);
    res.status(500).json({ msg: 'Payment creation failed' });
  }
});

// --- WEBHOOK HANDLER ---
// --- WEBHOOK HANDLER ---
// 🔥 ВАЖНО: express.raw читает исходные байты запроса до любого парсинга.
// 🎁 РЕФЕРАЛЬНАЯ ПРОГРАММА
//
// Пригласивший получает +10 дней подписки, когда приглашённый ВПЕРВЫЕ оплачивает.
// Дни, а не деньги: оператор — самозанятый, налог по НПД считается с валовой выручки
// без вычета расходов, поэтому денежная выплата уменьшала бы маржу, но не уменьшала
// налог и не освобождала лимит 2,4 млн ₽. Бесплатные дни не стоят почти ничего.
const REFERRAL_REWARD_DAYS = 10;

// =====================================================
// === 🤝 БИЗНЕС-ПАРТНЁРЫ: ЖУРНАЛ ОПЛАТ И НАЧИСЛЕНИЯ ===
// =====================================================

// Записывает оплату в журнал. Ключ — id платежа ЮKassa, поэтому повторный
// вебхук (а он в порядке вещей) не создаст второй строки.
const recordSubscriptionPayment = async ({ paymentId, userId, amount, plan, months }) => {
  await pool.query(
    `INSERT INTO subscription_payments (id, user_id, amount, plan, months)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO NOTHING`,
    [paymentId, userId, amount, plan, months]
  );
};

// Начисляет партнёру процент с оплаты приведённого им клиента.
//
// Процент и срок КОПИРУЮТСЯ в строку начисления. Считать их на лету из настроек
// партнёра нельзя: подняли процент — и он задним числом «заработал» больше за
// весь прошлый год, включая уже выплаченное. Деньги требуют неизменной истории.
const accruePartnerCommission = async ({ paymentId, clientId, amount }) => {
  const clientRes = await pool.query(
    `SELECT referred_by, created_at FROM users WHERE id = $1`,
    [clientId]
  );
  const client = clientRes.rows[0];
  if (!client?.referred_by) return;              // клиент пришёл сам

  const partnerRes = await pool.query(
    `SELECT id, partner_percent, partner_since, partner_term_months
       FROM users WHERE id = $1`,
    [client.referred_by]
  );
  const partner = partnerRes.rows[0];
  if (!partner) return;

  const percent = Number(partner.partner_percent);
  if (!percent || percent <= 0) return;          // не партнёр
  if (!partner.partner_since) return;            // партнёрство не активировано

  // Платежи до включения партнёрства не оплачиваем — иначе включение сегодня
  // означало бы долг за всю прошлую историю.
  if (new Date() < new Date(partner.partner_since)) return;

  // Срок считаем от РЕГИСТРАЦИИ клиента: от даты платежа он обнулялся бы с
  // каждым продлением и не заканчивался никогда.
  if (partner.partner_term_months && client.created_at) {
    const until = addMonthsClamped(new Date(client.created_at), Number(partner.partner_term_months));
    if (new Date() > until) return;              // срок вышел
  }

  const base = Number(amount);
  if (!Number.isFinite(base) || base <= 0) return;
  const commission = Math.round(base * percent) / 100;

  await pool.query(
    `INSERT INTO partner_commissions
       (id, partner_id, client_id, payment_id, base_amount, percent, amount)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (payment_id) DO NOTHING`,
    [`pc_${paymentId}`, partner.id, clientId, paymentId, base, percent, commission]
  );

  console.log(`🤝 Партнёру ${partner.id} начислено ${commission} ₽ (${percent}% с ${base} ₽) за клиента ${clientId}`);
};

const grantReferralReward = async (paidUserId) => {
  const paid = await pool.query(
    `SELECT id, email, phone, referred_by, referral_rewarded_at FROM users WHERE id = $1`,
    [paidUserId]
  );
  if (paid.rowCount === 0) return;
  const { referred_by: referrerId, referral_rewarded_at, email, phone } = paid.rows[0];

  if (!referrerId) return;                  // пришёл сам, не по ссылке
  if (referral_rewarded_at) return;         // за этого человека уже награждали

  const refRes = await pool.query(
    `SELECT id, email, phone, subscription FROM users WHERE id = $1 AND role = 'manager'`,
    [referrerId]
  );
  if (refRes.rowCount === 0) return;
  const referrer = refRes.rows[0];

  // Защита от самоприглашения через второй аккаунт.
  //
  // Почта: в базе есть уникальный индекс по lower(email), поэтому два аккаунта на один
  // адрес завести нельзя — проверка здесь на случай, если индекс когда-нибудь снимут.
  //
  // Телефон: уникального индекса нет, и это основной вектор накрутки. Сравнивать голые
  // цифры недостаточно — «+7 900 222-33-44» и «89002223344» это ОДИН номер, но строки
  // '79002223344' и '89002223344' не совпадают, и накрутка проходила. Приводим номера
  // общей функцией normalizePhone: она и убирает разделители, и заменяет ведущую 8 на 7.
  const sameEmail = email && referrer.email && email.toLowerCase() === referrer.email.toLowerCase();
  const normA = normalizePhone(String(phone || '')).phone;
  const normB = normalizePhone(String(referrer.phone || '')).phone;
  const samePhone = !!normA && normA === normB;
  if (sameEmail || samePhone) {
    console.warn(`⛔ Реферальная награда отклонена: ${referrerId} и ${paidUserId} имеют общий контакт`);
    // Помечаем обработанным, чтобы не пересчитывать это при каждой следующей оплате
    await pool.query(
      'UPDATE users SET referral_rewarded_at = NOW(), referral_reward_granted = FALSE WHERE id = $1',
      [paidUserId]
    );
    return;
  }

  // Дни добавляем к текущему сроку; если подписка истекла — считаем от сегодня,
  // иначе награда сгорела бы в прошлом.
  const sub = referrer.subscription || { plan: 'TRIAL', expiresAt: new Date().toISOString() };
  let expiresAt = new Date(sub.expiresAt);
  if (isNaN(expiresAt.getTime()) || expiresAt < new Date()) expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFERRAL_REWARD_DAYS);

  await pool.query(
    'UPDATE users SET subscription = $1, updated_at = NOW() WHERE id = $2',
    [JSON.stringify({ ...sub, expiresAt: expiresAt.toISOString() }), referrerId]
  );
  await pool.query(
    'UPDATE users SET referral_rewarded_at = NOW(), referral_reward_granted = TRUE WHERE id = $1',
    [paidUserId]
  );

  console.log(`🎁 Реферальная награда: +${REFERRAL_REWARD_DAYS} дн. пользователю ${referrerId} за оплату ${paidUserId}`);

  // Уведомление, чтобы человек увидел результат приглашения, а не гадал
  try {
    await createNotification(
      referrerId,
      'REFERRAL_BONUS',
      'Бонус за приглашение',
      `Приглашённый вами пользователь оплатил подписку — вам начислено ${REFERRAL_REWARD_DAYS} дней.`
    );
  } catch (e) { /* уведомления не критичны для начисления */ }
};

// Статистика для экрана «Пригласить друга»
app.get('/api/referral/stats', auth, async (req, res) => {
  if (req.user.role !== 'manager') {
    return res.status(403).json({ error: 'Реферальная программа доступна только владельцам аккаунта' });
  }
  try {
    const me = await pool.query('SELECT referral_code FROM users WHERE id = $1', [req.user.id]);
    let code = me.rows[0]?.referral_code;

    // Аккаунты, созданные до появления программы, кода не имеют — выдаём при первом заходе
    if (!code) {
      code = crypto.createHash('md5').update(req.user.id + 'finuchet-ref').digest('hex').slice(0, 8).toUpperCase();
      await pool.query('UPDATE users SET referral_code = $1 WHERE id = $2', [code, req.user.id]);
    }

    const stats = await pool.query(
      `SELECT COUNT(*)::int AS invited,
              COUNT(*) FILTER (WHERE referral_reward_granted = TRUE)::int AS paid
         FROM users WHERE referred_by = $1`,
      [req.user.id]
    );

    const invited = stats.rows[0].invited;
    const paid = stats.rows[0].paid;
    res.json({
      code,
      invited,
      paid,
      daysEarned: paid * REFERRAL_REWARD_DAYS,
      rewardDays: REFERRAL_REWARD_DAYS,
    });
  } catch (e) {
    console.error('❌ Referral stats error:', e);
    res.status(500).json({ error: 'Не удалось загрузить статистику' });
  }
});

// Непоказанные поздравления: сколько наград начислено с тех пор, как пользователь
// последний раз видел это окно. Возвращаем скопом — если человек не заходил неделю
// и за это время оплатили трое, показываем одно окно на 30 дней, а не три подряд.
app.get('/api/referral/pending', auth, async (req, res) => {
  if (req.user.role !== 'manager') return res.json({ count: 0, days: 0 });
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS cnt
         FROM users
        WHERE referred_by = $1
          AND referral_reward_granted = TRUE
          AND referral_rewarded_at > COALESCE(
                (SELECT referral_seen_at FROM users WHERE id = $1), to_timestamp(0))`,
      [req.user.id]
    );
    const count = r.rows[0].cnt;
    res.json({ count, days: count * REFERRAL_REWARD_DAYS, rewardDays: REFERRAL_REWARD_DAYS });
  } catch (e) {
    console.error('❌ Referral pending error:', e);
    res.json({ count: 0, days: 0 });
  }
});

app.post('/api/referral/pending/seen', auth, async (req, res) => {
  try {
    await pool.query('UPDATE users SET referral_seen_at = NOW() WHERE id = $1', [req.user.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('❌ Referral seen error:', e);
    res.status(500).json({ error: 'Ошибка' });
  }
});

// 👑 Админ: полная картина по реферальной программе
app.get('/api/admin/referrals', adminAuth, async (req, res) => {
  try {
    const summary = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE referred_by IS NOT NULL)::int                          AS invited_total,
        COUNT(*) FILTER (WHERE referral_reward_granted = TRUE)::int                   AS rewarded_total,
        COUNT(*) FILTER (WHERE referred_by IS NOT NULL
                           AND referral_rewarded_at IS NOT NULL
                           AND referral_reward_granted = FALSE)::int                  AS rejected_total,
        COUNT(DISTINCT referred_by) FILTER (WHERE referred_by IS NOT NULL)::int       AS referrers_total
      FROM users
    `);

    // Кто сколько привёл. Сортируем по оплатившим: привести сотню и не получить
    // ни одной оплаты — не заслуга, а повод присмотреться.
    const top = await pool.query(`
      SELECT r.id, r.name, r.email, r.referral_code,
             COUNT(u.id)::int                                            AS invited,
             COUNT(*) FILTER (WHERE u.referral_reward_granted = TRUE)::int AS paid
        FROM users r
        JOIN users u ON u.referred_by = r.id
       GROUP BY r.id, r.name, r.email, r.referral_code
       ORDER BY paid DESC, invited DESC
       LIMIT 50
    `);

    // Все пары «кто → кого» с текущим статусом
    const pairs = await pool.query(`
      SELECT u.id, u.name, u.email, u.created_at,
             u.referral_rewarded_at, u.referral_reward_granted,
             u.subscription->>'plan' AS plan,
             r.id AS referrer_id, r.name AS referrer_name, r.email AS referrer_email
        FROM users u
        JOIN users r ON r.id = u.referred_by
       ORDER BY u.created_at DESC
       LIMIT 300
    `);

    const s = summary.rows[0];
    res.json({
      summary: {
        ...s,
        daysGranted: s.rewarded_total * REFERRAL_REWARD_DAYS,
        // Доля приглашённых, которые дошли до оплаты
        conversion: s.invited_total > 0
          ? Math.round((s.rewarded_total / s.invited_total) * 100)
          : 0,
        rewardDays: REFERRAL_REWARD_DAYS,
      },
      top: top.rows,
      pairs: pairs.rows,
    });
  } catch (e) {
    console.error('❌ Admin referrals error:', e);
    res.status(500).json({ error: 'Не удалось загрузить данные' });
  }
});

app.post('/api/payment/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        // 🔒 ЮKassa НЕ подписывает вебхуки заголовком "signature" в формате
        // "v1 <shopId> <keyId> <sig>" — прежняя проверка была построена на неверном
        // предположении об их API и реально ни разу не проходила: по логам продакшена
        // 100% реальных вызовов (с IP из диапазонов ЮKassa 77.75.153.*/77.75.154.* и т.п.)
        // получали 401 "Invalid shopId", то есть подписка НИКОГДА не обновлялась после
        // оплаты — платёж проходил у ЮKassa, а наш сервер отбрасывал уведомление об этом
        // до того, как код апдейта подписки вообще успевал выполниться.
        //
        // Официально рекомендуемая ЮKassa защита в отсутствие крипто-подписи — сверка
        // по IP (это уже было, но раньше только предупреждало, а не блокировало) плюс
        // переспрос статуса платежа через их же API своим авторизованным запросом —
        // тело вебхука само по себе не источник истины, доверяем только ответу ЮKassa.
        const clientIp = req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.ip;
        const yookassaIpRanges = ['185.71.76.', '185.71.77.', '77.75.153.', '77.75.154.', '77.75.156.', '2a02:5180:'];
        const isFromYookassa = yookassaIpRanges.some(range => clientIp?.startsWith(range));

        if (!isFromYookassa) {
            console.warn(`⚠️ Webhook отклонён: IP вне диапазона ЮKassa: ${clientIp}`);
            return res.status(403).send('Forbidden');
        }

        const bodyString = req.body.toString('utf8');
        const parsedBody = JSON.parse(bodyString);
        const { event, object } = parsedBody;

        if (event === 'payment.succeeded' && object?.id) {
            const shopId = process.env.YOOKASSA_SHOP_ID;
            const secretKey = process.env.YOOKASSA_SECRET_KEY;

            // 🔒 Переспрашиваем реальный статус платежа у ЮKassa своим Basic Auth
            // запросом, а не доверяем напрямую телу вебхука (его теоретически можно
            // подделать, зная только IP-диапазон, но не секретный ключ магазина).
            const verifyResp = await axios.get(`https://api.yookassa.ru/v3/payments/${object.id}`, {
                headers: { 'Authorization': 'Basic ' + Buffer.from(`${shopId}:${secretKey}`).toString('base64') }
            });

            if (verifyResp.data?.status === 'succeeded') {
                const { userId, plan, months } = verifyResp.data.metadata || {};
                if (userId && plan && months) {
                    // 🔒 Сверяем, что заплачено ровно столько, сколько стоит этот тариф
                    // на этот срок. Без проверки достаточно было создать платёж в обход
                    // интерфейса — метаданные с планом и сроком активировали подписку
                    // независимо от внесённой суммы.
                    const expected = calculateSubscriptionAmount(plan, Number(months));
                    const paid = Number(verifyResp.data.amount?.value);
                    if (expected === null || !(paid >= expected)) {
                        console.error(
                            `🚨 Оплата не соответствует тарифу. Пользователь ${userId}, ${plan}/${months} мес.: ` +
                            `ожидалось ${expected} ₽, оплачено ${verifyResp.data.amount?.value}. Подписка НЕ активирована.`
                        );
                        return res.status(200).send('OK'); // 200, иначе ЮKassa будет слать вебхук повторно
                    }

                    const userResult = await pool.query('SELECT subscription FROM users WHERE id = $1', [userId]);
                    let currentSub = userResult.rows[0]?.subscription || { plan: 'TRIAL', expiresAt: new Date().toISOString() };
                    let newExpiresAt = new Date(currentSub.expiresAt);
                    if (newExpiresAt < new Date()) newExpiresAt = new Date();
                    newExpiresAt = addMonthsClamped(newExpiresAt, Number(months));

                    await pool.query(
                        'UPDATE users SET subscription = $1, updated_at = NOW() WHERE id = $2',
                        [JSON.stringify({ plan, expiresAt: newExpiresAt.toISOString() }), userId]
                    );
                    console.log(`✅ Subscription updated for user ${userId} to ${plan} for ${months} months`);

                    // 💳 Журнал оплат и доля партнёра. Обе операции идемпотентны по id
                    // платежа, поэтому повторный вебхук ничего не задваивает.
                    try {
                        await recordSubscriptionPayment({
                            paymentId: object.id, userId, amount: paid, plan, months: Number(months)
                        });
                        await accruePartnerCommission({ paymentId: object.id, clientId: userId, amount: paid });
                    } catch (e) {
                        // Как и с реферальной наградой: подписка уже продлена, и ошибка в
                        // ответе заставила бы ЮKassa слать вебхук снова.
                        console.error('⚠️ Не удалось записать оплату или начислить долю партнёра:', e.message);
                    }

                    // 🎁 Награда пригласившему — 10 дней за приглашённого, который заплатил.
                    // Начисляется один раз и только за ПЕРВУЮ оплату: повторные платежи
                    // того же человека награду не удваивают (см. referral_rewarded_at).
                    try {
                        await grantReferralReward(userId);
                    } catch (e) {
                        // Реферальная награда не должна ломать обработку платежа: подписка
                        // уже продлена, и вернуть ЮKassa ошибку означало бы повторный вебхук.
                        console.error('⚠️ Не удалось начислить реферальную награду:', e.message);
                    }
                } else {
                    console.warn('⚠️ Webhook payment.succeeded без userId/plan/months в metadata:', verifyResp.data?.metadata);
                }
            } else {
                console.warn(`⚠️ Webhook сообщил payment.succeeded, но проверка статуса в ЮKassa вернула: ${verifyResp.data?.status}`);
            }
        }

        // Всегда отвечаем 200 OK, чтобы ЮKassa не повторяла запрос
        res.status(200).send('OK');
    } catch (err) {
        console.error('[WEBHOOK] Critical error:', err);
        res.status(500).send('Server Error');
    }
});

// --- API KEY ROUTES ---
const apiKeyAuth = async (req, res, next) => {
  const apiKey = req.header('x-api-key');
  if (!apiKey) return res.status(401).json({ msg: 'No API key, authorization denied' });
  
  try {
    const result = await pool.query('SELECT * FROM users WHERE api_key = $1', [apiKey]);
    if (result.rows.length === 0) {
      return res.status(401).json({ msg: 'Invalid API key' });
    }
    req.user = result.rows[0];
    next();
  } catch (err) {
    console.error("API Key Auth Error:", err);
    res.status(500).json({ msg: 'Server Error' });
  }
};

app.post('/api/auth/generate-api-key', auth, async (req, res) => {
  try {
    const newKey = `sk_${uuidv4().replace(/-/g, '')}`;
    await pool.query('UPDATE users SET api_key = $1 WHERE id = $2', [newKey, req.user.id]);
    res.json({ apiKey: newKey });
  } catch (err) {
    console.error("Generate API Key Error:", err);
    res.status(500).send('Server Error');
  }
});






// =====================================================
// === 🔧 ТЕХПОДДЕРЖКА — ПОЛНЫЙ БЛОК РОУТОВ ===
// =====================================================

// === 📥 ПОЛЬЗОВАТЕЛЬСКИЕ РОУТЫ ===

// Получить список тикетов пользователя + непрочитанные + broadcast
app.get('/api/support/tickets', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    // 🔹 Админы видят все тикеты, остальные — только свои
    let ticketsResult;
    if (userRole === 'admin') {
      ticketsResult = await pool.query(`
        SELECT * FROM support_tickets ORDER BY updated_at DESC
      `);
    } else {
      ticketsResult = await pool.query(`
        SELECT * FROM support_tickets WHERE user_id = $1 ORDER BY updated_at DESC
      `, [userId]);
    }

    // Считаем непрочитанные для каждого тикета
    const tickets = await Promise.all(ticketsResult.rows.map(async (ticket) => {
      const unreadResult = await pool.query(`
        SELECT COUNT(*) as count FROM support_messages 
        WHERE ticket_id = $1 AND is_from_user = FALSE AND is_read = FALSE
      `, [ticket.id]);
      return { ...ticket, unreadCount: parseInt(unreadResult.rows[0].count) };
    }));

    // Получаем активные broadcast-сообщения
    let broadcastResult;
    if (userRole === 'admin') {
      broadcastResult = { rows: [] }; // Админам не показываем свои же рассылки
    } else {
      broadcastResult = await pool.query(`
        SELECT * FROM broadcast_messages 
        WHERE is_active = TRUE 
        AND (target_role IS NULL OR target_role = $1)
        AND NOT (read_by_users @> $2::jsonb)
        ORDER BY created_at DESC
      `, [userRole, JSON.stringify([userId])]);
    }

    const totalUnread = tickets.reduce((sum, t) => sum + t.unreadCount, 0) + broadcastResult.rows.length;
    res.json({ tickets, broadcasts: broadcastResult.rows, totalUnread });
  } catch (err) {
    console.error('Support tickets error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Создать новый тикет
app.post('/api/support/tickets', auth, async (req, res) => {
  try {
    const { subject, message, priority = 'NORMAL' } = req.body;
    if (!subject?.trim() || !message?.trim()) {
      return res.status(400).json({ msg: 'Заполните тему и сообщение' });
    }

    const userId = req.user.id;
    const ticketId = `ticket_${Date.now()}_${userId}`;
    const messageId = `msg_${Date.now()}`;

    await pool.query(`
      INSERT INTO support_tickets (id, user_id, subject, priority)
      VALUES ($1, $2, $3, $4)
    `, [ticketId, userId, subject.trim(), priority]);

    await pool.query(`
      INSERT INTO support_messages (id, ticket_id, user_id, message, is_from_user)
      VALUES ($1, $2, $3, $4, TRUE)
    `, [messageId, ticketId, userId, message.trim()]);

    const senderResult = await pool.query(`SELECT name FROM users WHERE id = $1`, [userId]);
    const senderName = senderResult.rows[0]?.name || 'Пользователь';
    await notifyAdminsOfSupportMessage(
      userId,
      'Новое обращение в поддержку',
      `${senderName}: ${subject.trim()}`,
      { ticketId }
    );

    res.json({ success: true, ticketId });
  } catch (err) {
    console.error('Create ticket error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// 🔥 ОТПРАВИТЬ СООБЩЕНИЕ В ТИКЕТ (ИСПРАВЛЕНО!)
app.post('/api/support/tickets/:ticketId/messages', auth, async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { message } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (!message?.trim()) {
      return res.status(400).json({ msg: 'Сообщение не может быть пустым' });
    }

    // 🔹 Проверка доступа: админ — ко всем, пользователь — только к своим
    let ticketResult;
    if (userRole === 'admin') {
      ticketResult = await pool.query(`SELECT * FROM support_tickets WHERE id = $1`, [ticketId]);
    } else {
      ticketResult = await pool.query(`SELECT * FROM support_tickets WHERE id = $1 AND user_id = $2`, [ticketId, userId]);
    }

    if (ticketResult.rows.length === 0) {
      return res.status(403).json({ msg: 'Доступ запрещён' });
    }

    const ticket = ticketResult.rows[0];
    if (ticket.status === 'CLOSED' && userRole !== 'admin') {
      return res.status(400).json({ msg: 'Тикет закрыт' });
    }

    const messageId = `msg_${Date.now()}`;
    const isFromUser = userRole !== 'admin';

    await pool.query(`
      INSERT INTO support_messages (id, ticket_id, user_id, message, is_from_user)
      VALUES ($1, $2, $3, $4, $5)
    `, [messageId, ticketId, userId, message.trim(), isFromUser]);

    await pool.query(`UPDATE support_tickets SET updated_at = NOW() WHERE id = $1`, [ticketId]);

    if (isFromUser) {
      const senderResult = await pool.query(`SELECT name FROM users WHERE id = $1`, [userId]);
      const senderName = senderResult.rows[0]?.name || 'Пользователь';
      const preview = message.trim().length > 120 ? `${message.trim().slice(0, 120)}…` : message.trim();
      await notifyAdminsOfSupportMessage(
        userId,
        'Новое сообщение в поддержке',
        `${senderName} (${ticket.subject}): ${preview}`,
        { ticketId }
      );
    }

    res.json({ success: true, messageId });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Получить сообщения тикета
app.get('/api/support/tickets/:ticketId/messages', auth, async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Проверка доступа
    let ticketResult;
    if (userRole === 'admin') {
      ticketResult = await pool.query(`SELECT * FROM support_tickets WHERE id = $1`, [ticketId]);
    } else {
      ticketResult = await pool.query(`SELECT * FROM support_tickets WHERE id = $1 AND user_id = $2`, [ticketId, userId]);
    }

    if (ticketResult.rows.length === 0) {
      return res.status(403).json({ msg: 'Доступ запрещён' });
    }

    const messagesResult = await pool.query(`
      SELECT * FROM support_messages WHERE ticket_id = $1 ORDER BY created_at ASC
    `, [ticketId]);

    // 🔹 Помечаем прочитанными сообщения, адресованные ИМЕННО ТОМУ, кто открыл тикет.
    //    Раньше ветки для админа не было вообще — из-за этого сообщения клиента навсегда
    //    оставались непрочитанными и счётчик в админ-панели не сбрасывался при открытии.
    if (userRole === 'admin') {
      await pool.query(`
        UPDATE support_messages SET is_read = TRUE
        WHERE ticket_id = $1 AND is_from_user = TRUE AND is_read = FALSE
      `, [ticketId]);
    } else {
      await pool.query(`
        UPDATE support_messages SET is_read = TRUE
        WHERE ticket_id = $1 AND is_from_user = FALSE AND is_read = FALSE
      `, [ticketId]);
    }

    res.json(messagesResult.rows);
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Закрыть тикет (пользователь или админ)
app.patch('/api/support/tickets/:ticketId/close', auth, async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (userRole === 'admin') {
      await pool.query(`
        UPDATE support_tickets SET status = 'CLOSED', resolved_at = NOW() WHERE id = $1
      `, [ticketId]);
    } else {
      await pool.query(`
        UPDATE support_tickets SET status = 'CLOSED', resolved_at = NOW() WHERE id = $1 AND user_id = $2
      `, [ticketId, userId]);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Close ticket error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Отметить broadcast как прочитанный
app.post('/api/support/broadcast/:broadcastId/read', auth, async (req, res) => {
  try {
    const { broadcastId } = req.params;
    const userId = req.user.id;

    await pool.query(`
      UPDATE broadcast_messages SET read_by_users = read_by_users || $1::jsonb WHERE id = $2
    `, [JSON.stringify([userId]), broadcastId]);

    res.json({ success: true });
  } catch (err) {
    console.error('Mark broadcast read error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// === 🔔 УВЕДОМЛЕНИЯ (платёж, договор, расход, whatsapp, рассылки) — тариф Стандарт+ ===

// Лента уведомлений (свои события + рассылки от администратора)
app.get('/api/notifications', auth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    const featureAccess = await checkFeatureAccess(targetUserId, 'notifications');
    if (!featureAccess.allowed) {
      return res.status(403).json({ msg: featureAccess.msg, hint: featureAccess.hint });
    }

    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const cursor = req.query.cursor;
    const archived = req.query.archived === 'true';

    const params = [await notificationAudience(req.user)];
    let cursorClause = '';
    if (cursor) {
      params.push(cursor);
      cursorClause = `AND created_at < $${params.length}`;
    }
    params.push(limit);

    const notifResult = await pool.query(
      `SELECT id, type, title, body, data, is_read, created_at FROM notifications
       WHERE user_id = ANY($1) AND is_archived = ${archived ? 'TRUE' : 'FALSE'} ${cursorClause}
       ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );

    // Рассылки от администратора не архивируются — у архива своего смысла для них нет,
    // поэтому они попадают только в обычную (неархивную) ленту.
    let broadcastItems = [];
    if (!archived && req.user.role !== 'admin') {
      const broadcastResult = await pool.query(`
        SELECT id, title, message, created_at, read_by_users FROM broadcast_messages
        WHERE is_active = TRUE AND (target_role IS NULL OR target_role = $1)
        ORDER BY created_at DESC LIMIT 50
      `, [req.user.role]);
      broadcastItems = broadcastResult.rows.map(b => ({
        id: `broadcast_${b.id}`,
        type: 'ADMIN_BROADCAST',
        title: b.title,
        body: b.message,
        data: null,
        is_read: (b.read_by_users || []).includes(req.user.id),
        created_at: b.created_at,
      }));
    }

    const merged = [...notifResult.rows, ...broadcastItems]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);

    res.json({
      items: merged.map(n => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        data: n.data,
        isRead: n.is_read,
        isArchived: !!n.is_archived,
        createdAt: n.created_at,
      })),
      nextCursor: merged.length === limit ? merged[merged.length - 1].created_at : null,
    });
  } catch (err) {
    console.error('GET /api/notifications error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Счётчик непрочитанных — для бейджа на колокольчике, лёгкий и опрашивается часто
app.get('/api/notifications/unread-count', auth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    const featureAccess = await checkFeatureAccess(targetUserId, 'notifications');
    if (!featureAccess.allowed) {
      return res.json({ count: 0 });
    }

    const notifResult = await pool.query(
      `SELECT COUNT(*) as count FROM notifications WHERE user_id = ANY($1) AND is_read = FALSE AND is_archived = FALSE`,
      [await notificationAudience(req.user)]
    );

    let broadcastCount = 0;
    if (req.user.role !== 'admin') {
      const broadcastResult = await pool.query(`
        SELECT COUNT(*) as count FROM broadcast_messages
        WHERE is_active = TRUE AND (target_role IS NULL OR target_role = $1)
        AND NOT (read_by_users @> $2::jsonb)
      `, [req.user.role, JSON.stringify([req.user.id])]);
      broadcastCount = parseInt(broadcastResult.rows[0].count, 10);
    }

    res.json({ count: parseInt(notifResult.rows[0].count, 10) + broadcastCount });
  } catch (err) {
    console.error('GET /api/notifications/unread-count error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Отметить одно уведомление прочитанным (поддерживает и broadcast_* id)
app.post('/api/notifications/:id/read', auth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    const { id } = req.params;

    if (id.startsWith('broadcast_')) {
      const broadcastId = id.slice('broadcast_'.length);
      await pool.query(`
        UPDATE broadcast_messages SET read_by_users = read_by_users || $1::jsonb
        WHERE id = $2 AND NOT (read_by_users @> $1::jsonb)
      `, [JSON.stringify([req.user.id]), broadcastId]);
    } else {
      await pool.query(
        `UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = ANY($2)`,
        [id, await notificationAudience(req.user)]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/notifications/:id/read error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Отметить все уведомления прочитанными (свои события + рассылки)
app.post('/api/notifications/read-all', auth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);

    await pool.query(
      `UPDATE notifications SET is_read = TRUE WHERE user_id = ANY($1) AND is_read = FALSE`,
      [await notificationAudience(req.user)]
    );

    if (req.user.role !== 'admin') {
      await pool.query(`
        UPDATE broadcast_messages SET read_by_users = read_by_users || $1::jsonb
        WHERE is_active = TRUE AND (target_role IS NULL OR target_role = $2)
        AND NOT (read_by_users @> $1::jsonb)
      `, [JSON.stringify([req.user.id]), req.user.role]);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/notifications/read-all error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Архивировать уведомление (рассылки не архивируются — у них нет этого понятия)
app.post('/api/notifications/:id/archive', auth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    const { id } = req.params;
    if (id.startsWith('broadcast_')) {
      return res.status(400).json({ msg: 'Рассылки нельзя архивировать' });
    }

    await pool.query(
      `UPDATE notifications SET is_archived = TRUE WHERE id = $1 AND user_id = ANY($2)`,
      [id, await notificationAudience(req.user)]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/notifications/:id/archive error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Вернуть уведомление из архива
app.post('/api/notifications/:id/unarchive', auth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    const { id } = req.params;
    if (id.startsWith('broadcast_')) {
      return res.status(400).json({ msg: 'Рассылки нельзя архивировать' });
    }

    await pool.query(
      `UPDATE notifications SET is_archived = FALSE WHERE id = $1 AND user_id = ANY($2)`,
      [id, await notificationAudience(req.user)]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/notifications/:id/unarchive error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// === 🔔📱 PUSH-УВЕДОМЛЕНИЯ НА УСТРОЙСТВО (Web Push) ===

// Публичный VAPID-ключ — нужен браузеру для pushManager.subscribe()
app.get('/api/push/public-key', auth, async (req, res) => {
  res.json({ publicKey: PUSH_ENABLED ? VAPID_PUBLIC_KEY : null });
});

// Подписать текущее устройство
app.post('/api/push/subscribe', auth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    const { endpoint, keys } = req.body;

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ msg: 'Некорректные данные подписки' });
    }

    const featureAccess = await checkFeatureAccess(targetUserId, 'notifications');
    if (!featureAccess.allowed) {
      return res.status(403).json({ msg: featureAccess.msg, hint: featureAccess.hint });
    }

    const id = `push_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    await pool.query(`
      INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (endpoint) DO UPDATE SET
        user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent
    `, [id, targetUserId, endpoint, keys.p256dh, keys.auth, req.headers['user-agent'] || null]);

    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/push/subscribe error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Отписать устройство
app.post('/api/push/unsubscribe', auth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ msg: 'Отсутствует endpoint' });

    await pool.query(
      `DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2`,
      [endpoint, targetUserId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/push/unsubscribe error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Список подписанных устройств — для отображения в Настройках
app.get('/api/push/subscriptions', auth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    const result = await pool.query(
      `SELECT id, endpoint, user_agent, created_at FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC`,
      [targetUserId]
    );
    res.json(result.rows.map(r => ({
      id: r.id,
      endpoint: r.endpoint,
      userAgent: r.user_agent,
      createdAt: r.created_at,
    })));
  } catch (err) {
    console.error('GET /api/push/subscriptions error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// === 👑 АДМИНСКИЕ РОУТЫ ===

// Получить все тикеты с фильтрами
app.get('/api/admin/support/tickets', adminAuth, async (req, res) => {
  try {
    const { status, priority, search } = req.query;

    // 🔹 is_read у сообщения относится к ЕГО получателю:
    //    is_from_user = TRUE  → написал клиент, получатель админ  → is_read = "админ прочитал"
    //    is_from_user = FALSE → написал админ,  получатель клиент → is_read = "клиент прочитал"
    //    Раньше здесь считались сообщения САМОГО админа (is_from_user = FALSE), то есть бейдж
    //    показывал «сколько моих ответов ещё не прочитал клиент» и никогда не сбрасывался,
    //    когда админ открывал тикет. Считаем непрочитанные сообщения ОТ КЛИЕНТА.
    let query = `
      SELECT st.*, u.name as user_name, u.email as user_email,
        (SELECT COUNT(*) FROM support_messages
         WHERE ticket_id = st.id AND is_from_user = TRUE AND is_read = FALSE) as unread_count,
        (SELECT COUNT(*) FROM support_messages WHERE ticket_id = st.id) as messages_count,
        (SELECT message FROM support_messages WHERE ticket_id = st.id
         ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT is_from_user FROM support_messages WHERE ticket_id = st.id
         ORDER BY created_at DESC LIMIT 1) as last_message_from_user,
        (SELECT created_at FROM support_messages WHERE ticket_id = st.id
         ORDER BY created_at DESC LIMIT 1) as last_message_at
      FROM support_tickets st
      JOIN users u ON st.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (status) { query += ` AND st.status = $${idx++}`; params.push(status); }
    if (priority) { query += ` AND st.priority = $${idx++}`; params.push(priority); }
    if (search) {
      query += ` AND (st.subject ILIKE $${idx} OR u.name ILIKE $${idx} OR u.email ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    query += ` ORDER BY st.updated_at DESC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin tickets error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Админ отвечает в тикет
app.post('/api/admin/support/tickets/:ticketId/messages', adminAuth, async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ msg: 'Сообщение не может быть пустым' });

    const ticketResult = await pool.query(`SELECT * FROM support_tickets WHERE id = $1`, [ticketId]);
    if (ticketResult.rows.length === 0) return res.status(404).json({ msg: 'Тикет не найден' });

    const messageId = `msg_${Date.now()}`;
    await pool.query(`
      INSERT INTO support_messages (id, ticket_id, user_id, message, is_from_user)
      VALUES ($1, $2, $3, $4, FALSE)
    `, [messageId, ticketId, req.user.id, message.trim()]);

    // 🔹 Ответ админа = тикет в работе + закрепляется за ответившим (если ещё ничей).
    //    Раньше приходилось отдельно жать «Назначить», иначе тикет навсегда висел в OPEN.
    await pool.query(`
      UPDATE support_tickets
      SET updated_at = NOW(),
          status = CASE WHEN status = 'OPEN' THEN 'IN_PROGRESS' ELSE status END,
          assigned_admin_id = COALESCE(assigned_admin_id, $2)
      WHERE id = $1
    `, [ticketId, req.user.id]);
    res.json({ success: true, messageId });
  } catch (err) {
    console.error('Admin message error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Админ переоткрывает закрытый тикет
app.patch('/api/admin/support/tickets/:ticketId/reopen', adminAuth, async (req, res) => {
  try {
    const { ticketId } = req.params;
    await pool.query(`
      UPDATE support_tickets SET status = 'IN_PROGRESS', resolved_at = NULL, updated_at = NOW()
      WHERE id = $1
    `, [ticketId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Reopen ticket error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Админ назначает себя на тикет
app.patch('/api/admin/support/tickets/:ticketId/assign', adminAuth, async (req, res) => {
  try {
    const { ticketId } = req.params;
    await pool.query(`
      UPDATE support_tickets SET assigned_admin_id = $1, status = 'IN_PROGRESS' WHERE id = $2
    `, [req.user.id, ticketId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Assign ticket error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Массовая рассылка
app.post('/api/admin/support/broadcast', adminAuth, async (req, res) => {
  try {
    const { title, message, targetRole } = req.body;
    if (!title?.trim() || !message?.trim()) {
      return res.status(400).json({ msg: 'Заполните заголовок и сообщение' });
    }

    const broadcastId = `broadcast_${Date.now()}`;
    await pool.query(`
      INSERT INTO broadcast_messages (id, admin_id, title, message, target_role)
      VALUES ($1, $2, $3, $4, $5)
    `, [broadcastId, req.user.id, title.trim(), message.trim(), targetRole || null]);

    res.json({ success: true, broadcastId });
  } catch (err) {
    console.error('Broadcast error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Статистика поддержки
app.get('/api/admin/support/stats', adminAuth, async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_tickets,
        COUNT(*) FILTER (WHERE status = 'OPEN') as open_tickets,
        COUNT(*) FILTER (WHERE status = 'IN_PROGRESS') as in_progress_tickets,
        COUNT(*) FILTER (WHERE status = 'CLOSED') as closed_tickets,
        COUNT(*) FILTER (WHERE priority = 'HIGH') as high_priority,
        (SELECT COUNT(*) FROM support_messages WHERE is_from_user = TRUE AND is_read = FALSE) as unread_messages
      FROM support_tickets
    `);
    res.json(stats.rows[0]);
  } catch (err) {
    console.error('Support stats error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Удалить тикет (админ)
app.delete('/api/admin/support/tickets/:ticketId', adminAuth, async (req, res) => {
  try {
    const { ticketId } = req.params;
    await pool.query(`DELETE FROM support_messages WHERE ticket_id = $1`, [ticketId]);
    await pool.query(`DELETE FROM support_tickets WHERE id = $1`, [ticketId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete ticket error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});




// --- PUBLIC API V1 ---
// Все API V1 роуты также используют исправленную логику getTargetUserId

app.get('/api/v1/customers', apiKeyAuth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    const result = await pool.query("SELECT data FROM data_items WHERE user_id = $1 AND type = 'customers'", [targetUserId]);
    const customers = result.rows.map(r => r.data);
    res.json(customers);
  } catch (err) {
    console.error("API Customers Error:", err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

app.post('/api/v1/customers', apiKeyAuth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    const customerData = req.body;
    
    if (!customerData.name || !customerData.phone) {
      return res.status(400).json({ msg: 'Missing required fields: name, phone' });
    }
    
    const customerId = customerData.id || `cust_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    
    const newCustomer = {
      ...customerData,
      id: customerId,
      userId: targetUserId,
      trustScore: customerData.trustScore || 50,
      notes: customerData.notes || '',
      totalPurchases: 0
    };
    
    await pool.query(`
      INSERT INTO data_items (id, user_id, type, data, updated_at)
      VALUES ($1, $2, 'customers', $3, NOW())
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `, [customerId, targetUserId, JSON.stringify(newCustomer)]);
    
    res.json(newCustomer);
  } catch (err) {
    console.error("API Create Customer Error:", err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

app.get('/api/v1/accounts', apiKeyAuth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    
    const accountsResult = await pool.query("SELECT data FROM data_items WHERE user_id = $1 AND type = 'accounts'", [targetUserId]);
    const salesResult = await pool.query("SELECT data FROM data_items WHERE user_id = $1 AND type = 'sales'", [targetUserId]);
    const expensesResult = await pool.query("SELECT data FROM data_items WHERE user_id = $1 AND type = 'expenses'", [targetUserId]);
    
    const accounts = accountsResult.rows.map(r => r.data);
    const sales = salesResult.rows.map(r => r.data);
    const expenses = expensesResult.rows.map(r => r.data);
    
    const accountsWithBalance = accounts.map(acc => {
      let total = 0;
      const accountSales = sales.filter(s => s.accountId === acc.id);
      accountSales.forEach(s => {
        total += (s.downPayment || 0);
        if (s.paymentPlan) {
          s.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false).forEach(p => total += (p.amount || 0));
        }
      });
      const accountExpenses = expenses.filter(e => e.accountId === acc.id);
      total -= accountExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
      
      return {
        ...acc,
        calculatedBalance: total
      };
    });
    
    res.json(accountsWithBalance);
  } catch (err) {
    console.error("API Accounts Error:", err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

app.post('/api/v1/income', apiKeyAuth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    const { amount, accountId, note, date } = req.body;
    
    if (!amount || !accountId) {
      return res.status(400).json({ msg: 'Missing required fields: amount, accountId' });
    }
    
    const incomeId = `inc_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const newIncome = {
      id: incomeId,
      userId: targetUserId,
      type: 'CASH',
      customerId: 'system_income',
      productName: note || 'Приход через API',
      buyPrice: 0,
      accountId: accountId,
      totalAmount: Number(amount),
      downPayment: Number(amount),
      remainingAmount: 0,
      interestRate: 0,
      installments: 0,
      startDate: date || new Date().toISOString(),
      status: 'COMPLETED',
      paymentPlan: []
    };
    
    await pool.query(`
      INSERT INTO data_items (id, user_id, type, data, updated_at)
      VALUES ($1, $2, 'sales', $3, NOW())
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `, [incomeId, targetUserId, JSON.stringify(newIncome)]);
    
    res.json(newIncome);
  } catch (err) {
    console.error("API Create Income Error:", err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

app.get('/api/v1/expenses', apiKeyAuth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    const result = await pool.query("SELECT data FROM data_items WHERE user_id = $1 AND type = 'expenses'", [targetUserId]);
    const expenses = result.rows.map(r => r.data);
    res.json(expenses);
  } catch (err) {
    console.error("API Expenses Error:", err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

app.post('/api/v1/expenses', apiKeyAuth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    const { amount, accountId, title, category, date } = req.body;
    
    if (!amount || !accountId || !title) {
      return res.status(400).json({ msg: 'Missing required fields: amount, accountId, title' });
    }
    
    const expenseId = `exp_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const newExpense = {
      id: expenseId,
      userId: targetUserId,
      accountId: accountId,
      title: title,
      amount: Number(amount),
      category: category || 'Прочее',
      date: date || new Date().toISOString()
    };
    
    await pool.query(`
      INSERT INTO data_items (id, user_id, type, data, updated_at)
      VALUES ($1, $2, 'expenses', $3, NOW())
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `, [expenseId, targetUserId, JSON.stringify(newExpense)]);
    
    res.json(newExpense);
  } catch (err) {
    console.error("API Create Expense Error:", err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

app.get('/api/v1/contracts', apiKeyAuth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    const result = await pool.query("SELECT data FROM data_items WHERE user_id = $1 AND type = 'sales'", [targetUserId]);
    const sales = result.rows.map(r => r.data);
    res.json(sales);
  } catch (err) {
    console.error("API Contracts Error:", err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

app.post('/api/v1/contracts', apiKeyAuth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    const saleData = req.body;

    const limitCheck = await checkContractLimit(targetUserId, 'create');
    if (!limitCheck.allowed) {
      return res.status(403).json({
        msg: limitCheck.reason,
        details: { current: limitCheck.current, limit: limitCheck.limit }
      });
    }

    if (!saleData.customerId || !saleData.totalAmount || !saleData.productName) {
      return res.status(400).json({ msg: 'Missing required fields: customerId, totalAmount, productName' });
    }

    const saleId = saleData.id || `sale_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const newSale = {
      ...saleData,
      id: saleId,
      userId: targetUserId,
      status: saleData.status || 'ACTIVE',
      paymentPlan: saleData.paymentPlan || [],
      startDate: saleData.startDate || new Date().toISOString()
    };

    await pool.query(`
      INSERT INTO data_items (id, user_id, type, data, updated_at)
      VALUES ($1, $2, 'sales', $3, NOW())
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `, [saleId, targetUserId, JSON.stringify(newSale)]);

    res.json(newSale);
  } catch (err) {
    console.error("API Create Contract Error:", err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

app.post('/api/v1/payments', apiKeyAuth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    const { contractId, amount, date } = req.body;
    
    if (!contractId || !amount) {
      return res.status(400).json({ msg: 'Missing contractId or amount' });
    }
    
    const saleResult = await pool.query("SELECT data FROM data_items WHERE id = $1 AND user_id = $2 AND type = 'sales'", [contractId, targetUserId]);
    if (saleResult.rows.length === 0) {
      return res.status(404).json({ msg: 'Contract not found' });
    }
    
    const sale = saleResult.rows[0].data;
    
    const payment = {
      id: `pay_${Date.now()}_api`,
      saleId: contractId,
      amount: Number(amount),
      date: date || new Date().toISOString(),
      isPaid: true,
      // 🔒 Без этого флага запись проходит ОБА фильтра отображения сразу — и как
      // поступление (isRealPayment !== false), и как закрытый месяц графика
      // (isRealPayment !== true). Тогда она сама себя взаимно погашает в расчёте
      // излишка, платёж попадает в историю, но не закрывает месяцы в графике.
      isRealPayment: true,
      actualDate: new Date().toISOString()
    };
    
    sale.paymentPlan.push(payment);
    sale.remainingAmount = Math.max(0, sale.remainingAmount - Number(amount));
    if (sale.remainingAmount === 0) {
      sale.status = 'COMPLETED';
    }
    
    await pool.query(`
      UPDATE data_items SET data = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3
    `, [JSON.stringify(sale), contractId, targetUserId]);
    
    res.json({ msg: 'Payment processed', payment, remainingAmount: sale.remainingAmount });
  } catch (err) {
    console.error("API Payment Error:", err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

// =====================================================
// === 🧮 КАЛЬКУЛЯТОР — СОХРАНЕНИЕ КОНФИГОВ ===
// =====================================================

// Сохранить конфиг калькулятора → вернуть короткий ID
app.post('/api/calculator-configs', auth, async (req, res) => {
  try {
    const { defaultRate, termRates, roundStep, roundDir, markupOnRemainder } = req.body;

    // 🔹 Валидация
    if (defaultRate === undefined || !Array.isArray(termRates)) {
      return res.status(400).json({ msg: 'Некорректные данные конфига' });
    }
    // Шаг и направление округления — только из списка, поддержанного калькулятором
    if (roundStep !== undefined && ![0, 100, 500, 1000].includes(Number(roundStep))) {
      return res.status(400).json({ msg: 'Некорректный шаг округления' });
    }
    if (roundDir !== undefined && !['up', 'down'].includes(roundDir)) {
      return res.status(400).json({ msg: 'Некорректное направление округления' });
    }
    if (termRates.length > 20) {
      return res.status(400).json({ msg: 'Максимум 20 правил' });
    }
    if (termRates.some(r => r.months < 1 || r.months > 60 || r.rate < 0 || r.rate > 200)) {
      return res.status(400).json({ msg: 'Некорректные значения правил' });
    }

    // 🔹 Генерируем короткий уникальный ID (6 символов: a1b2c3)
    const configId = Math.random().toString(36).substring(2, 8);

    const configData = {
      id: `cfg_${configId}`,
      defaultRate: parseFloat(defaultRate),
      termRates: termRates.map(r => ({ months: r.months, rate: r.rate })),
      roundStep: Number(roundStep) || 0,
      roundDir: roundDir === 'down' ? 'down' : 'up',
      markupOnRemainder: !!markupOnRemainder,
      createdAt: new Date().toISOString(),
      createdBy: req.user.id
    };

    // 🔹 Сохраняем в data_items с типом 'calculator_configs'
    await pool.query(`
      INSERT INTO data_items (id, user_id, type, data, updated_at)
      VALUES ($1, $2, 'calculator_configs', $3, NOW())
    `, [configData.id, req.user.id, JSON.stringify(configData)]);

    res.json({ configId }); // Возвращаем только короткий ID: "a1b2c3"

  } catch (err) {
    console.error('Save calculator config error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Получить конфиг по короткому ID (публичный доступ — без auth!)
app.get('/api/calculator-configs/:configId', async (req, res) => {
  try {
    const { configId } = req.params;
    const fullId = `cfg_${configId}`;

    // 1. Получаем конфиг
    const configResult = await pool.query(`
      SELECT data, user_id FROM data_items 
      WHERE id = $1 AND type = 'calculator_configs'
    `, [fullId]);

    if (configResult.rows.length === 0) {
      return res.status(404).json({ msg: 'Конфиг не найден' });
    }

    const config = configResult.rows[0].data;
    const ownerId = configResult.rows[0].user_id;  // ← ID владельца конфига

    // 2. 🔥 Получаем телефон владельца из таблицы users
    const userResult = await pool.query(
      `SELECT phone FROM users WHERE id = $1`,
      [ownerId]
    );

    const sellerPhone = userResult.rows[0]?.phone || null;

    // 3. Проверяем актуальность конфига (30 дней)
    const configDate = new Date(config.createdAt);
    const daysOld = (Date.now() - configDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysOld > 30) {
      await pool.query('DELETE FROM data_items WHERE id = $1', [fullId]);
      return res.status(410).json({ msg: 'Конфиг устарел' });
    }

    // 4. 🔥 Возвращаем конфиг + телефон владельца
    res.json({
      defaultRate: config.defaultRate,
      termRates: config.termRates,
      // Ссылки, созданные до появления настройки, округления не хранят — но раньше
      // калькулятор всегда округлял вверх до 100 ₽. Отдаём им прежнее поведение,
      // иначе у клиента по уже разосланной ссылке молча поменяется сумма платежа.
      roundStep: config.roundStep === undefined ? 100 : config.roundStep,
      roundDir: config.roundDir === 'down' ? 'down' : 'up',
      markupOnRemainder: !!config.markupOnRemainder,
      sellerPhone: sellerPhone  // ← Новое поле
    });

  } catch (err) {
    console.error('Get calculator config error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});
// 💰 Премия сотрудника — считает СЕРВЕР.
// В браузере у сотрудника данные урезаны по доступным счетам: в общем пуле он видит
// только «своего» инвестора, из-за чего капитал-доля посчиталась бы как 100% вместо
// реальной, и премия вышла бы неверной. Здесь берутся полные данные менеджера,
// а наружу отдаются только итоговые суммы — чужих договоров сотрудник не увидит.
app.get('/api/my-bonus', auth, async (req, res) => {
  try {
    if (req.user.role !== 'employee') {
      return res.json({ enabled: false });
    }
    const meRes = await pool.query(
      'SELECT manager_id, profit_percentage, profit_base, profit_source, profit_since FROM users WHERE id = $1',
      [req.user.id]
    );
    const me = meRes.rows[0];
    if (!me || !(Number(me.profit_percentage) > 0)) {
      return res.json({ enabled: false });
    }

    const ownerId = me.manager_id;
    const rows = await pool.query(
      `SELECT type, data FROM data_items WHERE user_id = $1 AND type IN ('sales','accounts','investors','expenses')`,
      [ownerId]
    );
    const byType = { sales: [], accounts: [], investors: [], expenses: [] };
    rows.rows.forEach(r => { if (byType[r.type]) byType[r.type].push(r.data); });

    const { getEmployeeProfitAccrued, getEmployeeSalaryPaid } = await getProfitModule();
    const employee = {
      id: req.user.id,
      profitPercentage: Number(me.profit_percentage),
      profitBase: me.profit_base || 'CONTRACTS',
      profitSource: me.profit_source || 'MANAGER',
      profitSince: toDateString(me.profit_since),
    };
    const accrued = getEmployeeProfitAccrued(employee, byType.sales, byType.accounts, byType.investors);
    const paid = getEmployeeSalaryPaid(req.user.id, byType.expenses);

    res.json({
      enabled: true,
      percentage: employee.profitPercentage,
      base: employee.profitBase,
      source: employee.profitSource,
      since: employee.profitSince || null,
      accrued: Math.round(accrued * 100) / 100,
      paid: Math.round(paid * 100) / 100,
      balance: Math.round((accrued - paid) * 100) / 100,
    });
  } catch (e) {
    console.error('my-bonus error:', e);
    res.status(500).json({ msg: 'Не удалось рассчитать премию' });
  }
});

// 🔹 Резервное копирование на почту (роуты + ночной планировщик), см. server/backup.js
const backupModule = require('./backup')({
  pool, transporter, auth, getEffectivePlan, generateCode,
});
backupModule.registerRoutes(app);
backupModule.startScheduler();

// 🔹 Очистка старых конфигов (запускается раз в сутки)
setInterval(async () => {
  try {
    const result = await pool.query(`
      DELETE FROM data_items 
      WHERE type = 'calculator_configs' 
      AND (data->>'createdAt')::timestamp < NOW() - INTERVAL '30 days'
    `);
    if (result.rowCount > 0) {

    }
  } catch (err) {
    console.error('Cleanup calculator configs error:', err);
  }
}, 24 * 60 * 60 * 1000); // Раз в 24 часа

// --- VITE MIDDLEWARE ---
const startServer = async () => {
  if (process.env.NODE_ENV !== 'production') {
    const viteModule = await import('vite');
    const vite = await viteModule.createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const path = require('path');
    app.use(express.static(path.join(__dirname, '../dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, '../dist', 'index.html'));
    });
  }
  
  app.listen(PORT, '0.0.0.0', () => {

  });
};

startServer();



