import React, { useMemo, useState, useEffect } from 'react';
import { Sale, Customer, Account, AppSettings, Investor} from '../types';
import { ICONS } from '../constants';
import { formatCurrency, formatDate } from '../src/utils';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import {createPortal} from "react-dom";


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
  onViewSchedule: (sale: Sale) => void;
  accounts: Account[];
  appSettings: AppSettings;
  investors: Investor[];
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

                <div className="p-6 space-y-4 bg-slate-50">
                    <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-slate-500">Статус договора</span>
                        <span className={`px-3 py-1.5 rounded-full text-xs font-bold border ${status.color}`}>
                            {status.label}
                        </span>
                    </div>

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

                    <div className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm space-y-3">
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-slate-500">Общая сумма</span>
                            <span className="text-lg font-bold text-indigo-600 whitespace-nowrap">{formatCurrency(sale.totalAmount, appSettings.showCents)} ₽</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-slate-500">Первый взнос</span>
                            <span className="font-medium text-slate-700 whitespace-nowrap">{formatCurrency(sale.downPayment, appSettings.showCents)} ₽</span>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-dashed border-slate-200">
                            <span className="text-sm font-medium text-slate-600">Остаток долга</span>
                            <span className="text-lg font-bold text-amber-600 whitespace-nowrap">{formatCurrency(sale.remainingAmount, appSettings.showCents)} ₽</span>
                        </div>
                    </div>

                    {sale.paymentPlan && sale.paymentPlan.length > 0 && (
                        <div className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm">
                            <p className="text-sm font-medium text-slate-700 mb-3">График платежей</p>
                            <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                                {sale.paymentPlan.slice(0, 3).map((payment, idx) => (
                                    <div key={idx} className="flex justify-between items-center text-xs">
                                        <span className="text-slate-500">{formatDate(payment.date)}</span>
                                        <span className="font-medium text-slate-700 whitespace-nowrap">{formatCurrency(payment.amount, appSettings.showCents)} ₽</span>
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

                <div className="p-4 border-t border-slate-200 bg-white">
                    <button onClick={onClose} className="w-full py-3.5 bg-gradient-to-r from-slate-800 to-slate-700 text-white font-bold rounded-xl hover:from-slate-900 hover:to-slate-800 shadow-lg shadow-slate-200 transition-all">
                        Закрыть
                    </button>
                </div>
            </div>
        </div>
    );
};

const PaymentActionModal = ({
    sale,
    customerName,
    onClose,
    onSelectCustomer,
    onInitiatePayment,
    onViewSchedule,
    totalDue,
    appSettings
}: {
    sale: Sale,
    customerName: string,
    onClose: () => void,
    onSelectCustomer: (id: string) => void,
    onInitiatePayment: (sale: Sale, amount: number) => void,
    onViewSchedule: (sale: Sale) => void,
    totalDue: number,
    appSettings: AppSettings
}) => {
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gradient-to-br from-slate-900/80 to-indigo-900/60 backdrop-blur-md animate-in fade-in zoom-in duration-300"
            onClick={onClose}
        >
            <div
                className="bg-white backdrop-blur-sm w-full max-w-md rounded-3xl shadow-2xl overflow-hidden border border-white/20"
                onClick={e => e.stopPropagation()}
            >
                <div className="relative p-6 bg-gradient-to-r from-indigo-600 to-indigo-500 text-white">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-8 -mt-8 blur-2xl"></div>
                    <h3 className="text-xl font-bold mb-1">{customerName}</h3>
                    <p className="text-indigo-100 text-sm flex items-center gap-1">
                        <span className="opacity-70">📦</span> {sale.productName}
                    </p>
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 w-8 h-8 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center backdrop-blur-sm transition-all"
                    >
                        <span className="text-lg">✕</span>
                    </button>
                </div>

                <div className="p-6 pb-4">
                    <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100">
                        <p className="text-sm text-slate-500 mb-1">Сумма к оплате</p>
                        <p className="text-2xl font-bold text-indigo-600">
                            {formatCurrency(totalDue, appSettings.showCents)} ₽
                        </p>
                    </div>
                </div>

                <div className="px-6 pb-6 space-y-2">
                    <button
                        onClick={() => { onSelectCustomer(sale.customerId); onClose(); }}
                        className="w-full text-left px-4 py-3.5 text-sm text-slate-700 hover:bg-indigo-50 flex items-center gap-3 transition-colors rounded-xl"
                    >
                        <span className="text-indigo-500">👤</span>
                        <span>Инфо о клиенте</span>
                    </button>

                    <button
                        onClick={() => { onInitiatePayment(sale, totalDue); onClose(); }}
                        className="w-full text-left px-4 py-3.5 text-sm text-slate-700 hover:bg-emerald-50 flex items-center gap-3 transition-colors rounded-xl border-t border-slate-100 pt-3.5 mt-1"
                    >
                        <span className="text-emerald-500">💰</span>
                        <span>Добавить платеж</span>
                    </button>

                    <button
                        onClick={() => { onViewSchedule(sale); onClose(); }}
                        className="w-full text-left px-4 py-3.5 text-sm text-slate-700 hover:bg-indigo-50 flex items-center gap-3 transition-colors rounded-xl border-t border-slate-100 pt-3.5 mt-1"
                    >
                        <span className="text-indigo-500"><CalendarIcon size={18}/></span>
                        <span>График платежей</span>
                    </button>
                </div>
            </div>
        </div>
    );
};



// ─────────────────────────────────────────────────────────────
// 📋 Модалка с детализацией платежей
// ─────────────────────────────────────────────────────────────
const PaymentDetailsModal = ({
  type,
  sales,
  customers,
  investors,
  selectedAccountId,
  onClose,
  onInitiatePayment,
  onViewSchedule,
  appSettings
}: {
  type: 'expected' | 'received';
  sales: Sale[];
  customers: Customer[];
  investors: Investor[];
  selectedAccountId?: string | null;
  onClose: () => void;
  onInitiatePayment?: (sale: Sale, amount: number) => void;
  onViewSchedule?: (sale: Sale) => void;
  appSettings: AppSettings;
}) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const today = new Date(); today.setHours(0,0,0,0);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const items = useMemo(() => {
    const result: Array<{
      sale: Sale;
      customerName: string;
      amount: number;
      date: string;
      isOverdue: boolean;
    }> = [];

    const investorIds = new Set(investors.map(i => i.id));

    // 🔹 ФИЛЬТРАЦИЯ ПО ВЫБРАННОМУ СЧЁТУ
    const filteredSales = selectedAccountId
        ? sales.filter(s => s.accountId === selectedAccountId)
        : sales;

    filteredSales.forEach(sale => { // ← Используем filteredSales вместо sales
      if (sale.customerId.startsWith('system_')) return;
      if (investorIds.has(sale.customerId)) return;


      const customer = customers.find(c => c.id === sale.customerId);

            if (type === 'expected') {
        // 🔹 Проверяем общую просрочку перед добавлением платежей клиента
        let expectedTotalForCheck = sale.downPayment;
        sale.paymentPlan.forEach(p => {
            if (!p.isRealPayment && new Date(p.date) < today) expectedTotalForCheck += p.amount;
        });
        const clientOverdue = Math.max(0, expectedTotalForCheck - (sale.totalAmount - sale.remainingAmount));

        // ⛔ Если клиент в графике (просрочки нет) — не показываем его здесь
        if (clientOverdue <= 0) return;

        // 🔹 Ожидаемые: плановые, неоплаченные, дата в этом месяце
        sale.paymentPlan.forEach(p => {
          if ((p.isRealPayment === false || p.isRealPayment === undefined) && !p.isPaid) {
            const paymentDate = new Date(p.date);
            if (paymentDate >= monthStart && paymentDate <= monthEnd) {
              const isOverdue = paymentDate < today;
              result.push({
                sale,
                customerName: customer?.name || 'Неизвестно',
                amount: p.amount,
                date: p.date,
                isOverdue
              });
            }
          }
        });
      } else {

        sale.paymentPlan.forEach(p => {
          if (p.isPaid && p.isRealPayment !== false) {
            const paymentDate = new Date(p.date);
            if (paymentDate >= monthStart && paymentDate <= monthEnd) {
              result.push({
                sale,
                customerName: customer?.name || 'Неизвестно',
                amount: p.amount,
                date: p.date,
                isOverdue: false
              });
            }
          }
        });
      }
    });

    // Сортировка: сначала просроченные, потом по дате
    return result.sort((a, b) => {
      if (a.isOverdue && !b.isOverdue) return -1;
      if (!a.isOverdue && b.isOverdue) return 1;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
}, [sales, customers, investors, type, monthStart, monthEnd, selectedAccountId]);

  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);

// 🔹 РАЗДЕЛЯЕМ на платежи по графику и первые взносы
const { installmentTotal, downPaymentTotal } = useMemo(() => {
    const total = items.reduce((sum, item) => sum + item.amount, 0);
    return {
        installmentTotal: Math.round(total * 100) / 100,
        downPaymentTotal: 0 // 🔹 Больше не используется, но оставили для совместимости
    };
}, [items]);
  const title = type === 'expected' ? 'Ожидаемые платежи' : 'Полученные платежи';
  const emptyText = type === 'expected'
    ? 'Нет ожидаемых платежей в этом месяце'
    : 'Нет полученных платежей в этом месяце';

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Шапка */}
        <div className={`px-4 py-3 flex items-center justify-between shrink-0 ${
          type === 'expected' 
            ? 'bg-gradient-to-r from-amber-500 to-orange-500' 
            : 'bg-gradient-to-r from-emerald-500 to-teal-500'
        }`}>
          <div className="flex items-center gap-3">
            <div className="text-white bg-white/20 p-2 rounded-xl">
              {type === 'expected' ? <CalendarIcon size={18} />  : <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="currentColor"><text x="4" y="17" fontSize="14">✓</text></svg>}
            </div>
            <h3 className="text-base font-bold text-white">{title}</h3>
          </div>
          <button onClick={onClose} className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-xl transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

       {/* Итого */}
<div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
  <span className="text-sm text-slate-500">Итого</span>
  <span className="text-lg font-bold text-slate-800">
    {formatCurrency(installmentTotal, appSettings.showCents)} ₽
  </span>
</div>
        {/* Список */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {items.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <div className="text-4xl mb-2 opacity-30">📭</div>
              <p className="text-sm">{emptyText}</p>
            </div>
          ) : items.map((item, idx) => (
            <div
              key={`${item.sale.id}-${item.date}-${idx}`}
              className="bg-white p-3 rounded-xl border border-slate-100 hover:border-indigo-200 hover:shadow-sm transition-all"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-800 text-sm truncate">{item.customerName}</p>
                  <p className="text-xs text-slate-500 truncate">{item.sale.productName}</p>
                </div>
                <div className="text-right ml-3">
                  <p className={`font-bold text-sm ${item.isOverdue ? 'text-red-600' : 'text-slate-800'}`}>
                    {formatCurrency(item.amount, appSettings.showCents)} ₽
                  </p>
                  {item.isOverdue && (
                    <span className="text-[10px] text-red-500 font-medium">Просрочено</span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span>{formatDate(item.date)}</span>
                <div className="flex gap-1">
                  {type === 'expected' && onInitiatePayment && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onInitiatePayment(item.sale, item.amount); onClose(); }}
                      className="px-2 py-1 bg-emerald-50 text-emerald-600 rounded-lg font-medium hover:bg-emerald-100 transition-colors"
                    >
                      + Платёж
                    </button>
                  )}
                  {onViewSchedule && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onViewSchedule(item.sale); onClose(); }}
                      className="px-2 py-1 bg-indigo-50 text-indigo-600 rounded-lg font-medium hover:bg-indigo-100 transition-colors"
                    >
                      График
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Кнопка закрытия */}
        <button
          onClick={onClose}
          className="py-3 text-slate-400 text-sm hover:text-slate-600 hover:bg-slate-50 transition-colors shrink-0 border-t border-slate-100"
        >
          Закрыть
        </button>
      </div>
    </div>,
    document.body
  );
};

