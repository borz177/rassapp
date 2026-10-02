import React, { useMemo, useState } from 'react';
import GlassSheet, { SheetSection, sheetInputClass } from './GlassSheet';
import { Account, Investor } from '../types';
import { getAccountShares, getManagerSharePercent, getActivePeriodAt } from '../src/utils';
import { appConfirm } from '../src/dialogs';

/**
 * Доля за управление в общем пуле.
 *
 * Прибыль пула: каждому инвестору — его процент с части прибыли, заработанной
 * его деньгами. Остаток (например, 20% с денег инвестора на 80%) по умолчанию
 * менеджера. Когда дело ведут сами участники пула, этот остаток можно отдать им —
 * в процентах от остатка. Раньше для этого ставили инвесторам 110%, и они
 * получали больше прибыли, чем вообще заработано.
 */

interface Props {
  account: Account;
  investors: Investor[];
  onClose: () => void;
  onSave: (account: Account) => void;
}

const round = (n: number) => Math.round(n * 10) / 10;

const ManagementShareSheet: React.FC<Props> = ({ account, investors, onClose, onSave }) => {
  const now = Date.now();
  const members = useMemo(() => (account.poolMemberIds || [])
    .map(id => investors.find(i => i.id === id))
    .filter((i): i is Investor => !!i && getActivePeriodAt(i, now) !== null),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [account, investors]);

  const initial = useMemo(() => {
    const map: Record<string, string> = {};
    (account.managerShareSplit || []).forEach(s => { map[s.investorId] = String(s.percent); });
    return map;
  }, [account]);
  const [values, setValues] = useState<Record<string, string>>(initial);

  const split = members
    .map(m => ({ investorId: m.id, percent: Math.max(0, Number(String(values[m.id] || '').replace(',', '.')) || 0) }))
    .filter(s => s.percent > 0);
  const splitTotal = split.reduce((sum, s) => sum + s.percent, 0);
  const preview = { ...account, managerShareSplit: split };
  const shares = getAccountShares(preview, investors);
  const managerLeft = getManagerSharePercent(preview, investors);
  // Без доли за управление — сколько остаётся менеджеру сейчас
  const rest = getManagerSharePercent({ ...account, managerShareSplit: [] }, investors);

  const dirty = members.some(m => (values[m.id] || '') !== (initial[m.id] || ''));
  const valid = splitTotal <= 100;

  const save = (close: () => void) => {
    if (!valid) return;
    onSave({ ...account, managerShareSplit: split });
    close();
  };

  return (
    <GlassSheet
      title="Доля за управление"
      subtitle={account.name}
      onClose={onClose}
      cancelLabel="Отмена"
      action={{ label: 'Готово', submit: true, disabled: !dirty || !valid }}
      onSubmit={save}
      confirmClose={() => !dirty || appConfirm({
        title: 'Закрыть без сохранения?', message: 'Изменения пропадут.',
        confirmLabel: 'Закрыть', cancelLabel: 'Остаться', destructive: true,
      })}
    >
      <div className="space-y-6">
        <SheetSection plain>
          <p className="px-1 text-[14px] leading-relaxed text-slate-600 dark:text-slate-300">
            Каждый инвестор получает свой процент с прибыли, которую заработали его деньги.
            Остаток — сейчас это <b className="text-slate-900 dark:text-white">{round(rest)}%</b> всей прибыли пула —
            плата за управление. По умолчанию она ваша как менеджера. Если дело ведут участники пула,
            отдайте её им.
          </p>
        </SheetSection>

        {members.length === 0 ? (
          <SheetSection>
            <p className="px-4 py-4 text-[15px] text-slate-500 dark:text-slate-400">В пуле сейчас нет участников.</p>
          </SheetSection>
        ) : (
          <SheetSection
            title="Кому и сколько от остатка"
            hint={valid
              ? (splitTotal < 100 && splitTotal > 0 ? `Не распределено ${round(100 - splitTotal)}% остатка — это останется менеджеру.` : 'Например, 50% и 50% — поровну двоим, кто ведёт дело.')
              : 'Вместе больше 100% остатка раздать нельзя.'}
          >
            {members.map(m => (
              <label key={m.id} className="flex items-center gap-3 px-4 py-3 min-h-[52px]">
                <span className="flex-1 min-w-0 text-[16px] text-slate-900 dark:text-white truncate">{m.name}</span>
                <span className="flex items-baseline gap-1 w-24 shrink-0">
                  <input
                    className={`${sheetInputClass} text-right font-semibold`}
                    value={values[m.id] || ''}
                    onChange={e => setValues(v => ({ ...v, [m.id]: e.target.value }))}
                    type="number" inputMode="decimal" min={0} max={100} placeholder="0"
                  />
                  <span className="text-[16px] text-slate-400">%</span>
                </span>
              </label>
            ))}
          </SheetSection>
        )}

        <SheetSection title="Как делится прибыль сейчас" hint="Из каждых 100 ₽ прибыли пула — по текущим вложениям.">
          {shares.map(({ investor, percentage }) => (
            <div key={investor.id} className="flex items-center justify-between px-4 py-3">
              <span className="text-[15px] text-slate-700 dark:text-slate-200 truncate">{investor.name}</span>
              <span className="text-[15px] font-semibold tabular-nums text-slate-900 dark:text-white">{round(percentage)} ₽</span>
            </div>
          ))}
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[15px] text-slate-500 dark:text-slate-400">Менеджер</span>
            <span className="text-[15px] font-semibold tabular-nums text-slate-500 dark:text-slate-400">{round(managerLeft)} ₽</span>
          </div>
        </SheetSection>

        <p className="px-5 text-[13px] leading-snug text-slate-500 dark:text-slate-400">
          Настройка действует на всю историю пула: прибыль по уже полученным платежам тоже пересчитается по новым долям.
        </p>
      </div>
    </GlassSheet>
  );
};

export default ManagementShareSheet;
