/**
 * Письма о конце подписки: за 3 дня, за сутки и когда она закончилась.
 *
 * Зачем письмом. В iOS-приложении нельзя ни продавать подписку мимо покупок Apple,
 * ни звать оплатить на сайте (App Store, правила 3.1.1 и 3.1.3(f)) — там человек
 * видит только «подписка истекла». Писать клиентам о способах оплаты вне
 * приложения Apple разрешает, поэтому ссылка на оплату приходит на почту. Заодно
 * напоминание получают и те, кто работает в вебе и на Android.
 *
 * Каждое письмо уходит один раз на конкретный срок подписки: отметка хранится по
 * паре (пользователь, expiresAt). Продлил — срок новый, и к следующему окончанию
 * напоминания придут снова.
 *
 * Зависимости приходят параметрами, как в backup.js.
 */

const PLAN_TITLES = {
  TRIAL: 'Пробный',
  START: 'Старт',
  STANDARD: 'Стандарт',
  BUSINESS: 'Бизнес',
  BUSINESS_PRO: 'Бизнес Pro',
};

const HOUR = 60 * 60 * 1000;

// Какое письмо положено по оставшемуся времени. Окна не пересекаются, и каждое
// длиннее шага планировщика (час), поэтому ни одно не проскочит между проходами.
// Об истёкшей пишем только в первые двое суток: после первого запуска не должно
// уйти письмо всем, у кого подписка кончилась давно.
const reminderKind = (msLeft) => {
  if (msLeft > 72 * HOUR) return null;
  if (msLeft > 24 * HOUR) return 'D3';
  if (msLeft > 0) return 'D1';
  if (msLeft > -48 * HOUR) return 'EXPIRED';
  return null;
};

// Ночью не пишем: письмо в три часа ночи выглядит как спам и тонет к утру.
// Окна в сутки и больше, так что ожидание до утра ничего не пропускает.
const isDaytimeMoscow = (date = new Date()) => {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false,
  }).format(date));
  return hour >= 9 && hour < 21;
};

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const formatMoscow = (date) => date.toLocaleString('ru-RU', {
  timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
});

