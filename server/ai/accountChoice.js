// Счёт, выбранный моделью, должен быть назван человеком, когда счетов несколько.
const normalize = s => String(s || '').toLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}_]+/gu,' ').trim();
const needsAccountChoice = (accounts, accountId, text, history = []) => {
  if (accounts.length <= 1) return false;
  const chosen = accounts.find(a => a.id === accountId);
  if (!chosen) return true;
  const messages = [text, ...history.filter(m => m.role === 'user').slice(-1).map(m => m.text || m.content || '')];
  return !messages.some(raw => {
    const said = normalize(raw), name = normalize(chosen.name);
    if (String(raw).includes(`[${chosen.id}]`) || String(raw).includes(`Идентификатор счёта: ${chosen.id}`)) return true;
    if (name && (` ${said} `).includes(` ${name} `)) return true;
    return chosen.type === 'MAIN' && /основн[а-я]*\s+(счет|касс)|(?:с|из|на)\s+основн[а-я]*/.test(said);
  });
};
module.exports = { needsAccountChoice };
