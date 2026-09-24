// Публичное API v1: маршруты, доступные по API-ключу.
//
// Договорённости, общие для всех маршрутов (они же описаны в документации):
//   • ответ всегда { data } или { data, meta } у списков, ошибка — { error: {code, message} };
//   • списки постраничные: limit (по умолчанию 50, максимум 200) и offset;
//   • наружу отдаются только описанные поля, а не внутренняя запись целиком:
//     внутреннее устройство мы меняем часто, а обещание клиенту менять нельзя;
//   • создание отвечает 201 и заголовком Location;
//   • деньги — числа с двумя знаками, даты — ISO.

const express = require('express');
const crypto = require('crypto');
const { CODES, ok, created, noContent, fail, route, readPaging, paginate } = require('./http');
const { validate } = require('./validate');
const { requireScope } = require('./auth');
const domain = require('./domain');

const newId = prefix => `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

const createApiV1Router = ({ pool, checkContractLimit, planLimits }) => {
  const router = express.Router();

  // ── доступ к данным ──────────────────────────────────────────────────────
  const loadAll = async (userId, type) => {
    const { rows } = await pool.query(`SELECT data FROM data_items WHERE user_id = $1 AND type = $2`, [userId, type]);
    return rows.map(r => r.data);
  };
  const loadOne = async (userId, type, id) => {
    const { rows } = await pool.query(
      `SELECT data FROM data_items WHERE user_id = $1 AND type = $2 AND id = $3`, [userId, type, id]);
    return rows[0]?.data || null;
  };
  const save = async (userId, type, item) => {
    await pool.query(
      `INSERT INTO data_items (id, user_id, type, data, updated_at) VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [item.id, userId, type, JSON.stringify(item)]
    );
    return item;
  };
  const remove = async (userId, type, id) => {
    const { rowCount } = await pool.query(
      `DELETE FROM data_items WHERE user_id = $1 AND type = $2 AND id = $3`, [userId, type, id]);
    return rowCount > 0;
  };

  const tenant = req => req.apiAuth.userId;

  // ── что отдаём наружу ────────────────────────────────────────────────────
  const num = v => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : 0);

  const mapCustomer = c => ({
    id: c.id,
    name: c.name || '',
    phone: c.phone || '',
    email: c.email || null,
    address: c.address || null,
    birthDate: c.birthDate || null,
    passport: (c.passportSeries || c.passportNumber || c.passportIssuedBy)
      ? { series: c.passportSeries || null, number: c.passportNumber || null, issuedBy: c.passportIssuedBy || null }
      : null,
    trustScore: Number(c.trustScore) || 0,
    notes: c.notes || '',
    createdAt: c.createdAt || null,
  });

  const mapScheduleRow = p => ({
    id: p.id,
    contractId: p.saleId,
    amount: num(p.amount),
    date: p.date,
    isPaid: !!p.isPaid,
    // Плановая строка графика и фактический платёж лежат в одном списке и
    // различаются флагом isRealPayment — наружу отдаём это словом.
    kind: p.isRealPayment === true ? 'payment' : 'scheduled',
    actualDate: p.actualDate || null,
    note: p.note || null,
  });

  const mapContract = (s, { schedule = false } = {}) => ({
    id: s.id,
    type: s.type || 'INSTALLMENT',
    status: s.status || 'ACTIVE',
    customerId: s.customerId,
    accountId: s.accountId || null,
    productName: s.productName || '',
    productId: s.productId || null,
    buyPrice: num(s.buyPrice),
    totalAmount: num(s.totalAmount),
    downPayment: num(s.downPayment),
    remainingAmount: num(s.remainingAmount),
    collectedAmount: num(domain.collected(s)),
    overdueAmount: num(domain.overdueAmount(s)),
    interestRate: Number(s.interestRate) || 0,
    installments: Number(s.installments) || 0,
    startDate: s.startDate,
    paymentDay: s.paymentDay ?? null,
    notes: s.notes || '',
    guarantor: (s.guarantorName || s.guarantorPhone)
      ? { name: s.guarantorName || null, phone: s.guarantorPhone || null } : null,
    ...(schedule ? { schedule: (s.paymentPlan || []).map(mapScheduleRow) } : {}),
  });

  const mapExpense = e => ({
    id: e.id,
    accountId: e.accountId,
    title: e.title || '',
    amount: num(e.amount),
    category: e.category || 'Прочее',
    date: e.date,
    description: e.description || null,
    customerId: e.customerId || null,
    supplierId: e.supplierId || null,
    payoutType: e.payoutType || null,
  });

  const mapAccount = (a, balance) => ({
    id: a.id,
    name: a.name || '',
    type: a.type || 'MAIN',
    isMain: !!a.isMain,
    ownerInvestorId: a.ownerId || null,
    balance: num(balance),
  });

  const mapProduct = p => ({
    id: p.id,
    name: p.name || '',
    sku: p.sku || null,
    barcodes: Array.isArray(p.barcodes) ? p.barcodes : [],
    category: p.category || null,
    price: num(p.price),
    buyPrice: num(p.buyPrice),
    stock: Number(p.stock) || 0,
    unit: p.unit || null,
  });

  const mapInvestor = i => ({
    id: i.id,
    name: i.name || '',
    initialAmount: num(i.initialAmount),
    profitPercentage: Number(i.profitPercentage) || 0,
    joinedDate: i.joinedDate || null,
    exitDate: i.exitDate || null,
  });

  const mapRetailSale = r => ({
    id: r.id,
    accountId: r.accountId || null,
    warehouseId: r.warehouseId || null,
    customerId: r.customerId || null,
    total: num(r.total),
    isCredit: !!r.isCredit,
    isCancelled: !!r.isCancelled,
    date: r.date || r.createdAt || null,
    items: (r.items || []).map(i => ({
      productId: i.productId, name: i.name, quantity: Number(i.quantity) || 0, price: num(i.price),
    })),
  });

  // ── общие проверки ───────────────────────────────────────────────────────
  const paging = (req, res) => {
    const p = readPaging(req.query);
    if (p.errors.length) {
      fail(res, 400, CODES.VALIDATION, 'Некорректные параметры постраничного вывода.', p.errors);
      return null;
    }
    return p;
  };

  const body = (req, res, schema, opts) => {
    const result = validate(req.body, schema, opts);
    if (!result.ok) {
      fail(res, 422, CODES.VALIDATION, 'Проверьте поля запроса.', result.errors);
      return null;
    }
    return result.value;
  };

  // Счёт и клиент должны принадлежать этому аккаунту: иначе запись уходит
  // «в никуда» и деньги пропадают из интерфейса, хотя запрос вернул 200.
  const mustExist = async (res, userId, type, id, label) => {
    const item = await loadOne(userId, type, id);
    if (!item) {
      fail(res, 422, CODES.VALIDATION, `${label} не найден в вашем аккаунте.`, [{ field: type === 'accounts' ? 'accountId' : 'customerId', code: 'not_found', message: id }]);
      return null;
    }
    return item;
  };

  const inRange = (dateStr, from, to) => {
    if (!from && !to) return true;
    const t = new Date(dateStr).getTime();
    if (isNaN(t)) return false;
    if (from && t < new Date(from).getTime()) return false;
    if (to && t > new Date(`${to}T23:59:59.999`).getTime()) return false;
    return true;
  };

  // ── кто я ────────────────────────────────────────────────────────────────
  router.get('/me', requireScope('read'), route(async (req, res) => {
    const { user, plan, scopes, key } = req.apiAuth;
    const subscription = typeof user.subscription === 'string' ? JSON.parse(user.subscription) : user.subscription;
    ok(res, {
      account: { id: user.id, name: user.name, email: user.email, role: user.role },
      plan,
      subscription: { plan: subscription?.plan || null, expiresAt: subscription?.expiresAt || null },
      key: { id: key.id, name: key.name, prefix: key.key_prefix, scopes },
      limits: {
        contracts: planLimits?.[plan]?.contracts ?? null,
        investors: planLimits?.[plan]?.investors ?? null,
        requestsPerMinute: 120,
        requestsPerDay: 20000,
      },
    });
  }));

  // ── счета ────────────────────────────────────────────────────────────────
  router.get('/accounts', requireScope('read'), route(async (req, res) => {
    const userId = tenant(req);
    const [accounts, sales, expenses, retail] = await Promise.all([
      loadAll(userId, 'accounts'), loadAll(userId, 'sales'),
      loadAll(userId, 'expenses'), loadAll(userId, 'retailSales'),
    ]);
    const balances = domain.accountBalances(accounts, sales, expenses, retail);
    ok(res, accounts.map(a => mapAccount(a, balances[a.id] || 0)));
  }));

  // ── клиенты ──────────────────────────────────────────────────────────────
  const customerSchema = {
    name: { type: 'string', required: true, maxLength: 200 },
    phone: { type: 'string', required: true, maxLength: 40 },
    email: { type: 'string', maxLength: 200 },
    address: { type: 'string', maxLength: 500 },
    birthDate: { type: 'date' },
    notes: { type: 'string', maxLength: 2000 },
    trustScore: { type: 'int', min: 0, max: 100, default: 50 },
    passportSeries: { type: 'string', maxLength: 20 },
    passportNumber: { type: 'string', maxLength: 30 },
    passportIssuedBy: { type: 'string', maxLength: 300 },
  };

  router.get('/customers', requireScope('read'), route(async (req, res) => {
    const p = paging(req, res); if (!p) return;
    const search = String(req.query.search || '').trim().toLowerCase();
    let items = await loadAll(tenant(req), 'customers');
    if (search) {
      // Цифры сравниваем отдельно и только если они есть: пустая строка цифр
      // содержится в любом номере, и поиск по имени возвращал бы всех подряд.
      const digits = search.replace(/\D/g, '');
      items = items.filter(c =>
        String(c.name || '').toLowerCase().includes(search) ||
        (!!digits && String(c.phone || '').replace(/\D/g, '').includes(digits)));
    }
    items.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru'));
    const { page, meta } = paginate(items, p);
    ok(res, page.map(mapCustomer), meta);
  }));

  router.get('/customers/:id', requireScope('read'), route(async (req, res) => {
    const item = await loadOne(tenant(req), 'customers', req.params.id);
    if (!item) return fail(res, 404, CODES.NOT_FOUND, 'Клиент не найден.');
    ok(res, mapCustomer(item));
  }));

  router.post('/customers', requireScope('write'), route(async (req, res) => {
    const value = body(req, res, customerSchema); if (!value) return;
    const userId = tenant(req);
    const customer = {
      id: newId('cust'), userId,
      createdAt: new Date().toISOString(),
      totalPurchases: 0, documents: [],
      ...value,
      email: value.email || '',
      notes: value.notes || '',
    };
    await save(userId, 'customers', customer);
    created(res, mapCustomer(customer), `/api/v1/customers/${customer.id}`);
  }));

  router.patch('/customers/:id', requireScope('write'), route(async (req, res) => {
    const userId = tenant(req);
    const existing = await loadOne(userId, 'customers', req.params.id);
    if (!existing) return fail(res, 404, CODES.NOT_FOUND, 'Клиент не найден.');
    const value = body(req, res, customerSchema, { partial: true }); if (!value) return;
    const updated = { ...existing, ...value };
    await save(userId, 'customers', updated);
    ok(res, mapCustomer(updated));
  }));

  router.delete('/customers/:id', requireScope('write'), route(async (req, res) => {
    const userId = tenant(req);
    const existing = await loadOne(userId, 'customers', req.params.id);
    if (!existing) return fail(res, 404, CODES.NOT_FOUND, 'Клиент не найден.');
    const sales = await loadAll(userId, 'sales');
    const linked = sales.filter(s => s.customerId === req.params.id);
    if (linked.length) {
      return fail(res, 409, CODES.CONFLICT,
        'У клиента есть договоры — удалить его нельзя. Сначала удалите договоры.',
        { contracts: linked.length });
    }
    await remove(userId, 'customers', req.params.id);
    noContent(res);
  }));

  // ── договоры ─────────────────────────────────────────────────────────────
  const contractSchema = {
    customerId: { type: 'string', required: true, maxLength: 100 },
    accountId: { type: 'string', required: true, maxLength: 100 },
    productName: { type: 'string', required: true, maxLength: 300 },
    totalAmount: { type: 'money', required: true, min: 0.01 },
    buyPrice: { type: 'money', default: 0 },
    downPayment: { type: 'money', default: 0 },
    installments: { type: 'int', min: 0, max: 120, default: 0 },
    interestRate: { type: 'number', min: 0, max: 1000, default: 0 },
    startDate: { type: 'date' },
    paymentDay: { type: 'int', min: 1, max: 31 },
    notes: { type: 'string', maxLength: 2000 },
    productId: { type: 'string', maxLength: 100 },
    guarantorName: { type: 'string', maxLength: 200 },
    guarantorPhone: { type: 'string', maxLength: 40 },
    status: { type: 'enum', values: ['ACTIVE', 'COMPLETED', 'DEFAULTED', 'DRAFT'], default: 'ACTIVE' },
  };

  // Строит график: столько же равных платежей, сколько месяцев, начиная через
  // месяц от даты договора. Тот же принцип, что и в приложении.
  const buildSchedule = sale => {
    const due = Math.max(0, num(sale.totalAmount) - num(sale.downPayment));
    const count = Number(sale.installments) || 0;
    if (!count || due <= 0) return [];
    const base = Math.round((due / count) * 100) / 100;
    const start = new Date(sale.startDate);
    const rows = [];
    let left = due;
    for (let i = 0; i < count; i++) {
      const d = new Date(start);
      d.setMonth(d.getMonth() + i + 1);
      if (sale.paymentDay) {
        const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(sale.paymentDay, daysInMonth));
      }
      // Последний платёж добирает копейки округления, чтобы сумма графика
      // сошлась с долгом до копейки.
      const amount = i === count - 1 ? Math.round(left * 100) / 100 : base;
      left = Math.round((left - amount) * 100) / 100;
      rows.push({
        id: `pay_${sale.id}_${i + 1}`, saleId: sale.id, date: d.toISOString(),
        amount, isPaid: false, isRealPayment: false,
      });
    }
    return rows;
  };

  // Пересчёт графика от фактических денег: какие плановые строки закрыты и
  // сколько осталось долга. Повторяет хвост reconcileSalePaymentPlan из App.tsx —
  // без него платёж, проведённый через API, виден в истории, но график
  // продолжает показывать месяц неоплаченным.
  const reconcile = sale => {
    if (!Array.isArray(sale.paymentPlan)) return sale;
    const realPaid = sale.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false);
    const totalRealPaid = realPaid.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const totalDiscounts = realPaid.reduce((sum, p) => sum + (Number(p.discountAmount) || 0), 0);
    const scheduled = sale.paymentPlan.filter(p => p.isRealPayment !== true)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const totalDue = Math.max(0, num(sale.totalAmount) - num(sale.downPayment));

    let surplus = totalRealPaid + totalDiscounts;
    const reconciled = scheduled.map(p => {
      const covered = surplus >= p.amount - 0.01;
      if (covered) surplus = Math.max(0, surplus - p.amount);
      return { ...p, isPaid: covered };
    });
    const remaining = Math.max(0, Math.round((totalDue - totalRealPaid - totalDiscounts) * 100) / 100);
    return {
      ...sale,
      paymentPlan: [...reconciled, ...sale.paymentPlan.filter(p => p.isRealPayment === true)],
      remainingAmount: remaining,
      status: remaining === 0 && sale.status === 'ACTIVE' ? 'COMPLETED' : sale.status,
    };
  };

  router.get('/contracts', requireScope('read'), route(async (req, res) => {
    const p = paging(req, res); if (!p) return;
    const { status, customerId, accountId, from, to } = req.query;
    let items = await loadAll(tenant(req), 'sales');
    // Прочий приход хранится теми же записями, что и договоры, но договором не
    // является — в списке договоров ему не место.
    items = items.filter(s => !String(s.customerId || '').startsWith('system_'));
    if (status) items = items.filter(s => s.status === status);
    if (customerId) items = items.filter(s => s.customerId === customerId);
    if (accountId) items = items.filter(s => s.accountId === accountId);
    if (from || to) items = items.filter(s => inRange(s.startDate, from, to));
    if (String(req.query.overdue) === 'true') items = items.filter(s => domain.overdueAmount(s) > 0);
    items.sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
    const { page, meta } = paginate(items, p);
    ok(res, page.map(s => mapContract(s)), meta);
  }));

  router.get('/contracts/:id', requireScope('read'), route(async (req, res) => {
    const item = await loadOne(tenant(req), 'sales', req.params.id);
    if (!item) return fail(res, 404, CODES.NOT_FOUND, 'Договор не найден.');
    ok(res, mapContract(item, { schedule: true }));
  }));

  router.post('/contracts', requireScope('write'), route(async (req, res) => {
    const value = body(req, res, contractSchema); if (!value) return;
    const userId = tenant(req);

    const limit = await checkContractLimit(userId, 'create');
    if (!limit.allowed) {
      return fail(res, 403, CODES.LIMIT_REACHED, limit.reason || limit.msg || 'Достигнут лимит договоров по тарифу.',
        { current: limit.current, limit: limit.limit });
    }
    if (!await mustExist(res, userId, 'customers', value.customerId, 'Клиент')) return;
    if (!await mustExist(res, userId, 'accounts', value.accountId, 'Счёт')) return;
    if (value.downPayment > value.totalAmount) {
      return fail(res, 422, CODES.VALIDATION, 'Первый взнос больше суммы договора.',
        [{ field: 'downPayment', code: 'max', message: `не больше ${value.totalAmount}` }]);
    }

    const sale = {
      id: newId('sale'), userId, type: 'INSTALLMENT',
      ...value,
      startDate: value.startDate || new Date().toISOString(),
      remainingAmount: Math.round((value.totalAmount - value.downPayment) * 100) / 100,
      paymentPlan: [],
    };
    sale.paymentPlan = buildSchedule(sale);
    await save(userId, 'sales', sale);
    created(res, mapContract(sale, { schedule: true }), `/api/v1/contracts/${sale.id}`);
  }));

  // Правим только то, что не ломает деньги: суммы и график договора через API
  // не переписываются — для этого есть приложение, где видны последствия.
  const contractPatchSchema = {
    status: { type: 'enum', values: ['ACTIVE', 'COMPLETED', 'DEFAULTED', 'DRAFT'] },
    notes: { type: 'string', maxLength: 2000 },
    productName: { type: 'string', maxLength: 300 },
    paymentDay: { type: 'int', min: 1, max: 31 },
    guarantorName: { type: 'string', maxLength: 200 },
    guarantorPhone: { type: 'string', maxLength: 40 },
  };

  router.patch('/contracts/:id', requireScope('write'), route(async (req, res) => {
    const userId = tenant(req);
    const existing = await loadOne(userId, 'sales', req.params.id);
    if (!existing) return fail(res, 404, CODES.NOT_FOUND, 'Договор не найден.');
    const value = body(req, res, contractPatchSchema, { partial: true }); if (!value) return;
    const updated = { ...existing, ...value };
    await save(userId, 'sales', updated);
    ok(res, mapContract(updated, { schedule: true }));
  }));

  router.delete('/contracts/:id', requireScope('write'), route(async (req, res) => {
    const userId = tenant(req);
    const existing = await loadOne(userId, 'sales', req.params.id);
    if (!existing) return fail(res, 404, CODES.NOT_FOUND, 'Договор не найден.');
    const paid = (existing.paymentPlan || []).filter(p => p.isRealPayment === true && p.isPaid).length;
    if (paid > 0 || num(existing.downPayment) > 0) {
      return fail(res, 409, CODES.CONFLICT,
        'По договору уже приняты деньги — через API он не удаляется. Удалите его в приложении, где видно, что произойдёт с кассой.',
        { payments: paid, downPayment: num(existing.downPayment) });
    }
    await remove(userId, 'sales', req.params.id);
    noContent(res);
  }));

  // ── платежи ──────────────────────────────────────────────────────────────
  router.get('/payments', requireScope('read'), route(async (req, res) => {
    const p = paging(req, res); if (!p) return;
    const { contractId, from, to } = req.query;
    const sales = await loadAll(tenant(req), 'sales');
    const rows = [];
    sales.forEach(s => {
      if (contractId && s.id !== contractId) return;
      if (String(s.customerId || '').startsWith('system_')) return;
      if (num(s.downPayment) > 0 && inRange(s.startDate, from, to)) {
        rows.push({
          id: `${s.id}_dp`, contractId: s.id, customerId: s.customerId,
          amount: num(s.downPayment), date: s.startDate, kind: 'down_payment', note: null,
        });
      }
      (s.paymentPlan || []).filter(pm => pm.isPaid && pm.isRealPayment !== false).forEach(pm => {
        if (!inRange(pm.actualDate || pm.date, from, to)) return;
        rows.push({
          id: pm.id, contractId: s.id, customerId: s.customerId,
          amount: num(pm.amount), date: pm.actualDate || pm.date,
          kind: 'payment', note: pm.note || null,
        });
      });
    });
    rows.sort((a, b) => new Date(b.date) - new Date(a.date));
    const { page, meta } = paginate(rows, p);
    ok(res, page, meta);
  }));

  const paymentSchema = {
    contractId: { type: 'string', required: true, maxLength: 100 },
    amount: { type: 'money', required: true, min: 0.01 },
    date: { type: 'date' },
    note: { type: 'string', maxLength: 500 },
  };

  router.post('/payments', requireScope('write'), route(async (req, res) => {
    const value = body(req, res, paymentSchema); if (!value) return;
    const userId = tenant(req);

    // Транзакция с блокировкой строки: два одновременных платежа по одному
    // договору иначе затирают друг друга — второй перезапишет остаток, будто
    // первого не было.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT data FROM data_items WHERE id = $1 AND user_id = $2 AND type = 'sales' FOR UPDATE`,
        [value.contractId, userId]
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return fail(res, 404, CODES.NOT_FOUND, 'Договор не найден.');
      }
      const sale = rows[0].data;
      if (!Array.isArray(sale.paymentPlan)) sale.paymentPlan = [];

      const overpay = Math.round((value.amount - num(sale.remainingAmount)) * 100) / 100;
      if (overpay > 0.01 && String(req.query.allowOverpay) !== 'true') {
        await client.query('ROLLBACK');
        return fail(res, 409, CODES.CONFLICT,
          'Сумма больше остатка долга. Если переплата намеренная, повторите запрос с ?allowOverpay=true.',
          { remainingAmount: num(sale.remainingAmount), overpayment: overpay });
      }

      const payment = {
        id: newId('pay'), saleId: sale.id, amount: value.amount,
        date: value.date || new Date().toISOString(),
        actualDate: new Date().toISOString(),
        isPaid: true, isRealPayment: true,
        note: value.note || 'Платёж через API',
      };
      sale.paymentPlan.push(payment);
      const updated = reconcile(sale);

      await client.query(
        `UPDATE data_items SET data = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
        [JSON.stringify(updated), sale.id, userId]
      );
      await client.query('COMMIT');
      created(res, {
        payment: { id: payment.id, contractId: sale.id, amount: payment.amount, date: payment.date, kind: 'payment', note: payment.note },
        contract: mapContract(updated),
      }, `/api/v1/contracts/${sale.id}`);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }));

  router.delete('/payments/:id', requireScope('write'), route(async (req, res) => {
    const userId = tenant(req);
    const sales = await loadAll(userId, 'sales');
    const sale = sales.find(s => (s.paymentPlan || []).some(p => p.id === req.params.id && p.isRealPayment === true));
    if (!sale) return fail(res, 404, CODES.NOT_FOUND, 'Платёж не найден. Первый взнос через API не отменяется.');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT data FROM data_items WHERE id = $1 AND user_id = $2 AND type = 'sales' FOR UPDATE`, [sale.id, userId]);
      const fresh = rows[0]?.data;
      if (!fresh) { await client.query('ROLLBACK'); return fail(res, 404, CODES.NOT_FOUND, 'Договор не найден.'); }
      fresh.paymentPlan = (fresh.paymentPlan || []).filter(p => p.id !== req.params.id);
      const updated = reconcile({ ...fresh, status: fresh.status === 'COMPLETED' ? 'ACTIVE' : fresh.status });
      await client.query(`UPDATE data_items SET data = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
        [JSON.stringify(updated), sale.id, userId]);
      await client.query('COMMIT');
      ok(res, mapContract(updated, { schedule: true }));
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }));

  // ── расходы ──────────────────────────────────────────────────────────────
  const expenseSchema = {
    accountId: { type: 'string', required: true, maxLength: 100 },
    title: { type: 'string', required: true, maxLength: 300 },
    amount: { type: 'money', required: true, min: 0.01 },
    category: { type: 'string', maxLength: 100, default: 'Прочее' },
    date: { type: 'date' },
    description: { type: 'string', maxLength: 1000 },
    customerId: { type: 'string', maxLength: 100 },
  };

  router.get('/expenses', requireScope('read'), route(async (req, res) => {
    const p = paging(req, res); if (!p) return;
    const { accountId, category, from, to } = req.query;
    let items = await loadAll(tenant(req), 'expenses');
    if (accountId) items = items.filter(e => e.accountId === accountId);
    if (category) items = items.filter(e => e.category === category);
    if (from || to) items = items.filter(e => inRange(e.date, from, to));
    items.sort((a, b) => new Date(b.date) - new Date(a.date));
    const { page, meta } = paginate(items, p);
    ok(res, page.map(mapExpense), meta);
  }));

  router.get('/expenses/:id', requireScope('read'), route(async (req, res) => {
    const item = await loadOne(tenant(req), 'expenses', req.params.id);
    if (!item) return fail(res, 404, CODES.NOT_FOUND, 'Расход не найден.');
    ok(res, mapExpense(item));
  }));

  router.post('/expenses', requireScope('write'), route(async (req, res) => {
    const value = body(req, res, expenseSchema); if (!value) return;
    const userId = tenant(req);
    if (!await mustExist(res, userId, 'accounts', value.accountId, 'Счёт')) return;
    const expense = {
      id: newId('exp'), userId,
      createdAt: new Date().toISOString(),
      ...value,
      date: value.date || new Date().toISOString(),
    };
    await save(userId, 'expenses', expense);
    created(res, mapExpense(expense), `/api/v1/expenses/${expense.id}`);
  }));

  router.patch('/expenses/:id', requireScope('write'), route(async (req, res) => {
    const userId = tenant(req);
    const existing = await loadOne(userId, 'expenses', req.params.id);
    if (!existing) return fail(res, 404, CODES.NOT_FOUND, 'Расход не найден.');
    const value = body(req, res, expenseSchema, { partial: true }); if (!value) return;
    if (value.accountId && !await mustExist(res, userId, 'accounts', value.accountId, 'Счёт')) return;
    const updated = { ...existing, ...value };
    await save(userId, 'expenses', updated);
    ok(res, mapExpense(updated));
  }));

  router.delete('/expenses/:id', requireScope('write'), route(async (req, res) => {
    const userId = tenant(req);
    const existing = await loadOne(userId, 'expenses', req.params.id);
    if (!existing) return fail(res, 404, CODES.NOT_FOUND, 'Расход не найден.');
    // Закуп по договору — не самостоятельный расход: он повторяет закуп и
    // пересчитывается вместе с договором.
    if (String(req.params.id).startsWith('exp_sale_')) {
      return fail(res, 409, CODES.CONFLICT, 'Это закуп по договору. Он меняется вместе с договором, а не отдельно.');
    }
    await remove(userId, 'expenses', req.params.id);
    noContent(res);
  }));

  // ── прочий приход ────────────────────────────────────────────────────────
  const incomeSchema = {
    accountId: { type: 'string', required: true, maxLength: 100 },
    amount: { type: 'money', required: true, min: 0.01 },
    note: { type: 'string', maxLength: 300 },
    category: { type: 'string', maxLength: 100 },
    date: { type: 'date' },
  };

  router.post('/income', requireScope('write'), route(async (req, res) => {
    const value = body(req, res, incomeSchema); if (!value) return;
    const userId = tenant(req);
    if (!await mustExist(res, userId, 'accounts', value.accountId, 'Счёт')) return;
    // Приход хранится такой же записью, как продажа за наличные: так его видят
    // все экраны кассы без отдельной ветки в расчётах.
    const income = {
      id: newId('inc'), userId, type: 'CASH', customerId: 'system_income',
      productName: value.note || 'Приход через API',
      category: value.category || null,
      accountId: value.accountId,
      buyPrice: 0, totalAmount: value.amount, downPayment: value.amount,
      remainingAmount: 0, interestRate: 0, installments: 0,
      startDate: value.date || new Date().toISOString(),
      status: 'COMPLETED', paymentPlan: [],
    };
    await save(userId, 'sales', income);
    created(res, {
      id: income.id, accountId: income.accountId, amount: num(income.totalAmount),
      note: income.productName, category: income.category, date: income.startDate,
    }, `/api/v1/accounts`);
  }));

  // ── склад и магазин ──────────────────────────────────────────────────────
  router.get('/products', requireScope('read'), route(async (req, res) => {
    const p = paging(req, res); if (!p) return;
    const search = String(req.query.search || '').trim().toLowerCase();
    let items = await loadAll(tenant(req), 'products');
    if (search) {
      items = items.filter(pr =>
        String(pr.name || '').toLowerCase().includes(search) ||
        String(pr.sku || '').toLowerCase().includes(search) ||
        (pr.barcodes || []).some(b => String(b).includes(search)));
    }
    if (String(req.query.inStock) === 'true') items = items.filter(pr => (Number(pr.stock) || 0) > 0);
    items.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru'));
    const { page, meta } = paginate(items, p);
    ok(res, page.map(mapProduct), meta);
  }));

  router.get('/products/:id', requireScope('read'), route(async (req, res) => {
    const item = await loadOne(tenant(req), 'products', req.params.id);
    if (!item) return fail(res, 404, CODES.NOT_FOUND, 'Товар не найден.');
    ok(res, mapProduct(item));
  }));

  router.get('/warehouses', requireScope('read'), route(async (req, res) => {
    const items = await loadAll(tenant(req), 'warehouses');
    ok(res, items.map(w => ({ id: w.id, name: w.name || '', accountId: w.accountId || null, isMain: !!w.isMain })));
  }));

  router.get('/retail-sales', requireScope('read'), route(async (req, res) => {
    const p = paging(req, res); if (!p) return;
    const { from, to, warehouseId } = req.query;
    let items = await loadAll(tenant(req), 'retailSales');
    if (warehouseId) items = items.filter(r => r.warehouseId === warehouseId);
    if (from || to) items = items.filter(r => inRange(r.date || r.createdAt, from, to));
    items.sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));
    const { page, meta } = paginate(items, p);
    ok(res, page.map(mapRetailSale), meta);
  }));

  // ── инвесторы ────────────────────────────────────────────────────────────
  router.get('/investors', requireScope('read'), route(async (req, res) => {
    const items = await loadAll(tenant(req), 'investors');
    ok(res, items.map(mapInvestor));
  }));

  router.get('/investors/:id', requireScope('read'), route(async (req, res) => {
    const item = await loadOne(tenant(req), 'investors', req.params.id);
    if (!item) return fail(res, 404, CODES.NOT_FOUND, 'Инвестор не найден.');
    ok(res, mapInvestor(item));
  }));

  // ── сводка ───────────────────────────────────────────────────────────────
  // Считается по тем же формулам, что и экраны приложения (см. api/domain.js).
  // Распределение прибыли между инвесторами наружу не отдаём: оно зависит от
  // настроек кассы и состава пула на каждую дату — такую цифру нельзя давать
  // без всего контекста, иначе её истолкуют неверно.
  router.get('/reports/summary', requireScope('read'), route(async (req, res) => {
    const userId = tenant(req);
    const { from, to, accountId } = req.query;
    const [accounts, salesAll, expensesAll, retail] = await Promise.all([
      loadAll(userId, 'accounts'), loadAll(userId, 'sales'),
      loadAll(userId, 'expenses'), loadAll(userId, 'retailSales'),
    ]);

    const sales = salesAll.filter(s => !accountId || s.accountId === accountId);
    const contracts = sales.filter(s => !String(s.customerId || '').startsWith('system_'));
    const inPeriod = contracts.filter(s => inRange(s.startDate, from, to));

    let collectedInPeriod = 0;
    let profitInPeriod = 0;
    contracts.forEach(s => {
      domain.moneyIn(s).forEach(m => {
        if (!inRange(m.date, from, to)) return;
        collectedInPeriod += m.amount;
        profitInPeriod += domain.moneyInProfit(s, m, false);
      });
    });

    const expenses = expensesAll
      .filter(e => !accountId || e.accountId === accountId)
      .filter(e => inRange(e.date, from, to));

    const balances = domain.accountBalances(accounts, salesAll, expensesAll, retail);

    ok(res, {
      period: { from: from || null, to: to || null },
      contracts: {
        total: contracts.length,
        created: inPeriod.length,
        active: contracts.filter(s => s.status === 'ACTIVE').length,
        completed: contracts.filter(s => s.status === 'COMPLETED').length,
        overdue: contracts.filter(s => domain.overdueAmount(s) > 0).length,
      },
      money: {
        collected: num(collectedInPeriod),
        profit: num(profitInPeriod),
        expenses: num(expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0)),
        outstandingDebt: num(contracts.reduce((sum, s) => sum + (Number(s.remainingAmount) || 0), 0)),
        overdueDebt: num(contracts.reduce((sum, s) => sum + domain.overdueAmount(s), 0)),
        cashOnAccounts: num(Object.entries(balances)
          .filter(([id]) => !accountId || id === accountId)
          .reduce((sum, [, v]) => sum + v, 0)),
      },
    });
  }));

  // Неизвестный путь внутри /api/v1 — это опечатка в интеграции, и молчать о ней
  // нельзя: без этого запрос уходил бы в раздачу фронтенда и возвращал HTML.
  router.use((req, res) => fail(res, 404, CODES.NOT_FOUND,
    `Маршрут ${req.method} ${req.baseUrl}${req.path} не существует. Список — в документации на rassrochka.pro/api`));

  return router;
};

module.exports = { createApiV1Router };
