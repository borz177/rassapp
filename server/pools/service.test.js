const { test, before, after } = require('node:test');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const { Pool } = require('pg');
const { createPoolService } = require('./service');
const { hash } = require('../ai/canonical');
const url = process.env.POOL_TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5434/finuchet';
if (!['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname))
    throw Error('Pool tests require a LOCAL isolated database.');
const raw = new Pool({ connectionString: url }), schema = `pool_test_${crypto.randomBytes(7).toString('hex')}`;
let db, P, F;
before(async () => {
    await raw.query(`CREATE SCHEMA ${schema}`);
    db = new Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 8 });
    await db.query("CREATE TABLE users(id text PRIMARY KEY,name text,email text UNIQUE,password text,role text,manager_id text,phone text,permissions jsonb,blocked boolean DEFAULT false)");
    await db.query("CREATE TABLE data_items(id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),type text NOT NULL,data jsonb NOT NULL,updated_at timestamptz DEFAULT now())");
    P = await import('../../shared/profit.js');
    F = await import('../../shared/funding.js');
});
after(async () => { if (db)
    await db.end(); await raw.query(`DROP SCHEMA ${schema} CASCADE`); await raw.end(); });
let seq = 0;
const req = () => `request_${++seq}_${crypto.randomUUID()}`;
const save = async (owner, type, data) => db.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)', [data.id, owner, type, JSON.stringify(data)]);
async function fixture({ monthly = true, now = '2026-12-01T09:00:00+03:00', auto = false } = {}) {
    const owner = `owner_${++seq}`, id = `pool_${owner}`, iid = `a_${owner}`, bid = `b_${owner}`;
    await db.query("INSERT INTO users(id,name,role) VALUES($1,'Тест','manager')", [owner]);
    const ii = [{ id: iid, name: 'Первый', initialAmount: 1e6, profitPercentage: 50, joinedDate: '2026-11-01T00:00:00+03:00' }, { id: bid, name: 'Второй', initialAmount: 1e6, profitPercentage: 50, joinedDate: '2026-11-01T00:00:00+03:00' }];
    const terms = { date: '2026-11-01T00:00:00+03:00', members: Object.fromEntries(ii.map(i => [i.id, { rate: 50, disposition: auto && i.id === iid ? 'REINVEST' : 'PAYABLE' }])), managerShareSplit: [] };
    const account = { id, userId: owner, name: 'Общий', type: 'POOL', initialBalance: 2000000, poolMemberIds: ii.map(i => i.id), ...(monthly ? { poolAccounting: { version: 1, startMonth: '2026-11', openingTerms: terms, terms: [terms], closed: [], excludedSaleIds: [], reinvestments: [], requests: [] } } : {}) };
    const sale = { id: `sale_${owner}`, accountId: id, type: 'INSTALLMENT', customerId: 'client', productName: 'Товар', startDate: '2026-11-01', buyPrice: 100000, totalAmount: 200000, downPayment: 0, paymentPlan: [{ id: 'p', date: '2026-11-20T12:00:00+03:00', amount: 200000, isPaid: true, isRealPayment: true }] };
    await save(owner, 'accounts', account);
    for (const i of ii)
        await save(owner, 'investors', i);
    await save(owner, 'sales', sale);
    const svc = createPoolService({ pool: db, checkFeatureAccess: async () => ({ allowed: true }), getSubscriptionState: async () => ({ expired: false }), now: () => Date.parse(now) });
    return { owner, id, iid, bid, ii, account, sale, svc, call: (action, data) => svc.mutate(owner, id, action, { requestId: req(), ...data }) };
}
test('повтор одного пополнения при потере ответа и 8 параллельных запросах даёт одну запись', async () => { const f = await fixture(), input = { requestId: req(), investorId: f.iid, amount: 10000, kind: 'DEPOSIT' }; await Promise.all(Array.from({ length: 8 }, () => f.svc.mutate(f.owner, f.id, 'capital', input))); const v = await f.svc.preview(f.owner, f.id); assert.equal(v.investors.find(i => i.id === f.iid).initialAmount, 1010000); assert.equal((await db.query("SELECT id FROM data_items WHERE user_id=$1 AND type='sales'", [f.owner])).rows.length, 2); });
test('параллельные разные пополнения не перезаписывают капитал друг друга', async () => { const f = await fixture(); await Promise.all(Array.from({ length: 6 }, () => f.call('capital', { investorId: f.iid, amount: 1000, kind: 'DEPOSIT' }))); const v = await f.svc.preview(f.owner, f.id); assert.equal(v.investors.find(i => i.id === f.iid).initialAmount, 1006000); });
test('один requestId с другой суммой отвергается', async () => { const f = await fixture(), input = { requestId: req(), investorId: f.iid, amount: 1000, kind: 'DEPOSIT' }; await f.svc.mutate(f.owner, f.id, 'capital', input); await assert.rejects(f.svc.mutate(f.owner, f.id, 'capital', { ...input, amount: 2000 }), e => e.status === 409); });
test('закрытие месяца сохраняет начисления, повторный запрос не создаёт второе реинвестирование', async () => { const f = await fixture({ auto: true }); const preview = await f.svc.preview(f.owner, f.id), report = preview.reports.find(r => r.month === '2026-11'); const input = { requestId: req(), month: '2026-11', confirmed: true, fingerprint: report.fingerprint }; await f.svc.mutate(f.owner, f.id, 'close', input); await f.svc.mutate(f.owner, f.id, 'close', input); const v = await f.svc.preview(f.owner, f.id); assert.equal(v.account.poolAccounting.closed.length, 1); assert.equal(v.account.poolAccounting.reinvestments.length, 1); assert.equal(v.investors.find(i => i.id === f.iid).initialAmount, 1025000); assert.equal(v.balances.investors[f.iid].available, 0); assert.equal((await db.query("SELECT id FROM data_items WHERE user_id=$1 AND type='sales'", [f.owner])).rows.length, 1); });
test('зафиксированный автоматически месяц не меняется от повторного запроса старого клиента', async () => { const f=await fixture();const p=await f.svc.preview(f.owner,f.id);const snapshot=p.account.poolAccounting.closed[0];const changed=structuredClone(f.sale);changed.paymentPlan[0].amount=100000;await db.query('UPDATE data_items SET data=$1 WHERE id=$2',[JSON.stringify(changed),changed.id]);const v=await f.call('close',{month:'2026-11',confirmed:true,fingerprint:p.reports[0].fingerprint});assert.deepEqual(v.account.poolAccounting.closed[0],snapshot); });
test('текущий месяц не фиксируется, завершённый рассчитывается без подтверждения',async()=>{const f=await fixture({now:'2026-11-20T10:00:00+03:00'});await assert.rejects(f.call('close',{month:'2026-11',confirmed:true}),e=>e.status===409);const g=await fixture();const v=await g.svc.preview(g.owner,g.id);assert.equal(v.account.poolAccounting.closed.length,1);assert.equal(v.balances.investors[g.iid].available,25000);});

