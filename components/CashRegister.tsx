import React, { useMemo, useState } from 'react';
import { Sale, Account, Expense, Investor } from '../types';
import { ICONS } from '../constants';

interface CashRegisterProps {
  accounts: Account[];
  sales: Sale[];
  expenses: Expense[];
  investors: Investor[];
  onAddAccount: (name: string, type: Account['type'], partners?: string[]) => void;
  onAction: (action: string) => void;
  onSelectAccount: (accountId: string) => void;
  onSetMainAccount: (accountId: string) => void;
  onUpdateAccount?: (account: Account) => void;
  isManager: boolean;
  totalExpectedProfit: number;
  realizedPeriodProfit: number;
  myProfitPeriod: { start: string; end: string; };
  setMyProfitPeriod: React.Dispatch<React.SetStateAction<{ start: string; end: string; }>>;
}

const CreateAccountModal = ({ onClose, onSubmit, investors }: { onClose: () => void, onSubmit: (name: string, type: Account['type'], partners?: string[]) => void, investors: Investor[] }) => {
    const [name, setName] = useState('');
    const [type, setType] = useState<Account['type']>('CUSTOM');
    const [selectedPartners, setSelectedPartners] = useState<string[]>([]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if(!name.trim()) return;
        onSubmit(name, type, type === 'SHARED' ? selectedPartners : undefined);
    };

    const togglePartner = (id: string) => {
        setSelectedPartners(prev => prev.includes(id) ? prev.filter(pid => pid !== id) : [...prev, id]);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gradient-to-br from-slate-900/80 to-indigo-900/80 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div className="bg-white/95 backdrop-blur-sm w-full max-w-sm rounded-3xl shadow-2xl p-6 border border-white/20" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white shadow-lg">
                        {ICONS.Plus}
                    </div>
                    <h3 className="text-xl font-bold bg-gradient-to-r from-slate-800 to-indigo-800 bg-clip-text text-transparent">Новый счет</h3>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-slate-700">Название счета</label>
                        <input
                            autoFocus
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition-all"
                            placeholder="Например: Общий котел"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-slate-700">Тип счета</label>
                        <div className="flex gap-2 bg-slate-100 p-1.5 rounded-2xl">
                            <button
                                type="button"
                                onClick={() => setType('CUSTOM')}
                                className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all ${
                                    type === 'CUSTOM' 
                                        ? 'bg-white shadow-md text-slate-800 transform scale-105' 
                                        : 'text-slate-500 hover:text-slate-700'
                                }`}
                            >
                                Личный
                            </button>
                            <button
                                type="button"
                                onClick={() => setType('SHARED')}
                                className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all ${
                                    type === 'SHARED' 
                                        ? 'bg-white shadow-md text-indigo-600 transform scale-105' 
                                        : 'text-slate-500 hover:text-slate-700'
                                }`}
                            >
                                Общий
                            </button>
                        </div>
                    </div>

                    {type === 'SHARED' && (
                        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 p-4 rounded-xl border border-indigo-100 max-h-40 overflow-y-auto">
                            <p className="text-xs font-bold text-indigo-700 mb-3 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></span>
                                Выберите партнеров:
                            </p>
                            {investors.length === 0 ? (
                                <p className="text-xs text-slate-400 text-center py-2">Нет доступных инвесторов</p>
                            ) : (
                                <div className="space-y-2">
                                    {investors.map(inv => (
                                        <label key={inv.id} className="flex items-center gap-3 cursor-pointer group">
                                            <input
                                                type="checkbox"
                                                checked={selectedPartners.includes(inv.id)}
                                                onChange={() => togglePartner(inv.id)}
                                                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 transition-all"
                                            />
                                            <span className="text-sm text-slate-700 group-hover:text-indigo-600 transition-colors">
                                                {inv.name}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="flex gap-3 mt-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-3.5 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-all"
                        >
                            Отмена
                        </button>
                        <button
                            type="submit"
                            className="flex-1 py-3.5 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-xl font-bold hover:from-indigo-700 hover:to-indigo-800 transition-all shadow-lg shadow-indigo-200"
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
            <div className="bg-white/95 backdrop-blur-sm w-full max-w-sm rounded-3xl shadow-2xl p-6 border border-white/20" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center text-white shadow-lg">
                        {ICONS.Edit}
                    </div>
                    <h3 className="text-xl font-bold bg-gradient-to-r from-slate-800 to-amber-800 bg-clip-text text-transparent">Редактировать счет</h3>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-slate-700">Название счета</label>
                        <input
                            autoFocus
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100 transition-all"
                        />
                    </div>

                    <div className="flex gap-3 mt-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-3.5 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-all"
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

const SharedAccountDetails = ({ account, sales, expenses, investors, onClose }: { account: Account, sales: Sale[], expenses: Expense[], investors: Investor[], onClose: () => void }) => {
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
            <div className="bg-white/95 backdrop-blur-sm w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] border border-white/20" onClick={e => e.stopPropagation()}>
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
                        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 p-4 rounded-2xl">
                            <p className="text-xs text-emerald-700 font-medium mb-1">Кэш в кассе</p>
                            <p className="text-xl font-bold text-emerald-800">{cashBalance.toLocaleString()} ₽</p>
                        </div>
                        <div className="bg-gradient-to-br from-amber-50 to-amber-100 p-4 rounded-2xl">
                            <p className="text-xs text-amber-700 font-medium mb-1">В товаре (Долги)</p>
                            <p className="text-xl font-bold text-amber-800">{receivables.toLocaleString()} ₽</p>
                        </div>
                    </div>

                    <div className="bg-gradient-to-br from-slate-800 to-slate-900 text-white p-5 rounded-2xl">
                        <p className="text-slate-400 text-sm mb-2">Общая стоимость активов</p>
                        <p className="text-3xl font-bold mb-3">{totalAccountEquity.toLocaleString()} ₽</p>
                        <div className="flex justify-between text-xs border-t border-slate-700 pt-3">
                            <span className="text-slate-400">Вложено: <span className="text-white font-medium">{totalNetCapital.toLocaleString()} ₽</span></span>
                            <span className="text-emerald-400">Прибыль: +{totalProfitGenerated.toLocaleString()} ₽</span>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <h4 className="font-bold text-slate-800 flex items-center gap-2">
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
                                    <div key={p.id} className="bg-white border border-slate-100 p-4 rounded-2xl shadow-sm hover:shadow-md transition-all">
                                        <div className="flex justify-between items-center mb-3">
                                            <span className="font-bold text-slate-800">{p.name}</span>
                                            <span className="bg-indigo-100 text-indigo-700 text-xs px-3 py-1 rounded-full font-bold">
                                                {sharePercent.toFixed(1)}%
                                            </span>
                                        </div>
                                        <div className="w-full bg-slate-100 h-2 rounded-full mb-4 overflow-hidden">
                                            <div className="bg-gradient-to-r from-indigo-500 to-purple-500 h-full rounded-full transition-all" style={{width: `${sharePercent}%`}}></div>
                                        </div>
                                        <div className="grid grid-cols-2 text-sm gap-3">
                                            <div>
                                                <span className="text-slate-400 text-xs block">Вложено</span>
                                                <span className="font-medium text-slate-800">{p.netCapital.toLocaleString()} ₽</span>
                                            </div>
                                            <div className="text-right">
                                                <span className="text-slate-400 text-xs block">Доля в активах</span>
                                                <span className="font-bold text-slate-800">{Math.round(equityValue).toLocaleString()} ₽</span>
                                            </div>
                                        </div>
                                        {profitShare > 0 && (
                                            <div className="mt-3 pt-3 border-t border-slate-100 flex justify-between text-sm">
                                                <span className="text-emerald-600 font-medium">Доступная прибыль</span>
                                                <span className="font-bold text-emerald-600">+{Math.round(profitShare).toLocaleString()} ₽</span>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t border-slate-100 bg-slate-50">
                    <button
                        onClick={onClose}
                        className="w-full py-3.5 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl hover:bg-slate-100 transition-all"
                    >
                        Закрыть
                    </button>
                </div>
            </div>
        </div>
    );
};

// Компонент меню действий, который появляется поверх карточки
const AccountActionMenu = ({
    account,
    onClose,
    onSelectAccount,
    onEdit,
    onSetMain,
    isManager,
    onUpdateAccount
}: {
    account: Account;
    onClose: () => void;
    onSelectAccount: (id: string) => void;
    onEdit: (acc: Account) => void;
    onSetMain: (id: string) => void;
    isManager: boolean;
    onUpdateAccount?: (acc: Account) => void;
}) => {
    const getAccountTypeColor = (type: Account['type']) => {
        switch(type) {
            case 'MAIN': return 'from-indigo-500 to-indigo-600';
            case 'INVESTOR': return 'from-purple-500 to-purple-600';
            case 'CUSTOM': return 'from-emerald-500 to-emerald-600';
            case 'SHARED': return 'from-amber-500 to-amber-600';
            default: return 'from-slate-500 to-slate-600';
        }
    };

    return (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-6 bg-gradient-to-br from-slate-900/90 to-indigo-900/90 backdrop-blur-sm rounded-3xl animate-fade-in" onClick={onClose}>
            <div className="bg-white/95 backdrop-blur-sm w-full max-w-xs rounded-2xl shadow-2xl overflow-hidden border border-white/20" onClick={e => e.stopPropagation()}>
                {/* Заголовок с градиентом как у карточки */}
                <div className={`h-2 bg-gradient-to-r ${getAccountTypeColor(account.type)}`}></div>

                <div className="p-5">
                    <div className="flex items-center gap-3 mb-4">
                        <div className={`w-10 h-10 rounded-xl bg-gradient-to-r ${getAccountTypeColor(account.type)} flex items-center justify-center text-white shadow-lg`}>
                            {account.type === 'SHARED' ? ICONS.Users : ICONS.Wallet}
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-800">{account.name}</h3>
                            <p className="text-xs text-slate-500">{account.type === 'MAIN' ? 'Основной счет' :
                                account.type === 'INVESTOR' ? 'Счет инвестора' :
                                account.type === 'SHARED' ? 'Общий счет' : 'Дополнительный'}</p>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <button
                            onClick={() => { onSelectAccount(account.id); onClose(); }}
                            className="w-full text-left px-4 py-3.5 text-sm text-slate-700 hover:bg-indigo-50 rounded-xl flex items-center gap-3 transition-all group"
                        >
                            <span className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-500 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-all">
                                {ICONS.List}
                            </span>
                            <div>
                                <span className="font-medium">История операций</span>
                                <p className="text-xs text-slate-400">Просмотр всех движений по счету</p>
                            </div>
                        </button>

                        {isManager && onUpdateAccount && (
                            <button
                                onClick={() => { onEdit(account); onClose(); }}
                                className="w-full text-left px-4 py-3.5 text-sm text-slate-700 hover:bg-amber-50 rounded-xl flex items-center gap-3 transition-all group"
                            >
                                <span className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-500 group-hover:bg-amber-100 group-hover:text-amber-600 transition-all">
                                    {ICONS.Edit}
                                </span>
                                <div>
                                    <span className="font-medium">Редактировать</span>
                                    <p className="text-xs text-slate-400">Изменить название счета</p>
                                </div>
                            </button>
                        )}

                        {isManager && account.type !== 'MAIN' && (
                            <button
                                onClick={() => { onSetMain(account.id); onClose(); }}
                                className="w-full text-left px-4 py-3.5 text-sm text-slate-700 hover:bg-emerald-50 rounded-xl flex items-center gap-3 transition-all group"
                            >
                                <span className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-500 group-hover:bg-emerald-100 group-hover:text-emerald-600 transition-all">
                                    {ICONS.Check}
                                </span>
                                <div>
                                    <span className="font-medium">Сделать основным</span>
                                    <p className="text-xs text-slate-400">Установить как основной счет</p>
                                </div>
                            </button>
                        )}

                        <button
                            onClick={onClose}
                            className="w-full text-left px-4 py-3.5 text-sm text-slate-700 hover:bg-slate-100 rounded-xl flex items-center gap-3 transition-all group mt-2 border-t border-slate-100 pt-3"
                        >
                            <span className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-500 group-hover:bg-slate-200 transition-all">
                                ✕
                            </span>
                            <span className="font-medium">Закрыть</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const CashRegister: React.FC<CashRegisterProps> = ({
    accounts, sales, expenses, investors, onAddAccount, onAction, onSelectAccount, onSetMainAccount, onUpdateAccount,
    isManager, myProfitPeriod, setMyProfitPeriod
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [selectedSharedAccount, setSelectedSharedAccount] = useState<Account | null>(null);
  const [activeMenuAccount, setActiveMenuAccount] = useState<Account | null>(null);

  const [showProfitDetails, setShowProfitDetails] = useState(false);
  const [profitDetailsTab, setProfitDetailsTab] = useState<'accruals' | 'payouts'>('accruals');
  const [profitFilterAccountId, setProfitFilterAccountId] = useState<string>('ALL');

  const accountBalances = useMemo(() => {
    const balances: Record<string, number> = {};

    accounts.forEach(acc => {
      let total = 0;

      const accountSales = sales.filter(s => s.accountId === acc.id);
      accountSales.forEach(s => {
          total += Number(s.downPayment);
          s.paymentPlan.filter(p => p.isPaid).forEach(p => total += Number(p.amount));
      });

      const accountExpenses = expenses.filter(e => e.accountId === acc.id);
      total -= accountExpenses.reduce((sum, e) => sum + Number(e.amount), 0);

      balances[acc.id] = total;
    });

    return balances;
  }, [accounts, sales, expenses]);

  const calculatedExpectedProfit = useMemo(() => {
      let totalProfit = 0;

      const activeSales = sales.filter(s => s.status === 'ACTIVE' && s.buyPrice > 0);

      activeSales.forEach(sale => {
          if (profitFilterAccountId !== 'ALL' && sale.accountId !== profitFilterAccountId) return;

          const saleProfit = sale.totalAmount - sale.buyPrice;
          if (saleProfit <= 0) return;

          const account = accounts.find(a => a.id === sale.accountId);
          let managerProfitShare = 1;

          if (account && account.type === 'INVESTOR' && account.ownerId) {
              const investor = investors.find(i => i.id === account.ownerId);
              if (investor) {
                  managerProfitShare = (100 - investor.profitPercentage) / 100;
              }
          }

          totalProfit += saleProfit * managerProfitShare;
      });

      return totalProfit;
  }, [sales, accounts, investors, profitFilterAccountId]);

  const { managerProfitAccruals, managerProfitPayouts, totalManagerProfitEarned, totalManagerProfitWithdrawn } = useMemo(() => {
    const accruals: {id: string, date: string, amount: number, source: string}[] = [];

    sales.forEach(sale => {
        if (profitFilterAccountId !== 'ALL' && sale.accountId !== profitFilterAccountId) return;
        if (sale.buyPrice <= 0 || sale.totalAmount <= sale.buyPrice) return;

        const totalSaleProfit = Number(sale.totalAmount) - Number(sale.buyPrice);
        const profitMargin = totalSaleProfit / Number(sale.totalAmount);

        const account = accounts.find(a => a.id === sale.accountId);

        let managerProfitSharePercent = 1.0;
        if (account?.type === 'INVESTOR' && account.ownerId) {
            const investor = investors.find(i => i.id === account.ownerId);
            if (investor) {
                managerProfitSharePercent = (100 - investor.profitPercentage) / 100;
            }
        } else if (account?.type === 'SHARED') {
            return;
        }

        const allPayments = [
            { date: sale.startDate, amount: Number(sale.downPayment), id: `${sale.id}_dp` },
            ...sale.paymentPlan.filter(p => p.isPaid)
        ];

        allPayments.forEach(p => {
            if (p.amount > 0) {
                const pDate = new Date(p.date);
                const startDate = myProfitPeriod.start ? new Date(myProfitPeriod.start) : new Date(0);
                const endDate = myProfitPeriod.end ? new Date(myProfitPeriod.end) : new Date(2100, 0, 1);
                endDate.setHours(23, 59, 59, 999);

                if (pDate >= startDate && pDate <= endDate) {
                    const profitFromPayment = p.amount * profitMargin;
                    const managerShare = profitFromPayment * managerProfitSharePercent;
                    if(managerShare > 0) {
                        accruals.push({
                            id: p.id,
                            date: p.date,
                            amount: managerShare,
                            source: `Платеж по "${sale.productName}"`
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
  }, [sales, expenses, accounts, investors, profitFilterAccountId, myProfitPeriod]);

  const managerProfitBalance = totalManagerProfitEarned - totalManagerProfitWithdrawn;

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
          default: return 'Счет';
      }
  }

  const getAccountTypeColor = (type: Account['type']) => {
      switch(type) {
          case 'MAIN': return 'from-indigo-500 to-indigo-600';
          case 'INVESTOR': return 'from-purple-500 to-purple-600';
          case 'CUSTOM': return 'from-emerald-500 to-emerald-600';
          case 'SHARED': return 'from-amber-500 to-amber-600';
          default: return 'from-slate-500 to-slate-600';
      }
  }

  const handleAccountClick = (acc: Account) => {
      if (acc.type === 'SHARED') {
          setSelectedSharedAccount(acc);
      } else {
          // Больше не переходим на историю, просто показываем меню
          setActiveMenuAccount(acc);
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
          <h2 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-indigo-800 bg-clip-text text-transparent">
            Мои Счета
          </h2>
        </div>

        {isManager && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold hover:from-indigo-700 hover:to-indigo-800 transition-all shadow-lg shadow-indigo-200"
          >
            <span className="text-lg">{ICONS.Plus}</span>
            <span>Новый счет</span>
          </button>
        )}
      </div>

      {/* Modals */}
      {isAdding && (
        <CreateAccountModal
          onClose={() => setIsAdding(false)}
          onSubmit={handleCreateAccount}
          investors={investors}
        />
      )}

      {editingAccount && onUpdateAccount && (
        <EditAccountModal
          account={editingAccount}
          onClose={() => setEditingAccount(null)}
          onUpdate={onUpdateAccount}
        />
      )}

      {/* Account Cards */}
      {accounts.length === 0 ? (
        <div className="bg-gradient-to-br from-slate-50 to-indigo-50 rounded-3xl p-12 text-center border-2 border-dashed border-indigo-200">
          <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-3xl text-indigo-400">{ICONS.Wallet}</span>
          </div>
          <h3 className="text-xl font-bold text-slate-800 mb-2">Нет созданных счетов</h3>
          <p className="text-slate-500 mb-6">Создайте первый счет для начала работы</p>
          {isManager && (
            <button
              onClick={() => setIsAdding(true)}
              className="inline-flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white px-6 py-3 rounded-xl font-bold hover:from-indigo-700 hover:to-indigo-800 transition-all shadow-lg"
            >
              <span>{ICONS.Plus}</span>
              <span>Создать счет</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {accounts.map(acc => (
            <div
              key={acc.id}
              className="relative bg-white rounded-3xl shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden cursor-pointer transform hover:-translate-y-1"
              onClick={() => handleAccountClick(acc)}
            >
              {/* Background Gradient */}
              <div className={`absolute inset-0 bg-gradient-to-br ${getAccountTypeColor(acc.type)} opacity-0 hover:opacity-5 transition-opacity`}></div>

              {/* Top Accent */}
              <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${getAccountTypeColor(acc.type)}`}></div>

              <div className="relative p-6">
                {/* Type Badge */}
                <div className="flex items-start justify-between mb-4">
                  <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-gradient-to-r ${getAccountTypeColor(acc.type)} text-white shadow-sm`}>
                    {acc.type === 'SHARED' && <span className="text-xs">{ICONS.Users}</span>}
                    {getAccountTypeLabel(acc.type)}
                  </div>

                  {/* Кнопка меню теперь вызывает меню поверх карточки */}
                  <button
                    onClick={(e) => handleMenuClick(e, acc)}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all z-10"
                  >
                    {ICONS.More}
                  </button>
                </div>

                {/* Account Info */}
                <div className="space-y-4">
                  <div>
                    <h3 className="font-bold text-xl text-slate-800 mb-1">{acc.name}</h3>
                    <p className="text-3xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
                      {(accountBalances[acc.id] || 0).toLocaleString()} ₽
                    </p>
                  </div>

                  {/* Partners Avatars for Shared Accounts */}
                  {acc.type === 'SHARED' && acc.partners && acc.partners.length > 0 && (
                    <div className="flex items-center justify-between">
                      <div className="flex -space-x-2 overflow-hidden">
                        {acc.partners.slice(0, 4).map((pid, idx) => {
                          const investor = investors.find(i => i.id === pid);
                          const colors = ['bg-indigo-500', 'bg-purple-500', 'bg-pink-500', 'bg-amber-500'];
                          return (
                            <div
                              key={pid}
                              className={`inline-flex h-8 w-8 rounded-full ${colors[idx % colors.length]} ring-2 ring-white items-center justify-center text-white text-xs font-bold shadow-sm`}
                              title={investor?.name}
                            >
                              {investor?.name?.charAt(0) || '?'}
                            </div>
                          );
                        })}
                        {(acc.partners.length) > 4 && (
                          <div className="inline-flex h-8 w-8 rounded-full bg-slate-100 ring-2 ring-white items-center justify-center text-xs font-bold text-slate-600">
                            +{acc.partners.length - 4}
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-slate-400">{acc.partners.length} участников</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Menu Overlay */}
              {activeMenuAccount?.id === acc.id && (
                <AccountActionMenu
                  account={acc}
                  onClose={() => setActiveMenuAccount(null)}
                  onSelectAccount={onSelectAccount}
                  onEdit={setEditingAccount}
                  onSetMain={onSetMainAccount}
                  isManager={isManager}
                  onUpdateAccount={onUpdateAccount}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Profit Section for Manager */}
      {isManager && (
        <div className="space-y-6 pt-8">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-white shadow-lg">
              {ICONS.TrendingUp}
            </div>
            <h3 className="text-xl font-bold bg-gradient-to-r from-slate-800 to-emerald-800 bg-clip-text text-transparent">
              Моя прибыль
            </h3>
          </div>

          {/* Filters */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Фильтр по счету</label>
                <select
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm text-slate-700 font-medium focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition-all"
                  value={profitFilterAccountId}
                  onChange={e => setProfitFilterAccountId(e.target.value)}
                >
                  <option value="ALL">Все счета</option>
                  {accounts.filter(a => a.type !== 'SHARED').map(acc => (
                    <option key={acc.id} value={acc.id}>{acc.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Начало периода</label>
                <input
                  type="date"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700 font-medium focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition-all"
                  value={myProfitPeriod.start}
                  onChange={e => setMyProfitPeriod(p => ({...p, start: e.target.value}))}
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Конец периода</label>
                <input
                  type="date"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700 font-medium focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition-all"
                  value={myProfitPeriod.end}
                  onChange={e => setMyProfitPeriod(p => ({...p, end: e.target.value}))}
                />
              </div>
            </div>

            {(!myProfitPeriod.start && !myProfitPeriod.end) && (
              <p className="text-xs text-center text-slate-400 bg-slate-50 py-2 rounded-lg">
                Показаны данные за все время
              </p>
            )}
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 p-6 rounded-2xl">
              <p className="text-sm font-medium text-indigo-600 mb-2">Ожидаемая прибыль</p>
              <p className="text-2xl font-bold text-indigo-900">
                {calculatedExpectedProfit.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} ₽
              </p>
              <p className="text-xs text-indigo-500 mt-2">С активных договоров</p>
            </div>

            <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 p-6 rounded-2xl">
              <p className="text-sm font-medium text-emerald-600 mb-2">Полученная прибыль</p>
              <p className="text-2xl font-bold text-emerald-900">
                {totalManagerProfitEarned.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} ₽
              </p>
              <p className="text-xs text-emerald-500 mt-2">За выбранный период</p>
            </div>

            <div
              onClick={() => setShowProfitDetails(true)}
              className="bg-gradient-to-br from-slate-800 to-slate-900 p-6 rounded-2xl cursor-pointer hover:from-slate-700 hover:to-slate-800 transition-all transform hover:scale-105"
            >
              <p className="text-sm font-medium text-slate-300 mb-2">Доступно к выводу</p>
              <p className="text-2xl font-bold text-white">
                {managerProfitBalance.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} ₽
              </p>
              <p className="text-xs text-slate-400 mt-2">Нажмите для деталей</p>
            </div>
          </div>
        </div>
      )}

      {/* Profit Details Modal */}
      {showProfitDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gradient-to-br from-slate-900/90 to-indigo-900/90 backdrop-blur-sm animate-fade-in" onClick={() => setShowProfitDetails(false)}>
          <div className="bg-white/95 backdrop-blur-sm w-full max-w-md rounded-3xl shadow-2xl flex flex-col max-h-[80vh] border border-white/20" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-100">
              <h3 className="text-xl font-bold bg-gradient-to-r from-slate-800 to-indigo-800 bg-clip-text text-transparent">Детализация прибыли</h3>
              <p className="text-sm text-slate-500 mt-1">
                Баланс: <span className="font-bold text-emerald-600">{managerProfitBalance.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} ₽</span>
              </p>
            </div>

            <div className="flex border-b border-slate-100 p-1">
              <button
                onClick={() => setProfitDetailsTab('accruals')}
                className={`flex-1 py-3 text-sm font-semibold rounded-xl transition-all ${
                  profitDetailsTab === 'accruals' 
                    ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-md' 
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Начисления
              </button>
              <button
                onClick={() => setProfitDetailsTab('payouts')}
                className={`flex-1 py-3 text-sm font-semibold rounded-xl transition-all ${
                  profitDetailsTab === 'payouts' 
                    ? 'bg-gradient-to-r from-red-500 to-red-600 text-white shadow-md' 
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Выплаты
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {profitDetailsTab === 'accruals' && (
                <div className="space-y-2 animate-fade-in">
                  {managerProfitAccruals.length === 0 ? (
                    <div className="text-center py-8">
                      <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                        <span className="text-2xl text-slate-400">{ICONS.TrendingUp}</span>
                      </div>
                      <p className="text-slate-500">Нет начислений за этот период</p>
                    </div>
                  ) : (
                    managerProfitAccruals.map(p => (
                      <div key={p.id} className="flex justify-between items-center p-3 bg-emerald-50 rounded-xl hover:bg-emerald-100 transition-all">
                        <div>
                          <p className="font-medium text-slate-800 text-sm">{p.source}</p>
                          <p className="text-xs text-slate-500">{new Date(p.date).toLocaleDateString('ru-RU')}</p>
                        </div>
                        <span className="font-bold text-emerald-600">
                          +{p.amount.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} ₽
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {profitDetailsTab === 'payouts' && (
                <div className="space-y-2 animate-fade-in">
                  {managerProfitPayouts.length === 0 ? (
                    <div className="text-center py-8">
                      <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                        <span className="text-2xl text-slate-400">{ICONS.Wallet}</span>
                      </div>
                      <p className="text-slate-500">Нет выплат за этот период</p>
                    </div>
                  ) : (
                    managerProfitPayouts.map(e => (
                      <div key={e.id} className="flex justify-between items-center p-3 bg-red-50 rounded-xl hover:bg-red-100 transition-all">
                        <div>
                          <p className="font-medium text-slate-800 text-sm">{e.title}</p>
                          <p className="text-xs text-slate-500">{new Date(e.date).toLocaleDateString('ru-RU')}</p>
                        </div>
                        <span className="font-bold text-red-600">
                          -{Number(e.amount).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} ₽
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50">
              <button
                onClick={() => setShowProfitDetails(false)}
                className="w-full py-3.5 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl hover:bg-slate-100 transition-all"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shared Account Details Modal */}
      {selectedSharedAccount && (
        <SharedAccountDetails
          account={selectedSharedAccount}
          sales={sales}
          expenses={expenses}
          investors={investors}
          onClose={() => setSelectedSharedAccount(null)}
        />
      )}
    </div>
  );
};

export default CashRegister;