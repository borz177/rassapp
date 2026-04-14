
const DB_NAME = 'InstallMateDB';
const DB_VERSION = 3;
const STORES = {
  SYNC_QUEUE: 'syncQueue',
  CACHE: 'cache'
};

interface SyncItem {
  id: string; // Unique ID for the queue item
  type: string; // 'saveItem', 'deleteItem', etc.
  collection?: string; // 'sales', 'customers', etc.
  payload?: any; // The data being saved
  itemId?: string; // ID of the item being deleted
  timestamp: number;
  retryCount?: number;
  dependsOn?: string[]; // 🔹 IDs других элементов очереди, которые должны выполниться ПЕРЕД этим
  error?: string; //
}

interface CacheItem {
  key: string; // URL or key
  data: any;
  timestamp: number;
}

class OfflineStorage {
  private dbPromise: Promise<IDBDatabase>;

  constructor() {
    this.dbPromise = this.openDB();
  }

  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
          db.createObjectStore(STORES.SYNC_QUEUE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.CACHE)) {
          db.createObjectStore(STORES.CACHE, { keyPath: 'key' });
        }
      };
    });
  }

 async addToQueue(item: Omit<SyncItem, 'id' | 'timestamp'>): Promise<void> {
  const db = await this.dbPromise;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORES.SYNC_QUEUE, 'readwrite');
    const store = transaction.objectStore(STORES.SYNC_QUEUE);

    const syncItem: SyncItem = {
      ...item,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      retryCount: 0,
      // 🔹 Автоматически определяем зависимости
      dependsOn: this.extractDependencies(item)
    };

    const request = store.add(syncItem);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// 🔹 Вспомогательный метод для извлечения зависимостей
private extractDependencies(item: Omit<SyncItem, 'id' | 'timestamp'>): string[] {
  const deps: string[] = [];

  // Если это платёж/продажа — ищем в payload customerId
  if (item.collection === 'sales' && item.payload?.customerId) {
    // Проверяем, есть ли в очереди операция создания этого клиента
    // Это упрощённая логика — в реальном приложении нужно проверять IndexedDB
    deps.push(`customer_${item.payload.customerId}`);
  }

  // Аналогично для других зависимостей (accountId, investorId, etc.)
  if (item.collection === 'sales' && item.payload?.accountId) {
    deps.push(`account_${item.payload.accountId}`);
  }

  return deps;
}

async getQueue(): Promise<SyncItem[]> {
  const db = await this.dbPromise;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORES.SYNC_QUEUE, 'readonly');
    const store = transaction.objectStore(STORES.SYNC_QUEUE);
    const request = store.getAll();

    request.onsuccess = () => {
      const items = request.result as SyncItem[];

      // 🔹 Топологическая сортировка: сначала элементы без зависимостей
      const sorted = this.topologicalSort(items);
      resolve(sorted);
    };
    request.onerror = () => reject(request.error);
  });
}

// 🔹 Простая топологическая сортировка для очереди
private topologicalSort(items: SyncItem[]): SyncItem[] {
  const result: SyncItem[] = [];
  const visited = new Set<string>();
  const itemMap = new Map(items.map(i => [i.id, i]));

  const visit = (item: SyncItem) => {
    if (visited.has(item.id)) return;

    // Сначала обрабатываем зависимости
    if (item.dependsOn?.length) {
      for (const depId of item.dependsOn) {
        const dep = items.find(i => i.id === depId || i.payload?.id === depId.replace(/^customer_/, ''));
        if (dep && !visited.has(dep.id)) {
          visit(dep);
        }
      }
    }

    visited.add(item.id);
    result.push(item);
  };

  // Сортируем по времени, но с учётом зависимостей
  items.sort((a, b) => a.timestamp - b.timestamp).forEach(visit);

  return result;
}

  async removeFromQueue(id: string): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.SYNC_QUEUE, 'readwrite');
      const store = transaction.objectStore(STORES.SYNC_QUEUE);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }


  async updateQueueItem(item: any): Promise<void> {
  const db = await this.dbPromise;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORES.SYNC_QUEUE, 'readwrite');
    const store = transaction.objectStore(STORES.SYNC_QUEUE);

    const request = store.put(item);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
  async setCache(key: string, data: any): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.CACHE, 'readwrite');
      const store = transaction.objectStore(STORES.CACHE);
      const request = store.put({ key, data, timestamp: Date.now() });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getCache(key: string): Promise<any | null> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.CACHE, 'readonly');
      const store = transaction.objectStore(STORES.CACHE);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result ? request.result.data : null);
      request.onerror = () => reject(request.error);
    });
  }

  async clearCache(): Promise<void> {
      const db = await this.dbPromise;
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORES.CACHE, 'readwrite');
          const store = transaction.objectStore(STORES.CACHE);
          const request = store.clear();
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
      });
  }
}

export const offlineStorage = new OfflineStorage();
