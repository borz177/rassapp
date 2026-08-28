
import React, { useState, useEffect, useMemo, useRef, Suspense, lazy } from 'react';
import PartnerPage from './components/PartnerPage';
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
import EmployeeActivity from './components/EmployeeActivity';
import Operations from './components/Operations';
import Settings from './components/Settings';
import Reports from './components/Reports';
import Profile from './components/Profile';
import Partners from './components/Partners';
import Suppliers from './components/Suppliers';
import Tasks from './components/Tasks';
import SupplierDetails from './components/SupplierDetails';
import InvestorDashboard from './components/InvestorDashboard';
import Tariffs from './components/Tariffs';
import Auth from './components/Auth';
import PagePush from './components/transitions/PagePush';
// 🔹 Редко открываемые/тяжёлые экраны — грузим отдельными чанками по требованию,
// чтобы не тащить их в основной бандл (особенно заметно на медленном соединении/VPN).
const AdminPanel = lazy(() => import('./components/AdminPanel'));
const AdminSupportPanel = lazy(() => import('./components/AdminSupportPanel'));
const Integrations = lazy(() => import('./components/Integrations'));
const Calculator = lazy(() => import('./components/Calculator'));
const Referral = lazy(() => import('./components/Referral'));
import { SuccessCheck } from './components/feedback';
const LazyFallback: React.FC = () => (
  <div className="flex items-center justify-center py-20">
    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
  </div>
);
import { Customer, Product, Sale, ViewState, Expense, User, Account, Investor, Payment, AppSettings, InvestorPermissions, Partnership, SubscriptionPlan, Supplier, Task, LossEvent } from './types';
import { getAppSettings, saveAppSettings } from './services/storage';
import { api } from './services/api';
import { ICONS } from './constants';
import SplashScreen from "./components/SplashScreen"

import SupportButton from './components/SupportButton';
import SupportChat from './components/SupportChat';
import NotificationsPanel from './components/NotificationsPanel';
import NotificationsPage from './components/NotificationsPage';
import { formatCurrency, formatDate, getAccountShares, getManagerSharePercent, getInvestorAccount, isAccountForInvestor, getCapitalShares, getActivePeriodAt, calculateSaleOverdue, addMonthsClamped, getManagerProfitDeduction, getEmployeeProfitAccrued, shareDateForSale } from './src/utils';
import { useSwipeable } from "react-swipeable"

import Landing from './components/Landing.tsx';
import { NotificationModal } from './components/NotificationModal';
import { withTimeout } from './src/timeout';
import { offlineStorage } from "./services/offlineStorage";
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { triggerPagePushBack } from './components/transitions/PagePush';
import { useTheme } from './src/theme/ThemeContext';

async function enablePersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    const isPersisted = await navigator.storage.persisted();
    if (!isPersisted) {
      const granted = await navigator.storage.persist();
    }
  }
}




// Views pushed on top of the mobile "Еще" menu — kept stacked over MORE (which stays mounted
// underneath, gated on previousView === 'MORE') so swiping back reveals the real menu, not blank space.
const MORE_PUSH_VIEWS = new Set<ViewState>([
  'PROFILE', 'SETTINGS', 'EMPLOYEES', 'SUPPLIERS', 'TARIFFS', 'ADMIN_PANEL',
  'REPORTS', 'CONTRACTS', 'INVESTORS', 'TASKS', 'REFERRAL', 'PARTNER',
]);

// 🎁 Код приглашения из адреса сохраняем СРАЗУ при загрузке любой страницы.
//
// Раньше захват жил внутри компонента Auth, и это не работало: по адресу «/» открывается
// лендинг, Auth не смонтирован, эффект не выполняется. А кнопка «Войти» на лендинге —
// обычная ссылка на /app, то есть полная перезагрузка, при которой ?ref= теряется.
// Здесь код перехватывается до какой-либо развилки и переживает переход на /app.
const capturePendingReferral = () => {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('ref');
    if (fromUrl) {
      const code = fromUrl.trim().toUpperCase().slice(0, 16);
      if (code) localStorage.setItem('pending_referral', code);
    }
  } catch { /* приватный режим без localStorage — приглашение просто не засчитается */ }
};
capturePendingReferral();

const App: React.FC = () => {
    const path = window.location.pathname
const isLanding = path === "/"
  const { resolvedTheme } = useTheme();
  // Auth State
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPublicMode, setIsPublicMode] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  // 🔒 Синхронный guard от параллельных handleSync(): событие 'online' и стартовый
  // setTimeout(handleSync, 1000) вызывают handleSync() напрямую, без проверки isSyncing
  // (в отличие от 5-минутного интервала — см. ниже). React-стейт isSyncing тут не подходит:
  // event-хендлеры объявлены один раз в useEffect([]) и видели бы устаревшее значение.
  // Несколько одновременных handleSync() гоняют собственные fetchAllData()+setSales(merge...),
  // что расширяет окно гонки, в которой свежая правка платежа может быть затёрта устаревшими
  // данными с сервера.
  const isSyncingRef = React.useRef(false);

  // App State
  const [currentView, setCurrentView] = useState<ViewState>('DASHBOARD');

  const [activeContractTab, setActiveContractTab] = useState<'ALL' | 'ACTIVE' | 'OVERDUE' | 'ARCHIVE'>('ACTIVE');

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [investors, setInvestors] = useState<Investor[]>([]);
  // 🔒 Инвесторы сверх лимита тарифа. Список считает сервер и отдаёт в /api/data —
  // так интерфейс и проверки при записи опираются на одно правило и не расходятся.
  // Данные таких инвесторов сохраняются: они блокируются, а не удаляются.
  const [lockedInvestorIds, setLockedInvestorIds] = useState<string[]>([]);
  // Счета заблокированных инвесторов — операции по ним тоже закрыты, иначе деньги
  // можно было бы проводить через тот же счёт, просто не указывая инвестора.
  const [lockedAccountIds, setLockedAccountIds] = useState<string[]>([]);
  const [employees, setEmployees] = useState<User[]>([]);
  const [partnerships, setPartnerships] = useState<Partnership[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  // Заготовка задачи, переданная со страницы договоров или карточки клиента
  const [taskDraft, setTaskDraft] = useState<Partial<Task> | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>({ companyName: 'FinUchet' });

  const [whatsappRefreshKey, setWhatsAppRefreshKey] = useState<number>(0);
  const [templatesRefreshKey, setTemplatesRefreshKey] = useState<number>(0);

  // Drafts & Temporary State
  const [draftSaleData, setDraftSaleData] = useState<any>({});
  const [previousView, setPreviousView] = useState<ViewState>('DASHBOARD');
  // Remembers whether a customer's details were left open, so tapping the "Клиенты" tab
  // again (from elsewhere in the app) resumes there instead of resetting to the list.
  const [customersSubView, setCustomersSubView] = useState<'LIST' | 'DETAILS'>('LIST');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedInvestorId, setSelectedInvestorId] = useState<string | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [draftExpenseData, setDraftExpenseData] = useState<any>(null);
  const [operationsAccountId, setOperationsAccountId] = useState<string | null>(null);
  const [editingSale, setEditingSale] = useState<Sale | null>(null);
  const [initialSaleIdForDetails, setInitialSaleIdForDetails] = useState<string | null>(null);

  const [moreExpandedSection, setMoreExpandedSection] = useState<string | null>(null);

  const [supportUnreadCount, setSupportUnreadCount] = useState(0);
  const [showSupportChat, setShowSupportChat] = useState(false);

  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [showNotificationsPanel, setShowNotificationsPanel] = useState(false);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showTemplateUpdateModal, setShowTemplateUpdateModal] = useState(false);


  const [showSplash, setShowSplash] = useState(true);
  const [showBlockedDeleteModal, setShowBlockedDeleteModal] = useState<{
  customerId: string;
  customerName: string;
  contracts: Array<{ id: string; productName: string }>;
} | null>(null);

const [showSessionExpiredModal, setShowSessionExpiredModal] = useState(false);

  // 🎁 Поздравление о начисленных реферальных днях. Одно окно на все накопившиеся
  // награды: если человек неделю не заходил, а за это время оплатили трое, он увидит
  // одно сообщение о 30 днях, а не три подряд.
  const [referralBonus, setReferralBonus] = useState<{ count: number; days: number } | null>(null);
const [sessionMessage, setSessionMessage] = useState('');
const [sessionHandlers, setSessionHandlers] = useState<{
  onConfirm: () => void;
  onCancel: () => void;
} | null>(null);

// 🔹 Возврат из оплаты тарифа (?payment=success): статус активной проверки подписки
const [paymentReturnStatus, setPaymentReturnStatus] = useState<'checking' | 'success' | 'timeout' | null>(null);

  const [myProfitPeriod, setMyProfitPeriod] = useState(() => {
    const today = new Date().toISOString().split('T')[0];
    return { start: '2023-01-01', end: today };
  });

  const [reportFilters, setReportFilters] = useState({
      accountId: 'ALL',
      period: myProfitPeriod
  });



  // 🔹 Состояние для модала уведомлений
const [showNotification, setShowNotification] = useState(false);
const [notificationData, setNotificationData] = useState<{
  title: string;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  actionLabel?: string;
  onAction?: () => void;
  cancelLabel?: string;
} | null>(null);


// 🔹 Функция для показа уведомления (доступна из любых функций)
const showNotificationModal = (
  title: string,
  message: string,
  type: 'success' | 'error' | 'warning' | 'info',
  actionLabel?: string,
  onAction?: () => void,
  cancelLabel?: string
) => {
  setNotificationData({ title, message, type, actionLabel, onAction, cancelLabel });
  setShowNotification(true);
};



    const isNative =
  navigator.userAgent.includes("Electron") ||
  navigator.userAgent.includes("wv")





 // 🔒 Метки времени последних ЛОКАЛЬНЫХ записей (см. updateList ниже) — id → когда записали.
// Решает гонку, описанную в комментарии isSyncingRef выше в другом разрезе: даже ОДИН
// handleSync(), запущенный ДО локальной правки (например, удаления платежа) и завершившийся
// ПОСЛЕ неё, до этой правки вернул бы устаревшую версию записи с сервера и мог затереть её
// через mergeServerData — платёж, который пользователь только что удалил, "внезапно"
// появлялся бы обратно после фоновой синхронизации. isSyncingRef защищает только от
// параллельных ДРУГ ДРУГУ handleSync(), но не от этого — синхронизация тут всего одна.
const recentLocalWritesRef = React.useRef<Map<string, number>>(new Map());
// 30 секунд, а не 10: таймаут запроса — 8 секунд, и при прежнем значении между
// приходом медленного ответа и истечением гарда оставалось всего 2 секунды. Синхронизация
// теперь запускается ещё и при возврате в приложение, то есть чаще, и попасть в это окно
// стало проще. Гард лишь говорит «столько-то секунд доверяй локальной версии этой записи» —
// свежие данные по ней всё равно приедут следующей синхронизацией.
const RECENT_WRITE_GUARD_MS = 30000;

 // 🔹 Вспомогательная функция для "умного" слияния данных (исправленная версия)
// 🔹 Улучшенная версия с защитой от потери данных
const mergeServerData = <T extends { id: string }>(
    current: T[],
    fresh: T[],
    collectionName: string = 'unknown'
): T[] => {
    // 🔥 КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ ДЛЯ СОТРУДНИКОВ:
    // Если вошел сотрудник, и сервер вернул пустой массив (нет доступа), мы ОБЯЗАНЫ очистить кэш.
    if (user?.role === 'employee' && fresh.length === 0 && current.length > 0) {
        
        return [];
    }

    // 🔹 ЗАЩИТА 1: Если сервер вернул пустой массив — НЕ перезаписываем (ТОЛЬКО для менеджеров/админов)
    if (fresh.length === 0 && current.length > 0 && user?.role !== 'employee') {
        console.warn(`⚠️ Server returned empty array for "${collectionName}", keeping local data.`);
        return current;
    }

    const freshMap = new Map<string, T>(fresh.map(item => [item.id, item]));
    const now = Date.now();
    const updated = current.map(item => {
        if (!freshMap.has(item.id)) return item;
        // 🔒 Эту запись только что записали локально (см. updateList) — сервер мог ответить
        // данными, полученными ДО этой записи (гонка с фоновым handleSync, см. комментарий
        // у recentLocalWritesRef выше). Доверяем локальной версии ещё RECENT_WRITE_GUARD_MS,
        // а не слепо перезаписываем тем, что вернул fetchAllData.
        const writtenAt = recentLocalWritesRef.current.get(item.id);
        if (writtenAt && now - writtenAt < RECENT_WRITE_GUARD_MS) return item;
        return freshMap.get(item.id)!;
    });
    updated.forEach(item => freshMap.delete(item.id));
    // 🔒 То же самое для настоящих удалений (removeFromList) — если запись только что удалили
    // локально, но сервер в этом ответе (запрошенном ДО удаления) её ещё вернул, не добавляем
    // её обратно как "новую".
    const newItems = Array.from(freshMap.values()).filter(item => {
        const writtenAt = recentLocalWritesRef.current.get(item.id);
        return !(writtenAt && now - writtenAt < RECENT_WRITE_GUARD_MS);
    });

    return [...updated, ...newItems];
};

// 🔒 Единая функция приведения графика платежей (paymentPlan) и remainingAmount к согласованному
// виду. Раньше "остаток долга" и "график платежей" считались и обновлялись независимо друг от
// друга в трёх разных местах (handleSaveSale, handleIncomeSubmit, handleUndoPayment) — при
// офлайн-сохранении, гонке с фоновой синхронизацией или редактировании договора без явного
// изменения полей графика эти два числа расходились: то плановый платёж не создавался вообще
// (paymentPlan короче, чем installments), то remainingAmount не совпадал с суммой того, что
// реально показывает график. Теперь ЛЮБОЕ сохранение договора проходит через эту функцию —
// несогласованное состояние просто не может быть записано, независимо от причины.
// 🔒 Безопасное прибавление месяцев к дате. Обычный `date.setMonth(date.getMonth()+n)` при дне
// месяца 29-31 "переливается" в следующий месяц, если в целевом месяце столько дней нет —
// например, 30 февраля не существует, и JS превращает его в 2 марта. Из-за этого при обходе
// по installments месяцам подряд ДВЕ разные итерации (условно "февраль" и "март") попадали в
// один и тот же календарный месяц (короткий месяц "съедался" соседним), и вместо того чтобы
// найти существующую запись за этот месяц, код создавал дубликат — именно так в проде возникла
// лишняя запись за март у Приоры. Здесь день месяца всегда КЛАМПится до последнего реального
// дня целевого месяца, а не перетекает в следующий.

const reconcileSalePaymentPlan = (sale: Sale): Sale => {
    if (sale.type !== 'INSTALLMENT' || !Array.isArray(sale.paymentPlan)) return sale;

    const realPaidEntries = sale.paymentPlan.filter((p: Payment) => p.isPaid && p.isRealPayment !== false);
    const totalRealPaid = realPaidEntries.reduce((sum: number, p: Payment) => sum + p.amount, 0);
    // 🆕 Скидка при полном погашении (handleIncomeSubmit) "гасит" долг без реальных денег —
    // считаем её наравне с реальной оплатой, иначе остаток долга не дойдёт до нуля.
    const totalDiscounts = realPaidEntries.reduce((sum: number, p: Payment) => sum + ((p as any).discountAmount || 0), 0);

    const existingScheduled = sale.paymentPlan.filter((p: Payment) => p.isRealPayment !== true);
    const totalDue = Math.max(0, sale.totalAmount - sale.downPayment);
    const installments = Math.max(1, sale.installments || existingScheduled.length || 1);
    const monthlyAmount = Math.round((totalDue / installments) * 100) / 100;

    // 🔒 Определяем, каким КАЛЕНДАРНЫМ месяцам вообще должны соответствовать плановые слоты
    // (от даты первого платежа — startDate+1 месяц, день = paymentDay — и дальше по одному
    // месяцу на installment), и для каждого либо берём существующую запись за этот месяц
    // (сохраняя её id/isPaid/note как есть), либо создаём новую. Раньше недостающий платёж
    // просто добавлялся ПОСЛЕ последней записи в массиве — если реально пропущенные месяцы
    // были более РАННИМИ (а не последними), новый слот вставал не на своё место (например,
    // "довесок" за первые 9 месяцев уезжал на 9 месяцев ВПЕРЁД относительно последних трёх
    // уже существовавших) и график показывал совсем не те даты, что нужно.
    let firstPaymentDate: Date | null = new Date(sale.startDate);
    if (isNaN(firstPaymentDate.getTime())) {
        firstPaymentDate = null;
    } else {
        firstPaymentDate = addMonthsClamped(firstPaymentDate, 1);
        if (sale.paymentDay) {
            const daysInMonth = new Date(firstPaymentDate.getFullYear(), firstPaymentDate.getMonth() + 1, 0).getDate();
            firstPaymentDate.setDate(Math.min(sale.paymentDay, daysInMonth));
        }
    }

    let scheduled: Payment[];
    if (existingScheduled.length >= installments) {
        // 🔒 Уже есть столько же (или больше) плановых записей, сколько установлено
        // installments — значит ничего не пропущено, ничего достраивать не нужно. Берём
        // существующие как есть, НЕ пытаясь угадать календарные месяцы через startDate.
        // У Sale нет отдельного поля "дата первого платежа" (только paymentDay — день месяца),
        // поэтому startDate+1 месяц — лишь предположение; если договор редактировали и
        // реальная дата первого платежа съехала (например, при редактировании явно указали
        // другую дату первого платежа), предположение расходится с тем, что уже в графике, и
        // код (до этой правки) считал существующие месяцы "непонятными" и задваивал их лишней
        // записью, хотя всё уже было на месте.
        scheduled = existingScheduled.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    } else if (existingScheduled.length > 0) {
        // 🔒 Не хватает части плановых слотов, но хотя бы один уже есть — опираемся на ЕГО
        // дату (она отражает реальную дату первого платежа, которую выбрали при
        // оформлении/редактировании), а не на startDate+1 месяц вслепую. Достраиваем
        // недостающие месяцы либо ДО существующего блока, либо ПОСЛЕ — направление определяем
        // по знаку "лишних" реальных денег: если реально оплачено больше, чем покрывают
        // существующие слоты, — значит недостающие месяцы более РАННИЕ (деньгам просто некуда
        // деваться против только поздних слотов); иначе — недостающие месяцы более ПОЗДНИЕ
        // (обычный случай "не хватает хвоста графика").
        const sortedExisting = existingScheduled
            .slice()
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const existingSum = sortedExisting.reduce((sum, p) => sum + p.amount, 0);
        const missingCount = installments - sortedExisting.length;
        const extendBefore = totalRealPaid + totalDiscounts > existingSum + 0.01;

        const rebuilt: Payment[] = [];
        if (extendBefore) {
            const anchor = new Date(sortedExisting[0].date);
            for (let i = missingCount; i >= 1; i--) {
                const slotDate = addMonthsClamped(anchor, -i);
                rebuilt.push({
                    id: `pay_reconcile_${Date.now()}_${missingCount - i}`,
                    saleId: sale.id,
                    date: slotDate.toISOString(),
                    amount: monthlyAmount,
                    isPaid: false,
                    isRealPayment: false
                });
            }
            scheduled = [...rebuilt, ...sortedExisting];
        } else {
            const anchor = new Date(sortedExisting[sortedExisting.length - 1].date);
            for (let i = 1; i <= missingCount; i++) {
                const slotDate = addMonthsClamped(anchor, i);
                rebuilt.push({
                    id: `pay_reconcile_${Date.now()}_${i}`,
                    saleId: sale.id,
                    date: slotDate.toISOString(),
                    amount: monthlyAmount,
                    isPaid: false,
                    isRealPayment: false
                });
            }
            scheduled = [...sortedExisting, ...rebuilt];
        }
    } else if (firstPaymentDate) {
        // 🔙 Плановых слотов нет вообще (пустой график, installments:0-стиль договор) —
        // единственный случай, где реально приходится вычислять дату первого платежа из
        // startDate, потому что опереться не на что.
        const rebuilt: Payment[] = [];
        for (let i = 0; i < installments; i++) {
            const slotDate = addMonthsClamped(firstPaymentDate, i);
            rebuilt.push({
                id: `pay_reconcile_${Date.now()}_${i}`,
                saleId: sale.id,
                date: slotDate.toISOString(),
                amount: monthlyAmount,
                isPaid: false,
                isRealPayment: false
            });
        }
        scheduled = rebuilt;
    } else {
        // 🔙 Не удалось разобрать startDate — подстраховка: старое поведение (докинуть
        // недостающую сумму одним слотом после последней записи), лучше грубо, чем никак.
        scheduled = existingScheduled.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const totalScheduledAmount = scheduled.reduce((sum, p) => sum + p.amount, 0);
        const missingAmount = Math.round((totalDue - totalScheduledAmount) * 100) / 100;
        if (missingAmount > 0.01) {
            const lastDate = scheduled.length > 0 ? new Date(scheduled[scheduled.length - 1].date) : new Date();
            const newDate = addMonthsClamped(lastDate, 1);
            scheduled = [...scheduled, {
                id: `pay_reconcile_${Date.now()}_${scheduled.length}`,
                saleId: sale.id,
                date: newDate.toISOString(),
                amount: missingAmount,
                isPaid: false,
                isRealPayment: false
            }];
        }
    }

    // 🔹 Пересчитываем isPaid плановых слотов от факта реальных платежей (по датам, от раннего
    // к позднему) — не доверяем унаследованным флагам: они могут "зависнуть" в isPaid:true после
    // удаления покрывавшего их реального платежа (см. handleUndoPayment).
    let surplus = totalRealPaid + totalDiscounts;
    const reconciledScheduled = scheduled.map((p: Payment) => {
        const covered = surplus >= p.amount - 0.01;
        if (covered) surplus = Math.max(0, surplus - p.amount);
        return { ...p, isPaid: covered };
    });

    const realPayments = sale.paymentPlan.filter((p: Payment) => p.isRealPayment === true);
    const correctRemaining = Math.max(0, Math.round((totalDue - totalRealPaid - totalDiscounts) * 100) / 100);

    return {
        ...sale,
        paymentPlan: [...reconciledScheduled, ...realPayments],
        remainingAmount: correctRemaining
    };
};








  useEffect(() => {
      setReportFilters(prev => ({...prev, period: myProfitPeriod}));
  }, [myProfitPeriod]);


  // 🔹 Фоновая синхронизация каждые 5 минут, если приложение открыто
