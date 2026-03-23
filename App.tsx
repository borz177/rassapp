import React, { useState, useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
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
import Landing from './components/Landing.tsx';

// --- УТИЛИТЫ И ХУКИ ---

async function enablePersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    const isPersisted = await navigator.storage.persisted();
    if (!isPersisted) {
      const granted = await navigator.storage.persist();
      console.log("Persistent storage granted:", granted);
    }
  }
}

// Хук для свайпа назад (как в нативных приложениях)
const useSwipeBack = (onSwipeBack: () => void, enabled: boolean) => {
  useEffect(() => {
    if (!enabled) return;
    let startX = 0;
    let startY = 0;
    const handleTouchStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };
    const handleTouchEnd = (e: TouchEvent) => {
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const diffX = endX - startX;
      const diffY = endY - startY;
      // Свайп вправо > 100px и горизонтальнее чем вертикаль
      if (diffX > 100 && Math.abs(diffX) > Math.abs(diffY) && startX < 50) {
        onSwipeBack();
      }
    };
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [onSwipeBack, enabled]);
};

// Компонент анимированной страницы
const AnimatedView = ({ children, direction, currentView }: { children: React.ReactNode, direction: number, currentView: string }) => {
  return (
    <motion.div
      key={currentView}
      initial={{ opacity: 0, x: direction > 0 ? 50 : -50, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: direction < 0 ? 50 : -50, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 300, damping: 30, duration: 0.25 }}
      className="w-full h-full overflow-y-auto pb-20"
    >
      {children}
    </motion.div>
  );
};

// --- ОСНОВНОЙ КОМПОНЕНТ ---

