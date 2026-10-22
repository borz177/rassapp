const { createReconciliation } = require('./reconciliation');
const findings = report => ({
  negative: report.accounts.filter(a => a.balance < 0),
  orphan: report.orphanContracts.length, mismatches: report.mismatches.length, duplicates: report.duplicatePayments.length,
});
const alertText = f => [
  f.negative.length && `Отрицательный остаток: ${f.negative.map(a => `${a.name} — ${a.balance.toLocaleString('ru-RU')} ₽`).join('; ')}.`,
  f.orphan && `Договоров с отсутствующим счётом: ${f.orphan}.`,
  f.mismatches && `Несовпадений счёта договора и закупа: ${f.mismatches}.`,
  f.duplicates && `Возможных повторов платежей: ${f.duplicates}; требуется проверка.`,
].filter(Boolean).join(' ');
const createMonitor = ({ pool, createNotification, allowed }) => {
  const reconciliation = createReconciliation(pool);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await pool.query('CREATE TABLE IF NOT EXISTS ai_monitor_deliveries(user_id TEXT,day DATE,created_at TIMESTAMPTZ DEFAULT NOW(),PRIMARY KEY(user_id,day))');
      const users = (await pool.query("SELECT id,role FROM users WHERE NOT COALESCE(blocked,false) AND ai_consent_at IS NOT NULL AND ai_settings->>'anomalyAlerts'='true'")).rows;
      const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
      for (const u of users) {
        if (!allowed(u.role)) continue;
        const text = alertText(findings(await reconciliation.read(u.id)));
        if (!text) continue;
        const claim = await pool.query('INSERT INTO ai_monitor_deliveries(user_id,day) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING user_id', [u.id,day]);
        if (!claim.rowCount) continue;
        // Не повторяем отправку после неизвестного результата провайдера.
        await createNotification(u.id,'AI_AUDIT','FinUchetGPT: нужна проверка учёта',text,{ url: '/app?open=ai' });
      }
      await pool.query("DELETE FROM ai_monitor_deliveries WHERE day < CURRENT_DATE - 90");
    } finally { running = false; }
  };
  return { tick, start() { const timer = setInterval(() => tick().catch(e => console.error('AI monitor:', e.code || e.name)), 30 * 60000); timer.unref(); return () => clearInterval(timer); } };
};
module.exports = { createMonitor, findings, alertText };
