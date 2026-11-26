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
const unlabelledReason = /^(?:(?:пожалуйста[,\s]+)?не\s+(?:давать|выдавать|оформлять)(?:\s+(?:ему|ей|товар|кредит))?(?=$|[.,!❌⛔]|\s*[.,!❌⛔])|(?:(?:очень\s+)?сложн(?:ый|ая)|проблемн(?:ый|ая))\s+клиент(?:ка)?(?=$|[\s.,!❌⛔]))/iu;
const inlineComment = /^(.+?)[ \t]*(?:[,:–—]|[ \t]+-[ \t]+)[ \t]*(.+)$/u;
const conversationalReason = /^(?!.*(?:интервью|сайтом|приложением|импортом|сервером|интернетом))(?:(?:я\s+)?(?:ему\s+|ей\s+)?(?:больше\s+|никогда\s+)не\s+(?:дам|даю|выдам|выдаю|буду\s+давать)(?=$|[\s.,!])|(?:я\s+)?не\s+(?:дам|выдам)(?=$|[\s.,!])|(?:вс[её]\s+время|постоянно|вечно)\s+(?:с\s+ним\s+|с\s+ней\s+)?(?:какие[\s-]*то\s+)?проблемы(?=$|[\s.,!])|(?:с\s+ним|с\s+ней)\s+(?:(?:вс[её]\s+время|постоянно)\s+)?(?:какие[\s-]*то\s+)?проблемы(?=$|[\s.,!]))/iu;
const paymentExperience = /^(?:(?:ему|ей|им)\s+не\s+(?:давать|давайте|выдавать|выдавайте)|не\s+(?:давайте|выдавайте)(?:\s+(?:ему|ей|им|рассрочку|товар|кредит))?|(?:я\s+)?не\s+рекомендую\s+(?:давать|выдавать|оформлять)|(?:трудн(?:ый|ая)|тяж[её]л(?:ый|ая))\s+клиент(?:ка)?|(?:не\s+бер[её]т\s+трубку|трубку\s+не\s+бер[её]т)|(?:платит|оплачивает|платежи)\s+(?:с\s+задержк(?:ой|ами)|с\s+опозданием)|(?:постоянно\s+)?задерживает\s+(?:платежи|оплату)|кормит\s+обещаниями|(?:только\s+)?обещает\s*[,—–-]?\s*(?:но\s+)?не\s+(?:платит|отда[её]т)|(?:еле|с\s+трудом)\s+(?:забрали|вернул|отдал)(?:\s+(?:деньги|долг))?)(?=$|[\s.,!❌⛔])/iu;
const archiveReasonVariants = /^(?:(?:(?:категорически|вообще|никогда|пока)\s+)?(?:ничего|нечего)\s+не\s+давать|(?:категорически|вообще|никогда|пока)\s+не\s+давать|не\s+давать\s+(?:ничего|вообще)|(?:очень\s+)?проблемн(?:ый|ая|ые)|неплат[её]жеспособн(?:ый|ая|ые)|в\s+просрочке|просрочки)(?=$|[\s\p{P}\p{S}])/iu;
const reportedReason = /^(?:(?:мать|мама|отец|родители)\s+просил(?:а|и)?(?=\s).*?(?:не\s+давать|ничего(?:\s+ему|\s+ей)?\s+(?:не\s+)?давать)|на\s+звонки\s+не\s+отвечает|полный\s+бл[эе]к|мне\s+(?:(?:он|она)\s+)?(?:должен|должна|долг))(?=$|[\s\p{P}\p{S}])/iu;
const isExperience = text => {
  if (/^(?:проблемные\s+вопросы|в\s+просрочке\s+нет)(?=$|[\s.,!])/iu.test(text)) return false;
  return conversationalReason.test(text) || paymentExperience.test(text) || archiveReasonVariants.test(text) || reportedReason.test(text);
};

