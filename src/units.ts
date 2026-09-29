/**
 * Единицы измерения товара — общий справочник.
 *
 * Раньше единицу вписывали руками в пустое поле, и на боевой базе это видно:
 * рядом со «шт» стоят «5 комплект», «6 комплект», «1», «2». Человеку нужно было
 * сказать «комплект из пяти», а места для этого не было — он написал всё в одну
 * строку. После такого «5 комплект» не годится ни для подписи под числом, ни
 * для поиска, ни для этикетки.
 *
 * Поэтому единицу выбирают из списка, а вложение («сколько внутри») стало
 * отдельным полем — оно появляется только там, где имеет смысл: у упаковки,
 * коробки, ящика, комплекта.
 *
 * Вложение справочное: остатки как считались в выбранной единице, так и
 * считаются. Коробка на складе — это одна коробка, а не двенадцать штук.
 */

export type UnitGroup = 'count' | 'pack' | 'weight' | 'volume' | 'length' | 'area' | 'service';

export interface UnitDef {
  /** Как пишется рядом с числом: «5 кор». Оно же хранится в Product.unit */
  id: string;
  /** Полное название для списка выбора */
  name: string;
  group: UnitGroup;
  /** У упаковочных спрашиваем, сколько внутри */
  pack?: boolean;
  /** Дробное количество осмысленно: 1,5 кг бывает, полторы штуки — нет */
  fractional?: boolean;
}

export const GROUP_TITLES: Record<UnitGroup, string> = {
  count: 'Поштучно',
  pack: 'Упаковками',
  weight: 'Вес',
  volume: 'Объём',
  length: 'Длина и площадь',
  area: 'Длина и площадь',
  service: 'Работы и услуги',
};

/** Порядок групп в списке — от самого частого к редкому */
export const GROUP_ORDER: UnitGroup[] = ['count', 'pack', 'weight', 'volume', 'length', 'service'];

export const UNITS: UnitDef[] = [
  { id: 'шт', name: 'Штука', group: 'count' },
  { id: 'пар', name: 'Пара', group: 'count' },

  { id: 'упак', name: 'Упаковка', group: 'pack', pack: true },
  { id: 'кор', name: 'Коробка', group: 'pack', pack: true },
  { id: 'ящик', name: 'Ящик', group: 'pack', pack: true },
  { id: 'компл', name: 'Комплект', group: 'pack', pack: true },
  { id: 'набор', name: 'Набор', group: 'pack', pack: true },
  { id: 'блок', name: 'Блок', group: 'pack', pack: true },
  { id: 'мешок', name: 'Мешок', group: 'pack', pack: true },
  { id: 'рулон', name: 'Рулон', group: 'pack', pack: true },
  { id: 'палета', name: 'Палета', group: 'pack', pack: true },

  { id: 'г', name: 'Грамм', group: 'weight', fractional: true },
  { id: 'кг', name: 'Килограмм', group: 'weight', fractional: true },
  { id: 'т', name: 'Тонна', group: 'weight', fractional: true },

  { id: 'мл', name: 'Миллилитр', group: 'volume', fractional: true },
  { id: 'л', name: 'Литр', group: 'volume', fractional: true },
  { id: 'м³', name: 'Кубический метр', group: 'volume', fractional: true },

  { id: 'мм', name: 'Миллиметр', group: 'length', fractional: true },
  { id: 'см', name: 'Сантиметр', group: 'length', fractional: true },
  { id: 'м', name: 'Метр', group: 'length', fractional: true },
  { id: 'м.п.', name: 'Погонный метр', group: 'length', fractional: true },
  { id: 'м²', name: 'Квадратный метр', group: 'area', fractional: true },

  { id: 'усл', name: 'Услуга', group: 'service' },
  { id: 'час', name: 'Час', group: 'service', fractional: true },
];

export const DEFAULT_UNIT = 'шт';

/** Что может лежать внутри упаковки: поштучно, по весу или по объёму */
export const CONTENT_UNITS = UNITS.filter(u => u.group === 'count' || u.group === 'weight' || u.group === 'volume');

const byId = new Map(UNITS.map(u => [u.id.toLowerCase(), u]));
const byName = new Map(UNITS.map(u => [u.name.toLowerCase(), u]));

/**
 * Определение единицы. Понимает и полное название («Коробка»), потому что
 * в старых карточках встречается и оно.
 */
