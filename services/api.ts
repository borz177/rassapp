
import { User, Sale, Customer, Product, Expense, Account, Investor, Partnership, SubscriptionPlan, AppSettings, WhatsAppSettings } from "../types";

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

export const api = {
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
        const res = await fetch(`${API_URL}/auth/me`, {
            headers: getAuthHeader()
        });
        if (!res.ok) throw new Error('Failed to fetch user');
        return res.json();
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
        try {
            const res = await fetch(`${API_URL}/data`, { headers: getAuthHeader() });
            if (!res.ok) {
                if (res.status === 401) {
                    localStorage.removeItem('token');
                    localStorage.removeItem('user');
                    // We can redirect or reload here, but be careful about loops
                    window.location.reload();
                }
                throw new Error('Failed to fetch data');
            }
            return res.json();
        } catch (error) {
            console.error("Fetch Data Error:", error);
            throw error;
        }
    },

    // CRUD
    saveItem: async (type: string, item: any): Promise<any> => {
        const res = await fetch(`${API_URL}/data/${type}`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify(item)
        });
        if (!res.ok) throw new Error(`Failed to save ${type}`);
        return res.json(); // Returns the saved item
    },

    deleteItem: async (type: string, id: string) => {
        await fetch(`${API_URL}/data/${type}/${id}`, {
            method: 'DELETE',
            headers: getAuthHeader()
        });
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
    }
};
