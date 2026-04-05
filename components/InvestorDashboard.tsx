import React, { useMemo } from 'react';
import { Sale, Expense, Account, Investor, AppSettings } from '../types';
import { ICONS } from '../constants';
import { formatCurrency, formatDate } from '../src/utils';

interface InvestorDashboardProps {
  sales: Sale[];
  expenses: Expense[];
  accounts: Account[];
  investor: Investor;
  appSettings: AppSettings;
  onLogout: () => void;
}

const InvestorDashboard: React.FC<InvestorDashboardProps> = ({
  sales, expenses, accounts, investor, appSettings, onLogout, useEffect
}) => {
  // 🔹 ОТЛАДКА: Проверяем полученные данные
  useEffect(() => {
    console.log('📦 InvestorDashboard received:', {
      investorId: investor.id,
      investorName: investor.name,
      accountsCount: accounts.length,
      accounts: accounts.map(a => ({ id: a.id, ownerId: a.ownerId })),
      salesCount: sales.length,
      expensesCount: expenses.length,
    });
  }, [investor, accounts, sales, expenses]);

  // 🔹 ФИЛЬТРАЦИЯ: Находим счёт инвестора по ownerId
  const investorAccount = useMemo(() => {
    const acc = accounts.find(a => a.ownerId === investor.id);
    console.log('🏦 Found account:', acc
      ? { id: acc.id, ownerId: acc.ownerId, name: acc.name }
      : 'NOT FOUND ❌');
    return acc;
  }, [accounts, investor.id]);

  // 🔹 ФИЛЬТРАЦИЯ: Показываем только продажи этого инвестора
  const investorSales = useMemo(() => {
    if (!investorAccount) return [];
    return sales.filter(s => s.accountId === investorAccount.id);
  }, [sales, investorAccount]);

  // 🔹 ФИЛЬТРАЦИЯ: Показываем только расходы этого инвестора
  const investorExpenses = useMemo(() => {
    if (!investorAccount) return [];
    return expenses.filter(e => e.accountId === investorAccount.id);
  }, [expenses, investorAccount]);

  // 🔹 Баланс: (Взносы + Платежи) - (Выводы инвестора)
  const balance = useMemo(() => {
    const totalIncome = investorSales.reduce((acc, s) => {
      const collected = Number(s.downPayment ?? 0) +
        s.paymentPlan.filter(p => p.isPaid).reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
      return acc + collected;
    }, 0);

    // Вычитаем только возвраты инвестиций этого инвестора
    const investorWithdrawals = investorExpenses
      .filter(e => e.investorId === investor.id && e.payoutType === 'INVESTMENT')
      .reduce<number>((acc, e) => acc + Number(e.amount ?? 0), 0);

    return totalIncome - investorWithdrawals;
  }, [investorSales, investorExpenses, investor.id]);

  // 🔹 Прибыль инвестора (только от его сделок)
  const { expectedProfit, realizedProfit } = useMemo(() => {
    const profitShare = investor.profitPercentage / 100;
    let expected = 0;
    let realized = 0;

    investorSales.forEach(sale => {
      if (sale.buyPrice <= 0 || sale.totalAmount <= sale.buyPrice) return;

      const totalSaleProfit = Number(sale.totalAmount) - Number(sale.buyPrice);
      const margin = sale.totalAmount > 0 ? totalSaleProfit / Number(sale.totalAmount) : 0;

      // Ожидаемая: от остатка по активным сделкам
      if (sale.status === 'ACTIVE') {
        expected += Number(sale.remainingAmount) * margin * profitShare;
      }

      // Полученная: от реально оплаченных сумм
      const collectedAmount = Number(sale.downPayment) +
        sale.paymentPlan.filter(p => p.isPaid).reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
      realized += (collectedAmount * margin) * profitShare;
    });

    return {
      expectedProfit: Math.round(expected * 100) / 100,
      realizedProfit: Math.round(realized * 100) / 100
    };
  }, [investorSales, investor]);

  // 🔹 Выплаты прибыли инвестору
  const profitWithdrawals = useMemo(() =>
    investorExpenses.filter(e => e.investorId === investor.id && e.payoutType === 'PROFIT'),
    [investorExpenses, investor.id]
  );

  // 🔹 Сумма выплаченной прибыли (с корректной типизацией)
  const totalProfitWithdrawn = useMemo(() =>
    profitWithdrawals.reduce<number>((sum, e) => sum + Number(e.amount ?? 0), 0),
    [profitWithdrawals]
  );

  const availableToWithdraw = Math.max(0, realizedProfit - totalProfitWithdrawn);

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      {/* 🔹 Заголовок с кнопкой выхода */}
      <header className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Кабинет инвестора</h2>
          <p className="text-slate-500 text-sm">Ваша статистика и активные сделки</p>
        </div>
        <button
          onClick={onLogout}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-xl transition-colors"
          title="Выйти из аккаунта"
        >
          {ICONS.Logout} Выйти
        </button>
      </header>

      {/* 🔹 Карточки статистики */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">{ICONS.Wallet}</div>
            <h3 className="font-semibold text-slate-700">Текущий баланс</h3>
          </div>
          <p className="text-sm text-slate-500 mb-1">Инвестиции + накопленная прибыль</p>
          <h3 className="text-3xl font-bold text-indigo-600">{formatCurrency(balance, appSettings.showCents)} ₽</h3>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">{ICONS.Income}</div>
            <h3 className="font-semibold text-slate-700">Доступно к выводу</h3>
          </div>
          <p className="text-sm text-slate-500 mb-1">Полученная прибыль минус выплаты</p>
          <h3 className="text-3xl font-bold text-emerald-600">{formatCurrency(availableToWithdraw, appSettings.showCents)} ₽</h3>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-purple-100 text-purple-600 rounded-lg">{ICONS.TrendingUp}</div>
            <h3 className="font-semibold text-slate-700">Ожидаемая прибыль</h3>
          </div>
          <p className="text-sm text-slate-500 mb-1">С активных договоров</p>
          <h3 className="text-3xl font-bold text-purple-600">{formatCurrency(expectedProfit, appSettings.showCents)} ₽</h3>
        </div>
      </div>

      {/* 🔹 Ваши сделки */}
      <div>
        <h3 className="font-bold text-slate-800 text-lg mb-4">
          Ваши профинансированные сделки
          {investorAccount && <span className="text-sm font-normal text-slate-400 ml-2">({investorAccount.name})</span>}
        </h3>

        {investorSales.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400">
            Нет активных операций
          </div>
        ) : (
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {investorSales.map(sale => {
              const progress = sale.totalAmount > 0
                ? ((Number(sale.totalAmount) - Number(sale.remainingAmount)) / Number(sale.totalAmount)) * 100
                : 0;
              const saleProfit = Number(sale.totalAmount) - Number(sale.buyPrice);
              const margin = sale.totalAmount > 0 ? saleProfit / Number(sale.totalAmount) : 0;
              const investorShare = Number(sale.remainingAmount) * margin * (investor.profitPercentage / 100);

              return (
                <div key={sale.id} className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start mb-2">
                      <p className="font-bold text-slate-800 text-lg">{sale.productName}</p>
                      <span className={`text-xs px-2 py-1 rounded-full font-bold ${
                        Number(sale.remainingAmount) === 0 
                          ? 'bg-slate-100 text-slate-600' 
                          : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {Number(sale.remainingAmount) === 0 ? 'ЗАКРЫТО' : 'АКТИВНО'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mb-4">Дата оформления: {formatDate(sale.startDate)}</p>

                    <div className="space-y-2 mb-4">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Сумма продажи:</span>
                        <span className="font-medium">{formatCurrency(sale.totalAmount, appSettings.showCents)} ₽</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Остаток долга:</span>
                        <span className="font-bold text-slate-800">{formatCurrency(sale.remainingAmount, appSettings.showCents)} ₽</span>
                      </div>
                      <div className="flex justify-between text-sm text-emerald-600 font-medium pt-2 border-t border-slate-100">
                        <span>Ваша доля прибыли:</span>
                        <span>{formatCurrency(investorShare, appSettings.showCents)} ₽</span>
                      </div>
                    </div>
                  </div>

                  <div className="w-full bg-slate-100 rounded-full h-1.5 mt-auto">
                    <div className="bg-indigo-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${progress}%` }}></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default InvestorDashboard;