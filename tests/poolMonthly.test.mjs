import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../shared/profit.js';
import { build } from 'esbuild';
const compiled = await build({ entryPoints: ['src/cashProfitLedger.ts', 'src/utils.ts'], bundle: true, platform: 'node', format: 'esm', write: false, outdir: 'unused-pool-tests', logLevel: 'silent' });
const [L, U] = await Promise.all(compiled.outputFiles.map(f => import(`data:text/javascript;base64,${Buffer.from(f.contents).toString('base64')}`)));
const t = d => Date.parse(`${d}T00:00:00+03:00`), end = t('2026-12-01');
const investor = (id, amount = 1e6, joined = '2026-11-01', rate = 50) => ({ id, name: id, initialAmount: amount, joinedDate: new Date(t(joined)).toISOString(), profitPercentage: rate });
const account = (ids = ['a', 'b']) => { const terms = { date: new Date(t('2026-11-01')).toISOString(), members: Object.fromEntries(ids.map(id => [id, { rate: 50, disposition: 'PAYABLE' }])), managerShareSplit: [] }; return { id: 'pool', name: 'Пул', type: 'POOL', poolMemberIds: ids, poolAccounting: { version: 1, startMonth: '2026-11', openingTerms: terms, terms: [terms], closed: [], excludedSaleIds: [], reinvestments: [] } }; };
const sale = (extra = {}) => ({ id: 's', accountId: 'pool', customerId: 'client', productName: 'Товар', type: 'INSTALLMENT', status: 'ACTIVE', startDate: '2026-10-01', buyPrice: 100000, totalAmount: 200000, downPayment: 0, paymentPlan: [{ id: 'paid', date: '2026-11-20T12:00:00+03:00', amount: 200000, isPaid: true, isRealPayment: true }], ...extra });
const report = (a = account(), ii = [investor('a'), investor('b')], ss = [sale()], ee = [], now = end) => P.poolMonthlyReport(a, ii, ss, ee, '2026-11', now);
const amt = (r, id) => r.allocations.find(a => a.id === id)?.amount || 0;
test('одинаковые капитал и ставки дают одинаковые начисления на поступление без графика', () => { const r = report(); assert.equal(r.gross, 100000); assert.equal(amt(r, 'a'), 25000); assert.equal(amt(r, 'b'), 25000); assert.equal(amt(r, '__manager__'), 50000); });
test('участник до начала месяца равен участнику, вошедшему раньше', () => { const r = report(account(), [investor('a', 1e6, '2026-08-01'), investor('b', 1e6, '2026-10-24')]); assert.equal(amt(r, 'a'), amt(r, 'b')); });
test('поступление без графика делится по капиталу на дату оплаты', () => { const r = report(account(), [investor('a'), investor('b', 1e6, '2026-11-16')]); assert.equal(amt(r, 'a'), 25000); assert.equal(amt(r, 'b'), 25000); });
test('пополнение посреди месяца учитывается только после своей даты', () => { const a = investor('a'); a.initialAmount = 2e6; a.investmentPeriods = [{ id: 'p', joinedDate: a.joinedDate, initialAmount: 2e6, capitalChanges: [{ date: new Date(t('2026-11-16')).toISOString(), delta: 1e6 }] }]; const r = report(account(), [a, investor('b')]); assert.equal(r.shares.find(s => s.investorId === 'a').capitalDays, 45e6); assert.equal(amt(r, 'a'), 33333.33); assert.equal(amt(r, 'b'), 16666.67); });
test('выход и повторный вход учитываются отдельными периодами', () => { const a = investor('a'); a.investmentPeriods = [{ id: 'one', joinedDate: new Date(t('2026-11-01')).toISOString(), leftPoolDate: new Date(t('2026-11-11')).toISOString(), initialAmount: 1e6 }, { id: 'two', joinedDate: new Date(t('2026-11-21')).toISOString(), initialAmount: 1e6 }]; const r = report(account(), [a, investor('b')]); assert.equal(r.shares.find(s => s.investorId === 'a').capitalDays, 20e6); assert.equal(amt(r, 'a'), 0); assert.equal(amt(r, 'b'), 50000); });
test('разные ставки, остаток управляющему и дополнительная управленческая доля', () => { const a = account(); a.poolAccounting.terms[0].members.a.rate = 80; a.poolAccounting.terms[0].managerShareSplit = [{ investorId: 'b', percent: 50 }]; const r = report(a); assert.equal(amt(r, 'a'), 40000); assert.equal(amt(r, 'b'), 42500); assert.equal(amt(r, '__manager__'), 17500); });
test('будущая ставка не переписывает прошлый месяц; патчи не теряют условия другого участника', () => { const a = account(); a.poolAccounting.terms.push({ date: new Date(end).toISOString(), members: { a: { rate: 80, disposition: 'REINVEST' } } }, { date: new Date(t('2027-01-01')).toISOString(), members: { b: { rate: 70, disposition: 'PAYABLE' } } }); assert.equal(amt(report(a), 'a'), 25000); assert.equal(P.poolTermsAt(a, t('2027-01-01')).members.a.rate, 80); });
test('общие расходы до распределения; личные расходы управляющего не уменьшают базу', () => { const ee = [{ id: 'rent', accountId: 'pool', date: '2026-11-15', amount: 20000, fromProfit: true, profitSource: 'SHARED' }, { id: 'personal', accountId: 'pool', date: '2026-11-15', amount: 10000, fromProfit: true, profitSource: 'MANAGER' }]; const r = report(undefined, undefined, undefined, ee); assert.equal(r.costs, 20000); assert.equal(amt(r, 'a'), 20000); });
test('первый взнос: настройка только с платежей сохраняется', () => { const s = sale({ downPayment: 100000, paymentPlan: [], startDate: '2026-11-01' }); assert.equal(P.poolMonthlyReport(account(), [investor('a'), investor('b')], [s], [], '2026-11', end, true).gross, 0); assert.equal(report(undefined, undefined, [s]).gross, 50000); });
test('скидка с нулевой оплатой уменьшает базу и не создаёт повторного расхода', () => { const s = sale({ paymentPlan: [{ id: 'p', date: '2026-11-15', amount: 100000, isPaid: true, isRealPayment: true }, { id: 'd', date: '2026-11-20', amount: 0, discountAmount: 100000, discountFromProfit: true, isPaid: true, isRealPayment: true }] }); const r = report(undefined, undefined, [s]); assert.equal(r.gross, 0); assert.equal(amt(r, 'a'), 0); });
test('плановые и будущие оплаты не становятся прибылью', () => { const s = sale(); s.paymentPlan.push({ ...s.paymentPlan[0], id: 'plan', isRealPayment: false }, { ...s.paymentPlan[0], id: 'future', date: '2026-12-20' }); assert.equal(report(undefined, undefined, [s]).gross, 100000); assert.equal(report(undefined, undefined, [s], [], t('2026-11-10')).gross, 0); });
test('личный договор исключается явно, даты оформления не определяют принадлежность', () => { const a = account(); a.poolAccounting.excludedSaleIds = ['s']; assert.equal(report(a).gross, 0); a.poolAccounting.excludedSaleIds = []; assert.equal(report(a).gross, 100000); });
test('нет капитала: прибыль не присваивается управляющему автоматически', () => { const r = report(account(), [investor('a', 0), investor('b', 0)]); assert.equal(r.unallocated, 100000); assert.equal(amt(r, '__manager__'), 0); });
test('убыток переносится, будущая прибыль сначала покрывает его', () => { const a = account(), i = [investor('a'), investor('b')]; const ee = [{ id: 'e', accountId: 'pool', date: '2026-11-20', amount: 120000, fromProfit: true, profitSource: 'SHARED' }]; const ss = [sale(), sale({ id: 'dec', paymentPlan: [{ id: 'd', date: '2026-12-15', amount: 200000, isPaid: true, isRealPayment: true }] })]; const rr = P.poolMonthlyReports(a, i, ss, ee, t('2027-01-01')); assert.equal(rr[0].carryOut, 20000); assert.equal(rr[0].distributable, 0); assert.equal(rr[1].carryIn, 20000); assert.equal(rr[1].distributable, 80000); });
test('закрытый месяц неизменен при изменении данных договора и капитала', () => { const a = account(), r = report(a); a.poolAccounting.closed.push({ ...r, status: 'CLOSED' }); assert.deepEqual(P.poolMonthlyReport(a, [investor('a', 9e6), investor('b')], [sale({ totalAmount: 999999 })], [], '2026-11', end), { ...r, status: 'CLOSED' }); });
test('копейки сохраняются при любой сумме и не зависят от порядка строк', () => { for (let n = 1; n < 150; n++) {
    const weights = [{ id: 'a', weight: 17 }, { id: 'b', weight: 17 }, { id: 'c', weight: 66 }];
    for (const amount of [n / 100, -n / 100]) {
        const r = P.allocatePoolMoney(amount, weights);
        assert.equal(Math.round(r.reduce((s, x) => s + x.amount, 0) * 100), Math.round(amount * 100));
        assert.deepEqual(r, P.allocatePoolMoney(amount, weights.slice().reverse()).reverse());
    }
} });
test('месяц и дата без времени одинаковы на устройствах с разными часовыми поясами', () => { const old = process.env.TZ; try {
    for (const tz of ['UTC', 'Europe/Moscow', 'America/Los_Angeles']) {
        process.env.TZ = tz;
        assert.equal(P.poolMonth('2026-11-01'), '2026-11');
        assert.equal(report().gross, 100000);
    }
}
finally {
    if (old === undefined)
        delete process.env.TZ;
    else
        process.env.TZ = old;
} });
test('личные счета и старые пулы сохраняют прежний расчёт', () => { const ii = [investor('a'), investor('b')], s = sale(); const own = { id: 'own', type: 'INVESTOR', ownerId: 'a' }; assert.equal(P.paymentProfitShares(own, ii, s, s.paymentPlan[0])[0].percentage, 50); const old = { id: 'pool', type: 'POOL', poolMemberIds: ['a', 'b'] }; assert.deepEqual(P.paymentProfitShares(old, ii, s, s.paymentPlan[0]), []); assert.equal(P.poolMonthlyReports(own, ii, [s]).length, 0); });
test('касса, карточка и кабинет используют одинаковый месячный результат, реинвестирование не выплата', () => { const before=Date.now;Date.now=()=>end;try{const a = account(), r = report(a); a.poolAccounting.closed = [{ ...r, status: 'CLOSED' }]; a.poolAccounting.reinvestments = [{ id: 'ri', investorId: 'a', date: '2026-12-01T00:00:00+03:00', amount: 5000 }]; const ii = [investor('a'), investor('b')]; const out = L.cashProfitLedgers({ accounts: [a], investors: ii, sales: [sale()], expenses: [], customers: [], period: { start: '2026-11-01', end: '2026-12-31' } }); const accr = P.investorProfitAccruals(a, ii, [sale()], 'a'); const received = accr.reduce((n, x) => n + x.amount, 0); assert.equal(out.investors.get('a').received, received); assert.equal(out.investors.get('a').paid, 0); assert.equal(out.investors.get('a').available, received - 5000); assert.equal(U.investorProfitOutflows([], [a], ii, 'a').total, 5000);}finally{Date.now=before}});
test('убыточный договор уменьшает прибыль месяца', () => { const r = report(account(), [investor('a'), investor('b')], [sale({ id: 'loss', buyPrice: 200000, totalAmount: 100000, paymentPlan: [{ id: 'l', date: '2026-11-20', amount: 100000, isPaid: true, isRealPayment: true }] })]); assert.equal(r.gross, -100000); assert.equal(r.carryOut, 100000); assert.equal(r.distributable, 0); });
test('прибыль текущего месяца доступна без подтверждения', () => { const old = Date.now; Date.now = () => t('2026-11-25'); try {
    const r = L.cashProfitLedgers({ accounts: [account()], investors: [investor('a'), investor('b')], sales: [sale()], expenses: [], customers: [], period: { start: '2026-11-01', end: '2026-11-30' } });
    assert.equal(r.investors.get('a').received, 25000);
    assert.equal(r.investors.get('a').pending, 25000);
    assert.equal(r.investors.get('a').available, 25000);
}
finally {
    Date.now = old;
} });
test('режим определения прибыли пула не меняется от настройки других счетов', () => { const a = account(); a.poolAccounting.profitFromPaymentsOnly = true; const s = sale({ startDate: '2026-11-01', downPayment: 100000, paymentPlan: [] }); assert.equal(P.poolMonthlyReport(a, [investor('a'), investor('b')], [s], [], '2026-11', end, false).gross, 0); });
test('имена других участников не раскрываются из закрытого расчёта', async () => { const { createRequire } = await import('node:module'), require = createRequire(import.meta.url), { poolAccountForViewer } = require('../server/pools/view.js'); const a = account(); a.poolAccounting.closed = [report(a)]; a.poolAccounting.requests = [{ id: 'test-secret', hash: 'hash' }]; const before = JSON.stringify(a), v = poolAccountForViewer(a, { role: 'investor', id: 'a' }); assert.equal(v.poolAccounting.closed[0].shares.find(s => s.investorId === 'b').name, 'Участник пула'); assert.equal(v.poolAccounting.requests, undefined); assert.equal(JSON.stringify(a), before); });
test('повреждённые даты, суммы и повторные записи помечаются для проверки', () => { const s = sale(); s.paymentPlan.push({ ...s.paymentPlan[0] }, { ...s.paymentPlan[0], id: 'bad', amount: 'oops' }, { ...s.paymentPlan[0], id: 'date', date: 'bad-date' }); const r = report(undefined, undefined, [s]); assert(r.issues.some(i => /повторяется/.test(i))); assert(r.issues.some(i => /сумму/.test(i))); assert(r.issues.some(i => /дату/.test(i))); });
test('пересекающиеся периоды и отрицательный капитал не разрешают незаметное распределение', () => { const i = investor('a'); i.initialAmount = -1; i.investmentPeriods = [{ joinedDate: i.joinedDate, initialAmount: 1e6 }, { joinedDate: i.joinedDate, initialAmount: 2e6 }]; const r = report(account(), [i, investor('b')]); assert(r.issues.some(i => /капитал/.test(i))); assert(r.issues.some(i => /периоды/.test(i))); });
test('первый взнос и оплата без времени учитываются в текущем дне до полуночи', () => { const s = sale({ startDate: '2026-11-20', downPayment: 20000, paymentPlan: [{ id: 'today', date: '2026-11-20', amount: 10000, isPaid: true, isRealPayment: true }] }); const r = report(undefined, undefined, [s], [], Date.parse('2026-11-20T09:00:00+03:00')); assert.equal(r.gross, 15000); });
test('ошибочные управленческие доли и дубли участников не разрешают закрыть потерянную сумму', () => { const a = account(); a.poolAccounting.terms[0].managerShareSplit = [{ investorId: 'a', percent: 'not-number' }]; assert(report(a).issues.length > 0); a.poolMemberIds.push('a'); assert(report(a).issues.some(i => /дважды/.test(i))); });
test('служебные хеши старого пула скрыты до включения месячного режима', async () => { const { createRequire } = await import('node:module'), require = createRequire(import.meta.url), { poolAccountForViewer } = require('../server/pools/view.js'); const a = { id: 'legacy', type: 'POOL', poolRequests: [{ id: 'private', hash: 'not-public' }] }; assert.equal(poolAccountForViewer(a, { role: 'investor', id: 'a' }).poolRequests, undefined); assert.equal(a.poolRequests.length, 1); });
test('касса относит закрытое начисление к московскому месяцу даже на устройстве UTC+14', () => { const a = account(), r = report(a); a.poolAccounting.closed = [{ ...r, status: 'CLOSED' }]; const old = process.env.TZ; try {
    for (const tz of ['UTC', 'Pacific/Kiritimati', 'America/Los_Angeles']) {
        process.env.TZ = tz;
        const l = L.cashProfitLedgers({ accounts: [a], investors: [investor('a'), investor('b')], sales: [sale()], expenses: [], customers: [], period: { start: '2026-11-01', end: '2026-11-30' } });
        assert.equal(l.investors.get('a').received, 25000);
        assert(P.inPoolProfitPeriod(r.date, { start: '2026-11-01', end: '2026-11-30' }));
    }
}
finally {
    if (old === undefined)
        delete process.env.TZ;
    else
        process.env.TZ = old;
} });
test('сегодняшнее вложение получает время сервера, прошедший день — начало московского дня',()=>{const now=Date.parse('2026-12-01T09:00:00+03:00');assert.equal(P.poolEntryDate('2026-12-01',now),new Date(now).toISOString());assert.equal(P.poolEntryDate('2026-11-01',now),'2026-10-31T21:00:00.000Z');assert.equal(P.poolEntryDate('2026-02-30',now),'Invalid Date');});
test('новый день общего пула начинается по Москве, а не по UTC устройства',()=>{const now=Date.parse('2026-11-19T21:15:00Z');assert.equal(P.poolDay(now),'2026-11-20');assert.equal(P.poolEntryDate('2026-11-20',now),new Date(now).toISOString());});
test('сумма округлённых источников равна общей прибыли; точные копейки корректировки сохраняются',()=>{const rows=[{id:'exact',amount:100000},...Array.from({length:20},(_,n)=>({id:String(n),amount:0.000255}))];const r=P.roundPoolProfitRows(rows);assert.equal(r[0].amount,100000);assert.equal(Math.round(r.reduce((n,r)=>n+r.amount,0)*100),Math.round(rows.reduce((n,r)=>n+r.amount,0)*100));const negative=P.roundPoolProfitRows([{id:'a',amount:0.006},{id:'b',amount:-0.004}]);assert.equal(negative.reduce((n,r)=>n+r.amount,0),0);assert.deepEqual(P.roundPoolProfitRows([...rows].reverse()).reverse(),r);});
test('будущие выплаты и реинвестирование нового пула не уменьшают сегодняшний доступный остаток',()=>{
    const before=Date.now;Date.now=()=>t('2026-11-25');try{
        const a=account(),ii=[investor('a'),investor('b')],expenses=[{id:'future',accountId:'pool',investorId:'a',payoutType:'PROFIT',amount:1000,date:'2026-11-26'}];
        a.poolAccounting.reinvestments=[{id:'future-ri',investorId:'a',amount:2000,date:'2026-11-26'}];
        const out=L.cashProfitLedgers({accounts:[a],investors:ii,sales:[sale()],expenses,customers:[],period:{start:'2000-01-01',end:'2100-12-31'}});
        assert.equal(out.investors.get('a').available,25000);assert.equal(U.investorProfitOutflows(expenses,[a],ii,'a').total,0);
    }finally{Date.now=before}
});
test('будущая фактическая оплата до даты перехода не становится сегодняшней прибылью нового пула',()=>{
    const before=Date.now;Date.now=()=>t('2026-11-25');try{
        const a=account();a.poolAccounting.startMonth='2026-12';const s=sale();s.paymentPlan[0].date='2026-11-26';const ii=[investor('a'),investor('b')];
        assert.equal(P.investorProfitAccruals(a,ii,[s],'a').length,0);
        const out=L.cashProfitLedgers({accounts:[a],investors:ii,sales:[s],expenses:[],customers:[],period:{start:'2000-01-01',end:'2100-12-31'}});assert.equal(out.manager.available,0);
    }finally{Date.now=before}
});