const Dashboard: React.FC<DashboardProps> = ({
    sales,
    customers,
    stats: globalStats,
    workingCapital: globalWorkingCapital,
    accountBalances,
    onAction,
    onSelectCustomer,
    onInitiatePayment,
    onViewSchedule,
    accounts,
    appSettings,
    investors, 
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'upcoming'>('overview');
  const [selectedSaleForModal, setSelectedSaleForModal] = useState<Sale | null>(null);
  const [selectedPaymentForAction, setSelectedPaymentForAction] = useState<{
      sale: Sale;
      customerName: string;
      totalDue: number;
  } | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [paymentDateFilter, setPaymentDateFilter] = useState<'ALL' | 'TODAY' | 'TOMORROW'>('ALL');

  // В начале компонента Dashboard, рядом с другими useState:
const [selectedPaymentType, setSelectedPaymentType] = useState<'expected' | 'received' | null>(null);

const [selectedCalendarDate, setSelectedCalendarDate] = useState<Date | null>(null);
const [showCalendarPicker, setShowCalendarPicker] = useState(false);
const [calendarMonth, setCalendarMonth] = useState(new Date());

 const calculatedStats = useMemo(() => {
    const filteredSales = selectedAccountId
        ? sales.filter(s => s.accountId === selectedAccountId)
        : sales;

    let totalRevenue = 0;
    let totalOutstanding = 0;
    let installmentSalesTotal = 0;

    // 🔹 Создаём Set инвесторских ID для быстрой проверки
    const investorIds = new Set(investors.map(i => i.id));

    filteredSales.forEach(sale => {
        const isSystemTransaction = sale.customerId.startsWith('system_');
        const isInvestorTransaction = investorIds.has(sale.customerId); // ← новая проверка

        // Исключаем и системные, и инвесторские транзакции
        if (!isSystemTransaction && !isInvestorTransaction) {
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
}, [sales, selectedAccountId, investors]); // ← добавили investors в зависимости


  const profitStats = useMemo(() => {
    const filteredSales = selectedAccountId
        ? sales.filter(s => s.accountId === selectedAccountId)
        : sales;

    let receivedProfit = 0;
    let expectedProfit = 0;

    filteredSales.forEach(sale => {
        if (sale.customerId.startsWith('system_')) return;
        if (!sale.buyPrice || sale.buyPrice <= 0) return;

        const totalSaleProfit = sale.totalAmount - sale.buyPrice;
        if (totalSaleProfit <= 0) return;

        // 🔹 Безопасный поиск счёта
        const account = accounts?.find(a => a?.id === sale.accountId);
        let managerShare = 1;

        // 🔹 Безопасная проверка инвестора
        if (account?.ownerId && investors?.length) {
            const investor = investors.find(i => i?.id === account.ownerId);
            if (investor) {
                managerShare = (100 - investor.profitPercentage) / 100;
            }
        }

        const profitMargin = totalSaleProfit / sale.totalAmount;

        const collectedPayments = sale.downPayment + sale.paymentPlan
            .filter(p => p.isPaid && p.isRealPayment !== false)
            .reduce((sum, p) => sum + p.amount, 0);

        receivedProfit += collectedPayments * profitMargin;

        if (sale.status === 'ACTIVE' || sale.status === 'DRAFT') {
    expectedProfit += sale.remainingAmount * profitMargin;
}
    });

    return {
        receivedProfit: Math.round(receivedProfit * 100) / 100,
        expectedProfit: Math.round(expectedProfit * 100) / 100
    };
},  [sales, selectedAccountId]);

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
      if (sale.status !== 'ACTIVE' && sale.status !== 'DRAFT') return;

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

             // Внутри useMemo для upcomingAndOverduePayments добавьте проверку selectedCalendarDate:

let include = false;
if (selectedCalendarDate) {
  // Если выбрана дата в календаре — показываем только её
  const selectedDateStr = selectedCalendarDate.toDateString();
  if (paymentDate.toDateString() === selectedDateStr) include = true;
} else if (paymentDateFilter === 'ALL') {
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
          totalDue: Math.round(relevantAmount * 100) / 100,
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



// 📊 Ожидаемые платежи в этом месяце (исправленная версия)
const expectedPaymentsThisMonth = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    monthStart.setHours(0, 0, 0, 0); // 🔹 Нормализуем
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const filteredSales = selectedAccountId
        ? sales.filter(s => s.accountId === selectedAccountId)
        : sales;

    let expected = 0;

    filteredSales.forEach(sale => {
        if (sale.customerId.startsWith('system_')) return;
        if (investors.some(i => i.id === sale.customerId)) return;
        // 🔹 Если нужно — верни фильтр по статусу:
        if (sale.status !== 'ACTIVE' && sale.status !== 'DRAFT') return;

        sale.paymentPlan.forEach(payment => {
            // 🔹 Надёжная проверка: только плановые платежи
            if (payment.isRealPayment !== true) {
                const paymentDate = new Date(payment.date);
                paymentDate.setHours(0, 0, 0, 0); // 🔹 Нормализуем дату!

                if (paymentDate >= monthStart && paymentDate <= monthEnd) {
                    expected += payment.amount;
                }
            }
        });
    });

    return Math.round(expected * 100) / 100;
}, [sales, investors, selectedAccountId]);

// 💰 Полученные платежи за этот месяц (фактически оплаченные)

const receivedPaymentsThisMonth = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const filteredSales = selectedAccountId
        ? sales.filter(s => s.accountId === selectedAccountId)
        : sales;

    let received = 0;

    filteredSales.forEach(sale => {
        if (sale.customerId.startsWith('system_')) return;
        if (investors.some(i => i.id === sale.customerId)) return;

        // 🔥 УБРАЛИ первый взнос — считаем только оплаченные платежи по графику
        sale.paymentPlan.forEach(payment => {
            if (payment.isPaid && payment.isRealPayment !== false) {
                const paymentDate = new Date(payment.date);
                if (paymentDate >= monthStart && paymentDate <= monthEnd) {
                    received += payment.amount;
                }
            }
        });
    });

    return Math.round(received * 100) / 100;
}, [sales, investors, selectedAccountId]);





// 💰 Ожидаемая прибыль в этом месяце (от плановых платежей)
const expectedProfitThisMonth = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    monthStart.setHours(0, 0, 0, 0);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const filteredSales = selectedAccountId
        ? sales.filter(s => s.accountId === selectedAccountId)
        : sales;

    let expectedProfit = 0;

    filteredSales.forEach(sale => {
        if (sale.customerId.startsWith('system_')) return;
        if (investors.some(i => i.id === sale.customerId)) return;
        if (!sale.buyPrice || sale.buyPrice <= 0) return;
        if (sale.totalAmount <= 0) return;

        // Маржа прибыли от этой продажи
        const profitMargin = (sale.totalAmount - sale.buyPrice) / sale.totalAmount;
        if (profitMargin <= 0) return;

        // 🔹 Считаем прибыль только от плановых НЕоплаченных платежей этого месяца
        sale.paymentPlan.forEach(payment => {
            if (payment.isRealPayment !== true && !payment.isPaid) {
                const paymentDate = new Date(payment.date);
                paymentDate.setHours(0, 0, 0, 0);

                if (paymentDate >= monthStart && paymentDate <= monthEnd) {
                    expectedProfit += payment.amount * profitMargin;
                }
            }
        });
    });

    return Math.round(expectedProfit * 100) / 100;
}, [sales, investors, selectedAccountId]);


