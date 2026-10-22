// Данные и ответ идемпотентности фиксируются одной транзакцией.
// Запросы без ключа сохраняют прежнее поведение API.
const { AsyncLocalStorage } = require('node:async_hooks');
const { hash: digest } = require('../ai/canonical');
const createAtomicWrites = pool => {
  const context = new AsyncLocalStorage();
  const db = new Proxy(pool, { get(target, prop) {
    if (prop === 'query') return (...args) => (context.getStore() || pool).query(...args);
    if (prop === 'connect') return async () => {
      const current = context.getStore();
      if (!current) return pool.connect();
      // Маршрут платежей уже использует собственную транзакцию. Внутри
      // общей записи это savepoint на ТОМ ЖЕ соединении, а не второе
      // соединение, ожидающее наши же блокировки.
      const name = `nested_${require('node:crypto').randomBytes(8).toString('hex')}`;
      let active = false;
      return {
        query: async (sql, ...args) => {
          if (typeof sql === 'string' && /^BEGIN\b/i.test(sql.trim())) { active = true; return current.query(`SAVEPOINT ${name}`); }
          if (typeof sql === 'string' && /^COMMIT\b/i.test(sql.trim()) && active) { active = false; return current.query(`RELEASE SAVEPOINT ${name}`); }
          if (typeof sql === 'string' && /^ROLLBACK\b/i.test(sql.trim()) && active) {
            await current.query(`ROLLBACK TO SAVEPOINT ${name}`); active = false; return current.query(`RELEASE SAVEPOINT ${name}`);
          }
          return current.query(sql, ...args);
        },
        release: () => {},
      };
    };
    const value = target[prop];
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const middleware = async (req, res, next) => {
    const key = req.get('idempotency-key');
    if (!key || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (key.length > 200) return res.status(400).json({ error: { message: 'Слишком длинный ключ операции.' } });
    const userId = req.apiAuth.userId;
    const endpoint = `${req.method} ${req.baseUrl}${req.url}`;
    const requestHash = digest([endpoint, req.body ?? null]);
    let client, finished = false;
    const originalJson = res.json.bind(res), originalEnd = res.end.bind(res);
    const release = async commit => {
      if (finished) return;
      finished = true;
      try { await client.query(commit ? 'COMMIT' : 'ROLLBACK'); }
      finally { client.release(); }
    };
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '10s'");
      await client.query("SET LOCAL statement_timeout = '40s'");
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 4818))', [userId]);
      const saved = (await client.query('SELECT * FROM api_idempotency WHERE user_id=$1 AND key=$2', [userId, key])).rows[0];
      if (saved) {
        await release(false);
        const legacyHash = require('node:crypto').createHash('sha256').update(`${req.method} ${req.baseUrl}${req.path}` + JSON.stringify(req.body ?? null)).digest('hex');
        if (saved.request_hash !== requestHash && saved.request_hash !== legacyHash) return res.status(409).json({ error: { message: 'Ключ операции уже использован с другими данными.' } });
        res.setHeader('Idempotent-Replay', 'true');
        return res.status(saved.status).json(saved.response);
      }
      // Блокируем записи до чтения/пересчёта платежей, чтобы два платежа
      // одного договора не перезаписали друг друга.
      await client.query('SELECT id FROM data_items WHERE user_id=$1 ORDER BY id FOR UPDATE', [userId]);
      const expectedRaw = req.get('x-ai-expected-state');
      if (expectedRaw) {
        const expected = JSON.parse(Buffer.from(expectedRaw, 'base64url').toString());
        const rows = (await client.query(`SELECT id,type,data FROM data_items WHERE user_id=$1 AND id=ANY($2::text[]) ORDER BY id`, [userId, expected.ids])).rows;
        if (digest(rows.map(r => ({ id: r.id, type: r.type, hash: digest(r.data) }))) !== digest(expected.rows)) {
          await release(false);
          return res.status(409).json({ error: { message: 'Записи изменились. Подготовьте действие заново.' } });
        }
      }
      let responding = false;
      const respond = async (body, empty = false) => {
        if (responding || finished) return;
        responding = true;
        try {
          const success = res.statusCode >= 200 && res.statusCode < 300;
          if (success) await client.query(`INSERT INTO api_idempotency(user_id,key,endpoint,request_hash,status,response)
            VALUES($1,$2,$3,$4,$5,$6)`, [userId, key, endpoint, requestHash, res.statusCode, JSON.stringify(body ?? null)]);
          await release(success);
          res.json = originalJson; res.end = originalEnd;
          if (empty) originalEnd(); else originalJson(body);
        } catch {
          if (!finished) await release(false).catch(() => {});
          res.json = originalJson; res.end = originalEnd;
          res.status(503).json({ error: { message: 'Не удалось подтвердить результат. Повторите запрос с тем же ключом операции.' } });
        }
      };
      res.json = body => { void respond(body); return res; };
      res.end = () => { void respond(null, true); return res; };
      // Обрыв HTTP не освобождает соединение посреди обработчика: иначе
      // продолжающийся код мог бы писать уже вне транзакции. Сохраняем итог
      // и ключ даже при исчезнувшем клиенте; повтор получит этот же результат.
      context.run(client, next);
    } catch {
      if (client && !finished) await release(false).catch(() => {});
      res.status(503).json({ error: { message: 'Операция занята или недоступна. Повторите позже.' } });
    }
  };
  return { db, middleware };
};
module.exports = { createAtomicWrites };
