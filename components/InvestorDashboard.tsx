import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Sale, Expense, Account, Investor, AppSettings, Customer } from '../types';
import { ICONS } from '../constants';
import { formatCurrency, formatDate } from '../src/utils';
import Contracts from './Contracts';

interface InvestorDashboardProps {
  sales: Sale[];
  expenses: Expense[];
  accounts: Account[];
  customers: Customer[];
  investor: Investor;
  appSettings: AppSettings;
  onLogout: () => void;
}

// 🔹 Пресеты периода для графика динамики прибыли — тот же подход, что и у менеджера
// в Reports.tsx (там не экспортирован, поэтому лёгкая копия здесь, а не общий импорт).
type PeriodPreset = 'week' | 'month' | 'quarter' | 'year' | 'all';
const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  week: '7 дней', month: 'Месяц', quarter: 'Квартал', year: 'Год', all: 'Всё время',
};
const MONTH_NAMES_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
function getPeriodDates(preset: PeriodPreset): { start: string; end: string } {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const todayStr = fmt(today);
  switch (preset) {
    case 'week': { const d = new Date(today); d.setDate(today.getDate() - 7); return { start: fmt(d), end: todayStr }; }
    case 'month': return { start: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), end: todayStr };
    case 'quarter': { const d = new Date(today); d.setMonth(today.getMonth() - 3); return { start: fmt(d), end: todayStr }; }
    case 'year': { const d = new Date(today); d.setFullYear(today.getFullYear() - 1); return { start: fmt(d), end: todayStr }; }
    case 'all': return { start: '2020-01-01', end: todayStr };
  }
}

