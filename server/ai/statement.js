// CSV выписки: UTF-8, разделитель ; или ,; кавычки и переводы строк в полях.
// Только чтение: импорт денег выполняется отдельно после проверки владельцем.
const parseStatement = raw => {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 256 * 1024) throw new Error('CSV должен быть в UTF-8 и не больше 256 КБ.');
  const text = raw.replace(/^\uFEFF/,'');
  const firstLine = text.split(/\r?\n/,1)[0];
  const delimiter = firstLine.includes(';') ? ';' : ',';
  const rows = []; let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else if (!quoted && value.length) throw new Error('Некорректные кавычки в CSV.');
      else quoted = !quoted;
    } else if (!quoted && ch === delimiter) { row.push(value.trim()); value = ''; }
    else if (!quoted && (ch === '\n' || ch === '\r')) {
      row.push(value.trim()); if (row.some(Boolean)) rows.push(row); row=[]; value='';
      if (ch === '\r' && text[i+1] === '\n') i++;
    } else value += ch;
  }
  if (quoted) throw new Error('Незакрытая кавычка в CSV.');
  row.push(value.trim()); if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2 || rows.length > 101) throw new Error('Нужны заголовок и от 1 до 100 строк.');
  const headers = rows.shift().map(s => s.toLowerCase().trim());
  const col = names => headers.findIndex(h => names.includes(h));
  const dateCol = col(['дата','date','дата операции']), amountCol = col(['сумма','amount','поступление']), nameCol = col(['клиент','плательщик','customer','фио']), refCol = col(['номер','reference','назначение','назначение платежа']);
  if (dateCol < 0 || amountCol < 0) throw new Error('Нужны колонки «Дата» и «Сумма». Необязательно: «Клиент» и «Номер».');
  return rows.map((r,i) => {
    let date = r[dateCol] || '';
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(date)) date = date.split('.').reverse().join('-');
    if (r.length !== headers.length) throw new Error(`Строка ${i+2}: число полей не совпадает с заголовком.`);
    const parsedDate = new Date(`${date}T12:00:00Z`);
    const amount = Number((r[amountCol] || '').replace(/[\s\u00a0₽]/g,'').replace(',','.'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0,10) !== date || !Number.isFinite(amount) || amount <= 0) throw new Error(`Строка ${i+2}: проверьте дату и положительную сумму поступления.`);
    return { date, amount, customer: nameCol < 0 ? '' : r[nameCol], reference: refCol < 0 ? '' : r[refCol] };
  });
};
module.exports = { parseStatement };
