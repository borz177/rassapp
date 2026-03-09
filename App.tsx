
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
import { useSwipeable } from "react-swipeable"

import Landing from './components/Landing.tsx';


async function enablePersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {

    const isPersisted = await navigator.storage.persisted();

    if (!isPersisted) {
      const granted = await navigator.storage.persist();
      console.log("Persistent storage granted:", granted);
    } else {
      console.log("Persistent storage already enabled");
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
  const [viewHistory, setViewHistory] = useState<ViewState[]>(['DASHBOARD'])
  const [swipeX, setSwipeX] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)
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

  const [myProfitPeriod, setMyProfitPeriod] = useState(() => {
    const today = new Date().toISOString().split('T')[0];
    return { start: '2023-01-01', end: today };
  });

  const [reportFilters, setReportFilters] = useState({
      investorId: 'ALL',
      period: myProfitPeriod
  });

// автоматически добавляем экран в историю
useEffect(() => {
  setViewHistory(prev => {
    const last = prev[prev.length - 1]
    if (last === currentView) return prev
    return [...prev, currentView]
  })
}, [currentView])

// возврат назад
const handleSwipeBack = () => {
  if (currentView === "DASHBOARD") return

  setViewHistory(prev => {
    if (prev.length <= 1) return prev

    const newHistory = prev.slice(0, -1)
    const previousView = newHistory[newHistory.length - 1]

    setCurrentView(previousView)
    return newHistory
  })
}

// swipe обработчик
const swipeHandlers = useSwipeable({
  onSwiping: (event) => {
    if (currentView === "DASHBOARD") return
    if (event.initial[0] > 40) return

    if (Math.abs(event.deltaX) > Math.abs(event.deltaY) && event.deltaX > 0) {
      setIsSwiping(true)
      setSwipeX(Math.min(event.deltaX, 300))
    }
  },

  onSwipedRight: () => {
    if (swipeX > 120) {
      handleSwipeBack()
    }

    setSwipeX(0)
    setIsSwiping(false)
  },

  onSwipedLeft: () => {
    setSwipeX(0)
    setIsSwiping(false)
  },

  trackMouse: true,
  preventScrollOnSwipe: false,
  delta: 10
})



    const isNative =
  navigator.userAgent.includes("Electron") ||
  navigator.userAgent.includes("Android") ||
  navigator.userAgent.includes("wv")











  useEffect(() => {
      setReportFilters(prev => ({...prev, period: myProfitPeriod}));
  }, [myProfitPeriod]);

  // Network Status & Sync
  useEffect(() => {
      const handleOnline = () => {
          setIsOnline(true);
          handleSync();
      };
      const handleOffline = () => setIsOnline(false);

      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);

      // Initial Sync check
      if (navigator.onLine) {
          handleSync();
      }

      return () => {
          window.removeEventListener('online', handleOnline);
          window.removeEventListener('offline', handleOffline);
      };
  }, []);

  const handleSync = async () => {
      if (!navigator.onLine) return;
      setIsSyncing(true);
      try {
          await api.sync();
          // Optional: Reload data after sync to ensure consistency with server
          // await loadData();
      } catch (e) {
          console.error("Sync failed", e);
      } finally {
          setIsSyncing(false);
      }
  };

  // Initial Data Load (Auth Check & Fetch)
  useEffect(() => {
    enablePersistentStorage();
    const initApp = async () => {
        // Check for Public Calculator Link
        // Support: ?view=public_calc, ?v=calc, OR path /calc/CompanyName
        const searchParams = new URLSearchParams(window.location.search);
        const pathName = window.location.pathname;
        const decodedPath = decodeURIComponent(pathName);

        if (
            searchParams.get('view') === 'public_calc' ||
            searchParams.get('v') === 'calc' ||
            decodedPath.startsWith('/calc')
        ) {
            setIsPublicMode(true);
            setIsLoading(false);
            return;
        }

        // 1. Restore Local User FIRST (Offline Priority)
        const localUserStr = localStorage.getItem('user');
        let localUser: User | null = null;
        if (localUserStr) {
            try {
                localUser = JSON.parse(localUserStr);
                if (localUser) {
                    console.log("Restoring user from local storage...");
                    setUser(localUser);
                    setIsLoading(false); // <--- IMPORTANT: Stop loading immediately
                    // Load data immediately using local user context
                    await loadData(localUser).catch(e => console.warn("Local data load warning:", e));
                }
            } catch (e) {
                console.error("Failed to parse local user", e);
            }
        }

        // 2. If Online, try to refresh from server
        const token = localStorage.getItem('token');
        if (token && navigator.onLine) {
            try {
                const freshUser = await api.getMe();
                setUser(freshUser);
                localStorage.setItem('user', JSON.stringify(freshUser));
                // Refresh data with fresh permissions/settings, skip loading spinner if we already have data
                await loadData(freshUser, !!localUser);
            } catch (err) {
                console.error('Auth refresh failed', err);
                // Only logout if we DON'T have a local user to fall back on
                if (!localUser) {
                    localStorage.removeItem('token');
                    localStorage.removeItem('user');
                    setUser(null);
                }
            }
        } else if (!token && !localUser) {
            // No token and no local user -> Stop loading to show Auth
            setIsLoading(false);
        }

        // Ensure loading is turned off
        if (!token && !localUser) {
             setIsLoading(false);
        }

        // Load default local settings first
        setAppSettings(getAppSettings());
    };

    initApp();
  }, []);

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

  // ... (CRUD helpers updateList, removeFromList, handleSaveSale, etc. kept same) ...
  const updateList = <T extends { id: string }>(setter: React.Dispatch<React.SetStateAction<T[]>>, item: T) => { setter(prev => { const idx = prev.findIndex(i => i.id === item.id); if (idx >= 0) return prev.map(i => i.id === item.id ? item : i); return [item, ...prev]; }); };
  const removeFromList = <T extends { id: string }>(setter: React.Dispatch<React.SetStateAction<T[]>>, id: string) => { setter(prev => prev.filter(i => i.id !== id)); };

  const handleSaveSale = async (data: any) => { if (!user) return; const ownerId = isEmployee && user.managerId ? user.managerId : user.id; const saleId = data.id || Date.now().toString(); const paymentScheduleStartDate = data.paymentDate ? new Date(data.paymentDate) : new Date(data.startDate); if (!data.paymentDate) { paymentScheduleStartDate.setMonth(paymentScheduleStartDate.getMonth() + 1); } const preferredDay = paymentScheduleStartDate.getDate(); const saleData = { ...data, id: saleId, userId: ownerId, paymentDay: preferredDay, paymentPlan: data.type === 'CASH' ? [] : (data.paymentPlan || Array.from({ length: data.installments }).map((_, idx) => { const pDate = new Date(paymentScheduleStartDate); pDate.setMonth(pDate.getMonth() + idx); return { id: `pay_${Date.now()}_${idx}`, saleId: saleId, amount: Number((data.remainingAmount / data.installments).toFixed(2)), date: pDate.toISOString(), isPaid: false, isRealPayment: false }; })) }; const existingSaleIndex = sales.findIndex(s => s.id === data.id); const saleToSave = existingSaleIndex >= 0 ? { ...sales[existingSaleIndex], ...saleData } : { ...saleData, status: data.type === 'CASH' ? 'COMPLETED' : 'ACTIVE' }; const savedSale = await api.saveItem('sales', saleToSave); updateList(setSales, savedSale); if (existingSaleIndex < 0) { if (Number(data.buyPrice) > 0) { const buyPriceExpense: Expense = { id: `exp_sale_${saleId}`, userId: ownerId, accountId: data.accountId, title: `Закуп: ${data.productName}`, amount: Number(data.buyPrice), category: 'Себестоимость', date: data.startDate }; const savedExpense = await api.saveItem('expenses', buyPriceExpense); updateList(setExpenses, savedExpense); } if (data.productId) { const prod = products.find(p => p.id === data.productId); if(prod) { const updatedProd = { ...prod, stock: prod.stock - 1 }; const savedProd = await api.saveItem('products', updatedProd); updateList(setProducts, savedProd); } } } setEditingSale(null); };
  const handleStartEditSale = (sale: Sale) => { setEditingSale(sale); setCurrentView('CREATE_SALE'); };
  const handleDeleteSale = async (saleId: string) => { if (window.confirm("Вы уверены?")) { const sale = sales.find(s => s.id === saleId); await api.deleteItem('sales', saleId); removeFromList(setSales, saleId); if(sale) { await api.deleteItem('expenses', `exp_sale_${saleId}`); setExpenses(prev => prev.filter(e => e.id !== `exp_sale_${saleId}`)); if (sale.productId) { const prod = products.find(p => p.id === sale.productId); if(prod) { const updatedProd = { ...prod, stock: prod.stock + 1 }; const savedProd = await api.saveItem('products', updatedProd); updateList(setProducts, savedProd); } } } } };
  const handleViewSaleSchedule = (sale: Sale) => { setSelectedCustomerId(sale.customerId); setInitialSaleIdForDetails(sale.id); setPreviousView('CONTRACTS'); setCurrentView('CUSTOMER_DETAILS'); };
  const handleIncomeSubmit = async (data: any) => { if (!user) return; if (data.type === 'CUSTOMER_PAYMENT') { const { saleId, amount } = data; const sale = sales.find(s => s.id === saleId); if (sale) { const updatedSale = { ...sale }; updatedSale.remainingAmount = Math.max(0, updatedSale.remainingAmount - amount); updatedSale.paymentPlan.push({ id: `paid_${Date.now()}`, saleId: sale.id, amount: amount, date: data.date, isPaid: true, isRealPayment: true }); if (updatedSale.remainingAmount === 0) updatedSale.status = 'COMPLETED'; const savedSale = await api.saveItem('sales', updatedSale); updateList(setSales, savedSale); } } else { const ownerId = isEmployee && user.managerId ? user.managerId : user.id; const newTransaction: Sale = { id: `inc_${Date.now()}`, userId: ownerId, type: 'CASH', customerId: data.investorId || 'system_income', productName: data.note || 'Приход', buyPrice: 0, accountId: data.accountId, totalAmount: data.amount, downPayment: data.amount, remainingAmount: 0, interestRate: 0, installments: 0, startDate: data.date, status: 'COMPLETED', paymentPlan: [] }; const savedTx = await api.saveItem('sales', newTransaction); updateList(setSales, savedTx); if (data.type === 'INVESTOR_DEPOSIT') { const inv = investors.find(i => i.id === data.investorId); if (inv) { const updatedInv = { ...inv, initialAmount: (inv.initialAmount || 0) + Number(data.amount) }; const savedInv = await api.saveItem('investors', updatedInv); updateList(setInvestors, savedInv); } } } setCurrentView('OPERATIONS'); };
  const handleExpenseSubmit = async (data: any) => { if (!user) return; const ownerId = isEmployee && user.managerId ? user.managerId : user.id; const newExpense: Expense = { id: Date.now().toString(), userId: ownerId, accountId: data.accountId, title: data.title, amount: data.amount, category: data.category, date: data.date, payoutType: data.payoutType, managerPayoutSource: data.managerPayoutSource, investorId: data.investorId }; const savedExpense = await api.saveItem('expenses', newExpense); updateList(setExpenses, savedExpense); if(data.payoutType === 'INVESTMENT' && data.investorId) { const inv = investors.find(i => i.id === data.investorId); if (inv) { const updatedInv = { ...inv, initialAmount: inv.initialAmount - data.amount }; const savedInv = await api.saveItem('investors', updatedInv); updateList(setInvestors, savedInv); } } setCurrentView('OPERATIONS'); };
  const handleAddEmployee = async (data: any) => { if (user && isManager) { if (!checkAccess('EMPLOYEES')) { showUpgradeAlert("Сотрудники доступны в тарифе Бизнес."); return; } try { const newEmp = await api.createSubUser({ ...data, role: 'employee' }); setEmployees(prev => [...prev, newEmp]); } catch(e) { alert("Ошибка создания сотрудника"); console.error(e); } } };
  const handleUpdateEmployee = async (updatedData: User) => { if (isManager) { await api.updateUser(updatedData); updateList(setEmployees, updatedData); } };
  const handleDeleteEmployee = async (id: string) => { if (isManager) { await api.deleteUser(id); removeFromList(setEmployees, id); } };
  const handleAddInvestor = async (name: string, phone: string, email: string, pass: string, amount: number, profitPercentage: number, permissions: InvestorPermissions) => { if (user && isManager) { if (!checkAccess('INVESTORS')) { showUpgradeAlert("Превышен лимит инвесторов для вашего тарифа."); return; } try { const newInvestorUser = await api.createSubUser({ name, email, password: pass, role: 'investor', phone }); const newInvestor: Investor = { id: newInvestorUser.id, userId: user.id, name, phone, email, initialAmount: amount, joinedDate: new Date().toISOString(), profitPercentage, permissions }; const savedInv = await api.saveItem('investors', newInvestor); updateList(setInvestors, savedInv); const newAccount: Account = { id: `acc_${newInvestorUser.id}`, userId: user.id, name: `Счет: ${name}`, type: 'INVESTOR', ownerId: newInvestorUser.id }; const savedAcc = await api.saveItem('accounts', newAccount); updateList(setAccounts, savedAcc); const depositTransaction: Sale = { id: `dep_${Date.now()}`, userId: user.id, type: 'CASH', customerId: `system_deposit_${newInvestorUser.id}`, productName: 'Начальный депозит', buyPrice: 0, accountId: newAccount.id, totalAmount: amount, downPayment: amount, remainingAmount: 0, interestRate: 0, installments: 0, startDate: new Date().toISOString(), status: 'COMPLETED', paymentPlan: [] }; const savedTx = await api.saveItem('sales', depositTransaction); updateList(setSales, savedTx); alert("Инвестор создан!"); } catch(e) { alert("Ошибка создания инвестора"); console.error(e); } } };
  const handleUpdateInvestor = async (updated: Investor, password?: string) => {
      if (isManager) {
          const saved = await api.saveItem('investors', updated);
          updateList(setInvestors, saved);

          // Also update the User record
          const userUpdateData: any = {
              id: updated.id,
              name: updated.name,
              email: updated.email,
              permissions: updated.permissions,
              allowedInvestorIds: []
          };
          if (password) {
              userUpdateData.password = password;
          }
          await api.updateUser(userUpdateData);
      }
  };
  const handleDeleteInvestor = async (id: string) => {
      if (isManager) {
          await api.deleteUser(id);
          removeFromList(setInvestors, id);
          const acc = accounts.find(a => a.ownerId === id);
          if(acc) {
              await api.deleteItem('accounts', acc.id);
              removeFromList(setAccounts, acc.id);
          }
      }
  };
  const handleAddProduct = async (name: string, price: number, stock: number) => { if (!checkAccess('WRITE')) { showUpgradeAlert("Срок подписки истек."); return; } if (user) { const ownerId = isEmployee && user.managerId ? user.managerId : user.id; const newProd = { id: Date.now().toString(), userId: ownerId, name, price, category: 'Общее', stock }; const saved = await api.saveItem('products', newProd); updateList(setProducts, saved); } };
  const handleUpdateProduct = async (updated: Product) => { if (isEmployee && !user?.permissions?.canEdit) return; const saved = await api.saveItem('products', updated); updateList(setProducts, saved); };
  const handleDeleteProduct = async (id: string) => { if (isEmployee && !user?.permissions?.canDelete) return; await api.deleteItem('products', id); removeFromList(setProducts, id); };
  const handleAddCustomer = async (name: string, phone: string, photo: string, address: string) => { if (!checkAccess('WRITE')) { showUpgradeAlert("Срок подписки истек."); return; } if (!user) throw new Error("No user"); const ownerId = isEmployee && user.managerId ? user.managerId : user.id; const newCustomer: Customer = { id: Date.now().toString(), userId: ownerId, name, phone, email: '', trustScore: 50, notes: '', photo, address }; const saved = await api.saveItem('customers', newCustomer); updateList(setCustomers, saved); return saved; };
  const handleUpdateCustomer = async (updated: Customer) => { const saved = await api.saveItem('customers', updated); updateList(setCustomers, saved); };
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
  const handleQuickAddCustomer = async (data: { name: string, phone: string, address: string }) => { if (!user) return; if (!checkAccess('WRITE')) { showUpgradeAlert("Срок подписки истек."); return; } const ownerId = isEmployee && user.managerId ? user.managerId : user.id; const newCustomer: Customer = { id: Date.now().toString(), userId: ownerId, name: data.name, phone: data.phone, address: data.address, email: '', trustScore: 50, notes: '', photo: '' }; const saved = await api.saveItem('customers', newCustomer); updateList(setCustomers, saved); handleSelection('customerId', saved.id); };
  const handleSelectAccountForOperations = (accountId: string) => { setOperationsAccountId(accountId); setCurrentView('OPERATIONS'); };
  const handleSelectCustomer = (id: string) => { setSelectedCustomerId(id); setPreviousView(currentView); setCurrentView('CUSTOMER_DETAILS'); };
  const handleSelectInvestor = (investor: Investor) => { setSelectedInvestorId(investor.id); setCurrentView('INVESTOR_DETAILS'); };
  const handleAddPartnership = async (name: string, members: string[]) => { if (!user) return; const newAccountId = `acc_part_${Date.now()}`; const newAccount: Account = { id: newAccountId, userId: user.id, name: `Счет: ${name}`, type: 'CUSTOM' }; const newPartnership: Partnership = { id: `part_${Date.now()}`, userId: user.id, name, accountId: newAccountId, partnerIds: members, createdAt: new Date().toISOString() }; const savedAcc = await api.saveItem('accounts', newAccount); updateList(setAccounts, savedAcc); const savedPart = await api.saveItem('partnerships', newPartnership); updateList(setPartnerships, savedPart); };
  const handleUpdateProfile = async (data: any) => { if (!user) return; try { await api.updateUser({ ...user, ...data }); setUser({ ...user, ...data }); alert("Профиль обновлен!"); } catch(e) { alert("Ошибка обновления профиля"); } };
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

