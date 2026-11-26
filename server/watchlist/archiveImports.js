const crypto = require('node:crypto');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const P = require('./policy');
const { MAX_BYTES, MAX_MIB, publicationDate } = require('./telegramArchive');
const { importBirthDate } = require('./bulkImport');
const { defaultSelection, validateSelection, matchesSelection } = require('./archiveSelection');
const { archivePeople, standaloneReason } = require('./archivePeople');
const MAX_ARCHIVE_RECORDS = 20000;

const jobs = 'client_watchlist_archive_jobs';
const records = 'client_watchlist_archive_records';
const history = 'client_watchlist_archive_history';
const jobFields = 'id,filename,state,progress,total,scanned,error,created_at';
const statusView = row => ({ id: row.id, filename: row.filename, status: row.state, progress: row.progress, total: row.total, scanned: row.scanned, error: row.error, createdAt: row.created_at });
const publicErrors = {
  NO_MESSAGES: 'В файле нет текстовых сообщений экспорта Telegram.',
  TOO_MANY_MESSAGES: 'Слишком много сообщений. Загрузите части архива по отдельности.',
  TOO_MANY_RECORDS: 'Слишком много карточек. Загрузите части архива по отдельности.',
  INVALID_HTML: 'Не удалось разобрать структуру HTML-архива.',
};
const keyFor = (owner, job, ordinal) => `${owner}:${job}:${ordinal}`;
const draftLimits = { name: 200, birthDate: 32, reason: 16, reasonDetails: 1000, source: 200, publishedAt: 80 };

function draftFields(body) {
  return Object.fromEntries(Object.entries(draftLimits).map(([key, max]) => {
    const value = body?.[key] ?? '';
    if (typeof value !== 'string' || value.length > max) throw P.problem(400, 'Одно из полей имеет неверный формат или превышает допустимый размер.');
    return [key, value.trim()];
  }));
}
function withPublicationDate(data, fallback) {
  if (data.fields.publishedAt) return data;
  return { ...data, dateFromImport: true, fields: { ...data.fields, publishedAt: new Date(fallback).toISOString() } };
}
function verifyDraft(fields) {
  const valid = {}, errors = [];
  const check = fn => { try { Object.assign(valid, fn()); } catch (e) { if (e.status !== 400) throw e; errors.push(e.message); } };
  check(() => ({ name: P.fullName(fields.name) }));
  check(() => importBirthDate(fields.birthDate));
  check(() => P.submissionReason(fields));
  check(() => ({ source: P.text(fields.source, 2, 200, 'источник информации') }));
  check(() => {
    const publishedAt = publicationDate(fields.publishedAt);
    if (!publishedAt || Date.parse(publishedAt) > Date.now()) throw P.problem(400, 'Проверьте дату публикации источника.');
    return { publishedAt };
  });
  return { valid, errors };
}

function suggestedFields(person, message, source) {
  const reasonDetails = person.reasonText;
  const categories = { 'длительная просрочка': 'overdue', 'неисполнение обязательств': 'unfulfilled' };
  const reason = Object.hasOwn(categories, reasonDetails.toLowerCase()) ? categories[reasonDetails.toLowerCase()] : reasonDetails ? 'other' : '';
  return draftFields({
    name: person.name.slice(0, 200), birthDate: person.birthDate.slice(0, 32),
    reason, reasonDetails: reason === 'other' ? reasonDetails.slice(0, 1000) : '', source,
    publishedAt: message.publishedAt || '',
  });
}

function messageDrafts(message, source, fallback, selection, people = archivePeople(message.text)) {
  const stamp = message.publishedAt || crypto.createHash('sha256').update(message.text).digest('hex');
  return people.flatMap((person, index) => {
    if (person.commentOnly) return [];
    const { author, position, replyTo, ...sourceMessage } = message;
    const original = people.length > 1
      ? { ...sourceMessage, text: person.text, part: index + 1, people: people.length, stamp }
      : sourceMessage;
    const data = withPublicationDate({ message: { ...original, source }, fields: suggestedFields(person, message, source) }, fallback);
    if (person.reasonMessage) data.reasonMessage = person.reasonMessage;
    const searchable = person.reasonText
      ? { text: [person.text, person.reasonText, person.reasonMessage?.text].filter(Boolean).join('\n') }
      : original;
    return matchesSelection(searchable, verifyDraft(data.fields).valid, selection) ? [data] : [];
  });
}

