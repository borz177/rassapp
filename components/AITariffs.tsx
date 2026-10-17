import React, { useEffect, useState } from 'react';
import { CreditCard } from 'lucide-react';
import AIOrb from './AIOrb';
import { api } from '../services/api';
import { toast } from '../src/toast';
import { rememberPendingPayment } from '../src/pendingPayment';
import { isIOSApp } from '../src/platform';
import { PayMethodButton, SbpMark } from './Tariffs';

/**
 * Тарифы FinUchetGPT — отдельно от основных. Подписка на месяц, лимит
 * запросов в месяц (запрос — одно сообщение: текст, голос или фото). Цены и
 * лимиты приходят с сервера (AI_PLANS в server/index.js).
 *
 * В приложении для iPhone цены и оплату не показываем — правила App Store
 * (как и на экране основных тарифов, src/platform.ts).
 */

const FEATURES: Record<string, string[]> = {
  AI_START: ['Ответы по долгам, платежам и прибыли', 'Принять платёж, расход, приход — голосом', 'Фото паспорта → готовый договор', '300 запросов в месяц'],
  AI_PRO: ['Всё из «ИИ Старт»', '1 000 запросов в месяц', 'Для тех, кто работает с ассистентом весь день'],
};

const AITariffs: React.FC = () => {
  const [status, setStatus] = useState<any>(null);
  const [buying, setBuying] = useState<{ plan: string; method: string } | null>(null);
  const iosApp = isIOSApp();

  useEffect(() => { api.aiAssistant.status().then(setStatus).catch(() => {}); }, []);

  const buy = async (plan: string, method: 'sbp' | 'card') => {
    setBuying({ plan, method });
    try {
      const data = await api.aiAssistant.buy(plan, method);
      if (data.id) rememberPendingPayment(data.id);
      window.location.href = data.confirmationUrl;
    } catch (e: any) {
      toast.error('Не удалось перейти к оплате', { message: 'Попробуйте ещё раз через минуту. Деньги не списаны.' });
      setBuying(null);
    }
  };

  const plans = status?.plans || [];

  return (
    <div className="max-w-3xl mx-auto space-y-5 pb-24">
      <div className="ai-msg-in flex flex-col items-center text-center pt-2">
        <AIOrb size={72} />
        <h2 className="mt-4 text-2xl font-bold text-slate-900 dark:text-white">Тарифы FinUchetGPT</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 max-w-md">
          Отдельно от основного тарифа. Запрос — одно сообщение: вопрос, голосовое или фото, сколько бы шагов ассистент ни сделал внутри.
        </p>
        {status && (
          <p className="mt-3 px-3 py-1.5 rounded-full text-xs font-semibold bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300">
            {status.plan
              ? `Сейчас: ${status.plan.name} до ${new Date(status.plan.expiresAt).toLocaleDateString('ru-RU')} · осталось ${status.left} запросов`
              : `Пробный доступ · осталось ${status.left} из 20 бесплатных запросов`}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {plans.map((p: any, i: number) => {
          const current = status?.plan?.key === p.key;
          const pro = p.key === 'AI_PRO';
          return (
            <div key={p.key} style={{ animationDelay: `${120 + i * 90}ms` }}
                 className={`ai-msg-in relative overflow-hidden rounded-3xl p-5 border ${pro
                   ? 'border-violet-300 dark:border-violet-500/40 bg-gradient-to-br from-violet-50 to-fuchsia-50 dark:from-violet-500/10 dark:to-fuchsia-500/10'
                   : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'}`}>
              {pro && <span className="absolute top-4 right-4 px-2.5 py-1 rounded-full text-[10px] font-bold bg-violet-600 text-white">Выгоднее</span>}
              <p className="text-lg font-bold text-slate-900 dark:text-white">{p.name}</p>
              {!iosApp && (
                <p className="mt-1"><span className="text-3xl font-bold text-slate-900 dark:text-white">{p.price.toLocaleString('ru-RU')} ₽</span><span className="text-sm text-slate-500"> / мес</span></p>
              )}
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{p.monthly.toLocaleString('ru-RU')} запросов в месяц{!iosApp ? ` · ≈ ${(p.price / p.monthly).toFixed(2).replace('.', ',')} ₽ за запрос` : ''}</p>
              <ul className="mt-4 space-y-2">
                {(FEATURES[p.key] || []).map(f => (
                  <li key={f} className="flex gap-2 text-sm text-slate-700 dark:text-slate-200">
                    <span className="text-violet-500 shrink-0">✦</span>{f}
                  </li>
                ))}
              </ul>
              {!iosApp && (
                <div className="mt-5 space-y-2">
                  <PayMethodButton primary onClick={() => buy(p.key, 'sbp')} disabled={!!buying}
                                   loading={buying?.plan === p.key && buying.method === 'sbp'}
                                   icon={<SbpMark />} title={current ? 'Продлить через СБП' : 'Оплатить через СБП'} hint="Без комиссии, в приложении банка" />
                  <PayMethodButton onClick={() => buy(p.key, 'card')} disabled={!!buying}
                                   loading={buying?.plan === p.key && buying.method === 'card'}
                                   icon={<CreditCard size={20} />} title="Картой" hint="Visa, Mastercard, МИР" />
                </div>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
};

export default AITariffs;
