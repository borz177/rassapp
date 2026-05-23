
import React, { useState, useEffect, useMemo } from 'react';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import CashRegister from './components/CashRegister';
import Investors from './components/Investors';
import Contracts from './components/Contracts';
import NewSale from './components/NewSale';
import NewIncome from './components/NewIncome';
import NewExpense from './components/NewExpense';
import SelectionList from './components/SelectionList';
import Products from './components/Products';
import Customers from './components/Customers';
import CustomerDetails from './components/CustomerDetails';
import InvestorDetails from './components/InvestorDetails';
import Employees from './components/Employees';
import Operations from './components/Operations';
import Settings from './components/Settings';
import Reports from './components/Reports';
import Profile from './components/Profile';
import Partners from './components/Partners';
import InvestorDashboard from './components/InvestorDashboard';
import Tariffs from './components/Tariffs';
import AdminPanel from './components/AdminPanel';
import Integrations from './components/Integrations';
import Calculator from './components/Calculator';
import Auth from './components/Auth';
import { Customer, Product, Sale, ViewState, Expense, User, Account, Investor, Payment, AppSettings, InvestorPermissions, Partnership, SubscriptionPlan } from './types';
import { getAppSettings, saveAppSettings } from './services/storage';
import { api } from './services/api';
import { ICONS } from './constants';
import SplashScreen from "./components/SplashScreen"

import SupportButton from './components/SupportButton';
import SupportChat from './components/SupportChat';
import AdminSupportPanel from './components/AdminSupportPanel';
import { formatCurrency, formatDate } from './src/utils';
import { useSwipeable } from "react-swipeable"

import Landing from './components/Landing.tsx';
import { NotificationModal } from './components/NotificationModal';


async function enablePersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {

    const isPersisted = await navigator.storage.persisted();

    if (!isPersisted) {
      const granted = await navigator.storage.persist();

    }

  }
}

const App: React.FC = () => {
    const path = window.location.pathname
const isLanding = path === "/"
  // Auth State
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPublicMode, setIsPublicMode] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);

  // App State
  const [currentView, setCurrentView] = useState<ViewState>('DASHBOARD');

  const [activeContractTab, setActiveContractTab] = useState<'ACTIVE' | 'OVERDUE' | 'ARCHIVE'>('ACTIVE');

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [employees, setEmployees] = useState<User[]>([]);
  const [partnerships, setPartnerships] = useState<Partnership[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings>({ companyName: 'FinUchet' });

  const [whatsappRefreshKey, setWhatsAppRefreshKey] = useState<number>(0);
  const [templatesRefreshKey, setTemplatesRefreshKey] = useState<number>(0);

  // Drafts & Temporary State
  const [draftSaleData, setDraftSaleData] = useState<any>({});
  const [previousView, setPreviousView] = useState<ViewState>('DASHBOARD');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedInvestorId, setSelectedInvestorId] = useState<string | null>(null);
  const [operationsAccountId, setOperationsAccountId] = useState<string | null>(null);
  const [editingSale, setEditingSale] = useState<Sale | null>(null);
  const [initialSaleIdForDetails, setInitialSaleIdForDetails] = useState<string | null>(null);

  const [moreExpandedSection, setMoreExpandedSection] = useState<string | null>(null);

  const [loadingProgress, setLoadingProgress] = useState(0)

  const [supportUnreadCount, setSupportUnreadCount] = useState(0);
  const [showSupportChat, setShowSupportChat] = useState(false);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);


  const [showSplash, setShowSplash] = useState(true);
  const [showBlockedDeleteModal, setShowBlockedDeleteModal] = useState<{
  customerId: string;
  customerName: string;
  contracts: Array<{ id: string; productName: string }>;
} | null>(null);

const [showSessionExpiredModal, setShowSessionExpiredModal] = useState(false);
const [sessionMessage, setSessionMessage] = useState('');
const [sessionHandlers, setSessionHandlers] = useState<{
  onConfirm: () => void;
  onCancel: () => void;
} | null>(null);

  const [myProfitPeriod, setMyProfitPeriod] = useState(() => {
    const today = new Date().toISOString().split('T')[0];
    return { start: '2023-01-01', end: today };
  });

  const [reportFilters, setReportFilters] = useState({
      investorId: 'ALL',
      period: myProfitPeriod
  });



  // 🔹 Состояние для модала уведомлений
const [showNotification, setShowNotification] = useState(false);
const [notificationData, setNotificationData] = useState<{
  title: string;
  message: string;
  type: 'success' | 'error' | 'warning';
  actionLabel?: string;
  onAction?: () => void;
} | null>(null);

// 🔹 Функция для показа уведомления (доступна из любых функций)
const showNotificationModal = (
  title: string,
  message: string,
  type: 'success' | 'error' | 'warning',
  actionLabel?: string,
  onAction?: () => void
) => {
  setNotificationData({ title, message, type, actionLabel, onAction });
  setShowNotification(true);
};



    const isNative =
  navigator.userAgent.includes("Electron") ||
  navigator.userAgent.includes("Android") ||
  navigator.userAgent.includes("wv")





 // 🔹 Вспомогательная функция для "умного" слияния данных (исправленная версия)
const mergeServerData = <T extends { id: string }>(
  current: T[],
  fresh: T[]
): T[] => {
  const freshMap = new Map<string, T>(fresh.map(item => [item.id, item]));

  const updated = current.map(item => {
    if (freshMap.has(item.id)) {
      return freshMap.get(item.id)!;
    }
    return item;
  });

  updated.forEach(item => freshMap.delete(item.id));
  return [...updated, ...Array.from(freshMap.values())];
};





  useEffect(() => {
      setReportFilters(prev => ({...prev, period: myProfitPeriod}));
  }, [myProfitPeriod]);

  // Network Status & Sync
  // 🔹 Network Status & Sync — ОБНОВЛЁННЫЙ
useEffect(() => {
    const handleOnline = async () => {
        setIsOnline(true);

        // 🔹 Небольшая задержка для стабилизации сети (чтобы запросы не отваливались)
        await new Promise(resolve => setTimeout(resolve, 800));

        // 🔹 Тихая фоновая синхронизация
        await handleSync();
    };

    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // 🔹 Initial Sync check — оставляем, чтобы проверить соединение при старте
    if (navigator.onLine) {
        // Запускаем синхронизацию с небольшой задержкой, чтобы не блокировать загрузку
        setTimeout(() => handleSync(), 1000);
    }

    return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
    };
}, []); // ✅ Пустой массив — подписка создаётся только один раз


 useEffect(() => {
  (window as any).__onSessionExpired = (
    message: string,
    onConfirm: () => void,
    onCancel: () => void
  ) => {
    setSessionMessage(message);
    setSessionHandlers({ onConfirm, onCancel });
    setShowSessionExpiredModal(true);
  };

  return () => {
    delete (window as any).__onSessionExpired;
  };
}, []);


// 🔹 В App.tsx — исправленная часть handleSync
const handleSync = async () => {
    if (!navigator.onLine) return;
    setIsSyncing(true);

    try {
        const result = await api.sync();

        if (result.success && result.syncedCollections.size > 0) {
            console.log(`🔄 Synced: ${[...result.syncedCollections].join(', ')}`);

            const updates: Record<string, any[]> = {};

            for (const collection of result.syncedCollections) {
                try {
                    // ✅ ИСПОЛЬЗУЕМ api.get() — он уже содержит URL и заголовки
                    const data = await api.get<any[]>(`/data/${collection}`);
                    updates[collection] = data;
                } catch (e) {
                    console.warn(`⚠️ Failed to fetch ${collection} for merge:`, e);
                }
            }

            // "Умно" мёржим данные
            if (updates.customers) setCustomers(prev => mergeServerData(prev, updates.customers));
            if (updates.sales) setSales(prev => mergeServerData(prev, updates.sales));
            if (updates.expenses) setExpenses(prev => mergeServerData(prev, updates.expenses));
            if (updates.accounts) setAccounts(prev => mergeServerData(prev, updates.accounts));
            if (updates.investors) setInvestors(prev => mergeServerData(prev, updates.investors));
            if (updates.products) setProducts(prev => mergeServerData(prev, updates.products));
            if (updates.partnerships) setPartnerships(prev => mergeServerData(prev, updates.partnerships));
        }
    } catch (e) {
        console.error("❌ Sync failed", e);
    } finally {
        setIsSyncing(false);
    }
};


useEffect(() => {

  setShowSplash(true);
  enablePersistentStorage();

  const initApp = async () => {
    // 1. Проверка на публичный режим
    const searchParams = new URLSearchParams(window.location.search);
    const pathName = window.location.pathname;

    if (
      searchParams.get('view') === 'public_calc' ||
      searchParams.get('v') === 'calc' ||
      decodeURIComponent(pathName).startsWith('/calc')
    ) {
      setIsPublicMode(true);
      setIsLoading(false);
      return;
    }

    // 2. Читаем токены
    const token = localStorage.getItem('token');
    const localUserStr = localStorage.getItem('user');
    let localUser: User | null = null;

    // 3. Восстанавливаем локального пользователя
    if (localUserStr) {
      try {
        localUser = JSON.parse(localUserStr);
        if (localUser) {

          setUser(localUser);
          // НЕ выключаем isLoading — попробуем обновить с сервера
          await loadData(localUser).catch(e => console.warn("⚠️ Local data warning:", e));
        }
      } catch (e) {
        console.error("❌ Failed to parse local user", e);
        localStorage.removeItem('user');
        localStorage.removeItem('token');
      }
    }

    // 4. Если онлайн и есть токен — обновляем с сервера
    if (token && navigator.onLine) {
      try {
        const freshUser = await api.getMe();
        setUser(freshUser);
        localStorage.setItem('user', JSON.stringify(freshUser));
        await loadData(freshUser, !!localUser);
      } catch (err) {
        console.error('❌ Auth refresh failed', err);
        // Если сервер отверг токен — очищаем всё
        if (!localUser) {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          setUser(null);
        }
        // Иначе остаёмся на локальных данных (оффлайн)
      }
    }

    // 5. Если нет ни токена, ни локального пользователя
    if (!token && !localUser) {
      setUser(null);
    }

    // 6. Загружаем настройки
    setAppSettings(getAppSettings());

    // 7. Выключаем загрузку
    setIsLoading(false);

    setTimeout(() => {
      setShowSplash(false);
    }, 700);
  };

  initApp();
}, []);


