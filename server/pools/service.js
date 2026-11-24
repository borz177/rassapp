const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const modulePromise = import(pathToFileURL(path.resolve(__dirname, '../../shared/profit.js')).href);
const fundingPromise = import(pathToFileURL(path.resolve(__dirname, '../../shared/funding.js')).href);
const { hash } = require('../ai/canonical');
const round = n => Math.round(n * 100) / 100;
const fail = (status, message) => { throw Object.assign(new Error(message), { status, poolAccounting: true }); };
const money = n => { if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e11 || Math.round(n * 100) !== n * 100 && Math.abs(Math.round(n * 100) - n * 100) > 1e-5)
    fail(400, 'Укажите сумму с точностью до копеек.'); return Math.round(n * 100) / 100; };
const rate = n => { if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100)
    fail(400, 'Доля прибыли должна быть от 0 до 100%.'); return n; };
const validMonth = m => typeof m === 'string' && /^20\d{2}-(0[1-9]|1[0-2])$/.test(m);
const disposition = d => { if (!['PAYABLE', 'REINVEST'].includes(d))
    fail(400, 'Выберите, что делать с прибылью.'); return d; };

function historyIssues(P, account, members, sales, expenses, reports, rows) {
    const issues = [];
    if (!validMonth(reports[0]?.month)) issues.push('Проверьте дату начала истории пула.');
    if ((account.poolMemberIds || []).some(id => !members.some(i => i.id === id))) issues.push('В пуле есть отсутствующий участник.');
    if (expenses.some(e => e.payoutType === 'PROFIT' && !members.some(i => i.id === e.investorId))) issues.push('В истории есть выплата без участника пула.');
    for (const i of members) {
        const periods = i.investmentPeriods?.length ? i.investmentPeriods : [i];
        const links = new Map(periods.flatMap(p => (p.capitalChanges || []).filter(e => e.sourceId).map(e => [e.sourceId, e])));
        const matches = (id, date, amount) => {
            const change = links.get(id);
            return change && Math.abs(Number(change.delta) - amount) < 0.005 && P.poolTime(change.date) === P.poolTime(date);
        };
        const openings = new Map(periods.map(p => [p, Number(p.initialAmount) - (p.capitalChanges || []).reduce((sum, e) => sum + Number(e.delta), 0)]));
        const deposits = sales.filter(s => s.type === 'CASH' && s.totalAmount > 0 && [i.id, `system_deposit_${i.id}`].includes(s.customerId));
        const returns = expenses.filter(e => e.investorId === i.id && e.payoutType === 'INVESTMENT' && e.amount > 0);
        const unresolved = deposits.filter(s => {
            if (links.has(s.id)) return !matches(s.id, s.startDate, s.totalAmount);
            const opening = [...openings].find(([p, amount]) => Math.abs(amount - s.totalAmount) < 0.005 && Math.abs(P.poolTime(p.joinedDate) - P.poolTime(s.startDate)) < 86400000);
            if (opening) openings.delete(opening[0]);
            return !opening;
        }).length + returns.filter(e => !matches(e.id, e.date, -Number(e.amount))).length;
        if (unresolved) issues.push(`${i.name}: операций капитала, требующих сверки — ${unresolved}.`);
    }
    for (const report of reports) {
        if (report.issues.length) issues.push(`${report.month}: ${report.issues[0]}`);
        if (report.unallocated > 0) issues.push(`${report.month}: есть прибыль без подтверждённого капитала.`);
    }
    for (const row of rows) {
        const paid = expenses.filter(e => row.id === '__manager__'
            ? e.category === 'Моя выплата' && e.managerPayoutSource !== 'CAPITAL'
            : e.payoutType === 'PROFIT' && e.investorId === row.id).reduce((sum, e) => sum + Number(e.amount), 0);
        row.paid = round(paid);
        const personal = row.id === '__manager__' ? expenses.filter(e => e.fromProfit && e.profitSource === 'MANAGER' && e.category !== 'Моя выплата' && !['PROFIT', 'INVESTMENT'].includes(e.payoutType)).reduce((sum, e) => sum + Number(e.amount), 0) : 0;
        if (![row.current, row.proposed, paid, personal].every(Number.isFinite)) issues.push(`${row.name}: проверьте суммы начислений и выплат.`);
        if (paid > 0 && row.proposed < round(paid + personal)) issues.push(`${row.name}: по новому расчёту не хватает прибыли на проведённые выплаты.`);
    }
    return [...new Set(issues)];
}

