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
  const [contractTab, setContractTab] = useState<'ACTIVE' | 'OVERDUE' | 'ARCHIVE'>('ACTIVE');

   // 🔹 ВСЕ аккаунты инвестора (уже переданы в props как accounts)
  const investorAccountIds = useMemo(() => {
    return accounts.map(acc => acc.id);
  }, [accounts]);

    const investorSales = useMemo(() => {
    if (investorAccountIds.length === 0) return [];
    return sales.filter(s =>
      investorAccountIds.includes(s.accountId) &&
      !s.customerId.startsWith('system_') &&  // ← ИСКЛЮЧАЕМ системные операции
      s.customerId !== investor.id            // ← ИСКЛЮЧАЕМ депозиты инвестора
    );
  }, [sales, investorAccountIds, investor.id]);

  // 🔹 Расходы: уже отфильтрованы в App.tsx
  const investorExpenses = expenses;

  // 🔹 БАЛАНС СЧЁТА: Все поступления − Все расходы
  const balance = useMemo(() => {
    let totalInflow = 0;
    let totalOutflow = 0;

    // 💰 ВСЕ поступления на все счета инвестора
    sales.forEach(s => {
      totalInflow += Number(s.downPayment || 0);
      s.paymentPlan
        .filter(p => p.isPaid && p.isRealPayment !== false)
        .forEach(p => totalInflow += Number(p.amount || 0));
    });

    // 💸 ВСЕ расходы со всех счетов, ИСКЛЮЧАЯ возвраты
    expenses
      .filter(e => e.isRefund !== true)
      .forEach(e => totalOutflow += Number(e.amount || 0));

    // ✅ Учитываем начальный баланс всех счетов
    const initialBalance = accounts.reduce((sum, acc) => sum + (acc.initialBalance || 0), 0);

    return initialBalance + totalInflow - totalOutflow;
  }, [sales, expenses, accounts]);

 const stats = useMemo(() => {
    let totalCollected = 0;
    let totalOutstanding = 0;
    let totalSalesAmount = 0;

    // 🔥 КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ: УБИРАЕМ ФИЛЬТР ПО СТАТУСУ!
    // Раньше здесь было: s.status === 'ACTIVE' || s.status === 'COMPLETED' ...
    // Из-за этого договоры со статусом 'DEFAULTED' (Просрочен) выпадали из расчётов,
    // и долг клиентов (totalOutstanding) и сумма продаж (totalSalesAmount) занижались.
    // Теперь учитываются ВСЕ продажи инвестора (кроме системных, которые отфильтрованы выше).
    
    investorSales.forEach(sale => {
      // 📊 Продажи: общая сумма договоров
        if (sale.type === 'INSTALLMENT') {
        totalSalesAmount += Number(sale.totalAmount) || 0;
      }

      // 💰 Собрано: фактически поступившие платежи
      totalCollected += Number(sale.downPayment) || 0;
      sale.paymentPlan
        .filter(p => p.isPaid && p.isRealPayment !== false)
        .forEach(p => totalCollected += Number(p.amount) || 0);

      // 💸 Долг: остаток к оплате
      totalOutstanding += Number(sale.remainingAmount) || 0;
    });

    // 🔄 Оборот: деньги на счёте + долг клиентов
    const workingCapital = balance + totalOutstanding;

    return { totalCollected, totalOutstanding, totalSalesAmount, workingCapital };
  }, [investorSales, balance]);
  // 🔹 ПРИБЫЛЬ: Как в InvestorDetails
const { totalProfitEarned, totalProfitWithdrawn, profitAccruals } = useMemo(() => {
    if (investorAccountIds.length === 0) return { totalProfitEarned: 0, totalProfitWithdrawn: 0, profitAccruals: [] };

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
  }, [investorSales, investorExpenses, investorAccountIds]);

  // 🔹 Ожидаемая прибыль: Как в InvestorDetails
  // 🔹 Ожидаемая прибыль: от остатка долга по АКТИВНЫМ сделкам
