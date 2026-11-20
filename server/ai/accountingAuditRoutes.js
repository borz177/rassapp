// Без LLM, квоты ИИ и внешних вызовов. Изменение плана — отдельное подтверждаемое действие.
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
  status: q.status,
});
function registerAccountingAuditRoutes(app, { pool, auth, allowed, conversations }) {
  const service = createAccountingAudits(pool),
    base = '/api/ai/assistant/accounting-audit';
  const repairs=require('./auditRepairs').createAuditRepairs({pool,audits:service,allowed});
  const access = [
    auth,
    (req, res, next) => {
      if (!allowed(req.user.role))
        return res.status(403).json({ msg: 'Проверка доступна владельцу аккаунта.' });
      next();
    },
  ];
  const currentOwner = async (req,res,next) => {
    try{const user=(await pool.query('SELECT role,blocked FROM users WHERE id=$1',[req.user.id])).rows[0];
      if(!user||user.blocked||!allowed(user.role))return res.status(403).json({msg:'Действие доступно владельцу аккаунта.'});
      next();
    }catch{res.status(503).json({msg:'Не удалось проверить доступ.'});}
  };
  app.post(`${base}/:id/findings/:findingId/review`,...access,currentOwner,wrap(async(req,res)=>
    res.json(await service.review(req.user.id,req.params.id,req.params.findingId,req.body?.checked))));
  app.post(`${base}/:id/findings/:findingId/repair`,...access,currentOwner,wrap(async(req,res)=>
    res.json(await repairs.prepare(req.user.id,req.params.id,req.params.findingId,req.body?.requestId))));
  for(const action of ['confirm','undo','cancel'])app.post(`${base}/repairs/:repairId/${action}`,...access,currentOwner,wrap(async(req,res)=>{
    if(req.body?.confirmed!==true&&action!=='cancel')throw Object.assign(new Error('Подтвердите действие.'),{status:400});
    res.json(await repairs[action](req.user.id,req.params.repairId));
  }));
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
  return {...service,repairs};
}
module.exports = { registerAccountingAuditRoutes, pageOptions };
