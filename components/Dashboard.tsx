import React, { useMemo, useState, useEffect } from 'react';
import { Sale, Customer, Account, AppSettings, Investor, User } from '../types';
import { ICONS } from '../constants';
import SubscriptionExpiryBanner from './SubscriptionExpiryBanner';
import MyBonusCard from './MyBonusCard';
import { formatCurrency, formatDate, getManagerSharePercent, calculateSaleOverdue, normalizePhoneForWhatsApp } from '../src/utils';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import {createPortal} from "react-dom";

// Календарный день платежа в виде «YYYY-MM-DD» по московскому времени.
//
// В базе даты платежей лежат в двух видах: «...T00:00:00.000Z» (24 015 записей) и
// «...T21:00:00.000Z» — полночь по Москве (1 546 записей). Если разбирать их часовым
// поясом устройства, второй вид у пользователя западнее Москвы (Калининград, UTC+2)
// съезжает на день назад, и платёж показывается не в тот день. В московском поясе
// оба вида дают одну и ту же верную дату, поэтому сравниваем именно по нему.
// 'en-CA' выбран потому, что даёт ровно формат YYYY-MM-DD.
const mskDayKey = (d: string | number | Date): string =>
  new Date(d).toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });

// Номер для wa.me собирает общий помощник normalizePhoneForWhatsApp из src/utils.ts —
// здесь была четвёртая по счёту копия этой логики в проекте.
const waPhoneDigits = (phone?: string): string | null => normalizePhoneForWhatsApp(phone);

// Сколько календарных дней (по Москве) осталось до дня платежа
const daysUntilDayKey = (dayKey: string): number => {
  const toUtc = (k: string) => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(dayKey) - toUtc(mskDayKey(new Date()))) / 86400000);
};

const pluralRu = (n: number, one: string, few: string, many: string): string => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
};

// Текст напоминания подстраивается под то, за сколько дней до срока его отправляют:
// в день оплаты — просьба оплатить сегодня, заранее — предупреждение о дате.
const buildPaymentReminder = (opts: {
  customerName: string; productName: string; amount: number;
  dayKey: string; date: Date; showCents?: boolean; companyName?: string;
}): string => {
  const { customerName, productName, amount, dayKey, date, showCents, companyName } = opts;
  const days = daysUntilDayKey(dayKey);
  const sum = `*${formatCurrency(amount, showCents)} ₽*`;
  const when = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

  let body: string;
  if (days < 0) {
    const late = Math.abs(days);
    body = `По договору «${productName}» платёж от ${when} пока не поступил — ${late} ${pluralRu(late, 'день', 'дня', 'дней')} просрочки.\n\n💰 Сумма к оплате: ${sum}\n\nПожалуйста, погасите задолженность.`;
  } else if (days === 0) {
    body = `Сегодня день оплаты по договору «${productName}».\n\n💰 Сумма к оплате: ${sum}`;
  } else if (days === 1) {
    body = `Напоминаем: завтра, ${when}, очередной платёж по договору «${productName}».\n\n💰 Сумма к оплате: ${sum}`;
  } else {
    body = `Напоминаем о предстоящем платеже по договору «${productName}».\n\n📅 Дата: ${when} (через ${days} ${pluralRu(days, 'день', 'дня', 'дней')})\n💰 Сумма: ${sum}`;
  }

  return `Здравствуйте, ${customerName}!\n\n${body}${companyName ? `\n\n${companyName}` : ''}`;
};


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
  onAction: (action: string, ctx?: { accountId?: string | null }) => void;
  onSelectCustomer: (id: string) => void;
  onInitiatePayment: (sale: Sale, amount: number) => void;
  onViewSchedule: (sale: Sale) => void;
  accounts: Account[];
  appSettings: AppSettings;
  investors: Investor[];
  /** Нужен только для плашки об истекающей подписке */
  user?: User | null;
}

