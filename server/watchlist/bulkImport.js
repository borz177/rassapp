const P = require('./policy');

const MAX_ROWS = 100;
const reasonLabels = {
  'длительная просрочка': 'overdue',
  'неисполнение обязательств': 'unfulfilled',
  'другая причина': 'other',
};

function parseImport(body) {
  const input = body?.text;
  if (typeof input !== 'string' || input.length > 120000) throw P.problem(400, 'Список слишком большой для одной загрузки.');
  const lines = input.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)
    .map((line, index) => ({ line, number: index + 1 })).filter(({ line }) => line.trim());
  if (/^(фио|полное фио|фамилия имя отчество)(\t|$)/iu.test(lines[0]?.line.trimStart() || '')) lines.shift();
  if (!lines.length || lines.length > MAX_ROWS) throw P.problem(400, `Вставьте от 1 до ${MAX_ROWS} записей.`);

  return lines.map(({ line, number }) => {
    try {
      const columns = line.split('\t');
      if (columns.length > 3) throw P.problem(400, 'Ожидается до трёх столбцов.');
      const [rawName, rawYear = '', rawReason = ''] = columns.map(value => value.trim());
      const name = P.fullName(rawName);
      const birthYear = P.birthYear(rawYear);
      const reasonText = rawReason.toLocaleLowerCase('ru');
      const category = P.REASONS.includes(reasonText) ? reasonText
        : Object.hasOwn(reasonLabels, reasonText) ? reasonLabels[reasonText] : undefined;
      const fields = P.submissionReason({
        reason: rawReason ? category || 'other' : body.defaultReason,
        reasonDetails: rawReason && !category ? rawReason : body.defaultReasonDetails,
      });
      return { number, name, birthYear, ...fields };
    } catch (e) {
      if (e.status !== 400) throw e;
      return { number, error: e.message };
    }
  });
}

module.exports = { parseImport };
