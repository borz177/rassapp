// Детерминированная сверка. Модель и запись финансовых операций здесь не используются.
const crypto = require('node:crypto');
const domain = require('../api/domain');
const {reviewFingerprint} = require('./auditReviewIdentity');
const VERSION = 4;
const FINDING_VERSION = 2;
const MIN_SCHEDULE_DIFFERENCE_CENTS = 100;
const TYPES = [
  'accounts',
  'sales',
  'expenses',
  'retailSales',
  'customers',
  'investors',
  'stockMovements',
  'products',
  'settings',
];
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const round = (n) => Math.round(n * 100) / 100;
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const auditDate = (date) => Number.isFinite(Date.parse(date))
  ? new Date(date).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }) : null;
const groupRows = (rows) =>
  Object.fromEntries(TYPES.map((type) => [type, rows.filter((r) => r.type === type).map((r) => r.data)]));
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
// Режим импорта относится к договору целиком. Импорт отдельного платежа
// не доказывает, что закуп не должен был попасть в кассу.
function importedPurchase(sale) {
  const info = sale.importInfo;
  if (info && ['EXCEL', 'FINPAY'].includes(info.source) &&
    ['WITH_EXPENSE', 'WITHOUT_EXPENSE', 'UNKNOWN'].includes(info.purchaseMode)) return info;
  if (info != null) return null;
  // Старый импорт FinPay не сохранял выбранный режим закупа. Его можно
  // опознать по нескольким признакам, но восстановить выбор пользователя нельзя.
  if (String(sale.id).startsWith('finpay_') &&
    String(sale.notes || '').startsWith('Импорт FinUchet, договор №') &&
    Array.isArray(sale.paymentPlan) && sale.paymentPlan.some(p => String(p?.id || '').startsWith('finpay_plan_')))
    return { source: 'FINPAY', purchaseMode: 'UNKNOWN' };
  return null;
}
const scopeOf = (accounts, accountIds) => {
  if (
    accountIds != null &&
    (!Array.isArray(accountIds) ||
      !accountIds.length ||
      accountIds.length > 200 ||
      accountIds.some((id) => typeof id !== 'string' || !id || id.length > 200) ||
      new Set(accountIds).size !== accountIds.length)
  )
    fail(400, 'Выберите счета для проверки.');
  if (accountIds?.some((id) => !accounts.some((a) => a.id === id))) fail(403, 'Один из счетов недоступен.');
  const ids = accountIds ? [...accountIds].sort() : null;
  return {
    accountIds: ids,
    label: ids ? ids.map((id) => accounts.find((a) => a.id === id).name || 'Счёт').join(' · ') : 'Все счета',
    includesArchived: accounts.some((a) => a.isArchived && (!ids || ids.includes(a.id))),
  };
};

