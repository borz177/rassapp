import { User, Sale, Customer, Product, Expense, Account, Investor, Partnership, SubscriptionPlan, AppSettings, WhatsAppSettings } from "../types";
import { offlineStorage } from "./offlineStorage";

// Helper to determine the API URL dynamically
const getBaseUrl = () => {
    const { hostname, protocol } = window.location;

    // Локальная разработка
    if (hostname === 'localhost' || hostname.startsWith('192.168.')) {
        return `${protocol}//${hostname === 'localhost' ? '127.0.0.1' : hostname}:5000/api`;
    }

    // Продакшен: используем тот же домен и протокол, без порта
    return '/api';
};

const API_URL = getBaseUrl();

const getAuthHeader = () => {
    const token = localStorage.getItem('token');
    return token ? { 'x-auth-token': token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
};

let isSyncing = false;


const fetchWithAuth = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const baseHeaders = getAuthHeader();
  const optionHeaders = options.headers;

  let mergedHeaders: Record<string, string> = { ...baseHeaders };

  if (optionHeaders) {
    if (optionHeaders instanceof Headers) {
      optionHeaders.forEach((value, key) => {
        mergedHeaders[key] = value;
      });
    } else if (Array.isArray(optionHeaders)) {
      optionHeaders.forEach(([key, value]) => {
        mergedHeaders[key] = value;
      });
    } else if (typeof optionHeaders === 'object') {
      mergedHeaders = { ...mergedHeaders, ...optionHeaders as Record<string, string> };
    }
  }

  const res = await fetch(url, {
    ...options,
    headers: mergedHeaders
  });

// Внутри блока обработки 401:
if (res.status === 401) {
  console.warn('🔒 Auth error detected:', res.status, res.url);

  let errorMessage = '';
  try {
    const errorData = await res.clone().json();
    errorMessage = errorData?.msg || errorData?.message || '';
  } catch (e) {}

  // 🔥 Чистим токены СРАЗУ
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('refreshToken');

  // 🔥 Показываем уведомление
  if (typeof window !== 'undefined' && (window as any).showNotification) {
    (window as any).showNotification(
      '⏳ Сессия истекла',
      errorMessage || 'Войдите в систему снова',
      'warning'
    );

    // Редиректим сразу после уведомления
    if (!window.location.pathname.includes('/login')) {
      setTimeout(() => {
        window.location.replace('/login?expired=1');
      }, 300);
    }

    throw new Error('TOKEN_EXPIRED');
  }

  // 🔥 ПОКАЗЫВАЕМ КРАСИВУЮ МОДАЛКУ ВМЕСТО confirm()
  if (typeof window !== 'undefined') {
    // Сохраняем сообщение в state (через window, так как fetchWithAuth вне компонента)
    (window as any).__sessionExpiredData = {
      message: errorMessage || 'Сессия истекла',
      show: true
    };

    // 🔥 Создаём Promise, который резолвится после выбора пользователя
    return new Promise((resolve, reject) => {
      // Сохраняем колбэки в window для доступа из модалки
      (window as any).__sessionExpiredHandlers = {
        onConfirm: () => {
          (window as any).__sessionExpiredData.show = false;
          setTimeout(() => {
            window.location.replace('/login?expired=1');
          }, 200);
          resolve(new Response(JSON.stringify({ redirected: true })));
        },

      };

      // 🔥 Триггерим обновление состояния в App.tsx
      if ((window as any).__onSessionExpired) {
        (window as any).__onSessionExpired(
          errorMessage || 'Сессия истекла',
          (window as any).__sessionExpiredHandlers.onConfirm,
          (window as any).__sessionExpiredHandlers.onCancel
        );
      }
    });
  }

  throw new Error('TOKEN_EXPIRED');
}

return res;
};