// 💰 Полученная прибыль в этом месяце (от фактических поступлений)
const receivedProfitThisMonth = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    monthStart.setHours(0, 0, 0, 0);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const filteredSales = selectedAccountId
        ? sales.filter(s => s.accountId === selectedAccountId)
        : sales;

    let receivedProfit = 0;

    filteredSales.forEach(sale => {
        if (sale.customerId.startsWith('system_')) return;
        if (investors.some(i => i.id === sale.customerId)) return;
        if (!sale.buyPrice || sale.buyPrice <= 0) return;
        if (sale.totalAmount <= 0) return;

        // Маржа прибыли
        const profitMargin = (sale.totalAmount - sale.buyPrice) / sale.totalAmount;
        if (profitMargin <= 0) return;

        // 🔹 Считаем прибыль от оплаченных платежей этого месяца
        sale.paymentPlan.forEach(payment => {
            if (payment.isPaid && payment.isRealPayment !== false) {
                const paymentDate = new Date(payment.date);
                paymentDate.setHours(0, 0, 0, 0);

                if (paymentDate >= monthStart && paymentDate <= monthEnd) {
                    receivedProfit += payment.amount * profitMargin;
                }
            }
        });
    });

    return Math.round(receivedProfit * 100) / 100;
}, [sales, investors, selectedAccountId]);






