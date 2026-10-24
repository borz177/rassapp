// Подсказки FinUchetGPT: раз в день агент сам предлагает, что сделать, — с
// кнопками. Нажатие отправляет агенту обычную просьбу («Напиши Петрову письмо о
// долге за iPhone»), дальше всё как всегда: карточка, «Подтвердить».
//
// Включается в настройках агента (users.ai_settings.proactiveTips). Считается по
// базе, без модели: бесплатно, цифры те же, что в приложении. Время — как у
// утренней сводки (digestHour, digestWeekdays). Включена и сводка — уведомление
// одно (сводкой), подсказки ждут в чате следующим сообщением.

const { collectionQueue, forecast, mskDay } = require('./collections');
const { isDigestTime } = require('./digest');

const money = (n) => `${Math.round(Number(n) || 0).toLocaleString('ru-RU')} ₽`;
const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
// Фамилия и имя — для кнопки: полное ФИО не помещается
const shortName = (name) => String(name || 'Клиент').trim().split(/\s+/).slice(0, 2).join(' ');
const MAX_TIPS = 4;

/**
 * Подсказки на сегодня: [{ text, label }] — строка в сообщении и кнопка.
 * По важности: сорванные обещания, давние долги, просрочка в целом, прогноз
 * недели, заканчивающийся товар.
 */
const buildTips = ({ sales, customers = [], investors = [], promises = [], products = [], shop = false, today = mskDay() }) => {
  const tips = [];
  const q = collectionQueue({ sales, customers, investors, promises, today, limit: 1000 });
  const reachable = q.items.filter(x => !x.remindersMuted);

  // 1. Обещали и не заплатили — первым: человек ждёт звонка или письма
  for (const x of reachable.filter(i => i.promise?.status === 'broken').slice(0, 2)) {
    tips.push({
      text: `${shortName(x.customer)} не сдержал обещание заплатить ${money(x.promise.amount)} до ${x.promise.date.split('-').reverse().join('.')} (${x.product}).`,
      label: `Напиши письмо о долге: ${shortName(x.customer)}, ${x.product}`,
    });
  }
  // 2. Больше 30 дней — пора официальное письмо
  const old = reachable.filter(x => x.stage === 'final' && x.promise?.status !== 'broken' && x.promise?.status !== 'pending').sort((a, b) => b.overdue - a.overdue)[0];
  if (old) {
    tips.push({
      text: `${shortName(old.customer)} не платит ${old.daysOverdue} ${plural(old.daysOverdue, 'день', 'дня', 'дней')}, долг ${money(old.overdue)} (${old.product}) — пора официальное письмо.`,
      label: `Напиши официальное письмо о долге: ${shortName(old.customer)}, ${old.product}`,
    });
  }
  // 3. Просрочка от 5 дней без обещания — разобрать очередь
  const stale = q.items.filter(x => x.daysOverdue >= 5 && x.promise?.status !== 'pending');
  if (stale.length >= 2) {
    const people = new Set(stale.map(x => x.customer)).size;
    tips.push({
      text: `${people} ${plural(people, 'клиент не платит', 'клиента не платят', 'клиентов не платят')} больше 5 дней — всего ${money(stale.reduce((n, x) => n + x.overdue, 0))}.`,
      label: 'Кому звонить по долгам?',
    });
  }
  // 4. Неделя: по графику заметно больше, чем придёт по опыту оплат
  const f = forecast({ sales, customers, investors, today, days: 7 });
  if (f.scheduled.total >= 10000 && f.realistic < f.scheduled.total * 0.75) {
    tips.push({
      text: `На неделе по графику ждём ${money(f.scheduled.total)}, по опыту оплат придёт около ${money(f.realistic)}.`,
      label: 'Сколько придёт на неделе?',
    });
  }
  // 5. Склад: остаток дошёл до порога «мало на складе» (только с магазином)
  if (shop) {
    const low = products.filter(p => !p.isArchived && Number(p.minStock) > 0 && (Number(p.stock) || 0) <= Number(p.minStock))
      .sort((a, b) => (Number(a.stock) || 0) - (Number(b.stock) || 0));
    if (low.length) {
      tips.push({
        text: `Заканчивается на складе: ${low.slice(0, 3).map(p => `${p.name} — ${Number(p.stock) || 0} ${p.unit || 'шт'}`).join(', ')}${low.length > 3 ? ` и ещё ${low.length - 3}` : ''}.`,
        label: `Оформи приход: ${low[0].name}`,
      });
    }
  }
  return tips.slice(0, MAX_TIPS);
};