const backgroundSyncInterval = React.useRef<ReturnType<typeof setInterval> | null>(null);


  // Network Status & Sync
useEffect(() => {
  const handleOnline = async () => {
    console.log('🌐 Network online detected');
    setIsOnline(true);

    // 🔹 Ждём стабилизации сети (VPN/модем)
    await new Promise(resolve => setTimeout(resolve, 1500));

    // 🔹 Проверяем, реально ли сервер доступен
    try {
      const isReachable = await api.healthCheck();
      if (!isReachable) {
        console.warn('⚠️ Network online but server unreachable');
        return;
      }
    } catch {
      console.warn('⚠️ Health check failed');
      return;
    }

    // 🔔 Дожать уведомления, которые были отмечены прочитанными офлайн/при плохой связи —
    // иначе сервер по-прежнему считает их непрочитанными, и после реального восстановления
    // сети счётчик и статус "прочитано" откатываются назад.
    api.flushPendingNotificationReads().catch(() => {});

    await handleSync();
  };

  const handleOffline = () => {
    console.log('📴 Network offline');
    setIsOnline(false);
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  if (navigator.onLine) {
    setTimeout(() => handleSync(), 1000);
  }

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    clearInterval(backgroundSyncInterval.current); // Очистка интервала (см. ниже)
  };
}, []);





useEffect(() => {
  if (!user) return;

  backgroundSyncInterval.current = setInterval(() => {
    if (navigator.onLine) {
      console.log('🔄 Background sync triggered');
      handleSync();   // сам выйдет, если синхронизация уже идёт (isSyncingRef)
    }
  }, 5 * 60 * 1000); // 5 минут

  return () => {
    if (backgroundSyncInterval.current) clearInterval(backgroundSyncInterval.current);
  };
  // 🔒 isSyncing намеренно НЕ в зависимостях: он переключается дважды за каждую
  // синхронизацию, эффект перезапускался, и пятиминутный отсчёт всё время обнулялся —
  // реальный интервал плавал. Защита от параллельного запуска и так есть внутри
  // handleSync (isSyncingRef) и в api.sync().
}, [user]);

// 🔄 Обновление при возврате в приложение.
//
// Основной сценарий: договор внесли на телефоне, а на компьютере приложение открыто,
// но свёрнуто. Пятиминутный таймер в фоне душится браузером (в Electron — ещё и
// backgroundThrottling), поэтому переключение на окно ничего не обновляло и данные
// появлялись только после перезапуска. Такой же обработчик уже стоял на счётчике
// уведомлений — здесь он для основных данных.
//
// Момент возврата вдобавок самый безопасный для обновления: пользователь только что
// пришёл и заведомо ничего не редактировал последние секунды.
const lastFocusSyncRef = React.useRef(0);
useEffect(() => {
  if (!user) return;

  const FOCUS_SYNC_THROTTLE_MS = 20000; // чаще раза в 20 сек не дёргаем сервер

  const syncOnReturn = () => {
    if (!navigator.onLine) return;
    const now = Date.now();
    if (now - lastFocusSyncRef.current < FOCUS_SYNC_THROTTLE_MS) return;
    lastFocusSyncRef.current = now;
    handleSync();
  };

  const onVisible = () => { if (document.visibilityState === 'visible') syncOnReturn(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', syncOnReturn);

  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', syncOnReturn);
  };
}, [user]);


  // 🎁 Есть ли непоказанные реферальные награды. Отдельным эффектом, а не внутри
  // loadData: это редкое событие, и сбой запроса не должен влиять на загрузку данных.
  useEffect(() => {
    if (!user || user.role !== 'manager') return;
    let cancelled = false;
    const check = async () => {
      try {
        const p = await api.getReferralPending();
        if (!cancelled && p.count > 0) setReferralBonus({ count: p.count, days: p.days });
      } catch { /* не критично: уведомление в колокольчике всё равно придёт */ }
    };
    check();
    // Проверяем и при возврате в приложение: приглашённый мог оплатить, пока
    // вкладка висела в фоне
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisible); };
  }, [user?.id, user?.role]);

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
  if (isSyncingRef.current) {
    console.log('⏳ handleSync уже выполняется, пропускаем повторный вызов');
    return;
  }
  isSyncingRef.current = true;
  setIsSyncing(true);

  try {


    const syncResult = await api.sync();
    if (syncResult.success) {
      console.log(`🔄 Synced collections: ${[...syncResult.syncedCollections].join(', ') || 'none'}`);
    }

    // 🔹 ВСЕГДА пытаемся получить свежие данные
    try {
      const freshData = await api.fetchAllData();
      if (freshData) {
        if (freshData.customers) setCustomers(prev => mergeServerData(prev, freshData.customers, 'customers'));
        if (freshData.sales) setSales(prev => mergeServerData(prev, freshData.sales, 'sales'));
        if (freshData.expenses) setExpenses(prev => mergeServerData(prev, freshData.expenses, 'expenses'));
        if (freshData.accounts) setAccounts(prev => mergeServerData(prev, freshData.accounts, 'accounts'));
        if (freshData.investors) setInvestors(prev => mergeServerData(prev, freshData.investors, 'investors'));
        if (Array.isArray(freshData.lockedInvestorIds)) setLockedInvestorIds(freshData.lockedInvestorIds);
        if (Array.isArray(freshData.lockedAccountIds)) setLockedAccountIds(freshData.lockedAccountIds);
        if (freshData.products) setProducts(prev => mergeServerData(prev, freshData.products, 'products'));
        if (freshData.partnerships) setPartnerships(prev => mergeServerData(prev, freshData.partnerships, 'partnerships'));
        if (freshData.suppliers) setSuppliers(prev => mergeServerData(prev, freshData.suppliers, 'suppliers'));
        if (freshData.tasks) setTasks(prev => mergeServerData(prev, freshData.tasks, 'tasks'));

        if (freshData.settings) {
          setAppSettings(freshData.settings);
          saveAppSettings(freshData.settings);
        }
       
      }
    } catch (fetchErr: any) {
      console.warn('⚠️ Failed to fetch fresh data:', fetchErr.message);
    }
  } catch (e) {
    console.error("❌ Sync failed", e);
  } finally {
    isSyncingRef.current = false;
    setIsSyncing(false);
  }
};


// 🔹 Возврат из оплаты тарифа: YooKassa обрабатывает платёж и шлёт webhook серверу
// АСИНХРОННО, независимо от редиректа пользователя обратно в приложение — поэтому
// подписка на сервере может обновиться на 1-20 секунд позже, чем открылась эта страница.
// Активно опрашиваем /api/auth/me, пока не увидим изменение, вместо того чтобы ждать
// фоновую синхронизацию (которая может сработать через несколько минут).
// Вынесено на уровень компонента, т.к. вызывается и при старте, и кнопкой "Проверить снова".
const checkPaymentReturn = async () => {
  setPaymentReturnStatus('checking');

  let previousExpiresAt: string | undefined;
  try {
    const cached = localStorage.getItem('user');
    if (cached) previousExpiresAt = JSON.parse(cached)?.subscription?.expiresAt;
  } catch (e) {}

  const maxAttempts = 10; // ~20 секунд суммарно
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const freshUser = await api.getMe();
      if (freshUser?.subscription?.expiresAt && freshUser.subscription.expiresAt !== previousExpiresAt) {
        setUser(prev => {
          const merged = { ...(prev || freshUser), ...freshUser };
          localStorage.setItem('user', JSON.stringify(merged));
          return merged;
        });
        setPaymentReturnStatus('success');
        return;
      }
    } catch (e) {
      console.warn('⚠️ Проверка оплаты тарифа: попытка не удалась, повторяем...', e);
    }
    if (attempt < maxAttempts - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  setPaymentReturnStatus('timeout');
};

// 🔒 Момент реального появления сплеша (мгновение монтирования App) — от него отсчитываем
// минимальное время показа ниже, чтобы на быстром соединении/из кэша сплеш не мелькал долями
// секунды (именно резкое почти-мгновенное появление-и-исчезновение и воспринимается как "мерцание",
// а не сама анимация перехода).
const splashShownAtRef = useRef<number>(Date.now());
const MIN_SPLASH_VISIBLE_MS = 700;

// 🔒 Единая точка скрытия сплеша — если он был на экране меньше MIN_SPLASH_VISIBLE_MS (данные
// загрузились почти мгновенно, например из офлайн-кэша), сначала досиживаем оставшееся время.
// На медленном соединении, где загрузка и так дольше этого порога, задержки нет — hideSplash
// сработает сразу.
const hideSplash = () => {
  const elapsed = Date.now() - splashShownAtRef.current;
  const remaining = Math.max(0, MIN_SPLASH_VISIBLE_MS - elapsed);
  setTimeout(() => {
    setIsLoading(false);
    setShowSplash(false);
  }, remaining);
};

useEffect(() => {
  setShowSplash(true);
  enablePersistentStorage();

  const initApp = async () => {
    // 🔥 1. КРИТИЧЕСКАЯ СТРАХОВКА (WATCHDOG)
    // Если что-то зависнет (StatusBar, IndexedDB, сеть), мы всё равно покажем приложение через 5 секунд
    const initTimeout = setTimeout(() => {
        console.error('⚠️ initApp завис! Принудительно показываем интерфейс.');
        hideSplash();
    }, 5000);

    try {
        if (window.Capacitor && window.Capacitor.isNativePlatform()) {
            // 🔥 2. ОБЕРТЫВАЕМ StatusBar В ТАЙМАУТЫ (2 секунды)
            // Если плагин зависнет, мы просто пропустим этот шаг и пойдем дальше
            // overlay: true — приложение занимает и область статус-бара. Фон полосе не
            // задаём: её закрывает шапка приложения, выросшая на высоту выреза.
            await withTimeout(StatusBar.setOverlaysWebView({ overlay: true }), 2000).catch(() => {});
            await withTimeout(StatusBar.setStyle({ style: resolvedTheme === 'dark' ? Style.Dark : Style.Light }), 2000).catch(() => {});
        }
    } catch (e) {
        console.warn('StatusBar init skipped (web/timeout)');
    }

    const staticSplash = document.getElementById('static-splash');
    if (staticSplash) {
        staticSplash.classList.add('hidden');
        setTimeout(() => staticSplash.remove(), 400);
    }

    // 1. Проверка на публичный режим
    const searchParams = new URLSearchParams(window.location.search);
    const pathName = window.location.pathname;
    if (
        searchParams.get('view') === 'public_calc' ||
        searchParams.get('v') === 'calc' ||
        decodeURIComponent(pathName).startsWith('/calc')
    ) {
        clearTimeout(initTimeout); // Снимаем страховку
        setIsPublicMode(true);
        hideSplash();
        return;
    }

    // 1.5 Возврат из оплаты тарифа (?payment=success из returnUrl ЮKassa)
    if (searchParams.get('payment') === 'success') {
        // Убираем маркер из URL сразу, чтобы обновление страницы не запускало проверку повторно
        window.history.replaceState({}, '', window.location.pathname);
        checkPaymentReturn();
    }

    // 2. Читаем локального пользователя
    const token = localStorage.getItem('token');
    const localUserStr = localStorage.getItem('user');
    let localUser: User | null = null;
    if (localUserStr) {
        try {
            localUser = JSON.parse(localUserStr);
            if (localUser) setUser(localUser);
        } catch (e) {
            console.error("❌ Failed to parse local user", e);
            localStorage.removeItem('user');
            localStorage.removeItem('token');
        }
    }

    const hasLocalData = !!localUser;

    // 3. 🔥 ВСЕГДА загружаем данные из кэша IndexedDB мгновенно
        
    if (hasLocalData) {
        try {
            // 🔥 ОБЕРТЫВАЕМ IndexedDB В ТАЙМАУТ (3 секунды)
            const cachedData = await withTimeout(offlineStorage.getCache('all_data'), 3000);
            if (cachedData) {
                

                // 🔥 НОВОЕ: Применяем офлайн-очередь к кэшу ПЕРЕД показом!
                // Теперь при перезагрузке офлайн-данные не потеряются
                try {
                    const queue = await offlineStorage.getQueue();
                    if (queue.length > 0) {
                        
                        for (const item of queue) {
                            if (!item.collection || !cachedData[item.collection]) continue;
                            
                            if (item.type === 'saveItem') {
                                if (Array.isArray(cachedData[item.collection])) {
                                    const list = cachedData[item.collection] as any[];
                                    let idx = list.findIndex(i => i.id === item.payload.id);
                                    
                                    // Специальная логика для инвесторов (по email)
                                    if (idx === -1 && item.collection === 'investors' && item.payload.email) {
                                        idx = list.findIndex(i => i.email === item.payload.email);
                                        if (idx >= 0) { list[idx] = { ...list[idx], ...item.payload, id: item.payload.id }; continue; }
                                    }
                                    
                                    if (idx >= 0) { 
                                        list[idx] = item.payload; 
                                    } else {
                                        const isDuplicate = item.collection === 'investors' && item.payload.email && list.some(i => i.email === item.payload.email);
                                        if (!isDuplicate) list.unshift(item.payload);
                                    }
                                } else {
                                    cachedData[item.collection] = { ...cachedData[item.collection], ...item.payload };
                                }
                            } 
                            // 🔥 Корректная обработка удалений в офлайн-очереди
                            else if (item.type === 'deleteItem') {
                                if (Array.isArray(cachedData[item.collection])) {
                                    cachedData[item.collection] = cachedData[item.collection].filter(
                                        (i: any) => i.id !== item.itemId
                                    );
                                }
                            }
                        }
                    }
                } catch (qErr) {
                    console.warn('⚠️ Не удалось применить офлайн-очередь при старте:', qErr);
                }

                // 🔥 Теперь устанавливаем стейт уже с примененной очередью!
                if (cachedData.customers) setCustomers(cachedData.customers);
                if (cachedData.products) setProducts(cachedData.products);
                if (cachedData.sales) setSales(cachedData.sales);
                if (cachedData.expenses) setExpenses(cachedData.expenses);
                if (cachedData.accounts) setAccounts(cachedData.accounts);
                if (cachedData.investors) setInvestors(cachedData.investors);
                if (cachedData.partnerships) setPartnerships(cachedData.partnerships);
                if (cachedData.suppliers) setSuppliers(cachedData.suppliers);
                if (cachedData.tasks) setTasks(cachedData.tasks);
                if (cachedData.employees) setEmployees(cachedData.employees);
                if (cachedData.settings) setAppSettings(cachedData.settings);
            }
        } catch (e) {
            console.warn('⚠️ Не удалось загрузить кэш (таймаут или ошибка):', e);
        }
    }

    // 4. 🔥 МГНОВЕННО показываем приложение пользователю (не ждем сервер!)
    clearTimeout(initTimeout); // 🔥 Снимаем страховку, так как мы успешно дошли до конца
    hideSplash();


    // 5. 🔥 ФОНОВАЯ СИНХРОНИЗАЦИЯ (запускается, но НЕ блокирует интерфейс)
    if (token && navigator.onLine && localUser) {
      // Мы не используем await здесь, чтобы не останавливать выполнение кода
      (async () => {
        try {
          
          const isReachable = await api.healthCheck();

          if (isReachable) {
            // Обновляем данные пользователя (например, если изменилась подписка)
            const freshUser = await api.getMe();
            const mergedUser = {
              ...freshUser,
              permissions: freshUser.permissions || localUser.permissions,
              allowedInvestorIds: freshUser.allowedInvestorIds || localUser.allowedInvestorIds,
              fullAccessInvestorIds: freshUser.fullAccessInvestorIds || localUser.fullAccessInvestorIds
            };

            setUser(mergedUser);
            localStorage.setItem('user', JSON.stringify(mergedUser));

            // Получаем свежие данные и умно мёржим их с локальными
            const freshData = await api.fetchAllData();
            if (freshData) {
              if (freshData.customers) setCustomers(prev => mergeServerData(prev, freshData.customers, 'customers'));
              if (freshData.sales) setSales(prev => mergeServerData(prev, freshData.sales, 'sales'));
              if (freshData.expenses) setExpenses(prev => mergeServerData(prev, freshData.expenses, 'expenses'));
              if (freshData.accounts) setAccounts(prev => mergeServerData(prev, freshData.accounts, 'accounts'));
              if (freshData.investors) setInvestors(prev => mergeServerData(prev, freshData.investors, 'investors'));
              if (Array.isArray(freshData.lockedInvestorIds)) setLockedInvestorIds(freshData.lockedInvestorIds);
              if (Array.isArray(freshData.lockedAccountIds)) setLockedAccountIds(freshData.lockedAccountIds);
              if (freshData.products) setProducts(prev => mergeServerData(prev, freshData.products, 'products'));
              if (freshData.partnerships) setPartnerships(prev => mergeServerData(prev, freshData.partnerships, 'partnerships'));
              if (freshData.suppliers) setSuppliers(prev => mergeServerData(prev, freshData.suppliers, 'suppliers'));
              if (freshData.tasks) setTasks(prev => mergeServerData(prev, freshData.tasks, 'tasks'));

              if (freshData.settings) {
                setAppSettings(freshData.settings);
                saveAppSettings(freshData.settings);
              }
             
            }
          }
        } catch (err: any) {
          console.log('📴 Фоновая синхронизация пропущена (нет сети или таймаут), работаем с локальными данными');
        }
      })();
    }

    // 6. Если нет ни токена, ни пользователя
    if (!token && !localUser) {
      setUser(null);
      hideSplash();
    }

    // 7. Настройки (на всякий случай, если кэш пуст)
    setAppSettings(getAppSettings());
  };

  initApp();
}, []);

// 🔹 Аппаратная кнопка/жест "Назад" на Android: по умолчанию Capacitor выходит из приложения
// сразу, с любого экрана, т.к. в SPA нет истории браузера, по которой можно было бы "откатиться".
// Здесь мы сами решаем, что делать — сначала закрываем открытые модалки, затем "выехавшую"
// страницу (тем же способом, что и её кнопка/свайп "Назад"), затем возвращаемся на главную
// вкладку, и только если деваться больше некуда — спрашиваем подтверждение выхода.
// Слушатель регистрируется один раз при монтировании; актуальное состояние читается из рефа,
// чтобы не пересоздавать нативный listener на каждый чих (currentView меняется очень часто).
const backHandlerStateRef = useRef({
  showSessionExpiredModal, showSupportChat, showNotification,
  showTemplateUpdateModal, showBlockedDeleteModal, showDeleteConfirm, currentView
});
useEffect(() => {
  backHandlerStateRef.current = {
    showSessionExpiredModal, showSupportChat, showNotification,
    showTemplateUpdateModal, showBlockedDeleteModal, showDeleteConfirm, currentView
  };
});

useEffect(() => {
  if (!Capacitor.isNativePlatform()) return;

  let listenerHandle: { remove: () => void } | undefined;
  let cancelled = false;

  CapacitorApp.addListener('backButton', () => {
    const s = backHandlerStateRef.current;

    // Модалка истёкшей сессии не должна закрываться назад — это принудительный ре-логин.
    if (s.showSessionExpiredModal) return;

    if (s.showSupportChat) { setShowSupportChat(false); return; }
    if (s.showNotification) { setShowNotification(false); return; }
    if (s.showTemplateUpdateModal) { setShowTemplateUpdateModal(false); return; }
    if (s.showBlockedDeleteModal) { setShowBlockedDeleteModal(null); return; }
    if (s.showDeleteConfirm) { setShowDeleteConfirm(null); return; }

    if (triggerPagePushBack()) return;

    const tabRoots: ViewState[] = ['DASHBOARD', 'CASH_REGISTER', 'CUSTOMERS', 'MORE'];
    if (tabRoots.includes(s.currentView) && s.currentView !== 'DASHBOARD') {
      setCurrentView('DASHBOARD');
      return;
    }

    showNotificationModal(
      'Выход из приложения',
      'Вы уверены, что хотите выйти?',
      'warning',
      'Да, выйти',
      () => { CapacitorApp.exitApp(); },
      'Отмена'
    );
  }).then(h => {
    if (cancelled) h.remove();
    else listenerHandle = h;
  });

  return () => {
    cancelled = true;
    listenerHandle?.remove();
  };
}, []);