const buildEmail = ({ kind, name, plan, expiresAt, payUrl }) => {
  const trial = plan === 'TRIAL';
  const what = trial ? 'Пробный период' : `Подписка «${PLAN_TITLES[plan] || plan}»`;
  const when = formatMoscow(expiresAt);

  const subject = {
    D3: `${what} в FinUchet заканчивается ${when}`,
    D1: `${what} в FinUchet заканчивается менее чем через сутки`,
    EXPIRED: `${what} в FinUchet закончил${trial ? 'ся' : 'ась'}`,
  }[kind];

  const lead = kind === 'EXPIRED'
    ? `${what} закончил${trial ? 'ся' : 'ась'} ${when}. Учёт остановлен: нельзя оформлять договоры, проводить платежи и вносить изменения. Все данные сохранены — после оплаты работа продолжится с того же места.`
    : `${what} действует до ${when}. После этого нельзя будет оформлять договоры и проводить платежи — данные при этом сохранятся.`;

  const button = kind === 'EXPIRED' ? 'Возобновить подписку' : 'Продлить подписку';
  const hello = name ? `${escapeHtml(name)}, здравствуйте!` : 'Здравствуйте!';

  const text = `${name ? `${name}, з` : 'З'}дравствуйте!\n\n${lead}\n\n${button}: ${payUrl}\n\nОплата проходит на сайте; в приложениях на iPhone, Android и в браузере подписка включится автоматически.\n\nFinUchet — rassrochka.pro`;

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
  <div style="background:${kind === 'EXPIRED' ? 'linear-gradient(135deg,#e11d48,#f43f5e)' : 'linear-gradient(135deg,#4f46e5,#6366f1)'};padding:24px">
    <p style="margin:0;color:#ffffff;opacity:.85;font-size:13px;letter-spacing:.08em;text-transform:uppercase;font-weight:700">FinUchet</p>
    <p style="margin:6px 0 0;color:#ffffff;font-size:22px;font-weight:800;line-height:1.3">${escapeHtml(subject.replace(' в FinUchet', ''))}</p>
  </div>
  <div style="padding:24px">
    <p style="margin:0 0 12px;color:#0f172a;font-size:15px">${hello}</p>
    <p style="margin:0;color:#334155;font-size:15px;line-height:1.55">${escapeHtml(lead)}</p>
    <a href="${payUrl}"
       style="display:block;margin-top:22px;padding:14px;background:#4f46e5;color:#ffffff;text-align:center;text-decoration:none;border-radius:12px;font-weight:700;font-size:15px">
      ${button}
    </a>
    <p style="margin:16px 0 0;color:#64748b;font-size:13px;line-height:1.5">
      Оплата проходит на сайте. В приложениях на iPhone, Android и в браузере подписка включится автоматически.
    </p>
  </div>
  <div style="background:#f8fafc;padding:16px 24px;text-align:center;border-top:1px solid #e2e8f0">
    <p style="margin:0;color:#94a3b8;font-size:13px">
      &copy; ${new Date().getFullYear()} FinUchet &bull;
      <a href="https://rassrochka.pro" style="color:#4f46e5;text-decoration:none">rassrochka.pro</a>
    </p>
  </div>
</div>`;

  return { subject, text, html };
};

module.exports = ({ pool, sendEmail }) => {
  // Ссылка открывает сразу экран тарифов (App.tsx, ?open=tariffs), после входа — тоже
  const payUrl = `${process.env.APP_PUBLIC_URL || 'https://rassrochka.pro'}/app?open=tariffs`;

  const ensureTable = () => pool.query(`
    CREATE TABLE IF NOT EXISTS subscription_reminders (
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      kind TEXT NOT NULL,
      sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, expires_at, kind)
    );
  `);

  let running = false;
  const tick = async () => {
    if (running || !isDaytimeMoscow()) return;
    running = true;
    try {
      // Только владельцы аккаунтов: сотрудники и инвесторы работают по подписке
      // менеджера и оплатить её не могут. Срок разбираем только у строк, похожих
      // на дату, — одна испорченная запись не должна ронять весь запрос.
      const { rows } = await pool.query(`
        SELECT id, name, email, subscription
          FROM users
         WHERE role = 'manager'
           AND COALESCE(blocked, FALSE) = FALSE
           AND email IS NOT NULL
           AND subscription->>'expiresAt' ~ '^\\d{4}-\\d{2}-\\d{2}'
           AND (CASE WHEN subscription->>'expiresAt' ~ '^\\d{4}-\\d{2}-\\d{2}'
                     THEN (subscription->>'expiresAt')::timestamptz END)
               BETWEEN NOW() - INTERVAL '48 hours' AND NOW() + INTERVAL '72 hours'
      `);

      for (const u of rows) {
        const expiresRaw = u.subscription.expiresAt;
        const expiresAt = new Date(expiresRaw);
        if (isNaN(expiresAt)) continue;
        const kind = reminderKind(expiresAt.getTime() - Date.now());
        if (!kind) continue;

        // Сначала отметка, потом письмо: два прохода подряд не отправят его дважды
        const mark = await pool.query(
          `INSERT INTO subscription_reminders (user_id, expires_at, kind)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1`,
          [u.id, expiresRaw, kind]
        );
        if (mark.rowCount === 0) continue;

        const { subject, text, html } = buildEmail({
          kind, name: u.name, plan: u.subscription.plan, expiresAt, payUrl,
        });
        const ok = await sendEmail(u.email, subject, text, html);
        if (ok) {
          console.log(`📧 Напоминание о подписке (${kind}) → ${u.id}`);
        } else {
          // Не ушло — снимаем отметку, попробуем на следующем проходе
          await pool.query(
            'DELETE FROM subscription_reminders WHERE user_id = $1 AND expires_at = $2 AND kind = $3',
            [u.id, expiresRaw, kind]
          );
        }
      }
    } catch (e) {
      console.error('❌ Subscription reminders error:', e.message);
    } finally {
      running = false;
    }
  };

  const start = async () => {
    try {
      await ensureTable();
    } catch (e) {
      console.error('❌ subscription_reminders table:', e.message);
      return;
    }
    setInterval(tick, HOUR);
    setTimeout(tick, 2 * 60 * 1000); // после перезапуска — не дожидаясь часа
  };

  return { start, tick, buildEmail, reminderKind };
};
