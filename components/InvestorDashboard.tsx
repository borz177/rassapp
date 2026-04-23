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
  return sales.filter(s =>
    s.accountId === investorAccount.id &&
    !s.customerId.startsWith('system_')  // ← ИСКЛЮЧАЕМ инвестиции и системные операции
  );
}, [sales, investorAccount]);

  // 🔹 ФИЛЬТРАЦИЯ: Показываем только расходы этого инвестора
  const investorExpenses = useMemo(() => {
    if (!investorAccount) return [];
    return expenses.filter(e => e.accountId === investorAccount.id);
  }, [expenses, investorAccount]);

  // 🔹 БАЛАНС: Как в InvestorDetails (взносы + платежи - все расходы)
  // 🔹 БАЛАНС СЧЁТА: Все поступления − Все расходы (как в InvestorDetails)
const balance = useMemo(() => {
  if (!investorAccount) return 0;

  let totalInflow = 0;
  let totalOutflow = 0;

  // 💰 ВСЕ поступления на счёт (включая системные/депозиты)
  sales
    .filter(s => s.accountId === investorAccount.id)
    .forEach(s => {
      totalInflow += Number(s.downPayment || 0);
      s.paymentPlan
        .filter(p => p.isPaid && p.isRealPayment !== false)
        .forEach(p => totalInflow += Number(p.amount || 0));
    });

  // 💸 ВСЕ расходы со счёта
  expenses
    .filter(e => e.accountId === investorAccount.id)
    .forEach(e => totalOutflow += Number(e.amount || 0));

  return totalInflow - totalOutflow;
}, [sales, expenses, investorAccount]); // ⚠️ Важно: зависимости от исходных массивов


  // 🔹 СТАТИСТИКА: Исправленные расчёты
const stats = useMemo(() => {
  let totalCollected = 0;
  let totalOutstanding = 0;
  let totalSalesAmount = 0;

  investorSales.forEach(sale => {
    // Считаем ВСЕ поступления (для карточки "Собрано")
    totalCollected += sale.downPayment;
    sale.paymentPlan
      .filter(p => p.isPaid && p.isRealPayment !== false)
      .forEach(p => totalCollected += p.amount);

    // Считаем ВСЕ остатки (для карточки "Долг клиентов")
    totalOutstanding += sale.remainingAmount;

    // Считаем общий объём сделок
    totalSalesAmount += sale.totalAmount;
  });

  // 🔹 ОБРОТ = баланс счёта + долг клиентов
  // balance уже учитывает: поступления − расходы − выплаты
  const workingCapital = balance + totalOutstanding;

  return {
    totalCollected,
    totalOutstanding,
    totalSalesAmount,
    workingCapital  // 🔹 Теперь показывает реальные активы инвестора
  };
}, [investorSales, balance]);  // ⚠️ Добавьте balance в зависимости!

  // 🔹 ПРИБЫЛЬ: Как в InvestorDetails
  const { totalProfitEarned, totalProfitWithdrawn, profitAccruals } = useMemo(() => {
    if (!investorAccount) return { totalProfitEarned: 0, totalProfitWithdrawn: 0, profitAccruals: [] };

    const investorSalesFiltered = investorSales.filter(sale => sale.buyPrice > 0);
    let profitSum = 0;
    const accruals: {id: string, date: string, amount: number, source: string}[] = [];

    investorSalesFiltered.forEach(sale => {
      const totalSaleProfit = sale.totalAmount - sale.buyPrice;
      if (sale.totalAmount <= 0 || totalSaleProfit <= 0) return;
      const profitMargin = totalSaleProfit / sale.totalAmount;

      const allPayments = [
        { date: sale.startDate, amount: sale.downPayment, id: `${sale.id}_dp`, isRealPayment: true },
        ...sale.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false)
      ];

      allPayments.forEach(p => {
        if (p.amount > 0) {
          const profitFromPayment = p.amount * profitMargin;
          profitSum += profitFromPayment;
          accruals.push({
            id: p.id,
            date: p.date,
            amount: profitFromPayment,
            source: `Платеж по '${sale.productName}'`
          });
        }
      });
    });

    const withdrawnSum = investorExpenses
      .filter(e => e.payoutType === 'PROFIT')
      .reduce((sum, e) => sum + e.amount, 0);

    return {
      totalProfitEarned: profitSum,
      totalProfitWithdrawn: withdrawnSum,
      profitAccruals: accruals.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    };
  }, [investorSales, investorExpenses, investorAccount]);

  // 🔹 Ожидаемая прибыль: Как в InvestorDetails
  // 🔹 Ожидаемая прибыль: от остатка долга по АКТИВНЫМ сделкам
