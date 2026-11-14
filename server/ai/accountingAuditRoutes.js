// Отдельный путь без LLM, квоты ИИ и внешних вызовов. Записывается только отчёт/история чата.
const { createAccountingAudits } = require('./accountingAudit');
const wrap = (fn) => async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    await fn(req, res);
  } catch (e) {
    res
      .status(e.status || (e.code === 'AI_BUSY' ? 409 : 500))
      .json({
        msg:
          (e.status && e.status < 500) || e.code === 'AI_BUSY'
            ? e.message
            : 'Не удалось выполнить проверку. Попробуйте ещё раз.',
      });
  }
};
const pageOptions = (q) => ({
  offset: q.offset === undefined ? 0 : Number(q.offset),
  limit: q.limit === undefined ? 30 : Number(q.limit),
  severity: q.severity,
  kind: q.kind,
});
function registerAccountingAuditRoutes(app, { pool, auth, allowed, conversations }) {
  const service = createAccountingAudits(pool),
    base = '/api/ai/assistant/accounting-audit';
  const access = [
    auth,
    (req, res, next) => {
      if (!allowed(req.user.role))
        return res.status(403).json({ msg: 'Проверка доступна владельцу аккаунта.' });
      next();
    },
  ];
  app.post(
    base,
    ...access,
    wrap(async (req, res) => {
      const { accountIds = null, requestId } = req.body || {};
      if (typeof requestId !== 'string' || requestId.length < 8 || requestId.length > 120)
        throw Object.assign(new Error('Обновите запрос проверки.'), { status: 400 });
      const report = await service.create(req.user.id, accountIds);
      const out = await conversations.run(
        {
          userId: req.user.id,
          requestId,
          text: `Проверь учёт: ${report.scope.label}`,
          channel: 'accounting_audit',
          auditScope: report.scope.accountIds,
          sharedHistory: true,
        },
        async () => ({
          reply: 'Сверка по записям приложения готова. Данные не изменены.',
          actions: [
            {
              id: `audit_${report.id}`,
              kind: 'accounting_audit',
              title: 'Проверка учёта',
              report: service.compact(report),
            },
          ],
          modelUsed: false,
        })
      );
      res.json(out);
    })
  );
  app.get(
    `${base}/:id`,
    ...access,
    wrap(async (req, res) => res.json(await service.page(req.user.id, req.params.id, pageOptions(req.query))))
  );
  app.get(
    `${base}/:id/source`,
    ...access,
    wrap(async (req, res) =>
      res.json(
        await service.source(req.user.id, req.params.id, req.query.kind, req.query.id, req.query.contractId)
      )
    )
  );
  return service;
}
module.exports = { registerAccountingAuditRoutes, pageOptions };
