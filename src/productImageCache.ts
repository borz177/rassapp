/**
 * Фото товаров без интернета.
 *
 * Фото хранятся на сервере (/uploads/products/…) и у каждого своё неизменное имя:
 * новая картинка получает новое имя, старая не переписывается. Поэтому один раз
 * сохранённый файл верен навсегда, и его можно брать из кеша, не спрашивая сеть.
 *
 * Сохраняет их service worker (правило в vite.config.ts, кеш с тем же именем).
 * Но он кладёт в кеш только то, что уже открывали: товар, которого не видели при
 * сети, без неё остался бы без фото. Поэтому, пока сеть есть, фото всего каталога
 * докачиваются в кеш заранее — фоном, по три за раз.
 */

/** Имя кеша. Совпадает с правилом runtimeCaching в vite.config.ts */
export const PRODUCT_IMAGE_CACHE = 'product-images-v1';

/** Сколько фото докачивать за один проход: защита от огромного каталога на слабой сети */
const MAX_PER_RUN = 600;

type WithImages = { images?: string[]; isArchived?: boolean };

/** Адреса фото товаров, которые имеет смысл держать в кеше */
export const productImageUrls = (products: WithImages[]): string[] => {
  const urls = new Set<string>();
  for (const p of products) {
    // Архивные товары не продают и не ищут — их фото место в кеше не занимают
    if (p.isArchived) continue;
    for (const src of p.images || []) {
      if (typeof src !== 'string') continue;
      // Только файлы с нашего сервера: base64 и чужие ссылки кешировать незачем
      if (src.startsWith('/uploads/products/')) urls.add(src);
      else if (typeof location !== 'undefined' && src.startsWith(`${location.origin}/uploads/products/`)) urls.add(src);
    }
  }
  return [...urls];
};

/** Сеть есть и не жалко трафика: на экономии и 2G фоном ничего не качаем */
const networkAllows = (): boolean => {
  if (typeof navigator === 'undefined' || !navigator.onLine) return false;
  const conn = (navigator as any).connection;
  if (conn?.saveData) return false;
  if (typeof conn?.effectiveType === 'string' && conn.effectiveType.includes('2g')) return false;
  return true;
};

const done = new Set<string>();
let running = false;
let queued: WithImages[] | null = null;

/**
 * Докачать в кеш фото, которых там ещё нет.
 *
 * Если страница под service worker'ом, файл просто запрашивается: правило
 * CacheFirst само кладёт его в кеш и следит за сроком хранения. Без воркера
 * (первый заход, пока он не активировался) кладём в кеш сами.
 */
export const warmProductImages = async (products: WithImages[]): Promise<number> => {
  if (typeof window === 'undefined' || !('caches' in window) || !networkAllows()) return 0;
  if (running) { queued = products; return 0; }
  running = true;
  let fetched = 0;
  try {
    const cache = await caches.open(PRODUCT_IMAGE_CACHE);
    const todo: string[] = [];
    for (const url of productImageUrls(products)) {
      if (done.has(url)) continue;
      if (await cache.match(url)) { done.add(url); continue; }
      todo.push(url);
      if (todo.length >= MAX_PER_RUN) break;
    }

    const underWorker = !!navigator.serviceWorker?.controller;
    let next = 0;
    const worker = async () => {
      while (next < todo.length && networkAllows()) {
        const url = todo[next++];
        try {
          const res = await fetch(url, { credentials: 'same-origin' });
          if (!res.ok) continue;
          if (!underWorker) await cache.put(url, res.clone());
          // Тело дочитываем: иначе запрос считается незавершённым и воркер не
          // сохранит ответ в кеш
          await res.blob();
          done.add(url);
          fetched++;
        } catch {
          // Сеть пропала посреди прохода — остальное докачаем, когда вернётся
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  } finally {
    running = false;
  }

  // Каталог успел измениться, пока шёл проход, — пройдём ещё раз по свежему
  if (queued) {
    const again = queued;
    queued = null;
    fetched += await warmProductImages(again);
  }
  return fetched;
};
