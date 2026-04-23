import React, { useState, useEffect } from 'react';
import { AppSettings, WhatsAppSettings } from '../types';
import { ICONS } from '../constants';
import { checkGreenApiConnection } from '../services/whatsapp';

import { api } from '../services/api';
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
  overdue: `🔔 *Напоминание о просрочке*\n\n*{имя}!*\n\n⚠️ Оплата по договору просрочена!\n\n🔸 *{товар}*\n   • Ежемесячный платёж: *{сумма} ₽*\n   • Задолженность: *{долг} ₽* ({месяцы} мес.)\n\n💰 *ИТОГО К ОПЛАТЕ: {итого} ₽*\n\n\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``
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

  const [activeTemplateTab, setActiveTemplateTab] = useState<'UPCOMING' | 'TODAY' | 'OVERDUE'>('TODAY');
  const [templates, setTemplates] = useState(DEFAULT_TEMPLATES);
  const [currentTemplates, setCurrentTemplates] = useState(DEFAULT_TEMPLATES);

  const [isTesting, setIsTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'IDLE' | 'AUTHORIZED' | 'NOT_AUTHORIZED' | 'ERROR'>('IDLE');

  const [botEnabled, setBotEnabled] = useState(false);
  const [historyEnabled, setHistoryEnabled] = useState(true);
  const [conditionsEnabled, setConditionsEnabled] = useState(true);

  const [isExpanded, setIsExpanded] = useState(false);
  const [overdueInterval, setOverdueInterval] = useState<number>(1);

  const [showPreview, setShowPreview] = useState(false);


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
      setOverdueInterval(appSettings.whatsapp.overdueReminderInterval ?? 1);

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
  // 🔥 1. Сначала сохраняем конфиг калькулятора (если есть ставки)
  let calculatorConfigId: string | null = null;

  if (appSettings?.calculator?.termRates?.length > 0) {
    try {
      calculatorConfigId = await api.saveCalculatorConfig({
        defaultRate: appSettings.calculator.defaultInterestRate,
        termRates: appSettings.calculator.termRates.map(r => ({
          months: r.months,
          rate: r.rate
        }))
      });

    } catch (e) {
      console.error('❌ Не удалось сохранить конфиг калькулятора:', e);
      // Не прерываем сохранение остальных настроек
    }
  }

  // 🔥 2. Формируем настройки WhatsApp
  const waSettings: WhatsAppSettings = {
    enabled: waEnabled,
    idInstance,
    apiTokenInstance: apiToken,
    reminderTime,
    reminderDays,
    templates: {
      upcoming: templates.upcoming,
      today: templates.today,
      overdue: templates.overdue
    },
    botEnabled,
    historyEnabled,
    conditionsEnabled,
    companyName: appSettings?.companyName || 'Наша Компания',
    calculator: appSettings?.calculator,
    // 🔥 3. Сохраняем configId для короткой ссылки
    calculatorConfigId: calculatorConfigId || appSettings?.whatsapp?.calculatorConfigId,
    overdueReminderInterval: overdueInterval
  };

  // 🔥 4. Обновляем настройки
  onUpdateSettings({
    ...appSettings,
    whatsapp: { ...waSettings }
  });

  if (onSettingsChanged) {
    onSettingsChanged();
  }

  // 🔥 5. Проверяем соединение с WhatsApp
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


  // 🔹 Сбросить текущий шаблон к значению по умолчанию
const resetCurrentTemplate = () => {
  if (!window.confirm('Вернуть шаблон к значению по умолчанию?')) {
    return;
  }

  const newTemplates = { ...templates };

  if (activeTemplateTab === 'UPCOMING') {
    newTemplates.upcoming = DEFAULT_TEMPLATES.upcoming;
  } else if (activeTemplateTab === 'TODAY') {
    newTemplates.today = DEFAULT_TEMPLATES.today;
  } else if (activeTemplateTab === 'OVERDUE') {
    newTemplates.overdue = DEFAULT_TEMPLATES.overdue;
  }

  setTemplates(newTemplates);
  setCurrentTemplates(newTemplates);
};

// 🔹 Сбросить ВСЕ шаблоны к значениям по умолчанию
const resetAllTemplates = () => {
  if (!window.confirm('Вернуть ВСЕ шаблоны к значениям по умолчанию?\n\nЭто действие нельзя отменить.')) {
    return;
  }

  setTemplates(DEFAULT_TEMPLATES);
  setCurrentTemplates(DEFAULT_TEMPLATES);
};


// 🔹 Предпросмотр шаблона с подставленными данными
const previewTemplate = () => {
  const template = getCurrentTemplate();

  // Пример данных для предпросмотра
  const sampleData = {
    имя: 'ФИО',
    товар: 'iPhone 15 Pro',
    сумма: '20 000',
    дата: '20 апреля 2026 г.',
    долг: '45 000',
    итого: '65 000',
    месяцы: '3',
    платеж_блок: '   • Платёж по плану: *20 000 ₽*\n   • Остаток за этот месяц: *20 000 ₽*\n',
    долг_блок: '   • Задолженность: *45 000 ₽* (3 мес.)\n',
    итого_блок: '\n💰 *ИТОГО К ОПЛАТЕ: 65 000 ₽*',
  };

  // Заменяем переменные на примеры
  let preview = template;
  Object.entries(sampleData).forEach(([key, value]) => {
    preview = preview.replace(new RegExp(`{${key}}`, 'g'), value);
  });

  // Сохраняем в состояние для отображения в модальном окне
  setPreviewContent(preview);
  setShowPreview(true);
};

// 🔹 Состояние для контента предпросмотра
const [previewContent, setPreviewContent] = useState('');


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
      <header className="flex items-center gap-3">
        <button onClick={onBack} className="text-slate-500 hover:text-slate-800">
          {ICONS.Back}
        </button>
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Интеграции</h2>
          <p className="text-slate-500 text-sm">Подключение Green API (WhatsApp)</p>
        </div>
      </header>

      <div
        className={`bg-white rounded-2xl shadow-sm border transition-all duration-300 ${
          waEnabled ? 'border-emerald-200' : 'border-slate-200'
        }`}
      >
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
            {/* ✅ Переключатель WhatsApp с правильной обработкой */}
<label className="relative inline-flex items-center cursor-pointer">
  <input
    type="checkbox"
    className="sr-only peer"
    checked={waEnabled}
    onChange={(e) => {
      e.stopPropagation(); // ← Останавливаем всплытие
      const newState = e.target.checked;
      setWaEnabled(newState);
      setIsExpanded(newState);
    }}
    onClick={(e) => {
      e.stopPropagation(); // ← Двойная защита
    }}
  />
  <div
    onClick={(e) => e.stopPropagation()} // ← Останавливаем клик на div
    className={`w-11 h-6 rounded-full peer peer-checked:bg-emerald-500 peer-focus:outline-none transition-colors ${
      waEnabled ? 'bg-emerald-500' : 'bg-slate-200'
    }`}
  >
    <div
      className={`absolute top-[2px] left-[2px] bg-white border border-gray-300 rounded-full h-5 w-5 transition-transform peer-checked:translate-x-full`}
    ></div>
  </div>
</label>
          </div>
        </div>

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
                  <div className="relative">
                    <input
                      type={isTokenVisible ? "text" : "password"}
                      className="w-full p-3 pr-10 border border-slate-200 rounded-xl bg-slate-50 font-mono text-sm"
                      value={apiToken}
                      onChange={e => setApiToken(e.target.value)}
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setIsTokenVisible(!isTokenVisible)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {isTokenVisible ? '👁️' : '🔒'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Status */}
            <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-4">
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${connectionStatus === 'AUTHORIZED' ? 'bg-emerald-500' : connectionStatus === 'ERROR' ? 'bg-red-500' : 'bg-amber-500'}`}></div>
                <span className="text-sm font-bold text-slate-700">
                  {connectionStatus === 'AUTHORIZED' ? 'Подключено' : connectionStatus === 'NOT_AUTHORIZED' ? 'Не авторизован' : 'Не проверено'}
                </span>
              </div>
              <button
                onClick={() => checkConnection(idInstance, apiToken).catch(console.error)}
                disabled={isTesting}
                className="text-sm text-indigo-600 font-bold hover:underline"
              >
                {isTesting ? 'Проверка...' : 'Проверить связь'}
              </button>
            </div>

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

            {/* 🔥 Интервал повторных напоминаний при просрочке */}
{reminderDays.includes(1) && (
  <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl">
    <label className="text-xs font-bold text-amber-800 uppercase mb-2 block">
      ⏱ Интервал напоминаний при просрочке
    </label>
    <select
      value={overdueInterval}
      onChange={e => setOverdueInterval(Number(e.target.value))}
      className="w-full p-2 border border-amber-300 rounded-lg text-sm bg-white text-amber-900 font-medium"
    >
      <option value={1}>Каждый день</option>
      <option value={3}>Раз в 3 дня</option>
      <option value={7}>Раз в неделю</option>
      <option value={14}>Раз в 2 недели</option>
    </select>
    <p className="text-[10px] text-amber-700 mt-1">
      💡 Клиент получит повторное напоминание только через указанный интервал,
      если долг не погашен
    </p>
  </div>
)}


            <hr className="border-slate-100" />

            {/* Templates */}
            <div>
              <h4 className="font-semibold text-slate-700 mb-3 text-sm flex items-center gap-2">
                {ICONS.File} Шаблоны сообщений
              </h4>
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
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                <textarea
                    className="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm outline-none focus:border-indigo-400 h-32 resize-none"
                    value={getCurrentTemplate()}
                    onChange={e => updateTemplate(e.target.value)}
                    placeholder="Текст сообщения..."
                />
                <div className="mt-3 space-y-3">
                  {/* Переменные */}
                  <div>
                    <p className="text-[10px] uppercase font-bold text-slate-400 mb-2">Переменные:</p>
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

                  {/* 🔹 Кнопки сброса */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                    {/* 🔹 Кнопка предпросмотра — слева */}
                    <button
                        type="button"
                        onClick={previewTemplate}
                        className="text-[10px] text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
                        title="Посмотреть, как будет выглядеть сообщение"
                    >
                      👁️ Предпросмотр
                    </button>

                    {/* 🔹 Кнопки сброса — справа */}
                    <div className="flex items-center gap-3">
                      <button
                          type="button"
                          onClick={resetCurrentTemplate}
                          className="text-[10px] text-amber-600 hover:text-amber-800 font-medium flex items-center gap-1"
                          title="Сбросить только этот шаблон"
                      >
                        ↩️ Этот шаблон
                      </button>

                      <button
                          type="button"
                          onClick={resetAllTemplates}
                          className="text-[10px] text-red-600 hover:text-red-800 font-medium flex items-center gap-1"
                          title="Сбросить все 3 шаблона"
                      >
                        🗑️ Все по умолчанию
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <hr className="border-slate-100"/>

            {/* ЧАТ-БОТ */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-slate-700 text-sm flex items-center gap-2">
                  🤖 Чат-бот (Автоответчик)
                </h4>
                <div
                    className="relative inline-flex items-center cursor-pointer"
                    onClick={() => setBotEnabled(!botEnabled)}
                >
                  <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={botEnabled}
                      onChange={() => {
                      }}
                  />
                  <div
                      className={`w-11 h-6 rounded-full peer peer-checked:bg-indigo-600 peer-focus:outline-none transition-colors ${botEnabled ? 'bg-indigo-600' : 'bg-slate-200'}`}>
                    <div
                        className={`absolute top-[2px] left-[2px] bg-white border border-gray-300 rounded-full h-5 w-5 transition-transform ${botEnabled ? 'translate-x-full' : ''}`}></div>
                  </div>
                </div>
              </div>

              {botEnabled && (
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-4 animate-fade-in">
                  {/* Webhook URL */}
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Webhook URL</label>
                    <div className="flex gap-2">
                      <input
                        readOnly
                        className="w-full p-2 border border-slate-200 rounded-lg text-xs bg-white text-slate-600 font-mono select-all"
                        value={`${window.location.origin}/api/integrations/whatsapp/webhook`}
                      />
                      <button
                        onClick={() => copyToClipboard(`${window.location.origin}/api/integrations/whatsapp/webhook`)}
                        className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100 whitespace-nowrap"
                      >
                        Копировать
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Укажите этот URL в настройках инстанса Green API
                    </p>
                  </div>

                  {/* Команды бота */}
                  <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 space-y-3">
                    <h5 className="font-semibold text-indigo-900 text-sm">Активные команды:</h5>

                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={historyEnabled}
                        onChange={e => setHistoryEnabled(e.target.checked)}
                        className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                      />
                      <div>
                        <p className="text-sm font-medium text-indigo-900">📋 История / Долг</p>
                        <p className="text-xs text-indigo-600">Клиент пишет: *история*, *остаток*, *долг*</p>
                      </div>
                    </label>

                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={conditionsEnabled}
                        onChange={e => setConditionsEnabled(e.target.checked)}
                        className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                      />
                      <div>
                        <p className="text-sm font-medium text-indigo-900">📝 Условия рассрочки</p>
                        <p className="text-xs text-indigo-600">Клиент пишет: *условия*</p>
                      </div>
                    </label>
                  </div>

                  {/* Инфо */}
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                    <div className="flex gap-3">
                      <div className="text-2xl">💬</div>
                      <div>
                        <p className="text-sm font-bold text-emerald-900 mb-1">Бот работает по текстовым командам</p>
                        <p className="text-xs text-emerald-700">
                          Название компании для бота берётся из общих настроек: <b>{appSettings?.companyName || 'Наша Компания'}</b>
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
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

      {/* 🔹 МОДАЛЬНОЕ ОКНО ПРЕДПРОСМОТРА */}
{showPreview && (
  <div
    className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-fade-in"
    onClick={() => setShowPreview(false)}
  >
    <div
      className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-scale-in"
      onClick={e => e.stopPropagation()}
    >
      {/* Заголовок */}
      <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-gradient-to-r from-indigo-50 to-emerald-50">
        <h3 className="font-bold text-slate-800 flex items-center gap-2">
          <span className="text-lg">👁️</span> Предпросмотр сообщения
        </h3>
        <button
          onClick={() => setShowPreview(false)}
          className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* Контент предпросмотра */}
      <div className="p-4 max-h-[60vh] overflow-y-auto">
        {/* Имитация пузыря сообщения WhatsApp */}
        <div className="bg-[#dcf8c6] rounded-2xl rounded-tr-sm p-4 shadow-sm border border-emerald-100">
          <pre className="whitespace-pre-wrap text-sm text-slate-800 font-sans leading-relaxed">
            {previewContent}
          </pre>
        </div>

        {/* Подсказка */}
        <div className="mt-4 p-3 bg-slate-50 rounded-xl border border-slate-200">
          <p className="text-[10px] text-slate-500">
            💡 <b>Примечание:</b> Это пример. В реальном сообщении переменные заменятся на данные клиента.
          </p>
        </div>
      </div>

      {/* Кнопки */}
      <div className="flex gap-3 p-4 border-t border-slate-100 bg-slate-50">
        <button
          onClick={() => setShowPreview(false)}
          className="flex-1 py-2.5 bg-slate-200 text-slate-700 rounded-xl font-medium text-sm hover:bg-slate-300 transition-colors"
        >
          Закрыть
        </button>
        <button
          onClick={() => {
            navigator.clipboard.writeText(previewContent);
            alert('📋 Скопировано!');
          }}
          className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl font-medium text-sm hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Копировать
        </button>
      </div>
    </div>
  </div>
)}
    </div>
  );
};

export default Integrations;