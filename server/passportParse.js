/**
 * Разбор российского паспорта из ответа Яндекс Vision OCR (модель «page»).
 *
 * Три источника, от надёжного к запасному:
 *  1. Машиночитаемая зона внизу страницы с фото (паспорта с 2011 г.): две
 *     строки «PNRUS…» — ФИО, дата рождения, серия и номер с контрольными
 *     цифрами. Сошлась контрольная цифра — значение точное.
 *  2. Подписи по координатам: значение справа от «Фамилия», «Имя»… в той же
 *     строке, иначе — чуть ниже. Порядок строк в ответе OCR для этого не
 *     годится: значение часто идёт раньше подписи (другая колонка).
 *  3. Для даты рождения — самая ранняя правдоподобная дата на странице, не
 *     дата выдачи.
 */

/** Строки OCR с рамками: { text, x0, y0, x1, y1, cx, cy, h } */
const ocrItems = (ann) => {
  const out = [];
  (ann.blocks || []).forEach(b => (b.lines || []).forEach(l => {
    const text = String(l.text || '').trim();
    if (!text) return;
    const v = ((l.boundingBox && l.boundingBox.vertices) || []).map(p => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }));
    if (v.length) {
      const xs = v.map(p => p.x), ys = v.map(p => p.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      out.push({ text, x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, h: Math.max(1, y1 - y0) });
    } else {
      out.push({ text, x0: 0, y0: out.length * 10, x1: 0, y1: out.length * 10 + 9, cx: 0, cy: out.length * 10 + 5, h: 9, noBox: true });
    }
  }));
  if (!out.length && ann.fullText) {
    String(ann.fullText).split('\n').map(t => t.trim()).filter(Boolean)
      .forEach((text, i) => out.push({ text, x0: 0, y0: i * 10, x1: 0, y1: i * 10 + 9, cx: 0, cy: i * 10 + 5, h: 9, noBox: true }));
  }
  return out;
};

// ───────────── Машиночитаемая зона ─────────────

/** Кириллица, похожая на латиницу, — OCR с русским языком иногда читает так */
const LOOKALIKE = { 'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'У': 'Y', 'Х': 'X' };
const mrzNormalize = (s) => String(s).toUpperCase()
  .replace(/[«‹＜]/g, '<')
  .replace(/[АВЕКМНОРСТУХ]/g, ch => LOOKALIKE[ch])
  .replace(/\s+/g, '');

/** Контрольная цифра ICAO 9303: веса 7-3-1, буквы 10…35, «<» = 0 */
const mrzCheck = (s) => {
  const w = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const v = c === '<' ? 0 : /\d/.test(c) ? Number(c) : /[A-Z]/.test(c) ? c.charCodeAt(0) - 55 : 0;
    sum += v * w[i % 3];
  }
  return String(sum % 10);
};

/** Обратная транслитерация МЗ внутреннего паспорта РФ (приказ ФМС): Ч → 3, Ш → 4, Я → 8 … */
const MRZ_RU = {
  A: 'А', B: 'Б', V: 'В', G: 'Г', D: 'Д', E: 'Е', 2: 'Ё', J: 'Ж', Z: 'З', I: 'И', Q: 'Й', K: 'К', L: 'Л', M: 'М',
  N: 'Н', O: 'О', P: 'П', R: 'Р', S: 'С', T: 'Т', U: 'У', F: 'Ф', H: 'Х', C: 'Ц', 3: 'Ч', 4: 'Ш', W: 'Щ', X: 'Ъ',
  Y: 'Ы', 9: 'Ь', 6: 'Э', 7: 'Ю', 8: 'Я', 0: 'О', 1: 'И', 5: 'С',
};
const mrzToRu = (s) => String(s).split('').map(c => MRZ_RU[c] || '').join('');

const mrzDate = (yymmdd) => {
  if (!/^\d{6}$/.test(yymmdd)) return '';
  const yy = Number(yymmdd.slice(0, 2)), mm = yymmdd.slice(2, 4), dd = yymmdd.slice(4, 6);
  const nowYY = new Date().getFullYear() % 100;
  const year = yy > nowYY ? 1900 + yy : 2000 + yy;
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return '';
  return `${dd}.${mm}.${year}`;
};

/**
 * МЗ внутреннего паспорта РФ:
 *  1: PNRUS ФАМИЛИЯ << ИМЯ < ОТЧЕСТВО <<<…
 *  2: [0..8] серия (3 цифры) + номер, [9] контр., [10..12] RUS, [13..18] дата
 *     рождения, [19] контр., [20] пол, [21..27] <<<<<<<, [28] 4-я цифра серии,
 *     [29..34] дата выдачи, [35..40] код подразделения, [42] контр. доп. поля
 */
