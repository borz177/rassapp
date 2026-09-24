// Проверка тела запроса публичного API.
//
// Внешних библиотек в server/ нет, и заводить их ради этого незачем: правил
// немного, а выгода большая — маршрут больше не раскладывает чужой объект
// целиком (`{...req.body}`), в базу попадают только описанные поля, и клиент
// получает внятный список ошибок вместо «Missing required fields».
//
// Незнакомые поля считаются ошибкой намеренно: опечатка `amout` вместо `amount`
// иначе молча потерялась бы, и человек искал бы пропавшие деньги.

const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);

// YYYY-MM-DD или полный ISO. Обе формы в базе уже встречаются.
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

const checkers = {
  string: (v, rule, field, errs) => {
    if (typeof v !== 'string') return errs.push({ field, code: 'type', message: 'ожидалась строка' });
    const s = rule.trim === false ? v : v.trim();
    if (rule.maxLength && s.length > rule.maxLength) {
      errs.push({ field, code: 'too_long', message: `не длиннее ${rule.maxLength} символов` });
    }
    if (rule.minLength && s.length < rule.minLength) {
      errs.push({ field, code: 'too_short', message: `не короче ${rule.minLength} символов` });
    }
    if (rule.pattern && !rule.pattern.test(s)) {
      errs.push({ field, code: 'pattern', message: rule.patternHint || 'неподходящий формат' });
    }
    return s;
  },
  number: (v, rule, field, errs) => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      return errs.push({ field, code: 'type', message: 'ожидалось число' });
    }
    if (rule.min !== undefined && n < rule.min) errs.push({ field, code: 'min', message: `не меньше ${rule.min}` });
    if (rule.max !== undefined && n > rule.max) errs.push({ field, code: 'max', message: `не больше ${rule.max}` });
    return n;
  },
  // Деньги: число, не отрицательное, не больше миллиарда и с двумя знаками после
  // запятой. Копейки округляем сразу, чтобы 0.1+0.2 не расползались по базе.
  money: (v, rule, field, errs) => {
    const n = checkers.number(v, { min: rule.min === undefined ? 0 : rule.min, max: rule.max === undefined ? 1e12 : rule.max }, field, errs);
    return typeof n === 'number' ? Math.round(n * 100) / 100 : n;
  },
  int: (v, rule, field, errs) => {
    const n = checkers.number(v, rule, field, errs);
    if (typeof n === 'number' && !Number.isInteger(n)) {
      errs.push({ field, code: 'type', message: 'ожидалось целое число' });
    }
    return n;
  },
  bool: (v, rule, field, errs) => {
    if (typeof v === 'boolean') return v;
    if (v === 'true') return true;
    if (v === 'false') return false;
    return errs.push({ field, code: 'type', message: 'ожидалось true или false' });
  },
  date: (v, rule, field, errs) => {
    if (typeof v !== 'string' || !DATE_RE.test(v) || isNaN(new Date(v))) {
      return errs.push({ field, code: 'type', message: 'дата в формате YYYY-MM-DD или полный ISO' });
    }
    return v;
  },
  enum: (v, rule, field, errs) => {
    if (!rule.values.includes(v)) {
      return errs.push({ field, code: 'enum', message: `допустимо: ${rule.values.join(', ')}` });
    }
    return v;
  },
  array: (v, rule, field, errs) => {
    if (!Array.isArray(v)) return errs.push({ field, code: 'type', message: 'ожидался список' });
    if (rule.maxItems && v.length > rule.maxItems) {
      errs.push({ field, code: 'too_many', message: `не больше ${rule.maxItems} элементов` });
    }
    if (!rule.of) return v;
    return v.map((item, i) => {
      const sub = [];
      const val = validate(item, rule.of, { path: `${field}[${i}]` });
      sub.push(...val.errors);
      errs.push(...sub);
      return val.value;
    });
  },
};

/**
 * @param input  тело запроса
 * @param schema { поле: { type, required, default, ... } }
 * @param opts   partial — разрешить отсутствие обязательных полей (для PATCH)
 * @returns { ok, value, errors: [{field, code, message}] }
 */
const validate = (input, schema, { partial = false, path = '' } = {}) => {
  const errors = [];
  if (!isPlainObject(input)) {
    return { ok: false, value: {}, errors: [{ field: path || 'body', code: 'type', message: 'ожидался объект JSON' }] };
  }

  const known = new Set(Object.keys(schema));
  for (const key of Object.keys(input)) {
    if (!known.has(key)) {
      errors.push({ field: path ? `${path}.${key}` : key, code: 'unknown_field', message: 'неизвестное поле' });
    }
  }

  const value = {};
  for (const [key, rule] of Object.entries(schema)) {
    const field = path ? `${path}.${key}` : key;
    const raw = input[key];
    const missing = raw === undefined || raw === null || raw === '';

    if (missing) {
      if (rule.required && !partial) {
        errors.push({ field, code: 'required', message: 'обязательное поле' });
      } else if (rule.default !== undefined && !partial) {
        value[key] = typeof rule.default === 'function' ? rule.default() : rule.default;
      }
      continue;
    }

    const checker = checkers[rule.type];
    if (!checker) throw new Error(`validate: неизвестный тип правила ${rule.type}`);
    const before = errors.length;
    const parsed = checker(raw, rule, field, errors);
    if (errors.length === before) value[key] = parsed;
  }

  return { ok: errors.length === 0, value, errors };
};

module.exports = { validate };
