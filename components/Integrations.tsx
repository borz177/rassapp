
import React, { useState, useEffect, useRef } from 'react';
import { AppSettings, WhatsAppSettings } from '../types';
import { ICONS } from '../constants';
import { checkGreenApiConnection, createPartnerInstance, getQrCode } from '../services/whatsapp';

interface IntegrationsProps {
  appSettings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => void;
  onBack: () => void;
}

const Integrations: React.FC<IntegrationsProps> = ({ appSettings, onUpdateSettings, onBack }) => {
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

  const hasPartnerToken = !!process.env.REACT_APP_GREEN_API_PARTNER_TOKEN;

  useEffect(() => {
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

  const saveWhatsAppSettings = () => {
    const waSettings: WhatsAppSettings = {
        enabled: waEnabled,
        idInstance,
        apiTokenInstance: apiToken,
        reminderTime,
        reminderDays
    };

    onUpdateSettings({
        ...appSettings,
        whatsapp: waSettings
    });
    alert("Настройки интеграции сохранены!");
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

  const handleCreatePartnerInstance = async () => {
      if (!window.confirm("Создать новое подключение WhatsApp?")) return;

      setIsCreatingInstance(true);
      setQrCode(null);

      const credentials = await createPartnerInstance(appSettings.companyName || "InstallMate User");

      if (credentials) {
          setIdInstance(credentials.idInstance);
          setApiToken(credentials.apiTokenInstance);

          setTimeout(async () => {
              const qr = await getQrCode(credentials.idInstance, credentials.apiTokenInstance);
              if (qr) {
                  setQrCode(qr);
                  setConnectionStatus('WAITING_SCAN');
                  startPolling(credentials.idInstance, credentials.apiTokenInstance);
              } else {
                  alert("Инстанс создан, но QR-код недоступен. Проверьте ключи вручную.");
              }
              setIsCreatingInstance(false);
          }, 2000);
      } else {
          alert("Ошибка создания инстанса.");
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
      }, 5000);
  };

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <header className="flex items-center gap-3">
        <button onClick={onBack} className="text-slate-500 hover:text-slate-800">
            {ICONS.Back}
        </button>
        <div>
            <h2 className="text-2xl font-bold text-slate-800">Интеграции</h2>
            <p className="text-slate-500 text-sm">Подключение внешних сервисов</p>
        </div>
      </header>

      {/* WhatsApp Integration Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-emerald-100 overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-emerald-50/50">
              <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-500 rounded-full flex items-center justify-center text-white">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
                  </div>
                  <div>
                      <h3 className="font-bold text-slate-800">WhatsApp</h3>
                      <p className="text-xs text-slate-500">Провайдер: Green API</p>
                  </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={waEnabled} onChange={() => setWaEnabled(!waEnabled)} className="sr-only peer" />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
              </label>
          </div>

          {waEnabled && (
              <div className="p-5 space-y-6">
                  {/* Status Indicator */}
                  <div className={`p-4 rounded-xl flex items-center gap-3 ${connectionStatus === 'AUTHORIZED' ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-slate-50 border border-slate-200 text-slate-600'}`}>
                      <div className={`w-3 h-3 rounded-full ${connectionStatus === 'AUTHORIZED' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`}></div>
                      <span className="font-bold text-sm">
                          {connectionStatus === 'AUTHORIZED' ? 'WhatsApp подключен' : connectionStatus === 'WAITING_SCAN' ? 'Сканируйте QR код' : 'Не подключено'}
                      </span>
                  </div>

                  {/* Partner Connection Flow */}
                  {hasPartnerToken && connectionStatus !== 'AUTHORIZED' && (
                      <div className="bg-indigo-50 p-5 rounded-xl border border-indigo-100 text-center">
                          <h4 className="font-bold text-indigo-900 mb-2">Быстрое подключение</h4>
                          {!qrCode ? (
                              <button
                                onClick={handleCreatePartnerInstance}
                                disabled={isCreatingInstance}
                                className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-70 transition-all text-sm"
                              >
                                {isCreatingInstance ? 'Создание...' : 'Получить QR код'}
                              </button>
                          ) : (
                              <div className="space-y-3">
                                  <div className="bg-white p-2 rounded-lg inline-block shadow-sm">
                                      <img src={`data:image/png;base64,${qrCode}`} alt="QR Code" className="w-48 h-48 object-contain" />
                                  </div>
                                  <p className="text-sm font-medium text-slate-600">Сканируйте в WhatsApp</p>
                              </div>
                          )}
                      </div>
                  )}

                  {/* Manual Config */}
                  <div className="space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                              <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">idInstance</label>
                              <input
                                  type="text"
                                  className="w-full p-3 border border-slate-200 rounded-xl outline-none text-sm"
                                  value={idInstance}
                                  onChange={e => setIdInstance(e.target.value)}
                              />
                          </div>
                          <div>
                              <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">apiTokenInstance</label>
                              <input
                                  type="text"
                                  className="w-full p-3 border border-slate-200 rounded-xl outline-none text-sm"
                                  value={apiToken}
                                  onChange={e => setApiToken(e.target.value)}
                              />
                          </div>
                      </div>
                      <div className="flex justify-end gap-3">
                          <button onClick={handleTestConnection} disabled={isTesting} className="text-sm text-indigo-600 font-bold hover:underline">
                              {isTesting ? 'Проверка...' : 'Проверить связь'}
                          </button>
                      </div>
                  </div>

                  <hr className="border-slate-100" />

                  {/* Schedule */}
                  <div>
                      <h4 className="font-semibold text-slate-700 mb-3 text-sm">Настройки рассылки</h4>
                      <div className="grid grid-cols-2 gap-4 mb-4">
                          <div>
                              <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Время отправки</label>
                              <input type="time" className="w-full p-2 border border-slate-200 rounded-lg text-sm" value={reminderTime} onChange={e => setReminderTime(e.target.value)} />
                          </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                          <button onClick={() => toggleDay(0)} className={`px-3 py-1.5 rounded-lg text-xs border ${reminderDays.includes(0) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'}`}>В день оплаты</button>
                          <button onClick={() => toggleDay(-1)} className={`px-3 py-1.5 rounded-lg text-xs border ${reminderDays.includes(-1) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'}`}>За 1 день</button>
                          <button onClick={() => toggleDay(1)} className={`px-3 py-1.5 rounded-lg text-xs border ${reminderDays.includes(1) ? 'bg-red-600 text-white border-red-600' : 'bg-white text-slate-600 border-slate-200'}`}>Просрочка</button>
                      </div>
                  </div>

                  <button onClick={saveWhatsAppSettings} className="w-full py-3 bg-slate-800 text-white font-bold rounded-xl hover:bg-slate-900 transition-all">
                      Сохранить настройки WhatsApp
                  </button>
              </div>
          )}
      </div>

      {/* Placeholders for future integrations */}
      <div className="opacity-50 pointer-events-none grayscale">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-sky-500 rounded-full flex items-center justify-center text-white font-bold text-xs">TG</div>
                  <div><h3 className="font-bold text-slate-800">Telegram Bot</h3><p className="text-xs text-slate-500">Скоро</p></div>
              </div>
              <div className="w-11 h-6 bg-slate-200 rounded-full"></div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-yellow-500 rounded-full flex items-center justify-center text-white font-bold text-xs">SMS</div>
                  <div><h3 className="font-bold text-slate-800">SMS Рассылка</h3><p className="text-xs text-slate-500">Скоро</p></div>
              </div>
              <div className="w-11 h-6 bg-slate-200 rounded-full"></div>
          </div>
      </div>
    </div>
  );
};

export default Integrations;