const projection = (item, cutoff, P) => !item ? null : item.type === 'CASH' ? item : {
    accountId: item.accountId, funding: item.funding, customerId: item.customerId, type: item.type, buyPrice: item.buyPrice, totalAmount: item.totalAmount,
    downPayment: item.downPayment, startDate: item.startDate,
    payments: (item.paymentPlan || []).filter(p => p.isPaid && p.isRealPayment !== false && P.poolTime(p.date) < cutoff)
        .map(p => ({ id: p.id, date: p.date, amount: p.amount, discountAmount: p.discountAmount, discountFromProfit: p.discountFromProfit })).sort((a, b) => a.id.localeCompare(b.id)),
};
const applyCapitalChange = (P, investor, delta, date, sourceId, floor, at) => {
    const time = P.poolTime(date);
    if (!Number.isFinite(time) || time < floor || time > at + 1000)
        fail(409, 'Выберите дату открытого периода, не позднее сегодняшней.');
    const periods = investor.investmentPeriods?.length ? investor.investmentPeriods : [{ id: 'legacy', joinedDate: investor.joinedDate, leftPoolDate: investor.leftPoolDate, initialAmount: investor.initialAmount, capitalChanges: [] }];
    const period = periods.find(p => P.periodActiveAt(p, time));
    if (!period)
        fail(409, 'На выбранную дату инвестор не участвует в пуле.');
    if (delta < 0)
        for (const c of period.capitalChanges || [])
            if (P.poolTime(c.date) > time && P.getInvestorAmountAt({ ...investor, investmentPeriods: periods }, P.poolTime(c.date)) + delta < 0)
                fail(409, 'Возврат создаёт отрицательный капитал в истории. Проверьте дату.');
    const next = money(Number(period.initialAmount) + delta);
    if (next < 0 || P.getInvestorAmountAt({ ...investor, investmentPeriods: periods }, time) + delta < 0)
        fail(409, 'Недостаточно вложенного капитала.');
    period.initialAmount = next;
    period.capitalChanges = [...(period.capitalChanges || []), { id: `cap_${sourceId}`, date: new Date(time).toISOString(), delta, sourceId }];
    investor.investmentPeriods = periods;
    investor.initialAmount = money(Number(investor.initialAmount) + delta);
};
function createPoolService({ pool, checkFeatureAccess, getSubscriptionState, getInvestorLimitState, now = () => Date.now() }) {
    const load = async (db, owner) => { const rows = (await db.query("SELECT type,data FROM data_items WHERE user_id=$1 AND type=ANY($2::text[])", [owner, ['accounts', 'investors', 'sales', 'expenses', 'settings', 'retailSales']])).rows; return Object.fromEntries(['accounts', 'investors', 'sales', 'expenses', 'settings', 'retailSales'].map(type => [type, rows.filter(r => r.type === type).map(r => r.data)])); };
    const save = async (db, owner, type, item) => { item.userId = owner; const r = await db.query(`INSERT INTO data_items(id,user_id,type,data,updated_at) VALUES($1,$2,$3,$4,NOW()) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW() WHERE data_items.user_id=EXCLUDED.user_id AND data_items.type=EXCLUDED.type RETURNING id`, [item.id, owner, type, JSON.stringify(item)]); if (!r.rows.length)
        fail(409, 'Запись уже существует. Обновите данные.'); };
    const reports = async (data, account, at = now()) => { const P = await modulePromise, F = await fundingPromise; return P.poolMonthlyReports(account, data.investors, F.expandFundedSales(data.sales), data.expenses, at, !!data.settings[0]?.profitFromPaymentsOnly); };
    const cashAvailable = async (data, account) => {
        const P = await modulePromise, domain = require('../api/domain');
        await domain.ready;
        const cutoff = now(), sales = data.sales.map(s => ({ ...s, downPayment: P.poolTime(s.startDate) <= cutoff ? s.downPayment : 0, paymentPlan: (s.paymentPlan || []).filter(p => P.poolTime(p.date) <= cutoff) }));
        const retail = (data.retailSales || []).filter(r => P.poolTime(r.date) <= cutoff).map(r => ({ ...r, payments: (r.payments || []).filter(p => P.poolTime(p.date) <= cutoff) }));
        return domain.accountBalances(data.accounts, sales, data.expenses.filter(e => P.poolTime(e.date) <= cutoff), retail)[account.id] || 0;
    };
    const balances = async (data, account, at = now()) => {
        const P = await modulePromise, F = await fundingPromise, ss = F.expandFundedSales(data.sales), start = P.poolMonthStart(account.poolAccounting.startMonth), paymentsOnly = account.poolAccounting.profitFromPaymentsOnly ?? !!data.settings[0]?.profitFromPaymentsOnly;
        const scoped = data.expenses.filter(e => e.accountId === account.id && P.poolTime(e.date) <= at);
        const investorBalances = {};
        for (const id of account.poolMemberIds || []) {
            const accr = P.investorProfitAccruals(account, data.investors, ss, id, paymentsOnly, scoped, at);
            const confirmed = accr.filter(a => !a.preliminary).reduce((n, a) => n + a.amount, 0), pending = accr.filter(a => a.preliminary).reduce((n, a) => n + a.amount, 0);
            const paid = scoped.filter(e => e.payoutType === 'PROFIT' && e.investorId === id).reduce((n, e) => n + Number(e.amount || 0), 0);
            const legacyCosts = scoped.filter(e => P.poolTime(e.date) < start && e.fromProfit && e.profitSource !== 'MANAGER' && e.payoutType !== 'PROFIT' && e.payoutType !== 'INVESTMENT')
                .reduce((n, e) => n + Number(e.amount || 0) * (P.getAccountShares(account, data.investors, e.date).find(s => s.investor.id === id)?.percentage || 0) / 100, 0);
            const reinvested = P.poolReinvested(account, id, -Infinity, at);
            investorBalances[id] = { earned: round(confirmed + pending), confirmed: round(confirmed), pending: round(pending), paid: round(paid), reinvested: round(reinvested), available: round(confirmed + pending - paid - legacyCosts - reinvested) };
        }
        let managerEarned = 0;
        for (const s of ss.filter(s => s.accountId === account.id && s.buyPrice > 0 && s.totalAmount > s.buyPrice))
            for (const p of P.poolMoneyIn(s)) {
                if (P.poolTime(p.date) > at || P.monthlyPoolApplies(account, p.date) && !account.poolAccounting.excludedSaleIds.includes(s.id))
                    continue;
                managerEarned += P.moneyInProfit(s, p, paymentsOnly) * P.paymentManagerPercent(account, data.investors, s, p) / 100;
            }
        const monthlyReports = await reports(data, account, at);
        const managerPending = monthlyReports.filter(r => r.status !== 'CLOSED').reduce((n, r) => n + (r.allocations.find(a => a.id === '__manager__')?.amount || 0), 0);
        managerEarned += monthlyReports.filter(r => r.status === 'CLOSED').reduce((n, r) => n + (r.allocations.find(a => a.id === '__manager__')?.amount || 0), 0);
        const managerOut = scoped.reduce((n, e) => {
            if (e.category === 'Моя выплата')
                return n + (e.managerPayoutSource === 'CAPITAL' ? 0 : Number(e.amount || 0));
            if (!e.fromProfit || e.payoutType === 'PROFIT' || e.payoutType === 'INVESTMENT')
                return n;
            if (e.profitSource === 'MANAGER')
                return n + Number(e.amount || 0);
            return n + (P.poolTime(e.date) < start ? Number(e.amount || 0) * P.getManagerSharePercent(account, data.investors, e.date) / 100 : 0);
        }, 0);
        const managerPaid = scoped.filter(e => e.category === 'Моя выплата' && e.managerPayoutSource !== 'CAPITAL').reduce((n, e) => n + Number(e.amount || 0), 0);
        return { investors: investorBalances, manager: { earned: round(managerEarned + managerPending), pending: round(managerPending), confirmed: round(managerEarned), paid: round(managerPaid), other: round(managerOut - managerPaid), available: round(managerEarned + managerPending - managerOut) } };
    };
    const closeReport = async (data, account, report, changedInvestors, P, at) => {
        if (report?.issues?.length) fail(409, `${report.month}: ${report.issues[0]}`);
        if (!report || report.unallocated > 0 || ![report.gross, report.costs, report.distributable, report.carryOut, ...report.allocations.map(r => r.amount)].every(Number.isFinite))
            fail(409, 'Проверьте капитал участников: есть нераспределённая прибыль.');
        account.poolAccounting.closed.push({ ...report, status: 'CLOSED' });
        for (const row of report.allocations) {
            if (row.id === '__manager__' || row.amount <= 0 || P.poolProfitDisposition(account, row.id, P.poolMonthStart(P.nextPoolMonth(report.month)) - 1) !== 'REINVEST') continue;
            const investor = data.investors.find(i => i.id === row.id), date = new Date(P.poolMonthStart(P.nextPoolMonth(report.month))).toISOString();
            if (!P.isPoolMemberActiveAt(investor, P.poolTime(date))) continue;
            const balanceAtEnd = (await balances(data, account, P.poolTime(date) - 1)).investors[row.id];
            const reinvestAmount = round(Math.min(row.amount, Math.max(0, balanceAtEnd?.available || 0)));
            if (!reinvestAmount) continue;
            applyCapitalChange(P, investor, reinvestAmount, date, `reinvest_${report.month}_${row.id}`, P.poolMonthStart(report.month), at);
            if (!changedInvestors.includes(investor)) changedInvestors.push(investor);
            account.poolAccounting.reinvestments.push({ id: `reinvest_${report.month}_${row.id}`, investorId: row.id, date, amount: reinvestAmount, month: report.month });
        }
    };
    // Просмотр и подтверждение проходят одни и те же месяцы последовательно.
    // Реинвестирование раннего месяца участвует в расчёте последующих уже в сводке.
    const completedPlan = async (source, id, requestedThrough) => {
        const P = await modulePromise, F = await fundingPromise, at = now();
        const data = structuredClone(source), account = data.accounts.find(a => a.id === id);
        if (!P.isMonthlyPool(account)) fail(409, 'Сначала включите месячный учёт.');
        const config = account.poolAccounting, current = P.poolMonth(at);
        const throughMonth = requestedThrough ?? P.poolMonth(P.poolMonthStart(current) - 1);
        if (!validMonth(throughMonth) || throughMonth >= current) fail(400, 'Подтверждать можно только завершённые месяцы.');
        const last = [...config.closed].sort((a, b) => a.month.localeCompare(b.month)).at(-1);
        let month = last ? P.nextPoolMonth(last.month) : config.startMonth;
        const fromMonth = month, months = [], changedInvestors = [];
        const sales = F.expandFundedSales(data.sales);
        while (month <= throughMonth) {
            const report = P.poolMonthlyReport(account, data.investors, sales, data.expenses, month, at, !!data.settings[0]?.profitFromPaymentsOnly);
            await closeReport(data, account, report, changedInvestors, P, at);
            months.push(report);
            month = P.nextPoolMonth(month);
        }
        const before = await balances(source, source.accounts.find(a => a.id === id)), after = await balances(data, account);
        const rows = ['__manager__', ...(account.poolMemberIds || [])].map(id => {
            const b = id === '__manager__' ? before.manager : before.investors[id];
            const a = id === '__manager__' ? after.manager : after.investors[id];
            return { id, name: id === '__manager__' ? 'Моя прибыль' : data.investors.find(i => i.id === id)?.name || 'Участник',
                amount: round(months.reduce((n, r) => n + (r.allocations.find(a => a.id === id)?.amount || 0), 0)),
                confirmed: a.confirmed, paid: a.paid || 0, reinvested: a.reinvested || 0,
                other: round(a.confirmed - (a.paid || 0) - (a.reinvested || 0) - a.available),
                availableBefore: b.available, availableAfter: a.available };
        });
        if (rows.some(row => ['amount', 'confirmed', 'paid', 'reinvested', 'other', 'availableBefore', 'availableAfter'].some(key => !Number.isFinite(row[key]))))
            fail(409, 'Проверьте суммы выплат и расходов пула.');
        const confirmation = { fromMonth, throughMonth, count: months.length, lastConfirmedMonth: last?.month, rows,
            fingerprint: hash({ id, revision: config.revision || 0, throughMonth, months, rows, investors: changedInvestors }) };
        return { data, account, changedInvestors, confirmation };
    };
    const previewData = async (data, id, options = {}, applyHistory) => {
        const P = await modulePromise, account = data.accounts.find(a => a.id === id && a.type === 'POOL');
        if (!account)
            fail(404, 'Пул не найден.');
        const historicalContracts = data.sales.filter(s => s.type === 'INSTALLMENT' && (s.accountId === id || s.funding?.some(f => f.accountId === id))).map(s => ({ id: s.id, productName: s.productName, date: s.startDate, previouslyPersonal: !P.getAccountShares(account, data.investors, s.startDate).length }));
        let comparison;
        if (!account.poolAccounting) {
            const to = now(), month = P.poolMonth(to), history = options.history === true;
            const excluded = options.excludedSaleIds || historicalContracts.filter(s => s.previouslyPersonal).map(s => s.id);
            if (!Array.isArray(excluded) || excluded.some(id => !historicalContracts.some(s => s.id === id)))
                fail(400, 'Проверьте список личных договоров.');
            const F = await fundingPromise, ss = F.expandFundedSales(data.sales).filter(s => s.accountId === id);
            const members = data.investors.filter(i => (account.poolMemberIds || []).includes(i.id));
            const expenses = data.expenses.filter(e => e.accountId === id);
            const paymentsOnly = !!data.settings[0]?.profitFromPaymentsOnly;
            const dates = [to];
            if (history) {
                for (const i of members) for (const p of i.investmentPeriods?.length ? i.investmentPeriods : [i]) dates.push(P.poolTime(p.joinedDate));
                for (const s of ss) for (const p of P.poolMoneyIn(s)) if (p.amount > 0 || p.discountAmount > 0) dates.push(P.poolTime(p.date));
                for (const e of expenses) dates.push(P.poolTime(e.date));
            }
            const startMonth = P.poolMonth(dates.reduce((min, date) => Number.isFinite(date) ? Math.min(min, date) : min, to));
            const from = P.poolMonthStart(startMonth), inside = date => P.poolTime(date) >= from && P.poolTime(date) <= to;
            const terms = { date: new Date(from).toISOString(), members: Object.fromEntries(members.map(i => [i.id, { rate: Number(i.profitPercentage), disposition: 'PAYABLE' }])), managerShareSplit: account.managerShareSplit || [] };
            const proposal = { ...account, poolAccounting: { version: 1, startMonth, profitFromPaymentsOnly: paymentsOnly, openingTerms: terms, terms: [terms], closed: [], reinvestments: [], excludedSaleIds: [...new Set(excluded)].sort(), requests: [] } };
            const monthly = P.poolMonthlyReports(proposal, data.investors, ss, expenses, to, paymentsOnly);
            const proposedProfit = recipient => monthly.reduce((sum, r) => sum + (r.allocations.find(a => a.id === recipient)?.amount || 0), 0);
            const shared = data.expenses.filter(e => e.accountId === id && inside(e.date) && e.fromProfit && e.profitSource !== 'MANAGER' && e.category !== 'Моя выплата' && e.payoutType !== 'PROFIT' && e.payoutType !== 'INVESTMENT');
            const legacyGross = new Map();
            const profitableSales = ss.filter(s => s.buyPrice > 0 && s.totalAmount > s.buyPrice);
            for (const s of profitableSales) for (const p of P.poolMoneyIn(s)) {
                if (!inside(p.date) || !(p.amount > 0 || p.discountAmount > 0)) continue;
                const profit = P.moneyInProfit(s, p, paymentsOnly);
                const shares = P.paymentProfitShares(account, data.investors, s, p);
                const managerPct = Math.max(0, 100 - shares.reduce((sum, row) => sum + row.percentage, 0));
                legacyGross.set('__manager__', (legacyGross.get('__manager__') || 0) + profit * managerPct / 100);
                for (const { investor, percentage } of shares) legacyGross.set(investor.id, (legacyGross.get(investor.id) || 0) + profit * percentage / 100);
            }
            const rows = members.map(i => {
                const gross = legacyGross.get(i.id) || 0;
                const cost = shared.reduce((n, e) => n + Number(e.amount || 0) * (P.getAccountShares(account, data.investors, e.date).find(s => s.investor.id === i.id)?.percentage || 0) / 100, 0);
                return { id: i.id, name: i.name, current: round(gross - cost), proposed: round(proposedProfit(i.id)) };
            });
            const managerCost = shared.reduce((n, e) => n + Number(e.amount || 0) * P.getManagerSharePercent(account, data.investors, e.date) / 100, 0);
            const personal = profitableSales.filter(s => excluded.includes(s.id)).reduce((n, s) => n + P.poolMoneyIn(s).filter(p => inside(p.date)).reduce((n, p) => n + P.moneyInProfit(s, p, paymentsOnly), 0), 0);
            rows.push({ id: '__manager__', name: 'За управление и личные договоры', current: round((legacyGross.get('__manager__') || 0) - managerCost), proposed: round(proposedProfit('__manager__') + personal) });
            comparison = { month, asOf: new Date(to).toISOString(), rows };
            if (history) {
                const issues = historyIssues(P, account, members, ss.filter(s => inside(s.startDate)), expenses.filter(e => inside(e.date)), monthly, rows);
                const sort = items => [...items].sort((a, b) => a.id.localeCompare(b.id));
                const sources = monthly.map(r => ({ month: r.month, sources: r.sources.map(s => [s.saleId, s.paymentId]).sort(), costs: r.costRows.map(e => e.id).sort() }));
                const fingerprint = hash({ account, terms, excluded: proposal.poolAccounting.excludedSaleIds, paymentsOnly, month, investors: sort(members), sales: sort(ss), expenses: sort(expenses), sources, rows: sort(rows) });
                comparison = { ...comparison, startMonth, issues, fingerprint };
                if (applyHistory && !issues.length)
                    applyHistory({ ...proposal.poolAccounting, closed: monthly.filter(r => r.month < month).map(r => ({ ...r, status: 'CLOSED' })) });
            }
        }
        const confirmation = options.closeCompleted ? (await completedPlan(data, id)).confirmation : undefined;
        return { account, investors: data.investors.filter(i => account.poolMemberIds?.includes(i.id)), balances: account.poolAccounting ? await balances(data, account) : undefined, confirmation,
            historicalContracts, comparison,
            reports: account.poolAccounting ? (await reports(data, account)).map(r => ({ ...r, fingerprint: hash(r) })) : [] };
    };
    const settleOwner = async (owner, accountId = null) => {
        const P = await modulePromise, current = P.poolMonth(now()), previousMonth = P.poolMonth(P.poolMonthStart(current) - 1);
        const changed = { accounts: [], investors: [] }, issues = [];
        const due = await pool.query(`SELECT 1 FROM data_items WHERE user_id=$1 AND type='accounts'
          AND ($2::text IS NULL OR id=$2) AND data->'poolAccounting'->>'version'='1'
          AND data->'poolAccounting'->>'startMonth'<$3
          AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(data->'poolAccounting'->'closed','[]'::jsonb)) r WHERE r->>'month'=$4) LIMIT 1`,[owner,accountId,current,previousMonth]);
        if (!due.rows.length) return { changed, issues };
        const db = await pool.connect();
        try {
            await db.query('BEGIN');
            await db.query("SET LOCAL lock_timeout='10s'"); await db.query("SET LOCAL statement_timeout='30s'");
            const user = (await db.query('SELECT id,role,blocked FROM users WHERE id=$1 FOR UPDATE',[owner])).rows[0];
            if (!user || user.blocked || !['manager','admin'].includes(user.role)) { await db.query('COMMIT'); return { changed, issues }; }
            await db.query('SELECT id FROM data_items WHERE user_id=$1 ORDER BY id FOR UPDATE',[owner]);
            const data = await load(db,owner);
            for (const account of data.accounts.filter(a=>P.isMonthlyPool(a)&&(!accountId||a.id===accountId))) {
                if (account.poolAccounting.startMonth>=current || account.poolAccounting.closed?.some(r=>r.month===previousMonth)) continue;
                try {
                    const plan = await completedPlan(data,account.id,previousMonth);
                    if (!plan.confirmation.count) continue;
                    account.poolAccounting = plan.account.poolAccounting;
                    account.poolAccounting.revision = Number(account.poolAccounting.revision||0)+1;
                    changed.accounts.push(account);
                    for (const investor of plan.changedInvestors) {
                        data.investors[data.investors.findIndex(i=>i.id===investor.id)] = investor;
                        const index=changed.investors.findIndex(i=>i.id===investor.id);
                        if(index<0)changed.investors.push(investor);else changed.investors[index]=investor;
                    }
                } catch(e) { if(!e.poolAccounting)throw e;issues.push({accountId:account.id,message:e.message}); }
            }
            for (const investor of changed.investors) await save(db,owner,'investors',investor);
            for (const account of changed.accounts) await save(db,owner,'accounts',account);
            await db.query('COMMIT');
            return { changed, issues };
        } catch(e) { await db.query('ROLLBACK').catch(()=>{});throw e; }
        finally { db.release(); }
    };
    const preview = async (owner, id, options = {}) => {
        const automatic = await settleOwner(owner,id);
        return { ...await previewData(await load(pool,owner),id,options), settlementIssues:automatic.issues,
            ...(automatic.changed.accounts.length?{changed:automatic.changed}:{}) };
    };
    const guardWrite = async (owner, type, item, previous = null, isDelete = false) => {
        if (!['accounts', 'investors', 'sales', 'expenses', 'settings', 'retailSales'].includes(type))
            return;
        const P = await modulePromise;
        await settleOwner(owner);
        const data = await load(pool, owner), active = data.accounts.filter(P.isMonthlyPool);
        if (previous?.id) previous = data[type]?.find(r=>r.id===previous.id) || previous;
        if (type === 'settings' && !previous)
            previous = data.settings[0];
        if (type === 'accounts' && (hash(item?.poolAccounting ?? null) !== hash(previous?.poolAccounting ?? null) || hash(item?.poolRequests ?? null) !== hash(previous?.poolRequests ?? null)))
            fail(409, 'Месячный учёт изменяется в настройках общего пула.');
        const touches = (item, a) => item && (item.accountId === a.id || item.funding?.some(f => f.accountId === a.id));
        const tracked = !isDelete && item && ['sales', 'expenses'].includes(type) && active.some(a => touches(item, a) || touches(previous, a));
        const originalHash = tracked ? hash(Object.fromEntries(Object.entries(item).filter(([key]) => !['poolRevision', '_poolWriteHash'].includes(key)))) : null;
        let replay = false;
        if (tracked && Number(item.poolRevision || 0) !== Number(previous?.poolRevision || 0)) {
            if (previous?._poolWriteHash !== originalHash)
                fail(409, 'Запись изменилась на другом устройстве. Обновите данные перед сохранением.');
            for (const key of Object.keys(item))
                delete item[key];
            Object.assign(item, structuredClone(previous));
            replay = true;
        }
        for (const a of active) {
            const belongs = s => s && a.poolMemberIds.some(id => s.customerId === id || s.customerId === `system_deposit_${id}`);
            if (type === 'sales' && item?.type === 'CASH' && belongs(item) && item.accountId !== a.id)
                fail(409, 'Вложения этого инвестора учитываются в общем пуле.');
            if (type === 'expenses' && ['INVESTMENT', 'PROFIT'].includes(item?.payoutType) && a.poolMemberIds.includes(item.investorId) && item.accountId !== a.id)
                fail(409, 'Выберите общий пул этого инвестора.');
            const c = a.poolAccounting, closed = [...(c.closed || [])].sort((x, y) => x.month.localeCompare(y.month)).at(-1), cutoff = closed ? P.poolMonthStart(P.nextPoolMonth(closed.month)) : Math.min(P.poolMonthStart(c.startMonth), P.poolMonthStart(P.poolMonth(now())));
            if (type === 'accounts' && a.id === (item || previous)?.id) {
                if (isDelete)
                    fail(409, 'Пул с месячным учётом можно архивировать, но нельзя удалить.');
                for (const key of ['type', 'poolMemberIds', 'managerShareSplit', 'lossEvents', 'initialBalance', 'ownerId'])
                    if (hash(item?.[key] ?? null) !== hash(previous?.[key] ?? null))
                        fail(409, 'Состав и условия изменяются в настройках общего пула.');
            }
            if (type === 'investors' && a.poolMemberIds?.includes((item || previous)?.id)) {
                if (isDelete)
                    fail(409, 'Оформите выход инвестора через общий пул. История должна сохраниться.');
                for (const key of ['id', 'initialAmount', 'profitPercentage', 'joinedDate', 'leftPoolDate', 'investmentPeriods'])
                    if (hash(item?.[key] ?? null) !== hash(previous?.[key] ?? null))
                        fail(409, 'Капитал, даты и условия изменяются в окне общего пула.');
            }
            const touched = s => s && (s.accountId === a.id || s.funding?.some(f => f.accountId === a.id));
            if (type === 'sales' && (touched(item) || touched(previous))) {
                const capital = s => s && (s.type === 'CASH') && (a.poolMemberIds || []).some(id => s.customerId === id || s.customerId === `system_deposit_${id}`);
                if (capital(item) || capital(previous))
                    fail(409, 'Пополнение и возврат капитала оформляются через общий пул.');
                if (cutoff) {
                    if (previous && (P.poolTime(previous.startDate) < cutoff || (previous.paymentPlan || []).some(p => p.isPaid && p.isRealPayment !== false && P.poolTime(p.date) < cutoff)) && hash(projection(item, cutoff, P)) !== hash(projection(previous, cutoff, P)))
                        fail(409, 'Данные входят в закрытый месяц. Нужна отдельная корректировка.');
                    if (!previous && P.poolTime(item.startDate) < cutoff)
                        fail(409, 'Нельзя добавлять договор в закрытый месяц.');
                    const old = new Set((previous?.paymentPlan || []).filter(p => p.isPaid && p.isRealPayment !== false).map(p => p.id));
                    if ((item?.paymentPlan || []).some(p => p.isPaid && p.isRealPayment !== false && !old.has(p.id) && P.poolTime(p.date) < cutoff))
                        fail(409, 'Платёж относится к закрытому месяцу.');
                }
            }
            if (type === 'expenses' && touched(item) && !isDelete && (item.payoutType === 'PROFIT' || item.category === 'Моя выплата' && item.managerPayoutSource !== 'CAPITAL')) {
                if ((await reports(data,a)).some(r=>r.issues?.length||r.unallocated>0)) fail(409,'Проверьте расчёт пула: есть ошибки в данных.');
                const amount = money(item.amount);
                if (amount <= 0 || P.poolTime(item.date) > now() + 1000)
                    fail(400, 'Проверьте сумму и дату выплаты.');
                const copy = { ...data, expenses: data.expenses.filter(e => e.id !== item.id) }, b = await balances(copy, a);
                if (item.payoutType === 'PROFIT' && !a.poolMemberIds.includes(item.investorId))
                    fail(400, 'Выберите инвестора общего пула.');
                const available = item.payoutType === 'PROFIT' ? b.investors[item.investorId]?.available : b.manager.available;
                if ((await cashAvailable(copy, a)) < amount)
                    fail(409, 'На счёте недостаточно денег для выплаты.');
                if (!Number.isFinite(available) || amount > available)
                    fail(409, 'Недостаточно доступной прибыли.');
            }
            if (type === 'expenses' && (touched(item) || touched(previous))) {
                if (item?.payoutType === 'INVESTMENT' || previous?.payoutType === 'INVESTMENT' || item?.category === 'Моя выплата' && item?.managerPayoutSource === 'CAPITAL')
                    fail(409, 'Возврат капитала оформляется через общий пул.');
                if (cutoff && ((previous && P.poolTime(previous.date) < cutoff) || (!previous && P.poolTime(item.date) < cutoff)))
                    if (hash(item) !== hash(previous))
                        fail(409, 'Расход относится к закрытому месяцу.');
            }
        }
        if (tracked && !replay) {
            item.poolRevision = Number(previous?.poolRevision || 0) + 1;
            item._poolWriteHash = originalHash;
        }
    };
    const mutate = async (owner, accountId, action, input = {}) => {
        if (typeof input.requestId !== 'string' || !/^[\w-]{12,120}$/.test(input.requestId))
            fail(400, 'Обновите идентификатор операции.');
        if (accountId === 'new' && action === 'addInvestor' && input.newPoolName)
            accountId = `pool_${crypto.createHash('sha256').update(JSON.stringify([owner, input.requestId])).digest('hex').slice(0, 20)}`;
        const automatic = await settleOwner(owner,accountId);
        if (automatic.issues.length) fail(409,automatic.issues[0].message);
        const P = await modulePromise, F = await fundingPromise, db = await pool.connect();
        let done = false, released = false;
        try {
            await db.query('BEGIN');
            await db.query("SET LOCAL lock_timeout='10s'");
            await db.query("SET LOCAL statement_timeout='30s'");
            const user = (await db.query('SELECT id,role,blocked FROM users WHERE id=$1 FOR UPDATE', [owner])).rows[0];
            if (!user || user.blocked || !['manager', 'admin'].includes(user.role))
                fail(403, 'Операция доступна владельцу аккаунта.');
            if (getSubscriptionState && (await getSubscriptionState(owner)).expired)
                fail(403, 'Продлите подписку для изменения учёта.');
            if (checkFeatureAccess && !(await checkFeatureAccess(owner, 'investorPools')).allowed)
                fail(403, 'Общий пул недоступен на текущем тарифе.');
            await db.query('SELECT id FROM data_items WHERE user_id=$1 ORDER BY id FOR UPDATE', [owner]);
            const data = await load(db, owner);
            let account = data.accounts.find(a => a.id === accountId && a.type === 'POOL');
            if (!account && action === 'addInvestor' && input.newPoolName) {
                account = { id: accountId, userId: owner, name: String(input.newPoolName).trim().slice(0, 120), type: 'POOL', poolMemberIds: [], currency: 'RUB' };
                data.accounts.push(account);
            }
            if (!account)
                fail(404, 'Пул не найден.');
            if (account.isArchived)
                fail(409, 'Сначала верните пул из архива.');
            if (getInvestorLimitState) {
                const limits = await getInvestorLimitState(owner);
                if (limits.lockedAccountIds.includes(account.id) || input.investorId && limits.lockedIds.includes(input.investorId))
                    fail(403, 'Инвестор заблокирован по лимиту тарифа.');
            }
            const requestHash = hash([action, input]);
            const previousRequest = [...(account.poolAccounting?.requests || []), ...(account.poolRequests || [])].find(r => r.id === input.requestId);
            if (previousRequest) {
                if (previousRequest.hash !== requestHash)
                    fail(409, 'Этот запрос уже использован с другими данными.');
                await db.query('COMMIT');
                done = true;
                db.release();
                released = true;
                return { ...await previewData(data, accountId), replayed: true, changed: { accounts: [account], investors: data.investors.filter(i => account.poolMemberIds.includes(i.id)), sales: data.sales.filter(s => s.accountId === account.id || s.funding?.some(f => f.accountId === account.id)), expenses: data.expenses.filter(e => e.accountId === account.id) } };
            }
            const changedInvestors = data.investors.filter(i=>automatic.changed.investors.some(c=>c.id===i.id)), changedSales = [], changedExpenses = [];
            const stamp = new Date(now()).toISOString();
            const initialize = month => { if (!validMonth(month))
                fail(400, 'Выберите месяц перехода.'); if (data.expenses.some(e => e.accountId === account.id && e.payoutType === 'PROFIT' && !e.investorId))
                fail(409, 'В истории есть выплата без инвестора. Укажите получателя перед переходом.'); if (new Set(account.poolMemberIds || []).size !== (account.poolMemberIds || []).length)
                fail(409, 'Проверьте повторяющихся участников.'); if ((account.managerShareSplit || []).some(s => !Number.isFinite(Number(s.percent)) || Number(s.percent) < 0 || Number(s.percent) > 100) || (account.managerShareSplit || []).reduce((n, s) => n + Number(s.percent), 0) > 100)
                fail(409, 'Проверьте доли за управление перед переходом.'); const members = Object.fromEntries((account.poolMemberIds || []).map(id => { const i = data.investors.find(i => i.id === id); if (!i)
                fail(409, 'В пуле есть отсутствующий участник. Сначала проверьте состав.'); return [id, { rate: rate(Number(i.profitPercentage)), disposition: 'PAYABLE' }]; })); const openingTerms = { date: new Date(P.poolMonthStart(month)).toISOString(), members, managerShareSplit: account.managerShareSplit || [] }; account.poolAccounting = { version: 1, startMonth: month, profitFromPaymentsOnly: !!data.settings[0]?.profitFromPaymentsOnly, openingTerms, terms: [openingTerms], closed: [], excludedSaleIds: [], reinvestments: [], requests: [] }; };
            if (action === 'enableHistory') {
                if (account.poolAccounting) fail(409, 'Месячный учёт уже включён.');
                if (input.confirmed !== true || typeof input.fingerprint !== 'string') fail(400, 'Сначала сравните историю и подтвердите условия.');
                let historyConfig;
                const { comparison } = await previewData(data, accountId, { excludedSaleIds: input.excludedSaleIds, history: true }, config => { historyConfig = config; });
                if (comparison.issues.length) fail(409, comparison.issues[0]);
                if (input.fingerprint !== comparison.fingerprint) fail(409, 'История изменилась. Обновите сравнение.');
                account.poolAccounting = historyConfig;
            }
            else if (action === 'enable') {
                if (account.poolAccounting)
                    fail(409, 'Месячный учёт уже включён.');
                if (!validMonth(input.startMonth) || input.startMonth < P.nextPoolMonth(P.poolMonth(now())))
                    fail(400, 'Для существующего пула выберите начало следующего месяца или позднее.');
                if (input.confirmed !== true)
                    fail(400, 'Подтвердите переход.');
                initialize(input.startMonth);
                if (!Array.isArray(input.excludedSaleIds) || input.excludedSaleIds.some(id => !data.sales.some(s => s.id === id && (s.accountId === account.id || s.funding?.some(f => f.accountId === account.id)))))
                    fail(400, 'Проверьте договоры пула.');
                account.poolAccounting.excludedSaleIds = [...new Set(input.excludedSaleIds)];
            }
            else if (action === 'addInvestor') {
                const name = String(input.name || '').trim();
                if (!name || name.length > 160)
                    fail(400, 'Укажите имя инвестора.');
                const amount = money(input.amount);
                if (amount < 0)
                    fail(400, 'Вложение не может быть отрицательным.');
                rate(input.rate);
                disposition(input.disposition || 'PAYABLE');
                if (getInvestorLimitState) {
                    const limit = (await getInvestorLimitState(owner)).limit;
                    if (limit >= 0 && data.investors.length >= limit)
                        fail(403, 'Достигнут лимит инвесторов.');
                }
                if (!account.poolAccounting && !data.sales.some(s => s.accountId === account.id) && !account.poolMemberIds?.length)
                    initialize(P.poolMonth(now()));
                const normalized = P.poolEntryDate(input.date, now());
                const date = !account.poolAccounting && /^\d{4}-\d{2}-\d{2}$/.test(input.date||'') && input.date!==P.poolDay(now()) && normalized!=='Invalid Date' ? new Date(`${input.date}T00:00:00Z`).toISOString() : normalized, time = P.poolTime(date);
                if (!Number.isFinite(time) || time > now() + 1000)
                    fail(400, 'Дата вложения не может быть в будущем.');
                const last = account.poolAccounting?.closed?.at(-1);
                if (account.poolAccounting && time < (last ? P.poolMonthStart(P.nextPoolMonth(last.month)) : Math.min(P.poolMonthStart(account.poolAccounting.startMonth), P.poolMonthStart(P.poolMonth(now())))))
                    fail(409, 'Месяц вложения уже закрыт.');
                const id = `inv_pool_${crypto.createHash('sha256').update(JSON.stringify([owner, input.requestId])).digest('hex').slice(0, 20)}`;
                let investorId = id;
                if (input.email) {
                    if (typeof input.password !== 'string' || input.password.length < 6)
                        fail(400, 'Пароль должен содержать минимум 6 символов.');
                    const email = String(input.email).trim().toLowerCase();
                    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
                        fail(400, 'Проверьте email.');
                    if ((await db.query('SELECT id FROM users WHERE lower(email)=$1', [email])).rows.length)
                        fail(409, 'Email уже занят.');
                    investorId = `u_${id}`;
                    await db.query("INSERT INTO users(id,name,email,password,role,manager_id,phone,permissions) VALUES($1,$2,$3,$4,'investor',$5,$6,$7)", [investorId, name, email, await require('bcryptjs').hash(input.password, 10), owner, input.phone || '', JSON.stringify(input.permissions || {})]);
                }
                const i = { id: investorId, userId: owner, name, phone: input.phone || '', email: input.email || '', initialAmount: amount, profitPercentage: input.rate, joinedDate: date, permissions: input.permissions || {}, investmentPeriods: [{ id: `period_${input.requestId}`, joinedDate: date, initialAmount: amount, capitalChanges: [] }] };
                changedInvestors.push(i);
                data.investors.push(i);
                account.poolMemberIds = [...(account.poolMemberIds || []), i.id];
                if (account.poolAccounting) {
                    const prior = P.poolTermsAt(account, now());
                    account.poolAccounting.terms.push({ date: new Date(Math.max(time, P.poolMonthStart(account.poolAccounting.startMonth))).toISOString(), members: { [i.id]: { rate: input.rate, disposition: input.disposition || 'PAYABLE' } } });
                }
                if (amount > 0) {
                    const s = { id: `dep_${id}`, userId: owner, type: 'CASH', accountId: account.id, customerId: `system_deposit_${i.id}`, productName: 'Вложение в общий пул', totalAmount: amount, downPayment: amount, buyPrice: 0, remainingAmount: 0, startDate: date, paymentPlan: [], status: 'COMPLETED' };
                    changedSales.push(s);
                    data.sales.push(s);
                }
            }
            else {
                if (!P.isMonthlyPool(account))
                    fail(409, 'Сначала включите месячный учёт.');
                const config = account.poolAccounting, last = [...config.closed].sort((a, b) => a.month.localeCompare(b.month)).at(-1), floor = last ? P.poolMonthStart(P.nextPoolMonth(last.month)) : Math.min(P.poolMonthStart(config.startMonth), P.poolMonthStart(P.poolMonth(now())));
                const i = data.investors.find(i => i.id === input.investorId && account.poolMemberIds.includes(i.id));
                const applyCapital = (investor, delta, date, sourceId) => {
                    applyCapitalChange(P, investor, delta, date, sourceId, floor, now());
                    if (!changedInvestors.includes(investor))
                        changedInvestors.push(investor);
                };
                if (action === 'adjustment') {
                    const amount = money(input.amount), reason = String(input.reason || '').trim(), date = P.poolEntryDate(input.date, now());
                    if (!amount || reason.length < 3 || reason.length > 500 || P.poolTime(date) < floor || P.poolTime(date) > now() + 1000 || input.confirmed !== true)
                        fail(400, 'Укажите сумму, причину и дату открытого периода.');
                    if (input.saleId && !data.sales.some(s => s.id === input.saleId && (s.accountId === account.id || s.funding?.some(f => f.accountId === account.id))))
                        fail(400, 'Договор не принадлежит этому пулу.');
                    config.adjustments = [...(config.adjustments || []), { id: `adjustment_${input.requestId}`, date, amount, reason, ...(input.saleId ? { saleId: input.saleId } : {}) }];
                }
                else if (action === 'profile') {
                    if (!i)
                        fail(404, 'Инвестор не найден.');
                    const name = String(input.name || '').trim();
                    if (!name || name.length > 160)
                        fail(400, 'Укажите имя.');
                    const existingUser = (await db.query('SELECT id,manager_id FROM users WHERE id=$1', [i.id])).rows[0];
                    const email = String(input.email || '').trim().toLowerCase();
                    if (email) {
                        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
                            fail(400, 'Проверьте email.');
                        if ((await db.query('SELECT id FROM users WHERE lower(email)=$1 AND id<>$2', [email, i.id])).rows.length)
                            fail(409, 'Email уже занят.');
                        if (!existingUser && (!input.password || input.password.length < 6))
                            fail(400, 'Укажите пароль от 6 символов.');
                    }
                    if (existingUser && existingUser.manager_id !== owner)
                        fail(403, 'Нет доступа к этому аккаунту.');
                    if (existingUser) {
                        if (!email)
                            fail(400, 'У аккаунта с доступом нельзя убрать email.');
                        await db.query('UPDATE users SET name=$1,email=$2,phone=$3,permissions=$4 WHERE id=$5', [name, email, input.phone || '', JSON.stringify(input.permissions || {}), i.id]);
                        if (input.password) {
                            if (input.password.length < 6)
                                fail(400, 'Пароль должен содержать минимум 6 символов.');
                            await db.query('UPDATE users SET password=$1 WHERE id=$2', [await require('bcryptjs').hash(input.password, 10), i.id]);
                        }
                    }
                    else if (email)
                        await db.query("INSERT INTO users(id,name,email,password,role,manager_id,phone,permissions) VALUES($1,$2,$3,$4,'investor',$5,$6,$7)", [i.id, name, email, await require('bcryptjs').hash(input.password, 10), owner, input.phone || '', JSON.stringify(input.permissions || {})]);
                    Object.assign(i, { name, phone: input.phone || '', email, permissions: input.permissions || {}, isOwner: !!input.isOwner });
                    changedInvestors.push(i);
                }
                else if (action === 'reentry') {
                    if (!i)
                        fail(404, 'Инвестор не найден.');
                    const date = P.poolEntryDate(input.date, now()), time = P.poolTime(date), amount = money(input.amount);
                    if (amount < 0 || time < floor || time > now() + 1000)
                        fail(400, 'Проверьте сумму и дату входа.');
                    const periods = i.investmentPeriods || [{ id: 'legacy', joinedDate: i.joinedDate, leftPoolDate: i.leftPoolDate, initialAmount: i.initialAmount }];
                    if (periods.some(p => !p.leftPoolDate || P.poolTime(p.leftPoolDate) > time))
                        fail(409, 'Периоды участия пересекаются.');
                    periods.push({ id: `period_${input.requestId}`, joinedDate: date, initialAmount: amount, capitalChanges: [] });
                    i.investmentPeriods = periods;
                    i.initialAmount = amount;
                    delete i.leftPoolDate;
                    changedInvestors.push(i);
                    if (amount > 0) {
                        const sale = { id: `dep_${input.requestId}`, type: 'CASH', accountId: account.id, customerId: i.id, productName: 'Повторное вложение в пул', totalAmount: amount, downPayment: amount, buyPrice: 0, remainingAmount: 0, startDate: date, status: 'COMPLETED', paymentPlan: [] };
                        changedSales.push(sale);
                        data.sales.push(sale);
                    }
                }
                else if (action === 'terms') {
                    if (!i)
                        fail(404, 'Инвестор не найден.');
                    rate(input.rate);
                    disposition(input.disposition);
                    const month = input.month || P.nextPoolMonth(P.poolMonth(now()));
                    if (!validMonth(month) || P.poolMonthStart(month) < Math.max(floor, P.poolMonthStart(P.nextPoolMonth(P.poolMonth(now())))))
                        fail(409, 'Новые условия применяются со следующего открытого месяца.');
                    config.terms.push({ date: new Date(P.poolMonthStart(month)).toISOString(), members: { [i.id]: { rate: input.rate, disposition: input.disposition } } });
                }
                else if (action === 'management') {
                    const month = input.month;
                    if (!validMonth(month) || month < P.nextPoolMonth(P.poolMonth(now())))
                        fail(400, 'Выберите следующий месяц или позднее.');
                    if (!Array.isArray(input.split) || input.split.some(s => !account.poolMemberIds.includes(s.investorId) || typeof s.percent !== 'number' || s.percent < 0 || s.percent > 100) || input.split.reduce((n, s) => n + s.percent, 0) > 100 || new Set(input.split.map(s => s.investorId)).size !== input.split.length)
                        fail(400, 'Проверьте доли за управление.');
                    config.terms.push({ date: new Date(P.poolMonthStart(month)).toISOString(), managerShareSplit: input.split });
                }
                else if (action === 'profitBasis') {
                    const { month, basis } = input;
                    if (basis !== 'MONTH' && basis !== 'SCHEDULE_PERIOD')
                        fail(400, 'Выберите способ распределения прибыли.');
                    if (!validMonth(month) || month < config.startMonth || month < P.nextPoolMonth(P.poolMonth(now())) || P.poolMonthStart(month) < floor)
                        fail(400, 'Выберите следующий открытый месяц учёта.');
                    config.terms.push({ date: new Date(P.poolMonthStart(month)).toISOString(), profitBasis: basis });
                }
                else if (action === 'capital') {
                    if (!i)
                        fail(404, 'Инвестор не найден.');
                    const amount = money(input.amount);
                    if (input.kind === 'WITHDRAW' && (await reports(data, account)).at(-1)?.carryOut > 0)
                        fail(409, 'Есть непокрытый убыток. Сначала проверьте результат пула перед возвратом капитала.');
                    if (amount <= 0 || !['DEPOSIT', 'WITHDRAW'].includes(input.kind))
                        fail(400, 'Укажите положительную сумму и вид операции.');
                    const date = P.poolEntryDate(input.date, now()), sourceId = `pool_capital_${input.requestId}`;
                    applyCapital(i, input.kind === 'DEPOSIT' ? amount : -amount, date, sourceId);
                    if (input.kind === 'DEPOSIT') {
                        const s = { id: sourceId, type: 'CASH', accountId: account.id, customerId: i.id, productName: 'Пополнение капитала', buyPrice: 0, totalAmount: amount, downPayment: amount, remainingAmount: 0, startDate: date, status: 'COMPLETED', paymentPlan: [] };
                        changedSales.push(s);
                        data.sales.push(s);
                    }
                    else {
                        if ((await cashAvailable(data, account)) < amount)
                            fail(409, 'На счёте недостаточно денег для возврата вложения.');
                        const e = { id: sourceId, accountId: account.id, investorId: i.id, date, amount, payoutType: 'INVESTMENT', category: 'Возврат вложения', fromProfit: false };
                        changedExpenses.push(e);
                        data.expenses.push(e);
                    }
                }
                else if (action === 'exit') {
                    if (!i)
                        fail(404, 'Инвестор не найден.');
                    const date = P.poolEntryDate(input.date, now());
                    if (P.poolTime(date) < floor || P.poolTime(date) > now() + 1000)
                        fail(409, 'Выберите дату открытого периода.');
                    if (P.getInvestorAmountAt(i, P.poolTime(date)) > 0)
                        fail(409, 'Сначала оформите возврат вложенного капитала.');
                    const periods = i.investmentPeriods || [{ id: 'legacy', joinedDate: i.joinedDate, initialAmount: i.initialAmount }];
                    const p = periods.find(p => P.periodActiveAt(p, P.poolTime(date)));
                    if (!p)
                        fail(409, 'Инвестор уже вышел.');
                    p.leftPoolDate = date;
                    i.investmentPeriods = periods;
                    i.leftPoolDate = date;
                    changedInvestors.push(i);
                }
                else if (action === 'closeCompleted') {
                    if (input.confirmed !== true) fail(400, 'Подтвердите начисления по сводке.');
                    if (!validMonth(input.throughMonth)) fail(400, 'Обновите сводку начислений.');
                    const plan = await completedPlan(data, account.id, input.throughMonth);
                    if (!plan.confirmation.count) fail(409, 'Все завершённые месяцы уже подтверждены.');
                    if (input.fingerprint !== plan.confirmation.fingerprint) fail(409, 'Данные изменились. Обновите сводку перед подтверждением.');
                    account.poolAccounting = plan.account.poolAccounting;
                    for (const investor of plan.changedInvestors) {
                        data.investors[data.investors.findIndex(i => i.id === investor.id)] = investor;
                        changedInvestors.push(investor);
                    }
                }
                else if (action === 'close') {
                    const month = input.month;
                    if(config.closed.some(r=>r.month===month)) {
                        await db.query('COMMIT');done=true;db.release();released=true;
                        return { ...await previewData(data,accountId), alreadyCalculated:true,changed:{accounts:[account],investors:changedInvestors,sales:[],expenses:[]} };
                    }
                    if (!validMonth(month) || month !== (last ? P.nextPoolMonth(last.month) : config.startMonth) || P.poolMonthStart(P.nextPoolMonth(month)) > now())
                        fail(409, 'Закрывайте завершённые месяцы по порядку.');
                    if (input.confirmed !== true)
                        fail(400, 'Подтвердите проверку расходов, убытков и возвратности долгов.');
                    const report = (await reports(data, account)).find(r => r.month === month);
                    if (input.fingerprint !== hash(report))
                        fail(409, 'Данные изменились. Обновите расчёт перед закрытием.');
                    await closeReport(data, account, report, changedInvestors, P, now());
                }
                else if (action === 'reinvest') {
                    if (!i)
                        fail(404, 'Инвестор не найден.');
                    const amount = money(input.amount);
                    if (amount <= 0)
                        fail(400, 'Укажите положительную сумму.');
                    const date = P.poolEntryDate(input.date, now());
                    if (P.poolTime(date) < Math.max(floor, now() - 60000))
                        fail(409, 'Реинвестирование доступной прибыли оформляется текущей датой.');
                    const available = (await balances(data, account)).investors[i.id]?.available || 0;
                    if (!Number.isFinite(available) || amount > available)
                        fail(409, 'Недостаточно доступной прибыли.');
                    const id = `reinvest_${input.requestId}`;
                    applyCapital(i, amount, date, id);
                    config.reinvestments.push({ id, investorId: i.id, date, amount });
                }
                else
                    fail(400, 'Неизвестная операция.');
            }
            const refs = { investors: changedInvestors.map(i => i.id), sales: changedSales.map(s => s.id), expenses: changedExpenses.map(e => e.id) };
            if (account.poolAccounting) {
                account.poolAccounting.revision = (account.poolAccounting.revision || 0) + 1;
                account.poolAccounting.requests.push({ id: input.requestId, hash: requestHash, action, refs });
            }
            // Старый пул также получает идемпотентность, без включения новой формулы.
            else {
                account.poolRequests = [...(account.poolRequests || []), { id: input.requestId, hash: requestHash, action, refs }];
            }
            for (const item of changedInvestors)
                await save(db, owner, 'investors', item);
            for (const item of changedSales)
                await save(db, owner, 'sales', item);
            for (const item of changedExpenses)
                await save(db, owner, 'expenses', item);
            await save(db, owner, 'accounts', account);
            await db.query('COMMIT');
            done = true;
            db.release();
            released = true;
            return { ...await previewData(data, accountId), changed: { accounts: [account], investors: changedInvestors, sales: changedSales, expenses: changedExpenses } };
        }
        catch (e) {
            if (!done)
                await db.query('ROLLBACK').catch(() => { });
            throw e;
        }
        finally {
            if (!released)
                db.release();
        }
    };
    return { preview, mutate, guardWrite, load, reports, balances, settleOwner, fingerprint: hash };
}
module.exports = { createPoolService, validMonth };