const subStatus = useMemo(() => {
  if (!user?.subscription) {
    return { planName: 'Free', daysLeft: 0, expired: false, isWarning: false };
  }

  const { plan, expiresAt } = user.subscription;
  const endDate = new Date(expiresAt);
  const today = new Date();
  const daysLeft = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  const planNames: Record<string, string> = {
    TRIAL: 'Тест',
    START: 'Старт',
    STANDARD: 'Стандарт',
    BUSINESS: 'Бизнес'
  };

  return {
    planName: planNames[plan] || plan,
    daysLeft: Math.max(0, daysLeft),
    expired: daysLeft <= 0,
    isWarning: daysLeft > 0 && daysLeft <= 7  // Предупреждение за неделю
  };
}, [user?.subscription]);
// После useEffect с initApp добавьте:
useEffect(() => {
  if (!user || user.role === 'admin') return;

  // Загружаем сразу
  loadSupportUnreadCount(user);

  // Проверяем каждые 30 секунд
  const interval = setInterval(() => {
    loadSupportUnreadCount(user);
  }, 30000);

  return () => clearInterval(interval);
}, [user]);

  const loadData = async (currentUser?: User, skipLoading = false) => {
      if (!skipLoading && customers.length === 0 && sales.length === 0) {
          setIsLoading(true);
      }
      try {
          const data = await api.fetchAllData();
          setCustomers(data.customers);
          setProducts(data.products);
          setSales(data.sales);
          setExpenses(data.expenses);
          setAccounts(data.accounts);
          setInvestors(data.investors);
          setPartnerships(data.partnerships);
          setEmployees(data.employees);

          let loadedSettings = data.settings || getAppSettings();

          // Merge WhatsApp settings from User Profile if available
          const activeUser = currentUser || user;
          if (activeUser?.whatsapp_settings) {
              loadedSettings = {
                  ...loadedSettings,
                  whatsapp: activeUser.whatsapp_settings
              };
          }

          setAppSettings(loadedSettings);
          saveAppSettings(loadedSettings); // Sync server data to local storage
      } catch (error) {
          console.error("Failed to load data", error);
      } finally {
          setIsLoading(false);
      }
  };

  const isManager = user?.role === 'manager' || user?.role === 'admin';
  const isEmployee = user?.role === 'employee';
  const isInvestor = user?.role === 'investor';
  const activeInvestor = isInvestor && user ? investors.find(i => i.id === user.id) : null;


  const loadSupportUnreadCount = async (currentUser: User) => {
  if (!currentUser || currentUser.role === 'admin') return;

  try {
    const response = await api.get<{
      tickets: Array<{ unreadCount: number }>;
      broadcasts: any[];
      totalUnread: number
    }>('/support/tickets');

    setSupportUnreadCount(response.totalUnread || 0);
  } catch (error) {
    console.error('Failed to load support unread count:', error);
  }
};

  // ... (Access checks and calculation logic remain the same)
  const checkAccess = (feature: 'WRITE' | 'INVESTORS' | 'AI' | 'WHATSAPP' | 'EMPLOYEES'): boolean => {
      if (!user) return false;
      if (isEmployee || isInvestor || user.role === 'admin') return true;
      const sub = user.subscription || { plan: 'TRIAL', expiresAt: new Date(0).toISOString() };
      const isExpired = new Date() > new Date(sub.expiresAt);
      if (isExpired && feature === 'WRITE') return false;
      const plan = sub.plan;
      switch(feature) {
          case 'WRITE': return !isExpired;
          case 'INVESTORS': return (plan === 'START' && investors.length < 1) || (plan === 'STANDARD' && investors.length < 5) || true;
          case 'AI': return plan === 'BUSINESS' || plan === 'TRIAL';
          case 'WHATSAPP': return plan === 'STANDARD' || plan === 'BUSINESS' || plan === 'TRIAL';
          case 'EMPLOYEES': return plan === 'BUSINESS' || plan === 'TRIAL';
          default: return true;
      }
  };

  const showUpgradeAlert = (reason: string) => { if(window.confirm(`${reason} Оформите подписку для доступа.`)) { setCurrentView('TARIFFS'); } };

  // ... (Stats calculations omitted for brevity as they are unchanged) ...
const dashboardStats = useMemo(() => {
  let totalRevenue = 0;
  let totalOutstanding = 0;
  let overdueCount = 0;
  let installmentSalesTotal = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // ✅ ФУНКЦИЯ: расчёт реальной просрочки
  const calculateSaleOverdue = (sale: Sale) => {
    let expectedTotal = sale.downPayment;
    sale.paymentPlan.forEach(p => {
      if (!p.isRealPayment && new Date(p.date) < today) {
        expectedTotal += p.amount;
      }
    });
    const totalPaid = sale.totalAmount - sale.remainingAmount;
    const overdue = expectedTotal - totalPaid;
    return Math.max(0, overdue);
  };

  sales.forEach(sale => {
    totalRevenue += (sale.totalAmount - sale.remainingAmount);
    totalOutstanding += sale.remainingAmount;
    // ✅ ПРОВЕРКА: реальная сумма просрочки > 0
    const overdueAmount = calculateSaleOverdue(sale);
    if (overdueAmount > 0) overdueCount++;
    if (sale.type === 'INSTALLMENT') {
      installmentSalesTotal += sale.totalAmount;
    }
  });
  return { totalRevenue, totalOutstanding, overdueCount, installmentSalesTotal };
}, [sales]);  const accountBalances = useMemo(() => { const balances: Record<string, number> = {}; accounts.forEach(acc => { let total = 0; const accountSales = sales.filter(s => s.accountId === acc.id); accountSales.forEach(s => { total += s.downPayment; s.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false).forEach(p => total += p.amount); }); const accountExpenses = expenses.filter(e => e.accountId === acc.id); total -= accountExpenses.reduce((sum, e) => sum + e.amount, 0); balances[acc.id] = total; }); return balances; }, [accounts, sales, expenses]);
  const workingCapital = useMemo(() => { const cashInAccounts = Object.values(accountBalances).reduce((sum: number, bal: number) => sum + bal, 0); return cashInAccounts + dashboardStats.totalOutstanding; }, [accountBalances, dashboardStats.totalOutstanding]);
  const totalExpectedProfit = useMemo(() => {
    if (!isManager) return 0;
    let totalProfit = 0;

    // Only consider active or completed sales that have a buy price
    const salesWithProfit = sales.filter(s => (s.status === 'ACTIVE' || s.status === 'COMPLETED') && s.buyPrice > 0);

    salesWithProfit.forEach(sale => {
        const saleProfit = sale.totalAmount - sale.buyPrice;
        if (saleProfit <= 0) return;

        const account = accounts.find(a => a.id === sale.accountId);
        let managerProfitShare = 1;

        if (account && account.ownerId) {
            const investor = investors.find(i => i.id === account.ownerId);
            if (investor) {
                managerProfitShare = (100 - investor.profitPercentage) / 100;
            }
        }

        totalProfit += saleProfit * managerProfitShare;
    });

    return totalProfit;
  }, [sales, accounts, investors, isManager]);
  const realizedPeriodProfit = useMemo(() => {
    if (!isManager) return 0;
    let periodProfit = 0;
    const startDate = new Date(myProfitPeriod.start);
    const endDate = new Date(myProfitPeriod.end);
    endDate.setHours(23, 59, 59, 999);

    const salesWithProfit = sales.filter(s => s.buyPrice > 0);

    salesWithProfit.forEach(sale => {
        const totalSaleProfit = sale.totalAmount - sale.buyPrice;
        if (sale.totalAmount <= 0 || totalSaleProfit <= 0) return;

        const profitMargin = totalSaleProfit / sale.totalAmount;
        const account = accounts.find(a => a.id === sale.accountId);
        let managerProfitShare = 1;

        if (account && account.ownerId) {
            const investor = investors.find(i => i.id === account.ownerId);
            if (investor) {
                managerProfitShare = (100 - investor.profitPercentage) / 100;
            }
        }

        // Collect all REAL money movements
        const allPayments = [
            { date: sale.startDate, amount: sale.downPayment, id: `${sale.id}_dp`, isRealPayment: true },
            ...sale.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false) // Exclude plan items
        ];

        allPayments.forEach(p => {
            const paymentDate = new Date(p.date);
            if (paymentDate >= startDate && paymentDate <= endDate && p.amount > 0) {
                const profitFromPayment = p.amount * profitMargin;
                periodProfit += profitFromPayment * managerProfitShare;
            }
        });
    });
    return periodProfit;
  }, [sales, accounts, investors, myProfitPeriod, isManager]);
  const reportData = useMemo(() => {
    if (!isManager) return null;
    const { investorId, period } = reportFilters;
    const startDate = new Date(period.start);
    const endDate = new Date(period.end);
    endDate.setHours(23, 59, 59, 999);

    let filteredSales = sales;
    if (investorId !== 'ALL') {
        const investorAccount = accounts.find(a => a.ownerId === investorId);
        if (investorAccount) {
            filteredSales = sales.filter(s => s.accountId === investorAccount.id);
        } else {
            filteredSales = sales.filter(s => accounts.find(a => a.id === s.accountId)?.ownerId === investorId);
        }
    }

    let customerPaymentsInPeriod = 0;

    filteredSales.forEach(sale => {
        const allPayments = [
            { date: sale.startDate, amount: sale.downPayment, isRealPayment: true },
            ...sale.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false) // Exclude plan items
        ];

        allPayments.forEach(p => {
            const paymentDate = new Date(p.date);
            if (paymentDate >= startDate && paymentDate <= endDate) {
                customerPaymentsInPeriod += p.amount;
            }
        });
    });

    let expectedManagerProfit = 0;
    let expectedInvestorProfit = 0;

    // Expected profit should include both ACTIVE and COMPLETED sales
    const salesForExpectation = (investorId === 'ALL' ? sales : filteredSales)
        .filter(s => (s.status === 'ACTIVE' || s.status === 'COMPLETED') && s.buyPrice > 0);

    salesForExpectation.forEach(sale => {
        const saleProfit = sale.totalAmount - sale.buyPrice;
        if (saleProfit <= 0) return;

        const account = accounts.find(a => a.id === sale.accountId);
        if (account?.ownerId) {
            const investor = investors.find(i => i.id === account.ownerId);
            if (investor) {
                const investorShare = saleProfit * (investor.profitPercentage / 100);
                expectedInvestorProfit += investorShare;
                expectedManagerProfit += saleProfit - investorShare;
            } else {
                expectedManagerProfit += saleProfit;
            }
        } else {
            expectedManagerProfit += saleProfit;
        }
    });

    let realizedManagerProfit = 0;
    let realizedInvestorProfit = 0;

    filteredSales.forEach(sale => {
        if (sale.buyPrice <= 0 || sale.totalAmount <= sale.buyPrice) return;

        const totalSaleProfit = sale.totalAmount - sale.buyPrice;
        const profitMargin = totalSaleProfit / sale.totalAmount;
        const account = accounts.find(a => a.id === sale.accountId);

        let managerProfitSharePercent = 1.0;
        if (account?.ownerId) {
            const investor = investors.find(i => i.id === account.ownerId);
            if (investor) {
                managerProfitSharePercent = (100 - investor.profitPercentage) / 100;
            }
        }

        const paymentsInPeriod = [
            { date: sale.startDate, amount: sale.downPayment, isRealPayment: true },
            ...sale.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false) // Exclude plan items
        ].filter(p => {
            const pDate = new Date(p.date);
            return pDate >= startDate && pDate <= endDate;
        });

        paymentsInPeriod.forEach(p => {
            const profitFromPayment = p.amount * profitMargin;
            realizedManagerProfit += profitFromPayment * managerProfitSharePercent;
            realizedInvestorProfit += profitFromPayment * (1 - managerProfitSharePercent);
        });
    });

    return {
        customerPaymentsInPeriod,
        expectedManagerProfit,
        expectedInvestorProfit,
        realizedManagerProfit,
        realizedInvestorProfit,
    };
  }, [reportFilters, sales, accounts, investors, isManager]);

  const handleAuthSuccess = async (loggedInUser: User) => {
      setUser(loggedInUser);
      await loadData(loggedInUser);
  };

  const handleAction = (action: string) => {
      switch (action) {
          case 'CREATE_SALE': setDraftSaleData({}); setEditingSale(null); setCurrentView('CREATE_SALE'); break;
          case 'INCOME': setDraftSaleData({}); setCurrentView('CREATE_INCOME'); break;
          case 'EXPENSE': setCurrentView('CREATE_EXPENSE'); break;
          case 'OPERATIONS': setOperationsAccountId(null); setCurrentView('OPERATIONS'); break;
          case 'MANAGE_PRODUCTS': setCurrentView('MANAGE_PRODUCTS'); break;
          case 'ADD_CUSTOMER': setCurrentView('CUSTOMERS'); break;
          case 'ADD_PRODUCT': setCurrentView('MANAGE_PRODUCTS'); break;
      }
  };

