const DB_NAME = 'InstallMateDB';
const DB_VERSION = 3; // ⬆️ УВЕЛИЧЕНО для миграции: добавлены индексы
const STORES = {
  SYNC_QUEUE: 'syncQueue',
  CACHE: 'cache',
  SALES: 'sales'  // 🔹 хранилище для договоров с платежами
};

interface SyncItem {
  id: string;
  type: string;
  collection?: string;
  payload?: any;
  itemId?: string;
  timestamp: number;
  retryCount?: number;
}

interface CacheItem {
  key: string;
  data: any;
  timestamp: number;
}

// 🔹 SaleRecord удалён — используем any для совместимости с Sale из типов

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

        // 🔹 SYNC_QUEUE store + индексы
        if (!db.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
          const store = db.createObjectStore(STORES.SYNC_QUEUE, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('type', 'type', { unique: false });
          store.createIndex('collection', 'collection', { unique: false });
        }

        // 🔹 CACHE store + индекс по времени
        if (!db.objectStoreNames.contains(STORES.CACHE)) {
          const store = db.createObjectStore(STORES.CACHE, { keyPath: 'key' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // 🔹 SALES store + индексы для фильтрации
        if (!db.objectStoreNames.contains(STORES.SALES)) {
          const store = db.createObjectStore(STORES.SALES, { keyPath: 'id' });
          store.createIndex('customerId', 'customerId', { unique: false });
          store.createIndex('accountId', 'accountId', { unique: false });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };
    });
  }

  // ==================== SYNC QUEUE METHODS ====================

  async addToQueue(item: Omit<SyncItem, 'id' | 'timestamp'>): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.SYNC_QUEUE, 'readwrite');
      const store = transaction.objectStore(STORES.SYNC_QUEUE);
      const syncItem: SyncItem = {
        ...item,
        id: crypto.randomUUID(),
        timestamp: Date.now()
      };
      const request = store.add(syncItem);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getQueue(): Promise<SyncItem[]> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.SYNC_QUEUE, 'readonly');
      const store = transaction.objectStore(STORES.SYNC_QUEUE);
      const request = store.getAll();
      request.onsuccess = () => {
          const items = request.result as SyncItem[];
          items.sort((a, b) => a.timestamp - b.timestamp);
          resolve(items);
      };
      request.onerror = () => reject(request.error);
    });
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

  async updateQueueItem(item: SyncItem): Promise<void> {
    if (!item?.id) {
      throw new Error('SyncItem must have a valid "id" field');
    }
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.SYNC_QUEUE, 'readwrite');
      const store = transaction.objectStore(STORES.SYNC_QUEUE);
      const request = store.put(item);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // ==================== CACHE METHODS ====================

  async setCache(key: string, data: any): Promise<void> {
  const db = await this.dbPromise;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORES.CACHE, 'readwrite');
    const store = transaction.objectStore(STORES.CACHE);

    store.put({ key, data, timestamp: Date.now() });

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(new Error('Transaction aborted'));
  });
}

  async getCache(key: string, maxAgeMs?: number): Promise<any | null> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.CACHE, 'readonly');
      const store = transaction.objectStore(STORES.CACHE);
      const request = store.get(key);

      request.onsuccess = () => {
        const result = request.result as CacheItem | undefined;
        if (!result) {
          resolve(null);
          return;
        }

        // 🔹 Проверка срока жизни кеша (TTL)
        if (maxAgeMs && (Date.now() - result.timestamp) > maxAgeMs) {
          // Автоудаление устаревшего кеша (асинхронно, не блокируя)
          this.clearCacheItem(key).catch(err =>
            console.warn('[IndexedDB] Failed to clear expired cache:', err)
          );
          resolve(null);
          return;
        }

        resolve(result.data);
      };
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

  // 🔹 ПУБЛИЧНЫЙ метод для удаления одного элемента кеша
  async clearCacheItem(key: string): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.CACHE, 'readwrite');
      const store = transaction.objectStore(STORES.CACHE);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // 🔹 Проверка валидности кеша без получения данных
  async isCacheValid(key: string, maxAgeMs: number): Promise<boolean> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.CACHE, 'readonly');
      const store = transaction.objectStore(STORES.CACHE);
      const request = store.get(key);

      request.onsuccess = () => {
        const result = request.result as CacheItem | undefined;
        if (!result) {
          resolve(false);
          return;
        }
        const isValid = (Date.now() - result.timestamp) <= maxAgeMs;
        resolve(isValid);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // 🔹 Очистка устаревшего кеша (по всем ключам)
  async clearExpiredCache(maxAgeMs: number): Promise<number> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.CACHE, 'readwrite');
      const store = transaction.objectStore(STORES.CACHE);
      const request = store.getAll();

      request.onsuccess = () => {
        const items = request.result as CacheItem[];
        const expired = items.filter(item =>
          (Date.now() - item.timestamp) > maxAgeMs
        );

        if (expired.length === 0) {
          resolve(0);
          return;
        }

        let deleted = 0;
        expired.forEach(item => {
          const delReq = store.delete(item.key);
          delReq.onsuccess = () => {
            deleted++;
            if (deleted === expired.length) resolve(deleted);
          };
        });
      };
      request.onerror = () => reject(request.error);
    });
  }

  // ==================== SALES METHODS ====================

  async saveSale(sale: any): Promise<void> {
    if (!sale?.id) {
      throw new Error('Sale must have a valid "id" field for IndexedDB storage');
    }

    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.SALES, 'readwrite');
      const store = transaction.objectStore(STORES.SALES);

      // 🔹 Добавляем метку времени для сортировки/синхронизации
      const saleWithMeta = {
        ...sale,
        _syncedAt: sale._syncedAt || null,
        _updatedAt: Date.now()
      };

      const request = store.put(saleWithMeta);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getSale(id: string): Promise<any | null> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.SALES, 'readonly');
      const store = transaction.objectStore(STORES.SALES);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllSales(): Promise<any[]> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.SALES, 'readonly');
      const store = transaction.objectStore(STORES.SALES);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async clearSales(): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.SALES, 'readwrite');
      const store = transaction.objectStore(STORES.SALES);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // 🔹 Массовое сохранение продаж (для импорта/синхронизации)
  async saveSalesBulk(sales: any[]): Promise<void> {
    if (sales.length === 0) return;

    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.SALES, 'readwrite');
      const store = transaction.objectStore(STORES.SALES);

      let completed = 0;
      const total = sales.length;

      sales.forEach((sale, index) => {
        if (!sale?.id) {
          reject(new Error(`Sale at index ${index} missing id`));
          return;
        }
        const request = store.put({
          ...sale,
          _updatedAt: Date.now()
        });
        request.onsuccess = () => {
          completed++;
          if (completed === total) resolve();
        };
        request.onerror = () => reject(request.error);
      });

      transaction.onerror = () => reject(transaction.error);
    });
  }

  // 🔹 Получение продаж с фильтрацией по индексу
  async getSalesByIndex(indexName: string, value: any): Promise<any[]> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.SALES, 'readonly');
      const store = transaction.objectStore(STORES.SALES);

      try {
        const index = store.index(indexName);
        const request = index.getAll(value);
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      } catch (e) {
        reject(new Error(`Index "${indexName}" not found: ${e}`));
      }
    });
  }

  // 🔹 Удаление продажи по ID
  async deleteSale(id: string): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.SALES, 'readwrite');
      const store = transaction.objectStore(STORES.SALES);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // 🔹 Получение количества продаж (для пагинации/статистики)
  async getSalesCount(): Promise<number> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.SALES, 'readonly');
      const store = transaction.objectStore(STORES.SALES);
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}

export const offlineStorage = new OfflineStorage();