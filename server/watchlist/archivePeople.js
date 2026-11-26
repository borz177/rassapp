const P = require('./policy');

const word = String.raw`[\p{L}\p{M}][\p{L}\p{M}'’.-]*`;
const namePattern = String.raw`${word}(?:[ \t]+${word}){1,3}`;
const dateSeparator = String.raw`[ \t]*[.,/\-]+[ \t]*`;
const datePattern = String.raw`(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}${dateSeparator}\d{1,2}${dateSeparator}\d{4}|\d{1,2}(?:${dateSeparator}\d{1,2}[ \t]+|[ \t]+\d{1,2}${dateSeparator})(?:19|20)\d{2})`;
const dateMatch = new RegExp(String.raw`^\(?(?<date>${datePattern})\)?(?!\d)(?:\s*(?:год\s+рождения|года|г(?:\s*\.\s*р\.?)?)(?=$|[\s.,;])\.?)?`, 'iu');
const dateLabel = /^(?:дата\s+рождения|год\s+рождения|д\.\s*р\.?|г\.\s*р\.?)(?=$|[\s:–—-])\s*[-:–—]?\s*/iu;
const inlineDateLabel = /[\s,:–—]+(?=(?:дата\s+рождения|год\s+рождения|д\.\s*р\.?)(?=$|[\s:–—-]))/iu;
const role = /^(?:(?:полное\s+)?фио|ф\.\s*и\.\s*о\.|фамилия\s+имя\s+отчество|должник|за[её]мщик|поручитель|покупатель|клиент)\s*([-:–—]\s*|(?=[\p{Lu}]))/iu;
const labelledName = new RegExp(String.raw`^(?<name>${namePattern})(?=\s*[,:()–—\d]|$)`, 'u');
const nameWithDate = new RegExp(String.raw`^(?<name>${namePattern})[ \t]*[,:–—]?[ \t]*(?=\(?\d)`, 'u');
const plainName = new RegExp(String.raw`^${namePattern}$`, 'u');
const capitalized = /^(?:\p{Lu}\S+[ \t]+){1,3}\p{Lu}\S+$/u;
const patronymic = /(?:ович|евич|овна|евна|кызы|оглы|ич)\.?$/iu;
const reasonLabel = /(?:^|[\s,.;])(?:причина|основание|комментарий)\s*[-:–—]\s*(.+)$/iu;
const sharedReasonLabel = /^(?:общая\s+причина|общее\s+основание|общий\s+комментарий|(?:причина|основание|комментарий)\s+для\s+всех)\s*[-:–—]\s*(.+)$/iu;
const knownValue = value => /^(?:[-–—?…]+|нет|не указан(?:а|о)?|неизвестн[ао])\.?$/iu.test(value) ? '' : value;
const cleanLine = line => line.replace(/^\s*(?:(?:[•▪▫◆●*]+|\d{1,3}[.)])\s+(?!\d))?/u, '')
  .replace(/^[❌❎✖\uFE0F]+\s*/u, '').trim();
const ordinaryWords = new Set(['с', 'до', 'от', 'по', 'не', 'в', 'без', 'город', 'дата', 'год', 'договора', 'рассрочка', 'паспорт', 'долг', 'просрочка']);
const hasNameWords = name => !name.toLowerCase().split(/\s+/u).some(word => ordinaryWords.has(word));
const statedNonpayment = /^(?:(?:плат[её]ж[и]?|рассрочку|долг)\s+)?не\s+(?:оплатил(?:а|и)?|оплачива(?:ет|ют)|плат(?:ит|ят)|погасил(?:а|и)?|вернул(?:а|и)?|возвраща(?:ет|ют)|отда[её](?:т|ют))(?=$|[\s.,!❌⛔])/iu;
const statedOverdue = /^(?:просрочка\s*(?:[-:]\s*)?(?:\d|[.!?]|$)|\d{1,2}(?:-й)?\s+(?:день|дня|дней|недел[яиюь]|месяц(?:а|ев)?)\s+(?:просрочки|просрочке))/iu;
const crossMark = /[❌❎✖]/u;
const crossReason = '❌';
const capitalNameWord = String.raw`\p{Lu}[\p{L}\p{M}'’.-]*`;
const inlineSeparation = new RegExp(String.raw`[ \t]{2,}(?=(?:${capitalNameWord}[ \t]+){2,3}${capitalNameWord}[ \t]*[,:]?[ \t]*\(?${datePattern})`, 'gu');

function resolveStatement(line) {
  const text = line.replace(/^[\p{P}\p{S}\s]+/u, '');
  if (statedNonpayment.test(text) || /[,.;]\s*не\s+оплачива(?:ет|ют)\s*[.!❌⛔]*$/iu.test(text))
    return 'Неисполнение обязательств';
  if (/^(?:длительная|долгая)\s+просрочка/iu.test(text)) return 'Длительная просрочка';
  if (statedOverdue.test(text)) return 'Просрочка платежа';
  if (/^(?:(?:в\s+)?рассрочку\s+не\s+давать|не\s+(?:давать|оформлять)\s+(?:в\s+)?рассрочку)(?=$|[\s.,!❌⛔])/iu.test(text))
    return 'Не давать рассрочку';
  if (/^не\s+выходит\s+на\s+связь(?=$|[\s.,!❌⛔])/iu.test(text)) return 'Не выходит на связь';
  if (/^не\s+отвечает(?=$|[\s.,!❌⛔])/iu.test(text)) return 'Не отвечает';
  return '';
}