function buildAccountingAudit(data, accountIds = null, now = new Date().toISOString()) {
  const {
    accounts = [],
    sales = [],
    expenses = [],
    retailSales = [],
    customers = [],
    investors = [],
    stockMovements = [],
  } = data;
  const scope = scopeOf(accounts, accountIds),
    selected = new Set(scope.accountIds || accounts.map((a) => a.id));
  const account = new Map(accounts.map((a) => [a.id, a])),
    names = new Map(customers.map((c) => [c.id, c.name || 'Клиент']));
  const invById = new Map(investors.map((i) => [i.id, i])),
    salesById = new Map(sales.map((s) => [s.id, s]));
  const all = !scope.accountIds,
    inScope = (s) => all || selected.has(s.accountId) || s.funding?.some((f) => selected.has(f.accountId));
  const allContracts = sales.filter(
    (s) =>
      (s.type || 'INSTALLMENT') === 'INSTALLMENT' &&
      s.customerId &&
      !String(s.customerId).startsWith('system_') &&
      !invById.has(s.customerId)
  );
  const contracts = allContracts.filter(inScope);
  const contractIds = new Set(contracts.map((s) => s.id));
  const purchaseOwner = new Map(),
    purchasesBySale = new Map(), linkedPurchases = new Set();
  const purchaseKey = (key, saleId, legacy = false) => {
    if (!purchaseOwner.has(key)) purchaseOwner.set(key, []);
    purchaseOwner.get(key).push({ saleId, legacy });
  };
  for (const s of allContracts) {
    purchaseKey(`exp_sale_${s.id}`, s.id);
    purchaseKey(`exp_${s.id}`, s.id, true); // Excel-импорт до явной связи saleId.
    for (const f of s.funding || []) purchaseKey(`exp_sale_${s.id}__${f.accountId}`, s.id);
  }
  for (const e of expenses) {
    if (e.isRefund === true) continue;
    const purchaseCategory = ['Закуп', 'Себестоимость'].includes(e.category);
    // Явная ссылка важнее старого id. По одному названию, сумме или дате
    // закуп не связываем; неоднозначный id тоже не подтверждает связь.
    const candidates = [...new Set((purchaseOwner.get(e.id) || [])
      .filter(link => !link.legacy || purchaseCategory).map(link => link.saleId))];
    const id = e.saleId ? (purchaseCategory ? e.saleId : null) : candidates.length === 1 ? candidates[0] : null;
    if (contractIds.has(id)) {
      linkedPurchases.add(e.id);
      if (!purchasesBySale.has(id)) purchasesBySale.set(id, []);
      purchasesBySale.get(id).push(e);
    }
  }

  const relevantExpenses = expenses.filter(
    (e) => all || selected.has(e.accountId) || contractIds.has(e.saleId) || linkedPurchases.has(e.id)
  );
  const linkedInvestors = new Set(accounts.filter(a => !a.isArchived).flatMap(a => [a.ownerId, ...(a.poolMemberIds || []), ...(a.partners || [])]).filter(Boolean));
  const deposits = sales.filter(inScope).flatMap(s => {
    if (s.type !== 'CASH' && s.type != null) return [];
    const key = /^system_deposit_(.+)$/.exec(s.customerId || '')?.[1];
    const investorId = key || (invById.has(s.customerId) ? s.customerId : null);
    return investorId ? [{ sale: s, investorId }] : [];
  });
  const historyKey = (accountId, investorId) => JSON.stringify([accountId, investorId]);
  const unmatchedDeposits = new Map(), unmatchedReturns = new Map();
  const group = (map, k, entry) => { if (!map.has(k)) map.set(k, []); map.get(k).push(entry); };
  for (const { sale, investorId } of deposits) {
    if (!invById.has(investorId) && !linkedInvestors.has(investorId) && account.has(sale.accountId)) group(unmatchedDeposits, historyKey(sale.accountId, investorId), sale);
  }
  for (const e of relevantExpenses) {
    if (e.isRefund !== true && e.payoutType === 'INVESTMENT' && e.investorId && !invById.has(e.investorId)) group(unmatchedReturns, historyKey(e.accountId, e.investorId), e);
  }
  const returnedDeposits = new Map();
  for (const [key, incoming] of unmatchedDeposits) {
    const outgoing = unmatchedReturns.get(key) || [];
    if (incoming.length !== 1 || outgoing.length !== 1) continue;
    const [sale] = incoming, [expense] = outgoing;
    const amount = domain.collected(sale);
    if (amount > 0 && round(amount) === round(num(expense.amount)) && Date.parse(sale.startDate) <= Date.parse(expense.date)) returnedDeposits.set(sale.id, expense);
  }
  const historicalReturnIds = new Set([...returnedDeposits.values()].map(e => e.id));
  const findings = [];
  const ref = (kind, id, label, contractId) => ({ kind, id, label, ...(contractId ? { contractId } : {}) });
  const contractRef = (s) => ref('contract', s.id, 'Открыть договор');
  const expenseRef = (e) => ref('expense', e.id, 'Открыть расход');
  const fact = (label, value, format = 'money') => ({ label, value, format });
  const add = (
    code,
    severity,
    title,
    explanation,
    { sale, sourceId, sources = [], facts = [], difference, nextStep, accountName } = {}
  ) => {
    findings.push({
      id: hash([FINDING_VERSION, code, sale?.id, sourceId, sources]).slice(0, 24),
      code,
      severity,
      title,
      explanation,
      customer: sale ? names.get(sale.customerId) || 'Клиент не найден' : undefined,
      product: sale?.productName || undefined,
      accountName: accountName || (sale ? account.get(sale.accountId)?.name || 'Без счёта' : undefined),
      facts,
      sources,
      difference: Number.isFinite(difference) ? round(difference) : undefined,
      nextStep: nextStep || 'Откройте связанные записи и проверьте данные.',
    });
  };
  for (const s of contracts) {
    const sources = [contractRef(s)],
      plan = Array.isArray(s.paymentPlan) ? s.paymentPlan : [];
    const real = plan.filter((p) => p && p.isPaid && p.isRealPayment !== false);
    const scheduled = plan.filter(
      (p) => p && (p.isRealPayment === false || (p.isRealPayment == null && !p.isPaid))
    );
    if (!account.has(s.accountId) || (s.funding || []).some((f) => !account.has(f.accountId))) {
      add(
        'missing_account',
        'confirmed',
        s.accountId ? 'Договор ссылается на отсутствующий счёт' : 'Договор без счёта',
        'Счёт договора или одна из частей финансирования не найдены.',
        { sale: s, sources }
      );
    }
    if (!names.has(s.customerId))
      add(
        'missing_customer',
        'confirmed',
        'Клиент договора не найден',
        'В договоре сохранена ссылка на клиента, которого нет в доступных записях.',
        { sale: s, sources }
      );
    const invalidMoney =
      [s.totalAmount, s.downPayment || 0, s.remainingAmount].some(
        (v) => !Number.isFinite(Number(v)) || Number(v) < 0
      ) ||
      real.some(
        (p) =>
          !Number.isFinite(Number(p.amount)) ||
          Number(p.amount) < 0 ||
          !Number.isFinite(Number(p.discountAmount || 0)) ||
          Number(p.discountAmount || 0) < 0
      );
    if (invalidMoney)
      add(
        'contract_amount',
        'review',
        'Нужно проверить денежные поля договора',
        'Сохранены некорректные суммы. Точное сравнение долга не выполнялось.',
        { sale: s, sources }
      );
    const paid = domain.collected(s),
      discounts = real.reduce((sum, p) => sum + Math.max(0, num(p.discountAmount)), 0);
    const expected = Math.max(0, round(num(s.totalAmount) - paid - discounts)),
      actual = num(s.remainingAmount);
    if (!invalidMoney && Math.abs(actual - expected) > 0.011)
      add(
        'debt_mismatch',
        'confirmed',
        'Долг не совпадает с записанными оплатами',
        'Сопоставлены цена, первый взнос, фактические оплаты и подтверждённые скидки.',
        {
          sale: s,
          sources,
          facts: [
            fact('Цена договора', num(s.totalAmount)),
            fact('Получено, включая первый взнос', round(paid)),
            fact('Скидки', round(discounts)),
            fact('Остаток в договоре', actual),
            fact('По записанным оплатам', expected),
          ],
          difference: actual - expected,
        }
      );
    const legacyPayments = real.some((p) => p.isRealPayment == null);
    if (legacyPayments)
      add(
        'legacy_schedule',
        'information',
        'Платежи сохранены в старом формате',
        'Оплаченные строки без флага учтены как полученные деньги. Полнота исторического графика не предполагается.',
        { sale: s, sources }
      );
    if (scheduled.length && !legacyPayments) {
      const sum = round(scheduled.reduce((n, p) => n + num(p.amount), 0)),
        due = round(Math.max(0, num(s.totalAmount) - num(s.downPayment)));
      const differenceCents = Math.round(100 * Math.min(Math.abs(sum - due), Math.abs(sum - Math.max(0, due - discounts))));
      if (differenceCents >= MIN_SCHEDULE_DIFFERENCE_CENTS)
        add(
          'schedule_review',
          'review',
          'Нужно сверить график платежей',
          'Сумма плановых строк отличается от цены за вычетом взноса. Уточните изменения графика и историю скидок; автоматически график не меняется.',
          {
            sale: s,
            sources,
            facts: [fact('Сумма плановых строк', sum), fact('Цена за вычетом взноса', due)],
          }
        );
    } else if (!scheduled.length && actual > 0 && !legacyPayments)
      add(
        'missing_schedule',
        'review',
        'Для долга нет записанного графика',
        'Возможно, договор импортирован с начальным долгом. Нужна проверка исходного договора.',
        { sale: s, sources }
      );
    const seen = new Map();
    for (const p of real) {
      if (p.saleId && p.saleId !== s.id)
        add(
          'payment_contract',
          'confirmed',
          'Платёж ссылается на другой договор',
          'Платёж находится в графике одного договора, а его ссылка указывает на другой.',
          { sale: s, sourceId: p.id, sources: [contractRef(s), ref('payment', p.id, 'Открыть платёж', s.id)] }
        );
      if (
        !Number.isFinite(Number(p.amount)) ||
        num(p.amount) < 0 ||
        !Number.isFinite(Number(p.discountAmount || 0)) ||
        num(p.discountAmount) < 0
      )
        add(
          'payment_amount',
          'review',
          'Нужно проверить сумму платежа',
          'Сохранена некорректная или отрицательная сумма. Уточните, не является ли запись возвратом.',
          { sale: s, sourceId: p.id, sources: [contractRef(s), ref('payment', p.id, 'Открыть платёж', s.id)] }
        );
      const paymentDate = p.actualDate || p.date;
      const parsedDate = new Date(paymentDate);
      const dateKey = Number.isFinite(parsedDate.getTime())
        ? parsedDate.toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' })
        : paymentDate;
      const key = JSON.stringify([dateKey, round(num(p.amount)), round(num(p.discountAmount))]);
      if ((p.actualDate || p.date) && num(p.amount) > 0 && seen.has(key))
        add(
          'possible_duplicate',
          'review',
          'Похожие платежи — проверьте повтор',
          'Календарная дата и сумма совпадают. Это могут быть два настоящих платежа; удаление не выполняется.',
          {
            sale: s,
            sourceId: p.id,
            sources: [
              contractRef(s),
              ref('payment', seen.get(key), 'Первый платёж', s.id),
              ref('payment', p.id, 'Второй платёж', s.id),
            ],
            facts: [fact('Сумма каждого платежа', num(p.amount))],
          }
        );
      else seen.set(key, p.id);
    }
    const external = !!(
      s.supplierId ||
      s.productId ||
      s.stockItems?.length ||
      s.stockMovementId ||
      s.stockMovementIds?.length
    );
    const purchases = purchasesBySale.get(s.id) || [];
    if (!purchases.length && num(s.buyPrice) > 0) {
      const imported = importedPurchase(s);
      const withoutHistory = imported && imported.purchaseMode !== 'WITH_EXPENSE';
      add(
        external ? 'external_purchase' : withoutHistory ? 'import_purchase_history' : 'missing_purchase',
        external || withoutHistory ? 'information' : 'review',
        external ? 'Закуп учитывается через склад или поставщика' : withoutHistory ? 'Импорт без истории закупа' : 'Расход закупа не найден',
        external
          ? 'Для этого договора прямой расход закупа не обязателен. Проверьте связанные складские документы или расчёты с поставщиком.'
          : withoutHistory
          ? imported.purchaseMode === 'WITHOUT_EXPENSE'
            ? 'Договор перенесён без расходов закупа. Само по себе это не ошибка.'
            : 'Отдельного расхода нет. В старом импорте не сохранено, нужно ли было его переносить.'
          : imported?.purchaseMode === 'WITH_EXPENSE'
          ? 'Импорт предусматривал расход закупа, но связанная запись не найдена.'
          : 'Закуп указан в договоре, но связанного расхода нет. Это не доказывает потерю денег.',
        { sale: s, sources, facts: [fact('Закуп в договоре', num(s.buyPrice))],
          nextStep: external ? 'Проверьте складские документы или расчёты с поставщиком.'
            : withoutHistory ? imported.purchaseMode === 'WITHOUT_EXPENSE'
              ? 'Добавлять расход только ради сверки не нужно.'
              : 'Сверьте исходный учёт, если закуп должен входить в эту кассу.'
            : 'Проверьте, как закуп был оплачен и сохранён ли расход.' }
      );
    }
    if (purchases.length && !external) {
      const expectedAccounts = new Set(s.funding?.length ? s.funding.map((f) => f.accountId) : [s.accountId]);
      for (const e of purchases)
        if (!expectedAccounts.has(e.accountId))
          add(
            'purchase_account',
            'confirmed',
            'Закуп записан на другом счёте',
            'У явно связанного закупа и договора разные счета.',
            {
              sale: s,
              sources: [contractRef(s), expenseRef(e)],
              facts: [
                fact(
                  'Счёт договора',
                  [...expectedAccounts].map((id) => account.get(id)?.name || 'Счёт не найден').join(' · '),
                  'text'
                ),
                fact('Счёт закупа', account.get(e.accountId)?.name || 'Счёт не найден', 'text'),
                fact('Сумма закупа', num(e.amount)),
              ],
            }
          );
      const total = round(purchases.reduce((n, e) => n + num(e.amount), 0));
      if (Math.abs(total - num(s.buyPrice)) > 0.011)
        add(
          'purchase_amount',
          'confirmed',
          'Сумма связанных закупов отличается',
          'Сопоставлены закуп в договоре и расходы с явной ссылкой на него.',
          {
            sale: s,
            sources: [contractRef(s), ...purchases.map(expenseRef)],
            facts: [fact('Закуп в договоре', num(s.buyPrice)), fact('Связанные расходы', total)],
            difference: total - num(s.buyPrice),
          }
        );
      if (s.funding?.length)
        for (const f of s.funding) {
          const own = purchases
            .filter((e) => e.accountId === f.accountId)
            .reduce((n, e) => n + num(e.amount), 0);
          if (Math.abs(own - num(f.amount)) > 0.011)
            add(
              'funding_purchase',
              'confirmed',
              'Закуп по части финансирования не совпадает',
              'Сравнение выполнено для конкретного счёта совместной закупки.',
              {
                sale: s,
                sourceId: f.accountId,
                sources: [
                  contractRef(s),
                  ...purchases.filter((e) => e.accountId === f.accountId).map(expenseRef),
                ],
                facts: [
                  fact('Счёт', account.get(f.accountId)?.name || 'Счёт не найден', 'text'),
                  fact('Вложено по договору', num(f.amount)),
                  fact('Связанный закуп', round(own)),
                ],
                difference: own - num(f.amount),
              }
            );
        }
    }
  }
  for (const e of relevantExpenses) {
    if (e.isRefund === true) continue;
    const sources = [expenseRef(e)];
    if (!account.has(e.accountId))
      add(
        'expense_account',
        'confirmed',
        'Расход без действующей ссылки на счёт',
        'Указанный счёт отсутствует в записях.',
        { sourceId: e.id, sources, facts: [fact('Сумма', num(e.amount))] }
      );
    if (e.saleId && !salesById.has(e.saleId))
      add(
        'expense_contract',
        'review',
        'Связанный договор расхода не найден',
        'Проверьте исходную запись и историю удаления договора.',
        { sourceId: e.id, sources }
      );
    if (e.category === 'Моя выплата' && !['PROFIT', 'CAPITAL'].includes(e.managerPayoutSource))
      add(
        'payout_source',
        'review',
        'Не указан источник выплаты себе',
        'В старых записях источник мог не сохраняться. Требуется уточнение.',
        { sourceId: e.id, sources, facts: [fact('Сумма', num(e.amount))] }
      );
    if (!historicalReturnIds.has(e.id) && e.category !== 'Моя выплата' && (e.category === 'Выплата инвестора' || e.payoutType || e.investorId)) {
      const inv = invById.get(e.investorId),
        a = account.get(e.accountId);
      if (!inv)
        add(
          'payout_investor',
          !e.investorId || linkedInvestors.has(e.investorId) ? 'confirmed' : 'review',
          e.investorId ? 'Карточка получателя выплаты не найдена' : 'В выплате не указан получатель',
          'Расход есть в истории. Без получателя сверка не может отнести его к конкретному инвестору.',
          { sourceId: e.id, sources, accountName: a?.name || 'Счёт не найден', facts: [fact('Сумма выплаты', num(e.amount)), ...(auditDate(e.date) ? [fact('Дата', auditDate(e.date), 'text')] : [])], nextStep: 'Откройте расход и сверьте получателя с исходной операцией.' }
        );
      else if (
        a &&
        !(
          a.ownerId === inv.id ||
          (a.type === 'POOL' && a.poolMemberIds?.includes(inv.id)) ||
          (a.type === 'SHARED' && a.partners?.includes(inv.id))
        )
      )
        add(
          'payout_membership',
          'review',
          'Нужно сверить связь инвестора со счётом',
          'Текущая связь отсутствует. Она могла измениться после выплаты; история требует проверки.',
          { sourceId: e.id, sources, facts: [fact('Инвестор', inv.name || 'Инвестор', 'text')] }
        );
      if (!['PROFIT', 'INVESTMENT'].includes(e.payoutType))
        add(
          'investor_payout_source',
          'review',
          'Не указан источник выплаты инвестору',
          'Нужно уточнить: выплата прибыли или возврат вложений.',
          { sourceId: e.id, sources }
        );
    }
  }
  for (const { sale: s, investorId: id } of deposits) {
    const inv = invById.get(id),
      a = account.get(s.accountId),
      sources = [ref('income', s.id, 'Открыть внесение')];
    const oldReturn = returnedDeposits.get(s.id);
    const facts = [fact('Сумма внесения', round(domain.collected(s))), ...(auditDate(s.startDate) ? [fact('Дата внесения', auditDate(s.startDate), 'text')] : [])];
    if (oldReturn)
      add('historical_investor_return', 'information', 'Историческое вложение и возврат',
        'На одном счёте сохранились внесение и возврат на ту же сумму с одной ссылкой на инвестора. Его карточки больше нет.',
        { sourceId: s.id, sources: [...sources, ref('expense', oldReturn.id, 'Открыть возврат')], accountName: a?.name, facts: [...facts, fact('Сумма возврата', num(oldReturn.amount)), fact('Дата возврата', auditDate(oldReturn.date), 'text')], nextStep: 'При необходимости откройте обе операции. По этой паре разница между внесением и возвратом — 0 ₽.' });
    else if (!inv)
      add(
        'deposit_investor',
        linkedInvestors.has(id) ? 'confirmed' : 'review',
        'Карточка инвестора по внесению не найдена',
        a ? 'Сумма есть в истории счёта. Внесение ссылается на карточку инвестора, которой сейчас нет.' : 'Внесение сохранилось в истории. Связанные карточка инвестора и счёт не найдены.',
        { sourceId: s.id, sources, accountName: a?.name || 'Счёт не найден', facts, nextStep: 'Сверьте, кому принадлежали деньги. Сумма внесения сама по себе не показывает остаток капитала или потерю.' }
      );
    else if (!a || !(a.ownerId === id || a.poolMemberIds?.includes(id) || a.partners?.includes(id)))
      add(
        'deposit_membership',
        'review',
        'Нужно сверить счёт внесения инвестора',
        'По текущим данным инвестор не связан со счётом внесения. Возможны изменения состава участников.',
        { sourceId: s.id, sources, facts: [fact('Внесено', round(domain.collected(s)))] }
      );
  }
  const legacy = require('./reconciliation').audit({ accounts, sales, expenses, retailSales, customers });
  const accountTotals = legacy.accounts.filter((a) => selected.has(a.id));
  for (const a of accountTotals) {
    if (a.balance < -0.01)
      add(
        'negative_balance',
        'review',
        'На счёте отрицательный баланс',
        'Отрицательная сумма требует сверки источников денег; сама по себе она не доказывает ошибку.',
        {
          sourceId: a.id,
          sources: [
            ref('account', a.id, 'Открыть счёт'),
            ...expenses
              .filter((e) => e.accountId === a.id && e.isRefund !== true)
              .sort((x, y) => num(y.amount) - num(x.amount))
              .slice(0, 5)
              .map((e) => ref('expense', e.id, e.title || e.category || 'Открыть расход')),
          ],
          facts: [
            fact('Счёт', a.name, 'text'),
            fact('Начальный остаток', a.initial),
            fact('Поступления', a.receipts),
            fact('Расходы', a.expenses),
            fact('Движение магазина', a.retailNet),
            fact('На счёте', a.balance),
            ...a.topExpenseCategories.map((c) => fact(c.category, c.amount)),
          ],
          nextStep:
            'Сопоставьте поступления и расходы. Ниже — до пяти крупнейших расходов счёта; это подтверждённые списания, а не автоматически найденные ошибки.',
        }
      );
    if (Math.abs(num(a.initial)) > 0.01)
      add(
        'initial_balance',
        'information',
        'Начальный остаток учтён отдельно',
        'Начальная сумма не является отдельной оплатой клиента или расходом.',
        {
          sourceId: a.id,
          sources: [ref('account', a.id, 'Открыть счёт')],
          facts: [fact('Счёт', a.name, 'text'), fact('Начальный остаток', a.initial)],
        }
      );
  }
  for (const inv of investors) {
    const linked = accounts.filter(
      (a) => a.ownerId === inv.id || a.poolMemberIds?.includes(inv.id) || a.partners?.includes(inv.id)
    );
    if (linked.length > 1 && linked.some((a) => selected.has(a.id)))
      add(
        'capital_allocation',
        'review',
        'Капитал связан с несколькими счетами',
        'Вклад хранится у инвестора целиком. Распределение между счетами требует явных внесений и истории переводов; весь вклад не приписывается каждому счёту.',
        {
          sourceId: inv.id,
          sources: linked.map((a) => ref('account', a.id, 'Открыть счёт')),
          facts: [
            fact('Инвестор', inv.name || 'Инвестор', 'text'),
            fact('Связанные счета', linked.map((a) => a.name).join(' · '), 'text'),
          ],
        }
      );
  }
  const order = { confirmed: 0, review: 1, information: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.id.localeCompare(b.id));
  const counts = Object.fromEntries(
    Object.keys(order).map((k) => [k, findings.filter((f) => f.severity === k).length])
  );
  const affected = new Set(
    findings
      .filter((f) => f.severity !== 'information')
      .flatMap((f) => f.sources.map((s) => `${s.kind}:${s.contractId || ''}:${s.id}`))
  );
  return {
    version: VERSION,
    calculatedAt: now,
    scope,
    counts: { ...counts, affectedRecords: affected.size },
    summary: counts.confirmed
      ? `Найдены несоответствия: ${counts.confirmed}.`
      : counts.review
      ? `Вопросов для уточнения: ${counts.review}.`
      : 'В проверенных записях расхождений не найдено',
    checked: {
      accounts: accountTotals.length,
      contracts: contracts.length,
      payments: contracts.reduce(
        (n, s) =>
          n +
          (Array.isArray(s.paymentPlan) ? s.paymentPlan : []).filter(
            (p) => p?.isPaid && p.isRealPayment !== false
          ).length,
        0
      ),
      expenses: relevantExpenses.length,
      stockDocuments: stockMovements.filter(inScope).length,
    },
    accounts: accountTotals,
    findings,
    limitations: [
      'Проверены записи приложения; наличные и банковские выписки вне приложения не сверялись.',
      'Импорт без истории закупа — особенность учёта. Похожие платежи и неизвестный источник закупа требуют проверки.',
      'Суммы разных находок могут пересекаться и не складываются в общую потерю.',
    ],
    financialDataChanged: false,
  };
}

