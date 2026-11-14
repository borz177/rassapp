// Запускать вручную на нужном сервере. Секреты создаются в файлах, не в stdout.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createVault } = require('./crypto');
const [command, directory] = process.argv.slice(2);
function write(file, value, flag = 'wx') {
  const fd = fs.openSync(file, flag, 0o600);
  try { fs.writeFileSync(fd, value); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function base32(bytes) {
  let bits = '', result = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i + 5 <= bits.length; i += 5) result += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[parseInt(bits.slice(i, i + 5), 2)];
  return result;
}
try {
  if (!['init', 'rotate'].includes(command) || !directory || !path.isAbsolute(directory)) throw new Error('Использование: node server/watchlist/setup.cjs init|rotate /абсолютный/закрытый/каталог');
  const dir = path.resolve(directory);
  if (command === 'init') {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || (stat.mode & 0o077) || fs.readdirSync(dir).length) throw new Error('Нужен пустой каталог с правами 0700. Существующие секреты не заменяются.');
    const config = { activeVersion: 'v1', keys: { v1: crypto.randomBytes(32).toString('base64') }, searchKey: crypto.randomBytes(32).toString('base64') };
    const secret = base32(crypto.randomBytes(20));
    write(path.join(dir, 'keys.json'), JSON.stringify(config));
    write(path.join(dir, 'keys.json.revocations'), '');
    write(path.join(dir, 'admin-totp'), secret);
    const uri = `otpauth://totp/FinUchet:watchlist-owner?secret=${secret}&issuer=FinUchet&algorithm=SHA1&digits=6&period=30`;
    write(path.join(dir, 'authenticator.txt'), `Добавьте в доверенный аутентификатор владельца. После настройки удалите этот файл.\n${uri}\n`);
    console.log('Файлы созданы с правами 0600. Значения секретов не выводятся.');
  } else {
    const file = path.join(dir, 'keys.json'), stat = fs.lstatSync(file);
    if (!stat.isFile() || (stat.mode & 0o077)) throw new Error('Проверьте права keys.json: требуется 0600.');
    let config;
    try { config = JSON.parse(fs.readFileSync(file, 'utf8')); createVault(config); }
    catch { throw new Error('Некорректный файл ключей. Содержимое не выводится.'); }
    const version = 'v_' + crypto.randomBytes(6).toString('hex');
    config.activeVersion = version; config.keys[version] = crypto.randomBytes(32).toString('base64');
    const temporary = path.join(dir, 'keys-' + crypto.randomBytes(8).toString('hex') + '.tmp');
    write(temporary, JSON.stringify(config)); fs.renameSync(temporary, file);
    const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    console.log('Добавлена новая версия ключа. Старые ключи и поисковый ключ сохранены.');
  }
  console.log(`WATCHLIST_KEY_FILE=${path.join(dir, 'keys.json')}`);
  console.log(`WATCHLIST_ADMIN_TOTP_FILE=${path.join(dir, 'admin-totp')}`);
  console.log('Перезапустите сервер после настройки. Режим общего списка автоматически не включается.');
} catch (e) { console.error(e.message); process.exitCode = 1; }