const parseMrz = (items) => {
  const texts = items.map(i => mrzNormalize(i.text));
  const i1 = texts.findIndex(t => t.includes('PNRUS'));
  if (i1 < 0) return null;
  const line1 = texts[i1].slice(texts[i1].indexOf('PNRUS'));
  // Вторая строка — следующая из цифр, букв и «<», начинается с девяти цифр
  let line2 = '';
  for (let j = 0; j < texts.length; j++) {
    if (j === i1) continue;
    const m = texts[j].match(/\d{9}[\d<][A-Z<0-9]{20,}/);
    if (m) { line2 = m[0]; break; }
  }
  const res = { surname: '', name: '', middle: '', birthDate: '', series: '', number: '', valid: { number: false, birth: false } };

  const names = line1.slice(5).replace(/<+$/, '');
  const [sur, given = ''] = names.split(/<<+/);
  res.surname = mrzToRu(sur.replace(/</g, ''));
  const tokens = given.split('<').filter(Boolean);
  if (tokens.length >= 3) { res.name = tokens.slice(0, -1).map(mrzToRu).join('-'); res.middle = mrzToRu(tokens[tokens.length - 1]); }
  else if (tokens.length === 2) { res.name = mrzToRu(tokens[0]); res.middle = mrzToRu(tokens[1]); }
  else if (tokens.length === 1) res.name = mrzToRu(tokens[0]);

  if (line2.length >= 29) {
    const doc = line2.slice(0, 9), birth = line2.slice(13, 19);
    if (/^\d{9}$/.test(doc) && mrzCheck(doc) === line2[9] && /\d/.test(line2[28] || '')) {
      res.series = doc.slice(0, 3) + line2[28];
      res.number = doc.slice(3, 9);
      res.valid.number = true;
    }
    if (mrzCheck(birth) === line2[19]) {
      res.birthDate = mrzDate(birth);
      res.valid.birth = !!res.birthDate;
    }
  }
  return res;
};

// ───────────── Подписи по координатам ─────────────

const UPPER_WORDS = /^[А-ЯЁ][А-ЯЁ\s-]*[А-ЯЁ]$/;
const DATE = /\d{2}\.\d{2}\.\d{4}/;

/**
 * Значение поля по подписи: остаток строки после подписи; иначе строка справа
 * на той же высоте; иначе ближайшая строка ниже (до двух высот строки).
 */
const valueNear = (items, label, accept) => {
  const L = items.find(i => label.test(i.text));
  if (!L) return '';
  const rest = L.text.slice(L.text.search(label)).replace(label, '').replace(/^[\s:.]+/, '').trim();
  if (rest && accept(rest)) return rest;
  if (L.noBox) {
    const k = items.indexOf(L);
    for (const n of [items[k + 1], items[k - 1]]) if (n && accept(n.text)) return n.text;
    return '';
  }
  const sameRow = items
    .filter(i => i !== L && i.x0 >= L.x0 + (L.x1 - L.x0) * 0.5 && Math.abs(i.cy - L.cy) < Math.max(i.h, L.h) * 0.7 && accept(i.text))
    .sort((a, b) => a.x0 - b.x0);
  if (sameRow.length) return sameRow[0].text;
  const below = items
    .filter(i => i !== L && i.y0 >= L.y1 - L.h * 0.3 && i.y0 - L.y1 < L.h * 2.5 && i.x1 > L.x0 && accept(i.text))
    .sort((a, b) => a.y0 - b.y0);
  return below.length ? below[0].text : '';
};

/**
 * Место рождения: справа от подписи и строки под этим значением (бывает 2–3:
 * «С. ШАЛИ ШАЛИНСКОГО Р-НА ЧЕЧЕНСКОЙ РЕСП.»), пока не встретится другая подпись.
 */
