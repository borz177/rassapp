import React, { useState } from 'react';
import type { Account } from '../types';
import { formatCurrency } from '../src/utils';
import Sheet from './Sheet';

/**
 * Шапка счёта на главной: какой счёт выбран, сколько на нём денег и что можно
 * с ними сделать.
 *
 * Общая для обеих вкладок главной. На «Рассрочке» она была всегда, на
 * «Наличных» её не было вовсе: продавец видел выручку магазина, но не видел
 * остаток кассы и не мог оттуда же записать приход или расход — за этим
 * приходилось уходить на другой экран.
 *
 * На компьютере — лента счетов: все видны сразу и переключаются одним щелчком.
 * На телефоне — крупный баланс с выбором счёта и тремя кнопками: приём
 * мобильный, он рассчитан на большой палец, а на широком мониторе та же связка
 * растянулась бы пустотой поперёк страницы.
 */
interface AccountHeadProps {
  accounts: Account[];
  accountBalances: Record<string, number>;
  selectedAccountId: string | null;
  onSelectAccount: (id: string | null) => void;
  hideBalance: boolean;
  onToggleHideBalance: () => void;
  /** Кнопки «Приход/Расход/Операции». У сотрудника без права на деньги их нет */
  canMoveMoney?: boolean;
  onAction: (action: string, payload?: any) => void;
  showCents?: boolean;
}

const EYE = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const EYE_OFF = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

// Приход и расход есть и в меню «+», но там они в двух нажатиях и вне контекста
// счёта; здесь открываются сразу с выбранным. «Операции» замыкают связку: без
// них баланс — тупик, увидел странную цифру и некуда нажать.
const ACTIONS = [
  { id: 'INCOME', label: 'Приход', tone: 'text-emerald-600 dark:text-emerald-400',
    icon: <><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></> },
  { id: 'EXPENSE', label: 'Расход', tone: 'text-rose-500 dark:text-rose-400',
    icon: <><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></> },
  { id: 'OPERATIONS', label: 'Операции', tone: 'text-slate-500 dark:text-slate-300',
    icon: <><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></> },
];

