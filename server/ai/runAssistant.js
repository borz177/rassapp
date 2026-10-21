// Единый вызов агента и учёт лимитов для приложения и Алисы.
const createAssistantRunner = ({ pool, assistant, state, subscriptionState, month }) => async ({
  userId, text = '', history = [], image = null, audio = null, mode = 'confirm',
  signal, onStep, onStream, silent = false, channel = 'app', allowWrites = true, verifiedState,
}) => {
  const st = verifiedState || await state(userId);
  const reject = (status, message, code) => { throw Object.assign(new Error(message), { status, code }); };
  if (!st?.allowedRole) reject(403, 'Агент доступен владельцу аккаунта.');
  if (!st.consent) reject(403, 'Откройте агента в FinUchet и подтвердите согласие на обработку данных.', 'AI_CONSENT_REQUIRED');
  if (st.left <= 0) reject(402, 'Запросы к агенту закончились. Откройте тарифы ИИ в FinUchet.', 'AI_LIMIT');
  const me = (await pool.query('SELECT id, name, role, blocked FROM users WHERE id = $1', [userId])).rows[0];
  if (!me || me.blocked) reject(403, 'Аккаунт недоступен.');
  const settings = (await pool.query("SELECT data FROM data_items WHERE user_id = $1 AND type = 'settings' LIMIT 1", [userId])).rows[0]?.data;
  const alice = channel === 'alice';
  const out = await assistant.reply({
    user: me, text: String(text).slice(0, 4000), history: Array.isArray(history) ? history : [],
    image: alice ? null : image, audio: alice ? null : audio,
    mode: alice ? 'confirm' : mode === 'auto' ? 'auto' : 'confirm',
    channel, autoLimit: st.settings.autoLimit, companyName: settings?.companyName || '',
    readOnly: !allowWrites || (me.role !== 'admin' && !!(await subscriptionState(userId)).expired),
    signal, onStep, onStream, silent,
  });
  const counted = !out.cancelled || (out.usage?.completion || 0) > 0;
  await pool.query(
    `INSERT INTO ai_assistant_usage (user_id, month, requests, prompt_tokens, completion_tokens, cost_usd, cached_tokens)
     VALUES ($1, $2, $6, $3, $4, $5, $7)
     ON CONFLICT (user_id, month) DO UPDATE SET requests = ai_assistant_usage.requests + EXCLUDED.requests,
       prompt_tokens = ai_assistant_usage.prompt_tokens + EXCLUDED.prompt_tokens,
       cached_tokens = ai_assistant_usage.cached_tokens + EXCLUDED.cached_tokens,
       completion_tokens = ai_assistant_usage.completion_tokens + EXCLUDED.completion_tokens,
       cost_usd = ai_assistant_usage.cost_usd + EXCLUDED.cost_usd`,
    [userId, month(), out.usage?.prompt || 0, out.usage?.completion || 0, out.usage?.cost || 0, counted ? 1 : 0, out.usage?.cached || 0]);
  if (st.trial && counted) await pool.query('UPDATE users SET ai_trial_used = ai_trial_used + 1 WHERE id = $1', [userId]);
  return {
    reply: out.reply, actions: (out.actions || []).map(a => alice ? { ...a, auto: false } : a),
    cancelled: !!out.cancelled, left: Math.max(0, st.left - (counted ? 1 : 0)),
    ...(typeof out.heard === 'string' ? { heard: out.heard } : {}),
  };
};
module.exports = { createAssistantRunner };
