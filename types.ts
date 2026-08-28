
export enum PaymentStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE'
}

export type SubscriptionPlan = 'TRIAL' | 'START' | 'STANDARD' | 'BUSINESS' | 'BUSINESS_PRO';

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
  welcome?: string
}

export interface WhatsAppSettings {
  enabled: boolean;
  idInstance: string;
  apiTokenInstance: string;
  reminderTime: string; // "09:00"
  // Array of offsets: 0 = due date, -1 = 1 day before, 1 = 1 day after
  reminderDays: number[];
  templates?: WhatsAppTemplates; // New field for custom templates
  botEnabled?: boolean;
  welcomeEnabled?: boolean;  // 🔥 НОВОЕ: включено ли приветствие
  welcomeInterval?: number;
  historyEnabled?: boolean;      // ← НОВОЕ
  conditionsEnabled?: boolean;
  calculator?: CalculatorSettings;
  companyName?: string;
  calculatorConfigId?: string;
  overdueReminderInterval?: number
  /**
   * Дата окончания подписки инстанса, введённая вручную.
   * Нужна только для инстансов, заведённых мимо партнёрского аккаунта: Green API
   * не отдаёт их срок ни одним методом уровня инстанса — эти данные видны лишь
   * владельцу аккаунта в его личном кабинете. Для партнёрских инстансов срок
   * приходит с сервера и это поле не используется.
   */
  expiresAt?: string; // YYYY-MM-DD
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
  allowedInvestorIds?: string[]; // IDs of investors (+ 'MAIN_ACCOUNT') this employee can access
  fullAccessInvestorIds?: string[]; // Subset of allowedInvestorIds where employee sees ALL records, not just their own
  // 💰 Мотивация сотрудника: процент от прибыли.
  // Начисляется по мере поступления платежей, а не сразу от суммы договора —
  // иначе премия начислялась бы за деньги, которые ещё не пришли.
  // Берётся из доли МЕНЕДЖЕРА: сотрудник нанят им, и договорённости
  // с инвесторами не должны меняться от найма.
  profitPercentage?: number;
  /**
   * От чего считать процент:
   *  CONTRACTS — прибыль по договорам, которые сотрудник оформил (createdByUserId)
   *  PAYMENTS  — прибыль по платежам, которые он принял (recordedByUserId)
   *  ALL       — вся прибыль менеджера
   */
  profitBase?: 'CONTRACTS' | 'PAYMENTS' | 'ALL';
  /** Уменьшать прибыль менеджера сразу при начислении (по умолчанию) или только при выплате. */
  profitReducesManager?: boolean;
  /** Процент бизнес-партнёра. Пусто — не партнёр. Суммы приходят отдельным запросом. */
  partnerPercent?: number;
  /**
   * Из чьей прибыли платится премия сотруднику:
   *  MANAGER — из доли менеджера (по умолчанию): сотрудник нанят им.
   *  SHARED  — расход общего дела: вычитается из прибыли ДО распределения,
   *            то есть ложится и на инвесторов. Нужен, когда доля менеджера равна нулю
   *            и платить премию попросту не из чего. Требует договорённости с инвесторами.
   */
  profitSource?: 'MANAGER' | 'SHARED';
  /**
   * С какой даты начисляется премия. Платежи, поступившие раньше, в расчёт не идут —
   * иначе при установке процента сотруднику разом «набегала» премия за всю историю,
   * включая договоры, которых он не касался.
   * Проставляется автоматически в момент включения процента, но её можно поправить,
   * если договорились с сотрудником с другого числа.
   */
  profitSince?: string;

  subscription?: UserSubscription; // New field
  whatsapp_settings?: WhatsAppSettings; // Saved in users table
  // Admin specific optional fields
  salesCount?: number;
  lastLogin?: string;
  apiKey?: string;
  blocked?: boolean;
}

export interface InvestorPermissions {
  canViewContracts: boolean;
  canViewHistory: boolean;
}