const SaleDetailsModal = ({ sale, customerName, onClose, appSettings }: { sale: Sale, customerName: string, onClose: () => void, appSettings: AppSettings }) => {
    const statusMap: Record<string, { label: string, color: string }> = {
        'ACTIVE': { label: 'Активен', color: 'bg-blue-100 text-blue-700 border-blue-200' },
        'COMPLETED': { label: 'Завершен', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
        'DEFAULTED': { label: 'Просрочен', color: 'bg-rose-100 text-rose-700 border-rose-200' }
    };

    const status = statusMap[sale.status] || { label: sale.status, color: 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-600' };

    // 🔹 НОВОЕ
    const [isClosing, setIsClosing] = useState(false);
    const handleClose = () => {
        setIsClosing(true);
        setTimeout(onClose, 200);
    };

   return (
        <div
          className={`fixed inset-0 z-modal flex items-center justify-center p-4 bg-gradient-to-br from-slate-900/80 to-indigo-900/60 backdrop-blur-md ${isClosing ? 'animate-fade-out' : 'animate-in fade-in zoom-in duration-300'}`}
          onClick={handleClose}
        >
            <div
              className={`bg-white dark:bg-slate-800 backdrop-blur-sm w-full max-w-md rounded-3xl shadow-2xl overflow-hidden border border-white/20 ${isClosing ? 'animate-zoom-out-modal' : ''}`}
              onClick={e => e.stopPropagation()}
            >
                <div className="relative p-6 bg-gradient-to-r from-indigo-600 to-indigo-500 text-white">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-8 -mt-8 blur-2xl"></div>
                    <h3 className="text-xl font-bold mb-1">{sale.productName}</h3>
                    <p className="text-indigo-100 text-sm flex items-center gap-1">
                        <span className="opacity-70">👤</span> {customerName}
                    </p>
                    <button onClick={handleClose} className="absolute top-4 right-4 w-8 h-8 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center backdrop-blur-sm transition-all">
                        <span className="text-lg">✕</span>
                    </button>
                </div>

                <div className="p-6 space-y-4 bg-slate-50 dark:bg-slate-900">
                    <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Статус договора</span>
                        <span className={`px-3 py-1.5 rounded-full text-xs font-bold border ${status.color}`}>
                            {status.label}
                        </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm">
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Дата</p>
                            <p className="font-semibold text-slate-800 dark:text-white">{formatDate(sale.startDate)}</p>
                        </div>
                        <div className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm">
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Срок</p>
                            <p className="font-semibold text-slate-800 dark:text-white">{sale.installments} мес.</p>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-100 dark:border-slate-700 shadow-sm space-y-3">
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-slate-500 dark:text-slate-400">Общая сумма</span>
                            <span className="text-lg font-bold text-indigo-600 whitespace-nowrap">{formatCurrency(sale.totalAmount, appSettings.showCents)} ₽</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-slate-500 dark:text-slate-400">Первый взнос</span>
                            <span className="font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">{formatCurrency(sale.downPayment, appSettings.showCents)} ₽</span>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-dashed border-slate-200 dark:border-slate-700">
                            <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Остаток долга</span>
                            <span className="text-lg font-bold text-amber-600 whitespace-nowrap">{formatCurrency(sale.remainingAmount, appSettings.showCents)} ₽</span>
                        </div>
                    </div>

                    {sale.paymentPlan && sale.paymentPlan.length > 0 && (
                        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-100 dark:border-slate-700 shadow-sm">
                            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">График платежей</p>
                            <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                                {sale.paymentPlan.slice(0, 3).map((payment, idx) => (
                                    <div key={idx} className="flex justify-between items-center text-xs">
                                        <span className="text-slate-500 dark:text-slate-400">{formatDate(payment.date)}</span>
                                        <span className="font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">{formatCurrency(payment.amount, appSettings.showCents)} ₽</span>
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${payment.isPaid ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'}`}>
                                            {payment.isPaid ? 'Оплачено' : 'Ожидается'}
                                        </span>
                                    </div>
                                ))}
                                {sale.paymentPlan.length > 3 && (
                                    <p className="text-center text-[10px] text-slate-400 dark:text-slate-500 mt-1">+ еще {sale.paymentPlan.length - 3} платежей</p>
                                )}
                            </div>
                        </div>
                    )}
                </div>

               <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                    <button onClick={handleClose} className="w-full py-3.5 bg-gradient-to-r from-slate-800 to-slate-700 text-white font-bold rounded-xl hover:from-slate-900 hover:to-slate-800 shadow-lg shadow-slate-200 dark:shadow-slate-900/30 transition-all">
                        Закрыть
                    </button>
                </div>
            </div>
        </div>
    );
};

const PaymentActionModal = ({
    sale, customerName, customerPhone, dueDate, dueDayKey,
    onClose, onSelectCustomer, onInitiatePayment, onViewSchedule, totalDue, appSettings
}: {
    sale: Sale, customerName: string, customerPhone?: string,
    dueDate: Date, dueDayKey: string, onClose: () => void,
    onSelectCustomer: (id: string) => void, onInitiatePayment: (sale: Sale, amount: number) => void,
    onViewSchedule: (sale: Sale) => void, totalDue: number, appSettings: AppSettings
}) => {
    // 🔹 НОВОЕ
    const [isClosing, setIsClosing] = useState(false);
    const handleClose = () => {
        setIsClosing(true);
        setTimeout(onClose, 200);
    };

    const phone = waPhoneDigits(customerPhone);
    const daysLeft = daysUntilDayKey(dueDayKey);
    // Подпись на кнопке говорит, каким будет тон сообщения, ещё до отправки
    const reminderHint =
        daysLeft < 0 ? 'о просрочке'
        : daysLeft === 0 ? 'в день оплаты'
        : daysLeft === 1 ? 'за день'
        : `за ${daysLeft} ${pluralRu(daysLeft, 'день', 'дня', 'дней')}`;

    const handleRemind = () => {
        if (!phone) return;
        const text = buildPaymentReminder({
            customerName,
            productName: sale.productName,
            amount: totalDue,
            dayKey: dueDayKey,
            date: dueDate,
            showCents: appSettings.showCents,
            companyName: appSettings.companyName,
        });
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
        handleClose();
    };

    return (
        <div
            className={`fixed inset-0 z-modal flex items-center justify-center p-4 bg-gradient-to-br from-slate-900/80 to-indigo-900/60 backdrop-blur-md ${isClosing ? 'animate-fade-out' : 'animate-in fade-in zoom-in duration-300'}`}
            onClick={handleClose}
        >
            <div
                className={`bg-white dark:bg-slate-800 backdrop-blur-sm w-full max-w-md rounded-3xl shadow-2xl overflow-hidden border border-white/20 ${isClosing ? 'animate-zoom-out-modal' : ''}`}
                onClick={e => e.stopPropagation()}
            >
                <div className="relative p-6 bg-gradient-to-r from-indigo-600 to-indigo-500 text-white">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-8 -mt-8 blur-2xl"></div>
                    <h3 className="text-xl font-bold mb-1">{customerName}</h3>
                    <p className="text-indigo-100 text-sm flex items-center gap-1">
                        <span className="opacity-70">📦</span> {sale.productName}
                    </p>
                    <button
                        onClick={handleClose}
                        className="absolute top-4 right-4 w-8 h-8 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center backdrop-blur-sm transition-all"
                    >
                        <span className="text-lg">✕</span>
                    </button>
                </div>

                <div className="p-6 pb-4">
                    <div className="bg-indigo-50 dark:bg-indigo-900/30 rounded-xl p-4 border border-indigo-100 dark:border-indigo-900/50">
                        <div className="flex items-end justify-between gap-3">
                            <div>
                                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Сумма к оплате</p>
                                <p className="text-2xl font-bold text-indigo-600">
                                    {formatCurrency(totalDue, appSettings.showCents)} ₽
                                </p>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap pb-1">
                                {daysLeft === 0 ? 'сегодня' : daysLeft === 1 ? 'завтра'
                                    : dueDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
                            </p>
                        </div>
                    </div>

                    {phone ? (
                        <button
                            onClick={handleRemind}
                            className="mt-3 w-full flex items-center justify-center gap-2 py-3.5 bg-gradient-to-r from-emerald-500 to-green-500 text-white font-bold rounded-xl shadow-lg shadow-emerald-200 dark:shadow-emerald-900/30 hover:from-emerald-600 hover:to-green-600 active:scale-[0.98] transition-all"
                        >
                            <span>💬</span>
                            <span>Напомнить</span>
                            <span className="text-[11px] font-medium text-white/80">· {reminderHint}</span>
                        </button>
                    ) : (
                        <p className="mt-3 text-center text-xs text-slate-400 dark:text-slate-500 py-3">
                            Чтобы напомнить, добавьте телефон клиента
                        </p>
                    )}
                </div>

                <div className="px-6 pb-6 space-y-2">
                    <button
                        onClick={() => { onSelectCustomer(sale.customerId); handleClose(); }}
                        className="w-full text-left px-4 py-3.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 flex items-center gap-3 transition-colors rounded-xl"
                    >
                        <span className="text-indigo-500">👤</span>
                        <span>Инфо о клиенте</span>
                    </button>

                    <button
                        onClick={() => { onInitiatePayment(sale, totalDue); handleClose(); }}
                        className="w-full text-left px-4 py-3.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 flex items-center gap-3 transition-colors rounded-xl border-t border-slate-100 dark:border-slate-700 pt-3.5 mt-1"
                    >
                        <span className="text-emerald-500">💰</span>
                        <span>Добавить платеж</span>
                    </button>

                    <button
                        onClick={() => { onViewSchedule(sale); handleClose(); }}
                        className="w-full text-left px-4 py-3.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 flex items-center gap-3 transition-colors rounded-xl border-t border-slate-100 dark:border-slate-700 pt-3.5 mt-1"
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
  type, sales, customers, investors, selectedAccountId, onClose,
  onInitiatePayment, onViewSchedule, appSettings
}: {
  type: 'expected' | 'received'; sales: Sale[]; customers: Customer[]; investors: Investor[];
  selectedAccountId?: string | null; onClose: () => void;
  onInitiatePayment?: (sale: Sale, amount: number) => void; onViewSchedule?: (sale: Sale) => void;
  appSettings: AppSettings;
}) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const today = new Date(); today.setHours(0,0,0,0);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  // 🔹 НОВОЕ
  const [isClosing, setIsClosing] = useState(false);
  const handleClose = () => {
    setIsClosing(true);
    setTimeout(onClose, 280);
  };

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
        const clientOverdue = calculateSaleOverdue(sale, today);

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
        downPaymentTotal: 0
    };
}, [items]);

  const uniqueCustomerCount = new Set(
    (items as any[]).map((item: any) => (item.sale?.customerId || '') as string)
  ).size;

  const title = type === 'expected' ? 'Ожидаемые платежи' : 'Полученные платежи';
  const emptyText = type === 'expected'
    ? 'Нет ожидаемых платежей в этом месяце'
    : 'Нет полученных платежей в этом месяце';

    return createPortal(
    <div
      className={`fixed inset-0 z-modal flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
      onClick={handleClose}
    >
      <div
        className={`bg-white dark:bg-slate-800 w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col ${isClosing ? 'animate-slide-down-sheet' : 'animate-slide-up-sheet'}`}
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
          <button onClick={handleClose} className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-xl transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

       {/* Итого */}
<div className="px-4 py-3 bg-slate-50 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center">
  <div className="flex items-center gap-2">
    <span className="text-sm text-slate-500 dark:text-slate-400">Итого</span>
    {uniqueCustomerCount > 0 && (
      <span title="Уникальных клиентов в списке" className="relative group inline-flex items-center gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 px-2 py-0.5 rounded-full text-[11px] font-semibold text-slate-500 dark:text-slate-400 cursor-default select-none">
        <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
        </svg>
        {uniqueCustomerCount}
        <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap px-2 py-1 rounded-lg bg-slate-800 dark:bg-slate-700 text-white text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-150 shadow-lg z-10">
          Уникальных клиентов
        </span>
      </span>
    )}
  </div>
  <span className="text-lg font-bold text-slate-800 dark:text-white">
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
              className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-100 dark:border-slate-700 hover:border-indigo-200 dark:hover:border-indigo-800 hover:shadow-sm transition-all"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-800 dark:text-white text-sm truncate">{item.customerName}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{item.sale.productName}</p>
                </div>
                <div className="text-right ml-3">
                  <p className={`font-bold text-sm ${item.isOverdue ? 'text-red-600' : 'text-slate-800 dark:text-white'}`}>
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
                      onClick={(e) => { e.stopPropagation(); onInitiatePayment(item.sale, item.amount); handleClose(); }}
                      className="px-2 py-1 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-lg font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors"
                    >
                      + Платёж
                    </button>
                  )}
                  {onViewSchedule && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onViewSchedule(item.sale); handleClose(); }}
                      className="px-2 py-1 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg font-medium hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
                    >
                      График
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={handleClose}
          className="py-3 text-slate-400 text-sm hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shrink-0 border-t border-slate-100 dark:border-slate-700"
        >
          Закрыть
        </button>
      </div>
    </div>,
    document.body
  );
};




const ProfitDetailsModal = ({
  type, sales, customers, investors, selectedAccountId, onClose, onSelectCustomer, appSettings
}: {
  type: 'expected' | 'received'; sales: Sale[]; customers: Customer[]; investors: Investor[];
  selectedAccountId?: string | null; onClose: () => void;
  onSelectCustomer: (customerId: string) => void; appSettings: AppSettings;
}) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  monthStart.setHours(0, 0, 0, 0);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  // 🔹 НОВОЕ
  const [isClosing, setIsClosing] = useState(false);
  const handleClose = () => {
    setIsClosing(true);
    setTimeout(onClose, 280);
  };
  const items = useMemo(() => {
    const result: Array<{
      sale: Sale;
      customerName: string;
      customerId: string;
      paymentAmount: number;
      profitAmount: number;
      date: string;
      isPaid: boolean;
      isDownPayment: boolean;
      paidAmount: number;
      paymentPercent: number;
    }> = [];

    const investorIds = new Set(investors.map(i => i.id));
    const filteredSales = selectedAccountId
      ? sales.filter(s => s.accountId === selectedAccountId)
      : sales;

    filteredSales.forEach(sale => {
      if (sale.customerId.startsWith('system_')) return;
      if (investorIds.has(sale.customerId)) return;
      if (!sale.buyPrice || sale.buyPrice <= 0) return;
      if (sale.totalAmount <= 0) return;

      const profitMargin = (sale.totalAmount - sale.buyPrice) / sale.totalAmount;
      if (profitMargin <= 0) return;

      const customer = customers.find(c => c.id === sale.customerId);

      if (type === 'expected') {
        // 🔹 Неоплаченные платежи из графика (та же логика, что в карточке)
        sale.paymentPlan.forEach(payment => {
          if (payment.isRealPayment !== true && !payment.isPaid) {
            const paymentDate = new Date(payment.date);
            paymentDate.setHours(0, 0, 0, 0);
            if (paymentDate >= monthStart && paymentDate <= monthEnd) {
              result.push({
                sale,
                customerName: customer?.name || 'Неизвестно',
                customerId: sale.customerId,
                paymentAmount: payment.amount, // 🔹 Вся сумма, как в карточке
                profitAmount: payment.amount * profitMargin, // 🔹 Прибыль от всей суммы
                date: payment.date,
                isPaid: false,
                isDownPayment: false,
                paidAmount: 0,
                paymentPercent: 0
              });
            }
          }
        });

        // 🔹 Неоплаченный downPayment (та же логика)
        if (sale.downPayment > 0) {
          const totalPaid = sale.totalAmount - sale.remainingAmount;
          if (totalPaid < sale.downPayment) {
            const saleStart = new Date(sale.startDate);
            saleStart.setHours(0, 0, 0, 0);
            if (saleStart >= monthStart && saleStart <= monthEnd) {
              const unpaidDownPayment = sale.downPayment - totalPaid;
              result.push({
                sale,
                customerName: customer?.name || 'Неизвестно',
                customerId: sale.customerId,
                paymentAmount: unpaidDownPayment,
                profitAmount: unpaidDownPayment * profitMargin,
                date: sale.startDate,
                isPaid: false,
                isDownPayment: true,
                paidAmount: totalPaid,
                paymentPercent: (totalPaid / sale.downPayment) * 100
              });
            }
          }
        }
      } else {
        // 🔹 Оплаченные платежи из графика (та же логика, что в карточке)
        sale.paymentPlan.forEach(payment => {
          if (payment.isPaid && payment.isRealPayment !== false) {
            const paymentDate = new Date(payment.date);
            paymentDate.setHours(0, 0, 0, 0);
            if (paymentDate >= monthStart && paymentDate <= monthEnd) {
              result.push({
                sale,
                customerName: customer?.name || 'Неизвестно',
                customerId: sale.customerId,
                paymentAmount: payment.amount,
                profitAmount: payment.amount * profitMargin,
                date: payment.date,
                isPaid: true,
                isDownPayment: false,
                paidAmount: payment.amount,
                paymentPercent: 100
              });
            }
          }
        });

        // 🔹 Оплаченный downPayment (та же логика)
        if (sale.downPayment > 0) {
          const saleStart = new Date(sale.startDate);
          saleStart.setHours(0, 0, 0, 0);
          if (saleStart >= monthStart && saleStart <= monthEnd) {
            const totalPaid = sale.totalAmount - sale.remainingAmount;
            if (totalPaid >= sale.downPayment) {
              result.push({
                sale,
                customerName: customer?.name || 'Неизвестно',
                customerId: sale.customerId,
                paymentAmount: sale.downPayment,
                profitAmount: sale.downPayment * profitMargin,
                date: sale.startDate,
                isPaid: true,
                isDownPayment: true,
                paidAmount: sale.downPayment,
                paymentPercent: 100
              });
            }
          }
        }
      }
    });

    return result.sort((a, b) => {
      if (a.isPaid && !b.isPaid) return -1;
      if (!a.isPaid && b.isPaid) return 1;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [sales, customers, investors, type, monthStart, monthEnd, selectedAccountId]);

  const totalProfit = items.reduce((sum, item) => sum + item.profitAmount, 0);

  const uniqueCustomerCountProfit = new Set(
    (items as any[]).map((item: any) => (item.customerId || '') as string)
  ).size;

  const title = type === 'expected' ? 'Ожидаемая прибыль' : 'Получено прибыли';
  const emptyText = type === 'expected'
    ? 'Нет ожидаемой прибыли в этом месяце'
    : 'Нет полученной прибыли в этом месяце';

  const getStatusInfo = (percent: number, isPaid: boolean) => {
    if (isPaid || percent >= 100) {
      return {
        label: 'Получено',
        bg: 'bg-emerald-100 dark:bg-emerald-900/30',
        text: 'text-emerald-700 dark:text-emerald-400',
        barColor: 'bg-emerald-500',
        barBg: 'bg-emerald-100 dark:bg-emerald-900/30'
      };
    }
    if (percent > 0) {
      return {
        label: 'Частично',
        bg: 'bg-amber-100 dark:bg-amber-900/30',
        text: 'text-amber-700 dark:text-amber-400',
        barColor: 'bg-amber-500',
        barBg: 'bg-amber-100 dark:bg-amber-900/30'
      };
    }
    return {
      label: '',
      bg: 'bg-slate-100 dark:bg-slate-700',
      text: 'text-slate-600 dark:text-slate-300',
      barColor: 'bg-slate-300',
      barBg: 'bg-slate-100 dark:bg-slate-700'
    };
  };

  return createPortal(
    <div
      className={`fixed inset-0 z-modal flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
      onClick={handleClose}
    >
      <div
        className={`bg-white dark:bg-slate-800 w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col ${isClosing ? 'animate-slide-down-sheet' : 'animate-slide-up-sheet'}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Шапка */}
        <div className={`px-4 py-3 flex items-center justify-between shrink-0 ${
          type === 'expected'
            ? 'bg-gradient-to-r from-blue-500 to-indigo-500'
            : 'bg-gradient-to-r from-emerald-500 to-teal-500'
        }`}>
          <div className="flex items-center gap-3">
            <div className="text-white bg-white/20 p-2 rounded-xl">
              {type === 'expected' ? (
                <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
              ) : (
                <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/>
                </svg>
              )}
            </div>
            <h3 className="text-base font-bold text-white">{title}</h3>
          </div>
          <button onClick={handleClose} className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-xl transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>


        {/* Итого */}
        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500 dark:text-slate-400">Итого</span>
            {uniqueCustomerCountProfit > 0 && (
              <span title="Уникальных клиентов в списке" className="relative group inline-flex items-center gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 px-2 py-0.5 rounded-full text-[11px] font-semibold text-slate-500 dark:text-slate-400 cursor-default select-none">
                <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
                </svg>
                {uniqueCustomerCountProfit}
                <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap px-2 py-1 rounded-lg bg-slate-800 dark:bg-slate-700 text-white text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-150 shadow-lg z-10">
                  Уникальных клиентов
                </span>
              </span>
            )}
          </div>
          <span className="text-lg font-bold text-slate-800 dark:text-white">
            {formatCurrency(totalProfit, appSettings.showCents)} ₽
          </span>
        </div>

        {/* Список */}
       <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {items.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <div className="text-4xl mb-2 opacity-30">📭</div>
              <p className="text-sm">{emptyText}</p>
            </div>
          ) : items.map((item, idx) => {
            const statusInfo = getStatusInfo(item.paymentPercent, item.isPaid);

            return (
              <div
                key={`${item.sale.id}-${item.date}-${idx}`}
                onClick={() => {
                  onSelectCustomer(item.customerId);
                  handleClose();
                }}
                className={`bg-white dark:bg-slate-800 p-3 rounded-xl border transition-all ${
                  item.isPaid || item.paymentPercent > 0
                    ? 'border-emerald-100 dark:border-emerald-900/50'
                    : 'border-slate-100 dark:border-slate-700'
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">

                      <p className="font-semibold text-slate-800 dark:text-white text-sm truncate">{item.customerName}</p>

                      <svg className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                           viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {item.sale.productName}
                      {item.isDownPayment && (
                        <span className="ml-1 px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded text-[9px] font-bold">
                          Взнос
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="text-right ml-3">
    <p className={`font-bold text-sm ${
        type === 'expected' ? 'text-slate-800 dark:text-white' : 'text-emerald-600'
    }`}>
        {type === 'received' ? '+' : ''}{formatCurrency(item.profitAmount, appSettings.showCents)} ₽
    </p>
    <p className="text-[10px] text-slate-400">
        от {formatCurrency(item.paymentAmount, appSettings.showCents)} ₽
    </p>
</div>
                </div>

                {item.paymentPercent > 0 && item.paymentPercent < 100 && (
                  <div className="mb-2">
                    <div className="flex items-center justify-between text-[10px] mb-1">
                      <span className="text-slate-500 dark:text-slate-400">
                        Оплачено {formatCurrency(item.paidAmount, appSettings.showCents)} из {formatCurrency(item.paymentAmount + item.paidAmount, appSettings.showCents)} ₽
                      </span>
                      <span className="font-bold text-amber-600">
                        {Math.round(item.paymentPercent)}%
                      </span>
                    </div>
                    <div className={`h-1.5 rounded-full ${statusInfo.barBg} overflow-hidden`}>
                      <div
                        className={`h-full ${statusInfo.barColor} rounded-full transition-all duration-500`}
                        style={{ width: `${item.paymentPercent}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>{formatDate(item.date)}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${statusInfo.bg} ${statusInfo.text}`}>
                    {statusInfo.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <button
          onClick={handleClose}
          className="py-3 text-slate-400 text-sm hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shrink-0 border-t border-slate-100 dark:border-slate-700"
        >
          Закрыть
        </button>
      </div>
    </div>,
    document.body
  );
};

const Dashboard: React.FC<DashboardProps> = ({
    sales: allSales,
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
    user,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'upcoming'>('overview');
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  // Скрытие суммы переживает перезапуск: человек прячет её, чтобы не светить
  // баланс, и каждый раз заново нажимать глаз было бы бессмысленно.
  const [hideBalance, setHideBalance] = useState(() => {
    try { return localStorage.getItem('finuchet_hide_balance') === '1'; } catch { return false; }
  });
  const toggleHideBalance = () => {
    setHideBalance(v => {
      try { localStorage.setItem('finuchet_hide_balance', v ? '0' : '1'); } catch { /* приватный режим */ }
      return !v;
    });
  };
  const [selectedSaleForModal, setSelectedSaleForModal] = useState<Sale | null>(null);
  const [selectedPaymentForAction, setSelectedPaymentForAction] = useState<{
      sale: Sale;
      customerName: string;
      customerPhone?: string;
      totalDue: number;
      dueDate: Date;
      dueDayKey: string;
  } | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  // Кнопки под балансом гаснут по тем же правилам, что и меню «+»: инвестору
  // движения денег недоступны, сотруднику — только с правом на создание.
  // Иначе получилась бы кнопка, ведущая к отказу сервера.
  const canMoveMoney =
    user?.role !== 'investor' &&
    !(user?.role === 'employee' && !user?.permissions?.canCreate);

  // Архивные счета на главном экране не участвуют ни в суммах, ни в списках, ни
  // в календаре платежей: счёт убрали из работы — его цифры не должны подмешиваться
  // в общий итог. Отсекаем один раз здесь и дальше по компоненту работаем с этим
  // набором, иначе условие пришлось бы повторить в полутора десятках мест.
  // Исключение — счёт, выбранный прямо сейчас: его могли заархивировать уже после
  // выбора, и подсовывать пустой экран вместо его данных было бы странно.
  const sales = useMemo(() => {
    const archived = new Set(accounts.filter(a => a.isArchived).map(a => a.id));
    if (archived.size === 0) return allSales;
    return allSales.filter(sale =>
      !sale.accountId || !archived.has(sale.accountId) || sale.accountId === selectedAccountId
    );
  }, [allSales, accounts, selectedAccountId]);
  // Неделя, а не «сегодня и завтра»: у менеджера ближайший платёж часто через 2–3 дня,
  // и двухдневное окно показывало пустой экран, хотя на неделе ждут поступления.
  const [paymentDateFilter, setPaymentDateFilter] = useState<'WEEK' | 'TODAY' | 'TOMORROW'>('WEEK');

  // В начале компонента Dashboard, рядом с другими useState:
const [selectedPaymentType, setSelectedPaymentType] = useState<'expected' | 'received' | null>(null);

const [selectedCalendarDate, setSelectedCalendarDate] = useState<Date | null>(null);
const [showCalendarPicker, setShowCalendarPicker] = useState(false);
const [calendarMonth, setCalendarMonth] = useState(new Date());
const [selectedProfitType, setSelectedProfitType] = useState<'expected' | 'received' | null>(null);



const currentMonthName = useMemo(() => {
  const now = new Date();
  const month = now.toLocaleString('ru-RU', { month: 'long' });
  return month.charAt(0).toUpperCase() + month.slice(1); // "Июнь"
}, []);

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





  // 🔹 Общая сумма просрочки по всем клиентам
  const totalOverdue = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    const filteredSales = selectedAccountId ? sales.filter(s => s.accountId === selectedAccountId) : sales;
    const investorIds = new Set(investors.map(i => i.id));
    let overdue = 0;
    filteredSales.forEach(sale => {
      if (sale.customerId.startsWith('system_') || investorIds.has(sale.customerId)) return;
      if (sale.status === 'COMPLETED') return;
      overdue += calculateSaleOverdue(sale, today);
    });
    return Math.round(overdue * 100) / 100;
  }, [sales, selectedAccountId, investors]);

  // 🔹 Общая стоимость закупок (buyPrice) по активным договорам
  const totalBuyCost = useMemo(() => {
    const filteredSales = selectedAccountId ? sales.filter(s => s.accountId === selectedAccountId) : sales;
    const investorIds = new Set(investors.map(i => i.id));
    let cost = 0;
    filteredSales.forEach(sale => {
      if (sale.customerId.startsWith('system_') || investorIds.has(sale.customerId)) return;
      if (sale.buyPrice && sale.buyPrice > 0) cost += sale.buyPrice;
    });
    return Math.round(cost * 100) / 100;
  }, [sales, selectedAccountId, investors]);




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
        const profitMargin = totalSaleProfit / sale.totalAmount;

        const account = accounts?.find(a => a?.id === sale.accountId);
        const managerShare = getManagerSharePercent(account, investors || []) / 100;

        // 🔧 Считаем ФАКТИЧЕСКИ оплачено
        const collectedPayments = sale.downPayment + sale.paymentPlan
            .filter(p => p.isPaid && p.isRealPayment !== false)
            .reduce((sum, p) => sum + p.amount, 0);

        receivedProfit += collectedPayments * profitMargin;

        // 🔧 Ожидаемая = ВСЁ, что ещё не оплачено (включая downPayment)
        if (sale.status === 'ACTIVE' || sale.status === 'DRAFT') {
            const expectedRemaining = sale.totalAmount - collectedPayments;
            expectedProfit += expectedRemaining * profitMargin;
        }
    });

    return {
        receivedProfit: Math.round(receivedProfit * 100) / 100,
        expectedProfit: Math.round(expectedProfit * 100) / 100
    };
}, [sales, selectedAccountId, accounts, investors]);

  const currentWorkingCapital = useMemo(() => {
      if (selectedAccountId) {
          const cash = accountBalances[selectedAccountId] || 0;
          return cash + calculatedStats.totalOutstanding;
      }
      // globalWorkingCapital приходит из App и посчитан по всем счетам, включая
      // архивные. Если архивные есть — собираем сумму сами, из тех же слагаемых,
      // что и в ветке выше. Когда архивных нет, отдаём готовое значение: незачем
      // пересчитывать и рисковать разойтись с ним на копейку.
      const archived = accounts.filter(a => a.isArchived);
      if (archived.length === 0) return globalWorkingCapital;
      const visibleCash = accounts
        .filter(a => !a.isArchived)
        .reduce((sum, a) => sum + (accountBalances[a.id] || 0), 0);
      return visibleCash + calculatedStats.totalOutstanding;
  }, [selectedAccountId, accountBalances, calculatedStats.totalOutstanding, globalWorkingCapital, accounts]);

  const lastFiveSales = useMemo(() => {
      let filtered = sales;
      if (selectedAccountId) filtered = filtered.filter(s => s.accountId === selectedAccountId);
      filtered = filtered.filter(s => !s.customerId.startsWith('system_'));
      return [...filtered]
          .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())
          .slice(0, 5);
  }, [sales, selectedAccountId]);

  // 🔹 Единый источник неоплаченных плановых платежей для календаря и списка.
  // Раньше они считались двумя независимыми блоками с разной фильтрацией (календарь
  // отбрасывал isPaid, список гасил суммой реальных приходов), из-за чего день мог
  // подсвечиваться в календаре, а по клику список оказывался пустым.
  // Берём вариант с гашением: isPaid у плановых слотов — производная от реальных
  // платежей (см. reconcileSalePaymentPlan в App.tsx, «не доверяем унаследованным
  // флагам»), и она может зависнуть после отмены платежа.
  const duePaymentsBySale = useMemo(() => {
    // Выбор счёта в «Обзоре» распространяется и на «Платежи»: список, календарь
    // и счётчик на вкладке растут из этого массива, поэтому фильтруем в корне —
    // иначе пришлось бы повторять условие в трёх местах и однажды забыть.
    const scopedSales = selectedAccountId ? sales.filter(x => x.accountId === selectedAccountId) : sales;
    return scopedSales.map(sale => {
      if (sale.status !== 'ACTIVE' && sale.status !== 'DRAFT') return null;

      let paymentPool = sale.paymentPlan
        .filter(p => p.isPaid && p.isRealPayment !== false)
        .reduce((sum, p) => sum + p.amount, 0);

      const due: { date: Date; dayKey: string; amount: number }[] = [];

      sale.paymentPlan
        .filter(p => p.isRealPayment === false || p.isRealPayment === undefined)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .forEach(p => {
          const covered = Math.min(p.amount, paymentPool);
          paymentPool -= covered;
          const actualDue = p.amount - covered;
          if (actualDue > 0.01) {
            const d = new Date(p.date);
            due.push({ date: d, dayKey: mskDayKey(d), amount: actualDue });
          }
        });

      return due.length > 0 ? { sale, due } : null;
    }).filter((x): x is { sale: Sale; due: { date: Date; dayKey: string; amount: number }[] } => x !== null);
  }, [sales, selectedAccountId]);

// Платежи выбранного периода, сгруппированные по дням: так видно, что «11 августа ждём
// троих на 20 300 ₽», а не просто плоский перечень договоров вперемешку.
const paymentGroups = useMemo(() => {
  const todayKey = mskDayKey(new Date());
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowKey = mskDayKey(tomorrowDate);

  const weekEnd = new Date();
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndKey = mskDayKey(weekEnd);

  const selectedKey = selectedCalendarDate ? mskDayKey(selectedCalendarDate) : null;

  type Item = { sale: Sale; customerName: string; amount: number };
  const groups = new Map<string, { dayKey: string; date: Date; total: number; items: Item[] }>();

  duePaymentsBySale.forEach(({ sale, due }) => {
    const customerName = customers.find(c => c.id === sale.customerId)?.name || 'Неизвестный клиент';

    due.forEach(({ dayKey, date, amount }) => {
      // Строки «YYYY-MM-DD» сравниваются лексикографически так же, как хронологически
      let include = false;
      if (selectedKey) {
        include = dayKey === selectedKey;
      } else if (paymentDateFilter === 'WEEK') {
        include = dayKey >= todayKey && dayKey <= weekEndKey;
      } else if (paymentDateFilter === 'TODAY') {
        include = dayKey === todayKey;
      } else if (paymentDateFilter === 'TOMORROW') {
        include = dayKey === tomorrowKey;
      }
      if (!include) return;

      const group = groups.get(dayKey) || { dayKey, date, total: 0, items: [] };
      group.total += amount;
      // Несколько платежей одного договора в один день показываем одной строкой
      const existing = group.items.find(i => i.sale.id === sale.id);
      if (existing) existing.amount += amount;
      else group.items.push({ sale, customerName, amount });
      groups.set(dayKey, group);
    });
  });

  return [...groups.values()]
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey))
    .map(g => ({
      ...g,
      total: Math.round(g.total * 100) / 100,
      isToday: g.dayKey === todayKey,
      isTomorrow: g.dayKey === tomorrowKey,
      isPast: g.dayKey < todayKey,
      items: g.items.sort((a, b) => b.amount - a.amount),
    }));
}, [duePaymentsBySale, customers, paymentDateFilter, selectedCalendarDate]);

// Итог по выбранному периоду — для строки-сводки над списком
const periodSummary = useMemo(() => ({
  contracts: paymentGroups.reduce((sum, g) => sum + g.items.length, 0),
  amount: paymentGroups.reduce((sum, g) => sum + g.total, 0),
}), [paymentGroups]);

// Когда в выбранном периоде пусто — подсказываем ближайшую дату, чтобы экран
// не выглядел так, будто платежей нет вообще
const nextPaymentAfterPeriod = useMemo(() => {
  const todayKey = mskDayKey(new Date());
  let best: { dayKey: string; date: Date; amount: number; contracts: number } | null = null;

  const perDay = new Map<string, { date: Date; amount: number; sales: Set<string> }>();
  duePaymentsBySale.forEach(({ sale, due }) => {
    due.forEach(({ dayKey, date, amount }) => {
      if (dayKey < todayKey) return; // просрочка живёт на своей странице
      const e = perDay.get(dayKey) || { date, amount: 0, sales: new Set<string>() };
      e.amount += amount;
      e.sales.add(sale.id);
      perDay.set(dayKey, e);
    });
  });

  [...perDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, 1)
    .forEach(([dayKey, e]) => {
      best = { dayKey, date: e.date, amount: Math.round(e.amount * 100) / 100, contracts: e.sales.size };
    });

  return best;
}, [duePaymentsBySale]);


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

        const profitMargin = (sale.totalAmount - sale.buyPrice) / sale.totalAmount;
        if (profitMargin <= 0) return;

        // 1. Прибыль от оплаченных платежей из графика
        sale.paymentPlan.forEach(payment => {
            if (payment.isPaid && payment.isRealPayment !== false) {
                const paymentDate = new Date(payment.date);
                paymentDate.setHours(0, 0, 0, 0);
                if (paymentDate >= monthStart && paymentDate <= monthEnd) {
                    receivedProfit += payment.amount * profitMargin;
                }
            }
        });

        // 2. Прибыль от первого взноса (если продажа в этом месяце и взнос оплачен)
        if (sale.downPayment > 0) {
            const saleStart = new Date(sale.startDate);
            saleStart.setHours(0, 0, 0, 0);
            
            if (saleStart >= monthStart && saleStart <= monthEnd) {
                // Проверяем, что взнос оплачен
                const totalPaid = sale.totalAmount - sale.remainingAmount;
                if (totalPaid >= sale.downPayment) {
                    receivedProfit += sale.downPayment * profitMargin;
                }
            }
        }
    });

    return Math.round(receivedProfit * 100) / 100;
}, [sales, investors, selectedAccountId]);