function resolveStatement(line) {
  const text = line.replace(/^[\p{P}\p{S}\s]+/u, '').trim();
  if (isExperience(text)) return text;
  if (statedNonpayment.test(text) || /[,.;]\s*не\s+оплачива(?:ет|ют)\s*[.!❌⛔]*$/iu.test(text))
    return 'Неисполнение обязательств';
  if (/^(?:длительная|долгая)\s+просрочка/iu.test(text)) return 'Длительная просрочка';
  if (statedOverdue.test(text)) return 'Просрочка платежа';
  if (/^(?:(?:в\s+)?рассрочку\s+не\s+давать|не\s+(?:давать|оформлять)\s+(?:в\s+)?рассрочку)(?=$|[\s.,!❌⛔])/iu.test(text))
    return 'Не давать рассрочку';
  if (/^не\s+выходит\s+на\s+связь(?=$|[\s.,!❌⛔])/iu.test(text)) return 'Не выходит на связь';
  if (/^не\s+отвечает(?=$|[\s.,!❌⛔])/iu.test(text)) return 'Не отвечает';
  if (unlabelledReason.test(text)) return text;
  const embeddedRefusal = text.match(/(?:^|[\s,;])((?:никому\s+)?(?:ничего\s+)?не\s+давать(?:\s+(?:ему|ей|им|ничего|рассрочку))?[\s.!❌❎✖🚫🛑]*)$/iu);
  if (embeddedRefusal) return embeddedRefusal[1].trim();
  return '';
}

function reasonFromLine(line) {
  return knownValue(reasonLabel.exec(line)?.[1]?.trim() || '') || resolveStatement(line);
}

function standaloneReason(text) {
  const lines = text.trim().split(/[\r\n]+/u).map(line => line.trim()).filter(Boolean);
  if (lines.length > 1) {
    return lines.every(line => isExperience(line)) ? lines.join('\n') : '';
  }
  if (!lines.length) return '';
  return /^(?:[❌❎✖\uFE0F\s]+)$/u.test(lines[0]) ? crossReason : reasonFromLine(lines[0]);
}

function birthField(value, labelled = false) {
  const raw = value.trim();
  const match = dateMatch.exec(raw);
  if (!match) {
    const shortDate = raw.match(/^(\d{1,2}[./-]\d{1,2}[./-]\d{2})(?!\d)(?:\s*г\.?\s*р\.?)?/iu);
    if (shortDate) return { date: shortDate[1], tail: raw.slice(shortDate[0].length).trim() };
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
  const withComment = body.match(inlineComment);
  if (withComment && plainName.test(withComment[1]) && hasNameWords(withComment[1])
      && (matchRole || capitalized.test(withComment[1]) && patronymic.test(withComment[1]))
      && reasonFromLine(withComment[2])) {
    return { name: withComment[1], birth: { date: '', tail: withComment[2] }, lines: 1 };
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
    const reasonLines = [birth.tail, ...fragment.slice(header.lines)];
    const conversational = reasonLines.filter(line => isExperience(line.replace(/^[\p{P}\p{S}\s]+/u, '')));
    const direct = conversational.length ? conversational.join('\n') : reasonLines.map(resolveStatement).find(Boolean);
    return { name: header.name, birthDate: birth.date, comment: own || direct, inlineComment: conversational.length > 0 || !!birth.tail && !!reasonFromLine(birth.tail), cross: fragment.some(line => crossMark.test(line)),
      text: headers.length === 1 ? text : fragment.join('\n') };
  });
  const preface = lines.slice(0, headers[0]?.index ?? 0);
  const comments = new Set([...people.filter(person => !person.inlineComment).map(person => person.comment), ...preface.map(resolveStatement)].filter(Boolean));
  const tail = headers.at(-1);
  const standaloneCross = people.length > 1 && [...preface, ...lines.slice(tail.index + tail.lines)]
    .some(line => /^(?:[❌❎✖\uFE0F\s]+)$/u.test(line));
  const common = sharedReasons.length === 1 ? sharedReasons[0]
    : !sharedReasons.length && comments.size === 1 ? comments.values().next().value
    : !sharedReasons.length && !comments.size && standaloneCross ? crossReason : '';
  return people.map(({cross,comment,inlineComment,...person}) => ({
    ...person, reasonText: comment || (cross || (people.length === 1 && preface.some(line => crossMark.test(line))) ? crossReason : common),
  }));
}

module.exports = { archivePeople, standaloneReason };
