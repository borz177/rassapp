/**
 * Проверки формы входа и регистрации.
 *
 * Вынесены из экрана: их легко проверить тестами, а главное — сообщения об
 * ошибках должны быть одинаковыми во всех трёх режимах (вход, регистрация,
 * смена пароля). Пока они жили внутри разметки, каждый шаг писал своё.
 */

/** Email как его примет сервер: он тоже приводит к нижнему регистру и режет пробелы */
export const normalizeEmail = (raw: string): string => (raw || '').trim().toLowerCase();

/**
 * Проверка адреса. Нарочно мягкая: строгие выражения из интернета отвергают
 * живые адреса (домены с юникодом, плюс-адресация), а настоящую проверку всё
 * равно делает письмо с кодом.
 */
export const emailError = (raw: string): string | null => {
  const email = normalizeEmail(raw);
  if (!email) return 'Введите email';
  if (/\s/.test(email)) return 'В адресе не должно быть пробелов';
  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@')) return 'Проверьте адрес: в нём должна быть одна @';
  const domain = email.slice(at + 1);
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) {
    return 'Проверьте адрес после @';
  }
  if (domain.length < 4) return 'Проверьте адрес после @';
  return null;
};

export const MIN_PASSWORD = 8;

/** Проверка нового пароля: при регистрации и при смене */
export const newPasswordError = (password: string): string | null => {
  if (!password) return 'Придумайте пароль';
  if (password.length < MIN_PASSWORD) return `Пароль короче ${MIN_PASSWORD} символов`;
  if (/^\d+$/.test(password)) return 'Только цифры — слишком просто, добавьте буквы';
  if (/^(.)\1+$/.test(password)) return 'Пароль из одного символа подобрать слишком легко';
  return null;
};

export type PasswordStrength = 'weak' | 'medium' | 'strong';

/**
 * Насколько пароль крепкий — для подсказки под полем. Не запрет, а ориентир:
 * человек вправе поставить что хочет, но должен видеть, что выбрал.
 */
export const passwordStrength = (password: string): PasswordStrength => {
  if (!password) return 'weak';
  let score = 0;
  if (password.length >= MIN_PASSWORD) score++;
  if (password.length >= 12) score++;
  if (/[a-zа-яё]/i.test(password) && /\d/.test(password)) score++;
  if (/[^\w\s]/.test(password)) score++;
  if (/^\d+$/.test(password) || /^(.)\1+$/.test(password)) return 'weak';
  if (score >= 4) return 'strong';
  if (score >= 2) return 'medium';
  return 'weak';
};

export const STRENGTH_LABEL: Record<PasswordStrength, string> = {
  weak: 'Простой пароль',
  medium: 'Нормальный пароль',
  strong: 'Надёжный пароль',
};

/** Код из письма — только цифры, ровно шесть */
export const cleanCode = (raw: string): string => (raw || '').replace(/\D/g, '').slice(0, 6);

export const codeError = (raw: string): string | null => {
  const code = cleanCode(raw);
  if (!code) return 'Введите код из письма';
  if (code.length < 6) return 'В коде шесть цифр';
  return null;
};

/**
 * Ответ сервера человеческим языком.
 *
 * «Неверные учетные данные» ничего не говорит о том, что делать дальше, а
 * «POST /auth/login failed» — тем более: такой текст долетал до экрана, когда
 * сервер отвечал без разбора. Здесь он превращается в понятную подсказку.
 */
export const humanAuthError = (raw: unknown, fallback = 'Не получилось. Попробуйте ещё раз'): string => {
  const text = String((raw as { message?: string })?.message ?? raw ?? '').trim();
  if (!text) return fallback;

  const rules: [RegExp, string][] = [
    [/неверные учетные данные|invalid credentials/i, 'Неверный email или пароль'],
    [/пользователь не найден/i, 'Аккаунта с таким email нет — зарегистрируйтесь'],
    [/уже существует/i, 'Такой email уже зарегистрирован — войдите или восстановите пароль'],
    [/неверный код/i, 'Код не подходит. Проверьте письмо или запросите новый'],
    [/код истёк|код истек|expired/i, 'Срок действия кода вышел — запросите новый'],
    [/заблокирован/i, 'Аккаунт заблокирован. Напишите в поддержку'],
    [/слишком много попыток/i, 'Слишком много попыток. Подождите 15 минут'],
    [/failed to fetch|networkerror|нет связи|timeout/i, 'Нет связи с сервером. Проверьте интернет'],
    [/^(get|post|put|delete)\s|\bfailed$/i, fallback],
    [/^\s*\d{3}\s*$/, fallback],
  ];
  for (const [pattern, message] of rules) {
    if (pattern.test(text)) return message;
  }
  return text;
};
