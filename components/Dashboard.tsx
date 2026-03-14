import React, { useMemo, useState } from 'react';
import { Sale, Customer, Account, AppSettings } from '../types';
import { ICONS } from '../constants';
import { formatCurrency, formatDate } from '../src/utils';

interface DashboardProps {
  sales: Sale[];
  customers: Customer[];
  stats: {
    totalRevenue: number;
    totalOutstanding: number;
    overdueCount: number;
    installmentSalesTotal: number;
  };
  workingCapital: number;
  accountBalances: Record<string, number>;
  onAction: (action: string) => void;
  onSelectCustomer: (id: string) => void;
  onInitiatePayment: (sale: Sale, amount: number) => void;
  accounts: Account[];
  appSettings: AppSettings;
}

const SaleDetailsModal = ({ sale, customerName, onClose, appSettings }: { sale: Sale, customerName: string, onClose: () => void, appSettings: AppSettings }) => {
    const statusMap: Record<string, { label: string, color: string }> = {
        'ACTIVE': { label: 'Активен', color: 'bg-blue-100 text-blue-700 border-blue-200' },
        'COMPLETED': { label: 'Завершен', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
        'DEFAULTED': { label: 'Просрочен', color: 'bg-rose-100 text-rose-700 border-rose-200' }
    };

    const status = statusMap[sale.status] || { label: sale.status, color: 'bg-slate-100 text-slate-700 border-slate-200' };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gradient-to-br from-slate-900/80 to-indigo-900/60 backdrop-blur-md animate-in fade-in zoom-in duration-300" onClick={onClose}>
            <div className="bg-white backdrop-blur-sm w-full max-w-md rounded-3xl shadow-2xl overflow-hidden border border-white/20" onClick={e => e.stopPropagation()}>
                {/* Header with gradient */}
                <div className="relative p-6 bg-gradient-to-r from-indigo-600 to-indigo-500 text-white">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-8 -mt-8 blur-2xl"></div>
                    <h3 className="text-xl font-bold mb-1">{sale.productName}</h3>
                    <p className="text-indigo-100 text-sm flex items-center gap-1">
                        <span className="opacity-70">👤</span> {customerName}
                    </p>
                    <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center backdrop-blur-sm transition-all">
                        <span className="text-lg">✕</span>
                    </button>
                </div>

                {/* Content with glass morphism effect */}
                <div className="p-6 space-y-4 bg-slate-50">
                    {/* Status badge */}
                    <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-slate-500">Статус договора</span>
                        <span className={`px-3 py-1.5 rounded-full text-xs font-bold border ${status.color}`}>
                            {status.label}
                        </span>
                    </div>

                    {/* Details grid */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                            <p className="text-xs text-slate-500 mb-1">Дата</p>
                            <p className="font-semibold text-slate-800">{formatDate(sale.startDate)}</p>
                        </div>
                        <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                            <p className="text-xs text-slate-500 mb-1">Срок</p>
                            <p className="font-semibold text-slate-800">{sale.installments} мес.</p>
                        </div>
                    </div>

                    {/* Financial details */}
                    <div className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm space-y-3">
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-slate-500">Общая сумма</span>
                            <span className="text-lg font-bold text-indigo-600">{formatCurrency(sale.totalAmount, appSettings.showCents)} ₽</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-slate-500">Первый взнос</span>
                            <span className="font-medium text-slate-700">{formatCurrency(sale.downPayment, appSettings.showCents)} ₽</span>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-dashed border-slate-200">
                            <span className="text-sm font-medium text-slate-600">Остаток долга</span>
                            <span className="text-lg font-bold text-amber-600">{formatCurrency(sale.remainingAmount, appSettings.showCents)} ₽</span>
                        </div>
                    </div>

                    {/* Installments progress (if available) */}
                    {sale.paymentPlan && sale.paymentPlan.length > 0 && (
                        <div className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm">
                            <p className="text-sm font-medium text-slate-700 mb-3">График платежей</p>
                            <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                                {sale.paymentPlan.slice(0, 3).map((payment, idx) => (
                                    <div key={idx} className="flex justify-between items-center text-xs">
                                        <span className="text-slate-500">{formatDate(payment.date)}</span>
                                        <span className="font-medium text-slate-700">{formatCurrency(payment.amount, appSettings.showCents)} ₽</span>
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${payment.isPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                            {payment.isPaid ? 'Оплачено' : 'Ожидается'}
                                        </span>
                                    </div>
                                ))}
                                {sale.paymentPlan.length > 3 && (
                                    <p className="text-center text-[10px] text-slate-400 mt-1">+ еще {sale.paymentPlan.length - 3} платежей</p>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-200 bg-white">
                    <button onClick={onClose} className="w-full py-3.5 bg-gradient-to-r from-slate-800 to-slate-700 text-white font-bold rounded-xl hover:from-slate-900 hover:to-slate-800 shadow-lg shadow-slate-200 transition-all">
                        Закрыть
                    </button>
                </div>
            </div>
        </div>
    );
};

const Dashboard: React.FC<DashboardProps> = ({ sales, customers, stats: globalStats, workingCapital: globalWorkingCapital, accountBalances, onAction, onSelectCustomer, onInitiatePayment, accounts, appSettings }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'upcoming'>('overview');
  const [selectedSaleForModal, setSelectedSaleForModal] = useState<Sale | null>(null);
  const [activeActionMenu, setActiveActionMenu] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [paymentDateFilter, setPaymentDateFilter] = useState<'ALL' | 'TODAY' | 'TOMORROW'>('ALL');

  // --- STATS CALCULATION (FILTERED) ---
  const calculatedStats = useMemo(() => {
      const filteredSales = selectedAccountId
          ? sales.filter(s => s.accountId === selectedAccountId)
          : sales;

      let totalRevenue = 0;
      let totalOutstanding = 0;
      let installmentSalesTotal = 0;

      filteredSales.forEach(sale => {
          const isSystemTransaction = sale.customerId.startsWith('system_');
          if (!isSystemTransaction) {
              const collected = sale.downPayment + sale.paymentPlan
                  .filter(p => p.isPaid && p.isRealPayment !== false)
                  .reduce((sum, p) => sum + p.amount, 0);

              totalRevenue += collected;
              totalOutstanding += sale.remainingAmount;
              if (sale.type === 'INSTALLMENT') {
                  installmentSalesTotal += sale.totalAmount;
              }
          }
      });

      return { totalRevenue, totalOutstanding, installmentSalesTotal };
  }, [sales, selectedAccountId]);

  const currentWorkingCapital = useMemo(() => {
      if (selectedAccountId) {
          const cash = accountBalances[selectedAccountId] || 0;
          return cash + calculatedStats.totalOutstanding;
      }
      return globalWorkingCapital;
  }, [selectedAccountId, accountBalances, calculatedStats.totalOutstanding, globalWorkingCapital]);

  const lastFiveSales = useMemo(() => {
      let filtered = sales;
      if (selectedAccountId) filtered = filtered.filter(s => s.accountId === selectedAccountId);
      filtered = filtered.filter(s => !s.customerId.startsWith('system_'));
      return [...filtered]
          .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())
          .slice(0, 5);
  }, [sales, selectedAccountId]);

  const upcomingAndOverduePayments = useMemo(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const tomorrowEnd = new Date(tomorrow);
    tomorrowEnd.setHours(23, 59, 59, 999);

    const today = new Date();
    const todayEnd = new Date(today);
    today.setHours(0,0,0,0);
    todayEnd.setHours(23, 59, 59, 999);
    const todayStr = today.toDateString();

    const payments: { sale: Sale, customerName: string, totalDue: number, isTomorrow: boolean, isToday: boolean, isOverdue: boolean }[] = [];

    sales.forEach(sale => {
      if (sale.status !== 'ACTIVE') return;

      const realInstallmentPayments = sale.paymentPlan
          .filter(p => p.isPaid && p.isRealPayment !== false)
          .reduce((sum, p) => sum + p.amount, 0);

      let paymentPool = realInstallmentPayments;
      const planItems = sale.paymentPlan
          .filter(p => p.isRealPayment === false || p.isRealPayment === undefined)
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      let relevantAmount = 0;
      let isTomorrowPayment = false;
      let isTodayPayment = false;
      let isOverduePayment = false;

      planItems.forEach(p => {
          const amountDue = p.amount;
          const coveredByPool = Math.min(amountDue, paymentPool);
          paymentPool -= coveredByPool;
          const actualDue = amountDue - coveredByPool;

          if (actualDue > 0.01) {
              const paymentDate = new Date(p.date);
              paymentDate.setHours(0,0,0,0);
              const isPast = paymentDate < today;
              const isToday = paymentDate.toDateString() === todayStr;
              const isTomorrow = paymentDate >= tomorrow && paymentDate <= tomorrowEnd;

              let include = false;
              if (paymentDateFilter === 'ALL') {
                  if (isToday || isTomorrow) include = true;
              } else if (paymentDateFilter === 'TODAY') {
                  if (isToday) include = true;
              } else if (paymentDateFilter === 'TOMORROW') {
                  if (isTomorrow) include = true;
              }

              if (include) {
                  relevantAmount += actualDue;
                  if (isTomorrow) isTomorrowPayment = true;
                  if (isToday) isTodayPayment = true;
                  if (isPast) isOverduePayment = true;
              }
          }
      });

      if (relevantAmount > 0) {
        payments.push({
          sale: sale,
          customerName: customers.find(c => c.id === sale.customerId)?.name || 'Неизвестный клиент',
          totalDue: relevantAmount,
          isTomorrow: isTomorrowPayment && !isTodayPayment,
          isToday: isTodayPayment,
          isOverdue: isOverduePayment
        });
      }
    });

    return payments.sort((a,b) => {
        if (a.isToday && !b.isToday) return -1;
        if (!a.isToday && b.isToday) return 1;
        return a.totalDue - b.totalDue;
    });
  }, [sales, customers, paymentDateFilter]);

  const handleActionClick = (e: React.MouseEvent, saleId: string) => {
      e.stopPropagation();
      setActiveActionMenu(prev => prev === saleId ? null : saleId);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50/30 pb-24 w-full">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-6 animate-in fade-in slide-in-from-top-4 duration-500">

        {/* Header with greeting and date */}


        {/* Tabs */}
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
            onClick={() => setActiveTab('upcoming')}
            className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all duration-300 relative ${
              activeTab === 'upcoming' 
                ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-200' 
                : 'text-slate-500 hover:text-indigo-600'
            }`}
          >
            Платежи
            {upcomingAndOverduePayments.length > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white text-[10px] rounded-full flex items-center justify-center border-2 border-white shadow-sm animate-pulse">
                {upcomingAndOverduePayments.length}
              </span>
            )}
          </button>
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
            <div className="space-y-6 animate-in fade-in duration-500">

                {/* Account Filter - Horizontal Scroll - только если больше одного счета */}
                {accounts.length > 1 && (
                  <div className="relative ml-4">
                    <div className="overflow-x-auto pb-2 scrollbar-hide">
                        <div className="flex gap-2 min-w-max">
                            <button
                              onClick={() => setSelectedAccountId(null)}
                              className={`px-5 py-2.5 rounded-full text-xs font-bold whitespace-nowrap transition-all duration-300 border ${
                                !selectedAccountId 
                                  ? 'bg-gradient-to-r from-slate-800 to-slate-700 text-white border-slate-800 shadow-lg shadow-slate-200 scale-105' 
                                  : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
                              }`}
                            >
                                Все счета
                            </button>
                            {accounts.map(acc => (
                                <button
                                  key={acc.id}
                                  onClick={() => setSelectedAccountId(acc.id)}
                                  className={`px-5 py-2.5 rounded-full text-xs font-bold whitespace-nowrap transition-all duration-300 border ${
                                    selectedAccountId === acc.id 
                                      ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white border-indigo-600 shadow-lg shadow-indigo-200 scale-105' 
                                      : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
                                  }`}
                                >
                                    {acc.name}
                                </button>
                            ))}
                        </div>
                    </div>
                    {/* Gradient fade for scroll indicator */}
                    <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-indigo-50/50 to-transparent pointer-events-none"></div>
                  </div>
                )}

                {/* Stats Cards - без индикаторов прогресса, с иконками перед суммой */}
                {/* Stats Cards - как на фото: иконка слева, сверху текст, снизу сумма */}
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
  <div className="group bg-white p-5 rounded-3xl shadow-sm hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-emerald-200 hover:-translate-y-1">
      <div className="flex items-start gap-4">
          <div
              className="w-12 h-12 bg-emerald-100 rounded-2xl flex items-center justify-center text-emerald-600 flex-shrink-0 group-hover:bg-emerald-200 transition-colors">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                  <text x="5" y="18" fontSize="16" fontWeight="bold">₽</text>
              </svg>
          </div>
          <div className="flex-1">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">
                  Собрано средств
              </p>
              <p className="text-2xl font-bold text-slate-800">
                  {formatCurrency(calculatedStats.totalRevenue, appSettings.showCents)} ₽
              </p>
          </div>
      </div>
  </div>

    <div
        className="group bg-white p-5 rounded-3xl shadow-sm hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-amber-200 hover:-translate-y-1">
        <div className="flex items-start gap-4">
            <div
                className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center text-amber-600 flex-shrink-0 group-hover:bg-amber-200 transition-colors">
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      </div>
      <div className="flex-1">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">
          Долг клиентов
        </p>
        <p className="text-2xl font-bold text-slate-800">
          {formatCurrency(calculatedStats.totalOutstanding, appSettings.showCents)} ₽
        </p>
      </div>
    </div>
  </div>

  <div className="group bg-white p-5 rounded-3xl shadow-sm hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-blue-200 hover:-translate-y-1">
    <div className="flex items-start gap-4">
      <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600 flex-shrink-0 group-hover:bg-blue-200 transition-colors">
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
        </svg>
      </div>
      <div className="flex-1">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">
          Оборотные средства
        </p>
        <p className="text-2xl font-bold text-slate-800">
          {formatCurrency(currentWorkingCapital, appSettings.showCents)} ₽
        </p>
      </div>
    </div>
  </div>

  <div className="group bg-white p-5 rounded-3xl shadow-sm hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-indigo-200 hover:-translate-y-1">
    <div className="flex items-start gap-4">
      <div className="w-12 h-12 bg-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600 flex-shrink-0 group-hover:bg-indigo-200 transition-colors">
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      </div>
      <div className="flex-1">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">
          Продажи в рассрочку
        </p>
        <p className="text-2xl font-bold text-slate-800">
          {formatCurrency(calculatedStats.installmentSalesTotal, appSettings.showCents)} ₽
        </p>
      </div>
    </div>
  </div>
</div>

                {/* Two Column Layout */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Recent Contracts */}
                  <div className="bg-white/80 backdrop-blur-sm p-6 rounded-3xl shadow-sm border border-slate-100 hover:shadow-md transition-all">
                      <h3 className="text-lg font-semibold text-slate-700 mb-4 flex items-center gap-2">
                        <span className="w-1 h-5 bg-indigo-500 rounded-full"></span>
                        Последние договоры
                      </h3>
                      <div className="space-y-3">
                          {lastFiveSales.length === 0 ? (
                            <div className="text-center py-8 text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                              Нет договоров
                            </div>
                          ) : lastFiveSales.map((sale, idx) => (
                              <div key={sale.id} className="group flex items-center justify-between p-3 bg-slate-50 hover:bg-white rounded-xl transition-all hover:shadow-md border border-transparent hover:border-indigo-100 animate-in fade-in slide-in-from-bottom-2" style={{ animationDelay: `${idx * 50}ms` }}>
                                  <div>
                                      <p className="font-bold text-sm text-slate-800">{customers.find(c=>c.id === sale.customerId)?.name}</p>
                                      <p className="text-xs text-slate-500 mt-1">{sale.productName} • {formatDate(sale.startDate)}</p>
                                  </div>
                                  <button
                                    onClick={() => setSelectedSaleForModal(sale)}
                                    className="text-xs bg-gradient-to-r from-indigo-50 to-indigo-100 text-indigo-700 px-4 py-2 rounded-lg font-semibold hover:from-indigo-100 hover:to-indigo-200 transition-all group-hover:scale-105"
                                  >
                                    Детали
                                  </button>
                              </div>
                          ))}
                      </div>
                  </div>

                  {/* Quick Actions */}
                  <div className="bg-white/80 backdrop-blur-sm p-6 rounded-3xl shadow-sm border border-slate-100 hover:shadow-md transition-all">
                       <h3 className="text-lg font-semibold text-slate-700 mb-4 flex items-center gap-2">
                        <span className="w-1 h-5 bg-indigo-500 rounded-full"></span>
                        Быстрые действия
                      </h3>
                       <div className="space-y-4">
                          <button
                            onClick={() => onAction('CREATE_SALE')}
                            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-indigo-500 text-white py-4 rounded-xl font-semibold shadow-lg shadow-indigo-200 hover:shadow-xl hover:from-indigo-700 hover:to-indigo-600 transition-all hover:-translate-y-0.5"
                          >
                            <span className="text-lg">+</span> Новая рассрочка
                          </button>
                          <div className="grid grid-cols-2 gap-4">
                              <button
                                onClick={() => onAction('ADD_CUSTOMER')}
                                className="group w-full bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 py-4 rounded-xl font-medium transition-all border border-transparent hover:border-indigo-200"
                              >
                                <span className="block text-lg mb-1 group-hover:scale-110 transition-transform">👤</span>
                                + Клиент
                              </button>
                              <button
                                onClick={() => onAction('ADD_PRODUCT')}
                                className="group w-full bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 py-4 rounded-xl font-medium transition-all border border-transparent hover:border-indigo-200"
                              >
                                <span className="block text-lg mb-1 group-hover:scale-110 transition-transform">📦</span>
                                + Товар
                              </button>
                          </div>
                       </div>
                  </div>
                </div>
            </div>
        )}

        {/* Upcoming Payments Tab */}
        {activeTab === 'upcoming' && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-500" onClick={() => setActiveActionMenu(null)}>

              {/* Date Filters */}
              <div className="flex gap-2 p-1 bg-white/70 backdrop-blur-sm rounded-xl w-fit shadow-sm">
                  <button
                      onClick={() => setPaymentDateFilter('ALL')}
                      className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all duration-300 ${
                          paymentDateFilter === 'ALL' 
                            ? 'bg-gradient-to-r from-slate-800 to-slate-700 text-white shadow-md' 
                            : 'text-slate-600 hover:text-indigo-600'
                      }`}
                  >
                      Все
                  </button>
                  <button
                      onClick={() => setPaymentDateFilter('TODAY')}
                      className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all duration-300 ${
                          paymentDateFilter === 'TODAY' 
                            ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-md shadow-emerald-200' 
                            : 'text-slate-600 hover:text-emerald-600'
                      }`}
                  >
                      Сегодня
                  </button>
                  <button
                      onClick={() => setPaymentDateFilter('TOMORROW')}
                      className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all duration-300 ${
                          paymentDateFilter === 'TOMORROW' 
                            ? 'bg-gradient-to-r from-amber-500 to-amber-400 text-white shadow-md shadow-amber-200' 
                            : 'text-slate-600 hover:text-amber-500'
                      }`}
                  >
                      Завтра
                  </button>
              </div>

              {/* Payments List */}
              {upcomingAndOverduePayments.length === 0 ? (
                  <div className="text-center py-16 bg-white/80 backdrop-blur-sm rounded-2xl border border-dashed border-slate-200">
                    <div className="text-6xl mb-4 opacity-30">📅</div>
                    <p className="text-slate-400 font-medium">Нет платежей на сегодня и завтра</p>
                    <p className="text-xs text-slate-300 mt-1">Все платежи по расписанию</p>
                  </div>
              ) : (
                  <div className="space-y-3">
                    {upcomingAndOverduePayments.map((p, idx) => (
                        <div
                          key={p.sale.id}
                          className="group bg-white/90 backdrop-blur-sm p-5 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-indigo-200 relative animate-in fade-in slide-in-from-bottom-2"
                          style={{ animationDelay: `${idx * 100}ms` }}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className={`p-3 rounded-xl ${
                                        p.isTomorrow 
                                          ? 'bg-amber-100 text-amber-600 group-hover:bg-amber-200' 
                                          : p.isToday 
                                          ? 'bg-emerald-100 text-emerald-600 group-hover:bg-emerald-200'
                                          : 'bg-rose-100 text-rose-600 group-hover:bg-rose-200'
                                    } transition-all`}>
                                        {p.isTomorrow ? '⏰' : p.isToday ? '📆' : '⚠️'}
                                    </div>
                                    <div>
                                        <p className="font-bold text-slate-800 group-hover:text-indigo-600 transition-colors">{p.customerName}</p>
                                        <p className="text-xs text-slate-500 mt-1">{p.sale.productName}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="text-right">
                                        <p className="text-lg font-bold text-indigo-600">{formatCurrency(p.totalDue, appSettings.showCents)} ₽</p>
                                        {p.isToday && <p className="text-[10px] font-bold text-emerald-600">СЕГОДНЯ</p>}
                                        {p.isTomorrow && <p className="text-[10px] font-bold text-amber-600">ЗАВТРА</p>}
                                    </div>
                                    <div className="relative">
                                      <button
                                        onClick={(e) => handleActionClick(e, p.sale.id)}
                                        className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                                      >
                                        ⋮
                                      </button>

                                      {activeActionMenu === p.sale.id && (
                                          <div className="absolute right-0 top-8 bg-white shadow-xl rounded-xl z-20 w-48 overflow-hidden animate-in fade-in zoom-in border border-slate-100">
                                              <button
                                                onClick={() => onSelectCustomer(p.sale.customerId)}
                                                className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-indigo-50 flex items-center gap-3 transition-all"
                                              >
                                                <span className="text-indigo-500">👤</span> Инфо
                                              </button>
                                              <button
                                                onClick={() => onInitiatePayment(p.sale, p.totalDue)}
                                                className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-emerald-50 flex items-center gap-3 transition-all border-t border-slate-100"
                                              >
                                                <span className="text-emerald-500">💰</span> Добавить платеж
                                              </button>
                                          </div>
                                      )}
                                    </div>
                                </div>
                            </div>

                            {/* Progress indicator - удален */}
                        </div>
                    ))}
                  </div>
              )}
          </div>
        )}

        {/* Modal */}
        {selectedSaleForModal && (
            <SaleDetailsModal
                sale={selectedSaleForModal}
                customerName={customers.find(c => c.id === selectedSaleForModal.customerId)?.name || ''}
                onClose={() => setSelectedSaleForModal(null)}
                appSettings={appSettings}
            />
        )}
      </div>
    </div>
  );
};

export default Dashboard;