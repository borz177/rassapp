// cleanup-orphan-documents.js — уборка файлов документов, на которые никто не ссылается.
//
// Зачем. Загрузка документа состоит из двух шагов: файл уезжает на сервер, и только потом
// сохраняется карточка клиента со ссылкой на него. Если между шагами закрыли окно, пропала
// связь или сохранение не прошло — файл остаётся на диске навсегда. Удаление документа из
// карточки теперь сносит и файл (DELETE /api/upload/document), но это не ловит обрывы.
// На проде так накопилось 16 таких файлов, включая присланные клиентами фото паспортов:
// недоступные уже никому, но лежащие на диске.
//
// Как. Файл считается сиротой, если на него нет ссылки ни в одной записи data_items.
// Сироты не удаляются сразу, а переезжают в карантин и стираются оттуда через RETENTION_DAYS —
// на случай, если запись просто не успела сохраниться или что-то пойдёт не так.
//
// Запуск (раз в сутки):
//   0 4 * * * node /root/rassapp/server/cleanup-orphan-documents.js >> /var/log/rassapp-cleanup.log 2>&1
//
// Флаги:
//   --dry-run   только показать, ничего не трогать
//   --verbose   печатать каждый файл

require('dotenv').config({ path: '/var/www/env/rassapp.env' });

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const LOG_PREFIX = '[CLEANUP DOCS]';
const UPLOAD_DIR = '/var/www/rassapp/server/uploads/documents';
const QUARANTINE_DIR = '/var/www/rassapp/server/uploads/quarantine';

// Свежие файлы не трогаем: загрузка могла произойти минуту назад, а карточка ещё
// сохраняется (или лежит в офлайн-очереди у пользователя и уедет позже).
const GRACE_HOURS = 24;
// Сколько держать в карантине перед окончательным удалением
const RETENTION_DAYS = 14;

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2);

async function main() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    console.log(`${LOG_PREFIX} каталог ${UPLOAD_DIR} не найден — нечего делать`);
    return;
  }

  // 1. Все ссылки на файлы, которые есть в базе. Забираем разом, а не запросом на каждый
  // файл: 85 отдельных запросов к БД ради уборки — расточительство.
  const { rows } = await pool.query(
    `SELECT DISTINCT doc->>'fileUrl' AS url
       FROM data_items d,
            jsonb_array_elements(COALESCE(d.data->'documents', '[]'::jsonb)) doc
      WHERE doc->>'fileUrl' LIKE '/uploads/documents/%'`
  );
  const referenced = new Set(rows.map(r => path.basename(r.url)));
  console.log(`${LOG_PREFIX} ссылок в базе: ${referenced.size}`);

  // 2. Ищем файлы без ссылок
  const files = fs.readdirSync(UPLOAD_DIR);
  const cutoff = Date.now() - GRACE_HOURS * 3600 * 1000;

  let orphans = 0, tooFresh = 0, movedBytes = 0;
  if (!DRY_RUN && files.length) fs.mkdirSync(QUARANTINE_DIR, { recursive: true });

  for (const name of files) {
    if (referenced.has(name)) continue;

    const full = path.join(UPLOAD_DIR, name);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (!stat.isFile()) continue;

    if (stat.mtimeMs > cutoff) {
      tooFresh++;
      if (VERBOSE) console.log(`${LOG_PREFIX}   пропуск (свежий): ${name}`);
      continue;
    }

    orphans++;
    movedBytes += stat.size;
    if (VERBOSE || DRY_RUN) {
      console.log(`${LOG_PREFIX}   сирота: ${name} (${mb(stat.size)} МБ, ${stat.mtime.toISOString().slice(0, 10)})`);
    }
    if (!DRY_RUN) {
      try {
        fs.renameSync(full, path.join(QUARANTINE_DIR, name));
      } catch (e) {
        console.error(`${LOG_PREFIX}   ❌ не удалось перенести ${name}:`, e.message);
        orphans--;
      }
    }
  }

  console.log(
    `${LOG_PREFIX} файлов: ${files.length} | в карантин: ${orphans} (${mb(movedBytes)} МБ) | ` +
    `свежих, отложено: ${tooFresh}${DRY_RUN ? ' | DRY RUN, ничего не тронуто' : ''}`
  );

  // 3. Чистим карантин от старого
  if (!DRY_RUN && fs.existsSync(QUARANTINE_DIR)) {
    const purgeBefore = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
    let purged = 0, purgedBytes = 0;
    for (const name of fs.readdirSync(QUARANTINE_DIR)) {
      const full = path.join(QUARANTINE_DIR, name);
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs < purgeBefore) {
          purgedBytes += st.size;
          fs.unlinkSync(full);
          purged++;
        }
      } catch { /* уже удалён */ }
    }
    if (purged) {
      console.log(`${LOG_PREFIX} удалено из карантина (старше ${RETENTION_DAYS} дней): ${purged} (${mb(purgedBytes)} МБ)`);
    }
  }
}

main()
  .catch(e => { console.error(`${LOG_PREFIX} ❌`, e); process.exitCode = 1; })
  .finally(() => pool.end());
