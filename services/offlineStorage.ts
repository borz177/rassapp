const DB_NAME = 'InstallMateDB';
const DB_VERSION = 2; // ⬆️ УВЕЛИЧЬТЕ ВЕРСИЮ для миграции!
const STORES = {
  SYNC_QUEUE: 'syncQueue',
  CACHE: 'cache',
  SALES: 'sales'  // 🔹 НОВОЕ: хранилище для договоров с платежами
};

interface SyncItem {
  id: string;
  type: string;
  collection?: string;
  payload?: any;
  itemId?: string;
  timestamp: number;
  retryCount?: number
}

interface CacheItem {
  key: string;
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
        // 🔹 НОВОЕ: создаём хранилище для продаж
        if (!db.objectStoreNames.contains(STORES.SALES)) {
          db.createObjectStore(STORES.SALES, { keyPath: 'id' });
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

  // 🔹 🔹 🔹 НОВЫЕ МЕТОДЫ для сохранения продаж в IndexedDB 🔹 🔹 🔹
  
  async saveSale(sale: any): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.SALES, 'readwrite');
      const store = transaction.objectStore(STORES.SALES);
      const request = store.put(sale);
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
}

export const offlineStorage = new OfflineStorage();