export const formatCurrency = (amount: number, showCents: boolean = true): string => {
  return amount.toLocaleString('ru-RU', {
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  });
};