const birthPlaceNear = (items) => {
  const L = items.find(i => /место\s*рожд/i.test(i.text));
  if (!L) return '';
  const ok = (t) => CYR3.test(t) && !/фамил|^имя|отчеств|^пол\b|дата|PNRUS|выдан|место\s*рожд/i.test(t);
  const rest = L.text.replace(/.*место\s*рожд\S*/i, '').replace(/^[\s:.]+/, '').trim();
  if (L.noBox) {
    const k = items.indexOf(L);
    return [rest, ...items.slice(k + 1, k + 4).map(i => i.text)].filter(t => t && ok(t)).slice(0, 3).join(' ');
  }
  const out = [];
  let anchor = null;
  if (rest && ok(rest)) { out.push(rest); anchor = L; }
  else {
    const first = items
      .filter(i => i !== L && i.x0 >= L.x0 + (L.x1 - L.x0) * 0.5 && Math.abs(i.cy - L.cy) < Math.max(i.h, L.h) * 0.7 && ok(i.text))
      .sort((a, b) => a.x0 - b.x0)[0]
      || items.filter(i => i !== L && i.y0 >= L.y1 - L.h * 0.3 && i.y0 - L.y1 < L.h * 2.5 && ok(i.text)).sort((a, b) => a.y0 - b.y0)[0];
    if (!first) return '';
    out.push(first.text); anchor = first;
  }
  // Продолжение — строки ниже, начинающиеся примерно там же, без разрыва больше двух строк
  let last = anchor;
  for (const i of items.filter(x => x !== L && x !== anchor && x.cy > anchor.cy).sort((a, b) => a.cy - b.cy)) {
    if (out.length >= 3) break;
    if (i.y0 - last.y1 > last.h * 2) break;
    if (!ok(i.text)) break;
    if (Math.abs(i.x0 - anchor.x0) > Math.max(60, (anchor.x1 - anchor.x0) * 0.6)) continue;
    out.push(i.text); last = i;
  }
  return out.join(' ');
};

const isName = (t) => UPPER_WORDS.test(t.trim()) && t.trim().length >= 2 && !/ФЕДЕРАЦ|РОССИЙ|ПАСПОРТ|МУЖ|ЖЕН/.test(t);

/** Самая ранняя правдоподобная дата (человеку 14+), кроме даты выдачи */
const fallbackBirthDate = (items) => {
  const issue = valueNear(items, /^дата выдачи/i, t => DATE.test(t));
  const issueDate = issue ? issue.match(DATE)[0] : '';
  const nowY = new Date().getFullYear();
  const dates = [];
  items.forEach(i => (i.text.match(/\d{2}\.\d{2}\.\d{4}/g) || []).forEach(d => {
    const [dd, mm, yy] = d.split('.').map(Number);
    if (d !== issueDate && yy > 1900 && yy <= nowY - 14 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) dates.push({ d, key: yy * 10000 + mm * 100 + dd });
  }));
  dates.sort((a, b) => a.key - b.key);
  return dates.length ? dates[0].d : '';
};

// ───────────── Прочее ─────────────

const titleCaseRu = (s) => String(s || '').toLowerCase()
  .replace(/(^|[\s-])([а-яёa-z])/g, (m, sep, ch) => sep + ch.toUpperCase());

const CYR3 = /[А-Яа-яЁё]{3,}/;
const NOT_ISSUER = /российская|федерац|паспорт\s+выдан|^\s*выдан|дата|код\s*подр|подразделен|подпись|личн|фамил|отчеств|рожд|PNRUS/i;

/**
 * «Кем выдан» по положению: всё, что напечатано между «Паспорт выдан» и «Дата
 * выдачи» (она и «Код подразделения» читаются почти всегда). Нет надписи
 * «Паспорт выдан» — берём строки прямо над «Датой выдачи». Строчные («по
 * Чеченской Республике») не отбрасываем — у части паспортов так и напечатано.
 */
const issuerByPosition = (items) => {
  // Нижняя граница — «Дата выдачи» или «Код подразделения» (что выше)
  const D = items.filter(i => !i.noBox && /дата\s*выдач|код\s*подр/i.test(i.text)).sort((a, b) => a.cy - b.cy)[0];
  if (!D) return '';
  const S = items.find(i => /в[ыь]дан/i.test(i.text) && !/дата/i.test(i.text) && i.cy < D.cy);
  // С надписи «Паспорт выдан» (включая строку справа от неё — орган часто
  // начинается в той же строке), без неё — до девяти строк над датой выдачи
  const top = S ? S.cy - S.h * 0.7 : D.cy - D.h * 9;
  const parts = [];
  const rest = S ? S.text.replace(/.*в[ыь]дан[:\s]*/i, '').trim() : '';
  if (rest && CYR3.test(rest)) parts.push(rest);
  items
    .filter(i => i !== S && i.cy > top && i.cy < D.cy - D.h * 0.5 && CYR3.test(i.text) && !NOT_ISSUER.test(i.text))
    .sort((a, b) => a.cy - b.cy || a.x0 - b.x0)
    .slice(0, 5)
    .forEach(i => parts.push(i.text));
  return parts.join(' ');
};

/** «Паспорт выдан …» — строки после надписи до даты выдачи или кода подразделения (когда нет координат) */
const passportIssuer = (lines) => {
  const start = lines.findIndex(l => /выдан/i.test(l) && !/дата/i.test(l));
  if (start < 0) return '';
  const out = [];
  const first = lines[start].replace(/.*выдан[:\s]*/i, '').trim();
  if (first) out.push(first);
  for (let i = start + 1; i < lines.length && out.length < 4; i++) {
    const l = lines[i];
    if (/\d{2}\.\d{2}\.\d{4}|дата|код|подразд|подпись|личн|фамил|^имя|отчеств|^пол\b|рожд|PNRUS/i.test(l)) break;
    if (/[А-ЯЁ]{2,}/.test(l)) out.push(l);
  }
  return out.join(' ');
};