function linkArchiveReasons(messages, peopleByMessage = messages.map(message => archivePeople(message.text))) {
  const uniqueIds = new Map(), candidates = new Map();
  messages.forEach((message, index) => uniqueIds.set(message.messageId, uniqueIds.has(message.messageId) ? null : index));
  for (const [index, message] of messages.entries()) {
    if (message.truncated) continue;
    const reply = !!message.replyTo, previous = messages[index - 1];
    const parentIndex = reply ? uniqueIds.get(message.replyTo) : index - 1;
    if (parentIndex == null || parentIndex < 0 || parentIndex >= index || messages[parentIndex].truncated) continue;
    const parent = peopleByMessage[parentIndex], named = peopleByMessage[index];
    if (!parent.length || named.length > 1 || named.length && !reply) continue;
    if (!reply) {
      const gap = Date.parse(message.publishedAt) - Date.parse(previous.publishedAt);
      if (!message.author || message.author !== previous.author || message.position !== previous.position + 1
          || !(gap >= 0 && gap <= 5 * 60 * 1000)) continue;
    }

    const comment = named[0];
    const matches = comment ? parent.filter(person => P.normalizeName(person.name) === P.normalizeName(comment.name)
      && (!comment.birthDate || !person.birthDate || comment.birthDate === person.birthDate)) : parent;
    const reason = comment ? comment.reasonText : standaloneReason(message.text);
    if (matches.length !== 1 || !reason) continue;
    const [person] = matches;
    if (comment) comment.commentOnly = true;
    if (person.reasonText || person.commentOnly) continue;
    const list = candidates.get(person) || [];
    list.push({ reason, reply, messageId: message.messageId, text: message.text, publishedAt: message.publishedAt });
    candidates.set(person, list);
  }
  for (const [person, list] of candidates) {
    if (person.commentOnly) continue;
    const preferred = list.some(item => item.reply) ? list.filter(item => item.reply) : list;
    if (new Set(preferred.map(item => item.reason.toLowerCase().replace(/[.!?]+$/u, ''))).size !== 1) continue;
    const [{reason, reply, ...message}] = preferred;
    person.reasonText = reason;
    person.reasonMessage = { ...message, kind: reply ? 'reply' : 'adjacent' };
  }
  return peopleByMessage;
}

function parseOffThread(html, progress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'telegramArchive.js'), { workerData: { telegramArchive: true, html } });
    const timer = setTimeout(() => { void worker.terminate(); reject(Error('TIMEOUT')); }, 90000);
    timer.unref();
    worker.on('message', msg => {
      if (typeof msg.progress === 'number') { progress(msg.progress); return; }
      if (msg.error) reject(Error(msg.error));
      else resolve(msg.rows);
    });
    worker.on('error', reject);
    worker.on('exit', () => { clearTimeout(timer); reject(Error('WORKER_EXIT')); });
  });
}