const handleUpdateSettings = async (newSettings: AppSettings) => {
    console.log('🔄 handleUpdateSettings вызван, новые whatsapp-настройки:', newSettings.whatsapp);

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

            console.log('✅ Настройки успешно сохранены на сервере');

        } catch (e) {
            console.error("❌ Failed to save settings to API", e);
            alert("Ошибка сохранения настроек. Проверьте подключение к интернету.");
        }
    }

    // 🔹 6. Триггер для компонентов, которые зависят от настроек WhatsApp
    // (например, список шаблонов, отправка сообщений)
    setWhatsAppRefreshKey(prev => prev + 1);
};





if (isLoading) {
  return <SplashScreen progress={loadingProgress} />
}

if (!user) {

  if (isNative) {
    return <Auth onLogin={handleAuthSuccess} />
  }

  if (isLanding) {
    return <Landing />
  }

  return <Auth onLogin={handleAuthSuccess} />
}

  // PUBLIC MODE - No Auth required
  // PUBLIC MODE - No Auth required
if (isPublicMode) {
    return (
        <Calculator
            isPublic={true}
            appSettings={appSettings}
            userPhone={user?.phone}
        />
    );
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
    onNavigateToProfile={() => setCurrentView("PROFILE")}
    isOnline={isOnline}
    isSyncing={isSyncing}
  >
    <div
      {...swipeHandlers}
      style={{
        transform: `translateX(${swipeX}px)`,
        transition: isSwiping
          ? "none"
          : "transform 0.28s cubic-bezier(.22,.61,.36,1)",
        willChange: "transform"
      }}
    >

      {currentView === "DASHBOARD" && !isInvestor && (
        <Dashboard
          sales={sales}
          customers={customers}
          stats={dashboardStats}
          workingCapital={workingCapital}
          accountBalances={accountBalances}
          onAction={handleAction}
          onSelectCustomer={handleSelectCustomer}
          onInitiatePayment={handleInitiateDashboardPayment}
          accounts={accounts}
          appSettings={appSettings}
        />
      )}

      {currentView === "DASHBOARD" && isInvestor && activeInvestor && (
        <InvestorDashboard
          sales={sales}
          expenses={expenses}
          accounts={accounts}
          investor={activeInvestor}
          appSettings={appSettings}
        />
      )}

      {currentView === "CASH_REGISTER" && (
        <CashRegister
          accounts={accounts}
          sales={sales}
          expenses={expenses}
          investors={investors}
          onAddAccount={handleAddAccount}
          onAction={handleAction}
          onSelectAccount={handleSelectAccountForOperations}
          onSetMainAccount={handleSetMainAccount}
          onUpdateAccount={handleUpdateAccount}
          isManager={isManager}
          totalExpectedProfit={totalExpectedProfit}
          realizedPeriodProfit={realizedPeriodProfit}
          myProfitPeriod={myProfitPeriod}
          setMyProfitPeriod={setMyProfitPeriod}
          appSettings={appSettings}
        />
      )}

      {currentView === "CONTRACTS" && (
        <Contracts
          sales={
            isInvestor
              ? sales.filter(
                  s =>
                    s.accountId ===
                    accounts.find(a => a.ownerId === user.id)?.id
                )
              : sales
          }
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

      {currentView === "INVESTORS" && (
        <Investors
          investors={investors}
          onAddInvestor={handleAddInvestor}
          onUpdateInvestor={handleUpdateInvestor}
          onDeleteInvestor={handleDeleteInvestor}
          onViewDetails={handleSelectInvestor}
          appSettings={appSettings}
        />
      )}

      {currentView === "CUSTOMERS" && (
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
          appSettings={appSettings}
        />
      )}

      {currentView === "MANAGE_PRODUCTS" && (
        <Products
          products={products}
          onAddProduct={handleAddProduct}
          onUpdateProduct={handleUpdateProduct}
          onDeleteProduct={handleDeleteProduct}
          appSettings={appSettings}
        />
      )}

      {currentView === "OPERATIONS" && (
        <Operations
          sales={sales}
          expenses={expenses}
          accounts={accounts}
          customers={customers}
          initialAccountId={operationsAccountId}
          onDelete={handleDeleteOperation}
          appSettings={appSettings}
        />
      )}

      {currentView === "REPORTS" && reportData && (
        <Reports
          investors={investors}
          filters={reportFilters}
          onFiltersChange={setReportFilters}
          data={reportData}
          appSettings={appSettings}
        />
      )}

    </div>
  </Layout>
)


};

export default App;