const getPaymentsByDate = useMemo(() => {
  const map = new Map<string, number>();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  sales.forEach(sale => {
    if (sale.status !== 'ACTIVE' && sale.status !== 'DRAFT') return;

    const planItems = sale.paymentPlan
      .filter(p => p.isRealPayment === false || p.isRealPayment === undefined)
      .filter(p => !p.isPaid);

    planItems.forEach(p => {
      const paymentDate = new Date(p.date);
      paymentDate.setHours(0, 0, 0, 0);
      const dateKey = paymentDate.toDateString();
      const current = map.get(dateKey) || 0;
      map.set(dateKey, current + p.amount);
    });
  });

  return map;
}, [sales]);



useEffect(() => {
  const handleClickOutside = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('[data-calendar-picker]')) {
      setShowCalendarPicker(false);
    }
  };
  if (showCalendarPicker) {
    document.addEventListener('click', handleClickOutside);
  }
  return () => document.removeEventListener('click', handleClickOutside);
}, [showCalendarPicker]);


  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50/30 pb-24 w-full">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-6 animate-in fade-in slide-in-from-top-4 duration-500">

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
                    <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-indigo-50/50 to-transparent pointer-events-none"></div>
                  </div>
                )}

                {/* Карточки статистики: 2 в ряд на мобилках, 4 на больших экранах */}
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">

                    {/* 1. Собрано средств */}
                    <div
                        className="group bg-white p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-emerald-200 flex flex-col relative overflow-hidden cursor-default">
                        {/* Декоративный круг на фоне */}
                        <div
                            className="absolute -right-6 -top-6 w-24 h-24 bg-emerald-50 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-700 pointer-events-none"></div>

                        <div
                            className="w-10 h-10 sm:w-12 sm:h-12 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600 mb-4 z-10 relative group-hover:bg-emerald-500 group-hover:text-white transition-colors duration-300 shadow-sm">
                            <svg className="w-5 h-5 sm:w-6 sm:h-6" viewBox="0 0 24 24" fill="currentColor">
                                <text x="5" y="18" fontSize="16" fontWeight="bold">₽</text>
                            </svg>
                        </div>
                        <div className="z-10 relative mt-auto">
                            <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wide mb-1 leading-tight">
                                Собрано
                            </p>
                            <p className="text-lg sm:text-2xl font-bold text-slate-800 break-words leading-none">
                                {formatCurrency(calculatedStats.totalRevenue, appSettings.showCents)}
                                <span className="text-xs sm:text-sm text-slate-400 ml-1 font-bold">₽</span>
                            </p>
                        </div>
                    </div>

                    {/* 2. Долг клиентов */}
                    <div
                        className="group bg-white p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-amber-200 flex flex-col relative overflow-hidden cursor-default">
                        <div
                            className="absolute -right-6 -top-6 w-24 h-24 bg-amber-50 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-700 pointer-events-none"></div>

                        <div
                            className="w-10 h-10 sm:w-12 sm:h-12 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600 mb-4 z-10 relative group-hover:bg-amber-500 group-hover:text-white transition-colors duration-300 shadow-sm">
                            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor"
                                 viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                                      d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"/>
                            </svg>
                        </div>
                        <div className="z-10 relative mt-auto">
                            <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wide mb-1 leading-tight">
                                Долг клиентов
                            </p>
                            <p className="text-lg sm:text-2xl font-bold text-slate-800 break-words leading-none">
                                {formatCurrency(calculatedStats.totalOutstanding, appSettings.showCents)}
                                <span className="text-xs sm:text-sm text-slate-400 ml-1 font-bold">₽</span>
                            </p>
                        </div>
                    </div>

                    {/* 3. Оборотные средства */}
                    <div
                        className="group bg-white p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-blue-200 flex flex-col relative overflow-hidden cursor-default">
                        <div
                            className="absolute -right-6 -top-6 w-24 h-24 bg-blue-50 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-700 pointer-events-none"></div>

                        <div
                            className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600 mb-4 z-10 relative group-hover:bg-blue-500 group-hover:text-white transition-colors duration-300 shadow-sm">
                            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor"
                                 viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                                      d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/>
                            </svg>
                        </div>
                        <div className="z-10 relative mt-auto">
                            <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wide mb-1 leading-tight">
                                В обороте
                            </p>
                            <p className="text-lg sm:text-2xl font-bold text-slate-800 break-words leading-none">
                                {formatCurrency(currentWorkingCapital, appSettings.showCents)}
                                <span className="text-xs sm:text-sm text-slate-400 ml-1 font-bold">₽</span>
                            </p>

                        </div>
                    </div>

                    {/* 4. Продажи в рассрочку */}
                    <div
                        className="group bg-white p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-indigo-200 flex flex-col relative overflow-hidden cursor-default">
                        <div
                            className="absolute -right-6 -top-6 w-24 h-24 bg-indigo-50 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-700 pointer-events-none"></div>

                        <div
                            className="w-10 h-10 sm:w-12 sm:h-12 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600 mb-4 z-10 relative group-hover:bg-indigo-500 group-hover:text-white transition-colors duration-300 shadow-sm">
                            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor"
                                 viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                                      d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
                            </svg>
                        </div>
                        <div className="z-10 relative mt-auto">
                            <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wide mb-1 leading-tight">
                                Продажи
                            </p>
                            <p className="text-lg sm:text-2xl font-bold text-slate-800 break-words leading-none">
                                {formatCurrency(calculatedStats.installmentSalesTotal, appSettings.showCents)}
                                <span className="text-xs sm:text-sm text-slate-400 ml-1 font-bold">₽</span>
                            </p>
                        </div>
                    </div>



                     {/* 7. Ожидаемые платежи в этом месяце — СТАТИЧНАЯ КАРТОЧКА */}
                    <div
                        className="bg-white p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] border border-slate-100 flex flex-col relative overflow-hidden cursor-default"
                        // 🔥 УБРАЛИ: onClick, hover-эффекты, cursor-pointer
                    >
                        <div
                            className="absolute -right-6 -top-6 w-24 h-24 bg-amber-50 rounded-full opacity-50 pointer-events-none"></div>
                        <div
                            className="w-10 h-10 sm:w-12 sm:h-12 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600 mb-4 z-10 relative shadow-sm">
                            <CalendarIcon size={20}/>
                        </div>
                        <div className="z-10 relative mt-auto">
                            <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wide mb-1 leading-tight">
                                Ожидаемые платежи
                            </p>
                            <p className="text-lg sm:text-2xl font-bold text-slate-800 break-words leading-none">
                                {formatCurrency(expectedPaymentsThisMonth, appSettings.showCents)}
                                <span className="text-xs sm:text-sm text-slate-400 ml-1 font-bold">₽</span>
                            </p>
                            <p className="text-[10px] sm:text-xs text-slate-400 mt-1">От клиентов в этом месяце</p>
                        </div>

                    </div>

                    {/* 8. Полученные платежи за этот месяц */}
                    <div
                        className="group bg-white p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-emerald-200 flex flex-col relative overflow-hidden cursor-default"
                        onClick={() => setSelectedPaymentType('received')}>
                        <div
                            className="absolute -right-6 -top-6 w-24 h-24 bg-emerald-50 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-700 pointer-events-none"></div>
                        <div
                            className="w-10 h-10 sm:w-12 sm:h-12 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600 mb-4 z-10 relative group-hover:bg-emerald-500 group-hover:text-white transition-colors duration-300 shadow-sm">
                            <svg className="w-5 h-5 sm:w-6 sm:h-6" viewBox="0 0 24 24" fill="currentColor">
                                <text x="5" y="18" fontSize="16" fontWeight="bold">✓</text>
                            </svg>
                        </div>
                        <div className="z-10 relative mt-auto">
                            <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wide mb-1 leading-tight">
                                Получено в этом месяце
                            </p>
                            <p className="text-lg sm:text-2xl font-bold text-slate-800 break-words leading-none">
                                {formatCurrency(receivedPaymentsThisMonth, appSettings.showCents)}
                                <span className="text-xs sm:text-sm text-slate-400 ml-1 font-bold">₽</span>
                            </p>
                            <p className="text-[10px] sm:text-xs text-slate-400 mt-1">Нажмите для деталей</p>
                        </div>
                        <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                            <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none"
                                 stroke="currentColor" strokeWidth="2">
                                <polyline points="9 18 15 12 9 6"/>
                            </svg>
                        </div>
                    </div>


                       {/* 6. Ожидаемая прибыль */}

                    <div
                        className="group bg-white p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-blue-200 flex flex-col relative overflow-hidden cursor-default">
                        <div
                            className="absolute -right-6 -top-6 w-24 h-24 bg-blue-50 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-700 pointer-events-none"></div>
                        <div
                            className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600 mb-4 z-10 relative group-hover:bg-blue-500 group-hover:text-white transition-colors duration-300 shadow-sm">
                            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor"
                                 viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                                      d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                            </svg>
                        </div>
                        <div className="z-10 relative mt-auto">
                            <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wide mb-1 leading-tight">
                                Ожидается прибыли
                            </p>
                            <p className="text-lg sm:text-2xl font-bold text-slate-800 break-words leading-none">
                                {formatCurrency(profitStats.expectedProfit, appSettings.showCents)}
                                <span className="text-xs sm:text-sm text-slate-400 ml-1 font-bold">₽</span>
                            </p>

                        </div>
                    </div>


                    {/* 5. Полученная прибыль */}
                    <div
                        className="group bg-white p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-emerald-200 flex flex-col relative overflow-hidden cursor-default">
                        <div
                            className="absolute -right-6 -top-6 w-24 h-24 bg-emerald-50 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-700 pointer-events-none"></div>
                        <div
                            className="w-10 h-10 sm:w-12 sm:h-12 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600 mb-4 z-10 relative group-hover:bg-emerald-500 group-hover:text-white transition-colors duration-300 shadow-sm">
                            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor"
                                 viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                                      d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/>
                            </svg>
                        </div>
                        <div className="z-10 relative mt-auto">
                            <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wide mb-1 leading-tight">
                                Получено прибыли
                            </p>
                            <p className="text-lg sm:text-2xl font-bold text-slate-800 break-words leading-none">
                                {formatCurrency(profitStats.receivedProfit, appSettings.showCents)}
                                <span className="text-xs sm:text-sm text-slate-400 ml-1 font-bold">₽</span>
                            </p>
                        </div>
                    </div>




                </div>












                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div
                        className="bg-white/80 backdrop-blur-sm p-6 rounded-3xl shadow-sm border border-slate-100 hover:shadow-md transition-all">
                        <h3 className="text-lg font-semibold text-slate-700 mb-4 flex items-center gap-2">
                            <span className="w-1 h-5 bg-indigo-500 rounded-full"></span>
                            Последние договоры
                        </h3>
                        <div className="space-y-3">
                            {lastFiveSales.length === 0 ? (
                                <div
                                    className="text-center py-8 text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                                    Нет договоров
                                </div>
                            ) : lastFiveSales.map((sale, idx) => (
                                <div key={sale.id}
                                     className="group flex items-center justify-between p-3 bg-slate-50 hover:bg-white rounded-xl transition-all hover:shadow-md border border-transparent hover:border-indigo-100 animate-in fade-in slide-in-from-bottom-2"
                                     style={{animationDelay: `${idx * 50}ms`}}>
                                    <div className="min-w-0">
                                        <p className="font-bold text-sm text-slate-800 truncate">{customers.find(c => c.id === sale.customerId)?.name}</p>
                                        <p className="text-xs text-slate-500 mt-1">{sale.productName} • {formatDate(sale.startDate)}</p>
                                  </div>
                                  <button
                                    onClick={() => setSelectedSaleForModal(sale)}
                                    className="text-xs bg-gradient-to-r from-indigo-50 to-indigo-100 text-indigo-700 px-4 py-2 rounded-lg font-semibold hover:from-indigo-100 hover:to-indigo-200 transition-all group-hover:scale-105 whitespace-nowrap"
                                  >
                                    Детали
                                  </button>
                              </div>
                          ))}
                      </div>
                  </div>

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
  <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-500">
    {/* 🔹 Фильтры + Календарь */}
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1 p-1 bg-white/70 backdrop-blur-sm rounded-xl shadow-sm">
        <button
          onClick={() => { setSelectedCalendarDate(null); setPaymentDateFilter('ALL'); }}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all duration-300 ${
            !selectedCalendarDate && paymentDateFilter === 'ALL'
              ? 'bg-gradient-to-r from-slate-800 to-slate-700 text-white shadow-md'
              : 'text-slate-600 hover:text-indigo-600'
          }`}
        >
          Все
        </button>
        <button
          onClick={() => { setSelectedCalendarDate(null); setPaymentDateFilter('TODAY'); }}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all duration-300 ${
            !selectedCalendarDate && paymentDateFilter === 'TODAY'
              ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-md shadow-emerald-200'
              : 'text-slate-600 hover:text-emerald-600'
          }`}
        >
          Сегодня
        </button>
        <button
          onClick={() => { setSelectedCalendarDate(null); setPaymentDateFilter('TOMORROW'); }}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all duration-300 ${
            !selectedCalendarDate && paymentDateFilter === 'TOMORROW'
              ? 'bg-gradient-to-r from-amber-500 to-amber-400 text-white shadow-md shadow-amber-200'
              : 'text-slate-600 hover:text-amber-500'
          }`}
        >
          Завтра
        </button>
      </div>
      
      {/* 🔹 Кнопка календаря */}
      <div className="relative" data-calendar-picker>
        <button
          onClick={() => {
            setShowCalendarPicker(!showCalendarPicker);
            if (!showCalendarPicker) {
              setSelectedCalendarDate(null);
              setPaymentDateFilter('ALL');
            }
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all duration-300 border ${
            selectedCalendarDate
              ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white border-indigo-600 shadow-md shadow-indigo-200'
              : 'bg-white/70 backdrop-blur-sm text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
          }`}
        >
          <CalendarIcon size={16} />
          {selectedCalendarDate ? formatDate(selectedCalendarDate.toLocaleDateString('ru-RU')) : 'Календарь'}
          {selectedCalendarDate && (
            <button
              onClick={(e) => { e.stopPropagation(); setSelectedCalendarDate(null); }}
              className="ml-1 w-4 h-4 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center"
            >
              ✕
            </button>
          )}
        </button>
        
        {/* 🔹 Выпадающий календарь */}
        {showCalendarPicker && (
          <div className="absolute top-full left-0 mt-2 z-50 bg-white rounded-2xl shadow-2xl border border-slate-200 p-4 min-w-[280px] animate-in fade-in zoom-in-95 duration-200">
            {/* Заголовок календаря */}
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1))}
                className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <ChevronLeft size={18} />
              </button>
              <span className="text-sm font-bold text-slate-700">
                {calendarMonth.toLocaleString('ru-RU', { month: 'long', year: 'numeric' })}
              </span>
              <button
                onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1))}
                className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <ChevronRight size={18} />
              </button>
            </div>
            
            {/* Сетка дней */}
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-slate-400 mb-1">
              {['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d => <span key={d}>{d}</span>)}
            </div>
            {/* Сетка дней */}
<div className="grid grid-cols-7 gap-1">
  {(() => {
    const days: JSX.Element[] = [];
    const firstDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const lastDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0);
    const startOffset = (firstDay.getDay() + 6) % 7; // Пн = 0

    // Пустые ячейки до первого дня месяца
    for (let i = 0; i < startOffset; i++) {
      days.push(<div key={`empty-${i}`} className="aspect-square" />);
    }

    // Дни месяца
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), d);
      date.setHours(0, 0, 0, 0);
      const dateKey = date.toDateString();

      // ✅ ИСПРАВЛЕНО: используем getPaymentsByDate из useMemo
      const amount = getPaymentsByDate.get(dateKey) || 0;

      const hasPayments = amount > 0;
      const isToday = date.toDateString() === new Date().toDateString();
      const isSelected = selectedCalendarDate?.toDateString() === dateKey;

      days.push(
        <button
          key={d}
          onClick={() => {
            setSelectedCalendarDate(date);
            setShowCalendarPicker(false);
          }}
          className={`aspect-square rounded-lg text-xs flex flex-col items-center justify-center relative transition-all ${
            isSelected
              ? 'bg-indigo-600 text-white font-bold shadow-md'
              : isToday
                ? 'bg-indigo-100 text-indigo-700 font-semibold'
                : hasPayments
                  ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : 'hover:bg-slate-100 text-slate-600'
          }`}
        >
          <span>{d}</span>
          {hasPayments && !isSelected && (
            <span className="text-[9px] font-bold text-emerald-600 mt-0.5">
              {amount >= 1000 ? `${Math.round(amount/1000)}к` : `${amount}`}
            </span>
          )}
          {hasPayments && !isSelected && (
            <span className="absolute bottom-1 w-1.5 h-1.5 bg-emerald-500 rounded-full" />
          )}
        </button>
      );
    }
    return days;
  })()}
