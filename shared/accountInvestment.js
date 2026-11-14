// Общий расчёт личных вложений: экран счёта и агент используют одну формулу.
// Чужие/совместные средства не приписываются владельцу. Историю не изменяем.
export const SYSTEM_INCOME_CUSTOMER = 'system_income';
export const realAccountType = (account) => {
  if (!account) return 'CUSTOM';
  if ((account.poolMemberIds || []).length > 0) return 'POOL';
  if (account.ownerId) return 'INVESTOR';
  if ((account.partners || []).length > 0) return 'SHARED';
  // Ничего своего у счёта нет — это счёт самого владельца дела. 'MAIN' оставляем
  // как есть: он ещё встречается в данных и означает «основной».
  return account.type === 'INVESTOR' || account.type === 'POOL' || account.type === 'SHARED'
    ? 'CUSTOM'
    : (account.type || 'CUSTOM');

};
export const accountInvestment = (account, sales, expenses) => {
  const empty = { initial: 0, deposits: 0, invested: 0, returned: 0, left: 0 };
  if (!account) return empty;

  // 🔒 Только счёт, который целиком принадлежит владельцу дела. На счёте
  // инвестора и в пуле деньги чужие: сколько вложил инвестор, видно в его
  // карточке, а приход «Прочее» туда — пополнение его счёта, а не вложение
  // владельца. На общем счёте партнёров непонятно, чьё внесение, и приписывать
  // его себе — догадка. Считать чужие деньги своими вложениями нельзя ни в
  // одном из этих случаев.
  const kind = realAccountType(account);
  if (kind === 'INVESTOR' || kind === 'POOL' || kind === 'SHARED') return empty;

  const initial = Number(account.initialBalance) || 0;

  const deposits = sales
    .filter(s => s.accountId === account.id && s.customerId === SYSTEM_INCOME_CUSTOMER)
    .reduce((sum, s) => sum + (Number(s.downPayment) || 0), 0);

  const returned = expenses
    .filter(e => e.accountId === account.id
      && e.category === 'Моя выплата'
      && e.managerPayoutSource === 'CAPITAL'
      && e.isRefund !== true)
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  const invested = initial + deposits;
  return {
    initial, deposits, invested, returned,
    // В минус не уводим: «вернул больше, чем вложил» — это уже прибыль, и она
    // считается своим блоком. Здесь такая цифра читалась бы как долг перед делом.
    left: Math.max(0, invested - returned),
  };

};
