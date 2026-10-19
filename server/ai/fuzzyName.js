// Похожие имена — когда голосовое исказило ФИО или название, а точного
// совпадения нет: «Гагоев Хасаин» → «Гагаев Хасайн».
//
// Слова сравниваем по «скелету»: ошибки распознавания речи — это чаще всего
// безударные гласные (а/о, е/и/я), звонкие и глухие согласные (д/т, з/с, г/к),
// й/и, мягкий знак и двойные буквы. Скелет их сглаживает, а остаток
// различий меряем расстоянием Левенштейна.

const VOWELS = { а: 'а', о: 'а', е: 'и', ё: 'и', э: 'и', и: 'и', ы: 'и', я: 'и', й: 'и', у: 'у', ю: 'у' };
const VOICED = { б: 'п', в: 'ф', г: 'к', д: 'т', з: 'с', ж: 'ш' };

const skeleton = (word) => {
  const w = String(word || '').toLowerCase().replace(/[ьъ]/g, '').replace(/[^а-яёa-z0-9]/g, '');
  let out = '';
  for (const ch of w) {
    const c = VOWELS[ch] || VOICED[ch] || ch;
    if (out[out.length - 1] !== c) out += c; // «Хассан» = «Хасан»
  }
  return out;
};

const levenshtein = (a, b) => {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
};

// Похожесть двух слов 0..1. Окончание падежа («Гагаеву») — не ошибка: если одно
// слово — начало другого и разница не больше трёх букв, считаем почти совпадением
const wordSim = (a, b) => {
  const x = skeleton(a), y = skeleton(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  if (s.length >= 3 && l.startsWith(s) && l.length - s.length <= 3) return 0.92;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
};

// Слово запроса, не похожее ни на одно слово имени, — значит, это другой человек
// («Ризван Мусаев» ≠ «Мусаев Ясин»), а не ошибка распознавания
const MIN_WORD = 0.6;

/**
 * Насколько имя похоже на запрос: каждое слово запроса — с самым похожим словом
 * имени, итог — среднее; хоть одно слово непохоже — 0. Слова короче двух букв не считаем.
 */
const nameSim = (query, name) => {
  const q = String(query || '').split(/\s+/).filter(w => w.replace(/[^а-яёa-z]/gi, '').length >= 2);
  const n = String(name || '').split(/\s+/).filter(Boolean);
  if (!q.length || !n.length) return 0;
  const best = q.map(w => Math.max(...n.map(x => wordSim(w, x))));
  return best.some(b => b < MIN_WORD) ? 0 : best.reduce((a, b) => a + b, 0) / best.length;
};

/** До limit самых похожих: [{ item, score }] по убыванию, не ниже min */
const similar = (query, items, nameOf = (x) => x.name, { limit = 3, min = 0.72 } = {}) =>
  items.map(item => ({ item, score: nameSim(query, nameOf(item)) }))
    .filter(x => x.score >= min && x.score < 1.0001)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

module.exports = { skeleton, wordSim, nameSim, similar };