// Один период участия инвестора в пуле (поддержка повторного входа).
// Если поле investmentPeriods задано — используется вместо устаревших joinedDate/leftPoolDate/initialAmount.
export interface InvestmentPeriod {
  id: string;
  joinedDate: string;
  leftPoolDate?: string;
  initialAmount: number;
  note?: string;
}

export interface Investor {
  id: string; // This will match the User.id
  userId: string; // The Manager's ID
  name: string;
  email: string; // Login email
  phone: string;
  joinedDate: string;
  // Дата выхода из общего пула (type === 'POOL'). Не влияет на историю ДО этой даты —
  // см. getAccountShares/getInvestorCapitalShare в src/utils.ts.
  leftPoolDate?: string;
  // This now represents the current investment balance, not just the initial deposit.
  initialAmount: number;
  profitPercentage: number;
  permissions?: InvestorPermissions;
  notes?: string;
  color?: string;
  allowedInvestorIds?: string[];
  // Список периодов инвестирования (при повторных входах в пул).
  // Если задан — перекрывает joinedDate/leftPoolDate/initialAmount для расчётов.
  investmentPeriods?: InvestmentPeriod[];
}

// Убыток пула — по принципу аль-гунм биль-гурм (الغنم بالغرم).
// Распределяется пропорционально КАПИТАЛУ (не проценту прибыли — см. getCapitalShares в utils.ts).
export interface LossEvent {
  id: string;
  date: string;
  amount: number;       // Полная сумма убытка для пула
  description: string;
  saleId?: string;      // Ссылка на проблемный договор (необязательно)

  // Мудараба: обычный убыток ложится на капитал инвесторов пропорционально вложениям,
  // но убыток из-за небрежности управляющего (та'адди/тафрит) — лично на него,
  // и тогда доли участников не уменьшаются.
  blamedOnManager?: boolean;

  // Служебное: расход, которым убыток списан со счёта (если деньги были реальными).
  // Нужен, чтобы при удалении убытка убрать и списание.
  expenseId?: string;
}

export interface Account {
  id: string;
  userId: string; // Owner (Manager)
  name: string;
  type: 'MAIN' | 'INVESTOR' | 'CUSTOM' | 'SHARED' | 'POOL';
  ownerId?: string; // If type is INVESTOR, points to Investor User ID
  partners?: string[]; // IDs of Investors for SHARED accounts
  poolMemberIds?: string[]; // IDs of Investors sharing this account (type === 'POOL', BUSINESS_PRO). Each member's share of pool profit = (their initialAmount / total pool capital) × their own Investor.profitPercentage; manager gets the remainder.
  isMain?: boolean; // "Сделать основным" — отмечает счёт основным БЕЗ изменения его структурного type (INVESTOR/POOL/SHARED/CUSTOM)
  balance?: number;
  currency?: string;
  isArchived?: boolean;
  initialBalance?: number;
  lossEvents?: LossEvent[]; // Убытки пула (Исламские финансы: мушарака/мудараба)
}

export interface Partnership {
  id: string;
  userId: string; // Owner (Manager)
  name: string;
  accountId: string;
  partnerIds: string[];
  createdAt: string;
}

// Поставщик (модуль "Партнеры", тариф BUSINESS_PRO). Не путать с Partnership выше —
// это отдельная сущность для учёта закупа/долгов по нему, не связанная с совместными счетами.
export interface Supplier {
  id: string;
  userId: string; // Owner (Manager)
  createdByUserId?: string;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  createdAt: string;
}


export interface CustomerDocument {
  id: string;
  name: string;
  category: 'passport' | 'guarantor' | 'contract' | 'other' | 'photo';
  fileUrl: string;           // base64 | /uploads/... | s3Key | temp_doc_*
  fileType: 'image' | 'pdf';
  uploadedAt: string;
  description?: string;
  fileSize?: number;

  _isTemp?: boolean;
  mimeType?: string;
}

export interface Customer {
  id: string;
  userId: string; // Owner
  createdByUserId?: string; // Actual creator (manager or employee id) — for audit/visibility
  createdAt?: string; // ISO String
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
  documents?: CustomerDocument[];
    passportSeries?: string;
  passportNumber?: string;
  passportIssuedBy?: string;

}