async function previewEntryDate(f, entryDate) {
    const input = { investorId: f.bid, entryDate };
    const { entryDateCorrection } = await f.svc.preview(f.owner, f.id, { entryDateCorrection: input });
    return { input: { ...input, confirmed: true, fingerprint: entryDateCorrection.fingerprint }, review: entryDateCorrection };
}

for (const firstDate of ['2026-11-10', '2026-12-01']) {
    test(`новый пул с первым входом ${firstDate} принимает более раннего инвестора`, async () => {
        const f = await fixture();
        const add = (accountId, input) => f.svc.mutate(f.owner, accountId, 'addInvestor', input);
        const first = await add('new', {
            requestId: req(), newPoolName: 'Новый пул', name: 'Первый',
            amount: 100000, rate: 100, date: firstDate,
        });
        const id = first.account.id;
        assert.equal(first.account.poolAccounting.startMonth, firstDate.slice(0, 7));
        assert.equal(P.poolDay(first.changed.sales[0].startDate), firstDate);
        assert.deepEqual((await f.svc.preview(f.owner, id)).account.poolAccounting.closed, []);

        const secondInput = { requestId: req(), name: 'Второй', amount: 100000, rate: 100, date: '2026-10-05' };
        const second = await add(id, secondInput);
        assert.equal(second.account.poolAccounting.startMonth, '2026-10');
        assert.equal(P.poolDay(second.changed.sales[0].startDate), secondInput.date);
        assert.equal(P.poolDay(second.account.poolAccounting.openingTerms.date), '2026-10-01');
        assert.equal(P.poolDay(second.investors.find(i => i.name === 'Первый').joinedDate), firstDate);
        const replay = await add(id, secondInput);
        assert.equal(replay.replayed, true);
        assert.equal(replay.changed.sales.length, 2);
        assert.deepEqual(replay.account.poolAccounting.closed, []);

        await save(f.owner, 'sales', {
            ...f.sale, id: `opening_sale_${f.owner}`, accountId: id, startDate: '2026-11-15',
        });
        const settled = await f.svc.preview(f.owner, id);
        const { closed } = settled.account.poolAccounting;
        assert.deepEqual(closed.map(r => r.month), ['2026-10', '2026-11']);
        const [a, b] = ['Первый', 'Второй'].map(name => settled.investors.find(i => i.name === name).id);
        const expectedFirst = firstDate === '2026-11-10' ? 50000 : 0;
        assert.equal(settled.balances.investors[a].earned, expectedFirst);
        assert.equal(settled.balances.investors[b].earned, 100000 - expectedFirst);
        await assert.rejects(add(id, { ...secondInput, requestId: req(), date: '2026-09-01' }), e => e.status === 409);
        assert.deepEqual((await f.svc.preview(f.owner, id)).account.poolAccounting.closed, closed);
    });
}

test('в новом пуле договор текущего месяца и пустой рассчитанный месяц не блокируют ранний вход', async () => {
    const f = await fixture();
    const first = await f.svc.mutate(f.owner, 'new', 'addInvestor', {
        requestId: req(), newPoolName: 'Новый пул', name: 'Первый', amount: 100000, rate: 100, date: '2026-11-10',
    });
    const id = first.account.id;
    await save(f.owner, 'sales', {
        ...f.sale, id: `current_sale_${f.owner}`, accountId: id, startDate: '2026-12-01',
        paymentPlan: [{ ...f.sale.paymentPlan[0], date: '2026-12-01T08:00:00+03:00' }],
    });
    const before = await f.svc.preview(f.owner, id);
    assert.deepEqual(before.account.poolAccounting.closed.map(report => [report.month, report.gross]), [['2026-11', 0]]);
    const second = await f.svc.mutate(f.owner, id, 'addInvestor', {
        requestId: req(), name: 'Второй', amount: 100000, rate: 100, date: '2026-10-20',
    });
    assert.equal(second.account.poolAccounting.startMonth, '2026-10');
    assert.equal(P.poolDay(second.changed.sales[0].startDate), '2026-10-20');
    const after = await f.svc.preview(f.owner, id);
    assert.deepEqual(after.account.poolAccounting.closed.map(report => [report.month, report.gross]), [['2026-10', 0], ['2026-11', 0]]);
    assert.equal(after.reports.find(report => report.month === '2026-12').gross, 100000);
    assert.equal(after.balances.manager.earned, 0);
    const third = await f.svc.mutate(f.owner, id, 'addInvestor', {
        requestId: req(), name: 'Третий', amount: 100000, rate: 100, date: '2026-11-18',
    });
    const final = await f.svc.preview(f.owner, id);
    const thirdId = third.changed.investors[0].id;
    const november = final.account.poolAccounting.closed.find(report => report.month === '2026-11');
    assert.equal(november.gross, 0);
    assert(november.shares.some(row => row.investorId === thirdId));
    assert.equal(final.balances.investors[thirdId].earned, 33333.33);
});

