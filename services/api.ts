import { User, Sale, Customer, Product, Expense, Account, Investor, Partnership } from "../types";

// Helper to determine the API URL dynamically
const getBaseUrl = () => {
    const { hostname, protocol } = window.location;
    // Force IPv4 for localhost to avoid ::1 vs 127.0.0.1 resolution issues in Node v17+
    if (hostname === 'localhost') {
        return `${protocol}//127.0.0.1:5000/api`;
    }
    // For LAN testing (e.g. 192.168.1.5), use the same hostname as the frontend
    return `${protocol}//${hostname}:5000/api`;
};

const API_URL = getBaseUrl();

const getAuthHeader = () => {
    const token = localStorage.getItem('token');
    return token ? { 'x-auth-token': token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
};

export const api = {
    // Auth
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
            return data.user;
        } catch (error: any) {
            console.error("API Register Error:", error);
            if (error.message === 'Failed to fetch') {
                throw new Error('Нет соединения с сервером. Убедитесь, что бэкенд запущен (npm start в папке server).');
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
                throw new Error('Нет соединения с сервером. Убедитесь, что бэкенд запущен (npm start в папке server).');
            }
            throw error;
        }
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