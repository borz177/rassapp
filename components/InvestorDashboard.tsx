import React, { useMemo } from 'react';
import { Sale, Expense, Account, Investor } from '../types';
import { ICONS } from '../constants';

interface InvestorDashboardProps {
  sales: Sale[];
  expenses: Expense[];
  accounts: Account[];
  investor: Investor;
}

const InvestorDashboard: React.FC<InvestorDashboardProps> = ({ sales, expenses, accounts, investor }) => {
  // Calculate Balance: (DownPayments + Collected Payments) - Expenses (Withdrawals)
  const balance = useMemo(() => {
      const totalIncome = sales.reduce((acc, s) => {
          const collected = s.downPayment + s.paymentPlan.filter(p => p.isPaid).reduce((sum, p) => sum + p.amount, 0);
          return acc + collected;
      }, 0);
      
      const totalExpenses = expenses.reduce((acc, e) => acc + e.amount, 0);
      return totalIncome - totalExpenses;
  }, [sales, expenses]);

  const { expectedProfit, realizedProfit } = useMemo(() => {
      const profitShare = investor.profitPercentage / 100;
      let expected = 0;
      let realized = 0;

      sales.forEach(sale => {
          if (sale.buyPrice <= 0 || sale.totalAmount <= sale.buyPrice) return;

          const totalSaleProfit = sale.totalAmount - sale.buyPrice;
          const margin = totalSaleProfit / sale.totalAmount;

          // Expected Profit (from Active sales)
          if (sale.status === 'ACTIVE') {
              expected += totalSaleProfit * profitShare;
          }

          // Realized Profit (from paid portions)
          const collectedAmount = sale.downPayment + sale.paymentPlan.filter(p => p.isPaid).reduce((sum, p) => sum + p.amount, 0);
          realized += (collectedAmount * margin) * profitShare;
      });

      return { expectedProfit: expected, realizedProfit: realized };
  }, [sales, investor]);

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <header className="mb-4">
        <h2 className="text-2xl font-bold text-slate-800">Кабинет инвестора</h2>
        <p className="text-slate-500 text-sm">Ваша статистика и активные сделки</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">{ICONS.Wallet}</div>
                <h3 className="font-semibold text-slate-700">Текущий баланс</h3>
            </div>
            <p className="text-sm text-slate-500 mb-1">Инвестиции + Накопленная прибыль</p>
            <h3 className="text-3xl font-bold text-indigo-600">{balance.toLocaleString()} ₽</h3>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">{ICONS.Income}</div>
                <h3 className="font-semibold text-slate-700">Полученная прибыль</h3>
            </div>
            <p className="text-sm text-slate-500 mb-1">Фактически заработано</p>
            <h3 className="text-3xl font-bold text-emerald-600">{realizedProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })} ₽</h3>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-purple-100 text-purple-600 rounded-lg">{ICONS.TrendingUp}</div>
                <h3 className="font-semibold text-slate-700">Ожидаемая прибыль</h3>
            </div>
            <p className="text-sm text-slate-500 mb-1">С активных договоров</p>
            <h3 className="text-3xl font-bold text-purple-600">{expectedProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })} ₽</h3>
          </div>
      </div>

      <div>
        <h3 className="font-bold text-slate-800 text-lg mb-4">Ваши профинансированные сделки</h3>
        {sales.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400">
                Нет активных операций
            </div>
        ) : (
            <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                {sales.map(sale => {
                     const progress = sale.totalAmount > 0 ? ((sale.totalAmount - sale.remainingAmount) / sale.totalAmount) * 100 : 0;
                     return (
                        <div key={sale.id} className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-between">
                            <div>
                                <div className="flex justify-between items-start mb-2">
                                    <p className="font-bold text-slate-800 text-lg">{sale.productName}</p>
                                    <span className={`text-xs px-2 py-1 rounded-full font-bold ${sale.remainingAmount === 0 ? 'bg-slate-100 text-slate-600' : 'bg-emerald-100 text-emerald-700'}`}>
                                        {sale.remainingAmount === 0 ? 'ЗАКРЫТО' : 'АКТИВНО'}
                                    </span>
                                </div>
                                <p className="text-xs text-slate-500 mb-4">Дата оформления: {new Date(sale.startDate).toLocaleDateString()}</p>
                                
                                <div className="space-y-2 mb-4">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-500">Сумма продажи:</span>
                                        <span className="font-medium">{sale.totalAmount.toLocaleString()} ₽</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-500">Остаток долга:</span>
                                        <span className="font-bold text-slate-800">{sale.remainingAmount.toLocaleString()} ₽</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="w-full bg-slate-100 rounded-full h-1.5 mt-auto">
                                <div className="bg-indigo-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${progress}%` }}></div>
                            </div>
                        </div>
                     )
                })}
            </div>
        )}
      </div>
    </div>
  );
};

export default InvestorDashboard;