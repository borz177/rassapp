import React, { useState, useMemo, useEffect, useRef } from 'react';
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
  supportButton?: React.ReactNode;
  supportUnreadCount?: number;
}

const PLAN_NAMES: Record<SubscriptionPlan, string> = {
    'TRIAL': 'Пробный',
    'START': 'Старт',
    'STANDARD': 'Стандарт',
    'BUSINESS': 'Бизнес'
};

const Layout: React.FC<LayoutProps> = ({
  children,
  currentView,
  setView,
  onAction,
  onContractTabChange,
  sales = [],
  appSettings,
  customers,
  user,
  activeInvestor,
  onNavigateToProfile,
  isOnline = true,
  isSyncing = false,
  supportButton,
  supportUnreadCount = 0,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  const isInvestor = user?.role === 'investor';
  const investorPermissions = activeInvestor?.permissions;
  const [showInvestorMobileMenu, setShowInvestorMobileMenu] = useState(false);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenDropdown(null);
      }
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Apply Theme (Primary, Secondary + Navbar)
  useEffect(() => {
      const themeKey = appSettings.theme || 'PURPLE';
      const theme = THEMES[themeKey];

      if (theme) {
          const root = document.documentElement;
          Object.entries(theme.primary).forEach(([shade, value]) => {
              root.style.setProperty(`--color-primary-${shade}`, value);
          });
          Object.entries(theme.secondary).forEach(([shade, value]) => {
              root.style.setProperty(`--color-secondary-${shade}`, value);
          });
          // 🔹 Navbar variables
          if (theme.navbar) {
              Object.entries(theme.navbar).forEach(([key, value]) => {
                  root.style.setProperty(`--navbar-${key}`, value as string);
              });
          }
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
    today.setHours(0, 0, 0, 0);
    let active = 0, overdue = 0, archive = 0;
    const customerIdSet = new Set(customers.map(c => c.id));
    const actualSales = sales.filter(sale => customerIdSet.has(sale.customerId));
    actualSales.forEach(sale => {
      if (sale.status === 'COMPLETED' || sale.remainingAmount === 0) { archive++; return; }
      const hasOverduePayment = sale.paymentPlan.some(p => !p.isPaid && new Date(p.date) < today);
      if (hasOverduePayment) { overdue++; } else { active++; }
    });
    return { active, overdue, archive };
  }, [sales, customers]);

  // Navbar Items
  const allNavbarItems = [
    { id: 'DASHBOARD' as const, label: 'Главная', icon: ICONS.Dashboard, visible: true },
    {
      id: 'CASH_REGISTER' as const,
      label: 'Касса',
      icon: ICONS.Wallet,
      visible: !isInvestor,
      subItems: [
        { label: 'Счета', action: 'GOTO_CASH_REGISTER', icon: ICONS.Wallet, view: 'CASH_REGISTER' },
        { label: 'Приход', action: 'INCOME', icon: ICONS.Income, view: 'CASH_REGISTER' },
        { label: 'Расход', action: 'EXPENSE', icon: ICONS.Expense, view: 'CASH_REGISTER' },
        { label: 'История', action: 'OPERATIONS', icon: ICONS.List, view: 'OPERATIONS' },
      ]
    },
    {
      id: 'CONTRACTS' as const,
      label: 'Договоры',
      icon: ICONS.File,
      visible: !isInvestor || (isInvestor && !!investorPermissions?.canViewContracts),
      subItems: [
        { label: 'Оформить', action: 'CREATE_SALE', icon: ICONS.AddSmall, visible: !isInvestor, view: 'CONTRACTS' },
        { label: 'Активные', tab: 'ACTIVE', icon: ICONS.Check, count: counts.active, visible: true, view: 'CONTRACTS' },
        { label: 'Просроченные', tab: 'OVERDUE', icon: ICONS.Alert, count: counts.overdue, visible: true, view: 'CONTRACTS' },
        { label: 'Архив', tab: 'ARCHIVE', icon: ICONS.Clock, count: counts.archive, visible: true, view: 'CONTRACTS' },
      ]
    },
    { id: 'OPERATIONS' as const, label: 'История', icon: ICONS.List, visible: isInvestor && !!investorPermissions?.canViewHistory },
    { id: 'REPORTS' as const, label: 'Отчеты', icon: ICONS.Dashboard, visible: !isInvestor && user?.role !== 'employee' },
    { id: 'CUSTOMERS' as const, label: 'Клиенты', icon: ICONS.Customers, visible: !isInvestor },
    { id: 'INVESTORS' as const, label: 'Инвесторы', icon: ICONS.Users, visible: !isInvestor },
    { id: 'EMPLOYEES' as const, label: 'Сотрудники', icon: ICONS.Employees, visible: !isInvestor && (user?.role === 'manager' || user?.role === 'admin') },
    { id: 'ADMIN_PANEL' as const, label: 'Админ панель', icon: ICONS.Crown, visible: user?.role === 'admin' },
  ];

  const navbarItems = useMemo(() => allNavbarItems.filter(item => item.visible), [user, counts, isInvestor, investorPermissions]);

  const handleFabClick = () => setIsMenuOpen(!isMenuOpen);
  const toggleDropdown = (id: string) => setOpenDropdown(openDropdown === id ? null : id);
  const toggleProfile = () => setIsProfileOpen(!isProfileOpen);

  const handleSubItemClick = (parentView: ViewState, subItem: any) => {
     if (subItem.view) {
         setView(subItem.view);
     }
     if (subItem.action) {
         if (subItem.action === 'GOTO_CASH_REGISTER') {
             setView('CASH_REGISTER');
         } else {
             onAction(subItem.action);
         }
     }
     if (subItem.tab && onContractTabChange) {
         setView(parentView);
         onContractTabChange(subItem.tab);
     }
     setOpenDropdown(null);
  };

  const handleMainItemClick = (item: any) => {
      if ('subItems' in item) {
          toggleDropdown(item.id);
      } else {
          setView(item.id);
          setOpenDropdown(null);
      }
  }

  const handleActionClick = (action: string) => {
      setIsMenuOpen(false);
      onAction(action);
  };

  const handleProfileAction = (action: string) => {
      setIsProfileOpen(false);
      if (action === 'PROFILE') {
          onNavigateToProfile();
      } else if (action === 'SETTINGS') {
          setView('SETTINGS');
      } else if (action === 'TARIFFS') {
          setView('TARIFFS');
      }
  };

  // Render Desktop Navbar Item with Dropdown
  const renderNavbarItem = (item: any) => {
    const hasSubItems = 'subItems' in item;
    const isActive = currentView === item.id || (hasSubItems && openDropdown === item.id);
    const visibleSubItems = hasSubItems ? item.subItems.filter((sub: any) => sub.visible !== false) : [];

    return (
      <div key={item.id} className="relative" ref={hasSubItems ? dropdownRef : undefined}>
        <button
          onClick={() => handleMainItemClick(item)}
          className="flex items-center gap-2 px-4 py-3 rounded-lg transition-all duration-200 font-medium"
          style={{
            backgroundColor: isActive ? 'var(--navbar-activeBg)' : 'transparent',
            color: isActive ? 'var(--navbar-activeText)' : 'var(--navbar-text)',
          }}
          onMouseEnter={() => hasSubItems && setOpenDropdown(item.id)}
        >
          <span>{item.icon}</span>
          <span className="hidden lg:inline">{item.label}</span>
          {hasSubItems && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="transition-transform" style={{ transform: openDropdown === item.id ? 'rotate(180deg)' : 'none' }}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          )}
          {item.count !== undefined && item.count > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500 text-white">{item.count}</span>
          )}
        </button>

        {/* Dropdown Menu */}
        {hasSubItems && openDropdown === item.id && (
          <div
            className="absolute top-full left-0 mt-1 w-56 rounded-xl shadow-xl z-50 overflow-hidden"
            style={{
              backgroundColor: 'var(--navbar-bg)',
              border: `1px solid var(--navbar-border)`,
              minWidth: '200px'
            }}
            onMouseLeave={() => setOpenDropdown(null)}
          >
            {visibleSubItems.map((sub: any, idx: number) => (
              <button
                key={idx}
                onClick={() => handleSubItemClick(item.id, sub)}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors text-left"
                style={{ color: 'var(--navbar-text)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--navbar-hover)';
                  e.currentTarget.style.color = 'var(--navbar-activeText)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = 'var(--navbar-text)';
                }}
              >
                <span className="opacity-70">{sub.icon}</span>
                <span className="flex-1">{sub.label}</span>
                {sub.count !== undefined && sub.count > 0 && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-primary-500)', color: '#fff' }}>{sub.count}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">

      {/* 🔹 DESKTOP TOP NAVBAR */}
      <header
        className="hidden md:flex items-center justify-between px-6 py-3 fixed top-0 left-0 right-0 z-50 transition-colors duration-300"
        style={{
          backgroundColor: 'var(--navbar-bg)',
          color: 'var(--navbar-text)',
          borderBottom: `1px solid var(--navbar-border)`,
          WebkitAppRegion: 'drag',
          userSelect: 'none'
        }}
      >
        {/* Logo + Company */}
        <div className="flex items-center gap-4">
          <h1
            className="text-xl font-bold bg-clip-text text-transparent"
            style={{
              backgroundImage: 'linear-gradient(to right, var(--color-primary-400), var(--color-secondary-400))',
              WebkitAppRegion: 'no-drag'
            }}
          >
            {appSettings.companyName}
          </h1>
          {isOnline && isSyncing && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded"
              style={{
                color: 'var(--color-primary-400)',
                backgroundColor: 'rgba(96, 165, 250, 0.15)',
                border: '1px solid var(--color-primary-800)'
              }}>
              Синхронизация...
            </span>
          )}
        </div>

        {/* Navigation Links */}
        <nav className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' }}>
          {navbarItems.map(item => renderNavbarItem(item))}
        </nav>

        {/* Right Section: Profile Dropdown */}
        <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' }} ref={profileRef}>
          {user && (
            <div className="relative">
              <button
                onClick={toggleProfile}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors"
                style={{
                  color: 'var(--navbar-text)',
                  backgroundColor: isProfileOpen ? 'var(--navbar-hover)' : 'transparent'
                }}
              >
                <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm"
                     style={{ backgroundColor: 'var(--color-primary-500)', color: '#fff' }}>
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <span className="hidden lg:inline text-sm font-medium">{user.name}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="transition-transform" style={{ transform: isProfileOpen ? 'rotate(180deg)' : 'none' }}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>

              {/* Profile Dropdown Menu */}
              {isProfileOpen && (
                <div
                  className="absolute top-full right-0 mt-1 w-56 rounded-xl shadow-xl z-50 overflow-hidden"
                  style={{
                    backgroundColor: 'var(--navbar-bg)',
                    border: `1px solid var(--navbar-border)`,
                  }}
                >
                  {/* Subscription Info (if not admin) */}
                  {user && !isInvestor && user.role !== 'admin' && (
                    <div
                      className={`px-4 py-3 border-b text-xs font-medium cursor-pointer transition-opacity hover:opacity-90
                        ${subStatus.expired ? 'bg-red-900/30 border-red-800 text-red-300' : subStatus.isWarning ? 'bg-amber-900/30 border-amber-800 text-amber-300' : 'bg-emerald-900/30 border-emerald-800 text-emerald-300'}
                      `}
                      onClick={() => handleProfileAction('TARIFFS')}
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span className="opacity-70">Тариф:</span>
                        <span className="font-bold uppercase">{subStatus.planName}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="opacity-70">Статус:</span>
                        <span className="font-bold">{subStatus.expired ? 'Истек' : `${subStatus.daysLeft} дн.`}</span>
                      </div>
                    </div>
                  )}

                  {/* Profile */}
                  <button
                    onClick={() => handleProfileAction('PROFILE')}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors text-left"
                    style={{ color: 'var(--navbar-text)' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--navbar-hover)';
                      e.currentTarget.style.color = 'var(--navbar-activeText)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--navbar-text)';
                    }}
                  >
                    <span>{ICONS.Settings}</span>
                    <span className="flex-1">Профиль</span>
                  </button>

                  {/* Settings */}
                  {!isInvestor && (
                    <button
                      onClick={() => handleProfileAction('SETTINGS')}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors text-left"
                      style={{ color: 'var(--navbar-text)' }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--navbar-hover)';
                        e.currentTarget.style.color = 'var(--navbar-activeText)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.color = 'var(--navbar-text)';
                      }}
                    >
                      <span>{ICONS.Settings}</span>
                      <span className="flex-1">Настройки</span>
                    </button>
                  )}

                  {/* Tariffs */}
                  {!isInvestor && user.role !== 'admin' && (
                    <button
                      onClick={() => handleProfileAction('TARIFFS')}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors text-left"
                      style={{ color: 'var(--navbar-text)' }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--navbar-hover)';
                        e.currentTarget.style.color = 'var(--navbar-activeText)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.color = 'var(--navbar-text)';
                      }}
                    >
                      <span>{ICONS.Tariffs}</span>
                      <span className="flex-1">Тарифы</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* 🔹 MOBILE TOP NAVBAR */}
      <header className="md:hidden fixed top-0 left-0 right-0 bg-white border-b border-slate-200 z-40">
        <div className="h-16 flex items-center px-4">
          <div className="flex flex-col w-full">
            <h1 className="text-xl font-bold tracking-tight" style={{ color: 'var(--color-primary-600)' }}>{appSettings.companyName}</h1>
            {isOnline && isSyncing && (
              <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded w-fit">Синхронизация...</span>
            )}
          </div>
        </div>
      </header>

      {/* Main Content - 🔹 FIXED: Added mobile top padding */}
      <main className="flex-1 p-4 md:p-6 mx-auto w-full mb-20 md:mb-0 flex flex-col h-full bg-slate-50 mt-16 md:mt-20">
        <div className="w-full max-w-7xl mx-auto h-full">
            {children}
        </div>
      </main>

      {/* Mobile Quick Actions FAB Menu */}
      {!isInvestor && isMenuOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 md:hidden flex flex-col justify-end pb-24 px-4 animate-fade-in" onClick={() => setIsMenuOpen(false)}>
            <div className="bg-white rounded-2xl p-4 shadow-2xl space-y-2 mb-4" onClick={e => e.stopPropagation()}>
                <div className="pb-2 mb-2 border-b border-slate-100"><h3
                    className="text-slate-500 font-bold text-sm uppercase px-2">Быстрые действия</h3></div>
                <button onClick={() => handleActionClick('CREATE_SALE')}
                        className="w-full flex items-center gap-3 p-3 hover:bg-slate-50 rounded-xl text-slate-700">
                    <div className="bg-indigo-100 p-2 rounded-full"
                         style={{color: 'var(--color-primary-600)'}}>{ICONS.Sales}</div>
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
            <button onClick={() => setView('DASHBOARD')} className={`flex flex-col items-center p-2 ${currentView === 'DASHBOARD' ? 'text-indigo-600' : 'text-slate-400'}`}>
                {ICONS.Dashboard}<span className="text-[10px] mt-1 font-medium">Главная</span>
            </button>
            {!isInvestor && (
              <button onClick={() => setView('CASH_REGISTER')} className={`flex flex-col items-center p-2 ${currentView === 'CASH_REGISTER' ? 'text-indigo-600' : 'text-slate-400'}`}>
                  {ICONS.Wallet}<span className="text-[10px] mt-1 font-medium">Касса</span>
              </button>
            )}
        </div>
        {!isInvestor && (
          <div className="relative -top-5">
              <button onClick={handleFabClick} className={`w-14 h-14 rounded-full flex items-center justify-center text-white shadow-lg transition-transform active:scale-95 ${isMenuOpen ? 'bg-slate-800 rotate-45' : 'bg-indigo-600'}`}
                style={{ backgroundColor: isMenuOpen ? 'var(--navbar-bg)' : 'var(--color-primary-600)' }}>
                  {ICONS.Add}
              </button>
          </div>
        )}
        <div className={`flex ${isInvestor ? 'w-full justify-around' : 'w-2/5 justify-around'}`}>
            {!isInvestor && (
              <button onClick={() => setView('CUSTOMERS')} className={`flex flex-col items-center p-2 ${currentView === 'CUSTOMERS' ? 'text-indigo-600' : 'text-slate-400'}`}>
                  {ICONS.Customers}<span className="text-[10px] mt-1 font-medium">Клиенты</span>
              </button>
            )}
            <button onClick={() => isInvestor ? setShowInvestorMobileMenu(true) : setView('MORE')} className={`flex flex-col items-center p-2 ${['MORE','PROFILE','CONTRACTS','INVESTORS','EMPLOYEES','SETTINGS','TARIFFS','ADMIN_PANEL'].includes(currentView) ? 'text-indigo-600' : 'text-slate-400'}`}>
                {ICONS.Menu}<span className="text-[10px] mt-1 font-medium">{isInvestor ? 'Профиль' : 'Еще'}</span>
            </button>
            {/* Investor mobile menu */}
            {showInvestorMobileMenu && (
              <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 backdrop-blur-sm animate-fade-in md:hidden" onClick={() => setShowInvestorMobileMenu(false)}>
                <div className="bg-white w-full max-w-sm rounded-t-3xl p-5 pb-8 shadow-2xl animate-slide-up" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                    <h3 className="font-bold text-slate-800">Доступные разделы</h3>
                    <button onClick={() => setShowInvestorMobileMenu(false)} className="p-1 text-slate-400 hover:text-slate-600">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                  <div className="space-y-2">
                    {investorPermissions?.canViewContracts && (
                      <button onClick={() => { setShowInvestorMobileMenu(false); setView('CONTRACTS'); onContractTabChange?.('ACTIVE'); }} className="w-full flex items-center gap-3 p-4 bg-slate-50 hover:bg-indigo-50 rounded-xl text-left">
                        <span className="text-indigo-600">{ICONS.File}</span><div><p className="font-semibold">Договоры</p><p className="text-xs text-slate-500">Просмотр сделок</p></div>
                      </button>
                    )}
                    {investorPermissions?.canViewHistory && (
                      <button onClick={() => { setShowInvestorMobileMenu(false); setView('OPERATIONS'); }} className="w-full flex items-center gap-3 p-4 bg-slate-50 hover:bg-indigo-50 rounded-xl text-left">
                        <span className="text-indigo-600">{ICONS.List}</span><div><p className="font-semibold">История</p><p className="text-xs text-slate-500">Все операции</p></div>
                      </button>
                    )}
                  </div>
                  <button onClick={() => setShowInvestorMobileMenu(false)} className="w-full mt-4 py-3 bg-slate-100 text-slate-700 font-medium rounded-xl">Закрыть</button>
                </div>
              </div>
            )}
        </div>
      </nav>

      {/* Support button (desktop) */}
      {supportButton && <div className="hidden md:block">{supportButton}</div>}
    </div>
  );
};

export default Layout;