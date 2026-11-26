// Старые формы пишут несколько записей. Для месячного пула разрешаем только
// безопасные правки, сериализуем с закрытием месяца и отвечаем после COMMIT.
const { AsyncLocalStorage } = require('node:async_hooks');
function createPoolTransactions(raw) {
    const context = new AsyncLocalStorage();
    const db = new Proxy(raw, { get(target, key) {
            if (key === 'query')
                return (...args) => (context.getStore() || raw).query(...args);
            if (key === 'connect')
                return async () => {
                    const current = context.getStore();
                    if (!current)
                        return raw.connect();
                    const name = `pool_nested_${require('node:crypto').randomBytes(8).toString('hex')}`;
                    let active = false;
                    return { query: async (sql, ...args) => {
                            if (typeof sql === 'string' && /^BEGIN\b/i.test(sql.trim())) {
                                active = true;
                                return current.query(`SAVEPOINT ${name}`);
                            }
                            if (typeof sql === 'string' && /^COMMIT\b/i.test(sql.trim()) && active) {
                                active = false;
                                return current.query(`RELEASE SAVEPOINT ${name}`);
                            }
                            if (typeof sql === 'string' && /^ROLLBACK\b/i.test(sql.trim()) && active) {
                                await current.query(`ROLLBACK TO SAVEPOINT ${name}`);
                                active = false;
                                return current.query(`RELEASE SAVEPOINT ${name}`);
                            }
                            return current.query(sql, ...args);
                        }, release: () => { } };
                };
            const value = target[key];
            return typeof value === 'function' ? value.bind(target) : value;
        } });
    const middleware = async (req, res, next, { memberId = null } = {}) => {
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method))
            return next();
        const owner = req.apiAuth?.userId || (req.user?.role === 'employee' || req.user?.role === 'investor' ? req.user.managerId : req.user?.id);
        if (!owner)
            return next();
        let client, ended = false;
        const json = res.json.bind(res), end = res.end.bind(res);
        try {
            const has = (await raw.query(`
                SELECT 1 FROM data_items WHERE user_id=$1 AND type='accounts' AND (
                    ($2::text IS NULL AND data->'poolAccounting'->>'version'='1')
                    OR ($2::text IS NOT NULL AND data->>'type'='POOL' AND data->'poolMemberIds' ? $2)
                ) LIMIT 1`, [owner, memberId])).rows.length;
            if (!has)
                return next();
            client = await raw.connect();
            await client.query('BEGIN');
            await client.query("SET LOCAL lock_timeout='10s'");
            await client.query("SET LOCAL statement_timeout='30s'");
            await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [owner]);
            await client.query('SELECT id FROM data_items WHERE user_id=$1 ORDER BY id FOR UPDATE', [owner]);
            const finish = async (body, empty = false) => { if (ended)
                return; ended = true; try {
                await client.query(res.statusCode < 300 ? 'COMMIT' : 'ROLLBACK');
                res.json = json;
                res.end = end;
                empty ? end() : json(body);
            }
            catch {
                res.json = json;
                res.end = end;
                res.status(503).json({ msg: 'Операция не подтверждена. Обновите данные.' });
            }
            finally {
                client.release();
            } };
            res.json = body => { void finish(body); return res; };
            res.end = () => { void finish(null, true); return res; };
            context.run(client, next);
        }
        catch {
            if (client && !ended) {
                await client.query('ROLLBACK').catch(() => { });
                client.release();
            }
            res.status(503).json({ msg: 'Пул занят другой операцией. Повторите позже.' });
        }
    };
    return { db, middleware };
}
module.exports = { createPoolTransactions };
