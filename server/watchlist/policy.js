const POLICY_VERSION = '2026-11-12-v3';
const ACTIVE = ['pending', 'needs_info', 'published', 'hidden'];
const STATUS = ['pending', 'needs_info', 'published', 'hidden', 'rejected', 'withdrawn', 'terminated', 'expired', 'deleted'];
const REASONS = ['overdue', 'unfulfilled', 'other'];
const BASES = ['subject_consent', 'other_lawful_basis'];
function problem(status, message) { return Object.assign(new Error(message), { status }); }
function text(value, min, max, label) {
  if (typeof value !== 'string') throw problem(400, `Укажите ${label}.`);
  const v = value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (v.length < min || v.length > max) throw problem(400, `Проверьте ${label}.`);
  return v;
}
function fullName(value) {
  const name = text(value, 5, 200, 'полное ФИО').replace(/\s+/g, ' ');
  if (name.split(' ').length < 2 || !/^[\p{L}\p{M} .’'\-]+$/u.test(name)) throw problem(400, 'Введите полное ФИО без цифр.');
  return name;
}
function normalizeName(value) { return fullName(value).toLocaleLowerCase('ru').replace(/ё/g, 'е'); }
function birthYear(value) {
  if (value === null || value === undefined || value === '') return null;
  if (!/^\d{4}$/.test(String(value))) throw problem(400, 'Укажите год рождения четырьмя цифрами.');
  const n = Number(value);
  if (n < 1900 || n > new Date().getUTCFullYear()) throw problem(400, 'Проверьте год рождения.');
  return n;
}
function identity(customer) {
  const name = fullName(customer?.name);
  const raw = customer.birthDate;
  let year = null;
  if (raw) {
    const m = String(raw).match(/^(\d{4})-\d{2}-\d{2}$/) || String(raw).match(/^\d{2}\.\d{2}\.(\d{4})$/);
    if (m) year = birthYear(m[1]);
  }
  return { name, birthYear: year };
}
function page(query = {}) {
  const offset = Number(query.offset || 0), limit = Number(query.limit || 20);
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 30) throw problem(400, 'Некорректная страница.');
  return { offset, limit };
}
function submissionReason(input) {
  if (!REASONS.includes(input.reason)) throw problem(400, 'Выберите причину.');
  // Старые сборки описывали «Другое» в note. Явно пустое новое поле не обходим.
  const description = input.reasonDetails === undefined ? input.note : input.reasonDetails;
  return { reason: input.reason, reasonDetails: input.reason === 'other' ? text(description, 3, 1000, 'описание причины') : undefined };
}
function legacySubmissionFields(input) {
  const fields = {};
  if (input.basis) {
    if (!BASES.includes(input.basis)) throw problem(400, 'Проверьте основание передачи.');
    fields.basis = input.basis;
  }
  if (input.evidence) fields.evidence = text(input.evidence, 1, 1000, 'подтверждение');
  if (input.note) fields.note = text(input.note, 1, 1500, 'комментарий');
  return fields;
}
module.exports = { POLICY_VERSION, ACTIVE, STATUS, REASONS, BASES, problem, text, fullName, normalizeName, birthYear, identity, page, submissionReason, legacySubmissionFields };