test('общий месячный итог защищает уже полученную прибыль при входе, пополнении и выводе', () => {
    const a = account(['a', 'b', 'c', 'd']);
    a.poolAccounting.startMonth = '2026-03';
    a.poolAccounting.openingTerms.date = '2026-03-01T00:00:00+03:00';
    for (const term of Object.values(a.poolAccounting.openingTerms.members)) term.rate = 100;
    const ii = [investor('a', 10e6, '2026-01-01'), investor('b', 7e6, '2026-01-01'),
        investor('c', 2e6, '2026-01-01'), investor('d', 5e6, '2026-03-15')];
    for (const [i, date, delta] of [[ii[1], '2026-03-20', 2e6], [ii[2], '2026-03-25', -1e6]]) {
        i.investmentPeriods = [{ joinedDate: i.joinedDate, initialAmount: i.initialAmount,
            capitalChanges: [{ date: new Date(t(date)).toISOString(), delta }] }];
    }
    const ss = [[10, 18000], [17, 23000], [22, 25000], [27, 24000]].map(([day, profit]) => sale({
        id: `s${day}`, startDate: '2026-03-01', buyPrice: profit, totalAmount: profit * 2,
        paymentPlan: [{ id: `p${day}`, date: `2026-03-${day}`, amount: profit * 2, isPaid: true, isRealPayment: true }],
    }));
    const r = P.poolMonthlyReport(a, ii, ss, [], '2026-03', t('2026-04-01'));
    assert.deepEqual(['a', 'b', 'c', 'd'].map(id => amt(r, id)), [40000, 24000, 11000, 15000]);
    assert.deepEqual(P.poolAllocationDetails(r, 'd').map(row => row.paymentId), ['p17', 'p22', 'p27']);
    assert.equal(r.distributable, 90000);
});

