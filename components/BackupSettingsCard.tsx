import React, { useState, useEffect, useRef } from 'react';
import { api } from '@/services/api';
import { BackupSettings, BackupFrequency, ViewState } from '../types';
import { ICONS } from '../constants';

interface BackupSettingsCardProps {
  onNavigate: (view: ViewState) => void;
}

const FREQUENCY_OPTIONS: { key: BackupFrequency; label: string; hint: string }[] = [
  { key: 'DAILY', label: 'Ежедневно', hint: 'Каждую ночь' },
  { key: 'WEEKLY', label: 'Еженедельно', hint: 'По понедельникам' },
  { key: 'MONTHLY', label: 'Ежемесячно', hint: '1-го числа' },
];

// Кнопка ручной отправки скрыта по просьбе: проверить работу уже удалось,
// а на каждый клик уходит письмо с вложением — при лимитах Gmail лишние отправки ни к чему.
// Роут /api/backup/run-now на сервере остался рабочим, так что вернуть кнопку — это снять флаг.
const SHOW_RUN_NOW_BUTTON = false;

// Длина кода и пауза перед повторной отправкой — должны совпадать с сервером
// (generateCode и RESEND_COOLDOWN_SEC в server/backup.js).
const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SEC = 60;

const STATUS_TEXT: Record<string, string> = {
  OK: 'Отправлено',
  EMPTY: 'Нет данных для выгрузки',
  ERROR: 'Ошибка отправки',
  SKIPPED: 'Пропущено',
  OVERSIZED: 'Отправлено без файла — слишком большой',
  TOO_MANY: 'Слишком много договоров — выгрузите вручную',
};

const formatDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const BackupSettingsCard: React.FC<BackupSettingsCardProps> = ({ onNavigate }) => {
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Дополнительный адрес: ввод почты → код из письма → подтверждение.
  const [extraEmailInput, setExtraEmailInput] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [isCodeStage, setIsCodeStage] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.getBackupSettings();
        setSettings(data);
        // Незавершённое подтверждение живёт на сервере, поэтому карточка
        // восстанавливает стадию ввода кода после перезагрузки страницы.
        setIsCodeStage(!!data.extraEmailPending);
        setExtraEmailInput(data.extraEmailPending || '');
      } catch (e: any) {
        setError(e.message || 'Не удалось загрузить настройки');
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // Обратный отсчёт до повторной отправки кода.
  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn(s => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  // Сообщение об успехе живёт несколько секунд: «Код отправлен», висящее на экране
  // до конца сессии, перестаёт что-либо значить. Ошибку не гасим — её надо прочитать.
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(id);
  }, [notice]);

  // Попав на стадию кода, сразу ставим курсор в поле — иначе на телефоне
  // приходится отдельно тыкать в него после переключения формы.
  useEffect(() => {
    if (isCodeStage) codeRef.current?.focus();
  }, [isCodeStage]);

  // Любое действие сбрасывает предыдущие сообщения — иначе рядом висят
  // старый успех и новая ошибка, и непонятно, что относится к последнему клику.
  const runAction = async (action: () => Promise<void>) => {
    setIsBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e: any) {
      setError(e.message || 'Что-то пошло не так');
    } finally {
      setIsBusy(false);
    }
  };

  const save = (patch: { enabled?: boolean; frequency?: BackupFrequency }) => {
    if (!settings) return;
    // Включение отправляет текущую частоту — и если она недоступна на тарифе
    // (осталась с прежнего, более высокого тарифа), сервер отказывал, и включить
    // копирование было нельзя вовсе. Берём ближайшую доступную.
    const current = patch.frequency ?? settings.frequency;
    const frequency = settings.allowedFrequencies.includes(current)
      ? current
      : settings.allowedFrequencies[settings.allowedFrequencies.length - 1];
    runAction(async () => {
      const updated = await api.updateBackupSettings({
        enabled: patch.enabled ?? settings.enabled,
        frequency,
      });
      setSettings(updated);
    });
  };

  if (isLoading) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Загрузка…</p>;
  }
  if (!settings) {
    return <p className="text-sm text-rose-600 dark:text-rose-400">{error || 'Настройки недоступны'}</p>;
  }

  const isAllowed = (key: BackupFrequency) => settings.allowedFrequencies.includes(key);

  // Адрес, для которого идёт подтверждение. Сервер — источник правды (он переживает
  // перезагрузку страницы), локальное поле — запасной вариант сразу после отправки,
  // пока настройки не перечитаны.
  const pendingAddress = settings.extraEmailPending || extraEmailInput;

  const sendCode = (email: string) => runAction(async () => {
    await api.requestBackupExtraEmail(email);
    // Перечитываем настройки, чтобы extraEmailPending пришёл с сервера: без этого
    // после перезагрузки страницы карточка не знала бы, какой адрес подтверждается.
    setSettings(await api.getBackupSettings());
    setIsCodeStage(true);
    setCodeInput('');
    setResendIn(RESEND_COOLDOWN_SEC);
    setNotice(`Код отправлен на ${email}`);
  });

  const confirmCode = () => {
    if (isBusy || codeInput.length < CODE_LENGTH) return;
    runAction(async () => {
      try {
        setSettings(await api.confirmBackupExtraEmail(codeInput));
      } catch (e) {
        // Неверный код очищаем сразу: оставлять его в поле — значит заставлять
        // пользователя стирать цифры вручную перед второй попыткой.
        setCodeInput('');
        codeRef.current?.focus();
        throw e;
      }
      setCodeInput('');
      setIsCodeStage(false);
      setResendIn(0);
      setExtraEmailInput('');
      setNotice('Адрес подтверждён — копии будут приходить и на него');
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-slate-700 dark:text-slate-300">Присылать копию на почту</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Excel со всеми договорами, платежами и сводкой — на <b className="break-all">{settings.accountEmail}</b>
          </p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={settings.enabled}
            disabled={isBusy}
            onChange={(e) => save({ enabled: e.target.checked })}
          />
          <div className="w-11 h-6 bg-slate-200 dark:bg-slate-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
        </label>
      </div>

      <div className={settings.enabled ? '' : 'opacity-50 pointer-events-none'}>
        <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase mb-2">Как часто</p>
        <div className="space-y-2">
          {FREQUENCY_OPTIONS.map(opt => {
            const allowed = isAllowed(opt.key);
            const selected = settings.frequency === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                disabled={isBusy}
                // Заблокированная частота остаётся кликабельной и ведёт на тарифы:
                // неактивная кнопка, которая просто не реагирует, читается как поломка.
                onClick={() => (allowed ? save({ frequency: opt.key }) : onNavigate('TARIFFS'))}
                className={`w-full flex items-center justify-between gap-3 p-3 rounded-xl border text-left transition-colors ${
                  selected && allowed
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                } ${allowed ? '' : 'opacity-70'}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`w-4 h-4 rounded-full border-2 shrink-0 ${
                    selected && allowed ? 'border-indigo-600 bg-indigo-600 ring-2 ring-inset ring-white dark:ring-slate-800' : 'border-slate-300 dark:border-slate-600'
                  }`} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{opt.label}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{opt.hint}</p>
                  </div>
                </div>
                {!allowed && (
                  <span className="flex items-center gap-1 shrink-0 text-[11px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded-full">
                    {ICONS.Crown} Нужен Стандарт
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {settings.allowedFrequencies.length < FREQUENCY_OPTIONS.length && (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            На вашем тарифе доступна ежемесячная копия. Ежедневная и еженедельная — с тарифа Стандарт.
          </p>
        )}
      </div>

      {/* Дополнительный адрес */}
      <div className={`pt-4 border-t border-slate-100 dark:border-slate-700 ${settings.enabled ? '' : 'opacity-50 pointer-events-none'}`}>
        <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase mb-2">Дополнительный адрес</p>

        {settings.extraEmail && settings.extraEmailVerified ? (
          <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40">
            <p className="text-sm text-slate-700 dark:text-slate-300 break-all">
              {settings.extraEmail}
              <span className="ml-2 text-xs text-emerald-600 dark:text-emerald-400">подтверждён</span>
            </p>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => runAction(async () => {
                setSettings(await api.removeBackupExtraEmail());
                setExtraEmailInput('');
                setCodeInput('');
                setIsCodeStage(false);
                setResendIn(0);
                setNotice('Дополнительный адрес удалён');
              })}
              className="shrink-0 text-sm text-rose-600 dark:text-rose-400 hover:underline"
            >
              Убрать
            </button>
          </div>
        ) : isCodeStage ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Код отправлен на <b className="break-all">{pendingAddress}</b>
            </p>
            <div className="flex gap-2">
              <input
                ref={codeRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={CODE_LENGTH}
                value={codeInput}
                // Код всегда цифровой — отсекаем всё остальное на вводе,
                // чтобы «неверный код» не всплывал из-за случайного пробела.
                onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
                onKeyDown={(e) => { if (e.key === 'Enter') confirmCode(); }}
                placeholder={`Код из письма (${CODE_LENGTH} цифр)`}
                className="flex-1 min-w-0 px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-lg text-sm tracking-[0.3em] focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="button"
                disabled={isBusy || codeInput.length < CODE_LENGTH}
                onClick={confirmCode}
                className="shrink-0 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                Подтвердить
              </button>
            </div>
            <div className="flex items-center gap-4">
              <button
                type="button"
                disabled={isBusy || resendIn > 0}
                onClick={() => sendCode(pendingAddress)}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline disabled:text-slate-400 dark:disabled:text-slate-500 disabled:no-underline"
              >
                {resendIn > 0 ? `Отправить снова через ${resendIn} с` : 'Отправить код ещё раз'}
              </button>
              <button
                type="button"
                disabled={isBusy}
                // Сбрасываем и на сервере: иначе незавершённая попытка вернёт
                // карточку к вводу кода при следующем открытии настроек.
                onClick={() => runAction(async () => {
                  setSettings(await api.cancelBackupExtraEmail());
                  setIsCodeStage(false);
                  setCodeInput('');
                  setResendIn(0);
                  // Адрес оставляем в поле: «изменить» обычно значит поправить опечатку.
                  setExtraEmailInput(pendingAddress);
                })}
                className="text-xs text-slate-500 dark:text-slate-400 hover:underline"
              >
                Изменить адрес
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              type="email"
              value={extraEmailInput}
              onChange={(e) => setExtraEmailInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && extraEmailInput.trim()) sendCode(extraEmailInput.trim()); }}
              placeholder="например, бухгалтеру"
              className="flex-1 min-w-0 px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="button"
              disabled={isBusy || !extraEmailInput.trim()}
              onClick={() => sendCode(extraEmailInput.trim())}
              className="shrink-0 px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50"
            >
              {isBusy ? 'Отправляем…' : 'Отправить код'}
            </button>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Копия всегда уходит на почту аккаунта. Второй адрес нужно подтвердить кодом — иначе на него ничего не отправляется.
        </p>
      </div>

      {/* Состояние: когда была последняя копия и когда будет следующая */}
      <div className="pt-4 border-t border-slate-100 dark:border-slate-700 space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-slate-400 dark:text-slate-500">Последняя копия</p>
            <p className="text-slate-700 dark:text-slate-300">{formatDateTime(settings.lastRunAt)}</p>
            {settings.lastStatus && (
              <p className={`text-xs ${settings.lastStatus === 'OK' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {STATUS_TEXT[settings.lastStatus] || settings.lastStatus}
                {settings.lastError ? `: ${settings.lastError}` : ''}
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-slate-400 dark:text-slate-500">Следующая</p>
            <p className="text-slate-700 dark:text-slate-300">{settings.enabled ? formatDateTime(settings.nextRunAt) : 'Выключено'}</p>
          </div>
        </div>

        {SHOW_RUN_NOW_BUTTON && (
          <button
            type="button"
            disabled={isBusy || !settings.enabled}
            onClick={() => runAction(async () => {
              await api.runBackupNow();
              setNotice('Копия отправлена — проверьте почту');
              setSettings(await api.getBackupSettings());
            })}
            className="w-full py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50"
          >
            {isBusy ? 'Отправляем…' : 'Отправить копию сейчас'}
          </button>
        )}
      </div>

      {notice && <p className="text-sm text-emerald-600 dark:text-emerald-400">{notice}</p>}
      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
};

export default BackupSettingsCard;
