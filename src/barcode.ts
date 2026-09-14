import type { Product } from '../types';

/**
 * Штрихкоды товаров: сравнение, контрольные цифры, внутренние коды и отрисовка.
 *
 * Логика отдельно от экранов намеренно: одно и то же «чей это код» спрашивают
 * каталог, приход, касса и выбор товара в договоре. Разойдись правила хоть в
 * одном месте — касса не нашла бы товар, который склад только что принял.
 */

/**
 * Код в том виде, в каком его сравниваем. Сканеры добавляют к коду перевод
 * строки или табуляцию, при ручном вводе попадают пробелы — ни то ни другое
 * частью кода не является.
 */
export const normalizeBarcode = (raw: unknown): string =>
  String(raw ?? '').replace(/[\s\u0000-\u001f\u007f]+/g, '');

const DIGITS = /^\d+$/;

/** Контрольная цифра GTIN (EAN-8, UPC-A, EAN-13, GTIN-14) по телу кода без неё. */
export const gtinCheckDigit = (body: string): number => {
  let sum = 0;
  // Вес 3 у цифры, стоящей вплотную к контрольной, дальше через одну.
  for (let i = body.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += Number(body[i]) * weight;
  }
  return (10 - (sum % 10)) % 10;
};

export const isValidGtin = (code: string): boolean =>
  DIGITS.test(code)
  && [8, 12, 13, 14].includes(code.length)
  && gtinCheckDigit(code.slice(0, -1)) === Number(code[code.length - 1]);

/**
 * Варианты записи одного кода. UPC-A из 12 цифр и EAN-13 с ведущим нулём —
 * один и тот же товар: камера телефона отдаёт то одно, то другое в зависимости
 * от системы, и без этого товар, заведённый с iPhone, не находился бы на Android.
 */
export const codeKeys = (raw: unknown): string[] => {
  const code = normalizeBarcode(raw).toUpperCase();
  if (!code) return [];
  if (DIGITS.test(code)) {
    if (code.length === 12) return [code, `0${code}`];
    if (code.length === 13 && code.startsWith('0')) return [code, code.slice(1)];
  }
  return [code];
};

const matchesKeys = (raw: unknown, keys: Set<string>) => codeKeys(raw).some(k => keys.has(k));

export const productCodes = (p: Product): string[] =>
  (p.barcodes || []).map(normalizeBarcode).filter(Boolean);

export interface CodeMatch {
  product: Product;
  /** Нашли по штрихкоду или по артикулу — второе бывает у товаров, заведённых до штрихкодов */
  via: 'barcode' | 'sku';
}

/**
 * Товар по отсканированному коду.
 *
 * Сначала штрихкоды, потом артикул: до появления отдельного поля штрихкод
 * вписывали в «Артикул», и такие товары должны находиться без переделки.
 * Товары в работе идут раньше архивных — у архивного и живого товара мог
 * остаться один код, и касса должна пробить живой.
 */
export const findProductByCode = (products: Product[], raw: unknown): CodeMatch | null => {
  const keys = new Set(codeKeys(raw));
  if (keys.size === 0) return null;
  const ordered = [...products.filter(p => !p.isArchived), ...products.filter(p => p.isArchived)];
  const byBarcode = ordered.find(p => (p.barcodes || []).some(b => matchesKeys(b, keys)));
  if (byBarcode) return { product: byBarcode, via: 'barcode' };
  const bySku = ordered.find(p => p.sku && matchesKeys(p.sku, keys));
  return bySku ? { product: bySku, via: 'sku' } : null;
};

/** Другой товар, у которого уже есть этот код. Один код на два товара — касса не поймёт, что пробивать. */
export const barcodeOwner = (products: Product[], raw: unknown, selfId?: string): Product | null => {
  const keys = new Set(codeKeys(raw));
  if (keys.size === 0) return null;
  return products.find(p => p.id !== selfId && (
    (p.barcodes || []).some(b => matchesKeys(b, keys)) || (!!p.sku && matchesKeys(p.sku, keys))
  )) || null;
};

/** Поиск в списках: название, артикул и штрихкод, в том числе по части кода. */
export const productMatchesQuery = (p: Product, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)) return true;
  const code = normalizeBarcode(q).toLowerCase();
  return !!code && (p.barcodes || []).some(b => normalizeBarcode(b).toLowerCase().includes(code));
};

/**
 * Префикс внутренних кодов. Диапазон 200–299 GS1 отдаёт под внутреннее
 * использование магазинов: производители в нём коды не выпускают, и
 * сгенерированный код не совпадёт с заводским штрихкодом на упаковке.
 */
export const INTERNAL_PREFIX = '2000';

/**
 * Новые внутренние EAN-13 — по порядку после самого большого из уже выданных.
 * По порядку, а не случайно: номер на этикетке тогда сам говорит, что товар
 * заведён позже, а два кода подряд не спутать с опечаткой.
 */