// 📊 Ожидаемая прибыль в этом месяце
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

        const profitMargin = (sale.totalAmount - sale.buyPrice) / sale.totalAmount;
        if (profitMargin <= 0) return;

        // 1. Прибыль от неоплаченных платежей из графика
        sale.paymentPlan.forEach(payment => {
            if (payment.isRealPayment !== true && !payment.isPaid) {
                const paymentDate = new Date(payment.date);
                paymentDate.setHours(0, 0, 0, 0);
                if (paymentDate >= monthStart && paymentDate <= monthEnd) {
                    expectedProfit += payment.amount * profitMargin;
                }
            }
        });

        // 2. Прибыль от неоплаченного первого взноса
        // 🔧 ДОБАВЛЕНА ПРОВЕРКА ДАТЫ ПРОДАЖИ!
        if (sale.downPayment > 0) {
            const totalPaid = sale.totalAmount - sale.remainingAmount;
            if (totalPaid < sale.downPayment) {
                const saleStart = new Date(sale.startDate);
                saleStart.setHours(0, 0, 0, 0);
                
                // 🔧 Только если продажа создана в этом месяце
                if (saleStart >= monthStart && saleStart <= monthEnd) {
                    const unpaidDownPayment = sale.downPayment - totalPaid;
                    expectedProfit += unpaidDownPayment * profitMargin;
                }
            }
        }
    });

    return Math.round(expectedProfit * 100) / 100;
}, [sales, investors, selectedAccountId]);





