
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

export const api = {
    // Sync Logic
        // Sync Logic — ПОЛНЫЙ, ГОТОВЫЙ КОД
    sync: async (): Promise<{ success: boolean; syncedCollections: Set<string> }> => {
        if (!navigator.onLine || isSyncing) return { success: false, syncedCollections: new Set() };
        isSyncing = true;
        const syncedCollections = new Set<string>();

        try {
            const queue = await offlineStorage.getQueue();
            if (queue.length === 0) return { success: true, syncedCollections };

            // 🔹 Встроенная логика обработки одного элемента (вместо внешней функции)
            const processItem = async (item: any): Promise<boolean> => {
                try {
                    let res: Response;
                    if (item.type === 'saveItem') {
                        res = await fetch(`${API_URL}/data/${item.collection}`, {
                            method: 'POST',
                            headers: getAuthHeader(),
                            body: JSON.stringify(item.payload)
                        });
                    } else if (item.type === 'deleteItem') {
                        res = await fetch(`${API_URL}/data/${item.collection}/${item.itemId}`, {
                            method: 'DELETE',
                            headers: getAuthHeader()
                        });
                    } else {
                        return false;
                    }

                    if (res.ok) {
                        await offlineStorage.removeFromQueue(item.id);
                        if (item.collection) syncedCollections.add(item.collection);
                        return true;
                    } else {
                        // Обработка ошибок сервера
                        const errorText = await res.text().catch(() => '');
                        const isDependencyError = res.status === 400 && (
                            errorText.toLowerCase().includes('not found') ||
                            errorText.toLowerCase().includes('customer') ||
                            errorText.toLowerCase().includes('reference')
                        );

                        item.retryCount = (item.retryCount || 0) + 1;

                        if (isDependencyError && item.retryCount < 3) {
                            await offlineStorage.updateQueueItem(item);
                        } else if (item.retryCount > 5) {
                            console.error(`❌ Dropping item ${item.id} after ${item.retryCount} retries`);
                            await offlineStorage.removeFromQueue(item.id);
                        } else {
                            await offlineStorage.updateQueueItem(item);
                        }
                        return false;
                    }
                } catch (error) {
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


    // Auth
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

            // Stores token automatically (Log in)
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));

            // Cache user for offline access
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

            // Cache user for offline access
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

    getMe: async (): Promise<User> => {
        try {
            const res = await fetch(`${API_URL}/auth/me`, {
                headers: getAuthHeader()
            });
            if (!res.ok) throw new Error('Failed to fetch user');
            const user = await res.json();
            // Cache user data
            await offlineStorage.setCache('user_me', user);
            return user;
        } catch (error) {
            // Try cache
            const cachedUser = await offlineStorage.getCache('user_me');
            if (cachedUser) return cachedUser;
            throw error;
        }
    },

    // User Management - Create Sub-User (Protected, No Login Side-effect)
    createSubUser: async (userData: any): Promise<any> => {
        const res = await fetch(`${API_URL}/users/manage`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify({ action: 'create', userData })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.msg || 'Ошибка создания пользователя');
        return data; // Returns the created user object
    },

    // Subscription
    updateSubscription: async (plan: SubscriptionPlan, months: number): Promise<any> => {
        const res = await fetch(`${API_URL}/user/subscription`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify({ plan, months })
        });
        const data = await res.json();
        if (!res.ok) throw new Error('Failed to update subscription');
        return data.subscription;
    },

    // WhatsApp Settings
    saveWhatsAppSettings: async (settings: WhatsAppSettings): Promise<void> => {
        const res = await fetch(`${API_URL}/user/whatsapp`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify(settings)
        });
        if (!res.ok) throw new Error('Failed to save WhatsApp settings');
    },

    // Payments
    createPayment: async (paymentData: { amount: number, description: string, returnUrl: string, plan: SubscriptionPlan, months: number }): Promise<any> => {
        const res = await fetch(`${API_URL}/payment/create`, {
            method: 'POST',
            headers: getAuthHeader(),
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
            const res = await fetch(`${API_URL}/data`, { headers: getAuthHeader() });
            if (!res.ok) {
                if (res.status === 401) {
                    localStorage.removeItem('token');
                    localStorage.removeItem('user');
                    window.location.reload();
                }
                throw new Error('Failed to fetch data');
            }
            data = await res.json();
            // Cache the data
            await offlineStorage.setCache('all_data', data);
        } catch (error) {
            console.error("Fetch Data Error:", error);
            // Try to load from cache
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

        // 🔹 1. Ищем по ID
        let idx = list.findIndex(i => i.id === item.payload.id);

        // 🔹 2. Если не нашли и это инвестор — ищем по email
        if (idx === -1 && item.collection === 'investors' && item.payload.email) {
            idx = list.findIndex(i => i.email === item.payload.email);

            // 🔹 3. Если нашли по email — обновляем, но сохраняем НОВЫЙ id
            if (idx >= 0) {
                list[idx] = { ...list[idx], ...item.payload, id: item.payload.id };
                continue; // Пропускаем добавление
            }
        }

        // 🔹 4. Стандартное поведение
        if (idx >= 0) {
            list[idx] = item.payload;
        } else {
            // 🔹 Проверка на дубль по email перед добавлением
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
    saveItem: async (type: string, item: any): Promise<any> => {
        // Optimistic update support
        try {
            const res = await fetch(`${API_URL}/data/${type}`, {
                method: 'POST',
                headers: getAuthHeader(),
                body: JSON.stringify(item)
            });
            if (!res.ok) throw new Error(`Failed to save ${type}`);
            const savedItem = await res.json();

            // Update cache if possible (simple append/update)
            // Ideally we should re-fetch or update the specific cache entry
            // For now, we rely on the UI updating its state via the return value
            return savedItem;
        } catch (error) {
            console.warn("Offline mode: saving to queue", error);
            // Save to offline queue
            await offlineStorage.addToQueue({
                type: 'saveItem',
                collection: type,
                payload: item
            });
            // Return the item as if it was saved (Optimistic)
            return item;
        }
    },

    deleteItem: async (type: string, id: string) => {
        try {
            await fetch(`${API_URL}/data/${type}/${id}`, {
                method: 'DELETE',
                headers: getAuthHeader()
            });
        } catch (error) {
            console.warn("Offline mode: queuing delete", error);
            await offlineStorage.addToQueue({
                type: 'deleteItem',
                collection: type,
                itemId: id
            });
        }
    },

    // Account Reset
    resetAccountData: async () => {
        const res = await fetch(`${API_URL}/user/data`, {
            method: 'DELETE',
            headers: getAuthHeader()
        });
        if (!res.ok) throw new Error('Failed to reset account');
    },

    // User Management
    updateUser: async (user: User) => {
  const res = await fetch(`${API_URL}/users/manage`, {
    method: 'POST',
    headers: getAuthHeader(),
    body: JSON.stringify({ action: 'update', userData: user })
  });

  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.msg || data.error || 'Ошибка обновления пользователя');
  }

  return res.json();
},

    deleteUser: async (userId: string) => {
        await fetch(`${API_URL}/users/manage`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify({ action: 'delete', userData: { id: userId } })
        });
    },

  // === ОБНОВЛЕНИЕ ПРОФИЛЯ (через users/manage) ===
// === ОБНОВЛЕНИЕ ПРОФИЛЯ (через users/manage) ===
updateProfile: async (userId: string, profileData: { name?: string; phone?: string; email?: string }): Promise<User> => {
    const res = await fetch(`${API_URL}/users/manage`, {
        method: 'POST',
        headers: getAuthHeader(),
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


    // 🔥 ПРИОРИТЕТ 1: Если сервер вернул обновлённого пользователя — используем его
    if (data.user) {
        await offlineStorage.setCache('user_me', data.user);
        return data.user;
    }

    // 🔥 ПРИОРИТЕТ 2: Фолбэк — запрашиваем актуального пользователя с сервера
    try {
        const updatedUser = await api.getMe();
        await offlineStorage.setCache('user_me', updatedUser);
        return updatedUser;
    } catch (error) {
        console.warn('⚠️ Failed to fetch fresh user, using local merge as last resort');

        // 🔥 ПОСЛЕДНИЙ ВАРИАНТ: локальное слияние (только если всё остальное не сработало)
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

    // === СМЕНА ПАРОЛЯ (отдельный безопасный эндпоинт) ===
    changePassword: async (currentPassword: string, newPassword: string): Promise<{ success: true }> => {
        const res = await fetch(`${API_URL}/auth/change-password`, {
            method: 'POST',
            headers: getAuthHeader(),
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
            const res = await fetch(`${API_URL}/integrations/whatsapp/create`, {
                method: 'POST',
                headers: getAuthHeader(),
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
        const res = await fetch(`${API_URL}/admin/users`, { headers: getAuthHeader() });
        if (!res.ok) throw new Error('Failed to fetch users');
        return res.json();
    },

    adminSetSubscription: async (userId: string, plan: SubscriptionPlan, months: number): Promise<any> => {
        const res = await fetch(`${API_URL}/admin/set-subscription`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify({ userId, plan, months })
        });
        const data = await res.json();
        if (!res.ok) throw new Error('Failed to set subscription');
        return data.subscription;
    },

    adminGenerateUserApiKey: async (userId: string): Promise<string> => {
        const res = await fetch(`${API_URL}/admin/generate-user-api-key`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify({ userId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error('Failed to generate API Key');
        return data.apiKey;
    },


     // === КАЛЬКУЛЯТОР — СОХРАНЕНИЕ/ЗАГРУЗКА КОНФИГОВ ===

    /**
     * Сохраняет настройки калькулятора на сервере
     * @returns Короткий ID конфига (например: "a1b2c3")
     */
    saveCalculatorConfig: async (config: { defaultRate: number; termRates: { months: number; rate: number }[] }): Promise<string> => {
        const res = await fetch(`${API_URL}/calculator-configs`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify(config)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.msg || data.error || 'Не удалось сохранить настройки калькулятора');
        return data.configId; // Возвращаем короткий ID: "a1b2c3"
    },

    /**
     * Загружает конфиг калькулятора по короткому ID
     * ⚠️ ПУБЛИЧНЫЙ МЕТОД — не использует токен авторизации!
     */
    getCalculatorConfig: async (configId: string): Promise<{ defaultRate: number; termRates: { months: number; rate: number }[]; sellerPhone?: string; }> => {
        // 🔹 Публичный запрос — БЕЗ токена, чтобы клиент мог открыть ссылку без логина
        const res = await fetch(`${API_URL}/calculator-configs/${configId}`, {
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.msg || data.error || 'Не удалось загрузить настройки калькулятора');
        return data;
    },


    // === УНИВЕРСАЛЬНЫЕ HTTP МЕТОДЫ (для техподдержки и других новых роутов) ===

get: async <T>(url: string, params?: Record<string, any>): Promise<T> => {
    const queryString = params ? '?' + new URLSearchParams(params).toString() : '';
    const res = await fetch(`${API_URL}${url}${queryString}`, {
        headers: getAuthHeader()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.msg || data.error || `GET ${url} failed`);
    return data;
},

post: async <T>(url: string, data?: any): Promise<T> => {
    const res = await fetch(`${API_URL}${url}`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: data ? JSON.stringify(data) : undefined
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.msg || json.error || `POST ${url} failed`);
    return json;
},

patch: async <T>(url: string, data?: any): Promise<T> => {
    const res = await fetch(`${API_URL}${url}`, {
        method: 'PATCH',
        headers: getAuthHeader(),
        body: data ? JSON.stringify(data) : undefined
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.msg || json.error || `PATCH ${url} failed`);
    return json;
},

delete: async <T>(url: string): Promise<T> => {
    const res = await fetch(`${API_URL}${url}`, {
        method: 'DELETE',
        headers: getAuthHeader()
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
  monthlyPayment?: number;  // ← добавьте этот параметр
  totalToPay?: number;  
  monthsOverdue: number;
  template?: 'overdue';
}): Promise<{ success: boolean }> => {
  const res = await fetch(`${API_URL}/integrations/whatsapp/send-reminder`, {
    method: 'POST',
    headers: getAuthHeader(), // ✅ Использует ваш x-auth-token из localStorage
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || data.msg || 'Не удалось отправить напоминание');
  }
  return data;
},



/**
 * Массовая отправка напоминаний всем просроченным клиентам
 */
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
  const res = await fetch(`${API_URL}/integrations/whatsapp/send-reminder-all`, {
    method: 'POST',
    headers: getAuthHeader(),
    body: JSON.stringify(payload || {})
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || data.msg || 'Не удалось отправить напоминания');
  }
  return data;
},


};