const updateList = <T extends { id: string }>(
  setter: React.Dispatch<React.SetStateAction<T[]>>,
  item: T,
  oldId?: string,           // ← Старый ID, если он менялся (для замены)
  storageKey?: string       // ← Ключ localStorage для отладки (опционально)
) => {
  setter(prev => {
    // 🔹 Защита от невалидных данных
    if (!item?.id) {
      console.warn('⚠️ updateList: item without id', item);
      return prev;
    }

    let newList: T[];

    // 🔹 СЛУЧАЙ 1: Меняем ID (старый → новый)
    if (oldId && oldId !== item.id) {
      // 1. Удаляем старый элемент
      const withoutOld = prev.filter(i => i.id !== oldId);

      // 2. Проверяем, нет ли уже нового (защита от дублей)
      const exists = withoutOld.some(i => i.id === item.id);

      if (exists) {
        // Уже есть — просто возвращаем список без старого
        newList = withoutOld;

      } else {
        // Добавляем новый в начало
        newList = [item, ...withoutOld];

      }
    }
    // 🔹 СЛУЧАЙ 2: Обновляем существующий или добавляем новый
    else {
      const idx = prev.findIndex(i => i.id === item.id);

      if (idx >= 0) {
        // Обновляем существующий
        newList = prev.map(i => i.id === item.id ? item : i);

      } else {
        // Добавляем новый в начало
        newList = [item, ...prev];

      }
    }

    // 🔹 ОТЛАДКА: Принудительное сохранение в localStorage (только для отладки!)
    if (storageKey && typeof window !== 'undefined') {
      try {
        localStorage.setItem(storageKey, JSON.stringify(newList));

      } catch (e) {
        console.error(`❌ Failed to save to localStorage["${storageKey}"]`, e);
      }
    }

    return newList;
  });
};
const removeFromList = <T extends { id: string }>(setter: React.Dispatch<React.SetStateAction<T[]>>, id: string) => { setter(prev => prev.filter(i => i.id !== id)); };

// 🔹 Фильтрация данных для сотрудника по разрешённым инвесторам
const filterDataForEmployee = <T extends { accountId?: string; ownerId?: string }>(
  items: T[],
  allowedInvestorIds: string[] | undefined,
  accounts: Account[]
): T[] => {
  // Если нет ограничений — возвращаем всё
  if (!allowedInvestorIds || allowedInvestorIds.length === 0) return items;

  return items.filter(item => {
    // Если у элемента есть accountId — проверяем, принадлежит ли он разрешённому инвестору
    if (item.accountId) {
      const account = accounts.find(a => a.id === item.accountId);
      return account?.ownerId && allowedInvestorIds.includes(account.ownerId);
    }
    // Если у элемента есть ownerId (например, сам инвестор)
    if (item.ownerId) {
      return allowedInvestorIds.includes(item.ownerId);
    }
    return false;
  });
};

// ✅ ОБНОВЛЁННЫЙ handleSaveSale — проверка лимита + правильная обработка ошибок
const handleSaveSale = async (data: any): Promise<any> => {
  if (!user) return;

  try {
    // 🔹 1. ПРОВЕРКА ЛИМИТА ПЕРЕД СОХРАНЕНИЕМ (работает и онлайн, и офлайн!)
    const limitCheck = await api.checkLocalContractLimit(sales);
    if (!limitCheck.allowed) {
      // Создаём ошибку с флагом для распознавания в catch
      const limitError: any = new Error('LIMIT_EXCEEDED');
      limitError.isLimitError = true;
      limitError.message = limitCheck.reason;
      limitError.hint = 'Удалите старые договоры или оформите подписку выше.';
      limitError.details = limitCheck; // для отладки
      throw limitError; // 🔥 Останавливаем выполнение
    }

    // 🔹 2. Подготовка данных
    const ownerId = isEmployee && user.managerId ? user.managerId : user.id;
    const saleId = data.id || Date.now().toString();

    const paymentScheduleStartDate = data.paymentDate
      ? new Date(data.paymentDate)
      : new Date(data.startDate);
    if (!data.paymentDate) {
      paymentScheduleStartDate.setMonth(paymentScheduleStartDate.getMonth() + 1);
    }
    const preferredDay = paymentScheduleStartDate.getDate();

    const saleData = {
      ...data,
      id: saleId,
      userId: ownerId,
      paymentDay: preferredDay,
      paymentPlan: data.type === 'CASH'
        ? []
        : (data.paymentPlan || Array.from({ length: data.installments }).map((_, idx) => {
            const pDate = new Date(paymentScheduleStartDate);
            pDate.setMonth(pDate.getMonth() + idx);
            return {
              id: `pay_${Date.now()}_${idx}`,
              saleId: saleId,
              amount: Number((data.remainingAmount / data.installments).toFixed(2)),
              date: pDate.toISOString(),
              isPaid: false,
              isRealPayment: false
            };
          }))
    };

    const existingSaleIndex = sales.findIndex(s => s.id === data.id);
    const saleToSave = existingSaleIndex >= 0
      ? { ...sales[existingSaleIndex], ...saleData }
      : { ...saleData, status: data.type === 'CASH' ? 'COMPLETED' : 'ACTIVE' };

    // 🔹 3. Сохранение на сервер
    const savedSale = await api.saveItem('sales', saleToSave);

    // 🔹 4. Обновление стейта только после успешного сохранения
    updateList(setSales, savedSale);

    // 🔹 5. Создаём расход закупа (если есть)
    if (existingSaleIndex < 0 && Number(data.buyPrice) > 0) {
      const buyPriceExpense: Expense = {
        id: `exp_sale_${saleId}`,
        userId: ownerId,
        accountId: data.accountId,
        title: `Закуп: ${data.productName}`,
        amount: Number(data.buyPrice),
        category: 'Себестоимость',
        date: data.startDate,
        isRefund: false
      };
      const savedExpense = await api.saveItem('expenses', buyPriceExpense);
      updateList(setExpenses, savedExpense);
    }

    // 🔹 6. Обновляем остатки товара
    if (existingSaleIndex < 0 && data.productId) {
      const prod = products.find(p => p.id === data.productId);
      if (prod) {
        const updatedProd = { ...prod, stock: prod.stock - 1 };
        const savedProd = await api.saveItem('products', updatedProd);
        updateList(setProducts, savedProd);
      }
    }

    // 🔹 7. Возвращаем для цепочки Promise (успех)
    setEditingSale(null);
    return savedSale;

  } catch (error: any) {
    console.error('❌ Save sale error:', error);

    // 🔹 Обработка ошибки лимита
    if (error.isLimitError === true) {
      // Показываем уведомление через глобальную функцию
      showNotificationModal(
        '🚫 Лимит превышен',
        `${error.message}\n\n${error.hint || ''}`.trim(),
        'error',
        'Перейти к тарифам',
        () => setCurrentView('TARIFFS')
      );
      // 🔥 ВАЖНО: пробрасываем ошибку, чтобы handleConfirm в NewSale.tsx НЕ показал успех!
      throw error;
    }

    // 🔹 Обработка сетевых ошибок (офлайн-режим)
    if (error.message?.includes('Failed to fetch') || !navigator.onLine) {
      // 🔥 ПОВТОРНАЯ ПРОВЕРКА ЛИМИТА перед добавлением в офлайн-очередь!
      const offlineLimitCheck = await api.checkLocalContractLimit(sales);
      if (!offlineLimitCheck.allowed) {
        showNotificationModal(
          '🚫 Лимит превышен',
          `${offlineLimitCheck.reason}\n\n💡 В офлайн-режиме тоже действует лимит!`,
          'error'
        );
        return; // 🔥 НЕ добавляем в очередь!
      }

      // Если лимит не превышен — показываем офлайн-уведомление
      showNotificationModal(
        '⚠️ Офлайн-режим',
        'Нет соединения с сервером.\n\nДоговор сохранён локально и будет синхронизирован при подключении.',
        'warning'
      );

      // Оптимистичное обновление: добавляем в локальный стейт
      const tempSale = { ...data, id: `temp_${Date.now()}`, _isOffline: true };
      updateList(setSales, tempSale);
      setEditingSale(null);
      return tempSale;
    }

    // 🔹 Другие ошибки сервера
    showNotificationModal(
      '❌ Ошибка сохранения',
      error.message || 'Не удалось сохранить договор. Попробуйте ещё раз.',
      'error'
    );

    // 🔥 Пробрасываем ошибку, чтобы handleConfirm не показал успех
    throw error;
  }
};
const handleStartEditSale = (sale: Sale) => { setEditingSale(sale); setCurrentView('CREATE_SALE'); };
const handleDeleteSale = async (saleId: string) => {
    if (!window.confirm("Вы уверены, что хотите удалить этот договор?")) {
        return;
    }

    const sale = sales.find(s => s.id === saleId);
    if (!sale) {
        alert("Договор не найден");
        return;
    }

    // 🔹 1. Проверка: есть ли оплаченные платежи по графику?
    const installmentPayments = sale.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false);
    const installmentAmount = installmentPayments.reduce((sum, p) => sum + Number(p.amount), 0);

    if (installmentAmount > 0) {
        alert(
            `❌ Нельзя удалить договор с платежами по графику.\n\n` +
            `Оплачено по графику: ${formatCurrency(installmentAmount, appSettings?.showCents)} ₽\n\n` +
            `Сначала отмените все платежи в карточке клиента.`
        );
        return;
    }

    try {
        // 🔹 2. ВОЗВРАТ ПЕРВОГО ВЗНОСА (если был)
        if (sale.downPayment > 0 && sale.accountId) {
            const refundExpense: Expense = {
                id: `refund_${saleId}_${Date.now()}`,
                userId: sale.userId,
                accountId: sale.accountId,
                title: `Возврат: ${sale.productName}`,
                amount: sale.downPayment,
                category: 'Возврат клиента',
                date: new Date().toISOString(),
                isRefund: true,  // 🔥 Ключевой флаг!
                payoutType: undefined,
                investorId: undefined
            };
            await api.saveItem('expenses', refundExpense);
            updateList(setExpenses, refundExpense);
        }

        // 🔹 3. 🎯 УДАЛЕНИЕ РАСХОДА ЗАКУПА (надёжный поиск)
        if (sale.buyPrice > 0 && sale.accountId) {
            // Ищем расход закупа по нескольким критериям
            const buyExpense = expenses.find(e =>
                e.accountId === sale.accountId &&
                e.category === 'Себестоимость' &&
                e.title?.includes(sale.productName) &&
                Math.abs(e.amount - sale.buyPrice) < 0.01 // Сравнение с допуском
            );

            if (buyExpense) {
                // Удаляем с сервера
                await api.deleteItem('expenses', buyExpense.id).catch(() => {
                    // Игнорируем, если не найдено на сервере
                });
                // Удаляем из локального стейта
                removeFromList(setExpenses, buyExpense.id);
                console.log(`✅ Удалён расход закупа: ${buyExpense.id}`);
            } else {
                console.warn(`⚠️ Расход закупа не найден для договора ${saleId}`);
            }
        }

        // 🔹 4. Удаляем сам договор
        await api.deleteItem('sales', saleId);
        removeFromList(setSales, saleId);

        // 🔹 5. Возвращаем товар на склад
        if (sale.productId) {
            const prod = products.find(p => p.id === sale.productId);
            if (prod) {
                const updatedProd = {
                    ...prod,
                    stock: (prod.stock || 0) + 1,
                    updatedAt: new Date().toISOString()
                };
                const savedProd = await api.saveItem('products', updatedProd);
                updateList(setProducts, savedProd);
            }
        }

        alert('✅ Договор удалён');

    } catch (error) {
        console.error('❌ Ошибка удаления договора:', error);
        alert('Не удалось удалить договор.');
    }
};
const handleViewSaleSchedule = (sale: Sale) => { setSelectedCustomerId(sale.customerId); setInitialSaleIdForDetails(sale.id); setPreviousView('CONTRACTS'); setCurrentView('CUSTOMER_DETAILS'); };
const handleIncomeSubmit = async (data: any) => {
    if (!user) return;

    if (data.type === 'CUSTOMER_PAYMENT') {
        const { saleId, amount } = data;
        const sale = sales.find(s => s.id === saleId);

        if (sale) {
            const updatedSale = { ...sale };
            updatedSale.remainingAmount = Math.max(0, updatedSale.remainingAmount - amount);
            updatedSale.paymentPlan.push({
                id: `paid_${Date.now()}`,
                saleId: sale.id,
                amount: amount,
                date: data.date,
                isPaid: true,
                isRealPayment: true
            });

            if (updatedSale.remainingAmount === 0) updatedSale.status = 'COMPLETED';

            const savedSale = await api.saveItem('sales', updatedSale);
            updateList(setSales, savedSale);

            // 👇 ПОСЛЕ УСПЕШНОГО СОХРАНЕНИЯ ПЕРЕХОДИМ К ДЕТАЛЯМ ДОГОВОРА
            // Сохраняем ID для перехода
            setSelectedCustomerId(sale.customerId);
            setInitialSaleIdForDetails(saleId);
            setPreviousView(currentView);
            setCurrentView('CUSTOMER_DETAILS');

            return; // Выходим, чтобы не попасть в другой код
        }
    } else {
        const ownerId = isEmployee && user.managerId ? user.managerId : user.id;
        const newTransaction: Sale = {
            id: `inc_${Date.now()}`,
            userId: ownerId,
            type: 'CASH',
            customerId: data.investorId || 'system_income',
            productName: data.note || 'Приход',
            buyPrice: 0,
            accountId: data.accountId,
            totalAmount: data.amount,
            downPayment: data.amount,
            remainingAmount: 0,
            interestRate: 0,
            installments: 0,
            startDate: data.date,
            status: 'COMPLETED',
            paymentPlan: []
        };
        const savedTx = await api.saveItem('sales', newTransaction);
        updateList(setSales, savedTx);

        if (data.type === 'INVESTOR_DEPOSIT') {
            const inv = investors.find(i => i.id === data.investorId);
            if (inv) {
                const updatedInv = { ...inv, initialAmount: (inv.initialAmount || 0) + Number(data.amount) };
                const savedInv = await api.saveItem('investors', updatedInv);
                updateList(setInvestors, savedInv);
            }
        }

        setCurrentView('OPERATIONS'); // Для инвестора и прочего оставляем как было
    }
};  const handleExpenseSubmit = async (data: any) => { if (!user) return; const ownerId = isEmployee && user.managerId ? user.managerId : user.id; const newExpense: Expense = { id: crypto.randomUUID(), userId: ownerId, accountId: data.accountId, title: data.title, amount: data.amount, category: data.category, date: data.date, payoutType: data.payoutType, managerPayoutSource: data.managerPayoutSource, investorId: data.investorId }; const savedExpense = await api.saveItem('expenses', newExpense); updateList(setExpenses, savedExpense); if(data.payoutType === 'INVESTMENT' && data.investorId) { const inv = investors.find(i => i.id === data.investorId); if (inv) { const updatedInv = { ...inv, initialAmount: inv.initialAmount - data.amount }; const savedInv = await api.saveItem('investors', updatedInv); updateList(setInvestors, savedInv); } } setCurrentView('OPERATIONS'); };
  const handleAddEmployee = async (data: any) => { if (user && isManager) { if (!checkAccess('EMPLOYEES')) { showUpgradeAlert("Сотрудники доступны в тарифе Бизнес."); return; } try { const newEmp = await api.createSubUser({ ...data, role: 'employee' }); setEmployees(prev => [...prev, newEmp]); } catch(e) { alert("Ошибка создания сотрудника"); console.error(e); } } };
  const handleUpdateEmployee = async (updatedData: User) => { if (isManager) { await api.updateUser(updatedData); updateList(setEmployees, updatedData); } };
  const handleDeleteEmployee = async (id: string) => { if (isManager) { await api.deleteUser(id); removeFromList(setEmployees, id); } };
