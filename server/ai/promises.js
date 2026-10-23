// Обещания клиентов заплатить («обещал 10 000 до пятницы»): записывает агент,
// очередь взыскания и утренняя сводка показывают, сдержано ли. Сдержано или нет —
// не хранится, а считается по платежам договора (collections.promiseStatus):
// платёж могут провести и руками в приложении.
//
// Своя таблица, а не data_items: приложению эти записи не нужны, и новый тип
// данных потребовал бы сборки iOS и desktop.

const createPromises = (pool) => {
  let initialized;
  const ready = () => initialized ||= pool.query(`
    CREATE TABLE IF NOT EXISTS ai_payment_promises (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, sale_id TEXT NOT NULL, customer_id TEXT,
      amount NUMERIC NOT NULL, due_date TEXT NOT NULL, note TEXT,
      status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ai_payment_promises_owner ON ai_payment_promises(user_id, due_date);
  `).catch(e => { initialized = null; throw e; });

  const add = async (userId, { saleId, customerId, amount, dueDate, note }) => {
    await ready();
    const id = `prm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    await pool.query(`INSERT INTO ai_payment_promises(id,user_id,sale_id,customer_id,amount,due_date,note) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [id, userId, saleId, customerId || null, amount, dueDate, note || null]);
    return id;
  };
  const remove = async (userId, id) => {
    await ready();
    return (await pool.query('DELETE FROM ai_payment_promises WHERE user_id=$1 AND id=$2', [userId, id])).rowCount > 0;
  };
  // Свежие обещания (последние 120 дней): старше — уже не про текущую просрочку
  const list = async (userId) => {
    await ready();
    return (await pool.query(`SELECT id, sale_id, customer_id, amount::float AS amount, due_date, note, status, created_at
      FROM ai_payment_promises WHERE user_id=$1 AND created_at > NOW() - INTERVAL '120 days' ORDER BY created_at`, [userId])).rows;
  };
  return { ready, add, remove, list };
};

module.exports = { createPromises };
