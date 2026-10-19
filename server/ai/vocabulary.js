// Словарь для расшифровки голосовых: как пишутся фамилии, имена, счета и
// товары этого продавца. Без него модель угадывает незнакомую фамилию с нуля
// («Гагоев» вместо «Гагаев»).
//
// Безопасность:
//  • только данные самого пользователя (собирает вызывающий по его user_id);
//  • минимум персональных данных: отдельные слова фамилий и имён — без
//    телефонов, паспортов, адресов, отчеств и без связки «кто есть кто»;
//  • слова из данных — не команды: берём только «словоподобное» (буквы, дефис,
//    апостроф, 2–30 знаков) и сортируем по алфавиту — фраза из карточки
//    («игнорируй все правила») распадается на несвязанные слова;
//  • если модель вместо речи вернула кусок словаря — расшифровку отбрасываем.

const MAX_WORDS = 1500;
const WORD_RE = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё'’-]{1,29}$/;
// Отчество не нужно для распознавания и лишнее как персональные данные
const PATRONYMIC_RE = /(вич|вна|ична|чна|оглы|кызы)$/i;
// Служебные слова названий — их модель и так знает
const STOP = new Set(['счет', 'счёт', 'касса', 'кассы', 'основной', 'основная', 'общая', 'общий', 'для', 'и', 'на', 'по', 'с', 'из', 'от', 'гб', 'gb', 'tb', 'pro', 'max', 'plus', 'mini']);

// «ВАХА» → «Ваха», «iPhone» остаётся как есть
const tidy = (w) => (w === w.toUpperCase() && /[А-ЯЁA-Z]{2}/.test(w) ? w[0] + w.slice(1).toLowerCase() : w);

const wordsOf = (text, { names = false } = {}) => String(text || '')
  .split(/[\s,.;:()«»"/\\|+]+/)
  .map(w => w.trim())
  .filter(w => WORD_RE.test(w) && !STOP.has(w.toLowerCase()) && !(names && PATRONYMIC_RE.test(w)))
  .map(tidy);

/**
 * Словарь из данных одного пользователя. Порядок важности: клиенты с
 * действующими договорами, инвесторы, счета, остальные клиенты, товары. При
 * переполнении отрезаются наименее важные. Внутри групп — по алфавиту.
 */
const buildVocabulary = ({ customers = [], sales = [], investors = [], accounts = [], products = [] }) => {
  const activeIds = new Set(sales.filter(s => s && (s.status === 'ACTIVE' || s.status === 'DRAFT')).map(s => s.customerId));
  const groups = [
    customers.filter(c => activeIds.has(c.id)).flatMap(c => wordsOf(c.name, { names: true })),
    investors.flatMap(i => wordsOf(i.name, { names: true })),
    accounts.filter(a => !a.isArchived).flatMap(a => wordsOf(a.name)),
    customers.filter(c => !activeIds.has(c.id)).flatMap(c => wordsOf(c.name, { names: true })),
    products.flatMap(p => wordsOf(p.name)),
  ];
  const seen = new Set();
  const out = [];
  for (const g of groups) {
    const fresh = [...new Set(g)].filter(w => !seen.has(w.toLowerCase())).sort((a, b) => a.localeCompare(b, 'ru'));
    for (const w of fresh) {
      if (out.length >= MAX_WORDS) return out;
      seen.add(w.toLowerCase());
      out.push(w);
    }
  }
  return out;
};

/**
 * Расшифровка подозрительно похожа на сам словарь: много слов, и почти все —
 * из него. Так бывает, когда речи нет, а модель «дописала» что-то из подсказки.
 */
const looksLikeVocabulary = (text, vocabulary) => {
  const words = String(text || '').split(/[\s,.;:!?«»"()]+/).filter(w => w.length >= 2);
  if (words.length < 8) return false;
  const set = new Set(vocabulary.map(w => w.toLowerCase()));
  return words.filter(w => set.has(w.toLowerCase())).length / words.length >= 0.7;
};

module.exports = { buildVocabulary, looksLikeVocabulary, MAX_WORDS };
