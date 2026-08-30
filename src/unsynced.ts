import { useSyncExternalStore } from 'react';

/**
 * Какие записи ещё не уехали на сервер.
 *
 * Отдельным маленьким хранилищем, а не пропсами: пометка нужна в списках
 * договоров, операций, журнала и каталога — то есть почти везде. Протаскивать
 * ради одной точки набор идентификаторов через десяток компонентов значит
 * загромоздить их подписи ради того, что к их работе не относится.
 *
 * Наполняется из очереди синхронизации в App.
 */
let ids: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};

/** Обновляет набор. Ссылку меняем всегда — по ней подписчики и понимают, что пора перерисоваться. */
export const setUnsyncedIds = (next: Iterable<string>): void => {
  const set = new Set(next);
  // Сравниваем содержимое: очередь опрашивается по таймеру, и без этого каждый
  // опрос перерисовывал бы все списки приложения впустую.
  if (set.size === ids.size && [...set].every(id => ids.has(id))) return;
  ids = set;
  listeners.forEach(fn => fn());
};

export const getUnsyncedIds = (): ReadonlySet<string> => ids;

/** true, пока эта запись существует только на устройстве. */
export const useIsUnsynced = (id?: string): boolean =>
  useSyncExternalStore(
    subscribe,
    () => (id ? ids.has(id) : false),
    () => false
  );