// Второй капитал участвует 15 дней. База графика — 51 день, месячная — 20 дней.
for (const [basis, expectedSecond] of [['MONTH', 18750], ['SCHEDULE_PERIOD', 7352.94]]) {
    test(`исправление первого входа в открытом месяце по способу ${basis}`, async () => {
        const f = await fixture({ now: '2026-11-26T09:00:00+03:00' });
        f.account.poolAccounting.openingTerms.profitBasis = basis;
        f.account.poolAccounting.terms[0].profitBasis = basis;
        await db.query('UPDATE data_items SET data=$1 WHERE id=$2', [JSON.stringify(f.account), f.id]);
        f.ii[0].joinedDate = '2026-10-01T00:00:00+03:00';
        await db.query('UPDATE data_items SET data=$1 WHERE id=$2', [JSON.stringify(f.ii[0]), f.iid]);
        f.sale.startDate = '2026-10-01';
        f.sale.paymentPlan = [
            { id: 'planned', date: '2026-11-21', amount: 200000, isPaid: true, isRealPayment: false },
            { ...f.sale.paymentPlan[0], date: '2026-11-21' },
        ];
        await db.query('UPDATE data_items SET data=$1 WHERE id=$2', [JSON.stringify(f.sale), f.sale.id]);
        const plan = await previewEntryDate(f, '2026-11-06');
        assert.equal(plan.review.rows.find(r => r.id === f.bid).after, expectedSecond);
        assert.deepEqual(plan.review.months, []);
        assert.equal((await f.svc.preview(f.owner, f.id)).investors.find(i => i.id === f.bid).joinedDate, f.ii[1].joinedDate);
        const result = await f.call('correctEntryDate', plan.input);
        assert.equal(result.balances.investors[f.bid].earned, expectedSecond);
        assert.equal(result.balances.investors[f.iid].earned, 50000 - expectedSecond);
        assert.equal(result.balances.manager.earned, 50000);
        assert.equal(result.changed.sales.length + result.changed.expenses.length, 0);
        assert.equal(result.account.poolAccounting.entryDateAdjustments[0].parts.length, 0);
    });
}

test('закрытый месяц сохраняется, поправка видна в текущем месяце и не применяется повторно', async () => {
    const f = await fixture({ auto: true });
    const initial = await f.svc.preview(f.owner, f.id);
    const snapshot = initial.account.poolAccounting.closed[0];
    await save(f.owner, 'expenses', { id: `payout_${f.owner}`, accountId: f.id, investorId: f.bid, payoutType: 'PROFIT', date: '2026-12-01', amount: 10000 });
    const plan = await previewEntryDate(f, '2026-11-21');
    assert.deepEqual(plan.review.months, ['2026-11']);
    assert.equal(plan.review.rows.find(r => r.id === f.bid).availableAfter, -10000);
    const input = { ...plan.input, requestId: req() };
    const result = await f.svc.mutate(f.owner, f.id, 'correctEntryDate', input);
    const replay = await f.svc.mutate(f.owner, f.id, 'correctEntryDate', input);
    assert(replay.replayed);
    assert.deepEqual(result.account.poolAccounting.closed[0], snapshot);
    assert.deepEqual(result.account.poolAccounting.reinvestments, initial.account.poolAccounting.reinvestments);
    assert.equal(replay.account.poolAccounting.entryDateAdjustments.length, 1);
    assert.equal(result.balances.investors[f.iid].earned, 50000);
    assert.equal(result.balances.investors[f.bid].available, -10000);
    const current = result.reports.find(r => r.month === '2026-12');
    assert.equal(current.distributable, 0);
    assert.equal(current.allocations.reduce((sum, row) => sum + row.amount, 0), 0);
    assert.equal(P.poolAllocationDetails(current, f.bid)[0].amount, -25000);
    assert.equal(P.poolAllocationDetails(current, '__manager__', 25000, undefined, f.iid)[0].amount, 25000);
    assert.equal(result.changed.sales.length + result.changed.expenses.length, 0);
    const reverse = await previewEntryDate(f, '2026-11-01');
    const restored = await f.call('correctEntryDate', reverse.input);
    assert.equal(restored.balances.investors[f.bid].earned, 25000);
    assert.equal(restored.account.poolAccounting.entryDateAdjustments.length, 2);
    assert.deepEqual(restored.account.poolAccounting.closed[0], snapshot);
});

test('исправление даты требует свежего сравнения, проверяет календарь и существующие движения капитала', async () => {
    const f = await fixture();
    for (const day of ['2026-11-31', '2026-12-02', '2026-11-01'])
        await assert.rejects(previewEntryDate(f, day), e => e.status === 400);
    const review = await previewEntryDate(f, '2026-11-21');
    await f.call('capital', { investorId: f.bid, kind: 'DEPOSIT', amount: 1000 });
    await assert.rejects(f.call('correctEntryDate', review.input), e => e.status === 409 && /заново/.test(e.message));
    const older = await fixture({ now: '2026-11-26T09:00:00+03:00' });
    await older.call('capital', { investorId: older.bid, kind: 'DEPOSIT', date: '2026-11-04', amount: 1000 });
    await assert.rejects(previewEntryDate(older, '2026-11-06'), e => e.status === 409 && /капиталом/.test(e.message));
});
test('одна правка пересчитывает открытый месяц и переносит разницу из закрытого отдельно', async () => {
    const f = await fixture({ now: '2026-12-25T09:00:00+03:00' });
    f.ii[1].joinedDate = '2026-12-20T00:00:00+03:00';
    await db.query('UPDATE data_items SET data=$1 WHERE id=$2', [JSON.stringify(f.ii[1]), f.bid]);
    await save(f.owner, 'sales', { ...f.sale, id: `${f.sale.id}_dec`, paymentPlan: [
        { ...f.sale.paymentPlan[0], id: 'early', date: '2026-12-10', amount: 100000 },
        { ...f.sale.paymentPlan[0], id: 'late', date: '2026-12-22', amount: 100000 },
    ] });
    const plan = await previewEntryDate(f, '2026-11-15');
    const second = plan.review.rows.find(row => row.id === f.bid);
    assert.deepEqual([second.before, second.openDelta, second.closedDelta, second.after], [12500, 12500, 25000, 50000]);
    const result = await f.call('correctEntryDate', plan.input);
    assert.equal(result.reports[0].allocations.find(row => row.id === f.bid).amount, 0);
    assert.equal(result.reports[1].allocations.find(row => row.id === f.bid).amount, 50000);
    assert.equal(result.balances.investors[f.bid].available, second.availableAfter);
    assert.equal(result.reports.reduce((sum, report) => sum + report.allocations.reduce((n, row) => n + row.amount, 0), 0), 200000);
    const followingMonth = createPoolService({ pool: db, now: () => Date.parse('2027-01-04T09:00:00+03:00') });
    const settled = await followingMonth.preview(f.owner, f.id);
    assert.equal(settled.account.poolAccounting.closed[1].entryDateAdjustments.length, 1);
    assert.equal(settled.balances.investors[f.bid].available, second.availableAfter);
});