export const api = {
    // Sync Logic
    sync: async (): Promise<{ success: boolean; syncedCollections: Set<string> }> => {
        if (!navigator.onLine || isSyncing) return { success: false, syncedCollections: new Set() };
        isSyncing = true;
        const syncedCollections = new Set<string>();

        try {
            const queue = await offlineStorage.getQueue();
            if (queue.length === 0) return { success: true, syncedCollections };

            // 🔹 Встроенная логика обработки одного элемента
            const processItem = async (item: any): Promise<boolean> => {
              try {
                let res: Response;
                if (item.type === 'saveItem') {
                  // 🔥 ИСПОЛЬЗУЕМ fetchWithAuth
                  res = await fetchWithAuth(`${API_URL}/data/${item.collection}`, {
                    method: 'POST',
                    body: JSON.stringify(item.payload)
                  });
                } else if (item.type === 'deleteItem') {
                  // 🔥 ИСПОЛЬЗУЕМ fetchWithAuth
                  res = await fetchWithAuth(`${API_URL}/data/${item.collection}/${item.itemId}`, {
                    method: 'DELETE'
                  });
                } else {
                  return false;
                }

                if (res.ok) {
                  await offlineStorage.removeFromQueue(item.id);
                  if (item.collection) syncedCollections.add(item.collection);
                  return true;
                } else {
                  const errorText = await res.text().catch(() => '');
                  console.error(`❌ Sync failed for ${item.collection}/${item.payload?.id || item.itemId}:`,
                    res.status, errorText);

                  item.retryCount = (item.retryCount || 0) + 1;
                  if (item.retryCount > 5) {
                    console.error(`❌ Dropping item ${item.id} after ${item.retryCount} retries`);
                    await offlineStorage.removeFromQueue(item.id);
                  } else {
                    await offlineStorage.updateQueueItem(item);
                  }
                  return false;
                }
              } catch (error) {
                // Если ошибка "токен истёк" — пробрасываем, чтобы сработал редирект
                if (error instanceof Error && error.message === 'TOKEN_EXPIRED') {
                  throw error;
                }
                console.error(`Failed to sync item ${item.id}`, error);
                item.retryCount = (item.retryCount || 0) + 1;
                if (item.retryCount <= 5) {
                  await offlineStorage.updateQueueItem(item);
                } else {
                  await offlineStorage.removeFromQueue(item.id);
                }
                return false;
              }
            };

            // 🔹 Двухпроходная синхронизация
            const baseCollections = ['customers', 'accounts', 'investors', 'products'];

            // 1. Базовые сущности (SAVE)
            for (const item of queue) {
                if (item.type === 'saveItem' && baseCollections.includes(item.collection!)) {
                    await processItem(item);
                }
            }
            // 1. Базовые сущности (DELETE)
            for (const item of queue) {
                if (item.type === 'deleteItem' && baseCollections.includes(item.collection!)) {
                    await processItem(item);
                }
            }

            // 2. Зависимые сущности (SAVE)
            for (const item of queue) {
                if (item.type === 'saveItem' && !baseCollections.includes(item.collection!)) {
                    await processItem(item);
                }
            }
            // 2. Зависимые сущности (DELETE)
            for (const item of queue) {
                if (item.type === 'deleteItem' && !baseCollections.includes(item.collection!)) {
                    await processItem(item);
                }
            }

            return { success: true, syncedCollections };

        } catch (error) {
            console.error('Sync error:', error);
            return { success: false, syncedCollections };
        } finally {
            isSyncing = false;
        }
    },

    // Auth (ПУБЛИЧНЫЕ — обычный fetch)
    sendCode: async (email: string, type: 'REGISTER' | 'RESET'): Promise<void> => {
        const res = await fetch(`${API_URL}/auth/send-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, type })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.msg || 'Ошибка отправки кода');
    },

    register: async (userData: any): Promise<any> => {
        try {
            const res = await fetch(`${API_URL}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userData)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.msg || 'Ошибка регистрации');

            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            await offlineStorage.setCache('user_me', data.user);

            return data.user;
        } catch (error: any) {
            console.error("API Register Error:", error);
            if (error.message === 'Failed to fetch') {
                throw new Error('Нет соединения с сервером. Убедитесь, что бэкенд запущен.');
            }
            throw error;
        }
    },

    resetPassword: async (resetData: any): Promise<void> => {
        const res = await fetch(`${API_URL}/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(resetData)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.msg || 'Ошибка смены пароля');
    },

    login: async (creds: any): Promise<any> => {
        try {
            const res = await fetch(`${API_URL}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(creds)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.msg || 'Ошибка входа');

            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            await offlineStorage.setCache('user_me', data.user);

            return data.user;
        } catch (error: any) {
            console.error("API Login Error:", error);
            if (error.message === 'Failed to fetch') {
                throw new Error('Нет соединения с сервером. Убедитесь, что бэкенд запущен.');
            }
            throw error;
        }
    },

    // 🔥 ЗАЩИЩЁННЫЕ МЕТОДЫ (используют fetchWithAuth)
    getMe: async (): Promise<User> => {
        try {
            // 🔥 fetchWithAuth сам добавит токен и обработает 401
            const res = await fetchWithAuth(`${API_URL}/auth/me`);
            if (!res.ok) throw new Error('Failed to fetch user');
            const user = await res.json();
            await offlineStorage.setCache('user_me', user);
            return user;
        } catch (error: any) {
            // Если токен истёк — fetchWithAuth уже сделал редирект, просто пробуем кэш
            if (error.message === 'TOKEN_EXPIRED') {
                const cachedUser = await offlineStorage.getCache('user_me');
                if (cachedUser) return cachedUser;
            }
            const cachedUser = await offlineStorage.getCache('user_me');
            if (cachedUser) return cachedUser;
            throw error;
        }
    },

    createSubUser: async (userData: any): Promise<any> => {
        const res = await fetchWithAuth(`${API_URL}/users/manage`, {
            method: 'POST',
            body: JSON.stringify({ action: 'create', userData })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.msg || 'Ошибка создания пользователя');
        return data;
    },

    updateSubscription: async (plan: SubscriptionPlan, months: number): Promise<any> => {
        const res = await fetchWithAuth(`${API_URL}/user/subscription`, {
            method: 'POST',
            body: JSON.stringify({ plan, months })
        });
        const data = await res.json();
        if (!res.ok) throw new Error('Failed to update subscription');
        return data.subscription;
    },

    saveWhatsAppSettings: async (settings: WhatsAppSettings): Promise<void> => {
        const res = await fetchWithAuth(`${API_URL}/user/whatsapp`, {
            method: 'POST',
            body: JSON.stringify(settings)
        });
        if (!res.ok) throw new Error('Failed to save WhatsApp settings');
    },

    createPayment: async (paymentData: { amount: number, description: string, returnUrl: string, plan: SubscriptionPlan, months: number }): Promise<any> => {
        const res = await fetchWithAuth(`${API_URL}/payment/create`, {
            method: 'POST',
            body: JSON.stringify(paymentData)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.msg || 'Ошибка создания платежа');
        return data;
    },

    // Data Sync
    fetchAllData: async (): Promise<{
        customers: Customer[], products: Product[], sales: Sale[],
        expenses: Expense[], accounts: Account[], investors: Investor[],
        partnerships: Partnership[], employees: User[], settings?: AppSettings
    }> => {
        let data: any = null;
        try {
            // 🔥 fetchWithAuth сам обработает 401 — ручная проверка удалена
            const res = await fetchWithAuth(`${API_URL}/data`);
            if (!res.ok) throw new Error('Failed to fetch data');
            
            data = await res.json();
            await offlineStorage.setCache('all_data', data);
        } catch (error: any) {
            // Если токен истёк — fetchWithAuth уже сделал редирект
            if (error.message === 'TOKEN_EXPIRED') {
                const cachedData = await offlineStorage.getCache('all_data');
                if (cachedData) return cachedData;
                throw error;
            }
            
            console.error("Fetch Data Error:", error);
            const cachedData = await offlineStorage.getCache('all_data');
            if (cachedData) {
                data = cachedData;
            } else {
                throw error;
            }
        }

        // Apply pending offline changes to the data
        if (data) {
            try {
                const queue = await offlineStorage.getQueue();
                for (const item of queue) {
                    if (!item.collection || !data[item.collection]) continue;

                    if (item.type === 'saveItem') {
                        if (Array.isArray(data[item.collection])) {
                            const list = data[item.collection] as any[];
                            let idx = list.findIndex(i => i.id === item.payload.id);

                            if (idx === -1 && item.collection === 'investors' && item.payload.email) {
                                idx = list.findIndex(i => i.email === item.payload.email);
                                if (idx >= 0) {
                                    list[idx] = { ...list[idx], ...item.payload, id: item.payload.id };
                                    continue;
                                }
                            }

                            if (idx >= 0) {
                                list[idx] = item.payload;
                            } else {
                                const isDuplicate = item.collection === 'investors' &&
                                    item.payload.email &&
                                    list.some(i => i.email === item.payload.email);
                                if (!isDuplicate) {
                                    list.unshift(item.payload);
                                }
                            }
                        } else {
                            data[item.collection] = { ...data[item.collection], ...item.payload };
                        }
                    }
                }
            } catch (e) {
                console.error("Error applying offline queue to data", e);
            }
        }

        return data;
    },

    // CRUD
    saveItem: async (type: string, item: any, options?: { skipLimitCheck?: boolean; sales?: Sale[] }): Promise<any> => {
      console.log(`💾 Saving ${type}:`, { id: item.id });

      try {
        // 🔥 fetchWithAuth сам добавит заголовки
        const res = await fetchWithAuth(`${API_URL}/data/${type}`, {
          method: 'POST',
          body: JSON.stringify(item)
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));

          if (res.status === 403 && (errorData.details?.limit || errorData.msg?.includes('лимит'))) {
            const limitError: any = new Error('LIMIT_EXCEEDED');
            limitError.isLimitError = true;
            limitError.message = errorData.msg || 'Превышен лимит договоров';
            limitError.details = errorData.details;
            limitError.hint = errorData.hint;
            throw limitError;
          }

          throw new Error(errorData.msg || errorData.error || `Failed to save ${type}`);
        }

        const savedItem = await res.json();
        console.log(`✅ Saved ${type}: ${item.id}`);
        return savedItem;

      } catch (error: any) {
        // 🔥 Если токен истёк — пробрасываем, fetchWithAuth уже сделал редирект
        if (error.message === 'TOKEN_EXPIRED') {
          throw error;
        }

        console.warn("⚠️ Save error:", error);

        const isLimitError = error.isLimitError === true;
        const isNetworkError =
          error.message?.includes('Failed to fetch') ||
          !navigator.onLine ||
          (error.name === 'TypeError' && error.message?.includes('fetch'));

        if (isNetworkError && type === 'sales' && item.status !== 'DELETED') {
          try {
            const userStr = localStorage.getItem('user');
            if (userStr) {
              const user = JSON.parse(userStr);
              const LIMITS: Record<string, { contracts: number }> = {
                TRIAL: { contracts: 10 },
                START: { contracts: 100 },
                STANDARD: { contracts: 500 },
                BUSINESS: { contracts: -1 }
              };

              const limit = LIMITS[user.subscription?.plan]?.contracts ?? 0;

              if (user.role !== 'admin' && limit !== -1) {
                const salesData = options?.sales ||
                  (await offlineStorage.getCache('all_data'))?.sales || [];

                const currentCount = salesData.filter((s: any) =>
                  s.status === 'ACTIVE' || s.status === 'DRAFT'
                ).length;

                if (currentCount >= limit) {
                  const limitError: any = new Error('LIMIT_EXCEEDED_OFFLINE');
                  limitError.isLimitError = true;
                  limitError.message = `Превышен лимит договоров для тарифа "${user.subscription?.plan}". Максимум: ${limit}. У вас сейчас: ${currentCount}.`;
                  limitError.details = { current: currentCount, limit };
                  limitError.hint = 'В офлайн-режиме тоже действует лимит!';
                  throw limitError;
                }
              }
            }
          } catch (limitErr) {
            console.warn('⚠️ Limit check in offline mode failed:', limitErr);
          }
        }

        if (isNetworkError && !isLimitError) {
          console.log("📦 Queuing for offline sync (network error)");
          await offlineStorage.addToQueue({
            type: 'saveItem',
            collection: type,
            payload: item
          });
          return item;
        }

        console.error("❌ Validation/limit error (not queued):", error.message || error);
        throw error;
      }
    },

    deleteItem: async (type: string, id: string) => {
        try {
            // 🔥 fetchWithAuth
            await fetchWithAuth(`${API_URL}/data/${type}/${id}`, {
                method: 'DELETE'
            });
        } catch (error: any) {
            // Если токен истёк — не кешируем удаление
            if (error.message === 'TOKEN_EXPIRED') {
                throw error;
            }
            console.warn("Offline mode: queuing delete", error);
            await offlineStorage.addToQueue({
                type: 'deleteItem',
                collection: type,
                itemId: id
            });
        }
    },

    resetAccountData: async () => {
        const res = await fetchWithAuth(`${API_URL}/user/data`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error('Failed to reset account');
    },

    updateUser: async (user: User) => {
      try {
        const res = await fetchWithAuth(`${API_URL}/users/manage`, {
          method: 'POST',
          body: JSON.stringify({ action: 'update', userData: user })
        });
        if (!res.ok) throw new Error('Failed to update user');
        return res.json();
      } catch (error: any) {
        if (error.message === 'TOKEN_EXPIRED') throw error;
        console.warn("Offline mode: updateUser not queued (users managed separately)");
        return { success: true, user };
      }
    },

    deleteUser: async (userId: string) => {
        await fetchWithAuth(`${API_URL}/users/manage`, {
            method: 'POST',
            body: JSON.stringify({ action: 'delete', userData: { id: userId } })
        });
    },

    updateProfile: async (userId: string, profileData: { name?: string; phone?: string; email?: string }): Promise<User> => {
        const res = await fetchWithAuth(`${API_URL}/users/manage`, {
            method: 'POST',
            body: JSON.stringify({
                action: 'update',
                userData: {
                    id: userId,
                    ...profileData
                }
            })
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Server error ${res.status}: ${errorText}`);
        }

        const data = await res.json();

        if (data.user) {
            await offlineStorage.setCache('user_me', data.user);
            return data.user;
        }

        try {
            const updatedUser = await api.getMe();
            await offlineStorage.setCache('user_me', updatedUser);
            return updatedUser;
        } catch (error) {
            console.warn('⚠️ Failed to fetch fresh user, using local merge as last resort');
            const currentUser = await offlineStorage.getCache('user_me');
            const updatedUser: User = {
                ...(currentUser || {}),
                id: userId,
                ...profileData
            } as User;

            await offlineStorage.setCache('user_me', updatedUser);
            return updatedUser;
        }
    },

    changePassword: async (currentPassword: string, newPassword: string): Promise<{ success: true }> => {
        const res = await fetchWithAuth(`${API_URL}/auth/change-password`, {
            method: 'POST',
            body: JSON.stringify({ currentPassword, newPassword })
        });

        if (!res.ok) {
            const error = await res.json();
            if (res.status === 400 && error.code === 'WRONG_CURRENT_PASSWORD') {
                throw new Error('Неверный текущий пароль');
            }
            if (res.status === 400 && error.code === 'WEAK_PASSWORD') {
                throw new Error('Новый пароль слишком простой');
            }
            throw new Error(error.msg || error.error || 'Не удалось сменить пароль');
        }

        return { success: true };
    },

    // --- INTEGRATIONS ---
    createWhatsAppInstance: async (phoneNumber: string): Promise<{ idInstance: string, apiTokenInstance: string }> => {
        try {
            const res = await fetchWithAuth(`${API_URL}/integrations/whatsapp/create`, {
                method: 'POST',
                body: JSON.stringify({ phoneNumber })
            });

            const contentType = res.headers.get("content-type");
            if (contentType && contentType.indexOf("application/json") !== -1) {
                const data = await res.json();
                if (!res.ok) throw new Error(data.msg || data.details || 'Ошибка создания инстанса');
                return data;
            } else {
                const text = await res.text();
                console.error("Non-JSON response from server:", text);
                throw new Error(`Server returned non-JSON error: ${res.status} ${res.statusText}`);
            }
        } catch (error: any) {
            console.error("Create WhatsApp Instance Error:", error);
            throw error;
        }
    },

    // --- ADMIN METHODS ---
    adminGetUsers: async (): Promise<User[]> => {
        const res = await fetchWithAuth(`${API_URL}/admin/users`);
        if (!res.ok) throw new Error('Failed to fetch users');
        return res.json();
    },

    adminSetSubscription: async (userId: string, plan: SubscriptionPlan, months: number): Promise<any> => {
        const res = await fetchWithAuth(`${API_URL}/admin/set-subscription`, {
            method: 'POST',
            body: JSON.stringify({ userId, plan, months })
        });
        const data = await res.json();
        if (!res.ok) throw new Error('Failed to set subscription');
        return data.subscription;
    },

    adminGenerateUserApiKey: async (userId: string): Promise<string> => {
        const res = await fetchWithAuth(`${API_URL}/admin/generate-user-api-key`, {
            method: 'POST',
            body: JSON.stringify({ userId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error('Failed to generate API Key');
        return data.apiKey;
    },

    // === КАЛЬКУЛЯТОР ===
    saveCalculatorConfig: async (config: { defaultRate: number; termRates: { months: number; rate: number }[] }): Promise<string> => {
        const res = await fetchWithAuth(`${API_URL}/calculator-configs`, {
            method: 'POST',
            body: JSON.stringify(config)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.msg || data.error || 'Не удалось сохранить настройки калькулятора');
        return data.configId;
    },

    // 🔥 ПУБЛИЧНЫЙ — обычный fetch (без токена)
    getCalculatorConfig: async (configId: string): Promise<{ defaultRate: number; termRates: { months: number; rate: number }[]; sellerPhone?: string; }> => {
        const res = await fetch(`${API_URL}/calculator-configs/${configId}`, {
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.msg || data.error || 'Не удалось загрузить настройки калькулятора');
        return data;
    },

    // === УНИВЕРСАЛЬНЫЕ HTTP МЕТОДЫ (используют fetchWithAuth) ===
    get: async <T>(url: string, params?: Record<string, any>): Promise<T> => {
        const queryString = params ? '?' + new URLSearchParams(params).toString() : '';
        const res = await fetchWithAuth(`${API_URL}${url}${queryString}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.msg || data.error || `GET ${url} failed`);
        return data;
    },

    post: async <T>(url: string, data?: any): Promise<T> => {
        const res = await fetchWithAuth(`${API_URL}${url}`, {
            method: 'POST',
            body: data ? JSON.stringify(data) : undefined
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.msg || json.error || `POST ${url} failed`);
        return json;
    },

    patch: async <T>(url: string, data?: any): Promise<T> => {
        const res = await fetchWithAuth(`${API_URL}${url}`, {
            method: 'PATCH',
            body: data ? JSON.stringify(data) : undefined
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.msg || json.error || `PATCH ${url} failed`);
        return json;
    },

    delete: async <T>(url: string): Promise<T> => {
        const res = await fetchWithAuth(`${API_URL}${url}`, {
            method: 'DELETE'
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.msg || json.error || `DELETE ${url} failed`);
        return json;
    },

    sendOverdueReminder: async (payload: {
      phone: string;
      customerName: string;
      productName: string;
      overdueAmount: number;
      monthlyPayment?: number;
      totalToPay?: number;
      monthsOverdue: number;
      template?: 'overdue';
    }): Promise<{ success: boolean }> => {
      const res = await fetchWithAuth(`${API_URL}/integrations/whatsapp/send-reminder`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.msg || 'Не удалось отправить напоминание');
      }
      return data;
    },

    sendOverdueReminderAll: async (payload?: {
      template?: 'overdue';
    }): Promise<{
      success: boolean;
      results: {
        total: number;
        sent: number;
        failed: number;
        errors: Array<{ customer: string; error: string }>;
      }
    }> => {
      const res = await fetchWithAuth(`${API_URL}/integrations/whatsapp/send-reminder-all`, {
        method: 'POST',
        body: JSON.stringify(payload || {})
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.msg || 'Не удалось отправить напоминания');
      }
      return data;
    },

    adminGetStats: async (): Promise<{
      totalUsers: number;
      activeSubscriptions: number;
      totalContracts: number;
    }> => {
      const res = await fetchWithAuth(`${API_URL}/admin/stats`);
      if (!res.ok) throw new Error('Failed to fetch stats');
      return res.json();
    },

    adminSetUserStatus: async (userId: string, status: { blocked: boolean }): Promise<void> => {
      const res = await fetchWithAuth(`${API_URL}/admin/users/${userId}/status`, {
        method: 'PATCH',
        body: JSON.stringify(status)
      });
      if (!res.ok) throw new Error('Failed to update user status');
    },

    adminResetUserPassword: async (userId: string, newPassword: string): Promise<void> => {
      const res = await fetchWithAuth(`${API_URL}/admin/users/${userId}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword })
      });
      if (!res.ok) throw new Error('Failed to reset password');
    },

    checkLocalContractLimit: async (sales: Sale[]): Promise<{
      allowed: boolean;
      reason?: string;
      current: number;
      limit: number;
    }> => {
      try {
        const userStr = localStorage.getItem('user');
        if (!userStr) return { allowed: false, reason: 'Пользователь не авторизован', current: 0, limit: 0 };

        const user = JSON.parse(userStr);
        if (!user?.subscription) return { allowed: false, reason: 'Нет активной подписки', current: 0, limit: 0 };

        const { plan } = user.subscription;
        const LIMITS: Record<string, { contracts: number }> = {
          TRIAL: { contracts: 10 },
          START: { contracts: 100 },
          STANDARD: { contracts: 500 },
          BUSINESS: { contracts: -1 }
        };

        const limit = LIMITS[plan]?.contracts ?? 0;

        if (user.role === 'admin' || limit === -1) {
          return { allowed: true, current: 0, limit: -1 };
        }

        const currentCount = sales.filter(s =>
          s.status === 'ACTIVE' || s.status === 'DRAFT'
        ).length;

        if (currentCount >= limit) {
          return {
            allowed: false,
            reason: `Превышен лимит договоров для тарифа "${plan}". Максимум: ${limit}. У вас сейчас: ${currentCount}.`,
            current: currentCount,
            limit: limit
          };
        }

        return { allowed: true, current: currentCount, limit: limit };

      } catch (err) {
        console.error('checkLocalContractLimit error:', err);
        return { allowed: true, current: 0, limit: -1, reason: 'Ошибка проверки лимита' };
      }
    },
};