const AccountHead: React.FC<AccountHeadProps> = ({
  accounts, accountBalances, selectedAccountId, onSelectAccount,
  hideBalance, onToggleHideBalance, canMoveMoney = true, onAction, showCents = false,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);

  // Архивный счёт из списка убираем, но выбранный оставляем: иначе экран показал
  // бы цифры по счёту, которого в списке нет.
  const liveAccounts = accounts.filter(a => !a.isArchived || a.id === selectedAccountId);
  // Единственный счёт выбирать не из чего: показываем имя, не делая его кнопкой.
  const onlyOne = liveAccounts.length <= 1;
  const current = selectedAccountId
    ? accounts.find(a => a.id === selectedAccountId)
    : (onlyOne ? liveAccounts[0] : null);
  const title = current ? current.name : 'Все счета';
  const total = (id: string | null) => (id
    ? (accountBalances[id] || 0)
    : liveAccounts.reduce((sum, a) => sum + (accountBalances[a.id] || 0), 0));
  const value = total(selectedAccountId);

  // Целую часть и копейки разводим по цвету: крупное число читается с одного
  // взгляда, копейки не отвлекают. С выключенными копейками сумму округляем, а
  // не отрезаем: 1 850,99 должно показаться как 1 851, иначе рубль теряется.
  const shown = showCents ? Math.abs(value) : Math.round(Math.abs(value));
  const [whole, frac] = shown.toFixed(2).split('.');
  const grouped = Number(whole).toLocaleString('ru-RU');

  return (
    <>
      {/* Компьютер: только лента счетов. Остаток и кнопки прихода-расхода нужны
          на телефоне, где других путей к ним нет; за столом они дублировали меню
          и занимали строку над карточками, поэтому здесь их нет. */}
      <div className="hidden md:flex items-center gap-4 flex-wrap">
        <div className="flex flex-wrap items-center gap-2">
          {[{ id: null as string | null, name: 'Все счета' },
            ...liveAccounts.map(a => ({ id: a.id as string | null, name: a.name })),
          ].map(item => {
            const isActive = selectedAccountId === item.id;
            return (
              <button
                key={item.id ?? 'all'}
                onClick={() => onSelectAccount(item.id)}
                className={`px-5 py-2.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${
                  isActive
                    ? 'glass-surface text-indigo-600 dark:text-indigo-300'
                    : 'bg-white/60 dark:bg-slate-800/60 border border-white/70 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-indigo-600'
                }`}
              >
                {item.name}
              </button>
            );
          })}
        </div>

      </div>

      <div className="md:hidden flex flex-col items-center pt-1 pb-2">
        {onlyOne ? (
          <div className="px-3 py-1.5 text-sm font-bold text-slate-700 dark:text-slate-200">
            <span className="truncate max-w-[70vw] inline-block align-bottom">{title}</span>
          </div>
        ) : (
          <button
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold text-slate-700 dark:text-slate-200 active:scale-95 transition-transform"
          >
            <span className="truncate max-w-[60vw]">{title}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}

        <div className="flex items-center gap-2 mt-2">
          {hideBalance ? (
            <span className="text-4xl font-extrabold tracking-tight text-slate-800 dark:text-white leading-none">••••••</span>
          ) : (
            <span className="text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-none">
              {value < 0 ? '−' : ''}{grouped}
              {showCents && <span className="text-slate-400 dark:text-slate-500">,{frac}</span>}
              <span className="text-2xl text-slate-400 dark:text-slate-500 ml-1">₽</span>
            </span>
          )}
          <button
            onClick={onToggleHideBalance}
            aria-label={hideBalance ? 'Показать сумму' : 'Скрыть сумму'}
            className="text-slate-400 dark:text-slate-500 active:scale-90 transition-transform shrink-0"
          >
            {hideBalance ? EYE_OFF : EYE}
          </button>
        </div>

        {canMoveMoney && (
          <div className="flex items-stretch gap-2 mt-4 w-full max-w-xs">
            {ACTIONS.map(a => (
              <button
                key={a.id}
                onClick={() => onAction(a.id, { accountId: current ? current.id : null })}
                className="glass-surface rounded-2xl flex-1 flex flex-col items-center gap-1 py-2.5 active:scale-95 transition-transform"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={a.tone}>
                  {a.icon}
                </svg>
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">{a.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Выбор счёта — нижним листом: на телефоне до него легче дотянуться, и он
          не обрезается краем экрана. */}
      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} className="sm:max-w-sm max-h-[70vh] flex flex-col">
        <div className="px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-700 shrink-0">
          <h3 className="font-bold text-slate-800 dark:text-white">Счёт</h3>
        </div>
        <div className="p-2 overflow-y-auto">
          {[{ id: null as string | null, name: 'Все счета' },
            ...liveAccounts.map(a => ({ id: a.id as string | null, name: a.name })),
          ].map(item => {
            const isActive = selectedAccountId === item.id;
            return (
              <button
                key={item.id ?? 'all'}
                onClick={() => { onSelectAccount(item.id); setPickerOpen(false); }}
                className={`w-full flex items-center justify-between gap-3 px-3.5 py-3 rounded-xl text-left transition-colors ${
                  isActive ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'active:bg-slate-50 dark:active:bg-slate-700'
                }`}
              >
                <span className={`font-semibold truncate ${isActive ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-200'}`}>
                  {item.name}
                </span>
                <span className="shrink-0 text-sm font-bold text-slate-500 dark:text-slate-400">
                  {hideBalance ? '••••' : `${formatCurrency(total(item.id), showCents)} ₽`}
                </span>
              </button>
            );
          })}
        </div>
      </Sheet>
    </>
  );
};

export default AccountHead;
