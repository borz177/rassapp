import React, { useState, useEffect, Suspense, lazy } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { AppSettings, ViewState, User, NotificationSettings, NotificationEventToggles } from '../types';
import { ICONS, APP_VERSION, THEMES } from '../constants';
import ContractTemplatePicker from './ContractTemplatePicker';
import { getSellerPhone, formatRuPhone } from '../src/utils';
import { PrivacyPolicy, DataProcessingAgreement, ClientDataTerms, PublicOffer } from './LegalDocs';
import { api } from '../services/api';
import { offlineStorage } from '../services/offlineStorage';
import { useTheme, ThemeMode } from '../src/theme/ThemeContext';

// 🔹 Тянут xlsx — грузим только когда реально открыли импорт/экспорт
const DataImport = lazy(() => import('./DataImport'));
const DataExport = lazy(() => import('./DataExport'));
// Карточка сама ходит на /api/backup/settings — грузим лениво, чтобы запрос уходил
// только у тех, кто действительно открыл раздел настроек.
const BackupSettingsCard = lazy(() => import('./BackupSettingsCard'));

interface SettingsProps {
  appSettings: AppSettings;
  /** Разрешает ли тариф магазин. Решение принимает App — здесь только вид. */
  shopAllowed?: boolean;
  /** Вторая печатная форма договора — со «Стандарта» и выше */
  contractTemplatesAllowed?: boolean;
  onUpdateSettings: (settings: AppSettings) => void;
  onNavigate: (view: ViewState) => void;
  onSettingsChanged?: () => void;
  currentUserId?: string;
  user?: User | null;
}

const APPEARANCE_OPTIONS: { key: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { key: 'light', label: 'Светлая', icon: <Sun size={20} /> },
  { key: 'dark', label: 'Тёмная', icon: <Moon size={20} /> },
  { key: 'system', label: 'Системная', icon: <Monitor size={20} /> },
];

const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  events: {
    payment: true,
    newContract: true,
    contractClosed: true,
    expense: true,
    whatsappSent: true,
    adminBroadcast: true,
    supportMessage: true,
    taskDue: true,
  },
};

// adminOnly — событие имеет смысл только для админа (у него нет своих договоров/платежей,
// зато есть входящие обращения в техподдержку от остальных пользователей).
const NOTIFICATION_EVENT_ROWS: { key: keyof NotificationEventToggles; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
  { key: 'payment', label: 'Платёж', icon: ICONS.Income },
  { key: 'newContract', label: 'Новый договор', icon: ICONS.File },
  { key: 'contractClosed', label: 'Договор закрыт', icon: ICONS.CheckCircle },
  { key: 'expense', label: 'Расход', icon: ICONS.Expense },
  { key: 'whatsappSent', label: 'WhatsApp-напоминания', icon: ICONS.Chat },
  { key: 'taskDue', label: 'Напоминания о задачах', icon: ICONS.Tasks },
  { key: 'adminBroadcast', label: 'От администратора', icon: ICONS.Megaphone },
  { key: 'supportMessage', label: 'Сообщения от пользователей', icon: ICONS.Chat, adminOnly: true },
];

// 🔹 Свёрнутая по умолчанию карточка настроек — раскрывается по клику на шапку. Название
// компании остаётся открытой картой (задаётся через defaultOpen на месте использования),
// все остальные сворачиваются, чтобы страница не выглядела "россыпью" из полутора десятков
// одинаковых блоков.
/**
 * Строка настройки: слева значок, в середине название с пояснением, справа
 * стрелка. Раскрытая настройка показывает своё содержимое под строкой.
 *
 * Раньше каждая настройка была карточкой в 130 пикселей с крупным заголовком:
 * на телефоне экран превращался в россыпь одинаковых плиток на полтора экрана,
 * а пояснения всё равно обрезались. Строка втрое ниже, значок даёт зацепку
 * глазу, и весь список настроек виден почти целиком.
 */
const ROW = 'w-full flex items-center gap-3 p-3.5 text-left';
const ROW_ICON = 'w-9 h-9 shrink-0 rounded-xl flex items-center justify-center';
const ROW_TITLE = 'block text-[15px] font-semibold text-slate-800 dark:text-white truncate';
const ROW_SUB = 'block text-xs text-slate-500 dark:text-slate-400 truncate';
const CHEVRON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

/**
 * Группа настроек — одна карточка, строки внутри разделены линиями.
 *
 * Так список читается как список, а не как россыпь одинаковых плиток: рамка
 * одна на группу, а не на каждую строку.
 */
const GroupContext = React.createContext(false);

const SettingsGroup: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <GroupContext.Provider value={true}>
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700">
      {children}
    </div>
  </GroupContext.Provider>
);

