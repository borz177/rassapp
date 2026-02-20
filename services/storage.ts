
import { Customer, Product, Sale, Expense, Account, Investor, User, UserPermissions, AppSettings, Partnership } from '../types';

const STORAGE_KEYS = {
  USERS: 'installmate_users', // New key for auth
  CUSTOMERS: 'installmate_customers',
  PRODUCTS: 'installmate_products',
  SALES: 'installmate_sales',
  EXPENSES: 'installmate_expenses',
  ACCOUNTS: 'installmate_accounts',
  INVESTORS: 'installmate_investors',
  PARTNERSHIPS: 'installmate_partnerships',
  APP_SETTINGS: 'installmate_app_settings',
};

// --- AUTH SERVICES ---

export const getUsers = (): User[] => {
    const usersStr = localStorage.getItem(STORAGE_KEYS.USERS);
    return usersStr ? JSON.parse(usersStr) : [];
};

export const saveUsers = (users: User[]): void => {
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
};

export const registerUser = (name: string, email: string, password: string): User | null => {
    const users = getUsers();

    if (users.find(u => u.email === email)) {
        return null; // User exists
    }

    const newUser: User = {
        id: `u_${Date.now()}`,
        name,
        email,
        password,
        role: 'manager'
    };

    users.push(newUser);
    saveUsers(users);
    
    // Initialize default account for new user
    saveAccounts(newUser.id, [{ id: `acc_main_${newUser.id}`, userId: newUser.id, name: 'Основной счет', type: 'MAIN' }]);

    return newUser;
};

export const registerInvestor = (managerId: string, name: string, email: string, password: string): User | null => {
    const users = getUsers();

    if (users.find(u => u.email === email)) {
        return null; // User exists
    }

    const newUser: User = {
        id: `u_inv_${Date.now()}`,
        name,
        email,
        password,
        role: 'investor',
        managerId: managerId
    };

    users.push(newUser);
    saveUsers(users);
    return newUser;
};

export const registerEmployee = (
    managerId: string, 
    name: string, 
    email: string, 
    password: string,
    permissions: UserPermissions,
    allowedInvestorIds: string[]
): User | null => {
    const users = getUsers();

    if (users.find(u => u.email === email)) {
        return null; // User exists
    }

    const newUser: User = {
        id: `u_emp_${Date.now()}`,
        name,
        email,
        password,
        role: 'employee',
        managerId: managerId,
        permissions,
        allowedInvestorIds
    };

    users.push(newUser);
    saveUsers(users);
    return newUser;
};

export const updateEmployee = (employee: User): void => {
    let users = getUsers();
    users = users.map(u => u.id === employee.id ? employee : u);
    saveUsers(users);
};

export const deleteEmployee = (employeeId: string): void => {
    let users = getUsers();
    users = users.filter(u => u.id !== employeeId);
    saveUsers(users);
};

export const loginUser = (email: string, password: string): User | null => {
    const users = getUsers();
    
    const user = users.find(u => u.email === email && u.password === password);
    return user || null;
};

export const getEmployees = (managerId: string): User[] => {
    const users = getUsers();
    return users.filter(u => u.managerId === managerId && u.role === 'employee');
}

// --- DATA HELPERS (ISOLATION LOGIC) ---

// Generic loader that filters by User ID
const loadUserItems = <T extends { userId: string }>(key: string, userId: string): T[] => {
  const saved = localStorage.getItem(key);
  if (!saved) return [];
  const allItems: T[] = JSON.parse(saved);
  return allItems.filter(item => item.userId === userId);
};

// Generic saver that merges User items with others
const saveUserItems = <T extends { userId: string }>(key: string, userId: string, userItems: T[]): void => {
    const saved = localStorage.getItem(key);
    const allItems: T[] = saved ? JSON.parse(saved) : [];
    
    // Filter out items belonging to current user (to replace them)
    const otherItems = allItems.filter(item => item.userId !== userId);
    
    // Combine and save
    const merged = [...otherItems, ...userItems];
    localStorage.setItem(key, JSON.stringify(merged));
};

// --- PUBLIC API ---

export const getCustomers = (userId: string) => loadUserItems<Customer>(STORAGE_KEYS.CUSTOMERS, userId);
export const saveCustomers = (userId: string, data: Customer[]) => saveUserItems(STORAGE_KEYS.CUSTOMERS, userId, data);

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
    const defaults: AppSettings = { companyName: 'FinUchet' };
    return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
};

export const saveAppSettings = (settings: AppSettings): void => {
    localStorage.setItem(STORAGE_KEYS.APP_SETTINGS, JSON.stringify(settings));
};