</div>
            
            {/* Легенда */}
            <div className="flex items-center justify-center gap-3 mt-3 pt-3 border-t border-slate-100 text-[10px] text-slate-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-indigo-100 rounded" /> Сегодня</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-50 rounded" /> Есть платежи</span>
            </div>
          </div>
        )}
      </div>
      
      {/* Сброс фильтра */}
      {selectedCalendarDate && (
        <button
          onClick={() => setSelectedCalendarDate(null)}
          className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
        >
          Сбросить
        </button>
      )}
    </div>

    {/* 🔹 Список платежей */}
    {upcomingAndOverduePayments.length === 0 ? (
      <div className="text-center py-16 bg-white/80 backdrop-blur-sm rounded-2xl border border-dashed border-slate-200">
        <div className="text-6xl mb-4 opacity-30">📅</div>
        <p className="text-slate-400 font-medium">
          {selectedCalendarDate ? 'Нет платежей на выбранную дату' : 'Нет платежей на сегодня и завтра'}
        </p>
        <p className="text-xs text-slate-300 mt-1">Все платежи по расписанию</p>
      </div>
    ) : (
      <div className="space-y-3">
        {upcomingAndOverduePayments.map((p, idx) => (
          <div
            key={p.sale.id}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedPaymentForAction({
                sale: p.sale,
                customerName: p.customerName,
                totalDue: p.totalDue
              });
            }}
            className="group bg-white/90 backdrop-blur-sm p-5 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-indigo-200 relative animate-in fade-in slide-in-from-bottom-2 cursor-pointer"
            style={{animationDelay: `${idx * 100}ms`}}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 min-w-0 flex-1">
                <div className="min-w-0">
                  <p className="font-bold text-slate-800 group-hover:text-indigo-600 transition-colors break-words leading-tight">
                    {p.customerName}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5 break-words">
                    {p.sale.productName}
                  </p>
                </div>
              </div>
              <div className="text-right flex-shrink-0 pl-4">
                <p className="text-lg font-bold text-indigo-600 whitespace-nowrap">
                  {formatCurrency(p.totalDue, appSettings.showCents)} ₽
                </p>
                {p.isToday && !selectedCalendarDate && (
                  <p className="text-[10px] font-bold text-emerald-600 mt-0.5">СЕГОДНЯ</p>
                )}
                {p.isTomorrow && !selectedCalendarDate && (
                  <p className="text-[10px] font-bold text-amber-600 mt-0.5">ЗАВТРА</p>
                )}
               {selectedCalendarDate && (
  <p className="text-[10px] font-bold text-indigo-600 mt-0.5">

    {formatDate(selectedCalendarDate.toLocaleDateString('ru-RU'))}
  </p>
)}
              </div>
            </div>
            {/* Блок задолженности */}
            {(() => {
              const calculateOverdueAmount = (sale: Sale) => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                let expectedPaid = sale.downPayment;
                sale.paymentPlan.forEach(p => {
                  const paymentDate = new Date(p.date);
                  paymentDate.setHours(0, 0, 0, 0);
                  if ((!p.isRealPayment || p.isRealPayment === undefined) && paymentDate < today) {
                    expectedPaid += p.amount;
                  }
                });
                const actualPaid = sale.totalAmount - sale.remainingAmount;
                return Math.max(0, expectedPaid - actualPaid);
              };
              const overdueDebt = calculateOverdueAmount(p.sale);
              if (overdueDebt <= 0) return null;
              return (
                <div className="mt-4 pt-3 border-t border-dashed border-rose-200">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-rose-600 font-medium flex items-center gap-1">
                      ⚠️ Задолженность
                    </span>
                    <span className="font-bold text-rose-700 whitespace-nowrap">
                      {formatCurrency(overdueDebt, appSettings.showCents)} ₽
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>
        ))}
      </div>
    )}
  </div>
)}

          {selectedSaleForModal && (
              <SaleDetailsModal
                  sale={selectedSaleForModal}
                  customerName={customers.find(c => c.id === selectedSaleForModal.customerId)?.name || ''}
                  onClose={() => setSelectedSaleForModal(null)}
                  appSettings={appSettings}
              />
          )}

          {selectedPaymentForAction && (
              <PaymentActionModal
                sale={selectedPaymentForAction.sale}
                customerName={selectedPaymentForAction.customerName}
                totalDue={selectedPaymentForAction.totalDue}
                onClose={() => setSelectedPaymentForAction(null)}
                onSelectCustomer={onSelectCustomer}
                onInitiatePayment={onInitiatePayment}
                onViewSchedule={onViewSchedule}
                appSettings={appSettings}
            />
        )}
          {selectedPaymentType && (
  <PaymentDetailsModal
    type={selectedPaymentType}
    sales={sales}
    customers={customers}
    investors={investors}
    selectedAccountId={selectedAccountId} // ← Добавили
    onClose={() => setSelectedPaymentType(null)}
    onInitiatePayment={onInitiatePayment}
    onViewSchedule={onViewSchedule}
    appSettings={appSettings}
  />
)}
      </div>
    </div>
  );
};

export default Dashboard;
