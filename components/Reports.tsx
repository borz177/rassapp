import React, { useMemo, useState } from 'react';
import { Investor, AppSettings, Sale, Expense, Account, Customer } from '../types';
import { formatCurrency, getAccountShares, getManagerSharePercent, escapeHtml, isAccountForInvestor } from '../src/utils';
import {
    PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
    AreaChart, Area
} from 'recharts';

interface ReportFilters {
    accountId: string;
    period: { start: string; end: string; };
}

interface ReportData {
    customerPaymentsInPeriod: number;
    expectedManagerProfit: number;
    expectedInvestorProfit: number;
    realizedManagerProfit: number;
    realizedInvestorProfit: number;
}

interface ReportsProps {
    investors: Investor[];
    filters: ReportFilters;
    onFiltersChange: React.Dispatch<React.SetStateAction<ReportFilters>>;
    data: ReportData;
    appSettings: AppSettings;
    sales: Sale[];
    expenses: Expense[];
    accounts: Account[];
    customers: Customer[];
}

type PeriodPreset = 'today' | 'week' | 'month' | 'lastMonth' | 'quarter' | 'year' | 'all';

const PRESET_LABELS: Record<PeriodPreset, string> = {
    today: 'Сегодня', week: '7 дней', month: 'Месяц',
    lastMonth: 'Пр. месяц', quarter: 'Квартал', year: 'Год', all: 'Всё время',
};

function getPeriodDates(preset: PeriodPreset): { start: string; end: string } {
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().split('T')[0];
    const todayStr = fmt(today);
    switch (preset) {
        case 'today': return { start: todayStr, end: todayStr };
        case 'week': { const d = new Date(today); d.setDate(today.getDate() - 7); return { start: fmt(d), end: todayStr }; }
        case 'month': return { start: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), end: todayStr };
        case 'lastMonth': {
            const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            const e = new Date(today.getFullYear(), today.getMonth(), 0);
            return { start: fmt(s), end: fmt(e) };
        }
        case 'quarter': { const d = new Date(today); d.setMonth(today.getMonth() - 3); return { start: fmt(d), end: todayStr }; }
        case 'year': { const d = new Date(today); d.setFullYear(today.getFullYear() - 1); return { start: fmt(d), end: todayStr }; }
        case 'all': return { start: '2020-01-01', end: todayStr };
    }
}

const INVESTOR_PALETTE = ['#6366F1', '#8B5CF6', '#EC4899', '#F59E0B', '#06B6D4', '#84CC16', '#EF4444'];
const MONTH_NAMES = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

type KpiColor = 'emerald' | 'teal' | 'sky' | 'indigo' | 'purple' | 'amber' | 'red';