// Суммы и число договоров по дням — из того же источника, что и список платежей,
// поэтому подсвеченный день всегда открывает непустой список.
const getPaymentsByDate = useMemo(() => {
  const map = new Map<string, { amount: number; contracts: number }>();

  duePaymentsBySale.forEach(({ due }) => {
    // Один договор может иметь несколько платежей в одном дне — в счётчике
    // договоров он должен учитываться один раз
    const daysOfThisSale = new Set<string>();

    due.forEach(({ dayKey, amount }) => {
      const current = map.get(dayKey) || { amount: 0, contracts: 0 };
      current.amount += amount;
      if (!daysOfThisSale.has(dayKey)) {
        current.contracts += 1;
        daysOfThisSale.add(dayKey);
      }
      map.set(dayKey, current);
    });
  });

  return map;
}, [duePaymentsBySale]);



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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50/30 dark:from-slate-900 dark:to-indigo-950/20 pb-24 w-full">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-6 animate-in fade-in slide-in-from-top-4 duration-500">

        {/* Подписка заканчивается в ближайшие сутки либо уже закончилась.
            Компонент сам решает, показываться ли — здесь условия не дублируем. */}
        <SubscriptionExpiryBanner user={user} onRenew={() => onAction('TARIFFS')} />

        {/* «Моя премия» — только у сотрудника с назначенным процентом.
            Компонент сам запрашивает числа с сервера и прячется, если процента нет. */}
        {user?.role === 'employee' && <MyBonusCard />}

        {/* Tabs */}
        {/* Обе вкладки flex-1, то есть равной ширины — капсуле хватает процентов,
            мерить кнопки не нужно. Контейнер без backdrop-blur намеренно: элемент
            с ним становится «корнем подложки», и стекло внутри перестало бы
            размывать страницу. */}
        <div className="relative flex p-1.5 rounded-2xl bg-white/60 dark:bg-slate-800/60 border border-white/70 dark:border-slate-700 shadow-sm">
          <div
            aria-hidden
            className="nav-glass-track"
            style={{
              left: 6,
              top: 6,
              bottom: 6,
              width: 'calc(50% - 6px)',
              transform: activeTab === 'overview' ? 'translateX(0)' : 'translateX(100%)',
            }}
          >
            <div className={`nav-glass-pill ${activeTab === 'upcoming' ? 'nav-glass-pill--moving' : ''}`} />
          </div>
          <button
            onClick={() => setActiveTab('overview')}
            className={`relative z-10 flex-1 py-3 text-sm font-bold rounded-xl transition-colors duration-300 ${
              activeTab === 'overview'
                ? 'text-indigo-600 dark:text-indigo-300'
                : 'text-slate-500 hover:text-indigo-600'
            }`}
          >
            Обзор
          </button>
          <button
            onClick={() => setActiveTab('upcoming')}
            className={`relative z-10 flex-1 py-3 text-sm font-bold rounded-xl transition-colors duration-300 ${
              activeTab === 'upcoming'
                ? 'text-indigo-600 dark:text-indigo-300'
                : 'text-slate-500 hover:text-indigo-600'
            }`}
          >
            Платежи
            {periodSummary.contracts > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white text-[10px] rounded-full flex items-center justify-center border-2 border-white dark:border-slate-800 shadow-sm">
                {periodSummary.contracts}
              </span>
            )}
          </button>
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
            <div className="space-y-6 animate-in fade-in duration-500">
                {/* Счёт и его баланс. Раньше здесь была лента чипов-фильтров:
                    она занимала строку, но не отвечала на главный вопрос —
                    сколько денег на счёте. Выбор счёта переехал в список по
                    нажатию на название. */}
                {(() => {
                  const liveAccounts = accounts.filter(a => !a.isArchived || a.id === selectedAccountId);
                  // Единственный счёт выбирать не из чего: показываем его имя и не
                  // делаем заголовок кнопкой — нажатие открывало бы список из
                  // одной строки.
                  const onlyOne = liveAccounts.length <= 1;
                  const current = selectedAccountId
                    ? accounts.find(a => a.id === selectedAccountId)
                    : (onlyOne ? liveAccounts[0] : null);
                  const title = current ? current.name : 'Все счета';
                  const value = selectedAccountId
                    ? (accountBalances[selectedAccountId] || 0)
                    : liveAccounts.reduce((sum, a) => sum + (accountBalances[a.id] || 0), 0);
                  // Целую часть и копейки разводим по цвету: крупное число читается
                  // с одного взгляда, копейки не отвлекают.
                  // С выключенными копейками сумму округляем, а не отрезаем:
                  // 1 850,99 должно показаться как 1 851, иначе рубль теряется.
                  const shown = appSettings.showCents ? Math.abs(value) : Math.round(Math.abs(value));
                  const [whole, frac] = shown.toFixed(2).split('.');
                  const grouped = Number(whole).toLocaleString('ru-RU');
                  return (
                    <div className="flex flex-col items-center pt-1 pb-2">
                      {onlyOne ? (
                        <div className="px-3 py-1.5 text-sm font-bold text-slate-700 dark:text-slate-200">
                          <span className="truncate max-w-[70vw] inline-block align-bottom">{title}</span>
                        </div>
                      ) : (
                        <button
                          onClick={() => setAccountPickerOpen(true)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold text-slate-700 dark:text-slate-200 active:scale-95 transition-transform"
                        >
                          <span className="truncate max-w-[60vw]">{title}</span>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                               strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>
                      )}

                      <div className="flex items-center gap-2 mt-2">
                        {hideBalance ? (
                          <span className="text-4xl font-extrabold tracking-tight text-slate-800 dark:text-white leading-none">••••••</span>
                        ) : (
                          <span className="text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-none">
                            {value < 0 ? '−' : ''}{grouped}
                            {appSettings.showCents && (
                              <span className="text-slate-400 dark:text-slate-500">,{frac}</span>
                            )}
                            <span className="text-2xl text-slate-400 dark:text-slate-500 ml-1">₽</span>
                          </span>
                        )}
                        <button
                          onClick={toggleHideBalance}
                          aria-label={hideBalance ? 'Показать сумму' : 'Скрыть сумму'}
                          className="text-slate-400 dark:text-slate-500 active:scale-90 transition-transform shrink-0"
                        >
                          {hideBalance ? (
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                              <line x1="1" y1="1" x2="23" y2="23" />
                            </svg>
                          ) : (
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          )}
                        </button>
                      </div>

                      {/* Действия над деньгами этого счёта. Приход и расход есть и в
                          меню «+», но там они в двух нажатиях и вне контекста счёта;
                          здесь открываются сразу с выбранным. «Операции» замыкают
                          связку: без них баланс — тупик, увидел странную цифру и
                          некуда нажать. */}
                      {canMoveMoney && (
                        <div className="flex items-stretch gap-2 mt-4 w-full max-w-xs">
                          {[
                            { id: 'INCOME', label: 'Приход', tone: 'text-emerald-600 dark:text-emerald-400',
                              icon: <><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></> },
                            { id: 'EXPENSE', label: 'Расход', tone: 'text-rose-500 dark:text-rose-400',
                              icon: <><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></> },
                            { id: 'OPERATIONS', label: 'Операции', tone: 'text-slate-500 dark:text-slate-300',
                              icon: <><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></> },
                          ].map(a => (
                            <button
                              key={a.id}
                              onClick={() => onAction(a.id, { accountId: current ? current.id : null })}
                              className="glass-surface rounded-2xl flex-1 flex flex-col items-center gap-1 py-2.5 active:scale-95 transition-transform"
                            >
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                   strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={a.tone}>
                                {a.icon}
                              </svg>
                              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">{a.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Выбор счёта. Нижний лист, а не выпадашка: на телефоне до него
                    легче дотянуться, и он не обрезается краем экрана. */}
                {accountPickerOpen && (
                  <div
                    className="fixed inset-0 z-modal flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
                    onClick={() => setAccountPickerOpen(false)}
                  >
                    <div
                      className="bg-white dark:bg-slate-800 w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[70vh] flex flex-col animate-slide-up-sheet"
                      onClick={e => e.stopPropagation()}
                    >
                      <div className="px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-700">
                        <h3 className="font-bold text-slate-800 dark:text-white">Счёт</h3>
                      </div>
                      <div className="p-2 overflow-y-auto">
                        {[{ id: null as string | null, name: 'Все счета' },
                          ...accounts.filter(a => !a.isArchived || a.id === selectedAccountId)
                                     .map(a => ({ id: a.id as string | null, name: a.name }))
                        ].map(item => {
                          const isActive = selectedAccountId === item.id;
                          const sum = item.id
                            ? (accountBalances[item.id] || 0)
                            : accounts.filter(a => !a.isArchived)
                                      .reduce((acc, a) => acc + (accountBalances[a.id] || 0), 0);
                          return (
                            <button
                              key={item.id ?? 'all'}
                              onClick={() => { setSelectedAccountId(item.id); setAccountPickerOpen(false); }}
                              className={`w-full flex items-center justify-between gap-3 px-3.5 py-3 rounded-xl text-left transition-colors ${
                                isActive ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'active:bg-slate-50 dark:active:bg-slate-700'
                              }`}
                            >
                              <span className={`font-semibold truncate ${isActive ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-200'}`}>
                                {item.name}
                              </span>
                              <span className="shrink-0 text-sm font-bold text-slate-500 dark:text-slate-400">
                                {hideBalance ? '••••' : `${formatCurrency(sum, appSettings.showCents)} ₽`}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Карточки статистики: 2 в ряд на мобилках, 4 на больших экранах */}
               <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
  {/* 1. Долг клиентов (перенесён на 1 место) */}
  <div className="group bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 dark:border-slate-700 hover:border-amber-200 flex flex-col relative overflow-hidden cursor-default">
    <div className="absolute -right-6 -top-6 w-24 h-24 bg-amber-50 dark:bg-amber-900/20 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-700 pointer-events-none"></div>
    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-amber-100 dark:bg-amber-900/30 rounded-xl flex items-center justify-center text-amber-600 dark:text-amber-400 mb-4 z-10 relative group-hover:bg-amber-500 group-hover:text-white transition-colors duration-300 shadow-sm">
      <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"/>
      </svg>
    </div>
    <div className="z-10 relative mt-auto">
      <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wide mb-1 leading-tight">Долг клиентов</p>
      <p className="text-lg sm:text-2xl font-bold text-slate-800 dark:text-white break-words leading-none">
        {formatCurrency(calculatedStats.totalOutstanding, appSettings.showCents)}
        <span className="text-xs sm:text-sm text-slate-400 ml-1 font-bold">₽</span>
      </p>
    </div>
  </div>

  {/* 2. Просрочено (НОВАЯ) */}
  <div className="group bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(220,38,38,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 dark:border-slate-700 hover:border-red-200 flex flex-col relative overflow-hidden cursor-pointer"
       onClick={() => onAction('VIEW_OVERDUE')}>
    <div className="absolute -right-6 -top-6 w-24 h-24 bg-red-50 dark:bg-red-900/20 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-700 pointer-events-none"></div>
    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-red-100 dark:bg-red-900/30 rounded-xl flex items-center justify-center text-red-600 dark:text-red-400 mb-4 z-10 relative group-hover:bg-red-500 group-hover:text-white transition-colors duration-300 shadow-sm">
      <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
      </svg>
    </div>
    <div className="z-10 relative mt-auto">
      <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wide mb-1 leading-tight">Просрочено</p>
      <p className="text-lg sm:text-2xl font-bold text-red-600 break-words leading-none">
        {formatCurrency(totalOverdue, appSettings.showCents)}
        <span className="text-xs sm:text-sm text-slate-400 ml-1 font-bold">₽</span>
      </p>

    </div>
  </div>

  {/* 3. Оборотные средства (оставлен на 3 месте) */}
  <div className="group bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 dark:border-slate-700 hover:border-blue-200 flex flex-col relative overflow-hidden cursor-default">
    <div className="absolute -right-6 -top-6 w-24 h-24 bg-blue-50 dark:bg-blue-900/20 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-700 pointer-events-none"></div>
    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center text-blue-600 dark:text-blue-400 mb-4 z-10 relative group-hover:bg-blue-500 group-hover:text-white transition-colors duration-300 shadow-sm">
      <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/>
      </svg>
    </div>
    <div className="z-10 relative mt-auto">
      <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wide mb-1 leading-tight">В обороте</p>
      <p className="text-lg sm:text-2xl font-bold text-slate-800 dark:text-white break-words leading-none">
        {formatCurrency(currentWorkingCapital, appSettings.showCents)}
        <span className="text-xs sm:text-sm text-slate-400 ml-1 font-bold">₽</span>
      </p>
    </div>
  </div>



  {/* 4. Собрано (ПЕРЕНЕСЁН СЮДА) */}
  <div className="group bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 dark:border-slate-700 hover:border-emerald-200 flex flex-col relative overflow-hidden cursor-default">
    <div className="absolute -right-6 -top-6 w-24 h-24 bg-emerald-50 dark:bg-emerald-900/20 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-700 pointer-events-none"></div>
    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-4 z-10 relative group-hover:bg-emerald-500 group-hover:text-white transition-colors duration-300 shadow-sm">
      <svg className="w-5 h-5 sm:w-6 sm:h-6" viewBox="0 0 24 24" fill="currentColor">
        <text x="5" y="18" fontSize="16" fontWeight="bold">₽</text>
      </svg>
    </div>
    <div className="z-10 relative mt-auto">
      <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wide mb-1 leading-tight">Собрано</p>
      <p className="text-lg sm:text-2xl font-bold text-slate-800 dark:text-white break-words leading-none">
        {formatCurrency(calculatedStats.totalRevenue, appSettings.showCents)}
        <span className="text-xs sm:text-sm text-slate-400 ml-1 font-bold">₽</span>
      </p>
    </div>
  </div>

  {/* 5. Закуп (НОВАЯ) */}
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
        {formatCurrency(totalBuyCost, appSettings.showCents)}
        <span className="text-xs sm:text-sm text-slate-400 ml-1 font-bold">₽</span>
      </p>

    </div>
  </div>

  {/* 6. Продажи в рассрочку (перенесён на 6 место) */}
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
        {formatCurrency(calculatedStats.installmentSalesTotal, appSettings.showCents)}
        <span className="text-xs sm:text-sm text-slate-400 ml-1 font-bold">₽</span>
      </p>
    </div>
  </div>

  {/* 7. Ожидаемые платежи */}
  <div className="bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] border border-slate-100 dark:border-slate-700 flex flex-col relative overflow-hidden cursor-default">
    <div className="absolute -right-6 -top-6 w-24 h-24 bg-amber-50 dark:bg-amber-900/20 rounded-full opacity-50 pointer-events-none"></div>
    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-amber-100 dark:bg-amber-900/30 rounded-xl flex items-center justify-center text-amber-600 dark:text-amber-400 mb-4 z-10 relative shadow-sm">
      <CalendarIcon size={20}/>
    </div>
    <div className="z-10 relative mt-auto">
      <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wide mb-1 leading-tight">Ожидаемые платежи</p>
      <p className="text-lg sm:text-2xl font-bold text-slate-800 dark:text-white break-words leading-none">
        {formatCurrency(expectedPaymentsThisMonth, appSettings.showCents)}
        <span className="text-xs sm:text-sm text-slate-400 ml-1 font-bold">₽</span>
      </p>
      <p className="text-[10px] sm:text-xs text-slate-400 mt-1">От клиентов в этом месяце</p>
    </div>
  </div>

  {/* 8. Получено в этом месяце */}
  <div className="group bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-100 dark:border-slate-700 hover:border-emerald-200 flex flex-col relative overflow-hidden cursor-default"
       onClick={() => setSelectedPaymentType('received')}>
    <div className="absolute -right-6 -top-6 w-24 h-24 bg-emerald-50 dark:bg-emerald-900/20 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-700 pointer-events-none"></div>
    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-4 z-10 relative group-hover:bg-emerald-500 group-hover:text-white transition-colors duration-300 shadow-sm">
      <svg className="w-5 h-5 sm:w-6 sm:h-6" viewBox="0 0 24 24" fill="currentColor">
        <text x="5" y="18" fontSize="16" fontWeight="bold">✓</text>
      </svg>
    </div>
    <div className="z-10 relative mt-auto">
      <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wide mb-1 leading-tight">Получено в этом месяце</p>
      <p className="text-lg sm:text-2xl font-bold text-slate-800 dark:text-white break-words leading-none">
        {formatCurrency(receivedPaymentsThisMonth, appSettings.showCents)}
        <span className="text-xs sm:text-sm text-slate-400 ml-1 font-bold">₽</span>
      </p>
      <p className="text-[10px] sm:text-xs text-slate-400 mt-1">Нажмите для деталей</p>
    </div>
    <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
      <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </div>
  </div>
</div>

{/* ═══════════════════════════════════════════════════════════════ */}
{/* 📊 СЕКЦИЯ ПРИБЫЛИ */}
{/* ═══════════════════════════════════════════════════════════════ */}
<div className="relative pt-6">
    {/* Декоративная линия */}
    <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-300 to-transparent"></div>
    
    {/* Карточки прибыли */}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        
        {/* Ожидаемая прибыль в этом месяце */}
      <div
    className="group bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-800 dark:to-blue-950/30 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(100,116,139,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-200 dark:border-slate-700 hover:border-blue-200 flex flex-col relative overflow-hidden cursor-pointer"
    onClick={() => setSelectedProfitType('expected')}
>
    <div className="absolute -right-6 -top-6 w-24 h-24 bg-blue-50 dark:bg-blue-900/20 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-700 pointer-events-none"></div>
    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-slate-600 rounded-xl flex items-center justify-center text-white mb-4 z-10 relative group-hover:scale-110 transition-transform duration-300 shadow-lg shadow-slate-200 dark:shadow-slate-900/30">
        <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
    </div>
    <div className="z-10 relative mt-auto">
        <p className="text-[10px] sm:text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wide mb-1 leading-tight">Ожидаемая прибыль</p>
        <p className="text-lg sm:text-2xl font-bold text-slate-800 dark:text-white break-words leading-none">
            {formatCurrency(expectedProfitThisMonth, appSettings.showCents)}
            <span className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 ml-1 font-bold">₽</span>
        </p>
        <p className="text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-300 mt-1">{currentMonthName}</p>
        <p className="text-[10px] sm:text-xs text-slate-400 mt-1">Нажмите для деталей</p>
    </div>
    <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
        <svg className="w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6"/>
        </svg>
    </div>
</div>
{/* Полученная прибыль в этом месяце */}
<div
    className="group bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(16,185,129,0.15)] hover:shadow-xl transition-all duration-300 border border-emerald-100 dark:border-emerald-900/50 hover:border-emerald-300 flex flex-col relative overflow-hidden cursor-pointer"
    onClick={() => setSelectedProfitType('received')}
>
    <div className="absolute -right-6 -top-6 w-24 h-24 bg-emerald-100 dark:bg-emerald-900/30 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-700 pointer-events-none"></div>
    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-emerald-500 rounded-xl flex items-center justify-center text-white mb-4 z-10 relative group-hover:scale-110 transition-transform duration-300 shadow-lg shadow-emerald-200 dark:shadow-emerald-900/30">
        <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/>
        </svg>
    </div>
    <div className="z-10 relative mt-auto">
        <p className="text-[10px] sm:text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide mb-1 leading-tight">Получено прибыли</p>
        <p className="text-lg sm:text-2xl font-bold text-slate-800 dark:text-white break-words leading-none">
            {formatCurrency(receivedProfitThisMonth, appSettings.showCents)}
            <span className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 ml-1 font-bold">₽</span>
        </p>
        <p className="text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-300 mt-1">{currentMonthName}</p>
        <p className="text-[10px] sm:text-xs text-emerald-500 mt-1">Нажмите для деталей</p>
    </div>
    <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
        <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6"/>
        </svg>
    </div>
</div>
        {/* Общая ожидаемая прибыль */}
        <div className="group bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-800 dark:to-blue-950/30 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(100,116,139,0.1)] hover:shadow-xl transition-all duration-300 border border-slate-200 dark:border-slate-700 hover:border-blue-200 flex flex-col relative overflow-hidden cursor-default">
            <div className="absolute -right-6 -top-6 w-24 h-24 bg-blue-50 dark:bg-blue-900/20 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-700 pointer-events-none"></div>
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-slate-600 rounded-xl flex items-center justify-center text-white mb-4 z-10 relative group-hover:scale-110 transition-transform duration-300 shadow-lg shadow-slate-200 dark:shadow-slate-900/30">
                <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
                </svg>
            </div>
            <div className="z-10 relative mt-auto">
                <p className="text-[10px] sm:text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wide mb-1 leading-tight">Всего ожидается</p>
                <p className="text-lg sm:text-2xl font-bold text-slate-800 dark:text-white break-words leading-none">
                    {formatCurrency(profitStats.expectedProfit, appSettings.showCents)}
                    <span className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 ml-1 font-bold">₽</span>
                </p>
            </div>
        </div>

        {/* Общая полученная прибыль */}
        <div className="group bg-gradient-to-br from-emerald-50 to-green-50 dark:from-emerald-950/30 dark:to-green-950/30 p-4 sm:p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(16,185,129,0.15)] hover:shadow-xl transition-all duration-300 border border-emerald-100 dark:border-emerald-900/50 hover:border-emerald-300 flex flex-col relative overflow-hidden cursor-default">
            <div className="absolute -right-6 -top-6 w-24 h-24 bg-emerald-100 dark:bg-emerald-900/30 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-700 pointer-events-none"></div>
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-emerald-600 to-green-500 rounded-xl flex items-center justify-center text-white mb-4 z-10 relative group-hover:scale-110 transition-transform duration-300 shadow-lg shadow-emerald-200 dark:shadow-emerald-900/30">
                <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
            </div>
            <div className="z-10 relative mt-auto">
                <p className="text-[10px] sm:text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide mb-1 leading-tight">Всего получено</p>
                <p className="text-lg sm:text-2xl font-bold text-slate-800 dark:text-white break-words leading-none">
                    {formatCurrency(profitStats.receivedProfit, appSettings.showCents)}
                    <span className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 ml-1 font-bold">₽</span>
                </p>
            </div>
        </div>
    </div>
</div>









                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div
                        className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 hover:shadow-md transition-all">
                        <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-4 flex items-center gap-2">
                            <span className="w-1 h-5 bg-indigo-500 rounded-full"></span>
                            Последние договоры
                        </h3>
                        <div className="space-y-3">
                            {lastFiveSales.length === 0 ? (
                                <div
                                    className="text-center py-8 text-slate-400 bg-slate-50 dark:bg-slate-900 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
                                    Нет договоров
                                </div>
                            ) : lastFiveSales.map((sale, idx) => (
                                <div key={sale.id}
                                     className="group flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900 hover:bg-white dark:hover:bg-slate-700 rounded-xl transition-all hover:shadow-md border border-transparent hover:border-indigo-100 dark:hover:border-indigo-900 animate-in fade-in slide-in-from-bottom-2"
                                     style={{animationDelay: `${idx * 50}ms`}}>
                                    <div className="min-w-0">
                                        <p className="font-bold text-sm text-slate-800 dark:text-white truncate">{customers.find(c => c.id === sale.customerId)?.name}</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{sale.productName} • {formatDate(sale.startDate)}</p>
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

                  <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 hover:shadow-md transition-all">
                       <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-4 flex items-center gap-2">
                        <span className="w-1 h-5 bg-indigo-500 rounded-full"></span>
                        Быстрые действия
                      </h3>
                       <div className="space-y-4">
                          <button
                            onClick={() => onAction('CREATE_SALE')}
                            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-indigo-500 text-white py-4 rounded-xl font-semibold hover:shadow-xl hover:from-indigo-700 hover:to-indigo-600 transition-all hover:-translate-y-0.5"
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
      <div className="flex gap-1 p-1 bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-xl shadow-sm">
        <button
          onClick={() => { setSelectedCalendarDate(null); setPaymentDateFilter('WEEK'); }}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all duration-300 ${
            !selectedCalendarDate && paymentDateFilter === 'WEEK'
              ? 'bg-gradient-to-r from-slate-800 to-slate-700 text-white shadow-md'
              : 'text-slate-600 dark:text-slate-300 hover:text-indigo-600'
          }`}
        >
          Неделя
        </button>
        <button
          onClick={() => { setSelectedCalendarDate(null); setPaymentDateFilter('TODAY'); }}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all duration-300 ${
            !selectedCalendarDate && paymentDateFilter === 'TODAY'
              ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-md shadow-emerald-200'
              : 'text-slate-600 dark:text-slate-300 hover:text-emerald-600'
          }`}
        >
          Сегодня
        </button>
        <button
          onClick={() => { setSelectedCalendarDate(null); setPaymentDateFilter('TOMORROW'); }}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all duration-300 ${
            !selectedCalendarDate && paymentDateFilter === 'TOMORROW'
              ? 'bg-gradient-to-r from-amber-500 to-amber-400 text-white shadow-md shadow-amber-200'
              : 'text-slate-600 dark:text-slate-300 hover:text-amber-500'
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
        setPaymentDateFilter('WEEK');
      }
    }}
    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all duration-300 border ${
      selectedCalendarDate
        ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white border-indigo-600 shadow-md shadow-indigo-200'
        : 'bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-300 hover:text-indigo-600'
    }`}
  >
    <CalendarIcon size={16} />
    {selectedCalendarDate ? formatDate(selectedCalendarDate.toISOString()) : 'Календарь'}
    {selectedCalendarDate && (
      <button
        onClick={(e) => { e.stopPropagation(); setSelectedCalendarDate(null); }}
        className="ml-1 w-4 h-4 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center"
      >
        ✕
      </button>
    )}
  </button>

  {/* 🔹 Выпадающий календарь — ИСПРАВЛЕННЫЙ */}
  {showCalendarPicker && (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4 sm:absolute sm:inset-auto sm:top-full sm:left-0 sm:m-0 sm:p-0 sm:w-auto sm:justify-start">
      {/* Затемнение фона для мобильных */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm sm:hidden"
        onClick={() => setShowCalendarPicker(false)}
      />

      {/* Сам календарь */}
      <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 p-4 w-full max-w-[320px] animate-in fade-in zoom-in-95 duration-200 sm:min-w-[280px]">
        {/* Заголовок календаря */}
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1))}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <span className="text-sm font-bold text-slate-700 dark:text-slate-300 capitalize">
            {calendarMonth.toLocaleString('ru-RU', { month: 'long', year: 'numeric' })}
          </span>
          <button
            onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1))}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        {/* Сетка дней */}
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-slate-400 mb-2">
          {['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d => <span key={d}>{d}</span>)}
        </div>
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
            const todayKey = mskDayKey(new Date());
            for (let d = 1; d <= lastDay.getDate(); d++) {
              const date = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), d, 12);
              // Полдень, а не полночь: у даты, собранной на полночь, при переводе в
              // московский день можно уехать на сутки назад в западных поясах.
              const dateKey = mskDayKey(date);
              const entry = getPaymentsByDate.get(dateKey);
              const amount = entry?.amount || 0;
              const contracts = entry?.contracts || 0;
              const hasPayments = amount > 0;
              const isToday = dateKey === todayKey;
              const isPast = dateKey < todayKey;
              const isSelected = selectedCalendarDate ? mskDayKey(selectedCalendarDate) === dateKey : false;

              days.push(
                <button
                  key={d}
                  onClick={() => {
                    setSelectedCalendarDate(date);
                    setShowCalendarPicker(false);
                  }}
                  title={hasPayments ? `${contracts} ${contracts === 1 ? 'договор' : contracts < 5 ? 'договора' : 'договоров'} · ${formatCurrency(amount, false)} ₽` : undefined}
                  className={`aspect-square rounded-xl text-xs flex flex-col items-center justify-center relative transition-all font-semibold ${
                    isSelected
                      ? 'bg-gradient-to-br from-indigo-600 to-indigo-500 text-white font-bold shadow-lg scale-105'
                      : isToday
                        ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-bold border-2 border-indigo-300 dark:border-indigo-800'
                        : hasPayments
                          ? isPast
                            // Дни, срок которых уже прошёл, а деньги не пришли — приглушённо,
                            // чтобы не путать их с предстоящими поступлениями
                            ? 'bg-slate-100 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-600'
                            : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-900/50'
                          : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <span className="text-sm">{d}</span>
                  {hasPayments && !isSelected && (
                    <span className={`text-[9px] font-bold mt-0.5 ${isPast ? 'text-slate-400 dark:text-slate-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {amount >= 1000 ? `${Math.round(amount / 1000)}к` : `${Math.round(amount)}`}
                    </span>
                  )}
                  {/* Точки — сколько договоров в этот день (до трёх, дальше просто «3+») */}
                  {hasPayments && contracts > 1 && (
                    <span className="absolute bottom-1 flex gap-0.5">
                      {Array.from({ length: Math.min(contracts, 3) }).map((_, i) => (
                        <span key={i} className={`w-1 h-1 rounded-full ${
                          isSelected ? 'bg-white/80' : isPast ? 'bg-slate-400' : 'bg-emerald-500'
                        }`} />
                      ))}
                    </span>
                  )}
                </button>
              );
            }
            return days;
          })()}
        </div>

        {/* Легенда */}
        <div className="flex flex-wrap items-center justify-center gap-3 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 text-[10px] text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 bg-indigo-100 dark:bg-indigo-900/30 rounded border border-indigo-300 dark:border-indigo-800" /> Сегодня
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 bg-emerald-50 dark:bg-emerald-900/30 rounded border border-emerald-200 dark:border-emerald-900/50" /> Ожидается
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 bg-slate-100 dark:bg-slate-700/50 rounded border border-slate-200 dark:border-slate-600" /> Срок прошёл
          </span>
        </div>
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

    {/* 🔹 Сводка за период — сразу видно, сколько денег ждём */}
    {paymentGroups.length > 0 && (
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-indigo-50 to-white dark:from-indigo-950/40 dark:to-slate-800/60 rounded-2xl border border-indigo-100 dark:border-indigo-900/40">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          {periodSummary.contracts} {periodSummary.contracts === 1 ? 'платёж' : periodSummary.contracts < 5 ? 'платежа' : 'платежей'}
          {' · '}
          {paymentGroups.length} {paymentGroups.length === 1 ? 'день' : paymentGroups.length < 5 ? 'дня' : 'дней'}
        </span>
        <span className="text-lg font-bold text-indigo-700 dark:text-indigo-400">
          {formatCurrency(periodSummary.amount, appSettings.showCents)} ₽
        </span>
      </div>
    )}

    {/* 🔹 Список платежей, сгруппированный по дням */}
    {paymentGroups.length === 0 ? (
      <div className="text-center py-14 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
        <div className="text-5xl mb-3 opacity-30">📅</div>
        <p className="text-slate-500 dark:text-slate-400 font-medium">
          {selectedCalendarDate
            ? 'На выбранную дату платежей нет'
            : paymentDateFilter === 'TODAY' ? 'На сегодня платежей нет'
            : paymentDateFilter === 'TOMORROW' ? 'На завтра платежей нет'
            : 'На ближайшую неделю платежей нет'}
        </p>
        {/* Пустой экран не должен выглядеть так, будто платежей нет вовсе */}
        {nextPaymentAfterPeriod ? (
          <button
            onClick={() => { setSelectedCalendarDate(nextPaymentAfterPeriod.date); }}
            className="mt-4 inline-flex flex-col items-center gap-1 px-5 py-3 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
          >
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Ближайший платёж</span>
            <span className="text-sm font-bold text-indigo-700 dark:text-indigo-400">
              {nextPaymentAfterPeriod.date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
              {' · '}
              {formatCurrency(nextPaymentAfterPeriod.amount, appSettings.showCents)} ₽
            </span>
          </button>
        ) : (
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Все платежи по расписанию</p>
        )}
      </div>
    ) : (
      <div className="space-y-5">
        {paymentGroups.map((group, gIdx) => (
          <div key={group.dayKey} className="space-y-2 animate-in fade-in slide-in-from-bottom-2"
               style={{ animationDelay: `${gIdx * 80}ms` }}>
            {/* Заголовок дня */}
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <span className={`text-sm font-bold ${
                  group.isToday ? 'text-emerald-600 dark:text-emerald-400'
                  : group.isTomorrow ? 'text-amber-600 dark:text-amber-400'
                  : 'text-slate-700 dark:text-slate-200'
                }`}>
                  {group.isToday ? 'Сегодня' : group.isTomorrow ? 'Завтра'
                    : group.date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
                </span>
                <span className="text-[11px] text-slate-400 dark:text-slate-500">
                  {group.date.toLocaleDateString('ru-RU', { weekday: 'short' })}
                </span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                  {group.items.length}
                </span>
              </div>
              <span className="text-sm font-bold text-slate-600 dark:text-slate-300">
                {formatCurrency(group.total, appSettings.showCents)} ₽
              </span>
            </div>

            {group.items.map(item => (
              <div
                key={`${group.dayKey}_${item.sale.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedPaymentForAction({
                    sale: item.sale,
                    customerName: item.customerName,
                    customerPhone: customers.find(c => c.id === item.sale.customerId)?.phone,
                    totalDue: item.amount,
                    dueDate: group.date,
                    dueDayKey: group.dayKey,
                  });
                }}
                className={`group bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm p-4 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 border-l-4 border border-slate-100 dark:border-slate-700 hover:border-indigo-200 dark:hover:border-indigo-800 cursor-pointer ${
                  group.isToday ? 'border-l-emerald-500'
                  : group.isTomorrow ? 'border-l-amber-400'
                  : 'border-l-indigo-300 dark:border-l-indigo-700'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-800 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors break-words leading-tight">
                      {item.customerName}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 break-words">
                      {item.sale.productName}
                    </p>
                  </div>
                  <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400 whitespace-nowrap shrink-0">
                    {formatCurrency(item.amount, appSettings.showCents)} ₽
                  </p>
                </div>

                {/* Задолженность по этому же договору — предупреждение, что клиент уже должен */}
                {(() => {
                  const overdueDebt = calculateSaleOverdue(item.sale);
                  if (overdueDebt <= 0) return null;
                  return (
                    <div className="mt-3 pt-2.5 border-t border-dashed border-rose-200 dark:border-rose-900/50 flex items-center justify-between text-xs">
                      <span className="text-rose-600 dark:text-rose-400 font-medium">⚠️ Задолженность</span>
                      <span className="font-bold text-rose-700 dark:text-rose-400 whitespace-nowrap">
                        {formatCurrency(overdueDebt, appSettings.showCents)} ₽
                      </span>
                    </div>
                  );
                })()}
              </div>
            ))}
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
                customerPhone={selectedPaymentForAction.customerPhone}
                totalDue={selectedPaymentForAction.totalDue}
                dueDate={selectedPaymentForAction.dueDate}
                dueDayKey={selectedPaymentForAction.dueDayKey}
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


{selectedProfitType && (
    <ProfitDetailsModal
        type={selectedProfitType}
        sales={sales}
        customers={customers}
        investors={investors}
        selectedAccountId={selectedAccountId}
        onClose={() => setSelectedProfitType(null)}
        onSelectCustomer={(customerId) => {
            setSelectedProfitType(null);
            onSelectCustomer(customerId); 
        }}
        appSettings={appSettings}
    />
)}


      </div>
    </div>
  );
};

export default Dashboard;