export interface Product {
  id: string;
  userId: string; // Owner
  name: string;
  price: number;
  category: string;
  stock: number;

  // 🛒 Поля магазина. Все необязательные: 14 товаров, заведённых до магазина,
  // должны продолжать работать без миграции.
  /** Артикул или штрихкод — по нему ищут на складе быстрее, чем по названию */
  sku?: string;
  /** Цена закупа: без неё маржу по рознице не посчитать */
  buyPrice?: number;
  /** Единица измерения: шт, кг, м. По умолчанию штуки */
  unit?: string;
  /** Ссылки на картинки. Первая — обложка карточки */
  images?: string[];
  /** Порог «мало на складе». Пусто — не следим */
  minStock?: number;
  description?: string;
  isArchived?: boolean;
  updatedAt?: string;
}

/**
 * Движение по складу. Остаток товара — это сумма движений, а не отдельно
 * хранимое число: без истории цифру невозможно объяснить, а именно на ней
 * сходятся все споры о недостаче.
 *
 * Поле Product.stock остаётся как быстрый снимок для списков, но истина здесь.
 */
/**
 * Позиция розничного чека. Название и цены копируются в момент продажи: товар
 * потом переименуют или переоценят, а чек должен остаться таким, каким был.
 */
export interface RetailSaleItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
  buyPrice?: number;
  unit?: string;
}

/** Розничная продажа за наличные. Отдельно от Sale: там рассрочка с графиком. */
export interface RetailSale {
  id: string;
  userId: string;
  accountId: string;
  /** Пусто — розничный покупатель без карточки клиента */
  customerId?: string;
  items: RetailSaleItem[];
  subtotal: number;
  discount: number;
  total: number;
  /** Себестоимость на момент продажи — чтобы маржа не поплыла при переоценке */
  cost: number;
  profit: number;
  note?: string;
  date: string;
  createdByUserId?: string;
  isCancelled?: boolean;
}

export type StockMovementType = 'IN' | 'SALE' | 'WRITE_OFF' | 'RETURN' | 'CORRECTION';

export interface StockMovement {
  id: string;
  userId: string;
  productId: string;
  type: StockMovementType;
  /** Со знаком: приход положительный, продажа и списание отрицательные */
  quantity: number;
  /** Цена за единицу на момент движения: закуп для прихода, продажи для продажи */
  unitPrice?: number;
  /** Продажа, из которой возникло движение */
  saleId?: string;
  note?: string;
  date: string;
  createdByUserId?: string;
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
  recordedByUserId?: string; // Who actually logged this payment (manager or employee id) — for audit/visibility
}

export interface Expense {
  id: string;
  userId: string; // Owner
  createdByUserId?: string; // Actual creator (manager or employee id) — for audit/visibility
  accountId: string; // Linked account
  title: string;
  amount: number;
  category: string;
  date: string;

  // 🔹 Опциональные поля для расширенной функциональности
  createdAt?: string;              // Дата создания записи
  description?: string;            // Подробное описание операции
  customerId?: string;             // Связь с клиентом (для возвратов)

  // 🔹 Типы выплат для инвесторов и возвратов
  payoutType?: 'INVESTMENT' | 'PROFIT' | 'REFUND' | 'OTHER' | string;

  // 🔹 Источник выплаты для менеджера
  managerPayoutSource?: 'CAPITAL' | 'PROFIT';

  /**
   * Чью прибыль уменьшает расход, списанный из прибыли:
   *  SHARED  — расход общего дела: делится между менеджером и инвесторами по долям счёта.
   *            Допустимо только если так договорились с инвесторами заранее.
   *  MANAGER — расход менеджера: вся сумма с его доли, инвесторы не затрагиваются.
   * Для зарплаты сотрудника по умолчанию MANAGER — он нанят менеджером.
   */
  profitSource?: 'SHARED' | 'MANAGER';

  // 🔹 Общий расход списан из заработанной прибыли, а не из оборотных средств.
  // Сумма делится между менеджером и инвесторами по их долям в счёте на дату расхода —
  // симметрично тому, как прибыль по этому счёту начисляется.
  // См. getManagerProfitDeduction / getInvestorProfitDeduction в src/utils.ts.
  fromProfit?: boolean;