test('первый вход до начала месячного учёта можно уточнить, пока не затронуты прежние начисления', async () => {
    const f = await fixture({ now: '2026-11-25T09:00:00+03:00' });
    f.ii[1].joinedDate = '2026-10-01T00:00:00+03:00';
    await db.query('UPDATE data_items SET data=$1 WHERE id=$2', [JSON.stringify(f.ii[1]), f.bid]);
    const plan = await previewEntryDate(f, '2026-10-20');
    await save(f.owner, 'sales', {
        ...f.sale, id: `${f.sale.id}_legacy`, startDate: '2026-10-10',
        paymentPlan: [{ ...f.sale.paymentPlan[0], date: '2026-10-15' }],
    });
    await assert.rejects(f.call('correctEntryDate', plan.input), e => e.status === 409 && /старую историю/.test(e.message));
});
test('ручное реинвестирование доступной текущей прибыли не создаёт приход денег',async()=>{const f=await fixture({now:'2026-11-25T12:00:00+03:00'});await f.call('reinvest',{investorId:f.iid,amount:10000});const p=await f.svc.preview(f.owner,f.id);assert.equal(p.balances.investors[f.iid].available,15000);assert.equal(p.investors.find(i=>i.id===f.iid).initialAmount,1010000);await assert.rejects(f.call('reinvest',{investorId:f.iid,amount:15000.01}),e=>e.status===409);assert.equal((await db.query("SELECT id FROM data_items WHERE user_id=$1 AND type='sales'",[f.owner])).rows.length,1);});
test('выплата после реинвестирования не может повторно использовать те же деньги', async () => { const f = await fixture(); let p = await f.svc.preview(f.owner, f.id); await f.call('close', { month: '2026-11', confirmed: true, fingerprint: p.reports[0].fingerprint }); await f.call('reinvest', { investorId: f.iid, amount: 20000 }); const e = { id: 'payout', accountId: f.id, investorId: f.iid, payoutType: 'PROFIT', amount: 5000.01, date: '2026-12-01T09:00:00+03:00' }; await assert.rejects(f.svc.guardWrite(f.owner, 'expenses', e), e => e.status === 409); await f.svc.guardWrite(f.owner, 'expenses', { ...e, amount: 5000 }); });
test('старая форма не меняет капитал, условия, закрытый платёж или сам журнал', async () => { const f = await fixture(); await assert.rejects(f.svc.guardWrite(f.owner, 'investors', { ...f.ii[0], initialAmount: 2e6 }, f.ii[0]), e => e.status === 409); await f.svc.guardWrite(f.owner, 'investors', { ...f.ii[0], phone: '123' }, f.ii[0]); await assert.rejects(f.svc.guardWrite(f.owner, 'accounts', { ...f.account, poolAccounting: undefined }, f.account), e => e.status === 409); let p = await f.svc.preview(f.owner, f.id); await f.call('close', { month: '2026-11', confirmed: true, fingerprint: p.reports[0].fingerprint }); await assert.rejects(f.svc.guardWrite(f.owner, 'sales', { ...f.sale, totalAmount: 300000 }, f.sale), e => e.status === 409); const future = { ...f.sale, paymentPlan: [...f.sale.paymentPlan, { id: 'new', amount: 1000, date: '2026-12-01T09:00:00+03:00', isPaid: true, isRealPayment: true }] }; await f.svc.guardWrite(f.owner, 'sales', future, f.sale); });
test('атомарное создание инвестора: ошибка сохранения депозита откатывает весь состав', async () => { const f = await fixture(); await db.query(`CREATE FUNCTION fail_pool_deposit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${f.owner}' AND NEW.type='sales' AND NEW.data->>'productName'='Вложение в общий пул' THEN RAISE EXCEPTION 'test rollback'; END IF; RETURN NEW; END $$`); await db.query('CREATE TRIGGER fail_deposit BEFORE INSERT ON data_items FOR EACH ROW EXECUTE FUNCTION fail_pool_deposit()'); try {
    await assert.rejects(f.call('addInvestor', { name: 'Третий', amount: 1000, rate: 50, disposition: 'PAYABLE' }));
    const v = await f.svc.preview(f.owner, f.id);
    assert.equal(v.investors.length, 2);
    assert.equal(v.account.poolMemberIds.length, 2);
}
finally {
    await db.query('DROP TRIGGER fail_deposit ON data_items');
    await db.query('DROP FUNCTION fail_pool_deposit()');
} });
test('новый пул и инвестор с логином создаются одной транзакцией и сохраняют идентичность при повторе', async () => { const f = await fixture(), id = req(), input = { requestId: id, newPoolName: 'Новый', name: 'Инвестор', amount: 1000, rate: 50, email: `${id}@example.test`, password: 'test12345', disposition: 'REINVEST' }; const a = await f.svc.mutate(f.owner, 'new', 'addInvestor', input), b = await f.svc.mutate(f.owner, 'new', 'addInvestor', input); assert.equal(a.account.id, b.account.id); assert.equal(b.investors.length, 1); assert.equal(b.investors[0].initialAmount, 1000); assert.equal((await db.query('SELECT id FROM users WHERE manager_id=$1', [f.owner])).rows.length, 1); });
test('контакты и выдача логина пассивному инвестору не меняют id и деньги', async () => { const f = await fixture(); await f.call('profile', { investorId: f.iid, name: 'Новое имя', email: `${f.owner}@example.test`, password: 'test12345', permissions: { canViewHistory: true } }); const v = await f.svc.preview(f.owner, f.id); assert.equal(v.investors.find(i => i.id === f.iid).initialAmount, 1e6); assert(v.account.poolMemberIds.includes(f.iid)); assert.equal((await db.query('SELECT manager_id FROM users WHERE id=$1', [f.iid])).rows[0].manager_id, f.owner); });
test('выход после возврата капитала и повторный вход сохраняют старые периоды', async () => { const f = await fixture(); await assert.rejects(f.call('exit', { investorId: f.iid }), e => e.status === 409); await f.call('capital', { investorId: f.iid, kind: 'WITHDRAW', amount: 1e6 }); await f.call('exit', { investorId: f.iid }); await f.call('reentry', { investorId: f.iid, amount: 500000 }); const i = (await f.svc.preview(f.owner, f.id)).investors.find(i => i.id === f.iid); assert.equal(i.investmentPeriods.length, 2); assert.equal(i.initialAmount, 500000); assert.equal(i.leftPoolDate, undefined); });
test('переход существующего пула только с будущего месяца; до перехода вложения доступны', async () => { const f = await fixture({ monthly: false, now: '2026-11-20T10:00:00+03:00' }); await assert.rejects(f.call('enable', { startMonth: '2026-11', confirmed: true, excludedSaleIds: [] }), e => e.status === 400); await f.call('enable', { startMonth: '2026-12', confirmed: true, excludedSaleIds: [] }); await f.call('capital', { investorId: f.iid, amount: 1000, kind: 'DEPOSIT' }); assert.equal((await f.svc.preview(f.owner, f.id)).investors.find(i => i.id === f.iid).initialAmount, 1001000); });

