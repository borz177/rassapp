
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
    sync: async () => {
        if (!navigator.onLine || isSyncing) return;
        isSyncing = true;

        try {
            const queue = await offlineStorage.getQueue();
            if (queue.length === 0) return;

            console.log(`Syncing ${queue.length} items...`);

            for (const item of queue) {
                try {
                    let res;
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
                    }

                    if (res && res.ok) {
                        // Remove from queue on success
                        await offlineStorage.removeFromQueue(item.id);
                    } else {
                        console.error(`Sync failed for item ${item.id}: Server returned ${res?.status}`);
                    }
                } catch (error) {
                    console.error(`Failed to sync item ${item.id}`, error);
                }
            }
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
                console.log("Loaded data from offline cache");
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
                            // Handle Arrays (Sales, Customers, etc.)
                            const list = data[item.collection] as any[];
                            const idx = list.findIndex(i => i.id === item.payload.id);
                            if (idx >= 0) {
                                list[idx] = item.payload;
                            } else {
                                list.unshift(item.payload);
                            }
                        } else {
                            // Handle Objects (Settings)
                            data[item.collection] = { ...data[item.collection], ...item.payload };
                        }
                    } else if (item.type === 'deleteItem') {
                         if (Array.isArray(data[item.collection])) {
                            data[item.collection] = (data[item.collection] as any[]).filter(i => i.id !== item.itemId);
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
        await fetch(`${API_URL}/users/manage`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify({ action: 'update', userData: user })
        });
    },

    deleteUser: async (userId: string) => {
        await fetch(`${API_URL}/users/manage`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify({ action: 'delete', userData: { id: userId } })
        });
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
    }
};
