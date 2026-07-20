import React, { useState, useEffect, Suspense, lazy } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { AppSettings, ViewState, User, NotificationSettings, NotificationEventToggles } from '../types';
import { ICONS, APP_VERSION, THEMES } from '../constants';
import { PrivacyPolicy, DataProcessingAgreement } from './LegalDocs';
import { api } from '../services/api';
import { useTheme, ThemeMode } from '../src/theme/ThemeContext';

// 🔹 Тянут xlsx — грузим только когда реально открыли импорт/экспорт
const DataImport = lazy(() => import('./DataImport'));
const DataExport = lazy(() => import('./DataExport'));

interface SettingsProps {
  appSettings: AppSettings;
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
  },
};

const NOTIFICATION_EVENT_ROWS: { key: keyof NotificationEventToggles; label: string; icon: React.ReactNode }[] = [
  { key: 'payment', label: 'Платёж', icon: ICONS.Income },
  { key: 'newContract', label: 'Новый договор', icon: ICONS.File },
  { key: 'contractClosed', label: 'Договор закрыт', icon: ICONS.CheckCircle },
  { key: 'expense', label: 'Расход', icon: ICONS.Expense },
  { key: 'whatsappSent', label: 'WhatsApp-напоминания', icon: ICONS.Chat },
  { key: 'adminBroadcast', label: 'От администратора', icon: ICONS.Megaphone },
];

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

const Settings: React.FC<SettingsProps> = ({ appSettings, onUpdateSettings, onNavigate, onSettingsChanged, currentUserId, user }) => {
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

  // 👇 ДОБАВИЛИ: состояния для модалок импорта и экспорта
  const [showImportModal, setShowImportModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);

  // 🆕 СОСТОЯНИЕ ДЛЯ ОБНОВЛЕНИЯ ПРИЛОЖЕНИЯ
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);

  // Legal Docs View State
  const [legalView, setLegalView] = useState<'NONE' | 'PRIVACY' | 'AGREEMENT'>('NONE');

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

  return (
    <div className="space-y-6 animate-fade-in pb-20">
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

      {/* Company Name */}
      <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
        <h3 className="text-lg font-semibold text-slate-800 dark:text-white mb-1">Название компании</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Отображается в заголовке и в сообщениях.</p>
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
      </div>

      {/* Display Settings */}
      <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-white mb-1">Отображение</h3>
          <div className="flex items-center justify-between">
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
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100 dark:border-slate-700">
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
      </div>

      {/* Notifications — доступно только владельцу тенанта (менеджер/админ): у сотрудников и
          инвесторов тумблеры сохранялись бы под их собственным settings-id и не влияли бы на
          реальную рассылку событий, которая всегда идёт от имени менеджера */}
      {(user?.role === 'manager' || user?.role === 'admin') && (
      <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
          <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-white">Уведомления</h3>
              {!hasNotificationsAccess && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded-full">
                      {ICONS.Crown} Стандарт+
                  </span>
              )}
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              Платежи, новые и закрытые договоры, расходы, отправленные WhatsApp-напоминания и сообщения администрации.
          </p>

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
                      {NOTIFICATION_EVENT_ROWS.map(row => (
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
      </div>
      )}

      {/* Appearance / Dark Mode Selection */}
      <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-white mb-1">Тема оформления</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Светлая, тёмная или автоматически по системе.</p>
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
      </div>

      {/* Theme Selection */}
      <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-white mb-1">Цветовая тема</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Выберите основной цвет приложения.</p>
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
      </div>

      {/* Tools & Integrations */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {!isEmployee && (
              <button
                onClick={() => onNavigate('INTEGRATIONS')}
                className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 flex items-center gap-4 hover:shadow-md transition-all group text-left"
              >
                  <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                  </div>
                  <div>
                      <h3 className="font-bold text-slate-800 dark:text-white text-lg">Интеграции</h3>
                      <p className="text-sm text-slate-500 dark:text-slate-400">WhatsApp, SMS и другое</p>
                  </div>
              </button>
          )}


          <button
            onClick={() => onNavigate('CALCULATOR')}
            className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 flex items-center gap-4 hover:shadow-md transition-all group text-left"
          >
              <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-900/30 rounded-full flex items-center justify-center text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="16" y1="14" x2="16" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/></svg>
              </div>
              <div>
                  <h3 className="font-bold text-slate-800 dark:text-white text-lg">Калькулятор</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Расчет рассрочки и ссылка</p>
              </div>
          </button>
      </div>

      {/* 👇 ОБЪЕДИНЁННЫЙ БЛОК: Работа с данными (Экспорт + Импорт) */}
       {!isEmployee && (
      <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-white mb-1">Работа с данными</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Выгружайте данные в Excel или загружайте из файла.</p>

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


      </div>
       )}

      {/* Legal Information Section */}
      <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-white mb-2">Правовая информация</h3>
          <div className="space-y-2">
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
                  Политика конфиденциальности
                  <span className="text-slate-400">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </span>
              </button>
          </div>
      </div>

            {/* 🔥 СКРЫВАЕМ УПРАВЛЕНИЕ ДАННЫМИ ОТ СОТРУДНИКОВ */}
      {!isEmployee && (
          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-white mb-1">Управление данными</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Сброс всех данных приложения. Используйте с осторожностью.</p>
              <button
                  onClick={() => setShowClearModal(true)}
                  className="w-full py-3 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-bold rounded-xl hover:bg-red-100 dark:hover:bg-red-900/50 border border-red-100 dark:border-red-900/50 flex items-center justify-center gap-2 transition-colors"
              >
                  {ICONS.Delete} Сбросить все данные
              </button>
          </div>
      )}

      {/* Clear Data Modal */}
      {showClearModal && (
          <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
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
        <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white"></div></div>}>
          <DataExport onClose={() => setShowExportModal(false)} />
        </Suspense>
      )}

      {/* МОДАЛКА ИМПОРТА */}
      {showImportModal && (
        <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white"></div></div>}>
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