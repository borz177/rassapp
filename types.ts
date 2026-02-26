
export enum PaymentStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE'
}

export type SubscriptionPlan = 'TRIAL' | 'START' | 'STANDARD' | 'BUSINESS';

export interface UserSubscription {
  plan: SubscriptionPlan;
  expiresAt: string; // ISO String
}

export interface UserPermissions {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export interface WhatsAppTemplates {
  upcoming: string; // За N дней
  today: string;    // В день оплаты
  overdue: string;  // При просрочке
}

export interface WhatsAppSettings {
  enabled: boolean;
  idInstance: string;
  apiTokenInstance: string;
  reminderTime: string; // "09:00"
  // Array of offsets: 0 = due date, -1 = 1 day before, 1 = 1 day after
  reminderDays: number[];
  templates?: WhatsAppTemplates; // New field for custom templates
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  password?: string;
  role: 'admin' | 'manager' | 'investor' | 'employee';
  managerId?: string; // If role is 'investor' or 'employee', this links to the manager
  permissions?: UserPermissions; // Only for employees
  allowedInvestorIds?: string[]; // IDs of investors this employee can manage/see
  subscription?: UserSubscription; // New field
  whatsapp_settings?: WhatsAppSettings; // Saved in users table
  // Admin specific optional fields
  salesCount?: number;
  lastLogin?: string;
  apiKey?: string;
}

export interface InvestorPermissions {
  canViewContracts: boolean;
  canViewHistory: boolean;
}

export interface Investor {
  id: string; // This will match the User.id
  userId: string; // The Manager's ID
  name: string;
  email: string; // Login email
  phone: string;
  joinedDate: string;
  // This now represents the current investment balance, not just the initial deposit.
  initialAmount: number;
  profitPercentage: number;
  permissions?: InvestorPermissions;
  notes?: string;
  color?: string;
}

export interface Account {
  id: string;
  userId: string; // Owner (Manager)
  name: string;
  type: 'MAIN' | 'INVESTOR' | 'CUSTOM' | 'SHARED';
  ownerId?: string; // If type is INVESTOR, points to Investor User ID
  partners?: string[]; // IDs of Investors for SHARED accounts
  balance?: number;
  currency?: string;
  isArchived?: boolean;
}

export interface Partnership {
  id: string;
  userId: string; // Owner (Manager)
  name: string;
  accountId: string;
  partnerIds: string[];
  createdAt: string;
}

export interface Customer {
  id: string;
  userId: string; // Owner
  name: string;
  phone: string;
  email: string;
  address?: string; // New field
  trustScore: number; // 0-100, AI calculated
  notes: string;
  photo?: string; // Base64 string
  allowWhatsappNotification?: boolean; // New field for toggle
  totalPurchases?: number;
  activeContracts?: number;
  overdueContracts?: number;
}

export interface Product {
  id: string;
  userId: string; // Owner
  name: string;
  price: number;
  category: string;
  stock: number;
}

export interface Payment {
  id: string;
  saleId: string;
  amount: number;
  date: string; // ISO String
  isPaid: boolean;
  lastNotificationDate?: string; // ISO String (YYYY-MM-DD) of last sent reminder
  actualDate?: string | null;
  note?: string;
  isRealPayment?: boolean;
  importedAt?: string;
}

export interface Expense {
  id: string;
  userId: string; // Owner
  accountId: string; // Linked account
  title: string;
  amount: number;
  category: string;
  date: string;
  // Specific for investor payouts
  payoutType?: 'INVESTMENT' | 'PROFIT';
  managerPayoutSource?: 'CAPITAL' | 'PROFIT';
  investorId?: string; // For tracking withdrawals in shared accounts
}

export interface Sale {
  id: string;
  userId: string; // Owner
  type: 'INSTALLMENT' | 'CASH';
  customerId: string;
  productName: string; // Changed from productId to name for flexibility
  productId?: string; // Optional link to inventory
  buyPrice: number; // Cost price
  accountId: string;
  totalAmount: number; // Selling Price + Interest
  downPayment: number;
  remainingAmount: number;
  interestRate: number;
  installments: number;
  startDate: string;
  paymentDay?: number;
  status: 'ACTIVE' | 'COMPLETED' | 'DEFAULTED' | 'DRAFT';
  guarantorName?: string;
  guarantorPhone?: string;
  paymentPlan: Payment[];
  notes?: string;
  price?: number;
}

export interface TermRate {
    months: number;
    rate: number;
}

export interface CalculatorSettings {
    defaultInterestRate: number;
    maxMonths: number;
    termRates?: TermRate[]; // Array of specific rates for specific terms
}

export interface AppSettings {
  companyName: string;
  whatsapp?: WhatsAppSettings;
  calculator?: CalculatorSettings;
  theme?: 'PURPLE' | 'BLUE' | 'GREEN' | 'BLACK';
}

export type ViewState =
  | 'DASHBOARD'
  | 'CASH_REGISTER'
  | 'CUSTOMERS'
  | 'CUSTOMER_DETAILS'
  | 'MANAGE_PRODUCTS'
  | 'MORE'
  | 'OPERATIONS'
  | 'INVESTORS'
  | 'INVESTOR_DETAILS'
  | 'AI_ASSISTANT'
  | 'CONTRACTS'
  | 'CREATE_SALE'
  | 'CREATE_INCOME'
  | 'CREATE_EXPENSE'
  | 'SELECT_CUSTOMER'
  | 'EMPLOYEES'
  | 'SETTINGS'
  | 'INTEGRATIONS'
  | 'CALCULATOR'
  | 'REPORTS'
  | 'PROFILE'
  | 'PARTNERS'
  | 'TARIFFS'
  | 'ADMIN_PANEL';
