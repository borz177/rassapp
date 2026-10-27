// «Почему»: сравнение двух периодов — что изменилось и из-за чего.
//
// Цифры периода — теми же формулами, что сводка /api/v1/reports/summary
// (собрано, прибыль, расходы), а объяснения — из самих записей: какие статьи
// расходов выросли, кто платил раньше и перестал, сколько оформлено новых
// договоров. Модель только пересказывает — сама ничего не досчитывает.

const domain = require('../api/domain');
const { collectionPayments, isCustomerSale } = require('../../shared/collections.js');
const { mskDay, addDays, daysBetween, isDay } = require('./collections');

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
const inDays = (d, p) => { if (!d) return false; const day = mskDay(d); return day >= p.from && day <= p.to; };
const change = (cur, prev) => ({ delta: Math.round(cur - prev), percent: prev ? Math.round((cur - prev) / Math.abs(prev) * 1000) / 10 : null });

/**
 * Периоды по умолчанию. Месяц с первого числа по сегодня — с тем же отрезком
 * прошлого месяца (1–23 октября ↔ 1–23 сентября); иначе — такой же длины сразу
 * перед ним.
 */
const resolvePeriods = ({ from, to, compareFrom, compareTo } = {}, today = mskDay()) => {
  if (from && !isDay(from)) return { error: 'from — дата ГГГГ-ММ-ДД.' };
  if (to && !isDay(to)) return { error: 'to — дата ГГГГ-ММ-ДД.' };
  if (compareFrom && !isDay(compareFrom)) return { error: 'compareFrom — дата ГГГГ-ММ-ДД.' };
  if (compareTo && !isDay(compareTo)) return { error: 'compareTo — дата ГГГГ-ММ-ДД.' };
  const a = { from: from || `${(to || today).slice(0, 8)}01`, to: to || today };
  if (a.from > a.to) return { error: 'Начало периода позже конца.' };
  if (daysBetween(a.from, a.to) > 400) return { error: 'Период длиннее 400 дней — сузьте.' };
  let b;
  if (compareFrom || compareTo) {
    if (!compareFrom || !compareTo) return { error: 'Для периода сравнения нужны обе даты: compareFrom и compareTo.' };
    b = { from: compareFrom, to: compareTo };
    if (b.from > b.to) return { error: 'Начало периода сравнения позже конца.' };
  } else if (a.from.endsWith('-01') && a.from.slice(0, 7) === a.to.slice(0, 7)) {
    // Тот же отрезок прошлого месяца; 31-е — последний день короткого месяца
    const y = Number(a.from.slice(0, 4)), m = Number(a.from.slice(5, 7)) - 1;
    const py = m === 0 ? y - 1 : y, pm = m === 0 ? 12 : m;
    const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
    const pre = `${py}-${String(pm).padStart(2, '0')}`;
    b = { from: `${pre}-01`, to: `${pre}-${String(Math.min(Number(a.to.slice(8, 10)), last)).padStart(2, '0')}` };
  } else {
    const len = daysBetween(a.from, a.to);
    b = { from: addDays(a.from, -len - 1), to: addDays(a.from, -1) };
  }
  return { current: a, previous: b };
};

/**
 * Просрочка на конец дня: сколько должно было прийти по графику к этому дню
 * и сколько пришло. Для прошлых дат — по нынешнему графику (если график потом
 * переносили, цифра это учитывает).
 */
const overdueOn = (sale, day) => {
  if (!sale.startDate || mskDay(sale.startDate) > day) return 0;
  let expected = Number(sale.downPayment) || 0;
  let paid = Number(sale.downPayment) || 0;
  for (const p of sale.paymentPlan || []) {
    if (p.isRealPayment !== true && p.date && mskDay(p.date) <= day) expected += Number(p.amount) || 0;
    if (p.isPaid && p.isRealPayment !== false && mskDay(p.actualDate || p.date) <= day) paid += (Number(p.amount) || 0) + (Number(p.discountAmount) || 0);
  }
  const o = round(expected - paid);
  return o >= 1 ? o : 0;
};

