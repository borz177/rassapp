// Шифрование секретов в базе (AES-256-GCM) — ключей доступа к внешним
// сервисам, по которым можно действовать от имени владельца. База попадает в
// резервные копии и дампы, и открытый ключ в них — готовый доступ.
//
// Ключ шифрования выводится (HKDF) из отдельной переменной окружения, а без неё —
// из JWT_SECRET; у каждого назначения своя «соль», поэтому утечка одного
// производного ключа не раскрывает другие. Сменили секрет — старые значения не
// расшифруются, и подключение придётся сделать заново.
const crypto = require('crypto');

const PREFIX = 'enc1:';

/**
 * @param {string} purpose — назначение, например 'finuchet-npd'
 * @param {string} [envKeyName] — своя переменная окружения с секретом
 */
function createSecretBox(purpose, envKeyName) {
  const secret = (envKeyName && process.env[envKeyName]) || process.env.JWT_SECRET || '';
  const key = secret ? Buffer.from(crypto.hkdfSync('sha256', secret, purpose, 'secret-box', 32)) : null;

  const seal = (plain) => {
    if (plain == null || plain === '') return plain;
    if (!key) throw new Error(`Нет ключа шифрования для ${purpose}`);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
  };

  const open = (stored) => {
    if (!stored || !String(stored).startsWith(PREFIX)) return stored || null;
    if (!key) throw new Error(`Нет ключа шифрования для ${purpose}`);
    const raw = Buffer.from(String(stored).slice(PREFIX.length), 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  };

  return { seal, open };
}

module.exports = { createSecretBox };
