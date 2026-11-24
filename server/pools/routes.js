const { createPoolService } = require('./service');
function registerPoolRoutes(app, deps) {
    const service = deps.service || createPoolService(deps);
    const access = [deps.auth, async (req, res, next) => { try {
            if (!['manager', 'admin'].includes(req.user.role))
                return res.status(403).json({ msg: 'Действие доступно владельцу аккаунта.' });
            if (deps.pool) {
                const current = (await deps.pool.query('SELECT role,blocked FROM users WHERE id=$1', [req.user.id])).rows[0];
                if (!current || current.blocked || !['manager', 'admin'].includes(current.role))
                    return res.status(403).json({ msg: 'Нет доступа к общему пулу.' });
            }
            next();
        }
        catch {
            res.status(503).json({ msg: 'Не удалось проверить доступ.' });
        } }];
    const run = fn => async (req, res) => { try {
        res.setHeader('Cache-Control', 'no-store');
        res.json(await fn(req));
    }
    catch (e) {
        res.status(e.status || 503).json({ msg: e.status ? e.message : 'Не удалось подтвердить операцию. Повторите с тем же запросом.' });
    } };
    app.get('/api/pools/:id', ...access, run(req => service.preview(req.user.id, req.params.id)));
    app.post('/api/pools/:id/:action', ...access, run(req => req.params.action === 'preview' ? service.preview(req.user.id, req.params.id, req.body) : service.mutate(req.user.id, req.params.id, req.params.action, req.body)));
    return service;
}
module.exports = { registerPoolRoutes };