const periodStats = ({ contracts, moneyContracts, expenses, period, withoutDownPayment }) => {
  let collected = 0, profit = 0;
  const paidBy = new Map();
  for (const s of moneyContracts) {
    for (const m of domain.moneyIn(s)) if (inDays(m.date, period)) profit += domain.moneyInProfit(s, m, false);
    for (const m of collectionPayments(s, withoutDownPayment)) {
      if (!inDays(m.actualDate || m.date, period)) continue;
      collected += m.amount;
      // Кто сколько внёс по графику (первый взнос — не про дисциплину)
      if (m.id !== `${s.id}_dp`) paidBy.set(s.customerId, (paidBy.get(s.customerId) || 0) + m.amount);
    }
  }
  const exp = expenses.filter(e => inDays(e.date, period));
  const purchases = exp.filter(e => String(e.id).startsWith('exp_sale_'));
  const other = exp.filter(e => !String(e.id).startsWith('exp_sale_'));
  const byCategory = new Map();
  for (const e of other) byCategory.set(e.category || 'Прочее', (byCategory.get(e.category || 'Прочее') || 0) + (Number(e.amount) || 0));
  const fresh = contracts.filter(s => inDays(s.startDate, period));
  return {
    from: period.from, to: period.to,
    collected: Math.round(collected), profit: Math.round(profit),
    expenses: Math.round(exp.reduce((n, e) => n + (Number(e.amount) || 0), 0)),
    purchases: Math.round(purchases.reduce((n, e) => n + (Number(e.amount) || 0), 0)),
    otherExpenses: Math.round(other.reduce((n, e) => n + (Number(e.amount) || 0), 0)),
    newContracts: { count: fresh.length, total: Math.round(fresh.reduce((n, s) => n + (Number(s.totalAmount) || 0), 0)),
      markup: Math.round(fresh.reduce((n, s) => n + (Number(s.totalAmount) || 0) - (Number(s.buyPrice) || 0), 0)) },
    overdueAtEnd: Math.round(moneyContracts.reduce((n, s) => n + overdueOn(s, period.to), 0)),
    _byCategory: byCategory, _paidBy: paidBy, _other: other,
  };
};

