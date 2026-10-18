// Утренняя сводка FinUchetGPT: в 9:00 по Москве — сколько платежей ждём
// сегодня и сколько договоров в просрочке. Включается в настройках агента
// (users.ai_settings.morningDigest). Считается по базе, без модели: бесплатно
// и цифры всегда те же, что в приложении. Уходит обычным уведомлением
// приложения (createNotification) — с его настройками и пушем — и первым
// сообщением в чате агента, когда его откроют в тот же день.
//
// Только тем, у кого агент доступен: владелец аккаунта с тарифом ИИ или
// оставшимися пробными запросами (сводка — часть агента).

const domain = require('../api/domain');

const HOUR_MSK = 9;
const mskDay = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
const mskHour = () => Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false }));
const money = (n) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;
const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};

/** Текст сводки или null — сообщать нечего */
const buildDigest = (sales, today) => {
  let dueCount = 0, dueSum = 0, overdueCount = 0, overdueSum = 0;
  for (const s of sales) {
    if (s.status !== 'ACTIVE' || String(s.customerId || '').startsWith('system_')) continue;
    for (const p of s.paymentPlan || []) {
      if (p.isRealPayment === true || p.isPaid || !p.date) continue;
      if (mskDay(new Date(p.date)) === today) { dueCount++; dueSum += Number(p.amount) || 0; }
    }
    const o = domain.overdueAmount(s);
    if (o > 0) { overdueCount++; overdueSum += o; }
  }
  if (!dueCount && !overdueCount) return null;
  const parts = [];
  parts.push(dueCount
    ? `Сегодня ждём ${dueCount} ${plural(dueCount, 'платёж', 'платежа', 'платежей')} на ${money(dueSum)}.`
    : 'Сегодня платежей по графику нет.');
  if (overdueCount) parts.push(`В просрочке ${overdueCount} ${plural(overdueCount, 'договор', 'договора', 'договоров')} на ${money(overdueSum)} — спросите FinUchetGPT «кто просрочил» или «напомни всем».`);
  return parts.join(' ');
};

module.exports = ({ pool, createNotification, aiTrialRequests, aiPlans }) => {
  // force — без проверки часа (проверка вручную)
  const tick = async (force = false) => {
    if (!force && mskHour() !== HOUR_MSK) return;
    const today = mskDay();
    const { rows } = await pool.query(
      `SELECT id, role, ai_subscription, ai_trial_used, ai_settings FROM users
        WHERE (ai_settings->>'morningDigest') = 'true' AND role IN ('manager', 'admin')
          AND coalesce(ai_settings->>'digestSentOn', '') <> $1`, [today]);
    for (const u of rows) {
      try {
        const sub = u.ai_subscription && new Date(u.ai_subscription.expiresAt) > new Date() && aiPlans[u.ai_subscription.plan];
        const trialLeft = (u.ai_trial_used || 0) < aiTrialRequests;
        if (u.role !== 'admin' && !sub && !trialLeft) continue;
        // Отметка до отправки: при сбое лучше пропустить день, чем прислать дважды
        await pool.query(`UPDATE users SET ai_settings = coalesce(ai_settings, '{}'::jsonb) || jsonb_build_object('digestSentOn', $1::text) WHERE id = $2`, [today, u.id]);
        const sales = (await pool.query(`SELECT data FROM data_items WHERE user_id = $1 AND type = 'sales'`, [u.id])).rows.map(r => r.data);
        const text = buildDigest(sales, today);
        if (text) {
          // Та же сводка — первым сообщением в чате агента, когда его откроют сегодня
          await pool.query(`UPDATE users SET ai_settings = ai_settings || jsonb_build_object('digest', jsonb_build_object('date', $1::text, 'text', $2::text)) WHERE id = $3`, [today, text, u.id]);
          await createNotification(u.id, 'AI_DIGEST', 'FinUchetGPT: план на сегодня', text);
        }
      } catch (e) {
        console.error('AI digest error:', u.id, e.message);
      }
    }
  };
  return {
    buildDigest,
    tick,
    start() {
      // Каждые 10 минут: час проверяем по Москве, повтор в тот же день отсекает digestSentOn
      setInterval(() => tick().catch(e => console.error('AI digest tick:', e.message)), 10 * 60 * 1000);
      tick().catch(e => console.error('AI digest tick:', e.message));
    },
  };
};
