export const formatCurrency = (amount: number | undefined | null, showCents: boolean = true): string => {
  if (amount === undefined || amount === null || isNaN(amount)) {
    return '0';
  }
  return amount.toLocaleString('ru-RU', {
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  });
};

export const formatDate = (dateString: string | undefined | null): string => {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ru-RU');
};