  // 🔹 Флаг возврата (для фильтрации и отчётности)
  isRefund?: boolean;

  // 🔹 Для совместных счетов
  investorId?: string;
  employeeId?: string;

  // 🔹 Оплата поставщику (модуль "Партнеры")
  supplierId?: string;
  saleId?: string; // договор, долг по которому гасит этот расход

}

export interface Sale {
  id: string;
  userId: string; // Owner
  createdByUserId?: string; // Actual creator (manager or employee id) — for audit/visibility
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

  // 🔹 Долг перед поставщиком (модуль "Партнеры")
  supplierId?: string;
  partnerDebtPaidAmount?: number; // сколько уже оплачено поставщику по этому договору
  isPartnerDebtPaid?: boolean; // true когда partnerDebtPaidAmount >= buyPrice
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

export interface NotificationEventToggles {
  payment: boolean;
  newContract: boolean;
  contractClosed: boolean;
  expense: boolean;
  whatsappSent: boolean;
  adminBroadcast: boolean;
  supportMessage: boolean;
  taskDue: boolean;
}

export interface NotificationSettings {
  enabled: boolean;
  pushEnabled?: boolean;
  events: NotificationEventToggles;
}

export interface PushSubscriptionInfo {
  id: string;
  userAgent?: string;
  createdAt: string;
}

export interface AppSettings {
  companyName: string;
  sellerPhone?: string;
  whatsapp?: WhatsAppSettings;
  calculator?: CalculatorSettings;
  theme?: 'PURPLE' | 'BLUE' | 'GREEN' | 'BLACK';
  showCents?: boolean;
  markupFromNetBuyPrice?: boolean;
  notifications?: NotificationSettings;
  /**
   * Режим магазина: розничные продажи за наличные и склад.
   * Выключен по умолчанию — большинству он не нужен, а лишние разделы в меню
   * мешают. Доступен только на тарифе Бизнес Про; одного этого флага мало,
   * решение принимается вместе с проверкой тарифа.
   */
  shopEnabled?: boolean;
}

/**
 * Возможности тарифа. Приходят с сервера (PLAN_LIMITS в server/index.js) вместе
 * с ценами — интерфейс на их основе показывает, что теряется при понижении тарифа.
 * Значение -1 у числовых полей означает «без ограничений».
 */
export interface PlanLimits {
  contracts: number;
  investors: number;
  employees: number;
  whatsapp: boolean;
  ai: boolean;
  suppliers: boolean;
  investorPools: boolean;
  notifications: boolean;
  tasks: boolean;
  shop: boolean;
}

export type BackupFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

/**
 * Настройки резервного копирования на почту. Живут не в AppSettings, а в отдельной
 * таблице на сервере (backup_settings): приложение сохраняет AppSettings целиком,
 * и служебные отметки планировщика (nextRunAt/lastRunAt) затирались бы при каждом
 * сохранении любой другой настройки.
 */
export interface BackupSettings {
  enabled: boolean;
  frequency: BackupFrequency;
  /** Подтверждённый дополнительный адрес (кроме почты аккаунта). */
  extraEmail: string | null;
  extraEmailVerified: boolean;
  /** Адрес, для которого запрошен код, но подтверждение ещё не введено. */
  extraEmailPending: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: 'OK' | 'EMPTY' | 'ERROR' | 'SKIPPED' | 'OVERSIZED' | 'TOO_MANY' | null;
  lastError: string | null;
  accountEmail: string;
  plan: string;
  /** Что разрешает текущий тариф — решает сервер, интерфейс только отображает. */
  allowedFrequencies: BackupFrequency[];
}

export type NotificationType =
  | 'PAYMENT'
  | 'NEW_CONTRACT'
  | 'CONTRACT_CLOSED'
  | 'EXPENSE'
  | 'WHATSAPP_SENT'
  | 'ADMIN_BROADCAST'
  | 'SUPPORT_MESSAGE'
  | 'TASK_ASSIGNED'
  | 'TASK_DONE'
  | 'TASK_DUE'
  | 'REFERRAL_BONUS';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body?: string;
  data?: { saleId?: string; customerId?: string; expenseId?: string; ticketId?: string; amount?: number; [key: string]: any } | null;
  isRead: boolean;
  isArchived?: boolean;
  createdAt: string;
}


