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


// Добавьте эту функцию внутри компонента или вынесите в utils
const normalizePhoneForWhatsApp = (phone: string): string => {
  // Удаляем все нецифровые символы
  let cleaned = phone.replace(/[^0-9]/g, '');

  // Если номер начинается с 8 (российский формат), заменяем на 7
  if (cleaned.startsWith('8') && cleaned.length === 11) {
    cleaned = '7' + cleaned.slice(1);
  }

  // Если номер начинается с +7 (уже с плюсом, но мы удалили его), убеждаемся что первая цифра 7
  if (cleaned.startsWith('7') && cleaned.length === 11) {
    return cleaned;
  }

  // Если номер короче или длиннее 11 цифр — возвращаем как есть (возможно, международный)
  return cleaned;
};