/** Адрес со страницы «Место жительства»: строки с регионом, улицей, домом */
const passportAddress = (lines) => {
  const ADDR = /(обл|респ|край|р-н|район|г\.|город|с\.|пос|ул\.|улица|пр-т|пер\.|д\.|дом|кв\.)/i;
  return lines.filter(l => ADDR.test(l) && !/выдан|паспорт|подразд/i.test(l)).slice(0, 4).join(', ');
};

const sameWord = (a, b) => a && b && a.replace(/Ё/g, 'Е') === b.replace(/Ё/g, 'Е');

/**
 * Поля паспорта из ответа OCR. missing — что не нашлось (по ним можно
 * дозапросить шаблонную модель).
 */
const parsePassportPage = (ann) => {
  const items = ocrItems(ann);
  const lines = items.slice().sort((a, b) => (a.noBox ? 0 : a.cy - b.cy) || a.x0 - b.x0).map(i => i.text);
  const mrz = parseMrz(items);

  // ФИО: напечатанное кириллицей — по подписям; машиночитаемая зона дополняет
  // и исправляет (у неё нет ошибок шрифта, но нет и дефиса в двойном имени)
  const printed = {
    surname: valueNear(items, /^фамилия/i, isName),
    name: valueNear(items, /^имя/i, isName),
    middle: valueNear(items, /^отчество/i, isName),
  };
  const pick = (key) => {
    const p = (printed[key] || '').trim(), m = mrz ? mrz[key] : '';
    if (p && m && !sameWord(p, m)) return p.includes('-') ? p : m;
    return p || m || '';
  };
  const surname = pick('surname'), firstName = pick('name'), middle = pick('middle');

  // Серия и номер: из машиночитаемой зоны, если сошлась контрольная цифра,
  // иначе «96 15 123456» в тексте — 10 цифр (не дата и не код подразделения)
  let series = '', number = '';
  if (mrz && mrz.valid.number) { series = mrz.series; number = mrz.number; }
  else {
    const m = lines.join(' ').match(/(?:^|\D)(\d{2})\s?(\d{2})\s?(?:№\s?)?(\d{6})(?!\d)/);
    if (m) { series = m[1] + m[2]; number = m[3]; }
  }

  const labeledBirth = valueNear(items, /^дата рожд/i, t => DATE.test(t));
  const birthDate = (mrz && mrz.valid.birth && mrz.birthDate)
    || (labeledBirth && labeledBirth.match(DATE)[0])
    || fallbackBirthDate(items);

  const result = {
    name: [surname, firstName, middle].filter(Boolean).map(titleCaseRu).join(' '),
    series, number,
    issuedBy: issuerByPosition(items) || passportIssuer(lines),
    address: '',
    birthDate,
    birthPlace: birthPlaceNear(items),
  };
  // Не главный разворот (страница прописки) — полей нет, ищем адрес в тексте
  if (!result.name && !result.number) result.address = passportAddress(lines);
  return {
    result,
    missing: { surname: !surname, birthDate: !birthDate, number: !number },
    viaMrz: !!(mrz && (mrz.valid.birth || mrz.valid.number)),
  };
};

/**
 * Раскладка строк без личных данных — для журнала, когда поле не нашлось:
 * подписи паспорта остаются словами, остальные буквы → «А», цифры → «9».
 */
// Только целые слова: «ПОЛ» внутри фамилии «ПОЛЯКОВ» не должно уцелеть
const LABEL_WORDS = /(?<![A-Za-zА-Яа-яЁё])(паспорт|выдан|дата|выдачи|код|подразделения|фамилия|имя|отчество|пол|рождения|место|личный|подпись|российская|федерация)(?![A-Za-zА-Яа-яЁё])/gi;
const maskedLayout = (ann) => ocrItems(ann).map(i => {
  const masked = i.text.split(LABEL_WORDS).map((part, k) => (k % 2 ? part : part.replace(/[A-Za-zА-Яа-яЁё]/g, 'А').replace(/\d/g, '9'))).join('');
  return `${Math.round(i.x0)},${Math.round(i.y0)}-${Math.round(i.x1)},${Math.round(i.y1)} ${masked}`;
});

module.exports = { maskedLayout, parsePassportPage, parseMrz, mrzCheck, mrzToRu, titleCaseRu, ocrItems };