const handleAddInvestor = async (
  name: string,
  phone: string,
  email: string,
  pass: string,
  amount: number, // теперь может быть 0
  profitPercentage: number,
  permissions: InvestorPermissions
) => {
  if (!user || !isManager) return;

  if (!checkAccess('INVESTORS')) {
    showUpgradeAlert("Превышен лимит инвесторов для вашего тарифа.");
    return;
  }

  try {
    // 1. Создаём пользователя
    const newInvestorUser = await api.createSubUser({
      name,
      email,
      password: pass,
      role: 'investor',
      phone,
      permissions
    });

    // 2. Создаём запись инвестора
    const newInvestor: Investor = {
      id: newInvestorUser.id,
      userId: user.id,
      name,
      phone,
      email,
      initialAmount: amount, // может быть 0
      joinedDate: new Date().toISOString(),
      profitPercentage,
      permissions
    };

    const savedInv = await api.saveItem('investors', newInvestor);
    updateList(setInvestors, savedInv);

    // 3. Создаём счёт инвестора
    const newAccount: Account = {
      id: `acc_${newInvestorUser.id}`,
      userId: user.id,
      name: `Счет: ${name}`,
      type: 'INVESTOR',
      ownerId: newInvestorUser.id,
      currency: 'RUB',
      isArchived: false
    };

    const savedAcc = await api.saveItem('accounts', newAccount);
    updateList(setAccounts, savedAcc);

    // 4. 🔹 Создаём транзакцию депозита ТОЛЬКО если сумма > 0
    if (amount > 0) {
      const depositTransaction: Sale = {
        id: `dep_${Date.now()}`,
        userId: user.id,
        type: 'CASH',
        customerId: `system_deposit_${newInvestorUser.id}`,
        productName: 'Начальный депозит',
        buyPrice: 0,
        accountId: newAccount.id,
        totalAmount: amount,
        downPayment: amount,
        remainingAmount: 0,
        interestRate: 0,
        installments: 0,
        startDate: new Date().toISOString(),
        status: 'COMPLETED',
        paymentPlan: []
      };

      const savedTx = await api.saveItem('sales', depositTransaction);
      updateList(setSales, savedTx);
    }

    alert("✅ Инвестор создан!");
    return newInvestorUser;

  } catch(e: any) {
    if (e.message?.includes('Email уже занят') || e.message?.includes('already exists')) {
      alert('⚠️ Email уже занят');
      return;
    }
    console.error("❌ Ошибка создания инвестора:", e);
    alert(`Ошибка: ${e.message || 'Не удалось создать инвестора'}`);
    throw e;
  }
};




const handleUpdateInvestor = async (updated: Investor, password?: string) => {
  if (!isManager) return;

  try {
    const hasEmail = updated.email && updated.email.trim().length > 0;
    const hasPassword = password && password.trim().length > 0;
    const isImportedWithoutUser = updated.id.startsWith('inv_') && !updated.id.startsWith('u_inv_');

    // 🔹 АКТИВАЦИЯ: если есть email и (пароль или импортирован без пользователя)
    const needsActivation = hasEmail && (hasPassword || isImportedWithoutUser);

    if (needsActivation && !updated.id.startsWith('u_inv_') && !updated.id.startsWith('u_emp_')) {
      const oldInvestorId = updated.id;
      const oldAccount = accounts.find(a => a.ownerId === oldInvestorId);

      // 🔹 🔥 ОДНО ОБЪЯВЛЕНИЕ tempPassword
      const tempPassword = hasPassword ? password : `auto_${Math.random().toString(36).substr(2, 8)}`;

      // 🔹 1. Создаём ПОЛЬЗОВАТЕЛЯ — сервер сам проверит email глобально
      let newUser;
      try {
        newUser = await api.createSubUser({
          name: updated.name,
          email: updated.email!.trim(),
          password: tempPassword,
          role: 'investor',
          phone: updated.phone || '',
          permissions: updated.permissions || {}
        });
      } catch (userErr: any) {
        // 🔹 🔥 ПРОСТАЯ обработка: только "Email уже занят"
        if (userErr.message?.includes('Email уже занят') || userErr.message?.includes('already exists')) {
          alert('⚠️ Email уже занят');
          return;
        }
        throw userErr;
      }

      // 🔹 2. Создаём инвестора с НОВЫМ ID (ID пользователя)
      const linkedInvestor: Investor = {
        ...updated,
        id: newUser.id,           // 🔑 Новый ID = ID пользователя
        userId: user!.id,         // 🔑 ownerId менеджера
        email: updated.email!.trim(),
        phone: updated.phone,
        // 🔥 ЯВНО КОПИРУЕМ ВСЕ ПОЛЯ
        profitPercentage: updated.profitPercentage,
        initialAmount: updated.initialAmount,
        joinedDate: updated.joinedDate,
        permissions: updated.permissions
      };

      const savedInvestor = await api.saveItem('investors', linkedInvestor);

      // 🔹 3. 🗑️ УДАЛЯЕМ СТАРОГО ИНВЕСТОРА С СЕРВЕРА (КРИТИЧНО!)
      try {
        await api.deleteItem('investors', oldInvestorId);
        console.log(`🗑️ Старый инвестор ${oldInvestorId} удалён`);
      } catch (delErr) {
        console.warn('⚠️ Не удалось удалить старого инвестора:', delErr);
      }

      // 🔹 4. Обновляем локальный стейт: ЗАМЕНЯЕМ старого на нового
      setInvestors(prev => {
        const withoutOld = prev.filter(i => i.id !== oldInvestorId);
        // Проверка на дубликат по email
        const isDuplicate = withoutOld.some(i =>
          i.email?.toLowerCase() === updated.email?.toLowerCase() && i.id !== newUser.id
        );
        return isDuplicate ? withoutOld : [savedInvestor, ...withoutOld];
      });

      // 🔹 5. Транзакции депозита (если есть сумма и счёт)
      if (updated.initialAmount > 0 && oldAccount) {
        const depositTransaction: Sale = {
          id: `dep_activate_${newUser.id}_${Date.now()}`,
          userId: user!.id,
          type: 'CASH',
          customerId: `system_deposit_${newUser.id}`,
          productName: 'Начальный депозит (активация)',
          buyPrice: 0,
          accountId: oldAccount.id,
          totalAmount: updated.initialAmount,
          downPayment: updated.initialAmount,
          remainingAmount: 0,
          interestRate: 0,
          installments: 0,
          startDate: new Date().toISOString(),
          status: 'COMPLETED',
          paymentPlan: []
        };
        await api.saveItem('sales', depositTransaction);
        updateList(setSales, depositTransaction, undefined, 'sales');
      }

      // 🔹 6. Обновляем счёт: меняем ownerId
      if (oldAccount) {
        const updatedAccount = {
          ...oldAccount,
          ownerId: newUser.id,
          name: `Счет: ${updated.name}`
        };
        const savedAccount = await api.saveItem('accounts', updatedAccount);
        setAccounts(prev => {
          const withoutOld = prev.filter(a => a.id !== oldAccount.id);
          return [savedAccount, ...withoutOld];
        });
      }

      alert(`✅ Инвестор активирован!\nЛогин: ${updated.email}\nПароль: ${tempPassword}`);

      // 🔹 7. Перезагружаем данные с задержкой
      setTimeout(() => loadData(), 1000);
      return; // 🔥 ВАЖНО: выходим!
    }

    // ========================================
    // ОБЫЧНОЕ ОБНОВЛЕНИЕ (без активации)
    // ========================================
    const saved = await api.saveItem('investors', updated);
    updateList(setInvestors, saved, undefined, 'investors');

    // Обновляем пользователя ТОЛЬКО если это уже активированный инвестор
    if (updated.id.startsWith('u_inv_') || updated.id.startsWith('u_emp_')) {
      const userUpdateData: any = {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        phone: updated.phone,
        permissions: updated.permissions,
        allowedInvestorIds: updated.allowedInvestorIds || []
      };

      if (hasPassword) {
        userUpdateData.password = password;
      }

      try {
        await api.updateUser(userUpdateData);
      } catch (userErr) {
        console.warn('⚠️ Не удалось обновить пользователя:', userErr);
      }
    }

    alert(hasPassword ? "✅ Инвестор и пароль обновлены!" : "✅ Инвестор обновлён!");

  } catch (error: any) {
    // 🔹 🔥 ПРОСТАЯ обработка ошибки занятого email
    if (error.message?.includes('Email уже занят') || error.message?.includes('already exists')) {
      alert('⚠️ Email уже занят');
      return;
    }
    console.error('❌ Ошибка обновления инвестора:', error);
    alert(`Не удалось обновить: ${error.message}`);
  }
};




 const handleDeleteInvestor = async (id: string) => {
  if (!isManager) return;
  if (!window.confirm('Удалить инвестора?')) return;

  try {
    // 1. Удаляем пользователя
    await api.deleteUser(id);

    // 2. ✅ Обновляем UI напрямую (без хелпера)
    setInvestors(prev => prev.filter(inv => inv.id !== id));

    // 3. Удаляем связанный счёт
    const acc = accounts.find(a => a.ownerId === id);
    if (acc) {
      await api.deleteItem('accounts', acc.id);
      setAccounts(prev => prev.filter(a => a.id !== acc.id));
    }

    // 4. ✅ Перезагружаем данные для синхронизации
    setTimeout(() => loadData(), 500);

  } catch (error) {
    console.error('Ошибка удаления инвестора:', error);
    alert('Не удалось удалить инвестора');
    // ✅ Откат: перезагружаем данные
    loadData();
  }
};