const InvestorDashboard: React.FC<InvestorDashboardProps> = ({
  sales, expenses, accounts, customers, investor, appSettings, onLogout
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'contracts'>('overview');
  const [contractTab, setContractTab] = useState<'ACTIVE' | 'OVERDUE' | 'ARCHIVE'>('ACTIVE');
  const [showPayoutsModal, setShowPayoutsModal] = useState(false);
  const [showAccrualsModal, setShowAccrualsModal] = useState(false);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('month');

   // 🔹 ВСЕ аккаунты инвестора (уже переданы в props как accounts)
  const investorAccountIds = useMemo(() => {
    return accounts.map(acc => acc.id);
  }, [accounts]);

  // 🔒 Если хотя бы один из счетов — общий пул, "баланс" ниже — это общая касса пула
  // (деньги всех участников), а не личные деньги именно этого инвестора. Прибыль
  // (availableToWithdraw) при этом всё равно считается корректно — только его доля.
  const isPoolAccount = useMemo(() => accounts.some(acc => acc.type === 'POOL'), [accounts]);

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
    let totalBuyCost = 0;

    investorSales.forEach(sale => {
      if (sale.type === 'INSTALLMENT') {
        totalSalesAmount += Number(sale.totalAmount) || 0;
        totalBuyCost += Number(sale.buyPrice) || 0;
      }

      totalCollected += Number(sale.downPayment) || 0;
      sale.paymentPlan
        .filter(p => p.isPaid && p.isRealPayment !== false)
        .forEach(p => totalCollected += Number(p.amount) || 0);

      totalOutstanding += Number(sale.remainingAmount) || 0;
    });

    const workingCapital = balance + totalOutstanding;

    return { totalCollected, totalOutstanding, totalSalesAmount, totalBuyCost, workingCapital };
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

    // 🔒 В общем пуле expenses содержат выводы ВСЕХ участников — считаем только выводы этого инвестора,
    // иначе вывод одного участника ошибочно уменьшал бы "доступно к выводу" у другого.
    const withdrawnSum = investorExpenses
      .filter(e => e.payoutType === 'PROFIT' && (!e.investorId || e.investorId === investor.id))
      .reduce((sum, e) => sum + e.amount, 0);

    return {
      totalProfitEarned: profitSum,
      totalProfitWithdrawn: withdrawnSum,
      profitAccruals: accruals.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    };
  }, [investorSales, investorExpenses, investorAccountIds]);

  // 🔹 История выплат этому инвестору — тот же фильтр, что и для withdrawnSum выше,
  // но со списком отдельных операций (для модалки "Мои выплаты"), а не только суммой.
  const myPayouts = useMemo(() => {
    return investorExpenses
      .filter(e => e.payoutType === 'PROFIT' && (!e.investorId || e.investorId === investor.id))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [investorExpenses, investor.id]);

  // 🔹 Выбранный период для графика/деталей прибыли
  const periodRange = useMemo(() => getPeriodDates(periodPreset), [periodPreset]);

  // 🔹 profitAccruals уже посчитан выше (по каждому платежу клиента) — здесь просто
  // фильтруем по периоду и переводим из валовой прибыли в долю ЭТОГО инвестора.
  const accrualsInPeriod = useMemo(() => {
    const start = new Date(periodRange.start);
    const end = new Date(periodRange.end);
    end.setHours(23, 59, 59, 999);
    const share = investor.profitPercentage / 100;
    return profitAccruals
      .filter(a => { const d = new Date(a.date); return d >= start && d <= end; })
      .map(a => ({ ...a, amount: a.amount * share }));
  }, [profitAccruals, periodRange, investor.profitPercentage]);

  const periodProfitTotal = useMemo(
    () => accrualsInPeriod.reduce((sum, a) => sum + a.amount, 0),
    [accrualsInPeriod]
  );

  // 🔹 Данные для графика — группировка по дням, а на длинных периодах (>90 дней) по месяцам,
  // тот же порог, что и в Reports.tsx у менеджера.
  const profitChartData = useMemo(() => {
    if (accrualsInPeriod.length === 0) return [];
    const start = new Date(periodRange.start);
    const end = new Date(periodRange.end);
    const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const useMonthly = diffDays > 90;

    const buckets: Record<string, number> = {};
    accrualsInPeriod.forEach(a => {
      const d = new Date(a.date);
      const key = useMonthly
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        : a.date.substring(0, 10);
      buckets[key] = (buckets[key] || 0) + a.amount;
    });

    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, amount]) => {
        const label = useMonthly
          ? `${MONTH_NAMES_SHORT[parseInt(key.split('-')[1]) - 1]} ${key.split('-')[0]}`
          : key.substring(5).replace('-', '.');
        return { key, label, amount };
      });
  }, [accrualsInPeriod, periodRange]);

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




  // 🔹 Категоризация/просрочка/поиск для вкладки "Мои договоры" теперь считает
  // сам <Contracts/> (см. ниже) — та же логика, что и у менеджера, без дублирования.

  

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

              {/* 3. Закуп */}
              <div className="group bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(100,116,139,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 dark:border-slate-700 hover:border-slate-200 flex flex-col relative overflow-hidden cursor-default">
                <div className="absolute -right-6 -top-6 w-24 h-24 bg-slate-50 dark:bg-slate-700/50 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-700 pointer-events-none"></div>
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-slate-100 dark:bg-slate-700 rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-300 mb-4 z-10 relative group-hover:bg-slate-500 group-hover:text-white transition-colors duration-300 shadow-sm">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
                  </svg>
                </div>
                <div className="z-10 relative mt-auto">
                  <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wide mb-1 leading-tight">Закуп</p>
                  <p className="text-lg sm:text-2xl font-bold text-slate-800 dark:text-white break-words leading-none">
                    {formatCurrency(stats.totalBuyCost, appSettings.showCents)}
                    <span className="text-xs sm:text-sm text-slate-400 ml-1 font-bold">₽</span>
                  </p>
                </div>
              </div>

              {/* 4. Продажи */}
              <div className="group bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 dark:border-slate-700 hover:border-indigo-200 flex flex-col relative overflow-hidden cursor-default">
                <div className="absolute -right-6 -top-6 w-24 h-24 bg-indigo-50 dark:bg-indigo-900/20 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-700 pointer-events-none"></div>
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-4 z-10 relative group-hover:bg-indigo-500 group-hover:text-white transition-colors duration-300 shadow-sm">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
                  </svg>
                </div>
                <div className="z-10 relative mt-auto">
                  <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wide mb-1 leading-tight">Продажи</p>
                  <p className="text-lg sm:text-2xl font-bold text-slate-800 dark:text-white break-words leading-none">
                    {formatCurrency(stats.totalSalesAmount, appSettings.showCents)}
                    <span className="text-xs sm:text-sm text-slate-400 ml-1 font-bold">₽</span>
                  </p>
                </div>
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

              {/* 7. В обороте — перенесено сюда, в пару с "Доступно к выводу" (карточка 8) */}
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

              {/* 8. Доступно к выводу — напротив "В обороте" */}
              <div className="group bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 dark:border-slate-700 hover:border-emerald-200">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-4">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8c-1.657 0-3-.895-3-2s1.343-2 3-2 3 .895 3 2-1.343 2-3 2m0 8c-1.657 0-3-.895-3-2s1.343-2 3-2 3 .895 3 2-1.343 2-3 2M12 6V4m0 16v-2" />
                  </svg>
                </div>
                <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase mb-1">Доступно к выводу</p>
                <p className="text-lg sm:text-2xl font-bold text-slate-800 dark:text-white">
                  {formatCurrency(availableToWithdraw, appSettings.showCents)}
                  <span className="text-xs sm:text-sm text-slate-400 ml-1">₽</span>
                </p>
              </div>
            </div>

            {/* 🔹 Баланс и выплаты (карточка "Прибыль/Доступно к выводу" переехала в сетку выше) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 p-6 rounded-2xl text-white shadow-lg">
                <p className="text-indigo-100 text-sm mb-1">{isPoolAccount ? 'Баланс пула (общий)' : 'Текущий баланс счета'}</p>
                <p className="text-3xl font-bold">{formatCurrency(balance, appSettings.showCents)} ₽</p>
                {isPoolAccount && (
                  <p className="text-xs text-indigo-200 mt-2">Общая касса пула — включает деньги всех участников, ваша доля — в блоке «Доступно к выводу»</p>
                )}
              </div>

              {/* 🔹 Мои выплаты — клик открывает историю */}
              <button
                onClick={() => setShowPayoutsModal(true)}
                className="text-left bg-gradient-to-br from-violet-500 to-purple-600 p-6 rounded-2xl text-white shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all"
              >
                <p className="text-violet-100 text-sm mb-1">Мои выплаты</p>
                <p className="text-3xl font-bold">{formatCurrency(totalProfitWithdrawn, appSettings.showCents)} ₽</p>
                <p className="text-xs text-violet-200 mt-2 flex items-center gap-1">
                  {myPayouts.length > 0 ? `${myPayouts.length} ${myPayouts.length === 1 ? 'выплата' : 'выплат'} · история` : 'Выплат пока не было'}
                  <span aria-hidden>→</span>
                </p>
              </button>
            </div>

            {/* 🔹 Динамика прибыли */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-100 dark:border-slate-700">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                  <span className="w-1 h-5 bg-emerald-500 rounded-full"></span>
                  Динамика прибыли
                </h3>
                <button
                  onClick={() => setShowAccrualsModal(true)}
                  className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 flex items-center gap-1 self-start sm:self-auto"
                >
                  Откуда прибыль <span aria-hidden>→</span>
                </button>
              </div>

              {/* Пресеты периода */}
              <div className="flex flex-wrap gap-2 mb-5">
                {(Object.keys(PERIOD_PRESET_LABELS) as PeriodPreset[]).map(preset => (
                  <button
                    key={preset}
                    onClick={() => setPeriodPreset(preset)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 ${
                      periodPreset === preset
                        ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-md shadow-emerald-200 dark:shadow-emerald-900/30 scale-105'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}
                  >
                    {PERIOD_PRESET_LABELS[preset]}
                  </button>
                ))}
              </div>

              {profitChartData.length === 0 ? (
                <div className="text-center py-10 text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-900 rounded-xl">
                  Нет начислений прибыли за выбранный период
                </div>
              ) : (
                <>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={profitChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="investorProfitGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10B981" stopOpacity={0.25} />
                            <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 11, fill: '#94a3b8' }}
                          axisLine={false} tickLine={false}
                          interval="preserveStartEnd"
                        />
                        <YAxis hide />
                        <Tooltip
                          formatter={(value: any) => [`${formatCurrency(Number(value), appSettings.showCents)} ₽`, 'Прибыль']}
                          contentStyle={{ backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                          labelStyle={{ color: '#64748b', fontWeight: 600, marginBottom: 4 }}
                        />
                        <Area type="monotone" dataKey="amount" stroke="#10B981" strokeWidth={2.5}
                          fill="url(#investorProfitGradient)" dot={{ r: 3, fill: '#10B981', strokeWidth: 0 }}
                          activeDot={{ r: 5, fill: '#10B981', strokeWidth: 2, stroke: '#fff' }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-3 text-center">
                    Прибыль за период: <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(periodProfitTotal, appSettings.showCents)} ₽</span>
                  </p>
                </>
              )}
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
          <div className="animate-in fade-in duration-500 space-y-4">
            {/* 🔹 Contracts сам не рисует переключатель вкладок — ждёт его от родителя
                (у менеджера это делает боковое меню). Здесь — свой лёгкий переключатель. */}
            <div className="flex gap-2 p-1 bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-2xl shadow-sm border border-white dark:border-slate-700">
              {([
                { key: 'ACTIVE', label: 'Активные', activeClasses: 'from-indigo-600 to-indigo-500 shadow-indigo-200', hoverClass: 'hover:text-indigo-600' },
                { key: 'OVERDUE', label: 'Просроченные', activeClasses: 'from-red-600 to-red-500 shadow-red-200', hoverClass: 'hover:text-red-600' },
                { key: 'ARCHIVE', label: 'Архив', activeClasses: 'from-slate-600 to-slate-500 shadow-slate-200', hoverClass: 'hover:text-slate-600' },
              ] as const).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setContractTab(tab.key)}
                  className={`flex-1 py-2.5 text-xs sm:text-sm font-bold rounded-xl transition-all duration-300 ${
                    contractTab === tab.key
                      ? `bg-gradient-to-r ${tab.activeClasses} text-white shadow-md`
                      : `text-slate-500 dark:text-slate-400 ${tab.hoverClass}`
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* 🔹 Тот же компонент, что и у менеджера: карточки, клик — открывает
                информацию о договоре, сумма просрочки сверху на вкладке "Просроченные". */}
            <Contracts
              sales={investorSales}
              customers={customers}
              accounts={accounts}
              activeTab={contractTab}
              onTabChange={setContractTab}
              onViewSchedule={() => {}}
              onEditSale={() => {}}
              onDeleteSale={() => {}}
              readOnly
              appSettings={appSettings}
            />
          </div>
        )}
      </div>

      {/* 🔹 Модалка: история выплат */}
      {showPayoutsModal && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
          onClick={() => setShowPayoutsModal(false)}
        >
          <div
            className="bg-white dark:bg-slate-800 w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 bg-gradient-to-r from-violet-600 to-purple-600 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-base font-bold text-white">Мои выплаты</h3>
                <p className="text-xs text-violet-100 mt-0.5">Всего получено: {formatCurrency(totalProfitWithdrawn, appSettings.showCents)} ₽</p>
              </div>
              <button
                onClick={() => setShowPayoutsModal(false)}
                className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
                aria-label="Закрыть"
              >
                {ICONS.Close}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {myPayouts.length === 0 ? (
                <div className="text-center py-12 text-slate-400 dark:text-slate-500">
                  <div className="text-4xl mb-2">💸</div>
                  <p className="text-sm">Выплат пока не было</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {myPayouts.map(payout => (
                    <div key={payout.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900 rounded-xl">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-slate-800 dark:text-white truncate">{payout.title || 'Выплата прибыли'}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{formatDate(payout.date)}</p>
                      </div>
                      <span className="text-sm font-bold text-violet-600 dark:text-violet-400 shrink-0 ml-3">
                        −{formatCurrency(payout.amount, appSettings.showCents)} ₽
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-slate-700 shrink-0">
              <button
                onClick={() => setShowPayoutsModal(false)}
                className="w-full py-3 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 🔹 Модалка: откуда прибыль (детализация начислений за выбранный период) */}
      {showAccrualsModal && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
          onClick={() => setShowAccrualsModal(false)}
        >
          <div
            className="bg-white dark:bg-slate-800 w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 bg-gradient-to-r from-emerald-600 to-emerald-500 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-base font-bold text-white">Откуда прибыль</h3>
                <p className="text-xs text-emerald-100 mt-0.5">
                  {PERIOD_PRESET_LABELS[periodPreset]} · начислено {formatCurrency(periodProfitTotal, appSettings.showCents)} ₽
                </p>
              </div>
              <button
                onClick={() => setShowAccrualsModal(false)}
                className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
                aria-label="Закрыть"
              >
                {ICONS.Close}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {accrualsInPeriod.length === 0 ? (
                <div className="text-center py-12 text-slate-400 dark:text-slate-500">
                  <div className="text-4xl mb-2">📈</div>
                  <p className="text-sm">Начислений за этот период не было</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {accrualsInPeriod.map(accrual => (
                    <div key={accrual.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900 rounded-xl">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-slate-800 dark:text-white truncate">{accrual.source}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{formatDate(accrual.date)}</p>
                      </div>
                      <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 shrink-0 ml-3">
                        +{formatCurrency(accrual.amount, appSettings.showCents)} ₽
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-slate-700 shrink-0">
              <button
                onClick={() => setShowAccrualsModal(false)}
                className="w-full py-3 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default InvestorDashboard;