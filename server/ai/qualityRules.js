// Сравнение без модели. Похожие старые предложения только помечаются;
// их статусы и решения администратора не изменяются.
const key = text => String(text || '').normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/[^а-яa-z0-9_]+/g,' ').trim();
const tokens = text => new Set(key(text).split(' ').filter(w => w.length > 3 && !['если','когда','всегда','никогда','только','соответствующий'].includes(w)).map(w => w.replace(/(?:ировать|ировании|ением|ении|ение|ений|ыми|ого|его|ать|ять|ай|ый|ой|ая|ые|ие|ом|ам|ов|ит|ет|а|я|ы|и|е|у|ю)$/,'')));
const actionToolRule = text => /не\s+(?:сообщ|объяв|говор|пиш)/.test(text) && /выполн|готов|сделан/.test(text) && /инструмент/.test(text) && /не (?:был )?вызван|без (?:его )?вызова/.test(text);
const similar = (a,b) => {
  if (key(a) === key(b)) return true;
  const negative = text => /(?:^| )(?:не|никогда)(?: |$)/.test(key(text));
  if (negative(a) !== negative(b)) return false;
  if (actionToolRule(key(a)) && actionToolRule(key(b))) return true;
  const x=tokens(a),y=tokens(b),common=[...x].filter(t=>y.has(t)).length;
  return common >= 4 && common / (x.size + y.size - common) >= 0.65;
};
const markDuplicates = lessons => lessons.map(l => ({ ...l, similarTo: l.status === 'proposed'
  ? lessons.find(other => other.id !== l.id && (other.status === 'active' || (other.status === 'proposed' && Number(other.id) < Number(l.id))) && similar(l.rule,other.rule))?.id || null : null }));
module.exports = { key, similar, markDuplicates };