const COLOR_MAP: Record<KpiColor, { bg: string; shadow: string; text: string; light: string; border: string }> = {
    emerald: { bg: 'from-emerald-500 to-emerald-400', shadow: 'shadow-emerald-200 dark:shadow-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-400', light: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400', border: 'hover:border-emerald-200 dark:hover:border-emerald-800' },
    teal:    { bg: 'from-teal-500 to-teal-400',       shadow: 'shadow-teal-200 dark:shadow-teal-900/30',    text: 'text-teal-700 dark:text-teal-400',    light: 'bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400',    border: 'hover:border-teal-200 dark:hover:border-teal-800'    },
    sky:     { bg: 'from-sky-500 to-sky-400',         shadow: 'shadow-sky-200 dark:shadow-sky-900/30',     text: 'text-sky-700 dark:text-sky-400',     light: 'bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400',      border: 'hover:border-sky-200 dark:hover:border-sky-800'     },
    indigo:  { bg: 'from-indigo-500 to-indigo-400',   shadow: 'shadow-indigo-200 dark:shadow-indigo-900/30',  text: 'text-indigo-700 dark:text-indigo-400',  light: 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400', border: 'hover:border-indigo-200 dark:hover:border-indigo-800' },
    purple:  { bg: 'from-purple-500 to-purple-400',   shadow: 'shadow-purple-200 dark:shadow-purple-900/30',  text: 'text-purple-700 dark:text-purple-400',  light: 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400', border: 'hover:border-purple-200 dark:hover:border-purple-800' },
    amber:   { bg: 'from-amber-500 to-amber-400',     shadow: 'shadow-amber-200 dark:shadow-amber-900/30',   text: 'text-amber-700 dark:text-amber-400',   light: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',   border: 'hover:border-amber-200 dark:hover:border-amber-800'  },
    red:     { bg: 'from-red-500 to-red-400',         shadow: 'shadow-red-200 dark:shadow-red-900/30',     text: 'text-red-700 dark:text-red-400',     light: 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400',       border: 'hover:border-red-200 dark:hover:border-red-800'    },
};

interface KpiCardProps {
    icon: string; label: string; value: string; badge: string;
    color: KpiColor; subtext?: string;
}
const KpiCard: React.FC<KpiCardProps> = ({ icon, label, value, badge, color, subtext }) => {
    const c = COLOR_MAP[color];
    return (
        <div className={`group bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm p-5 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 border border-slate-100 dark:border-slate-700 ${c.border} hover:-translate-y-1`}>
            <div className="flex items-center justify-between mb-3">
                <div className={`p-2.5 bg-gradient-to-br ${c.bg} text-white rounded-xl shadow-lg ${c.shadow} group-hover:scale-110 transition-transform text-base leading-none`}>{icon}</div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c.light}`}>{badge}</span>
            </div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1 leading-tight">{label}</p>
            <p className={`text-xl font-bold ${c.text} leading-tight`}>{value}</p>
            {subtext && <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{subtext}</p>}
        </div>
    );
};

interface ProgressRowProps {
    label: string; realized: number; expected: number;
    color: 'emerald' | 'indigo'; showCents?: boolean;
}
const ProgressRow: React.FC<ProgressRowProps> = ({ label, realized, expected, color, showCents }) => {
    const pct = expected > 0 ? Math.min(Math.round((realized / expected) * 100), 100) : 0;
    const barColor = color === 'emerald' ? 'bg-emerald-500' : 'bg-indigo-500';
    const textColor = color === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : 'text-indigo-600 dark:text-indigo-400';
    return (
        <div>
            <div className="flex justify-between items-center mb-1.5">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span>
                <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-500 dark:text-slate-400 font-medium">{formatCurrency(realized, showCents)} ₽</span>
                    <span className="text-slate-300 dark:text-slate-600">/</span>
                    <span className="text-slate-400 dark:text-slate-500">{formatCurrency(expected, showCents)} ₽</span>
                    <span className={`font-bold ${textColor}`}>{pct}%</span>
                </div>
            </div>
            <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                <div className={`h-full ${barColor} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }}></div>
            </div>
        </div>
    );
};

const Reports: React.FC<ReportsProps> = ({
    investors, filters, onFiltersChange, data, appSettings,
    sales = [], expenses = [], accounts = [], customers = []
}) => {
    const hasInvestors = investors.length > 0;
    const showInvestorBreakdown = filters.accountId === 'ALL' && investors.length > 1;

    const handlePeriodInput = (field: 'start' | 'end', value: string) => {
        onFiltersChange(prev => ({ ...prev, period: { ...prev.period, [field]: value } }));
    };
    const applyPreset = (preset: PeriodPreset) => {
        onFiltersChange(prev => ({ ...prev, period: getPeriodDates(preset) }));
    };

    // Core metrics
    const totalExpected = data.expectedManagerProfit + data.expectedInvestorProfit;
    const totalRealized = data.realizedManagerProfit + data.realizedInvestorProfit;
    const efficiency = totalExpected > 0 ? Math.round((totalRealized / totalExpected) * 100) : 0;
    const managerSharePct = totalRealized > 0 ? Math.round((data.realizedManagerProfit / totalRealized) * 100) : 0;
    const investorSharePct = totalRealized > 0 ? Math.round((data.realizedInvestorProfit / totalRealized) * 100) : 0;
    const hasData = data.customerPaymentsInPeriod > 0 || totalExpected > 0 || totalRealized > 0;

    // Payment timeline (line chart data)
    const paymentTimeline = useMemo(() => {
        if (!sales.length) return [];
        const startDate = new Date(filters.period.start);
        const endDate = new Date(filters.period.end);
        endDate.setHours(23, 59, 59, 999);
        const diffDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        const useMonthly = diffDays > 90;

        let filteredSales = sales;
        if (filters.accountId !== 'ALL') {
            filteredSales = sales.filter(s => s.accountId === filters.accountId);
        }

        const buckets: Record<string, number> = {};
        filteredSales.forEach(sale => {
            const allPayments = [
                { date: sale.startDate, amount: sale.downPayment },
                ...sale.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false)
            ];
            allPayments.forEach(p => {
                const pDate = new Date(p.date);
                if (pDate >= startDate && pDate <= endDate) {
                    const key = useMonthly
                        ? `${pDate.getFullYear()}-${String(pDate.getMonth() + 1).padStart(2, '0')}`
                        : p.date.substring(0, 10);
                    buckets[key] = (buckets[key] || 0) + p.amount;
                }
            });
        });

        return Object.entries(buckets)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, amount]) => {
                let label: string;
                if (useMonthly) {
                    const [year, month] = key.split('-');
                    label = `${MONTH_NAMES[parseInt(month) - 1]} ${year}`;
                } else {
                    label = key.substring(5).replace('-', '.');
                }
                return { label, amount, key };
            });
    }, [sales, accounts, filters]);

    // Expense stats
    const expenseStats = useMemo(() => {
        if (!expenses.length) return null;
        const startDate = new Date(filters.period.start);
        const endDate = new Date(filters.period.end);
        endDate.setHours(23, 59, 59, 999);

        const periodExpenses = (expenses as Expense[]).filter((e: Expense) => {
            const eDate = new Date(e.date);
            if (!(eDate >= startDate && eDate <= endDate && !e.isRefund)) return false;
            if (filters.accountId !== 'ALL') return e.accountId === filters.accountId;
            return true;
        });
        if (!periodExpenses.length) return null;

        const investorPayouts = periodExpenses
            .filter((e: Expense) => e.payoutType === 'PROFIT' || e.payoutType === 'INVESTMENT')
            .reduce((sum: number, e: Expense) => sum + e.amount, 0);
        const otherExpenses = periodExpenses
            .filter((e: Expense) => e.payoutType !== 'PROFIT' && e.payoutType !== 'INVESTMENT')
            .reduce((sum: number, e: Expense) => sum + e.amount, 0);
        const total = periodExpenses.reduce((sum: number, e: Expense) => sum + e.amount, 0);

        return { investorPayouts, otherExpenses, total, count: periodExpenses.length };
    }, [expenses, accounts, filters]);

    // Accurate per-investor breakdown from real sales
    const totalInvestment = useMemo(() => investors.reduce((s, inv) => s + inv.initialAmount, 0), [investors]);

    const accurateInvestorBreakdown = useMemo(() => {
        if (!investors.length) return [];
        const startDate = new Date(filters.period.start);
        const endDate = new Date(filters.period.end);
        endDate.setHours(23, 59, 59, 999);

        return investors.map((inv, idx) => {
            const investorSales = sales.filter(s => {
                const acc = accounts.find(a => a.id === s.accountId);
                return !!acc && (isAccountForInvestor(acc, inv.id) || (acc.partners || []).includes(inv.id));
            }).filter(s => s.status === 'ACTIVE' || s.status === 'COMPLETED');

            // 🔒 Доля инвестора в пуле считается по вложенной сумме и может зависеть от даты
            // (см. getAccountShares) — для будущей/ожидаемой прибыли берём текущий состав пула,
            // для уже полученных платежей — состав пула на дату конкретного платежа.
            let expectedProfit = 0;
            investorSales.forEach(sale => {
                if (sale.buyPrice <= 0) return;
                const saleProfit = sale.totalAmount - sale.buyPrice;
                if (saleProfit <= 0) return;
                const acc = accounts.find(a => a.id === sale.accountId);
                const myShare = getAccountShares(acc, investors).find(m => m.investor.id === inv.id);
                if (myShare) expectedProfit += saleProfit * (myShare.percentage / 100);
            });

            let realizedProfit = 0;
            investorSales.forEach(sale => {
                if (sale.buyPrice <= 0 || sale.totalAmount <= sale.buyPrice) return;
                const profitMargin = (sale.totalAmount - sale.buyPrice) / sale.totalAmount;
                const acc = accounts.find(a => a.id === sale.accountId);
                const paymentsInPeriod = [
                    { date: sale.startDate, amount: sale.downPayment },
                    ...sale.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false)
                ].filter(p => { const d = new Date(p.date); return d >= startDate && d <= endDate; });
                paymentsInPeriod.forEach(p => {
                    const myShare = getAccountShares(acc, investors, p.date).find(m => m.investor.id === inv.id);
                    if (myShare) realizedProfit += p.amount * profitMargin * (myShare.percentage / 100);
                });
            });

            const share = totalInvestment > 0 ? Math.round((inv.initialAmount / totalInvestment) * 100) : 0;
            return {
                inv, share, expectedProfit, realizedProfit,
                salesCount: investorSales.length,
                color: INVESTOR_PALETTE[idx % INVESTOR_PALETTE.length],
            };
        });
    }, [investors, accounts, sales, filters, totalInvestment]);

    // Modal state
    const [activeModal, setActiveModal] = useState<'payments' | 'investor_payouts' | 'other_expenses' | null>(null);
    const [closingModal, setClosingModal] = useState<'active' | 'export' | null>(null);

    const closeActiveModal = () => setClosingModal('active');
    const closeExportModal = () => setClosingModal('export');

    // Export modal state
    const [exportModal, setExportModal] = useState<'pdf' | 'csv' | null>(null);
    const [exportOptions, setExportOptions] = useState({
        timeline: true,
        investorBreakdown: true,
        expenses: true,
        overduePayments: false,
        customerBreakdown: false,
    });
    const toggleExportOption = (key: keyof typeof exportOptions) =>
        setExportOptions((prev: typeof exportOptions) => ({ ...prev, [key]: !prev[key] }));

    // Payment detail items for modal
    const paymentsDetail = useMemo(() => {
        if (!sales.length) return [] as { date: string; productName: string; customerId: string; amount: number; label: string }[];
        const startDate = new Date(filters.period.start);
        const endDate = new Date(filters.period.end);
        endDate.setHours(23, 59, 59, 999);
        const typedSales = sales as Sale[];
        const filteredSales = filters.accountId !== 'ALL'
            ? typedSales.filter((s: Sale) => s.accountId === filters.accountId)
            : typedSales;
        const items: { date: string; productName: string; customerId: string; amount: number; label: string }[] = [];
        filteredSales.forEach((sale: Sale) => {
            const dpDate = new Date(sale.startDate);
            if (dpDate >= startDate && dpDate <= endDate && sale.downPayment > 0) {
                items.push({ date: sale.startDate, productName: sale.productName, customerId: sale.customerId, amount: sale.downPayment, label: 'Первый взнос' });
            }
            (sale.paymentPlan || []).filter((p: any) => p.isPaid && p.isRealPayment !== false).forEach((p: any) => {
                const pDate = new Date(p.date);
                if (pDate >= startDate && pDate <= endDate) {
                    items.push({ date: p.actualDate || p.date, productName: sale.productName, customerId: sale.customerId, amount: p.amount, label: 'Платёж' + (p.note ? ` · ${p.note}` : '') });
                }
            });
        });
        return items.sort((a, b) => b.date.localeCompare(a.date));
    }, [sales, accounts, filters]);

    // Investor payout detail items for modal
    const investorPayoutsDetail = useMemo(() => {
        const typedExpenses = expenses as Expense[];
        if (!typedExpenses.length) return [] as (Expense & { investorName?: string })[];
        const startDate = new Date(filters.period.start);
        const endDate = new Date(filters.period.end);
        endDate.setHours(23, 59, 59, 999);
        return typedExpenses.filter((e: Expense) => {
            const eDate = new Date(e.date);
            if (!(eDate >= startDate && eDate <= endDate && !e.isRefund &&
                (e.payoutType === 'PROFIT' || e.payoutType === 'INVESTMENT'))) return false;
            if (filters.accountId !== 'ALL') return e.accountId === filters.accountId;
            return true;
        }).sort((a: Expense, b: Expense) => b.date.localeCompare(a.date))
            .map((e: Expense) => ({ ...e, investorName: (investors as Investor[]).find((i: Investor) => i.id === e.investorId)?.name }));
    }, [expenses, investors, filters]);

    // Other expense detail items for modal
    const otherExpensesDetail = useMemo(() => {
        const typedExpenses = expenses as Expense[];
        if (!typedExpenses.length) return [] as Expense[];
        const startDate = new Date(filters.period.start);
        const endDate = new Date(filters.period.end);
        endDate.setHours(23, 59, 59, 999);
        return typedExpenses.filter((e: Expense) => {
            const eDate = new Date(e.date);
            if (!(eDate >= startDate && eDate <= endDate && !e.isRefund &&
                e.payoutType !== 'PROFIT' && e.payoutType !== 'INVESTMENT')) return false;
            if (filters.accountId !== 'ALL') return e.accountId === filters.accountId;
            return true;
        }).sort((a: Expense, b: Expense) => b.date.localeCompare(a.date));
    }, [expenses, accounts, filters]);

    // Overdue payments — same algorithm as calculateSaleOverdue in Contracts.tsx
    // Uses remainingAmount (not isPaid) to correctly account for partial/cash payments
    const overduePayments = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const result: { saleId: string; productName: string; customerName: string; overdueAmount: number; missedCount: number; earliestMissedDate: string }[] = [];

        (sales as Sale[])
            .filter((s: Sale) => {
                if (s.status === 'COMPLETED' || s.remainingAmount <= 0) return false;
                if (filters.accountId !== 'ALL') return s.accountId === filters.accountId;
                return true;
            })
            .forEach((sale: Sale) => {
                // expectedTotal = первый взнос + все плановые платежи, срок которых уже прошёл
                let expectedTotal = sale.downPayment;
                (sale.paymentPlan || []).forEach((p: any) => {
                    if (!p.isRealPayment && new Date(p.date) < today) expectedTotal += p.amount;
                });
                const totalPaid = sale.totalAmount - sale.remainingAmount;
                const overdueAmount = Math.max(0, expectedTotal - totalPaid);
                if (overdueAmount <= 0) return;

                // Считаем пропущенные месяцы (аналог overduePaymentsList в Contracts.tsx)
                const planPayments = (sale.paymentPlan || []).filter((p: any) => !p.isRealPayment);
                const sortedPlan = [...planPayments].sort((a: any, b: any) =>
                    new Date(a.date).getTime() - new Date(b.date).getTime()
                );
                let remaining = Math.max(0, totalPaid - sale.downPayment);
                let paidMonths = 0;
                for (const p of sortedPlan) {
                    if (remaining >= (p as any).amount * 0.99) { remaining -= (p as any).amount; paidMonths++; }
                    else break;
                }
                const missedList = sortedPlan.filter((p: any, idx: number) =>
                    new Date(p.date) < today && idx >= paidMonths
                );

                const customer = (customers as Customer[]).find((c: Customer) => c.id === sale.customerId);
                result.push({
                    saleId: sale.id,
                    productName: sale.productName,
                    customerName: customer?.name || 'Клиент',
                    overdueAmount,
                    missedCount: missedList.length,
                    earliestMissedDate: missedList[0] ? (missedList[0] as any).date.substring(0, 10) : '',
                });
            });

        return result.sort((a, b) => b.overdueAmount - a.overdueAmount);
    }, [sales, customers, accounts, filters]);

    // Customer breakdown — group paymentsDetail by customer
    const customerBreakdown = useMemo(() => {
        const map: Record<string, { customerName: string; total: number; count: number }> = {};
        paymentsDetail.forEach((item: { customerId: string; amount: number; productName: string; date: string; label: string }) => {
            if (!map[item.customerId]) {
                const customer = (customers as Customer[]).find((c: Customer) => c.id === item.customerId);
                map[item.customerId] = { customerName: customer?.name || 'Клиент', total: 0, count: 0 };
            }
            map[item.customerId].total += item.amount;
            map[item.customerId].count += 1;
        });
        return Object.entries(map)
            .map(([customerId, v]) => ({ customerId, ...v }))
            .sort((a, b) => b.total - a.total);
    }, [paymentsDetail, customers]);

    // Chart data
    const pieData = [
        { name: 'Моя прибыль', value: data.realizedManagerProfit, color: '#10B981' },
        { name: 'Прибыль инвесторов', value: data.realizedInvestorProfit, color: '#6366F1' },
    ].filter(d => d.value > 0);

    const barData = [
        { name: 'Менеджер', Ожидается: data.expectedManagerProfit, Получено: data.realizedManagerProfit },
        { name: 'Инвесторы', Ожидается: data.expectedInvestorProfit, Получено: data.realizedInvestorProfit },
    ];

    const efficiencyColor: KpiColor = efficiency >= 80 ? 'emerald' : efficiency >= 50 ? 'amber' : 'red';
    const efficiencyLabel = efficiency >= 80 ? 'Отлично' : efficiency >= 50 ? 'Норма' : 'Низкая';

    // Закуп и продажи — договоры типа INSTALLMENT, открытые в периоде (как на дашборде)
    // Исключаем system_* и инвестор-клиентов (та же логика что totalBuyCost / installmentSalesTotal на дашборде)
    const salesStats = useMemo(() => {
        const startDate = new Date(filters.period.start);
        const endDate = new Date(filters.period.end);
        endDate.setHours(23, 59, 59, 999);
        const investorIds = new Set((investors as Investor[]).map((i: Investor) => i.id));
        const periodSales = (sales as Sale[]).filter((s: Sale) => {
            const sDate = new Date(s.startDate);
            if (!(sDate >= startDate && sDate <= endDate)) return false;
            if (s.status === 'DEFAULTED') return false;
            if (s.customerId.startsWith('system_') || investorIds.has(s.customerId)) return false;
            if (s.type !== 'INSTALLMENT') return false;
            if (filters.accountId !== 'ALL') return s.accountId === filters.accountId;
            return true;
        });
        const totalBuyPrice = periodSales.reduce((sum: number, s: Sale) => sum + (s.buyPrice || 0), 0);
        const totalSaleAmount = periodSales.reduce((sum: number, s: Sale) => sum + s.totalAmount, 0);
        const grossProfit = totalSaleAmount - totalBuyPrice;
        return { totalBuyPrice, totalSaleAmount, grossProfit, count: periodSales.length };
    }, [sales, investors, filters]);

    // Pool profit distribution — shown when a POOL account is selected
    const poolDistribution = useMemo(() => {
        if (filters.accountId === 'ALL') return null;
        const account = (accounts as Account[]).find(a => a.id === filters.accountId);
        if (!account || account.type !== 'POOL') return null;

        const startDate = new Date(filters.period.start);
        const endDate = new Date(filters.period.end);
        endDate.setHours(23, 59, 59, 999);

        type Row = { label: string; isManager: boolean; sharePercent: number; received: number; expected: number };
        const rows = new Map<string, Row>();
        const MGR = '__mgr__';

        const ensure = (key: string, init: () => Row) => {
            if (!rows.has(key)) rows.set(key, init());
            return rows.get(key)!;
        };

        const accountSales = (sales as Sale[]).filter(s =>
            s.accountId === account.id && s.buyPrice > 0 && s.totalAmount > s.buyPrice
        );

        accountSales.forEach(sale => {
            const profitMargin = (sale.totalAmount - sale.buyPrice) / sale.totalAmount;
            const allPayments = [
                { date: sale.startDate, amount: sale.downPayment },
                ...sale.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false)
            ];
            allPayments.forEach(p => {
                if (p.amount <= 0) return;
                const pDate = new Date(p.date);
                if (pDate < startDate || pDate > endDate) return;
                const profitFromPayment = p.amount * profitMargin;
                const mgrPct = getManagerSharePercent(account, investors as Investor[], p.date) / 100;
                ensure(MGR, () => ({ label: 'Менеджер', isManager: true, sharePercent: getManagerSharePercent(account, investors as Investor[]), received: 0, expected: 0 })).received += profitFromPayment * mgrPct;
                getAccountShares(account, investors as Investor[], p.date).forEach(({ investor, percentage }) => {
                    ensure(investor.id, () => ({ label: investor.name, isManager: false, sharePercent: percentage, received: 0, expected: 0 })).received += profitFromPayment * (percentage / 100);
                });
            });
            if ((sale.status === 'ACTIVE' || sale.status === 'DRAFT') && sale.remainingAmount > 0) {
                const gross = sale.remainingAmount * profitMargin;
                const mgrPct = getManagerSharePercent(account, investors as Investor[]) / 100;
                ensure(MGR, () => ({ label: 'Менеджер', isManager: true, sharePercent: getManagerSharePercent(account, investors as Investor[]), received: 0, expected: 0 })).expected += gross * mgrPct;
                getAccountShares(account, investors as Investor[]).forEach(({ investor, percentage }) => {
                    ensure(investor.id, () => ({ label: investor.name, isManager: false, sharePercent: percentage, received: 0, expected: 0 })).expected += gross * (percentage / 100);
                });
            }
        });

        if (rows.size === 0) return null;
        const list = Array.from(rows.values()).sort((a, b) => Number(b.isManager) - Number(a.isManager));
        const totalReceived = list.reduce((s, r) => s + r.received, 0);
        const totalExpected = list.reduce((s, r) => s + r.expected, 0);
        return { account, rows: list, totalReceived, totalExpected };
    }, [filters.accountId, filters.period, accounts, sales, investors]);

    // CSV Export
    const exportCSV = (opts: typeof exportOptions) => {
        const sep = ';';
        const selectedAccountName = filters.accountId === 'ALL'
            ? 'Все счета'
            : (accounts as Account[]).find((a: Account) => a.id === filters.accountId)?.name || filters.accountId;

        const lines: string[] = [
            `Финансовый отчёт${sep}${sep}`,
            `Компания${sep}${appSettings.companyName || '—'}${sep}`,
            `Период${sep}${filters.period.start} — ${filters.period.end}${sep}`,
            `Счёт${sep}${selectedAccountName}${sep}`,
            `${sep}${sep}`,
            `ОСНОВНЫЕ ПОКАЗАТЕЛИ${sep}${sep}`,
            `Показатель${sep}Сумма (₽)${sep}`,
            `Поступления от клиентов${sep}${data.customerPaymentsInPeriod.toFixed(2)}${sep}`,
            `Ожидаемая прибыль (менеджер)${sep}${data.expectedManagerProfit.toFixed(2)}${sep}`,
            `Ожидаемая прибыль (инвесторы)${sep}${data.expectedInvestorProfit.toFixed(2)}${sep}`,
            `Реализованная прибыль (менеджер)${sep}${data.realizedManagerProfit.toFixed(2)}${sep}`,
            `Реализованная прибыль (инвесторы)${sep}${data.realizedInvestorProfit.toFixed(2)}${sep}`,
            `Итого ожидается${sep}${totalExpected.toFixed(2)}${sep}`,
            `Итого реализовано${sep}${totalRealized.toFixed(2)}${sep}`,
            `Эффективность (%)${sep}${efficiency}${sep}`,
            `${sep}${sep}`,
        ];

        if (opts.timeline && paymentTimeline.length > 0) {
            lines.push(`ДИНАМИКА ПЛАТЕЖЕЙ${sep}${sep}`);
            lines.push(`Период${sep}Поступления (₽)${sep}`);
            paymentTimeline.forEach(p => lines.push(`${p.key}${sep}${p.amount.toFixed(2)}${sep}`));
            lines.push(`${sep}${sep}`);
        }

        if (opts.investorBreakdown && showInvestorBreakdown && accurateInvestorBreakdown.length > 0) {
            lines.push(`РАЗБИВКА ПО ИНВЕСТОРАМ${sep}${sep}${sep}${sep}${sep}`);
            lines.push(`Инвестор${sep}Капитал (₽)${sep}Доля капитала (%)${sep}% прибыли${sep}Ожидается (₽)${sep}Получено (₽)${sep}Контрактов${sep}`);
            accurateInvestorBreakdown.forEach(({ inv, share, expectedProfit, realizedProfit, salesCount }) => {
                lines.push(`${inv.name}${sep}${inv.initialAmount.toFixed(2)}${sep}${share}${sep}${inv.profitPercentage}${sep}${expectedProfit.toFixed(2)}${sep}${realizedProfit.toFixed(2)}${sep}${salesCount}${sep}`);
            });
            lines.push(`${sep}${sep}`);
        }

        if (opts.expenses && expenseStats) {
            lines.push(`РАСХОДЫ ЗА ПЕРИОД${sep}${sep}`);
            lines.push(`Статья${sep}Сумма (₽)${sep}`);
            lines.push(`Выплаты инвесторам${sep}${expenseStats.investorPayouts.toFixed(2)}${sep}`);
            lines.push(`Прочие расходы${sep}${expenseStats.otherExpenses.toFixed(2)}${sep}`);
            lines.push(`Итого расходов${sep}${expenseStats.total.toFixed(2)}${sep}`);
            lines.push(`${sep}${sep}`);
        }

        if (opts.overduePayments && overduePayments.length > 0) {
            lines.push(`ПРОСРОЧЕННЫЕ ПЛАТЕЖИ (на дату экспорта)${sep}${sep}${sep}${sep}`);
            lines.push(`Клиент${sep}Товар${sep}Пропущено платежей${sep}С даты${sep}Сумма долга (₽)${sep}`);
            overduePayments.forEach((p: { customerName: string; productName: string; missedCount: number; earliestMissedDate: string; overdueAmount: number }) => {
                lines.push(`${p.customerName}${sep}${p.productName}${sep}${p.missedCount}${sep}${p.earliestMissedDate}${sep}${p.overdueAmount.toFixed(2)}${sep}`);
            });
            const totalOverdue = overduePayments.reduce((s: number, p: { overdueAmount: number }) => s + p.overdueAmount, 0);
            lines.push(`Итого просрочено${sep}${sep}${sep}${sep}${totalOverdue.toFixed(2)}${sep}`);
            lines.push(`${sep}${sep}`);
        }

        if (opts.customerBreakdown && customerBreakdown.length > 0) {
            lines.push(`ДЕТАЛИЗАЦИЯ ПОСТУПЛЕНИЙ ПО КЛИЕНТАМ${sep}${sep}${sep}`);
            lines.push(`Клиент${sep}Платежей${sep}Сумма (₽)${sep}`);
            customerBreakdown.forEach((c: { customerName: string; count: number; total: number }) => {
                lines.push(`${c.customerName}${sep}${c.count}${sep}${c.total.toFixed(2)}${sep}`);
            });
            lines.push(`${sep}${sep}`);
        }

        const csv = '﻿' + lines.join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `отчёт_${filters.period.start}_${filters.period.end}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    // PDF Export (formatted print window)
    const exportPDF = (opts: typeof exportOptions) => {
        const selectedAccountName = filters.accountId === 'ALL'
            ? 'Все счета'
            : (accounts as Account[]).find((a: Account) => a.id === filters.accountId)?.name || filters.accountId;
        const fmt = (n: number) => formatCurrency(n, appSettings.showCents) + ' ₽';
        const companyName = appSettings.companyName || '';

        const investorTableHTML = opts.investorBreakdown && showInvestorBreakdown && accurateInvestorBreakdown.length > 0 ? `
            <h2>Разбивка по инвесторам</h2>
            <p class="note">Ожидаемая и полученная прибыль рассчитаны из реальных сделок каждого инвестора</p>
            <table>
                <tr><th>Инвестор</th><th>Капитал</th><th>Доля</th><th>% прибыли</th><th>Ожидается</th><th>Получено</th><th>Контрактов</th></tr>
                ${accurateInvestorBreakdown.map(({ inv, share, expectedProfit, realizedProfit, salesCount }) => `
                <tr>
                    <td><strong>${escapeHtml(inv.name)}</strong></td>
                    <td>${fmt(inv.initialAmount)}</td>
                    <td>${share}%</td>
                    <td>${inv.profitPercentage}%</td>
                    <td>${fmt(expectedProfit)}</td>
                    <td class="green">${fmt(realizedProfit)}</td>
                    <td>${salesCount}</td>
                </tr>`).join('')}
            </table>` : '';

        const timelineHTML = opts.timeline && paymentTimeline.length > 0 ? `
            <h2>Динамика платежей</h2>
            <table>
                <tr><th>Период</th><th>Поступления</th></tr>
                ${paymentTimeline.map(p => `<tr><td>${p.label}</td><td class="green">${fmt(p.amount)}</td></tr>`).join('')}
                <tr class="total"><td><strong>Итого</strong></td><td><strong>${fmt(data.customerPaymentsInPeriod)}</strong></td></tr>
            </table>` : '';

        const expenseHTML = opts.expenses && expenseStats ? `
            <h2>Расходы за период</h2>
            <table>
                <tr><th>Статья</th><th>Сумма</th></tr>
                <tr><td>Выплаты инвесторам</td><td>${fmt(expenseStats.investorPayouts)}</td></tr>
                <tr><td>Прочие расходы</td><td>${fmt(expenseStats.otherExpenses)}</td></tr>
                <tr class="total"><td><strong>Итого расходов</strong></td><td><strong>${fmt(expenseStats.total)}</strong></td></tr>
            </table>` : '';

        const overdueHTML = opts.overduePayments && overduePayments.length > 0 ? `
            <h2>Просроченные платежи (на дату отчёта)</h2>
            <table>
                <tr><th>Клиент</th><th>Товар</th><th>Пропущено</th><th>С даты</th><th>Сумма долга</th></tr>
                ${overduePayments.map((p: { customerName: string; productName: string; missedCount: number; earliestMissedDate: string; overdueAmount: number }) => `
                <tr>
                    <td><strong>${p.customerName}</strong></td>
                    <td>${p.productName}</td>
                    <td class="red">${p.missedCount} пл.</td>
                    <td>${p.earliestMissedDate}</td>
                    <td class="red">${fmt(p.overdueAmount)}</td>
                </tr>`).join('')}
                <tr class="total"><td colspan="4"><strong>Итого просрочено</strong></td><td class="red"><strong>${fmt(overduePayments.reduce((s: number, p: { overdueAmount: number }) => s + p.overdueAmount, 0))}</strong></td></tr>
            </table>` : '';

        const customerBreakdownHTML = opts.customerBreakdown && customerBreakdown.length > 0 ? `
            <h2>Детализация поступлений по клиентам</h2>
            <table>
                <tr><th>Клиент</th><th>Платежей</th><th>Сумма</th></tr>
                ${customerBreakdown.map((c: { customerName: string; count: number; total: number }) => `
                <tr>
                    <td><strong>${c.customerName}</strong></td>
                    <td>${c.count}</td>
                    <td class="green">${fmt(c.total)}</td>
                </tr>`).join('')}
                <tr class="total"><td><strong>Итого</strong></td><td><strong>${customerBreakdown.reduce((s: number, c: { count: number }) => s + c.count, 0)}</strong></td><td class="green"><strong>${fmt(data.customerPaymentsInPeriod)}</strong></td></tr>
            </table>` : '';

        const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">
        <title>Финансовый отчёт ${filters.period.start} — ${filters.period.end}</title>
        <style>
            body { font-family: 'Arial', sans-serif; padding: 32px; color: #1e293b; font-size: 13px; }
            h1 { font-size: 22px; color: #4f46e5; margin: 0 0 2px; }
            .company { font-size: 13px; color: #6366f1; font-weight: 600; margin-bottom: 2px; }
            .subtitle { color: #64748b; font-size: 12px; margin-bottom: 20px; }
            h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #4f46e5; margin: 28px 0 8px; border-bottom: 2px solid #e0e7ff; padding-bottom: 6px; }
            .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 8px; }
            .kpi { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; background: #f8fafc; }
            .kpi-label { font-size: 10px; text-transform: uppercase; color: #94a3b8; margin-bottom: 4px; letter-spacing: 0.05em; }
            .kpi-value { font-size: 17px; font-weight: bold; color: #1e293b; }
            .kpi-sub { font-size: 10px; color: #64748b; margin-top: 2px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
            th { background: #f1f5f9; padding: 7px 10px; text-align: left; font-size: 10px; text-transform: uppercase; color: #64748b; border-bottom: 2px solid #e2e8f0; }
            td { padding: 7px 10px; border-bottom: 1px solid #f1f5f9; }
            tr.total td { background: #f8fafc; font-weight: bold; border-top: 1px solid #e2e8f0; }
            .green { color: #059669; }
            .red { color: #dc2626; }
            .note { font-size: 11px; color: #94a3b8; margin: -4px 0 8px; }
            .toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #e2e8f0; }
            .toolbar-title { font-size: 11px; color: #94a3b8; flex: 1; }
            .btn { padding: 7px 16px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; border: none; font-family: Arial, sans-serif; }
            .btn-print { background: #4f46e5; color: white; }
            .btn-close { background: #f1f5f9; color: #475569; }
            .btn-print:hover { background: #4338ca; }
            .btn-close:hover { background: #e2e8f0; }
            @media print { .toolbar { display: none !important; } @page { margin: 1.5cm; size: A4; } body { padding: 0; } }
        </style></head><body>
        <div class="toolbar">
            <span class="toolbar-title">Финансовый отчёт · ${filters.period.start} — ${filters.period.end}</span>
            <button class="btn btn-print" onclick="window.print()">🖨️ Сохранить PDF</button>
            <button class="btn btn-close" onclick="window.close()">✕ Закрыть</button>
        </div>
        ${companyName ? `<div class="company">${escapeHtml(companyName)}</div>` : ''}
        <h1>Финансовый отчёт</h1>
        <div class="subtitle">Период: <strong>${filters.period.start} — ${filters.period.end}</strong> · Счёт: <strong>${escapeHtml(selectedAccountName)}</strong></div>
        <h2>Ключевые показатели</h2>
        <div class="kpi-grid">
            <div class="kpi"><div class="kpi-label">Поступления</div><div class="kpi-value">${fmt(data.customerPaymentsInPeriod)}</div></div>
            <div class="kpi"><div class="kpi-label">Реализованная прибыль</div><div class="kpi-value green">${fmt(totalRealized)}</div></div>
            <div class="kpi"><div class="kpi-label">Ожидаемая прибыль</div><div class="kpi-value">${fmt(totalExpected)}</div></div>
            <div class="kpi"><div class="kpi-label">Моя прибыль</div><div class="kpi-value green">${fmt(data.realizedManagerProfit)}</div><div class="kpi-sub">${managerSharePct}% от общей</div></div>
            ${hasInvestors ? `<div class="kpi"><div class="kpi-label">Прибыль инвесторов</div><div class="kpi-value green">${fmt(data.realizedInvestorProfit)}</div><div class="kpi-sub">${investorSharePct}% от общей</div></div>` : ''}
            <div class="kpi"><div class="kpi-label">Эффективность</div><div class="kpi-value ${efficiency >= 80 ? 'green' : efficiency >= 50 ? '' : 'red'}">${efficiency}%</div><div class="kpi-sub">${efficiencyLabel}</div></div>
        </div>
        ${timelineHTML}
        ${investorTableHTML}
        ${expenseHTML}
        ${overdueHTML}
        ${customerBreakdownHTML}
        </body></html>`;

        const win = window.open('', '_blank', 'width=900,height=700');
        if (win) {
            win.document.write(html);
            win.document.close();
            setTimeout(() => win.print(), 300);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50/30 dark:from-slate-900 dark:to-slate-900 pb-24 w-full">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 animate-in fade-in slide-in-from-top-4 duration-500">

                {/* Header */}
                <header className="flex items-start justify-between flex-wrap gap-3">
                    <div>
                        <h2 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-indigo-400 bg-clip-text text-transparent">
                            Отчеты
                        </h2>
                        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1 flex items-center gap-2">
                            <span className="w-1 h-1 bg-indigo-400 rounded-full inline-block"></span>
                            Финансовая аналитика · {filters.period.start} — {filters.period.end}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {hasData && (
                            <div className={`hidden sm:block px-4 py-2 rounded-xl text-sm font-semibold ${efficiencyColor === 'emerald' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : efficiencyColor === 'amber' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'}`}>
                                Эффективность {efficiency}%
                            </div>
                        )}
                        <button
                            onClick={() => setExportModal('csv')}
                            className="flex items-center gap-1.5 px-3.5 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-slate-300 dark:hover:border-slate-600 transition-all shadow-sm"
                        >
                            <span>📥</span> CSV
                        </button>
                        <button
                            onClick={() => setExportModal('pdf')}
                            className="flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-indigo-600 to-indigo-500 text-white rounded-xl text-xs font-semibold hover:shadow-lg hover:shadow-indigo-200 hover:-translate-y-0.5 transition-all shadow-sm"
                        >
                            <span>🖨️</span> PDF
                        </button>
                    </div>
                </header>

                {/* Filters */}
                <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm p-5 rounded-2xl shadow-lg border border-white/20 dark:border-slate-700/50 hover:shadow-xl transition-all duration-300 space-y-4">
                    <div className="flex items-center gap-2">
                        <span className="w-1 h-5 bg-indigo-500 rounded-full"></span>
                        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Фильтры</h3>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {(Object.keys(PRESET_LABELS) as PeriodPreset[]).map(preset => {
                            const dates = getPeriodDates(preset);
                            const isActive = filters.period.start === dates.start && filters.period.end === dates.end;
                            return (
                                <button key={preset} onClick={() => applyPreset(preset)}
                                    className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 ${isActive ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-200 dark:shadow-indigo-900/30 scale-105' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 hover:scale-105'}`}>
                                    {PRESET_LABELS[preset]}
                                </button>
                            );
                        })}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1">
                                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full"></span>Счёт
                            </label>
                            <div className="relative">
                                <select
                                    className="w-full p-3 bg-white dark:bg-slate-900 dark:text-white border border-slate-200 dark:border-slate-600 rounded-xl outline-none text-sm appearance-none cursor-pointer hover:border-indigo-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all"
                                    value={filters.accountId}
                                    onChange={e => onFiltersChange(prev => ({ ...prev, accountId: e.target.value }))}
                                >
                                    <option value="ALL">Все счета</option>
                                    {(accounts as Account[]).filter((a: Account) => !a.isArchived).map((a: Account) => (
                                        <option key={a.id} value={a.id}>
                                            {a.name}{a.type === 'INVESTOR' ? ' 👤' : a.type === 'SHARED' ? ' 🤝' : ''}
                                        </option>
                                    ))}
                                </select>
                                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none text-xs">▼</div>
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1">
                                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></span>Начало периода
                            </label>
                            <input type="date" className="w-full p-3 bg-white dark:bg-slate-900 dark:text-white border border-slate-200 dark:border-slate-600 rounded-xl outline-none text-sm hover:border-indigo-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all"
                                value={filters.period.start} onChange={e => handlePeriodInput('start', e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1">
                                <span className="w-1.5 h-1.5 bg-amber-400 rounded-full"></span>Конец периода
                            </label>
                            <input type="date" className="w-full p-3 bg-white dark:bg-slate-900 dark:text-white border border-slate-200 dark:border-slate-600 rounded-xl outline-none text-sm hover:border-indigo-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all"
                                value={filters.period.end} onChange={e => handlePeriodInput('end', e.target.value)} />
                        </div>
                    </div>
                </div>

                {!hasData ? (
                    <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 p-16 text-center">
                        <div className="text-7xl mb-4 opacity-30">📊</div>
                        <h3 className="text-xl font-bold text-slate-700 dark:text-slate-200 mb-2">Нет данных за выбранный период</h3>
                        <p className="text-slate-400 dark:text-slate-500 max-w-md mx-auto">Выберите другой период или инвестора для просмотра аналитики</p>
                        <button onClick={() => applyPreset('month')}
                            className="mt-6 px-6 py-3 bg-gradient-to-r from-indigo-600 to-indigo-500 text-white rounded-xl font-semibold shadow-lg shadow-indigo-200 hover:shadow-xl hover:-translate-y-0.5 transition-all">
                            Показать текущий месяц
                        </button>
                    </div>
                ) : (
                    <>
                        {/* KPI Cards */}
                        <div className={`grid gap-4 ${hasInvestors ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5' : 'grid-cols-2 sm:grid-cols-2 lg:grid-cols-4'}`}>
                            <KpiCard icon="💰" label="Поступления" value={`${formatCurrency(data.customerPaymentsInPeriod, appSettings.showCents)} ₽`} badge="Получено" color="emerald" />
                            <KpiCard icon="✅" label="Реализованная прибыль" value={`${formatCurrency(totalRealized, appSettings.showCents)} ₽`} badge="Факт" color="teal" />
                            <KpiCard icon="👤" label="Моя прибыль" value={`${formatCurrency(data.realizedManagerProfit, appSettings.showCents)} ₽`} badge={`${managerSharePct}%`} color="sky" subtext="от общей прибыли" />
                            {hasInvestors && (
                                <KpiCard icon="👥" label="Прибыль инвесторов" value={`${formatCurrency(data.realizedInvestorProfit, appSettings.showCents)} ₽`} badge={`${investorSharePct}%`} color="indigo" subtext="от общей прибыли" />
                            )}
                            <KpiCard
                                icon={efficiency >= 80 ? '🎯' : efficiency >= 50 ? '📊' : '⚠️'}
                                label="Эффективность" value={`${efficiency}%`}
                                badge={efficiencyLabel} color={efficiencyColor} subtext="план / факт"
                            />
                        </div>

                        {/* Pool profit distribution card */}
                        {poolDistribution && (
                            <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm rounded-2xl shadow-lg border border-fuchsia-100 dark:border-fuchsia-900/40 overflow-hidden">
                                {/* Header */}
                                <div className="bg-gradient-to-r from-fuchsia-600 to-purple-600 px-5 py-4 flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center text-white text-lg">🏦</div>
                                    <div>
                                        <p className="text-white font-bold text-base leading-tight">{poolDistribution.account.name}</p>
                                        <p className="text-fuchsia-200 text-xs mt-0.5">Распределение прибыли по участникам</p>
                                    </div>
                                </div>

                                <div className="p-5 space-y-3">
                                    {poolDistribution.rows.map((row, idx) => {
                                        const rowColors = row.isManager
                                            ? { dot: 'bg-emerald-500', bar: 'bg-emerald-500', badge: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400', label: 'text-emerald-700 dark:text-emerald-400' }
                                            : { dot: ['bg-indigo-500','bg-purple-500','bg-pink-500','bg-amber-500','bg-cyan-500'][idx % 5], bar: ['bg-indigo-500','bg-purple-500','bg-pink-500','bg-amber-500','bg-cyan-500'][idx % 5], badge: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400', label: 'text-indigo-700 dark:text-indigo-400' };
                                        const total = row.received + row.expected;
                                        const pct = total > 0 ? Math.round((row.received / total) * 100) : 0;
                                        return (
                                            <div key={row.isManager ? '__mgr__' : String(idx)} className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-4">
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="flex items-center gap-2.5 min-w-0">
                                                        <div className={`w-8 h-8 rounded-full ${rowColors.dot} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                                                            {row.label.charAt(0).toUpperCase()}
                                                        </div>
                                                        <span className="font-semibold text-sm text-slate-800 dark:text-white truncate">{row.label}</span>
                                                    </div>
                                                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ml-2 ${rowColors.badge}`}>
                                                        {Math.round(row.sharePercent)}%
                                                    </span>
                                                </div>
                                                {/* Progress bar: received vs total */}
                                                <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mb-2">
                                                    <div className={`h-full ${rowColors.bar} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
                                                </div>
                                                <div className="flex justify-between text-xs">
                                                    <span className="text-slate-500 dark:text-slate-400">
                                                        Получено: <span className={`font-bold ${rowColors.label}`}>{formatCurrency(row.received, appSettings.showCents)} ₽</span>
                                                    </span>
                                                    <span className="text-slate-400 dark:text-slate-500">
                                                        Ожидается: <span className="font-semibold text-slate-600 dark:text-slate-300">{formatCurrency(row.expected, appSettings.showCents)} ₽</span>
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {/* Total row */}
                                    <div className="flex justify-between items-center pt-2 border-t border-slate-100 dark:border-slate-700 text-sm">
                                        <span className="font-semibold text-slate-600 dark:text-slate-300">Итого по пулу</span>
                                        <div className="flex gap-4 text-xs">
                                            <span className="text-slate-500 dark:text-slate-400">
                                                Получено: <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(poolDistribution.totalReceived, appSettings.showCents)} ₽</span>
                                            </span>
                                            <span className="text-slate-400 dark:text-slate-500">
                                                Ожидается: <span className="font-semibold text-slate-600 dark:text-slate-300">{formatCurrency(poolDistribution.totalExpected, appSettings.showCents)} ₽</span>
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Закуп и Продажи — договоры, открытые в периоде */}
                        {salesStats.count > 0 && (
                            <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm p-5 rounded-2xl shadow-lg border border-slate-100 dark:border-slate-700">
                                <div className="flex items-center gap-2 mb-4">
                                    <span className="w-1 h-5 bg-violet-500 rounded-full"></span>
                                    <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Договоры за период</h4>
                                    <span className="ml-auto text-xs font-medium text-slate-500 bg-slate-100 dark:bg-slate-700 dark:text-slate-400 px-3 py-1 rounded-full">{salesStats.count} договоров</span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                    <div className="bg-gradient-to-br from-rose-50 to-white dark:from-rose-900/20 dark:to-slate-800 p-4 rounded-xl border border-rose-100 dark:border-rose-900/30">
                                        <p className="text-xs font-medium text-rose-600 dark:text-rose-400 mb-1">Закуп (себестоимость)</p>
                                        <p className="text-xl font-bold text-rose-700 dark:text-rose-300">{formatCurrency(salesStats.totalBuyPrice, appSettings.showCents)} ₽</p>
                                        
                                    </div>
                                    <div className="bg-gradient-to-br from-violet-50 to-white dark:from-violet-900/20 dark:to-slate-800 p-4 rounded-xl border border-violet-100 dark:border-violet-900/30">
                                        <p className="text-xs font-medium text-violet-600 dark:text-violet-400 mb-1">Продажи (сумма контрактов)</p>
                                        <p className="text-xl font-bold text-violet-700 dark:text-violet-300">{formatCurrency(salesStats.totalSaleAmount, appSettings.showCents)} ₽</p>
                                        
                                    </div>
                                    <div className={`bg-gradient-to-br p-4 rounded-xl border ${salesStats.grossProfit >= 0 ? 'from-emerald-50 to-white dark:from-emerald-900/20 dark:to-slate-800 border-emerald-100 dark:border-emerald-900/30' : 'from-red-50 to-white dark:from-red-900/20 dark:to-slate-800 border-red-100 dark:border-red-900/30'}`}>
                                        <p className={`text-xs font-medium mb-1 ${salesStats.grossProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>Валовая прибыль</p>
                                        <p className={`text-xl font-bold ${salesStats.grossProfit >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>{formatCurrency(salesStats.grossProfit, appSettings.showCents)} ₽</p>
                                        <p className={`text-xs mt-1 ${salesStats.grossProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {salesStats.totalSaleAmount > 0 ? Math.round((salesStats.grossProfit / salesStats.totalSaleAmount) * 100) : 0}% маржа
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Payment timeline — area chart */}
                        {paymentTimeline.length > 1 && (
                            <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm p-6 rounded-2xl shadow-lg border border-slate-100 dark:border-slate-700">
                                <div className="flex items-center gap-2 mb-5">
                                    <span className="w-1 h-5 bg-emerald-500 rounded-full"></span>
                                    <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Динамика поступлений</h4>
                                    <span className="ml-auto text-xs text-slate-400 dark:text-slate-500">{paymentTimeline.length} точек · всего {formatCurrency(data.customerPaymentsInPeriod, appSettings.showCents)} ₽</span>
                                </div>
                                <div className="h-56">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={paymentTimeline} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                                            <defs>
                                                <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.2} />
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
                                                formatter={(value: any) => [`${formatCurrency(Number(value), appSettings.showCents)} ₽`, 'Поступления']}
                                                contentStyle={{ backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                                labelStyle={{ color: '#64748b', fontWeight: 600, marginBottom: 4 }}
                                            />
                                            <Area type="monotone" dataKey="amount" stroke="#10B981" strokeWidth={2.5}
                                                fill="url(#areaGradient)" dot={{ r: 3, fill: '#10B981', strokeWidth: 0 }}
                                                activeDot={{ r: 5, fill: '#10B981', strokeWidth: 2, stroke: '#fff' }}
                                            />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}

                        {/* Main charts: bar + pie */}
                        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                            <div className="lg:col-span-3 bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm p-6 rounded-2xl shadow-lg border border-slate-100 dark:border-slate-700">
                                <div className="flex items-center gap-2 mb-5">
                                    <span className="w-1 h-5 bg-indigo-500 rounded-full"></span>
                                    <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Ожидаемое vs Полученное</h4>
                                </div>
                                <div className="h-52">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={barData} barSize={28} barCategoryGap="40%">
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                            <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                            <YAxis hide />
                                            <Tooltip
                                                formatter={(value: any) => [`${formatCurrency(Number(value), appSettings.showCents)} ₽`]}
                                                contentStyle={{ backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                            />
                                            <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                                            <Bar dataKey="Ожидается" fill="#CBD5E1" radius={[6, 6, 0, 0]} />
                                            <Bar dataKey="Получено" fill="#10B981" radius={[6, 6, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="mt-5 pt-5 border-t border-slate-100 dark:border-slate-700 space-y-3">
                                    <ProgressRow label="Менеджер — план/факт" realized={data.realizedManagerProfit} expected={data.expectedManagerProfit} color="emerald" showCents={appSettings.showCents} />
                                    {hasInvestors && (
                                        <ProgressRow label="Инвесторы — план/факт" realized={data.realizedInvestorProfit} expected={data.expectedInvestorProfit} color="indigo" showCents={appSettings.showCents} />
                                    )}
                                </div>
                            </div>

                            <div className="lg:col-span-2 bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm p-6 rounded-2xl shadow-lg border border-slate-100 dark:border-slate-700">
                                <div className="flex items-center gap-2 mb-4">
                                    <span className="w-1 h-5 bg-emerald-500 rounded-full"></span>
                                    <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Распределение прибыли</h4>
                                </div>
                                {pieData.length > 0 ? (
                                    <>
                                        <div className="h-48">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <PieChart>
                                                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                                                        innerRadius={52} outerRadius={86} paddingAngle={4}
                                                        animationDuration={800} animationEasing="ease-out">
                                                        {pieData.map((entry, index) => (
                                                            <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                                                        ))}
                                                    </Pie>
                                                    <Tooltip
                                                        formatter={(value: any) => [`${formatCurrency(Number(value), appSettings.showCents)} ₽`, '']}
                                                        contentStyle={{ backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                                                    />
                                                </PieChart>
                                            </ResponsiveContainer>
                                        </div>
                                        <div className="space-y-2.5 mt-3">
                                            {pieData.map(entry => (
                                                <div key={entry.name} className="flex items-center justify-between text-sm">
                                                    <div className="flex items-center gap-2">
                                                        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }}></span>
                                                        <span className="text-slate-600 dark:text-slate-300">{entry.name}</span>
                                                    </div>
                                                    <span className="font-semibold text-slate-700 dark:text-slate-200">{formatCurrency(entry.value, appSettings.showCents)} ₽</span>
                                                </div>
                                            ))}
                                            <div className="pt-2 border-t border-slate-100 dark:border-slate-700 flex justify-between text-sm">
                                                <span className="text-slate-500 dark:text-slate-400">Итого получено</span>
                                                <span className="font-bold text-slate-700 dark:text-slate-200">{formatCurrency(totalRealized, appSettings.showCents)} ₽</span>
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="h-48 flex items-center justify-center text-slate-400 dark:text-slate-500 text-sm">Нет данных о прибыли</div>
                                )}
                            </div>
                        </div>

                        {/* Expected profit section */}
                        <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm p-6 rounded-2xl shadow-lg border border-slate-100 dark:border-slate-700">
                            <div className="flex items-center gap-2 mb-5">
                                <span className="w-1 h-5 bg-slate-400 rounded-full"></span>
                                <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Ожидаемая прибыль по контрактам</h4>
                                <span className="ml-auto text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-3 py-1 rounded-full">Прогноз</span>
                            </div>
                            <div className={`grid grid-cols-1 gap-4 ${hasInvestors ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                                <div className="bg-gradient-to-br from-slate-50 to-white dark:from-slate-700/50 dark:to-slate-800 p-4 rounded-xl border border-slate-100 dark:border-slate-700">
                                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Итого ожидается</p>
                                    <p className="text-2xl font-bold text-slate-700 dark:text-slate-200">{formatCurrency(totalExpected, appSettings.showCents)} ₽</p>
                                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">из активных и завершённых контрактов</p>
                                </div>
                                <div className="bg-gradient-to-br from-sky-50 to-white dark:from-sky-900/20 dark:to-slate-800 p-4 rounded-xl border border-sky-100 dark:border-sky-900/40">
                                    <p className="text-xs font-medium text-sky-600 dark:text-sky-400 mb-1">Прогноз менеджера</p>
                                    <p className="text-2xl font-bold text-sky-700 dark:text-sky-400">{formatCurrency(data.expectedManagerProfit, appSettings.showCents)} ₽</p>
                                    <p className="text-xs text-sky-500 dark:text-sky-400/80 mt-1">{totalExpected > 0 ? Math.round((data.expectedManagerProfit / totalExpected) * 100) : 0}% от общей суммы</p>
                                </div>
                                {hasInvestors && (
                                    <div className="bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-900/20 dark:to-slate-800 p-4 rounded-xl border border-indigo-100 dark:border-indigo-900/40">
                                        <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400 mb-1">Прогноз инвесторов</p>
                                        <p className="text-2xl font-bold text-indigo-700 dark:text-indigo-400">{formatCurrency(data.expectedInvestorProfit, appSettings.showCents)} ₽</p>
                                        <p className="text-xs text-indigo-500 dark:text-indigo-400/80 mt-1">{totalExpected > 0 ? Math.round((data.expectedInvestorProfit / totalExpected) * 100) : 0}% от общей суммы</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Expenses section */}
                        {expenseStats && (
                            <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm p-6 rounded-2xl shadow-lg border border-slate-100 dark:border-slate-700">
                                <div className="flex items-center gap-2 mb-5">
                                    <span className="w-1 h-5 bg-red-400 rounded-full"></span>
                                    <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Расходы за период</h4>
                                    <span className="ml-auto text-xs text-slate-400 dark:text-slate-500">{expenseStats.count} операций</span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                    <button
                                        onClick={() => setActiveModal('payments')}
                                        className="group text-left bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-900/20 dark:to-slate-800 p-4 rounded-xl border border-emerald-100 dark:border-emerald-900/40 hover:border-emerald-300 dark:hover:border-emerald-700 hover:shadow-md transition-all cursor-pointer"
                                    >
                                        <div className="flex items-center justify-between mb-1">
                                            <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Поступления</p>
                                            <span className="text-emerald-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity">Детали →</span>
                                        </div>
                                        <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400">{formatCurrency(data.customerPaymentsInPeriod, appSettings.showCents)} ₽</p>
                                        <p className="text-xs text-emerald-500 dark:text-emerald-400/80 mt-1">{paymentsDetail.length} платежей от клиентов</p>
                                    </button>
                                    <button
                                        onClick={() => setActiveModal('investor_payouts')}
                                        className="group text-left bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-900/20 dark:to-slate-800 p-4 rounded-xl border border-indigo-100 dark:border-indigo-900/40 hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-md transition-all cursor-pointer"
                                    >
                                        <div className="flex items-center justify-between mb-1">
                                            <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400">Выплаты инвесторам</p>
                                            <span className="text-indigo-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity">Детали →</span>
                                        </div>
                                        <p className="text-xl font-bold text-indigo-700 dark:text-indigo-400">{formatCurrency(expenseStats.investorPayouts, appSettings.showCents)} ₽</p>
                                        <p className="text-xs text-indigo-500 dark:text-indigo-400/80 mt-1">{investorPayoutsDetail.length} выплат</p>
                                    </button>
                                    <button
                                        onClick={() => setActiveModal('other_expenses')}
                                        className="group text-left bg-gradient-to-br from-red-50 to-white dark:from-red-900/20 dark:to-slate-800 p-4 rounded-xl border border-red-100 dark:border-red-900/40 hover:border-red-300 dark:hover:border-red-700 hover:shadow-md transition-all cursor-pointer"
                                    >
                                        <div className="flex items-center justify-between mb-1">
                                            <p className="text-xs font-medium text-red-500 dark:text-red-400">Прочие расходы</p>
                                            <span className="text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity">Детали →</span>
                                        </div>
                                        <p className="text-xl font-bold text-red-600 dark:text-red-400">{formatCurrency(expenseStats.otherExpenses, appSettings.showCents)} ₽</p>
                                        <p className="text-xs text-red-400 dark:text-red-400/80 mt-1">{otherExpensesDetail.length} операций</p>
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Per-investor breakdown */}
                        {showInvestorBreakdown && accurateInvestorBreakdown.length > 0 && (
                            <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm p-6 rounded-2xl shadow-lg border border-slate-100 dark:border-slate-700">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="w-1 h-5 bg-purple-500 rounded-full"></span>
                                    <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Разбивка по инвесторам</h4>
                                </div>
                                <p className="text-xs text-slate-400 dark:text-slate-500 mb-5 ml-3">Прибыль рассчитана из реальных сделок каждого инвестора с учётом его процентной ставки</p>
                                <div className="overflow-x-auto -mx-1">
                                    <table className="w-full text-sm min-w-[600px]">
                                        <thead>
                                            <tr>
                                                <th className="pb-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider pl-1">Инвестор</th>
                                                <th className="pb-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Капитал</th>
                                                <th className="pb-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Доля капитала</th>
                                                <th className="pb-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Ожидается</th>
                                                <th className="pb-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Получено</th>
                                                <th className="pb-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider pr-1">% плана</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50 dark:divide-slate-700">
                                            {accurateInvestorBreakdown.map(({ inv, share, expectedProfit, realizedProfit, salesCount, color }) => {
                                                const pct = expectedProfit > 0 ? Math.round((realizedProfit / expectedProfit) * 100) : 0;
                                                const rowPctColor = pct >= 80 ? 'text-emerald-600 dark:text-emerald-400' : pct >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-500 dark:text-red-400';
                                                return (
                                                    <tr key={inv.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-700/50 transition-colors">
                                                        <td className="py-3 pl-1">
                                                            <div className="flex items-center gap-2.5">
                                                                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: color }}>
                                                                    {inv.name.charAt(0).toUpperCase()}
                                                                </div>
                                                                <div>
                                                                    <p className="font-medium text-slate-700 dark:text-slate-200">{inv.name}</p>
                                                                    <p className="text-xs text-slate-400 dark:text-slate-500">{inv.profitPercentage}% ставка · {salesCount} контр.</p>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="py-3 text-right font-medium text-slate-600 dark:text-slate-300">{formatCurrency(inv.initialAmount, appSettings.showCents)} ₽</td>
                                                        <td className="py-3 text-right">
                                                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: color + '18', color }}>
                                                                {share}%
                                                            </span>
                                                        </td>
                                                        <td className="py-3 text-right text-slate-500 dark:text-slate-400">{formatCurrency(expectedProfit, appSettings.showCents)} ₽</td>
                                                        <td className="py-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(realizedProfit, appSettings.showCents)} ₽</td>
                                                        <td className="py-3 pr-1">
                                                            <div className="flex flex-col items-end gap-1">
                                                                <span className={`text-xs font-bold ${rowPctColor}`}>{pct}%</span>
                                                                <div className="w-14 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                                                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }}></div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                        <tfoot>
                                            <tr className="border-t-2 border-slate-200 dark:border-slate-600">
                                                <td className="pt-3 pl-1 font-semibold text-slate-700 dark:text-slate-200">Итого</td>
                                                <td className="pt-3 text-right font-semibold text-slate-700 dark:text-slate-200">{formatCurrency(totalInvestment, appSettings.showCents)} ₽</td>
                                                <td className="pt-3 text-right text-slate-500 dark:text-slate-400">100%</td>
                                                <td className="pt-3 text-right font-semibold text-slate-600 dark:text-slate-300">{formatCurrency(data.expectedInvestorProfit, appSettings.showCents)} ₽</td>
                                                <td className="pt-3 text-right font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(data.realizedInvestorProfit, appSettings.showCents)} ₽</td>
                                                <td className="pt-3 pr-1 text-right">
                                                    <span className={`text-xs font-bold ${efficiency >= 80 ? 'text-emerald-600 dark:text-emerald-400' : efficiency >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-500 dark:text-red-400'}`}>{efficiency}%</span>
                                                </td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* Summary gradient card */}
                        <div className="bg-gradient-to-br from-indigo-600 via-indigo-550 to-indigo-700 p-6 rounded-2xl shadow-xl text-white">
                            <div className="flex items-center gap-2 mb-5">
                                <span className="w-1 h-4 bg-white/50 rounded-full"></span>
                                <h4 className="text-sm font-bold text-indigo-100 uppercase tracking-wider">Итог периода</h4>
                            </div>
                            <div className={`grid gap-6 ${hasInvestors ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-4'}`}>
                                <div>
                                    <p className="text-indigo-200 text-xs mb-1">Поступления</p>
                                    <p className="text-2xl font-bold">{formatCurrency(data.customerPaymentsInPeriod, appSettings.showCents)} ₽</p>
                                </div>
                                <div>
                                    <p className="text-indigo-200 text-xs mb-1">Реализовано</p>
                                    <p className="text-2xl font-bold">{formatCurrency(totalRealized, appSettings.showCents)} ₽</p>
                                </div>
                                <div>
                                    <p className="text-indigo-200 text-xs mb-1">Ожидается</p>
                                    <p className="text-2xl font-bold">{formatCurrency(totalExpected, appSettings.showCents)} ₽</p>
                                </div>
                                {hasInvestors && (
                                    <div>
                                        <p className="text-indigo-200 text-xs mb-1">Инвесторам</p>
                                        <p className="text-2xl font-bold">{formatCurrency(data.realizedInvestorProfit, appSettings.showCents)} ₽</p>
                                    </div>
                                )}
                                <div>
                                    <p className="text-indigo-200 text-xs mb-1">Эффективность</p>
                                    <p className="text-2xl font-bold">{efficiency}%</p>
                                    <div className="mt-2 h-1.5 bg-white/20 rounded-full overflow-hidden">
                                        <div className="h-full bg-white rounded-full transition-all duration-700" style={{ width: `${Math.min(efficiency, 100)}%` }}></div>
                                    </div>
                                </div>
                            </div>
                        </div>

                    </>
                )}
            </div>

            {/* Export Options Modal */}
            {(exportModal || closingModal === 'export') && (
                <div
                    className="fixed inset-0 z-[200] flex items-center justify-center p-4"
                    onClick={closeExportModal}
                >
                    <div className={`absolute inset-0 bg-black/50 backdrop-blur-sm ${closingModal === 'export' ? 'animate-fade-out' : ''}`} />
                    <div
                        className={`relative w-full max-w-sm bg-white dark:bg-slate-800 rounded-2xl shadow-2xl overflow-hidden ${closingModal === 'export' ? 'animate-fade-out' : 'animate-slide-up-sheet'}`}
                        onClick={e => e.stopPropagation()}
                        onAnimationEnd={() => {
                            if (closingModal === 'export') {
                                setExportModal(null);
                                setClosingModal(null);
                            }
                        }}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
                            <div className="flex items-center gap-2.5">
                                <span className="text-lg">{exportModal === 'pdf' ? '🖨️' : '📥'}</span>
                                <div>
                                    <h3 className="font-bold text-slate-800 dark:text-white text-sm">Настройка экспорта</h3>
                                    <p className="text-xs text-slate-400 dark:text-slate-500">{exportModal === 'pdf' ? 'PDF документ' : 'CSV таблица'}</p>
                                </div>
                            </div>
                            <button
                                onClick={closeExportModal}
                                className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors text-xs font-bold"
                            >✕</button>
                        </div>

                        {/* Company info line */}
                        {appSettings.companyName && (
                            <div className="mx-5 mt-4 px-3 py-2 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl flex items-center gap-2">
                                <span className="text-indigo-400 text-sm">🏢</span>
                                <span className="text-xs font-medium text-indigo-700 dark:text-indigo-400">{appSettings.companyName}</span>
                                <span className="ml-auto text-xs text-indigo-400">в шапке отчёта</span>
                            </div>
                        )}

                        {/* Options */}
                        <div className="px-5 py-4 space-y-1">
                            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Разделы отчёта</p>
                            {([
                                { key: 'timeline', label: 'Динамика поступлений', icon: '📈', always: false },
                                { key: 'investorBreakdown', label: 'Разбивка по инвесторам', icon: '👥', always: false, hidden: !showInvestorBreakdown },
                                { key: 'expenses', label: 'Расходы за период', icon: '💸', always: false, hidden: !expenseStats },
                                { key: 'overduePayments', label: 'Просроченные платежи', icon: '⚠️', always: false, badge: overduePayments.length > 0 ? `${overduePayments.length}` : undefined },
                                { key: 'customerBreakdown', label: 'Детализация по клиентам', icon: '👤', always: false },
                            ] as { key: keyof typeof exportOptions; label: string; icon: string; always?: boolean; hidden?: boolean; badge?: string }[])
                                .filter(o => !o.hidden)
                                .map(opt => (
                                <button
                                    key={opt.key}
                                    onClick={() => toggleExportOption(opt.key)}
                                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left ${
                                        exportOptions[opt.key]
                                            ? 'bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800'
                                            : 'bg-slate-50 dark:bg-slate-700/50 border border-transparent hover:bg-slate-100 dark:hover:bg-slate-700'
                                    }`}
                                >
                                    <span className="text-base leading-none">{opt.icon}</span>
                                    <span className={`text-sm flex-1 font-medium ${exportOptions[opt.key] ? 'text-indigo-700 dark:text-indigo-400' : 'text-slate-600 dark:text-slate-300'}`}>
                                        {opt.label}
                                    </span>
                                    {opt.badge && (
                                        <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">{opt.badge}</span>
                                    )}
                                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                                        exportOptions[opt.key]
                                            ? 'bg-indigo-600 border-indigo-600'
                                            : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
                                    }`}>
                                        {exportOptions[opt.key] && <span className="text-white text-xs">✓</span>}
                                    </div>
                                </button>
                            ))}
                        </div>

                        {/* Footer */}
                        <div className="px-5 pb-5 flex gap-2">
                            <button
                                onClick={closeExportModal}
                                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-all"
                            >
                                Отмена
                            </button>
                            <button
                                onClick={() => {
                                    if (exportModal === 'csv') exportCSV(exportOptions);
                                    else exportPDF(exportOptions);
                                    closeExportModal();
                                }}
                                className="flex-2 flex-grow py-2.5 px-5 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 text-white text-sm font-semibold hover:shadow-lg hover:shadow-indigo-200 hover:-translate-y-0.5 transition-all"
                            >
                                {exportModal === 'pdf' ? '🖨️ Скачать PDF' : '📥 Скачать CSV'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Expense Detail Modal — Telegram style bottom sheet */}
            {(activeModal || closingModal === 'active') && (
                <div
                    className="fixed inset-0 z-[200] flex items-end justify-center"
                    onClick={closeActiveModal}
                >
                    {/* Backdrop */}
                    <div className={`absolute inset-0 bg-black/50 backdrop-blur-sm ${closingModal === 'active' ? 'animate-fade-out' : ''}`} />

                    {/* Sheet */}
                    <div
                        className={`relative w-full sm:max-w-lg bg-white dark:bg-slate-800 rounded-t-3xl shadow-2xl max-h-[85vh] flex flex-col overflow-hidden ${closingModal === 'active' ? 'animate-slide-down-sheet' : 'animate-slide-up-sheet'}`}
                        onClick={e => e.stopPropagation()}
                        onAnimationEnd={() => {
                            if (closingModal === 'active') {
                                setActiveModal(null);
                                setClosingModal(null);
                            }
                        }}
                    >
                        {/* Drag handle (mobile) */}
                        <div className="flex justify-center pt-3 pb-1 sm:hidden">
                            <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full" />
                        </div>

                        {/* Header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
                            <div>
                                <h3 className="font-bold text-slate-800 dark:text-white text-base">
                                    {activeModal === 'payments' ? 'Поступления от клиентов' :
                                     activeModal === 'investor_payouts' ? 'Выплаты инвесторам' :
                                     'Прочие расходы'}
                                </h3>
                                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{filters.period.start} — {filters.period.end}</p>
                            </div>
                            <button
                                onClick={closeActiveModal}
                                className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors text-sm font-bold flex-shrink-0"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Scrollable content */}
                        <div className="flex-1 overflow-y-auto">
                            {activeModal === 'payments' && (
                                paymentsDetail.length > 0 ? (
                                    <div className="divide-y divide-slate-50 dark:divide-slate-700">
                                        {paymentsDetail.map((item, i) => (
                                            <div key={i} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50/50 dark:hover:bg-slate-700/50 transition-colors">
                                                <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0 text-base">💳</div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-medium text-slate-700 dark:text-slate-200 text-sm truncate">{item.productName}</p>
                                                    <p className="text-xs text-slate-400 dark:text-slate-500">{item.label} · {new Date(item.date).toLocaleDateString('ru-RU')}</p>
                                                </div>
                                                <span className="font-semibold text-emerald-600 dark:text-emerald-400 text-sm flex-shrink-0">+{formatCurrency(item.amount, appSettings.showCents)} ₽</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-36 text-slate-400 dark:text-slate-500">
                                        <span className="text-3xl mb-2 opacity-40">💳</span>
                                        <p className="text-sm">Нет поступлений за период</p>
                                    </div>
                                )
                            )}

                            {activeModal === 'investor_payouts' && (
                                investorPayoutsDetail.length > 0 ? (
                                    <div className="divide-y divide-slate-50 dark:divide-slate-700">
                                        {investorPayoutsDetail.map((item, i) => (
                                            <div key={i} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50/50 dark:hover:bg-slate-700/50 transition-colors">
                                                <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0 text-base">👥</div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-medium text-slate-700 dark:text-slate-200 text-sm truncate">{item.title}</p>
                                                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                                        {item.investorName && (
                                                            <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded-md">{item.investorName}</span>
                                                        )}
                                                        <span className="text-xs text-slate-400 dark:text-slate-500">
                                                            {item.payoutType === 'PROFIT' ? 'Прибыль' : 'Инвестиция'} · {new Date(item.date).toLocaleDateString('ru-RU')}
                                                        </span>
                                                    </div>
                                                </div>
                                                <span className="font-semibold text-indigo-600 dark:text-indigo-400 text-sm flex-shrink-0">−{formatCurrency(item.amount, appSettings.showCents)} ₽</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-36 text-slate-400 dark:text-slate-500">
                                        <span className="text-3xl mb-2 opacity-40">👥</span>
                                        <p className="text-sm">Нет выплат за период</p>
                                    </div>
                                )
                            )}

                            {activeModal === 'other_expenses' && (
                                otherExpensesDetail.length > 0 ? (
                                    <div className="divide-y divide-slate-50 dark:divide-slate-700">
                                        {otherExpensesDetail.map((item, i) => (
                                            <div key={i} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50/50 dark:hover:bg-slate-700/50 transition-colors">
                                                <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0 text-base">📋</div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-medium text-slate-700 dark:text-slate-200 text-sm truncate">{item.title}</p>
                                                    <div className="flex items-center gap-1.5 mt-0.5">
                                                        {item.category && (
                                                            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded-md">{item.category}</span>
                                                        )}
                                                        <span className="text-xs text-slate-400 dark:text-slate-500">{new Date(item.date).toLocaleDateString('ru-RU')}</span>
                                                    </div>
                                                </div>
                                                <span className="font-semibold text-red-600 dark:text-red-400 text-sm flex-shrink-0">−{formatCurrency(item.amount, appSettings.showCents)} ₽</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-36 text-slate-400 dark:text-slate-500">
                                        <span className="text-3xl mb-2 opacity-40">📋</span>
                                        <p className="text-sm">Нет расходов за период</p>
                                    </div>
                                )
                            )}
                        </div>

                        {/* Footer with total */}
                        <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-700/50 flex-shrink-0">
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-slate-500 dark:text-slate-400">
                                    {activeModal === 'payments'
                                        ? `${paymentsDetail.length} платежей`
                                        : activeModal === 'investor_payouts'
                                        ? `${investorPayoutsDetail.length} выплат`
                                        : `${otherExpensesDetail.length} расходов`}
                                </span>
                                <span className="font-bold text-slate-800 dark:text-white text-base">
                                    {activeModal === 'payments'
                                        ? formatCurrency(data.customerPaymentsInPeriod, appSettings.showCents)
                                        : activeModal === 'investor_payouts'
                                        ? formatCurrency(expenseStats?.investorPayouts || 0, appSettings.showCents)
                                        : formatCurrency(expenseStats?.otherExpenses || 0, appSettings.showCents)} ₽
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Reports;