const expectedTotalProfit = useMemo(() => {
  if (investorAccountIds.length === 0 || !investor.profitPercentage) return 0;

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
}, [investorSales, investorAccountIds, investor.profitPercentage]);

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




  // 🔹 СЧЁТЧИКИ И ФИЛЬТРАЦИЯ ДОГОВОРОВ (как в Contracts у менеджера)
  const { contractCounts, filteredSales } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let active = 0, overdue = 0, archive = 0;

    // 🔧 Функция расчёта реальной просрочки
    const calculateSaleOverdue = (sale: Sale) => {
      let expectedTotal = sale.downPayment;
      sale.paymentPlan.forEach(p => {
        if (!p.isRealPayment && new Date(p.date) < today) {
          expectedTotal += p.amount;
        }
      });
      const totalPaid = sale.totalAmount - sale.remainingAmount;
      const overdueAmount = expectedTotal - totalPaid;
      return Math.max(0, overdueAmount);
    };

    // 🔹 Распределяем договоры по категориям
    const categorized = investorSales.map(sale => {
      if (sale.status === 'COMPLETED' || sale.remainingAmount === 0) {
        return { sale, category: 'ARCHIVE' as const };
      }
      const overdueAmount = calculateSaleOverdue(sale);
      if (overdueAmount > 0) {
        return { sale, category: 'OVERDUE' as const };
      }
      return { sale, category: 'ACTIVE' as const };
    });

    // 🔹 Считаем счётчики
    categorized.forEach(c => {
      if (c.category === 'ARCHIVE') archive++;
      else if (c.category === 'OVERDUE') overdue++;
      else active++;
    });

    // 🔹 Фильтруем по выбранной вкладке
    const filtered = categorized
      .filter(c => c.category === contractTab)
      .map(c => c.sale)
      .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());

    return { contractCounts: { active, overdue, archive }, filteredSales: filtered };
  }, [investorSales, contractTab]);

  

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50/30 dark:from-slate-900 dark:to-slate-900 pb-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-6">

        {/* 🔹 Заголовок */}
        <header className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Кабинет инвестора</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{investor.name} • {investor.email}</p>
          </div>
          <button
            onClick={onLogout}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50 rounded-xl transition-colors"
          >
            {ICONS.Logout} Выйти
          </button>
        </header>

        {/* 🔹 Табы */}
        <div className="flex bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm p-1.5 rounded-2xl shadow-sm border border-white dark:border-slate-700">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all duration-300 ${
              activeTab === 'overview'
                ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-200'
                : 'text-slate-500 dark:text-slate-400 hover:text-indigo-600'
            }`}
          >
            Обзор
          </button>
          <button
            onClick={() => setActiveTab('contracts')}
            className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all duration-300 ${
              activeTab === 'contracts'
                ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-200'
                : 'text-slate-500 dark:text-slate-400 hover:text-indigo-600'
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
              <div className="group bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 dark:border-slate-700 hover:border-emerald-200">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-4">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" viewBox="0 0 24 24" fill="currentColor">
                    <text x="5" y="18" fontSize="16" fontWeight="bold">₽</text>
                  </svg>
                </div>
                <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase mb-1">Собрано</p>
                <p className="text-lg sm:text-2xl font-bold text-slate-800 dark:text-white">
                  {formatCurrency(stats.totalCollected, appSettings.showCents)}
                  <span className="text-xs sm:text-sm text-slate-400 ml-1">₽</span>
                </p>
              </div>

              {/* 2. Долг клиентов */}
              <div className="group bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 dark:border-slate-700 hover:border-amber-200">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-amber-100 dark:bg-amber-900/30 rounded-xl flex items-center justify-center text-amber-600 dark:text-amber-400 mb-4">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase mb-1">Долг клиентов</p>
                <p className="text-lg sm:text-2xl font-bold text-slate-800 dark:text-white">
                  {formatCurrency(stats.totalOutstanding, appSettings.showCents)}
                  <span className="text-xs sm:text-sm text-slate-400 ml-1">₽</span>
                </p>
              </div>

              {/* 3. В обороте */}
              <div className="group bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 dark:border-slate-700 hover:border-blue-200">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center text-blue-600 dark:text-blue-400 mb-4">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                </div>
                <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase mb-1">В обороте</p>
                <p className="text-lg sm:text-2xl font-bold text-slate-800 dark:text-white">
                  {formatCurrency(stats.workingCapital, appSettings.showCents)}
                  <span className="text-xs sm:text-sm text-slate-400 ml-1">₽</span>
                </p>
              </div>

              {/* 4. Продажи */}
              <div className="group bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 dark:border-slate-700 hover:border-indigo-200">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-4">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase mb-1">Продажи</p>
                <p className="text-lg sm:text-2xl font-bold text-slate-800 dark:text-white">
                  {formatCurrency(stats.totalSalesAmount, appSettings.showCents)}
                  <span className="text-xs sm:text-sm text-slate-400 ml-1">₽</span>
                </p>
              </div>

              {/* 5. Ожидаемая прибыль */}
              <div className="group bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 dark:border-slate-700 hover:border-indigo-200">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-4">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase mb-1">Ожидается прибыли</p>
                <p className="text-lg sm:text-2xl font-bold text-slate-800 dark:text-white">
                  {formatCurrency(expectedTotalProfit, appSettings.showCents)}
                  <span className="text-xs sm:text-sm text-slate-400 ml-1">₽</span>
                </p>
              </div>

              {/* 6. Получено прибыли */}
              <div className="group bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 dark:border-slate-700 hover:border-emerald-200">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-4">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
                <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase mb-1">Получено прибыли</p>
                <p className="text-lg sm:text-2xl font-bold text-slate-800 dark:text-white">
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
               
              </div>

              <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 p-6 rounded-2xl text-white shadow-lg">
                <p className="text-emerald-100 text-sm mb-1">Прибыль</p>
                <p className="text-3xl font-bold">{formatCurrency(availableToWithdraw, appSettings.showCents)} ₽</p>
                <p className="text-xs text-emerald-200 mt-2">Доступно к выводу</p>
              </div>
            </div>

            {/* 🔹 Последние договоры */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-100 dark:border-slate-700">
              <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                <span className="w-1 h-5 bg-indigo-500 rounded-full"></span>
                Последние договоры
              </h3>
              <div className="space-y-3">
                {lastFiveSales.length === 0 ? (
                  <div className="text-center py-8 text-slate-400 bg-slate-50 dark:bg-slate-900 rounded-xl">
                    Нет договоров
                  </div>
                ) : (
                  lastFiveSales.map((sale, idx) => (
                    <div key={sale.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900 rounded-xl">
                      <div className="min-w-0">
                        <p className="font-bold text-sm text-slate-800 dark:text-white truncate">{sale.productName}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{formatDate(sale.startDate)}</p>
                      </div>
                      <span className={`text-xs px-3 py-1.5 rounded-full font-bold ${
                        sale.remainingAmount === 0
                          ? 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                          : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
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
            
            {/* 🔹 ФИЛЬТРЫ-КНОПКИ С СЧЁТЧИКАМИ */}
            <div className="flex gap-2 p-1 bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-2xl shadow-sm border border-white dark:border-slate-700">
              <button
                onClick={() => setContractTab('ACTIVE')}
                className={`flex-1 py-2.5 text-xs sm:text-sm font-bold rounded-xl transition-all duration-300 flex items-center justify-center gap-1.5 ${
                  contractTab === 'ACTIVE'
                    ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-200'
                    : 'text-slate-500 dark:text-slate-400 hover:text-indigo-600'
                }`}
              >
                Активные
                {contractCounts.active > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                    contractTab === 'ACTIVE' ? 'bg-white/20 text-white' : 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400'
                  }`}>
                    {contractCounts.active}
                  </span>
                )}
              </button>
              <button
                onClick={() => setContractTab('OVERDUE')}
                className={`flex-1 py-2.5 text-xs sm:text-sm font-bold rounded-xl transition-all duration-300 flex items-center justify-center gap-1.5 ${
                  contractTab === 'OVERDUE'
                    ? 'bg-gradient-to-r from-red-600 to-red-500 text-white shadow-md shadow-red-200'
                    : 'text-slate-500 dark:text-slate-400 hover:text-red-600'
                }`}
              >
                Просроченные
                {contractCounts.overdue > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                    contractTab === 'OVERDUE' ? 'bg-white/20 text-white' : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                  }`}>
                    {contractCounts.overdue}
                  </span>
                )}
              </button>
              <button
                onClick={() => setContractTab('ARCHIVE')}
                className={`flex-1 py-2.5 text-xs sm:text-sm font-bold rounded-xl transition-all duration-300 flex items-center justify-center gap-1.5 ${
                  contractTab === 'ARCHIVE'
                    ? 'bg-gradient-to-r from-slate-600 to-slate-500 text-white shadow-md shadow-slate-200'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-600'
                }`}
              >
                Архив
                {contractCounts.archive > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                    contractTab === 'ARCHIVE' ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                  }`}>
                    {contractCounts.archive}
                  </span>
                )}
              </button>
            </div>

            {/* 🔹 Список договоров (теперь отфильтрованный) */}
            {filteredSales.length === 0 ? (
              <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 text-slate-400">
                {contractTab === 'ACTIVE' && 'Нет активных договоров'}
                {contractTab === 'OVERDUE' && 'Нет просроченных договоров 🎉'}
                {contractTab === 'ARCHIVE' && 'Архив пуст'}
              </div>
            ) : (
              <div className="grid gap-3">
                {filteredSales.map(sale => {
                  const progress = sale.totalAmount > 0
                    ? ((sale.totalAmount - sale.remainingAmount) / sale.totalAmount) * 100
                    : 0;

                  return (
                    <div key={sale.id} className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 hover:shadow-md transition-all">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <p className="font-bold text-lg text-slate-800 dark:text-white">{sale.productName}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{formatDate(sale.startDate)} • {sale.installments} мес.</p>
                        </div>
                        <span className={`text-xs px-3 py-1.5 rounded-full font-bold ${
                          sale.remainingAmount === 0
                            ? 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                            : sale.status === 'ACTIVE'
                            ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                            : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                        }`}>
                          {sale.remainingAmount === 0 ? 'ЗАКРЫТО' : sale.status}
                        </span>
                      </div>

                      <div className="space-y-2 mb-4">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500 dark:text-slate-400">Сумма:</span>
                          <span className="font-medium dark:text-slate-200">{formatCurrency(sale.totalAmount, appSettings.showCents)} ₽</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500 dark:text-slate-400">Остаток:</span>
                          <span className="font-bold text-amber-600 dark:text-amber-400">{formatCurrency(sale.remainingAmount, appSettings.showCents)} ₽</span>
                        </div>
                        <div className="flex justify-between text-sm text-emerald-600 dark:text-emerald-400">
                          <span>Ваша доля:</span>
                          <span className="font-bold">{investor.profitPercentage}%</span>
                        </div>
                      </div>

                      <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-2">
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