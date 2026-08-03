// Общая нормализация телефонов для Green API.
// Используется и автоматической рассылкой (whatsapp-reminders.js), и ручной (index.js) —
// раньше у каждой была своя копия, и они расходились в обработке нероссийских номеров.

// Приводит номер к виду, который ждёт Green API (цифры без '+').
// Возвращает { phone, reason }: phone === null, если номер непригоден.
function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') return { phone: null, reason: 'пусто' };

  let d = raw.replace(/\D/g, '');
  if (!d) return { phone: null, reason: 'нет цифр' };

  // Префикс международного набора «00» вместо «+»
  if (d.startsWith('00')) d = d.slice(2);

  // Российский мобильный без кода страны: 9XXXXXXXXX
  if (d.length === 10 && d.startsWith('9')) return { phone: '7' + d, reason: null };

  // 89XXXXXXXXX → 79XXXXXXXXX. Только для мобильных: '80...' — это уже не Россия,
  // и замена восьмёрки на семёрку сделала бы из него несуществующий номер.
  if (d.length === 11 && d.startsWith('89')) return { phone: '7' + d.slice(1), reason: null };

  if (d.length === 11 && d.startsWith('7')) return { phone: d, reason: null };

  // Прочие страны (375…, 380…, 998…) и десятизначные с иным началом —
  // отдаём как есть, пусть Green API рассудит.
  if (d.length === 10) return { phone: '7' + d, reason: null };
  if (d.length >= 11 && d.length <= 15) return { phone: d, reason: null };

  return { phone: null, reason: `${d.length} цифр — номер неполный` };
}

module.exports = { normalizePhone };
