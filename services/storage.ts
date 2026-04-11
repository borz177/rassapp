// services/storage.ts
import { Customer, Product, Sale, Expense, Account, Investor, User, UserPermissions, AppSettings, Partnership } from '../types';

const API_BASE = import.meta.env.PROD 
  ? 'https://rassrochka.pro/api' 
  : 'http://localhost:5000/api';

const STORAGE_KEYS = {
  CUSTOMERS: 'installmate_customers',
  PRODUCTS: 'installmate_products',
  SALES: 'installmate_sales',
  EXPENSES: 'installmate_expenses',
  ACCOUNTS: 'installmate_accounts',
  INVESTORS: 'installmate_investors',
  PARTNERSHIPS: 'installmate_partnerships',
  APP_SETTINGS: 'installmate_app_settings',
};

// --- AUTH SERVICES (через API) ---

export const registerUser = async (name: string, email: string, password: string, code: string): Promise<{ token: string; user: User } | null> => {
  try {
    const response = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, code, role: 'manager' })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.msg || 'Registration failed');
    }
    
    const data = await response.json();
    // Сохраняем токен
    localStorage.setItem('auth_token', data.token);
    return data;
  } catch (err) {
    console.error('Register error:', err);
    return null;
  }
};

export const registerInvestor = async (managerId: string, name: string, email: string, password: string, code: string): Promise<{ token: string; user: User } | null> => {
  try {
    const response = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, code, role: 'investor', managerId })
    });
    
    if (!response.ok) return null;
    const data = await response.json();
    localStorage.setItem('auth_token', data.token);
    return data;
  } catch (err) {
    console.error('Register investor error:', err);
    return null;
  }
};

export const registerEmployee = async (
  managerId: string, 
  name: string, 
  email: string, 
  password: string,
  code: string,
  permissions: UserPermissions,
  allowedInvestorIds: string[]
): Promise<{ token: string; user: User } | null> => {
  try {
    const response = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        name, email, password, code, 
        role: 'employee', managerId, permissions, allowedInvestorIds 
      })
    });
    
    if (!response.ok) return null;
    const data = await response.json();
    localStorage.setItem('auth_token', data.token);
    return data;
  } catch (err) {
    console.error('Register employee error:', err);
    return null;
  }
};

export const loginUser = async (email: string, password: string): Promise<{ token: string; user: User } | null> => {
  try {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.msg || 'Login failed');
    }
    
    const data = await response.json();
    localStorage.setItem('auth_token', data.token);
    return data;
  } catch (err) {
    console.error('Login error:', err);
    return null;
  }
};

export const logoutUser = (): void => {
  localStorage.removeItem('auth_token');
};

export const getCurrentUser = async (): Promise<User | null> => {
  const token = localStorage.getItem('auth_token');
  if (!token) return null;
  
  try {
    const response = await fetch(`${API_BASE}/auth/me`, {
      headers: { 'x-auth-token': token }
    });
    
    if (!response.ok) {
      logoutUser();
      return null;
    }
    
    return await response.json();
  } catch (err) {
    console.error('Get user error:', err);
    return null;
  }
};

export const sendVerificationCode = async (email: string, type: 'REGISTER' | 'RESET'): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE}/auth/send-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, type })
    });
    return response.ok;
  } catch (err) {
    console.error('Send code error:', err);
    return false;
  }
};

export const resetPassword = async (email: string, code: string, newPassword: string): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, newPassword })
    });
    return response.ok;
  } catch (err) {
    console.error('Reset password error:', err);
    return false;
  }
};

// --- DATA HELPERS (с локальным кэшем + синхронизацией) ---

const loadUserItems = <T extends { userId?: string }>(key: string, userId: string): T[] => {
  const saved = localStorage.getItem(key);
  if (!saved) return [];
  const allItems: T[] = JSON.parse(saved);
  return allItems.filter(item => item.userId === userId || !item.userId);
};

const saveUserItems = <T extends { userId?: string }>(key: string, userId: string, userItems: T[]): void => {
  const saved = localStorage.getItem(key);
  const allItems: T[] = saved ? JSON.parse(saved) : [];
  const otherItems = allItems.filter(item => item.userId !== userId);
  const merged = [...otherItems, ...userItems.map(item => ({ ...item, userId }))];
  localStorage.setItem(key, JSON.stringify(merged));
};

