// Изолированный реестр. Не использует generic data API, офлайн-очередь или LLM.
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { loadVault, loadTotpSecret, totpCounter } = require('./crypto');
const { ensureTables } = require('./schema');
const { createRevocations } = require('./revocations');
const P = require('./policy');
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const id = () => crypto.randomUUID();
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function registerWatchlistRoutes(app, { pool, auth, vault = loadVault(), totpSecret = loadTotpSecret(),
  revocationFile = process.env.WATCHLIST_REVOCATION_FILE || (process.env.WATCHLIST_KEY_FILE ? process.env.WATCHLIST_KEY_FILE + '.revocations' : null) } = {}) {
  const revocations = createRevocations(revocationFile);
  let ready;
  const ensure = () => ready || (ready = ensureTables(pool).catch(e => { ready = null; throw e; }));
  const requireVault = () => { if (!vault) throw P.problem(503, 'Защита общего списка ещё не настроена. Обратитесь к администратору.'); return vault; };
  const event = (db, actor, action, target = null) => db.query(
    'INSERT INTO client_watchlist_events(actor_id,action,target_id) VALUES($1,$2,$3)', [actor, action, target]);
  async function limit(user, action, max, seconds = 3600) {
    const bucket = Math.floor(Date.now() / (seconds * 1000));
    const r = await pool.query(`INSERT INTO client_watchlist_limits(user_id,action,bucket,count,expires_at) VALUES($1,$2,$3,1,now()+($4::int * interval '1 second'))
      ON CONFLICT(user_id,action,bucket) DO UPDATE SET count=client_watchlist_limits.count+1 RETURNING count`, [user, action, bucket, seconds * 2]);
    if (r.rows[0].count > max) throw P.problem(429, 'Слишком много запросов. Попробуйте позже.');
  }
  async function current(db, req, admin = false) {
    const r = await db.query('SELECT id,role,blocked,password FROM users WHERE id=$1', [req.user?.id]);
    const user = r.rows[0];
    if (!user || user.blocked || (admin ? user.role !== 'admin' : !['manager', 'admin'].includes(user.role)))
      throw P.problem(403, admin ? 'Доступ только администратору.' : 'Раздел доступен владельцу аккаунта.');
    return user;
  }
  async function session(db, req) {
    const proof = req.get('x-watchlist-admin');
    if (!proof || !/^[a-f0-9]{64}$/.test(proof)) throw P.problem(403, 'Подтвердите административный вход.');
    const r = await db.query(`SELECT digest FROM client_watchlist_admin_sessions WHERE digest=$1 AND user_id=$2 AND auth_digest=$3 AND expires_at>now()`,
      [digest(proof), req.user.id, digest(req.get('x-auth-token'))]);
    if (!r.rowCount) throw P.problem(403, 'Подтвердите административный вход.');
  }
  async function settings(db) {
    return (await db.query('SELECT * FROM client_watchlist_settings WHERE id=1 FOR SHARE')).rows[0];
  }
  async function access(db, user) {
    return (await db.query('SELECT * FROM client_watchlist_access WHERE user_id=$1 FOR SHARE', [user])).rows[0];
  }
  async function permitted(db, req, action) {
    requireVault();
    revocations.read();
    const user = req.user.id;
    const admin = req.watchlistActor?.role === 'admin';
    const s = await settings(db), a = await access(db, user);
    // Администратор не подаёт заявку себе. Закрытый режим разрешает ему
    // подготовку записей; публичный доступ и публикация остаются отдельными.
    if (!admin) {
      if (!a || a.status !== 'granted' || !a[action === 'search' ? 'can_search' : 'can_submit']) throw P.problem(403, 'Для этого действия нужен доступ администратора.');
      if (s.mode === 'off' || (s.mode === 'pilot' && !a.pilot)) throw P.problem(403, 'Общий список пока не включён для вашего аккаунта.');
      if (!s.legal_ready) throw P.problem(403, 'Общий список ожидает подтверждения правил публикации.');
    }
    if (s[action === 'search' ? 'search_paused' : 'submissions_paused']) throw P.problem(403, action === 'search' ? 'Общий поиск временно приостановлен.' : 'Приём новых записей временно приостановлен.');
    const accepted = await db.query('SELECT 1 FROM client_watchlist_acceptances WHERE user_id=$1 AND version=$2', [user, P.POLICY_VERSION]);
    if (!accepted.rowCount) throw P.problem(403, 'Сначала ознакомьтесь с правилами раздела.');
    return s;
  }
  const payload = r => r.payload ? requireVault().decrypt(r.id, 'entry', r.payload) : null;
  function ownEntry(r) {
    try {
      if (!['withdrawn', 'terminated'].includes(r.status) && revocations.read().has(r.id))
        return { id: r.id, customerId: r.customer_id, name: 'Публикация удалена', birthYear: null, status: 'withdrawn', version: r.version, createdAt: r.created_at };
    } catch { /* Доступ автора к собственным материалам не становится общим доступом. */ }
    const d = payload(r);
    return { id: r.id, customerId: r.customer_id, name: d?.identity.name || 'Публикация удалена', birthYear: d?.identity.birthYear ?? null,
      reason: d?.reason, reasonDetails: d?.reasonDetails, response: d?.response, publicationMode: d?.publication?.mode,
      basis: d?.basis, evidence: d?.evidence, note: d?.note, decision: d?.decision,
      status: r.deleted_at ? 'deleted' : r.status === 'published' && new Date(r.expires_at) <= new Date() ? 'expired' : r.status,
      version: r.version, createdAt: r.created_at, expiresAt: r.expires_at };
  }
  async function entry(db, entryId, owner = null) {
    const r = await db.query('SELECT * FROM client_watchlist_entries WHERE id=$1 FOR UPDATE', [entryId]);
    if (!r.rowCount || (owner && r.rows[0].owner_id !== owner)) throw P.problem(404, 'Запись не найдена.');
    return r.rows[0];
  }
  function revision(row, expected) {
    if (!Number.isInteger(expected) || row.version !== expected) throw P.problem(409, 'Запись изменилась. Обновите данные и проверьте решение.');
  }
  async function source(db, user, customerId) {
    if (typeof customerId !== 'string' || customerId.length > 200) throw P.problem(400, 'Выберите клиента.');
    const r = await db.query("SELECT data FROM data_items WHERE id=$1 AND user_id=$2 AND type='customers' FOR SHARE", [customerId, user]);
    if (!r.rowCount) throw P.problem(404, 'Клиент не найден в вашей базе.');
    const identity = P.identity(r.rows[0].data);
    const fingerprint = requireVault().index('source', [user, customerId, identity]);
    return { customerId, ...identity, fingerprint };
  }
  async function maintenance() {
    // Никаких изменений в клиентах/договорах. Ограниченное хранение служебных дел.
    await pool.query(`UPDATE client_watchlist_entries SET status='expired',version=version+1,updated_at=now()
      WHERE status IN ('published','hidden') AND expires_at<=now();
      UPDATE client_watchlist_entries SET payload=NULL,name_index=NULL,year_index=NULL,source_fingerprint=NULL
      WHERE payload IS NOT NULL AND ((status IN ('rejected','expired') AND updated_at<now()-interval '30 days')
        OR (status IN ('pending','needs_info') AND updated_at<now()-interval '90 days'));
      UPDATE client_watchlist_entries SET status='expired',version=version+1,updated_at=now()
        WHERE status IN ('pending','needs_info') AND payload IS NULL;
      UPDATE client_watchlist_appeals SET payload=NULL WHERE status='resolved' AND updated_at<now()-interval '30 days';
      DELETE FROM client_watchlist_entries WHERE status IN ('withdrawn','terminated','rejected','expired') AND updated_at<now()-interval '180 days'
        AND NOT EXISTS(SELECT 1 FROM client_watchlist_appeals a WHERE a.entry_id=client_watchlist_entries.id AND a.status<>'resolved');
      DELETE FROM client_watchlist_limits WHERE expires_at<now();
      DELETE FROM client_watchlist_admin_sessions WHERE expires_at<=now();
      DELETE FROM client_watchlist_events WHERE created_at<now()-interval '180 days';`);
    // После SQL-restore применить независимый журнал, прежде чем возвращать реестр в работу.
    if (revocationFile) {
      const ids = [...revocations.read()];
      if (ids.length) await pool.query(`UPDATE client_watchlist_entries SET status='withdrawn',payload=NULL,name_index=NULL,year_index=NULL,
        source_fingerprint=NULL,version=version+1,updated_at=now() WHERE id=ANY($1::text[]) AND status NOT IN ('withdrawn','terminated')`, [ids]);
    }
  }
  let maintenanceAt = 0;
  const wrap = (fn, { admin = false, unlocked = false } = {}) => async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Pragma', 'no-cache');
    let db;
    try {
      await ensure();
      // Сначала актуальная роль в БД: не доверяем старой роли из 90-дневного JWT.
      await current(pool, req, admin);
      await limit(req.user.id, admin ? 'admin_requests' : 'requests', admin ? 600 : 300);
      // Сбой отдельного журнала блокирует поиск/публикации в их обработчиках,
      // но не закрывает административную паузу, запрос доступа и канал обращений.
      if (Date.now() - maintenanceAt > 60000) { await maintenance().catch(() => {}); maintenanceAt = Date.now(); }
      db = await pool.connect();
      await db.query('BEGIN');
      req.watchlistActor = await current(db, req, admin);
      if (admin && !unlocked) await session(db, req);
      const out = await fn(req, db);
      await db.query('COMMIT');
      res.json(out ?? { ok: true });
    } catch (e) {
      if (db) await db.query('ROLLBACK').catch(() => {});
      // Тела запросов, SQL-ошибки, поисковые строки и материалы не логируются.
      res.status(e.status || 503).json({ msg: e.status ? e.message : 'Общий список временно недоступен. Попробуйте позже.' });
    } finally { db?.release(); }
  };
  const route = (method, path, fn) => app[method](`/api/watchlist${path}`, auth, wrap(fn));
  const adminRoute = (method, path, fn, unlocked = false) => app[method](`/api/admin/watchlist${path}`, auth, wrap(fn, { admin: true, unlocked }));

  route('get', '/status', async (req, db) => {
    const s = await settings(db), a = await access(db, req.user.id);
    const admin = req.watchlistActor.role === 'admin';
    const accepted = (await db.query('SELECT 1 FROM client_watchlist_acceptances WHERE user_id=$1 AND version=$2', [req.user.id, P.POLICY_VERSION])).rowCount > 0;
    let ledgerReady = false; try { revocations.read(); ledgerReady = true; } catch {}
    return { policyVersion: P.POLICY_VERSION, accepted, adminAccess: admin, adminOnly: admin && s.mode === 'off',
      access: admin ? { status: 'granted', canSearch: true, canSubmit: true } : a ? { status: a.status, canSearch: a.can_search, canSubmit: a.can_submit } : null,
      enabled: !!vault && ledgerReady && (admin || (s.legal_ready && s.mode !== 'off' && (s.mode !== 'pilot' || !!a?.pilot))), autoPublish: s.auto_publish && s.legal_ready && s.mode !== 'off',
      searchPaused: s.search_paused, submissionsPaused: s.submissions_paused };
  });
  route('post', '/access-request', async (req, db) => {
    if (req.watchlistActor.role === 'admin') return { ok: true };
    await limit(req.user.id, 'access_request', 3, 86400);
    const r = await db.query(`INSERT INTO client_watchlist_access(user_id,status) VALUES($1,'requested')
      ON CONFLICT(user_id) DO NOTHING RETURNING user_id`, [req.user.id]);
    if (r.rowCount) await event(db, req.user.id, 'ACCESS_REQUESTED', req.user.id);
  });
  route('post', '/accept', async (req, db) => {
    const a = await access(db, req.user.id);
    if (a?.status !== 'granted' && req.watchlistActor.role !== 'admin') throw P.problem(403, 'Сначала дождитесь выдачи доступа.');
    if (req.body?.version !== P.POLICY_VERSION || req.body?.accepted !== true) throw P.problem(400, 'Подтвердите действующие правила.');
    await db.query('INSERT INTO client_watchlist_acceptances(user_id,version) VALUES($1,$2) ON CONFLICT DO NOTHING', [req.user.id, P.POLICY_VERSION]);
    await event(db, req.user.id, 'RULES_ACCEPTED', P.POLICY_VERSION);
  });
  route('post', '/search', async (req, db) => {
    const s = await permitted(db, req, 'search');
    await limit(req.user.id, 'search', s.search_limit);
    const name = P.normalizeName(req.body?.name), year = P.birthYear(req.body?.birthYear);
    const match = year === null ? 'name_index=$1' : 'year_index=ANY($1::text[])';
    const key = year === null ? vault.index('name', name) : [vault.index('year', [name, year]), vault.index('year', [name, null])];
    const r = await db.query(`SELECT id,payload FROM client_watchlist_entries WHERE ${match} AND status='published' AND expires_at>now()
      AND NOT(id=ANY($2::text[])) ORDER BY id LIMIT 21`, [key, [...revocations.read()]]);
    // Для «Другой причины» выдаём только её отдельное описание, не старое note.
    // Основание, ответы автора, решения и прочие служебные поля закрыты.
    const items = r.rows.slice(0, 20).map(row => { const d = payload(row); return { id: row.id, name: d.identity.name, birthYear: d.identity.birthYear,
      reason: P.REASONS.includes(d.reason) ? d.reason : null,
      ...(d.reason === 'other' && typeof d.reasonDetails === 'string' && d.reasonDetails.trim()
        ? { reasonDetails: d.reasonDetails.trim().slice(0, 1000) } : {}) }; });
    await event(db, req.user.id, 'SEARCH');
    return { items, limited: r.rows.length > 20 };
  });
  route('get', '/mine', async (req, db) => {
    const { offset, limit: take } = P.page(req.query);
    const r = await db.query('SELECT * FROM client_watchlist_entries WHERE owner_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3', [req.user.id, take + 1, offset]);
    return { items: r.rows.slice(0, take).map(ownEntry), hasMore: r.rows.length > take };
  });
  route('post', '/preview', async (req, db) => {
    await permitted(db, req, 'submit');
    return source(db, req.user.id, req.body?.customerId);
  });
  route('post', '/entries', async (req, db) => {
    const s = await permitted(db, req, 'submit');
    await limit(req.user.id, 'submit', 10, 86400);
    const b = req.body || {}, preview = await source(db, req.user.id, b.customerId);
    if (!same(preview.fingerprint, b.fingerprint)) throw P.problem(409, 'Данные клиента изменились. Выберите клиента повторно.');
    if (b.confirmed !== true) throw P.problem(400, 'Подтвердите отправку на проверку.');
    const reason = P.submissionReason(b), legacy = P.legacySubmissionFields(b);
    // Блокировка на автора/клиента делает повторную отправку идемпотентной.
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`watchlist:${req.user.id}:${b.customerId}`]);
    const duplicate = await db.query('SELECT * FROM client_watchlist_entries WHERE owner_id=$1 AND customer_id=$2 AND status=ANY($3::text[])', [req.user.id, b.customerId, P.ACTIVE]);
    if (duplicate.rowCount) return ownEntry(duplicate.rows[0]);
    const review = (await db.query(`SELECT 1 FROM client_watchlist_entries WHERE owner_id=$1 AND customer_id=$2 AND review_required LIMIT 1`, [req.user.id, b.customerId])).rowCount > 0;
    const autoPublish = s.auto_publish && s.legal_ready && s.mode !== 'off' && !review;
    const entryId = id(), identity = { name: preview.name, birthYear: preview.birthYear };
    const data = { identity, ...reason, ...legacy, confirmationAt: new Date().toISOString(),
      ...(autoPublish ? { publication: { mode: 'auto', settingsVersion: s.version, at: new Date().toISOString() } } : {}) };
    const r = await db.query(`INSERT INTO client_watchlist_entries(id,owner_id,customer_id,payload,name_index,year_index,source_fingerprint,status,policy_version,review_required,published_at,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $8='published' THEN now() ELSE NULL END,
        CASE WHEN $8='published' THEN now()+($11::int * interval '1 day') ELSE NULL END) RETURNING *`, [entryId, req.user.id, b.customerId, vault.encrypt(entryId, 'entry', data),
      vault.index('name', P.normalizeName(preview.name)), vault.index('year', [P.normalizeName(preview.name), preview.birthYear]), preview.fingerprint,
      autoPublish ? 'published' : 'pending', P.POLICY_VERSION, review, s.publication_days]);
    await event(db, req.user.id, 'ENTRY_SUBMITTED', entryId);
    if (autoPublish) await event(db, req.user.id, 'ENTRY_AUTO_PUBLISHED', entryId);
    return ownEntry(r.rows[0]);
  });
  route('post', '/entries/:id/withdraw', async (req, db) => {
    const r = await entry(db, req.params.id, req.user.id);
    if (['withdrawn', 'terminated'].includes(r.status) || r.deleted_at) return;
    // Сначала fsync независимого журнала, потом SQL commit. При сбое SQL запись
    // может скрыться раньше, но никогда не возвращается после восстановления БД.
    revocations.add(r.id);
    // Отзыв разрешён без нового согласия, права поиска, работающих ключей и включённого раздела.
    await db.query(`UPDATE client_watchlist_entries SET status='withdrawn',payload=NULL,name_index=NULL,year_index=NULL,
      source_fingerprint=NULL,version=version+1,updated_at=now() WHERE id=$1`, [r.id]);
    await event(db, req.user.id, 'ENTRY_WITHDRAWN', r.id);
  });
  route('post', '/entries/:id/resubmit', async (req, db) => {
    await permitted(db, req, 'submit');
    await limit(req.user.id, 'submit', 10, 86400);
    const r = await entry(db, req.params.id, req.user.id), b = req.body || {};
    revision(r, b.version);
    if (r.status !== 'needs_info') throw P.problem(409, 'Дополнение сейчас недоступно.');
    const data = payload(r), src = await source(db, req.user.id, r.customer_id);
    if (!same(src.fingerprint, r.source_fingerprint)) throw P.problem(409, 'Клиент изменился. Отзовите заявку и отправьте новую.');
    if (b.confirmed !== true) throw P.problem(400, 'Подтвердите отправку на проверку.');
    const updatedReason = P.submissionReason({ reason: b.reason ?? data.reason,
      reasonDetails: Object.prototype.hasOwnProperty.call(b, 'reasonDetails') ? b.reasonDetails : (b.reason === undefined ? data.reasonDetails : undefined), note: b.note ?? data.note });
    Object.assign(data, updatedReason, P.legacySubmissionFields(b));
    data.response = P.text(b.response ?? b.note, 3, 1500, 'ответ администратору');
    data.confirmationAt = new Date().toISOString();
    delete data.decision;
    await db.query(`UPDATE client_watchlist_entries SET status='pending',payload=$2,version=version+1,updated_at=now(),policy_version=$3 WHERE id=$1`,
      [r.id, vault.encrypt(r.id, 'entry', data), P.POLICY_VERSION]);
    await event(db, req.user.id, 'ENTRY_RESUBMITTED', r.id);
  });
  route('post', '/appeals', async (req, db) => {
    requireVault();
    await limit(req.user.id, 'appeal', 5, 86400);
    const b = req.body || {}, r = await entry(db, b.entryId);
    if (r.owner_id !== req.user.id) {
      const a = await access(db, req.user.id);
      if (a?.status !== 'granted' || r.status !== 'published' || new Date(r.expires_at) <= new Date()) throw P.problem(404, 'Запись недоступна для обращения.');
    }
    const message = P.text(b.message, 15, 1500, 'описание ошибки'), appealId = id();
    const result = await db.query(`INSERT INTO client_watchlist_appeals(id,entry_id,reporter_id,payload) VALUES($1,$2,$3,$4)
      ON CONFLICT(entry_id,reporter_id) WHERE status<>'resolved' DO NOTHING RETURNING id`,
      [appealId, r.id, req.user.id, vault.encrypt(appealId, 'appeal', { message })]);
    if (result.rowCount) await event(db, req.user.id, 'APPEAL_SUBMITTED', r.id);
  });
  route('get', '/appeals/mine', async (req, db) => {
    const { limit: take, offset } = P.page(req.query);
    const r = await db.query('SELECT * FROM client_watchlist_appeals WHERE reporter_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3', [req.user.id, take + 1, offset]);
    return { items: r.rows.slice(0, take).map(r => ({ id: r.id, status: r.status, createdAt: r.created_at,
      ...(r.payload ? requireVault().decrypt(r.id, 'appeal', r.payload) : { message: 'Материалы обращения удалены по сроку хранения.' }) })), hasMore: r.rows.length > take };
  });

  adminRoute('get', '/lock', async () => ({ configured: !!totpSecret && /^[A-Z2-7]{32,128}$/.test(totpSecret), encryptionReady: !!vault }), true);
  adminRoute('post', '/unlock', async (req, db) => {
    await limit(req.user.id, 'admin_login', 5, 900);
    if (!totpSecret || !/^[A-Z2-7]{32,128}$/.test(totpSecret)) throw P.problem(503, 'Второй фактор для общего списка ещё не настроен на сервере.');
    const user = await current(db, req, true), password = req.body?.password;
    if (typeof password !== 'string' || password.length > 200 || !await bcrypt.compare(password, user.password)) throw P.problem(403, 'Проверьте пароль и код подтверждения.');
    const counter = totpCounter(totpSecret, req.body?.code);
    if (counter === null) throw P.problem(403, 'Проверьте пароль и код подтверждения.');
    const taken = await db.query(`INSERT INTO client_watchlist_admin_factors(user_id,last_counter) VALUES($1,$2)
      ON CONFLICT(user_id) DO UPDATE SET last_counter=EXCLUDED.last_counter
      WHERE client_watchlist_admin_factors.last_counter<EXCLUDED.last_counter RETURNING user_id`, [user.id, counter]);
    if (!taken.rowCount) throw P.problem(403, 'Этот код уже использован. Дождитесь следующего.');
    const proof = crypto.randomBytes(32).toString('hex'), expiresAt = new Date(Date.now() + 10 * 60000).toISOString();
    await db.query('INSERT INTO client_watchlist_admin_sessions(digest,user_id,auth_digest,expires_at) VALUES($1,$2,$3,$4)',
      [digest(proof), user.id, digest(req.res.getHeader('x-renewed-token') || req.get('x-auth-token')), expiresAt]);
    await event(db, user.id, 'ADMIN_VERIFIED');
    return { proof, expiresAt };
  }, true);
  adminRoute('post', '/lock', async (req, db) => {
    await db.query('DELETE FROM client_watchlist_admin_sessions WHERE digest=$1 AND user_id=$2', [digest(req.get('x-watchlist-admin')), req.user.id]);
  });
  adminRoute('get', '/overview', async (req, db) => {
    const s = await settings(db);
    let revocationsReady = false; try { revocations.read(); revocationsReady = true; } catch {}
    const counts = (await db.query(`SELECT
      (SELECT count(*)::int FROM client_watchlist_access WHERE status='requested') AS access,
      (SELECT count(*)::int FROM client_watchlist_entries WHERE status IN ('pending','needs_info')) AS pending,
      (SELECT count(*)::int FROM client_watchlist_entries WHERE status='published' AND expires_at>now()) AS published,
      (SELECT count(*)::int FROM client_watchlist_appeals WHERE status<>'resolved') AS appeals`)).rows[0];
    await event(db, req.user.id, 'ADMIN_OVERVIEW_READ');
    return { counts, settings: { version: s.version, mode: s.mode, legalReady: s.legal_ready, searchPaused: s.search_paused, submissionsPaused: s.submissions_paused, autoPublish: s.auto_publish,
      searchLimit: s.search_limit, publicationDays: s.publication_days, legalReference: s.legal_reference && vault ? vault.decrypt('settings', 'legal', s.legal_reference).reference : '' },
      protection: { encryptionReady: !!vault, revocationsReady, keyVersion: vault?.version || null, secondFactor: true, restoreCheck: 'not_verified' }, policyVersion: P.POLICY_VERSION };
  });
  adminRoute('get', '/access', async (req, db) => {
    const { limit: take, offset } = P.page(req.query), status = req.query.status || null;
    if (status && !['requested', 'granted', 'rejected', 'revoked'].includes(status)) throw P.problem(400, 'Некорректный статус.');
    const r = await db.query(`SELECT a.*,u.name,u.email FROM client_watchlist_access a JOIN users u ON u.id=a.user_id
      WHERE ($1::text IS NULL OR a.status=$1) ORDER BY a.requested_at DESC,a.user_id LIMIT $2 OFFSET $3`, [status, take + 1, offset]);
    await event(db, req.user.id, 'ADMIN_ACCESS_READ');
    return { items: r.rows.slice(0, take).map(r => ({ userId: r.user_id, name: r.name, email: r.email, status: r.status, canSearch: r.can_search,
      canSubmit: r.can_submit, pilot: r.pilot, version: r.version, requestedAt: r.requested_at })), hasMore: r.rows.length > take };
  });
  adminRoute('post', '/access/:userId', async (req, db) => {
    const b = req.body || {};
    if (!['granted', 'rejected', 'revoked'].includes(b.status) || !['canSearch', 'canSubmit', 'pilot'].every(k => typeof b[k] === 'boolean')) throw P.problem(400, 'Проверьте права доступа.');
    const target = (await db.query('SELECT role,blocked FROM users WHERE id=$1 FOR SHARE', [req.params.userId])).rows[0];
    if (!target || !['manager', 'admin'].includes(target.role) || target.blocked) throw P.problem(400, 'Доступ можно выдать действующему владельцу аккаунта.');
    const a = (await db.query('SELECT * FROM client_watchlist_access WHERE user_id=$1 FOR UPDATE', [req.params.userId])).rows[0];
    if (!a) throw P.problem(404, 'Заявка на доступ не найдена.');
    revision(a, b.version);
    const reason = P.text(b.reason, 5, 500, 'причину решения');
    requireVault();
    await db.query(`UPDATE client_watchlist_access SET status=$2,can_search=$3,can_submit=$4,pilot=$5,decision=$6,
      version=version+1,updated_at=now() WHERE user_id=$1`, [req.params.userId, b.status, b.canSearch, b.canSubmit, b.pilot,
      vault.encrypt(req.params.userId, 'access', { reason, actor: req.user.id })]);
    await event(db, req.user.id, 'ACCESS_' + b.status.toUpperCase(), req.params.userId);
  });
  adminRoute('get', '/entries', async (req, db) => {
    const { limit: take, offset } = P.page(req.query), status = req.query.status || 'pending';
    if (!P.STATUS.includes(status)) throw P.problem(400, 'Некорректный статус.');
    const target = req.query.id ? P.text(req.query.id, 36, 36, 'идентификатор записи') : null;
    const nameKey = req.query.name ? requireVault().index('name', P.normalizeName(req.query.name)) : null;
    const r = await db.query(`SELECT e.*,u.email AS owner_email FROM client_watchlist_entries e JOIN users u ON u.id=e.owner_id
      WHERE (($4::text IS NULL AND $5::text IS NULL AND ((e.status=$1 AND e.deleted_at IS NULL) OR ($1='deleted' AND e.deleted_at IS NOT NULL))) OR ($4::text IS NOT NULL AND e.id=$4)
        OR ($5::text IS NOT NULL AND e.name_index=$5)) ORDER BY e.created_at,e.id LIMIT $2 OFFSET $3`, [status, take + 1, offset, target, nameKey]);
    await event(db, req.user.id, 'ADMIN_ENTRIES_READ');
    for (const row of r.rows.slice(0, take)) await event(db, req.user.id, 'ADMIN_ENTRY_READ', row.id);
    return { items: r.rows.slice(0, take).map(r => ({ ...ownEntry(r), ownerId: r.owner_id, ownerEmail: r.owner_email })), hasMore: r.rows.length > take };
  });
  adminRoute('post', '/entries/:id/decision', async (req, db) => {
    const s = await settings(db), r = await entry(db, req.params.id), b = req.body || {};
    if (r.deleted_at) throw P.problem(409, 'Запись удалена администратором.');
    revision(r, b.version);
    const transitions = { publish: ['pending', 'hidden'], needs_info: ['pending'], reject: ['pending', 'needs_info'], hide: ['published'], terminate: ['pending', 'needs_info', 'published', 'hidden', 'expired'] };
    if (!transitions[b.action]?.includes(r.status)) throw P.problem(409, 'Это решение недоступно для текущего статуса.');
    const note = P.text(b.note, 5, 1000, 'пояснение решения');
    if (b.action === 'publish') {
      requireVault();
      if (revocations.read().has(r.id)) throw P.problem(409, 'Публикация отозвана. Восстановление недоступно.');
      if (!s.legal_ready || s.mode === 'off' || s.submissions_paused || b.basisVerified !== true || r.policy_version !== P.POLICY_VERSION)
        throw P.problem(403, 'Сначала проверьте основание и настройки публикации.');
      const a = await access(db, r.owner_id);
      if (a?.status !== 'granted' || !a.can_submit || (s.mode === 'pilot' && !a.pilot)) throw P.problem(403, 'У автора нет действующего доступа.');
      const src = await source(db, r.owner_id, r.customer_id);
      if (!same(src.fingerprint, r.source_fingerprint)) throw P.problem(409, 'Данные клиента изменились после подачи заявки. Запросите новую заявку.');
    }
    const status = { publish: 'published', needs_info: 'needs_info', reject: 'rejected', hide: 'hidden', terminate: 'terminated' }[b.action];
    if (status === 'terminated') revocations.add(r.id);
    let encrypted = null;
    if (status !== 'terminated') {
      const data = payload(r); data.decision = note;
      if (status === 'published') data.publication = { mode: 'manual', settingsVersion: s.version, at: new Date().toISOString() };
      encrypted = requireVault().encrypt(r.id, 'entry', data);
    }
    await db.query(`UPDATE client_watchlist_entries SET status=$2,payload=$3,version=version+1,updated_at=now(),
      review_required=review_required OR $2 IN ('hidden','needs_info','rejected','terminated'),
      name_index=CASE WHEN $2='terminated' THEN NULL ELSE name_index END,
      year_index=CASE WHEN $2='terminated' THEN NULL ELSE year_index END,
      source_fingerprint=CASE WHEN $2='terminated' THEN NULL ELSE source_fingerprint END,
      published_at=CASE WHEN $2='published' THEN now() ELSE published_at END,
      expires_at=CASE WHEN $2='published' THEN now()+($4::int * interval '1 day') ELSE expires_at END WHERE id=$1`, [r.id, status, encrypted, s.publication_days]);
    await event(db, req.user.id, 'ENTRY_' + b.action.toUpperCase(), r.id);
  });
  adminRoute('post', '/entries/:id/delete', async (req, db) => {
    const r = await entry(db, req.params.id), b = req.body || {};
    if (r.deleted_at) return;
    revision(r, b.version);
    if (b.confirmed !== true) throw P.problem(400, 'Подтвердите удаление записи.');
    revocations.add(r.id);
    await db.query(`UPDATE client_watchlist_entries SET status='terminated',deleted_at=now(),payload=NULL,name_index=NULL,year_index=NULL,
      source_fingerprint=NULL,review_required=true,version=version+1,updated_at=now() WHERE id=$1`, [r.id]);
    await event(db, req.user.id, 'ENTRY_DELETED', r.id);
  });
  adminRoute('get', '/appeals', async (req, db) => {
    const { limit: take, offset } = P.page(req.query), status = req.query.status || 'new';
    if (!['new', 'reviewing', 'resolved'].includes(status)) throw P.problem(400, 'Некорректный статус обращения.');
    const r = await db.query(`SELECT a.*,u.email FROM client_watchlist_appeals a JOIN users u ON u.id=a.reporter_id
      WHERE a.status=$1 ORDER BY a.created_at,a.id LIMIT $2 OFFSET $3`, [status, take + 1, offset]);
    const items = [];
    for (const row of r.rows.slice(0, take)) {
      const data = row.payload ? requireVault().decrypt(row.id, 'appeal', row.payload) : {};
      const e = (await db.query('SELECT * FROM client_watchlist_entries WHERE id=$1', [row.entry_id])).rows[0];
      items.push({ id: row.id, entryId: row.entry_id, reporterEmail: row.email, status: row.status, version: row.version, createdAt: row.created_at, ...data, entry: e ? ownEntry(e) : null });
    }
    await event(db, req.user.id, 'ADMIN_APPEALS_READ');
    return { items, hasMore: r.rows.length > take };
  });
  adminRoute('post', '/appeals', async (req, db) => {
    // Регистрация обращения клиента из опубликованного канала связи, без аккаунта.
    const b = req.body || {}, e = await entry(db, b.entryId), appealId = id();
    const message = P.text(b.message, 15, 1500, 'суть обращения'), reference = P.text(b.reference, 10, 500, 'ссылку на обращение');
    requireVault();
    const r = await db.query(`INSERT INTO client_watchlist_appeals(id,entry_id,reporter_id,payload) VALUES($1,$2,$3,$4)
      ON CONFLICT(entry_id,reporter_id) WHERE status<>'resolved' DO NOTHING RETURNING id`,
      [appealId, e.id, req.user.id, vault.encrypt(appealId, 'appeal', { message, reference, channel: 'external', identityVerified: false })]);
    if (r.rowCount) await event(db, req.user.id, 'EXTERNAL_APPEAL_REGISTERED', e.id);
  });
  adminRoute('post', '/appeals/:id/decision', async (req, db) => {
    const r = (await db.query('SELECT * FROM client_watchlist_appeals WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0], b = req.body || {};
    if (!r) throw P.problem(404, 'Обращение не найдено.');
    revision(r, b.version);
    if (r.status === 'resolved' || !['reviewing', 'resolved'].includes(b.status)) throw P.problem(409, 'Обращение уже рассмотрено или решение недоступно.');
    if (b.status === 'resolved' && !['publication_stopped', 'not_confirmed', 'author_correction'].includes(b.outcome)) throw P.problem(400, 'Укажите результат рассмотрения.');
    const data = requireVault().decrypt(r.id, 'appeal', r.payload);
    data.response = P.text(b.response, 10, 1500, 'результат рассмотрения');
    data.outcome = b.status === 'resolved' ? b.outcome : null;
    if (typeof b.identityVerified === 'boolean') data.identityVerified = b.identityVerified;
    // Спор не возобновляет публикацию. Прекращение делаем в одной транзакции с решением.
    if (b.status === 'resolved' && b.outcome === 'publication_stopped') {
      const e = await entry(db, r.entry_id);
      if (!['withdrawn', 'terminated'].includes(e.status)) {
        revocations.add(e.id);
        await db.query(`UPDATE client_watchlist_entries SET status='terminated',payload=NULL,name_index=NULL,year_index=NULL,source_fingerprint=NULL,
          version=version+1,updated_at=now() WHERE id=$1`, [e.id]);
        await event(db, req.user.id, 'ENTRY_TERMINATE', e.id);
      }
    }
    await db.query('UPDATE client_watchlist_appeals SET status=$2,payload=$3,version=version+1,updated_at=now() WHERE id=$1', [r.id, b.status, vault.encrypt(r.id, 'appeal', data)]);
    await event(db, req.user.id, 'APPEAL_' + b.status.toUpperCase(), r.id);
  });
  adminRoute('post', '/settings', async (req, db) => {
    const s = (await db.query('SELECT * FROM client_watchlist_settings WHERE id=1 FOR UPDATE')).rows[0], b = req.body || {};
    revision(s, b.version);
    const autoPublish = b.autoPublish === undefined ? s.auto_publish : b.autoPublish;
    if (!['off', 'pilot', 'on'].includes(b.mode) || !['legalReady', 'searchPaused', 'submissionsPaused'].every(k => typeof b[k] === 'boolean') ||
      typeof autoPublish !== 'boolean' ||
      !Number.isInteger(b.searchLimit) || b.searchLimit < 1 || b.searchLimit > 100 || !Number.isInteger(b.publicationDays) || b.publicationDays < 7 || b.publicationDays > 90)
      throw P.problem(400, 'Проверьте настройки раздела.');
    const reason = P.text(b.reason, 5, 500, 'причину изменения');
    let reference = null;
    if (b.legalReady) {
      requireVault();
      const value = P.text(b.legalReference, 20, 1500, 'документ и основание допуска к общему списку');
      reference = vault.encrypt('settings', 'legal', { reference: value, reason, actor: req.user.id, policyVersion: P.POLICY_VERSION });
    }
    if (b.mode !== 'off') {
      if (!vault || !b.legalReady) throw P.problem(400, 'Для включения нужны настроенная защита и проверенное основание обмена.');
      revocations.read();
    }
    await db.query(`UPDATE client_watchlist_settings SET mode=$1,legal_ready=$2,legal_reference=$3,search_paused=$4,submissions_paused=$5,
      search_limit=$6,publication_days=$7,auto_publish=$8,version=version+1,updated_at=now() WHERE id=1`, [b.mode, b.legalReady, reference, b.searchPaused, b.submissionsPaused, b.searchLimit, b.publicationDays, autoPublish]);
    await event(db, req.user.id, 'SETTINGS_CHANGED');
    if (autoPublish !== s.auto_publish) await event(db, req.user.id, autoPublish ? 'AUTO_PUBLICATION_ENABLED' : 'AUTO_PUBLICATION_DISABLED');
  });
  adminRoute('get', '/events', async (req, db) => {
    const { limit: take, offset } = P.page(req.query);
    const r = await db.query('SELECT id,actor_id AS "actorId",action,target_id AS "targetId",created_at AS "createdAt" FROM client_watchlist_events ORDER BY id DESC LIMIT $1 OFFSET $2', [take + 1, offset]);
    return { items: r.rows.slice(0, take), hasMore: r.rows.length > take };
  });
  const maintenanceTimer = setInterval(() => ensure().then(maintenance).catch(() => {}), 15 * 60000);
  maintenanceTimer.unref?.();
  return { ensure, maintenance, close: () => clearInterval(maintenanceTimer) };
}
module.exports = { registerWatchlistRoutes };