const handleDeleteCustomer = async (customerId: string) => {
  // 🔹 1. ГЛАВНАЯ ПРОВЕРКА: есть ли привязанные договоры?
  const customerSales = sales.filter(s => s.customerId === customerId);

  if (customerSales.length > 0) {
    // 🔹 Вместо alert — открываем красивую модалку
    setShowBlockedDeleteModal({
      customerId,
      customerName: customers.find(c => c.id === customerId)?.name || 'Клиент',
      contracts: customerSales.map(s => ({
        id: s.id,
        productName: s.productName
      }))
    });
    return;
  }

  // 🔹 2. Если договоров нет — показываем модалку подтверждения удаления
  setShowDeleteConfirm(customerId);
};

// 🔹 Внутренняя функция для фактического удаления (вызывается после подтверждения)
const confirmDeleteCustomer = async () => {
  const customerId = showDeleteConfirm;
  if (!customerId) return;

  try {
    // 🔹 3. Удаляем с сервера (и в очередь офлайн-режима)
    await api.deleteItem('customers', customerId);

    // 🔹 4. Обновляем локальный стейт
    removeFromList(setCustomers, customerId);

    // 🔹 5. Если открыта детальная страница — закрываем её
    if (selectedCustomerId === customerId) {
      setSelectedCustomerId(null);
      setCurrentView(previousView === 'CUSTOMER_DETAILS' ? 'CUSTOMERS' : previousView);
    }

    // 🔹 6. Уведомление об успехе
    alert('✅ Клиент успешно удален');

  } catch (error) {
    console.error('❌ Ошибка удаления клиента:', error);
    alert('Не удалось удалить клиента. Проверьте подключение к интернету.');
  } finally {
    // 🔹 Закрываем модалку в любом случае
    setShowDeleteConfirm(null);
  }
};



  const handleAddProduct = async (name: string, price: number, stock: number) => { if (!checkAccess('WRITE')) { showUpgradeAlert("Срок подписки истек."); return; } if (user) { const ownerId = isEmployee && user.managerId ? user.managerId : user.id; const newProd = { id: crypto.randomUUID(), userId: ownerId, name, price, category: 'Общее', stock }; const saved = await api.saveItem('products', newProd); updateList(setProducts, saved); } };
  const handleUpdateProduct = async (updated: Product) => { if (isEmployee && !user?.permissions?.canEdit) return; const saved = await api.saveItem('products', updated); updateList(setProducts, saved); };
  const handleDeleteProduct = async (id: string) => { if (isEmployee && !user?.permissions?.canDelete) return; await api.deleteItem('products', id); removeFromList(setProducts, id); };
  const handleAddCustomer = async (name: string, phone: string, photo: string, address: string) => { if (!checkAccess('WRITE')) { showUpgradeAlert("Срок подписки истек."); return; } if (!user) throw new Error("No user"); const ownerId = isEmployee && user.managerId ? user.managerId : user.id; const newCustomer: Customer = { id: crypto.randomUUID(), userId: ownerId, name, phone, email: '', trustScore: 50, notes: '', photo, address }; const saved = await api.saveItem('customers', newCustomer); updateList(setCustomers, saved); return saved; };
const handleUpdateCustomer = async (updated: Customer) => {
    try {
        // 🔹 1. Оптимистичное обновление локального стейта (сразу видим изменения)
        updateList(setCustomers, updated, undefined, 'customers');

        // 🔹 2. Если онлайн — пробуем сохранить на сервер
        if (navigator.onLine) {
            const saved = await api.saveItem('customers', updated);

            // 🔹 3. Если сервер вернул обновлённый объект — синхронизируем стейт
            // (например, добавил серверные поля: createdAt, updatedAt, _id и т.д.)
            if (saved && saved.id === updated.id) {
                updateList(setCustomers, saved, undefined, 'customers');
            }
        }
        // 🔹 4. Если офлайн — данные уже сохранены локально через updateList,
        // и попадут в очередь синхронизации внутри api.saveItem
    } catch (error) {
        console.error('❌ Failed to update customer:', error);
        // 🔹 Опционально: откат изменений при ошибке
        // Но для офлайн-режима лучше оставить оптимистичное обновление
    }
};
const handleAddAccount = async (name: string, type: Account['type'] = 'CUSTOM', partners?: string[]) => { if (user && isManager) { const newAcc = { id: `acc_${Date.now()}`, userId: user.id, name, type, partners }; const saved = await api.saveItem('accounts', newAcc); updateList(setAccounts, saved); } };
  const handleSetMainAccount = async (accountId: string) => { if (user && isManager) { const updatedAccounts = accounts.map(acc => { if (acc.id === accountId) { return { ...acc, type: 'MAIN' as const }; } if (acc.type === 'MAIN') { return { ...acc, type: 'CUSTOM' as const }; } return acc; }); setAccounts(updatedAccounts); for(const acc of updatedAccounts) await api.saveItem('accounts', acc); } };

  const handleImportData = async (data: {
      customers: Customer[];
      products: Product[];
      sales: Sale[];
      accounts: Account[];
      investors: Investor[];
  }) => {
      if (!user) return;
      setIsLoading(true);
      try {
          // Import Customers
          for (const customer of data.customers) {
              const exists = customers.some(c => c.name === customer.name);
              if (!exists) {
                  const saved = await api.saveItem('customers', { ...customer, userId: user.id });
                  updateList(setCustomers, saved);
              }
          }

          // Import Products
          for (const product of data.products) {
              const exists = products.some(p => p.name === product.name);
              if (!exists) {
                  const saved = await api.saveItem('products', { ...product, userId: user.id });
                  updateList(setProducts, saved);
              }
          }

          // Import Accounts
          for (const account of data.accounts) {
              const exists = accounts.some(a => a.name === account.name);
              if (!exists) {
                  const saved = await api.saveItem('accounts', { ...account, userId: user.id });
                  updateList(setAccounts, saved);
              }
          }

          // Import Investors
          for (const investor of data.investors) {
              // Check by name/phone to avoid duplicates
              const exists = investors.some(i => i.name === investor.name);
              if (!exists) {
                  const saved = await api.saveItem('investors', { ...investor, userId: user.id });
                  updateList(setInvestors, saved);
              }
          }

          // Import Sales (and their payment plans)
          for (const sale of data.sales) {
              // Ensure IDs are unique or mapped correctly if we were doing a real DB sync
              // For now, we trust the importer generated unique temp IDs
              const saved = await api.saveItem('sales', { ...sale, userId: user.id });
              updateList(setSales, saved);
          }

          alert(`Импорт завершен! Загружено ${data.sales.length} продаж.`);
      } catch (error) {
          console.error("Import failed", error);
          alert("Ошибка при импорте данных.");
      } finally {
          setIsLoading(false);
      }
  };
  const handleUpdateAccount = async (updatedAccount: Account) => { if (user && isManager) { const saved = await api.saveItem('accounts', updatedAccount); updateList(setAccounts, saved); } };
  const handleUndoPayment = async (saleId: string, paymentId: string) => { if (isEmployee && !user?.permissions?.canDelete) { alert("Нет прав на удаление"); return; } const sale = sales.find(s => s.id === saleId); if(sale) { const payment = sale.paymentPlan.find(p => p.id === paymentId); if (payment) { const updatedSale = { ...sale, remainingAmount: sale.remainingAmount + payment.amount, paymentPlan: sale.paymentPlan.filter(p => p.id !== paymentId), status: 'ACTIVE' as const }; const saved = await api.saveItem('sales', updatedSale); updateList(setSales, saved); } } };
  const handleEditPayment = async (saleId: string, paymentId: string, newDate: string) => { if (isEmployee && !user?.permissions?.canEdit) { alert("Нет прав на редактирование"); return; } const sale = sales.find(s => s.id === saleId); if (sale) { const updatedSale = { ...sale, paymentPlan: sale.paymentPlan.map(p => p.id === paymentId ? { ...p, date: newDate } : p) }; const saved = await api.saveItem('sales', updatedSale); updateList(setSales, saved); } };
  const handleInitiateDashboardPayment = (sale: Sale, amount: number) => { if (!checkAccess('WRITE')) { showUpgradeAlert("Срок подписки истек."); return; } setDraftSaleData({ type: 'CUSTOMER_PAYMENT', customerId: sale.customerId, saleId: sale.id, amount }); setCurrentView('CREATE_INCOME'); };
  const handleInitiateCustomerPayment = (sale: Sale, payment: Payment) => { if (!checkAccess('WRITE')) { showUpgradeAlert("Срок подписки истек."); return; } setDraftSaleData({ type: 'CUSTOMER_PAYMENT', customerId: sale.customerId, saleId: sale.id, amount: payment.amount }); setCurrentView('CREATE_INCOME'); };
  const openSelection = (view: ViewState, currentData: any) => { setDraftSaleData(currentData); setPreviousView(currentView); setCurrentView(view); };
  const handleSelection = (key: 'customerId', id: string) => { setDraftSaleData({ ...draftSaleData, [key]: id }); setCurrentView(previousView === 'CREATE_INCOME' ? 'CREATE_INCOME' : 'CREATE_SALE'); };
  const handleQuickAddCustomer = async (data: { name: string, phone: string, address: string }) => { if (!user) return; if (!checkAccess('WRITE')) { showUpgradeAlert("Срок подписки истек."); return; } const ownerId = isEmployee && user.managerId ? user.managerId : user.id; const newCustomer: Customer = { id: crypto.randomUUID(), userId: ownerId, name: data.name, phone: data.phone, address: data.address, email: '', trustScore: 50, notes: '', photo: '' }; const saved = await api.saveItem('customers', newCustomer); updateList(setCustomers, saved); handleSelection('customerId', saved.id); };
  const handleSelectAccountForOperations = (accountId: string) => { setOperationsAccountId(accountId); setCurrentView('OPERATIONS'); };
  const handleSelectCustomer = (id: string) => { setSelectedCustomerId(id); setPreviousView(currentView); setCurrentView('CUSTOMER_DETAILS'); };
  const handleSelectInvestor = (investor: Investor) => { setSelectedInvestorId(investor.id); setCurrentView('INVESTOR_DETAILS'); };
  const handleAddPartnership = async (name: string, members: string[]) => { if (!user) return; const newAccountId = `acc_part_${Date.now()}`; const newAccount: Account = { id: newAccountId, userId: user.id, name: `Счет: ${name}`, type: 'CUSTOM' }; const newPartnership: Partnership = { id: `part_${Date.now()}`, userId: user.id, name, accountId: newAccountId, partnerIds: members, createdAt: new Date().toISOString() }; const savedAcc = await api.saveItem('accounts', newAccount); updateList(setAccounts, savedAcc); const savedPart = await api.saveItem('partnerships', newPartnership); updateList(setPartnerships, savedPart); };