const App: React.FC = () => {
  const path = window.location.pathname;
  const isLanding = path === "/";

  // Auth State
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPublicMode, setIsPublicMode] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);

  // App State
  const [currentView, setCurrentView] = useState<ViewState>('DASHBOARD');
  const [previousView, setPreviousView] = useState<ViewState>('DASHBOARD');
  const [viewDirection, setViewDirection] = useState(1); // 1 = вперед, -1 = назад
  
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
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedInvestorId, setSelectedInvestorId] = useState<string | null>(null);
  const [operationsAccountId, setOperationsAccountId] = useState<string | null>(null);
  const [editingSale, setEditingSale] = useState<Sale | null>(null);
  const [initialSaleIdForDetails, setInitialSaleIdForDetails] = useState<string | null>(null);
  const [moreExpandedSection, setMoreExpandedSection] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [myProfitPeriod, setMyProfitPeriod] = useState(() => {
    const today = new Date().toISOString().split('T')[0];
    return { start: '2023-01-01', end: today };
  });
  const [reportFilters, setReportFilters] = useState({
    investorId: 'ALL',
    period: myProfitPeriod
  });

  const isNative =
    navigator.userAgent.includes("Electron") ||
    navigator.userAgent.includes("Android") ||
    navigator.userAgent.includes("wv");

  useEffect(() => {
    setReportFilters(prev => ({ ...prev, period: myProfitPeriod }));
  }, [myProfitPeriod]);

  // Network Status & Sync
  useEffect(() => {
    const handleOnline = () => { setIsOnline(true); handleSync(); };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    if (navigator.onLine) handleSync();
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleSync = async () => {
    if (!navigator.onLine) return;
    setIsSyncing(true);
    try { await api.sync(); } catch (e) { console.error("Sync failed", e); } finally { setIsSyncing(false); }
  };

  // Initial Data Load
  useEffect(() => {
    enablePersistentStorage();
    const initApp = async () => {
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
      const token = localStorage.getItem('token');
      const localUserStr = localStorage.getItem('user');
      let localUser: User | null = null;
      if (localUserStr) {
        try {
          localUser = JSON.parse(localUserStr);
          if (localUser) {
            console.log("✅ Restoring user from localStorage");
            setUser(localUser);
            await loadData(localUser).catch(e => console.warn("⚠️ Local data warning:", e));
          }
        } catch (e) {
          console.error("❌ Failed to parse local user", e);
          localStorage.removeItem('user');
          localStorage.removeItem('token');
        }
      }
      if (token && navigator.onLine) {
        try {
          const freshUser = await api.getMe();
          setUser(freshUser);
          localStorage.setItem('user', JSON.stringify(freshUser));
          await loadData(freshUser, !!localUser);
        } catch (err) {
          console.error('❌ Auth refresh failed', err);
          if (!localUser) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            setUser(null);
          }
        }
      }
      if (!token && !localUser) setUser(null);
      setAppSettings(getAppSettings());
      setIsLoading(false);
    };
    initApp();
  }, []);

  const loadData = async (currentUser?: User, skipLoading = false) => {
    if (!skipLoading && customers.length === 0 && sales.length === 0) setIsLoading(true);
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
      const activeUser = currentUser || user;
      if (activeUser?.whatsapp_settings) {
        loadedSettings = { ...loadedSettings, whatsapp: activeUser.whatsapp_settings };
      }
      setAppSettings(loadedSettings);
      saveAppSettings(loadedSettings);
    } catch (error) { console.error("Failed to load data", error); } finally { setIsLoading(false); }
  };

  const isManager = user?.role === 'manager' || user?.role === 'admin';
  const isEmployee = user?.role === 'employee';
  const isInvestor = user?.role === 'investor';
  const activeInvestor = isInvestor && user ? investors.find(i => i.id === user.id) : null;

  const checkAccess = (feature: 'WRITE' | 'INVESTORS' | 'AI' | 'WHATSAPP' | 'EMPLOYEES'): boolean => {
    if (!user) return false;
    if (isEmployee || isInvestor || user.role === 'admin') return true;
    const sub = user.subscription || { plan: 'TRIAL', expiresAt: new Date(0).toISOString() };
    const isExpired = new Date() > new Date(sub.expiresAt);
    if (isExpired && feature === 'WRITE') return false;
    const plan = sub.plan;
    switch (feature) {
      case 'WRITE': return !isExpired;
      case 'INVESTORS': return (plan === 'START' && investors.length < 1) || (plan === 'STANDARD' && investors.length < 5) || true;
      case 'AI': return plan === 'BUSINESS' || plan === 'TRIAL';
      case 'WHATSAPP': return plan === 'STANDARD' || plan === 'BUSINESS' || plan === 'TRIAL';
      case 'EMPLOYEES': return plan === 'BUSINESS' || plan === 'TRIAL';
      default: return true;
    }
  };

  const showUpgradeAlert = (reason: string) => { if (window.confirm(`${reason} Оформите подписку для доступа.`)) { handleSetView('TARIFFS'); } };

  // Stats calculations
  const dashboardStats = useMemo(() => {
    let totalRevenue = 0;
    let totalOutstanding = 0;
    let overdueCount = 0;
    let installmentSalesTotal = 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const calculateSaleOverdue = (sale: Sale) => {
      let expectedTotal = sale.downPayment;
      sale.paymentPlan.forEach(p => { if (!p.isRealPayment && new Date(p.date) < today) expectedTotal += p.amount; });
      const totalPaid = sale.totalAmount - sale.remainingAmount;
      return Math.max(0, expectedTotal - totalPaid);
    };
    sales.forEach(sale => {
      totalRevenue += (sale.totalAmount - sale.remainingAmount);
      totalOutstanding += sale.remainingAmount;
      if (calculateSaleOverdue(sale) > 0) overdueCount++;
      if (sale.type === 'INSTALLMENT') installmentSalesTotal += sale.totalAmount;
    });
    return { totalRevenue, totalOutstanding, overdueCount, installmentSalesTotal };
  }, [sales]);

  const accountBalances = useMemo(() => {
    const balances: Record<string, number> = {};
    accounts.forEach(acc => {
      let total = 0;
      const accountSales = sales.filter(s => s.accountId === acc.id);
      accountSales.forEach(s => {
        total += s.downPayment;
        s.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false).forEach(p => total += p.amount);
      });
      const accountExpenses = expenses.filter(e => e.accountId === acc.id);
      total -= accountExpenses.reduce((sum, e) => sum + e.amount, 0);
      balances[acc.id] = total;
    });
    return balances;
  }, [accounts, sales, expenses]);

  const workingCapital = useMemo(() => {
    const cashInAccounts = Object.values(accountBalances).reduce((sum: number, bal: number) => sum + bal, 0);
    return cashInAccounts + dashboardStats.totalOutstanding;
  }, [accountBalances, dashboardStats.totalOutstanding]);

  const totalExpectedProfit = useMemo(() => {
    if (!isManager) return 0;
    let totalProfit = 0;
    const salesWithProfit = sales.filter(s => (s.status === 'ACTIVE' || s.status === 'COMPLETED') && s.buyPrice > 0);
    salesWithProfit.forEach(sale => {
      const saleProfit = sale.totalAmount - sale.buyPrice;
      if (saleProfit <= 0) return;
      const account = accounts.find(a => a.id === sale.accountId);
      let managerProfitShare = 1;
      if (account && account.ownerId) {
        const investor = investors.find(i => i.id === account.ownerId);
        if (investor) managerProfitShare = (100 - investor.profitPercentage) / 100;
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
        if (investor) managerProfitShare = (100 - investor.profitPercentage) / 100;
      }
      const allPayments = [
        { date: sale.startDate, amount: sale.downPayment, id: `${sale.id}_dp`, isRealPayment: true },
        ...sale.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false)
      ];
      allPayments.forEach(p => {
        const paymentDate = new Date(p.date);
        if (paymentDate >= startDate && paymentDate <= endDate && p.amount > 0) {
          periodProfit += p.amount * profitMargin * managerProfitShare;
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
      if (investorAccount) filteredSales = sales.filter(s => s.accountId === investorAccount.id);
      else filteredSales = sales.filter(s => accounts.find(a => a.id === s.accountId)?.ownerId === investorId);
    }
    let customerPaymentsInPeriod = 0;
    filteredSales.forEach(sale => {
      const allPayments = [
        { date: sale.startDate, amount: sale.downPayment, isRealPayment: true },
        ...sale.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false)
      ];
      allPayments.forEach(p => {
        const paymentDate = new Date(p.date);
        if (paymentDate >= startDate && paymentDate <= endDate) customerPaymentsInPeriod += p.amount;
      });
    });
    let expectedManagerProfit = 0;
    let expectedInvestorProfit = 0;
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
        } else expectedManagerProfit += saleProfit;
      } else expectedManagerProfit += saleProfit;
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
        if (investor) managerProfitSharePercent = (100 - investor.profitPercentage) / 100;
      }
      const paymentsInPeriod = [
        { date: sale.startDate, amount: sale.downPayment, isRealPayment: true },
        ...sale.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false)
      ].filter(p => { const pDate = new Date(p.date); return pDate >= startDate && pDate <= endDate; });
      paymentsInPeriod.forEach(p => {
        const profitFromPayment = p.amount * profitMargin;
        realizedManagerProfit += profitFromPayment * managerProfitSharePercent;
        realizedInvestorProfit += profitFromPayment * (1 - managerProfitSharePercent);
      });
    });
    return { customerPaymentsInPeriod, expectedManagerProfit, expectedInvestorProfit, realizedManagerProfit, realizedInvestorProfit };
  }, [reportFilters, sales, accounts, investors, isManager]);

  // --- НАВИГАЦИЯ С АНИМАЦИЕЙ ---

  const handleSetView = (newView: ViewState) => {
    const viewOrder: ViewState[] = [
      'DASHBOARD', 'CASH_REGISTER', 'CONTRACTS', 'INVESTORS',
      'CUSTOMERS', 'OPERATIONS', 'REPORTS', 'SETTINGS', 'PROFILE', 'MORE',
      'CREATE_SALE', 'CREATE_INCOME', 'CREATE_EXPENSE', 'CUSTOMER_DETAILS', 'INVESTOR_DETAILS'
    ];
    const currentIndex = viewOrder.indexOf(currentView);
    const newIndex = viewOrder.indexOf(newView);
    // Если новый вид глубже (индекс больше) - едем вправо (1), иначе влево (-1)
    setViewDirection(newIndex > currentIndex ? 1 : -1);
    setPreviousView(currentView);
    setCurrentView(newView);
  };

  const handleBack = () => {
    handleSetView(previousView);
  };

  // Включаем свайп назад если мы не на главном экране
  useSwipeBack(handleBack, currentView !== 'DASHBOARD' && currentView !== 'MORE');

  const handleAuthSuccess = async (loggedInUser: User) => {
    setUser(loggedInUser);
    await loadData(loggedInUser);
  };

  const handleAction = (action: string) => {
    switch (action) {
      case 'CREATE_SALE': setDraftSaleData({}); setEditingSale(null); handleSetView('CREATE_SALE'); break;
      case 'INCOME': setDraftSaleData({}); handleSetView('CREATE_INCOME'); break;
      case 'EXPENSE': handleSetView('CREATE_EXPENSE'); break;
      case 'OPERATIONS': setOperationsAccountId(null); handleSetView('OPERATIONS'); break;
      case 'MANAGE_PRODUCTS': handleSetView('MANAGE_PRODUCTS'); break;
      case 'ADD_CUSTOMER': handleSetView('CUSTOMERS'); break;
      case 'ADD_PRODUCT': handleSetView('MANAGE_PRODUCTS'); break;
    }
  };

  // --- CRUD HELPERS ---
  const updateList = <T extends { id: string }>(setter: React.Dispatch<React.SetStateAction<T[]>>, item: T) => {
    setter(prev => {
      const idx = prev.findIndex(i => i.id === item.id);
      if (idx >= 0) return prev.map(i => i.id === item.id ? item : i);
      return [item, ...prev];
    });
  };
  const removeFromList = <T extends { id: string }>(setter: React.Dispatch<React.SetStateAction<T[]>>, id: string) => {
    setter(prev => prev.filter(i => i.id !== id));
  };

  const handleSaveSale = async (data: any) => {
    if (!user) return;
    const ownerId = isEmployee && user.managerId ? user.managerId : user.id;
    const saleId = data.id || Date.now().toString();
    const paymentScheduleStartDate = data.paymentDate ? new Date(data.paymentDate) : new Date(data.startDate);
    if (!data.paymentDate) paymentScheduleStartDate.setMonth(paymentScheduleStartDate.getMonth() + 1);
    const preferredDay = paymentScheduleStartDate.getDate();
    const saleData = {
      ...data, id: saleId, userId: ownerId, paymentDay: preferredDay,
      paymentPlan: data.type === 'CASH' ? [] : (data.paymentPlan || Array.from({ length: data.installments }).map((_, idx) => {
        const pDate = new Date(paymentScheduleStartDate);
        pDate.setMonth(pDate.getMonth() + idx);
        return { id: `pay_${Date.now()}_${idx}`, saleId: saleId, amount: Number((data.remainingAmount / data.installments).toFixed(2)), date: pDate.toISOString(), isPaid: false, isRealPayment: false };
      }))
    };
    const existingSaleIndex = sales.findIndex(s => s.id === data.id);
    const saleToSave = existingSaleIndex >= 0 ? { ...sales[existingSaleIndex], ...saleData } : { ...saleData, status: data.type === 'CASH' ? 'COMPLETED' : 'ACTIVE' };
    const savedSale = await api.saveItem('sales', saleToSave);
    updateList(setSales, savedSale);
    if (existingSaleIndex < 0) {
      if (Number(data.buyPrice) > 0) {
        const buyPriceExpense: Expense = { id: `exp_sale_${saleId}`, userId: ownerId, accountId: data.accountId, title: `Закуп: ${data.productName}`, amount: Number(data.buyPrice), category: 'Себестоимость', date: data.startDate };
        const savedExpense = await api.saveItem('expenses', buyPriceExpense);
        updateList(setExpenses, savedExpense);
      }
      if (data.productId) {
        const prod = products.find(p => p.id === data.productId);
        if (prod) {
          const updatedProd = { ...prod, stock: prod.stock - 1 };
          const savedProd = await api.saveItem('products', updatedProd);
          updateList(setProducts, savedProd);
        }
      }
    }
    setEditingSale(null);
  };

  const handleStartEditSale = (sale: Sale) => { setEditingSale(sale); handleSetView('CREATE_SALE'); };

  const handleDeleteSale = async (saleId: string) => {
    if (window.confirm("Вы уверены?")) {
      const sale = sales.find(s => s.id === saleId);
      await api.deleteItem('sales', saleId);
      removeFromList(setSales, saleId);
      if (sale) {
        await api.deleteItem('expenses', `exp_sale_${saleId}`);
        setExpenses(prev => prev.filter(e => e.id !== `exp_sale_${saleId}`));
        if (sale.productId) {
          const prod = products.find(p => p.id === sale.productId);
          if (prod) {
            const updatedProd = { ...prod, stock: prod.stock + 1 };
            const savedProd = await api.saveItem('products', updatedProd);
            updateList(setProducts, savedProd);
          }
        }
      }
    }
  };

  const handleViewSaleSchedule = (sale: Sale) => {
    setSelectedCustomerId(sale.customerId);
    setInitialSaleIdForDetails(sale.id);
    setPreviousView('CONTRACTS');
    handleSetView('CUSTOMER_DETAILS');
  };

  const handleIncomeSubmit = async (data: any) => {
    if (!user) return;
    if (data.type === 'CUSTOMER_PAYMENT') {
      const { saleId, amount } = data;
      const sale = sales.find(s => s.id === saleId);
      if (sale) {
        const updatedSale = { ...sale };
        updatedSale.remainingAmount = Math.max(0, updatedSale.remainingAmount - amount);
        updatedSale.paymentPlan.push({ id: `paid_${Date.now()}`, saleId: sale.id, amount: amount, date: data.date, isPaid: true, isRealPayment: true });
        if (updatedSale.remainingAmount === 0) updatedSale.status = 'COMPLETED';
        const savedSale = await api.saveItem('sales', updatedSale);
        updateList(setSales, savedSale);
      }
    } else {
      const ownerId = isEmployee && user.managerId ? user.managerId : user.id;
      const newTransaction: Sale = {
        id: `inc_${Date.now()}`, userId: ownerId, type: 'CASH', customerId: data.investorId || 'system_income',
        productName: data.note || 'Приход', buyPrice: 0, accountId: data.accountId, totalAmount: data.amount,
        downPayment: data.amount, remainingAmount: 0, interestRate: 0, installments: 0, startDate: data.date,
        status: 'COMPLETED', paymentPlan: []
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
    }
    handleSetView('OPERATIONS');
  };

  const handleExpenseSubmit = async (data: any) => {
    if (!user) return;
    const ownerId = isEmployee && user.managerId ? user.managerId : user.id;
    const newExpense: Expense = {
      id: Date.now().toString(), userId: ownerId, accountId: data.accountId, title: data.title,
      amount: data.amount, category: data.category, date: data.date, payoutType: data.payoutType,
      managerPayoutSource: data.managerPayoutSource, investorId: data.investorId
    };
    const savedExpense = await api.saveItem('expenses', newExpense);
    updateList(setExpenses, savedExpense);
    if (data.payoutType === 'INVESTMENT' && data.investorId) {
      const inv = investors.find(i => i.id === data.investorId);
      if (inv) {
        const updatedInv = { ...inv, initialAmount: inv.initialAmount - data.amount };
        const savedInv = await api.saveItem('investors', updatedInv);
        updateList(setInvestors, savedInv);
      }
    }
    handleSetView('OPERATIONS');
  };

  const handleAddEmployee = async (data: any) => {
    if (user && isManager) {
      if (!checkAccess('EMPLOYEES')) { showUpgradeAlert("Сотрудники доступны в тарифе Бизнес."); return; }
      try { const newEmp = await api.createSubUser({ ...data, role: 'employee' }); setEmployees(prev => [...prev, newEmp]); }
      catch (e) { alert("Ошибка создания сотрудника"); console.error(e); }
    }
  };
  const handleUpdateEmployee = async (updatedData: User) => { if (isManager) { await api.updateUser(updatedData); updateList(setEmployees, updatedData); } };
  const handleDeleteEmployee = async (id: string) => { if (isManager) { await api.deleteUser(id); removeFromList(setEmployees, id); } };

  const handleAddInvestor = async (name: string, phone: string, email: string, pass: string, amount: number, profitPercentage: number, permissions: InvestorPermissions) => {
    if (user && isManager) {
      if (!checkAccess('INVESTORS')) { showUpgradeAlert("Превышен лимит инвесторов для вашего тарифа."); return; }
      try {
        const newInvestorUser = await api.createSubUser({ name, email, password: pass, role: 'investor', phone });
        const newInvestor: Investor = { id: newInvestorUser.id, userId: user.id, name, phone, email, initialAmount: amount, joinedDate: new Date().toISOString(), profitPercentage, permissions };
        const savedInv = await api.saveItem('investors', newInvestor);
        updateList(setInvestors, savedInv);
        const newAccount: Account = { id: `acc_${newInvestorUser.id}`, userId: user.id, name: `Счет: ${name}`, type: 'INVESTOR', ownerId: newInvestorUser.id };
        const savedAcc = await api.saveItem('accounts', newAccount);
        updateList(setAccounts, savedAcc);
        const depositTransaction: Sale = {
          id: `dep_${Date.now()}`, userId: user.id, type: 'CASH', customerId: `system_deposit_${newInvestorUser.id}`,
          productName: 'Начальный депозит', buyPrice: 0, accountId: newAccount.id, totalAmount: amount,
          downPayment: amount, remainingAmount: 0, interestRate: 0, installments: 0, startDate: new Date().toISOString(),
          status: 'COMPLETED', paymentPlan: []
        };
        const savedTx = await api.saveItem('sales', depositTransaction);
        updateList(setSales, savedTx);
        alert("Инвестор создан!");
      } catch (e) { alert("Ошибка создания инвестора"); console.error(e); }
    }
  };

  const handleUpdateInvestor = async (updated: Investor, password?: string) => {
    if (isManager) {
      const saved = await api.saveItem('investors', updated);
      updateList(setInvestors, saved);
      const userUpdateData: any = { id: updated.id, name: updated.name, email: updated.email, permissions: updated.permissions, allowedInvestorIds: [] };
      if (password) userUpdateData.password = password;
      await api.updateUser(userUpdateData);
    }
  };

  const handleDeleteInvestor = async (id: string) => {
    if (isManager) {
      await api.deleteUser(id);
      removeFromList(setInvestors, id);
      const acc = accounts.find(a => a.ownerId === id);
      if (acc) { await api.deleteItem('accounts', acc.id); removeFromList(setAccounts, acc.id); }
    }
  };

  const handleAddProduct = async (name: string, price: number, stock: number) => {
    if (!checkAccess('WRITE')) { showUpgradeAlert("Срок подписки истек."); return; }
    if (user) {
      const ownerId = isEmployee && user.managerId ? user.managerId : user.id;
      const newProd = { id: Date.now().toString(), userId: ownerId, name, price, category: 'Общее', stock };
      const saved = await api.saveItem('products', newProd);
      updateList(setProducts, saved);
    }
  };
  const handleUpdateProduct = async (updated: Product) => { if (isEmployee && !user?.permissions?.canEdit) return; const saved = await api.saveItem('products', updated); updateList(setProducts, saved); };
  const handleDeleteProduct = async (id: string) => { if (isEmployee && !user?.permissions?.canDelete) return; await api.deleteItem('products', id); removeFromList(setProducts, id); };

  const handleAddCustomer = async (name: string, phone: string, photo: string, address: string) => {
    if (!checkAccess('WRITE')) { showUpgradeAlert("Срок подписки истек."); return; }
    if (!user) throw new Error("No user");
    const ownerId = isEmployee && user.managerId ? user.managerId : user.id;
    const newCustomer: Customer = { id: Date.now().toString(), userId: ownerId, name, phone, email: '', trustScore: 50, notes: '', photo, address };
    const saved = await api.saveItem('customers', newCustomer);
    updateList(setCustomers, saved);
    return saved;
  };
  const handleUpdateCustomer = async (updated: Customer) => { const saved = await api.saveItem('customers', updated); updateList(setCustomers, saved); };

  const handleAddAccount = async (name: string, type: Account['type'] = 'CUSTOM', partners?: string[]) => {
    if (user && isManager) {
      const newAcc = { id: `acc_${Date.now()}`, userId: user.id, name, type, partners };
      const saved = await api.saveItem('accounts', newAcc);
      updateList(setAccounts, saved);
    }
  };
  const handleSetMainAccount = async (accountId: string) => {
    if (user && isManager) {
      const updatedAccounts = accounts.map(acc => {
        if (acc.id === accountId) return { ...acc, type: 'MAIN' as const };
        if (acc.type === 'MAIN') return { ...acc, type: 'CUSTOM' as const };
        return acc;
      });
      setAccounts(updatedAccounts);
      for (const acc of updatedAccounts) await api.saveItem('accounts', acc);
    }
  };

  const handleImportData = async (data: { customers: Customer[]; products: Product[]; sales: Sale[]; accounts: Account[]; investors: Investor[]; }) => {
    if (!user) return;
    setIsLoading(true);
    try {
      for (const customer of data.customers) {
        const exists = customers.some(c => c.name === customer.name);
        if (!exists) { const saved = await api.saveItem('customers', { ...customer, userId: user.id }); updateList(setCustomers, saved); }
      }
      for (const product of data.products) {
        const exists = products.some(p => p.name === product.name);
        if (!exists) { const saved = await api.saveItem('products', { ...product, userId: user.id }); updateList(setProducts, saved); }
      }
      for (const account of data.accounts) {
        const exists = accounts.some(a => a.name === account.name);
        if (!exists) { const saved = await api.saveItem('accounts', { ...account, userId: user.id }); updateList(setAccounts, saved); }
      }
      for (const investor of data.investors) {
        const exists = investors.some(i => i.name === investor.name);
        if (!exists) { const saved = await api.saveItem('investors', { ...investor, userId: user.id }); updateList(setInvestors, saved); }
      }
      for (const sale of data.sales) {
        const saved = await api.saveItem('sales', { ...sale, userId: user.id });
        updateList(setSales, saved);
      }
      alert(`Импорт завершен! Загружено ${data.sales.length} продаж.`);
    } catch (error) { console.error("Import failed", error); alert("Ошибка при импорте данных."); } finally { setIsLoading(false); }
  };

  const handleUpdateAccount = async (updatedAccount: Account) => { if (user && isManager) { const saved = await api.saveItem('accounts', updatedAccount); updateList(setAccounts, saved); } };

  const handleUndoPayment = async (saleId: string, paymentId: string) => {
    if (isEmployee && !user?.permissions?.canDelete) { alert("Нет прав на удаление"); return; }
    const sale = sales.find(s => s.id === saleId);
    if (sale) {
      const payment = sale.paymentPlan.find(p => p.id === paymentId);
      if (payment) {
        const updatedSale = { ...sale, remainingAmount: sale.remainingAmount + payment.amount, paymentPlan: sale.paymentPlan.filter(p => p.id !== paymentId), status: 'ACTIVE' as const };
        const saved = await api.saveItem('sales', updatedSale);
        updateList(setSales, saved);
      }
    }
  };

  const handleEditPayment = async (saleId: string, paymentId: string, newDate: string) => {
    if (isEmployee && !user?.permissions?.canEdit) { alert("Нет прав на редактирование"); return; }
    const sale = sales.find(s => s.id === saleId);
    if (sale) {
      const updatedSale = { ...sale, paymentPlan: sale.paymentPlan.map(p => p.id === paymentId ? { ...p, date: newDate } : p) };
      const saved = await api.saveItem('sales', updatedSale);
      updateList(setSales, saved);
    }
  };

  const handleInitiateDashboardPayment = (sale: Sale, amount: number) => {
    if (!checkAccess('WRITE')) { showUpgradeAlert("Срок подписки истек."); return; }
    setDraftSaleData({ type: 'CUSTOMER_PAYMENT', customerId: sale.customerId, saleId: sale.id, amount });
    handleSetView('CREATE_INCOME');
  };

  const handleInitiateCustomerPayment = (sale: Sale, payment: Payment) => {
    if (!checkAccess('WRITE')) { showUpgradeAlert("Срок подписки истек."); return; }
    setDraftSaleData({ type: 'CUSTOMER_PAYMENT', customerId: sale.customerId, saleId: sale.id, amount: payment.amount });
    handleSetView('CREATE_INCOME');
  };

  const openSelection = (view: ViewState, currentData: any) => {
    setDraftSaleData(currentData);
    setPreviousView(currentView);
    handleSetView(view);
  };

  const handleSelection = (key: 'customerId', id: string) => {
    setDraftSaleData({ ...draftSaleData, [key]: id });
    handleSetView(previousView === 'CREATE_INCOME' ? 'CREATE_INCOME' : 'CREATE_SALE');
  };

  const handleQuickAddCustomer = async (data: { name: string, phone: string, address: string }) => {
    if (!user) return;
    if (!checkAccess('WRITE')) { showUpgradeAlert("Срок подписки истек."); return; }
    const ownerId = isEmployee && user.managerId ? user.managerId : user.id;
    const newCustomer: Customer = { id: Date.now().toString(), userId: ownerId, name: data.name, phone: data.phone, address: data.address, email: '', trustScore: 50, notes: '', photo: '' };
    const saved = await api.saveItem('customers', newCustomer);
    updateList(setCustomers, saved);
    handleSelection('customerId', saved.id);
  };

  const handleSelectAccountForOperations = (accountId: string) => { setOperationsAccountId(accountId); handleSetView('OPERATIONS'); };
  const handleSelectCustomer = (id: string) => { setSelectedCustomerId(id); setPreviousView(currentView); handleSetView('CUSTOMER_DETAILS'); };
  const handleSelectInvestor = (investor: Investor) => { setSelectedInvestorId(investor.id); handleSetView('INVESTOR_DETAILS'); };

  const handleAddPartnership = async (name: string, members: string[]) => {
    if (!user) return;
    const newAccountId = `acc_part_${Date.now()}`;
    const newAccount: Account = { id: newAccountId, userId: user.id, name: `Счет: ${name}`, type: 'CUSTOM' };
    const newPartnership: Partnership = { id: `part_${Date.now()}`, userId: user.id, name, accountId: newAccountId, partnerIds: members, createdAt: new Date().toISOString() };
    const savedAcc = await api.saveItem('accounts', newAccount);
    updateList(setAccounts, savedAcc);
    const savedPart = await api.saveItem('partnerships', newPartnership);
    updateList(setPartnerships, savedPart);
  };

  const handleUpdateProfile = async (data: any) => {
    if (!user) return;
    try { await api.updateUser({ ...user, ...data }); setUser({ ...user, ...data }); alert("Профиль обновлен!"); }
    catch (e) { alert("Ошибка обновления профиля"); }
  };

  const contractCounts = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let active = 0, overdue = 0, archive = 0;
    const customerIdSet = new Set(customers.map(c => c.id));
    const actualSales = sales.filter(sale => customerIdSet.has(sale.customerId));
    const calculateSaleOverdue = (sale: Sale) => {
      let expectedTotal = sale.downPayment;
      sale.paymentPlan.forEach(p => { if (!p.isRealPayment && new Date(p.date) < today) expectedTotal += p.amount; });
      const totalPaid = sale.totalAmount - sale.remainingAmount;
      return Math.max(0, expectedTotal - totalPaid);
    };
    actualSales.forEach(sale => {
      if (sale.status === 'COMPLETED' || sale.remainingAmount === 0) { archive++; return; }
      if (calculateSaleOverdue(sale) > 0) overdue++; else active++;
    });
    return { active, overdue, archive };
  }, [sales, customers]);

  const toggleMoreSection = (section: string) => { setMoreExpandedSection(moreExpandedSection === section ? null : section); };

  const handleDeleteOperation = async (op: any) => {
    if (!user) return;
    if (isEmployee && !user.permissions?.canDelete) { alert("Нет прав на удаление"); return; }
    if (!window.confirm("Вы уверены, что хотите удалить эту операцию?")) return;
    if (op.type === 'EXPENSE') { await api.deleteItem('expenses', op.id); removeFromList(setExpenses, op.id); }
    else if (op.type === 'INCOME') {
      const sale = sales.find(s => s.id === op.raw.id);
      if (!sale) return;
      if (op.id === sale.id) {
        await api.deleteItem('sales', sale.id);
        removeFromList(setSales, sale.id);
        await api.deleteItem('expenses', `exp_sale_${sale.id}`);
        setExpenses(prev => prev.filter(e => e.id !== `exp_sale_${sale.id}`));
        if (sale.productId) {
          const prod = products.find(p => p.id === sale.productId);
          if (prod) { const updatedProd = { ...prod, stock: prod.stock + 1 }; const savedProd = await api.saveItem('products', updatedProd); updateList(setProducts, savedProd); }
        }
      } else if (op.id.endsWith('_dp')) {
        const updatedSale = { ...sale, downPayment: 0, remainingAmount: sale.remainingAmount + op.amount, status: 'ACTIVE' as const };
        const saved = await api.saveItem('sales', updatedSale);
        updateList(setSales, saved);
      } else {
        const payment = sale.paymentPlan.find(p => p.id === op.id);
        if (payment) {
          const updatedSale = { ...sale, remainingAmount: sale.remainingAmount + payment.amount, paymentPlan: sale.paymentPlan.filter(p => p.id !== op.id), status: 'ACTIVE' as const };
          const saved = await api.saveItem('sales', updatedSale);
          updateList(setSales, saved);
        }
      }
    }
  };

  function toggleTheme() {
    const html = document.documentElement;
    html.classList.toggle("dark");
    const theme = html.classList.contains("dark") ? "dark" : "light";
    localStorage.setItem("theme", theme);
  }

  const handleUpdateSettings = async (newSettings: AppSettings) => {
    console.log('🔄 handleUpdateSettings вызван, новые whatsapp-настройки:', newSettings.whatsapp);
    setAppSettings(prev => {
      const updated = {
        ...prev, ...newSettings,
        whatsapp: newSettings.whatsapp ? { ...newSettings.whatsapp, templates: newSettings.whatsapp.templates ? { ...newSettings.whatsapp.templates } : prev.whatsapp?.templates } : prev.whatsapp
      };
      return updated;
    });
    saveAppSettings(newSettings);
    if (user) {
      try {
        const settingsId = `settings_${user.id}`;
        await api.saveItem('settings', { id: settingsId, ...newSettings, _updated: Date.now() });
        if (newSettings.whatsapp) {
          await api.saveWhatsAppSettings({ ...newSettings.whatsapp, templates: newSettings.whatsapp.templates ? { ...newSettings.whatsapp.templates } : undefined });
          setUser(prev => {
            if (!prev) return null;
            return { ...prev, whatsapp_settings: newSettings.whatsapp ? { ...newSettings.whatsapp, templates: newSettings.whatsapp.templates ? { ...newSettings.whatsapp.templates } : prev.whatsapp_settings?.templates } : prev.whatsapp_settings };
          });
        }
        console.log('✅ Настройки успешно сохранены на сервере');
      } catch (e) { console.error("❌ Failed to save settings to API", e); alert("Ошибка сохранения настроек. Проверьте подключение к интернету."); }
    }
    setWhatsAppRefreshKey(prev => prev + 1);
  };

  // --- РЕНДЕРИНГ ---

  if (isPublicMode) {
    return <Calculator isPublic={true} appSettings={appSettings} userPhone={user?.phone} />;
  }

  if (isLoading) {
    return <SplashScreen progress={loadingProgress} />;
  }

  if (!user && !isLoading) {
    const isPWA = window.matchMedia('(display-mode: standalone)').matches;
    if (isNative || isPWA) return <Auth onLogin={handleAuthSuccess} />;
    if (isLanding) return <Landing />;
    return <Auth onLogin={handleAuthSuccess} />;
  }

  return (
    <Layout
      currentView={currentView}
      setView={handleSetView}
      onAction={handleAction}
      onContractTabChange={setActiveContractTab}
      sales={sales}
      appSettings={appSettings}
      customers={customers}
      user={user}
      activeInvestor={activeInvestor}
      onNavigateToProfile={() => handleSetView('PROFILE')}
      isOnline={isOnline}
      isSyncing={isSyncing}
    >
      <AnimatePresence mode="wait" custom={viewDirection}>
        {currentView === 'DASHBOARD' && !isInvestor && (
          <AnimatedView key="dashboard" direction={viewDirection} currentView={currentView}>
            <Dashboard sales={sales} customers={customers} stats={dashboardStats} workingCapital={workingCapital}
              accountBalances={accountBalances} onAction={handleAction}
              onSelectCustomer={handleSelectCustomer} onInitiatePayment={handleInitiateDashboardPayment}
              accounts={accounts} appSettings={appSettings} />
          </AnimatedView>
        )}
        {currentView === 'DASHBOARD' && isInvestor && activeInvestor && (
          <AnimatedView key="investor-dashboard" direction={viewDirection} currentView={currentView}>
            <InvestorDashboard sales={sales} expenses={expenses} accounts={accounts} investor={activeInvestor}
              appSettings={appSettings} />
          </AnimatedView>
        )}
        {currentView === 'CASH_REGISTER' && (
          <AnimatedView key="cash-register" direction={viewDirection} currentView={currentView}>
            <CashRegister accounts={accounts} sales={sales} expenses={expenses} investors={investors}
              onAddAccount={handleAddAccount} onAction={handleAction}
              onSelectAccount={handleSelectAccountForOperations}
              onSetMainAccount={handleSetMainAccount} onUpdateAccount={handleUpdateAccount}
              isManager={isManager} totalExpectedProfit={totalExpectedProfit}
              realizedPeriodProfit={realizedPeriodProfit} myProfitPeriod={myProfitPeriod}
              setMyProfitPeriod={setMyProfitPeriod} appSettings={appSettings} />
          </AnimatedView>
        )}
        {currentView === 'CONTRACTS' && (
          <AnimatedView key="contracts" direction={viewDirection} currentView={currentView}>
            <Contracts
              sales={isInvestor ? sales.filter(s => s.accountId === accounts.find(a => a.ownerId === user.id)?.id) : sales}
              customers={customers} accounts={accounts} activeTab={activeContractTab}
              onTabChange={setActiveContractTab} onViewSchedule={handleViewSaleSchedule}
              onEditSale={handleStartEditSale} onDeleteSale={handleDeleteSale}
              readOnly={isInvestor} user={user} appSettings={appSettings} />
          </AnimatedView>
        )}
        {currentView === 'INVESTORS' && (
          <AnimatedView key="investors" direction={viewDirection} currentView={currentView}>
            <Investors investors={investors} onAddInvestor={handleAddInvestor}
              onUpdateInvestor={handleUpdateInvestor} onDeleteInvestor={handleDeleteInvestor}
              onViewDetails={handleSelectInvestor} appSettings={appSettings} />
          </AnimatedView>
        )}
        {currentView === 'INVESTOR_DETAILS' && selectedInvestorId && (
          <AnimatedView key="investor-details" direction={viewDirection} currentView={currentView}>
            <InvestorDetails investor={investors.find(i => i.id === selectedInvestorId)!}
              account={accounts.find(a => a.ownerId === selectedInvestorId)} sales={sales}
              expenses={expenses} onBack={() => handleSetView('INVESTORS')} appSettings={appSettings} />
          </AnimatedView>
        )}
        {currentView === 'PARTNERS' && (
          <AnimatedView key="partners" direction={viewDirection} currentView={currentView}>
            <Partners partnerships={partnerships} investors={investors} accounts={accounts} sales={sales}
              expenses={expenses} onAddPartnership={handleAddPartnership}
              onSelectAccount={handleSelectAccountForOperations} appSettings={appSettings} />
          </AnimatedView>
        )}
        {currentView === 'CUSTOMERS' && (
          <AnimatedView key="customers" direction={viewDirection} currentView={currentView}>
            <Customers customers={customers} accounts={accounts} investors={investors} sales={sales}
              onAddCustomer={handleAddCustomer} onSelectCustomer={handleSelectCustomer}
              onInitiatePayment={handleInitiateCustomerPayment} onUndoPayment={handleUndoPayment}
              onEditPayment={handleEditPayment} onUpdateCustomer={handleUpdateCustomer}
              appSettings={appSettings} />
          </AnimatedView>
        )}
        {currentView === 'CUSTOMER_DETAILS' && selectedCustomerId && (
          <AnimatedView key="customer-details" direction={viewDirection} currentView={currentView}>
            <CustomerDetails customer={customers.find(c => c.id === selectedCustomerId)!} sales={sales}
              accounts={accounts} investors={investors} onBack={() => handleSetView(previousView)}
              onInitiatePayment={handleInitiateCustomerPayment} onUndoPayment={handleUndoPayment}
              onEditPayment={handleEditPayment} onUpdateCustomer={handleUpdateCustomer}
              initialSaleId={initialSaleIdForDetails} appSettings={appSettings} />
          </AnimatedView>
        )}
        {currentView === 'MANAGE_PRODUCTS' && (
          <AnimatedView key="products" direction={viewDirection} currentView={currentView}>
            <Products products={products} onAddProduct={handleAddProduct} onUpdateProduct={handleUpdateProduct}
              onDeleteProduct={handleDeleteProduct} appSettings={appSettings} />
          </AnimatedView>
        )}
        {currentView === 'OPERATIONS' && (
          <AnimatedView key="operations" direction={viewDirection} currentView={currentView}>
            <Operations
              sales={isInvestor ? sales.filter(s => s.accountId === accounts.find(a => a.ownerId === user.id)?.id) : sales}
              expenses={isInvestor ? expenses.filter(e => e.accountId === accounts.find(a => a.ownerId === user.id)?.id) : expenses}
              accounts={accounts} customers={customers} initialAccountId={operationsAccountId}
              onDelete={handleDeleteOperation} appSettings={appSettings} />
          </AnimatedView>
        )}
        {currentView === 'REPORTS' && reportData && (
          <AnimatedView key="reports" direction={viewDirection} currentView={currentView}>
            <Reports investors={investors} filters={reportFilters} onFiltersChange={setReportFilters}
              data={reportData} appSettings={appSettings} />
          </AnimatedView>
        )}
        {currentView === 'CREATE_INCOME' && (
          <AnimatedView key="create-income" direction={viewDirection} currentView={currentView}>
            <NewIncome initialData={draftSaleData} customers={customers} investors={investors} accounts={accounts}
              sales={sales} onClose={() => handleSetView('DASHBOARD')} onSubmit={handleIncomeSubmit}
              onSelectCustomer={() => openSelection('SELECT_CUSTOMER', draftSaleData)} appSettings={appSettings} />
          </AnimatedView>
        )}
        {currentView === 'CREATE_EXPENSE' && (
          <AnimatedView key="create-expense" direction={viewDirection} currentView={currentView}>
            <NewExpense investors={investors} accounts={accounts} onClose={() => handleSetView('DASHBOARD')}
              onSubmit={handleExpenseSubmit} appSettings={appSettings} />
          </AnimatedView>
        )}
        {currentView === 'CREATE_SALE' && (
          <AnimatedView key="create-sale" direction={viewDirection} currentView={currentView}>
            <NewSale initialData={editingSale || draftSaleData} customers={customers} products={products}
              accounts={accounts} onClose={() => { handleSetView('DASHBOARD'); setEditingSale(null); }}
              onSelectCustomer={(data) => openSelection('SELECT_CUSTOMER', data)} onSubmit={handleSaveSale}
              appSettings={appSettings} />
          </AnimatedView>
        )}
        {currentView === 'SELECT_CUSTOMER' && (
          <AnimatedView key="select-customer" direction={viewDirection} currentView={currentView}>
            <SelectionList title="Выберите клиента" items={customers.map(c => ({ id: c.id, title: c.name, subtitle: c.phone }))}
              onSelect={(id) => handleSelection('customerId', id)}
              onCancel={() => handleSetView(previousView === 'CREATE_INCOME' ? 'CREATE_INCOME' : 'CREATE_SALE')}
              onAddNew={handleQuickAddCustomer} />
          </AnimatedView>
        )}
        {currentView === 'EMPLOYEES' && (
          <AnimatedView key="employees" direction={viewDirection} currentView={currentView}>
            <Employees employees={employees} investors={investors} onAddEmployee={handleAddEmployee}
              onUpdateEmployee={handleUpdateEmployee} onDeleteEmployee={handleDeleteEmployee}
              appSettings={appSettings} />
          </AnimatedView>
        )}
        {currentView === 'TARIFFS' && (
          <AnimatedView key="tariffs" direction={viewDirection} currentView={currentView}>
            <Tariffs user={user} />
          </AnimatedView>
        )}
        {currentView === 'SETTINGS' && (
          <AnimatedView key="settings" direction={viewDirection} currentView={currentView}>
            <Settings appSettings={appSettings} onUpdateSettings={handleUpdateSettings}
              onNavigate={handleSetView} onImportData={handleImportData} />
          </AnimatedView>
        )}
        {currentView === 'INTEGRATIONS' && (
          <AnimatedView key="integrations" direction={viewDirection} currentView={currentView}>
            <Integrations appSettings={appSettings} onUpdateSettings={handleUpdateSettings}
              onBack={() => handleSetView('SETTINGS')} whatsappRefreshKey={whatsappRefreshKey}
              onSettingsChanged={() => console.log('Настройки WhatsApp обновлены')} />
          </AnimatedView>
        )}
        {currentView === 'CALCULATOR' && (
          <AnimatedView key="calculator" direction={viewDirection} currentView={currentView}>
            <Calculator appSettings={appSettings} userPhone={user?.phone}
              onBack={() => handleSetView('SETTINGS')} onSaveSettings={handleUpdateSettings} />
          </AnimatedView>
        )}
        {currentView === 'PROFILE' && user && (
          <AnimatedView key="profile" direction={viewDirection} currentView={currentView}>
            <Profile user={user} onUpdateProfile={handleUpdateProfile} onBack={() => handleSetView('MORE')}
              onLogout={() => { localStorage.removeItem('user'); localStorage.removeItem('token'); setUser(null); }} />
          </AnimatedView>
        )}
        {currentView === 'ADMIN_PANEL' && (
          <AnimatedView key="admin" direction={viewDirection} currentView={currentView}>
            <AdminPanel />
          </AnimatedView>
        )}
        {currentView === 'MORE' && !isInvestor && (
          <AnimatedView key="more" direction={viewDirection} currentView={currentView}>
            <div className="space-y-4 animate-fade-in pb-20">
              <button onClick={() => handleSetView('PROFILE')}
                className="w-full bg-slate-900 text-white p-6 rounded-2xl flex items-center gap-4 hover:bg-slate-800">
                <div className="w-16 h-16 bg-indigo-500 rounded-full flex items-center justify-center text-2xl font-bold">{user.name.charAt(0).toUpperCase()}</div>
                <div><h2 className="text-xl font-bold text-left">{user.name}</h2><p className="text-slate-400 text-sm capitalize text-left">{user.role}</p><p className="text-slate-500 text-xs mt-1 text-left">{user.email}</p></div>
              </button>
              <div className="space-y-2 pt-4">
                <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
                  <button onClick={() => toggleMoreSection('CASH')}
                    className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="bg-emerald-100 text-emerald-600 p-2 rounded-lg">{ICONS.Wallet}</div>
                      <span className="font-semibold text-slate-800">Касса</span>
                    </div>
                    <span className={`text-slate-400 transition-transform ${moreExpandedSection === 'CASH' ? 'rotate-90' : ''}`}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                    </span>
                  </button>
                  {moreExpandedSection === 'CASH' && (
                    <div className="bg-slate-50 border-t border-slate-100 p-2 space-y-1">
                      <button onClick={() => handleSetView('CASH_REGISTER')} className="w-full text-left px-4 py-3 rounded-lg hover:bg-white text-sm text-slate-600 flex items-center gap-2">
                        <span className="opacity-70">{ICONS.Wallet}</span> Счета
                      </button>
                      <button onClick={() => handleAction('INCOME')} className="w-full text-left px-4 py-3 rounded-lg hover:bg-white text-sm text-slate-600 flex items-center gap-2">
                        <span className="opacity-70">{ICONS.Income}</span> Приход
                      </button>
                      <button onClick={() => handleAction('EXPENSE')} className="w-full text-left px-4 py-3 rounded-lg hover:bg-white text-sm text-slate-600 flex items-center gap-2">
                        <span className="opacity-70">{ICONS.Expense}</span> Расход
                      </button>
                      <button onClick={() => handleAction('OPERATIONS')} className="w-full text-left px-4 py-3 rounded-lg hover:bg-white text-sm text-slate-600 flex items-center gap-2">
                        <span className="opacity-70">{ICONS.List}</span> История
                      </button>
                    </div>
                  )}
                </div>
                <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
                  <button onClick={() => toggleMoreSection('CONTRACTS')}
                    className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="bg-indigo-100 text-indigo-600 p-2 rounded-lg">{ICONS.File}</div>
                      <span className="font-semibold text-slate-800">Договоры</span>
                    </div>
                    <span className={`text-slate-400 transition-transform ${moreExpandedSection === 'CONTRACTS' ? 'rotate-90' : ''}`}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                    </span>
                  </button>
                  {moreExpandedSection === 'CONTRACTS' && (
                    <div className="bg-slate-50 border-t border-slate-100 p-2 space-y-1">
                      <button onClick={() => handleAction('CREATE_SALE')} className="w-full text-left px-4 py-3 rounded-lg hover:bg-white text-sm text-slate-600 flex items-center gap-2">
                        <span className="opacity-70">{ICONS.AddSmall}</span> Оформить
                      </button>
                      <button onClick={() => { handleSetView('CONTRACTS'); setActiveContractTab('ACTIVE'); }}
                        className="w-full text-left px-4 py-3 rounded-lg hover:bg-white text-sm text-slate-600 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2"><span className="opacity-70">{ICONS.Check}</span> Активные</div>
                        {contractCounts.active > 0 && <span className="text-xs bg-indigo-100 text-indigo-600 font-semibold px-2 py-0.5 rounded-full">{contractCounts.active}</span>}
                      </button>
                      <button onClick={() => { handleSetView('CONTRACTS'); setActiveContractTab('OVERDUE'); }}
                        className="w-full text-left px-4 py-3 rounded-lg hover:bg-white text-sm text-slate-600 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2"><span className="opacity-70">{ICONS.Alert}</span> Просроченные</div>
                        {contractCounts.overdue > 0 && <span className="text-xs bg-red-100 text-red-600 font-semibold px-2 py-0.5 rounded-full">{contractCounts.overdue}</span>}
                      </button>
                      <button onClick={() => { handleSetView('CONTRACTS'); setActiveContractTab('ARCHIVE'); }}
                        className="w-full text-left px-4 py-3 rounded-lg hover:bg-white text-sm text-slate-600 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2"><span className="opacity-70">{ICONS.Clock}</span> Архив</div>
                        {contractCounts.archive > 0 && <span className="text-xs bg-slate-100 text-slate-600 font-semibold px-2 py-0.5 rounded-full">{contractCounts.archive}</span>}
                      </button>
                    </div>
                  )}
                </div>
                <button onClick={() => handleSetView('REPORTS')}
                  className="w-full bg-white rounded-xl border border-slate-100 p-4 flex items-center justify-between hover:bg-slate-50">
                  <div className="flex items-center gap-3">
                    <div className="bg-sky-100 text-sky-600 p-2 rounded-lg">{ICONS.Dashboard}</div>
                    <span className="font-semibold text-slate-800">Отчеты</span>
                  </div>
                  <span className="text-slate-400"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></span>
                </button>
                <button onClick={() => handleSetView('CUSTOMERS')}
                  className="w-full bg-white rounded-xl border border-slate-100 p-4 flex items-center justify-between hover:bg-slate-50">
                  <div className="flex items-center gap-3">
                    <div className="bg-orange-100 text-orange-600 p-2 rounded-lg">{ICONS.Customers}</div>
                    <span className="font-semibold text-slate-800">Клиенты</span>
                  </div>
                  <span className="text-slate-400"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></span>
                </button>
                <button onClick={() => handleSetView('INVESTORS')}
                  className="w-full bg-white rounded-xl border border-slate-100 p-4 flex items-center justify-between hover:bg-slate-50">
                  <div className="flex items-center gap-3">
                    <div className="bg-purple-100 text-purple-600 p-2 rounded-lg">{ICONS.Users}</div>
                    <span className="font-semibold text-slate-800">Инвесторы</span>
                  </div>
                  <span className="text-slate-400"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></span>
                </button>
                {user.role === 'manager' && (
                  <button onClick={() => handleSetView('EMPLOYEES')}
                    className="w-full bg-white rounded-xl border border-slate-100 p-4 flex items-center justify-between hover:bg-slate-50">
                    <div className="flex items-center gap-3">
                      <div className="bg-blue-100 text-blue-600 p-2 rounded-lg">{ICONS.Employees}</div>
                      <span className="font-semibold text-slate-800">Сотрудники</span>
                    </div>
                    <span className="text-slate-400"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></span>
                  </button>
                )}
                <button onClick={() => handleSetView('TARIFFS')}
                  className="w-full bg-white rounded-xl border border-slate-100 p-4 flex items-center justify-between hover:bg-slate-50">
                  <div className="flex items-center gap-3">
                    <div className="bg-emerald-100 text-emerald-600 p-2 rounded-lg">{ICONS.Tariffs}</div>
                    <span className="font-semibold text-slate-800">Тарифы</span>
                  </div>
                  <span className="text-slate-400"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></span>
                </button>
                {user.role === 'admin' && (
                  <button onClick={() => handleSetView('ADMIN_PANEL')}
                    className="w-full bg-white rounded-xl border border-slate-100 p-4 flex items-center justify-between hover:bg-slate-50">
                    <div className="flex items-center gap-3">
                      <div className="bg-red-100 text-red-600 p-2 rounded-lg">{ICONS.Crown}</div>
                      <span className="font-semibold text-slate-800">Админ панель</span>
                    </div>
                    <span className="text-slate-400"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></span>
                  </button>
                )}
                <button onClick={() => handleSetView('SETTINGS')}
                  className="w-full bg-white rounded-xl border border-slate-100 p-4 flex items-center justify-between hover:bg-slate-50">
                  <div className="flex items-center gap-3">
                    <div className="bg-slate-100 text-slate-600 p-2 rounded-lg">{ICONS.Settings}</div>
                    <span className="font-semibold text-slate-800">Настройки</span>
                  </div>
                  <span className="text-slate-400"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></span>
                </button>
              </div>
              <div className="pt-4">
                <button onClick={() => { localStorage.removeItem('user'); localStorage.removeItem('token'); setUser(null); }}
                  className="w-full p-4 bg-red-50 text-red-600 rounded-xl font-medium">Выйти из системы
                </button>
              </div>
            </div>
          </AnimatedView>
        )}
      </AnimatePresence>
    </Layout>
  );
};

export default App;