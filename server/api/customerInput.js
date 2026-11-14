// Поля клиента одинаковы при создании и изменении через агента.
// Дата выдачи и код сохраняются в существующем поле «Кем выдан» — как в
// клиенте нового договора. Карточка и печать читают их без изменения формата базы.
const CUSTOMER_IDENTITY_INPUT = {
  birthDate: { type: 'string', description: 'Дата рождения, ГГГГ-ММ-ДД; только если известна' },
  passportSeries: { type: 'string', description: 'Серия паспорта строкой, сохрани ведущие нули' },
  passportNumber: { type: 'string', description: 'Номер паспорта строкой, сохрани ведущие нули' },
  passportIssuedBy: { type: 'string', description: 'Кем выдан паспорт — точно по документу' },
  passportIssueDate: {
    type: 'string',
    description: 'Дата выдачи паспорта, ГГГГ-ММ-ДД; только если известна',
  },
  passportDivisionCode: {
    type: 'string',
    description: 'Код подразделения, например 000-001; только если известен',
  },
};
const text = (value) => (typeof value === 'string' ? value.trim() : '');
const issuedParts = (value) => {
  let issuer = text(value),
    date = '',
    code = '';
  issuer = issuer.replace(/(?:^|,\s*)дата выдачи\s+([^,]+)/gi, (_, v) => {
    date = v.trim();
    return '';
  });
  issuer = issuer.replace(/(?:^|,\s*)код\s+(\d{3}[- ]?\d{3})(?=\s*(?:,|$))/gi, (_, v) => {
    code = v.trim();
    return '';
  });
  return { issuer: issuer.replace(/^,\s*|,\s*$/g, ''), date, code };
};
function normalizeCustomerInput(input, existing = {}) {
  const out = { ...input };
  // Иногда модель передаёт все десять цифр в номере. Разделяем только
  // однозначный вариант; конфликтующую отдельно указанную серию не заменяем.
  const number = text(out.passportNumber).replace(/\D/g, ''),
    series = text(out.passportSeries).replace(/\D/g, '');
  if (number.length === 10 && (!series || series === number.slice(0, 4))) {
    out.passportSeries = `${number.slice(0, 2)} ${number.slice(2, 4)}`;
    out.passportNumber = number.slice(4);
  }
  const hasDate = text(out.passportIssueDate),
    hasCode = text(out.passportDivisionCode);
  if (hasDate || hasCode) {
    const before = issuedParts(existing.passportIssuedBy),
      next = issuedParts(out.passportIssuedBy);
    const date = hasDate || next.date || before.date,
      code = hasCode || next.code || before.code;
    out.passportIssuedBy = [
      next.issuer || before.issuer,
      date && `дата выдачи ${date}`,
      code && `код ${code}`,
    ]
      .filter(Boolean)
      .join(', ');
  }
  // Неправильный тип остаётся в запросе: API вернёт ошибку, не молча потеряет поле.
  for (const key of ['passportIssueDate', 'passportDivisionCode'])
    if (out[key] == null || typeof out[key] === 'string') delete out[key];
  return out;
}
function customerSummary(input) {
  const c = normalizeCustomerInput(input);
  return [
    c.name,
    c.phone,
    (c.passportSeries || c.passportNumber) &&
      `паспорт ${[c.passportSeries, c.passportNumber].filter(Boolean).join(' ')}`,
    c.birthDate && `дата рождения ${c.birthDate}`,
    c.passportIssuedBy,
    c.address,
  ]
    .filter(Boolean)
    .join('; ');
}
module.exports = { CUSTOMER_IDENTITY_INPUT, normalizeCustomerInput, customerSummary };
