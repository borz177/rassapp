// Модель для образцов договоров: разметка полей и проверка оформления по PDF.
// Нужна точность (цитаты из бланка буква в букву, роли абзацев, чтение PDF):
// Claude Sonnet 5.5 на «триколор рассрочка.docx» разметил все поля и дал
// понятные предупреждения; Gemini 4 Argon пропустил почти все поля.
// Переопределяется AI_TEMPLATE_MODEL в /var/www/env/rassapp.env.
const templateModel = () =>
  process.env.AI_TEMPLATE_MODEL || "anthropic/claude-sonnet-5.5";
// Попыток распознавания и исправления в сутки на владельца. 0 — без лимита
// (локальная проверка: CONTRACT_TEMPLATE_DAILY_LIMIT=0 в server/.env; на
// проде переменной нет — действует 5)
const dailyLimit = () => {
  const v = process.env.CONTRACT_TEMPLATE_DAILY_LIMIT;
  const n = v === undefined || v === "" ? 5 : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 5;
};
const UNLIMITED = 1e9;
module.exports = { templateModel, dailyLimit, UNLIMITED };
