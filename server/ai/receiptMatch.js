const day = value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' }) : null;
};
const matchTransactions = ({ sales, customers }, transactions) => {
  if (!Array.isArray(transactions) || !transactions.length || transactions.length > 100) throw new Error('Можно проверить от 1 до 100 строк выписки.');
  const byId = new Map(customers.map(c => [c.id, c]));
  return transactions.map((t, index) => {
    const amount = Number(t.amount), date = day(t.date);
    if (!Number.isFinite(amount) || amount <= 0 || !date) return { row: index + 1, error: 'Нужны положительная сумма и дата.' };
    const name = String(t.customer || '').trim().toLocaleLowerCase('ru-RU');
    const matches = [], duplicates = [];
    for (const s of sales) {
      if (s.type !== 'INSTALLMENT' || !s.customerId || s.customerId.startsWith('system_')) continue;
      const customer = byId.get(s.customerId);
      const nameMatches = !!name && String(customer?.name || '').toLocaleLowerCase('ru-RU').includes(name);
      const base = { contractId: s.id, customer: customer?.name || 'Клиент', product: s.productName, remaining: s.remainingAmount };
      const existing = (s.paymentPlan || []).filter(p => p.isPaid && p.isRealPayment !== false && Math.abs(Number(p.amount) - amount) < 0.005 && day(p.actualDate || p.date) === date);
      if (existing.length) duplicates.push({ ...base, paymentIds: existing.map(p => p.id), nameMatches });
      if (s.status === 'ACTIVE' && (nameMatches || (!name && (s.paymentPlan || []).some(p => !p.isPaid && p.isRealPayment !== true && Math.abs(Number(p.amount) - amount) < 0.005)))) {
        matches.push({ ...base, reason: nameMatches ? 'Совпало имя плательщика' : 'Совпала сумма по графику' });
      }
    }
    return { row: index + 1, amount, date, reference: String(t.reference || '').slice(0,100),
      candidates: matches.slice(0,20), candidateCount: matches.length, possibleDuplicates: duplicates.slice(0,20), duplicateCount: duplicates.length,
      status: duplicates.length ? 'check_existing_payment' : matches.length === 1 ? 'candidate_needs_confirmation' : matches.length ? 'ambiguous' : 'not_found' };
  });
};
module.exports = { matchTransactions, day };