const handleUpdateProfile = async (data: any) => {
    if (!user) return;

    try {
        // Смена пароля
        if (data.currentPassword || data.newPassword) {
            if (!data.currentPassword || !data.newPassword) {
                throw new Error('Заполните все поля для смены пароля');
            }
            if (data.newPassword !== data.confirmPassword) {
                throw new Error('Новые пароли не совпадают');
            }

            await api.changePassword(data.currentPassword, data.newPassword);
            alert("✅ Пароль успешно изменён!");
            return;
        }

        // Обновление профиля
        const updatedUser = await api.updateProfile(user.id, {
            name: data.name,
            phone: data.phone,
        });

        // ✅ Обновляем стейт
        setUser(updatedUser);
        localStorage.setItem('user', JSON.stringify(updatedUser));
        alert("✅ Профиль обновлён!");

    } catch(e: any) {
        console.error("Update error:", e);
        alert(`❌ ${e.message || 'Ошибка сохранения'}`);
    }
};
const contractCounts = useMemo(() => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let active = 0, overdue = 0, archive = 0;
  const customerIdSet = new Set(customers.map(c => c.id));
  const actualSales = sales.filter(sale => customerIdSet.has(sale.customerId));

  // ✅ ФУНКЦИЯ: расчёт реальной просрочки (как в Contracts)
  const calculateSaleOverdue = (sale: Sale) => {
    let expectedTotal = sale.downPayment;
    sale.paymentPlan.forEach(p => {
      if (!p.isRealPayment && new Date(p.date) < today) {
        expectedTotal += p.amount;
      }
    });
    const totalPaid = sale.totalAmount - sale.remainingAmount;
    const overdue = expectedTotal - totalPaid;
    return Math.max(0, overdue);
  };

  actualSales.forEach(sale => {
    if (sale.status === 'COMPLETED' || sale.remainingAmount === 0) {
      archive++;
      return;
    }
    // ✅ ПРОВЕРКА: реальная сумма просрочки > 0
    const overdueAmount = calculateSaleOverdue(sale);
    if (overdueAmount > 0) {
      overdue++;
    } else {
      active++;
    }
  });
  return { active, overdue, archive };
}, [sales, customers]);  const toggleMoreSection = (section: string) => { setMoreExpandedSection(moreExpandedSection === section ? null : section); };

  const handleDeleteOperation = async (op: any) => {
      if (!user) return;
      if (isEmployee && !user.permissions?.canDelete) {
          alert("Нет прав на удаление");
          return;
      }

      if (!window.confirm("Вы уверены, что хотите удалить эту операцию?")) return;

      if (op.type === 'EXPENSE') {
          await api.deleteItem('expenses', op.id);
          removeFromList(setExpenses, op.id);
      } else if (op.type === 'INCOME') {
          const sale = sales.find(s => s.id === op.raw.id);
          if (!sale) return;

          if (op.id === sale.id) {
             // CASH Sale
             await api.deleteItem('sales', sale.id);
             removeFromList(setSales, sale.id);
             // Also delete associated expense if any
             await api.deleteItem('expenses', `exp_sale_${sale.id}`);
             setExpenses(prev => prev.filter(e => e.id !== `exp_sale_${sale.id}`));
             // Restore stock
             if (sale.productId) {
                 const prod = products.find(p => p.id === sale.productId);
                 if(prod) {
                     const updatedProd = { ...prod, stock: prod.stock + 1 };
                     const savedProd = await api.saveItem('products', updatedProd);
                     updateList(setProducts, savedProd);
                 }
             }
          } else if (op.id.endsWith('_dp')) {
              // Down Payment
              const updatedSale = {
                  ...sale,
                  downPayment: 0,
                  remainingAmount: sale.remainingAmount + op.amount,
                  status: 'ACTIVE' as const
              };
              const saved = await api.saveItem('sales', updatedSale);
              updateList(setSales, saved);
          } else {
              // Installment Payment
              const payment = sale.paymentPlan.find(p => p.id === op.id);
              if (payment) {
                  const updatedSale = {
                      ...sale,
                      remainingAmount: sale.remainingAmount + payment.amount,
                      paymentPlan: sale.paymentPlan.filter(p => p.id !== op.id),
                      status: 'ACTIVE' as const
                  };
                  const saved = await api.saveItem('sales', updatedSale);
                  updateList(setSales, saved);
              }
          }
      }
  };



function toggleTheme() {
  const html = document.documentElement

  html.classList.toggle("dark")

  const theme = html.classList.contains("dark") ? "dark" : "light"

  localStorage.setItem("theme", theme)
}

const handleUpdateSettings = async (newSettings: AppSettings) => {


    // 🔹 1. Обновляем appSettings с НОВЫМИ ссылками на объекты (для триггера re-render)
    setAppSettings(prev => {
        const updated = {
            ...prev,
            ...newSettings,
            // 🔹 Гарантируем, что whatsapp — новый объект с новыми templates
            whatsapp: newSettings.whatsapp
                ? {
                    ...newSettings.whatsapp,
                    templates: newSettings.whatsapp.templates
                        ? { ...newSettings.whatsapp.templates }
                        : prev.whatsapp?.templates
                }
                : prev.whatsapp
        };
        return updated;
    });

    // 🔹 2. Сохраняем в localStorage (локальный кэш)
    saveAppSettings(newSettings);

    if (user) {
        try {
            // 🔹 3. Сохраняем общие настройки в БД
            const settingsId = `settings_${user.id}`;
            await api.saveItem('settings', {
                id: settingsId,
                ...newSettings,
                // 🔹 Добавляем метку времени для invalidation кэша
                _updated: Date.now()
            });

            // 🔹 4. Если есть WhatsApp-настройки — сохраняем их отдельно
            if (newSettings.whatsapp) {
                await api.saveWhatsAppSettings({
                    ...newSettings.whatsapp,
                    // 🔹 Копируем templates для гарантии новой ссылки
                    templates: newSettings.whatsapp.templates
                        ? { ...newSettings.whatsapp.templates }
                        : undefined
                });

                // 🔹 5. Обновляем user state с новыми ссылками
                setUser(prev => {
                    if (!prev) return null;
                    return {
                        ...prev,
                        whatsapp_settings: newSettings.whatsapp
                            ? {
                                ...newSettings.whatsapp,
                                templates: newSettings.whatsapp.templates
                                    ? { ...newSettings.whatsapp.templates }
                                    : prev.whatsapp_settings?.templates
                            }
                            : prev.whatsapp_settings
                    };
                });
            }



        } catch (e) {
            console.error("❌ Failed to save settings to API", e);
            alert("Ошибка сохранения настроек. Проверьте подключение к интернету.");
        }
    }

    // 🔹 6. Триггер для компонентов, которые зависят от настроек WhatsApp
    // (например, список шаблонов, отправка сообщений)
    setWhatsAppRefreshKey(prev => prev + 1);

};



if (isPublicMode) {
    return (
        <Calculator
            isPublic={true}
            appSettings={appSettings}
            userPhone={user?.phone}
        />
    );
}