test('просрочка и текущий срок в одном платеже делятся по разным периодам графика', () => {
    const a = account(), ii = [investor('a', 100000, '2026-02-01'), investor('b', 100000, '2026-03-10')];
    a.poolAccounting.startMonth = '2026-03';
    a.poolAccounting.openingTerms.date = '2026-03-01T00:00:00+03:00';
    for (const term of Object.values(a.poolAccounting.openingTerms.members)) term.rate = 100;
    const s = sale({ startDate: '2026-02-01', buyPrice: 300, totalAmount: 600, paymentPlan: [
        { id: 'feb', date: '2026-02-28', amount: 300, isPaid: true, isRealPayment: false },
        { id: 'mar', date: '2026-03-20', amount: 300, isPaid: true, isRealPayment: false },
        { id: 'paid', date: '2026-03-22', amount: 600, isPaid: true, isRealPayment: true },
    ] });
    const r = P.poolMonthlyReport(a, ii, [s], [], '2026-03', t('2026-04-01'));
    assert.equal(amt(r, 'a'), 260.53);
    assert.equal(amt(r, 'b'), 39.47);
    assert.deepEqual(r.sources[0].earningMonths, ['2026-02', '2026-03']);
    assert.equal(P.poolAllocationDetails(r, 'b')[0].amount, 39.47);
});

