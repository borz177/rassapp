// Распознаём просьбы об открытии формы. Публикация происходит в разделе ЧС.
const destination = '(?:в|во)\\s+(?:ч\\s*\\.?\\s*с\\.?|ч[её]рн(?:ый|ом)\\s+спис(?:ок|ке)|бл[эе]клист)';
const command = '(?:добавь(?:те)?|занеси(?:те)?|внеси(?:те)?|отправь(?:те)?|помести(?:те)?)';
const polite = '(?:можешь|можете|хочу|давай(?:те)?)\\s+(?:добавить|занести|внести|отправить|поместить)';
const request = new RegExp('^(?:(?:пожалуйста|давай(?:те)?)[,\\s]+)*(?:' + command + '|' + polite + ')\\s+([\\s\\S]+)$', 'iu');
const targetList = new RegExp('(?<!\\p{L})' + destination + '(?!\\p{L})', 'iu');
const selection = /\[watchlist:([a-zA-Z0-9_-]{1,200})\]$/u;
const followup = /^(?:его|е[её]|этого клиента|эту клиентку)$/iu;
const reasonMarker = /(?:^|[\s,]+)(?:за\s+|по причине\s+|потому что\s+|причина\s*[:—–-]\s*)|^\s*:\s*|[\s,]+[—–]\s+/iu;
const reasonAliases = {
  overdue: /^(?:(?:длительная|длительную|длительной|долгая|долгую|долгой)\s+)?просрочк[ауеи]$/u,
  unfulfilled: /^(?:неисполнени[ея] обязательств|невыполнени[ея] обязательств|не (?:исполняет|выполняет|выполнил|выполнила) обязательства)$/u,
};

function reasonDraft(value) {
  const details = value.trim().replace(/^другая причина\s*[:—–-]\s*/iu, '');
  const key = details.toLowerCase().replace(/ё/g, 'е').replace(/[.!?]+$/u, '').trim().replace(/\s+/gu, ' ');
  for (const [reason, aliases] of Object.entries(reasonAliases)) {
    if (aliases.test(key)) return { reason };
  }
  return { reason: 'other', reasonDetails: key === 'другая причина' ? '' : details };
}

function watchlistIntent({ text, image, images, audio, channel = 'app', auditReportId } = {}) {
  if (channel !== 'app' || image || images?.length || audio || auditReportId) return null;
  const question = typeof text === 'string' ? text.trim() : '';
  const search = question.match(/^(?:(?:пожалуйста|можешь|можете|давай)[,\s]+)*(?:проверь(?:те)?|проверить|проверишь|найти|найди(?:те)?|поищи|посмотри|есть\s+ли)\s+(.+)$/iu);
  if (search && /(?<!\p{L})(?:ч\s*\.?\s*с\.?|ч[её]рн(?:ый|ом)\s+спис(?:ок|ке))(?!\p{L})/iu.test(search[1])) {
    let target = search[1].replace(/(?<!\p{L})(?:(?:в|по)\s+)?(?:ч\s*\.?\s*с\.?|ч[её]рн(?:ый|ом)\s+спис(?:ок|ке))/iu, '').replace(/^(?:есть\s+ли\s+)?(?:клиента?\s+|клиентку\s+)?/iu, '').replace(/[?!.,]+$/u,'').trim();
    const year = target.match(/(?:[,\s]+)(19\d{2}|20\d{2})(?:\s*г\.?\s*р\.?)?$/iu);
    if (year) target = target.slice(0,year.index).trim();
    if (/^[\p{L}'’.-]+(?:\s+[\p{L}'’.-]+){1,3}$/u.test(target)
        && !/(?:^|\s)(?:и|или|не)(?:\s|$)/iu.test(target))
      return { search: true, name: target, birthYear: year ? Number(year[1]) : null };
    return { search: true, unsupported: true };
  }
  const choice = question.match(selection);
  if (choice) return { customerId: choice[1] };
  const body = question.match(request)?.[1];
  const list = body?.match(targetList);
  if (!list) return null;
  const before = body.slice(0, list.index).trim().replace(/^(?:клиента|клиентку)$/iu, '');
  const suffix = body.slice(list.index + list[0].length).trim();
  const after = suffix.replace(/^[,.]\s*/u, '');
  const marker = after.match(reasonMarker);
  const commaReason = before && suffix.startsWith(',') && marker?.index !== 0;
  const trailingName = (commaReason ? '' : marker ? after.slice(0, marker.index) : after).trim().replace(/[.!?]+$/u, '');
  const details = (commaReason ? after : marker ? after.slice(marker.index + marker[0].length) : '').trim();
  if (question.length > 1250 || details.length > 1000 || /[\r\n]/u.test(question) ||
      /(?:^|\s)(?:всех|списком|массово|нескольких|группу)(?=\s|[.,!?]|$)/iu.test(`${before} ${trailingName}`))
    return { unsupported: true };
  if (before && trailingName) return { unsupported: true };
  const target = (before || trailingName).replace(/[,\s]+пожалуйста$/iu, '').trim();
  const draft = details ? { draft: reasonDraft(details) } : {};
  if (followup.test(target)) return { focus: true, ...draft };
  const name = target.replace(/^(?:клиента|клиентку)(?:\s+|$)/iu, '').replace(/[«»"]/gu, '').trim();
  if (!name) return {};
  if (!/^[\p{L}]+(?:[-'’][\p{L}]+)*(?:\s+[\p{L}]+(?:[-'’][\p{L}]+)*){0,3}$/u.test(name)
      || /(?:^|\s)(?:и|или|не|за|поручителя)(?:\s|$)/iu.test(name)) return { unsupported: true };
  return { name, ...draft };
}

module.exports = { watchlistIntent };