const SettingsAccordion: React.FC<{
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  /** Значок слева: по нему настройку находят глазами, не читая все подряд */
  icon?: React.ReactNode;
  /** Цвета значка — фон и цвет линии */
  tone?: string;
  children: React.ReactNode;
}> = ({ title, subtitle, badge, defaultOpen = false, icon, tone = 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300', children }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const inGroup = React.useContext(GroupContext);
  return (
    <div className={inGroup ? '' : 'bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden'}>
      <button onClick={() => setIsOpen(o => !o)} className={ROW}>
        {icon && <span className={`${ROW_ICON} ${tone}`}>{icon}</span>}
        <span className="min-w-0 flex-1">
          <span className={ROW_TITLE}>{title}</span>
          {subtitle && <span className={ROW_SUB}>{subtitle}</span>}
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {badge}
          <span className={`text-slate-400 dark:text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
            {CHEVRON}
          </span>
        </span>
      </button>
      {isOpen && (
        <div className="px-4 pb-4 pt-3 border-t border-slate-100 dark:border-slate-700 animate-fade-in">{children}</div>
      )}
    </div>
  );
};

/** Настройка, которая живёт на своём экране: та же строка, но переходом. */
const SettingsLink: React.FC<{
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  tone: string;
  onClick: () => void;
}> = ({ title, subtitle, icon, tone, onClick }) => {
  const inGroup = React.useContext(GroupContext);
  return (
  <button onClick={onClick}
          className={`${ROW} ${inGroup ? 'active:bg-slate-50 dark:active:bg-slate-700/50' : 'bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 active:scale-[0.99] transition-transform'}`}>
    <span className={`${ROW_ICON} ${tone}`}>{icon}</span>
    <span className="min-w-0 flex-1">
      <span className={ROW_TITLE}>{title}</span>
      {subtitle && <span className={ROW_SUB}>{subtitle}</span>}
    </span>
    <span className="shrink-0 text-slate-300 dark:text-slate-600 -rotate-90">{CHEVRON}</span>
  </button>
  );
};

// 🔔 VAPID-ключ сервера приходит в urlsafe-base64 — pushManager.subscribe() ждёт Uint8Array
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

const Settings: React.FC<SettingsProps> = ({ appSettings, shopAllowed = false, contractTemplatesAllowed = true, onUpdateSettings, onNavigate, onSettingsChanged, currentUserId, user }) => {
  const isEmployee = user?.role === 'employee';
  const hasNotificationsAccess = user?.role === 'admin' || user?.role === 'employee' || user?.role === 'investor'
    || user?.subscription?.plan !== 'START';
  const notifSettings = appSettings.notifications || DEFAULT_NOTIFICATION_SETTINGS;
  const updateNotifSettings = (patch: Partial<NotificationSettings>) => {
    onUpdateSettings({ ...appSettings, notifications: { ...notifSettings, ...patch } });
  };
  const updateNotifEvent = (key: keyof NotificationEventToggles, value: boolean) => {
    onUpdateSettings({ ...appSettings, notifications: { ...notifSettings, events: { ...notifSettings.events, [key]: value } } });
  };

  // 🔔📱 Push-уведомления на устройство
  const [pushDeviceCount, setPushDeviceCount] = useState<number | null>(null);
  const [isCurrentDeviceSubscribed, setIsCurrentDeviceSubscribed] = useState(false);
  const [isPushBusy, setIsPushBusy] = useState(false);

  useEffect(() => {
    if (!hasNotificationsAccess) return;
    (async () => {
      try {
        const subs = await api.getPushSubscriptions();
        setPushDeviceCount(subs.length);
      } catch (e) { /* тихо игнорируем — не критично для остальной страницы */ }
      try {
        if ('serviceWorker' in navigator && 'PushManager' in window) {
          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.getSubscription();
          setIsCurrentDeviceSubscribed(!!sub);
        }
      } catch (e) { /* браузер без поддержки push — просто не показываем состояние */ }
    })();
  }, [hasNotificationsAccess]);

  const handleSubscribeDevice = async () => {
    if (isPushBusy) return;
    setIsPushBusy(true);
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        alert('Этот браузер не поддерживает push-уведомления');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        alert('Разрешение на уведомления не выдано');
        return;
      }
      const { publicKey } = await api.getPushPublicKey();
      if (!publicKey) {
        alert('Push-уведомления временно недоступны на сервере');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await api.subscribePush(sub.toJSON() as PushSubscriptionJSON);
      setIsCurrentDeviceSubscribed(true);
      setPushDeviceCount(prev => (prev ?? 0) + 1);
    } catch (e) {
      console.error('Push subscribe error:', e);
      alert('Не удалось подписать устройство на push-уведомления');
    } finally {
      setIsPushBusy(false);
    }
  };

  const handleUnsubscribeDevice = async () => {
    if (isPushBusy) return;
    setIsPushBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.unsubscribePush(sub.endpoint);
        await sub.unsubscribe();
      }
      setIsCurrentDeviceSubscribed(false);
      setPushDeviceCount(prev => Math.max(0, (prev ?? 1) - 1));
    } catch (e) {
      console.error('Push unsubscribe error:', e);
      alert('Не удалось отписать устройство');
    } finally {
      setIsPushBusy(false);
    }
  };

  const [companyName, setCompanyName] = useState(appSettings.companyName);
  const { mode: themeMode, setMode: setThemeMode } = useTheme();

  // Clear Data Modal State
  const [showClearModal, setShowClearModal] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [confirmCooldown, setConfirmCooldown] = useState(0);

  // 🗑 Удаление учётной записи
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [deleteCooldown, setDeleteCooldown] = useState(0);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmWord, setDeleteConfirmWord] = useState('');
  const [deleteError, setDeleteError] = useState('');

  // 👇 ДОБАВИЛИ: состояния для модалок импорта и экспорта
  const [showImportModal, setShowImportModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);

  // 🆕 СОСТОЯНИЕ ДЛЯ ОБНОВЛЕНИЯ ПРИЛОЖЕНИЯ
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);

  // Legal Docs View State
  const [legalView, setLegalView] = useState<'NONE' | 'PRIVACY' | 'AGREEMENT' | 'CLIENT_DATA' | 'OFFER'>('NONE');

  useEffect(() => {
    setCompanyName(appSettings.companyName);
  }, [appSettings]);

  useEffect(() => {
    if (showClearModal) {
      setConfirmCooldown(10);

      const timer = setInterval(() => {
        setConfirmCooldown(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [showClearModal]);

  // 🗑 Удаление учётной записи. Отсчёт длиннее, чем при сбросе данных (15 против 10):
  // сброс оставляет аккаунт, а это действие необратимо и сносит ещё и сотрудников.
  useEffect(() => {
    if (showDeleteAccountModal) {
      setDeleteCooldown(15);
      const timer = setInterval(() => {
        setDeleteCooldown(prev => {
          if (prev <= 1) { clearInterval(timer); return 0; }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [showDeleteAccountModal]);

  const handleDeleteAccount = async () => {
    if (deleteCooldown > 0 || isDeletingAccount) return;
    setIsDeletingAccount(true);
    setDeleteError('');
    try {
      await api.deleteAccount(deletePassword);
      // Аккаунта больше нет — чистим локальные следы и уводим на экран входа.
      // Без этого приложение осталось бы с токеном несуществующего пользователя.
      try { await offlineStorage.wipeEverything(); } catch { /* не критично */ }
      localStorage.clear();
      window.location.href = '/';
    } catch (e: any) {
      setDeleteError(e?.message || 'Не удалось удалить учётную запись');
      setIsDeletingAccount(false);
    }
  };

  // 🆕 ЭФФЕКТ ДЛЯ АНИМАЦИИ ПРОГРЕССА ОБНОВЛЕНИЯ
  useEffect(() => {
    if (isUpdating) {
      const interval = setInterval(() => {
        setUpdateProgress(prev => {
          if (prev >= 100) {
            clearInterval(interval);
            // После завершения анимации — перезагружаем страницу
            setTimeout(() => {
              window.location.reload();
            }, 500);
            return 100;
          }
          return prev + 5; // Увеличиваем на 5% каждые 100мс = 2 секунды до 100%
        });
      }, 100);

      return () => clearInterval(interval);
    }
  }, [isUpdating]);

  const handleSave = () => {
    onUpdateSettings({
        ...appSettings,
        companyName
    });
    onSettingsChanged?.();
    alert("Настройки сохранены!");
  };

  const handleThemeChange = (themeKey: 'PURPLE' | 'BLUE' | 'GREEN' | 'BLACK') => {
      onUpdateSettings({
          ...appSettings,
          theme: themeKey
      });
  };

  const handleClearData = async () => {
    if (confirmCooldown > 0 || isClearing) return;

    setIsClearing(true);
    try {
        await api.resetAccountData();

        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const registration of registrations) {
                await registration.unregister();
            }
        }

        if ('indexedDB' in window) {
            const dbNames = await window.indexedDB.databases?.().then(dbs => dbs.map(db => db.name)) || [];
            dbNames.forEach(dbName => {
                if (dbName) {
                    const request = window.indexedDB.deleteDatabase(dbName);
                    request.onerror = () => console.error('Failed to delete DB:', dbName);
                }
            });
        }

        localStorage.removeItem('token');
        localStorage.removeItem('user');
        sessionStorage.clear();

        if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
        }

        window.location.href = '/';

    } catch (error) {
        console.error('Clear data error:', error);
        alert("Ошибка при очистке данных. Попробуйте снова.");
        setIsClearing(false);
    }
  };

  // 🆕 ОБНОВЛЁННАЯ ФУНКЦИЯ ОБНОВЛЕНИЯ ПРИЛОЖЕНИЯ
  const handleForceUpdate = () => {
      setUpdateProgress(0);
      setIsUpdating(true);
  };

  const handleCloseClearModal = () => {
      setShowClearModal(false);
      setConfirmCooldown(0);
  };

  if (legalView === 'PRIVACY') {
      return <PrivacyPolicy onBack={() => setLegalView('NONE')} />;
  }

  if (legalView === 'AGREEMENT') {
      return <DataProcessingAgreement onBack={() => setLegalView('NONE')} />;
  }

  if (legalView === 'OFFER') {
      return <PublicOffer onBack={() => setLegalView('NONE')} />;
  }

  if (legalView === 'CLIENT_DATA') {
      return <ClientDataTerms onBack={() => setLegalView('NONE')} />;
  }

  return (
    <div className="space-y-2.5 animate-fade-in pb-20">
      <header className="flex justify-between items-start">
        <div>
            <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Настройки</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm">Версия: {APP_VERSION}</p>
        </div>
        <button
            onClick={handleForceUpdate}
            disabled={isUpdating}
            className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-3 py-2 rounded-lg font-medium hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
            {isUpdating ? (
                <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    Обновление...
                </>
            ) : (
                <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>
                    </svg>
                    Обновить приложение
                </>
            )}
        </button>
      </header>

      {/* Настройки компании и её вид */}
      <SettingsGroup>
      {/* Company Name — единственная карточка, открытая по умолчанию */}
      <SettingsAccordion title="Название компании" subtitle="В заголовке и в сообщениях" defaultOpen icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M15 9h.01M9 13h.01M15 13h.01M10 21v-4h4v4" /></svg>} tone="bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300">
        <div className="flex gap-2">
            <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="flex-1 p-3 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Название вашей компании"
            />
            <button
                onClick={handleSave}
                className="bg-indigo-600 text-white px-4 rounded-xl font-bold hover:bg-indigo-700"
            >
                OK
            </button>
        </div>
      </SettingsAccordion>

      {/* Display Settings */}
      <SettingsAccordion title="Отображение" icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h16M4 18h10" /><circle cx="17" cy="18" r="2" /></svg>} tone="bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300">
          {/* Магазин выключен по умолчанию: большинству он не нужен, а лишние
              разделы в меню только мешают. На тарифах ниже Бизнес Про переключатель
              показывается заблокированным — так видно, что функция есть, но
              требует тарифа, вместо того чтобы просто отсутствовать. */}
          {/* Магазин и его вложенная настройка — одна группа: черта отделяет её
              целиком, а не вклинивается между родителем и потомком. */}
          <div className="mb-5 pb-5 border-b border-slate-100 dark:border-slate-700 space-y-4">
          <div className="flex items-center justify-between">
              <div className="pr-3">
                  <p className="font-medium text-slate-700 dark:text-slate-300">
                      Магазин и склад
                      {!shopAllowed && (
                          <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 align-middle">
                              Бизнес Про
                          </span>
                      )}
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                      Розничные продажи за наличные и учёт остатков товаров
                  </p>
              </div>
              <label className={`relative inline-flex items-center ${shopAllowed ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                  <input
                      type="checkbox"
                      className="sr-only peer"
                      disabled={!shopAllowed}
                      checked={shopAllowed && (appSettings.shopEnabled ?? false)}
                      onChange={(e) => onUpdateSettings({ ...appSettings, shopEnabled: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-slate-200 dark:bg-slate-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
          </div>

          {/* Вложенная настройка: у одних магазин — подсобная часть дела, у
              других основное занятие. Первым половина главного экрана под кассу
              только мешала бы, вторым без неё пришлось бы каждый раз идти в меню. */}
          {shopAllowed && appSettings.shopEnabled && (
          <div className="flex items-center justify-between gap-3 pl-4 border-l-2 border-indigo-200 dark:border-indigo-900/60">
              <div>
                  <p className="font-medium text-slate-700 dark:text-slate-300">Вкладка «Наличные» на главном</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                      Касса и сводка по рознице прямо в «Обзоре», без захода в меню
                  </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                  <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={appSettings.shopDashboardTab ?? false}
                      onChange={(e) => onUpdateSettings({ ...appSettings, shopDashboardTab: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-slate-200 dark:bg-slate-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
          </div>
          )}

          {/* Второй вложенный переключатель: остаток на то и остаток, чтобы ему
              верили. Но у кого пересчёт вечно откладывается, тому запрет мешает
              работать — пусть решает сам. */}
          {shopAllowed && appSettings.shopEnabled && (
          <div className="flex items-center justify-between gap-3 pl-4 border-l-2 border-indigo-200 dark:border-indigo-900/60">
              <div>
                  <p className="font-medium text-slate-700 dark:text-slate-300">Продажа в минус</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                      Разрешить брать товара больше, чем числится на складе. Выключено — остаток не уйдёт ниже нуля
                  </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                  <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={appSettings.shopAllowNegativeStock ?? false}
                      onChange={(e) => onUpdateSettings({ ...appSettings, shopAllowNegativeStock: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-slate-200 dark:bg-slate-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
          </div>
          )}
          </div>

          <div className="flex items-center justify-between gap-3">
              <div>
                  <p className="font-medium text-slate-700 dark:text-slate-300">Показывать копейки</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Отображать дробную часть в суммах (например, 100.50 ₽)</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                  <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={appSettings.showCents ?? false}
                      onChange={(e) => onUpdateSettings({ ...appSettings, showCents: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-slate-200 dark:bg-slate-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
          </div>
          <div className="flex items-center justify-between gap-3 mt-5 pt-5 border-t border-slate-100 dark:border-slate-700">
              <div>
                  <p className="font-medium text-slate-700 dark:text-slate-300">Наценка от суммы за вычетом взноса</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Начислять % не на весь закуп, а только на часть, которая идёт в рассрочку (закуп − взнос)</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                  <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={appSettings.markupFromNetBuyPrice ?? false}
                      onChange={(e) => onUpdateSettings({ ...appSettings, markupFromNetBuyPrice: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-slate-200 dark:bg-slate-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
          </div>
      </SettingsAccordion>

      {/* Когда договор приносит прибыль. Рядом с наценкой: оба про счёт, а не про вид. */}
      <SettingsAccordion
        title="Прибыль по договорам"
        subtitle={appSettings.profitFromPaymentsOnly ? 'Только с платежей' : 'С первого взноса и платежей'}
        icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 7-7" /><path d="M14 8h7v7" /></svg>}
        tone="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-300"
      >
          <div className="space-y-2">
              {([
                { value: false, label: 'С первого взноса и платежей',
                  hint: 'Как было всегда: прибыль распределена по всей сумме договора' },
                { value: true, label: 'Только с платежей',
                  hint: 'Первый взнос идёт в счёт закупа, а вся наценка признаётся по платежам графика' },
              ] as const).map(opt => {
                const active = !!appSettings.profitFromPaymentsOnly === opt.value;
                return (
                  <label key={String(opt.value)} className={`flex items-start gap-2.5 p-3 rounded-xl border-2 cursor-pointer ${
                      active ? 'border-emerald-600 bg-white dark:bg-slate-900' : 'border-slate-200 dark:border-slate-600 bg-white/60 dark:bg-slate-900/40'
                  }`}>
                      <input
                        type="radio"
                        name="profitRecognition"
                        className="mt-0.5 w-4 h-4 text-emerald-600 focus:ring-emerald-500"
                        checked={active}
                        onChange={() => onUpdateSettings({ ...appSettings, profitFromPaymentsOnly: opt.value })}
                      />
                      <span className="min-w-0">
                          <span className="block text-sm font-medium text-slate-700 dark:text-slate-300">{opt.label}</span>
                          <span className="block text-xs text-slate-500 dark:text-slate-400">{opt.hint}</span>
                      </span>
                  </label>
                );
              })}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">
              Общая прибыль договора не меняется — меняется только момент, когда она
              признаётся. Настройка действует и на прошлые договоры: их прибыль
              пересчитается по выбранному правилу, в том числе у инвесторов.
          </p>
      </SettingsAccordion>

      </SettingsGroup>

      {/* Рассылки и копии — то, что приложение делает само */}
      <SettingsGroup>
      {/* Резервное копирование — как и уведомления, только для владельца данных:
          рассылка идёт по базе менеджера, и настраивать её сотруднику нечего.
          Состояние живёт на сервере (backup_settings), поэтому карточка грузит его сама. */}
      {(user?.role === 'manager' || user?.role === 'admin') && (
      <SettingsAccordion
          title="Резервное копирование"
        icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m8 11 4 4 4-4" /><path d="M20 16.5A3.5 3.5 0 0 0 16.5 13h-.7A5.5 5.5 0 1 0 6 17h11a3 3 0 0 0 3-.5z" /></svg>} tone="bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-300"
          subtitle="Excel на почту по расписанию"
      >
          <Suspense fallback={<p className="text-sm text-slate-500 dark:text-slate-400">Загрузка…</p>}>
              <BackupSettingsCard onNavigate={onNavigate} />
          </Suspense>
      </SettingsAccordion>
      )}

      {/* Notifications — доступно только владельцу тенанта (менеджер/админ): у сотрудников и
          инвесторов тумблеры сохранялись бы под их собственным settings-id и не влияли бы на
          реальную рассылку событий, которая всегда идёт от имени менеджера */}
      {(user?.role === 'manager' || user?.role === 'admin') && (
      <SettingsAccordion
          title="Уведомления"
        icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>} tone="bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-300"
          subtitle="Платежи, договоры, расходы"
          badge={!hasNotificationsAccess && (
              <span className="flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded-full">
                  {ICONS.Crown} Стандарт+
              </span>
          )}
      >
          {!hasNotificationsAccess ? (
              <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-dashed border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-3">
                      <div className="bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 p-2 rounded-lg">{ICONS.Crown}</div>
                      <div>
                          <p className="font-medium text-slate-700 dark:text-slate-300 text-sm">Доступно с тарифа Стандарт</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">Оформите тариф, чтобы получать уведомления о событиях</p>
                      </div>
                  </div>
                  <button
                      onClick={() => onNavigate('TARIFFS')}
                      className="shrink-0 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
                  >
                      Тарифы
                  </button>
              </div>
          ) : (
              <>
                  <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-700">
                      <div>
                          <p className="font-medium text-slate-700 dark:text-slate-300">Уведомления в приложении</p>
                          <p className="text-sm text-slate-500 dark:text-slate-400">Показывать колокольчик и ленту уведомлений</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                          <input
                              type="checkbox"
                              className="sr-only peer"
                              checked={notifSettings.enabled}
                              onChange={(e) => updateNotifSettings({ enabled: e.target.checked })}
                          />
                          <div className="w-11 h-6 bg-slate-200 dark:bg-slate-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                      </label>
                  </div>

                  <div className={`mt-4 space-y-3 ${!notifSettings.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
                      <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase">Какие события присылать</p>
                      {NOTIFICATION_EVENT_ROWS.filter(row => !row.adminOnly || user?.role === 'admin').map(row => (
                          <div key={row.key} className="flex items-center justify-between">
                              <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                                  <span className="text-slate-400 dark:text-slate-500">{row.icon}</span>
                                  {row.label}
                              </div>
                              <label className="relative inline-flex items-center cursor-pointer">
                                  <input
                                      type="checkbox"
                                      className="sr-only peer"
                                      checked={notifSettings.events[row.key]}
                                      onChange={(e) => updateNotifEvent(row.key, e.target.checked)}
                                  />
                                  <div className="w-11 h-6 bg-slate-200 dark:bg-slate-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                              </label>
                          </div>
                      ))}
                  </div>

                  <div className="flex items-center justify-between mt-5 pt-4 border-t border-slate-100 dark:border-slate-700">
                      <div>
                          <p className="font-medium text-slate-700 dark:text-slate-300">Push-уведомления на устройстве</p>
                          <p className="text-sm text-slate-500 dark:text-slate-400">Приходят, даже когда вкладка закрыта — если приложение установлено как PWA</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-3">
                          <input
                              type="checkbox"
                              className="sr-only peer"
                              checked={notifSettings.pushEnabled ?? true}
                              onChange={(e) => updateNotifSettings({ pushEnabled: e.target.checked })}
                          />
                          <div className="w-11 h-6 bg-slate-200 dark:bg-slate-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                      </label>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40">
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                          {pushDeviceCount === null
                              ? 'Загрузка...'
                              : pushDeviceCount === 0
                                  ? 'На этом аккаунте пока нет устройств, подписанных на push'
                                  : `Подписано устройств: ${pushDeviceCount}`}
                      </p>
                      {isCurrentDeviceSubscribed ? (
                          <button
                              onClick={handleUnsubscribeDevice}
                              disabled={isPushBusy}
                              className="shrink-0 px-3 py-2 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-lg text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
                          >
                              Отписать это устройство
                          </button>
                      ) : (
                          <button
                              onClick={handleSubscribeDevice}
                              disabled={isPushBusy}
                              className="shrink-0 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5"
                          >
                              {ICONS.Bell} Подписать это устройство
                          </button>
                      )}
                  </div>
              </>
          )}
      </SettingsAccordion>
      )}

      </SettingsGroup>

      {/* Как приложение выглядит — на экране и на бумаге */}
      <SettingsGroup>
      {/* Appearance / Dark Mode Selection */}
      {/* Форма договора — рядом с оформлением: это тоже про то, как приложение
          выглядит снаружи, только на бумаге, а не на экране. */}
      <SettingsAccordion title="Печатная форма договора" subtitle="Бланк для печати и отправки" icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h6" /></svg>} tone="bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-300">
          <ContractTemplatePicker
            allowPaid={contractTemplatesAllowed}
            value={appSettings.contractTemplate || 'MODERN'}
            companyName={appSettings.companyName || ''}
            sellerPhone={formatRuPhone(getSellerPhone(user, appSettings))}
            onChange={id => onUpdateSettings({ ...appSettings, contractTemplate: id })}
          />
      </SettingsAccordion>

      {/* Светлый/тёмный режим и акцентный цвет — один вопрос «как приложение
          выглядит», а не два. Раздельными разделами человек выбирал цвет, не
          видя, на каком фоне он окажется. */}
      <SettingsAccordion title="Оформление" subtitle="Тема и основной цвет" icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 0 0 18z" /></svg>} tone="bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Тема</p>
          <div className="grid grid-cols-3 gap-3">
              {APPEARANCE_OPTIONS.map((option) => (
                  <button
                      key={option.key}
                      onClick={() => setThemeMode(option.key)}
                      className={`p-3 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${
                          themeMode === option.key
                              ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40'
                              : 'border-slate-100 dark:border-slate-700 hover:border-indigo-200 dark:hover:border-indigo-800'
                      }`}
                  >
                      <span className={themeMode === option.key ? 'text-indigo-600' : 'text-slate-500 dark:text-slate-400'}>
                          {option.icon}
                      </span>
                      <span className={`text-sm font-medium ${
                          themeMode === option.key ? 'text-indigo-900 dark:text-indigo-300' : 'text-slate-600 dark:text-slate-300'
                      }`}>
                          {option.label}
                      </span>
                  </button>
              ))}
          </div>

          <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mt-5 mb-2">Основной цвет</p>
          <div className="grid grid-cols-2 gap-3">
              {(Object.keys(THEMES) as Array<keyof typeof THEMES>).map((themeKey) => (
                  <button
                      key={themeKey}
                      onClick={() => handleThemeChange(themeKey)}
                      className={`p-3 rounded-xl border-2 transition-all flex items-center gap-3 ${
                          (appSettings.theme || 'PURPLE') === themeKey
                              ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40'
                              : 'border-slate-100 dark:border-slate-700 hover:border-indigo-200 dark:hover:border-indigo-800'
                      }`}
                  >
                      <div
                          className="w-8 h-8 rounded-full shadow-sm"
                          style={{ backgroundColor: THEMES[themeKey].primary[600] }}
                      ></div>
                      <span className={`text-sm font-medium ${
                          (appSettings.theme || 'PURPLE') === themeKey ? 'text-indigo-900 dark:text-indigo-300' : 'text-slate-600 dark:text-slate-300'
                      }`}>
                          {THEMES[themeKey].name}
                      </span>
                  </button>
              ))}
          </div>
      </SettingsAccordion>

      </SettingsGroup>

      {/* Настройки, которые живут на своих экранах — такие же строки, но с переходом */}
      <SettingsGroup>
          {!isEmployee && (
            <SettingsLink
              title="Интеграции" subtitle="WhatsApp, SMS и другое"
              icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" /></svg>} tone="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-300"
              onClick={() => onNavigate('INTEGRATIONS')}
            />
          )}
          <SettingsLink
            title="Калькулятор" subtitle="Расчёт рассрочки и ссылка"
            icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" /><line x1="8" y1="6" x2="16" y2="6" /><path d="M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M8 18h.01M12 18h.01" /><path d="M16 14v4" /></svg>} tone="bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300"
            onClick={() => onNavigate('CALCULATOR')}
          />
      </SettingsGroup>

      {/* Данные и документы */}
      <SettingsGroup>
      {/* 👇 ОБЪЕДИНЁННЫЙ БЛОК: Работа с данными (Экспорт + Импорт) */}
       {!isEmployee && (
      <SettingsAccordion title="Работа с данными" subtitle="Экспорт и импорт Excel" icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></svg>} tone="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-300">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Кнопка ЭКСПОРТА */}
              <button
                  onClick={() => setShowExportModal(true)}
                  className="py-4 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-bold rounded-xl hover:bg-emerald-100 dark:hover:bg-emerald-900/50 border border-emerald-100 dark:border-emerald-900/50 flex flex-col items-center justify-center gap-2 transition-colors group"
              >
                  <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/50 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                          <polyline points="7 10 12 15 17 10"/>
                          <line x1="12" y1="15" x2="12" y2="3"/>
                      </svg>
                  </div>
                  <span className="text-sm">Экспорт в Excel</span>
                  <span className="text-[10px] font-normal text-emerald-600/70 dark:text-emerald-400/70">С фильтром по датам</span>
              </button>

              {/* Кнопка ИМПОРТА */}
              <button
                  onClick={() => setShowImportModal(true)}
                  className="py-4 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-bold rounded-xl hover:bg-indigo-100 dark:hover:bg-indigo-900/50 border border-indigo-100 dark:border-indigo-900/50 flex flex-col items-center justify-center gap-2 transition-colors group"
              >
                  <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/50 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                          <polyline points="17 8 12 3 7 8"/>
                          <line x1="12" y1="3" x2="12" y2="15"/>
                      </svg>
                  </div>
                  <span className="text-sm">Импорт из Excel</span>
                  <span className="text-[10px] font-normal text-indigo-600/70 dark:text-indigo-400/70">Клиенты, продажи, платежи</span>
              </button>
          </div>

      </SettingsAccordion>
       )}

      {/* Legal Information Section */}
      <SettingsAccordion title="Правовая информация" icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /><path d="m9 12 2 2 4-4" /></svg>} tone="bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300">
          <div className="space-y-2">
              <button
                  onClick={() => setLegalView('OFFER')}
                  className="w-full text-left p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300 flex justify-between items-center transition-colors"
              >
                  Публичная оферта
                  <span className="text-slate-400">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </span>
              </button>
              <div className="h-px bg-slate-50 dark:bg-slate-700 mx-2"></div>
              <button
                  onClick={() => setLegalView('AGREEMENT')}
                  className="w-full text-left p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300 flex justify-between items-center transition-colors"
              >
                  Согласие на обработку данных
                  <span className="text-slate-400">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </span>
              </button>
              <div className="h-px bg-slate-50 dark:bg-slate-700 mx-2"></div>
              <button
                  onClick={() => setLegalView('PRIVACY')}
                  className="w-full text-left p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300 flex justify-between items-center transition-colors"
              >
                  Политика обработки персональных данных
                  <span className="text-slate-400">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </span>
              </button>
              <div className="h-px bg-slate-50 dark:bg-slate-700 mx-2"></div>
              {/* Ключевой документ: объясняет, что оператором данных покупателей является
                  сам пользователь, а согласие у них берёт он. */}
              <button
                  onClick={() => setLegalView('CLIENT_DATA')}
                  className="w-full text-left p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300 flex justify-between items-center transition-colors"
              >
                  Условия обработки данных клиентов
                  <span className="text-slate-400">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </span>
              </button>
          </div>
      </SettingsAccordion>

            {/* 🔥 СКРЫВАЕМ УПРАВЛЕНИЕ ДАННЫМИ ОТ СОТРУДНИКОВ */}
      {!isEmployee && (
          <SettingsAccordion title="Управление данными" subtitle="Сброс данных и удаление аккаунта" icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" /></svg>} tone="bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-300">
              <button
                  onClick={() => setShowClearModal(true)}
                  className="w-full py-3 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-bold rounded-xl hover:bg-red-100 dark:hover:bg-red-900/50 border border-red-100 dark:border-red-900/50 flex items-center justify-center gap-2 transition-colors"
              >
                  {ICONS.Delete} Сбросить все данные
              </button>

              {/* 🗑 Удаление аккаунта — только владелец. Право на прекращение обработки
                  и уничтожение данных (ст. 14 152-ФЗ), обещанное в Согласии и Оферте. */}
              {user?.role === 'manager' && (
                  <>
                      <div className="h-px bg-slate-100 dark:bg-slate-700 my-4" />
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-2 leading-snug">
                          Удаление учётной записи стирает все данные без возможности восстановления
                          и является отзывом согласия на обработку персональных данных.
                      </p>
                      <button
                          onClick={() => { setDeletePassword(''); setDeleteConfirmWord(''); setDeleteError(''); setShowDeleteAccountModal(true); }}
                          className="btn-press w-full py-3 bg-rose-600 text-white font-bold rounded-xl hover:bg-rose-700 flex items-center justify-center gap-2"
                      >
                          {ICONS.Delete} Удалить учётную запись
                      </button>
                  </>
              )}
          </SettingsAccordion>
      )}

      </SettingsGroup>

      {/* Delete Account Modal */}
      {showDeleteAccountModal && (
          <div className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-fade-in"
               onClick={() => { if (!isDeletingAccount) setShowDeleteAccountModal(false); }}>
              <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-4 animate-dialog-in max-h-[90vh] overflow-y-auto"
                   onClick={e => e.stopPropagation()}>
                  <div className="w-16 h-16 bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 rounded-full flex items-center justify-center mx-auto text-3xl">
                      {ICONS.Alert}
                  </div>
                  <div className="text-center">
                      <h3 className="text-xl font-bold text-slate-800 dark:text-white">Удалить учётную запись?</h3>
                      <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Это действие необратимо.</p>
                  </div>

                  {/* Перечисляем поимённо, что именно исчезнет — общая фраза
                      «все данные» не даёт понять масштаб */}
                  <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 rounded-xl p-4">
                      <p className="text-xs font-bold text-rose-800 dark:text-rose-300 mb-2">Будет удалено безвозвратно:</p>
                      <ul className="text-xs text-rose-800 dark:text-rose-300 space-y-1 list-disc pl-4">
                          <li>все клиенты, договоры рассрочки и история платежей;</li>
                          <li>загруженные документы и фотографии, включая копии паспортов;</li>
                          <li>расчёты с инвесторами, партнёрами и сотрудниками;</li>
                          <li>учётные записи ваших сотрудников и инвесторов;</li>
                          <li>переписка с поддержкой и все уведомления.</li>
                      </ul>
                  </div>

                  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-xl p-3 flex gap-2 items-start">
                      <span className="text-amber-500 shrink-0">💡</span>
                      <p className="text-xs text-amber-800 dark:text-amber-300">
                          Если нужна копия данных — закройте это окно и сначала выгрузите их
                          через «Экспорт данных». После удаления восстановить будет нечего.
                      </p>
                  </div>

                  <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                          Введите слово <span className="font-bold text-rose-600 dark:text-rose-400">УДАЛИТЬ</span> для подтверждения
                      </label>
                      <input
                          type="text"
                          value={deleteConfirmWord}
                          onChange={e => setDeleteConfirmWord(e.target.value)}
                          placeholder="УДАЛИТЬ"
                          autoComplete="off"
                          className="w-full p-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none focus:ring-2 focus:ring-rose-500"
                      />
                  </div>

                  <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Ваш пароль</label>
                      <input
                          type="password"
                          value={deletePassword}
                          onChange={e => setDeletePassword(e.target.value)}
                          placeholder="••••••"
                          autoComplete="current-password"
                          className="w-full p-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none focus:ring-2 focus:ring-rose-500"
                      />
                  </div>

                  {deleteError && (
                      <p className="text-sm text-rose-600 dark:text-rose-400 text-center">{deleteError}</p>
                  )}

                  {deleteCooldown > 0 && (
                      <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-3 text-center">
                          <p className="text-slate-600 dark:text-slate-300 text-sm">
                              ⏳ Подождите <span className="font-bold text-lg">{deleteCooldown}</span> сек.
                          </p>
                      </div>
                  )}

                  <div className="flex gap-3 pt-1">
                      <button
                          onClick={() => setShowDeleteAccountModal(false)}
                          disabled={isDeletingAccount}
                          className="btn-press flex-1 py-3 bg-slate-100 dark:bg-slate-700 font-bold text-slate-600 dark:text-slate-300 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50"
                      >
                          Отмена
                      </button>
                      <button
                          onClick={handleDeleteAccount}
                          disabled={deleteCooldown > 0 || isDeletingAccount || deleteConfirmWord.trim().toUpperCase() !== 'УДАЛИТЬ' || !deletePassword}
                          className="btn-press flex-1 py-3 font-bold rounded-xl flex items-center justify-center gap-2 bg-rose-600 text-white hover:bg-rose-700 disabled:bg-slate-300 dark:disabled:bg-slate-600 disabled:text-slate-500 disabled:cursor-not-allowed"
                      >
                          {isDeletingAccount ? (
                              <>
                                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                                  </svg>
                                  Удаление...
                              </>
                          ) : deleteCooldown > 0 ? `${deleteCooldown}с...` : 'Удалить навсегда'}
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Clear Data Modal */}
      {showClearModal && (
          <div
              className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
              onClick={handleCloseClearModal}
          >
              <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-2xl shadow-2xl p-6 text-center space-y-4" onClick={e => e.stopPropagation()}>
                  <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto text-3xl">
                      {ICONS.Alert}
                  </div>
                  <div>
                      <h3 className="text-xl font-bold text-slate-800 dark:text-white">Вы уверены?</h3>
                      <p className="text-slate-500 dark:text-slate-400 text-sm mt-2">
                          Это действие удалит ВСЕ данные (клиентов, продажи, настройки) с этого устройства. Восстановить их будет невозможно.
                      </p>
                  </div>

                  {confirmCooldown > 0 && (
                      <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-900/50 rounded-xl p-3">
                          <p className="text-amber-800 dark:text-amber-300 text-sm font-medium">
                              ⏳ Подождите <span className="font-bold text-lg">{confirmCooldown}</span> сек. для подтверждения
                          </p>
                      </div>
                  )}

                  <div className="flex gap-3 pt-2">
                      <button
                          onClick={handleCloseClearModal}
                          className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 font-bold text-slate-600 dark:text-slate-300 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                      >
                          Отмена
                      </button>
                      <button
                          onClick={handleClearData}
                          disabled={confirmCooldown > 0 || isClearing}
                          className={`flex-1 py-3 font-bold rounded-xl transition-all flex items-center justify-center gap-2 ${
                              confirmCooldown > 0 || isClearing
                                  ? 'bg-red-300 text-red-100 cursor-not-allowed' 
                                  : 'bg-red-600 text-white hover:bg-red-700 hover:scale-[1.02]'
                          }`}
                      >
                          {isClearing ? (
                              <>
                                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                                  </svg>
                                  Удаление...
                              </>
                          ) : confirmCooldown > 0 ? (
                              `${confirmCooldown}с...`
                          ) : (
                              '✅ Сбросить'
                          )}
                      </button>
                  </div>

                  {confirmCooldown > 0 && (
                      <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                          <div
                              className="bg-amber-400 h-full transition-all duration-1000 ease-linear"
                              style={{ width: `${(confirmCooldown / 10) * 100}%` }}
                          />
                      </div>
                  )}
              </div>
          </div>
      )}

      {/* 👇 МОДАЛКА ЭКСПОРТА */}
      {showExportModal && (
        <Suspense fallback={<div className="fixed inset-0 z-modal flex items-center justify-center bg-black/40"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white"></div></div>}>
          <DataExport onClose={() => setShowExportModal(false)} />
        </Suspense>
      )}

      {/* МОДАЛКА ИМПОРТА */}
      {showImportModal && (
        <Suspense fallback={<div className="fixed inset-0 z-modal flex items-center justify-center bg-black/40"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white"></div></div>}>
          <DataImport
              onClose={() => setShowImportModal(false)}
              onImportSuccess={() => {
                  setTimeout(() => {
                      setShowImportModal(false);
                      alert("✅ Данные успешно импортированы! Страница будет перезагружена.");
                      window.location.reload();
                  }, 5000);
              }}
              currentUserId={currentUserId}
          />
        </Suspense>
      )}

      {/* 🆕 МОДАЛКА ОБНОВЛЕНИЯ ПРИЛОЖЕНИЯ */}
      {isUpdating && (
          <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
              <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-3xl shadow-2xl p-8 text-center animate-scale-in">
                  {/* Анимированная иконка */}
                  <div className="relative w-24 h-24 mx-auto mb-6">
                      {/* Внешнее кольцо */}
                      <div className="absolute inset-0 rounded-full border-4 border-indigo-100 dark:border-indigo-900/40"></div>
                      {/* Вращающееся кольцо */}
                      <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-indigo-600 border-r-indigo-600 animate-spin"></div>
                      {/* Центральная иконка */}
                      <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
                              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>
                              </svg>
                          </div>
                      </div>
                  </div>

                  {/* Заголовок */}
                  <h3 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">
                      Обновление приложения
                  </h3>
                  <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">
                      Загружаем новую версию...
                  </p>

                  {/* Прогресс-бар */}
                  <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-2 overflow-hidden mb-3">
                      <div
                          className="bg-gradient-to-r from-indigo-500 to-purple-600 h-full transition-all duration-100 ease-linear rounded-full"
                          style={{ width: `${updateProgress}%` }}
                      />
                  </div>

                  {/* Процент */}
                  <p className="text-sm font-bold text-indigo-600">
                      {updateProgress}%
                  </p>

                  {/* Статус */}
                  <div className="mt-6 space-y-1">
                      {updateProgress < 30 && (
                          <p className="text-xs text-slate-400 animate-pulse">🔍 Проверка обновлений...</p>
                      )}
                      {updateProgress >= 30 && updateProgress < 60 && (
                          <p className="text-xs text-slate-400 animate-pulse">📦 Загрузка файлов...</p>
                      )}
                      {updateProgress >= 60 && updateProgress < 90 && (
                          <p className="text-xs text-slate-400 animate-pulse">⚙️ Применение изменений...</p>
                      )}
                      {updateProgress >= 90 && (
                          <p className="text-xs text-emerald-600 font-medium">✅ Почти готово!</p>
                      )}
                  </div>
              </div>
          </div>
      )}

    </div>
  );
};

export default Settings;