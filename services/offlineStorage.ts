
const DB_NAME = 'InstallMateDB';
const DB_VERSION = 1;
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
          // Sort by timestamp to ensure order
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
