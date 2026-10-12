import React, { useState, useEffect } from 'react';
import Sheet from './Sheet';
import ApiKeys from './ApiKeys';
import { AppSettings, WhatsAppSettings } from '../types';
import { ICONS } from '../constants';
import { checkGreenApiConnection } from '../services/whatsapp';
import { api } from '../services/api';
import { isIOSApp, publicOrigin } from '../src/platform';
import { appConfirm } from '../src/dialogs';
import WhatsAppConnectSheet from './WhatsAppConnectSheet';
import { SheetSection, SheetField, SheetToggle, SheetSegmented, sheetInputClass } from './GlassSheet';

interface IntegrationsProps {
  appSettings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => void;
  onBack: () => void;
  whatsappRefreshKey?: number;
  onSettingsChanged?: () => void;
  /** Разрешает ли тариф выдавать API-ключи (Бизнес и выше) */
  apiAllowed?: boolean;
  /** Открыть тарифы, если API закрыт тарифом */
  onOpenTariffs?: () => void;
  /** Встроенный WhatsApp входит в тариф (Бизнес и выше). Green API — на любом, как раньше */
  builtinAllowed?: boolean;
}

const DEFAULT_TEMPLATES = {
  upcoming: `🔔 *Напоминание об оплате*

*{имя}!*

📅 *Завтра*, *{дата}* — день оплаты!

{товары_блок}

{итого_блок}

\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``,
  today: `🔔 *Напоминание об оплате*

*{имя}!*

📅 *Сегодня*, *{дата}* — день оплаты!

{товары_блок}

{итого_блок}

\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``,
  overdue: `🔔 *Напоминание о просрочке*

*{имя}!*

⚠️ Оплата по договору просрочена!

{товары_блок}

{итого_блок}

\`И будьте верны своим обещаниям, ибо за обещания вас призовут к ответу. Quran(17:34)\``
};

// Русское склонение: 1 день, 2 дня, 5 дней
const WA_ICON = "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z";

const formatWaPhone = (digits: string) =>
  /^7\d{10}$/.test(digits)
    ? `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`
    : `+${digits}`;

const pluralDays = (n: number) => {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return 'дней';
  if (last === 1) return 'день';
  if (last >= 2 && last <= 4) return 'дня';
  return 'дней';
};

