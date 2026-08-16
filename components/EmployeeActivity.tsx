import React, { useMemo, useState } from 'react';
import { User, Sale, Expense, Customer } from '../types';
import { ICONS } from '../constants';
import { formatCurrency, formatDate, addMonthsClamped } from '../src/utils';

interface EmployeeActivityProps {
  employee: User;
  sales: Sale[];
  expenses: Expense[];
  customers: Customer[];
}

type Period = 'TODAY' | 'WEEK' | 'MONTH' | 'ALL';

const PERIOD_LABELS: Record<Period, string> = {
  TODAY: 'Сегодня',
  WEEK: 'Неделя',
  MONTH: 'Месяц',
  ALL: 'Всё время',
};

const periodStart = (period: Period): Date | null => {
  const now = new Date();
  if (period === 'ALL') return null;
  if (period === 'TODAY') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (period === 'WEEK') {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return d;
  }
  return addMonthsClamped(now, -1);
};

const formatRelativeTime = (iso: string | undefined | null): string => {
  if (!iso) return '';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин. назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч. назад`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} дн. назад`;
  return formatDate(iso);
};

type ActivityItem = {
  id: string;
  date: string;
  icon: React.ReactNode;
  iconClass: string;
  label: string;
  sub?: string;
};

const EmployeeActivity: React.FC<EmployeeActivityProps> = ({ employee, sales, expenses, customers }) => {
  const [period, setPeriod] = useState<Period>('MONTH');

  const customerName = (id: string) => customers.find(c => c.id === id)?.name || 'клиент';

  const { kpi, feed } = useMemo(() => {
    const from = periodStart(period);
    const inPeriod = (iso: string | undefined | null) => {
      if (!from || !iso) return !from; // ALL period keeps items even without a date
      const d = new Date(iso);
      return !isNaN(d.getTime()) && d >= from;
    };

    const myCustomers = customers.filter(c => c.createdByUserId === employee.id && inPeriod(c.createdAt));
    const mySales = sales.filter(s => s.createdByUserId === employee.id);
    const myContracts = mySales.filter(s => s.type === 'INSTALLMENT' && inPeriod(s.startDate));
    const myCashIncome = mySales.filter(s => s.type === 'CASH' && inPeriod(s.startDate));
    const myExpenses = expenses.filter(e => e.createdByUserId === employee.id && inPeriod(e.date));

    const myPayments: { sale: Sale; payment: Sale['paymentPlan'][number] }[] = [];
    sales.forEach(s => {
      s.paymentPlan.forEach(p => {
        if (p.recordedByUserId === employee.id && p.isRealPayment && inPeriod(p.actualDate || p.date)) {
          myPayments.push({ sale: s, payment: p });
        }
      });
    });

    const kpi = {
      customersCount: myCustomers.length,
      contractsCount: myContracts.length,
      contractsSum: myContracts.reduce((s, c) => s + c.totalAmount, 0),
      paymentsCount: myPayments.length,
      paymentsSum: myPayments.reduce((s, p) => s + p.payment.amount, 0),
      cashIncomeSum: myCashIncome.reduce((s, c) => s + c.totalAmount, 0),
      expensesCount: myExpenses.length,
      expensesSum: myExpenses.reduce((s, e) => s + e.amount, 0),
    };

    const feed: ActivityItem[] = [];
    myCustomers.forEach(c => c.createdAt && feed.push({
      id: `cust_${c.id}`, date: c.createdAt,
      icon: ICONS.Users, iconClass: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
      label: `Добавил клиента «${c.name}»`,
    }));
    myContracts.forEach(s => feed.push({
      id: `sale_${s.id}`, date: s.startDate,
      icon: ICONS.File, iconClass: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400',
      label: `Оформил договор с «${customerName(s.customerId)}»`,
      sub: formatCurrency(s.totalAmount) + ' ₽',
    }));
    myCashIncome.forEach(s => feed.push({
      id: `cash_${s.id}`, date: s.startDate,
      icon: ICONS.Income, iconClass: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
      label: `Внёс приход «${s.productName}»`,
      sub: formatCurrency(s.totalAmount) + ' ₽',
    }));
    myPayments.forEach(({ sale, payment }) => feed.push({
      id: `pay_${payment.id}`, date: payment.actualDate || payment.date,
      icon: ICONS.Income, iconClass: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
      label: `Принял платёж от «${customerName(sale.customerId)}»`,
      sub: formatCurrency(payment.amount) + ' ₽',
    }));
    myExpenses.forEach(e => feed.push({
      id: `exp_${e.id}`, date: e.date,
      icon: ICONS.Expense, iconClass: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
      label: `Добавил расход «${e.title}»`,
      sub: formatCurrency(e.amount) + ' ₽',
    }));

    feed.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return { kpi, feed: feed.slice(0, 100) };
  }, [employee.id, period, sales, expenses, customers]);

  return (
    <div className="space-y-4 pb-20 animate-fade-in">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center font-bold text-xl flex-shrink-0">
          {employee.name.charAt(0)}
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-slate-800 dark:text-white truncate">{employee.name}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{employee.email}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="opacity-70">{ICONS.Clock}</span>
        Последний вход: {employee.lastLogin ? formatRelativeTime(employee.lastLogin) : 'нет данных'}
      </div>

      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
              period === p
                ? 'bg-indigo-600 text-white'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
            }`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 mb-1">{ICONS.Users}<span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Клиенты</span></div>
          <p className="text-2xl font-bold text-slate-800 dark:text-white">{kpi.customersCount}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 mb-1">{ICONS.File}<span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Договоры</span></div>
          <p className="text-2xl font-bold text-slate-800 dark:text-white">{kpi.contractsCount}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{formatCurrency(kpi.contractsSum)} ₽</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 mb-1">{ICONS.Income}<span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Платежи</span></div>
          <p className="text-2xl font-bold text-slate-800 dark:text-white">{kpi.paymentsCount}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{formatCurrency(kpi.paymentsSum)} ₽</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400 mb-1">{ICONS.Expense}<span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Расходы</span></div>
          <p className="text-2xl font-bold text-slate-800 dark:text-white">{kpi.expensesCount}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{formatCurrency(kpi.expensesSum)} ₽</p>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2">
          <span className="text-slate-400">{ICONS.History}</span>
          <h3 className="font-bold text-slate-800 dark:text-white">Лента действий</h3>
        </div>
        {feed.length === 0 ? (
          <div className="text-center py-8 text-slate-400 dark:text-slate-500 text-sm">Нет действий за выбранный период</div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {feed.map(item => (
              <div key={item.id} className="p-4 flex items-center gap-3">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${item.iconClass}`}>
                  {item.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-800 dark:text-white truncate">{item.label}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">{formatRelativeTime(item.date)}</p>
                </div>
                {item.sub && <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex-shrink-0">{item.sub}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default EmployeeActivity;
