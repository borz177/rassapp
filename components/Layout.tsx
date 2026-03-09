
import React, { useState, useMemo, useEffect } from 'react';
import { ViewState, Sale, AppSettings, Customer, User, Investor, SubscriptionPlan } from '../types';
import { ICONS, APP_NAME, THEMES } from '../constants';

interface LayoutProps {
  children: React.ReactNode;
  currentView: ViewState;
  setView: (view: ViewState) => void;
  onAction: (action: string) => void;
  onContractTabChange?: (tab: 'ACTIVE' | 'OVERDUE' | 'ARCHIVE') => void;
  sales?: Sale[];
  appSettings: AppSettings;
  customers: Customer[];
  user: User | null;
  activeInvestor?: Investor | null;
  onNavigateToProfile: () => void;
  isOnline?: boolean;
  isSyncing?: boolean;
}

const PLAN_NAMES: Record<SubscriptionPlan, string> = {
    'TRIAL': 'Пробный',
    'START': 'Старт',
    'STANDARD': 'Стандарт',
    'BUSINESS': 'Бизнес'
};

const Layout: React.FC<LayoutProps> = ({ children, currentView, setView, onAction, onContractTabChange, sales = [], appSettings, customers, user, activeInvestor, onNavigateToProfile, isOnline = true, isSyncing = false }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [expandedMenu, setExpandedMenu] = useState<string | null>(null);

  const isInvestor = user?.role === 'investor';
  const investorPermissions = activeInvestor?.permissions;

  // Apply Theme
  useEffect(() => {
      const themeKey = appSettings.theme || 'PURPLE';
      const theme = THEMES[themeKey];

      if (theme) {
          const root = document.documentElement;
          // Apply Primary Colors
          Object.entries(theme.primary).forEach(([shade, value]) => {
              root.style.setProperty(`--color-primary-${shade}`, value);
          });
          // Apply Secondary Colors
          Object.entries(theme.secondary).forEach(([shade, value]) => {
              root.style.setProperty(`--color-secondary-${shade}`, value);
          });
      }
  }, [appSettings.theme]);

  // Subscription Calc
  const subStatus = useMemo(() => {
      if (!user?.subscription) return { daysLeft: 0, planName: 'Пробный', expired: true, isWarning: true };

      const now = new Date();
      const expires = new Date(user.subscription.expiresAt);
      const diffTime = expires.getTime() - now.getTime();
      const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      return {
          daysLeft,
          planName: PLAN_NAMES[user.subscription.plan] || user.subscription.plan,
          expired: diffTime < 0,
          isWarning: daysLeft <= 3 && daysLeft >= 0
      };
  }, [user]);

  // Calculate counts for badges
  const counts = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to midnight to match Contracts logic

    let active = 0;
    let overdue = 0;
    let archive = 0;

    const customerIdSet = new Set(customers.map(c => c.id));
    const actualSales = sales.filter(sale => customerIdSet.has(sale.customerId));

    actualSales.forEach(sale => {
      if (sale.status === 'COMPLETED' || sale.remainingAmount === 0) {
        archive++;
        return;
      }
      const hasOverduePayment = sale.paymentPlan.some(p => !p.isPaid && new Date(p.date) < today);
      if (hasOverduePayment) {
        overdue++;
      } else {
        active++;
      }
    });

    return { active, overdue, archive };
  }, [sales, customers]);

  // Desktop Sidebar Items
  const allSidebarItems = [
    { id: 'DASHBOARD' as const, label: 'Главная', icon: ICONS.Dashboard, visible: true },
    {
      id: 'CASH_REGISTER' as const,
      label: 'Касса',
      icon: ICONS.Wallet,
      visible: !isInvestor,
      subItems: [
        { label: 'Счета', action: 'GOTO_CASH_REGISTER', icon: ICONS.Wallet },
        { label: 'Приход', action: 'INCOME', icon: ICONS.Income },
        { label: 'Расход', action: 'EXPENSE', icon: ICONS.Expense },
        { label: 'История', action: 'OPERATIONS', icon: ICONS.List },
      ]
    },
    {
      id: 'CONTRACTS' as const,
      label: 'Договоры',
      icon: ICONS.File,
      visible: !isInvestor || (isInvestor && !!investorPermissions?.canViewContracts),
      subItems: [
        { label: 'Оформить', action: 'CREATE_SALE', icon: ICONS.AddSmall, visible: !isInvestor },
        { label: 'Активные', tab: 'ACTIVE', icon: ICONS.Check, count: counts.active, visible: true },
        { label: 'Просроченные', tab: 'OVERDUE', icon: ICONS.Alert, count: counts.overdue, visible: true },
        { label: 'Архив', tab: 'ARCHIVE', icon: ICONS.Clock, count: counts.archive, visible: true },
      ]
    },
    {
        id: 'OPERATIONS' as const,
        label: 'История',
        icon: ICONS.List,
        visible: isInvestor && !!investorPermissions?.canViewHistory
    },
    { id: 'REPORTS' as const, label: 'Отчеты', icon: ICONS.Dashboard, visible: !isInvestor && user?.role !== 'employee' },
    { id: 'CUSTOMERS' as const, label: 'Клиенты', icon: ICONS.Customers, visible: !isInvestor },
    { id: 'INVESTORS' as const, label: 'Инвесторы', icon: ICONS.Users, visible: !isInvestor },
    { id: 'EMPLOYEES' as const, label: 'Сотрудники', icon: ICONS.Employees, visible: !isInvestor && (user?.role === 'manager' || user?.role === 'admin') },
    { id: 'TARIFFS' as const, label: 'Тарифы', icon: ICONS.Tariffs, visible: !isInvestor },
    { id: 'SETTINGS' as const, label: 'Настройки', icon: ICONS.Settings, visible: !isInvestor },
    { id: 'ADMIN_PANEL' as const, label: 'Админ панель', icon: ICONS.Crown, visible: user?.role === 'admin' },
  ];

  const sidebarItems = useMemo(() => {
      return allSidebarItems.filter(item => item.visible);
  }, [user, counts, isInvestor, investorPermissions]);

  const handleFabClick = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  const toggleMenu = (id: string) => {
    if (expandedMenu === id) {
      setExpandedMenu(null);
    } else {
      setExpandedMenu(id);
    }
  };

  const handleSubItemClick = (parentView: ViewState, subItem: any) => {
     if (subItem.action) {
         if (subItem.action === 'GOTO_CASH_REGISTER') {
             setView('CASH_REGISTER');
         } else {
             onAction(subItem.action);
         }
     } else if (subItem.tab && onContractTabChange) {
         setView(parentView);
         onContractTabChange(subItem.tab);
     } else {
         setView(parentView);
     }
  };

  const handleMainItemClick = (item: any) => {
      if ('subItems' in item) {
          toggleMenu(item.id);
      } else {
          setView(item.id);
      }
  }

  // Render Sidebar Menu Item (Desktop Only)
  const renderMenuItem = (item: any) => {
    const hasSubItems = 'subItems' in item;
    const isExpanded = expandedMenu === item.id;
    const isActive = currentView === item.id;

    // Filter subitems if visibility logic exists
    const visibleSubItems = hasSubItems ? item.subItems.filter((sub: any) => sub.visible !== false) : [];

    return (
        <div key={item.id} className="w-full">
            <button
                onClick={() => handleMainItemClick(item)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all ${
                isActive && !hasSubItems
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/50' 
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
            >
                <div className="flex items-center gap-3">
                    <span>{item.icon}</span>
                    <span className="font-medium">{item.label}</span>
                </div>
                {hasSubItems && (
                    <span className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </span>
                )}
            </button>

            {/* Submenu */}
            {hasSubItems && isExpanded && (
                <div className="mt-1 ml-4 space-y-1 border-l border-slate-700 pl-3">
                {visibleSubItems.map((sub: any, idx: number) => (
                    <button
                    key={idx}
                    onClick={() => handleSubItemClick(item.id, sub)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-2 rounded-lg text-sm transition-colors text-slate-400 hover:text-white hover:bg-slate-800"
                    >
                        <div className="flex items-center gap-2">
                            <span className="opacity-70 scale-75">{sub.icon}</span>
                            <span>{sub.label}</span>
                        </div>
                        {sub.count !== undefined && sub.count > 0 && (
                            <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                                sub.label === 'Просроченные' ? 'bg-red-500 text-white' : 
                                sub.label === 'Активные' ? 'bg-indigo-500 text-white' : 'bg-slate-500 text-white'
                            }`}>
                                {sub.count}
                            </span>
                        )}
                    </button>
                ))}
                </div>
            )}
        </div>
    );
  };

  const handleActionClick = (action: string) => {
      setIsMenuOpen(false);
      onAction(action);
  };

  return (
      <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
          {/* Mobile Top Navbar */}
          <header
              className="md:hidden fixed top-0 left-0 right-0 bg-white h-16 flex items-center px-4 shadow-md z-30 border-b border-slate-200">
              <div className="flex flex-col">
                  <h1 className="text-xl font-bold tracking-tight text-indigo-600">{appSettings.companyName}</h1>
                  {!isOnline && <span
                      className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded w-fit">Офлайн</span>}
                  {isOnline && isSyncing && <span
                      className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded w-fit">Синхронизация...</span>}
              </div>
              {!isInvestor && (
                  <div
                      className={`ml-auto text-xs px-2 py-1.5 rounded-lg font-bold flex flex-col items-end leading-tight cursor-pointer
                    ${subStatus.expired ? 'bg-red-50 text-red-600' : subStatus.isWarning ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}
                `}
                      onClick={() => setView('TARIFFS')}
                  >
                      <span>{subStatus.planName}</span>
                      <span className="text-[10px] opacity-80">
                    {subStatus.expired ? 'Истек' : `Осталось: ${subStatus.daysLeft} дн.`}
                </span>
                  </div>
              )}
          </header>

          {/* Desktop Top Navbar */}
          <header
              className="hidden md:flex w-full items-center justify-between px-8 h-16 sticky top-0 z-40 shadow-md bg-indigo-600 text-white">
              {/* LEFT SIDE */}
              <div className="flex items-center gap-10">

                  <h1 className="text-xl font-bold tracking-tight">
                      {appSettings.companyName}
                  </h1>

                  <nav className="flex items-center gap-6">
                      {sidebarItems.map((item) => {
                          const hasSubItems = "subItems" in item;

                          return (
                              <div key={item.id} className="relative group">

                                  <button
                                      onClick={() => !hasSubItems && setView(item.id)}
                                      className={`flex items-center gap-2 text-sm font-medium transition-all
                ${
                                          currentView === item.id
                                              ? "text-white border-b-2 border-white pb-1"
                                              : "text-white/80 hover:text-white"
                                      }
              `}
                                  >
                                      {item.icon}
                                      {item.label}
                                  </button>

                                  {/* Dropdown */}
                                  {hasSubItems && (
                                      <div
                                          className="absolute top-full left-0 mt-3 w-56 bg-white rounded-xl shadow-xl
                opacity-0 invisible group-hover:opacity-100 group-hover:visible
                transition-all duration-200"
                                      >
                                          <div className="py-2">

                                              {item.subItems
                                                  .filter((s) => s.visible !== false)
                                                  .map((sub, idx) => (
                                                      <button
                                                          key={idx}
                                                          onClick={() => handleSubItemClick(item.id, sub)}
                                                          className="flex items-center justify-between w-full px-4 py-2 text-sm
                        text-slate-700 hover:bg-slate-100"
                                                      >
                                                          <div className="flex items-center gap-2">
                                                              {sub.icon}
                                                              {sub.label}
                                                          </div>

                                                          {sub.count > 0 && (
                                                              <span
                                                                  className="text-xs bg-slate-200 px-2 py-0.5 rounded-full">
                            {sub.count}
                          </span>
                                                          )}
                                                      </button>
                                                  ))}

                                          </div>
                                      </div>
                                  )}

                              </div>
                          );
                      })}
                  </nav>
              </div>

              {/* RIGHT SIDE */}
              <div className="flex items-center gap-6">

                  {!isOnline && (
                      <span className="text-xs bg-yellow-400/20 px-2 py-1 rounded">
        Офлайн
      </span>
                  )}

                  {isOnline && isSyncing && (
                      <span className="text-xs bg-white/20 px-2 py-1 rounded">
        Синхронизация...
      </span>
                  )}

                  {user && (
                      <button
                          onClick={onNavigateToProfile}
                          className="flex items-center gap-2 hover:bg-white/10 px-3 py-2 rounded-lg transition"
                      >
                          <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center font-bold">
                              {user.name.charAt(0).toUpperCase()}
                          </div>

                          <span className="text-sm font-medium">{user.name}</span>
                      </button>
                  )}

              </div>
          </header>

          {/* Main Content Area - Updated margins and centering */}
          <main className="flex-1 pt-16 px-6 md:px-10 pb-10 w-full bg-slate-50">
              <div className="max-w-7xl mx-auto w-full">
                  {children}
              </div>
          </main>

          {/* Mobile Quick Actions Menu (Triggered by FAB) - ONLY FOR MANAGER/EMPLOYEE */}
          {!isInvestor && isMenuOpen && (
              <div
                  className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 md:hidden flex flex-col justify-end pb-24 px-4 animate-fade-in"
                  onClick={() => setIsMenuOpen(false)}
              >
                  <div className="bg-white rounded-2xl p-4 shadow-2xl space-y-2 mb-4"
                       onClick={e => e.stopPropagation()}>
                      <div className="pb-2 mb-2 border-b border-slate-100">
                          <h3 className="text-slate-500 font-bold text-sm uppercase px-2">Быстрые действия</h3>
                      </div>
                      <button onClick={() => handleActionClick('CREATE_SALE')}
                              className="w-full flex items-center gap-3 p-3 hover:bg-slate-50 rounded-xl text-slate-700">
                          <div className="bg-indigo-100 p-2 rounded-full text-indigo-600">{ICONS.Sales}</div>
                          <span className="font-semibold">Оформить продажу</span>
                      </button>
                      <button onClick={() => handleActionClick('INCOME')}
                              className="w-full flex items-center gap-3 p-3 hover:bg-slate-50 rounded-xl text-slate-700">
                          <div className="bg-emerald-100 p-2 rounded-full text-emerald-600">{ICONS.Income}</div>
                          <span className="font-semibold">Приход (Внести)</span>
                      </button>
                      <button onClick={() => handleActionClick('EXPENSE')}
                              className="w-full flex items-center gap-3 p-3 hover:bg-slate-50 rounded-xl text-slate-700">
                          <div className="bg-red-100 p-2 rounded-full text-red-600">{ICONS.Expense}</div>
                          <span className="font-semibold">Расход (Изъять)</span>
                      </button>
                      <button onClick={() => handleActionClick('OPERATIONS')}
                              className="w-full flex items-center gap-3 p-3 hover:bg-slate-50 rounded-xl text-slate-700">
                          <div className="bg-slate-100 p-2 rounded-full text-slate-600">{ICONS.List}</div>
                          <span className="font-semibold">Все операции</span>
                      </button>
                  </div>
              </div>
          )}

          {/* Mobile Bottom Navigation */}
          <nav
              className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-[0_-5px_10px_rgba(0,0,0,0.05)] z-50 px-2 py-2 flex justify-between items-end safe-area-pb">

              <div className={`flex ${isInvestor ? 'w-full justify-around' : 'w-2/5 justify-around'}`}>
                  <button onClick={() => setView('DASHBOARD')}
                          className={`flex flex-col items-center p-2 ${currentView === 'DASHBOARD' ? 'text-indigo-600' : 'text-slate-400'}`}>
                      {ICONS.Dashboard}
                      <span className="text-[10px] mt-1 font-medium">Главная</span>
                  </button>
                  {!isInvestor && (
                      <button onClick={() => setView('CASH_REGISTER')}
                              className={`flex flex-col items-center p-2 ${currentView === 'CASH_REGISTER' ? 'text-indigo-600' : 'text-slate-400'}`}>
                          {ICONS.Wallet}
                          <span className="text-[10px] mt-1 font-medium">Касса</span>
                      </button>
                  )}
              </div>

              {!isInvestor && (
                  <div className="relative -top-5">
                      <button
                          onClick={handleFabClick}
                          className={`w-14 h-14 rounded-full flex items-center justify-center text-white shadow-lg shadow-indigo-300 transition-transform active:scale-95 ${isMenuOpen ? 'bg-slate-800 rotate-45' : 'bg-indigo-600'}`}
                      >
                          {ICONS.Add}
                      </button>
                  </div>
              )}

              <div className={`flex ${isInvestor ? 'w-full justify-around' : 'w-2/5 justify-around'}`}>
                  {!isInvestor && (
                      <button onClick={() => setView('CUSTOMERS')}
                              className={`flex flex-col items-center p-2 ${currentView === 'CUSTOMERS' || currentView === 'CUSTOMER_DETAILS' ? 'text-indigo-600' : 'text-slate-400'}`}>
                          {ICONS.Customers}
                          <span className="text-[10px] mt-1 font-medium">Клиенты</span>
                      </button>
                  )}
                  <button onClick={() => setView('MORE')}
                          className={`flex flex-col items-center p-2 ${currentView === 'MORE' || currentView === 'PROFILE' || currentView === 'CONTRACTS' || currentView === 'INVESTORS' || currentView === 'EMPLOYEES' || currentView === 'SETTINGS' || currentView === 'TARIFFS' || currentView === 'ADMIN_PANEL' ? 'text-indigo-600' : 'text-slate-400'}`}>
                      {ICONS.Menu}
                      <span className="text-[10px] mt-1 font-medium">{isInvestor ? 'Профиль' : 'Еще'}</span>
                  </button>
              </div>

          </nav>
      </div>
  );
};

export default Layout;