/** Сравнение периодов: цифры обоих, разница и что её объясняет */
const comparePeriods = ({ sales, expenses, customers = [], investors = [], withoutDownPayment = false, accountId = null, periods }) => {
  const investorIds = new Set(investors.map(i => i.id));
  const isContract = s => isCustomerSale(s, investorIds) && s.type === 'INSTALLMENT';
  const contracts = sales.filter(s => (!accountId || domain.saleTouchesAccount(s, accountId)) && isContract(s));
  const moneyContracts = domain.expandFundedSales(sales).filter(s => (!accountId || s.accountId === accountId) && isContract(s));
  const exp = expenses.filter(e => !accountId || e.accountId === accountId);
  const names = new Map(customers.map(c => [c.id, c.name || 'Клиент']));
  const cur = periodStats({ contracts, moneyContracts, expenses: exp, period: periods.current, withoutDownPayment });
  const prev = periodStats({ contracts, moneyContracts, expenses: exp, period: periods.previous, withoutDownPayment });

  const categories = [...new Set([...cur._byCategory.keys(), ...prev._byCategory.keys()])]
    .map(category => ({ category, current: Math.round(cur._byCategory.get(category) || 0), previous: Math.round(prev._byCategory.get(category) || 0) }))
    .map(x => ({ ...x, delta: x.current - x.previous }))
    .filter(x => x.delta).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5);
  // Платили в прошлом периоде и не платили в этом, хотя долг остался
  const owing = new Set(contracts.filter(s => s.status === 'ACTIVE' && Number(s.remainingAmount) >= 1).map(s => s.customerId));
  const stopped = [...prev._paidBy].filter(([id, n]) => n >= 1 && !(cur._paidBy.get(id) >= 1) && owing.has(id))
    .map(([id, n]) => ({ customer: names.get(id) || 'Клиент', previousPaid: Math.round(n) })).sort((a, b) => b.previousPaid - a.previousPaid);
  const shifts = [...new Set([...cur._paidBy.keys(), ...prev._paidBy.keys()])]
    .map(id => ({ customer: names.get(id) || 'Клиент', current: Math.round(cur._paidBy.get(id) || 0), previous: Math.round(prev._paidBy.get(id) || 0) }))
    .map(x => ({ ...x, delta: x.current - x.previous })).filter(x => x.delta);
  const strip = ({ _byCategory, _paidBy, _other, ...x }) => x;
  const keys = ['collected', 'profit', 'expenses', 'purchases', 'otherExpenses', 'overdueAtEnd'];
  return {
    current: strip(cur), previous: strip(prev),
    change: { ...Object.fromEntries(keys.map(k => [k, change(cur[k], prev[k])])), newContracts: change(cur.newContracts.count, prev.newContracts.count) },
    drivers: {
      expenseCategories: categories,
      biggestExpenses: cur._other.sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0)).slice(0, 3)
        .map(e => ({ title: e.title || e.category || 'Расход', category: e.category || 'Прочее', amount: Math.round(Number(e.amount) || 0), date: mskDay(e.date) })),
      stoppedPaying: { count: stopped.length, total: stopped.reduce((n, x) => n + x.previousPaid, 0), customers: stopped.slice(0, 5) },
      paidMore: shifts.filter(x => x.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3),
      paidLess: shifts.filter(x => x.delta < 0 && x.current > 0).sort((a, b) => a.delta - b.delta).slice(0, 3),
    },
    basis: 'Собрано, прибыль и расходы — как в сводке приложения. Закуп — расходы на товар по новым договорам. Просрочка на конец периода — по нынешнему графику платежей.',
  };
};

/**
 * Разбивка договоров: по товару, клиенту, счёту или месяцу оформления (или без
 * разбивки — итог). На каждую группу: сколько договоров, на какую сумму, средний
 * чек, закуп и наценка, получено и прибыль с полученного (за всё время), остаток
 * и просрочка. Для «сколько договоров на айфоны», «кто должен больше всех»,
 * «кто заплатил больше всех», «на чём я заработал». Период — по дате оформления.
 */