// 2. Загрузка (проверка сессии, подгрузка данных)
if (showSplash || isLoading) {
  return <SplashScreen progress={isLoading ? loadingProgress : 100} />
}
// 🔹 ПРОВЕРКА АВТОРИЗАЦИИ (перед Layout!)
if (!user && !showSplash) {
  const isPWA = window.matchMedia('(display-mode: standalone)').matches;

  // В PWA или нативном приложении — сразу Auth
  if (isNative || isPWA) {
    return <Auth onLogin={handleAuthSuccess} />;
  }

  // На вебе — показываем лендинг на главной
  if (isLanding) {
    return <Landing />;
  }

  // На остальных страницах — Auth
  return <Auth onLogin={handleAuthSuccess} />;
}

  return (

       <Layout
    currentView={currentView}
    setView={setCurrentView}
    onAction={handleAction}
    onContractTabChange={setActiveContractTab}
    sales={sales}
    appSettings={appSettings}
    customers={customers}
    user={user}
    activeInvestor={activeInvestor}
    onNavigateToProfile={() => setCurrentView('PROFILE')}
    isOnline={isOnline}
    isSyncing={isSyncing}
    supportUnreadCount={supportUnreadCount}
    // 🔹 Кнопка поддержки для десктопа (плавающая)
    supportButton={
      <SupportButton
        unreadCount={supportUnreadCount}
        onClick={() => setShowSupportChat(true)}
      />
    }

  >



              {/* ... (Layout Children remain exactly the same) ... */}
              {currentView === 'DASHBOARD' && !isInvestor &&
                  <Dashboard sales={sales} customers={customers} stats={dashboardStats} workingCapital={workingCapital}
                             accountBalances={accountBalances} onAction={handleAction}
                             onSelectCustomer={handleSelectCustomer}  onViewSchedule={handleViewSaleSchedule} onInitiatePayment={handleInitiateDashboardPayment}
                             accounts={accounts} appSettings={appSettings} investors={investors}/>}
              {/* 🔹 Дашборд инвестора — с фильтрацией и выходом */}
{/* 🔹 Дашборд инвестора — с проверкой на загрузку данных */}
{currentView === 'DASHBOARD' && isInvestor && activeInvestor && (
  (() => {
    // 🔹 Если данных ещё нет — показываем загрузку
    if (accounts.length === 0 && sales.length === 0) {
      return (
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
            <p className="text-slate-500">Загрузка данных...</p>
          </div>
        </div>
      );
    }

    // 🔹 ОТЛАДКА: Проверяем фильтрацию
    const filteredAccounts = accounts.filter(a => a.ownerId === activeInvestor.id);


    return (
      <InvestorDashboard
        sales={sales.filter(s => {
          const acc = accounts.find(a => a.id === s.accountId);
          return acc?.ownerId === activeInvestor.id;
        })}
        expenses={expenses.filter(e => {
          const acc = accounts.find(a => a.id === e.accountId);
          return acc?.ownerId === activeInvestor.id;
        })}
        accounts={filteredAccounts}
        investor={activeInvestor}
        appSettings={appSettings}
        onLogout={() => {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          setUser(null);
          setCurrentView('DASHBOARD');
        }}
      />
    );
  })()
)}
              {currentView === 'CASH_REGISTER' && (
  <CashRegister
    // 🔹 Фильтрация данных для инвестора
    accounts={isInvestor && user
      ? accounts.filter(a => a.ownerId === user.id)
      : accounts}
    sales={isInvestor && user
      ? sales.filter(s => {
          const acc = accounts.find(a => a.id === s.accountId);
          return acc?.ownerId === user.id;
        })
      : sales}
    expenses={isInvestor && user
      ? expenses.filter(e => {
          const acc = accounts.find(a => a.id === e.accountId);
          return acc?.ownerId === user.id;
        })
      : expenses}
    investors={investors}
    onAddAccount={handleAddAccount}
    onAction={handleAction}
    onSelectAccount={handleSelectAccountForOperations}
    onSetMainAccount={handleSetMainAccount}
    onUpdateAccount={handleUpdateAccount}
    isManager={isManager}

    // 🔹 Новые пропсы для внутренней фильтрации
    isInvestor={isInvestor}
    currentInvestorId={isInvestor ? user?.id : undefined}

    totalExpectedProfit={totalExpectedProfit}
    realizedPeriodProfit={realizedPeriodProfit}
    myProfitPeriod={myProfitPeriod}
    setMyProfitPeriod={setMyProfitPeriod}
    appSettings={appSettings}
  />
)}
              {currentView === 'CONTRACTS' && (
                  <Contracts
                      sales={isInvestor ? sales.filter(s => s.accountId === accounts.find(a => a.ownerId === user.id)?.id) : sales}
                      customers={customers}
                      accounts={accounts}
                      activeTab={activeContractTab}
                      onTabChange={setActiveContractTab}
                      onViewSchedule={handleViewSaleSchedule}
                      onEditSale={handleStartEditSale}
                      onDeleteSale={handleDeleteSale}
                      readOnly={isInvestor}
                      user={user}
                      appSettings={appSettings}
                  />
              )}
              {currentView === 'INVESTORS' && <Investors investors={investors} onAddInvestor={handleAddInvestor}
                                                         onUpdateInvestor={handleUpdateInvestor}
                                                         onDeleteInvestor={handleDeleteInvestor}
                                                         onViewDetails={handleSelectInvestor}
                                                         appSettings={appSettings}/>}
              {currentView === 'INVESTOR_DETAILS' && selectedInvestorId &&
                  <InvestorDetails investor={investors.find(i => i.id === selectedInvestorId)!}
                                   account={accounts.find(a => a.ownerId === selectedInvestorId)} sales={sales}
                                   expenses={expenses} onBack={() => setCurrentView('INVESTORS')}
                                   appSettings={appSettings}/>}
              {currentView === 'PARTNERS' && (
                  <Partners
                      partnerships={partnerships}
                      investors={investors}
                      accounts={accounts}
                      sales={sales}
                      expenses={expenses}
                      onAddPartnership={handleAddPartnership}
                      onSelectAccount={handleSelectAccountForOperations}
                      appSettings={appSettings}
                  />
              )}
              {currentView === 'CUSTOMERS' && (
                  <Customers
                      customers={customers}
                      accounts={accounts}
                      investors={investors}
                      sales={sales}
                      onAddCustomer={handleAddCustomer}
                      onSelectCustomer={handleSelectCustomer}
                      onInitiatePayment={handleInitiateCustomerPayment}
                      onUndoPayment={handleUndoPayment}
                      onEditPayment={handleEditPayment}
                      onUpdateCustomer={handleUpdateCustomer}
                      onDeleteCustomer={handleDeleteCustomer}
                      appSettings={appSettings}
                  />
              )}
              {currentView === 'CUSTOMER_DETAILS' && selectedCustomerId &&
                  <CustomerDetails customer={customers.find(c => c.id === selectedCustomerId)!} sales={sales}
                                   accounts={accounts} investors={investors} onBack={() => setCurrentView(previousView)}
                                   onInitiatePayment={handleInitiateCustomerPayment} onUndoPayment={handleUndoPayment}
                                   onEditPayment={handleEditPayment} onUpdateCustomer={handleUpdateCustomer}
                                   initialSaleId={initialSaleIdForDetails} appSettings={appSettings}/>}
              {currentView === 'MANAGE_PRODUCTS' &&
                  <Products products={products} onAddProduct={handleAddProduct} onUpdateProduct={handleUpdateProduct}
                            onDeleteProduct={handleDeleteProduct} appSettings={appSettings}/>}
              {currentView === 'OPERATIONS' && (
                  <Operations
                      sales={isInvestor ? sales.filter(s => s.accountId === accounts.find(a => a.ownerId === user.id)?.id) : sales}
                      expenses={isInvestor ? expenses.filter(e => e.accountId === accounts.find(a => a.ownerId === user.id)?.id) : expenses}
                      accounts={accounts}
                      customers={customers}
                      initialAccountId={operationsAccountId}
                      onDelete={handleDeleteOperation}
                      appSettings={appSettings}
                  />
              )}
              {currentView === 'REPORTS' && reportData &&
                  <Reports investors={investors} filters={reportFilters} onFiltersChange={setReportFilters}
                           data={reportData} appSettings={appSettings}/>}

              {currentView === 'CREATE_INCOME' &&
                  <NewIncome initialData={draftSaleData} customers={customers} investors={investors} accounts={accounts}
                             sales={sales} onClose={() => setCurrentView('DASHBOARD')} onSubmit={handleIncomeSubmit}
                             onSelectCustomer={() => openSelection('SELECT_CUSTOMER', draftSaleData)}
                             appSettings={appSettings} user={user}/>}
              {currentView === 'CREATE_EXPENSE' &&
                  <NewExpense investors={investors} accounts={accounts} onClose={() => setCurrentView('DASHBOARD')}
                              onSubmit={handleExpenseSubmit} appSettings={appSettings}/>}
              {currentView === 'CREATE_SALE' &&
                  <NewSale initialData={editingSale || draftSaleData} customers={customers} products={products}
                           accounts={accounts} onClose={() => {
                      setCurrentView('DASHBOARD');
                      setEditingSale(null);
                  }} onSelectCustomer={(data) => openSelection('SELECT_CUSTOMER', data)} onSubmit={handleSaveSale} onShowNotification={showNotificationModal}
                           appSettings={appSettings}/>}
              {currentView === 'SELECT_CUSTOMER' && <SelectionList title="Выберите клиента" items={customers.map(c => ({
                  id: c.id,
                  title: c.name,
                  subtitle: c.phone
              }))} onSelect={(id) => handleSelection('customerId', id)}
                                                                   onCancel={() => setCurrentView(previousView === 'CREATE_INCOME' ? 'CREATE_INCOME' : 'CREATE_SALE')}
                                                                   onAddNew={handleQuickAddCustomer}/>}
              {currentView === 'EMPLOYEES' &&
                  <Employees employees={employees} investors={investors} onAddEmployee={handleAddEmployee}
                             onUpdateEmployee={handleUpdateEmployee} onDeleteEmployee={handleDeleteEmployee}
                             appSettings={appSettings}/>}
              {currentView === 'TARIFFS' && <Tariffs user={user}/>}

              {currentView === 'SETTINGS' && <Settings appSettings={appSettings} onUpdateSettings={handleUpdateSettings}
                                                       onNavigate={setCurrentView} onImportData={handleImportData} currentUserId={user.id}/>}

              {currentView === 'INTEGRATIONS' &&
                  <Integrations appSettings={appSettings} onUpdateSettings={handleUpdateSettings}
                                onBack={() => setCurrentView('SETTINGS')}
                                whatsappRefreshKey={whatsappRefreshKey}  // ← Обязательно!
                                onSettingsChanged={() => {

                                }}/>}
              {currentView === 'CALCULATOR' && (
                  <Calculator
                      appSettings={appSettings}
                      userPhone={user?.phone}
                      onBack={() => setCurrentView('SETTINGS')}
                      onSaveSettings={handleUpdateSettings}
                  />
              )}

             {currentView === 'PROFILE' && user && (
      isInvestor && activeInvestor ? (
        <InvestorDetails
          investor={activeInvestor}
          account={accounts.find(a => a.ownerId === user.id)}
          sales={sales.filter(s => s.accountId === accounts.find(a => a.ownerId === user.id)?.id)}
          expenses={expenses.filter(e => e.accountId === accounts.find(a => a.ownerId === user.id)?.id)}
          onBack={() => setCurrentView('DASHBOARD')}
          appSettings={appSettings}
        />
      ) : (
        <Profile
          user={user}
          onUpdateProfile={handleUpdateProfile}
          onBack={() => setCurrentView('MORE')}
          onLogout={() => {
            localStorage.removeItem('user');
            localStorage.removeItem('token');
            setUser(null);
          }}

        />
      )
    )}

    {currentView === 'ADMIN_PANEL' && <AdminPanel/>}

    {/* 🔹 АДМИН ПАНЕЛЬ ПОДДЕРЖКИ */}
    {currentView === 'ADMIN_SUPPORT' && user?.role === 'admin' && (
      <AdminSupportPanel onBack={() => setCurrentView('ADMIN_PANEL')} />
    )}

    {/* 🔹 МОДАЛЬНОЕ ОКНО ЧАТА ПОДДЕРЖКИ */}
    {showSupportChat && user && (
      <SupportChat
        user={user}
        onClose={() => setShowSupportChat(false)}
        onUnreadChange={setSupportUnreadCount}
      />
    )}

    {/* ==================== МОБИЛЬНОЕ МЕНЮ "ЕЩЁ" ==================== */}
    {currentView === 'MORE' && !isInvestor && (
      <div className="space-y-4 animate-fade-in pb-20">

   {/* Профиль */}
<button
  onClick={() => setCurrentView('PROFILE')}
  className="group w-full bg-white/80 backdrop-blur-sm hover:bg-white/90
             text-slate-800 p-6 rounded-2xl flex items-center gap-4
             transition-all duration-300 hover:shadow-xl
             border border-slate-200/80 hover:border-[var(--color-primary-400)]
             shadow-sm relative overflow-hidden"
>
  {/* 🔹 Декоративная полоска статуса (сверху) */}
  {!isInvestor && (
    <div className={`absolute top-0 left-0 right-0 h-1 ${
      subStatus.expired 
        ? 'bg-gradient-to-r from-red-400 to-red-600' 
        : subStatus.isWarning 
          ? 'bg-gradient-to-r from-amber-400 to-amber-600' 
          : 'bg-gradient-to-r from-[var(--color-primary-400)] to-[var(--color-primary-600)]'
    }`} />
  )}

  {/* 🔹 Аватар — использует цвета темы */}
  <div
    className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold text-white
               shadow-md group-hover:scale-105 transition-transform duration-300 relative z-10"
    style={{
      background: `linear-gradient(135deg, var(--color-primary-500), var(--color-secondary-500))`
    }}
  >
    {user.name.charAt(0).toUpperCase()}
  </div>

  <div className="flex-1 min-w-0 relative z-10">
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-xl font-bold text-left text-slate-800 truncate">{user.name}</h2>

      {/* 🔹 Бейдж подписки — использует цвета темы */}
      {!isInvestor && (
        <div
          className={`flex-shrink-0 px-2.5 py-1.5 rounded-xl font-bold text-[10px] flex flex-col items-end leading-tight cursor-pointer transition-all hover:scale-105
            ${subStatus.expired 
              ? 'bg-red-100 text-red-700 border border-red-200' 
              : subStatus.isWarning 
                ? 'bg-amber-100 text-amber-700 border border-amber-200' 
                : 'bg-[var(--color-primary-100)] text-[var(--color-primary-700)] border border-[var(--color-primary-200)]'
            }`}
          onClick={(e) => { e.stopPropagation(); setCurrentView('TARIFFS'); }}
          title="Управление подпиской"
        >
          <span className="font-semibold">{subStatus.planName}</span>
          <span className="text-[9px] opacity-75 mt-0.5">
            {subStatus.expired ? '❌ Истек' : `⏰ ${subStatus.daysLeft} дн.`}
          </span>
        </div>
      )}
    </div>

    <p className="text-slate-500 text-xs mt-2 text-left flex items-center gap-1">
      <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
      <span className="truncate">{user.email}</span>
    </p>

    {/* 🔹 Прогресс-бар дней — использует цвета темы */}
    {!isInvestor && !subStatus.expired && (
      <div className="mt-3 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.min(100, (subStatus.daysLeft / 30) * 100)}%`,
            background: subStatus.isWarning
              ? `linear-gradient(90deg, var(--color-amber-400), var(--color-amber-600))`
              : `linear-gradient(90deg, var(--color-primary-400), var(--color-primary-600))`
          }}
        />
      </div>
    )}
  </div>

  {/* 🔹 Стрелка навигации — использует цвет темы */}
  <div
    className="text-slate-300 group-hover:text-[var(--color-primary-500)] transition-colors relative z-10"
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  </div>
</button>

        <div className="space-y-2 pt-4">
          {/* Касса (аккордеон) */}
          <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
            <button onClick={() => toggleMoreSection('CASH')}
                    className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="bg-emerald-100 text-emerald-600 p-2 rounded-lg">{ICONS.Wallet}</div>
                <span className="font-semibold text-slate-800">Касса</span>
              </div>
              <span className={`text-slate-400 transition-transform ${moreExpandedSection === 'CASH' ? 'rotate-90' : ''}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </span>
            </button>
            {moreExpandedSection === 'CASH' && (
              <div className="bg-slate-50 border-t border-slate-100 p-2 space-y-1">
                <button onClick={() => setCurrentView('CASH_REGISTER')}
                        className="w-full text-left px-4 py-3 rounded-lg hover:bg-white text-sm text-slate-600 flex items-center gap-2">
                  <span className="opacity-70">{ICONS.Wallet}</span> Счета
                </button>
                <button onClick={() => handleAction('INCOME')}
                        className="w-full text-left px-4 py-3 rounded-lg hover:bg-white text-sm text-slate-600 flex items-center gap-2">
                  <span className="opacity-70">{ICONS.Income}</span> Приход
                </button>
                <button onClick={() => handleAction('EXPENSE')}
                        className="w-full text-left px-4 py-3 rounded-lg hover:bg-white text-sm text-slate-600 flex items-center gap-2">
                  <span className="opacity-70">{ICONS.Expense}</span> Расход
                </button>
                <button onClick={() => handleAction('OPERATIONS')}
                        className="w-full text-left px-4 py-3 rounded-lg hover:bg-white text-sm text-slate-600 flex items-center gap-2">
                  <span className="opacity-70">{ICONS.List}</span> История
                </button>
              </div>
            )}
          </div>

          {/* Договоры (аккордеон) */}
          <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
            <button onClick={() => toggleMoreSection('CONTRACTS')}
                    className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="bg-indigo-100 text-indigo-600 p-2 rounded-lg">{ICONS.File}</div>
                <span className="font-semibold text-slate-800">Договоры</span>
              </div>
              <span className={`text-slate-400 transition-transform ${moreExpandedSection === 'CONTRACTS' ? 'rotate-90' : ''}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </span>
            </button>
            {moreExpandedSection === 'CONTRACTS' && (
              <div className="bg-slate-50 border-t border-slate-100 p-2 space-y-1">
                <button onClick={() => handleAction('CREATE_SALE')}
                        className="w-full text-left px-4 py-3 rounded-lg hover:bg-white text-sm text-slate-600 flex items-center gap-2">
                  <span className="opacity-70">{ICONS.AddSmall}</span> Оформить
                </button>
                <button onClick={() => { setCurrentView('CONTRACTS'); setActiveContractTab('ACTIVE'); }}
                        className="w-full text-left px-4 py-3 rounded-lg hover:bg-white text-sm text-slate-600 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2"><span className="opacity-70">{ICONS.Check}</span> Активные</div>
                  {contractCounts.active > 0 && <span className="text-xs bg-indigo-100 text-indigo-600 font-semibold px-2 py-0.5 rounded-full">{contractCounts.active}</span>}
                </button>
                <button onClick={() => { setCurrentView('CONTRACTS'); setActiveContractTab('OVERDUE'); }}
                        className="w-full text-left px-4 py-3 rounded-lg hover:bg-white text-sm text-slate-600 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2"><span className="opacity-70">{ICONS.Alert}</span> Просроченные</div>
                  {contractCounts.overdue > 0 && <span className="text-xs bg-red-100 text-red-600 font-semibold px-2 py-0.5 rounded-full">{contractCounts.overdue}</span>}
                </button>
                <button onClick={() => { setCurrentView('CONTRACTS'); setActiveContractTab('ARCHIVE'); }}
                        className="w-full text-left px-4 py-3 rounded-lg hover:bg-white text-sm text-slate-600 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2"><span className="opacity-70">{ICONS.Clock}</span> Архив</div>
                  {contractCounts.archive > 0 && <span className="text-xs bg-slate-100 text-slate-600 font-semibold px-2 py-0.5 rounded-full">{contractCounts.archive}</span>}
                </button>
              </div>
            )}
          </div>

          {/* Отчеты */}
          <button onClick={() => setCurrentView('REPORTS')}
                  className="w-full bg-white rounded-xl border border-slate-100 p-4 flex items-center justify-between hover:bg-slate-50">
            <div className="flex items-center gap-3">
              <div className="bg-sky-100 text-sky-600 p-2 rounded-lg">{ICONS.Dashboard}</div>
              <span className="font-semibold text-slate-800">Отчеты</span>
            </div>
            <span className="text-slate-400">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </span>
          </button>


          {/* Инвесторы */}
          <button onClick={() => setCurrentView('INVESTORS')}
                  className="w-full bg-white rounded-xl border border-slate-100 p-4 flex items-center justify-between hover:bg-slate-50">
            <div className="flex items-center gap-3">
              <div className="bg-purple-100 text-purple-600 p-2 rounded-lg">{ICONS.Users}</div>
              <span className="font-semibold text-slate-800">Инвесторы</span>
            </div>
            <span className="text-slate-400">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </span>
          </button>

          {/* Сотрудники (только менеджер) */}
          {user.role === 'manager' && (
            <button onClick={() => setCurrentView('EMPLOYEES')}
                    className="w-full bg-white rounded-xl border border-slate-100 p-4 flex items-center justify-between hover:bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="bg-blue-100 text-blue-600 p-2 rounded-lg">{ICONS.Employees}</div>
                <span className="font-semibold text-slate-800">Сотрудники</span>
              </div>
              <span className="text-slate-400">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </span>
            </button>
          )}

          {/* Тарифы */}
          <button onClick={() => setCurrentView('TARIFFS')}
                  className="w-full bg-white rounded-xl border border-slate-100 p-4 flex items-center justify-between hover:bg-slate-50">
            <div className="flex items-center gap-3">
              <div className="bg-emerald-100 text-emerald-600 p-2 rounded-lg">{ICONS.Tariffs}</div>
              <span className="font-semibold text-slate-800">Тарифы</span>
            </div>
            <span className="text-slate-400">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </span>
          </button>

          {/* Админ панель (только админ) */}
          {user.role === 'admin' && (
            <button onClick={() => setCurrentView('ADMIN_PANEL')}
                    className="w-full bg-white rounded-xl border border-slate-100 p-4 flex items-center justify-between hover:bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="bg-red-100 text-red-600 p-2 rounded-lg">{ICONS.Crown}</div>
                <span className="font-semibold text-slate-800">Админ панель</span>
              </div>
              <span className="text-slate-400">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </span>
            </button>
          )}

            {/* 🔹 НОВАЯ КНОПКА: Техподдержка (только для админов) */}
{user.role === 'admin' && (
  <button onClick={() => setCurrentView('ADMIN_SUPPORT')}
          className="w-full bg-white rounded-xl border border-slate-100 p-4 flex items-center justify-between hover:bg-slate-50">
      <div className="flex items-center gap-3">
          <div className="bg-blue-100 text-blue-600 p-2 rounded-lg">{ICONS.Chat}</div>
          <span className="font-semibold text-slate-800">Техподдержка</span>
      </div>
      <span className="text-slate-400">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6"/>
          </svg>
      </span>
  </button>
)}
{/* Кнопка Техподдержка */}
{user.role === 'manager' && (
<button
  onClick={() => {
    loadSupportUnreadCount(user); // Принудительное обновление
    setShowSupportChat(true);
  }}
  className="w-full bg-white rounded-xl border border-slate-100 p-4 flex items-center justify-between hover:bg-slate-50 relative"
>
  <div className="flex items-center gap-3">
    <div className="bg-indigo-100 p-2 rounded-full text-indigo-600">
      {ICONS.Chat}
    </div>
    <span className="font-semibold text-slate-700">Техподдержка</span>
  </div>

  {/* 🔴 Счётчик непрочитанных */}
  {supportUnreadCount > 0 && (
    <span className="bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 px-1.5 flex items-center justify-center">
      {supportUnreadCount > 9 ? '9+' : supportUnreadCount}
    </span>
  )}
</button>)}

          {/* Настройки */}
          <button onClick={() => setCurrentView('SETTINGS')}
                  className="w-full bg-white rounded-xl border border-slate-100 p-4 flex items-center justify-between hover:bg-slate-50">
            <div className="flex items-center gap-3">
              <div className="bg-slate-100 text-slate-600 p-2 rounded-lg">{ICONS.Settings}</div>
              <span className="font-semibold text-slate-800">Настройки</span>
            </div>
            <span className="text-slate-400">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </span>
          </button>
        </div>


      </div>
    )}

           {/* === МОДАЛЬНОЕ ОКНО: ПОДТВЕРЖДЕНИЕ УДАЛЕНИЯ КЛИЕНТА === */}
{showDeleteConfirm && (
  <div
    className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in"
    onClick={() => setShowDeleteConfirm(null)}
  >
    <div
      className="bg-white w-full max-w-sm p-6 rounded-2xl shadow-2xl animate-scale-in"
      onClick={e => e.stopPropagation()}
    >
      {/* 🔴 Иконка предупреждения */}
      <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </div>

      {/* 🔹 Заголовок */}
      <h3 className="text-lg font-bold text-slate-800 text-center mb-2">
        Удалить клиента?
      </h3>

      {/* 🔹 Текст предупреждения */}
      <p className="text-center text-slate-500 mb-6 text-sm leading-relaxed">
        Это действие <strong className="text-slate-700">нельзя отменить</strong>.<br/>
        Все данные клиента будут удалены безвозвратно.
      </p>

      {/* 🔹 Кнопки действий */}
      <div className="flex gap-3">
        <button
          onClick={() => setShowDeleteConfirm(null)}
          className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-300"
        >
          Отмена
        </button>
        <button
          onClick={confirmDeleteCustomer}
          className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors shadow-lg shadow-red-200 focus:outline-none focus:ring-2 focus:ring-red-300"
        >
          Да, удалить
        </button>
      </div>
    </div>
  </div>
)}

