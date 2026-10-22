#!/usr/bin/env node
// Запускается администратором вручную. Никогда не регистрирует клиента при старте сервера.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const oauth = require('../api/oauth');

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const skillId = option('--skill-id');
if (!skillId || !/^[a-zA-Z0-9-]{16,80}$/.test(skillId)) {
  console.error('Использование: node server/scripts/setup-alice.js --skill-id ID --env-file /var/www/env/rassapp.env --output server/.env.alice');
  process.exit(1);
}
require('dotenv').config({ path: option('--env-file') || path.join(__dirname, '../.env') });
if (!process.env.DATABASE_URL) { console.error('В выбранном env не задан DATABASE_URL.'); process.exit(1); }
const output = path.resolve(option('--output') || path.join(__dirname, '../.env.alice'));
const redirectUri = 'https://social.yandex.net/broker/redirect';
let fd;
let complete = false;
let client;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  // Не создаём второго клиента, если файл настроек уже подготовлен.
  fd = fs.openSync(output, 'wx', 0o600);
  client = await pool.connect();
  await client.query('BEGIN');
  await oauth.ensureOAuthTables(client);
  const created = await oauth.createClient(client, { name: 'Алиса · FinUchet', redirectUris: [redirectUri] });
  fs.writeFileSync(fd, `# Приватный навык Алисы. Не публикуйте этот файл.\nALICE_SKILL_ID=${skillId}\nALICE_OAUTH_CLIENT_ID=${created.clientId}\nALICE_OAUTH_CLIENT_SECRET=${created.clientSecret}\n`);
  await client.query('COMMIT');
  complete = true;
  console.log(`Настройки записаны в ${output}. Секрет не выводится в терминал.`);
  console.log('В консоли Яндекса используйте OAuth client ID и secret из файла. Scope: read&write.');
  console.log('Webhook: https://rassrochka.pro/api/alice/webhook');
  console.log('Авторизация: https://rassrochka.pro/oauth/authorize');
  console.log('Получение и обновление токена: https://rassrochka.pro/api/oauth/token');
})().catch(async e => {
  if (client) await client.query('ROLLBACK').catch(() => {});
  console.error('Не удалось подготовить Алису:', e.code || e.name);
  process.exitCode = 1;
}).finally(async () => {
  if (fd !== undefined) { fs.closeSync(fd); if (!complete) fs.unlinkSync(output); }
  if (client) client.release();
  await pool.end();
});
