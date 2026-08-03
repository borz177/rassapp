import React, { useMemo, useState } from 'react';
import { Sale, Account, Expense, Investor, AppSettings, Customer } from '../types';
import { ICONS } from '../constants';
import { formatCurrency, formatDate, getManagerSharePercent, getAccountShares } from '../src/utils';

// Пресеты периода — те же, что в карточке инвестора.
// 'ALL' сохранён отдельно: до этого касса по умолчанию показывала данные за всё время,
// и молча переключить всех на «месяц» значило бы изменить цифры без спроса.
type PeriodMode = 'ALL' | 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM';

// «Всё время» = дата заведомо раньше любых операций. Именно так период инициализируется
// в App, и расчёт realizedPeriodProfit делает new Date(start) без проверки на пустоту —
// поэтому очищать поле нельзя, иначе получится Invalid Date и прибыль обнулится.
const ALL_TIME_START = '2023-01-01';

const todayStr = () => new Date().toISOString().split('T')[0];
const weekAgoStr = () => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0]; };
const monthStartStr = () => { const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]; };

const PERIOD_CONFIG: { key: PeriodMode; label: string }[] = [
  { key: 'ALL', label: 'Всё время' },
  { key: 'TODAY', label: 'Сегодня' },
  { key: 'WEEK', label: 'Неделя' },
  { key: 'MONTH', label: 'Месяц' },
  { key: 'CUSTOM', label: 'Свой' },
];

interface CashRegisterProps {
  accounts: Account[];
  sales: Sale[];
  expenses: Expense[];
  investors: Investor[];
  customers: Customer[];
  onAddAccount: (name: string, type: Account['type'], partners?: string[]) => void;
  onAction: (action: string) => void;
  onSelectAccount: (accountId: string) => void;
  onSetMainAccount: (accountId: string) => void;
  onUpdateAccount?: (account: Account) => void;
  onSelectCustomer?: (customerId: string) => void;
  isManager: boolean;
  totalExpectedProfit: number;
  realizedPeriodProfit: number;
  myProfitPeriod: { start: string; end: string; };
  setMyProfitPeriod: React.Dispatch<React.SetStateAction<{ start: string; end: string; }>>;
  appSettings: AppSettings;
  isInvestor?: boolean;
  currentInvestorId?: string;

}

