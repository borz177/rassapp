/**
 * Причины ухода — опрос «Почему не продлеваете?» на плашке истёкшей подписки
 * (SubscriptionExpiryBanner) и разбор ответов в админке (AdminRetention).
 * Ключи совпадают с CHURN_REASONS в server/index.js.
 */
export const CHURN_REASON_LABELS: Record<string, string> = {
  price: 'Дорого',
  not_understood: 'Не разобрался',
  missing_feature: 'Не хватает функции',
  other_app: 'Перешёл в другую программу',
  no_business: 'Нет клиентов / закрыл дело',
  temporary: 'Временно не нужно',
  bugs: 'Ошибки, что-то не работало',
  other: 'Другое',
};