export interface WhatsAppReminderPayload {
  phone: string;
  customerName: string;
  productName: string;
  overdueAmount: number;
  monthsOverdue: number;
  template?: 'overdue';
}

export type ViewState =
  | 'DASHBOARD'
  | 'REFERRAL'
  | 'PARTNER'
  | 'WAREHOUSE'
  | 'RETAIL_SALE'
  | 'SHOP_REPORT'
  | 'CASH_REGISTER'
  | 'CUSTOMERS'
  | 'CUSTOMER_DETAILS'
  | 'MANAGE_PRODUCTS'
  | 'MORE'
  | 'OPERATIONS'
  | 'INVESTORS'
  | 'INVESTOR_DETAILS'
  | 'EMPLOYEE_ACTIVITY'
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
  | 'SUPPLIERS'
  | 'SUPPLIER_DETAILS'
  | 'TARIFFS'
  | 'ADMIN_SUPPORT'
  | 'ADMIN_PANEL'
  | 'TASKS'
  | 'NOTIFICATIONS';

// Задачи менеджера — личный список дел, не привязанный к договорам.
// Доступны на тарифах Бизнес и Бизнес Pro.
export interface Task {
  id: string;
  userId: string;
  title: string;
  note?: string;           // дополнительная информация
  dueDate?: string;        // ISO-строка; время внутри неё, если задано
  hasTime?: boolean;       // false — только дата, время не показываем
  isFavorite?: boolean;
  isDone?: boolean;
  completedAt?: string;
  createdAt: string;

  // Поручение сотруднику: пусто — личная задача менеджера.
  // Сервер отдаёт сотруднику только задачи с его assigneeId (filterDataForEmployee).
  assigneeId?: string;
  assigneeName?: string;   // снимок имени, чтобы список не зависел от загрузки сотрудников

  // Привязка к работе — задача из карточки клиента или договора
  customerId?: string;
  customerName?: string;
  saleId?: string;

  // Отметка cron-скрипта, что напоминание о наступившем сроке уже отправлено
  notifiedAt?: string;
}

// 🤝 Бизнес-партнёрство: процент с оплат приведённых клиентов.
// Отдельно от реферальной программы — та начисляет дни и один раз за клиента.
export interface PartnerRow {
  id: string;
  name: string;
  email: string;
  phone?: string;
  referral_code?: string;
  partner_percent: string | number | null;
  partner_since: string | null;
  /** null — бессрочно */
  partner_term_months: number | null;
  earned: string | number;
  paid: string | number;
  pending: string | number;
  clients: string | number;
}

export interface PartnerCommission {
  id: string;
  amount: string | number;
  base_amount: string | number;
  percent: string | number;
  status: 'accrued' | 'paid' | 'cancelled';
  created_at: string;
  plan: string;
  months: number;
  client_name: string | null;
}

export interface PartnerPayout {
  id: string;
  amount: string | number;
  method: string | null;
  receipt: string | null;
  note: string | null;
  created_at: string;
}

export interface PartnerSummary {
  isPartner: boolean;
  percent?: number;
  since?: string | null;
  termMonths?: number | null;
  totals?: { earned: number; paid: number; pending: number; clients: number };
  commissions?: PartnerCommission[];
  payouts?: PartnerPayout[];
}

// 🧾 Оплата подписки в админке. receipt_* — чек НПД из «Мой налог»:
// кассовый чек по 54-ФЗ самозанятый не выдаёт, ККТ он не применяет.
export interface AdminPayment {
  id: string;
  amount: string | number;
  plan: string;
  months: number;
  paid_at: string;
  receipt_number: string | null;
  receipt_url: string | null;
  refunded_at: string | null;
  user_name: string | null;
  user_email: string | null;
}