// 🔹 Установленный APK (нативная оболочка) не обновляется сам по себе, в отличие от веб-кода,
// который WebView каждый раз подтягивает свежим с сервера — поэтому проверяем именно нативную
// versionCode и, если на сервере опубликована более новая, предлагаем скачать новый APK.
useEffect(() => {
  if (!Capacitor.isNativePlatform()) return;
  (async () => {
    try {
      const [info, latest] = await Promise.all([CapacitorApp.getInfo(), api.getAppVersion()]);
      const installedCode = parseInt(info.build, 10); // на Android AppInfo.build === versionCode
      if (!Number.isFinite(installedCode) || latest.androidVersionCode <= installedCode) return;

      const apkUrl = new URL(latest.apkUrl, window.location.origin).toString();
      showNotificationModal(
        '📲 Доступно обновление',
        'Вышла новая версия приложения. Рекомендуем обновиться, чтобы получить последние исправления.',
        'info',
        'Скачать обновление',
        () => { window.open(apkUrl, '_system'); },
        'Позже'
      );
    } catch (e) {
      console.warn('⚠️ Проверка версии приложения не удалась:', e);
    }
  })();
}, []);

useEffect(() => {
  if (Capacitor.isNativePlatform()) {
    // Фон статус-бару не задаётся — полоса прозрачная, под ней шапка приложения.
    // Меняются только иконки, иначе на светлой шапке они станут белыми и пропадут.
    // 🔥 Названия у плагина обратные интуиции: Style.Dark = светлые иконки (для тёмного
    // фона), Style.Light = тёмные иконки (для светлого фона) — см. definitions.d.ts.
    StatusBar.setStyle({ style: resolvedTheme === 'dark' ? Style.Dark : Style.Light }).catch(() => {});
  }
  // Сплошной шапки нет — полоса должна совпадать с фоном страницы (slate-50 /
  // slate-900), он же цвет растушёвки под чёлкой.
  // Тег не правим, а заменяем целиком: Chrome в установленном PWA нередко не
  // замечает правку content у существующего тега, и полоса не меняла цвет при
  // переключении темы — новый узел он читает заново.
  const themeColor = resolvedTheme === 'dark' ? '#0f172a' : '#f8fafc';
  document.querySelectorAll('meta[name="theme-color"]').forEach(el => el.remove());
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'theme-color');
  meta.setAttribute('content', themeColor);
  document.head.appendChild(meta);
}, [resolvedTheme]);

// Вкладки нижней навигации живут на одной и той же прокрутке окна: пролистав
// «Клиентов» вниз и переключившись на «Главную», человек попадал на её середину.
// При смене вкладки возвращаем прокрутку наверх.
// Возврат с толкнутой страницы сюда не относится: она скроллится внутри своего
// слоя, вкладка под ней с места не двигалась — сбрасывать там нечего, да и
// потерять найденное место в списке было бы обиднее всего.
const TAB_ROOTS: ViewState[] = ['DASHBOARD', 'CASH_REGISTER', 'CUSTOMERS', 'MORE'];
const lastTabRootRef = useRef<ViewState | null>(null);
useEffect(() => {
  if (!TAB_ROOTS.includes(currentView)) return;
  if (lastTabRootRef.current === currentView) return;
  lastTabRootRef.current = currentView;
  window.scrollTo({ top: 0, behavior: 'auto' });
}, [currentView]);







// 🔥 Мгновенная и полная фильтрация стейта для сотрудника
// По умолчанию сотрудник видит только СВОИ записи (createdByUserId), кроме счетов/инвесторов
// из fullAccessInvestorIds — там менеджер разрешил видеть ВСЕ записи.
// Заменяет состояние только если набор id реально изменился — иначе setState создаёт
// новый массив с тем же содержимым каждый рендер, и раз accounts/sales есть в deps
// этого же эффекта, это уходит в бесконечный цикл ("Maximum update depth exceeded").
const replaceIfIdsChanged = <T extends { id: string }>(setter: React.Dispatch<React.SetStateAction<T[]>>, next: T[]) => {
    setter(prev => {
        if (prev.length === next.length && prev.every((p, i) => p.id === next[i].id)) return prev;
        return next;
    });
};

useEffect(() => {
    if (user?.role === 'employee') {
        const allowedIds = user.allowedInvestorIds || [];
        const hasMainAccess = allowedIds.includes('MAIN_ACCOUNT');
        const investorIds = allowedIds.filter(id => id !== 'MAIN_ACCOUNT');

        const safeFullAccessIds = (user.fullAccessInvestorIds || []).filter(id => allowedIds.includes(id));
        const hasFullMainAccess = safeFullAccessIds.includes('MAIN_ACCOUNT');
        const fullAccessInvestorIdSet = new Set(safeFullAccessIds.filter(id => id !== 'MAIN_ACCOUNT'));

        // 1. Инвесторы
        const filteredInvestors: Investor[] = investors.filter((inv: Investor) => investorIds.includes(inv.id));
        replaceIfIdsChanged(setInvestors, filteredInvestors);

        // 2. Счета
        const filteredAccounts: Account[] = accounts.filter((acc: Account) => {
            const isMainAccount = !acc.ownerId || acc.type === 'MAIN';
            if (isMainAccount && hasMainAccess) return true;
            if (acc.ownerId && investorIds.includes(acc.ownerId)) return true;
            return false;
        });
        replaceIfIdsChanged(setAccounts, filteredAccounts);

        const allowedAccountIds = new Set(filteredAccounts.map(acc => acc.id));
        const fullAccessAccountIds = new Set(
            filteredAccounts
                .filter(acc => {
                    const isMainAccount = !acc.ownerId || acc.type === 'MAIN';
                    if (isMainAccount && hasFullMainAccess) return true;
                    if (acc.ownerId && fullAccessInvestorIdSet.has(acc.ownerId)) return true;
                    return false;
                })
                .map(acc => acc.id)
        );
        const canSeeRecord = (record: { accountId?: string; createdByUserId?: string }) => {
            if (!record.accountId || !allowedAccountIds.has(record.accountId)) return false;
            if (fullAccessAccountIds.has(record.accountId)) return true;
            return record.createdByUserId === user.id;
        };

        // 3. Продажи и расходы
        const filteredSales: Sale[] = sales.filter(canSeeRecord);
        replaceIfIdsChanged(setSales, filteredSales);
        const filteredExpenses: Expense[] = expenses.filter(canSeeRecord);
        replaceIfIdsChanged(setExpenses, filteredExpenses);

        // 4. 🔥 КЛИЕНТЫ: те, кто есть в отфильтрованных продажах, + клиенты, которых сотрудник
        // сам добавил (иначе только что созданный клиент без договора «пропадает» из списка).
        const allowedCustomerIds = new Set(filteredSales.map((s: Sale) => s.customerId));
        const filteredCustomers: Customer[] = customers.filter((c: Customer) => allowedCustomerIds.has(c.id) || c.createdByUserId === user.id);
        replaceIfIdsChanged(setCustomers, filteredCustomers);
    }
}, [user, accounts, sales]);



















//для модалки сообщения
useEffect(() => {
  if (!user || isPublicMode) return;

  // Ключ меняется вместе с содержимым окна: те, кто видел прошлое обновление,
  // должны увидеть и новое, а не считаться уже показанными.
  const STORAGE_KEY = 'template_update_notice_last_shown_v28';
  const REPEAT_AFTER = 10 * 60 * 60 * 1000;

  const lastShown = localStorage.getItem(STORAGE_KEY);
  const now = Date.now();

  if (!lastShown || now - Number(lastShown) >= REPEAT_AFTER) {
    setShowTemplateUpdateModal(false);
    localStorage.setItem(STORAGE_KEY, String(now));
  }
}, [user, isPublicMode]);




















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
  if (!user) return;

  // Загружаем сразу
  loadSupportUnreadCount(user);

  // Проверяем каждые 30 секунд
  const interval = setInterval(() => {
    loadSupportUnreadCount(user);
  }, 30000);

  return () => clearInterval(interval);
}, [user]);