const GROUPS = ['product', 'customer', 'account', 'month', 'none'];
const SORTS = ['totalAmount', 'contracts', 'collected', 'profitReceived', 'remaining', 'overdue', 'averageTotal'];
const breakdown = ({ sales, customers = [], accounts = [], investors = [], groupBy = 'product', from, to, search, sort = 'totalAmount', limit = 20 }) => {
  if (!GROUPS.includes(groupBy)) return { error: `groupBy — одно из: ${GROUPS.join(', ')}.` };
  if (!SORTS.includes(sort)) return { error: `sort — одно из: ${SORTS.join(', ')}.` };
  if ((from && !isDay(from)) || (to && !isDay(to))) return { error: 'from и to — даты ГГГГ-ММ-ДД.' };
  const investorIds = new Set(investors.map(i => i.id));
  const names = new Map(customers.map(c => [c.id, c.name || 'Клиент']));
  const accNames = new Map(accounts.map(a => [a.id, a.name || 'Счёт']));
  const words = String(search || '').toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
  const list = sales.filter(s => s.type === 'INSTALLMENT' && isCustomerSale(s, investorIds))
    .filter(s => (!from || mskDay(s.startDate) >= from) && (!to || mskDay(s.startDate) <= to))
    .filter(s => !words.length || words.every(w => `${s.productName || ''} ${names.get(s.customerId) || ''}`.toLowerCase().replace(/ё/g, 'е').includes(w)));
  const keyOf = (s) => groupBy === 'product' ? String(s.productName || 'Без названия').trim()
    : groupBy === 'customer' ? names.get(s.customerId) || 'Клиент'
    : groupBy === 'account' ? accNames.get(s.accountId) || 'Без счёта'
    : groupBy === 'month' ? mskDay(s.startDate).slice(0, 7) : 'Всего';
  const groups = new Map();
  const add = (g, s) => {
    g.contracts++; g.totalAmount += Number(s.totalAmount) || 0; g.buyPrice += Number(s.buyPrice) || 0;
    g.collected += domain.collected(s); g.profitReceived += domain.receivedProfit(s);
    g.remaining += Number(s.remainingAmount) || 0; g.overdue += domain.overdueAmount(s);
  };
  const blank = (name) => ({ name, contracts: 0, totalAmount: 0, buyPrice: 0, collected: 0, profitReceived: 0, remaining: 0, overdue: 0 });
  const all = blank('Всего');
  for (const s of list) {
    const k = keyOf(s);
    if (!groups.has(k)) groups.set(k, blank(k));
    add(groups.get(k), s); add(all, s);
  }
  const fin = (g) => ({ name: g.name, contracts: g.contracts, totalAmount: Math.round(g.totalAmount), averageTotal: g.contracts ? Math.round(g.totalAmount / g.contracts) : 0,
    buyPrice: Math.round(g.buyPrice), markup: Math.round(g.totalAmount - g.buyPrice), collected: Math.round(g.collected),
    profitReceived: Math.round(g.profitReceived), remaining: Math.round(g.remaining), overdue: Math.round(g.overdue) });
  const rows = [...groups.values()].map(fin)
    .sort((a, b) => groupBy === 'month' && sort === 'totalAmount' ? a.name.localeCompare(b.name) : b[sort] - a[sort]);
  const n = Math.min(Math.max(Number(limit) || 20, 1), 100);
  return {
    groupBy, period: { from: from || null, to: to || null }, search: search || null, sort,
    totals: fin(all), groupsCount: rows.length, groups: groupBy === 'none' ? [] : rows.slice(0, n),
    basis: 'Договоры рассрочки клиентов, оформленные в периоде (без периода — все). Получено и прибыль с полученного — за всё время по этим договорам, как в отчётах прибыли. Цифры брать отсюда, не складывать самому.',
  };
};