function createArchiveImports({ pool, vault, ensure }) {
  let running = false, closed = false;
  const identity = (owner, job, ordinal) => keyFor(owner, job, ordinal);
  const open = row => vault.decrypt(identity(row.owner_id, row.job_id, row.ordinal), 'telegram_record', row.payload);
  const save = (row, value) => vault.encrypt(identity(row.owner_id, row.job_id, row.ordinal), 'telegram_record', value);
  const identityIndex = (owner, fields) => {
    const { valid } = verifyDraft(fields);
    return valid.name && valid.birthDate ? vault.index('telegram_identity', [owner,P.normalizeName(valid.name),valid.birthDate]) : null;
  };
  const progressUpdate = (job, value) => pool.query(`UPDATE ${jobs} SET progress=GREATEST(progress,$3),updated_at=now() WHERE id=$1 AND lease=$2`, [job.id, job.lease, value]);
  async function tick() {
    if (closed || running || !vault) return;
    running = true;
    let claimed;
    try {
      await ensure();
      // Lease protects a job shared by multiple server processes. Workers have a shorter timeout.
      [claimed] = (await pool.query(`UPDATE ${jobs} j SET state='processing',progress=1,lease=$1,updated_at=now()
        WHERE j.id=(SELECT id FROM ${jobs} WHERE archive IS NOT NULL
          AND (state='queued' OR (state='processing' AND updated_at < now()-interval '3 minutes'))
          AND NOT EXISTS (SELECT 1 FROM ${jobs} active WHERE active.state='processing' AND active.updated_at >= now()-interval '3 minutes')
          ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING j.*`, [crypto.randomUUID()])).rows;
      if (!claimed) return;
      const { html, source, selection = defaultSelection } = vault.decrypt(`${claimed.owner_id}:${claimed.id}`, 'telegram_archive', claimed.archive);
      let last = 0;
      const messages = await parseOffThread(html, value => {
        if (value < last + 5) return;
        last = value;
        void progressUpdate(claimed, value).catch(() => {});
      });
      const peopleByMessage = [];
      for (const [index, message] of messages.entries()) {
        peopleByMessage.push(archivePeople(message.text));
        if (index % 250 === 249) await new Promise(resolve => setImmediate(resolve));
      }
      linkArchiveReasons(messages, peopleByMessage);
      const selected = [];
      for (let index = 0; index < messages.length; index++) {
        selected.push(...messageDrafts(messages[index], source, claimed.created_at, selection, peopleByMessage[index]));
        if (selected.length > MAX_ARCHIVE_RECORDS) throw Error('TOO_MANY_RECORDS');
        if (index % 250 === 249) await new Promise(resolve => setImmediate(resolve));
      }
      await progressUpdate(claimed, 90);
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        const lock = await db.query(`SELECT 1 FROM ${jobs} WHERE id=$1 AND lease=$2 AND state='processing' FOR UPDATE`, [claimed.id, claimed.lease]);
        if (!lock.rowCount) { await db.query('ROLLBACK'); return; }
        for (let i = 0; i < selected.length; i += 200) {
          const batch = selected.slice(i, i + 200).map((data, j) => {
            const ordinal = i + j + 1;
            return { ordinal, identity_index:identityIndex(claimed.owner_id,data.fields),
              payload:save({ owner_id:claimed.owner_id, job_id:claimed.id, ordinal },data) };
          });
          await db.query(`INSERT INTO ${records}(job_id,owner_id,ordinal,payload,identity_index)
            SELECT $1,$2,x.ordinal,x.payload,x.identity_index FROM jsonb_to_recordset($3::jsonb) x(ordinal int,payload jsonb,identity_index text)`, [claimed.id, claimed.owner_id, JSON.stringify(batch)]);
        }
        await db.query(`UPDATE ${jobs} SET archive=NULL,state='ready',total=$2,scanned=$3,progress=100,lease=NULL,updated_at=now() WHERE id=$1`, [claimed.id,selected.length,messages.length]);
        await db.query('COMMIT');
      } catch (e) { await db.query('ROLLBACK').catch(() => {}); throw e; }
      finally { db.release(); }
    } catch (e) {
      if (claimed) await pool.query(`UPDATE ${jobs} SET state='failed',archive=NULL,lease=NULL,error=$3,updated_at=now() WHERE id=$1 AND lease=$2`,
        [claimed.id, claimed.lease, publicErrors[e.message] || 'Архив не обработан. Повторите загрузку файла.']).catch(() => {});
    } finally { running = false; }
  }
  const timer = setInterval(() => void tick(), 2000);
  timer.unref();

  async function enqueue(db, owner, file, rawSource, rawSelection) {
    if (!file || !/\.html?$/iu.test(file.originalname) || !file.buffer?.length || file.buffer.length > MAX_BYTES)
      throw P.problem(400, `Выберите HTML-файл экспорта Telegram размером до ${MAX_MIB} МБ.`);
    const source = P.text(rawSource, 2, 200, 'название источника');
    let selection = defaultSelection;
    if (rawSelection !== undefined) {
      let parsed;
      try { parsed = JSON.parse(rawSelection); }
      catch { throw P.problem(400, 'Проверьте условия отбора архива.'); }
      selection = validateSelection(parsed);
    }
    let html;
    try { html = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer); }
    catch { throw P.problem(400, 'Архив должен быть в кодировке UTF-8.'); }
    const fileIndex = vault.index('telegram_file', [owner, crypto.createHash('sha256').update(file.buffer).digest('hex'), selection, 10]);
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('watchlist:telegram-enqueue',0))");
    const existing = (await db.query(`SELECT ${jobFields} FROM ${jobs} WHERE owner_id=$1 AND file_index=$2`,[owner,fileIndex])).rows[0];
    if (existing && existing.state !== 'failed') return statusView(existing);
    if ((await db.query(`SELECT count(*)::int AS count FROM ${jobs} WHERE state IN ('queued','processing')`)).rows[0].count >= 20)
      throw P.problem(429, 'Очередь обработки заполнена. Повторите загрузку позже.');
    const id = existing?.id || crypto.randomUUID();
    const basename = path.basename(file.originalname);
    const displayName = /^messages\d*\.html?$/i.test(basename) ? basename : 'Архив Telegram';
    const result = await db.query(`INSERT INTO ${jobs}(id,owner_id,filename,file_index,archive) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(owner_id,file_index) DO UPDATE SET archive=EXCLUDED.archive,state='queued',progress=0,error=NULL,updated_at=now()
      RETURNING ${jobFields}`,[id,owner,displayName,fileIndex,vault.encrypt(`${owner}:${id}`,'telegram_archive',{html,source,selection})]);
    return statusView(result.rows[0]);
  }
  const list = async (db,owner) => ({ items:(await db.query(`SELECT ${jobFields} FROM ${jobs} WHERE owner_id=$1 ORDER BY created_at DESC,id LIMIT 50`,[owner])).rows.map(statusView) });
  async function detail(db, owner, jobId, { offset, limit, excluded = false }) {
    const job = (await db.query(`SELECT ${jobFields} FROM ${jobs} WHERE id=$1 AND owner_id=$2`,[jobId,owner])).rows[0];
    if (!job) throw P.problem(404, 'Архив не найден.');
    const { rows } = await db.query(`SELECT r.*,e.status AS entry_status,EXISTS(
        SELECT 1 FROM ${records} d WHERE d.owner_id=r.owner_id AND d.identity_index=r.identity_index AND NOT d.excluded
          AND (d.job_id,d.ordinal)<>(r.job_id,r.ordinal)) AS duplicate
      FROM ${records} r LEFT JOIN client_watchlist_entries e ON e.id=r.entry_id
      WHERE r.job_id=$1 AND r.owner_id=$2 AND r.excluded=$5 ORDER BY r.ordinal LIMIT $3 OFFSET $4`,[jobId,owner,limit+1,offset,excluded]);
    const counts = (await db.query(`SELECT count(*) FILTER (WHERE NOT excluded)::int AS drafts,
      count(*) FILTER (WHERE excluded)::int AS excluded FROM ${records} WHERE job_id=$1 AND owner_id=$2 AND state='draft'`, [jobId,owner])).rows[0];
    return { job:statusView(job), draftCount:counts.drafts, excludedCount:counts.excluded, items:rows.slice(0,limit).map(row => {
      const data = row.payload ? open(row) : null;
      return { ordinal:row.ordinal, version:row.version, state:row.state, entryStatus:row.entry_status, excluded:row.excluded, duplicate:row.duplicate, ...(data || {}),
        errors:data ? verifyDraft(data.fields).errors : [] };
    }), hasMore:rows.length > limit };
  }
  async function draftBatch(db, owner, jobId, after) {
    const job = (await db.query(`SELECT state FROM ${jobs} WHERE id=$1 AND owner_id=$2`, [jobId,owner])).rows[0];
    if (!job) throw P.problem(404, 'Архив не найден.');
    if (job.state !== 'ready') throw P.problem(409, 'Сначала дождитесь обработки архива.');
    const limit = 100;
    const { rows } = await db.query(`SELECT * FROM ${records} WHERE job_id=$1 AND owner_id=$2 AND state='draft' AND NOT excluded AND ordinal>$3
      ORDER BY ordinal LIMIT $4 FOR UPDATE`, [jobId,owner,after,limit+1]);
    return { rows: rows.slice(0,limit), next: rows.length > limit ? rows[limit-1].ordinal : null };
  }
  async function rowFor(db, owner, jobId, ordinal, write = false) {
    if (!/^\d{1,5}$/.test(String(ordinal))) throw P.problem(404, 'Запись не найдена.');
    const r = (await db.query(`SELECT * FROM ${records} WHERE job_id=$1 AND owner_id=$2 AND ordinal=$3 ${write ? 'FOR UPDATE' : ''}`,[jobId,owner,ordinal])).rows[0];
    if (!r) throw P.problem(404, 'Запись не найдена.');
    return r;
  }
  async function revisions(db, owner, jobId, ordinal) {
    const row = await rowFor(db,owner,jobId,ordinal);
    const changes = (await db.query(`SELECT h.version,h.payload,h.action,h.created_at FROM ${history} h
      JOIN ${records} r USING (job_id,ordinal) WHERE h.job_id=$1 AND r.owner_id=$2 AND h.ordinal=$3 ORDER BY h.version DESC LIMIT 30`,[jobId,owner,ordinal])).rows;
    return { items:changes.map(change=>({ version:change.version, action:change.action, date:change.created_at,
      ...vault.decrypt(identity(row.owner_id,row.job_id,row.ordinal),`telegram_history:${change.version}`,change.payload) })) };
  }
  async function write(db, row, data, actor, action, { entryId=row.entry_id, state=row.state, sourceIndex=row.source_index, excluded=row.excluded } = {}) {
    await db.query(`INSERT INTO ${history}(job_id,ordinal,version,payload,actor_id,action) VALUES($1,$2,$3,$4,$5,$6)`,
      [row.job_id,row.ordinal,row.version+1,vault.encrypt(identity(row.owner_id,row.job_id,row.ordinal),`telegram_history:${row.version+1}`,{ before:open(row).fields, fields:data.fields }),actor,action]);
    await db.query(`UPDATE ${records} SET payload=$4,version=version+1,entry_id=$5,state=$6,source_index=$7,identity_index=$8,excluded=$9 WHERE job_id=$1 AND owner_id=$2 AND ordinal=$3`,
      [row.job_id,row.owner_id,row.ordinal,save(row,data),entryId,state,sourceIndex,identityIndex(row.owner_id,data.fields),excluded]);
    return { version:row.version+1, state, excluded };
  }
  async function purgeRevoked(db, ids) {
    await db.query(`DELETE FROM ${history} h USING ${records} r WHERE h.job_id=r.job_id AND h.ordinal=r.ordinal AND r.entry_id=ANY($1::text[])`,[ids]);
    await db.query(`UPDATE ${records} SET payload=NULL,identity_index=NULL,version=version+1,state='removed'
      WHERE entry_id=ANY($1::text[]) AND state<>'removed'`,[ids]);
  }
  const purgeEntry = (db,entryId) => purgeRevoked(db,[entryId]);
  async function recordDecision(db, entryId, actor, action) {
    const row = (await db.query(`SELECT * FROM ${records} WHERE entry_id=$1 AND payload IS NOT NULL FOR UPDATE`,[entryId])).rows[0];
    if (row) await write(db,row,open(row),actor,action);
  }

  return { enqueue,list,detail,draftBatch,rowFor,revisions,open,write,purgeEntry,purgeRevoked,recordDecision,tick,close(){closed=true;clearInterval(timer);} };
}

module.exports = { createArchiveImports, draftFields, verifyDraft, withPublicationDate, messageDrafts, linkArchiveReasons, MAX_ARCHIVE_RECORDS };