test('ноябрьский взнос, оплаченный досрочно в ноябре, делится без учёта октябрьских дней', () => {
    const a = account(), ii = [investor('a', 1e6, '2026-08-28'), investor('b', 1e6, '2026-10-24')];
    const s = sale({ paymentPlan: [
        { id: 'oct', date: '2026-10-05T21:00:00Z', amount: 100000, isPaid: true, isRealPayment: false },
        { id: 'nov', date: '2026-11-05T21:00:00Z', amount: 100000, isPaid: true, isRealPayment: false },
        { id: 'first', date: '2026-10-04T12:00:00+03:00', amount: 100000, isPaid: true, isRealPayment: true },
        { id: 'second', date: '2026-11-01T12:00:00+03:00', amount: 100000, isPaid: true, isRealPayment: true },
    ] });
    const r = report(a, ii, [s]);
    assert.equal(amt(r, 'a'), 12500);
    assert.equal(amt(r, 'b'), 12500);
    assert.deepEqual(r.sources[0].earningMonths, ['2026-11']);
    assert.deepEqual(P.paymentProfitShares(a, ii, s, s.paymentPlan[3]).map(row => row.percentage), [25, 25]);
    const legacy = { ...a, poolAccounting: undefined };
    const legacyShares = P.paymentProfitShares(legacy, ii, s, s.paymentPlan[3]);
    assert(legacyShares[0].percentage > legacyShares[1].percentage);
    a.poolAccounting.terms.push({ date: '2026-12-01T00:00:00+03:00', profitBasis: 'SCHEDULE_PERIOD' });
    assert.equal(amt(report(a, ii, [s]), 'b'), 12500);
    const late = sale({ paymentPlan: s.paymentPlan.map(p => p.id === 'second' ? { ...p, date: '2026-12-01' } : p) });
    const december = P.poolMonthlyReport(a, ii, [late], [], '2026-12', t('2027-01-01'));
    assert.equal(amt(december, 'a'), 19758.06);
    assert.equal(amt(december, 'b'), 5241.94);
    assert.deepEqual(december.sources[0].earningMonths, ['2026-11']);
});

test('досрочная оплата до входа инвестора не даёт ему долю за будущие дни графика', () => {
    const a = account(), b = investor('b', 1e6, '2026-11-16');
    const s = sale({ startDate: '2026-11-01', paymentPlan: [
        { id: 'plan', date: '2026-11-30', amount: 200000, isPaid: true, isRealPayment: false },
        { id: 'real', date: '2026-11-10', amount: 200000, isPaid: true, isRealPayment: true },
    ] });
    const r = report(a, [investor('a'), b], [s]);
    assert.equal(amt(r, 'b'), 0);
    assert.equal(amt(r, 'a'), 50000);
});
