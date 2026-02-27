import React, { useState, useEffect, useRef } from 'react';
import { AppSettings, WhatsAppSettings } from '../types';
import { ICONS } from '../constants';
import { checkGreenApiConnection, getQrCode } from '../services/whatsapp';

interface IntegrationsProps {
  appSettings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => void;
  onBack: () => void;
}

// 🔹 НОВЫЕ шаблоны — с поддержкой долга и цитаты
const DEFAULT_TEMPLATES = {
  upcoming: `🔔 *Напоминание об оплате*\n\n*{имя}!*\n\n📅 Сегодня *{дата}* — день оплаты!\n\n🔸 *{товар}*\n   • К оплате: *{сумма} ₽*\n\n{долг_блок}\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``,
  today: `🔔 *Напоминание об оплате*\n\n*{имя}!*\n\n📅 Сегодня *{дата}* — день оплаты!\n\n🔸 *{товар}*\n   • К оплате: *{сумма} ₽*\n\n{долг_блок}\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``,
  overdue: `🔔 *Напоминание об оплате*\n\n*{имя}!*\n\n📅 Сегодня *{дата}* — день оплаты!\n\n🔸 *{товар}*\n   • Ежемесячный платёж: *{сумма} ₽*\n   • Задолженность: *{долг} ₽* ({месяцы} мес.)\n\n💰 *ИТОГО К ОПЛАТЕ: {итого} ₽*\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``
};

const Integrations: React.FC<IntegrationsProps> = ({ appSettings, onUpdateSettings, onBack }) => {
  // WhatsApp State
  const [waEnabled, setWaEnabled] = useState(false);
  const [idInstance, setIdInstance] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [reminderTime, setReminderTime] = useState('10:00');
  const [reminderDays, setReminderDays] = useState<number[]>([0]);

  // Templates State
  const [activeTemplateTab, setActiveTemplateTab] = useState<'UPCOMING' | 'TODAY' | 'OVERDUE'>('TODAY');
  const [templates, setTemplates] = useState(DEFAULT_TEMPLATES);

  // Connection State
  const [isTesting, setIsTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'IDLE' | 'AUTHORIZED' | 'NOT_AUTHORIZED' | 'ERROR'>('IDLE');
  const [qrCode, setQrCode] = useState<string | null>(null);

  // Bot State
  const [botEnabled, setBotEnabled] = useState(false);
  const [botButtons, setBotButtons] = useState({ debt: true, paymentDate: true, conditions: true });

  // UI State
  const [isExpanded, setIsExpanded] = useState(false);
  const pollingRef = useRef<number | null>(null);

  useEffect(() => {
    if (appSettings.whatsapp) {
      setWaEnabled(appSettings.whatsapp.enabled);
      setIdInstance(appSettings.whatsapp.idInstance);
      setApiToken(appSettings.whatsapp.apiTokenInstance);
      setReminderTime(appSettings.whatsapp.reminderTime);
      setReminderDays(appSettings.whatsapp.reminderDays);
      setBotEnabled(appSettings.whatsapp.botEnabled || false);
      if (appSettings.whatsapp.botButtons) {
          setBotButtons(appSettings.whatsapp.botButtons);
      }
      if (appSettings.whatsapp.templates) {
        setTemplates({ ...DEFAULT_TEMPLATES, ...appSettings.whatsapp.templates });
      }
      setIsExpanded(appSettings.whatsapp.enabled);
      if (appSettings.whatsapp.enabled && appSettings.whatsapp.idInstance && appSettings.whatsapp.apiTokenInstance) {
        checkConnection(appSettings.whatsapp.idInstance, appSettings.whatsapp.apiTokenInstance);
      }
    }

    return () => {
      if (pollingRef.current) window.clearInterval(pollingRef.current);
    };
  }, [appSettings]);

  const checkConnection = async (id: string, token: string) => {
    if (!id || !token) return;
    setIsTesting(true);
    try {
      const isAuth = await checkGreenApiConnection(id, token);
      setConnectionStatus(isAuth ? 'AUTHORIZED' : 'NOT_AUTHORIZED');
      if (isAuth) {
        setQrCode(null);
        if (pollingRef.current) window.clearInterval(pollingRef.current);
      }
    } catch (e) {
      setConnectionStatus('ERROR');
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveSettings = () => {
    const waSettings: WhatsAppSettings = {
      enabled: waEnabled,
      idInstance,
      apiTokenInstance: apiToken,
      reminderTime,
      reminderDays,
      templates,
      botEnabled,
      botButtons
    };

    onUpdateSettings({
      ...appSettings,
      whatsapp: waSettings
    });

    if (waEnabled) {
      checkConnection(idInstance, apiToken);
      alert("Настройки и шаблоны сохранены. Проверяем соединение...");
    } else {
      alert("Настройки сохранены (Интеграция выключена).");
    }
  };

  const handleGetQrCode = async () => {
    if (!idInstance || !apiToken) {
      alert("Сначала введите IdInstance и ApiTokenInstance");
      return;
    }

    setIsTesting(true);
    const qr = await getQrCode(idInstance, apiToken);
    setIsTesting(false);

    if (qr) {
      setQrCode(qr);
      startPolling();
    } else {
      alert("Не удалось получить QR-код. Проверьте правильность данных или тариф.");
    }
  };

  const startPolling = () => {
    if (pollingRef.current) window.clearInterval(pollingRef.current);
    pollingRef.current = window.setInterval(async () => {
      const isAuth = await checkGreenApiConnection(idInstance, apiToken);
      if (isAuth) {
        setConnectionStatus('AUTHORIZED');
        setQrCode(null);
        if (pollingRef.current) window.clearInterval(pollingRef.current);
        alert("WhatsApp успешно подключен!");
      }
    }, 5000);
  };

  const toggleDay = (day: number) => {
    setReminderDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const updateTemplate = (text: string) => {
    if (activeTemplateTab === 'UPCOMING') setTemplates({ ...templates, upcoming: text });
    if (activeTemplateTab === 'TODAY') setTemplates({ ...templates, today: text });
    if (activeTemplateTab === 'OVERDUE') setTemplates({ ...templates, overdue: text });
  };

  const getCurrentTemplate = () => {
    if (activeTemplateTab === 'UPCOMING') return templates.upcoming;
    if (activeTemplateTab === 'TODAY') return templates.today;
    return templates.overdue;
  };

  const insertVariable = (variable: string) => {
    updateTemplate(getCurrentTemplate() + ` {${variable}}`);
  };

  const generateTimeOptions = () => {
    const options = [];
    for (let h = 0; h < 24; h++) {
      options.push(`${String(h).padStart(2, '0')}:00`);
      options.push(`${String(h).padStart(2, '0')}:30`);
    }
    return options;
  };

  const handleToggleEnable = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newState = !waEnabled;
    setWaEnabled(newState);
    if (newState) setIsExpanded(true);
    else setIsExpanded(false);
  };

  const handleCardClick = () => {
    if (waEnabled) {
      setIsExpanded(!isExpanded);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <header className="flex items-center gap-3">
        <button onClick={onBack} className="text-slate-500 hover:text-slate-800">
          {ICONS.Back}
        </button>
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Интеграции</h2>
          <p className="text-slate-500 text-sm">Подключение Green API (WhatsApp)</p>
        </div>
      </header>

      {/* WhatsApp Integration Card */}
      <div
        className={`bg-white rounded-2xl shadow-sm border transition-all duration-300 ${
          waEnabled ? 'border-emerald-200' : 'border-slate-200'
        }`}
      >
        {/* Header */}
        <div
          className={`p-5 flex justify-between items-center cursor-pointer transition-colors ${
            waEnabled ? 'bg-emerald-50/50 hover:bg-emerald-50' : 'bg-white hover:bg-slate-50'
          }`}
          onClick={handleCardClick}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center text-white ${
                waEnabled ? 'bg-emerald-500' : 'bg-slate-300'
              }`}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
              </svg>
            </div>
            <div>
              <h3 className="font-bold text-slate-800">WhatsApp</h3>
              <p className="text-xs text-slate-500">Провайдер: Green API</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {waEnabled && (
              <div className={`text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </div>
            )}
            <div onClick={handleToggleEnable} className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={waEnabled} onChange={() => {}} />
              <div className={`w-11 h-6 rounded-full peer peer-checked:bg-emerald-500 peer-focus:outline-none ${waEnabled ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                <div className={`absolute top-[2px] left-[2px] bg-white border border-gray-300 rounded-full h-5 w-5 transition-transform peer-checked:translate-x-full`}></div>
              </div>
            </div>
          </div>
        </div>

        {/* Expanded Content */}
        {waEnabled && isExpanded && (
          <div className="p-5 space-y-6 border-t border-slate-100 animate-fade-in">
            {/* Credentials */}
            <div className="space-y-4">
              <div className="bg-blue-50 p-4 rounded-xl text-sm text-blue-700">
                <p>1. Зарегистрируйтесь на <a href="https://console.green-api.com" target="_blank" rel="noreferrer" className="underline font-bold">Green API Console</a>.</p>
                <p>2. Создайте инстанс (можно Developer — бесплатно).</p>
                <p>3. Скопируйте <b>idInstance</b> и <b>apiTokenInstance</b> сюда.</p>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">idInstance</label>
                  <input
                    type="text"
                    className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 font-mono text-sm"
                    value={idInstance}
                    onChange={e => setIdInstance(e.target.value)}
                    placeholder="1101000001"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">apiTokenInstance</label>
                  <input
                    type="text"
                    className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 font-mono text-sm"
                    value={apiToken}
                    onChange={e => setApiToken(e.target.value)}
                    placeholder="Вставьте токен"
                  />
                </div>
              </div>
            </div>

            {/* Status */}
            <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-4">
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${connectionStatus === 'AUTHORIZED' ? 'bg-emerald-500' : connectionStatus === 'ERROR' ? 'bg-red-500' : 'bg-amber-500'}`}></div>
                <span className="text-sm font-bold text-slate-700">
                  {connectionStatus === 'AUTHORIZED' ? 'Подключено' : connectionStatus === 'NOT_AUTHORIZED' ? 'Требуется QR' : 'Не проверено'}
                </span>
              </div>
              <button
                onClick={() => checkConnection(idInstance, apiToken)}
                disabled={isTesting}
                className="text-sm text-indigo-600 font-bold hover:underline"
              >
                {isTesting ? 'Проверка...' : 'Проверить связь'}
              </button>
            </div>

            {/* QR Code */}
            {connectionStatus === 'NOT_AUTHORIZED' && (
              <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 text-center">
                {!qrCode ? (
                  <button
                    onClick={handleGetQrCode}
                    disabled={isTesting}
                    className="bg-slate-800 text-white px-6 py-3 rounded-xl font-bold shadow-lg hover:bg-slate-900 disabled:opacity-70 transition-all text-sm"
                  >
                    {isTesting ? 'Загрузка...' : 'Получить QR-код для входа'}
                  </button>
                ) : (
                  <div className="space-y-4">
                    <h4 className="font-bold text-slate-900">Сканируйте в WhatsApp</h4>
                    <div className="bg-white p-3 rounded-xl inline-block shadow-md">
                      <img src={`data:image/png;base64,${qrCode}`} alt="QR Code" className="w-56 h-56 object-contain" />
                    </div>
                    <div className="text-sm text-slate-600">
                      <ol className="text-left list-decimal list-inside space-y-1 bg-white/50 p-3 rounded-lg text-xs">
                        <li>Откройте WhatsApp на телефоне</li>
                        <li>Нажмите <b>Меню</b> или <b>Настройки</b></li>
                        <li>Выберите <b>Связанные устройства</b></li>
                        <li>Нажмите <b>Привязка устройства</b></li>
                      </ol>
                    </div>
                  </div>
                )}
              </div>
            )}

            <hr className="border-slate-100" />

            {/* Schedule */}
            <div>
              <h4 className="font-semibold text-slate-700 mb-3 text-sm flex items-center gap-2">
                {ICONS.Clock} Настройки рассылки
              </h4>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Время отправки</label>
                  <select
                    value={reminderTime}
                    onChange={e => setReminderTime(e.target.value)}
                    className="w-full p-2 border border-slate-200 rounded-lg text-sm bg-slate-50"
                  >
                    {generateTimeOptions().map(time => (
                      <option key={time} value={time}>
                        {time}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Когда напоминать?</label>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => toggleDay(0)}
                  className={`px-3 py-1.5 rounded-lg text-xs border font-medium transition-all ${
                    reminderDays.includes(0)
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-600 border-slate-200'
                  }`}
                >
                  В день оплаты
                </button>
                <button
                  onClick={() => toggleDay(-1)}
                  className={`px-3 py-1.5 rounded-lg text-xs border font-medium transition-all ${
                    reminderDays.includes(-1)
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-600 border-slate-200'
                  }`}
                >
                  За 1 день
                </button>
                <button
                  onClick={() => toggleDay(1)}
                  className={`px-3 py-1.5 rounded-lg text-xs border font-medium transition-all ${
                    reminderDays.includes(1)
                      ? 'bg-red-600 text-white border-red-600'
                      : 'bg-white text-slate-600 border-slate-200'
                  }`}
                >
                  При просрочке
                </button>
              </div>
            </div>

            <hr className="border-slate-100" />

            {/* Bot Settings */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-slate-700 text-sm flex items-center gap-2">
                  🤖 Чат-бот (Автоответчик)
                </h4>
                <div className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={botEnabled}
                    onChange={() => setBotEnabled(!botEnabled)}
                  />
                  <div className={`w-11 h-6 rounded-full peer peer-checked:bg-indigo-600 peer-focus:outline-none transition-colors ${botEnabled ? 'bg-indigo-600' : 'bg-slate-200'}`}>
                    <div className={`absolute top-[2px] left-[2px] bg-white border border-gray-300 rounded-full h-5 w-5 transition-transform ${botEnabled ? 'translate-x-full' : ''}`}></div>
                  </div>
                </div>
              </div>

              {botEnabled && (
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-4 animate-fade-in">
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Webhook URL (для Green API)</label>
                    <div className="flex gap-2">
                      <input
                        readOnly
                        className="w-full p-2 border border-slate-200 rounded-lg text-xs bg-white text-slate-600 font-mono select-all"
                        value={`${window.location.origin}/api/integrations/whatsapp/webhook`}
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`${window.location.origin}/api/integrations/whatsapp/webhook`);
                          alert("Скопировано!");
                        }}
                        className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100 whitespace-nowrap"
                      >
                        Копировать
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Укажите этот URL в настройках инстанса Green API в поле "Webhook URL"
                    </p>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Активные кнопки</label>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer hover:bg-slate-100 p-1 rounded-lg -ml-1 transition-colors">
                        <input
                          type="checkbox"
                          checked={botButtons.debt}
                          onChange={e => setBotButtons({ ...botButtons, debt: e.target.checked })}
                          className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 border-slate-300"
                        />
                        <span className="text-sm text-slate-700">📊 Мой долг</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer hover:bg-slate-100 p-1 rounded-lg -ml-1 transition-colors">
                        <input
                          type="checkbox"
                          checked={botButtons.paymentDate}
                          onChange={e => setBotButtons({ ...botButtons, paymentDate: e.target.checked })}
                          className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 border-slate-300"
                        />
                        <span className="text-sm text-slate-700">📅 Дата платежа</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer hover:bg-slate-100 p-1 rounded-lg -ml-1 transition-colors">
                        <input
                          type="checkbox"
                          checked={botButtons.conditions}
                          onChange={e => setBotButtons({ ...botButtons, conditions: e.target.checked })}
                          className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 border-slate-300"
                        />
                        <span className="text-sm text-slate-700">📝 Условия рассрочки</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <hr className="border-slate-100" />

            {/* Templates */}
            <div>
              <h4 className="font-semibold text-slate-700 mb-3 text-sm flex items-center gap-2">
                {ICONS.File} Шаблоны сообщений
              </h4>

              {/* Tabs */}
              <div className="flex bg-slate-100 p-1 rounded-xl mb-3">
                <button
                  onClick={() => setActiveTemplateTab('UPCOMING')}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                    activeTemplateTab === 'UPCOMING'
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500'
                  }`}
                >
                  Заранее
                </button>
                <button
                  onClick={() => setActiveTemplateTab('TODAY')}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                    activeTemplateTab === 'TODAY'
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500'
                  }`}
                >
                  Сегодня
                </button>
                <button
                  onClick={() => setActiveTemplateTab('OVERDUE')}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                    activeTemplateTab === 'OVERDUE'
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500'
                  }`}
                >
                  Просрочка
                </button>
              </div>

              {/* Editor */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                <textarea
                  className="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm outline-none focus:border-indigo-400 h-32 resize-none"
                  value={getCurrentTemplate()}
                  onChange={e => updateTemplate(e.target.value)}
                  placeholder="Текст сообщения..."
                />
                <div className="mt-3">
                  <p className="text-[10px] uppercase font-bold text-slate-400 mb-2">Переменные (нажмите чтобы добавить):</p>
                  <div className="flex flex-wrap gap-2">
                    {['имя', 'товар', 'сумма', 'дата', 'долг', 'итого', 'месяцы', 'долг_блок'].map(v => (
                      <button
                        key={v}
                        onClick={() => insertVariable(v)}
                        className="text-xs bg-white border border-slate-200 px-2 py-1 rounded-md text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-colors"
                      >
                        {`{${v}}`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={handleSaveSettings}
              className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
            >
              Сохранить настройки
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Integrations;