export const WATCHLIST_POLICY_VERSION = '2026-11-14-v4';
// Допущенные владельцы видят раздел по ответу сервера. Общий вход
// для подачи новых заявок можно включить отдельно.
export const WATCHLIST_USER_UI_ENABLED = false;
export const watchlistUiVisible = (user?: { role?: string } | null, status?: WatchlistStatus | null): boolean =>
  user?.role === 'admin' || (user?.role === 'manager' && (WATCHLIST_USER_UI_ENABLED ||
    !!(status?.enabled && status.access?.status === 'granted' && (status.access.canSearch || status.access.canSubmit))));
export const WATCHLIST_STATUS: Record<string, string> = {
  pending: 'На проверке', needs_info: 'Нужны сведения', published: 'Опубликовано', hidden: 'Скрыто на проверку',
  rejected: 'Отклонено', withdrawn: 'Отозвано', terminated: 'Публикация прекращена', expired: 'Срок истёк',
  requested: 'Ожидает решения', granted: 'Доступ открыт', revoked: 'Доступ отозван',
  deleted: 'Удалено администратором',
};
export const WATCHLIST_REASONS: Record<string, string> = { overdue: 'Длительная просрочка', unfulfilled: 'Неисполнение обязательств', other: 'Другая причина' };
export const WATCHLIST_BASES: Record<string, string> = { subject_consent: 'Отдельное согласие клиента', other_lawful_basis: 'Иное законное основание' };
export interface WatchlistStatus {
  adminAccess?: boolean; adminOnly?: boolean;
  policyVersion: string; accepted: boolean; enabled: boolean; searchPaused: boolean; submissionsPaused: boolean; autoPublish?: boolean;
  access: null | { status: string; canSearch: boolean; canSubmit: boolean };
}
export interface WatchlistEntry {
  id: string; customerId: string; name: string; birthYear: number | null; reason?: string; reasonDetails?: string; response?: string; basis?: string;
  evidence?: string; note?: string; decision?: string; publicationMode?: 'auto' | 'manual'; status: string; version: number; createdAt: string; expiresAt?: string | null;
}
export interface WatchlistMatch { id: string; name: string; birthYear: number | null; reason?: string | null; reasonDetails?: string }
export interface WatchlistPage<T> { items: T[]; hasMore: boolean }
export const watchlistDate = (v?: string) => v ? new Date(v).toLocaleDateString('ru-RU') : '—';

/** Поиск по своим клиентам: те же правила регистра/пробелов/ё, что у общего поиска. */
export const watchlistSearchText = (value: string): string =>
  value.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/** Автопоиск не отправляет фамилию, инициалы, телефон или незаконченный год. */
export const watchlistSearchQuery = (name: string, year = ''): { name: string; birthYear: number | null } | null => {
  const normalized = watchlistSearchText(name);
  const parts = normalized.split(' ');
  if (normalized.length < 5 || normalized.length > 200 || parts.length < 2 ||
    !/^[\p{L}\p{M} .’'\-]+$/u.test(normalized) || parts.some(p => (p.match(/\p{L}/gu) || []).length < 2)) return null;
  if (year && (!/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > new Date().getUTCFullYear())) return null;
  return { name: normalized, birthYear: year ? Number(year) : null };
};

export const watchlistCanSearch = (status?: WatchlistStatus | null): boolean => !!(status?.enabled && status.accepted &&
  status.access?.status === 'granted' && status.access.canSearch && !status.searchPaused);

export const watchlistCanSubmit = (status?: WatchlistStatus | null): boolean => !!(status?.enabled && status.accepted &&
  status.access?.status === 'granted' && status.access.canSubmit && !status.submissionsPaused);

export interface WatchlistPreview { customerId: string; name: string; birthYear: number | null; fingerprint: string }