export const findUnit = (raw?: string | null): UnitDef | undefined => {
  const key = (raw || '').trim().toLowerCase();
  if (!key) return undefined;
  return byId.get(key) || byName.get(key);
};

/** Единица товара с подстановкой штук по умолчанию */
export const unitOf = (unit?: string | null): string => (unit || '').trim() || DEFAULT_UNIT;

/** Спрашивать ли «сколько внутри». Своя единица вложения не имеет. */
export const isPackUnit = (unit?: string | null): boolean => !!findUnit(unit)?.pack;

/** Можно ли вводить дробное количество. Незнакомую единицу считаем штучной. */
export const allowsFraction = (unit?: string | null): boolean => !!findUnit(unit)?.fractional;

/** Единица есть в справочнике — значит выбрана из списка, а не вписана руками */
export const isKnownUnit = (unit?: string | null): boolean => !!findUnit(unit);

export interface PackInfo {
  unit?: string;
  packSize?: number;
  packUnit?: string;
}

/**
 * «по 12 шт» — подпись вложения. Пусто, когда вложение не указано или
 * единица не упаковочная: обещать содержимое коробки, которого никто не
 * вводил, нельзя.
 */
export const packLabel = (p: PackInfo): string => {
  if (!isPackUnit(p.unit) || !p.packSize || p.packSize <= 0) return '';
  return `по ${formatNumber(p.packSize)} ${unitOf(p.packUnit)}`;
};

/**
 * Количество с единицей, а для упаковок — ещё и сколько это всего:
 * «5 кор (60 шт)». Второе число появляется, только если вложение указано.
 */
export const formatQuantity = (qty: number, p: PackInfo): string => {
  const base = `${formatNumber(qty)} ${unitOf(p.unit)}`;
  const inside = packTotal(qty, p);
  if (inside === null) return base;
  return `${base} (${formatNumber(inside)} ${unitOf(p.packUnit)})`;
};

/** Сколько всего содержимого в таком количестве упаковок. null — неизвестно. */
export const packTotal = (qty: number, p: PackInfo): number | null => {
  if (!isPackUnit(p.unit) || !p.packSize || p.packSize <= 0) return null;
  return qty * p.packSize;
};

const formatNumber = (n: number): string => {
  if (!Number.isFinite(n)) return '0';
  // Дробное показываем без хвоста нулей: 1,5 кг, но 2 шт, а не 2,0 шт
  return Number(n.toFixed(3)).toLocaleString('ru-RU');
};

/**
 * Разбор того, что люди успели вписать в поле единицы руками.
 *
 * На боевой базе лежит «5 комплект», «1 комплект», «6 комплект» — единица и
 * вложение в одной строке, потому что отдельного поля не было. Возвращаем
 * разобранное, чтобы форма показала «Комплект» и «по 5 шт» вместо строки,
 * которую никуда нельзя подставить. Данные при этом не переписываются молча:
 * разбор виден человеку, и сохраняет его он сам.
 */
export const parseLegacyUnit = (raw?: string | null): { unit: string; packSize?: number } => {
  const text = (raw || '').trim();
  if (!text) return { unit: DEFAULT_UNIT };

  // Уже нормальная единица — ничего не трогаем
  const exact = findUnit(text);
  if (exact) return { unit: exact.id };

  // «5 комплект», «комплект 5», «12шт»
  const match = text.match(/^(\d+(?:[.,]\d+)?)\s*(.+)$/) || text.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)$/);
  if (match) {
    const [, a, b] = match;
    const numberFirst = /^\d/.test(a);
    const amount = Number((numberFirst ? a : b).replace(',', '.'));
    const word = (numberFirst ? b : a).trim();
    const def = findUnit(word);
    if (def) {
      // «12 шт» — это не упаковка, а просто количество в подписи: единицу
      // берём, число отбрасываем, иначе у штуки появится вложение. Ноль и
      // мусор вместо числа тоже отбрасываем — единица при этом не теряется.
      const usable = def.pack && Number.isFinite(amount) && amount > 0;
      return usable ? { unit: def.id, packSize: amount } : { unit: def.id };
    }
  }

  // Просто число («1», «2») — единицы там нет вовсе
  if (/^\d+(?:[.,]\d+)?$/.test(text)) return { unit: DEFAULT_UNIT };

  // Что-то своё («пар», «рулон бумаги») — оставляем как есть
  return { unit: text };
};