const Integrations: React.FC<IntegrationsProps> = ({
    appSettings,
    onUpdateSettings,
    onBack,
    whatsappRefreshKey,
    onSettingsChanged,
    apiAllowed = false,
    onOpenTariffs,
    builtinAllowed = true
}) => {
  // 🔹 НОВАЯ ЛОГИКА: isConnected вместо waEnabled
  const [isConnected, setIsConnected] = useState(false);
  // Встроенный способ: номер привязан прямо в приложении, ключи на сервере
  const [connectOpen, setConnectOpen] = useState(false);
  const [builtinPhone, setBuiltinPhone] = useState<string | null>(null);
  const isBuiltin = appSettings.whatsapp?.provider === 'builtin';
  const [waSubscription, setWaSubscription] = useState<Awaited<ReturnType<typeof api.getWhatsAppSubscription>> | null>(null);
  const [showCredentials, setShowCredentials] = useState(false);

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
  const [overdueInterval, setOverdueInterval] = useState<number>(1);
  const [showPreview, setShowPreview] = useState(false);
  const [previewContent, setPreviewContent] = useState('');

  useEffect(() => {
    if (appSettings.whatsapp) {
      setIdInstance(appSettings.whatsapp.idInstance);
      setApiToken(appSettings.whatsapp.apiTokenInstance || '');
      setReminderTime(appSettings.whatsapp.reminderTime ?? '10:00');
      // 🔹 ИСПРАВЛЕНО: добавлен дефолт [0] если reminderDays undefined
      setReminderDays(appSettings.whatsapp.reminderDays ?? [0]);
      setBotEnabled(appSettings.whatsapp.botEnabled || false);
      setHistoryEnabled(appSettings.whatsapp.historyEnabled ?? true);
      setConditionsEnabled(appSettings.whatsapp.conditionsEnabled ?? true);
      setOverdueInterval(appSettings.whatsapp.overdueReminderInterval ?? 1);

      if (appSettings.whatsapp.templates) {
        const mergedTemplates = { ...DEFAULT_TEMPLATES, ...appSettings.whatsapp.templates };
        setTemplates(mergedTemplates);
        setCurrentTemplates(mergedTemplates);
      }

      // 🔹 Новая инициализация
      setIsConnected(appSettings.whatsapp.enabled);
      setShowCredentials(!appSettings.whatsapp.enabled);

      if (appSettings.whatsapp.enabled && appSettings.whatsapp.provider === 'builtin') {
        setShowCredentials(false);
        api.waBuiltin.status()
          .then(st => {
            setBuiltinPhone(st.phone || null);
            setConnectionStatus(st.loggedIn ? 'AUTHORIZED' : 'NOT_AUTHORIZED');
          })
          .catch(() => setConnectionStatus('ERROR'));
      } else if (appSettings.whatsapp.enabled && appSettings.whatsapp.idInstance && appSettings.whatsapp.apiTokenInstance) {
        checkConnection(appSettings.whatsapp.idInstance, appSettings.whatsapp.apiTokenInstance).catch(console.error);
        // Срок подписки — справочная строка, поэтому ошибку глотаем: настройки
        // не должны ломаться из-за недоступности стороннего сервиса.
        api.getWhatsAppSubscription().then(setWaSubscription).catch(() => setWaSubscription(null));
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

  // 🔹 Показать поля для ввода токенов
  const handleShowCredentials = () => setShowCredentials(true);

  // 🔹 Сохранить подключение
  const handleSaveConnection = async () => {
    if (!idInstance.trim() || !apiToken.trim()) {
      alert("⚠️ Заполните idInstance и apiTokenInstance");
      return;
    }

    setIsTesting(true);
    setConnectionStatus('IDLE');
    try {
      const isAuth = await checkGreenApiConnection(idInstance, apiToken);
      if (!isAuth) {
        setConnectionStatus('NOT_AUTHORIZED');
        alert("❌ Не удалось подключиться. Проверьте токены или статус инстанса в Green API Console.");
        return;
      }

      setConnectionStatus('AUTHORIZED');
      if (isBuiltin) await api.waBuiltin.disconnect().catch(console.error);
      onUpdateSettings({
        ...appSettings,
        whatsapp: { ...appSettings.whatsapp, enabled: true, provider: 'greenapi', idInstance, apiTokenInstance: apiToken }
      });
      setIsConnected(true);
      setShowCredentials(false);
      setIsTokenVisible(false);
      alert("✅ WhatsApp успешно подключен!");
    } catch (e) {
      setConnectionStatus('ERROR');
      console.error('Ошибка подключения:', e);
      alert("⚠️ Ошибка сети или сервера. Попробуйте позже.");
    } finally {
      setIsTesting(false);
    }
  };

  // 🔹 Отключить интеграцию
  const handleDisconnect = async () => {
    if (!await appConfirm("🔌 Отключить WhatsApp?\nРассылки и бот перестанут работать.")) return;

    // Встроенный — отвязываем номер на сервере, чтобы сессия не висела
    if (isBuiltin) await api.waBuiltin.disconnect().catch(console.error);
    onUpdateSettings({
      ...appSettings,
      whatsapp: { ...appSettings.whatsapp, enabled: false, provider: isBuiltin ? undefined : appSettings.whatsapp?.provider }
    });
    setBuiltinPhone(null);
    setIsConnected(false);
    setConnectionStatus('IDLE');
    setShowCredentials(false);
    alert("Интеграция отключена.");
  };

  // 🔹 Обновлённое сохранение настроек
  const handleSaveSettings = async () => {
    let calculatorConfigId: string | null = null;

    if (appSettings?.calculator?.termRates?.length > 0) {
      try {
        // Ссылка калькулятора у продавца одна (постоянная) — отправляем все его
        // настройки, иначе категории, скидки за взнос и округление затёрлись бы
        const c = appSettings.calculator;
        calculatorConfigId = (await api.saveCalculatorConfig({
          defaultRate: c.defaultInterestRate,
          termRates: c.termRates.map(r => ({ months: r.months, rate: r.rate })),
          categories: c.categories,
          downDiscounts: c.downDiscounts,
          roundStep: c.roundStep,
          roundDir: c.roundDir,
          markupOnRemainder: c.markupOnRemainder,
          slug: c.linkSlug,
          companyName: appSettings.companyName,
        })).configId;
      } catch (e) {
        console.error('❌ Не удалось сохранить конфиг калькулятора:', e);
      }
    }

    const waSettings: WhatsAppSettings = {
      enabled: isConnected, // 🔹 Используем isConnected вместо waEnabled
      provider: appSettings.whatsapp?.provider,
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
      calculatorConfigId: calculatorConfigId || appSettings?.whatsapp?.calculatorConfigId,
      overdueReminderInterval: overdueInterval
    };

    onUpdateSettings({ ...appSettings, whatsapp: { ...waSettings } });

    if (onSettingsChanged) {
      onSettingsChanged();
    }

    if (isConnected) {
      if (!isBuiltin) await checkConnection(idInstance, apiToken).catch(console.error);
      setIsTokenVisible(false);
      alert("✅ Настройки сохранены!");
    } else {
      alert("Интеграция WhatsApp отключена.");
    }
  };

  // 🔹 ИСПРАВЛЕНО: защита от undefined
  const toggleDay = (day: number) => {
    const currentDays = reminderDays || [];
    setReminderDays(
      currentDays.includes(day)
        ? currentDays.filter(d => d !== day)
        : [...currentDays, day]
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

  const resetCurrentTemplate = async () => {
    if (!await appConfirm('Вернуть шаблон к значению по умолчанию?')) return;
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

  const resetAllTemplates = async () => {
    if (!await appConfirm('Вернуть ВСЕ шаблоны к значениям по умолчанию?\n\nЭто действие нельзя отменить.')) return;
    setTemplates(DEFAULT_TEMPLATES);
    setCurrentTemplates(DEFAULT_TEMPLATES);
  };

  const previewTemplate = () => {
    const template = getCurrentTemplate();
    const sampleData = {
      имя: 'ФИО',
      товар: 'iPhone 15 Pro',
      сумма: '20 000',
      дата: '20 апреля 2026 г.',
      долг: '45 000',
      итого: '65 000',
      месяцы: '3',
      товары_блок: '🔸 *iPhone 15 Pro*\n   • К оплате: *20 000 ₽*\n   • Задолженность: *45 000 ₽* (3 мес.)\n\n🔸 *MacBook Air*\n   • Задолженность: *30 000 ₽* (2 мес.)',
      долг_блок: '',
      итого_блок: '💰 *ИТОГО К ОПЛАТЕ: 95 000 ₽*',
    };
    let preview = template;
    Object.entries(sampleData).forEach(([key, value]) => {
      preview = preview.replace(new RegExp(`{${key}}`, 'g'), value);
    });
    setPreviewContent(preview);
    setShowPreview(true);
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

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text).catch(console.error);
    alert("Скопировано!");
  };

  // Срок подписки Green API — строкой в карточке WhatsApp. Показываем, только
  // если он известен: партнёрский инстанс отдаёт его сам, свой — только если
  // пользователь вписал дату руками (Green API её не сообщает).
  const greenSubscriptionRow = (() => {
    if (!waSubscription) return null;
    const manual = !waSubscription.available;
    if (!manual && !waSubscription.expirationDate) return null;
    if (manual && waSubscription.reason !== 'not_partner_instance') return null;
    const iso = manual ? appSettings.whatsapp?.expiresAt : waSubscription.expirationDate;
    const days = manual
      ? (iso ? Math.ceil((new Date(iso + 'T23:59:59').getTime() - Date.now()) / 86400000) : null)
      : (waSubscription.daysLeft ?? null);
    const quota = waSubscription.planIssue === 'quota';
    const expired = !!waSubscription.isExpired || (days !== null && days < 0) || quota;
    const soon = !expired && days !== null && days <= 7;
    const date = iso ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
    const tone = expired ? 'text-rose-600 dark:text-rose-400' : soon ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400';
    return (
      <div className="px-4 py-3 space-y-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[15px] text-slate-900 dark:text-white">Подписка Green API{waSubscription.tariff ? ` · ${waSubscription.tariff}` : ''}</span>
          <span className={`text-[14px] font-medium ${tone}`}>
            {quota ? 'лимит исчерпан' : expired ? 'истекла' : date ? `до ${date}` : 'срок не указан'}
          </span>
        </div>
        {(expired || soon) && (
          <p className={`text-[12px] leading-snug ${tone}`}>
            {quota ? 'Месячный лимит тарифа исчерпан — смените тариф в личном кабинете Green API.'
              : expired ? 'Отправка не работает, пока не продлите подписку в личном кабинете Green API.'
                : `Осталось ${days} ${pluralDays(days!)}.`}
          </p>
        )}
        {manual && (
          <label className="flex items-center justify-between gap-3 pt-1">
            <span className="text-[12px] text-slate-400 dark:text-slate-500">Дата вводится вручную: свой инстанс срок не сообщает</span>
            <input type="date" value={appSettings.whatsapp?.expiresAt || ''}
                   onChange={e => onUpdateSettings({ ...appSettings, whatsapp: { ...appSettings.whatsapp!, expiresAt: e.target.value || undefined } })}
                   className="shrink-0 bg-transparent text-[14px] text-indigo-600 dark:text-indigo-400 outline-none" />
          </label>
        )}
      </div>
    );
  })();

  // Статус подключения одной строкой — под названием в карточке WhatsApp
  const waStatus = !isConnected
    ? { dot: 'bg-slate-300 dark:bg-slate-600', text: 'Не подключён' }
    : isBuiltin && connectionStatus === 'NOT_AUTHORIZED'
      ? { dot: 'bg-rose-500', text: 'Отключился — напоминания не уходят' }
      : isBuiltin
        ? { dot: 'bg-emerald-500', text: `Подключён в приложении${builtinPhone ? ` · ${formatWaPhone(builtinPhone)}` : ''}` }
        : { dot: connectionStatus === 'NOT_AUTHORIZED' ? 'bg-amber-500' : 'bg-emerald-500', text: 'Подключён · Green API' };

  const reminderRow = (day: number, label: string, description: string) => (
    <SheetToggle label={label} description={description}
                 checked={!!reminderDays?.includes(day)} onChange={() => toggleDay(day)} />
  );

  return (
    <div className="max-w-2xl space-y-6 animate-fade-in pb-24">
      <header className="flex items-center gap-3">
        <button onClick={onBack} className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white">{ICONS.Back}</button>
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Интеграции</h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm">WhatsApp и доступ к данным по API</p>
        </div>
      </header>

      {/* ── WhatsApp: состояние и подключение ───────────────────────────── */}
      <SheetSection title="WhatsApp">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <span className={`w-11 h-11 shrink-0 rounded-2xl flex items-center justify-center text-white ${isConnected ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={WA_ICON} /></svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-semibold text-slate-900 dark:text-white">Напоминания клиентам</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-slate-500 dark:text-slate-400">
              <span className={`w-2 h-2 shrink-0 rounded-full ${waStatus.dot}`} />
              <span className="truncate">{waStatus.text}</span>
            </p>
          </div>
          {isConnected && (
            <button onClick={handleDisconnect} className="shrink-0 text-[14px] font-semibold text-rose-600 dark:text-rose-400 active:opacity-60">
              Отключить
            </button>
          )}
        </div>

        {!isConnected && !builtinAllowed && !showCredentials && (
          <div className="px-4 pb-4 space-y-3">
            <p className="text-[14px] leading-snug text-slate-500 dark:text-slate-400">
              Подключение прямо в приложении — в тарифах «Бизнес» и «Бизнес Pro». На вашем тарифе можно подключить через сторонний сервис.
            </p>
            {onOpenTariffs && !isIOSApp() && (
              <button onClick={onOpenTariffs}
                      className="w-full h-11 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[15px] font-semibold active:opacity-85">
                Посмотреть тарифы
              </button>
            )}
          </div>
        )}

        {!isConnected && builtinAllowed && !showCredentials && (
          <div className="px-4 pb-4">
            <button onClick={() => setConnectOpen(true)}
                    className="w-full h-12 rounded-xl bg-emerald-600 text-white text-[16px] font-semibold active:opacity-85 transition-opacity">
              Подключить WhatsApp
            </button>
            <p className="mt-2 text-center text-[12px] text-slate-400 dark:text-slate-500">По коду из WhatsApp или QR — за минуту, без регистраций</p>
          </div>
        )}

        {isBuiltin && isConnected && connectionStatus === 'NOT_AUTHORIZED' && (
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-[14px] text-slate-600 dark:text-slate-300">Номер отвязан от сервиса</span>
            <button onClick={() => setConnectOpen(true)} className="shrink-0 h-9 px-3.5 rounded-xl bg-emerald-600 text-white text-[14px] font-semibold active:opacity-85">
              Подключить снова
            </button>
          </div>
        )}

        {/* Green API: срок подписки инстанса и ключи */}
        {isConnected && !isBuiltin && greenSubscriptionRow}
        {isConnected && !isBuiltin && !showCredentials && (
          <button onClick={() => setShowCredentials(true)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left active:bg-slate-50 dark:active:bg-slate-700/50">
            <span className="text-[15px] text-slate-900 dark:text-white">Ключи Green API</span>
            <span className="text-[14px] text-indigo-600 dark:text-indigo-400 font-medium">Изменить</span>
          </button>
        )}
      </SheetSection>

      {!isConnected && !showCredentials && (
        <button onClick={handleShowCredentials}
                className="-mt-3 w-full text-center text-[13px] font-medium text-slate-500 dark:text-slate-400 active:opacity-60">
          Подключить через сторонний сервис (Green API)
        </button>
      )}

      {/* ── Ключи Green API ─────────────────────────────────────────────── */}
      {showCredentials && (
        <SheetSection title="Green API"
                      hint={<>Ключи из <a href="https://console.green-api.com" target="_blank" rel="noreferrer" className="underline">личного кабинета Green API</a>: создайте инстанс и скопируйте idInstance и apiTokenInstance.</>}>
          <SheetField label="idInstance">
            <input className={`${sheetInputClass} font-mono`} value={idInstance} onChange={e => setIdInstance(e.target.value)} placeholder="1101000001" inputMode="numeric" />
          </SheetField>
          <SheetField label="apiTokenInstance">
            <div className="flex items-center gap-2">
              <input type={isTokenVisible ? 'text' : 'password'} className={`${sheetInputClass} font-mono`} value={apiToken} onChange={e => setApiToken(e.target.value)} placeholder="••••••••" />
              <button type="button" onClick={() => setIsTokenVisible(!isTokenVisible)} className="shrink-0 text-[13px] font-medium text-indigo-600 dark:text-indigo-400">
                {isTokenVisible ? 'Скрыть' : 'Показать'}
              </button>
            </div>
          </SheetField>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="flex items-center gap-2 text-[14px] text-slate-600 dark:text-slate-300">
              <span className={`w-2 h-2 rounded-full ${connectionStatus === 'AUTHORIZED' ? 'bg-emerald-500' : connectionStatus === 'ERROR' ? 'bg-rose-500' : connectionStatus === 'NOT_AUTHORIZED' ? 'bg-amber-500' : 'bg-slate-300'}`} />
              {connectionStatus === 'AUTHORIZED' ? 'Связь есть' : connectionStatus === 'NOT_AUTHORIZED' ? 'Инстанс не авторизован' : connectionStatus === 'ERROR' ? 'Ошибка соединения' : 'Не проверено'}
            </span>
            <button onClick={() => checkConnection(idInstance, apiToken).catch(console.error)} disabled={isTesting}
                    className="text-[14px] font-medium text-indigo-600 dark:text-indigo-400 disabled:opacity-50">
              {isTesting ? 'Проверка…' : 'Проверить'}
            </button>
          </div>
          <div className="flex gap-2 p-3">
            <button onClick={() => setShowCredentials(false)}
                    className="flex-1 h-11 rounded-xl bg-slate-100 dark:bg-slate-700 text-[15px] font-semibold text-slate-600 dark:text-slate-200 active:opacity-80">
              Отмена
            </button>
            <button onClick={handleSaveConnection} disabled={isTesting}
                    className="flex-1 h-11 rounded-xl bg-emerald-600 text-white text-[15px] font-semibold disabled:opacity-50 active:opacity-85">
              {isTesting ? 'Проверка…' : 'Подключить'}
            </button>
          </div>
        </SheetSection>
      )}

      {isConnected && !showCredentials && (
        <>
          {/* ── Рассылка ──────────────────────────────────────────────────── */}
          <SheetSection title="Рассылка" hint="Одно напоминание по платежу в день. Клиентам, у которых уведомления выключены в карточке, не пишем.">
            <label className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-[16px] text-slate-900 dark:text-white">Время отправки</span>
              <select value={reminderTime} onChange={e => setReminderTime(e.target.value)}
                      className="bg-transparent text-right text-[16px] font-medium text-indigo-600 dark:text-indigo-400 outline-none cursor-pointer">
                {generateTimeOptions().map(time => (<option key={time} value={time}>{time}</option>))}
              </select>
            </label>
            {reminderRow(-1, 'За день до оплаты', 'Предупреждение накануне')}
            {reminderRow(0, 'В день оплаты', 'Напоминание в сам день платежа')}
            {reminderRow(1, 'При просрочке', 'Пока долг не погашен')}
            {reminderDays?.includes(1) && (
              <label className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-[16px] text-slate-900 dark:text-white">Повторять при просрочке</span>
                <select value={overdueInterval} onChange={e => setOverdueInterval(Number(e.target.value))}
                        className="bg-transparent text-right text-[16px] font-medium text-indigo-600 dark:text-indigo-400 outline-none cursor-pointer">
                  <option value={1}>каждый день</option>
                  <option value={3}>раз в 3 дня</option>
                  <option value={7}>раз в неделю</option>
                  <option value={14}>раз в 2 недели</option>
                </select>
              </label>
            )}
          </SheetSection>

          {/* ── Шаблоны ───────────────────────────────────────────────────── */}
          <SheetSection title="Шаблоны сообщений">
            <div className="p-3 space-y-3">
              <SheetSegmented
                value={activeTemplateTab}
                onChange={setActiveTemplateTab}
                options={[{ id: 'UPCOMING', label: 'Заранее' }, { id: 'TODAY', label: 'В день' }, { id: 'OVERDUE', label: 'Просрочка' }]}
              />
              <textarea
                className="w-full h-44 resize-none rounded-xl bg-slate-50 dark:bg-slate-900 p-3 text-[15px] leading-relaxed text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500/30"
                value={getCurrentTemplate()} onChange={e => updateTemplate(e.target.value)} placeholder="Текст сообщения…"
              />
              <div className="-mx-3 px-3 flex gap-1.5 overflow-x-auto no-scrollbar">
                {['имя', 'товар', 'сумма', 'дата', 'долг', 'итого', 'месяцы', 'товары_блок', 'итого_блок'].map(v => (
                  <button key={v} onClick={() => insertVariable(v)}
                          className="shrink-0 h-8 px-2.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-[13px] font-mono text-slate-600 dark:text-slate-300 active:opacity-70">
                    {`{${v}}`}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 text-[13px] font-medium">
                <button type="button" onClick={previewTemplate} className="text-indigo-600 dark:text-indigo-400 active:opacity-60">Предпросмотр</button>
                <button type="button" onClick={resetCurrentTemplate} className="text-slate-500 dark:text-slate-400 active:opacity-60">Сбросить этот</button>
                <button type="button" onClick={resetAllTemplates} className="text-rose-600 dark:text-rose-400 active:opacity-60">Сбросить все</button>
              </div>
            </div>
          </SheetSection>

          {/* ── Автоответчик ──────────────────────────────────────────────── */}
          <SheetSection title="Автоответчик"
                        hint={isBuiltin ? 'Автоответчик пока работает только при подключении через Green API.' : 'Клиент пишет слово — бот отвечает сам. Название компании берётся из общих настроек.'}>
            {isBuiltin ? (
              <div className="px-4 py-3 text-[15px] text-slate-400 dark:text-slate-500">Недоступен при встроенном подключении</div>
            ) : (
              <>
                <SheetToggle label="Чат-бот" description="Отвечает на команды клиентов" checked={botEnabled} onChange={setBotEnabled} tone="indigo" />
                {botEnabled && (
                  <>
                    <SheetToggle label="История и долг" description="Клиент пишет: история, остаток, долг" checked={historyEnabled} onChange={setHistoryEnabled} tone="indigo" />
                    <SheetToggle label="Условия рассрочки" description="Клиент пишет: условия" checked={conditionsEnabled} onChange={setConditionsEnabled} tone="indigo" />
                    <div className="px-4 py-3">
                      <p className="text-[12px] font-medium text-slate-500 dark:text-slate-400">Webhook для настроек инстанса Green API</p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-slate-700 dark:text-slate-200 select-all">{`${publicOrigin()}/api/integrations/whatsapp/webhook`}</span>
                        <button onClick={() => copyToClipboard(`${publicOrigin()}/api/integrations/whatsapp/webhook`)}
                                className="shrink-0 text-[13px] font-medium text-indigo-600 dark:text-indigo-400">Скопировать</button>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </SheetSection>

          {/* ── Советы для встроенного способа ────────────────────────────── */}
          {isBuiltin && (
            <SheetSection title="Чтобы номер не ограничили">
              <ul className="divide-y divide-slate-100 dark:divide-slate-700/70">
                {[
                  ['Отдельный номер', 'Лучше WhatsApp Business с названием, фото и описанием компании.'],
                  ['Отвечайте клиентам', 'Живая переписка снижает риск. Приложение само делает паузы и не превышает дневной лимит.'],
                ].map(([t, d]) => (
                  <li key={t} className="px-4 py-3">
                    <p className="text-[15px] font-medium text-slate-900 dark:text-white">{t}</p>
                    <p className="mt-0.5 text-[13px] leading-snug text-slate-500 dark:text-slate-400">{d}</p>
                  </li>
                ))}
              </ul>
            </SheetSection>
          )}

          <button onClick={handleSaveSettings}
                  className="w-full h-12 rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[16px] font-semibold active:opacity-85">
            Сохранить настройки
          </button>
        </>
      )}

      {/* 🔹 МОДАЛЬНОЕ ОКНО ПРЕДПРОСМОТРА */}
      {showPreview && (
        <Sheet onClose={() => setShowPreview(false)} className="sm:max-w-md overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-700 bg-gradient-to-r from-indigo-50 to-emerald-50 dark:from-indigo-950/40 dark:to-emerald-950/40">
              <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2"><span className="text-lg">👁️</span> Предпросмотр сообщения</h3>
              <button onClick={() => setShowPreview(false)} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="p-4 max-h-[60vh] overflow-y-auto">
              <div className="bg-[#dcf8c6] rounded-2xl rounded-tr-sm p-4 shadow-sm border border-emerald-100 dark:border-emerald-900/50">
                <pre className="whitespace-pre-wrap text-sm text-slate-800 font-sans leading-relaxed">{previewContent}</pre>
              </div>
              <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-[10px] text-slate-500 dark:text-slate-400">💡 <b>Примечание:</b> Это пример. В реальном сообщении переменные заменятся на данные клиента.</p>
              </div>
            </div>
            <div className="flex gap-3 p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
              <button onClick={() => setShowPreview(false)} className="flex-1 py-2.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-medium text-sm hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors">Закрыть</button>
              <button onClick={() => { navigator.clipboard.writeText(previewContent); alert('📋 Скопировано!'); }} className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl font-medium text-sm hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                Копировать
              </button>
            </div>
          </Sheet>
      )}

      {/* API-ключи стоят рядом с WhatsApp: это тоже способ связать FinUchet
          с чем-то снаружи, и искать его в другом разделе незачем. */}
      <ApiKeys allowed={apiAllowed} onUpgrade={onOpenTariffs} />

      {connectOpen && (
        <WhatsAppConnectSheet
          onClose={() => setConnectOpen(false)}
          onConnected={phone => {
            // Сервер уже включил этот способ у себя; приводим к тому же и настройки приложения
            setBuiltinPhone(phone);
            setIsConnected(true);
            setShowCredentials(false);
            setConnectionStatus('AUTHORIZED');
            onUpdateSettings({
              ...appSettings,
              whatsapp: {
                ...appSettings.whatsapp,
                enabled: true,
                provider: 'builtin',
                idInstance: appSettings.whatsapp?.idInstance || '',
                apiTokenInstance: appSettings.whatsapp?.apiTokenInstance || '',
                reminderTime: appSettings.whatsapp?.reminderTime || '10:00',
                reminderDays: appSettings.whatsapp?.reminderDays || [0],
              },
            });
          }}
        />
      )}
    </div>
  );
};

export default Integrations;