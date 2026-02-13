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
        if(!name) return;
        onSubmit(name, type, type === 'SHARED' ? selectedPartners : undefined);
    };

    const togglePartner = (id: string) => {
        setSelectedPartners(prev => prev.includes(id) ? prev.filter(pid => pid !== id) : [...prev, id]);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl p-5" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-slate-800 mb-4">Новый счет</h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Название</label>
                        <input autoFocus value={name} onChange={e => setName(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none" placeholder="Например: Общий котел" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Тип счета</label>
                        <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
                            <button type="button" onClick={() => setType('CUSTOM')} className={`flex-1 py-2 text-xs font-bold rounded-lg ${type === 'CUSTOM' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}>Личный</button>
                            <button type="button" onClick={() => setType('SHARED')} className={`flex-1 py-2 text-xs font-bold rounded-lg ${type === 'SHARED' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>Общий</button>
                        </div>
                    </div>
                    
                    {type === 'SHARED' && (
                        <div className="bg-indigo-50 p-3 rounded-xl border border-indigo-100 max-h-40 overflow-y-auto">
                            <p className="text-xs text-indigo-700 font-bold mb-2">Выберите партнеров:</p>
                            {investors.length === 0 ? <p className="text-xs text-slate-400">Нет инвесторов</p> : (
                                <div className="space-y-2">
                                    {investors.map(inv => (
                                        <label key={inv.id} className="flex items-center gap-2 cursor-pointer">
                                            <input type="checkbox" checked={selectedPartners.includes(inv.id)} onChange={() => togglePartner(inv.id)} className="rounded text-indigo-600 focus:ring-indigo-500" />
                                            <span className="text-sm text-slate-700">{inv.name}</span>
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="flex gap-3 mt-4">
                        <button type="button" onClick={onClose} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold">Отмена</button>
                        <button type="submit" className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold">Создать</button>
                    </div>
                </form>
            </div>
        </div>
    )
}

const SharedAccountDetails = ({ account, sales, expenses, investors, onClose }: { account: Account, sales: Sale[], expenses: Expense[], investors: Investor[], onClose: () => void }) => {
    // 1. Calculate Account Total Value (Cash + Receivables)
    const accountSales = sales.filter(s => s.accountId === account.id);
    const accountExpenses = expenses.filter(e => e.accountId === account.id);
    
    // Cash Balance
    let cashBalance = 0;
    accountSales.forEach(s => {
        cashBalance += s.downPayment;
        s.paymentPlan.filter(p => p.isPaid).forEach(p => cashBalance += p.amount);
    });
    cashBalance -= accountExpenses.reduce((sum, e) => sum + e.amount, 0);

    // Receivables (Active Debt)
    const receivables = accountSales
        .filter(s => s.status === 'ACTIVE')
        .reduce((sum, s) => sum + s.remainingAmount, 0);

    const totalAccountEquity = cashBalance + receivables;

    // 2. Calculate Partner Contributions (Net Capital)
    // Deposit: Sale type CASH, customerId == investorId
    // Withdrawal: Expense type INVESTOR_WITHDRAWAL, investorId == investorId
    const partnerStats = (account.partners || []).map(partnerId => {
        const investor = investors.find(i => i.id === partnerId);
        
        // Deposits (Income into account tagged with investor)
        // In NewIncome, INVESTOR_DEPOSIT sets customerId = investorId and type=CASH (actually type is mapped to CASH in app logic but let's check Sale structure)
        // App.tsx handleIncomeSubmit: customerId: data.investorId, type: 'CASH'
        const deposits = accountSales
            .filter(s => s.type === 'CASH' && s.customerId === partnerId)
            .reduce((sum, s) => sum + s.totalAmount, 0);

        // Withdrawals (Capital Return)
        // Only count capital return, not profit payout, for "Net Invested Capital" calculation?
        // Actually, for simple equity share: Share = (Deposits - CapitalWithdrawals) / TotalNetDeposits
        const withdrawals = accountExpenses
            .filter(e => e.investorId === partnerId && e.payoutType === 'INVESTMENT')
            .reduce((sum, e) => sum + e.amount, 0);
        
        const profitWithdrawals = accountExpenses
            .filter(e => e.investorId === partnerId && e.payoutType === 'PROFIT')
            .reduce((sum, e) => sum + e.amount, 0);

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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b border-slate-200 bg-indigo-50">
                    <h3 className="text-lg font-bold text-slate-800">{account.name}</h3>
                    <p className="text-xs text-indigo-600 font-bold uppercase tracking-wider">Совместный счет</p>
                </div>
                
                <div className="p-5 space-y-4 overflow-y-auto">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white border border-slate-200 p-3 rounded-xl shadow-sm">
                            <p className="text-xs text-slate-500">Кэш в кассе</p>
                            <p className="text-xl font-bold text-emerald-600">{cashBalance.toLocaleString()} ₽</p>
                        </div>
                        <div className="bg-white border border-slate-200 p-3 rounded-xl shadow-sm">
                            <p className="text-xs text-slate-500">В товаре (Долги)</p>
                            <p className="text-xl font-bold text-amber-600">{receivables.toLocaleString()} ₽</p>
                        </div>
                    </div>
                    
                    <div className="bg-slate-800 text-white p-4 rounded-xl">
                        <div className="flex justify-between items-end mb-1">
                            <span className="text-slate-400 text-sm">Общая стоимость активов</span>
                            <span className="text-2xl font-bold">{totalAccountEquity.toLocaleString()} ₽</span>
                        </div>
                        <div className="flex justify-between text-xs text-slate-400 border-t border-slate-700 pt-2 mt-2">
                             <span>Вложено: {totalNetCapital.toLocaleString()} ₽</span>
                             <span className="text-emerald-400">Прибыль: +{totalProfitGenerated.toLocaleString()} ₽</span>
                        </div>
                    </div>

                    <div>
                        <h4 className="font-bold text-slate-700 mb-3 text-sm">Распределение долей</h4>
                        <div className="space-y-3">
                            {partnerStats.length === 0 ? <p className="text-center text-slate-400 text-xs">Нет активных партнеров</p> : 
                            partnerStats.map(p => {
                                const sharePercent = totalNetCapital > 0 ? (p.netCapital / totalNetCapital) * 100 : 0;
                                const equityValue = totalAccountEquity * (sharePercent / 100);
                                const profitShare = Math.max(0, equityValue - p.netCapital);

                                return (
                                    <div key={p.id} className="bg-white border border-slate-100 p-3 rounded-xl shadow-sm">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="font-bold text-slate-800 text-sm">{p.name}</span>
                                            <span className="bg-indigo-100 text-indigo-700 text-xs px-2 py-1 rounded-full font-bold">{sharePercent.toFixed(1)}%</span>
                                        </div>
                                        <div className="w-full bg-slate-100 h-1.5 rounded-full mb-3 overflow-hidden">
                                            <div className="bg-indigo-500 h-full rounded-full" style={{width: `${sharePercent}%`}}></div>
                                        </div>
                                        <div className="grid grid-cols-2 text-xs gap-2">
                                            <div><span className="text-slate-400 block">Вложено</span><span className="font-medium">{p.netCapital.toLocaleString()} ₽</span></div>
                                            <div className="text-right"><span className="text-slate-400 block">Доля в активах</span><span className="font-bold text-slate-700">{Math.round(equityValue).toLocaleString()} ₽</span></div>
                                        </div>
                                        {profitShare > 0 && (
                                            <div className="mt-2 pt-2 border-t border-slate-50 flex justify-between text-xs">
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

                <div className="p-4 border-t border-slate-200 bg-slate-50">
                    <button onClick={onClose} className="w-full py-3 bg-white border border-slate-300 text-slate-700 font-bold rounded-xl hover:bg-slate-50">Закрыть</button>
                </div>
            </div>
        </div>
    );
};

const CashRegister: React.FC<CashRegisterProps> = ({ 
    accounts, sales, expenses, investors, onAddAccount, onAction, onSelectAccount, onSetMainAccount,
    isManager, totalExpectedProfit, realizedPeriodProfit, myProfitPeriod, setMyProfitPeriod
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [selectedSharedAccount, setSelectedSharedAccount] = useState<Account | null>(null);

  const [showProfitDetails, setShowProfitDetails] = useState(false);
  const [profitDetailsTab, setProfitDetailsTab] = useState<'accruals' | 'payouts'>('accruals');

  const accountBalances = useMemo(() => {
    const balances: Record<string, number> = {};

    accounts.forEach(acc => {
      let total = 0;
      
      const accountSales = sales.filter(s => s.accountId === acc.id);
      accountSales.forEach(s => {
          total += s.downPayment;
          s.paymentPlan.filter(p => p.isPaid).forEach(p => total += p.amount);
      });
      
      const accountExpenses = expenses.filter(e => e.accountId === acc.id);
      total -= accountExpenses.reduce((sum, e) => sum + e.amount, 0);

      balances[acc.id] = total;
    });

    return balances;
  }, [accounts, sales, expenses]);

  const { managerProfitAccruals, managerProfitPayouts, totalManagerProfitEarned, totalManagerProfitWithdrawn } = useMemo(() => {
    const accruals: {id: string, date: string, amount: number, source: string}[] = [];

    sales.forEach(sale => {
        if (sale.buyPrice <= 0 || sale.totalAmount <= sale.buyPrice) return;

        const totalSaleProfit = sale.totalAmount - sale.buyPrice;
        const profitMargin = totalSaleProfit / sale.totalAmount;
        
        const account = accounts.find(a => a.id === sale.accountId);
        
        // Skip profit calc for Shared Accounts in "My Profit" view (calculated separately in Shared View)
        // Or treat manager as 100% owner if not investor? 
        // For simplicity, Manager Profit View currently tracks accounts where he is owner.
        // If it is a SHARED account, the manager might be one of the partners.
        // Let's keep existing logic for MAIN/CUSTOM/INVESTOR accounts.
        
        let managerProfitSharePercent = 1.0;
        if (account?.type === 'INVESTOR' && account.ownerId) {
            const investor = investors.find(i => i.id === account.ownerId);
            if (investor) {
                managerProfitSharePercent = (100 - investor.profitPercentage) / 100;
            }
        } else if (account?.type === 'SHARED') {
            // For shared accounts, "My Profit" logic is complex because it depends on dynamic share.
            // We'll exclude SHARED accounts from the general "My Profit" dashboard widget to avoid confusion,
            // relying on the specific SharedAccountDetails modal for that info.
            return;
        }

        const allPayments = [
            { date: sale.startDate, amount: sale.downPayment, id: `${sale.id}_dp` },
            ...sale.paymentPlan.filter(p => p.isPaid)
        ];
        
        allPayments.forEach(p => {
            if (p.amount > 0) {
                const profitFromPayment = p.amount * profitMargin;
                const managerShare = profitFromPayment * managerProfitSharePercent;
                if(managerShare > 0) {
                    accruals.push({
                        id: p.id,
                        date: p.date,
                        amount: managerShare,
                        source: `Платеж по '${sale.productName}'`
                    });
                }
            }
        });
    });

    const payouts = expenses
        .filter(e => e.category === 'Моя выплата')
        .sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    const totalEarned = accruals.reduce((sum, item) => sum + item.amount, 0);
    const totalWithdrawn = payouts.reduce((sum, item) => sum + item.amount, 0);

    return {
        managerProfitAccruals: accruals.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        managerProfitPayouts: payouts,
        totalManagerProfitEarned: totalEarned,
        totalManagerProfitWithdrawn: totalWithdrawn
    };
  }, [sales, expenses, accounts, investors]);

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

  const handleAccountClick = (acc: Account) => {
      if (acc.type === 'SHARED') {
          setSelectedSharedAccount(acc);
      } else {
          onSelectAccount(acc.id);
      }
  }

  return (
    <div className="space-y-6 animate-fade-in pb-20 w-full">
      <header className="flex justify-between items-center">
        <div>
            <h2 className="text-2xl font-bold text-slate-800">Касса и Счета</h2>
            <p className="text-slate-500 text-sm">Управление финансами</p>
        </div>
      </header>
      
      <div className="flex justify-between items-center pt-4">
        <h3 className="font-bold text-slate-700">Мои Счета</h3>
        {isManager && (
            <button 
                onClick={() => setIsAdding(true)}
                className="text-indigo-600 bg-indigo-50 px-3 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-100"
            >
                + Новый счет
            </button>
        )}
      </div>

      {isAdding && (
          <CreateAccountModal 
            onClose={() => setIsAdding(false)} 
            onSubmit={handleCreateAccount} 
            investors={investors}
          />
      )}

      {/* Account Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {accounts.map(acc => (
          <div 
            key={acc.id} 
            className="bg-white p-5 rounded-2xl shadow-sm relative overflow-hidden group hover:shadow-md transition-all flex flex-col"
          >
            <div 
                onClick={() => handleAccountClick(acc)}
                className="flex-1 cursor-pointer"
            >
                {acc.type === 'MAIN' && (
                    <span className="absolute top-3 right-3 bg-indigo-100 text-indigo-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
                        ОСНОВНОЙ
                    </span>
                )}
                {acc.type === 'SHARED' && (
                    <span className="absolute top-3 right-3 bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                        {ICONS.Users} ОБЩИЙ
                    </span>
                )}
                <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                   <div className="scale-150 text-indigo-600">{ICONS.Wallet}</div>
                </div>
                <div className="relative z-10">
                    <p className="text-sm font-medium text-slate-500 mb-1 flex items-center gap-1">
                        {getAccountTypeLabel(acc.type)}
                        <span className="text-indigo-400">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                        </span>
                    </p>
                    <h3 className="font-bold text-slate-800 text-lg">{acc.name}</h3>
                    <p className="text-2xl font-bold text-indigo-600 mt-2">
                        {(accountBalances[acc.id] || 0).toLocaleString()} ₽
                    </p>
                    {acc.type === 'SHARED' && (
                        <div className="mt-2 flex -space-x-2 overflow-hidden">
                            {acc.partners?.slice(0, 4).map((pid, idx) => (
                                <div key={pid} className="inline-block h-6 w-6 rounded-full ring-2 ring-white bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-500">
                                    {investors.find(i => i.id === pid)?.name.charAt(0)}
                                </div>
                            ))}
                            {(acc.partners?.length || 0) > 4 && (
                                <div className="inline-block h-6 w-6 rounded-full ring-2 ring-white bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500">
                                    +{(acc.partners?.length || 0) - 4}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
            {isManager && accounts.length > 1 && acc.type !== 'MAIN' && (
                <div className="flex gap-2 mt-4">
                     <button
                        onClick={(e) => { e.stopPropagation(); onSetMainAccount(acc.id); }}
                        className="flex-1 bg-slate-50 text-slate-600 text-xs font-semibold rounded-lg hover:bg-slate-100 py-2 transition-colors"
                    >
                        Сделать основным
                    </button>
                    {acc.type === 'SHARED' ? (
                        <button
                            onClick={(e) => { e.stopPropagation(); onSelectAccount(acc.id); }}
                            className="flex-1 bg-indigo-50 text-indigo-600 text-xs font-semibold rounded-lg hover:bg-indigo-100 py-2 transition-colors"
                        >
                            Операции
                        </button>
                    ) : null}
                </div>
            )}
          </div>
        ))}
      </div>

      {isManager && (
        <div className="space-y-4 pt-4 border-t border-slate-100 mt-6">
            <h3 className="font-bold text-slate-800 px-1">Моя прибыль (Личные счета)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
                    <h3 className="font-bold text-sm text-slate-800 mb-1">Общая ожидаемая прибыль</h3>
                    <p className="text-xs text-slate-500 mb-2">С активных договоров</p>
                    <p className="text-2xl font-bold text-indigo-800">{totalExpectedProfit.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} ₽</p>
                </div>
                <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
                    <h3 className="font-bold text-sm text-slate-800 mb-1">Полученная прибыль</h3>
                    <p className="text-xs text-slate-500 mb-2">За выбранный период</p>
                    <p className="text-2xl font-bold text-emerald-800">{realizedPeriodProfit.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} ₽</p>
                </div>
                 <div onClick={() => setShowProfitDetails(true)} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 cursor-pointer hover:bg-slate-50">
                    <h3 className="font-bold text-sm text-slate-800 mb-1">Полученная прибыль</h3>
                    <p className="text-xs text-slate-500 mb-2">Общий баланс</p>
                    <p className="text-2xl font-bold text-emerald-800">{managerProfitBalance.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} ₽</p>
                </div>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 grid grid-cols-2 gap-3">
                <div>
                    <label className="text-xs text-slate-500 mb-1 block">Начало</label>
                    <input 
                        type="date" 
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-900 font-medium" 
                        value={myProfitPeriod.start} 
                        onChange={e => setMyProfitPeriod(p => ({...p, start: e.target.value}))} 
                    />
                </div>
                <div>
                    <label className="text-xs text-slate-500 mb-1 block">Конец</label>
                    <input 
                        type="date" 
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-900 font-medium" 
                        value={myProfitPeriod.end} 
                        onChange={e => setMyProfitPeriod(p => ({...p, end: e.target.value}))} 
                    />
                </div>
            </div>
        </div>
      )}

       {showProfitDetails && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={() => setShowProfitDetails(false)}>
              <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
                  <div className="p-5 border-b border-slate-200"><h3 className="text-lg font-bold text-slate-800">Детализация моей прибыли</h3><p className="text-sm text-slate-500">Общий баланс: <span className="font-bold text-emerald-600">{managerProfitBalance.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} ₽</span></p></div>
                  
                  <div className="flex border-b border-slate-200 px-2">
                      <button onClick={() => setProfitDetailsTab('accruals')} className={`flex-1 py-3 text-sm font-semibold transition-colors ${profitDetailsTab === 'accruals' ? 'text-emerald-600 border-b-2 border-emerald-600' : 'text-slate-500'}`}>Начисления</button>
                      <button onClick={() => setProfitDetailsTab('payouts')} className={`flex-1 py-3 text-sm font-semibold transition-colors ${profitDetailsTab === 'payouts' ? 'text-red-600 border-b-2 border-red-600' : 'text-slate-500'}`}>Выплаты</button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-5">
                      {profitDetailsTab === 'accruals' && (
                          <div className="animate-fade-in space-y-2">
                              {managerProfitAccruals.length === 0 ? <p className="text-center text-slate-400 py-4">Начислений нет</p> : managerProfitAccruals.map(p => (
                                  <div key={p.id} className="flex justify-between items-center text-sm p-2 bg-emerald-50 rounded-lg">
                                      <div className="flex flex-col"><span className="text-slate-800">{p.source}</span><span className="text-xs text-slate-400">{new Date(p.date).toLocaleDateString()}</span></div>
                                      <span className="font-bold text-emerald-600">+{ p.amount.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} ₽</span>
                                  </div>
                              ))}
                          </div>
                      )}
                      {profitDetailsTab === 'payouts' && (
                           <div className="animate-fade-in space-y-2">
                              {managerProfitPayouts.length === 0 ? <p className="text-center text-slate-400 py-4">Выплат нет</p> : managerProfitPayouts.map(e => (
                                  <div key={e.id} className="flex justify-between items-center text-sm p-2 bg-red-50 rounded-lg">
                                      <div className="flex flex-col"><span className="text-slate-800">{e.title}</span><span className="text-xs text-slate-400">{new Date(e.date).toLocaleDateString()}</span></div>
                                      <span className="font-bold text-red-600">-{e.amount.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} ₽</span>
                                  </div>
                              ))}
                          </div>
                      )}
                  </div>
                  <div className="p-4 border-t border-slate-100"><button onClick={() => setShowProfitDetails(false)} className="w-full py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200">Закрыть</button></div>
              </div>
          </div>
      )}

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