import React, { useState, useMemo } from 'react';
import { Partnership, Investor, Account, Sale, Expense } from '../types';
import { ICONS } from '../constants';

interface PartnersProps {
  partnerships: Partnership[];
  investors: Investor[];
  accounts: Account[];
  sales: Sale[];
  expenses: Expense[];
  onAddPartnership: (name: string, members: string[]) => void;
  onSelectAccount: (accountId: string) => void;
}

const CreatePartnershipModal = ({ onClose, onSubmit, investors }: { onClose: () => void, onSubmit: (name: string, members: string[]) => void, investors: Investor[] }) => {
    const [name, setName] = useState('');
    const [selectedPartners, setSelectedPartners] = useState<string[]>([]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if(!name || selectedPartners.length === 0) {
            alert("Укажите название и выберите хотя бы одного партнера");
            return;
        }
        onSubmit(name, selectedPartners);
    };

    const togglePartner = (id: string) => {
        setSelectedPartners(prev => prev.includes(id) ? prev.filter(pid => pid !== id) : [...prev, id]);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl p-5" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-slate-800 mb-4">Новое партнерство</h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Название предприятия</label>
                        <input autoFocus value={name} onChange={e => setName(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none" placeholder="Например: Цех №1" />
                    </div>
                    
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 max-h-40 overflow-y-auto">
                        <p className="text-xs text-slate-500 font-bold mb-2 uppercase">Участники</p>
                        {investors.length === 0 ? <p className="text-xs text-slate-400">Нет инвесторов</p> : (
                            <div className="space-y-2">
                                {investors.map(inv => (
                                    <label key={inv.id} className="flex items-center gap-2 cursor-pointer hover:bg-slate-100 p-1 rounded">
                                        <input type="checkbox" checked={selectedPartners.includes(inv.id)} onChange={() => togglePartner(inv.id)} className="rounded text-indigo-600 focus:ring-indigo-500" />
                                        <span className="text-sm text-slate-700">{inv.name}</span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex gap-3 mt-4">
                        <button type="button" onClick={onClose} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold">Отмена</button>
                        <button type="submit" className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold">Создать</button>
                    </div>
                </form>
            </div>
        </div>
    )
}

const PartnershipDetail = ({ partnership, accounts, sales, expenses, investors, onClose }: { partnership: Partnership, accounts: Account[], sales: Sale[], expenses: Expense[], investors: Investor[], onClose: () => void }) => {
    
    // Calculate financial stats for this partnership's account
    const stats = useMemo(() => {
        const account = accounts.find(a => a.id === partnership.accountId);
        if (!account) return null;

        const accSales = sales.filter(s => s.accountId === account.id);
        const accExpenses = expenses.filter(e => e.accountId === account.id);

        // 1. Total Assets (Equity) = Cash + Receivables
        let cashBalance = 0;
        accSales.forEach(s => {
            cashBalance += s.downPayment;
            s.paymentPlan.filter(p => p.isPaid).forEach(p => cashBalance += p.amount);
        });
        cashBalance -= accExpenses.reduce((sum, e) => sum + e.amount, 0);

        const receivables = accSales
            .filter(s => s.status === 'ACTIVE')
            .reduce((sum, s) => sum + s.remainingAmount, 0);

        const totalEquity = cashBalance + receivables;

        // 2. Member Stats
        const members = partnership.partnerIds.map(pid => {
            const investor = investors.find(i => i.id === pid);
            
            // Capital Invested: Incomes where customerId == investorId
            const invested = accSales
                .filter(s => s.type === 'CASH' && s.customerId === pid)
                .reduce((sum, s) => sum + s.totalAmount, 0);
            
            // Capital Returned
            const returned = accExpenses
                .filter(e => e.investorId === pid && e.payoutType === 'INVESTMENT')
                .reduce((sum, e) => sum + e.amount, 0);

            const netInvested = Math.max(0, invested - returned);

            return {
                id: pid,
                name: investor?.name || 'Unknown',
                netInvested
            };
        });

        const totalNetInvested = members.reduce((sum, m) => sum + m.netInvested, 0);
        const totalProfit = Math.max(0, totalEquity - totalNetInvested);

        return {
            accountName: account.name,
            cashBalance,
            receivables,
            totalEquity,
            totalNetInvested,
            totalProfit,
            members
        };

    }, [partnership, accounts, sales, expenses, investors]);

    if (!stats) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                    <div>
                        <h3 className="text-xl font-bold text-slate-800">{partnership.name}</h3>
                        <p className="text-xs text-slate-500">Счет: {stats.accountName}</p>
                    </div>
                    <button onClick={onClose} className="p-2 bg-white rounded-full text-slate-400 hover:text-slate-600 shadow-sm">
                        {ICONS.Close}
                    </button>
                </div>

                <div className="p-5 space-y-5 overflow-y-auto">
                    {/* Key Metrics */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                            <p className="text-xs font-bold text-indigo-700 uppercase mb-1">Активы (Equity)</p>
                            <p className="text-2xl font-bold text-indigo-900">{stats.totalEquity.toLocaleString()} ₽</p>
                            <p className="text-[10px] text-indigo-500 mt-1">Кэш + Долги клиентов</p>
                        </div>
                        <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100">
                            <p className="text-xs font-bold text-emerald-700 uppercase mb-1">Прибыль</p>
                            <p className="text-2xl font-bold text-emerald-900">+{stats.totalProfit.toLocaleString()} ₽</p>
                            <p className="text-[10px] text-emerald-500 mt-1">Активы - Вложения</p>
                        </div>
                    </div>

                    <div className="flex gap-2 text-xs text-slate-500 bg-slate-50 p-3 rounded-lg">
                        <span className="font-medium">Касса: <span className="text-slate-800">{stats.cashBalance.toLocaleString()} ₽</span></span>
                        <span>•</span>
                        <span className="font-medium">В товаре: <span className="text-slate-800">{stats.receivables.toLocaleString()} ₽</span></span>
                    </div>

                    {/* Breakdown */}
                    <div>
                        <h4 className="font-bold text-slate-700 mb-3 text-sm">Доли участия</h4>
                        <div className="space-y-3">
                            {stats.members.map(m => {
                                const sharePercent = stats.totalNetInvested > 0 ? (m.netInvested / stats.totalNetInvested) * 100 : 0;
                                const valueShare = stats.totalEquity * (sharePercent / 100);
                                const profitShare = Math.max(0, valueShare - m.netInvested);

                                return (
                                    <div key={m.id} className="bg-white border border-slate-200 p-3 rounded-xl shadow-sm">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="font-bold text-slate-800">{m.name}</span>
                                            <span className="bg-slate-100 text-slate-600 text-xs px-2 py-1 rounded-full font-bold">{sharePercent.toFixed(1)}%</span>
                                        </div>
                                        <div className="w-full bg-slate-100 h-1.5 rounded-full mb-3 overflow-hidden">
                                            <div className="bg-slate-800 h-full rounded-full" style={{width: `${sharePercent}%`}}></div>
                                        </div>
                                        <div className="grid grid-cols-2 text-xs gap-2">
                                            <div>
                                                <span className="text-slate-400 block">Вложено</span>
                                                <span className="font-medium">{m.netInvested.toLocaleString()} ₽</span>
                                            </div>
                                            <div className="text-right">
                                                <span className="text-slate-400 block">Текущая стоимость</span>
                                                <span className="font-bold text-slate-700">{Math.round(valueShare).toLocaleString()} ₽</span>
                                            </div>
                                        </div>
                                        {profitShare > 0 && (
                                            <div className="mt-2 pt-2 border-t border-slate-50 flex justify-between text-xs">
                                                <span className="text-emerald-600 font-medium">Прибыль</span>
                                                <span className="font-bold text-emerald-600">+{Math.round(profitShare).toLocaleString()} ₽</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

const Partners: React.FC<PartnersProps> = ({ 
    partnerships, investors, accounts, sales, expenses, onAddPartnership, onSelectAccount 
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [selectedPartnership, setSelectedPartnership] = useState<Partnership | null>(null);

  const partnershipStats = useMemo(() => {
      return partnerships.map(p => {
          const account = accounts.find(a => a.id === p.accountId);
          let balance = 0;
          if (account) {
              const accSales = sales.filter(s => s.accountId === account.id);
              const accExpenses = expenses.filter(e => e.accountId === account.id);
              accSales.forEach(s => {
                  balance += s.downPayment;
                  s.paymentPlan.filter(x => x.isPaid).forEach(x => balance += x.amount);
              });
              accExpenses.forEach(e => balance -= e.amount);
          }
          return { ...p, balance };
      });
  }, [partnerships, accounts, sales, expenses]);

  return (
    <div className="space-y-6 pb-20 animate-fade-in">
      <header className="flex justify-between items-center">
        <div>
            <h2 className="text-2xl font-bold text-slate-800">Партнеры</h2>
            <p className="text-slate-500 text-sm">Совместные предприятия</p>
        </div>
        <button 
            onClick={() => setIsAdding(true)}
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-medium shadow-lg shadow-indigo-200"
        >
            {ICONS.AddSmall} Новое
        </button>
      </header>

      {isAdding && (
          <CreatePartnershipModal 
            onClose={() => setIsAdding(false)} 
            onSubmit={(name, members) => { onAddPartnership(name, members); setIsAdding(false); }} 
            investors={investors} 
          />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {partnershipStats.length === 0 && <div className="col-span-full text-center py-12 text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200">Нет активных партнерств</div>}
          
          {partnershipStats.map(p => (
              <div key={p.id} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 relative overflow-hidden">
                  <div className="flex justify-between items-start mb-4">
                      <div>
                          <h3 className="font-bold text-lg text-slate-800">{p.name}</h3>
                          <p className="text-xs text-slate-500">{new Date(p.createdAt).toLocaleDateString()}</p>
                      </div>
                      <div className="bg-slate-100 p-2 rounded-lg text-slate-600">
                          {ICONS.Partners}
                      </div>
                  </div>

                  <div className="mb-4">
                      <p className="text-xs text-slate-400 uppercase font-bold mb-1">Баланс счета</p>
                      <p className="text-2xl font-bold text-indigo-600">{p.balance.toLocaleString()} ₽</p>
                  </div>

                  <div className="flex -space-x-2 overflow-hidden mb-4">
                        {p.partnerIds.slice(0, 5).map(pid => (
                            <div key={pid} className="inline-block h-8 w-8 rounded-full ring-2 ring-white bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600" title={investors.find(i => i.id === pid)?.name}>
                                {investors.find(i => i.id === pid)?.name.charAt(0)}
                            </div>
                        ))}
                        {p.partnerIds.length > 5 && (
                            <div className="inline-block h-8 w-8 rounded-full ring-2 ring-white bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500">
                                +{p.partnerIds.length - 5}
                            </div>
                        )}
                  </div>

                  <div className="flex gap-2">
                      <button onClick={() => setSelectedPartnership(p)} className="flex-1 py-2 bg-slate-50 text-slate-700 font-semibold rounded-lg hover:bg-slate-100 transition-colors text-sm">
                          Аналитика
                      </button>
                      <button onClick={() => onSelectAccount(p.accountId)} className="flex-1 py-2 bg-indigo-50 text-indigo-700 font-semibold rounded-lg hover:bg-indigo-100 transition-colors text-sm">
                          Операции
                      </button>
                  </div>
              </div>
          ))}
      </div>

      {selectedPartnership && (
          <PartnershipDetail 
            partnership={selectedPartnership}
            accounts={accounts}
            sales={sales}
            expenses={expenses}
            investors={investors}
            onClose={() => setSelectedPartnership(null)}
          />
      )}
    </div>
  );
};

export default Partners;