export const generateInternalBarcodes = (products: Product[], count = 1): string[] => {
  const taken = new Set<string>();
  let max = 0;
  products.forEach(p => [...(p.barcodes || []), p.sku || ''].forEach(raw => {
    const code = normalizeBarcode(raw);
    if (!code) return;
    taken.add(code);
    if (code.length === 13 && code.startsWith(INTERNAL_PREFIX) && isValidGtin(code)) {
      max = Math.max(max, Number(code.slice(INTERNAL_PREFIX.length, 12)));
    }
  }));

  const result: string[] = [];
  for (let n = max + 1; result.length < count; n++) {
    const body = INTERNAL_PREFIX + String(n).padStart(12 - INTERNAL_PREFIX.length, '0');
    const code = body + gtinCheckDigit(body);
    if (!taken.has(code)) { taken.add(code); result.push(code); }
  }
  return result;
};

// ───────────────────────── Отрисовка ─────────────────────────

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
/** Первая цифра EAN-13 не рисуется сама — она задаёт чередование наборов L и G в левой половине. */
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

const encodeEan13 = (code: string): string => {
  const parity = EAN_PARITY[Number(code[0])];
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === 'L' ? EAN_L : EAN_G)[Number(code[i])];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += EAN_R[Number(code[i])];
  return `${bits}101`;
};

const encodeEan8 = (code: string): string => {
  let bits = '101';
  for (let i = 0; i < 4; i++) bits += EAN_L[Number(code[i])];
  bits += '01010';
  for (let i = 4; i < 8; i++) bits += EAN_R[Number(code[i])];
  return `${bits}101`;
};

/** Ширины штрихов и пробелов Code 128 для значений 0–105 (106 — стоп, у него семь элементов). */
const CODE128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232',
];
const CODE128_STOP = '2331112';
const CODE128_START_B = 104;
const CODE128_START_C = 105;

const widthsToBits = (widths: string): string =>
  widths.split('').map((w, i) => (i % 2 === 0 ? '1' : '0').repeat(Number(w))).join('');

/**
 * Code 128 для кодов, которые не EAN: артикулы с буквами, коды поставщиков.
 * Чисто цифровой код чётной длины пишем набором C — парами цифр, штрих выходит
 * вдвое короче и помещается на маленькую этикетку.
 */
const encodeCode128 = (text: string): string | null => {
  const values: number[] = [];
  if (DIGITS.test(text) && text.length >= 4 && text.length % 2 === 0) {
    values.push(CODE128_START_C);
    for (let i = 0; i < text.length; i += 2) values.push(Number(text.slice(i, i + 2)));
  } else {
    for (const ch of text) {
      const c = ch.charCodeAt(0);
      if (c < 32 || c > 126) return null;
    }
    values.push(CODE128_START_B);
    for (const ch of text) values.push(ch.charCodeAt(0) - 32);
  }
  let sum = values[0];
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  values.push(sum % 103);
  return values.map(v => widthsToBits(CODE128[v])).join('') + widthsToBits(CODE128_STOP);
};

export type BarcodeKind = 'EAN13' | 'EAN8' | 'CODE128';

/** Код в виде модулей: '1' — штрих, '0' — пробел. null — такой код нарисовать нельзя. */
export const encodeBarcode = (raw: unknown): { kind: BarcodeKind; bits: string; text: string } | null => {
  const code = normalizeBarcode(raw);
  if (!code) return null;
  if (isValidGtin(code)) {
    if (code.length === 13) return { kind: 'EAN13', bits: encodeEan13(code), text: code };
    if (code.length === 12) return { kind: 'EAN13', bits: encodeEan13(`0${code}`), text: code };
    if (code.length === 8) return { kind: 'EAN8', bits: encodeEan8(code), text: code };
  }
  const bits = encodeCode128(code);
  return bits ? { kind: 'CODE128', bits, text: code } : null;
};

/**
 * Код для этикетки: первый штрихкод, а если его нет — артикул, если его можно
 * нарисовать. Пусто — печатать нечего, код нужно сперва создать.
 */
export const labelCode = (p: Product): string => {
  const first = productCodes(p)[0];
  if (first) return first;
  const sku = normalizeBarcode(p.sku);
  return sku && encodeBarcode(sku) ? sku : '';
};

/**
 * SVG штрихкода. Ширина задаётся в модулях, а растягивает её место на этикетке:
 * соседние штрихи склеиваем в один прямоугольник, иначе на печати между ними
 * проступали бы волосяные белые щели.
 */
export const barcodeSvg = (raw: unknown, { height = 50, quiet = 12 } = {}): string | null => {
  const encoded = encodeBarcode(raw);
  if (!encoded) return null;
  const { bits } = encoded;
  const total = bits.length + quiet * 2;
  let rects = '';
  for (let i = 0; i < bits.length;) {
    if (bits[i] !== '1') { i++; continue; }
    let j = i;
    while (j < bits.length && bits[j] === '1') j++;
    rects += `<rect x="${i + quiet}" y="0" width="${j - i}" height="${height}"/>`;
    i = j;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" preserveAspectRatio="none" shape-rendering="crispEdges"><rect width="${total}" height="${height}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
};

export const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>
  )[ch]);
