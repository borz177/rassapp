import React, { useMemo, useState } from 'react';
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
  sales, expenses, accounts, investor, appSettings, onLogout
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'contracts'>('overview');

  // 🔹 ФИЛЬТРАЦИЯ: Находим счёт инвестора по ownerId
  const investorAccount = useMemo(() => {
    return accounts.find(a => a.ownerId === investor.id);
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

  // 🔹 СТАТИСТИКА: Как у менеджера
  const stats = useMemo(() => {
    let totalCollected = 0;
    let totalOutstanding = 0;
    let totalSalesAmount = 0;

    investorSales.forEach(sale => {
      // Исключаем системные транзакции
      if (!sale.customerId.startsWith('system_')) {
        const collected = sale.downPayment +
          sale.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false)
            .reduce((sum, p) => sum + p.amount, 0);

        totalCollected += collected;
        totalOutstanding += sale.remainingAmount;
        totalSalesAmount += sale.totalAmount;
      }
    });

    const workingCapital = totalCollected + totalOutstanding;

    return {
      totalCollected,
      totalOutstanding,
      workingCapital,
      totalSalesAmount
    };
  }, [investorSales]);

  // 🔹 ПРИБЫЛЬ: Как у менеджера
  const profitStats = useMemo(() => {
    const profitShare = investor.profitPercentage / 100;
    let receivedProfit = 0;
    let expectedProfit = 0;

    investorSales.forEach(sale => {
      if (sale.customerId.startsWith('system_')) return;
      if (!sale.buyPrice || sale.buyPrice <= 0) return;

      const totalSaleProfit = sale.totalAmount - sale.buyPrice;
      if (totalSaleProfit <= 0) return;

      const profitMargin = totalSaleProfit / sale.totalAmount;

      // Полученная прибыль (от оплаченных сумм)
      const collectedPayments = sale.downPayment +
        sale.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false)
          .reduce((sum, p) => sum + p.amount, 0);

      receivedProfit += collectedPayments * profitMargin * profitShare;

      // Ожидаемая прибыль (от остатка)
      if (sale.status === 'ACTIVE' || sale.status === 'DRAFT') {
        expectedProfit += sale.remainingAmount * profitMargin * profitShare;
      }
    });

    return {
      receivedProfit: Math.round(receivedProfit * 100) / 100,
      expectedProfit: Math.round(expectedProfit * 100) / 100
    };
  }, [investorSales, investor.profitPercentage]);

  // 🔹 БАЛАНС: (Взносы + Платежи) - (Выводы инвестора)
  const balance = useMemo(() => {
    const totalIncome = stats.totalCollected;
    const investorWithdrawals = investorExpenses
      .filter(e => e.investorId === investor.id && e.payoutType === 'INVESTMENT')
      .reduce<number>((acc, e) => acc + Number(e.amount ?? 0), 0);

    return totalIncome - investorWithdrawals;
  }, [stats.totalCollected, investorExpenses, investor.id]);

  // 🔹 Выплаты прибыли инвестору
  const profitWithdrawals = useMemo(() =>
    investorExpenses.filter(e => e.investorId === investor.id && e.payoutType === 'PROFIT'),
    [investorExpenses, investor.id]
  );

  const totalProfitWithdrawn = profitWithdrawals.reduce<number>((sum, e) =>
    sum + Number(e.amount ?? 0), 0
  );

  const availableToWithdraw = Math.max(0, profitStats.receivedProfit - totalProfitWithdrawn);

  // 🔹 Последние 5 договоров
  const lastFiveSales = useMemo(() => {
    return [...investorSales]
      .filter(s => !s.customerId.startsWith('system_'))
      .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())
      .slice(0, 5);
  }, [investorSales]);

  // 🔹 Ближайшие платежи
  const upcomingPayments = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const payments: { sale: Sale, customerName: string, amount: number, date: string, isOverdue: boolean }[] = [];

    investorSales.forEach(sale => {
      if (sale.status !== 'ACTIVE' && sale.status !== 'DRAFT') return;

      sale.paymentPlan.forEach(payment => {
        if (payment.isPaid || !payment.isRealPayment === false) {
          const paymentDate = new Date(payment.date);
          const isOverdue = paymentDate < today && !payment.isPaid;
          const isToday = paymentDate.toDateString() === today.toDateString();
          const isTomorrow = paymentDate.toDateString() === tomorrow.toDateString();

          if (isToday || isTomorrow || isOverdue) {
            payments.push({
              sale,
              customerName: sale.productName,
              amount: payment.amount,
              date: payment.date,
              isOverdue
            });
          }
        }
      });
    });

    return payments.sort((a, b) => {
      if (a.isOverdue && !b.isOverdue) return -1;
      if (!a.isOverdue && b.isOverdue) return 1;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
  }, [investorSales]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50/30 pb-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-6">

        {/* 🔹 Заголовок */}
        <header className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">Кабинет инвестора</h2>
            <p className="text-slate-500 text-sm">{investor.name} • {investor.email}</p>
          </div>
          <button
            onClick={onLogout}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-xl transition-colors"
          >
            {ICONS.Logout} Выйти
          </button>
        </header>

        {/* 🔹 Табы */}
        <div className="flex bg-white/70 backdrop-blur-sm p-1.5 rounded-2xl shadow-sm border border-white">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all duration-300 ${
              activeTab === 'overview' 
                ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-200' 
                : 'text-slate-500 hover:text-indigo-600'
            }`}
          >
            Обзор
          </button>
          <button
            onClick={() => setActiveTab('contracts')}
            className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all duration-300 ${
              activeTab === 'contracts' 
                ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-200' 
                : 'text-slate-500 hover:text-indigo-600'
            }`}
          >
            Мои договоры
          </button>
        </div>

        {/* 🔹 Вкладка: Обзор */}
        {activeTab === 'overview' && (
          <div className="space-y-6 animate-in fade-in duration-500">

            {/* Карточки статистики: 6 штук как у менеджера */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">

              {/* 1. Собрано средств */}
              <div className="group bg-white p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-emerald-200">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600 mb-4">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" viewBox="0 0 24 24" fill="currentColor">
                    <text x="5" y="18" fontSize="16" fontWeight="bold">₽</text>
                  </svg>
                </div>
                <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase mb-1">Собрано</p>
                <p className="text-lg sm:text-2xl font-bold text-slate-800">
                  {formatCurrency(stats.totalCollected, appSettings.showCents)}
                  <span className="text-xs sm:text-sm text-slate-400 ml-1">₽</span>
                </p>
              </div>

              {/* 2. Долг клиентов */}
              <div className="group bg-white p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-amber-200">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600 mb-4">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase mb-1">Долг клиентов</p>
                <p className="text-lg sm:text-2xl font-bold text-slate-800">
                  {formatCurrency(stats.totalOutstanding, appSettings.showCents)}
                  <span className="text-xs sm:text-sm text-slate-400 ml-1">₽</span>
                </p>
              </div>

              {/* 3. В обороте */}
              <div className="group bg-white p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-blue-200">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600 mb-4">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                </div>
                <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase mb-1">В обороте</p>
                <p className="text-lg sm:text-2xl font-bold text-slate-800">
                  {formatCurrency(stats.workingCapital, appSettings.showCents)}
                  <span className="text-xs sm:text-sm text-slate-400 ml-1">₽</span>
                </p>
              </div>

              {/* 4. Продажи */}
              <div className="group bg-white p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-indigo-200">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600 mb-4">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase mb-1">Продажи</p>
                <p className="text-lg sm:text-2xl font-bold text-slate-800">
                  {formatCurrency(stats.totalSalesAmount, appSettings.showCents)}
                  <span className="text-xs sm:text-sm text-slate-400 ml-1">₽</span>
                </p>
              </div>

              {/* 5. Получено прибыли */}
              <div className="group bg-white p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-emerald-200">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600 mb-4">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
                <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase mb-1">Получено прибыли</p>
                <p className="text-lg sm:text-2xl font-bold text-slate-800">
                  {formatCurrency(profitStats.receivedProfit, appSettings.showCents)}
                  <span className="text-xs sm:text-sm text-slate-400 ml-1">₽</span>
                </p>
              </div>

              {/* 6. Ожидается прибыли */}
              <div className="group bg-white p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-purple-200">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-purple-100 rounded-xl flex items-center justify-center text-purple-600 mb-4">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase mb-1">Ожидается прибыли</p>
                <p className="text-lg sm:text-2xl font-bold text-slate-800">
                  {formatCurrency(profitStats.expectedProfit, appSettings.showCents)}
                  <span className="text-xs sm:text-sm text-slate-400 ml-1">₽</span>
                </p>
              </div>
            </div>

            {/* 🔹 Баланс и доступно к выводу */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 p-6 rounded-2xl text-white shadow-lg">
                <p className="text-indigo-100 text-sm mb-1">Текущий баланс</p>
                <p className="text-3xl font-bold">{formatCurrency(balance, appSettings.showCents)} ₽</p>
                <p className="text-xs text-indigo-200 mt-2">Инвестиции + накопленная прибыль</p>
              </div>

              <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 p-6 rounded-2xl text-white shadow-lg">
                <p className="text-emerald-100 text-sm mb-1">Доступно к выводу</p>
                <p className="text-3xl font-bold">{formatCurrency(availableToWithdraw, appSettings.showCents)} ₽</p>
                <p className="text-xs text-emerald-200 mt-2">Полученная прибыль минус выплаты</p>
              </div>
            </div>

            {/* 🔹 Ближайшие платежи */}
            {upcomingPayments.length > 0 && (
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <span className="w-1 h-5 bg-amber-500 rounded-full"></span>
                  Ближайшие платежи
                </h3>
                <div className="space-y-3">
                  {upcomingPayments.slice(0, 5).map((payment, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                      <div>
                        <p className="font-medium text-slate-800">{payment.customerName}</p>
                        <p className="text-xs text-slate-500">{formatDate(payment.date)}</p>
                      </div>
                      <span className={`font-bold ${payment.isOverdue ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {formatCurrency(payment.amount, appSettings.showCents)} ₽
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 🔹 Вкладка: Договоры */}
        {activeTab === 'contracts' && (
          <div className="space-y-4 animate-in fade-in duration-500">
            {investorSales.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400">
                Нет активных договоров
              </div>
            ) : (
              <div className="grid gap-3">
                {investorSales
                  .filter(s => !s.customerId.startsWith('system_'))
                  .map(sale => {
                    const progress = sale.totalAmount > 0
                      ? ((sale.totalAmount - sale.remainingAmount) / sale.totalAmount) * 100
                      : 0;

                    return (
                      <div key={sale.id} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-all">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <p className="font-bold text-lg text-slate-800">{sale.productName}</p>
                            <p className="text-xs text-slate-500 mt-1">{formatDate(sale.startDate)} • {sale.installments} мес.</p>
                          </div>
                          <span className={`text-xs px-3 py-1.5 rounded-full font-bold ${
                            sale.remainingAmount === 0 
                              ? 'bg-slate-100 text-slate-600' 
                              : sale.status === 'ACTIVE'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}>
                            {sale.remainingAmount === 0 ? 'ЗАКРЫТО' : sale.status}
                          </span>
                        </div>

                        <div className="space-y-2 mb-4">
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-500">Сумма:</span>
                            <span className="font-medium">{formatCurrency(sale.totalAmount, appSettings.showCents)} ₽</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-500">Остаток:</span>
                            <span className="font-bold text-amber-600">{formatCurrency(sale.remainingAmount, appSettings.showCents)} ₽</span>
                          </div>
                          <div className="flex justify-between text-sm text-emerald-600">
                            <span>Ваша доля:</span>
                            <span className="font-bold">{investor.profitPercentage}%</span>
                          </div>
                        </div>

                        <div className="w-full bg-slate-100 rounded-full h-2">
                          <div
                            className="bg-gradient-to-r from-indigo-500 to-indigo-600 h-2 rounded-full transition-all"
                            style={{ width: `${progress}%` }}
                          ></div>
                        </div>
                        <p className="text-xs text-slate-400 mt-1 text-right">{Math.round(progress)}% оплачено</p>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default InvestorDashboard;