/** Помесячно за прошлые месяцы: собрано, прибыль, расходы (закуп отдельно), новые договоры */
const monthly = ({ sales, expenses, investors = [], withoutDownPayment = false, accountId = null, from, to, today = mskDay() }) => {
  const start = from && isDay(from) ? from.slice(0, 7) : null, end = to && isDay(to) ? to.slice(0, 7) : today.slice(0, 7);
  if (from && !isDay(from)) return { error: 'from — дата ГГГГ-ММ-ДД.' };
  if (to && !isDay(to)) return { error: 'to — дата ГГГГ-ММ-ДД.' };
  const months = [];
  const ym = (m, k) => { const d = new Date(`${m}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + k); return d.toISOString().slice(0, 7); };
  for (let m = start || ym(end, -5); m <= end && months.length < 24; m = ym(m, 1)) months.push(m);
  if (!months.length) return { error: 'Начало периода позже конца.' };
  const investorIds = new Set(investors.map(i => i.id));
  const isContract = s => isCustomerSale(s, investorIds) && s.type === 'INSTALLMENT';
  const contracts = sales.filter(s => (!accountId || domain.saleTouchesAccount(s, accountId)) && isContract(s));
  const moneyContracts = domain.expandFundedSales(sales).filter(s => (!accountId || s.accountId === accountId) && isContract(s));
  const exp = expenses.filter(e => !accountId || e.accountId === accountId);
  const rows = months.map(m => {
    const last = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
    // Текущий месяц — по сегодня
    const period = { from: `${m}-01`, to: m === today.slice(0, 7) ? today : `${m}-${String(last).padStart(2, '0')}` };
    const st = periodStats({ contracts, moneyContracts, expenses: exp, period, withoutDownPayment });
    return { month: m, collected: st.collected, profit: st.profit, expenses: st.expenses, purchases: st.purchases, otherExpenses: st.otherExpenses, newContracts: st.newContracts.count, newContractsTotal: st.newContracts.total };
  });
  const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
  return { months: rows, totals: { collected: sum('collected'), profit: sum('profit'), expenses: sum('expenses'), newContracts: sum('newContracts') },
    basis: 'Прошедшие месяцы — как сводка приложения (текущий — по сегодня). Будущие месяцы — это прогноз (cash_forecast), не этот отчёт.' };
};

/**
 * Выписка по счёту: из чего сложился остаток — каждая операция с датой и суммой,
 * остаток на начало и конец периода. Операции — ровно те, что считает остаток
 * (domain.accountBalances): первые взносы и платежи (moneyIn по долям счетов),
 * прочие приходы и взносы инвесторов, расходы, магазин. Поэтому начальный остаток
 * + все операции = остаток на экране.
 *
 * Прод 22.10: «днём в кассе было 17 400, потом стало 307 000 — откуда?» — агент видел
 * только платежи дня и ответил «технический сбой». Скачки дают записи «задним числом»:
 * приход или расход, внесённый сегодня, но с датой другого дня, правка суммы, новый
 * начальный остаток счёта. changedAt (id → когда менялась запись) отдаёт их отдельно.
 *
 * Возвращает { accounts: [{ id, name, opening, in, out, closing, current }], items, changedElsewhere } или { error }.
 */
const MOVEMENT_LIMIT = 60;
const movements = ({ accounts = [], sales = [], expenses = [], retailSales = [], customers = [], investors = [], changedAt = new Map(),
  accountId = null, from, to, today = mskDay() }) => {
  const start = from || today, end = to || from || today;
  if (!isDay(start) || !isDay(end) || start > end) return { error: 'Период — даты ГГГГ-ММ-ДД, from не позже to.' };
  const live = accounts.filter(a => !a.isArchived || a.id === accountId);
  const scope = accountId ? live.filter(a => a.id === accountId) : live;
  if (accountId && !scope.length) return { error: 'Счёт не найден — возьми id из list_accounts.' };
  const inScope = new Set(scope.map(a => a.id));
  const names = new Map(customers.map(c => [c.id, c.name]));
  const investorName = new Map(investors.map(i => [i.id, i.name]));
  const accName = new Map(accounts.map(a => [a.id, a.name || 'Счёт']));
  const all = [];
  const push = (m) => { if (inScope.has(m.accountId) && Math.abs(m.amount) >= 0.01) all.push({ ...m, day: m.date ? mskDay(m.date) : '' }); };

  for (const s of domain.expandFundedSales(sales)) {
    const cid = String(s.customerId || '');
    const inv = cid.startsWith('system_deposit_') ? cid.slice('system_deposit_'.length) : investorName.has(cid) ? cid : null;
    const sourceId = String(s.id).split('__')[0];
    for (const m of domain.moneyIn(s)) {
      const isDown = m.id === `${s.id}_dp`;
      const kind = inv ? 'Взнос инвестора' : cid === 'system_income' || (cid.startsWith('system_') && s.type === 'CASH') ? 'Приход'
        : s.type === 'CASH' ? 'Продажа за наличные' : isDown ? 'Первый взнос' : 'Платёж';
      push({ id: m.id, sourceId, accountId: s.accountId, date: m.date, amount: m.amount, kind,
        title: inv ? investorName.get(inv) || 'инвестор' : kind === 'Приход' ? s.productName || 'Приход' : `${names.get(cid) || 'клиент'} — ${s.productName || 'договор'}` });
    }
  }
  for (const e of expenses) {
    if (e.isRefund === true) continue;
    const kind = String(e.id).startsWith('exp_sale_') ? 'Закуп' : e.payoutType || e.investorId ? 'Выплата инвестору' : 'Расход';
    push({ id: e.id, sourceId: e.id, accountId: e.accountId, date: e.date, amount: -(Number(e.amount) || 0), kind, title: e.title || e.category || 'Расход' });
  }
  for (const r of retailSales) {
    if (r.isCancelled) continue;
    if (r.returnOf) push({ id: r.id, sourceId: r.id, accountId: r.accountId, date: r.date, amount: -Math.max(0, Number(r.refund ?? -r.total) || 0), kind: 'Возврат в магазине', title: 'Возврат покупателю' });
    else if (!r.isCredit) push({ id: r.id, sourceId: r.id, accountId: r.accountId, date: r.date, amount: Number(r.total) || 0, kind: 'Продажа в магазине', title: 'Чек' });
    for (const pm of r.payments || []) push({ id: `${r.id}_${pm.id || pm.date}`, sourceId: r.id, accountId: pm.accountId, date: pm.date || r.date, amount: Number(pm.amount) || 0, kind: 'Оплата долга магазину', title: 'Оплата чека в долг' });
  }

  const round = n => Math.round(n * 100) / 100;
  const summary = scope.map(a => {
    const own = all.filter(m => m.accountId === a.id);
    const sum = f => round(own.filter(f).reduce((n, m) => n + m.amount, 0));
    const initial = Number(a.initialBalance) || 0;
    const opening = round(initial + sum(m => m.day < start));
    const inP = own.filter(m => m.day >= start && m.day <= end);
    return {
      id: a.id, name: a.name || 'Счёт', initialBalance: initial, opening,
      in: round(inP.filter(m => m.amount > 0).reduce((n, m) => n + m.amount, 0)),
      out: round(-inP.filter(m => m.amount < 0).reduce((n, m) => n + m.amount, 0)),
      closing: round(opening + inP.reduce((n, m) => n + m.amount, 0)),
      current: round(initial + own.reduce((n, m) => n + m.amount, 0)),
      ...(changedAt.has(a.id) && mskDay(changedAt.get(a.id)) >= start && mskDay(changedAt.get(a.id)) <= end
        ? { accountChanged: 'Счёт правили в этот период — начальный остаток мог измениться' } : {}),
    };
  });
  const inPeriod = all.filter(m => m.day >= start && m.day <= end).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const view = m => ({ date: m.date, kind: m.kind, title: m.title, amount: round(m.amount), ...(scope.length > 1 ? { account: accName.get(m.accountId) } : {}) });
  // Изменены в периоде, а датированы другим днём — то, что «вдруг» сдвинуло остаток.
  // Только записи «одна запись — одна операция»: договор меняется с каждым платежом,
  // и все его старые платежи выглядели бы правленными
  const single = new Set(['Приход', 'Взнос инвестора', 'Продажа за наличные', 'Расход', 'Закуп', 'Выплата инвестору', 'Продажа в магазине', 'Возврат в магазине']);
  const changedElsewhere = all
    .filter(m => { if (!single.has(m.kind)) return false; const c = changedAt.get(m.sourceId); if (!c) return false; const d = mskDay(c); return d >= start && d <= end && (m.day < start || m.day > end); })
    .sort((a, b) => String(changedAt.get(b.sourceId)).localeCompare(String(changedAt.get(a.sourceId))))
    .slice(0, 20)
    .map(m => ({ ...view(m), changedAt: changedAt.get(m.sourceId) }));
  return {
    from: start, to: end, accounts: summary,
    items: inPeriod.slice(0, MOVEMENT_LIMIT).map(view),
    ...(inPeriod.length > MOVEMENT_LIMIT ? { more: inPeriod.length - MOVEMENT_LIMIT } : {}),
    changedElsewhere,
    note: 'Удалённые записи здесь не видны: остаток мог вырасти от удалённого расхода (или закупа вместе с договором) и уменьшиться от удалённого прихода или платежа.',
  };
};

module.exports = { resolvePeriods, overdueOn, comparePeriods, breakdown, monthly, movements };
