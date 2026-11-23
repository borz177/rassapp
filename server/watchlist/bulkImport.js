const P = require('./policy');

const MAX_ROWS = 100;
const reasonLabels = {
  'длительная просрочка': 'overdue',
  'неисполнение обязательств': 'unfulfilled',
  'другая причина': 'other',
};

function importColumns(line) {
  if (line.includes('\t')) return line.split('\t').map(value => value.trim());
  const parts = line.trim().match(/^(.+?)\s+(\d\S*)(?:\s+(.+))?$/u);
  return parts ? parts.slice(1) : [line.trim()];
}

function importBirthDate(value) {
  if (!value || /^\d{4}$/.test(value)) return { birthYear: P.birthYear(value) };
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/u);
  const local = value.match(/^(\d{1,2})([./-])(\d{1,2})\2(\d{4})$/u);
  if (!iso && !local) throw P.problem(400, 'Укажите дату рождения ДД.ММ.ГГГГ или год.');
  const [year, month, day] = iso ? iso.slice(1).map(Number) : [Number(local[4]), Number(local[3]), Number(local[1])];
  const birthYear = P.birthYear(year);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day ||
      date.toISOString().slice(0, 10) > new Date().toISOString().slice(0, 10)) {
    throw P.problem(400, 'Проверьте дату рождения.');
  }
  return { birthYear, birthDate: date.toISOString().slice(0, 10) };
}

function parseImport(body) {
  const input = body?.text;
  if (typeof input !== 'string' || input.length > 120000) throw P.problem(400, 'Список слишком большой для одной загрузки.');
  const lines = input.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)
    .map((line, index) => ({ line, number: index + 1 })).filter(({ line }) => line.trim());
  if (/^(фио|полное фио|фамилия имя отчество)(\t|$)/iu.test(lines[0]?.line.trimStart() || '')) lines.shift();
  if (!lines.length || lines.length > MAX_ROWS) throw P.problem(400, `Вставьте от 1 до ${MAX_ROWS} записей.`);

  return lines.map(({ line, number }) => {
    try {
      const columns = importColumns(line);
      if (columns.length > 3) throw P.problem(400, 'Ожидается до трёх столбцов.');
      const [rawName, rawDate = '', rawReason = ''] = columns;
      const name = P.fullName(rawName);
      const birth = importBirthDate(rawDate);
      const reasonText = rawReason.trim().toLocaleLowerCase('ru');
      const category = P.REASONS.includes(reasonText) ? reasonText
        : Object.hasOwn(reasonLabels, reasonText) ? reasonLabels[reasonText] : undefined;
      const fields = P.submissionReason({
        reason: rawReason ? category || 'other' : body.defaultReason,
        reasonDetails: rawReason && !category ? rawReason : body.defaultReasonDetails,
      });
      return { number, name, ...birth, ...fields };
    } catch (e) {
      if (e.status !== 400) throw e;
      return { number, error: e.message };
    }
  });
}

module.exports = { parseImport };
