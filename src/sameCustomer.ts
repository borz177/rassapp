import type { Customer } from '../types';

/**
 * Клиент из черновика FinUchetGPT уже есть в базе? Ассистент по фото паспорта
 * передаёт «нового» клиента, даже если такой уже заведён, а по двум черновикам
 * на одного человека без проверки появились бы два одинаковых клиента.
 *
 * Паспорт есть у обоих — решает только он (тёзки с разными паспортами — разные
 * люди). Иначе — то же ФИО, и даты рождения не противоречат друг другу.
 */
const digits = (v?: string) => String(v || '').replace(/\D/g, '');
const normName = (v?: string) => String(v || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

export const findSameCustomer = (
  customers: Customer[],
  c: { name?: string; passportSeries?: string; passportNumber?: string; birthDate?: string },
): Customer | undefined => {
  const passport = digits(c.passportSeries) + digits(c.passportNumber);
  const name = normName(c.name);
  if (passport.length >= 6) {
    const byPassport = customers.find(x => digits(x.passportSeries) + digits(x.passportNumber) === passport);
    if (byPassport) return byPassport;
  }
  if (!name) return undefined;
  return customers.find(x => {
    if (normName(x.name) !== name) return false;
    const theirs = digits(x.passportSeries) + digits(x.passportNumber);
    if (passport.length >= 6 && theirs.length >= 6) return false; // тёзка с другим паспортом
    const xb = x.birthDate;
    return !(c.birthDate && xb && String(xb).slice(0, 10) !== c.birthDate);
  });
};
