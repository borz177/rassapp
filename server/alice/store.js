const crypto = require('crypto');

const ensureTables = pool => pool.query(`
  CREATE TABLE IF NOT EXISTS alice_jobs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, connection_id TEXT NOT NULL,
    session_key TEXT NOT NULL, message_id BIGINT NOT NULL, question TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
    result JSONB, error_text TEXT, acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, session_key, message_id)
  );
  CREATE INDEX IF NOT EXISTS idx_alice_jobs_user ON alice_jobs(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_alice_jobs_queue ON alice_jobs(created_at) WHERE status='queued';
`);

const createStore = pool => ({
  latest: async (userId, key) => (await pool.query(
    `SELECT * FROM alice_jobs WHERE user_id=$1 AND session_key=$2
     AND created_at > NOW() - INTERVAL '24 hours' ORDER BY created_at DESC LIMIT 1`, [userId, key])).rows[0],
  enqueue: async ({ userId, connectionId, key, messageId, question }) => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      // Одна задача на владельца: повторные запросы и несколько колонок не тратят лимит параллельно.
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`alice:${userId}`]);
      const same = (await c.query('SELECT * FROM alice_jobs WHERE user_id=$1 AND session_key=$2 AND message_id=$3', [userId, key, messageId])).rows[0];
      if (same) { await c.query('COMMIT'); return { job: same, duplicate: true }; }
      const active = (await c.query("SELECT id FROM alice_jobs WHERE user_id=$1 AND status IN ('queued','running') LIMIT 1", [userId])).rows[0];
      if (active) { await c.query('COMMIT'); return { busy: true }; }
      const used = (await c.query("SELECT count(*)::int AS n FROM alice_jobs WHERE user_id=$1 AND created_at > NOW() - INTERVAL '1 minute'", [userId])).rows[0].n;
      if (used >= 10) { await c.query('COMMIT'); return { limited: true }; }
      const job = (await c.query(`INSERT INTO alice_jobs (id,user_id,connection_id,session_key,message_id,question)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [crypto.randomUUID(), userId, connectionId, key, messageId, question])).rows[0];
      await c.query('COMMIT');
      return { job };
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  },
  claim: async () => (await pool.query(`UPDATE alice_jobs SET status='running', updated_at=NOW()
    WHERE id=(SELECT id FROM alice_jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING *`)).rows[0],
  history: async (job) => (await pool.query(`SELECT question,result FROM alice_jobs
    WHERE user_id=$1 AND session_key=$2 AND status='done' AND created_at < $3
    ORDER BY created_at DESC LIMIT 6`, [job.user_id, job.session_key, job.created_at])).rows.reverse(),
  finish: (id, result) => pool.query("UPDATE alice_jobs SET status='done',result=$2,updated_at=NOW() WHERE id=$1 AND status='running'", [id, JSON.stringify(result)]),
  fail: (id, text) => pool.query("UPDATE alice_jobs SET status='failed',error_text=$2,updated_at=NOW() WHERE id=$1 AND status='running'", [id, text]),
  cleanup: async () => {
    // Незавершённые после сбоя задачи не запускаем повторно автоматически.
    await pool.query(`UPDATE alice_jobs SET status='failed', error_text='Обработка прервалась. Пожалуйста, повторите запрос.', updated_at=NOW()
      WHERE status IN ('queued','running') AND updated_at < NOW() - INTERVAL '4 minutes'`);
    await pool.query("DELETE FROM alice_jobs WHERE created_at < NOW() - INTERVAL '24 hours'");
  },
  inbox: async userId => (await pool.query(`SELECT id,question,result,updated_at FROM alice_jobs WHERE user_id=$1
    AND status='done' AND acknowledged_at IS NULL AND created_at > NOW() - INTERVAL '24 hours'
    ORDER BY created_at LIMIT 10`, [userId])).rows,
  acknowledge: (userId, ids) => pool.query('UPDATE alice_jobs SET acknowledged_at=NOW() WHERE user_id=$1 AND id=ANY($2::text[])', [userId, ids]),
});
module.exports = { ensureTables, createStore };
