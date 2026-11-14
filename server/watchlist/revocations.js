// Журнал отзыва хранится ОТДЕЛЬНО от восстанавливаемой БД. Только непрозрачные id,
// без ФИО/года/причин. Контрольная сумма выявляет повреждение, не заменяет права ОС.
const fs = require('node:fs');
const crypto = require('node:crypto');
const checksum = value => crypto.createHash('sha256').update(value).digest('hex');
const unavailable = () => { throw Object.assign(new Error('Журнал отзыва недоступен. Общий поиск остановлен.'), { status: 503 }); };
function createRevocations(file) {
  const check = () => {
    if (!file) return unavailable();
    try {
      const s = fs.lstatSync(file);
      if (!s.isFile() || (s.mode & 0o077)) return unavailable();
    } catch { return unavailable(); }
  };
  const read = () => {
    check();
    try {
      const content = fs.readFileSync(file, 'utf8'), result = new Set();
      if (content && !content.endsWith('\n')) return unavailable();
      for (const line of content.split('\n').filter(Boolean)) {
        const [id, time, sum, extra] = line.split('|');
        if (!/^[a-f0-9-]{36}$/.test(id) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(time || '') ||
          !Number.isFinite(Date.parse(time)) || sum !== checksum(id + '|' + time) || extra !== undefined) return unavailable();
        result.add(id);
      }
      return result;
    } catch { return unavailable(); }
  };
  return {
    read,
    add(id) {
      if (!/^[a-f0-9-]{36}$/.test(id)) return unavailable();
      if (read().has(id)) return;
      let fd;
      try {
        fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | (fs.constants.O_NOFOLLOW || 0));
        const time = new Date().toISOString(), line = Buffer.from(`${id}|${time}|${checksum(id + '|' + time)}\n`);
        if (fs.writeSync(fd, line) !== line.length) return unavailable();
        fs.fsyncSync(fd);
      } catch { return unavailable(); }
      finally { if (fd !== undefined) fs.closeSync(fd); }
    },
  };
}
module.exports = { createRevocations };
