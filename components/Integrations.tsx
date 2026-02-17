
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
      // No description needed, logic handled in backend
      setIsCreatingInstance(true);
      setQrCode(null);

      const credentials = await createPartnerInstance();

      if (credentials) {
          setIdInstance(credentials.idInstance);
          setApiToken(credentials.apiTokenInstance);
          setWaEnabled(true); // Enable automatically

          setTimeout(async () => {
              const qr = await getQrCode(credentials.idInstance, credentials.apiTokenInstance);
              if (qr) {
                  setQrCode(qr);
                  setConnectionStatus('WAITING_SCAN');
                  startPolling(credentials.idInstance, credentials.apiTokenInstance);
              } else {
                  alert("Инстанс создан, но QR-код еще не готов. Попробуйте еще раз через пару секунд.");
              }
              setIsCreatingInstance(false);
          }, 3000); // Wait 3s for Green API to init
      } else {
          alert("Ошибка создания подключения. Обратитесь в поддержку.");
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

              // Auto save settings
              const waSettings: WhatsAppSettings = {
                  enabled: true,
                  idInstance: id,
                  apiTokenInstance: token,
                  reminderTime,
                  reminderDays
              };
              onUpdateSettings({ ...appSettings, whatsapp: waSettings });
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
                      <p className="text-xs text-slate-500">Авто-уведомления клиентов</p>
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
                  <div className={`p-4 rounded-xl flex items-center justify-between gap-3 ${connectionStatus === 'AUTHORIZED' ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-slate-50 border border-slate-200 text-slate-600'}`}>
                      <div className="flex items-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${connectionStatus === 'AUTHORIZED' ? 'bg-emerald-500 animate-pulse' : connectionStatus === 'WAITING_SCAN' ? 'bg-amber-500 animate-pulse' : 'bg-slate-400'}`}></div>
                          <div>
                              <span className="font-bold text-sm block">
                                  {connectionStatus === 'AUTHORIZED' ? 'Подключено' : connectionStatus === 'WAITING_SCAN' ? 'Ожидание сканирования...' : 'Не подключено'}
                              </span>
                              {connectionStatus === 'AUTHORIZED' && <span className="text-xs opacity-70">Сообщения отправляются автоматически</span>}
                          </div>
                      </div>
                  </div>

                  {/* Connect Flow */}
                  {connectionStatus !== 'AUTHORIZED' && (
                      <div className="bg-indigo-50 p-6 rounded-xl border border-indigo-100 text-center animate-fade-in">
                          {!qrCode ? (
                              <>
                                  <h4 className="font-bold text-indigo-900 mb-2">Подключение устройства</h4>
                                  <p className="text-xs text-indigo-700 mb-4">Нажмите кнопку ниже, чтобы сгенерировать QR-код для входа.</p>
                                  <button
                                    onClick={handleCreatePartnerInstance}
                                    disabled={isCreatingInstance}
                                    className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-70 transition-all text-sm flex items-center justify-center gap-2 mx-auto"
                                  >
                                    {isCreatingInstance ? (
                                        <>
                                            <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                            Создание...
                                        </>
                                    ) : (
                                        'Получить QR-код'
                                    )}
                                  </button>
                              </>
                          ) : (
                              <div className="space-y-4 animate-fade-in">
                                  <h4 className="font-bold text-indigo-900">Сканируйте в WhatsApp</h4>
                                  <div className="bg-white p-3 rounded-xl inline-block shadow-md">
                                      <img src={`data:image/png;base64,${qrCode}`} alt="QR Code" className="w-56 h-56 object-contain" />
                                  </div>
                                  <div className="text-sm text-slate-600">
                                      <ol className="text-left list-decimal list-inside space-y-1 bg-white/50 p-3 rounded-lg text-xs">
                                          <li>Откройте WhatsApp на телефоне</li>
                                          <li>Нажмите <b>Меню</b> или <b>Настройки</b></li>
                                          <li>Выберите <b>Связанные устройства</b></li>
                                          <li>Нажмите <b>Привязка устройства</b></li>
                                          <li>Наведите камеру на этот код</li>
                                      </ol>
                                  </div>
                              </div>
                          )}
                      </div>
                  )}

                  {connectionStatus === 'AUTHORIZED' && (
                      <div className="space-y-6">
                          <hr className="border-slate-100" />

                          {/* Schedule Settings */}
                          <div>
                              <h4 className="font-semibold text-slate-700 mb-3 text-sm flex items-center gap-2">
                                  {ICONS.Clock} Время рассылки
                              </h4>
                              <div className="grid grid-cols-2 gap-4 mb-4">
                                  <div>
                                      <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Время отправки</label>
                                      <input type="time" className="w-full p-2 border border-slate-200 rounded-lg text-sm bg-slate-50" value={reminderTime} onChange={e => setReminderTime(e.target.value)} />
                                  </div>
                              </div>
                              <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Когда напоминать?</label>
                              <div className="flex flex-wrap gap-2">
                                  <button onClick={() => toggleDay(0)} className={`px-3 py-1.5 rounded-lg text-xs border font-medium transition-all ${reminderDays.includes(0) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'}`}>В день оплаты</button>
                                  <button onClick={() => toggleDay(-1)} className={`px-3 py-1.5 rounded-lg text-xs border font-medium transition-all ${reminderDays.includes(-1) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'}`}>За 1 день</button>
                                  <button onClick={() => toggleDay(1)} className={`px-3 py-1.5 rounded-lg text-xs border font-medium transition-all ${reminderDays.includes(1) ? 'bg-red-600 text-white border-red-600' : 'bg-white text-slate-600 border-slate-200'}`}>При просрочке</button>
                              </div>
                          </div>

                          <div className="flex gap-3">
                              <button onClick={saveWhatsAppSettings} className="flex-1 py-3 bg-slate-800 text-white font-bold rounded-xl hover:bg-slate-900 transition-all shadow-lg shadow-slate-200">
                                  Сохранить настройки
                              </button>
                              <button
                                  onClick={handleTestConnection}
                                  className={`px-4 py-3 rounded-xl border font-bold text-sm transition-all ${testStatus === 'SUCCESS' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                              >
                                  {isTesting ? '...' : testStatus === 'SUCCESS' ? ICONS.Check : 'Проверить'}
                              </button>
                          </div>
                      </div>
                  )}
              </div>
          )}
      </div>
    </div>
  );
};

export default Integrations;
