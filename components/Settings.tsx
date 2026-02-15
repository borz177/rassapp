
import React, { useState, useEffect, useRef } from 'react';
import { AppSettings, WhatsAppSettings } from '../types';
import { ICONS, APP_VERSION } from '../constants';
import { checkGreenApiConnection, createPartnerInstance, getQrCode } from '../services/whatsapp';
import { PrivacyPolicy, DataProcessingAgreement } from './LegalDocs';
import { api } from '../services/api';

interface SettingsProps {
  appSettings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => void;
}

const Settings: React.FC<SettingsProps> = ({ appSettings, onUpdateSettings }) => {
  const [companyName, setCompanyName] = useState(appSettings.companyName);

  // WhatsApp State
  const [waEnabled, setWaEnabled] = useState(false);
  const [idInstance, setIdInstance] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [reminderTime, setReminderTime] = useState('10:00');
  const [reminderDays, setReminderDays] = useState<number[]>([0]); // Default: On due date

  // Manual Test State
  const [isTesting, setIsTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<'IDLE' | 'SUCCESS' | 'ERROR'>('IDLE');

  // Partner Integration State
  const [isCreatingInstance, setIsCreatingInstance] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'IDLE' | 'WAITING_SCAN' | 'AUTHORIZED'>('IDLE');
  const pollingRef = useRef<number | null>(null);

  // Clear Data Modal State
  const [showClearModal, setShowClearModal] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  // Legal Docs View State
  const [legalView, setLegalView] = useState<'NONE' | 'PRIVACY' | 'AGREEMENT'>('NONE');

  const hasPartnerToken = !!process.env.REACT_APP_GREEN_API_PARTNER_TOKEN;

  useEffect(() => {
    setCompanyName(appSettings.companyName);
    if (appSettings.whatsapp) {
        setWaEnabled(appSettings.whatsapp.enabled);
        setIdInstance(appSettings.whatsapp.idInstance);
        setApiToken(appSettings.whatsapp.apiTokenInstance);
        setReminderTime(appSettings.whatsapp.reminderTime);
        setReminderDays(appSettings.whatsapp.reminderDays);
        if (appSettings.whatsapp.idInstance) {
            checkGreenApiConnection(appSettings.whatsapp.idInstance, appSettings.whatsapp.apiTokenInstance)
                .then(isAuth => setConnectionStatus(isAuth ? 'AUTHORIZED' : 'IDLE'));
        }
    } else {
        // Load from env if not set in storage (Legacy support)
        const envId = process.env.REACT_APP_GREEN_API_ID_INSTANCE || '';
        const envToken = process.env.REACT_APP_GREEN_API_TOKEN_INSTANCE || '';
        if (envId) setIdInstance(envId);
        if (envToken) setApiToken(envToken);
    }

    return () => {
        if (pollingRef.current) window.clearInterval(pollingRef.current);
    }
  }, [appSettings]);

  const handleSave = () => {
    const waSettings: WhatsAppSettings = {
        enabled: waEnabled,
        idInstance,
        apiTokenInstance: apiToken,
        reminderTime,
        reminderDays
    };

    onUpdateSettings({
        ...appSettings,
        companyName,
        whatsapp: waSettings
    });
    alert("Настройки сохранены!");
  };

  const handleTestConnection = async () => {
      setIsTesting(true);
      setTestStatus('IDLE');
      const success = await checkGreenApiConnection(idInstance, apiToken);
      setTestStatus(success ? 'SUCCESS' : 'ERROR');
      if (success) setConnectionStatus('AUTHORIZED');
      setIsTesting(false);
  };

  const toggleDay = (day: number) => {
      setReminderDays(prev =>
          prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
      );
  };

  // --- Partner Flow ---

  const handleCreatePartnerInstance = async () => {
      if (!window.confirm("Создать новое подключение WhatsApp?")) return;

      setIsCreatingInstance(true);
      setQrCode(null);

      const credentials = await createPartnerInstance(companyName || "InstallMate App");

      if (credentials) {
          setIdInstance(credentials.idInstance);
          setApiToken(credentials.apiTokenInstance);

          // Wait a moment for instance to initialize before asking for QR
          setTimeout(async () => {
              const qr = await getQrCode(credentials.idInstance, credentials.apiTokenInstance);
              if (qr) {
                  setQrCode(qr);
                  setConnectionStatus('WAITING_SCAN');
                  startPolling(credentials.idInstance, credentials.apiTokenInstance);
              } else {
                  alert("Инстанс создан, но не удалось получить QR. Попробуйте позже или введите ключи вручную.");
              }
              setIsCreatingInstance(false);
          }, 2000);
      } else {
          alert("Ошибка создания инстанса. Проверьте настройки партнера.");
          setIsCreatingInstance(false);
      }
  };

  const startPolling = (id: string, token: string) => {
      if (pollingRef.current) window.clearInterval(pollingRef.current);

      pollingRef.current = window.setInterval(async () => {
          const isAuth = await checkGreenApiConnection(id, token);
          if (isAuth) {
              setConnectionStatus('AUTHORIZED');
              setQrCode(null);
              if (pollingRef.current) window.clearInterval(pollingRef.current);
              alert("WhatsApp успешно подключен!");
          }
      }, 5000); // Check every 5 seconds
  };

  const handleClearData = async () => {
      setIsClearing(true);
      try {
          // Clear Local Storage
          localStorage.clear();
          // Call API to wipe data
          await api.resetAccountData();
          window.location.reload();
      } catch (error) {
          console.error(error);
          alert("Ошибка при очистке данных на сервере. Попробуйте снова.");
          setIsClearing(false);
      }
  };

  const handleForceUpdate = () => {
      window.location.reload();
  }

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
            <h2 className="text-2xl font-bold text-slate-800">Настройки</h2>
            <p className="text-slate-500 text-sm">Версия: {APP_VERSION}</p>
        </div>
        <button onClick={handleForceUpdate} className="text-xs bg-slate-100 text-slate-600 px-3 py-2 rounded-lg font-medium hover:bg-slate-200">
            Обновить приложение
        </button>
      </header>

      {/* Company Name */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
        <h3 className="text-lg font-semibold text-slate-800 mb-1">Название компании</h3>
        <p className="text-sm text-slate-500 mb-4">Отображается в заголовке и в сообщениях WhatsApp.</p>
        <input
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className="w-full p-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 mb-2"
            placeholder="Название вашей компании"
        />
      </div>

      {/* WhatsApp Integration */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 space-y-4">
          <div className="flex justify-between items-center border-b border-slate-100 pb-4">
              <div>
                  <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                      <span className="text-emerald-500">{ICONS.TrendingUp}</span> WhatsApp (Green API)
                  </h3>
                  <p className="text-xs text-slate-500">Автоматические напоминания</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={waEnabled} onChange={() => setWaEnabled(!waEnabled)} className="sr-only peer" />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
              </label>
          </div>

          {waEnabled && (
              <div className="space-y-6 animate-fade-in">

                  {/* Status Indicator */}
                  <div className={`p-4 rounded-xl flex items-center gap-3 ${connectionStatus === 'AUTHORIZED' ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-slate-50 border border-slate-200 text-slate-600'}`}>
                      <div className={`w-3 h-3 rounded-full ${connectionStatus === 'AUTHORIZED' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`}></div>
                      <span className="font-bold text-sm">
                          {connectionStatus === 'AUTHORIZED' ? 'WhatsApp подключен и работает' : connectionStatus === 'WAITING_SCAN' ? 'Ожидание сканирования QR...' : 'Не подключено'}
                      </span>
                  </div>

                  {/* Partner Connection Flow */}
                  {hasPartnerToken && connectionStatus !== 'AUTHORIZED' && (
                      <div className="bg-gradient-to-r from-indigo-50 to-purple-50 p-5 rounded-xl border border-indigo-100 text-center">
                          <h4 className="font-bold text-indigo-900 mb-2">Быстрое подключение</h4>
                          <p className="text-xs text-indigo-700 mb-4 max-w-xs mx-auto">Создайте подключение автоматически через наш партнерский аккаунт Green API.</p>

                          {!qrCode ? (
                              <button
                                onClick={handleCreatePartnerInstance}
                                disabled={isCreatingInstance}
                                className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-70 transition-all"
                              >
                                {isCreatingInstance ? 'Создание...' : 'Создать подключение'}
                              </button>
                          ) : (
                              <div className="space-y-3">
                                  <div className="bg-white p-2 rounded-lg inline-block shadow-sm">
                                      <img src={`data:image/png;base64,${qrCode}`} alt="QR Code" className="w-48 h-48 object-contain" />
                                  </div>
                                  <p className="text-sm font-medium text-slate-600">Сканируйте QR-код в WhatsApp</p>
                                  <p className="text-xs text-slate-400">Настройки {'>'} Связанные устройства</p>
                              </div>
                          )}
                      </div>
                  )}

                  {/* Manual Configuration */}
                  <div className="space-y-3">
                      <div className="flex justify-between items-center">
                          <h4 className="font-semibold text-slate-700 text-sm">Ручная настройка</h4>
                          <button onClick={() => setConnectionStatus('IDLE')} className="text-xs text-indigo-600 underline">Сбросить статус</button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                              <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">idInstance</label>
                              <input
                                  type="text"
                                  className="w-full p-3 border border-slate-200 rounded-xl outline-none text-sm"
                                  value={idInstance}
                                  onChange={e => setIdInstance(e.target.value)}
                                  placeholder="1101******"
                              />
                          </div>
                          <div>
                              <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">apiTokenInstance</label>
                              <input
                                  type="text"
                                  className="w-full p-3 border border-slate-200 rounded-xl outline-none text-sm"
                                  value={apiToken}
                                  onChange={e => setApiToken(e.target.value)}
                                  placeholder="K12345******"
                              />
                          </div>
                      </div>

                      <div className="flex items-center gap-3">
                          <button
                              onClick={handleTestConnection}
                              disabled={isTesting || !idInstance || !apiToken}
                              className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-200 disabled:opacity-50"
                          >
                              {isTesting ? 'Проверка...' : 'Проверить вручную'}
                          </button>
                          {testStatus === 'SUCCESS' && <span className="text-sm text-emerald-600 font-bold flex items-center gap-1">{ICONS.Check} OK</span>}
                          {testStatus === 'ERROR' && <span className="text-sm text-red-600 font-bold flex items-center gap-1">{ICONS.Alert} Ошибка</span>}
                      </div>
                  </div>

                  <hr className="border-slate-100" />

                  {/* Schedule Settings */}
                  <div>
                      <h4 className="font-semibold text-slate-700 mb-3">Расписание напоминаний</h4>

                      <div className="mb-4">
                          <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Время проверки (ежедневно)</label>
                          <input
                              type="time"
                              className="p-2 border border-slate-200 rounded-lg outline-none font-bold text-slate-800"
                              value={reminderTime}
                              onChange={e => setReminderTime(e.target.value)}
                          />
                      </div>

                      <div className="space-y-2">
                          <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Когда отправлять?</label>
                          <div className="flex flex-wrap gap-2">
                              <button onClick={() => toggleDay(0)} className={`px-3 py-2 rounded-lg text-sm border ${reminderDays.includes(0) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'}`}>В день оплаты</button>
                              <button onClick={() => toggleDay(-1)} className={`px-3 py-2 rounded-lg text-sm border ${reminderDays.includes(-1) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'}`}>За 1 день до</button>
                              <button onClick={() => toggleDay(-3)} className={`px-3 py-2 rounded-lg text-sm border ${reminderDays.includes(-3) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'}`}>За 3 дня до</button>
                              <button onClick={() => toggleDay(1)} className={`px-3 py-2 rounded-lg text-sm border ${reminderDays.includes(1) ? 'bg-red-600 text-white border-red-600' : 'bg-white text-slate-600 border-slate-200'}`}>1 день просрочки</button>
                          </div>
                      </div>
                  </div>
              </div>
          )}
      </div>

      {/* Legal Information Section */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-semibold text-slate-800 mb-2">Правовая информация</h3>
          <div className="space-y-2">
              <button
                  onClick={() => setLegalView('AGREEMENT')}
                  className="w-full text-left p-3 rounded-xl hover:bg-slate-50 text-sm font-medium text-slate-700 flex justify-between items-center transition-colors"
              >
                  Согласие на обработку данных
                  <span className="text-slate-400">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </span>
              </button>
              <div className="h-px bg-slate-50 mx-2"></div>
              <button
                  onClick={() => setLegalView('PRIVACY')}
                  className="w-full text-left p-3 rounded-xl hover:bg-slate-50 text-sm font-medium text-slate-700 flex justify-between items-center transition-colors"
              >
                  Политика конфиденциальности
                  <span className="text-slate-400">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </span>
              </button>
          </div>
      </div>

      {/* Clear Data Section */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-semibold text-slate-800 mb-1">Управление данными</h3>
          <p className="text-sm text-slate-500 mb-4">Сброс всех данных приложения. Используйте с осторожностью.</p>
          <button
              onClick={() => setShowClearModal(true)}
              className="w-full py-3 bg-red-50 text-red-600 font-bold rounded-xl hover:bg-red-100 border border-red-100 flex items-center justify-center gap-2 transition-colors"
          >
              {ICONS.Delete} Сбросить все данные
          </button>
      </div>

      <div className="pt-4">
        <button
            onClick={handleSave}
            className="w-full py-4 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
        >
            Сохранить все настройки
        </button>
      </div>

      {/* Clear Data Modal */}
      {showClearModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={() => setShowClearModal(false)}>
              <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 text-center space-y-4" onClick={e => e.stopPropagation()}>
                  <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto text-3xl">
                      {ICONS.Alert}
                  </div>
                  <div>
                      <h3 className="text-xl font-bold text-slate-800">Вы уверены?</h3>
                      <p className="text-slate-500 text-sm mt-2">
                          Это действие удалит ВСЕ данные (клиентов, продажи, настройки) с этого устройства. Восстановить их будет невозможно.
                      </p>
                  </div>
                  <div className="flex gap-3 pt-2">
                      <button onClick={() => setShowClearModal(false)} className="flex-1 py-3 bg-slate-100 font-bold text-slate-600 rounded-xl">Отмена</button>
                      <button onClick={handleClearData} disabled={isClearing} className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl disabled:opacity-70">
                          {isClearing ? 'Удаление...' : 'Сбросить'}
                      </button>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
};

export default Settings;
