// Суточный лимит распознавания образцов: один счётчик на владельца и для
// экрана «Мои шаблоны», и для агента — иначе агент обходил бы лимит.
const { dailyLimit, UNLIMITED } = require("./model");

const createUsage = (pool) => {
  const ready = pool.query(`CREATE TABLE IF NOT EXISTS contract_template_import_usage (
    user_id TEXT NOT NULL, day DATE NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id,day))`);
  ready.catch(() => {});
  /** Занимает попытку: { ok, attempts } — ok=false, если лимит за сегодня исчерпан */
  const take = async (userId) => {
    await ready;
    const r = await pool.query(
      `INSERT INTO contract_template_import_usage(user_id,day,attempts)
      VALUES($1,(now() AT TIME ZONE 'Europe/Moscow')::date,1)
      ON CONFLICT(user_id,day) DO UPDATE SET attempts=contract_template_import_usage.attempts+1
      WHERE contract_template_import_usage.attempts < $2 RETURNING attempts`,
      [userId, dailyLimit() || UNLIMITED],
    );
    return { ok: r.rows.length > 0, attempts: r.rows[0]?.attempts };
  };
  return { ready, take };
};

module.exports = { createUsage };
