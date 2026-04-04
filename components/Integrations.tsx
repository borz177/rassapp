import React, { useState, useEffect } from 'react';
import { AppSettings, WhatsAppSettings } from '../types';
import { ICONS } from '../constants';
import { checkGreenApiConnection } from '../services/whatsapp';

interface IntegrationsProps {
  appSettings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => void;
  onBack: () => void;
  whatsappRefreshKey?: number;
  onSettingsChanged?: () => void;
}

const DEFAULT_TEMPLATES = {
  upcoming: `🔔 *Напоминание об оплате*\n\n*{имя}!*\n\n📅 *Завтра*, *{дата}* — день оплаты!\n\n🔸 *{товар}*\n   • К оплате: *{сумма} ₽*\n\n{долг_блок}\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``,
  today: `🔔 *Напоминание об оплате*\n\n*{имя}!*\n\n📅 *Сегодня*, *{дата}* — день оплаты!\n\n🔸 *{товар}*\n   • К оплате: *{сумма} ₽*\n\n{долг_блок}\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``,
  overdue: `🔔 *Напоминание о просрочке*\n\n*{имя}!*\n\n⚠️ Оплата по договору просрочена!\n\n🔸 *{товар}*\n   • Ежемесячный платёж: *{сумма} ₽*\n   • Задолженность: *{долг} ₽* ({месяцы} мес.)\n\n💰 *ИТОГО К ОПЛАТЕ: {итого} ₽*\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``,
};

const Integrations: React.FC<IntegrationsProps> = ({
    appSettings,
    onUpdateSettings,
    onBack,
    whatsappRefreshKey,
    onSettingsChanged
}) => {
  const [waEnabled, setWaEnabled] = useState(false);
  const [idInstance, setIdInstance] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [isTokenVisible, setIsTokenVisible] = useState(true);
  const [reminderTime, setReminderTime] = useState('10:00');
  const [reminderDays, setReminderDays] = useState<number[]>([0]);

  const [activeTemplateTab, setActiveTemplateTab] = useState<'UPCOMING' | 'TODAY' | 'OVERDUE' | 'WELCOME'>('TODAY');
  const [templates, setTemplates] = useState(DEFAULT_TEMPLATES);
  const [currentTemplates, setCurrentTemplates] = useState(DEFAULT_TEMPLATES);

  const [isTesting, setIsTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'IDLE' | 'AUTHORIZED' | 'NOT_AUTHORIZED' | 'ERROR'>('IDLE');

  const [botEnabled, setBotEnabled] = useState(false);



  // 🔥 Настройки команд бота
  const [historyEnabled, setHistoryEnabled] = useState(true);
  const [conditionsEnabled, setConditionsEnabled] = useState(true);

  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (appSettings.whatsapp) {
      setWaEnabled(appSettings.whatsapp.enabled);
      setIdInstance(appSettings.whatsapp.idInstance);
      setApiToken(appSettings.whatsapp.apiTokenInstance || '');
      setReminderTime(appSettings.whatsapp.reminderTime);
      setReminderDays(appSettings.whatsapp.reminderDays);
      setBotEnabled(appSettings.whatsapp.botEnabled || false);

      setHistoryEnabled(appSettings.whatsapp.historyEnabled ?? true);
      setConditionsEnabled(appSettings.whatsapp.conditionsEnabled ?? true);

      if (appSettings.whatsapp.templates) {
        const mergedTemplates = { ...DEFAULT_TEMPLATES, ...appSettings.whatsapp.templates };
        setTemplates(mergedTemplates);
        setCurrentTemplates(mergedTemplates);
      }
      setIsExpanded(appSettings.whatsapp.enabled);
      if (appSettings.whatsapp.enabled && appSettings.whatsapp.idInstance && appSettings.whatsapp.apiTokenInstance) {
        checkConnection(appSettings.whatsapp.idInstance, appSettings.whatsapp.apiTokenInstance).catch(console.error);
        setIsTokenVisible(false);
      }
    }
  }, [appSettings]);

  useEffect(() => {
    if (appSettings.whatsapp?.templates) {
      const mergedTemplates = { ...DEFAULT_TEMPLATES, ...appSettings.whatsapp.templates };
      setTemplates(mergedTemplates);
      setCurrentTemplates(mergedTemplates);
    }
  }, [whatsappRefreshKey, appSettings.whatsapp?.templates]);

  const checkConnection = async (id: string, token: string) => {
    if (!id || !token) return;
    setIsTesting(true);
    try {
      const isAuth = await checkGreenApiConnection(id, token);
      setConnectionStatus(isAuth ? 'AUTHORIZED' : 'NOT_AUTHORIZED');
    } catch (e) {
      setConnectionStatus('ERROR');
      console.error('Ошибка проверки соединения:', e);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveSettings = async () => {
    const waSettings: WhatsAppSettings = {
      enabled: waEnabled,
      idInstance,
      apiTokenInstance: apiToken,
      reminderTime,
      reminderDays,
      templates: {
        upcoming: templates.upcoming,
        today: templates.today,
        overdue: templates.overdue,

      },
      botEnabled,

      historyEnabled,
      conditionsEnabled
    };

    onUpdateSettings({
      ...appSettings,
      whatsapp: { ...waSettings }
    });

    if (onSettingsChanged) {
      onSettingsChanged();
    }

    if (waEnabled) {
      await checkConnection(idInstance, apiToken).catch(console.error);
      setIsTokenVisible(false);
      alert("✅ Настройки сохранены!");
    } else {
      alert("Интеграция WhatsApp отключена.");
    }
  };

  const toggleDay = (day: number) => {
    setReminderDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const updateTemplate = (text: string) => {
    const newTemplates = { ...templates };
    if (activeTemplateTab === 'UPCOMING') {
      newTemplates.upcoming = text;
    } else if (activeTemplateTab === 'TODAY') {
      newTemplates.today = text;
    } else if (activeTemplateTab === 'OVERDUE') {
      newTemplates.overdue = text;
    }
    setTemplates(newTemplates);
    setCurrentTemplates(newTemplates);
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

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text).catch(console.error);
    alert("Скопировано!");
  };

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      {/* Header */}
      <header className="flex items-center gap-3">
        <button onClick={onBack} className="text-slate-500 hover:text-slate-800 transition-colors">
          {ICONS.Back}
        </button>
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Интеграции</h2>
          <p className="text-slate-500 text-sm">Подключение Green API (WhatsApp)</p>
        </div>
      </header>

      {/* 🔥 КАРТОЧКА 1: Подключение WhatsApp */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div
          className={`p-5 flex justify-between items-center cursor-pointer transition-colors ${
            waEnabled ? 'bg-gradient-to-r from-emerald-50 to-emerald-50/50' : 'bg-white hover:bg-slate-50'
          }`}
          onClick={handleCardClick}
        >
          <div className="flex items-center gap-4">
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-lg ${
                waEnabled ? 'bg-gradient-to-br from-emerald-400 to-emerald-600' : 'bg-slate-300'
              }`}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
              </svg>
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-lg">WhatsApp</h3>
              <p className="text-xs text-slate-500">Провайдер: Green API</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {waEnabled && (
              <div className={`text-slate-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </div>
            )}
            <div onClick={handleToggleEnable} className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={waEnabled} onChange={() => {}} />
              <div className={`w-12 h-7 rounded-full peer peer-checked:bg-emerald-500 peer-focus:outline-none transition-colors ${waEnabled ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                <div className={`absolute top-[3px] left-[3px] bg-white border border-gray-300 rounded-full h-6 w-6 transition-transform duration-300 shadow-md peer-checked:translate-x-5`}></div>
              </div>
            </div>
          </div>
        </div>

        {waEnabled && isExpanded && (
          <div className="p-6 space-y-6 border-t border-slate-100 animate-fade-in bg-gradient-to-b from-white to-slate-50/50">

            {/* 🔥 СЕКЦИЯ 1: Учётные данные */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <h4 className="font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <span className="text-lg">🔑</span> Учётные данные
              </h4>

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-4">
                <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
                  <li>Зарегистрируйтесь на <a href="https://console.green-api.com" target="_blank" rel="noreferrer" className="underline font-bold hover:text-blue-900">Green API Console</a></li>
                  <li>Создайте инстанс (можно Developer — бесплатно)</li>
                  <li>Скопируйте <b>idInstance</b> и <b>apiTokenInstance</b> сюда</li>
                </ol>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">idInstance</label>
                  <input
                    type="text"
                    className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 font-mono text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none transition-all"
                    value={idInstance}
                    onChange={e => setIdInstance(e.target.value)}
                    placeholder="1101000001"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">apiTokenInstance</label>
                  <div className="relative">
                    <input
                      type={isTokenVisible ? "text" : "password"}
                      className="w-full p-3 pr-10 border border-slate-200 rounded-xl bg-slate-50 font-mono text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none transition-all"
                      value={apiToken}
                      onChange={e => setApiToken(e.target.value)}
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setIsTokenVisible(!isTokenVisible)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {isTokenVisible ? '👁️' : '🔒'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Status */}
              <div className="flex items-center justify-between gap-4 border-t border-slate-100 mt-4 pt-4">
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${connectionStatus === 'AUTHORIZED' ? 'bg-emerald-500' : connectionStatus === 'ERROR' ? 'bg-red-500' : 'bg-amber-500'}`}></div>
                  <span className="text-sm font-bold text-slate-700">
                    {connectionStatus === 'AUTHORIZED' ? 'Подключено' : connectionStatus === 'NOT_AUTHORIZED' ? 'Не авторизован' : 'Не проверено'}
                  </span>
                </div>
                <button
                  onClick={() => checkConnection(idInstance, apiToken).catch(console.error)}
                  disabled={isTesting}
                  className="text-sm text-emerald-600 font-bold hover:underline disabled:opacity-50"
                >
                  {isTesting ? 'Проверка...' : 'Проверить связь'}
                </button>
              </div>
            </div>

            {/* 🔥 СЕКЦИЯ 2: Настройки рассылки */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <h4 className="font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <span className="text-lg">⏰</span> Настройки рассылки
              </h4>

              <div className="grid md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Время отправки</label>
                  <select
                    value={reminderTime}
                    onChange={e => setReminderTime(e.target.value)}
                    className="w-full p-3 border border-slate-200 rounded-lg text-sm bg-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none transition-all"
                  >
                    {generateTimeOptions().map(time => (
                      <option key={time} value={time}>{time}</option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="text-xs font-bold text-slate-500 uppercase mb-3 block">Когда напоминать?</label>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => toggleDay(0)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all border-2 ${
                    reminderDays.includes(0)
                      ? 'bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-200'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300'
                  }`}
                >
                  В день оплаты
                </button>
                <button
                  onClick={() => toggleDay(-1)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all border-2 ${
                    reminderDays.includes(-1)
                      ? 'bg-indigo-500 text-white border-indigo-500 shadow-md shadow-indigo-200'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
                  }`}
                >
                  За 1 день
                </button>
                <button
                  onClick={() => toggleDay(1)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all border-2 ${
                    reminderDays.includes(1)
                      ? 'bg-red-500 text-white border-red-500 shadow-md shadow-red-200'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-red-300'
                  }`}
                >
                  При просрочке
                </button>
              </div>
            </div>

            {/* 🔥 СЕКЦИЯ 3: Шаблоны сообщений */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <h4 className="font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <span className="text-lg">📝</span> Шаблоны сообщений
              </h4>

              <div className="flex bg-slate-100 p-1.5 rounded-xl mb-4 gap-1">
                {[
                  { id: 'UPCOMING', label: 'Заранее', icon: '⏰' },
                  { id: 'TODAY', label: 'Сегодня', icon: '📅' },
                  { id: 'OVERDUE', label: 'Просрочка', icon: '⚠️' },

                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTemplateTab(tab.id as typeof activeTemplateTab)}
                    className={`flex-1 py-2.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                      activeTemplateTab === tab.id
                        ? 'bg-white text-slate-800 shadow-sm border border-slate-200'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <span>{tab.icon}</span>
                    <span className="hidden sm:inline">{tab.label}</span>
                  </button>
                ))}
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <textarea
                  className="w-full bg-white border border-slate-200 rounded-xl p-4 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 h-40 resize-none transition-all font-mono"
                  value={getCurrentTemplate()}
                  onChange={e => updateTemplate(e.target.value)}
                  placeholder="Текст сообщения..."
                />
                <div className="mt-4">
                  <p className="text-[10px] uppercase font-bold text-slate-400 mb-3">Переменные:</p>
                  <div className="flex flex-wrap gap-2">
                    {(activeTemplateTab === 'WELCOME' ? ['имя', 'managerName'] : ['имя', 'товар', 'сумма', 'дата', 'долг', 'итого', 'месяцы', 'долг_блок']).map(v => (
                      <button
                        key={v}
                        onClick={() => insertVariable(v)}
                        className="text-xs bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-slate-600 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200 transition-all font-mono"
                      >
                        {`{${v}}`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* 🔥 СЕКЦИЯ 4: Чат-бот */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-semibold text-slate-700 flex items-center gap-2">
                  <span className="text-lg">🤖</span> Чат-бот (Автоответчик)
                </h4>
                <div
                  className="relative inline-flex items-center cursor-pointer"
                  onClick={() => setBotEnabled(!botEnabled)}
                >
                  <input type="checkbox" className="sr-only peer" checked={botEnabled} onChange={() => {}} />
                  <div className={`w-12 h-7 rounded-full peer peer-checked:bg-indigo-600 peer-focus:outline-none transition-colors ${botEnabled ? 'bg-indigo-600' : 'bg-slate-200'}`}>
                    <div className={`absolute top-[3px] left-[3px] bg-white border border-gray-300 rounded-full h-6 w-6 transition-transform duration-300 shadow-md peer-checked:translate-x-5`}></div>
                  </div>
                </div>
              </div>

              {botEnabled && (
                <div className="space-y-4 animate-fade-in">
                  {/* Webhook URL */}
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Webhook URL</label>
                    <div className="flex gap-2">
                      <input
                        readOnly
                        className="flex-1 p-2.5 border border-slate-200 rounded-lg text-xs bg-white text-slate-600 font-mono select-all focus:border-indigo-400 outline-none"
                        value={`${window.location.origin}/api/integrations/whatsapp/webhook`}
                      />
                      <button
                        onClick={() => copyToClipboard(`${window.location.origin}/api/integrations/whatsapp/webhook`)}
                        className="px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-all whitespace-nowrap"
                      >
                        Копировать
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-2">
                      Укажите этот URL в настройках инстанса Green API
                    </p>
                  </div>

                  {/* 🔥 Настройки команд бота */}
                  <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 space-y-3">
                    <h5 className="font-semibold text-indigo-900 text-sm flex items-center gap-2">
                      <span>⚙️</span> Активные команды
                    </h5>

                    <div className="space-y-3">
                      {/* Команда: История */}
                      <div className="flex items-center justify-between bg-white p-3 rounded-lg border border-indigo-100">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center text-lg">
                            📋
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-800">История договоров</p>
                            <p className="text-xs text-slate-500">Детали, платежи, долг</p>
                          </div>
                        </div>
                        <div
                          className="relative inline-flex items-center cursor-pointer"
                          onClick={() => setHistoryEnabled(!historyEnabled)}
                        >
                          <input type="checkbox" className="sr-only peer" checked={historyEnabled} onChange={() => {}} />
                          <div className={`w-11 h-6 rounded-full peer peer-checked:bg-emerald-500 peer-focus:outline-none transition-colors ${historyEnabled ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                            <div className={`absolute top-[2px] left-[2px] bg-white border border-gray-300 rounded-full h-5 w-5 transition-transform peer-checked:translate-x-full`}></div>
                          </div>
                        </div>
                      </div>

                      {/* Команда: Условия */}
                      <div className="flex items-center justify-between bg-white p-3 rounded-lg border border-indigo-100">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center text-lg">
                            🔗
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-800">Условия рассрочки</p>
                            <p className="text-xs text-slate-500">Ссылка на калькулятор</p>
                          </div>
                        </div>
                        <div
                          className="relative inline-flex items-center cursor-pointer"
                          onClick={() => setConditionsEnabled(!conditionsEnabled)}
                        >
                          <input type="checkbox" className="sr-only peer" checked={conditionsEnabled} onChange={() => {}} />
                          <div className={`w-11 h-6 rounded-full peer peer-checked:bg-blue-500 peer-focus:outline-none transition-colors ${conditionsEnabled ? 'bg-blue-500' : 'bg-slate-200'}`}>
                            <div className={`absolute top-[2px] left-[2px] bg-white border border-gray-300 rounded-full h-5 w-5 transition-transform peer-checked:translate-x-full`}></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>



                  {/* 🔥 Справка по командам */}
                  <div className="bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200 rounded-xl p-4">
                    <h5 className="font-semibold text-slate-800 text-sm mb-3 flex items-center gap-2">
                      <span>💬</span> Как это работает
                    </h5>
                    <div className="grid sm:grid-cols-2 gap-3 text-xs">
                      <div className="flex items-start gap-2 bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-lg">📋</span>
                        <div>
                          <p className="font-bold text-slate-700">Клиент пишет «история»</p>
                          <p className="text-slate-500 mt-0.5">Бот показывает детали договоров и платежи</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2 bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-lg">🔗</span>
                        <div>
                          <p className="font-bold text-slate-700">Клиент пишет «условия»</p>
                          <p className="text-slate-500 mt-0.5">Бот отправляет ссылку на калькулятор</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Save Button */}
            <button
              onClick={handleSaveSettings}
              className="w-full py-4 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white font-bold rounded-xl hover:from-indigo-700 hover:to-indigo-800 transition-all shadow-lg shadow-indigo-200 hover:shadow-xl hover:shadow-indigo-300 active:scale-[0.98]"
            >
              💾 Сохранить настройки
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Integrations;