test('способ начисления сохраняется на будущий месяц и не меняет закрытый расчёт', async () => {
    const f = await fixture();
    const original = await f.svc.preview(f.owner, f.id);
    const snapshot = original.account.poolAccounting.closed[0];
    assert.equal(P.poolProfitBasis(original.account, '2026-12-01'), 'MONTH');
    await assert.rejects(f.call('profitBasis', { month: '2026-12', basis: 'SCHEDULE_PERIOD' }), e => e.status === 400);
    await assert.rejects(f.call('profitBasis', { month: '2027-01', basis: 'INVALID' }), e => e.status === 400);
    const scheduled = await f.call('profitBasis', { month: '2027-01', basis: 'SCHEDULE_PERIOD' });
    assert.equal(P.poolProfitBasis(scheduled.account, '2026-12-31'), 'MONTH');
    assert.equal(P.poolProfitBasis(scheduled.account, '2027-01-01'), 'SCHEDULE_PERIOD');
    assert.deepEqual(scheduled.account.poolAccounting.closed[0], snapshot);
    await f.call('terms', { month: '2027-01', investorId: f.iid, rate: 55, disposition: 'PAYABLE' });
    const reloaded = await f.svc.preview(f.owner, f.id);
    assert.equal(P.poolProfitBasis(reloaded.account, '2027-01-01'), 'SCHEDULE_PERIOD');
    assert.equal(P.poolTermsAt(reloaded.account, '2027-01-01').members[f.iid].rate, 55);
    const restored = await f.call('profitBasis', { month: '2027-01', basis: 'MONTH' });
    assert.equal(P.poolProfitBasis(restored.account, '2027-01-01'), 'MONTH');
});
test('чужой владелец и сотрудник не могут менять пул', async () => { const f = await fixture(), g = await fixture(); await assert.rejects(g.svc.mutate(g.owner, f.id, 'capital', { requestId: req(), investorId: f.iid, kind: 'DEPOSIT', amount: 1000 }), e => e.status === 404); await db.query("UPDATE users SET role='employee' WHERE id=$1", [f.owner]); await assert.rejects(f.call('capital', { investorId: f.iid, kind: 'DEPOSIT', amount: 1000 }), e => e.status === 403); });
async function httpRun(f, run, { v1 = false, atomic = false } = {}) {
    const express = require('express'), app = express(), { createPoolTransactions } = require('./transactions'), tx = createPoolTransactions(db);
    const svc = createPoolService({ pool: tx.db, now: () => Date.parse('2026-12-01T09:00:00+03:00') });
    app.use(express.json());
    app.use((req, res, next) => { req.apiAuth = { userId: f.owner, scopes: ['read', 'write'] }; next(); });
    app.use(tx.middleware);
    if (atomic) {
        await db.query('CREATE TABLE IF NOT EXISTS api_idempotency(user_id text,key text,endpoint text,request_hash text,status int,response jsonb,PRIMARY KEY(user_id,key))');
        const writes = require('../api/atomicWrites').createAtomicWrites(tx.db);
        app.use(writes.middleware);
    }
    if (v1)
        app.use('/v1', require('../api/v1').createApiV1Router({ pool: tx.db, poolAccountingService: svc }));
    else
        app.post('/payout', async (req, res) => { try {
            const e = { id: `payout_${req.body.id}`, accountId: f.id, investorId: f.iid, payoutType: 'PROFIT', amount: req.body.amount, date: '2026-12-01T09:00:00+03:00' };
            await svc.guardWrite(f.owner, 'expenses', e);
            await tx.db.query('INSERT INTO data_items(id,user_id,type,data) VALUES($1,$2,$3,$4)', [e.id, f.owner, 'expenses', JSON.stringify(e)]);
            res.json({ ok: true });
        }
        catch (e) {
            res.status(e.status || 500).json({ msg: e.message });
        } });
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
        await run(`http://127.0.0.1:${server.address().port}`);
    }
    finally {
        await new Promise(resolve => server.close(resolve));
    }
}
test('HTTP: параллельные выплаты не расходуют одну подтверждённую прибыль дважды', async () => { const f = await fixture(); const p = await f.svc.preview(f.owner, f.id); await f.call('close', { month: '2026-11', confirmed: true, fingerprint: p.reports[0].fingerprint }); await httpRun(f, async (url) => { const post = id => fetch(url + '/payout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, amount: 15000 }) }); const results = await Promise.all([post(req()), post(req())]); assert.deepEqual(results.map(r => r.status).sort(), [200, 409]); }); assert.equal((await f.svc.preview(f.owner, f.id)).balances.investors[f.iid].available, 10000); });
test('HTTP: вложенная транзакция идемпотентности возвращает один результат и один расход', async () => { const f = await fixture(); const p = await f.svc.preview(f.owner, f.id); await f.call('close', { month: '2026-11', confirmed: true, fingerprint: p.reports[0].fingerprint }); await httpRun(f, async (url) => { const body = { id: req(), amount: 1000 }, key = req(), options = { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) }; assert.equal((await fetch(url + '/payout', options)).status, 200); const repeat = await fetch(url + '/payout', options); assert.equal(repeat.status, 200); assert.equal(repeat.headers.get('idempotent-replay'), 'true'); }, { atomic: true }); assert.equal((await f.svc.preview(f.owner, f.id)).balances.investors[f.iid].available, 24000); });
test('HTTP API/ИИ: закрытый платёж нельзя удалить через отдельный маршрут платежей', async () => { const f = await fixture(); const p = await f.svc.preview(f.owner, f.id); await f.call('close', { month: '2026-11', confirmed: true, fingerprint: p.reports[0].fingerprint }); await httpRun(f, async (url) => { const r = await fetch(url + '/v1/payments/p', { method: 'DELETE' }); assert.equal(r.status, 409); assert.match((await r.json()).error.message, /закрытый месяц/); }, { v1: true }); assert.equal((await db.query('SELECT data FROM data_items WHERE id=$1', [f.sale.id])).rows[0].data.paymentPlan.length, 1); });
test('предварительное сравнение старого пула не сохраняет новый режим', async () => { const f = await fixture({ monthly: false, now: '2026-11-25T10:00:00+03:00' }), before = await db.query('SELECT data FROM data_items WHERE id=$1', [f.id]); const p = await f.svc.preview(f.owner, f.id); assert(p.comparison); assert.equal(p.comparison.rows.find(r => r.id === f.iid).proposed, 25000); assert.deepEqual((await db.query('SELECT data FROM data_items WHERE id=$1', [f.id])).rows, before.rows); });

test('переход с историей пересчитывает все месяцы, сохраняет выплаты и не меняет операции', async () => {
    const f = await fixture({ monthly: false });
    for (const i of f.ii) await db.query('UPDATE data_items SET data=$1 WHERE id=$2', [{ ...i, joinedDate: '2026-10-01T00:00:00+03:00' }, i.id]);
    await save(f.owner, 'sales', { ...f.sale, id: req(), startDate: '2026-10-05', paymentPlan: [{ ...f.sale.paymentPlan[0], date: '2026-10-25' }] });
    await save(f.owner, 'expenses', { id: req(), accountId: f.id, date: '2026-11-25', investorId: f.iid, payoutType: 'PROFIT', amount: 5000 });
    const records = () => db.query("SELECT id,data FROM data_items WHERE user_id=$1 AND type<>'accounts' ORDER BY id", [f.owner]);
    const before = await records();
    const { comparison } = await f.svc.preview(f.owner, f.id, { history: true });
    assert.equal(comparison.startMonth, '2026-10');
    assert.deepEqual(comparison.issues, []);
    assert.equal(comparison.rows.find(r => r.id === f.iid).paid, 5000);
    const input = { requestId: req(), confirmed: true, fingerprint: comparison.fingerprint };
    const result = await f.svc.mutate(f.owner, f.id, 'enableHistory', input);
    assert.deepEqual(result.account.poolAccounting.closed.map(r => r.month), ['2026-10', '2026-11']);
    assert.equal(result.account.poolAccounting.closed[0].status, 'CLOSED');
    assert.equal(result.balances.investors[f.iid].available, 45000);
    assert.equal(result.balances.investors[f.iid].paid, 5000);
    assert.deepEqual((await records()).rows, before.rows);
    const replay = await f.svc.mutate(f.owner, f.id, 'enableHistory', input);
    assert(replay.replayed);
    assert.equal(replay.account.poolAccounting.closed.length, 2);
});

test('новые данные после сравнения требуют повторного расчёта, сомнительный капитал блокирует перенос', async () => {
    const f = await fixture({ monthly: false });
    const { comparison } = await f.svc.preview(f.owner, f.id, { history: true });
    const changed = { ...f.sale, totalAmount: 190000 };
    await db.query('UPDATE data_items SET data=$1 WHERE id=$2', [JSON.stringify(changed), f.sale.id]);
    await assert.rejects(f.call('enableHistory', { fingerprint: comparison.fingerprint, confirmed: true }), e => e.status === 409 && /История изменилась/.test(e.message));
    await save(f.owner, 'sales', { id: req(), accountId: f.id, type: 'CASH', customerId: `system_deposit_${f.iid}`, startDate: '2026-11-03', totalAmount: 300, downPayment: 300, buyPrice: 0 });
    const preview = await f.svc.preview(f.owner, f.id, { history: true });
    assert(preview.comparison.issues.some(s => /операций капитала/.test(s)));
    await assert.rejects(f.call('enableHistory', { fingerprint: preview.comparison.fingerprint, confirmed: true }), e => e.status === 409 && /операций капитала/.test(e.message));
    assert.equal((await f.svc.preview(f.owner, f.id)).account.poolAccounting, undefined);
});
test('корректировка не двигает деньги и не переписывает закрытый результат', async () => { const f = await fixture(), p = await f.svc.preview(f.owner, f.id); await f.call('close', { month: '2026-11', confirmed: true, fingerprint: p.reports[0].fingerprint }); const snapshot = JSON.stringify((await f.svc.preview(f.owner, f.id)).account.poolAccounting.closed); await f.call('adjustment', { amount: -10000, reason: 'Уточнение прошлого периода', confirmed: true }); const v = await f.svc.preview(f.owner, f.id); assert.equal(JSON.stringify(v.account.poolAccounting.closed), snapshot); assert.equal(v.reports.find(r => r.month === '2026-12').costs, 10000); assert.equal((await db.query("SELECT id FROM data_items WHERE user_id=$1 AND type='expenses'", [f.owner])).rows.length, 0); await assert.rejects(f.call('adjustment', { amount: 100, reason: 'Без подтверждения' }), e => e.status === 400); });
test('устаревшая версия договора с другого устройства не стирает новый платёж', async () => { const f = await fixture({ now: '2026-11-25T12:00:00+03:00' }), first = structuredClone(f.sale); first.paymentPlan.push({ id: 'extra', date: '2026-11-24', amount: 1000, isPaid: true, isRealPayment: true }); await f.svc.guardWrite(f.owner, 'sales', first, f.sale); await db.query('UPDATE data_items SET data=$1 WHERE id=$2', [JSON.stringify(first), first.id]); await assert.rejects(f.svc.guardWrite(f.owner, 'sales', structuredClone(f.sale), first), e => e.status === 409 && /другом устройстве/.test(e.message)); assert.equal((await db.query('SELECT data FROM data_items WHERE id=$1', [first.id])).rows[0].data.paymentPlan.length, 2); });
test('повтор сохранения договора после потерянного ответа распознаётся по хешу без второго изменения', async () => { const f = await fixture({ now: '2026-11-25T12:00:00+03:00' }), input = { ...structuredClone(f.sale), productName: 'Обновлено' }, first = structuredClone(input); await f.svc.guardWrite(f.owner, 'sales', first, f.sale); const replay = structuredClone(input); await f.svc.guardWrite(f.owner, 'sales', replay, first); assert.equal(replay.poolRevision, first.poolRevision); assert.equal(replay._poolWriteHash, first._poolWriteHash); });
test('текущую прибыль можно выплатить без подтверждения, сверх доступного нельзя',async()=>{const f=await fixture({now:'2026-11-25T12:00:00+03:00'});const e={id:'current',accountId:f.id,investorId:f.iid,payoutType:'PROFIT',amount:1000,date:'2026-11-25'};await f.svc.guardWrite(f.owner,'expenses',e);await assert.rejects(f.svc.guardWrite(f.owner,'expenses',{...e,id:'over-current',poolRevision:undefined,amount:25000.01}),e=>e.status===409&&/доступной/.test(e.message));});
test('будущая оплата клиента не финансирует сегодняшний возврат капитала', async () => { const f = await fixture({ now: '2026-11-25T12:00:00+03:00' }); f.account.initialBalance = 0; f.sale.paymentPlan[0].date = '2026-12-20'; await db.query('UPDATE data_items SET data=$1 WHERE id=$2', [JSON.stringify(f.account), f.id]); await db.query('UPDATE data_items SET data=$1 WHERE id=$2', [JSON.stringify(f.sale), f.sale.id]); await assert.rejects(f.call('capital', { investorId: f.iid, amount: 1000, kind: 'WITHDRAW' }), e => e.status === 409 && /недостаточно денег/.test(e.message)); assert.equal((await f.svc.preview(f.owner, f.id)).investors.find(i => i.id === f.iid).initialAmount, 1e6); });
test('истёкшая подписка, закрытый тариф и архив не обходятся прямым запросом', async () => { const f = await fixture(); for (const opts of [{ getSubscriptionState: async () => ({ expired: true }) }, { checkFeatureAccess: async () => ({ allowed: false }) }]) {
    const svc = createPoolService({ pool: db, ...opts });
    await assert.rejects(svc.mutate(f.owner, f.id, 'capital', { requestId: req(), investorId: f.iid, amount: 1000, kind: 'DEPOSIT' }), e => e.status === 403);
} f.account.isArchived = true; await db.query('UPDATE data_items SET data=$1 WHERE id=$2', [JSON.stringify(f.account), f.id]); await assert.rejects(f.call('capital', { investorId: f.iid, amount: 1000, kind: 'DEPOSIT' }), e => e.status === 409); });
test('повтор старого добавления после перехода не создаёт второго участника и не сбрасывает пополнения', async () => { const f = await fixture({ monthly: false, now: '2026-11-25T12:00:00+03:00' }), input = { requestId: req(), name: 'Новый', amount: 10000, rate: 50, disposition: 'PAYABLE' }; const first = await f.svc.mutate(f.owner, f.id, 'addInvestor', input), id = first.investors.find(i => i.name === 'Новый').id; await f.call('enable', { startMonth: '2026-12', excludedSaleIds: [], confirmed: true }); await f.call('capital', { investorId: id, amount: 1000, kind: 'DEPOSIT' }); const replay = await f.svc.mutate(f.owner, f.id, 'addInvestor', input); assert.equal(replay.replayed, true); assert.equal(replay.investors.length, 3); assert.equal(replay.investors.find(i => i.id === id).initialAmount, 11000); assert(replay.changed.sales.some(s => s.totalAmount === 1000)); assert.equal(replay.account.poolAccounting.revision, 2); });

test('ответ параллельной операции содержит согласованные версии капитала и пула', async () => { const f = await fixture(); const results = await Promise.all(Array.from({ length: 4 }, () => f.call('capital', { investorId: f.iid, kind: 'DEPOSIT', amount: 1000 }))); for (const r of results) {
    const member = r.investors.find(i => i.id === f.iid);
    assert.equal(member.initialAmount, r.changed.investors[0].initialAmount);
    assert.equal(member.initialAmount, 1000000 + (r.account.poolAccounting.revision - 1) * 1000);
} });

const records=async f=>(await db.query('SELECT type,data FROM data_items WHERE user_id=$1 ORDER BY id',[f.owner])).rows;
async function automaticFixture(auto=false){
    const f=await fixture({now:'2027-01-15T12:00:00+03:00',auto});
    const december={...structuredClone(f.sale),id:`dec_${f.owner}`,startDate:'2026-12-01',paymentPlan:[{id:'dec',date:'2026-12-20',amount:200000,isPaid:true,isRealPayment:true}]};
    const january={...structuredClone(f.sale),id:`jan_${f.owner}`,startDate:'2027-01-01',paymentPlan:[{id:'jan',date:'2027-01-05',amount:20000,isPaid:true,isRealPayment:true}]};
    await save(f.owner,'sales',december);await save(f.owner,'sales',january);return {...f,december,january};
}
test('автоматический расчёт всех завершённых месяцев и текущая прибыль доступны без подтверждения',async()=>{
    const f=await automaticFixture(),before=await records(f),v=await f.svc.preview(f.owner,f.id);
    assert.deepEqual(v.account.poolAccounting.closed.map(r=>r.month),['2026-11','2026-12']);assert.equal(v.reports.find(r=>r.month==='2027-01').status,'PRELIMINARY');
    assert.equal(v.balances.investors[f.iid].earned,52500);assert.equal(v.balances.investors[f.iid].available,52500);assert.equal(v.balances.manager.available,105000);
    assert.deepEqual((await records(f)).filter(r=>['sales','expenses'].includes(r.type)),before.filter(r=>['sales','expenses'].includes(r.type)));
    const after=await records(f);await f.svc.preview(f.owner,f.id);assert.deepEqual(await records(f),after);
});
test('6 параллельных автоматических расчётов фиксируют месяцы и реинвестирование один раз',async()=>{
    const f=await automaticFixture(true);await Promise.all(Array.from({length:6},()=>f.svc.settleOwner(f.owner)));
    const v=await f.svc.preview(f.owner,f.id);assert.equal(v.account.poolAccounting.closed.length,2);assert.equal(v.account.poolAccounting.reinvestments.length,2);assert.equal(v.account.poolAccounting.revision,1);
    assert.equal(v.investors.find(i=>i.id===f.iid).initialAmount,1050308.64);assert(v.balances.investors[f.iid].available>0);
    assert.equal(v.balances.investors[f.iid].available,v.balances.investors[f.iid].pending);
});
test('выплаченная текущая прибыль не реинвестируется второй раз в конце месяца',async()=>{
    const f=await fixture({auto:true,now:'2026-11-25T12:00:00+03:00'});
    const payout={id:req(),accountId:f.id,payoutType:'PROFIT',investorId:f.iid,date:'2026-11-25',amount:10000};await f.svc.guardWrite(f.owner,'expenses',payout);await save(f.owner,'expenses',payout);
    const before=await records(f),endService=createPoolService({pool:db,now:()=>Date.parse('2026-12-01T09:00:00+03:00')});
    const v=await endService.preview(f.owner,f.id);assert.equal(v.investors.find(i=>i.id===f.iid).initialAmount,1015000);assert.equal(v.account.poolAccounting.reinvestments[0].amount,15000);assert.equal(v.balances.investors[f.iid].available,0);
    assert.deepEqual((await records(f)).filter(r=>['sales','expenses'].includes(r.type)),before.filter(r=>['sales','expenses'].includes(r.type)));
});
test('ошибка позднего месяца не сохраняет часть истории или капитал; исправление позволяет повторить автоматически',async()=>{
    const f=await automaticFixture(true);f.december.paymentPlan[0].amount='invalid';await db.query('UPDATE data_items SET data=$1 WHERE id=$2',[JSON.stringify(f.december),f.december.id]);
    const before=await records(f),failed=await f.svc.settleOwner(f.owner);assert.equal(failed.issues.length,1);assert.deepEqual(await records(f),before);
    f.december.paymentPlan[0].amount=200000;await db.query('UPDATE data_items SET data=$1 WHERE id=$2',[JSON.stringify(f.december),f.december.id]);
    assert.equal((await f.svc.preview(f.owner,f.id)).account.poolAccounting.closed.length,2);
});
test('ошибка записи автоматического расчёта откатывает весь журнал и капитал',async()=>{
    const f=await automaticFixture(true),before=await records(f);
    await db.query(`CREATE FUNCTION fail_automatic_pool() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${f.owner}' AND NEW.type='accounts' THEN RAISE EXCEPTION 'automatic rollback'; END IF; RETURN NEW; END $$`);
    await db.query('CREATE TRIGGER fail_automatic_pool BEFORE UPDATE ON data_items FOR EACH ROW EXECUTE FUNCTION fail_automatic_pool()');
    try{await assert.rejects(f.svc.settleOwner(f.owner));assert.deepEqual(await records(f),before)}finally{await db.query('DROP TRIGGER fail_automatic_pool ON data_items');await db.query('DROP FUNCTION fail_automatic_pool()')}
});
test('защита от устаревшей карточки инвестора сохраняет капитал после автоматического реинвестирования',async()=>{
    const f=await fixture({auto:true});await assert.rejects(f.svc.guardWrite(f.owner,'investors',{...f.ii[0],phone:'123'},f.ii[0]),e=>e.status===409);
    assert.equal((await f.svc.preview(f.owner,f.id)).investors.find(i=>i.id===f.iid).initialAmount,1025000);
});
test('новый месяц фиксирует только завершённый результат; будущие оплаты не становятся текущей прибылью',async()=>{
    const f=await fixture({now:'2026-11-25T12:00:00+03:00'});f.sale.paymentPlan[0].date='2026-12-20';await db.query('UPDATE data_items SET data=$1 WHERE id=$2',[JSON.stringify(f.sale),f.sale.id]);
    assert.equal((await f.svc.preview(f.owner,f.id)).balances.investors[f.iid].available,0);
    const endService=createPoolService({pool:db,now:()=>Date.parse('2026-11-30T21:00:00Z')});const v=await endService.preview(f.owner,f.id);assert.equal(v.account.poolAccounting.closed.length,1);assert.equal(v.balances.investors[f.iid].available,0);
});
test('старые пулы без нового режима не меняются, сотрудник не запускает фиксацию',async()=>{
    const f=await fixture({monthly:false}),before=await records(f);await f.svc.settleOwner(f.owner);assert.deepEqual(await records(f),before);
    const g=await fixture();await db.query("UPDATE users SET role='employee' WHERE id=$1",[g.owner]);const employeeBefore=await records(g);await g.svc.settleOwner(g.owner);assert.deepEqual(await records(g),employeeBefore);
});
test('повреждённая прежняя выплата блокирует автоматическую фиксацию, не создавая частичного результата',async()=>{
    const f=await automaticFixture();await save(f.owner,'expenses',{id:req(),accountId:f.id,payoutType:'PROFIT',investorId:f.iid,date:'2026-12-25',amount:'invalid'});const before=await records(f);
    const failed=await f.svc.settleOwner(f.owner);assert.equal(failed.issues.length,1);assert.deepEqual(await records(f),before);
});
test('текущая выплата после автоматического реинвестирования ограничена доступной суммой',async()=>{
    const f=await automaticFixture(true),v=await f.svc.preview(f.owner,f.id),available=v.balances.investors[f.iid].available;
    const e={id:req(),accountId:f.id,payoutType:'PROFIT',investorId:f.iid,date:'2027-01-15',amount:available};await f.svc.guardWrite(f.owner,'expenses',e);
    await assert.rejects(f.svc.guardWrite(f.owner,'expenses',{...e,id:req(),poolRevision:undefined,amount:Math.round((available+0.01)*100)/100}),e=>e.status===409);
});
