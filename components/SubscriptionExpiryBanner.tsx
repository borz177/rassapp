import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { ICONS } from '../constants';
import { isIOSApp } from '../src/platform';
import { api } from '../services/api';
import { CHURN_REASON_LABELS } from '../src/churnReasons';

interface SubscriptionExpiryBannerProps {
  user?: User | null;
  onRenew: () => void;
}

// За сколько до конца начинаем предупреждать. Раньше не нужно: подписка ещё
// действует полностью, и постоянная плашка превращается в фон, который перестают читать.
const WARN_WITHIN_HOURS = 24;

const HIDDEN_UNTIL_KEY = 'finuchet_subscription_banner_hidden_until';
// Ответ на опрос — по окончанию конкретной подписки: продлил и снова не продлил —
// спросим ещё раз.
const SURVEY_KEY = (expiresAt: number) => `finuchet_churn_answered_${expiresAt}`;

/**
 * «Почему не продлеваете?» — один вопрос на плашке истёкшей подписки. Варианты —
 * в одно касание, пояснение — по желанию. Ответы видны в админке («Удержание»).
 */
const ChurnSurvey: React.FC<{ expiresAt: number }> = ({ expiresAt }) => {
  const [done, setDone] = useState(() => { try { return !!localStorage.getItem(SURVEY_KEY(expiresAt)); } catch { return false; } });
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const [thanks, setThanks] = useState(false);
  if (done && !thanks) return null;
  if (thanks) return <p className="mt-3 text-xs font-semibold text-rose-800 dark:text-rose-300">Спасибо! Ответ поможет сделать программу лучше.</p>;

  const send = async () => {
    if (!reason) return;
    setSending(true);
    try {
      await api.sendChurnFeedback(reason, details.trim() || undefined);
      try { localStorage.setItem(SURVEY_KEY(expiresAt), reason); } catch { /* приватный режим */ }
      setDone(true);
      setThanks(true);
    } catch {
      setSending(false);
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-rose-200/70 dark:border-rose-900/50">
      <p className="text-xs font-semibold text-rose-900 dark:text-rose-300">Не планируете продлевать? Подскажите почему — это займёт 5 секунд</p>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {Object.entries(CHURN_REASON_LABELS).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setReason(k)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                    reason === k
                      ? 'bg-rose-600 border-rose-600 text-white'
                      : 'bg-white/70 dark:bg-slate-900/40 border-rose-200 dark:border-rose-900/60 text-rose-800 dark:text-rose-300'}`}>
            {label}
          </button>
        ))}
      </div>
      {reason && (
        <div className="mt-2 flex flex-col sm:flex-row gap-2">
          <input value={details} onChange={e => setDetails(e.target.value)} maxLength={1000}
                 placeholder={reason === 'missing_feature' ? 'Какой функции не хватило?' : 'Пару слов, если хотите (необязательно)'}
                 className="flex-1 px-3 py-2 rounded-xl text-sm bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 text-slate-900 dark:text-white outline-none focus:border-rose-400" />
          <button type="button" onClick={send} disabled={sending}
                  className="px-4 py-2 rounded-xl text-sm font-bold bg-rose-600 text-white disabled:opacity-60">
            {sending ? 'Отправляем…' : 'Отправить'}
          </button>
        </div>
      )}
    </div>
  );
};

const plural = (n: number, one: string, few: string, many: string) => {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};

/**
 * Плашка на главной: подписка заканчивается в ближайшие сутки или уже закончилась.
 *
 * Два разных состояния, а не одно с разным цветом: до окончания это напоминание,
 * которое можно отложить, а после — объяснение, почему перестал работать учёт.
 * Второе скрывать нельзя, иначе человек будет видеть только ошибки при сохранении
 * и не поймёт их причину.
 */
const SubscriptionExpiryBanner: React.FC<SubscriptionExpiryBannerProps> = ({ user, onRenew }) => {
  // Пересчитываем раз в минуту: иначе на открытой вкладке «через 2 часа» так и висит,
  // когда подписка уже кончилась.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const [hiddenUntil, setHiddenUntil] = useState<number>(() => {
    const raw = localStorage.getItem(HIDDEN_UNTIL_KEY);
    return raw ? Number(raw) || 0 : 0;
  });

  const expiresAt = user?.subscription?.expiresAt ? new Date(user.subscription.expiresAt).getTime() : null;
  if (!expiresAt || isNaN(expiresAt)) return null;

  const msLeft = expiresAt - now;
  const isExpired = msLeft <= 0;
  const hoursLeft = Math.floor(msLeft / (1000 * 60 * 60));

  // Пока до окончания больше суток — молчим.
  if (!isExpired && hoursLeft >= WARN_WITHIN_HOURS) return null;
  // Отложенное напоминание. К истёкшей подписке не применяется.
  if (!isExpired && now < hiddenUntil) return null;

  const timeText = () => {
    if (hoursLeft >= 1) return `через ${hoursLeft} ${plural(hoursLeft, 'час', 'часа', 'часов')}`;
    const minutes = Math.max(1, Math.floor(msLeft / (1000 * 60)));
    return `через ${minutes} ${plural(minutes, 'минуту', 'минуты', 'минут')}`;
  };

  const expiryClock = new Date(expiresAt).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });

  // В iOS-сборке звать к оплате нельзя (см. src/platform.ts): плашка только сообщает.
  const canRenew = !isIOSApp();

  const snooze = () => {
    // Прячем на 4 часа, а не до конца дня: при остатке в сутки более долгая пауза
    // означала бы, что напоминание больше не появится вообще.
    const until = Date.now() + 4 * 60 * 60 * 1000;
    localStorage.setItem(HIDDEN_UNTIL_KEY, String(until));
    setHiddenUntil(until);
  };

  return (
    <div
      role="status"
      className={`rounded-2xl border p-4 flex items-start gap-3 animate-fade-in ${
        isExpired
          ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/50'
          : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/50'
      }`}
    >
      <div className={`shrink-0 p-2 rounded-xl ${
        isExpired
          ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400'
          : 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'
      }`}>
        {isExpired ? ICONS.Alert : ICONS.Clock}
      </div>

      <div className="flex-1 min-w-0">
        <p className={`font-bold text-sm ${
          isExpired ? 'text-rose-900 dark:text-rose-300' : 'text-amber-900 dark:text-amber-300'
        }`}>
          {isExpired ? 'Подписка истекла' : `Подписка истекает ${timeText()}`}
        </p>
        <p className={`text-xs mt-0.5 leading-relaxed ${
          isExpired ? 'text-rose-700 dark:text-rose-400' : 'text-amber-700 dark:text-amber-400'
        }`}>
          {isExpired
            ? `Учёт остановлен: нельзя оформлять договоры, проводить платежи и вносить изменения. Данные на месте${canRenew ? ' — продлите тариф, чтобы продолжить работу' : ''}.`
            : `Действует до ${expiryClock}. После этого нельзя будет оформлять договоры и проводить платежи — данные при этом сохранятся.`}
        </p>

        {(canRenew || !isExpired) && <div className="flex items-center gap-3 mt-3">
          {canRenew && <button
            onClick={onRenew}
            className={`px-4 py-2 rounded-xl text-sm font-bold text-white transition-colors ${
              isExpired ? 'bg-rose-600 hover:bg-rose-700' : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            Продлить
          </button>}
          {!isExpired && (
            <button
              onClick={snooze}
              className="text-xs text-amber-700/70 dark:text-amber-400/70 hover:underline"
            >
              Напомнить позже
            </button>
          )}
        </div>}
        {isExpired && user?.role === 'manager' && <ChurnSurvey expiresAt={expiresAt} />}
      </div>
    </div>
  );
};

export default SubscriptionExpiryBanner;
