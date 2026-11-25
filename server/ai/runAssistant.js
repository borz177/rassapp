// Единый вызов агента и учёт лимитов для приложения и Алисы.
const { localAuditIntent, auditExplanation } = require('./auditQuestions');
const { watchlistIntent } = require('./watchlistIntent');
const { poolQuestionIntent, answerPoolQuestion } = require('./poolQuestions');
const createAssistantRunner = ({ pool, assistant, state, subscriptionState, month, conversations = null, audits = null }) => {
const execute = async ({
  userId, text = '', history = [], image = null, images = null, audio = null, mode = 'confirm',
  signal, onStep, onStream, auditReportId = null, silent = false, channel = 'app', allowWrites = true, verifiedState,
}) => {
  const st = verifiedState || await state(userId);
  const local = audits && localAuditIntent({ text, image, images, audio, channel, auditReportId });
  const watchlist = watchlistIntent({ text, image, images, audio, channel, auditReportId });
  const poolQuestion = poolQuestionIntent({ text, image, images, audio, channel, auditReportId });
  const reject = (status, message, code) => { throw Object.assign(new Error(message), { status, code }); };
  if (!st?.allowedRole) reject(403, 'Агент доступен владельцу аккаунта.');
  if (!st.consent) reject(403, 'Откройте агента в FinUchet и подтвердите согласие на обработку данных.', 'AI_CONSENT_REQUIRED');
  if (!local && !watchlist && !poolQuestion && st.left <= 0) reject(402, 'Запросы к агенту закончились. Откройте тарифы ИИ в FinUchet.', 'AI_LIMIT');
  const me = (await pool.query('SELECT id, name, role, blocked FROM users WHERE id = $1', [userId])).rows[0];
  if (!me || me.blocked) reject(403, 'Аккаунт недоступен.');
  if (poolQuestion) {
    onStep?.('Сверяю расчёт общего пула…');
    const reply = await answerPoolQuestion(pool, userId, poolQuestion);
    return { reply, actions: [], left: Math.max(0, st.left), modelUsed: false };
  }
  if (local) {
    const response = (reply, actions = []) => ({ reply, actions, left: Math.max(0, st.left), modelUsed: false });
    onStep?.('Проверяю записи учёта…');
    if (local.kind === 'summary') {
      const report = await audits.get(userId, auditReportId);
      if (report.stale) reject(409, 'Учёт изменился. Обновите проверку перед объяснением.', 'AUDIT_STALE');
      return response(auditExplanation(report, 'summary'));
    }
    let accountIds = null;
    if (local.account) {
      const accounts = (await pool.query("SELECT id,data->>'name' AS name FROM data_items WHERE user_id=$1 AND type='accounts' AND data->>'isArchived' IS DISTINCT FROM 'true'", [userId])).rows;
      const norm = value => String(value || '').trim().toLowerCase().replace(/ё/g, 'е');
      const exact = accounts.filter(a => norm(a.name) === norm(local.account));
      const matches = exact.length ? exact : accounts.filter(a => norm(a.name).includes(norm(local.account)));
      if (matches.length === 0) return response('Счёт для сверки не найден. Уточните его название.');
      if (matches.length > 1) return response('Подходит несколько счетов. Напишите полное название счёта для сверки.');
      accountIds = [matches[0].id];
    }
    const report = await audits.create(userId, accountIds);
    const reply = local.kind === 'scan' ? `${report.summary} Подробности и исходные записи — в карточке.` : auditExplanation(report, local.kind);
    return response(reply, [{ id: `audit_${report.id}`, kind: 'accounting_audit', title: 'Проверка учёта', report: audits.compact(report) }]);
  }
  if (watchlist) {
    const out = await assistant.prepareWatchlist({ userId, intent: watchlist, readOnly: !allowWrites, signal });
    const { usage, ...response } = out;
    return { ...response, left: Math.max(0, st.left), modelUsed: false, watchlistRequest: true };
  }
  const settings = (await pool.query("SELECT data FROM data_items WHERE user_id = $1 AND type = 'settings' LIMIT 1", [userId])).rows[0]?.data;
  let auditContext = null;
  if (auditReportId) {
    const {accounts, ...report} = await require('./accountingAudit').createAccountingAudits(pool).page(userId,auditReportId,{limit:10});
    auditContext = report;
    if(auditContext.stale) reject(409,'Учёт изменился. Обновите проверку перед объяснением.','AUDIT_STALE');
  }
  const alice = channel === 'alice';
  const out = await assistant.reply({
    user: me, text: String(text).slice(0, 4000), history: !auditContext && Array.isArray(history) ? history : [],
    image: alice || auditContext ? null : image, images: alice || auditContext ? null : images, audio: alice || auditContext ? null : audio,
    mode: alice ? 'confirm' : mode === 'auto' ? 'auto' : 'confirm',
    channel, preferences: st.settings.preferences || '', autoLimit: st.settings.autoLimit, companyName: settings?.companyName || '',
    analysisOnly: !!auditContext, auditContext,
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
    ...(out.watchlistRequest ? { watchlistRequest: true } : {}),
  };
};
return async args => {
  // Повтор запроса возвращает сохранённый ответ, но не обходит отзыв доступа.
  if (conversations) {
    const current = await state(args.userId);
    const me = (await pool.query('SELECT id, name, role, blocked FROM users WHERE id = $1', [args.userId])).rows[0];
    if (!current?.allowedRole || !current.consent || !me || me.blocked) {
      throw Object.assign(new Error('Доступ к агенту отсутствует. Проверьте аккаунт и согласие на обработку данных.'), { status: 403 });
    }
    return conversations.run({ ...args, verifiedState: current }, execute);
  }
  return execute(args);
};
};
module.exports = { createAssistantRunner };
