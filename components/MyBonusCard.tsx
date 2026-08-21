import React, { useEffect, useState } from 'react';
import { api } from '@/services/api';
import { formatCurrency, formatDate } from '../src/utils';

/**
 * Блок «Моя премия» — сотрудник видит, сколько заработал.
 *
 * Числа приходят с сервера намеренно. В браузере у сотрудника данные урезаны
 * по доступным ему счетам: в общем пуле он видит только «своего» инвестора,
 * из-за чего капитал-доля посчиталась бы как 100% вместо реальной, и премия
 * вышла бы неверной. Сервер считает по полным данным менеджера и отдаёт только
 * итоговые суммы — чужих договоров сотрудник при этом не видит.
 *
 * Если процент не назначен, блок не рисуется вовсе.
 */

const BASE_LABEL: Record<string, string> = {
  CONTRACTS: 'с договоров, которые вы оформили',
  PAYMENTS: 'с платежей, которые вы приняли',
  ALL: 'со всей прибыли',
};

type Bonus = {
  enabled: boolean;
  percentage?: number;
  base?: string;
  since?: string | null;
  accrued?: number;
  paid?: number;
  balance?: number;
};

const MyBonusCard: React.FC = () => {
  const [bonus, setBonus] = useState<Bonus | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getMyBonus()
      .then(d => { if (!cancelled) setBonus(d); })
      .catch(() => { /* тихо: премия — не критичный блок, ошибку показывать незачем */ });
    return () => { cancelled = true; };
  }, []);

  if (!bonus?.enabled) return null;

  const toPay = Math.max(0, bonus.balance ?? 0);

  return (
    <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-2xl p-5 shadow-lg text-white">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <p className="text-sm font-bold opacity-90">Моя премия</p>
          <p className="text-xs opacity-75 mt-0.5">
            {bonus.percentage}% {BASE_LABEL[bonus.base || 'CONTRACTS']}
          </p>
        </div>
        <span className="text-3xl font-bold shrink-0 leading-none">{bonus.percentage}%</span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-[11px] opacity-75">Начислено</p>
          <p className="text-base font-bold">{formatCurrency(bonus.accrued ?? 0)} ₽</p>
        </div>
        <div>
          <p className="text-[11px] opacity-75">Выплачено</p>
          <p className="text-base font-bold">{formatCurrency(bonus.paid ?? 0)} ₽</p>
        </div>
        <div>
          <p className="text-[11px] opacity-75">К выплате</p>
          <p className="text-base font-bold">{formatCurrency(toPay)} ₽</p>
        </div>
      </div>

      <p className="text-[11px] opacity-70 mt-3 pt-3 border-t border-white/20 leading-relaxed">
        {bonus.since ? `Начисляется с ${formatDate(bonus.since)}. ` : ''}
        Премия растёт по мере того, как клиенты вносят платежи.
      </p>
    </div>
  );
};

export default MyBonusCard;
