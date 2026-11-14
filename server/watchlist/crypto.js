const crypto = require('node:crypto');
const fs = require('node:fs');

const fail = () => { throw Object.assign(new Error('Хранилище защиты общего списка недоступно.'), { status: 503 }); };
function keyBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return fail();
  const b = Buffer.from(value, 'base64');
  if (b.length !== 32) return fail();
  return b;
}
function createVault(config) {
  if (!config || !/^[a-zA-Z0-9_-]{1,32}$/.test(config.activeVersion || '')) return fail();
  const keys = new Map(Object.entries(config.keys || {}).map(([v, k]) => [v, keyBytes(k)]));
  const active = keys.get(config.activeVersion), search = keyBytes(config.searchKey);
  if (!active || [...keys.values()].some(k => k.equals(search))) return fail();
  return {
    version: config.activeVersion,
    encrypt(id, purpose, data) {
      const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', active, iv);
      c.setAAD(Buffer.from(JSON.stringify(['watchlist', id, purpose, config.activeVersion])));
      const value = Buffer.concat([c.update(JSON.stringify(data), 'utf8'), c.final()]);
      return { v: config.activeVersion, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), value: value.toString('base64') };
    },
    decrypt(id, purpose, data) {
      try {
        if (!data || !keys.has(data.v)) return fail();
        const iv = Buffer.from(data.iv, 'base64'), tag = Buffer.from(data.tag, 'base64');
        if (iv.length !== 12 || tag.length !== 16) return fail();
        const d = crypto.createDecipheriv('aes-256-gcm', keys.get(data.v), iv);
        d.setAAD(Buffer.from(JSON.stringify(['watchlist', id, purpose, data.v])));
        d.setAuthTag(tag);
        return JSON.parse(Buffer.concat([d.update(Buffer.from(data.value, 'base64')), d.final()]).toString('utf8'));
      } catch { return fail(); }
    },
    index(purpose, value) {
      return crypto.createHmac('sha256', search).update(JSON.stringify(['watchlist', purpose, value])).digest('hex');
    },
  };
}
function loadVault(file = process.env.WATCHLIST_KEY_FILE) {
  try {
    if (!file) return null;
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || (stat.mode & 0o077)) return null;
    return createVault(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch { return null; }
}
function loadTotpSecret() {
  try {
    const file = process.env.WATCHLIST_ADMIN_TOTP_FILE;
    if (!file) return process.env.WATCHLIST_ADMIN_TOTP_SECRET;
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || (stat.mode & 0o077)) return undefined;
    return fs.readFileSync(file, 'utf8').trim();
  } catch { return undefined; }
}
function totpCounter(secret, code, now = Date.now()) {
  if (typeof secret !== 'string' || !/^[A-Z2-7]{32,128}$/.test(secret) || !/^\d{6}$/.test(String(code))) return null;
  let bits = '', bytes = [];
  for (const c of secret) bits += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0');
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const counter = Math.floor(now / 30000);
  for (const step of [counter, counter - 1, counter + 1]) {
    const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(step));
    const mac = crypto.createHmac('sha1', Buffer.from(bytes)).update(b).digest(), offset = mac[19] & 15;
    const expected = String((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(code)))) return step;
  }
  return null;
}
module.exports = { createVault, loadVault, loadTotpSecret, totpCounter };
