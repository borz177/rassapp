// offlineStorage.ts

const DB_NAME = 'InstallMateDB';
const DB_VERSION = 4; // 🔹 УВЕЛИЧИЛИ: было 3, стало 4 (добавили хранилище файлов)
const STORES = {
  SYNC_QUEUE: 'syncQueue',
  CACHE: 'cache',
  FILES: 'files'  // 🔹 Хранилище для файлов
};

interface SyncItem {
  id: string;
  type: string;
  collection?: string;
  payload?: any;
  itemId?: string;
  timestamp: number;
  retryCount?: number;
  dependsOn?: string[];
  error?: string;
  // Сервер явно и стабильно отклонил элемент (не сетевая ошибка) — дальше ретраить бессмысленно,
  // но элемент НЕ удаляется из очереди, чтобы данные не пропадали молча (см. sync() в api.ts).
  failed?: boolean;
}

interface CacheItem {
  key: string;
  data: any;
  timestamp: number;
}

// 🔹 НОВЫЙ интерфейс для кэшированных файлов
interface FileCacheItem {
  url: string;           // Ключ: temp_doc_*, /uploads/..., или URL
  blob: Blob;            // Файл как Blob
  mimeType: string;      // 'image/jpeg', 'application/pdf'
  fileName: string;      // Оригинальное имя
  fileSize: number;      // Размер в байтах
  timestamp: number;     // Время кэширования
  expiresAt?: number;    // Опционально: время истечения
  isTemp?: boolean;      // Флаг: временный файл для офлайн-загрузки
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
        // 🔹 НОВОЕ: создаём хранилище для файлов
        if (!db.objectStoreNames.contains(STORES.FILES)) {
          db.createObjectStore(STORES.FILES, { keyPath: 'url' });
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
        dependsOn: this.extractDependencies(item)
      };

      const request = store.add(syncItem);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private extractDependencies(item: Omit<SyncItem, 'id' | 'timestamp'>): string[] {
    const deps: string[] = [];
    if (item.collection === 'sales' && item.payload?.customerId) {
      deps.push(`customer_${item.payload.customerId}`);
    }
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
        const sorted = this.topologicalSort(items);
        resolve(sorted);
      };
      request.onerror = () => reject(request.error);
    });
  }

  private topologicalSort(items: SyncItem[]): SyncItem[] {
    const result: SyncItem[] = [];
    const visited = new Set<string>();

    const visit = (item: SyncItem) => {
      if (visited.has(item.id)) return;
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

  // ==================== 🔹 НОВЫЕ МЕТОДЫ ДЛЯ ФАЙЛОВ ====================

  /**
   * Сохранить файл в кэш (Blob)
   */
  async cacheFile(fileData: Omit<FileCacheItem, 'timestamp'>): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.FILES, 'readwrite');
      const store = transaction.objectStore(STORES.FILES);
      
      const item: FileCacheItem = {
        ...fileData,
        timestamp: Date.now()
      };
      
      const request = store.put(item);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Получить файл из кэша по URL/ключу
   */
  async getCachedFile(url: string): Promise<FileCacheItem | null> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.FILES, 'readonly');
      const store = transaction.objectStore(STORES.FILES);
      const request = store.get(url);
      
      request.onsuccess = () => {
        const item = request.result as FileCacheItem | undefined;
        
        // 🔹 Проверка срока жизни (если установлен)
        if (item && item.expiresAt && Date.now() > item.expiresAt) {
          this.removeCachedFile(url);
          resolve(null);
          return;
        }
        
        resolve(item || null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Удалить файл из кэша
   */
  async removeCachedFile(url: string): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.FILES, 'readwrite');
      const store = transaction.objectStore(STORES.FILES);
      const request = store.delete(url);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Очистка старых файлов (по размеру)
   */
  async cleanupFiles(maxSizeMB: number = 100): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.FILES, 'readwrite');
      const store = transaction.objectStore(STORES.FILES);
      const request = store.getAll();
      
      request.onsuccess = async () => {
        const files = request.result as FileCacheItem[];
        const totalSize = files.reduce((sum, f) => sum + f.fileSize, 0);
        const maxSizeBytes = maxSizeMB * 1024 * 1024;
        
        if (totalSize <= maxSizeBytes) {
          resolve();
          return;
        }
        
        // Сортируем по времени (старые → новые) и удаляем
        files.sort((a, b) => a.timestamp - b.timestamp);
        let currentSize = totalSize;
        
        for (const file of files) {
          if (currentSize <= maxSizeBytes) break;
          await new Promise<void>((res) => {
            const delReq = store.delete(file.url);
            delReq.onsuccess = () => {
              currentSize -= file.fileSize;
              res();
            };
            delReq.onerror = () => res();
          });
        }
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Быстрая проверка: есть ли файл в кэше
   */
  async isFileCached(url: string): Promise<boolean> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.FILES, 'readonly');
      const store = transaction.objectStore(STORES.FILES);
      const request = store.getKey(url);
      request.onsuccess = () => resolve(!!request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Сохранить временный файл для офлайн-загрузки (temp_doc_*)
   * Возвращает уникальный ID: `temp_doc_${uuid}`
   */
  async saveTempFile(file: File): Promise<string> {
    const tempId = `temp_doc_${crypto.randomUUID()}`;
    const db = await this.dbPromise;
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.FILES, 'readwrite');
      const store = transaction.objectStore(STORES.FILES);
      
      const item: FileCacheItem = {
        url: tempId,
        blob: file,
        mimeType: file.type,
        fileName: file.name,
        fileSize: file.size,
        timestamp: Date.now(),
        isTemp: true
      };
      
      const request = store.put(item);
      request.onsuccess = () => resolve(tempId);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Получить временный файл по ID
   */
  async getTempFile(tempId: string): Promise<FileCacheItem | null> {
    return this.getCachedFile(tempId);
  }

  /**
   * Удалить временный файл после успешной загрузки
   */
  async removeTempFile(tempId: string): Promise<void> {
    return this.removeCachedFile(tempId);
  }

  /**
   * Получить все отложенные файлы для синхронизации
   */
  async getPendingFiles(): Promise<FileCacheItem[]> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.FILES, 'readonly');
      const store = transaction.objectStore(STORES.FILES);
      const request = store.getAll();
      
      request.onsuccess = () => {
        const files = request.result as FileCacheItem[];
        resolve(files.filter(f => f.isTemp));
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Очистить ВСЕ временные файлы
   */
  async clearTempFiles(): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.FILES, 'readwrite');
      const store = transaction.objectStore(STORES.FILES);
      const request = store.getAll();
      
      request.onsuccess = async () => {
        const files = request.result as FileCacheItem[];
        const tempFiles = files.filter(f => f.isTemp);
        
        for (const file of tempFiles) {
          await new Promise<void>((res) => {
            const delReq = store.delete(file.url);
            delReq.onsuccess = () => res();
            delReq.onerror = () => res();
          });
        }
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }
}

export const offlineStorage = new OfflineStorage();