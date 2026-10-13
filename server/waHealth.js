// Присмотр за встроенным WhatsApp — раз в 5 минут из основного процесса.
//
// Раньше о сбое узнавали только из админ-панели или от клиентов («напоминание
// не пришло»), а номер, не поднявшийся после перезапуска сервиса, так и висел
// отключённым до ручного «Подключить снова». Теперь:
//   • сервис не отвечает две проверки подряд — уведомление администраторам,
//     и ещё одно, когда заработает;
//   • номер не на связи, но был привязан — сначала сами подключаем заново
//     (после сбоя сервиса это обычно помогает), и только если не вышло —
//     предупреждаем владельца, не чаще раза в сутки;
//   • отвалилось сразу несколько номеров — это уже не телефон пользователя,
//     а сервис или WhatsApp: уведомление администраторам.
const { waField } = require('./waTransport');

const CHECK_MS = 5 * 60 * 1000;
const SERVICE_FAILS_TO_ALERT = 2;
const OWNER_NOTIFY_EVERY_MS = 20 * 60 * 60 * 1000;
const RETRY_LOST_EVERY_MS = 60 * 60 * 1000;
const MASS_LOSS = 3;

function startWaHealth({ pool, waTransport, notifyUser, notifyAdmins }) {
  if (!waTransport.builtinAvailable()) return;

  let serviceFails = 0;
  let serviceAlerted = false;
  let running = false;

  const setState = (userId, state) =>
    pool.query(
      `UPDATE wa_builtin SET health_state = $2,
         health_since = CASE WHEN health_state IS DISTINCT FROM $2 THEN NOW() ELSE health_since END
       WHERE user_id = $1`,
      [userId, state]
    );

  const check = async () => {
    let sessions;
    try {
      sessions = await waTransport.builtin.sessions();
      if (!Array.isArray(sessions)) throw new Error('неожиданный ответ сервиса');
    } catch (e) {
      serviceFails += 1;
      console.warn(`⚠️ WA health: сервис не отвечает (${serviceFails}): ${e.message}`);
      if (serviceFails >= SERVICE_FAILS_TO_ALERT && !serviceAlerted) {
        serviceAlerted = true;
        await notifyAdmins('WhatsApp-сервис не отвечает',
          'Встроенный WhatsApp не отправляет сообщения. Проверьте сервер wa.rassrochka.pro.');
      }
      return;
    }
    serviceFails = 0;
    if (serviceAlerted) {
      serviceAlerted = false;
      await notifyAdmins('WhatsApp-сервис снова работает', 'Встроенный WhatsApp отвечает, проверка номеров продолжается.');
    }

    const byId = new Map(sessions.map(s => [String(waField(s, 'id')), s]));
    const { rows } = await pool.query(`
      SELECT b.user_id, b.wuz_id, b.health_state, b.health_since, b.health_notified_at
      FROM wa_builtin b JOIN users u ON u.id = b.user_id
      WHERE u.whatsapp_settings->>'provider' = 'builtin'
        AND u.whatsapp_settings->>'enabled' = 'true'`);

    const newlyLost = [];
    for (const row of rows) {
      try {
        const s = byId.get(String(row.wuz_id));
        if (s && waField(s, 'loggedIn')) {
          if (row.health_state !== 'ok') await setState(row.user_id, 'ok');
          continue;
        }
        // Номер ещё не привязывали (окно подключения не довели) — не наше дело
        if (!s || !waField(s, 'jid')) continue;

        const since = row.health_since ? new Date(row.health_since).getTime() : 0;
        const tryReconnect = async () => {
          const session = await waTransport.getBuiltin(row.user_id);
          try { await waTransport.builtin.connect(session.token); } catch { /* 409 — уже подключается */ }
        };

        if (row.health_state === 'ok' || !row.health_state) {
          // Первый раз видим отключённым — пробуем подключить сами
          await tryReconnect();
          await setState(row.user_id, 'reconnecting');
          console.log(`🔄 WA health: переподключаем ${row.user_id}`);
        } else if (row.health_state === 'reconnecting') {
          // Сами не смогли — номер, скорее всего, отвязали на телефоне
          await setState(row.user_id, 'lost');
          newlyLost.push(row.user_id);
          const notified = row.health_notified_at ? new Date(row.health_notified_at).getTime() : 0;
          if (Date.now() - notified > OWNER_NOTIFY_EVERY_MS) {
            await notifyUser(row.user_id);
            await pool.query('UPDATE wa_builtin SET health_notified_at = NOW() WHERE user_id = $1', [row.user_id]);
          }
        } else if (row.health_state === 'lost' && Date.now() - since > RETRY_LOST_EVERY_MS) {
          // Раз в час ещё попытка — вдруг был сбой у самого WhatsApp
          await tryReconnect();
          await pool.query('UPDATE wa_builtin SET health_since = NOW() WHERE user_id = $1', [row.user_id]);
        }
      } catch (e) {
        console.warn(`⚠️ WA health ${row.user_id}: ${e.message}`);
      }
    }

    if (newlyLost.length >= MASS_LOSS) {
      await notifyAdmins(`Отключились сразу ${newlyLost.length} номеров WhatsApp`,
        'Похоже на сбой сервиса или блокировку со стороны WhatsApp. Подробности — Админ-панель → WhatsApp.');
    }
  };

  const tick = async () => {
    if (running) return;
    running = true;
    try { await check(); } catch (e) { console.error('❌ WA health:', e.message); }
    finally { running = false; }
  };

  setTimeout(tick, 60 * 1000);
  setInterval(tick, CHECK_MS);
}

module.exports = { startWaHealth };