{showSessionExpiredModal && (
  <div
    className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
    onClick={() => sessionHandlers?.onCancel()}
  >
    <div
      className="bg-white dark:bg-slate-800 w-full max-w-md rounded-2xl shadow-2xl p-6 space-y-5 animate-scale-in"
      onClick={e => e.stopPropagation()}
    >
      {/* Иконка */}
      <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 text-amber-600 rounded-full flex items-center justify-center mx-auto text-3xl">
        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>

      {/* Заголовок */}
      <div className="text-center space-y-2">
        <h3 className="text-2xl font-bold text-slate-800 dark:text-white">
          ⏳ Сессия истекла
        </h3>
        <p className="text-slate-600 dark:text-slate-300">
          {sessionMessage}
        </p>
      </div>

      {/* Информация */}
      <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-4 space-y-2 text-sm">
        <p className="text-slate-600 dark:text-slate-300">
          Ваша сессия завершилась из-за истечения срока действия токена.
        </p>
        <p className="text-slate-500 dark:text-slate-400 text-xs">
          Для продолжения работы необходимо войти в систему заново.
        </p>
      </div>

      {/* Кнопки */}
        <div className="pt-2">
            <button
                onClick={() => sessionHandlers?.onConfirm()}
                className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold shadow-lg shadow-indigo-200 dark:shadow-indigo-900/30 transition-all hover:scale-105 active:scale-95"
            >
                Войти снова
            </button>
        </div>
    </div>
  </div>
)}


           {/* === МОДАЛЬНОЕ ОКНО: НЕЛЬЗЯ УДАЛИТЬ (ЕСТЬ ДОГОВОРЫ) === */}
           {showBlockedDeleteModal && (
               <div
                   className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in"
                   onClick={() => setShowBlockedDeleteModal(null)}
               >
                   <div
                       className="bg-white w-full max-w-sm p-6 rounded-2xl shadow-2xl animate-scale-in"
      onClick={e => e.stopPropagation()}
    >
      {/* 🔴 Иконка предупреждения */}
      <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>

      {/* 🔹 Заголовок */}
      <h3 className="text-lg font-bold text-slate-800 text-center mb-1">
        Невозможно удалить
      </h3>
      <p className="text-center text-slate-500 mb-4 text-sm">
        У клиента <strong>{showBlockedDeleteModal.customerName}</strong> есть активные договоры
      </p>

      {/* 🔹 Список договоров */}
      <div className="bg-slate-50 rounded-xl p-4 mb-6 max-h-48 overflow-y-auto">
        <p className="text-xs font-medium text-slate-500 mb-2 uppercase">
          Привязанные договоры ({showBlockedDeleteModal.contracts.length})
        </p>
        <ul className="space-y-2">
          {showBlockedDeleteModal.contracts.map(contract => (
            <li
              key={contract.id}
              className="flex items-center gap-2 text-sm text-slate-700 bg-white px-3 py-2 rounded-lg border border-slate-100"
            >
              <span className="text-slate-400 flex-shrink-0">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
              </span>
              <span className="truncate">{contract.productName}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* 🔹 Текст инструкции */}
      <p className="text-center text-slate-500 text-sm mb-6">
        Сначала удалите привязанные договоры.
      </p>

      {/* 🔹 Кнопки действий */}
      <div className="flex gap-3">
        <button
          onClick={() => {
            setShowBlockedDeleteModal(null);
            // 🔹 Переход к клиенту → вкладка рассрочек
            setSelectedCustomerId(showBlockedDeleteModal.customerId);
            setCurrentView('CUSTOMER_DETAILS');
          }}
          className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-colors"
        >
          Перейти к договорам
        </button>
        <button
          onClick={() => setShowBlockedDeleteModal(null)}
          className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
        >
          Понятно
        </button>
      </div>
    </div>
  </div>
)}

{/* 🔹 Модал уведомлений */}
{showNotification && notificationData && (
  <NotificationModal
    isOpen={showNotification}
    onClose={() => setShowNotification(false)}
    title={notificationData.title}
    message={notificationData.message}
    type={notificationData.type}
    actionLabel={notificationData.actionLabel}
    onAction={notificationData.onAction}
  />
)}


  </Layout>
);


};

export default App;