
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

const CreateAccountModal = ({ onClose, onSubmit }: { onClose: () => void, onSubmit: (name: string, type: Account['type']) => void }) => {
    const [name, setName] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if(!name.trim()) return;
        // Default to CUSTOM (Personal) account, removed SHARED option
        onSubmit(name, 'CUSTOM');
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
                            placeholder="Например: Касса 1"
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

// Аккуратное модальное окно для действий со счетом
const AccountActionModal = ({
    account,
    balance,
    onClose,
    onSelectAccount,
    onEdit,
    onSetMain,
    isManager,
    onUpdateAccount
}: {
    account: Account;
    balance: number;
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

    const getAccountTypeIcon = (type: Account['type']) => {
        switch(type) {
            case 'MAIN': return '⭐';
            case 'INVESTOR': return '📈';
            case 'CUSTOM': return '💼';
            case 'SHARED': return ICONS.Users;
            default: return '💳';
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div className="bg-white w-full max-w-xs rounded-2xl shadow-2xl overflow-hidden animate-slide-up" onClick={e => e.stopPropagation()}>
                {/* Верхняя полоса с цветом типа счета */}
                <div className={`h-2 bg-gradient-to-r ${getAccountTypeColor(account.type)}`}></div>

                <div className="p-5">
                    {/* Информация о счете */}
                    <div className="flex items-center gap-3 mb-4 pb-4 border-b border-slate-100">
                        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${getAccountTypeColor(account.type)} flex items-center justify-center text-white text-xl shadow-lg`}>
                            {getAccountTypeIcon(account.type)}
                        </div>
                        <div className="flex-1">
                            <h3 className="font-bold text-lg text-slate-800">{account.name}</h3>
                            <p className="text-xs text-slate-500">
                                {account.type === 'MAIN' ? 'Основной счет' :
                                 account.type === 'INVESTOR' ? 'Счет инвестора' :
                                 account.type === 'SHARED' ? 'Общий счет' : 'Дополнительный счет'}
                            </p>
                            <p className="text-sm font-bold text-indigo-600 mt-1">
                                {balance.toLocaleString()} ₽
                            </p>
                        </div>
                    </div>

                    {/* Список действий */}
                    <div className="space-y-1">
                        <button
                            onClick={() => { onSelectAccount(account.id); onClose(); }}
                            className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-indigo-50 rounded-xl flex items-center gap-3 transition-all group"
                        >
                            <span className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600 group-hover:bg-indigo-100 transition-all">
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
                                className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-amber-50 rounded-xl flex items-center gap-3 transition-all group"
                            >
                                <span className="w-8 h-8 bg-amber-50 rounded-lg flex items-center justify-center text-amber-600 group-hover:bg-amber-100 transition-all">
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
                                className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-emerald-50 rounded-xl flex items-center gap-3 transition-all group"
                            >
                                <span className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center text-emerald-600 group-hover:bg-emerald-100 transition-all">
                                    {ICONS.Check}
                                </span>
                                <div>
                                    <span className="font-medium">Сделать основным</span>
                                    <p className="text-xs text-slate-400">Установить как основной счет</p>
                                </div>
                            </button>
                        )}
                    </div>

                    {/* Кнопка закрытия */}
                    <button
                        onClick={onClose}
                        className="w-full mt-4 py-3 bg-slate-100 text-slate-600 font-medium rounded-xl hover:bg-slate-200 transition-all flex items-center justify-center gap-2"
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
          // Only sum REAL payments (exclude plan items)
          s.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false).forEach(p => total += Number(p.amount));
      });

      const accountExpenses = expenses.filter(e => e.accountId === acc.id);
      total -= accountExpenses.reduce((sum, e) => sum + Number(e.amount), 0);

      balances[acc.id] = total;
    });

    return balances;
  }, [accounts, sales, expenses]);

  const calculatedExpectedProfit = useMemo(() => {
      let totalProfit = 0;

      // Include both ACTIVE and COMPLETED sales
      const salesWithProfit = sales.filter(s => (s.status === 'ACTIVE' || s.status === 'COMPLETED') && s.buyPrice > 0);

      salesWithProfit.forEach(sale => {
          if (profitFilterAccountId !== 'ALL' && sale.accountId !== profitFilterAccountId) return;

          const saleProfit = sale.totalAmount - sale.buyPrice;
          if (saleProfit <= 0) return;

          const account = accounts.find(a => a.id === sale.accountId);
          let managerProfitShare = 1;

          if (account && account.ownerId) {
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
        if (account?.ownerId) {
            const investor = investors.find(i => i.id === account.ownerId);
            if (investor) {
                managerProfitSharePercent = (100 - investor.profitPercentage) / 100;
            }
        } else if (account?.type === 'SHARED') {
            return;
        }

        // Use only REAL payments for profit calculation
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
          <h2 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-indigo-800 bg-clip-text text-transparent">
            Мои Счета
          </h2>
        </div>

        {isManager && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold hover:from-indigo-700 hover:to-indigo-800 transition-all shadow-lg shadow-indigo-200 text-sm sm:text-base"
          >
            <span className="text-lg">{ICONS.Plus}</span>
            <span className="hidden sm:inline">+Новый счет</span>
          </button>
        )}
      </div>

      {/* Modals */}
      {isAdding && (
        <CreateAccountModal
          onClose={() => setIsAdding(false)}
          onSubmit={handleCreateAccount}
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
        <div className="bg-gradient-to-br from-slate-50 to-indigo-50 rounded-3xl p-8 sm:p-12 text-center border-2 border-dashed border-indigo-200">
          <div className="w-16 h-16 sm:w-20 sm:h-20 bg-white rounded-2xl sm:rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-2xl sm:text-3xl text-indigo-400">{ICONS.Wallet}</span>
          </div>
          <h3 className="text-lg sm:text-xl font-bold text-slate-800 mb-2">Нет созданных счетов</h3>
          <p className="text-sm sm:text-base text-slate-500 mb-6">Создайте первый счет для начала работы</p>
          {isManager && (
            <button
              onClick={() => setIsAdding(true)}
              className="inline-flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white px-5 py-2.5 sm:px-6 sm:py-3 rounded-xl font-bold hover:from-indigo-700 hover:to-indigo-800 transition-all shadow-lg text-sm sm:text-base"
            >
              <span>{ICONS.Plus}</span>
              <span>Создать счет</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {accounts.map(acc => (
            <div
              key={acc.id}
              className="relative bg-white rounded-2xl sm:rounded-3xl shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden"
              onClick={() => handleSharedAccountClick(acc)}
            >
              {/* Background Gradient */}
              <div className={`absolute inset-0 bg-gradient-to-br ${getAccountTypeColor(acc.type)} opacity-0 hover:opacity-5 transition-opacity`}></div>

              {/* Top Accent */}
              <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${getAccountTypeColor(acc.type)}`}></div>

              <div className="relative p-4 sm:p-6">
                {/* Type Badge */}
                <div className="flex items-start justify-between mb-3 sm:mb-4">
                  <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full text-[10px] sm:text-xs font-bold bg-gradient-to-r ${getAccountTypeColor(acc.type)} text-white shadow-sm`}>
                    {acc.type === 'SHARED' && <span className="text-[10px] sm:text-xs">{ICONS.Users}</span>}
                    <span className="truncate max-w-[80px] sm:max-w-none">{getAccountTypeLabel(acc.type)}</span>
                  </div>

                  {/* Menu Button */}
                  <button
                    onClick={(e) => handleMenuClick(e, acc)}
                    className="p-1.5 sm:p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg sm:rounded-xl transition-all z-10"
                    aria-label="Действия со счетом"
                  >
                    {ICONS.More}
                  </button>
                </div>

                {/* Account Info */}
                <div className="space-y-3 sm:space-y-4">
                  <div>
                    <h3 className="font-bold text-lg sm:text-xl text-slate-800 mb-1 truncate">{acc.name}</h3>
                    <p className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
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
                              className={`inline-flex h-6 w-6 sm:h-8 sm:w-8 rounded-full ${colors[idx % colors.length]} ring-2 ring-white items-center justify-center text-white text-[10px] sm:text-xs font-bold shadow-sm`}
                              title={investor?.name}
                            >
                              {investor?.name?.charAt(0) || '?'}
                            </div>
                          );
                        })}
                        {(acc.partners.length) > 4 && (
                          <div className="inline-flex h-6 w-6 sm:h-8 sm:w-8 rounded-full bg-slate-100 ring-2 ring-white items-center justify-center text-[10px] sm:text-xs font-bold text-slate-600">
                            +{acc.partners.length - 4}
                          </div>
                        )}
                      </div>
                      <span className="text-[10px] sm:text-xs text-slate-400">{acc.partners.length} участников</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Account Action Modal */}
      {activeMenuAccount && (
        <AccountActionModal
          account={activeMenuAccount}
          balance={accountBalances[activeMenuAccount.id] || 0}
          onClose={() => setActiveMenuAccount(null)}
          onSelectAccount={onSelectAccount}
          onEdit={setEditingAccount}
          onSetMain={onSetMainAccount}
          isManager={isManager}
          onUpdateAccount={onUpdateAccount}
        />
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

          {/* Filters - исправлено для мобильных */}
          <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-100">
            <div className="space-y-3">
              {/* Account Filter - полная ширина на мобильных */}
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">
                  Фильтр по счету
                </label>
                <select
                  className="w-full p-2.5 sm:p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm text-slate-700 font-medium focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition-all"
                  value={profitFilterAccountId}
                  onChange={e => setProfitFilterAccountId(e.target.value)}
                >
                  <option value="ALL">Все счета</option>
                  {accounts.filter(a => a.type !== 'SHARED').map(acc => (
                    <option key={acc.id} value={acc.id}>{acc.name}</option>
                  ))}
                </select>
              </div>

              {/* Date Filters - отдельные строки */}
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">
                    Начало
                  </label>
                  <input
                    type="date"
                    className="w-full p-2.5 sm:p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700 font-medium focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition-all"
                    value={myProfitPeriod.start}
                    onChange={e => setMyProfitPeriod(p => ({...p, start: e.target.value}))}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">
                    Конец
                  </label>
                  <input
                    type="date"
                    className="w-full p-2.5 sm:p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700 font-medium focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition-all"
                    value={myProfitPeriod.end}
                    onChange={e => setMyProfitPeriod(p => ({...p, end: e.target.value}))}
                  />
                </div>
              </div>
            </div>

            {(!myProfitPeriod.start && !myProfitPeriod.end) && (
              <p className="text-[10px] sm:text-xs text-center text-slate-400 bg-slate-50 py-2 rounded-lg mt-3">
                Показаны данные за все время
              </p>
            )}
          </div>

          {/* Stats Cards - адаптивная сетка */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-5">
            <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 p-4 sm:p-6 rounded-xl sm:rounded-2xl">
              <p className="text-xs sm:text-sm font-medium text-indigo-600 mb-1 sm:mb-2">Ожидаемая прибыль</p>
              <p className="text-lg sm:text-2xl font-bold text-indigo-900 break-words">
                {calculatedExpectedProfit.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} ₽
              </p>
              <p className="text-[10px] sm:text-xs text-indigo-500 mt-1 sm:mt-2">С активных договоров</p>
            </div>

            <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 p-4 sm:p-6 rounded-xl sm:rounded-2xl">
              <p className="text-xs sm:text-sm font-medium text-emerald-600 mb-1 sm:mb-2">Полученная прибыль</p>
              <p className="text-lg sm:text-2xl font-bold text-emerald-900 break-words">
                {totalManagerProfitEarned.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} ₽
              </p>
              <p className="text-[10px] sm:text-xs text-emerald-500 mt-1 sm:mt-2">За выбранный период</p>
            </div>

            <div
              onClick={() => setShowProfitDetails(true)}
              className="bg-gradient-to-br from-slate-800 to-slate-900 p-4 sm:p-6 rounded-xl sm:rounded-2xl cursor-pointer hover:from-slate-700 hover:to-slate-800 transition-all transform hover:scale-[1.02] active:scale-[0.98]"
            >
              <p className="text-xs sm:text-sm font-medium text-slate-300 mb-1 sm:mb-2">Доступно к выводу</p>
              <p className="text-lg sm:text-2xl font-bold text-white break-words">
                {managerProfitBalance.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} ₽
              </p>
              <p className="text-[10px] sm:text-xs text-slate-400 mt-1 sm:mt-2">Нажмите для деталей</p>
            </div>
          </div>
        </div>
      )}

      {/* Profit Details Modal */}
      {showProfitDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gradient-to-br from-slate-900/90 to-indigo-900/90 backdrop-blur-sm animate-fade-in" onClick={() => setShowProfitDetails(false)}>
          <div className="bg-white/95 backdrop-blur-sm w-full max-w-md rounded-3xl shadow-2xl flex flex-col max-h-[80vh] border border-white/20" onClick={e => e.stopPropagation()}>
            <div className="p-5 sm:p-6 border-b border-slate-100">
              <h3 className="text-lg sm:text-xl font-bold bg-gradient-to-r from-slate-800 to-indigo-800 bg-clip-text text-transparent">Детализация прибыли</h3>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                Баланс: <span className="font-bold text-emerald-600">{managerProfitBalance.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} ₽</span>
              </p>
            </div>

            <div className="flex border-b border-slate-100 p-1">
              <button
                onClick={() => setProfitDetailsTab('accruals')}
                className={`flex-1 py-2.5 sm:py-3 text-xs sm:text-sm font-semibold rounded-xl transition-all ${
                  profitDetailsTab === 'accruals' 
                    ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-md' 
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Начисления
              </button>
              <button
                onClick={() => setProfitDetailsTab('payouts')}
                className={`flex-1 py-2.5 sm:py-3 text-xs sm:text-sm font-semibold rounded-xl transition-all ${
                  profitDetailsTab === 'payouts' 
                    ? 'bg-gradient-to-r from-red-500 to-red-600 text-white shadow-md' 
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Выплаты
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              {profitDetailsTab === 'accruals' && (
                <div className="space-y-2 animate-fade-in">
                  {managerProfitAccruals.length === 0 ? (
                    <div className="text-center py-6 sm:py-8">
                      <div className="w-12 h-12 sm:w-16 sm:h-16 bg-slate-100 rounded-xl sm:rounded-2xl flex items-center justify-center mx-auto mb-3">
                        <span className="text-xl sm:text-2xl text-slate-400">{ICONS.TrendingUp}</span>
                      </div>
                      <p className="text-sm sm:text-base text-slate-500">Нет начислений за этот период</p>
                    </div>
                  ) : (
                    managerProfitAccruals.map(p => (
                      <div key={p.id} className="flex justify-between items-center p-2.5 sm:p-3 bg-emerald-50 rounded-lg sm:rounded-xl hover:bg-emerald-100 transition-all">
                        <div className="flex-1 min-w-0 mr-2">
                          <p className="font-medium text-slate-800 text-xs sm:text-sm truncate">{p.source}</p>
                          <p className="text-[10px] sm:text-xs text-slate-500">{new Date(p.date).toLocaleDateString('ru-RU')}</p>
                        </div>
                        <span className="font-bold text-emerald-600 text-xs sm:text-sm whitespace-nowrap">
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
                    <div className="text-center py-6 sm:py-8">
                      <div className="w-12 h-12 sm:w-16 sm:h-16 bg-slate-100 rounded-xl sm:rounded-2xl flex items-center justify-center mx-auto mb-3">
                        <span className="text-xl sm:text-2xl text-slate-400">{ICONS.Wallet}</span>
                      </div>
                      <p className="text-sm sm:text-base text-slate-500">Нет выплат за этот период</p>
                    </div>
                  ) : (
                    managerProfitPayouts.map(e => (
                      <div key={e.id} className="flex justify-between items-center p-2.5 sm:p-3 bg-red-50 rounded-lg sm:rounded-xl hover:bg-red-100 transition-all">
                        <div className="flex-1 min-w-0 mr-2">
                          <p className="font-medium text-slate-800 text-xs sm:text-sm truncate">{e.title}</p>
                          <p className="text-[10px] sm:text-xs text-slate-500">{new Date(e.date).toLocaleDateString('ru-RU')}</p>
                        </div>
                        <span className="font-bold text-red-600 text-xs sm:text-sm whitespace-nowrap">
                          -{Number(e.amount).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} ₽
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50">
              <button
                onClick={() => setShowProfitDetails(false)}
                className="w-full py-2.5 sm:py-3.5 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl hover:bg-slate-100 transition-all text-sm sm:text-base"
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
