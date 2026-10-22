// Утренняя сводка FinUchetGPT: в выбранный час по Москве (по умолчанию 9:00,
// можно «только по будням») — сколько платежей ждём сегодня, кто в просрочке,
// сколько получили вчера. Включается в настройках агента
// (users.ai_settings.morningDigest, digestHour, digestWeekdays). Считается по
// базе, без модели: бесплатно и цифры всегда те же, что в приложении. Уходит
// обычным уведомлением приложения (createNotification) — с его настройками и
// пушем, нажатие открывает чат агента — и первым сообщением в чате, с кнопками
// следующих шагов по этим цифрам.
//
// Только тем, у кого агент доступен: владелец аккаунта с тарифом ИИ или
// оставшимися пробными запросами (сводка — часть агента).

const domain = require('../api/domain');
const { collectionPayments, isCustomerSale } = require('../../shared/collections.js');

const DEFAULT_HOUR = 9;
// Сервер перезапускался ровно в этот час — догоняем, но не позже чем через два часа:
// «план на сегодня» в обед уже не план
const CATCH_UP_HOURS = 2;
const mskDay = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
const mskHour = () => Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false }));
// 0 — воскресенье, 6 — суббота
const mskWeekday = () => new Date(`${mskDay()}T12:00:00Z`).getUTCDay();
const money = (n) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;
const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};

/** Пора ли слать: час настал (с запасом на перезапуск), день подходит */
const isDigestTime = (settings, hour = mskHour(), weekday = mskWeekday()) => {
  const h = Number.isInteger(settings?.digestHour) ? settings.digestHour : DEFAULT_HOUR;
  if (settings?.digestWeekdays && (weekday === 0 || weekday === 6)) return false;
  return hour >= h && hour <= h + CATCH_UP_HOURS;
};

/**
 * Цифры сводки. customers — чтобы знать, кому можно напомнить (есть телефон
 * и напоминания не отключены в карточке).
 */
const digestStats = (sales, customers, today, withoutDownPayment = false, investors = []) => {
  const byId = new Map(customers.map(c => [c.id, c]));
  const yesterday = mskDay(new Date(new Date(`${today}T12:00:00+03:00`).getTime() - 864e5));
  const st = { dueCount: 0, dueSum: 0, overdueCount: 0, overdueSum: 0, remindable: 0, muted: 0, receivedYesterday: 0, collectedWithoutDownPayment: withoutDownPayment };
  const investorIds = new Set(investors.map(i => i.id));
  for (const s of sales) {
    if (!isCustomerSale(s, investorIds)) continue;
    // Вчера получено: первый взнос и платежи по договорам
    if (s.type === 'INSTALLMENT') {
      for (const p of collectionPayments(s, withoutDownPayment)) {
        if (mskDay(new Date(p.actualDate || p.date)) === yesterday) st.receivedYesterday += p.amount;
      }
    }
    if (s.status !== 'ACTIVE') continue;
    for (const p of s.paymentPlan || []) {
      if (p.isRealPayment === true || p.isPaid || !p.date) continue;
      if (mskDay(new Date(p.date)) === today) { st.dueCount++; st.dueSum += Number(p.amount) || 0; }
    }
    const o = domain.overdueAmount(s);
    if (o > 0) {
      st.overdueCount++; st.overdueSum += o;
      const c = byId.get(s.customerId);
      if (c?.allowWhatsappNotification === false) st.muted++;
      else if (c?.phone) st.remindable++;
    }
  }
  return st;
};

/** Текст сводки или null — сообщать нечего */
const digestText = (st) => {
  if (!st.dueCount && !st.overdueCount && !st.receivedYesterday) return null;
  const parts = [];
  parts.push(st.dueCount
    ? `Сегодня ждём ${st.dueCount} ${plural(st.dueCount, 'платёж', 'платежа', 'платежей')} на ${money(st.dueSum)}.`
    : 'Сегодня платежей по графику нет.');
  if (st.overdueCount) {
    parts.push(`В просрочке ${st.overdueCount} ${plural(st.overdueCount, 'договор', 'договора', 'договоров')} на ${money(st.overdueSum)}`
      + (st.muted ? ` (у ${st.muted} напоминания отключены в карточке клиента).` : '.'));
  }
  if (st.receivedYesterday) parts.push(`Вчера получено ${money(st.receivedYesterday)}${st.collectedWithoutDownPayment ? ' без первых взносов' : ''}.`);
  return parts.join(' ');
};

// Прежний вызов: только по договорам
const buildDigest = (sales, today) => digestText(digestStats(sales, [], today));

module.exports = ({ pool, createNotification, aiTrialRequests, aiPlans }) => {
  // force — без проверки часа (проверка вручную)
  const tick = async (force = false) => {
    const today = mskDay();
    const { rows } = await pool.query(
      `SELECT id, role, ai_subscription, ai_trial_used, ai_settings FROM users
        WHERE (ai_settings->>'morningDigest') = 'true' AND role IN ('manager', 'admin')
          AND coalesce(ai_settings->>'digestSentOn', '') <> $1`, [today]);
    for (const u of rows) {
      try {
        if (!force && !isDigestTime(u.ai_settings)) continue;
        const sub = u.ai_subscription && new Date(u.ai_subscription.expiresAt) > new Date() && aiPlans[u.ai_subscription.plan];
        const trialLeft = (u.ai_trial_used || 0) < aiTrialRequests;
        if (u.role !== 'admin' && !sub && !trialLeft) continue;
        // Отметка до отправки: при сбое лучше пропустить день, чем прислать дважды
        await pool.query(`UPDATE users SET ai_settings = coalesce(ai_settings, '{}'::jsonb) || jsonb_build_object('digestSentOn', $1::text) WHERE id = $2`, [today, u.id]);
        const [sales, customers, settings, investors] = await Promise.all(['sales', 'customers', 'settings', 'investors'].map(t =>
          pool.query(`SELECT data FROM data_items WHERE user_id = $1 AND type = $2`, [u.id, t]).then(r => r.rows.map(x => x.data))));
        const stats = digestStats(sales, customers, today, !!settings[0]?.collectedWithoutDownPayment, investors);
        const text = digestText(stats);
        if (text) {
          // Та же сводка — первым сообщением в чате агента, когда его откроют сегодня; кнопки — по цифрам
          const keep = { dueCount: stats.dueCount, overdueCount: stats.overdueCount, remindable: stats.remindable, muted: stats.muted };
          await pool.query(`UPDATE users SET ai_settings = ai_settings || jsonb_build_object('digest', jsonb_build_object('date', $1::text, 'text', $2::text, 'stats', $3::jsonb)) WHERE id = $4`,
            [today, text, JSON.stringify(keep), u.id]);
          // Нажатие на уведомление открывает чат агента (App.tsx: ?open=ai)
          await createNotification(u.id, 'AI_DIGEST', 'FinUchetGPT: план на сегодня', text, { url: '/app?open=ai' });
        }
      } catch (e) {
        console.error('AI digest error:', u.id, e.message);
      }
    }
  };
  return {
    buildDigest,
    digestStats,
    digestText,
    isDigestTime,
    tick,
    start() {
      // Каждые 10 минут: час у каждого свой, повтор в тот же день отсекает digestSentOn
      setInterval(() => tick().catch(e => console.error('AI digest tick:', e.message)), 10 * 60 * 1000);
      tick().catch(e => console.error('AI digest tick:', e.message));
    },
  };
};

module.exports.isDigestTime = isDigestTime;
module.exports.digestStats = digestStats;
module.exports.digestText = digestText;