const loadData = async (currentUser?: User, skipLoadingState = true) => {
  // 🔥 Мы больше НЕ трогаем setIsLoading здесь, чтобы не мерцал экран
  try {
    const data = await api.fetchAllData();

    if (!data) {
      console.warn('⚠️ loadData: получены пустые данные, сохраняем текущее состояние');
      return;
    }

    // 🔹 Слияние вместо слепой перезаписи (та же mergeServerData, что и в handleSync и в
    // фоновом обновлении после логина): fetchAllData() при сетевой ошибке/таймауте (плохая
    // связь, VPN) подставляет устаревший кэш из IndexedDB — прямая перезапись стирала из UI
    // записи, которых не было в этом устаревшем снимке, даже если они целы на сервере
    // (например, договор пропадал после действия с инвестором на плохой связи).
    if (data.customers) setCustomers(prev => mergeServerData(prev, data.customers, 'customers'));
    if (data.products) setProducts(prev => mergeServerData(prev, data.products, 'products'));
    if (data.sales) setSales(prev => mergeServerData(prev, data.sales, 'sales'));
    if (data.expenses) setExpenses(prev => mergeServerData(prev, data.expenses, 'expenses'));
    if (data.accounts) setAccounts(prev => mergeServerData(prev, data.accounts, 'accounts'));
    if (data.investors) setInvestors(prev => mergeServerData(prev, data.investors, 'investors'));
    if (Array.isArray(data.lockedInvestorIds)) setLockedInvestorIds(data.lockedInvestorIds);
    if (Array.isArray(data.lockedAccountIds)) setLockedAccountIds(data.lockedAccountIds);
    if (data.partnerships) setPartnerships(prev => mergeServerData(prev, data.partnerships, 'partnerships'));
    if (data.suppliers) setSuppliers(prev => mergeServerData(prev, data.suppliers, 'suppliers'));
    if (data.tasks) setTasks(prev => mergeServerData(prev, data.tasks, 'tasks'));
    if (data.employees?.length > 0 || employees.length === 0) setEmployees(data.employees || []);

    let loadedSettings = data.settings || getAppSettings();
    const activeUser = currentUser || user;

    if (activeUser?.whatsapp_settings) {
      loadedSettings = { ...loadedSettings, whatsapp: activeUser.whatsapp_settings };
    }

    setAppSettings(loadedSettings);
    saveAppSettings(loadedSettings);
  } catch (error) {
    console.error("Failed to load data in background", error);
    // При ошибке просто молча оставляем те данные, что уже есть на экране
  }
};

  const isManager = user?.role === 'manager' || user?.role === 'admin';
  const isEmployee = user?.role === 'employee';
  const isInvestor = user?.role === 'investor';
  const activeInvestor = isInvestor && user ? investors.find(i => i.id === user.id) : null;


  const loadSupportUnreadCount = async (currentUser: User) => {
  if (!currentUser) return;

  try {
    // 🔹 У админа нет "своих" тикетов (он видит все чужие обращения) — считаем
    // непрочитанные сообщения от пользователей через админскую статистику, а не
    // через /support/tickets (тот эндпоинт про тикеты ТЕКУЩЕГО юзера и для админа
    // всегда возвращал 0 — счётчик на кнопке поддержки никогда не показывался).
    if (currentUser.role === 'admin') {
      const stats = await api.get<{ unread_messages: number }>('/admin/support/stats');
      setSupportUnreadCount(Number(stats.unread_messages) || 0);
      return;
    }

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
  const checkAccess = (feature: 'WRITE' | 'INVESTORS' | 'AI' | 'WHATSAPP' | 'EMPLOYEES' | 'SUPPLIERS' | 'INVESTOR_POOLS' | 'NOTIFICATIONS' | 'TASKS' | 'SHOP'): boolean => {
    if (!user) return false;
    if (isEmployee || isInvestor || user.role === 'admin') return true;

    const sub = user.subscription || { plan: 'TRIAL', expiresAt: new Date(0).toISOString() };
    const isExpired = new Date() > new Date(sub.expiresAt);
    if (isExpired && feature === 'WRITE') return false;

    // Оплаченный тариф действует только до даты окончания: дальше остаются возможности
    // START, пока подписку не продлят. Та же логика на сервере — getEffectivePlan
    // в server/index.js, иначе интерфейс показывал бы кнопки, которые API уже не пропускает.
    const plan = isExpired ? 'START' : sub.plan;
    switch(feature) {
        case 'WRITE': return !isExpired;
        case 'INVESTORS': return (plan === 'START' && investors.length < 1) || (plan === 'STANDARD' && investors.length < 5) || true;
        // 🔒 BUSINESS_PRO — надстройка над BUSINESS (см. server/index.js PLAN_LIMITS: у обоих
        // ai/whatsapp/employees одинаково включены), поэтому везде, где разрешён BUSINESS,
        // должен быть разрешён и BUSINESS_PRO — иначе BUSINESS_PRO ошибочно лишался этих функций.
        case 'AI': return plan === 'BUSINESS' || plan === 'BUSINESS_PRO' || plan === 'TRIAL';
        case 'WHATSAPP': return plan === 'STANDARD' || plan === 'BUSINESS' || plan === 'BUSINESS_PRO' || plan === 'TRIAL';
        // 🔥 ИСПРАВЛЕНО: TRIAL имеет лимит 0, поэтому разрешаем только STANDARD и BUSINESS(_PRO)
        case 'EMPLOYEES': return plan === 'BUSINESS' || plan === 'BUSINESS_PRO';
        case 'SUPPLIERS': return plan === 'BUSINESS_PRO';
        // Магазин: розничные продажи и склад. TRIAL включён намеренно — пробный
        // период показывает всё, и на сервере в PLAN_LIMITS у него тот же доступ.
        case 'SHOP': return plan === 'BUSINESS_PRO' || plan === 'TRIAL';
        case 'INVESTOR_POOLS': return plan === 'BUSINESS_PRO';
        // Задачи — тарифы Бизнес и Бизнес Pro (см. PLAN_LIMITS.tasks на сервере)
        case 'TASKS': return plan === 'BUSINESS' || plan === 'BUSINESS_PRO';
        case 'NOTIFICATIONS': return plan !== 'START';
        default: return true;
    }
};
  const showUpgradeAlert = (reason: string) => { if(window.confirm(`${reason} Оформите подписку для доступа.`)) { setCurrentView('TARIFFS'); } };

  // 🔔 Опрос счётчика непрочитанных уведомлений (тариф Стандарт+) — раз в 45 сек +
  // немедленное обновление при возврате в приложение (мобильные браузеры сильно тормозят
  // фоновые setInterval, когда вкладка свёрнута/экран заблокирован — без этого счётчик
  // выглядел "живым" только пока открыта сама панель уведомлений)
  useEffect(() => {
    if (!user || !checkAccess('NOTIFICATIONS')) {
      setUnreadNotifCount(0);
      return;
    }

    let cancelled = false;
    const loadUnread = async () => {
      try {
        await api.flushPendingNotificationReads();
        const count = await api.getUnreadNotificationCount();
        if (!cancelled) setUnreadNotifCount(count);
      } catch (error) {
        console.error('Failed to load unread notifications count:', error);
      }
    };

    loadUnread();
    const interval = setInterval(loadUnread, 45000);

    const onVisible = () => { if (document.visibilityState === 'visible') loadUnread(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', loadUnread);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', loadUnread);
    };
  }, [user, user?.subscription?.plan]);

  // ... (Stats calculations omitted for brevity as they are unchanged) ...
const dashboardStats = useMemo(() => {
  let totalRevenue = 0;
  let totalOutstanding = 0;
  let overdueCount = 0;
  let installmentSalesTotal = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  sales.forEach(sale => {
    totalRevenue += (sale.totalAmount - sale.remainingAmount);
    totalOutstanding += sale.remainingAmount;
    // ✅ ПРОВЕРКА: реальная сумма просрочки > 0
    const overdueAmount = calculateSaleOverdue(sale, today);
    if (overdueAmount > 0) overdueCount++;
    if (sale.type === 'INSTALLMENT') {
      installmentSalesTotal += sale.totalAmount;
    }
  });
  return { totalRevenue, totalOutstanding, overdueCount, installmentSalesTotal };
}, [sales]);  const accountBalances = useMemo(() => { const balances: Record<string, number> = {}; accounts.forEach(acc => { let total = acc.initialBalance || 0; const accountSales = sales.filter(s => s.accountId === acc.id); accountSales.forEach(s => { total += s.downPayment; s.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false).forEach(p => total += p.amount); }); const accountExpenses = expenses.filter(e => e.accountId === acc.id && e.isRefund !== true);  total -= accountExpenses.reduce((sum, e) => sum + e.amount, 0); balances[acc.id] = total; }); return balances; }, [accounts, sales, expenses]);
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
        const managerProfitShare = getManagerSharePercent(account, investors, shareDateForSale(sale)) / 100;

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

        // Collect all REAL money movements
        const allPayments = [
            { date: sale.startDate, amount: sale.downPayment, id: `${sale.id}_dp`, isRealPayment: true },
            ...sale.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false) // Exclude plan items
        ];

        allPayments.forEach(p => {
            const paymentDate = new Date(p.date);
            if (paymentDate >= startDate && paymentDate <= endDate && p.amount > 0) {
                // 🔒 Доля считается на дату ОФОРМЛЕНИЯ договора: прибыль по мурабахе
                // фиксируется при заключении сделки, поэтому принадлежит тем, чей капитал
                // её профинансировал (см. shareDateForSale в src/utils.ts).
                const managerProfitShare = getManagerSharePercent(account, investors, shareDateForSale(sale)) / 100;
                const profitFromPayment = p.amount * profitMargin;
                periodProfit += profitFromPayment * managerProfitShare;
            }
        });
    });
    return periodProfit;
  }, [sales, accounts, investors, myProfitPeriod, isManager]);
  const reportData = useMemo(() => {
    if (!isManager) return null;
    const { accountId, period } = reportFilters;
    const startDate = new Date(period.start);
    const endDate = new Date(period.end);
    endDate.setHours(23, 59, 59, 999);

    const filteredSales = accountId === 'ALL'
        ? sales
        : sales.filter(s => s.accountId === accountId);

    let customerPaymentsInPeriod = 0;
    filteredSales.forEach(sale => {
        const allPayments = [
            { date: sale.startDate, amount: sale.downPayment },
            ...sale.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false)
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
    filteredSales
        .filter(s => (s.status === 'ACTIVE' || s.status === 'COMPLETED') && s.buyPrice > 0)
        .forEach(sale => {
            const saleProfit = sale.totalAmount - sale.buyPrice;
            if (saleProfit <= 0) return;
            const account = accounts.find(a => a.id === sale.accountId);
            const shares = getAccountShares(account, investors, shareDateForSale(sale));
            const totalInvestorShare = shares.reduce((sum, m) => sum + saleProfit * (m.percentage / 100), 0);
            expectedInvestorProfit += totalInvestorShare;
            expectedManagerProfit += saleProfit - totalInvestorShare;
        });

    let realizedManagerProfit = 0;
    let realizedInvestorProfit = 0;
    filteredSales.forEach(sale => {
        if (sale.buyPrice <= 0 || sale.totalAmount <= sale.buyPrice) return;
        const profitMargin = (sale.totalAmount - sale.buyPrice) / sale.totalAmount;
        const account = accounts.find(a => a.id === sale.accountId);
        const paymentsInPeriod = [
            { date: sale.startDate, amount: sale.downPayment },
            ...sale.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false)
        ].filter(p => { const d = new Date(p.date); return d >= startDate && d <= endDate; });

        paymentsInPeriod.forEach(p => {
            const profitFromPayment = p.amount * profitMargin;
            const managerPct = getManagerSharePercent(account, investors, shareDateForSale(sale)) / 100;
            realizedManagerProfit += profitFromPayment * managerPct;
            realizedInvestorProfit += profitFromPayment * (1 - managerPct);
        });
    });

    // 🔻 Расходы, списанные из прибыли, уменьшают её у обеих сторон.
    // Общий расход с флагом fromProfit делится по долям счёта, а «Моя выплата»
    // с пометкой «Из Прибыли» уменьшает только долю менеджера.
    expenses
      .filter(e => { const d = new Date(e.date); return d >= startDate && d <= endDate; })
      .forEach(e => {
        const account = accounts.find(a => a.id === e.accountId);
        if (accountId !== 'ALL' && e.accountId !== accountId) return;
        realizedManagerProfit -= getManagerProfitDeduction(e, account, investors);
        if (e.fromProfit) {
          const investorPct = 100 - getManagerSharePercent(account, investors, e.date);
          realizedInvestorProfit -= e.amount * investorPct / 100;
        }
      });

    // 💰 Премия сотрудников уменьшает прибыль. Кого именно — зависит от настройки:
    //  MANAGER — расход менеджера, целиком с его доли, инвесторы не затрагиваются;
    //  SHARED  — расход общего дела: считается от всей прибыли и ложится на всех
    //            по их долям, то есть инвесторы тоже несут свою часть.
    // Учитываем только тех, у кого включено «сразу уменьшать прибыль» — у остальных
    // она изменится лишь в момент фактической выплаты зарплаты (обычным расходом).
    employees
      .filter(emp => Number(emp.profitPercentage) > 0 && emp.profitReducesManager !== false)
      .forEach(emp => {
        const scopedSales = accountId === 'ALL' ? sales : sales.filter(s => s.accountId === accountId);
        const range = { start: startDate, end: endDate };
        const total = getEmployeeProfitAccrued(emp, scopedSales, accounts, investors, range);
        if (emp.profitSource === 'SHARED') {
          // Доля менеджера в этом расходе — это та же премия, посчитанная «из доли
          // менеджера»: Σ(прибыль × доля_менеджера × процент). Остальное несут инвесторы.
          const managerPart = getEmployeeProfitAccrued(
            { ...emp, profitSource: 'MANAGER' }, scopedSales, accounts, investors, range
          );
          realizedManagerProfit -= managerPart;
          realizedInvestorProfit -= (total - managerPart);
        } else {
          realizedManagerProfit -= total;
        }
      });

    return { customerPaymentsInPeriod, expectedManagerProfit, expectedInvestorProfit, realizedManagerProfit, realizedInvestorProfit };
  }, [reportFilters, sales, accounts, investors, expenses, employees, isManager]);

  const handleAuthSuccess = async (loggedInUser: User) => {
      setUser(loggedInUser);
      await loadData(loggedInUser);
  };

  // Второй аргумент — счёт, в контексте которого нажали. Его передаёт блок
  // баланса на Главной: форма должна открыться уже с выбранным счётом, иначе
  // кнопка просто дублирует меню «+».
  const handleAction = (action: string, ctx?: { accountId?: string | null }) => {
      switch (action) {
        case 'VIEW_OVERDUE':  // ← НОВОЕ: переход на просроченные договоры
            setActiveContractTab('OVERDUE');
            setCurrentView('CONTRACTS');
            break;
          case 'CREATE_SALE': setDraftSaleData({}); setEditingSale(null); setCurrentView('CREATE_SALE'); break;
          case 'INCOME': setDraftSaleData(ctx?.accountId ? { accountId: ctx.accountId } : {}); setCurrentView('CREATE_INCOME'); break;
          case 'EXPENSE': setDraftExpenseData(ctx?.accountId ? { accountId: ctx.accountId } : null); setCurrentView('CREATE_EXPENSE'); break;
          case 'OPERATIONS': setOperationsAccountId(ctx?.accountId ?? null); setCurrentView('OPERATIONS'); break;
          case 'CALCULATOR': setCurrentView('CALCULATOR'); break;
          case 'PARTNER': setPreviousView(currentView); setCurrentView('PARTNER'); break;
          case 'MANAGE_PRODUCTS': setCurrentView('MANAGE_PRODUCTS'); break;
          case 'TASKS': setPreviousView(currentView); setCurrentView('TASKS'); break;
          case 'ADD_CUSTOMER': setCurrentView('CUSTOMERS'); break;
          case 'ADD_PRODUCT': setCurrentView('MANAGE_PRODUCTS'); break;
          // Из плашки об истекающей подписке на главной
          case 'TARIFFS': setPreviousView(currentView); setCurrentView('TARIFFS'); break;
      }
  };

const updateList = <T extends { id: string }>(
  setter: React.Dispatch<React.SetStateAction<T[]>>,
  item: T,
  oldId?: string,           // ← Старый ID, если он менялся (для замены)
  storageKey?: string       // ← Ключ localStorage для отладки (опционально)
) => {
  // 🔒 Отмечаем момент локальной записи — mergeServerData на RECENT_WRITE_GUARD_MS доверяет
  // этой версии больше, чем тому, что вернёт следующий handleSync (см. комментарий там же).
  if (item?.id) recentLocalWritesRef.current.set(item.id, Date.now());

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
const removeFromList = <T extends { id: string }>(setter: React.Dispatch<React.SetStateAction<T[]>>, id: string) => {
  // 🔒 Та же защита, что и в updateList — иначе фоновая синхронизация, стартовавшая ДО
  // удаления, могла бы "воскресить" только что удалённую запись (см. mergeServerData).
  recentLocalWritesRef.current.set(id, Date.now());
  setter(prev => prev.filter(i => i.id !== id));
};

// 🔹 Фильтрация данных для сотрудника по разрешённым инвесторам
const filterDataForEmployeeClient = (data: any, allowedIds: string[]) => {
    // Если массив пустой, сотрудник не видит ничего (кроме своих настроек)
    if (!allowedIds || allowedIds.length === 0) {
        return { ...data, investors: [], accounts: [], sales: [], expenses: [] };
    }

    const hasMainAccess = allowedIds.includes('MAIN_ACCOUNT');
    const investorIds = allowedIds.filter((id: string) => id !== 'MAIN_ACCOUNT');

    // 1. Инвесторы
    const filteredInvestors = (data.investors || []).filter((inv: Investor) => investorIds.includes(inv.id));

    // 2. Счета: разрешенные инвесторы ИЛИ основной счет
    const filteredAccounts = (data.accounts || []).filter((acc: Account) => {
        const isMainAccount = !acc.ownerId || acc.type === 'MAIN';
        if (isMainAccount && hasMainAccess) return true; // Разрешаем основной счет
        if (acc.ownerId && investorIds.includes(acc.ownerId)) return true; // Разрешаем счет инвестора
        return false;
    });

    const allowedAccountIds = new Set(filteredAccounts.map((acc: Account) => acc.id));

    // 3. Продажи и расходы только по разрешенным счетам
    const filteredSales = (data.sales || []).filter((s: Sale) => s.accountId && allowedAccountIds.has(s.accountId));
    const filteredExpenses = (data.expenses || []).filter((e: Expense) => e.accountId && allowedAccountIds.has(e.accountId));

    return {
        ...data,
        investors: filteredInvestors,
        accounts: filteredAccounts,
        sales: filteredSales,
        expenses: filteredExpenses
    };
};

// ✅ ОБНОВЛЁННЫЙ handleSaveSale — проверка лимита + правильная обработка ошибок
const handleSaveSale = async (data: any): Promise<any> => {
  if (!user) return;

  // Без активной подписки запись закрыта — тот же запрет стоит на сервере.
  // Проверяем и здесь, чтобы человек увидел понятное объяснение, а не ошибку API.
  if (!checkAccess('WRITE')) {
    showUpgradeAlert("Срок подписки истек.");
    return;
  }

  // 🔒 Собирается внутри try — храним ссылку здесь, чтобы offline-фолбэк в catch
  // мог переиспользовать уже готовую запись (правильный id, график платежей, статус),
  // а не собирать параллельную с другим id, рассинхронизированную с очередью в api.saveItem.
  let saleToSave: any = null;

  try {
    // 🔹 1. ПРОВЕРКА ЛИМИТА ПЕРЕД СОХРАНЕНИЕМ
    const limitCheck = await api.checkLocalContractLimit(sales);
    if (!limitCheck.allowed) {
      const limitError: any = new Error('LIMIT_EXCEEDED');
      limitError.isLimitError = true;
      limitError.message = limitCheck.reason;
      limitError.hint = 'Удалите старые договоры или оформите подписку выше.';
      limitError.details = limitCheck;
      throw limitError;
    }

    // 🔹 2. Подготовка данных
    const ownerId = isEmployee && user.managerId ? user.managerId : user.id;
    const saleId = data.id || Date.now().toString();

    const paymentScheduleStartDate = data.paymentDate
      ? new Date(data.paymentDate)
      : new Date(data.startDate);
    if (!data.paymentDate) {
      // addMonthsClamped, а не setMonth: на 29-31 числе обычное прибавление
      // «переливается» в следующий месяц (31 января + 1 мес = 3 марта).
      paymentScheduleStartDate.setTime(addMonthsClamped(paymentScheduleStartDate, 1).getTime());
    }
    const preferredDay = paymentScheduleStartDate.getDate();

    const saleData = {
      ...data,
      id: saleId,
      userId: ownerId,
      createdByUserId: data.createdByUserId || user.id, // Сохраняем создателя при редактировании, ставим текущего при создании
      supplierId: data.supplierId || undefined,
      partnerDebtPaidAmount: data.partnerDebtPaidAmount || 0,
      isPartnerDebtPaid: !!data.isPartnerDebtPaid,
      paymentDay: preferredDay,
      paymentPlan: data.type === 'CASH'
        ? []
        : (data.paymentPlan || Array.from({ length: data.installments }).map((_, idx) => {
            // 🔒 Ключевое место: тут строится весь график. С обычным setMonth договор
            // с платежом 31-го числа терял февральский платёж — он «переливался»
            // в март, а весь дальнейший ряд съезжал на месяц.
            const pDate = addMonthsClamped(paymentScheduleStartDate, idx);
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
    saleToSave = existingSaleIndex >= 0
      ? { ...sales[existingSaleIndex], ...saleData }
      : { ...saleData, status: data.type === 'CASH' ? 'COMPLETED' : 'ACTIVE' };

    // 🔒 Гарантируем, что график платежей полностью покрывает сумму договора и remainingAmount
    // ей соответствует — даже если форма (или офлайн-сохранение) сгенерировали неполный график.
    if (saleToSave.type === 'INSTALLMENT') {
      saleToSave = reconcileSalePaymentPlan(saleToSave);
    }

    // 🔹 3. Сохранение на сервер (или в очередь офлайн)
    const savedSale = await api.saveItem('sales', saleToSave);
    
    // 🔑 🔑 🔑 КЛЮЧЕВОЕ: проверяем флаг _isOffline
    const isOfflineMode = savedSale._isOffline === true;

    // 🔹 4. Обновление стейта (работает и онлайн, и офлайн)
    updateList(setSales, savedSale);

    // 🔹 🔑 🔑 5. СОЗДАЁМ / СИНХРОНИЗИРУЕМ РАСХОД ЗАКУПА — ОБЯЗАТЕЛЬНО И ОНЛАЙН, И ОФЛАЙН!
    // При редактировании закупочная цена могла измениться — держим связанный расход в актуальном состоянии,
    // иначе учёт себестоимости/прибыли разойдётся с фактическими данными договора.
    {
      const buyPriceExpenseId = `exp_sale_${saleId}`;
      const linkedExpense = expenses.find(e => e.id === buyPriceExpenseId);
      const newBuyPrice = Number(data.buyPrice);

      try {
        if (data.supplierId) {
          // 🔒 Выбран поставщик — деньги за закуп НЕ списываем со счёта, заводится долг (Sale.supplierId/partnerDebtPaidAmount).
          // Если ранее (до выбора поставщика) уже был обычный расход закупа — убираем его, чтобы не задвоить списание.
          if (linkedExpense) {
            await api.deleteItem('expenses', buyPriceExpenseId);
            setExpenses(prev => prev.filter(e => e.id !== buyPriceExpenseId));
          }
        } else if (newBuyPrice > 0) {
          if (
            !linkedExpense ||
            linkedExpense.amount !== newBuyPrice ||
            linkedExpense.title !== `Закуп: ${data.productName}` ||
            linkedExpense.accountId !== data.accountId
          ) {
            const buyPriceExpense: Expense = {
              ...linkedExpense,
              id: buyPriceExpenseId,
              userId: ownerId,
              // Без автора расход невидим сотруднику без полного доступа к счёту
              // (filterDataForEmployee оставляет только свои записи) — и тогда при
              // удалении договора его нечем было найти, списание закупа оставалось висеть.
              createdByUserId: linkedExpense?.createdByUserId || user.id,
              accountId: data.accountId,
              title: `Закуп: ${data.productName}`,
              amount: newBuyPrice,
              category: 'Себестоимость',
              date: linkedExpense?.date || data.startDate,
              isRefund: false
            };
            const savedExpense = await api.saveItem('expenses', buyPriceExpense);
            updateList(setExpenses, savedExpense);
          }
        } else if (linkedExpense) {
          // Закуп обнулили при редактировании — убираем связанный расход
          await api.deleteItem('expenses', buyPriceExpenseId);
          setExpenses(prev => prev.filter(e => e.id !== buyPriceExpenseId));
        }
      } catch (e: any) {
        console.warn('⚠️ Расход закупа не синхронизирован (будет учтён при синхронизации):', e.message);
        // 🔹 НЕ прерываем выполнение — договор уже сохранён
      }
    }

    // 🔹 🔑 🔑 6. ОБНОВЛЯЕМ ОСТАТКИ ТОВАРА — ОБЯЗАТЕЛЬНО И ОНЛАЙН, И ОФЛАЙН!
    if (existingSaleIndex < 0 && data.productId) {
      try {
        const prod = products.find(p => p.id === data.productId);
        if (prod) {
          const updatedProd = { ...prod, stock: prod.stock - 1 };
          const savedProd = await api.saveItem('products', updatedProd);
          updateList(setProducts, savedProd);
         
        }
      } catch (e: any) {
        console.warn('⚠️ Остаток товара не обновлён:', e.message);
        // 🔹 НЕ прерываем выполнение
      }
    }

    // 🔹 7. Показываем уведомление ТОЛЬКО если офлайн
    if (isOfflineMode) {
      showNotificationModal(
        '⚠️ Офлайн-режим',
        'Нет соединения с сервером.\n\nДоговор сохранен локально и будут синхронизирован при подключении.',
        'warning'
      );
    }

    // 🔹 8. Возвращаем результат
    setEditingSale(null);
    return savedSale;

  } catch (error: any) {
    console.error('❌ Save sale error:', error);

    // 🔹 Обработка ошибки лимита
    if (error.isLimitError === true) {
      showNotificationModal(
        '🚫 Лимит превышен',
        `${error.message}\n\n${error.hint || ''}`.trim(),
        'error',
        'Перейти к тарифам',
        () => setCurrentView('TARIFFS')
      );
      throw error;
    }

    // 🔹 Обработка сетевых ошибок (фолбэк, если saveItem не успел обработать)
    const isNetworkError = 
      error.message?.includes('Failed to fetch') ||
      error.message?.includes('TIMEOUT') ||
      error.name === 'AbortError' ||
      !navigator.onLine;

    if (isNetworkError) {
      const offlineLimitCheck = await api.checkLocalContractLimit(sales);
      if (!offlineLimitCheck.allowed) {
        showNotificationModal(
          '🚫 Лимит превышен',
          `${offlineLimitCheck.reason}\n\n💡 В офлайн-режиме тоже действует лимит!`,
          'error'
        );
        return;
      }

      showNotificationModal(
        '⚠️ Офлайн-режим',
        'Нет соединения с сервером.\n\nДоговор сохранён локально и будет синхронизирован при подключении.',
        'warning'
      );

      // 🔒 Переиспользуем уже собранную saleToSave (тот же id, график платежей, статус) —
      // именно этот id уже мог быть положен в офлайн-очередь внутри api.saveItem
      // (сетевая ошибка или истёкшая сессия), поэтому здесь нельзя фабриковать новый id,
      // иначе локальное состояние и очередь синхронизации разъедутся, а запись потеряется.
      const tempSale = saleToSave
        ? { ...saleToSave, _isOffline: true }
        : { ...data, id: `temp_${Date.now()}`, _isOffline: true };
      updateList(setSales, tempSale);

      // 🔹 🔑 СОЗДАЁМ РАСХОД ЗАКУПА ЛОКАЛЬНО (только если поставщик не выбран — иначе это долг, а не списание)
      if (!data.supplierId && Number(data.buyPrice) > 0) {
        const buyPriceExpense: Expense = {
          id: `exp_sale_${tempSale.id}`,
          userId: isEmployee && user.managerId ? user.managerId : user.id,
          createdByUserId: user.id,
          accountId: data.accountId,
          title: `Закуп: ${data.productName}`,
          amount: Number(data.buyPrice),
          category: 'Себестоимость',
          date: data.startDate,
          isRefund: false
        };
        updateList(setExpenses, buyPriceExpense);
        
      }
      
      // 🔹 🔑 ОБНОВЛЯЕМ ОСТАТОК ТОВАРА ЛОКАЛЬНО (только для новых договоров)
      const isOfflineEdit = data.id && sales.some((s: any) => s.id === data.id);
      if (!isOfflineEdit && data.productId) {
        const prod = products.find((p: any) => p.id === data.productId);
        if (prod) {
          const updatedProd = { ...prod, stock: prod.stock - 1 };
          updateList(setProducts, updatedProd);
        }
      }
      
      setEditingSale(null);
      return tempSale;
    }

    // 🔹 Другие ошибки сервера
    showNotificationModal(
      '❌ Ошибка сохранения',
      error.message || 'Не удалось сохранить договор. Попробуйте ещё раз.',
      'error'
    );
    throw error;
  }
};
const handleStartEditSale = (sale: Sale) => { 
  if (isEmployee && !user?.permissions?.canEdit) {
        alert("⛔ У вас нет прав на редактирование договоров.");
        return;
    }
  setEditingSale(sale); setCurrentView('CREATE_SALE'); };



// Причины отказа бросаем наружу: их показывает та же модалка, в которой пользователь
// подтвердил удаление. Своего window.confirm здесь нет — модалка уже спросила,
// второй системный вопрос поверх неё выглядел дублем.
const handleDeleteSale = async (saleId: string) => {
  if (isEmployee && !user?.permissions?.canDelete) {
    throw new Error('У вас нет прав на удаление договоров.');
  }

  const sale = sales.find(s => s.id === saleId);
  if (!sale) {
    throw new Error('Договор не найден.');
  }

  const installmentPayments = sale.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false);
  const installmentAmount = installmentPayments.reduce((sum, p) => sum + Number(p.amount), 0);

  if (installmentAmount > 0) {
    throw new Error(`Нельзя удалить договор с платежами по графику. Оплачено: ${formatCurrency(installmentAmount, appSettings?.showCents)} ₽`);
  }

  if (sale.supplierId && !sale.isPartnerDebtPaid && (sale.partnerDebtPaidAmount || 0) > 0) {
    throw new Error(`Нельзя удалить договор с частично оплаченным долгом поставщику. Оплачено: ${formatCurrency(sale.partnerDebtPaidAmount || 0, appSettings?.showCents)} ₽`);
  }

  // 🔹 🔑 ОПТИМИСТИЧНОЕ УДАЛЕНИЕ: сначала удаляем из UI
  removeFromList(setSales, saleId);

  try {
    // 🔹 1. ВОЗВРАТ ПЕРВОГО ВЗНОСА (изолированно)
    try {
      if (sale.downPayment > 0 && sale.accountId) {
        const refundExpense: Expense = {
          id: `refund_${saleId}_${Date.now()}`,
          userId: sale.userId,
          accountId: sale.accountId,
          title: `Возврат: ${sale.productName}`,
          amount: sale.downPayment,
          category: 'Возврат клиенту',
          date: new Date().toISOString(),
          isRefund: true
        };
        await api.saveItem('expenses', refundExpense);
        updateList(setExpenses, refundExpense);
      }
    } catch (e) {
      console.warn('⚠️ Refund expense save failed:', e);
    }

    // 🔹 2. УДАЛЕНИЕ РАСХОДА ЗАКУПА (изолированно)
    try {
      if (sale.buyPrice > 0 && sale.accountId && !sale.supplierId) {
        // Сначала ищем по точному ID (все текущие договоры используют этот формат)
        let buyExpense = expenses.find(e => e.id === `exp_sale_${saleId}`);
        // Запасной вариант для старых договоров с другим форматом ID
        if (!buyExpense) {
          buyExpense = expenses.find(e =>
            e.accountId === sale.accountId &&
            e.category === 'Себестоимость' &&
            e.title === `Закуп: ${sale.productName}` &&
            Math.abs(e.amount - sale.buyPrice) < 0.01
          );
        }
        if (buyExpense) {
          const result = await api.deleteItem('expenses', buyExpense.id);
          removeFromList(setExpenses, buyExpense.id);
          if (result.isOffline) {
            console.log('📦 Расход закупа удалён локально');
          }
        } else {
          // Расхода нет в локальном списке — это нормально для сотрудника: без полного
          // доступа к счёту он не видит чужие записи, а у договоров, созданных до
          // появления createdByUserId, автор не проставлен вовсе. Id детерминированный,
          // поэтому удаляем вслепую: если записи нет, сервер просто ничего не тронет.
          await api.deleteItem('expenses', `exp_sale_${saleId}`);
          removeFromList(setExpenses, `exp_sale_${saleId}`);
        }
      }
    } catch (e) {
      console.warn('⚠️ Buy expense delete failed:', e);
    }

    // 🔹 3. УДАЛЕНИЕ САМОГО ДОГОВОРА (изолированно)
    try {
      const result = await api.deleteItem('sales', saleId);
      if (result.isOffline) {
        showNotificationModal(
          '⚠️ Офлайн-режим',
          'Договор удалён локально и будет синхронизирован при подключении.',
          'warning'
        );
      }
      // Успех показывает модалка удаления — своей анимацией, без системного alert
    } catch (e) {
      console.warn('⚠️ Sale delete failed:', e);
    }

    // 🔹 4. ВОЗВРАТ ТОВАРА НА СКЛАД (изолированно)
    try {
      if (sale.productId) {
        const prod = products.find(p => p.id === sale.productId);
        if (prod) {
          const updatedProd = { ...prod, stock: (prod.stock || 0) + 1, updatedAt: new Date().toISOString() };
          const savedProd = await api.saveItem('products', updatedProd);
          updateList(setProducts, savedProd);
        }
      }
    } catch (e) {
      console.warn('⚠️ Product stock restore failed:', e);
    }
  } catch (error) {
    console.error('❌ Ошибка удаления договора:', error);
    // 🔹 НЕ откатываем удаление из UI — оно уже произошло
  }
};
const handleViewSaleSchedule = (sale: Sale) => { setSelectedCustomerId(sale.customerId); setInitialSaleIdForDetails(sale.id); setPreviousView('CONTRACTS'); setCurrentView('CUSTOMER_DETAILS'); };
const handleIncomeSubmit = async (data: any) => {
    if (!user) return;

    if (data.type === 'CUSTOMER_PAYMENT') {
        // 🆕 Извлекаем данные о скидке
        const { saleId, amount, discountAmount = 0, discountPercent = 0 } = data;
        const sale = sales.find(s => s.id === saleId);

        if (sale) {
            const updatedSale = { ...sale, paymentPlan: [...sale.paymentPlan] };

            // 🆕 ЛОГИКА СО СКИДКОЙ: полное погашение с дисконтом
            if (discountAmount > 0) {
                updatedSale.paymentPlan.push({
                    id: `paid_${Date.now()}`,
                    saleId: sale.id,
                    amount: amount, // Фактически полученная сумма (с учётом скидки)
                    date: data.date,
                    actualDate: data.actualDate,
                    isPaid: true,
                    isRealPayment: true,
                    recordedByUserId: user.id,
                    // 🆕 Метаданные скидки — для истории и отчётов
                    discountAmount: discountAmount,
                    discountPercent: discountPercent,
                    note: `Полное погашение со скидкой ${discountPercent.toFixed(1)}% (−${discountAmount} ₽)`
                } as any);
            }
            // 🟢 ОБЫЧНАЯ ЛОГИКА: стандартное погашение без скидки
            else {
                updatedSale.paymentPlan.push({
                    id: `paid_${Date.now()}`,
                    saleId: sale.id,
                    amount: amount,
                    date: data.date,
                    actualDate: data.actualDate,
                    isPaid: true,
                    isRealPayment: true,
                    recordedByUserId: user.id
                });
            }

            // 🔒 remainingAmount и isPaid плановых слотов пересчитываются здесь же, единым
            // способом (reconcileSalePaymentPlan) — раньше remainingAmount выставлялся вручную
            // отдельно от факта в paymentPlan, и эти два числа могли разойтись.
            const reconciledSale = reconcileSalePaymentPlan(updatedSale);
            const finalSale = { ...reconciledSale, status: reconciledSale.remainingAmount <= 0 ? 'COMPLETED' as const : updatedSale.status };

             updateList(setSales, finalSale);

            // ✅ МГНОВЕННЫЙ ПЕРЕХОД к деталям договора
            setSelectedCustomerId(sale.customerId);
            setInitialSaleIdForDetails(saleId);
            setPreviousView(currentView);
            setCurrentView('CUSTOMER_DETAILS');

            // 🔹 Сохраняем на сервер (или в офлайн-очередь — api.saveItem сам это делает
            // и не бросает ошибку в этом случае). Синхронизируем стейт с ответом сервера,
            // а если сохранение реально упало — откатываем локальное изменение и сообщаем
            // пользователю, чтобы платёж не "терялся" молча.
            try {
                const savedSale = await api.saveItem('sales', finalSale);
                updateList(setSales, savedSale);
            } catch (err: any) {
                // 🔒 При TOKEN_EXPIRED api.saveItem УЖЕ положил платёж в офлайн-очередь
                // (services/api.ts) и лишь после этого пробрасывает ошибку — платёж не
                // потерян и досинхронизируется после повторного входа. Раньше это тоже
                // считалось провалом: локальное изменение откатывалось, а пользователь
                // видел "не удалось сохранить" про платёж, который на самом деле сохранён.
                if (err?.message === 'TOKEN_EXPIRED') {
                    console.warn('⚠️ Сессия истекла во время сохранения платежа — платёж в офлайн-очереди, будет применён после входа');
                    return;
                }
                console.error('❌ Ошибка сохранения платежа:', err);
                updateList(setSales, sale);
                alert(`❌ Не удалось сохранить платёж. Попробуйте ещё раз.\n${err?.message || ''}`);
            }

            return;
        }
    } else {
        // Остальной код для инвестора и прочего (без изменений)
        const ownerId = isEmployee && user.managerId ? user.managerId : user.id;
        const newTransaction: Sale = {
            id: `inc_${Date.now()}`,
            userId: ownerId,
            createdByUserId: user.id,
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
        updateList(setSales, newTransaction);
        setCurrentView('OPERATIONS');
        
        api.saveItem('sales', newTransaction).catch(err => {
            console.error('❌ Ошибка сохранения транзакции:', err);
        });

        if (data.type === 'INVESTOR_DEPOSIT') {
            const inv = investors.find(i => i.id === data.investorId);
            if (inv) {
                const updatedInv = { ...inv, initialAmount: (inv.initialAmount || 0) + Number(data.amount) };
                updateList(setInvestors, updatedInv);
                api.saveItem('investors', updatedInv).catch(err => {
                    console.error('❌ Ошибка обновления инвестора:', err);
                });
            }
        }
    }
};  const handleExpenseSubmit = async (data: any) => { if (!user) return; const ownerId = isEmployee && user.managerId ? user.managerId : user.id; const newExpense: Expense = { id: crypto.randomUUID(), userId: ownerId, createdByUserId: user.id, accountId: data.accountId, title: data.title, amount: data.amount, category: data.category, date: data.date, payoutType: data.payoutType, managerPayoutSource: data.managerPayoutSource, fromProfit: data.fromProfit, investorId: data.investorId, supplierId: data.supplierId, saleId: data.saleId }; const savedExpense = await api.saveItem('expenses', newExpense); updateList(setExpenses, savedExpense); if(data.payoutType === 'INVESTMENT' && data.investorId) { const inv = investors.find(i => i.id === data.investorId); if (inv) { const updatedInv = applyInvestmentDelta(inv, -Number(data.amount), data.date); const savedInv = await api.saveItem('investors', updatedInv); updateList(setInvestors, savedInv); } } if (data.category === 'Оплата партнёру' && data.saleId) { const sale = sales.find(s => s.id === data.saleId); if (sale) { const newPaid = (sale.partnerDebtPaidAmount || 0) + Number(data.amount); const updatedSale = { ...sale, partnerDebtPaidAmount: newPaid, isPartnerDebtPaid: newPaid >= sale.buyPrice }; const savedSale = await api.saveItem('sales', updatedSale); updateList(setSales, savedSale); } } setDraftExpenseData(null); setCurrentView('OPERATIONS'); };
 const handleAddEmployee = async (data: any) => {
  if (!user || !isManager) return;

  // 1️⃣ Проверка доступа (теперь работает только для BUSINESS)
  if (!checkAccess('EMPLOYEES')) {
    showUpgradeAlert("Сотрудники доступны только в тарифе Бизнес.");
    return;
  }

  try {
    // 2️⃣ Отправка на сервер
    const newEmp = await api.createSubUser({ ...data, role: 'employee' });

    // 3️⃣ Безопасное добавление в стейт
    if (newEmp && newEmp.id) {
      setEmployees(prev => [...prev, newEmp]);
      showNotificationModal(
        '✅ Сотрудник создан', 
        `${newEmp.name} успешно добавлен в систему.`, 
        'success'
      );
    } else {
      throw new Error('Некорректный ответ сервера');
    }

  } catch (e: any) {
    console.error("❌ Ошибка создания сотрудника:", e);

    // 4️⃣ Умная обработка ошибок (как во всём приложении)
    if (e.message?.includes('Email уже занят') || e.message?.includes('already exists')) {
      showNotificationModal('⚠️ Email уже занят', 'Пользователь с таким email уже существует.', 'warning');
    } 
    else if (e.message?.includes('лимит') || e.message?.includes('Превышен')) {
      showNotificationModal(
        '🚫 Лимит сотрудников превышен', 
        e.message, 
        'error', 
        'Перейти к тарифам',
        () => setCurrentView('TARIFFS')
      );
    } 
    else {
      showNotificationModal(
        '❌ Ошибка', 
        e.message || 'Не удалось создать сотрудника. Проверьте подключение.', 
        'error'
      );
    }
  }
};
  const handleUpdateEmployee = async (updatedData: User) => { if (isManager) { await api.updateUser(updatedData); updateList(setEmployees, updatedData); } };
  const handleDeleteEmployee = async (id: string) => { if (isManager) { await api.deleteUser(id); removeFromList(setEmployees, id); } };
const handleAddInvestor = async (
  name: string,
  phone: string,
  email: string,
  pass: string,
  amount: number,
  profitPercentage: number,
  permissions: InvestorPermissions,
  poolChoice?: { mode: 'EXISTING'; accountId: string } | { mode: 'NEW'; name: string },
  joinedDate?: string,
  leftPoolDate?: string
) => {
  if (!user || !isManager) return;

  if (!checkAccess('INVESTORS')) {
    showUpgradeAlert("Превышен лимит инвесторов для вашего тарифа.");
    return;
  }

  if (poolChoice && !checkAccess('INVESTOR_POOLS')) {
    showUpgradeAlert("Общий инвестиционный пул доступен только на тарифе Бизнес Pro.");
    return;
  }

  try {
    const hasLogin = !!(email && email.trim() && pass && pass.trim());

    // 1. Создаём пользователя ТОЛЬКО если заданы email и пароль — иначе это "пассивный"
    // инвестор без доступа в приложение (просто учёт доли в прибыли). Его id остаётся
    // с префиксом inv_ (не u_inv_) — тем самым уже существующая логика "активации" в
    // handleUpdateInvestor сама заведёт ему логин позже, если email/пароль укажут при редактировании.
    const investorId = hasLogin
      ? (await api.createSubUser({ name, email, password: pass, role: 'investor', phone, permissions })).id
      : `inv_${Date.now()}`;

    // 2. Создаём запись инвестора
    const newInvestor: Investor = {
      id: investorId,
      userId: user.id,
      name,
      phone,
      email,
      initialAmount: amount,
      joinedDate: joinedDate || new Date().toISOString(),
      leftPoolDate: leftPoolDate || undefined,
      profitPercentage,
      permissions
    };

    const savedInv = await api.saveItem('investors', newInvestor);
    updateList(setInvestors, savedInv);

    // 3. Счёт инвестора — свой отдельный (по умолчанию) или общий пул (BUSINESS_PRO)
    let targetAccount: Account;
    if (poolChoice?.mode === 'NEW') {
      targetAccount = {
        id: `pool_${Date.now()}`,
        userId: user.id,
        name: poolChoice.name,
        type: 'POOL',
        poolMemberIds: [investorId],
        currency: 'RUB',
        isArchived: false
      };
    } else if (poolChoice?.mode === 'EXISTING') {
      const existingPool = accounts.find(a => a.id === poolChoice.accountId);
      targetAccount = {
        ...(existingPool as Account),
        poolMemberIds: [...((existingPool?.poolMemberIds) || []), investorId]
      };
    } else {
      targetAccount = {
        id: `acc_${investorId}`,
        userId: user.id,
        name: `Счет: ${name}`,
        type: 'INVESTOR',
        ownerId: investorId,
        currency: 'RUB',
        isArchived: false
      };
    }

    const savedAcc = await api.saveItem('accounts', targetAccount);
    updateList(setAccounts, savedAcc);

    // 4. 🔹 Создаём транзакцию депозита ТОЛЬКО если сумма > 0
    if (amount > 0) {
      const depositTransaction: Sale = {
        id: `dep_${Date.now()}`,
        userId: user.id,
        type: 'CASH',
        customerId: `system_deposit_${investorId}`,
        productName: 'Начальный депозит',
        buyPrice: 0,
        accountId: savedAcc.id,
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

    alert(hasLogin ? "✅ Инвестор создан!" : "✅ Инвестор создан (без доступа в приложение — логин можно добавить позже при редактировании).");
    return savedInv;

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




// Повторный вход инвестора в пул: кроме нового периода нужно оприходовать деньги на счёт.
// Раньше добавлялся только период — сумма числилась за инвестором, но на баланс счёта
// не попадала, и касса расходилась с долями участников.
/**
 * Меняет вложенную сумму инвестора на delta (отрицательная — возврат инвестиций).
 *
 * Обновляет И активный период (investmentPeriods), И поле initialAmount.
 * Это принципиально: у участника общего пула сумма вложения читается из активного
 * периода (getInvestorAmountAt в src/utils.ts), а верхнее поле игнорируется.
 * Возврат инвестиций уменьшал только initialAmount — поэтому у инвестора в пуле
 * «вложено» не менялось вовсе, а его доля в прибыли продолжала считаться
 * от прежней суммы. Тот же приём уже используется в applyLossToCapital ниже.
 */
const applyInvestmentDelta = (investor: Investor, delta: number, atDate: string | number | Date): Investor => {
  const periods = investor.investmentPeriods && investor.investmentPeriods.length > 0
    ? investor.investmentPeriods
    : [{ id: 'legacy', joinedDate: investor.joinedDate, leftPoolDate: investor.leftPoolDate, initialAmount: investor.initialAmount }];

  const active = getActivePeriodAt(investor, new Date(atDate).getTime());
  const updatedPeriods = active
    ? periods.map(p => (p.id === active.id ? { ...p, initialAmount: Math.max(0, p.initialAmount + delta) } : p))
    : periods;

  return {
    ...investor,
    investmentPeriods: updatedPeriods,
    initialAmount: Math.max(0, (investor.initialAmount || 0) + delta),
  };
};

// Убыток пула (мудараба). Раньше событие только записывалось в счёт и показывалось справкой —
// ни касса, ни доли участников не менялись. Теперь:
//  • деньги реально ушли (убыток не привязан к договору) → создаём расход по счёту пула;
//  • убыток по договору → расхода нет, деньги в кассу и не поступали;
//  • вина управляющего → капитал инвесторов не трогаем, потеря на менеджере.
const applyLossToCapital = (event: LossEvent, poolAccount: Account, sign: 1 | -1) => {
  // sign = 1 — уменьшить капитал (новый убыток), -1 — вернуть (убыток удалён)
  const shares = getCapitalShares(poolAccount, investors, event.date);
  return shares.map(({ investor, percentage }) => {
    const delta = event.amount * percentage / 100 * sign;
    const periods = investor.investmentPeriods && investor.investmentPeriods.length > 0
      ? investor.investmentPeriods
      : [{ id: 'legacy', joinedDate: investor.joinedDate, leftPoolDate: investor.leftPoolDate, initialAmount: investor.initialAmount }];

    const active = getActivePeriodAt(investor, new Date(event.date).getTime());
    if (!active) return null;

    const updatedPeriods = periods.map(p =>
      p.id === active.id ? { ...p, initialAmount: Math.max(0, p.initialAmount - delta) } : p
    );
    const updatedInvestor: Investor = {
      ...investor,
      investmentPeriods: updatedPeriods,
      initialAmount: Math.max(0, (investor.initialAmount || 0) - delta),
    };
    return updatedInvestor;
  }).filter((i): i is Investor => !!i);
};

const handlePoolLoss = async (poolAccount: Account, event: LossEvent) => {
  if (!user) return;

  let expenseId: string | undefined;

  // 1. Реальные деньги ушли из кассы — списываем со счёта.
  //    По договору расход не создаём: эти деньги в кассу никогда не поступали.
  if (!event.saleId) {
    const lossExpense: Expense = {
      id: `loss_${event.id}`,
      userId: user.id,
      createdByUserId: user.id,
      accountId: poolAccount.id,
      title: event.description?.trim() || 'Убыток пула',
      amount: event.amount,
      category: 'Убыток пула',
      date: event.date,
      description: event.blamedOnManager ? 'Убыток по вине управляющего' : undefined,
    };
    try {
      const saved = await api.saveItem('expenses', lossExpense);
      updateList(setExpenses, saved || lossExpense);
      expenseId = lossExpense.id;
    } catch (e) {
      console.error('❌ Не удалось списать убыток со счёта:', e);
    }
  }

  // 2. Капитал участников уменьшаем только если убыток не на совести управляющего
  if (!event.blamedOnManager) {
    for (const inv of applyLossToCapital(event, poolAccount, 1)) {
      try {
        const saved = await api.saveItem('investors', inv);
        updateList(setInvestors, saved || inv);
      } catch (e) {
        console.error('❌ Не удалось уменьшить долю инвестора:', e);
      }
    }
  }

  // 3. Само событие сохраняем в счёте
  await handleUpdateAccount({
    ...poolAccount,
    lossEvents: [...(poolAccount.lossEvents || []), { ...event, expenseId }],
  });
};

// Удаление убытка обязано вернуть всё назад, иначе доли навсегда останутся заниженными
const handleDeletePoolLoss = async (poolAccount: Account, lossId: string) => {
  if (!user) return;
  const event = (poolAccount.lossEvents || []).find(e => e.id === lossId);
  if (!event) return;

  if (event.expenseId) {
    try {
      await api.deleteItem('expenses', event.expenseId);
      setExpenses(prev => prev.filter(e => e.id !== event.expenseId));
    } catch (e) {
      console.error('❌ Не удалось удалить списание убытка:', e);
    }
  }

  if (!event.blamedOnManager) {
    for (const inv of applyLossToCapital(event, poolAccount, -1)) {
      try {
        const saved = await api.saveItem('investors', inv);
        updateList(setInvestors, saved || inv);
      } catch (e) {
        console.error('❌ Не удалось вернуть долю инвестора:', e);
      }
    }
  }

  await handleUpdateAccount({
    ...poolAccount,
    lossEvents: (poolAccount.lossEvents || []).filter(e => e.id !== lossId),
  });
};

const handleInvestorReentry = async (
  updatedInvestor: Investor,
  deposit: { accountId: string; amount: number; date: string; note?: string }
) => {
  if (!user) return;
  await handleUpdateInvestor(updatedInvestor);

  if (!deposit.accountId || !(deposit.amount > 0)) return;

  const depositTransaction: Sale = {
    id: `dep_reentry_${updatedInvestor.id}_${Date.now()}`,
    userId: user.id,
    type: 'CASH',
    customerId: `system_deposit_${updatedInvestor.id}`,
    productName: `Пополнение доли: ${updatedInvestor.name}${deposit.note ? ` (${deposit.note})` : ''}`,
    buyPrice: 0,
    accountId: deposit.accountId,
    totalAmount: deposit.amount,
    downPayment: deposit.amount,
    remainingAmount: 0,
    interestRate: 0,
    installments: 0,
    startDate: new Date(deposit.date).toISOString(),
    status: 'COMPLETED',
    paymentPlan: []
  };

  try {
    const saved = await api.saveItem('sales', depositTransaction);
    updateList(setSales, saved || depositTransaction, undefined, 'sales');
  } catch (e) {
    console.error('❌ Не удалось оприходовать повторный вход инвестора:', e);
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
      // 🔒 getInvestorAccount учитывает и обычный счёт (ownerId), и общий пул (poolMemberIds) —
      // раньше здесь был accounts.find(a => a.ownerId === ...), из-за чего активация логина
      // инвестору из общего пула не находила счёт (депозит не писался) и не обновляла poolMemberIds.
      const oldAccount = getInvestorAccount(oldInvestorId, accounts);

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

      // 🔹 6. Обновляем счёт: у обычного счёта меняем ownerId; у общего пула — заменяем СТАРЫЙ id
      // инвестора на НОВЫЙ внутри poolMemberIds (сам счёт общий на нескольких инвесторов,
      // поэтому его ownerId/name не трогаем — иначе счёт "уехал" бы от остальных участников пула).
      if (oldAccount) {
        const updatedAccount = oldAccount.type === 'POOL'
          ? {
              ...oldAccount,
              poolMemberIds: (oldAccount.poolMemberIds || []).map(id => id === oldInvestorId ? newUser.id : id)
            }
          : {
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

    // 3. Счёт: если это общий пул — убираем инвестора из участников, счёт не трогаем
    // (другие инвесторы пула им пользуются); если это его отдельный счёт — удаляем как раньше.
    const acc = getInvestorAccount(id, accounts);
    if (acc?.type === 'POOL') {
      const updatedPool = { ...acc, poolMemberIds: (acc.poolMemberIds || []).filter(memberId => memberId !== id) };
      const savedPool = await api.saveItem('accounts', updatedPool);
      updateList(setAccounts, savedPool);
    } else if (acc) {
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

  // 🔹 🔑 ОПТИМИСТИЧНОЕ УДАЛЕНИЕ: сначала удаляем из UI
  removeFromList(setCustomers, customerId);

  if (selectedCustomerId === customerId) {
    setSelectedCustomerId(null);
    setCurrentView(previousView === 'CUSTOMER_DETAILS' ? 'CUSTOMERS' : previousView);
  }

  try {
    const result = await api.deleteItem('customers', customerId);
    
    if (result.isOffline) {
      showNotificationModal(
        '⚠️ Офлайн-режим',
        'Клиент удалён локально и будет синхронизирован при подключении.',
        'warning'
      );
    } else {
      alert('✅ Клиент успешно удален');
    }
  } catch (error) {
    console.error('❌ Ошибка удаления клиента:', error);
    // 🔹 НЕ откатываем — данные в очереди
  } finally {
    setShowDeleteConfirm(null);
  }
};


  const handleAddProduct = async (name: string, price: number, stock: number) => { if (!checkAccess('WRITE')) { showUpgradeAlert("Срок подписки истек."); return; } if (user) { const ownerId = isEmployee && user.managerId ? user.managerId : user.id; const newProd = { id: crypto.randomUUID(), userId: ownerId, name, price, category: 'Общее', stock }; const saved = await api.saveItem('products', newProd); updateList(setProducts, saved); } };
  const handleUpdateProduct = async (updated: Product) => { if (isEmployee && !user?.permissions?.canEdit) return; const saved = await api.saveItem('products', updated); updateList(setProducts, saved); };
 const handleDeleteProduct = async (id: string) => {
  if (isEmployee && !user?.permissions?.canDelete) return;
  
  // 🔹 🔑 ОПТИМИСТИЧНОЕ УДАЛЕНИЕ
  removeFromList(setProducts, id);
  
  try {
    const result = await api.deleteItem('products', id);
    if (result.isOffline) {
      console.log('📦 Товар удалён локально');
    }
  } catch (e) {
    console.warn('⚠️ Product delete failed:', e);
  }
};
const handleAddCustomer = async (data: {
  name: string;
  phone: string;
  photo?: string;
  address?: string;
  passportSeries?: string;
  passportNumber?: string;
  passportIssuedBy?: string;
}) => {
  // 🔹 Проверка доступа
  if (!checkAccess('WRITE')) {
    showUpgradeAlert("Срок подписки истек.");
    return;
  }

  if (!user) throw new Error("No user");

  const ownerId = isEmployee && user.managerId ? user.managerId : user.id;

  // 🔹 Создаём нового клиента с паспортными данными
  const newCustomer: {
      passportNumber: string;
      address: string;
      notes: string;
      documents: any[];
      photo: string;
      userId: string;
      createdByUserId: string;
      passportSeries: string;
      createdAt: string;
      trustScore: number;
      phone: string;
      name: string;
      id: `${string}-${string}-${string}-${string}-${string}`;
      email: string;
      passportIssuedBy: string;
      allowWhatsappNotification: boolean
  } = {
    id: crypto.randomUUID(),
    userId: ownerId,
    createdByUserId: user.id,

    // Обязательные поля
    name: data.name.trim(),
    phone: data.phone.trim(),

    // Опциональные поля
    email: '',
    photo: data.photo?.trim() || undefined,
    address: data.address?.trim() || undefined,
    notes: '',

    // 🔹 Паспортные данные (только если заполнены)
    passportSeries: data.passportSeries?.trim() || undefined,
    passportNumber: data.passportNumber?.trim() || undefined,
    passportIssuedBy: data.passportIssuedBy?.trim() || undefined,

    // Поля по умолчанию
    trustScore: 50,
    allowWhatsappNotification: true,
    documents: [],
    createdAt: new Date().toISOString(),
  };

  // 🔹 Сохраняем в базу
  const saved = await api.saveItem('customers', newCustomer);

  // 🔹 Обновляем список в стейте
  updateList(setCustomers, saved);

  return saved;
};
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
const handleAddAccount = async (name: string, type: Account['type'] = 'CUSTOM', partners?: string[]) => { if (!checkAccess('WRITE')) { showUpgradeAlert("Срок подписки истек."); return; } if (user && isManager) { const newAcc = { id: `acc_${Date.now()}`, userId: user.id, name, type, partners }; const saved = await api.saveItem('accounts', newAcc); updateList(setAccounts, saved); } };
  const handleSetMainAccount = async (accountId: string) => {
    if (!user || !isManager) return;
    // 🔒 Раньше выбранному счёту принудительно ставился type: 'MAIN', что затирало его
    // реальный тип (INVESTOR/POOL/SHARED) — для пула это ломало распределение прибыли
    // и делало его "невидимым" для инвесторов (getAccountShares/getInvestorAccount
    // проверяют именно type). Теперь "основной" — отдельный флаг isMain, type не трогаем.
    const updatedAccounts = accounts.map(acc => {
      if (acc.id === accountId) {
        return { ...acc, isMain: true };
      }
      if (acc.isMain) {
        return { ...acc, isMain: false };
      }
      if (acc.type === 'MAIN') {
        // Единственный случай, где "основной" исторически был закодирован в type —
        // снимаем его, чтобы не было двух счетов с type === 'MAIN' одновременно.
        return { ...acc, type: 'CUSTOM' as const };
      }
      return acc;
    });
    setAccounts(updatedAccounts);
    for (const acc of updatedAccounts) await api.saveItem('accounts', acc);
  };

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

  // Задачи. Список локальный для менеджера, поэтому обновляем состояние сразу,
  // а сохранение уходит следом — иначе галочка «выполнено» ставилась бы с задержкой сети.
  const handleSaveTask = async (task: Task) => {
    if (!user) return;
    setTasks(prev => prev.some(t => t.id === task.id)
      ? prev.map(t => (t.id === task.id ? task : t))
      : [task, ...prev]);
    try {
      await api.saveItem('tasks', task);
    } catch (e) {
      console.error('Не удалось сохранить задачу:', e);
    }
  };

  // Открыть страницу задач с заполненной заготовкой (из договора / карточки клиента)
  const handleCreateTaskFor = (draft: Partial<Task>) => {
    setTaskDraft(draft);
    setPreviousView(currentView);
    setCurrentView('TASKS');
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!user) return;
    setTasks(prev => prev.filter(t => t.id !== taskId));
    try {
      await api.deleteItem('tasks', taskId);
    } catch (e) {
      console.error('Не удалось удалить задачу:', e);
    }
  };
  const handleUndoPayment = async (saleId: string, paymentId: string) => {
    if (isEmployee && !user?.permissions?.canDelete) {
        alert("Нет прав на удаление");
        return;
    }

    const sale = sales.find(s => s.id === saleId);
    if(sale) {
        const payment = sale.paymentPlan.find(p => p.id === paymentId);
        if (payment) {
            // 🆕 Получаем сумму скидки (если была) — только для текста уведомления ниже.
            const discountAmount = (payment as any).discountAmount || 0;
            const amountToRestore = payment.amount + discountAmount;

            const planWithoutPayment: Payment[] = sale.paymentPlan.filter((p: Payment) => p.id !== paymentId);

            // 🔒 remainingAmount и isPaid плановых платежей пересчитываются единой функцией
            // (reconcileSalePaymentPlan) от факта оставшихся реальных платежей — а не вручную
            // прибавлением суммы. Раньше плановый платёж, однажды помеченный isPaid: true
            // (например, при импорте из Excel — DataImport.tsx), навсегда оставался "закрытым"
            // в графике, даже если реальный платёж, который его закрыл, был удалён — деньги
            // возвращались в remainingAmount, а в "Графике платежей" эта сумма нигде не появлялась.
            const updatedSale = {
                ...reconcileSalePaymentPlan({ ...sale, paymentPlan: planWithoutPayment }),
                status: 'ACTIVE' as const
            };

            try {
                const saved = await api.saveItem('sales', updatedSale);
                updateList(setSales, saved);

                //  Показываем уведомление о восстановленной сумме
                if (discountAmount > 0) {
                    alert(`✅ Платёж отменён!\nВосстановлено: ${payment.amount} ₽ + скидка ${discountAmount} ₽ = ${amountToRestore} ₽`);
                }
            } catch (error: any) {
                // 🔒 Раньше ошибка сохранения (не сетевая — те api.saveItem сама ставит в
                // офлайн-очередь и не бросает) проходила молча: пользователь видел, что платёж
                // как будто отменился, а на самом деле ничего не сохранилось.
                console.error('❌ Ошибка отмены платежа:', error);
                alert(`Не удалось отменить платёж: ${error.message || 'неизвестная ошибка'}`);
            }
        }
    }
};
  const handleEditPayment = async (saleId: string, paymentId: string, newDate: string) => {
    if (isEmployee && !user?.permissions?.canEdit) { alert("Нет прав на редактирование"); return; }
    const sale = sales.find((s: Sale) => s.id === saleId);
    if (sale) {
        const updatedSale = reconcileSalePaymentPlan({ ...sale, paymentPlan: sale.paymentPlan.map((p: Payment) => p.id === paymentId ? { ...p, date: newDate } : p) });
        try {
            const saved = await api.saveItem('sales', updatedSale);
            updateList(setSales, saved);
        } catch (error: any) {
            // 🔒 Раньше ошибка сохранения (не сетевая) проходила молча — правка даты
            // как будто применилась на экране, а на сервер не попала.
            console.error('❌ Ошибка сохранения даты платежа:', error);
            alert(`Не удалось изменить дату платежа: ${error.message || 'неизвестная ошибка'}`);
        }
    }
  };
  const handleInitiateDashboardPayment = (sale: Sale, amount: number) => { if (!checkAccess('WRITE')) { showUpgradeAlert("Срок подписки истек."); return; } setDraftSaleData({ type: 'CUSTOMER_PAYMENT', customerId: sale.customerId, saleId: sale.id, amount }); setCurrentView('CREATE_INCOME'); };
  const handleInitiateCustomerPayment = (sale: Sale, payment: Payment) => { if (!checkAccess('WRITE')) { showUpgradeAlert("Срок подписки истек."); return; } setDraftSaleData({ type: 'CUSTOMER_PAYMENT', customerId: sale.customerId, saleId: sale.id, amount: payment.amount }); setCurrentView('CREATE_INCOME'); };
  // 🔒 При открытии выбора (клиента и т.п.) форма <NewSale> размонтируется, а её initialData —
  // editingSale || draftSaleData. Если не синхронизировать editingSale тоже, все несохранённые
  // правки (и сам выбор) при возврате в форму терялись бы, т.к. editingSale имеет приоритет.
  const openSelection = (view: ViewState, currentData: any) => { setDraftSaleData(currentData); if (editingSale) setEditingSale(currentData); setPreviousView(currentView); setCurrentView(view); };
  const handleSelection = (key: 'customerId', id: string) => { setDraftSaleData({ ...draftSaleData, [key]: id }); if (editingSale) setEditingSale({ ...editingSale, [key]: id }); setCurrentView(previousView === 'CREATE_INCOME' ? 'CREATE_INCOME' : 'CREATE_SALE'); };
const handleQuickAddCustomer = async (data: {
  name: string;
  phone: string;
  address?: string;
  passportSeries?: string;
  passportNumber?: string;
  passportIssuedBy?: string;
}) => {
  // 🔹 Проверка пользователя
  if (!user) return;

  // 🔹 Проверка доступа
  if (!checkAccess('WRITE')) {
    showUpgradeAlert("Срок подписки истек.");
    return;
  }

  const ownerId = isEmployee && user.managerId ? user.managerId : user.id;

  // 🔹 Создаём клиента с паспортными данными
  const newCustomer: {
      passportNumber: string;
      notes: string;
      address: string;
      documents: any[];
      photo: string;
      userId: string;
      passportSeries: string;
      createdAt: string;
      trustScore: number;
      phone: string;
      name: string;
      id: `${string}-${string}-${string}-${string}-${string}`;
      email: string;
      passportIssuedBy: string;
      allowWhatsappNotification: boolean
  } = {
    id: crypto.randomUUID(),
    userId: ownerId,

    // Обязательные поля
    name: data.name.trim(),
    phone: data.phone.trim(),

    // Опциональные поля
    email: '',
    trustScore: 50,
    notes: '',
    photo: '',

    // 🔹 Адрес (может быть пустым)
    address: data.address?.trim() || undefined,

    // 🔹 Паспортные данные (все необязательные)
    passportSeries: data.passportSeries?.trim() || undefined,
    passportNumber: data.passportNumber?.trim() || undefined,
    passportIssuedBy: data.passportIssuedBy?.trim() || undefined,

    // Поля по умолчанию
    allowWhatsappNotification: true,
    documents: [],
    createdAt: new Date().toISOString(),
  };

  // 🔹 Сохраняем в базу
  const saved = await api.saveItem('customers', newCustomer);

  // 🔹 Обновляем список клиентов в стейте
  updateList(setCustomers, saved);

  // 🔹 Автоматически выбираем созданного клиента в форме
  handleSelection('customerId', saved.id);

  // 🔹 Возвращаем клиента (для цепочки вызовов)
  return saved;
};  const handleSelectAccountForOperations = (accountId: string) => { setOperationsAccountId(accountId); setCurrentView('OPERATIONS'); };
  const handleSelectCustomer = (id: string) => { setSelectedCustomerId(id); setPreviousView(currentView); setCurrentView('CUSTOMER_DETAILS'); };
  // Resume into the customer's details if one was left open when the user tapped away to
  // another tab; tapping "Клиенты" while already in this section resets to the list.
  const handleGoToCustomersTab = () => {
    if (currentView === 'CUSTOMERS' || currentView === 'CUSTOMER_DETAILS') {
      setCurrentView('CUSTOMERS');
      return;
    }
    if (customersSubView === 'DETAILS' && selectedCustomerId && customers.some((c: Customer) => c.id === selectedCustomerId)) {
      setPreviousView('CUSTOMERS');
      setCurrentView('CUSTOMER_DETAILS');
    } else {
      setCurrentView('CUSTOMERS');
    }
  };
  useEffect(() => {
    if (currentView === 'CUSTOMER_DETAILS' && previousView === 'CUSTOMERS') {
      setCustomersSubView('DETAILS');
    } else if (currentView === 'CUSTOMERS') {
      setCustomersSubView('LIST');
    }
  }, [currentView, previousView]);
  const handleSelectInvestor = (investor: Investor) => { setSelectedInvestorId(investor.id); setCurrentView('INVESTOR_DETAILS'); };
  const handleSelectEmployeeActivity = (id: string) => { setSelectedEmployeeId(id); setCurrentView('EMPLOYEE_ACTIVITY'); };
  const handleAddPartnership = async (name: string, members: string[]) => { if (!user) return; const newAccountId = `acc_part_${Date.now()}`; const newAccount: Account = { id: newAccountId, userId: user.id, name: `Счет: ${name}`, type: 'CUSTOM' }; const newPartnership: Partnership = { id: `part_${Date.now()}`, userId: user.id, name, accountId: newAccountId, partnerIds: members, createdAt: new Date().toISOString() }; const savedAcc = await api.saveItem('accounts', newAccount); updateList(setAccounts, savedAcc); const savedPart = await api.saveItem('partnerships', newPartnership); updateList(setPartnerships, savedPart); };
  const handleSelectSupplier = (supplier: Supplier) => { setSelectedSupplierId(supplier.id); setCurrentView('SUPPLIER_DETAILS'); };
  const handleViewSupplierContract = (sale: Sale) => { setSelectedCustomerId(sale.customerId); setInitialSaleIdForDetails(sale.id); setPreviousView('SUPPLIER_DETAILS'); setCurrentView('CUSTOMER_DETAILS'); };
  const handleAddSupplier = async (data: { name: string; phone?: string; email?: string; notes?: string }) => {
    if (!user) return;
    if (!checkAccess('SUPPLIERS')) { showUpgradeAlert("Модуль «Партнеры» доступен только на тарифе Бизнес Pro."); return; }
    const ownerId = isEmployee && user.managerId ? user.managerId : user.id;
    const newSupplier: Supplier = { id: crypto.randomUUID(), userId: ownerId, createdByUserId: user.id, name: data.name, phone: data.phone, email: data.email, notes: data.notes, createdAt: new Date().toISOString() };
    const saved = await api.saveItem('suppliers', newSupplier);
    updateList(setSuppliers, saved);
  };
  const handleUpdateSupplier = async (supplier: Supplier) => {
    const saved = await api.saveItem('suppliers', supplier);
    updateList(setSuppliers, saved);
  };
  const handleDeleteSupplier = async (id: string) => {
    try {
      await api.deleteItem('suppliers', id);
      removeFromList(setSuppliers, id);
    } catch (error: any) {
      console.error('❌ Ошибка удаления поставщика:', error);
      showNotificationModal('❌ Ошибка удаления', error.message || 'Не удалось удалить поставщика.', 'error');
    }
  };
  const handlePaySupplier = (sale: Sale) => {
    const remaining = sale.buyPrice - (sale.partnerDebtPaidAmount || 0);
    setDraftExpenseData({
      accountId: sale.accountId,
      supplierId: sale.supplierId,
      saleId: sale.id,
      category: 'Оплата партнёру',
      title: `Оплата поставщику: ${sale.productName}`,
      amount: remaining,
      maxAmount: remaining,
    });
    setCurrentView('CREATE_EXPENSE');
  };
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
        const response = await api.updateProfile(user.id, {
            name: data.name,
            phone: data.phone,
        });

        // ✅ Мержим: берём ответ сервера, но phone точно не теряем
        const updatedUser = {
            ...user,
            ...(response.user || response),
            phone: response.user?.phone ?? response.phone ?? data.phone,
        };

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

  actualSales.forEach(sale => {
    if (sale.status === 'COMPLETED' || sale.remainingAmount === 0) {
      archive++;
      return;
    }
    // ✅ ПРОВЕРКА: реальная сумма просрочки > 0
    const overdueAmount = calculateSaleOverdue(sale, today);
    if (overdueAmount > 0) {
      overdue++;
    } else {
      active++;
    }
  });
  return { all: actualSales.length, active, overdue, archive };
}, [sales, customers]);  const toggleMoreSection = (section: string) => { setMoreExpandedSection(moreExpandedSection === section ? null : section); };

  const handleDeleteOperation = async (op: any) => {
      if (!user) return;
      if (isEmployee && !user.permissions?.canDelete) {
          alert("Нет прав на удаление");
          return;
      }

      try {
        if (op.type === 'EXPENSE') {
            const expense: Expense | undefined = op.raw;
            await api.deleteItem('expenses', op.id);
            removeFromList(setExpenses, op.id);

            // 🔙 Откатываем побочные эффекты, которые были сделаны при создании расхода
            // (см. handleExpenseSubmit). Без этого отмена возвращала деньги на счёт,
            // но оставляла испорченными связанные записи: у инвестора навсегда
            // оставался уменьшенный капитал, а долг поставщику — помеченным оплаченным.
            // Остаток счёта и прибыль пересчитываются из списка расходов сами,
            // поэтому отдельно их восстанавливать не нужно.
            if (expense?.payoutType === 'INVESTMENT' && expense.investorId) {
                const inv = investors.find(i => i.id === expense.investorId);
                if (inv) {
                    // Возвращаем и в активный период, и в initialAmount — симметрично списанию
                    const restored = applyInvestmentDelta(inv, Number(expense.amount), expense.date);
                    const savedInv = await api.saveItem('investors', restored);
                    updateList(setInvestors, savedInv);
                }
            }

            if (expense?.category === 'Оплата партнёру' && expense.saleId) {
                const sale = sales.find(s => s.id === expense.saleId);
                if (sale) {
                    const newPaid = Math.max(0, (sale.partnerDebtPaidAmount || 0) - Number(expense.amount));
                    const updatedSale = {
                        ...sale,
                        partnerDebtPaidAmount: newPaid,
                        isPartnerDebtPaid: newPaid >= sale.buyPrice,
                    };
                    const savedSale = await api.saveItem('sales', updatedSale);
                    updateList(setSales, savedSale);
                }
            }
        } else if (op.type === 'INCOME') {
            if (!window.confirm("Вы уверены, что хотите удалить эту операцию?")) return;
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
      } catch (error: any) {
        console.error('❌ Ошибка удаления операции:', error);
        showNotificationModal('❌ Ошибка удаления', error.message || 'Не удалось удалить операцию.', 'error');
      }
  };




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
        <Suspense fallback={<LazyFallback />}>
            <Calculator
                isPublic={true}
                appSettings={appSettings}
                userPhone={user?.phone}
            />
        </Suspense>
    );
}

// 2. Загрузка (проверка сессии, подгрузка данных)
if (showSplash || isLoading) {
  return <SplashScreen />
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
    onGoToCustomers={handleGoToCustomersTab}
    isOnline={isOnline}
    isSyncing={isSyncing}
    supportUnreadCount={supportUnreadCount}
    unreadNotifCount={unreadNotifCount}
    onOpenNotifications={() => setShowNotificationsPanel(true)}
    showNotificationsBell={checkAccess('NOTIFICATIONS')}
    showTasks={checkAccess('TASKS')}
    showEmployees={checkAccess('EMPLOYEES')}
    showSuppliers={checkAccess('SUPPLIERS')}
    // 🔹 Кнопка поддержки для десктопа (плавающая) — админа ведём в панель
    // управления обращениями, а не в чат "как у обычного пользователя"
    supportButton={
      <SupportButton
        unreadCount={supportUnreadCount}
        onClick={() => {
          if (user?.role === 'admin') { setPreviousView(currentView); setCurrentView('ADMIN_SUPPORT'); }
          else setShowSupportChat(true);
        }}
      />
    }

  >



              {/* ... (Layout Children remain exactly the same) ... */}
              {currentView === 'DASHBOARD' && !isInvestor &&
                  <Dashboard sales={sales} customers={customers} stats={dashboardStats} workingCapital={workingCapital}
                             accountBalances={accountBalances} onAction={handleAction}
                             onSelectCustomer={handleSelectCustomer}  onViewSchedule={handleViewSaleSchedule} onInitiatePayment={handleInitiateDashboardPayment}
                             accounts={accounts} appSettings={appSettings} investors={investors} user={user}/>}
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
            <p className="text-slate-500 dark:text-slate-400">Загрузка данных...</p>
          </div>
        </div>
      );
    }

    // 🔹 Счета, где этот инвестор участвует — свой отдельный или как участник общего пула
    const filteredAccounts = accounts.filter(a => isAccountForInvestor(a, activeInvestor.id));


    return (
      <InvestorDashboard
        sales={sales.filter(s => {
          const acc = accounts.find(a => a.id === s.accountId);
          return !!acc && isAccountForInvestor(acc, activeInvestor.id);
        })}
        expenses={expenses.filter(e => {
          const acc = accounts.find(a => a.id === e.accountId);
          return !!acc && isAccountForInvestor(acc, activeInvestor.id);
        })}
        accounts={filteredAccounts}
        customers={customers}
        investor={activeInvestor}
        investors={investors}
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
    accounts={isInvestor && user
      ? accounts.filter(a => isAccountForInvestor(a, user.id))
      : accounts}
    sales={isInvestor && user
      ? sales.filter(s => {
          const acc = accounts.find(a => a.id === s.accountId);
          return !!acc && isAccountForInvestor(acc, user.id);
        })
      : sales}
    expenses={isInvestor && user
      ? expenses.filter(e => {
          const acc = accounts.find(a => a.id === e.accountId);
          return !!acc && isAccountForInvestor(acc, user.id);
        })
      : expenses}
    investors={investors}
    customers={customers}
    onSelectCustomer={handleSelectCustomer}
    onAddAccount={handleAddAccount}
    onAction={handleAction}
    onSelectAccount={handleSelectAccountForOperations}
    onSetMainAccount={handleSetMainAccount}
    onUpdateAccount={handleUpdateAccount}
    lockedAccountIds={lockedAccountIds}
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
                  <PagePush onClose={() => setCurrentView(previousView)} showBackButton scrollKey="CONTRACTS">
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
                      employees={employees}
                      appSettings={appSettings}
                      onCreateTask={checkAccess("TASKS") ? handleCreateTaskFor : undefined}
                  />
                  </PagePush>
              )}
              {(currentView === 'INVESTORS' || currentView === 'INVESTOR_DETAILS') && (
                <PagePush onClose={() => setCurrentView(previousView)} showBackButton scrollKey="INVESTORS">
                  <Investors investors={investors} accounts={accounts}
                                                         showPools={checkAccess('INVESTOR_POOLS')}
                                                         onAddInvestor={handleAddInvestor}
                                                         onUpdateInvestor={handleUpdateInvestor}
                                                         onDeleteInvestor={handleDeleteInvestor}
                                                         onViewDetails={handleSelectInvestor}
                                                         lockedInvestorIds={lockedInvestorIds}
                                                         appSettings={appSettings}/>
                </PagePush>
              )}
              {currentView === 'INVESTOR_DETAILS' && selectedInvestorId && (
                  <PagePush onClose={() => setCurrentView('INVESTORS')} scrollKey={`INVESTOR_DETAILS:${selectedInvestorId}`}>
                    {(requestClose: () => void) => {
                      // Удаление инвестора обновляет `investors` асинхронно (после ответа сервера),
                      // а PagePush ещё какое-то время держит этот экран смонтированным для анимации
                      // закрытия. Если стейт обновился раньше, чем анимация успела закрыться,
                      // .find() вернёт undefined — без этой проверки `!` ниже не спасает от падения
                      // в рантайме (только заглушает TypeScript) и роняет всё приложение в белый экран.
                      const selectedInvestor = investors.find((i: Investor) => i.id === selectedInvestorId);
                      if (!selectedInvestor) return null;
                      return (
                        <InvestorDetails investor={selectedInvestor}
                                     investors={investors}
                                     account={getInvestorAccount(selectedInvestorId, accounts)} sales={sales}
                                     expenses={expenses} customers={customers} onBack={requestClose}
                                     appSettings={appSettings}
                                     onUpdateInvestor={handleUpdateInvestor}
                                     onDeleteInvestor={(id: string) => { handleDeleteInvestor(id); requestClose(); }}
                                     onUpdateAccount={handleUpdateAccount}
                                     onInvestorReentry={handleInvestorReentry}
                                     onPoolLoss={handlePoolLoss}
                                     onDeletePoolLoss={handleDeletePoolLoss}/>
                      );
                    }}
                  </PagePush>
              )}
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
              {currentView === 'TASKS' && (
                  <PagePush onClose={() => setCurrentView(previousView)} showBackButton scrollKey="TASKS">
                  <Tasks
                      tasks={tasks}
                      onSaveTask={handleSaveTask}
                      onDeleteTask={handleDeleteTask}
                      userId={user.id}
                      employees={employees}
                      isEmployee={isEmployee}
                      draft={taskDraft}
                      onDraftConsumed={() => setTaskDraft(null)}
                      onOpenCustomer={handleSelectCustomer}
                  />
                  </PagePush>
              )}
              {currentView === 'SUPPLIERS' && (
                  <PagePush onClose={() => setCurrentView(previousView)} showBackButton scrollKey="SUPPLIERS">
                  <Suppliers
                      suppliers={suppliers}
                      sales={sales}
                      showCents={appSettings.showCents}
                      onAddSupplier={handleAddSupplier}
                      onUpdateSupplier={handleUpdateSupplier}
                      onDeleteSupplier={handleDeleteSupplier}
                      onViewDetails={handleSelectSupplier}
                  />
                  </PagePush>
              )}
              {currentView === 'SUPPLIER_DETAILS' && selectedSupplierId && (
                  <PagePush onClose={() => setCurrentView('SUPPLIERS')} scrollKey={`SUPPLIER_DETAILS:${selectedSupplierId}`}>
                    {(requestClose: () => void) => (
                      <SupplierDetails
                      supplier={suppliers.find((s: Supplier) => s.id === selectedSupplierId)!}
                      sales={sales}
                      expenses={expenses}
                      customers={customers}
                      showCents={appSettings.showCents}
                      appSettings={appSettings}
                      onBack={requestClose}
                      onPaySupplier={handlePaySupplier}
                      onViewContract={handleViewSupplierContract}
                      />
                    )}
                  </PagePush>
              )}
              {(currentView === 'CUSTOMERS' || (currentView === 'CUSTOMER_DETAILS' && previousView === 'CUSTOMERS')) && (
                  <Customers
                      customers={customers}
                      onAddCustomer={handleAddCustomer}
                      onSelectCustomer={handleSelectCustomer}
                      isActive={currentView === 'CUSTOMERS'}
                  />
              )}
              {currentView === 'CUSTOMER_DETAILS' && selectedCustomerId &&
                  <PagePush onClose={() => setCurrentView(previousView)} scrollKey={`CUSTOMER_DETAILS:${selectedCustomerId}`}>
                    {(requestClose: () => void) => (
                      <CustomerDetails customer={customers.find((c: Customer) => c.id === selectedCustomerId)!} sales={sales}
                                       accounts={accounts} investors={investors} onBack={requestClose}
                                       onInitiatePayment={handleInitiateCustomerPayment} onUndoPayment={handleUndoPayment}
                                       onEditPayment={handleEditPayment} onUpdateCustomer={handleUpdateCustomer}
                                       onDeleteCustomer={handleDeleteCustomer}
                                       suppliers={suppliers} onPaySupplier={handlePaySupplier}
                                       initialSaleId={initialSaleIdForDetails} appSettings={appSettings} user={user}
                                       onCreateTask={checkAccess("TASKS") ? handleCreateTaskFor : undefined}/>
                    )}
                  </PagePush>}
              {currentView === 'MANAGE_PRODUCTS' &&
                  <Products products={products} onAddProduct={handleAddProduct} onUpdateProduct={handleUpdateProduct}
                            onDeleteProduct={handleDeleteProduct} appSettings={appSettings}/>}
              {currentView === 'OPERATIONS' && (
                  <PagePush onClose={() => setCurrentView(previousView)} scrollKey="OPERATIONS">
                    <Operations
                      sales={isInvestor ? sales.filter(s => s.accountId === accounts.find(a => a.ownerId === user.id)?.id) : sales}
                      expenses={isInvestor ? expenses.filter(e => e.accountId === accounts.find(a => a.ownerId === user.id)?.id) : expenses}
                      accounts={accounts}
                      customers={customers}
                      initialAccountId={operationsAccountId}
                      onDelete={handleDeleteOperation}
                      investors={investors}
                      employees={isInvestor ? [] : employees}
                      canFilterByEmployee={isManager && !isEmployee && !isInvestor}
                      accountBalances={accountBalances}
                      appSettings={appSettings}
                    />
                  </PagePush>
              )}
              {currentView === 'REPORTS' && reportData && (
                  <PagePush onClose={() => setCurrentView(previousView)} showBackButton>
                    <Reports investors={investors} filters={reportFilters} onFiltersChange={setReportFilters}
                           data={reportData} appSettings={appSettings} sales={sales} expenses={expenses} accounts={accounts} customers={customers}/>
                  </PagePush>
              )}

              {currentView === 'CREATE_INCOME' && (
                  <PagePush onClose={() => setCurrentView('DASHBOARD')}>
                    {(requestClose: () => void) => (
                      <NewIncome initialData={draftSaleData} customers={customers} investors={investors} accounts={accounts}
                             sales={sales} onClose={requestClose} onSubmit={handleIncomeSubmit}
                             onSelectCustomer={() => openSelection('SELECT_CUSTOMER', draftSaleData)}
                             appSettings={appSettings} user={user}/>
                    )}
                  </PagePush>
              )}
              {currentView === 'CREATE_EXPENSE' && (
                  <PagePush onClose={() => { setCurrentView('DASHBOARD'); setDraftExpenseData(null); }}>
                    {(requestClose: () => void) => (
                      <NewExpense investors={investors} accounts={accounts} expenses={expenses} suppliers={suppliers} sales={sales}
                              showSupplierCategory={checkAccess('SUPPLIERS')} initialData={draftExpenseData} onClose={requestClose}
                              onSubmit={handleExpenseSubmit} appSettings={appSettings} employees={employees} />
                    )}
                  </PagePush>
              )}
              {currentView === 'CREATE_SALE' && (
                  <PagePush onClose={() => { setCurrentView('DASHBOARD'); setEditingSale(null); }}>
                    {(requestClose: () => void) => (
                      <NewSale initialData={editingSale || draftSaleData} customers={customers} products={products}
                           accounts={accounts} suppliers={suppliers} showSupplierField={checkAccess('SUPPLIERS')} onClose={requestClose}
                           onSelectCustomer={(data: any) => openSelection('SELECT_CUSTOMER', data)} onSubmit={handleSaveSale} onShowNotification={showNotificationModal}
                           appSettings={appSettings} />
                    )}
                  </PagePush>
              )}
              {currentView === 'SELECT_CUSTOMER' && <SelectionList title="Выберите клиента" items={customers.map(c => ({
                  id: c.id,
                  title: c.name,
                  subtitle: c.phone
              }))} onSelect={(id) => handleSelection('customerId', id)}
                                                                   onCancel={() => setCurrentView(previousView === 'CREATE_INCOME' ? 'CREATE_INCOME' : 'CREATE_SALE')}
                                                                   onAddNew={handleQuickAddCustomer}/>}
              {(currentView === 'EMPLOYEES' || currentView === 'EMPLOYEE_ACTIVITY') && (
                  <PagePush onClose={() => setCurrentView(previousView)} showBackButton={currentView !== 'EMPLOYEE_ACTIVITY'} scrollKey="EMPLOYEES">
                    <Employees employees={employees} investors={investors} onAddEmployee={handleAddEmployee}
                             onUpdateEmployee={handleUpdateEmployee} onDeleteEmployee={handleDeleteEmployee}
                             onSelectActivity={handleSelectEmployeeActivity}
                             appSettings={appSettings}/>
                  </PagePush>
              )}
              {currentView === 'EMPLOYEE_ACTIVITY' && selectedEmployeeId && (() => {
                  const emp = employees.find((e: User) => e.id === selectedEmployeeId);
                  return emp ? (
                      <PagePush onClose={() => setCurrentView('EMPLOYEES')} scrollKey={`EMPLOYEE_ACTIVITY:${selectedEmployeeId}`}>
                        {(requestClose: () => void) => (
                          <EmployeeActivity employee={emp} sales={sales} expenses={expenses} customers={customers} accounts={accounts} investors={investors} onBack={requestClose}/>
                        )}
                      </PagePush>
                  ) : null;
              })()}
              {currentView === 'TARIFFS' && (
                <PagePush onClose={() => setCurrentView(previousView)} showBackButton>
                  {/* Счётчики нужны, чтобы при понижении тарифа показать не абстрактное
                      «лимит станет меньше», а конкретное «4 из 5 инвесторов заблокируются» */}
                  <Tariffs
                    user={user}
                    investorsCount={investors.length}
                    contractsCount={sales.filter(s => !s.customerId.startsWith('system_')).length}
                    employeesCount={employees.length}
                  />
                </PagePush>
              )}

              {currentView === 'SETTINGS' && (
                <PagePush onClose={() => setCurrentView(previousView)} showBackButton>
                  <Settings appSettings={appSettings} shopAllowed={checkAccess('SHOP')} onUpdateSettings={handleUpdateSettings}
                                                       onNavigate={(v: ViewState) => { setPreviousView('SETTINGS'); setCurrentView(v); }} onImportData={handleImportData} currentUserId={user.id} user={user}/>
                </PagePush>
              )}

              {currentView === 'PARTNER' && (
                <PagePush onClose={() => setCurrentView(previousView)} scrollKey="PARTNER">
                  {(requestClose: () => void) => <PartnerPage onBack={requestClose} />}
                </PagePush>
              )}

              {currentView === 'REFERRAL' && (
                <PagePush onClose={() => setCurrentView('MORE')} scrollKey="REFERRAL">
                  {(requestClose: () => void) => (
                    <Suspense fallback={<LazyFallback />}>
                      <Referral onBack={requestClose} />
                    </Suspense>
                  )}
                </PagePush>
              )}

              {currentView === 'INTEGRATIONS' && (
                <PagePush onClose={() => setCurrentView('SETTINGS')}>
                  {(requestClose: () => void) => (
                    <Suspense fallback={<LazyFallback />}>
                      <Integrations appSettings={appSettings} onUpdateSettings={handleUpdateSettings}
                                    onBack={requestClose}
                                    whatsappRefreshKey={whatsappRefreshKey}  // ← Обязательно!
                                    onSettingsChanged={() => {

                                    }}/>
                    </Suspense>
                  )}
                </PagePush>
              )}
              {currentView === 'CALCULATOR' && (
                <PagePush onClose={() => setCurrentView('SETTINGS')}>
                  {(requestClose: () => void) => (
                    <Suspense fallback={<LazyFallback />}>
                      <Calculator
                          appSettings={appSettings}
                          userPhone={user?.phone}
                          onBack={requestClose}
                          onSaveSettings={handleUpdateSettings}
                      />
                    </Suspense>
                  )}
                </PagePush>
              )}

             {currentView === 'PROFILE' && user && (
      <PagePush onClose={() => setCurrentView(isInvestor ? 'DASHBOARD' : 'MORE')}>
        {(requestClose: () => void) => (
          isInvestor && activeInvestor ? (
            <InvestorDetails
              investor={activeInvestor}
              investors={investors}
              account={getInvestorAccount(user.id, accounts)}
              sales={sales.filter((s: Sale) => s.accountId === getInvestorAccount(user.id, accounts)?.id)}
              expenses={expenses.filter((e: Expense) => e.accountId === getInvestorAccount(user.id, accounts)?.id)}
              customers={customers}
              onBack={requestClose}
              appSettings={appSettings}
            />
          ) : (
            <Profile
              user={user}
              onUpdateProfile={handleUpdateProfile}
              onBack={requestClose}
              onLogout={() => {
                localStorage.removeItem('user');
                localStorage.removeItem('token');
                setUser(null);
              }}

            />
          )
        )}
      </PagePush>
    )}

    {currentView === 'ADMIN_PANEL' && (
      <PagePush onClose={() => setCurrentView(previousView)} showBackButton>
        <Suspense fallback={<LazyFallback />}>
          <AdminPanel/>
        </Suspense>
      </PagePush>
    )}

    {/* 🔹 АДМИН ПАНЕЛЬ ПОДДЕРЖКИ */}
    {currentView === 'ADMIN_SUPPORT' && user?.role === 'admin' && (
      <PagePush onClose={() => setCurrentView(previousView)}>
        {(requestClose: () => void) => (
          <Suspense fallback={<LazyFallback />}>
            <AdminSupportPanel onBack={requestClose} />
          </Suspense>
        )}
      </PagePush>
    )}

    {/* 🔹 МОДАЛЬНОЕ ОКНО ЧАТА ПОДДЕРЖКИ */}
    {showSupportChat && user && (
      <SupportChat
        user={user}
        onClose={() => setShowSupportChat(false)}
        onUnreadChange={setSupportUnreadCount}
      />
    )}

    {/* 🔔 ПАНЕЛЬ УВЕДОМЛЕНИЙ */}
    {showNotificationsPanel && user && (
      <NotificationsPanel
        onClose={() => setShowNotificationsPanel(false)}
        onUnreadChange={setUnreadNotifCount}
        onOpenSettings={() => { setShowNotificationsPanel(false); setCurrentView('SETTINGS'); }}
        onOpenAll={() => { setShowNotificationsPanel(false); setPreviousView(currentView); setCurrentView('NOTIFICATIONS'); }}
      />
    )}

    {/* 🔔 СТРАНИЦА "ВСЕ УВЕДОМЛЕНИЯ" */}
    {currentView === 'NOTIFICATIONS' && user && (
      <PagePush onClose={() => setCurrentView(previousView)} showBackButton>
        {(requestClose: () => void) => (
          <NotificationsPage onBack={requestClose} onUnreadChange={setUnreadNotifCount} />
        )}
      </PagePush>
    )}

    {/* ==================== МОБИЛЬНОЕ МЕНЮ "ЕЩЁ" ==================== */}
    {(currentView === 'MORE' || (previousView === 'MORE' && MORE_PUSH_VIEWS.has(currentView))) && !isInvestor && (
      <div className="space-y-4 animate-fade-in pb-20">

   {/* Профиль */}
<button
  onClick={() => { setPreviousView('MORE'); setCurrentView('PROFILE'); }}
  className="group w-full bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm hover:bg-white/90 dark:hover:bg-slate-800/90
             text-slate-800 dark:text-white p-6 rounded-2xl flex items-center gap-4
             transition-all duration-300 hover:shadow-xl
             border border-slate-200/80 dark:border-slate-700/80 hover:border-[var(--color-primary-400)]
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
      <h2 className="text-xl font-bold text-left text-slate-800 dark:text-white truncate">{user.name}</h2>

      {/* 🔹 Бейдж подписки — использует цвета темы */}
      {!isInvestor && (
        <div
          className={`flex-shrink-0 px-2.5 py-1.5 rounded-xl font-bold text-[10px] flex flex-col items-end leading-tight cursor-pointer transition-all hover:scale-105
            ${subStatus.expired
              ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900/50'
              : subStatus.isWarning
                ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50'
                : 'bg-[var(--color-primary-100)] text-[var(--color-primary-700)] border border-[var(--color-primary-200)]'
            }`}
          onClick={(e) => { e.stopPropagation(); setPreviousView('MORE'); setCurrentView('TARIFFS'); }}
          title="Управление подпиской"
        >
          <span className="font-semibold">{subStatus.planName}</span>
          <span className="text-[9px] opacity-75 mt-0.5">
            {subStatus.expired ? '❌ Истек' : `⏰ ${subStatus.daysLeft} дн.`}
          </span>
        </div>
      )}
    </div>

    <p className="text-slate-500 dark:text-slate-400 text-xs mt-2 text-left flex items-center gap-1">
      <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
      <span className="truncate">{user.email}</span>
    </p>

    {/* 🔹 Прогресс-бар дней — использует цвета темы */}
    {!isInvestor && !subStatus.expired && (
      <div className="mt-3 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
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
    className="text-slate-300 dark:text-slate-600 group-hover:text-[var(--color-primary-500)] transition-colors relative z-10"
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  </div>
</button>

        <div className="space-y-2 pt-4">
          {/* Касса (аккордеон) */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
            <button onClick={() => toggleMoreSection('CASH')}
                    className="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
              <div className="flex items-center gap-3">
                <div className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 p-2 rounded-lg">{ICONS.Wallet}</div>
                <span className="font-semibold text-slate-800 dark:text-white">Касса</span>
              </div>
              <span className={`text-slate-400 dark:text-slate-500 transition-transform ${moreExpandedSection === 'CASH' ? 'rotate-90' : ''}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </span>
            </button>
            {moreExpandedSection === 'CASH' && (
              <div className="bg-slate-50 dark:bg-slate-700/50 border-t border-slate-100 dark:border-slate-700 p-2 space-y-1">
                <button onClick={() => setCurrentView('CASH_REGISTER')}
                        className="w-full text-left px-4 py-3 rounded-lg hover:bg-white dark:hover:bg-slate-700 text-sm text-slate-600 dark:text-slate-300 flex items-center gap-2">
                  <span className="opacity-70">{ICONS.Wallet}</span> Счета
                </button>
                <button onClick={() => handleAction('INCOME')}
                        className="w-full text-left px-4 py-3 rounded-lg hover:bg-white dark:hover:bg-slate-700 text-sm text-slate-600 dark:text-slate-300 flex items-center gap-2">
                  <span className="opacity-70">{ICONS.Income}</span> Приход
                </button>
                <button onClick={() => handleAction('EXPENSE')}
                        className="w-full text-left px-4 py-3 rounded-lg hover:bg-white dark:hover:bg-slate-700 text-sm text-slate-600 dark:text-slate-300 flex items-center gap-2">
                  <span className="opacity-70">{ICONS.Expense}</span> Расход
                </button>
                <button onClick={() => handleAction('OPERATIONS')}
                        className="w-full text-left px-4 py-3 rounded-lg hover:bg-white dark:hover:bg-slate-700 text-sm text-slate-600 dark:text-slate-300 flex items-center gap-2">
                  <span className="opacity-70">{ICONS.List}</span> История
                </button>
              </div>
            )}
          </div>

          {/* Договоры (аккордеон) */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
            <button onClick={() => toggleMoreSection('CONTRACTS')}
                    className="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
              <div className="flex items-center gap-3">
                <div className="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 p-2 rounded-lg">{ICONS.File}</div>
                <span className="font-semibold text-slate-800 dark:text-white">Договоры</span>
              </div>
              <span className={`text-slate-400 dark:text-slate-500 transition-transform ${moreExpandedSection === 'CONTRACTS' ? 'rotate-90' : ''}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </span>
            </button>
            {moreExpandedSection === 'CONTRACTS' && (
              <div className="bg-slate-50 dark:bg-slate-700/50 border-t border-slate-100 dark:border-slate-700 p-2 space-y-1">
                <button onClick={() => handleAction('CREATE_SALE')}
                        className="w-full text-left px-4 py-3 rounded-lg hover:bg-white dark:hover:bg-slate-700 text-sm text-slate-600 dark:text-slate-300 flex items-center gap-2">
                  <span className="opacity-70">{ICONS.AddSmall}</span> Оформить
                </button>
                <button onClick={() => { setPreviousView('MORE'); setCurrentView('CONTRACTS'); setActiveContractTab('ACTIVE'); }}
                        className="w-full text-left px-4 py-3 rounded-lg hover:bg-white dark:hover:bg-slate-700 text-sm text-slate-600 dark:text-slate-300 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2"><span className="opacity-70">{ICONS.Check}</span> Активные</div>
                  {contractCounts.active > 0 && <span className="text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-semibold px-2 py-0.5 rounded-full">{contractCounts.active}</span>}
                </button>
                <button onClick={() => { setPreviousView('MORE'); setCurrentView('CONTRACTS'); setActiveContractTab('OVERDUE'); }}
                        className="w-full text-left px-4 py-3 rounded-lg hover:bg-white dark:hover:bg-slate-700 text-sm text-slate-600 dark:text-slate-300 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2"><span className="opacity-70">{ICONS.Alert}</span> Просроченные</div>
                  {contractCounts.overdue > 0 && <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-semibold px-2 py-0.5 rounded-full">{contractCounts.overdue}</span>}
                </button>
                <button onClick={() => { setPreviousView('MORE'); setCurrentView('CONTRACTS'); setActiveContractTab('ARCHIVE'); }}
                        className="w-full text-left px-4 py-3 rounded-lg hover:bg-white dark:hover:bg-slate-700 text-sm text-slate-600 dark:text-slate-300 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2"><span className="opacity-70">{ICONS.Clock}</span> Архив</div>
                  {contractCounts.archive > 0 && <span className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-semibold px-2 py-0.5 rounded-full">{contractCounts.archive}</span>}
                </button>
                <button onClick={() => { setPreviousView('MORE'); setCurrentView('CONTRACTS'); setActiveContractTab('ALL'); }}
                        className="w-full text-left px-4 py-3 rounded-lg hover:bg-white dark:hover:bg-slate-700 text-sm text-slate-600 dark:text-slate-300 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2"><span className="opacity-70">{ICONS.List}</span> Все</div>
                  {contractCounts.all > 0 && <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-semibold px-2 py-0.5 rounded-full">{contractCounts.all}</span>}
                </button>
              </div>
            )}
          </div>

          {/* Отчеты */}
          <button onClick={() => { setPreviousView('MORE'); setCurrentView('REPORTS'); }}
                  className="w-full bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700">
            <div className="flex items-center gap-3">
              <div className="bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400 p-2 rounded-lg">{ICONS.Dashboard}</div>
              <span className="font-semibold text-slate-800 dark:text-white">Отчеты</span>
            </div>
            <span className="text-slate-400 dark:text-slate-500">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </span>
          </button>


          {/* Инвесторы — только менеджер, сотруднику раздел не нужен */}
          {!isEmployee && (
          <button onClick={() => { setPreviousView('MORE'); setCurrentView('INVESTORS'); }}
                  className="w-full bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700">
            <div className="flex items-center gap-3">
              <div className="bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 p-2 rounded-lg">{ICONS.Users}</div>
              <span className="font-semibold text-slate-800 dark:text-white">Инвесторы</span>
            </div>
            <span className="text-slate-400 dark:text-slate-500">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </span>
          </button>
          )}

          {/* Сотрудники — менеджер на тарифе Бизнес и выше */}
          {user.role === 'manager' && checkAccess('EMPLOYEES') && (
            <button onClick={() => { setPreviousView('MORE'); setCurrentView('EMPLOYEES'); }}
                    className="w-full bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700">
              <div className="flex items-center gap-3">
                <div className="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 p-2 rounded-lg">{ICONS.Employees}</div>
                <span className="font-semibold text-slate-800 dark:text-white">Сотрудники</span>
              </div>
              <span className="text-slate-400 dark:text-slate-500">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </span>
            </button>
          )}

          {/* Задачи — тарифы Бизнес и Бизнес Pro. Сотруднику видны поручения от менеджера */}
          {(user.role === 'manager' || isEmployee) && checkAccess('TASKS') && (
            <button onClick={() => { setPreviousView('MORE'); setCurrentView('TASKS'); }}
                    className="w-full bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700">
              <div className="flex items-center gap-3">
                <div className="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 p-2 rounded-lg">{ICONS.Tasks}</div>
                <span className="font-semibold text-slate-800 dark:text-white">Задачи</span>
              </div>
              <div className="flex items-center gap-2">
                {tasks.filter(t => !t.isDone).length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300">
                    {tasks.filter(t => !t.isDone).length}
                  </span>
                )}
                <span className="text-slate-400 dark:text-slate-500">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </span>
              </div>
            </button>
          )}

          {/* Партнеры (поставщики) — только тариф Бизнес Pro */}
          {user.role === 'manager' && checkAccess('SUPPLIERS') && (
            <button onClick={() => { setPreviousView('MORE'); setCurrentView('SUPPLIERS'); }}
                    className="w-full bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700">
              <div className="flex items-center gap-3">
                <div className="bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 p-2 rounded-lg">{ICONS.Suppliers}</div>
                <span className="font-semibold text-slate-800 dark:text-white">Партнеры</span>
              </div>
              <span className="text-slate-400 dark:text-slate-500">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </span>
            </button>
          )}

          {/* Тарифы */}
          <button onClick={() => { setPreviousView('MORE'); setCurrentView('TARIFFS'); }}
                  className="w-full bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700">
            <div className="flex items-center gap-3">
              <div className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 p-2 rounded-lg">{ICONS.Tariffs}</div>
              <span className="font-semibold text-slate-800 dark:text-white">Тарифы</span>
            </div>
            <span className="text-slate-400 dark:text-slate-500">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </span>
          </button>

          {/* Админ панель (только админ) */}
          {user.role === 'admin' && (
            <button onClick={() => { setPreviousView('MORE'); setCurrentView('ADMIN_PANEL'); }}
                    className="w-full bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700">
              <div className="flex items-center gap-3">
                <div className="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 p-2 rounded-lg">{ICONS.Crown}</div>
                <span className="font-semibold text-slate-800 dark:text-white">Админ панель</span>
              </div>
              <span className="text-slate-400 dark:text-slate-500">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </span>
            </button>
          )}

            {/* 🔹 НОВАЯ КНОПКА: Техподдержка (только для админов) */}
{user.role === 'admin' && (
  <button onClick={() => { setPreviousView('MORE'); setCurrentView('ADMIN_SUPPORT'); }}
          className="w-full bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700">
      <div className="flex items-center gap-3">
          <div className="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 p-2 rounded-lg">{ICONS.Chat}</div>
          <span className="font-semibold text-slate-800 dark:text-white">Техподдержка</span>
      </div>
      <div className="flex items-center gap-2">
          {supportUnreadCount > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 px-1.5 flex items-center justify-center">
                  {supportUnreadCount > 9 ? '9+' : supportUnreadCount}
              </span>
          )}
          <span className="text-slate-400 dark:text-slate-500">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6"/>
              </svg>
          </span>
      </div>
  </button>
)}
{/* Кнопка Техподдержка */}
{user.role === 'manager' && (
<button
  onClick={() => {
    loadSupportUnreadCount(user); // Принудительное обновление
    setShowSupportChat(true);
  }}
  className="w-full bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700 relative"
>
  <div className="flex items-center gap-3">
    <div className="bg-indigo-100 dark:bg-indigo-900/30 p-2 rounded-full text-indigo-600 dark:text-indigo-400">
      {ICONS.Chat}
    </div>
    <span className="font-semibold text-slate-700 dark:text-slate-300">Техподдержка</span>
  </div>

  {/* 🔴 Счётчик непрочитанных */}
  {supportUnreadCount > 0 && (
    <span className="bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 px-1.5 flex items-center justify-center">
      {supportUnreadCount > 9 ? '9+' : supportUnreadCount}
    </span>
  )}
</button>)}

          {/* 🎁 Пригласить друга — только владельцам аккаунта: сотрудники и инвесторы
              приглашать не могут, у них нет своей подписки */}
          {user?.role === 'manager' && (
          <button onClick={() => { setPreviousView('MORE'); setCurrentView('REFERRAL'); }}
                  className="w-full bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700">
            <div className="flex items-center gap-3">
              <div className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 p-2 rounded-lg">{ICONS.Star}</div>
              <div className="text-left">
                <span className="font-semibold text-slate-800 dark:text-white block">Пригласить друга</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">+10 дней подписки за каждого</span>
              </div>
            </div>
            <span className="text-slate-400 dark:text-slate-500">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </span>
          </button>)}

          {/* Настройки */}
          <button onClick={() => { setPreviousView('MORE'); setCurrentView('SETTINGS'); }}
                  className="w-full bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700">
            <div className="flex items-center gap-3">
              <div className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 p-2 rounded-lg">{ICONS.Settings}</div>
              <span className="font-semibold text-slate-800 dark:text-white">Настройки</span>
            </div>
            <span className="text-slate-400 dark:text-slate-500">
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
      className="bg-white dark:bg-slate-800 w-full max-w-sm p-6 rounded-2xl shadow-2xl animate-scale-in"
      onClick={e => e.stopPropagation()}
    >
      {/* 🔴 Иконка предупреждения */}
      <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </div>

      {/* 🔹 Заголовок */}
      <h3 className="text-lg font-bold text-slate-800 dark:text-white text-center mb-2">
        Удалить клиента?
      </h3>

      {/* 🔹 Текст предупреждения */}
      <p className="text-center text-slate-500 dark:text-slate-400 mb-6 text-sm leading-relaxed">
        Это действие <strong className="text-slate-700 dark:text-slate-300">нельзя отменить</strong>.<br/>
        Все данные клиента будут удалены безвозвратно.
      </p>

      {/* 🔹 Кнопки действий */}
      <div className="flex gap-3">
        <button
          onClick={() => setShowDeleteConfirm(null)}
          className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-300"
        >
          Отмена
        </button>
        <button
          onClick={confirmDeleteCustomer}
          className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors shadow-lg shadow-red-200 dark:shadow-red-900/30 focus:outline-none focus:ring-2 focus:ring-red-300"
        >
          Да, удалить
        </button>
      </div>
    </div>
  </div>
)}

{/* 🎁 Поздравление с реферальной наградой */}
{referralBonus && (
  <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-fade-in">
    <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-3xl shadow-2xl p-7 text-center space-y-5 animate-dialog-in">
      <SuccessCheck size={84} />

      <div className="animate-stage-in" style={{ animationDelay: '0.55s' }}>
        <h3 className="text-2xl font-bold text-slate-800 dark:text-white">Спасибо за приглашение!</h3>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
          {referralBonus.count === 1
            ? 'Приглашённый вами пользователь оплатил подписку'
            : `Приглашённые вами пользователи (${referralBonus.count}) оплатили подписку`}
        </p>

        <div className="mt-5 bg-gradient-to-br from-emerald-500 to-green-500 rounded-2xl py-5 text-white">
          <p className="text-4xl font-bold">+{referralBonus.days}</p>
          <p className="text-emerald-50 text-sm mt-0.5">
            {referralBonus.days % 10 === 1 && referralBonus.days % 100 !== 11 ? 'день' :
             [2,3,4].includes(referralBonus.days % 10) && ![12,13,14].includes(referralBonus.days % 100) ? 'дня' : 'дней'}
            {' '}подписки уже начислено
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 animate-stage-in" style={{ animationDelay: '0.7s' }}>
        <button
          onClick={async () => {
            setReferralBonus(null);
            try { await api.markReferralPendingSeen(); } catch { /* повторим при следующем входе */ }
            setPreviousView('MORE');
            setCurrentView('REFERRAL');
          }}
          className="btn-press w-full py-3.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700"
        >
          Пригласить ещё
        </button>
        <button
          onClick={async () => {
            setReferralBonus(null);
            try { await api.markReferralPendingSeen(); } catch { /* повторим при следующем входе */ }
          }}
          className="w-full py-2.5 text-slate-400 dark:text-slate-500 text-sm font-medium hover:text-slate-600 dark:hover:text-slate-300"
        >
          Закрыть
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

{paymentReturnStatus && (
  <div
    className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
    onClick={() => paymentReturnStatus !== 'checking' && setPaymentReturnStatus(null)}
  >
    <div
      className="bg-white dark:bg-slate-800 w-full max-w-md rounded-2xl shadow-2xl p-6 space-y-5 animate-scale-in text-center"
      onClick={e => e.stopPropagation()}
    >
      {paymentReturnStatus === 'checking' && (
        <>
          <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-full flex items-center justify-center mx-auto">
            <svg className="animate-spin h-8 w-8" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-slate-800 dark:text-white">Проверяем оплату…</h3>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              Платёжная система подтверждает операцию — это займёт до минуты.
            </p>
          </div>
        </>
      )}

      {paymentReturnStatus === 'success' && (
        <>
          <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto text-3xl">
            🎉
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-slate-800 dark:text-white">Оплата прошла успешно!</h3>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              {user?.subscription
                ? `Тариф "${{ TRIAL: 'Пробный', START: 'Старт', STANDARD: 'Стандарт', BUSINESS: 'Бизнес' }[user.subscription.plan] || user.subscription.plan}" активирован до ${new Date(user.subscription.expiresAt).toLocaleDateString('ru-RU')}.`
                : 'Ваш тариф обновлён.'}
            </p>
          </div>
          <button
            onClick={() => setPaymentReturnStatus(null)}
            className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold shadow-lg shadow-indigo-200 dark:shadow-indigo-900/30 transition-all hover:scale-105 active:scale-95"
          >
            Отлично
          </button>
        </>
      )}

      {paymentReturnStatus === 'timeout' && (
        <>
          <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-full flex items-center justify-center mx-auto text-3xl">
            ⏳
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-slate-800 dark:text-white">Платёж обрабатывается</h3>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              Оплата принята, но подтверждение от платёжной системы ещё не пришло. Обычно это занимает пару минут —
              тариф обновится автоматически, либо проверьте ещё раз.
            </p>
          </div>
          <div className="flex gap-3 pt-1">
            <button
              onClick={() => setPaymentReturnStatus(null)}
              className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 rounded-xl font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
            >
              Закрыть
            </button>
            <button
              onClick={checkPaymentReturn}
              className="flex-1 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold shadow-lg shadow-indigo-200 dark:shadow-indigo-900/30 transition-all"
            >
              Проверить снова
            </button>
          </div>
        </>
      )}
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
                       className="bg-white dark:bg-slate-800 w-full max-w-sm p-6 rounded-2xl shadow-2xl animate-scale-in"
      onClick={e => e.stopPropagation()}
    >
      {/* 🔴 Иконка предупреждения */}
      <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>

      {/* 🔹 Заголовок */}
      <h3 className="text-lg font-bold text-slate-800 dark:text-white text-center mb-1">
        Невозможно удалить
      </h3>
      <p className="text-center text-slate-500 dark:text-slate-400 mb-4 text-sm">
        У клиента <strong>{showBlockedDeleteModal.customerName}</strong> есть активные договоры
      </p>

      {/* 🔹 Список договоров */}
      <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-4 mb-6 max-h-48 overflow-y-auto">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2 uppercase">
          Привязанные договоры ({showBlockedDeleteModal.contracts.length})
        </p>
        <ul className="space-y-2">
          {showBlockedDeleteModal.contracts.map(contract => (
            <li
              key={contract.id}
              className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 px-3 py-2 rounded-lg border border-slate-100 dark:border-slate-700"
            >
              <span className="text-slate-400 dark:text-slate-500 flex-shrink-0">
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
      <p className="text-center text-slate-500 dark:text-slate-400 text-sm mb-6">
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
          className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
        >
          Перейти к договорам
        </button>
        <button
          onClick={() => setShowBlockedDeleteModal(null)}
          className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200 dark:shadow-indigo-900/30"
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
    cancelLabel={notificationData.cancelLabel}
  />
)}











{showTemplateUpdateModal && (
  <div
    className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/40 backdrop-blur-md animate-fade-in"
    onClick={() => setShowTemplateUpdateModal(false)}
  >
    <div
      className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl w-full max-w-sm rounded-[32px] shadow-2xl shadow-black/20 border border-white/20 dark:border-white/10 overflow-hidden animate-scale-in"
      onClick={e => e.stopPropagation()}
    >
      <div className="p-6">
        {/* Заголовок с новым пузырьковым стилем */}
        <div className="flex items-center gap-4 mb-6">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-violet-400 via-purple-400 to-pink-400 flex items-center justify-center text-3xl shadow-lg shadow-purple-500/20">
            ✨
          </div>
          <div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">
              Обновление дизайна
            </h3>
            <p className="text-sm text-gray-500 dark:text-slate-400 font-medium">
              Новый стиль
            </p>
          </div>
        </div>

        {/* Список обновлений в стиле карточек */}
        <div className="space-y-4 mb-6">
          

          <div className="flex items-start gap-4 p-4 rounded-2xl bg-gradient-to-br from-emerald-50/50 to-teal-50/50 dark:from-emerald-950/30 dark:to-teal-950/30 border border-emerald-200/50 dark:border-emerald-800/30">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-teal-400 flex items-center justify-center text-xl shadow-md flex-shrink-0">
              📱
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
                Если у кого не правильно показывает стили переустановите приложение
              </p>
            </div>
          </div>
        </div>

        {/* Кнопка в новом стиле */}
        <button
          onClick={() => setShowTemplateUpdateModal(false)}
          className="w-full py-3.5 bg-gradient-to-r from-violet-600 via-purple-600 to-pink-600 text-white font-bold rounded-2xl shadow-lg shadow-purple-500/30 active:scale-[0.97] transition-all duration-200 text-base tracking-wide"
        >
          🔥 Отлично!
        </button>
      </div>
    </div>
  </div>
)}












  </Layout>
);


};

export default App;