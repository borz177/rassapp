import { User, Sale, Customer, Product, Expense, Account, Investor, Partnership } from "../types";

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
    // Auth - Self Registration (Public)
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

    // Data Sync
    fetchAllData: async (): Promise<{
        customers: Customer[], products: Product[], sales: Sale[],
        expenses: Expense[], accounts: Account[], investors: Investor[],
        partnerships: Partnership[], employees: User[]
    }> => {
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
            return res.json();
        } catch (error) {
            console.error("Fetch Data Error:", error);
            throw error;
        }
    },

    // CRUD
    saveItem: async (type: string, item: any) => {
        await fetch(`${API_URL}/data/${type}`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify(item)
        });
    },

    deleteItem: async (type: string, id: string) => {
        await fetch(`${API_URL}/data/${type}/${id}`, {
            method: 'DELETE',
            headers: getAuthHeader()
        });
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
    }
};