const CreateAccountModal = ({ onClose, onSubmit }: { onClose: () => void, onSubmit: (name: string, type: Account['type']) => void }) => {
    const [name, setName] = useState('');


    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if(!name.trim()) return;
        onSubmit(name, 'CUSTOM');
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gradient-to-br from-slate-900/80 to-indigo-900/80 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div className="bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm w-full max-w-sm rounded-3xl shadow-2xl p-6 border border-white/20 dark:border-slate-700/50" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white shadow-lg">
                        {ICONS.Plus}
                    </div>
                    <h3 className="text-xl font-bold bg-gradient-to-r from-slate-800 to-indigo-800 dark:from-white dark:to-indigo-400 bg-clip-text text-transparent">Новый счет</h3>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">Название счета</label>
                        <input
                            autoFocus
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="w-full p-3.5 bg-slate-50 dark:bg-slate-900 dark:text-white border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition-all"
                            placeholder="Например: Касса 1"
                        />
                    </div>

                    <div className="flex gap-3 mt-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-3.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-200 dark:hover:bg-slate-600 transition-all"
                        >
                            Отмена
                        </button>
                        <button
                            type="submit"
                            className="flex-1 py-3.5 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-xl font-bold hover:from-indigo-700 hover:to-indigo-800 transition-all"
                        >
                            Создать
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

const EditAccountModal = ({ account, onClose, onUpdate }: { account: Account, onClose: () => void, onUpdate: (acc: Account) => void }) => {
    const [name, setName] = useState(account.name);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if(!name.trim()) return;
        onUpdate({ ...account, name });
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gradient-to-br from-slate-900/80 to-indigo-900/80 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div className="bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm w-full max-w-sm rounded-3xl shadow-2xl p-6 border border-white/20 dark:border-slate-700/50" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center text-white shadow-lg">
                        {ICONS.Edit}
                    </div>
                    <h3 className="text-xl font-bold bg-gradient-to-r from-slate-800 to-amber-800 dark:from-white dark:to-amber-400 bg-clip-text text-transparent">Редактировать счет</h3>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">Название счета</label>
                        <input
                            autoFocus
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="w-full p-3.5 bg-slate-50 dark:bg-slate-900 dark:text-white border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100 transition-all"
                        />
                    </div>

                    <div className="flex gap-3 mt-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-3.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-200 dark:hover:bg-slate-600 transition-all"
                        >
                            Отмена
                        </button>
                        <button
                            type="submit"
                            className="flex-1 py-3.5 bg-gradient-to-r from-amber-600 to-amber-700 text-white rounded-xl font-bold hover:from-amber-700 hover:to-amber-800 transition-all shadow-lg shadow-amber-200"
                        >
                            Сохранить
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

const SharedAccountDetails = ({ account, sales, expenses, investors, onClose, appSettings }: { account: Account, sales: Sale[], expenses: Expense[], investors: Investor[], onClose: () => void, appSettings: AppSettings }) => {
    const accountSales = sales.filter(s => s.accountId === account.id);
    const accountExpenses = expenses.filter(e => e.accountId === account.id);

    let cashBalance = 0;
    accountSales.forEach(s => {
        cashBalance += Number(s.downPayment);
        s.paymentPlan.filter(p => p.isPaid).forEach(p => cashBalance += Number(p.amount));
    });
    cashBalance -= accountExpenses.reduce((sum, e) => sum + Number(e.amount), 0);

    const receivables = accountSales
        .filter(s => s.status === 'ACTIVE')
        .reduce((sum, s) => sum + Number(s.remainingAmount), 0);

    const totalAccountEquity = cashBalance + receivables;

    const partnerStats = (account.partners || []).map(partnerId => {
        const investor = investors.find(i => i.id === partnerId);

        const deposits = accountSales
            .filter(s => s.type === 'CASH' && s.customerId === partnerId)
            .reduce((sum, s) => sum + Number(s.totalAmount), 0);

        const withdrawals = accountExpenses
            .filter(e => e.investorId === partnerId && e.payoutType === 'INVESTMENT')
            .reduce((sum, e) => sum + Number(e.amount), 0);

        const profitWithdrawals = accountExpenses
            .filter(e => e.investorId === partnerId && e.payoutType === 'PROFIT')
            .reduce((sum, e) => sum + Number(e.amount), 0);

        const netCapital = Math.max(0, deposits - withdrawals);

        return {
            id: partnerId,
            name: investor?.name || 'Unknown',
            netCapital,
            profitWithdrawals
        };
    });

    const totalNetCapital = partnerStats.reduce((sum, p) => sum + p.netCapital, 0);
    const totalProfitGenerated = Math.max(0, totalAccountEquity - totalNetCapital);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gradient-to-br from-slate-900/80 to-indigo-900/80 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div className="bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] border border-white/20 dark:border-slate-700/50" onClick={e => e.stopPropagation()}>
                <div className="p-6 bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                            {ICONS.Users}
                        </div>
                        <div>
                            <h3 className="text-xl font-bold">{account.name}</h3>
                            <p className="text-indigo-100 text-sm">Совместный счет</p>
                        </div>
                    </div>
                </div>

                <div className="p-6 space-y-6 overflow-y-auto">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/30 dark:to-emerald-900/20 p-4 rounded-2xl">
                            <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium mb-1">Кэш в кассе</p>
                            <p className="text-xl font-bold text-emerald-800 dark:text-emerald-300">{formatCurrency(cashBalance, appSettings.showCents)} ₽</p>
                        </div>
                        <div className="bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-900/30 dark:to-amber-900/20 p-4 rounded-2xl">
                            <p className="text-xs text-amber-700 dark:text-amber-400 font-medium mb-1">В товаре (Долги)</p>
                            <p className="text-xl font-bold text-amber-800 dark:text-amber-300">{formatCurrency(receivables, appSettings.showCents)} ₽</p>
                        </div>
                    </div>

                    <div className="bg-gradient-to-br from-slate-800 to-slate-900 text-white p-5 rounded-2xl">
                        <p className="text-slate-400 text-sm mb-2">Общая стоимость активов</p>
                        <p className="text-3xl font-bold mb-3">{formatCurrency(totalAccountEquity, appSettings.showCents)} ₽</p>
                        <div className="flex justify-between text-xs border-t border-slate-700 pt-3">
                            <span className="text-slate-400">Вложено: <span className="text-white font-medium">{formatCurrency(totalNetCapital, appSettings.showCents)} ₽</span></span>
                            <span className="text-emerald-400">Прибыль: +{formatCurrency(totalProfitGenerated, appSettings.showCents)} ₽</span>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <h4 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                            <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></span>
                            Распределение долей
                        </h4>
                        <div className="space-y-3">
                            {partnerStats.length === 0 ? (
                                <p className="text-center text-slate-400 text-sm py-4">Нет активных партнеров</p>
                            ) : partnerStats.map(p => {
                                const sharePercent = totalNetCapital > 0 ? (p.netCapital / totalNetCapital) * 100 : 0;
                                const equityValue = totalAccountEquity * (sharePercent / 100);
                                const profitShare = Math.max(0, equityValue - p.netCapital);

                                return (
                                    <div key={p.id} className="bg-white dark:bg-slate-700 border border-slate-100 dark:border-slate-600 p-4 rounded-2xl shadow-sm hover:shadow-md transition-all">
                                        <div className="flex justify-between items-center mb-3">
                                            <span className="font-bold text-slate-800 dark:text-white">{p.name}</span>
                                            <span className="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 text-xs px-3 py-1 rounded-full font-bold">
                                                {sharePercent.toFixed(1)}%
                                            </span>
                                        </div>
                                        <div className="w-full bg-slate-100 dark:bg-slate-600 h-2 rounded-full mb-4 overflow-hidden">
                                            <div className="bg-gradient-to-r from-indigo-500 to-purple-500 h-full rounded-full transition-all" style={{width: `${sharePercent}%`}}></div>
                                        </div>
                                        <div className="grid grid-cols-2 text-sm gap-3">
                                            <div>
                                                <span className="text-slate-400 dark:text-slate-400 text-xs block">Вложено</span>
                                                <span className="font-medium text-slate-800 dark:text-white">{formatCurrency(p.netCapital, appSettings.showCents)} ₽</span>
                                            </div>
                                            <div className="text-right">
                                                <span className="text-slate-400 dark:text-slate-400 text-xs block">Доля в активах</span>
                                                <span className="font-bold text-slate-800 dark:text-white">{formatCurrency(Math.round(equityValue), appSettings.showCents)} ₽</span>
                                            </div>
                                        </div>
                                        {profitShare > 0 && (
                                            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-600 flex justify-between text-sm">
                                                <span className="text-emerald-600 font-medium">Доступная прибыль</span>
                                                <span className="font-bold text-emerald-600">+{formatCurrency(Math.round(profitShare), appSettings.showCents)} ₽</span>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
                    <button
                        onClick={onClose}
                        className="w-full py-3.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-all"
                    >
                        Закрыть
                    </button>
                </div>
            </div>
        </div>
    );
};

const AccountActionModal = ({
    account,
    balance,
    onClose,
    onSelectAccount,
    onEdit,
    onSetMain,
    isManager,
    onUpdateAccount,
    onToggleHidden,
    appSettings,
    isBalanceMasked
}: {
    account: Account;
    balance: number;
    onClose: () => void;
    onSelectAccount: (id: string) => void;
    onEdit: (acc: Account) => void;
    onSetMain: (id: string) => void;
    isManager: boolean;
    onUpdateAccount?: (acc: Account) => void;
    onToggleHidden: (acc: Account) => void;
    appSettings: AppSettings;
    isBalanceMasked: boolean;
}) => {
    const getAccountTypeColor = (type: Account['type']) => {
        switch(type) {
            case 'MAIN': return 'from-indigo-500 to-indigo-600';
            case 'INVESTOR': return 'from-purple-500 to-purple-600';
            case 'CUSTOM': return 'from-emerald-500 to-emerald-600';
            case 'SHARED': return 'from-amber-500 to-amber-600';
            case 'POOL': return 'from-fuchsia-500 to-fuchsia-600';
            default: return 'from-slate-500 to-slate-600';
        }
    };

    const getAccountTypeIcon = (type: Account['type']) => {
        switch(type) {
            case 'MAIN': return '⭐';
            case 'INVESTOR': return '📈';
            case 'CUSTOM': return '💼';
            case 'SHARED': return ICONS.Users;
            case 'POOL': return ICONS.Users;
            default: return '💳';
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 w-full max-w-xs rounded-2xl shadow-2xl overflow-hidden animate-slide-up" onClick={e => e.stopPropagation()}>
                <div className={`h-2 bg-gradient-to-r ${getAccountTypeColor(account.type)}`}></div>

                <div className="p-5">
                    <div className="flex items-center gap-3 mb-4 pb-4 border-b border-slate-100 dark:border-slate-700">
                        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${getAccountTypeColor(account.type)} flex items-center justify-center text-white text-xl shadow-lg`}>
                            {getAccountTypeIcon(account.type)}
                        </div>
                        <div className="flex-1">
                            <h3 className="font-bold text-lg text-slate-800 dark:text-white">{account.name}</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                {account.type === 'MAIN' ? 'Основной счет' :
                                 account.type === 'INVESTOR' ? 'Счет инвестора' :
                                 account.type === 'SHARED' ? 'Общий счет' :
                                 account.type === 'POOL' ? 'Инвестиционный пул' : 'Дополнительный счет'}
                            </p>
                            <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400 mt-1">
                                {isBalanceMasked ? '•••••• ₽' : `${formatCurrency(balance, appSettings.showCents)} ₽`}
                            </p>
                        </div>
                    </div>

                    <div className="space-y-1">
                        <button
                            onClick={() => { onSelectAccount(account.id); onClose(); }}
                            className="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-xl flex items-center gap-3 transition-all group"
                        >
                            <span className="w-8 h-8 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center text-indigo-600 dark:text-indigo-400 group-hover:bg-indigo-100 dark:group-hover:bg-indigo-900/50 transition-all">
                                {ICONS.List}
                            </span>
                            <div>
                                <span className="font-medium">История операций</span>
                                <p className="text-xs text-slate-400 dark:text-slate-500">Просмотр всех движений по счету</p>
                            </div>
                        </button>

                        {isManager && onUpdateAccount && (
                            <button
                                onClick={() => { onEdit(account); onClose(); }}
                                className="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded-xl flex items-center gap-3 transition-all group"
                            >
                                <span className="w-8 h-8 bg-amber-50 dark:bg-amber-900/30 rounded-lg flex items-center justify-center text-amber-600 dark:text-amber-400 group-hover:bg-amber-100 dark:group-hover:bg-amber-900/50 transition-all">
                                    {ICONS.Edit}
                                </span>
                                <div>
                                    <span className="font-medium">Редактировать</span>
                                    <p className="text-xs text-slate-400 dark:text-slate-500">Изменить название счета</p>
                                </div>
                            </button>
                        )}

                        {isManager && account.type !== 'MAIN' && !account.isMain && (
                            <button
                                onClick={() => { onSetMain(account.id); onClose(); }}
                                className="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded-xl flex items-center gap-3 transition-all group"
                            >
                                <span className="w-8 h-8 bg-emerald-50 dark:bg-emerald-900/30 rounded-lg flex items-center justify-center text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-100 dark:group-hover:bg-emerald-900/50 transition-all">
                                    {ICONS.Check}
                                </span>
                                <div>
                                    <span className="font-medium">Сделать основным</span>
                                    <p className="text-xs text-slate-400 dark:text-slate-500">Установить как основной счет</p>
                                </div>
                            </button>
                        )}

                        {/* Основной счёт прятать нельзя — иначе касса останется без счёта по умолчанию */}
                        {isManager && onUpdateAccount && account.type !== 'MAIN' && !account.isMain && (
                            <button
                                onClick={() => { onToggleHidden(account); onClose(); }}
                                className="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60 rounded-xl flex items-center gap-3 transition-all group"
                            >
                                <span className="w-8 h-8 bg-slate-100 dark:bg-slate-700 rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 group-hover:bg-slate-200 dark:group-hover:bg-slate-600 transition-all">
                                    {account.isArchived ? ICONS.Unarchive : ICONS.Archive}
                                </span>
                                <div>
                                    <span className="font-medium">{account.isArchived ? 'Вернуть счет' : 'Скрыть счет'}</span>
                                    <p className="text-xs text-slate-400 dark:text-slate-500">
                                        {account.isArchived
                                            ? 'Показать карточку в общем списке'
                                            : 'Убрать карточку из списка, данные сохранятся'}
                                    </p>
                                </div>
                            </button>
                        )}
                    </div>

                    <button
                        onClick={onClose}
                        className="w-full mt-4 py-3 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-medium rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-all flex items-center justify-center gap-2"
                    >
                        <span>✕</span>
                        <span>Закрыть</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

const CashRegister: React.FC<CashRegisterProps> = ({
    accounts, sales, expenses, investors, customers, onAddAccount, onAction, onSelectAccount, onSetMainAccount, onUpdateAccount,
    onSelectCustomer, isManager, myProfitPeriod, setMyProfitPeriod, appSettings
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [selectedSharedAccount, setSelectedSharedAccount] = useState<Account | null>(null);
  const [activeMenuAccount, setActiveMenuAccount] = useState<Account | null>(null);

  // Маскировка суммы — у каждого счёта своя. Это локальная приватность «от посторонних
  // глаз», поэтому список живёт в localStorage устройства, а не в данных счёта: скрыв
  // сумму на телефоне, пользователь не ждёт, что она пропадёт и на компьютере.
  const [maskedAccountIds, setMaskedAccountIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('finuchet_masked_accounts');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const toggleAccountMask = (accountId: string) => {
    setMaskedAccountIds(prev => {
      const next = prev.includes(accountId)
        ? prev.filter(id => id !== accountId)
        : [...prev, accountId];
      localStorage.setItem('finuchet_masked_accounts', JSON.stringify(next));
      return next;
    });
  };

  const isMasked = (accountId: string) => maskedAccountIds.includes(accountId);

  const [showHiddenAccounts, setShowHiddenAccounts] = useState(false);

  // Период хранится в App (myProfitPeriod) — здесь только режим выбора.
  // При возврате на страницу восстанавливаем его по уже выставленным датам.
  const [periodMode, setPeriodMode] = useState<PeriodMode>(() => {
    const { start, end } = myProfitPeriod;
    if (!start || start <= ALL_TIME_START) return 'ALL';
    if (end === todayStr()) {
      if (start === todayStr()) return 'TODAY';
      if (start === weekAgoStr()) return 'WEEK';
      if (start === monthStartStr()) return 'MONTH';
    }
    return 'CUSTOM';
  });

  const applyPeriodMode = (mode: PeriodMode) => {
    setPeriodMode(mode);
    if (mode === 'ALL') setMyProfitPeriod({ start: ALL_TIME_START, end: todayStr() });
    else if (mode === 'TODAY') setMyProfitPeriod({ start: todayStr(), end: todayStr() });
    else if (mode === 'WEEK') setMyProfitPeriod({ start: weekAgoStr(), end: todayStr() });
    else if (mode === 'MONTH') setMyProfitPeriod({ start: monthStartStr(), end: todayStr() });
    else if (!myProfitPeriod.start || myProfitPeriod.start <= ALL_TIME_START) {
      // «Свой» поверх «всего времени» — подставляем осмысленную заготовку
      setMyProfitPeriod({ start: monthStartStr(), end: todayStr() });
    }
  };

  const visibleAccounts = useMemo(() => accounts.filter(a => !a.isArchived), [accounts]);
  const hiddenAccounts = useMemo(() => accounts.filter(a => a.isArchived), [accounts]);

  const handleToggleHidden = (acc: Account) => {
    if (!onUpdateAccount) return;
    onUpdateAccount({ ...acc, isArchived: !acc.isArchived });
  };

  // Скрытую сумму заменяем строкой похожей ширины, чтобы карточка не «прыгала»
  const renderAmount = (accountId: string, value: number) =>
    isMasked(accountId) ? '•••••• ₽' : `${formatCurrency(value, appSettings.showCents)} ₽`;

 // 🔹 Добавьте новые состояния в начало компонента (после других useState)
const [showProfitDetails, setShowProfitDetails] = useState(false);
const [showInvestorProfitDetails, setShowInvestorProfitDetails] = useState(false);
const [profitDetailsTab, setProfitDetailsTab] = useState<'accruals' | 'payouts'>('accruals');
const [profitFilterAccountId, setProfitFilterAccountId] = useState<string>('ALL');
const [profitFilterInvestorId, setProfitFilterInvestorId] = useState<string>('ALL');

// ... (остальной код без изменений до блока "Моя прибыль") ...
 const accountBalances = useMemo(() => {
    const balances: Record<string, number> = {};

    accounts.forEach(acc => {
      let total = 0;

      // ➕ Приход из договоров
      const accountSales = sales.filter(s => s.accountId === acc.id);
      accountSales.forEach(s => {
          total += Number(s.downPayment);
          s.paymentPlan
            .filter(p => p.isPaid && p.isRealPayment !== false)
            .forEach(p => total += Number(p.amount));
      });

      // ➖ Расходы, ИСКЛЮЧАЯ возвраты
      const accountExpenses = expenses.filter(e => e.accountId === acc.id);
      const regularExpenses = accountExpenses.filter(e => e.isRefund !== true);

      total -= regularExpenses.reduce((sum, e) => sum + Number(e.amount), 0);

      balances[acc.id] = total;
    });

    return balances;
}, [accounts, sales, expenses]);

  // 🔹 Прибыль менеджера (ожидаемая)
  const calculatedExpectedProfit = useMemo(() => {
    let totalProfit = 0;

    const salesWithProfit = sales.filter(s =>
        (s.status === 'ACTIVE' || s.status === 'COMPLETED' || s.status === 'DRAFT')
        && s.buyPrice > 0
    );

    salesWithProfit.forEach(sale => {
        if (profitFilterAccountId !== 'ALL' && sale.accountId !== profitFilterAccountId) return;

        // 🔧 ИЗМЕНЕНИЕ: считаем только ожидаемую прибыль от остатка
        if (sale.status === 'ACTIVE' || sale.status === 'DRAFT') {
            const totalSaleProfit = sale.totalAmount - sale.buyPrice;
            const profitMargin = sale.totalAmount > 0 ? totalSaleProfit / sale.totalAmount : 0;

            const account = accounts.find(a => a.id === sale.accountId);
            const managerProfitShare = getManagerSharePercent(account, investors) / 100;

            // 🔧 Только от остатка долга, как у инвестора!
            totalProfit += sale.remainingAmount * profitMargin * managerProfitShare;
        }
    });

    return totalProfit;
}, [sales, accounts, investors, profitFilterAccountId]);

  // 🔹 Прибыль менеджера (полученная и выплаты)
  const { managerProfitAccruals, managerProfitPayouts, totalManagerProfitEarned, totalManagerProfitWithdrawn } = useMemo(() => {
    const accruals: {id: string, date: string, amount: number, customerId: string, customerName: string, productName: string}[] = [];
    sales.forEach(sale => {
        if (profitFilterAccountId !== 'ALL' && sale.accountId !== profitFilterAccountId) return;
        if (sale.buyPrice <= 0 || sale.totalAmount <= sale.buyPrice) return;
        const totalSaleProfit = Number(sale.totalAmount) - Number(sale.buyPrice);
        const profitMargin = totalSaleProfit / Number(sale.totalAmount);
        const account = accounts.find(a => a.id === sale.accountId);
        // SHARED-счета считаются отдельно (по внесённому капиталу), а не по фиксированному %.
        if (account?.type === 'SHARED') return;
        const customerName = customers.find(c => c.id === sale.customerId)?.name || 'Неизвестно';
        const allPayments = [
            { date: sale.startDate, amount: Number(sale.downPayment), id: `${sale.id}_dp`, isRealPayment: true },
            ...sale.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false)
        ];
        allPayments.forEach(p => {
            if (p.amount > 0) {
                const pDate = new Date(p.date);
                const startDate = myProfitPeriod.start ? new Date(myProfitPeriod.start) : new Date(0);
                const endDate = myProfitPeriod.end ? new Date(myProfitPeriod.end) : new Date(2100, 0, 1);
                endDate.setHours(23, 59, 59, 999);
                if (pDate >= startDate && pDate <= endDate) {
                    // 🔒 Доля — на дату этого платежа, чтобы новый участник пула не получил
                    // задним числом долю от прибыли, полученной до его вступления.
                    const managerProfitSharePercent = getManagerSharePercent(account, investors, p.date) / 100;
                    const profitFromPayment = p.amount * profitMargin;
                    const managerShare = profitFromPayment * managerProfitSharePercent;
                    if(managerShare > 0) {
                        accruals.push({
                            id: p.id,
                            date: p.date,
                            amount: managerShare,
                            customerId: sale.customerId,
                            customerName,
                            productName: sale.productName
                        });
                    }
                }
            }
        });
    });
    const payouts = expenses
        .filter(e => e.category === 'Моя выплата' && (profitFilterAccountId === 'ALL' || e.accountId === profitFilterAccountId))
        .filter(e => {
            const eDate = new Date(e.date);
            const startDate = myProfitPeriod.start ? new Date(myProfitPeriod.start) : new Date(0);
            const endDate = myProfitPeriod.end ? new Date(myProfitPeriod.end) : new Date(2100, 0, 1);
            endDate.setHours(23, 59, 59, 999);
            return eDate >= startDate && eDate <= endDate;
        })
        .sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const totalEarned = accruals.reduce((sum, item) => sum + item.amount, 0);
    const totalWithdrawn = payouts.reduce((sum, item) => sum + Number(item.amount), 0);
    return {
        managerProfitAccruals: accruals.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        managerProfitPayouts: payouts,
        totalManagerProfitEarned: totalEarned,
        totalManagerProfitWithdrawn: totalWithdrawn
    };
  }, [sales, expenses, accounts, investors, customers, profitFilterAccountId, myProfitPeriod]);

  const managerProfitBalance = totalManagerProfitEarned - totalManagerProfitWithdrawn;




// 🔹 Начисления инвестора(ов) — работает и для одиночного счёта инвестора, и для общего пула
// (тогда прибыль с одного платежа распределяется на несколько начислений, по одному на каждого
// участника пула, с его долей — см. getAccountShares).
const investorProfitAccruals = useMemo(() => {
    const accruals: {id: string, date: string, amount: number, customerId: string, customerName: string, productName: string, investorId: string, investorName: string}[] = [];

    sales.forEach(sale => {
        if (profitFilterAccountId !== 'ALL' && sale.accountId !== profitFilterAccountId) return;
        if (sale.buyPrice <= 0 || sale.totalAmount <= sale.buyPrice) return;

        const account = accounts.find(a => a.id === sale.accountId);
        if (!account) return;
        if (account.type === 'SHARED') return;

        const customerName = customers.find(c => c.id === sale.customerId)?.name || 'Неизвестно';
        const totalSaleProfit = Number(sale.totalAmount) - Number(sale.buyPrice);
        const profitMargin = totalSaleProfit / Number(sale.totalAmount);

        const allPayments = [
            { date: sale.startDate, amount: Number(sale.downPayment), id: `${sale.id}_dp` },
            ...sale.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false)
        ];

        allPayments.forEach(p => {
            if (p.amount > 0) {
                const pDate = new Date(p.date);
                const startDate = myProfitPeriod.start ? new Date(myProfitPeriod.start) : new Date(0);
                const endDate = myProfitPeriod.end ? new Date(myProfitPeriod.end) : new Date(2100, 0, 1);
                endDate.setHours(23, 59, 59, 999);

                if (pDate >= startDate && pDate <= endDate) {
                    const profitFromPayment = p.amount * profitMargin;
                    const shares = getAccountShares(account, investors, p.date);
                    shares.forEach(({ investor, percentage }) => {
                        const investorAmount = profitFromPayment * (percentage / 100);
                        if (investorAmount > 0) {
                            accruals.push({
                                id: `${p.id}_${investor.id}`,
                                date: p.date,
                                amount: investorAmount,
                                customerId: sale.customerId,
                                customerName,
                                productName: sale.productName,
                                investorId: investor.id,
                                investorName: investor.name
                            });
                        }
                    });
                }
            }
        });
    });

    const filtered = profitFilterInvestorId === 'ALL' ? accruals : accruals.filter(a => a.investorId === profitFilterInvestorId);
    return filtered.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}, [sales, accounts, investors, customers, profitFilterAccountId, profitFilterInvestorId, myProfitPeriod]);

// 🔹 Выплаты инвестора
const investorProfitPayouts = useMemo(() => {
    return expenses
        .filter(e => e.investorId && e.payoutType === 'PROFIT' && (profitFilterAccountId === 'ALL' || e.accountId === profitFilterAccountId))
        .filter(e => profitFilterInvestorId === 'ALL' || e.investorId === profitFilterInvestorId)
        .filter(e => {
            const eDate = new Date(e.date);
            const startDate = myProfitPeriod.start ? new Date(myProfitPeriod.start) : new Date(0);
            const endDate = myProfitPeriod.end ? new Date(myProfitPeriod.end) : new Date(2100, 0, 1);
            endDate.setHours(23, 59, 59, 999);
            return eDate >= startDate && eDate <= endDate;
        })
        .sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}, [expenses, profitFilterAccountId, profitFilterInvestorId, myProfitPeriod]);



  // 🔹🔹🔹 БЛОК: Прибыль инвестора(ов), в разбивке по каждому инвестору 🔹🔹🔹
  // Работает единообразно и для обычного счёта (один владелец), и для общего пула
  // (несколько инвесторов через getAccountShares) — раньше здесь проверялся только
  // account.ownerId, поэтому при выборе счёта-пула блок был пуст.
  const investorProfitBreakdown = useMemo(() => {
    const startDate = myProfitPeriod.start ? new Date(myProfitPeriod.start) : new Date(0);
    const endDate = myProfitPeriod.end ? new Date(myProfitPeriod.end) : new Date(2100, 0, 1);
    endDate.setHours(23, 59, 59, 999);

    const map = new Map<string, { investor: Investor; expectedProfit: number; receivedProfit: number; totalWithdrawn: number }>();
    const ensure = (investor: Investor) => {
        let entry = map.get(investor.id);
        if (!entry) {
            entry = { investor, expectedProfit: 0, receivedProfit: 0, totalWithdrawn: 0 };
            map.set(investor.id, entry);
        }
        return entry;
    };

    sales.forEach(sale => {
        if (profitFilterAccountId !== 'ALL' && sale.accountId !== profitFilterAccountId) return;
        if (sale.buyPrice <= 0 || sale.totalAmount <= sale.buyPrice) return;

        const account = accounts.find(a => a.id === sale.accountId);
        if (!account || account.type === 'SHARED') return;

        const totalSaleProfit = sale.totalAmount - sale.buyPrice;
        const profitMargin = sale.totalAmount > 0 ? totalSaleProfit / sale.totalAmount : 0;

        // Ожидаемая прибыль: от остатка (ACTIVE/DRAFT), доли на сегодня
        if (sale.status === 'ACTIVE' || sale.status === 'DRAFT') {
            getAccountShares(account, investors).forEach(({ investor, percentage }) => {
                ensure(investor).expectedProfit += sale.remainingAmount * profitMargin * (percentage / 100);
            });
        }

        // 🔧 Полученная прибыль: платежи в выбранном периоде, доли — на дату каждого платежа
        const allPayments = [
            { date: sale.startDate, amount: Number(sale.downPayment) },
            ...sale.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false)
        ];
        allPayments.forEach(p => {
            if (p.amount <= 0) return;
            const pDate = new Date(p.date);
            if (pDate < startDate || pDate > endDate) return;
            const profitFromPayment = p.amount * profitMargin;
            getAccountShares(account, investors, p.date).forEach(({ investor, percentage }) => {
                ensure(investor).receivedProfit += profitFromPayment * (percentage / 100);
            });
        });
    });

    // Выплаты инвесторам (уже фильтруются по периоду — ок)
    expenses
        .filter(e => e.investorId && e.payoutType === 'PROFIT' &&
                    (profitFilterAccountId === 'ALL' || e.accountId === profitFilterAccountId))
        .filter(e => {
            const eDate = new Date(e.date);
            return eDate >= startDate && eDate <= endDate;
        })
        .forEach(e => {
            const investor = investors.find(i => i.id === e.investorId);
            if (!investor) return;
            ensure(investor).totalWithdrawn += Number(e.amount);
        });

    return Array.from(map.values())
        .map(m => ({
            investor: m.investor,
            expectedProfit: Math.round(m.expectedProfit * 100) / 100,
            receivedProfit: Math.round(m.receivedProfit * 100) / 100,
            totalWithdrawn: Math.round(m.totalWithdrawn * 100) / 100,
            balance: Math.round((m.receivedProfit - m.totalWithdrawn) * 100) / 100
        }))
        .sort((a, b) => b.receivedProfit - a.receivedProfit);
}, [sales, accounts, investors, expenses, profitFilterAccountId, myProfitPeriod]);

  // Если выбран конкретный инвестор — показываем только его цифры, иначе сумму по всем.
  const investorProfitStats = useMemo(() => {
    const relevant = profitFilterInvestorId === 'ALL'
        ? investorProfitBreakdown
        : investorProfitBreakdown.filter(m => m.investor.id === profitFilterInvestorId);
    if (relevant.length === 0) return null;
    const sum = (key: 'expectedProfit' | 'receivedProfit' | 'totalWithdrawn' | 'balance') =>
        Math.round(relevant.reduce((s, m) => s + m[key], 0) * 100) / 100;
    return {
        expectedProfit: sum('expectedProfit'),
        receivedProfit: sum('receivedProfit'),
        totalWithdrawn: sum('totalWithdrawn'),
        balance: sum('balance')
    };
}, [investorProfitBreakdown, profitFilterInvestorId]);

  const handleCreateAccount = (name: string, type: Account['type'], partners?: string[]) => {
      onAddAccount(name, type, partners);
      setIsAdding(false);
  }

  const getAccountTypeLabel = (type: Account['type']) => {
      switch(type) {
          case 'MAIN': return 'Основной счет';
          case 'INVESTOR': return 'Счет инвестора';
          case 'CUSTOM': return 'Дополнительный';
          case 'SHARED': return 'Общий счет';
          case 'POOL': return 'Инвестпул';
          default: return 'Счет';
      }
  }

  const getAccountTypeColor = (type: Account['type']) => {
      switch(type) {
          case 'MAIN': return 'from-indigo-500 to-indigo-600';
          case 'INVESTOR': return 'from-purple-500 to-purple-600';
          case 'CUSTOM': return 'from-emerald-500 to-emerald-600';
          case 'SHARED': return 'from-amber-500 to-amber-600';
          case 'POOL': return 'from-fuchsia-500 to-fuchsia-600';
          default: return 'from-slate-500 to-slate-600';
      }
  }

  const handleSharedAccountClick = (acc: Account) => {
      if (acc.type === 'SHARED') {
          setSelectedSharedAccount(acc);
      }
  }

  const handleMenuClick = (e: React.MouseEvent, acc: Account) => {
      e.stopPropagation();
      setActiveMenuAccount(acc);
  }

  return (
    <div className="space-y-8 animate-fade-in pb-20 w-full max-w-7xl mx-auto px-4">
      {/* Header */}
      <div className="flex justify-between items-center pt-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white shadow-lg">
            {ICONS.Wallet}
          </div>
          <h2 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-indigo-800 dark:from-white dark:to-indigo-400 bg-clip-text text-transparent">
            Мои Счета
          </h2>
        </div>

        {isManager && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold hover:from-indigo-700 hover:to-indigo-800 transition-all text-sm sm:text-base"
          >
            <span className="text-lg">{ICONS.Plus}</span>
            <span className="hidden sm:inline">+Новый счет</span>
          </button>
        )}
      </div>

      {/* Modals */}
      {isAdding && <CreateAccountModal onClose={() => setIsAdding(false)} onSubmit={handleCreateAccount} />}
      {editingAccount && onUpdateAccount && (
        <EditAccountModal account={editingAccount} onClose={() => setEditingAccount(null)} onUpdate={onUpdateAccount} />
      )}

      {/* Account Cards */}
      {accounts.length === 0 ? (
        <div className="bg-gradient-to-br from-slate-50 to-indigo-50 dark:from-slate-800 dark:to-indigo-950/30 rounded-3xl p-8 sm:p-12 text-center border-2 border-dashed border-indigo-200 dark:border-indigo-900/50">
          <div className="w-16 h-16 sm:w-20 sm:h-20 bg-white dark:bg-slate-800 rounded-2xl sm:rounded-3xl flex items-center justify-center mx-auto mb-4 ">
            <span className="text-2xl sm:text-3xl text-indigo-400">{ICONS.Wallet}</span>
          </div>
          <h3 className="text-lg sm:text-xl font-bold text-slate-800 dark:text-white mb-2">Нет созданных счетов</h3>
          <p className="text-sm sm:text-base text-slate-500 dark:text-slate-400 mb-6">Создайте первый счет для начала работы</p>
          {isManager && (
            <button onClick={() => setIsAdding(true)} className="inline-flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white px-5 py-2.5 sm:px-6 sm:py-3 rounded-xl font-bold hover:from-indigo-700 hover:to-indigo-800 transition-all text-sm sm:text-base">
              <span>{ICONS.Plus}</span><span>Создать счет</span>
            </button>
          )}
        </div>
      ) : visibleAccounts.length === 0 ? (
        // Счета есть, но все спрятаны — иначе на месте сетки была бы пустота без объяснений
        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-3xl p-8 text-center border-2 border-dashed border-slate-200 dark:border-slate-700">
          <div className="flex justify-center mb-3 text-slate-400 dark:text-slate-500">{ICONS.Archive}</div>
          <h3 className="text-base sm:text-lg font-bold text-slate-700 dark:text-slate-200 mb-1">Все счета скрыты</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">Верните нужный счет в списке ниже</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {visibleAccounts.map(acc => (
            <div key={acc.id} className="relative bg-white dark:bg-slate-800 rounded-2xl sm:rounded-3xl shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden" onClick={() => handleSharedAccountClick(acc)}>
              <div className={`absolute inset-0 bg-gradient-to-br ${getAccountTypeColor(acc.type)} opacity-0 hover:opacity-5 transition-opacity`}></div>
              <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${getAccountTypeColor(acc.type)}`}></div>
              <div className="relative p-4 sm:p-6">
                <div className="flex items-start justify-between mb-3 sm:mb-4">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full text-[10px] sm:text-xs font-bold bg-gradient-to-r ${getAccountTypeColor(acc.type)} text-white shadow-sm`}>
                      {acc.type === 'SHARED' && <span className="text-[10px] sm:text-xs">{ICONS.Users}</span>}
                      <span className="truncate max-w-[80px] sm:max-w-none">{getAccountTypeLabel(acc.type)}</span>
                    </div>
                    {acc.isMain && acc.type !== 'MAIN' && (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-[10px] sm:text-xs font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">⭐ Основной</span>
                    )}
                  </div>
                  <button onClick={(e) => handleMenuClick(e, acc)} className="p-1.5 sm:p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg sm:rounded-xl transition-all z-10" aria-label="Действия со счетом">{ICONS.More}</button>
                </div>
                <div className="space-y-3 sm:space-y-4">
                  <div>
                    <h3 className="font-bold text-lg sm:text-xl text-slate-800 dark:text-white mb-1 truncate">{acc.name}</h3>
                    <div className="flex items-center gap-2">
                      <p className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 dark:from-white dark:to-slate-300 bg-clip-text text-transparent">
                        {renderAmount(acc.id, accountBalances[acc.id] || 0)}
                      </p>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleAccountMask(acc.id); }}
                        className="shrink-0 p-1.5 rounded-lg text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all z-10"
                        title={isMasked(acc.id) ? 'Показать сумму' : 'Скрыть сумму'}
                        aria-label={isMasked(acc.id) ? 'Показать сумму' : 'Скрыть сумму'}
                      >
                        {isMasked(acc.id) ? ICONS.EyeOff : ICONS.Eye}
                      </button>
                    </div>
                  </div>
                  {acc.type === 'SHARED' && acc.partners && acc.partners.length > 0 && (
                    <div className="flex items-center justify-between">
                      <div className="flex -space-x-2 overflow-hidden">
                        {acc.partners.slice(0, 4).map((pid, idx) => {
                          const investor = investors.find(i => i.id === pid);
                          const colors = ['bg-indigo-500', 'bg-purple-500', 'bg-pink-500', 'bg-amber-500'];
                          return (
                            <div key={pid} className={`inline-flex h-6 w-6 sm:h-8 sm:w-8 rounded-full ${colors[idx % colors.length]} ring-2 ring-white dark:ring-slate-800 items-center justify-center text-white text-[10px] sm:text-xs font-bold shadow-sm`} title={investor?.name}>
                              {investor?.name?.charAt(0) || '?'}
                            </div>
                          );
                        })}
                        {acc.partners.length > 4 && (
                          <div className="inline-flex h-6 w-6 sm:h-8 sm:w-8 rounded-full bg-slate-100 dark:bg-slate-700 ring-2 ring-white dark:ring-slate-800 items-center justify-center text-[10px] sm:text-xs font-bold text-slate-600 dark:text-slate-300">+{acc.partners.length - 4}</div>
                        )}
                      </div>
                      <span className="text-[10px] sm:text-xs text-slate-400 dark:text-slate-500">{acc.partners.length} участников</span>
                    </div>
                  )}
                  {acc.type === 'POOL' && (
                    <div className="space-y-1.5">
                      {getAccountShares(acc, investors).map(({ investor, percentage }) => (
                        <div key={investor.id} className="flex items-center justify-between text-[11px] sm:text-xs">
                          <span className="text-slate-600 dark:text-slate-300 truncate">{investor.name}</span>
                          <span className="font-bold text-fuchsia-600 dark:text-fuchsia-400 shrink-0 ml-2">{Math.round(percentage)}%</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between text-[11px] sm:text-xs pt-1 border-t border-slate-100 dark:border-slate-700">
                        <span className="text-slate-400 dark:text-slate-500">Ваша доля (менеджер)</span>
                        <span className="font-bold text-slate-500 dark:text-slate-400">{Math.round(getManagerSharePercent(acc, investors))}%</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Скрытые счета — свёрнуты, но всегда под рукой */}
      {hiddenAccounts.length > 0 && (
        <div>
          <button
            onClick={() => setShowHiddenAccounts(prev => !prev)}
            className="flex items-center gap-2 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all"
          >
            <span className="text-slate-400 dark:text-slate-500">{ICONS.Archive}</span>
            <span>Скрытые счета ({hiddenAccounts.length})</span>
            <span className={`transition-transform ${showHiddenAccounts ? 'rotate-180' : ''}`}>▾</span>
          </button>

          {showHiddenAccounts && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 mt-4">
              {hiddenAccounts.map(acc => (
                <div
                  key={acc.id}
                  className="relative bg-slate-50 dark:bg-slate-800/60 rounded-2xl sm:rounded-3xl border border-dashed border-slate-200 dark:border-slate-700 p-4 sm:p-5"
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <h3 className="font-bold text-base sm:text-lg text-slate-600 dark:text-slate-300 truncate">{acc.name}</h3>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">{getAccountTypeLabel(acc.type)}</p>
                    </div>
                    <span className="shrink-0 px-2 py-1 rounded-full text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                      Скрыт
                    </span>
                  </div>

                  <p className="text-xl sm:text-2xl font-bold text-slate-500 dark:text-slate-400 mb-4">
                    {renderAmount(acc.id, accountBalances[acc.id] || 0)}
                  </p>

                  <div className="flex gap-2">
                    <button
                      onClick={() => onSelectAccount(acc.id)}
                      className="flex-1 py-2 text-xs font-bold rounded-xl bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-600 transition-all"
                    >
                      История
                    </button>
                    {isManager && onUpdateAccount && (
                      <button
                        onClick={() => handleToggleHidden(acc)}
                        className="flex-1 py-2 text-xs font-bold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-all"
                      >
                        Вернуть
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeMenuAccount && (
        <AccountActionModal account={activeMenuAccount} balance={accountBalances[activeMenuAccount.id] || 0} onClose={() => setActiveMenuAccount(null)} onSelectAccount={onSelectAccount} onEdit={setEditingAccount} onSetMain={onSetMainAccount} isManager={isManager} onUpdateAccount={onUpdateAccount} onToggleHidden={handleToggleHidden} appSettings={appSettings} isBalanceMasked={isMasked(activeMenuAccount.id)} />
      )}

      {/* 🔹🔹🔹 БЛОК: Моя прибыль 🔹🔹🔹 */}
     {isManager && (
    <div className="space-y-6 pt-8">
        {/* Фильтры */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-100 dark:border-slate-700">
            <div className="space-y-3">
                <div>
                    <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5 block">Фильтр по счету</label>
                    <select
                        className="w-full p-2.5 sm:p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-xl outline-none text-sm text-slate-700 dark:text-slate-300 font-medium focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition-all"
                        value={profitFilterAccountId}
                        onChange={e => { setProfitFilterAccountId(e.target.value); setProfitFilterInvestorId('ALL'); }}
                    >
                        <option value="ALL">Все счета</option>
                        {accounts.filter(a => a.type !== 'SHARED' && (!a.isArchived || a.id === profitFilterAccountId)).map(acc => (
                            <option key={acc.id} value={acc.id}>{acc.name}</option>
                        ))}
                    </select>
                </div>
                {investorProfitBreakdown.length > 1 && (
                    <div>
                        <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5 block">Фильтр по инвестору</label>
                        <select
                            className="w-full p-2.5 sm:p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-xl outline-none text-sm text-slate-700 dark:text-slate-300 font-medium focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition-all"
                            value={profitFilterInvestorId}
                            onChange={e => setProfitFilterInvestorId(e.target.value)}
                        >
                            <option value="ALL">Все инвесторы</option>
                            {investorProfitBreakdown.map(m => (
                                <option key={m.investor.id} value={m.investor.id}>{m.investor.name}</option>
                            ))}
                        </select>
                    </div>
                )}
                <div>
                    <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5 block">Период</label>
                    <div className="flex flex-wrap gap-2">
                        {PERIOD_CONFIG.map(({ key, label }) => (
                            <button
                                key={key}
                                onClick={() => applyPeriodMode(key)}
                                className={`flex-1 min-w-[68px] py-2 rounded-xl text-xs font-bold transition-colors ${
                                    periodMode === key
                                        ? 'bg-indigo-600 text-white'
                                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {periodMode === 'CUSTOM' && (
                    <div className="grid grid-cols-2 gap-3 animate-fade-in">
                        <div>
                            <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5 block">Начало</label>
                            <input
                                type="date"
                                className="w-full p-2.5 sm:p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-700 dark:text-slate-300 font-medium focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition-all"
                                value={myProfitPeriod.start}
                                onChange={e => setMyProfitPeriod(p => ({...p, start: e.target.value}))}
                            />
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5 block">Конец</label>
                            <input
                                type="date"
                                className="w-full p-2.5 sm:p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-700 dark:text-slate-300 font-medium focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition-all"
                                value={myProfitPeriod.end}
                                onChange={e => setMyProfitPeriod(p => ({...p, end: e.target.value}))}
                            />
                        </div>
                    </div>
                )}
            </div>

            <p className="text-[10px] sm:text-xs text-center text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-900 py-2 rounded-lg mt-3">
                {(() => {
                    const { start, end } = myProfitPeriod;
                    if (periodMode === 'ALL') return 'Показаны данные за все время';
                    const fmt = (d: string) => new Date(d).toLocaleDateString('ru-RU');
                    // В режиме «Свой» одно из полей можно очистить — тогда границы нет
                    if (!start) return `по ${fmt(end)}`;
                    if (!end) return `с ${fmt(start)}`;
                    return start === end ? fmt(start) : `${fmt(start)} — ${fmt(end)}`;
                })()}
            </p>
        </div>

        {/* Заголовок */}
        <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-white shadow-lg">
                {ICONS.TrendingUp}
            </div>
            <h3 className="text-xl font-bold bg-gradient-to-r from-slate-800 to-emerald-800 dark:from-white dark:to-emerald-400 bg-clip-text text-transparent">
                Моя прибыль
            </h3>
        </div>

        {/* Карточки в стиле дашборда: 4 карточки, 2 в ряд */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4">

            {/* 1. Ожидаемая прибыль */}
            <div className="group bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 dark:border-slate-700 hover:border-indigo-200 flex flex-col relative overflow-hidden cursor-default">

                <div
                    className="w-10 h-10 sm:w-12 sm:h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-4 z-10 relative group-hover:bg-emerald-500 group-hover:text-white transition-colors duration-300 shadow-sm">
                    <svg className="w-5 h-5 sm:w-6 sm:h-6" viewBox="0 0 24 24" fill="currentColor">
                        <text x="5" y="18" fontSize="16" fontWeight="bold">₽</text>
                    </svg>
                </div>
                <div className="z-10 relative mt-auto">
                    <p className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1 leading-tight">Ожидается</p>
                    <p className="text-lg sm:text-2xl font-bold text-slate-800 dark:text-white break-words leading-none">
                        {formatCurrency(calculatedExpectedProfit, appSettings.showCents)}
                        <span className="text-xs sm:text-sm text-slate-400 dark:text-slate-500 ml-1 font-bold">₽</span>
                    </p>
                </div>
            </div>

            {/* 2. Полученная прибыль */}
            <div className="group bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 dark:border-slate-700 hover:border-emerald-200 flex flex-col relative overflow-hidden cursor-default">

                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-4 z-10 relative group-hover:bg-emerald-500 group-hover:text-white transition-colors duration-300 shadow-sm">
                    <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                </div>
                <div className="z-10 relative mt-auto">
                    <p className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1 leading-tight">Получено</p>
                    <p className="text-lg sm:text-2xl font-bold text-slate-800 dark:text-white break-words leading-none">
                        {formatCurrency(totalManagerProfitEarned, appSettings.showCents)}
                        <span className="text-xs sm:text-sm text-slate-400 dark:text-slate-500 ml-1 font-bold">₽</span>
                    </p>
                </div>
            </div>

            {/* 3. Выплачено */}
            <div className="group bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 dark:border-slate-700 hover:border-rose-200 flex flex-col relative overflow-hidden cursor-default">

                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-rose-100 dark:bg-rose-900/30 rounded-xl flex items-center justify-center text-rose-600 dark:text-rose-400 mb-4 z-10 relative group-hover:bg-rose-500 group-hover:text-white transition-colors duration-300 shadow-sm">
                    <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                </div>
                <div className="z-10 relative mt-auto">
                    <p className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1 leading-tight">Выплачено</p>
                    <p className="text-lg sm:text-2xl font-bold text-slate-800 dark:text-white break-words leading-none">
                        {formatCurrency(totalManagerProfitWithdrawn, appSettings.showCents)}
                        <span className="text-xs sm:text-sm text-slate-400 dark:text-slate-500 ml-1 font-bold">₽</span>
                    </p>
                </div>
            </div>

            {/* 4. Доступно к выводу (кликабельно) */}
            <div
                onClick={() => setShowProfitDetails(true)}
                className="group bg-gradient-to-br from-slate-800 to-slate-900 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-700 hover:border-indigo-500 flex flex-col relative overflow-hidden cursor-pointer"
            >
                <div
                    className="absolute -right-6 -top-6 w-24 h-24 bg-white/10 rounded-full opacity-30 group-hover:scale-150 transition-transform duration-700 pointer-events-none"></div>
                <div
                    className="w-10 h-10 sm:w-12 sm:h-12 bg-white/20 rounded-xl flex items-center justify-center text-white mb-4 z-10 relative group-hover:bg-white/30 transition-colors duration-300 shadow-sm">
                    <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M7 11l5-5m0 0l5 5m-5-5v12"/>
                    </svg>
                </div>
                <div className="z-10 relative mt-auto">
                    <p className="text-[10px] sm:text-xs font-bold text-slate-300 uppercase tracking-wide mb-1 leading-tight">К
                        выводу</p>
                    <p className="text-lg sm:text-2xl font-bold text-white break-words leading-none">
                        {formatCurrency(managerProfitBalance, appSettings.showCents)}
                        <span className="text-xs sm:text-sm text-slate-400 ml-1 font-bold">₽</span>
                    </p>
                    <p className="text-[10px] sm:text-xs text-slate-400 mt-1">Нажмите для деталей</p>
                </div>
            </div>

        </div>
    </div>
     )}


        {/* 🔹🔹🔹 БЛОК: Прибыль инвестора (только если есть инвесторы) 🔹🔹🔹 */}
        {isManager && investorProfitStats && (
            <div className="space-y-6 pt-4">
                <div className="flex items-center gap-3">
                    <div
                        className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center text-white shadow-lg">
                {ICONS.Users}
            </div>
            <h3 className="text-xl font-bold bg-gradient-to-r from-slate-800 to-purple-800 dark:from-white dark:to-purple-400 bg-clip-text text-transparent">
                Прибыль инвестора
            </h3>
        </div>

        {/* Сетка: 2 карточки в ряд — при выбранном конкретном инвесторе (см. фильтр выше) показывает его личные цифры,
            при "Все инвесторы" — сумму по всем участникам счёта/пула. */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4">

            {/* 1. Ожидаемая прибыль инвестора */}
            <div className="group bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 dark:border-slate-700 hover:border-purple-200 flex flex-col relative overflow-hidden cursor-default">

                <div
                    className="w-10 h-10 sm:w-12 sm:h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-4 z-10 relative group-hover:bg-emerald-500 group-hover:text-white transition-colors duration-300 shadow-sm">
                    <svg className="w-5 h-5 sm:w-6 sm:h-6" viewBox="0 0 24 24" fill="currentColor">
                        <text x="5" y="18" fontSize="16" fontWeight="bold">₽</text>
                    </svg>
                </div>
                <div className="z-10 relative mt-auto">
                    <p className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1 leading-tight">Ожидается</p>
                    <p className="text-lg sm:text-2xl font-bold text-slate-800 dark:text-white break-words leading-none">
                        {formatCurrency(investorProfitStats.expectedProfit, appSettings.showCents)}
                        <span className="text-xs sm:text-sm text-slate-400 dark:text-slate-500 ml-1 font-bold">₽</span>
                    </p>
                </div>
            </div>

            {/* 2. Полученная прибыль инвестора */}
            <div className="group bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 dark:border-slate-700 hover:border-violet-200 flex flex-col relative overflow-hidden cursor-default">

                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-violet-100 dark:bg-violet-900/30 rounded-xl flex items-center justify-center text-violet-600 dark:text-violet-400 mb-4 z-10 relative group-hover:bg-violet-500 group-hover:text-white transition-colors duration-300 shadow-sm">
                    <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                </div>
                <div className="z-10 relative mt-auto">
                    <p className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1 leading-tight">Получено</p>
                    <p className="text-lg sm:text-2xl font-bold text-slate-800 dark:text-white break-words leading-none">
                        {formatCurrency(investorProfitStats.receivedProfit, appSettings.showCents)}
                        <span className="text-xs sm:text-sm text-slate-400 dark:text-slate-500 ml-1 font-bold">₽</span>
                    </p>
                </div>
            </div>

            {/* 3. Выплачено инвестору */}
            <div className="group bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 dark:border-slate-700 hover:border-rose-200 flex flex-col relative overflow-hidden cursor-default">

                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-rose-100 dark:bg-rose-900/30 rounded-xl flex items-center justify-center text-rose-600 dark:text-rose-400 mb-4 z-10 relative group-hover:bg-rose-500 group-hover:text-white transition-colors duration-300 shadow-sm">
                    <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                </div>
                <div className="z-10 relative mt-auto">
                    <p className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1 leading-tight">Выплачено</p>
                    <p className="text-lg sm:text-2xl font-bold text-slate-800 dark:text-white break-words leading-none">
                        {formatCurrency(investorProfitStats.totalWithdrawn, appSettings.showCents)}
                        <span className="text-xs sm:text-sm text-slate-400 dark:text-slate-500 ml-1 font-bold">₽</span>
                    </p>
                </div>
            </div>

            {/* 4. Доступно инвестору (кликабельно) */}
            <div
                onClick={() => setShowInvestorProfitDetails(true)}
                className="group bg-gradient-to-br from-slate-800 to-slate-900 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-700 hover:border-purple-500 flex flex-col relative overflow-hidden cursor-pointer"
            >
                <div className="absolute -right-6 -top-6 w-24 h-24 bg-white/10 rounded-full opacity-30 group-hover:scale-150 transition-transform duration-700 pointer-events-none"></div>
                <div
                    className="w-10 h-10 sm:w-12 sm:h-12 bg-white/20 rounded-xl flex items-center justify-center text-white mb-4 z-10 relative group-hover:bg-white/30 transition-colors duration-300 shadow-sm">
                    <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M7 11l5-5m0 0l5 5m-5-5v12"/>
                    </svg>
                </div>
                <div className="z-10 relative mt-auto">
                    <p className="text-[10px] sm:text-xs font-bold text-slate-300 uppercase tracking-wide mb-1 leading-tight">К
                        выводу</p>
                    <p className="text-lg sm:text-2xl font-bold text-white break-words leading-none">
                        {formatCurrency(investorProfitStats.balance, appSettings.showCents)}
                        <span className="text-xs sm:text-sm text-slate-400 ml-1 font-bold">₽</span>
                    </p>
                    <p className="text-[10px] sm:text-xs text-slate-400 mt-1">Нажмите для деталей</p>
                </div>
            </div>

        </div>
    </div>
)}

      {selectedSharedAccount && (
        <SharedAccountDetails account={selectedSharedAccount} sales={sales} expenses={expenses} investors={investors} onClose={() => setSelectedSharedAccount(null)} appSettings={appSettings} />
      )}


{/* 🔹 МОДАЛЬНОЕ ОКНО: Детали прибыли менеджера — на мобильных выезжает снизу, как модалка
    "Получено прибыли" на главном экране (Dashboard.tsx, ProfitDetailsModal) */}
{showProfitDetails && (
    <div
        className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
        onClick={() => setShowProfitDetails(false)}
    >
        <div
            className="bg-white dark:bg-slate-800 w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col animate-slide-up-sheet"
            onClick={e => e.stopPropagation()}
        >
            {/* Header */}
            <div className="px-4 py-3 flex items-center justify-between shrink-0 bg-gradient-to-r from-emerald-500 to-emerald-600">
                <div className="flex items-center gap-3">
                    <div className="text-white bg-white/20 p-2 rounded-xl">
                        {ICONS.TrendingUp}
                    </div>
                    <div>
                        <h3 className="text-base font-bold text-white">Моя прибыль</h3>
                        <p className="text-emerald-100 text-xs">
                            Баланс: <span className="font-bold text-white">{formatCurrency(managerProfitBalance, appSettings.showCents)} ₽</span>
                        </p>
                    </div>
                </div>
                <button onClick={() => setShowProfitDetails(false)} className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-xl transition-colors">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>

            {/* Tabs */}
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 shrink-0">
                <div className="flex gap-2 p-1 bg-slate-100 dark:bg-slate-700 rounded-xl">
                    <button
                        onClick={() => setProfitDetailsTab('accruals')}
                        className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all ${
                            profitDetailsTab === 'accruals'
                                ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-sm'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                        }`}
                    >
                        Начисления ({managerProfitAccruals.length})
                    </button>
                    <button
                        onClick={() => setProfitDetailsTab('payouts')}
                        className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all ${
                            profitDetailsTab === 'payouts'
                                ? 'bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 shadow-sm'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                        }`}
                    >
                        Выплаты ({managerProfitPayouts.length})
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {profitDetailsTab === 'accruals' && (
                    managerProfitAccruals.length === 0 ? (
                        <div className="text-center py-16">
                            <div className="w-20 h-20 bg-slate-100 dark:bg-slate-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <span className="text-4xl text-slate-400">{ICONS.TrendingUp}</span>
                            </div>
                            <p className="text-slate-500 dark:text-slate-400 font-medium">Нет начислений за этот период</p>
                        </div>
                    ) : (
                        managerProfitAccruals.map(p => (
                            <div
                                key={p.id}
                                onClick={() => { if (onSelectCustomer) { onSelectCustomer(p.customerId); setShowProfitDetails(false); } }}
                                className={`bg-white dark:bg-slate-800 p-3 rounded-xl border border-emerald-100 dark:border-emerald-900/50 transition-all ${onSelectCustomer ? 'cursor-pointer hover:shadow-md' : ''}`}
                            >
                                <div className="flex justify-between items-start">
                                    <div className="min-w-0 flex-1">
                                        <p className="font-semibold text-slate-800 dark:text-white text-sm truncate">{p.customerName}</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{p.productName}</p>
                                    </div>
                                    <div className="text-right ml-3 shrink-0">
                                        <p className="font-bold text-sm text-emerald-600 dark:text-emerald-400">+{formatCurrency(p.amount, appSettings.showCents)} ₽</p>
                                        <p className="text-[10px] text-slate-400">{formatDate(p.date)}</p>
                                    </div>
                                </div>
                            </div>
                        ))
                    )
                )}

                {profitDetailsTab === 'payouts' && (
                    managerProfitPayouts.length === 0 ? (
                        <div className="text-center py-16">
                            <div className="w-20 h-20 bg-slate-100 dark:bg-slate-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <span className="text-4xl text-slate-400">{ICONS.Wallet}</span>
                            </div>
                            <p className="text-slate-500 dark:text-slate-400 font-medium">Нет выплат за этот период</p>
                        </div>
                    ) : (
                        managerProfitPayouts.map(e => (
                            <div key={e.id} className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-rose-100 dark:border-rose-900/50">
                                <div className="flex justify-between items-start">
                                    <p className="font-semibold text-slate-800 dark:text-white text-sm truncate">{e.title}</p>
                                    <span className="font-bold text-sm text-rose-600 dark:text-rose-400 ml-3 shrink-0">-{formatCurrency(Number(e.amount), appSettings.showCents)} ₽</span>
                                </div>
                                <p className="text-[10px] text-slate-400 mt-0.5">{formatDate(e.date)}</p>
                            </div>
                        ))
                    )
                )}
            </div>
        </div>
    </div>
)}

{/* 🔹 МОДАЛЬНОЕ ОКНО: Детали прибыли инвестора — на мобильных выезжает снизу, как модалка
    "Получено прибыли" на главном экране (Dashboard.tsx, ProfitDetailsModal) */}
{showInvestorProfitDetails && investorProfitStats && (
    <div
        className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
        onClick={() => setShowInvestorProfitDetails(false)}
    >
        <div
            className="bg-white dark:bg-slate-800 w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col animate-slide-up-sheet"
            onClick={e => e.stopPropagation()}
        >
            {/* Header */}
            <div className="px-4 py-3 flex items-center justify-between shrink-0 bg-gradient-to-r from-purple-500 to-purple-600">
                <div className="flex items-center gap-3">
                    <div className="text-white bg-white/20 p-2 rounded-xl">
                        {ICONS.Users}
                    </div>
                    <div>
                        <h3 className="text-base font-bold text-white">Прибыль инвестора</h3>
                        <p className="text-purple-100 text-xs">
                            Баланс: <span className="font-bold text-white">{formatCurrency(investorProfitStats.balance, appSettings.showCents)} ₽</span>
                        </p>
                    </div>
                </div>
                <button onClick={() => setShowInvestorProfitDetails(false)} className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-xl transition-colors">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>

            {/* Tabs */}
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 shrink-0">
                <div className="flex gap-2 p-1 bg-slate-100 dark:bg-slate-700 rounded-xl">
                    <button
                        onClick={() => setProfitDetailsTab('accruals')}
                        className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all ${
                            profitDetailsTab === 'accruals'
                                ? 'bg-white dark:bg-slate-800 text-purple-600 dark:text-purple-400 shadow-sm'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                        }`}
                    >
                        Начисления ({investorProfitAccruals.length})
                    </button>
                    <button
                        onClick={() => setProfitDetailsTab('payouts')}
                        className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all ${
                            profitDetailsTab === 'payouts'
                                ? 'bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 shadow-sm'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                        }`}
                    >
                        Выплаты ({investorProfitPayouts.length})
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {profitDetailsTab === 'accruals' && (
                    investorProfitAccruals.length === 0 ? (
                        <div className="text-center py-16">
                            <div className="w-20 h-20 bg-slate-100 dark:bg-slate-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <span className="text-4xl text-slate-400">{ICONS.TrendingUp}</span>
                            </div>
                            <p className="text-slate-500 dark:text-slate-400 font-medium">Нет начислений за этот период</p>
                        </div>
                    ) : (
                        investorProfitAccruals.map(p => (
                            <div
                                key={p.id}
                                onClick={() => { if (onSelectCustomer) { onSelectCustomer(p.customerId); setShowInvestorProfitDetails(false); } }}
                                className={`bg-white dark:bg-slate-800 p-3 rounded-xl border border-purple-100 dark:border-purple-900/50 transition-all ${onSelectCustomer ? 'cursor-pointer hover:shadow-md' : ''}`}
                            >
                                <div className="flex justify-between items-start">
                                    <div className="min-w-0 flex-1">
                                        <p className="font-semibold text-slate-800 dark:text-white text-sm truncate">{p.customerName}</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                            {p.productName}
                                            {profitFilterInvestorId === 'ALL' && investorProfitBreakdown.length > 1 && (
                                                <span className="ml-1.5 px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 rounded text-[9px] font-bold">
                                                    {p.investorName}
                                                </span>
                                            )}
                                        </p>
                                    </div>
                                    <div className="text-right ml-3 shrink-0">
                                        <p className="font-bold text-sm text-purple-600 dark:text-purple-400">+{formatCurrency(p.amount, appSettings.showCents)} ₽</p>
                                        <p className="text-[10px] text-slate-400">{formatDate(p.date)}</p>
                                    </div>
                                </div>
                            </div>
                        ))
                    )
                )}

                {profitDetailsTab === 'payouts' && (
                    investorProfitPayouts.length === 0 ? (
                        <div className="text-center py-16">
                            <div className="w-20 h-20 bg-slate-100 dark:bg-slate-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <span className="text-4xl text-slate-400">{ICONS.Wallet}</span>
                            </div>
                            <p className="text-slate-500 dark:text-slate-400 font-medium">Нет выплат инвестору за этот период</p>
                        </div>
                    ) : (
                        investorProfitPayouts.map(e => {
                            const investor = investors.find(i => i.id === e.investorId);
                            return (
                                <div key={e.id} className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-rose-100 dark:border-rose-900/50">
                                    <div className="flex justify-between items-start">
                                        <div className="min-w-0 flex-1">
                                            <p className="font-semibold text-slate-800 dark:text-white text-sm truncate">{e.title}</p>
                                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{investor?.name || 'Инвестор'}</p>
                                        </div>
                                        <span className="font-bold text-sm text-rose-600 dark:text-rose-400 ml-3 shrink-0">-{formatCurrency(Number(e.amount), appSettings.showCents)} ₽</span>
                                    </div>
                                    <p className="text-[10px] text-slate-400 mt-0.5">{formatDate(e.date)}</p>
                                </div>
                            );
                        })
                    )
                )}
            </div>
        </div>
    </div>
)}




    </div>
  );
};

export default CashRegister;