function createAccountingAudits(pool) {
  let initialized;
  const ready = () =>
    (initialized ||= pool
      .query(
        `CREATE TABLE IF NOT EXISTS ai_accounting_reports(
    id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,scope_key text NOT NULL,fingerprint text NOT NULL,report jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT NOW(),
    UNIQUE(user_id,scope_key,fingerprint));
    CREATE TABLE IF NOT EXISTS ai_accounting_reviews(
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      finding_id text NOT NULL, source_fingerprint text NOT NULL,
      report_id text NOT NULL, checked_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(user_id,finding_id))`
      )
      .catch((e) => {
        initialized = null;
        throw e;
      }));
  const load = async (userId) =>
    (
      await pool.query(
        'SELECT id,type,data FROM data_items WHERE user_id=$1 AND type=ANY($2::text[]) ORDER BY id',
        [userId, TYPES]
      )
    ).rows;
  const stamp = (rows) => hash([VERSION, rows.map((r) => [r.id, r.type, r.data])]);
  const decorate = async (report, userId, rows) => {
    const data=groupRows(rows),stale=!!report.stale;
    const marks=(await pool.query('SELECT finding_id,source_fingerprint,checked_at FROM ai_accounting_reviews WHERE user_id=$1',[userId])).rows;
    const byId=new Map(marks.map(m=>[m.finding_id,m]));
    const salesById=new Map(data.sales.map(s=>[s.id,s]));
    const {repairRebuiltSchedule}=await import(require('url').pathToFileURL(require('path').join(__dirname,'../../shared/saleSchedule.js')).href);
    const findings=report.findings.map(f=>{
      const mark=byId.get(f.id),sale=salesById.get(f.sources.find(ref=>ref.kind==='contract')?.id);
      return {...f,reviewedAt:!stale&&f.severity!=='confirmed'&&mark&&mark.source_fingerprint===reviewFingerprint(f,data,FINDING_VERSION)?mark.checked_at:null,
        repairable:!stale&&f.code==='schedule_review'&&!!sale&&!!repairRebuiltSchedule(sale)};
    });
    const counts={...report.counts,reviewed:findings.filter(f=>f.reviewedAt).length};
    for(const severity of ['confirmed','review','information'])counts[severity]=findings.filter(f=>f.severity===severity&&!f.reviewedAt).length;
    const summary=counts.confirmed?`Найдены несоответствия: ${counts.confirmed}.`:counts.review?`Вопросов для уточнения: ${counts.review}.`:counts.reviewed?'Новых вопросов для проверки нет.':report.summary;
    return {...report,findings,counts,summary};
  };
  const create = async (userId, accountIds = null) => {
    await domain.ready;
    await ready();
    const rows = await load(userId),
      data = groupRows(rows),
      scope = scopeOf(data.accounts, accountIds),
      fingerprint = stamp(rows),
      key = hash(scope.accountIds);
    const previous = (
      await pool.query(
        'SELECT id,report FROM ai_accounting_reports WHERE user_id=$1 AND scope_key=$2 AND fingerprint=$3',
        [userId, key, fingerprint]
      )
    ).rows[0];
    if (previous) return decorate({ ...previous.report, id: previous.id, stale: false, cached: true },userId,rows);
    const report = buildAccountingAudit(data, scope.accountIds),
      id = crypto.randomUUID();
    const saved = (
      await pool.query(
        `INSERT INTO ai_accounting_reports(id,user_id,scope_key,fingerprint,report) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(user_id,scope_key,fingerprint) DO UPDATE SET fingerprint=EXCLUDED.fingerprint RETURNING id,report`,
        [id, userId, key, fingerprint, JSON.stringify(report)]
      )
    ).rows[0];
    return decorate({ ...saved.report, id: saved.id, stale: false, cached: false },userId,rows);
  };
  const stored = async (userId, id) => {
    await domain.ready;
    await ready();
    const row = (
      await pool.query('SELECT id,report,fingerprint FROM ai_accounting_reports WHERE user_id=$1 AND id=$2', [
        userId,
        id,
      ])
    ).rows[0];
    if (!row) fail(404, 'Отчёт недоступен.');
    return row;
  };
  const get = async (userId, id) => {
    const row = await stored(userId, id);
    const rows=await load(userId);
    return decorate({ ...row.report, id: row.id, stale: stamp(rows) !== row.fingerprint },userId,rows);
  };
  const review = async (userId, reportId, findingId, checked) => {
    if(typeof checked!=='boolean')fail(400,'Проверьте действие.');
    const storedReport=await stored(userId,reportId),rows=await load(userId);
    if(stamp(rows)!==storedReport.fingerprint)fail(409,'Проверка устарела. Обновите её.');
    const finding=storedReport.report.findings.find(f=>f.id===findingId);
    if(!finding)fail(404,'Запись проверки недоступна.');
    if(finding.severity==='confirmed')fail(409,'Подтверждённое несоответствие нужно исправить, отметка его не скрывает.');
    if(checked)await pool.query(`INSERT INTO ai_accounting_reviews(user_id,finding_id,source_fingerprint,report_id) VALUES($1,$2,$3,$4)
      ON CONFLICT(user_id,finding_id) DO UPDATE SET source_fingerprint=EXCLUDED.source_fingerprint,report_id=EXCLUDED.report_id,
      checked_at=CASE WHEN ai_accounting_reviews.source_fingerprint=EXCLUDED.source_fingerprint THEN ai_accounting_reviews.checked_at ELSE now() END`,
      [userId,finding.id,reviewFingerprint(finding,groupRows(rows),FINDING_VERSION),reportId]);
    else await pool.query('DELETE FROM ai_accounting_reviews WHERE user_id=$1 AND finding_id=$2',[userId,finding.id]);
    return {ok:true,checked,financialDataChanged:false};
  };
  const findingInput = async (userId, reportId, findingId) => {
    const row=await stored(userId,reportId),rows=await load(userId);
    if(stamp(rows)!==row.fingerprint)fail(409,'Проверка устарела. Обновите её.');
    const finding=row.report.findings.find(f=>f.id===findingId);
    if(!finding)fail(404,'Запись проверки недоступна.');
    return {finding,data:groupRows(rows)};
  };
  const source = async (userId, reportId, kind, id, contractId) => {
    const row = await stored(userId, reportId),
      allowed = row.report.findings
        .flatMap((f) => f.sources)
        .some((s) => s.kind === kind && s.id === id && (s.contractId || null) === (contractId || null));
    if (!allowed) fail(403, 'Эта запись не относится к отчёту.');
    const rows = await load(userId),
      data = groupRows(rows),
      item =
        kind === 'payment'
          ? data.sales.find((s) => s.id === contractId)?.paymentPlan?.find((p) => p.id === id)
          : (kind === 'contract' || kind === 'income'
              ? data.sales
              : kind === 'expense'
              ? data.expenses
              : kind === 'account'
              ? data.accounts
              : []
            ).find((x) => x.id === id);
    if (!item) fail(404, 'Запись удалена или больше недоступна. Обновите проверку.');
    const sale =
      kind === 'contract'
        ? item
        : kind === 'payment'
        ? data.sales.find((s) => s.id === contractId)
        : kind === 'expense' && item.saleId
        ? data.sales.find((s) => s.id === item.saleId)
        : null;
    const accountId = kind === 'account' ? item.id : item.accountId || sale?.accountId;
    // Только необходимые поля. Паспорт, адрес, телефон и заметки в просмотр сверки не попадают.
    return {
      kind,
      id,
      contractId: sale?.id || undefined,
      title: kind === 'payment' ? 'Платёж' : item.productName || item.title || item.name || 'Запись',
      customerId: sale?.customerId,
      customer: sale ? data.customers.find((c) => c.id === sale.customerId)?.name : undefined,
      accountName: data.accounts.find((a) => a.id === accountId)?.name || 'Счёт не найден',
      amount:
        kind === 'contract'
          ? num(item.totalAmount)
          : kind === 'income'
          ? round(domain.collected(item))
          : kind === 'account'
          ? domain.accountBalances(data.accounts, data.sales, data.expenses, data.retailSales)[id]
          : num(item.amount),
      date: item.actualDate || item.date || item.startDate || undefined,
      category: item.category || undefined,
      discountAmount: num(item.discountAmount),
      remainingAmount: sale ? num(sale.remainingAmount) : undefined,
      stale: stamp(rows) !== row.fingerprint,
    };
  };
  const page = async (userId, id, { offset = 0, limit = 30, severity, kind, status = 'open' } = {}) => {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100)
      fail(400, 'Некорректная страница отчёта.');
    if (severity && !['confirmed', 'review', 'information'].includes(severity))
      fail(400, 'Неизвестный вид проверки.');
    if (kind && !['contract', 'payment', 'expense', 'account', 'income'].includes(kind))
      fail(400, 'Неизвестный вид записи.');
    if(!['open','reviewed','all'].includes(status))fail(400,'Неизвестная группа проверки.');
    const report = await get(userId, id),
      list = report.findings.filter(
        (f) => (!severity || f.severity === severity) && (!kind || f.sources.some((s) => s.kind === kind)) &&
          (status==='all'||(status==='reviewed'?!!f.reviewedAt:!f.reviewedAt))
      );
    return {
      ...report,
      findings: list.slice(offset, offset + limit),
      findingsTotal: list.length,
      offset,
      hasMore: offset + limit < list.length,
    };
  };
  const compact = (report) => ({
    id: report.id,
    calculatedAt: report.calculatedAt,
    scope: report.scope,
    counts: report.counts,
    checked: report.checked,
    summary: report.summary,
    stale: report.stale,
  });
  return { create, get, page, source, compact, ready, review, findingInput };
}
module.exports = { buildAccountingAudit, createAccountingAudits, groupRows, scopeOf, VERSION };