function birthField(value, labelled = false) {
  const raw = value.trim();
  const match = dateMatch.exec(raw);
  if (!match) {
    const explicitYear = raw.match(/^\(?(\d{4})\s*(?:г\.\s*р\.?|год(?:а)?\s+рождения)(?=$|[\s,.;)!❌])\)?/iu);
    if (explicitYear) return { date: explicitYear[1], tail: raw.slice(explicitYear[0].length).trim() };
    if (!labelled) return null;
    const year = raw.match(/^\(?(\d{4})\)?(?:\s*(?:г\.?(?:р\.?)?|год(?:а)?))?(?=$|\s|[,;])/iu);
    return { date: year?.[1] || knownValue(raw), tail: '' };
  }
  const numbers = match.groups.date.match(/\d+/g);
  const date = numbers[0].length === 4 ? numbers.join('-') : numbers.join('.');
  return { date, tail: raw.slice(match[0].length).replace(/^[\s.),:–—-]+/u, '') };
}

function personHeader(line, nextLine) {
  const content = cleanLine(line).replace(/^\[\d{1,2}\.\d{1,2}(?:\.\d{2,4})?,\s*\d{1,2}:\d{2}(?::\d{2})?\]\s*[^:\n]{1,100}:\s*/u, '');
  const matchRole = content.match(role);
  const body = matchRole ? content.slice(matchRole[0].length) : content;
  const inline = body.match(nameWithDate);
  if (inline && (matchRole || hasNameWords(inline.groups.name))) {
    const birth = birthField(body.slice(inline[0].length));
    if (birth) return { name: inline.groups.name, birth, lines: 1 };
  }
  const labelAt = body.search(inlineDateLabel);
  if (labelAt > 0) {
    const name = body.slice(0, labelAt).trim();
    if (plainName.test(name) && (matchRole || hasNameWords(name))) {
      const value = body.slice(labelAt).replace(/^[\s,:–—-]+/u, '').replace(dateLabel, '');
      return { name, birth: birthField(value, true), lines: 1 };
    }
  }
  const candidate = (matchRole ? body.match(labelledName)?.groups.name || '' : body).trim();
  if (!plainName.test(candidate) || (!matchRole && !hasNameWords(candidate))) return null;
  const next = cleanLine(nextLine || '');
  const explicitBirth = dateLabel.test(next);
  const birth = birthField(next.replace(dateLabel, ''), explicitBirth);
  if (birth) return { name: candidate, birth, lines: 2 };
  if (matchRole || (capitalized.test(candidate) && (patronymic.test(candidate) || reasonLabel.test(next))))
    return { name: candidate, birth: { date: '', tail: '' }, lines: 1 };
  return null;
}

function archivePeople(text) {
  // Точка с запятой может разделять карточки в одной строке. Если после неё
  // нет нового ФИО, текст остаётся частью той же карточки.
  const lines = text.replace(inlineSeparation, '\n').split(/[\r\n]+|[;；][ \t]*/u).map(value => value.trim()).filter(Boolean);
  const headers = [];
  for (let index = 0; index < lines.length; index++) {
    const header = personHeader(lines[index], lines[index + 1]);
    if (!header) continue;
    try { P.fullName(header.name); } catch { continue; }
    headers.push({ ...header, index });
    index += header.lines - 1;
  }
  const sharedReasons = [...new Set(lines.flatMap(line => {
    const value = knownValue(sharedReasonLabel.exec(line)?.[1]?.trim() || '');
    return value ? [value] : [];
  }))];
  const people = headers.map((header, position) => {
    const fragment = lines.slice(header.index, headers[position + 1]?.index);
    const birthLabels = fragment.slice(header.lines).map(cleanLine).filter(line => dateLabel.test(line));
    const birth = !header.birth.date && birthLabels.length === 1
      ? birthField(birthLabels[0].replace(dateLabel, ''), true)
      : header.birth;
    const first = header.birth?.tail || fragment[0];
    const own = [first, ...fragment.slice(header.lines)]
      .filter(line => !sharedReasonLabel.test(line))
      .map(line => knownValue(reasonLabel.exec(line)?.[1]?.trim() || '')).find(Boolean);
    const direct = [birth.tail, ...fragment.slice(header.lines)].map(resolveStatement).find(Boolean);
    return { name: header.name, birthDate: birth.date, comment: own || direct, cross: fragment.some(line => crossMark.test(line)),
      text: headers.length === 1 ? text : fragment.join('\n') };
  });
  const preface = lines.slice(0, headers[0]?.index ?? 0);
  const comments = new Set([...people.map(person => person.comment), ...preface.map(resolveStatement)].filter(Boolean));
  const tail = headers.at(-1);
  const standaloneCross = people.length > 1 && [...preface, ...lines.slice(tail.index + tail.lines)]
    .some(line => /^(?:[❌❎✖\uFE0F\s]+)$/u.test(line));
  const common = sharedReasons.length === 1 ? sharedReasons[0]
    : !sharedReasons.length && comments.size === 1 ? comments.values().next().value
    : !sharedReasons.length && !comments.size && standaloneCross ? crossReason : '';
  return people.map(({cross,comment,...person}) => ({
    ...person, reasonText: cross || (people.length === 1 && preface.some(line => crossMark.test(line))) ? crossReason : comment || common,
  }));
}

module.exports = { archivePeople };