const expectedTotalProfit = useMemo(() => {
  if (!investorAccount || !investor.profitPercentage) return 0;

  // 🔧 Фильтруем только активные и черновые сделки (не завершённые!)
  const activeSales = investorSales.filter(s =>
    (s.status === 'ACTIVE' || s.status === 'DRAFT') &&
    s.buyPrice > 0 &&
    s.totalAmount > 0 &&
    s.remainingAmount > 0  // 🔧 Только если ещё есть что получать
  );

  return activeSales.reduce((sum, sale) => {
    // 🔧 Маржа прибыли: доля прибыли в каждом рубле выручки
    const profitMargin = (sale.totalAmount - sale.buyPrice) / sale.totalAmount;

    // 🔧 Прибыль, которая ещё может быть получена с остатка долга
    const grossProfitFromRemaining = sale.remainingAmount * profitMargin;

    // 🔧 Доля инвестора в этой потенциальной прибыли
    const investorShare = grossProfitFromRemaining * (investor.profitPercentage / 100);

    return sum + investorShare;
  }, 0);
}, [investorSales, investorAccount, investor.profitPercentage]);

  // 🔹 Доступно к выводу
  const availableToWithdraw = useMemo(() => {
    const profitShare = totalProfitEarned * (investor.profitPercentage / 100);
    return Math.max(0, profitShare - totalProfitWithdrawn);
  }, [totalProfitEarned, totalProfitWithdrawn, investor.profitPercentage]);

  // 🔹 Последние 5 договоров
  const lastFiveSales = useMemo(() => {
    return [...investorSales]
      .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())
      .slice(0, 5);
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

            {/* Карточки статистики */}
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

              {/* 5. Ожидаемая прибыль */}
              <div className="group bg-white p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-indigo-200">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600 mb-4">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase mb-1">Ожидается прибыли</p>
                <p className="text-lg sm:text-2xl font-bold text-slate-800">
                  {formatCurrency(expectedTotalProfit, appSettings.showCents)}
                  <span className="text-xs sm:text-sm text-slate-400 ml-1">₽</span>
                </p>
              </div>

              {/* 6. Получено прибыли */}
              <div className="group bg-white p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-emerald-200">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600 mb-4">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
                <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase mb-1">Получено прибыли</p>
                <p className="text-lg sm:text-2xl font-bold text-slate-800">
                  {formatCurrency(totalProfitEarned * (investor.profitPercentage / 100), appSettings.showCents)}
                  <span className="text-xs sm:text-sm text-slate-400 ml-1">₽</span>
                </p>
              </div>
            </div>

            {/* 🔹 Баланс и доступно к выводу */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 p-6 rounded-2xl text-white shadow-lg">
                <p className="text-indigo-100 text-sm mb-1">Текущий баланс счета</p>
                <p className="text-3xl font-bold">{formatCurrency(balance, appSettings.showCents)} ₽</p>
                <p className="text-xs text-indigo-200 mt-2">Взносы + платежи − расходы</p>
              </div>

              <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 p-6 rounded-2xl text-white shadow-lg">
                <p className="text-emerald-100 text-sm mb-1">Доступно к выводу</p>
                <p className="text-3xl font-bold">{formatCurrency(availableToWithdraw, appSettings.showCents)} ₽</p>
                <p className="text-xs text-emerald-200 mt-2">Прибыль минус выплаты</p>
              </div>
            </div>

            {/* 🔹 Последние договоры */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <span className="w-1 h-5 bg-indigo-500 rounded-full"></span>
                Последние договоры
              </h3>
              <div className="space-y-3">
                {lastFiveSales.length === 0 ? (
                  <div className="text-center py-8 text-slate-400 bg-slate-50 rounded-xl">
                    Нет договоров
                  </div>
                ) : (
                  lastFiveSales.map((sale, idx) => (
                    <div key={sale.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                      <div className="min-w-0">
                        <p className="font-bold text-sm text-slate-800 truncate">{sale.productName}</p>
                        <p className="text-xs text-slate-500 mt-1">{formatDate(sale.startDate)}</p>
                      </div>
                      <span className={`text-xs px-3 py-1.5 rounded-full font-bold ${
                        sale.remainingAmount === 0 
                          ? 'bg-slate-100 text-slate-600' 
                          : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {sale.remainingAmount === 0 ? 'ЗАКРЫТО' : 'АКТИВНО'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
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
                {investorSales.map(sale => {
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