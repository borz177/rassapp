
import React, { useState, useMemo, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import ModalPortal from './ModalPortal';
import { ViewState, Sale, AppSettings, Customer, User, Investor, SubscriptionPlan } from '../types';
import { ICONS, APP_NAME, THEMES } from '../constants';
import { calculateSaleOverdue } from '../src/utils';

interface LayoutProps {
  children: React.ReactNode;
  currentView: ViewState;
  setView: (view: ViewState) => void;
  onAction: (action: string) => void;
  onContractTabChange?: (tab: 'ALL' | 'ACTIVE' | 'OVERDUE' | 'ARCHIVE') => void;
  sales?: Sale[];
  appSettings: AppSettings;
  customers: Customer[];
  user: User | null;
  activeInvestor?: Investor | null;
  onNavigateToProfile: () => void;
  onGoToCustomers?: () => void;
  isOnline?: boolean;
  isSyncing?: boolean;
  supportButton?: React.ReactNode;
  supportUnreadCount?: number;
  unreadNotifCount?: number;
  onOpenNotifications?: () => void;
  showNotificationsBell?: boolean;
  showTasks?: boolean;
  showEmployees?: boolean;
  showSuppliers?: boolean;
}

const PLAN_NAMES: Record<SubscriptionPlan, string> = {
    'TRIAL': 'Пробный',
    'START': 'Старт',
    'STANDARD': 'Стандарт',
    'BUSINESS': 'Бизнес',
    'BUSINESS_PRO': 'Бизнес Pro'
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
  onGoToCustomers,
  isOnline = true,
  isSyncing = false,
  supportButton, // 🔹 Добавили сюда
  supportUnreadCount = 0,
  unreadNotifCount = 0,
  onOpenNotifications,
  showNotificationsBell = false,
  showTasks = false,
  showEmployees = false,
  showSuppliers = false,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMenuClosing, setIsMenuClosing] = useState(false);
  const [expandedMenu, setExpandedMenu] = useState<string | null>(null);

  const isInvestor = user?.role === 'investor';

  // 🫧 Стеклянная капсула активного раздела в нижней навигации.
  // Положение считаем по реальным размерам кнопок: разделы разной ширины,
  // между группами стоит круглая кнопка «+», и захардкодить координаты нельзя.
  const navRef = useRef<HTMLElement | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [pill, setPill] = useState<{ x: number; w: number; h: number; y: number } | null>(null);
  const [pillMoving, setPillMoving] = useState(false);
  // Видимость отдельно от геометрии: на экранах вне навигации (операции, отчёты,
  // создание договора) активного раздела нет. Если в этот момент убрать капсулу
  // из разметки, при возврате она появится рывком в новом месте. Поэтому она
  // остаётся на последней позиции и просто гаснет — возвращаясь, доезжает плавно.
  const [pillVisible, setPillVisible] = useState(false);

  // Какой раздел считать активным — те же условия, что подсвечивают иконки
  const activeTab = useMemo(() => {
    if (currentView === 'DASHBOARD') return 'dashboard';
    if (currentView === 'CASH_REGISTER') return 'cash';
    if (currentView === 'CUSTOMERS' || currentView === 'CUSTOMER_DETAILS') return 'customers';
    if (['MORE', 'PROFILE', 'CONTRACTS', 'INVESTORS', 'EMPLOYEES', 'SETTINGS',
         'SUPPLIERS', 'SUPPLIER_DETAILS', 'TARIFFS', 'ADMIN_PANEL'].includes(currentView)) return 'more';
    return null;
  }, [currentView]);

  // Геометрия капсулы для конкретного раздела. Вынесено из эффекта: то же самое
  // нужно посчитать в момент, когда палец отпускает капсулу, — там ждать
  // перерисовки нельзя, иначе она уедет домой и только потом к цели.
  const measureTab = useCallback((id: string | null) => {
    const nav = navRef.current;
    const btn = id ? tabRefs.current[id] : null;
    if (!nav || !btn) return null;
    const n = nav.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    // Небольшой отступ по вертикали: без него капсула упирается в края острова
    // и выглядит втиснутой. По горизонтали, наоборот, чуть шире кнопки —
    // так она читается как отдельный элемент, а не обводка текста.
    const padY = 0;
    const padX = 7;
    return {
      x: b.left - n.left - padX,
      y: b.top - n.top + padY,
      w: b.width + padX * 2,
      h: b.height - padY * 2,
    };
  }, []);

  // useLayoutEffect, а не useEffect: считаем до отрисовки, иначе капсула
  // на мгновение появляется в старом месте и дёргается.
  useLayoutEffect(() => {
    const measure = () => {
      const nav = navRef.current;
      const geom = measureTab(activeTab);
      if (!nav || !geom) { setPillVisible(false); return; }
      // На первом кадре подписи ещё набраны запасным шрифтом, а иконки не
      // разложены — кнопка тогда шире и выше настоящей, и капсула застревала
      // раскоряченной поверх острова до самой перезагрузки. Отбрасываем такие
      // замеры: настоящий придёт с ResizeObserver, как только вёрстка устоится.
      const navW = nav.getBoundingClientRect().width;
      const plausible = navW > 0 && geom.h > 16 && geom.w > 24 && geom.w < navW * 0.6;
      if (!plausible) { setPillVisible(false); return; }
      setPill(geom);
      setPillVisible(true);
    };
    measure();

    // Кнопка меняет размер, когда подгружается шрифт подписи и раскладываются
    // иконки — событий об этом нет, поэтому следим за размерами напрямую.
    const nav = navRef.current;
    const btn = activeTab ? tabRefs.current[activeTab] : null;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro && nav) ro.observe(nav);
    if (ro && btn) ro.observe(btn);

    const raf = requestAnimationFrame(measure);
    // Подстраховка для браузеров без ResizeObserver и на случай позднего swap шрифта
    document.fonts?.ready.then(measure).catch(() => {});

    // Пересчёт при повороте экрана и смене размеров панели
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [activeTab, isInvestor, measureTab]);

  // Блик пробегает по стеклу только в момент переезда, а не постоянно
  useEffect(() => {
    if (!activeTab) return;
    setPillMoving(true);
    const id = setTimeout(() => setPillMoving(false), 520);
    return () => clearTimeout(id);
  }, [activeTab]);

  const investorPermissions = activeInvestor?.permissions;
  const [showInvestorMobileMenu, setShowInvestorMobileMenu] = useState(false);

  // ─── Перетаскивание капсулы ────────────────────────────────────────────────
  // Капсулу можно зажать и вести пальцем: она следует за ним, по пути
  // подсвечивая раздел, над которым находится, а на отпускании доезжает до
  // ближайшего и открывает его.
  const [dragPos, setDragPos] = useState<number | null>(null);   // абсолютный x во время перетаскивания
  // Отдельно от dragging: капсула отзывается на само касание, ещё до того как
  // палец сдвинулся дальше порога и жест стал перетаскиванием.
  const [pressed, setPressed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragTab, setDragTab] = useState<string | null>(null);
  const dragTabRef = useRef<string | null>(null);
  // active=false, пока палец не сдвинулся дальше порога: до этого жест ещё
  // может оказаться обычным нажатием, и перехватывать его нельзя.
  const dragRef = useRef<{ id: number; startX: number; startY: number; baseX: number; active: boolean } | null>(null);
  // После перетаскивания браузер всё равно шлёт click по кнопке под пальцем —
  // его надо проглотить, иначе переход случится дважды.
  const suppressClick = useRef(false);

  const TAB_ORDER = ['dashboard', 'cash', 'customers', 'more'];
  const visibleTabs = () => TAB_ORDER.filter(id => tabRefs.current[id]);

  const goToTab = (id: string) => {
    if (id === 'dashboard') return setView('DASHBOARD');
    if (id === 'cash') return setView('CASH_REGISTER');
    if (id === 'customers') return onGoToCustomers ? onGoToCustomers() : setView('CUSTOMERS');
    if (id === 'more') return isInvestor ? setShowInvestorMobileMenu(true) : setView('MORE');
  };

  // Раздел, чей центр ближе всего к центру капсулы
  const nearestTab = (x: number, w: number) => {
    const center = x + w / 2;
    let best: string | null = null;
    let bestDist = Infinity;
    for (const id of visibleTabs()) {
      const g = measureTab(id);
      if (!g) continue;
      const d = Math.abs(center - (g.x + g.w / 2));
      if (d < bestDist) { bestDist = d; best = id; }
    }
    return best;
  };

  // Слушаем на окне, а не на панели: палец нередко отпускают, уже уведя его с
  // острова, и события panel'ю не достаётся — капсула так и осталась бы крупной.
  useEffect(() => {
    if (!pressed) return;
    const release = () => setPressed(false);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, [pressed]);

  const handleNavPointerDown = (e: React.PointerEvent) => {
    if (!pill || !pillVisible || e.pointerType === 'mouse' && e.button !== 0) return;
    const nav = navRef.current;
    if (!nav) return;
    const n = nav.getBoundingClientRect();
    const lx = e.clientX - n.left;
    const ly = e.clientY - n.top;
    // Зона захвата чуть шире самой капсулы — в неё труднее не попасть пальцем
    const grab = 10;
    const inPill = lx >= pill.x - grab && lx <= pill.x + pill.w + grab
                && ly >= pill.y - grab && ly <= pill.y + pill.h + grab;
    if (!inPill) return;
    setPressed(true);
    dragRef.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, baseX: pill.x, active: false };
  };

  const handleNavPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId || !pill) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.active) {
      if (Math.abs(dx) < 6) return;                       // ещё не тянут — это обычное нажатие
      if (Math.abs(dy) > Math.abs(dx)) { dragRef.current = null; return; }  // ведут вверх/вниз — жест не наш
      d.active = true;
      setDragging(true);
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* палец уже отпущен */ }
    }
    const tabs = visibleTabs();
    const first = measureTab(tabs[0]);
    const last = measureTab(tabs[tabs.length - 1]);
    let x = d.baseX + dx;
    // За крайними разделами капсула не останавливается намертво, а идёт с
    // сопротивлением — так понятно, что дальше двигать некуда.
    if (first && x < first.x) x = first.x - (first.x - x) * 0.3;
    if (last && x > last.x) x = last.x + (x - last.x) * 0.3;
    setDragPos(x);
    const near = nearestTab(x, pill.w);
    if (near !== dragTabRef.current) {
      dragTabRef.current = near;
      setDragTab(near);
      // Короткий отклик на пересечении раздела — как у нативных переключателей
      try { navigator.vibrate?.(8); } catch { /* устройство без вибромотора */ }
    }
  };

  const endDrag = (commit: boolean) => {
    const d = dragRef.current;
    const target = commit ? dragTabRef.current : null;   // читаем до сброса
    dragRef.current = null;
    const wasActive = !!d?.active;
    setDragPos(null);
    setDragging(false);
    setDragTab(null);
    dragTabRef.current = null;
    if (!wasActive) return;                 // палец не сдвинулся — обычное нажатие, кнопка отработает сама
    suppressClick.current = true;
    window.setTimeout(() => { suppressClick.current = false; }, 400);
    if (!target || target === activeTab) return;
    // Инвестору «Профиль» открывает лист, а не раздел: активная вкладка не
    // меняется, поэтому капсулу оставляем ехать домой.
    const willActivate = !(isInvestor && target === 'more');
    if (willActivate) {
      const geom = measureTab(target);
      if (geom) setPill(geom);              // ставим цель сразу, иначе капсула сначала вернётся к старой
      setPillMoving(true);
      window.setTimeout(() => setPillMoving(false), 520);
    }
    goToTab(target);
  };

  const handleNavPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current && dragRef.current.id !== e.pointerId) return;
    endDrag(true);
  };

  const handleNavPointerCancel = () => endDrag(false);

  const handleNavClickCapture = (e: React.MouseEvent) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  // Во время перетаскивания подсвечен раздел под капсулой, а не открытый
  const tabActive = (id: string) => (dragTab ?? activeTab) === id;


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
  // В компоненте Layout замени counts на эту версию:
