import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { PartnerSummary } from '../types';

const money = (v: string | number | null | undefined) =>
  Number(v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Заработок бизнес-партнёра на его реферальной странице.
 *
 * Показываем не только итог, но и полную выкладку по каждому начислению: сумму
 * платежа клиента, процент и результат. Без этого человек не может проверить
 * расчёт сам, а спорят здесь о деньгах. Цены тарифов и так публичные, тайны в
 * них нет — а вот почту и телефон клиента не показываем: партнёр и так знает,
 * кого привёл, и система не должна раздавать контакты.
 *
 * Если партнёрство не включено, компонент не рисует ничего — реферальная
 * программа с днями живёт отдельно и от него не зависит.
 */
const PartnerEarnings: React.FC = () => {
  const [data, setData] = useState<PartnerSummary | null>(null);

  useEffect(() => {
    // Ошибку глотаем: блок дополнительный, и падать из-за него страница не должна.
    api.getPartnerSummary().then(setData).catch(() => setData(null));
  }, []);

  if (!data?.isPartner || !data.totals) return null;

  const { earned, paid, pending, clients } = data.totals;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="font-bold text-slate-800 dark:text-white">Партнёрское вознаграждение</h3>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
          {data.percent}%
        </span>
      </div>

      {/* Главное число — то, ради чего сюда заходят */}
      <div className="rounded-2xl p-5 bg-gradient-to-br from-emerald-600 to-emerald-500 text-white shadow-lg shadow-emerald-200 dark:shadow-emerald-900/30">
        <p className="text-xs uppercase tracking-wider text-emerald-100 font-bold">К выплате</p>
        <p className="text-4xl font-bold mt-1">{money(pending)} ₽</p>
        <p className="text-emerald-100 text-sm mt-1">
          заработано {money(earned)} ₽ · выплачено {money(paid)} ₽
        </p>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        {data.percent}% с каждой оплаты клиентов, пришедших по вашей ссылке.
        Действует с {data.since ? longDate(data.since) : '—'},
        {' '}{data.termMonths ? `${data.termMonths} мес. с регистрации клиента` : 'бессрочно'}.
        {' '}Приведено клиентов: {clients}.
      </p>

      {/* Начисления с выкладкой: клиент, что он заплатил, ваш процент, итог */}
      {!!data.commissions?.length && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200">Начисления</h4>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {data.commissions.map(c => (
              <div key={c.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">
                    {c.client_name || 'Клиент'}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {shortDate(c.created_at)} · {c.plan}, {c.months} мес. ·
                    {' '}{money(c.base_amount)} ₽ × {Number(c.percent)}%
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-slate-800 dark:text-white">+{money(c.amount)} ₽</p>
                  <p className={`text-[10px] font-bold ${
                    c.status === 'paid'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : c.status === 'cancelled'
                        ? 'text-rose-500'
                        : 'text-slate-400 dark:text-slate-500'
                  }`}>
                    {c.status === 'paid' ? 'выплачено' : c.status === 'cancelled' ? 'отменено' : 'начислено'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!!data.payouts?.length && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200">Выплаты</h4>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {data.payouts.map(p => (
              <div key={p.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-white">{shortDate(p.created_at)}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {[p.method, p.receipt && `чек ${p.receipt}`, p.note].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
                <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 shrink-0">
                  {money(p.amount)} ₽
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PartnerEarnings;