const tipsText = (tips) => tips.map(t => `• ${t.text}`).join('\n');

module.exports = ({ pool, createNotification, aiTrialRequests, aiPlans, checkFeatureAccess }) => {
  const load = (userId, type) => pool.query(`SELECT data FROM data_items WHERE user_id = $1 AND type = $2`, [userId, type]).then(r => r.rows.map(x => x.data));
  const tipsFor = async (userId, today = mskDay()) => {
    const [sales, customers, investors, products] = await Promise.all(['sales', 'customers', 'investors', 'products'].map(t => load(userId, t)));
    let promises = [];
    try {
      promises = (await pool.query(`SELECT id, sale_id, amount::float AS amount, due_date, status, created_at FROM ai_payment_promises
        WHERE user_id = $1 AND created_at > NOW() - INTERVAL '120 days'`, [userId])).rows;
    } catch { /* обещаний ещё не записывали — таблицы нет */ }
    const shop = checkFeatureAccess ? !!(await checkFeatureAccess(userId, 'shop').catch(() => null))?.allowed : false;
    return buildTips({ sales, customers, investors, promises, products, shop, today });
  };

  // force — без проверки часа (проверка вручную)
  const tick = async (force = false) => {
    const today = mskDay();
    const { rows } = await pool.query(
      `SELECT id, role, ai_subscription, ai_trial_used, ai_settings FROM users
        WHERE (ai_settings->>'proactiveTips') = 'true' AND role IN ('manager', 'admin')
          AND coalesce(ai_settings->>'proactiveSentOn', '') <> $1`, [today]);
    for (const u of rows) {
      try {
        if (!force && !isDigestTime(u.ai_settings)) continue;
        const sub = u.ai_subscription && new Date(u.ai_subscription.expiresAt) > new Date() && aiPlans[u.ai_subscription.plan];
        const trialLeft = (u.ai_trial_used || 0) < aiTrialRequests;
        if (u.role !== 'admin' && !sub && !trialLeft) continue;
        // Отметка до отправки: при сбое лучше пропустить день, чем прислать дважды
        await pool.query(`UPDATE users SET ai_settings = coalesce(ai_settings, '{}'::jsonb) || jsonb_build_object('proactiveSentOn', $1::text) WHERE id = $2`, [today, u.id]);
        const tips = await tipsFor(u.id, today);
        if (!tips.length) continue;
        const text = tipsText(tips);
        await pool.query(`UPDATE users SET ai_settings = ai_settings || jsonb_build_object('proactive', jsonb_build_object('date', $1::text, 'text', $2::text, 'options', $3::jsonb)) WHERE id = $4`,
          [today, text, JSON.stringify(tips.map(t => ({ label: t.label }))), u.id]);
        // Сводка включена — уведомление уже пришло ею (или придёт), второе не шлём
        if (u.ai_settings?.morningDigest !== true) {
          await createNotification(u.id, 'AI_DIGEST', 'FinUchetGPT: что сделать сегодня', text, { url: '/app?open=ai' });
        }
      } catch (e) {
        console.error('AI tips error:', u.id, e.message);
      }
    }
  };
  return {
    tick, tipsFor,
    start() {
      // Каждые 10 минут, как сводка: час у каждого свой, повтор в тот же день отсекает proactiveSentOn
      setInterval(() => tick().catch(e => console.error('AI tips tick:', e.message)), 10 * 60 * 1000);
      tick().catch(e => console.error('AI tips tick:', e.message));
    },
  };
};

module.exports.buildTips = buildTips;
module.exports.tipsText = tipsText;