const counts = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let active = 0;
    let overdue = 0;
    let archive = 0;

    const customerIdSet = new Set(customers.map(c => c.id));
    const actualSales = sales.filter(sale => customerIdSet.has(sale.customerId));

    actualSales.forEach(sale => {
      // Архив: завершенные или полностью оплаченные
      if (sale.status === 'COMPLETED' || sale.remainingAmount === 0) {
        archive++;
        return;
      }

      if (calculateSaleOverdue(sale, today) > 0) {
        overdue++;
      } else {
        active++;
      }
    });

    return { all: actualSales.length, active, overdue, archive };
}, [sales, customers]);

  // Desktop Sidebar Items
  const allSidebarItems = [
    { id: 'TASKS' as const, label: 'Задачи', icon: ICONS.Tasks, visible: showTasks && !isInvestor },
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
        { label: 'Все', tab: 'ALL', icon: ICONS.List, count: counts.all, visible: true },
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
    // Инвесторы — дело менеджера: сотруднику этот раздел не нужен
    { id: 'INVESTORS' as const, label: 'Инвесторы', icon: ICONS.Users, visible: !isInvestor && user?.role !== 'employee' },
    { id: 'EMPLOYEES' as const, label: 'Сотрудники', icon: ICONS.Employees, visible: !isInvestor && (user?.role === 'admin' || (user?.role === 'manager' && showEmployees)) },
    { id: 'SUPPLIERS' as const, label: 'Партнеры', icon: ICONS.Suppliers, visible: !isInvestor && (user?.role === 'admin' || (user?.role === 'manager' && showSuppliers)) },
    { id: 'TARIFFS' as const, label: 'Тарифы', icon: ICONS.Tariffs, visible: !isInvestor },
    { id: 'SETTINGS' as const, label: 'Настройки', icon: ICONS.Settings, visible: !isInvestor },
    { id: 'ADMIN_PANEL' as const, label: 'Админ панель', icon: ICONS.Crown, visible: user?.role === 'admin' },
  ];

  const sidebarItems = useMemo(() => {
      return allSidebarItems.filter(item => item.visible);
  }, [user, counts, isInvestor, investorPermissions]);

  const closeMenu = () => {
    setIsMenuClosing(true);
    setTimeout(() => {
      setIsMenuOpen(false);
      setIsMenuClosing(false);
    }, 260);
  };

  const handleFabClick = () => {
    if (isMenuOpen) closeMenu();
    else { setIsMenuOpen(true); setIsMenuClosing(false); }
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
    closeMenu();
    setTimeout(() => onAction(action), 260);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col md:flex-row font-sans">
      {/* Верх экрана: сплошной шапки нет. Над контентом висят два отдельных
          пузыря — название компании и уведомления, — а между ними страница
          просматривается насквозь и уходит под чёлку.
          pointer-events-none на слое: пустое место не должно перехватывать
          нажатия по контенту под ним; пузыри возвращают себе события сами. */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 safe-area-top pointer-events-none">
        {/* Растушёвка под системной полосой: часы и значки рисует система, и над
            светлой карточкой они теряются. Градиент почти не виден, но контраст
            вытягивает. */}
        <div aria-hidden className="topbar-scrim" />

        <div className="h-16 flex items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-2 min-w-0">
            {/* Сюда порталом из PagePush приходит стрелка «назад» толкнутой
                страницы и встаёт отдельным пузырём перед названием.
                display: contents — пустой слот не создаёт ни коробки, ни зазора,
                поэтому без стрелки название прижато к краю как раньше. */}
            <div id="topbar-back-slot" className="contents" />
            <div className="glass-surface rounded-full pointer-events-auto flex items-center gap-2 min-w-0 pl-4 pr-4 py-2">
            <h1 className="text-lg font-bold tracking-tight text-indigo-600 dark:text-indigo-400 truncate">
              {appSettings.companyName}
            </h1>
            {isOnline && isSyncing && (
              <span
                className="shrink-0 text-indigo-500 dark:text-indigo-300 topbar-sync"
                title="Синхронизация..."
                aria-label="Синхронизация"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                  <polyline points="21 3 21 9 15 9" />
                </svg>
              </span>
              )}
            </div>
          </div>

          {showNotificationsBell && (
            <button
              onClick={onOpenNotifications}
              className="glass-surface rounded-full pointer-events-auto relative shrink-0 w-11 h-11 flex items-center justify-center text-slate-600 dark:text-slate-200 active:scale-95 transition-transform"
              aria-label="Уведомления"
            >
              {ICONS.Bell}
              {unreadNotifCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center ring-2 ring-white dark:ring-slate-800">
                  {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
                </span>
              )}
            </button>
          )}
        </div>
      </header>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-slate-900 text-white h-screen fixed left-0 top-0 overflow-y-auto z-20">
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
              {appSettings.companyName}
            </h1>
            {showNotificationsBell && (
              <button
                onClick={onOpenNotifications}
                className="relative p-2 rounded-full text-slate-400 hover:bg-slate-800 hover:text-white shrink-0"
                aria-label="Уведомления"
              >
                {ICONS.Bell}
                {unreadNotifCount > 0 && (
                  <span className="absolute top-0.5 right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
                    {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
                  </span>
                )}
              </button>
            )}
          </div>
          <div className="mt-2 flex gap-2">
              {/*{!isOnline && <span className="text-[10px] font-bold text-amber-400 bg-amber-900/30 border border-amber-800 px-2 py-0.5 rounded">Офлайн режим</span>}*/}
              {isOnline && isSyncing && <span className="text-[10px] font-bold text-blue-400 bg-blue-900/30 border border-blue-800 px-2 py-0.5 rounded">Синхронизация...</span>}
          </div>

        </div>
        <nav className="flex-1 p-4 space-y-2">
          {sidebarItems.map(item => renderMenuItem(item))}
        </nav>

        {user && (
             <div className="p-4 border-t border-slate-800">
                <button onClick={onNavigateToProfile} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-800 transition-colors">
                    <div className="w-10 h-10 bg-indigo-500 rounded-full flex items-center justify-center font-bold">
                        {user.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <p className="font-semibold text-sm text-left">{user.name}</p>
                        <p className="text-xs text-slate-400 text-left">{user.email}</p>
                    </div>
                </button>
             </div>
        )}
      </aside>

      {/* Main Content Area - Updated margins and centering */}
      <main className="flex-1 md:ml-64 p-4 md:p-10 mx-auto w-full mb-20 md:mb-0 mt-16 md:mt-0 flex flex-col h-full bg-slate-50 dark:bg-slate-900 mobile-main-offset">
        <div className="relative w-full max-w-7xl mx-auto flex-1 min-h-0">
            {children}
        </div>
      </main>

      {/* Mobile Quick Actions Menu (Triggered by FAB) - ONLY FOR MANAGER/EMPLOYEE */}
      {!isInvestor && isMenuOpen && (
        <div
          // Размытие держит слой затемнения, а не сама панель: элемент с
          // backdrop-filter становится «корнем подложки», и вложенное стекло
          // страницу под собой уже не видит. Раз панель стала полупрозрачной,
          // размытие фона усилено с blur-sm — иначе сквозь меню читался бы текст
          // карточек.
          className={`fixed inset-0 bg-slate-900/60 backdrop-blur-xl z-40 md:hidden flex flex-col justify-end pb-32 px-4 ${isMenuClosing ? 'animate-fade-out' : 'animate-modal-fade-in'}`}
          onClick={closeMenu}
        >
          <div
            className={`glass-surface rounded-2xl overflow-hidden ${isMenuClosing ? 'animate-slide-down-sheet' : 'animate-slide-up-sheet'}`}
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 pt-4 pb-2 border-b border-slate-100 dark:border-slate-700">
              <h3 className="text-slate-500 dark:text-slate-400 font-bold text-sm uppercase tracking-wide">Быстрые действия</h3>
            </div>
            <div className="p-2">
              <button onClick={() => handleActionClick('CALCULATOR')} className="w-full flex items-center gap-3 p-3.5 active:bg-slate-50 dark:active:bg-slate-700 rounded-xl text-slate-700 dark:text-slate-300">
                <div className="bg-violet-100 dark:bg-violet-900/30 p-2.5 rounded-full text-violet-600 dark:text-violet-400">{ICONS.Calculator}</div>
                <span className="font-semibold text-[15px]">Калькулятор</span>
              </button>
              {showTasks && (
                <button onClick={() => handleActionClick('TASKS')} className="w-full flex items-center gap-3 p-3.5 active:bg-slate-50 dark:active:bg-slate-700 rounded-xl text-slate-700 dark:text-slate-300">
                  <div className="bg-sky-100 dark:bg-sky-900/30 p-2.5 rounded-full text-sky-600 dark:text-sky-400">{ICONS.Tasks}</div>
                  <span className="font-semibold text-[15px]">Задачи</span>
                </button>
              )}
              <button onClick={() => handleActionClick('CREATE_SALE')} className="w-full flex items-center gap-3 p-3.5 active:bg-slate-50 dark:active:bg-slate-700 rounded-xl text-slate-700 dark:text-slate-300">
                <div className="bg-indigo-100 dark:bg-indigo-900/30 p-2.5 rounded-full text-indigo-600 dark:text-indigo-400">{ICONS.Sales}</div>
                <span className="font-semibold text-[15px]">Оформить продажу</span>
              </button>
              <button onClick={() => handleActionClick('INCOME')} className="w-full flex items-center gap-3 p-3.5 active:bg-slate-50 dark:active:bg-slate-700 rounded-xl text-slate-700 dark:text-slate-300">
                <div className="bg-emerald-100 dark:bg-emerald-900/30 p-2.5 rounded-full text-emerald-600 dark:text-emerald-400">{ICONS.Income}</div>
                <span className="font-semibold text-[15px]">Приход (Внести)</span>
              </button>
              <button onClick={() => handleActionClick('EXPENSE')} className="w-full flex items-center gap-3 p-3.5 active:bg-slate-50 dark:active:bg-slate-700 rounded-xl text-slate-700 dark:text-slate-300">
                <div className="bg-red-100 dark:bg-red-900/30 p-2.5 rounded-full text-red-600 dark:text-red-400">{ICONS.Expense}</div>
                <span className="font-semibold text-[15px]">Расход (Изъять)</span>
              </button>
              <button onClick={() => handleActionClick('OPERATIONS')} className="w-full flex items-center gap-3 p-3.5 active:bg-slate-50 dark:active:bg-slate-700 rounded-xl text-slate-700 dark:text-slate-300">
                <div className="bg-slate-100 dark:bg-slate-700 p-2.5 rounded-full text-slate-600 dark:text-slate-300">{ICONS.List}</div>
                <span className="font-semibold text-[15px]">Все операции</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation */}
      {/* Обёртка держит отступы от краёв и безопасную зону, сам остров — внутри.
          pointer-events-none, чтобы прозрачные поля по бокам не перехватывали нажатия
          по контенту под ними. */}
      <div
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 px-5 pointer-events-none"
        style={{ paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom, 0px))' }}
      >
      <nav
        ref={navRef}
        // touch-pan-y: вертикальную прокрутку страницы отдаём браузеру, горизонтальное
        // ведение остаётся нам — иначе перетаскивание конфликтовало бы со скроллом.
        className={`nav-glass nav-island pointer-events-auto px-2 pt-0 pb-1.5 flex justify-between items-end relative touch-pan-y select-none ${
          pressed || dragging || pillMoving ? 'nav-island--held' : ''
        }`}
        onPointerDown={handleNavPointerDown}
        onPointerMove={handleNavPointerMove}
        onPointerUp={handleNavPointerUp}
        onPointerCancel={handleNavPointerCancel}
        onClickCapture={handleNavClickCapture}
      >
        {/* Стеклянная капсула активного раздела. Лежит под кнопками (z-0) и
            переезжает к активной — координаты считает useLayoutEffect выше. */}
        {pill && (
          <div
            aria-hidden
            className={`nav-glass-track ${dragging ? 'nav-glass-track--dragging' : ''}`}
            style={{
              transform: `translate3d(${dragPos ?? pill.x}px, ${pill.y}px, 0)`,
              width: pill.w,
              height: pill.h,
              left: 0,
              top: 0,
              opacity: pillVisible ? 1 : 0,
            }}
          >
            <div className={`nav-glass-pill ${pressed || dragging ? 'nav-glass-pill--held' : pillMoving ? 'nav-glass-pill--moving' : ''}`} />
          </div>
        )}

        <div className={`flex ${isInvestor ? 'w-full justify-around' : 'w-2/5 justify-around'}`}>
            <button ref={el => { tabRefs.current['dashboard'] = el; }} onClick={() => setView('DASHBOARD')} className={`relative z-10 flex flex-col items-center p-2 transition-colors ${tabActive('dashboard') ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-400'}`}>
                {ICONS.Dashboard}
                <span className="text-[10px] mt-1 font-medium">Главная</span>
            </button>
            {!isInvestor && (
              <button ref={el => { tabRefs.current['cash'] = el; }} onClick={() => setView('CASH_REGISTER')} className={`relative z-10 flex flex-col items-center p-2 transition-colors ${tabActive('cash') ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-400'}`}>
                  {ICONS.Wallet}
                  <span className="text-[10px] mt-1 font-medium">Касса</span>
              </button>
            )}
        </div>

        {!isInvestor && (
          <div className="relative -top-5 z-10">
              <button
                  onClick={handleFabClick}
                  className={`w-14 h-14 rounded-full flex items-center justify-center text-white transition-transform active:scale-95 ${isMenuOpen ? 'bg-slate-800 rotate-45' : 'bg-indigo-600'}`}
              >
                  {ICONS.Add}
              </button>
          </div>
        )}

        <div className={`flex ${isInvestor ? 'w-full justify-around' : 'w-2/5 justify-around'}`}>
            {!isInvestor && (
              <button ref={el => { tabRefs.current['customers'] = el; }} onClick={() => (onGoToCustomers ? onGoToCustomers() : setView('CUSTOMERS'))} className={`relative z-10 flex flex-col items-center p-2 transition-colors ${tabActive('customers') ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-400'}`}>
                  {ICONS.Customers}
                  <span className="text-[10px] mt-1 font-medium">Клиенты</span>
              </button>
            )}
            <button
                onClick={() => {
                    if (isInvestor) {
                        // Показываем меню с доступными разделами
                        setShowInvestorMobileMenu(true);
                    } else {
                        setView('MORE');
                    }
                }}
                ref={el => { tabRefs.current['more'] = el; }}
                className={`relative z-10 flex flex-col items-center p-2 transition-colors ${
                    tabActive('more') ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-400'
                }`}
            >
                {ICONS.Menu}
                <span className="text-[10px] mt-1 font-medium">{isInvestor ? 'Профиль' : 'Еще'}</span>
            </button>

            {/* 📱 Мобильное меню для инвестора (показывает доступные разделы) */}
{showInvestorMobileMenu && (
  // Порталом в body: остров теперь масштабируется при нажатии, а элемент с
  // transform становится точкой отсчёта для position: fixed внутри себя —
  // меню схлопнулось бы до размеров острова. См. ModalPortal.
  <ModalPortal>
  <div
    className="fixed inset-0 z-modal flex items-end justify-center bg-slate-900/60 backdrop-blur-sm animate-fade-in md:hidden"
    onClick={() => setShowInvestorMobileMenu(false)}
  >
    <div
      className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-t-3xl p-5 pb-8 shadow-2xl animate-slide-up"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100 dark:border-slate-700">
        <h3 className="font-bold text-slate-800 dark:text-white">Доступные разделы</h3>
        <button
          onClick={() => setShowInvestorMobileMenu(false)}
          className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div className="space-y-2">
        {/* Договоры */}
        {(investorPermissions?.canViewContracts) && (
          <button
            onClick={() => {
              setShowInvestorMobileMenu(false);
              setView('CONTRACTS');
              onContractTabChange?.('ACTIVE');
            }}
            className="w-full flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-xl text-left transition-colors"
          >
            <span className="text-indigo-600 dark:text-indigo-400">{ICONS.File}</span>
            <div>
              <p className="font-semibold text-slate-800 dark:text-white">Договоры</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Просмотр активных сделок</p>
            </div>
          </button>
        )}

        {/* История */}
        {(investorPermissions?.canViewHistory) && (
          <button
            onClick={() => {
              setShowInvestorMobileMenu(false);
              setView('OPERATIONS');
            }}
            className="w-full flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-xl text-left transition-colors"
          >
            <span className="text-indigo-600 dark:text-indigo-400">{ICONS.List}</span>
            <div>
              <p className="font-semibold text-slate-800 dark:text-white">История операций</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Все платежи и движения</p>
            </div>
          </button>
        )}

        {/* Профиль (заглушка, если нет других разрешений) */}
        {!investorPermissions?.canViewContracts && !investorPermissions?.canViewHistory && (
          <div className="text-center py-6 text-slate-400 text-sm">
            Нет доступных разделов
          </div>
        )}
      </div>

      {/* Кнопка закрытия */}
      <button
        onClick={() => setShowInvestorMobileMenu(false)}
        className="w-full mt-4 py-3 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
      >
        Закрыть
      </button>
    </div>
  </div>
  </ModalPortal>
)}

        </div>

      </nav>
      </div>
         {/* 🔹 Плавающая кнопка техподдержки (только десктоп) */}
{supportButton && (
  <div className="hidden md:block">
    {supportButton}
  </div>
)}
    </div>
  );
};

export default Layout;