// --- PUBLIC API (локальное хранение + опциональная синхронизация) ---

export const getCustomers = (userId: string) => loadUserItems<Customer>(STORAGE_KEYS.CUSTOMERS, userId);
export const saveCustomers = (userId: string, data: Customer[]) => {
  saveUserItems(STORAGE_KEYS.CUSTOMERS, userId, data);
  // Опционально: синхронизация с бэкендом
  // syncData('customers', userId, data);
};

export const getProducts = (userId: string) => loadUserItems<Product>(STORAGE_KEYS.PRODUCTS, userId);
export const saveProducts = (userId: string, data: Product[]) => saveUserItems(STORAGE_KEYS.PRODUCTS, userId, data);

export const getSales = (userId: string) => loadUserItems<Sale>(STORAGE_KEYS.SALES, userId);
export const saveSales = (userId: string, data: Sale[]) => saveUserItems(STORAGE_KEYS.SALES, userId, data);

export const getExpenses = (userId: string) => loadUserItems<Expense>(STORAGE_KEYS.EXPENSES, userId);
export const saveExpenses = (userId: string, data: Expense[]) => saveUserItems(STORAGE_KEYS.EXPENSES, userId, data);

export const getAccounts = (userId: string) => loadUserItems<Account>(STORAGE_KEYS.ACCOUNTS, userId);
export const saveAccounts = (userId: string, data: Account[]) => saveUserItems(STORAGE_KEYS.ACCOUNTS, userId, data);

export const getInvestors = (userId: string) => loadUserItems<Investor>(STORAGE_KEYS.INVESTORS, userId);
export const saveInvestors = (userId: string, data: Investor[]) => saveUserItems(STORAGE_KEYS.INVESTORS, userId, data);

export const getPartnerships = (userId: string) => loadUserItems<Partnership>(STORAGE_KEYS.PARTNERSHIPS, userId);
export const savePartnerships = (userId: string, data: Partnership[]) => saveUserItems(STORAGE_KEYS.PARTNERSHIPS, userId, data);

// --- APP SETTINGS ---

export const getAppSettings = (): AppSettings => {
  const saved = localStorage.getItem(STORAGE_KEYS.APP_SETTINGS);
  const defaults: AppSettings = { companyName: 'FinUchet', showCents: true, theme: 'PURPLE' };
  return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
};

export const saveAppSettings = (settings: AppSettings): void => {
  localStorage.setItem(STORAGE_KEYS.APP_SETTINGS, JSON.stringify(settings));
};

// --- EMPLOYEE MANAGEMENT (через API) ---

export const getEmployees = async (managerId: string, token: string): Promise<User[]> => {
  try {
    const response = await fetch(`${API_BASE}/data`, {
      headers: { 'x-auth-token': token }
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.employees || [];
  } catch (err) {
    console.error('Get employees error:', err);
    return [];
  }
};

export const createEmployee = async (
  token: string,
  name: string, 
  email: string, 
  password: string,
  permissions: UserPermissions,
  allowedInvestorIds: string[]
): Promise<User | null> => {
  try {
    const response = await fetch(`${API_BASE}/users/manage`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-auth-token': token 
      },
      body: JSON.stringify({
        action: 'create',
        userData: {
          name, email, password,
          role: 'employee',
          permissions,
          allowedInvestorIds
        }
      })
    });
    
    if (!response.ok) return null;
    return await response.json();
  } catch (err) {
    console.error('Create employee error:', err);
    return null;
  }
};

export const updateEmployee = async (token: string, employee: User): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE}/users/manage`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-auth-token': token 
      },
      body: JSON.stringify({
        action: 'update',
        userData: employee
      })
    });
    return response.ok;
  } catch (err) {
    console.error('Update employee error:', err);
    return false;
  }
};

export const deleteEmployee = async (token: string, employeeId: string): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE}/users/manage`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-auth-token': token 
      },
      body: JSON.stringify({
        action: 'delete',
        userData: { id: employeeId }
      })
    });
    return response.ok;
  } catch (err) {
    console.error('Delete employee error:', err);
    return false;
  }
};

// --- HELPER: Получить токен ---
export const getAuthToken = (): string | null => localStorage.getItem('auth_token');