import React, { useMemo } from 'react';
import { Investor, AppSettings, Sale, Expense, Account } from '../types';
import { formatCurrency } from '../src/utils';
import {
    PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
    AreaChart, Area
} from 'recharts';

interface ReportFilters {
    investorId: string;
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
    emerald: { bg: 'from-emerald-500 to-emerald-400', shadow: 'shadow-emerald-200', text: 'text-emerald-700', light: 'bg-emerald-50 text-emerald-600', border: 'hover:border-emerald-200' },
    teal:    { bg: 'from-teal-500 to-teal-400',       shadow: 'shadow-teal-200',    text: 'text-teal-700',    light: 'bg-teal-50 text-teal-600',    border: 'hover:border-teal-200'    },
    sky:     { bg: 'from-sky-500 to-sky-400',         shadow: 'shadow-sky-200',     text: 'text-sky-700',     light: 'bg-sky-50 text-sky-600',      border: 'hover:border-sky-200'     },
    indigo:  { bg: 'from-indigo-500 to-indigo-400',   shadow: 'shadow-indigo-200',  text: 'text-indigo-700',  light: 'bg-indigo-50 text-indigo-600', border: 'hover:border-indigo-200' },
    purple:  { bg: 'from-purple-500 to-purple-400',   shadow: 'shadow-purple-200',  text: 'text-purple-700',  light: 'bg-purple-50 text-purple-600', border: 'hover:border-purple-200' },
    amber:   { bg: 'from-amber-500 to-amber-400',     shadow: 'shadow-amber-200',   text: 'text-amber-700',   light: 'bg-amber-50 text-amber-600',   border: 'hover:border-amber-200'  },
    red:     { bg: 'from-red-500 to-red-400',         shadow: 'shadow-red-200',     text: 'text-red-700',     light: 'bg-red-50 text-red-600',       border: 'hover:border-red-200'    },
};

interface KpiCardProps {
    icon: string; label: string; value: string; badge: string;
    color: KpiColor; subtext?: string;
}
const KpiCard: React.FC<KpiCardProps> = ({ icon, label, value, badge, color, subtext }) => {
    const c = COLOR_MAP[color];
    return (
        <div className={`group bg-white/90 backdrop-blur-sm p-5 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 border border-slate-100 ${c.border} hover:-translate-y-1`}>
            <div className="flex items-center justify-between mb-3">
                <div className={`p-2.5 bg-gradient-to-br ${c.bg} text-white rounded-xl shadow-lg ${c.shadow} group-hover:scale-110 transition-transform text-base leading-none`}>{icon}</div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c.light}`}>{badge}</span>
            </div>
            <p className="text-xs font-medium text-slate-500 mb-1 leading-tight">{label}</p>
            <p className={`text-xl font-bold ${c.text} leading-tight`}>{value}</p>
            {subtext && <p className="text-xs text-slate-400 mt-1">{subtext}</p>}
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
    const textColor = color === 'emerald' ? 'text-emerald-600' : 'text-indigo-600';
    return (
        <div>
            <div className="flex justify-between items-center mb-1.5">
                <span className="text-xs font-medium text-slate-600">{label}</span>
                <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-500 font-medium">{formatCurrency(realized, showCents)} ₽</span>
                    <span className="text-slate-300">/</span>
                    <span className="text-slate-400">{formatCurrency(expected, showCents)} ₽</span>
                    <span className={`font-bold ${textColor}`}>{pct}%</span>
                </div>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full ${barColor} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }}></div>
            </div>
        </div>
    );
};

const Reports: React.FC<ReportsProps> = ({
    investors, filters, onFiltersChange, data, appSettings,
    sales = [], expenses = [], accounts = []
}) => {
    const hasInvestors = investors.length > 0;
    const showInvestorBreakdown = filters.investorId === 'ALL' && investors.length > 1;

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
        if (filters.investorId !== 'ALL') {
            filteredSales = sales.filter(s => {
                const acc = accounts.find(a => a.id === s.accountId);
                return acc?.ownerId === filters.investorId;
            });
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

        const periodExpenses = expenses.filter(e => {
            const eDate = new Date(e.date);
            return eDate >= startDate && eDate <= endDate && !e.isRefund;
        });
        if (!periodExpenses.length) return null;

        const investorPayouts = periodExpenses
            .filter(e => e.payoutType === 'PROFIT' || e.payoutType === 'INVESTMENT')
            .reduce((sum, e) => sum + e.amount, 0);
        const otherExpenses = periodExpenses
            .filter(e => e.payoutType !== 'PROFIT' && e.payoutType !== 'INVESTMENT')
            .reduce((sum, e) => sum + e.amount, 0);
        const total = periodExpenses.reduce((sum, e) => sum + e.amount, 0);

        return { investorPayouts, otherExpenses, total, count: periodExpenses.length };
    }, [expenses, filters]);

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
                return acc?.ownerId === inv.id;
            }).filter(s => s.status === 'ACTIVE' || s.status === 'COMPLETED');

            let expectedProfit = 0;
            investorSales.forEach(sale => {
                if (sale.buyPrice <= 0) return;
                const saleProfit = sale.totalAmount - sale.buyPrice;
                if (saleProfit > 0) expectedProfit += saleProfit * (inv.profitPercentage / 100);
            });

            let realizedProfit = 0;
            investorSales.forEach(sale => {
                if (sale.buyPrice <= 0 || sale.totalAmount <= sale.buyPrice) return;
                const profitMargin = (sale.totalAmount - sale.buyPrice) / sale.totalAmount;
                const paymentsInPeriod = [
                    { date: sale.startDate, amount: sale.downPayment },
                    ...sale.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false)
                ].filter(p => { const d = new Date(p.date); return d >= startDate && d <= endDate; });
                paymentsInPeriod.forEach(p => {
                    realizedProfit += p.amount * profitMargin * (inv.profitPercentage / 100);
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

    // CSV Export
    const exportCSV = () => {
        const sep = ';';
        const selectedInvestorName = filters.investorId === 'ALL'
            ? 'Все инвесторы'
            : investors.find(i => i.id === filters.investorId)?.name || filters.investorId;

        const lines: string[] = [
            `Финансовый отчёт${sep}${sep}`,
            `Период${sep}${filters.period.start} — ${filters.period.end}${sep}`,
            `Инвестор${sep}${selectedInvestorName}${sep}`,
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

        if (paymentTimeline.length > 0) {
            lines.push(`ДИНАМИКА ПЛАТЕЖЕЙ${sep}${sep}`);
            lines.push(`Период${sep}Поступления (₽)${sep}`);
            paymentTimeline.forEach(p => lines.push(`${p.key}${sep}${p.amount.toFixed(2)}${sep}`));
            lines.push(`${sep}${sep}`);
        }

        if (showInvestorBreakdown && accurateInvestorBreakdown.length > 0) {
            lines.push(`РАЗБИВКА ПО ИНВЕСТОРАМ${sep}${sep}${sep}${sep}${sep}`);
            lines.push(`Инвестор${sep}Капитал (₽)${sep}Доля капитала (%)${sep}% прибыли${sep}Ожидается (₽)${sep}Получено (₽)${sep}Контрактов${sep}`);
            accurateInvestorBreakdown.forEach(({ inv, share, expectedProfit, realizedProfit, salesCount }) => {
                lines.push(`${inv.name}${sep}${inv.initialAmount.toFixed(2)}${sep}${share}${sep}${inv.profitPercentage}${sep}${expectedProfit.toFixed(2)}${sep}${realizedProfit.toFixed(2)}${sep}${salesCount}${sep}`);
            });
            lines.push(`${sep}${sep}`);
        }

        if (expenseStats) {
            lines.push(`РАСХОДЫ ЗА ПЕРИОД${sep}${sep}`);
            lines.push(`Статья${sep}Сумма (₽)${sep}`);
            lines.push(`Выплаты инвесторам${sep}${expenseStats.investorPayouts.toFixed(2)}${sep}`);
            lines.push(`Прочие расходы${sep}${expenseStats.otherExpenses.toFixed(2)}${sep}`);
            lines.push(`Итого расходов${sep}${expenseStats.total.toFixed(2)}${sep}`);
            lines.push(`${sep}${sep}`);
            const netFlow = data.customerPaymentsInPeriod - expenseStats.total;
            lines.push(`Чистый денежный поток${sep}${netFlow.toFixed(2)}${sep}`);
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
    const exportPDF = () => {
        const selectedInvestorName = filters.investorId === 'ALL'
            ? 'Все инвесторы'
            : investors.find(i => i.id === filters.investorId)?.name || filters.investorId;
        const fmt = (n: number) => formatCurrency(n, appSettings.showCents) + ' ₽';

        const investorTableHTML = showInvestorBreakdown && accurateInvestorBreakdown.length > 0 ? `
            <h2>Разбивка по инвесторам</h2>
            <p class="note">Ожидаемая и полученная прибыль рассчитаны из реальных сделок каждого инвестора</p>
            <table>
                <tr><th>Инвестор</th><th>Капитал</th><th>Доля</th><th>% прибыли</th><th>Ожидается</th><th>Получено</th><th>Контрактов</th></tr>
                ${accurateInvestorBreakdown.map(({ inv, share, expectedProfit, realizedProfit, salesCount }) => `
                <tr>
                    <td><strong>${inv.name}</strong></td>
                    <td>${fmt(inv.initialAmount)}</td>
                    <td>${share}%</td>
                    <td>${inv.profitPercentage}%</td>
                    <td>${fmt(expectedProfit)}</td>
                    <td class="green">${fmt(realizedProfit)}</td>
                    <td>${salesCount}</td>
                </tr>`).join('')}
            </table>` : '';

        const timelineHTML = paymentTimeline.length > 0 ? `
            <h2>Динамика платежей</h2>
            <table>
                <tr><th>Период</th><th>Поступления</th></tr>
                ${paymentTimeline.map(p => `<tr><td>${p.label}</td><td class="green">${fmt(p.amount)}</td></tr>`).join('')}
                <tr class="total"><td><strong>Итого</strong></td><td><strong>${fmt(data.customerPaymentsInPeriod)}</strong></td></tr>
            </table>` : '';

        const expenseHTML = expenseStats ? `
            <h2>Расходы за период</h2>
            <table>
                <tr><th>Статья</th><th>Сумма</th></tr>
                <tr><td>Выплаты инвесторам</td><td>${fmt(expenseStats.investorPayouts)}</td></tr>
                <tr><td>Прочие расходы</td><td>${fmt(expenseStats.otherExpenses)}</td></tr>
                <tr class="total"><td><strong>Итого расходов</strong></td><td><strong>${fmt(expenseStats.total)}</strong></td></tr>
                <tr><td>Поступления от клиентов</td><td class="green">${fmt(data.customerPaymentsInPeriod)}</td></tr>
                <tr class="total">
                    <td><strong>Чистый поток</strong></td>
                    <td class="${data.customerPaymentsInPeriod - expenseStats.total >= 0 ? 'green' : 'red'}">
                        <strong>${fmt(data.customerPaymentsInPeriod - expenseStats.total)}</strong>
                    </td>
                </tr>
            </table>` : '';

        const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">
        <title>Финансовый отчёт ${filters.period.start} — ${filters.period.end}</title>
        <style>
            body { font-family: 'Arial', sans-serif; padding: 32px; color: #1e293b; font-size: 13px; }
            h1 { font-size: 22px; color: #4f46e5; margin: 0 0 4px; }
            .subtitle { color: #64748b; font-size: 12px; margin-bottom: 28px; }
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
            @media print { @page { margin: 1.5cm; size: A4; } body { padding: 0; } }
        </style></head><body>
        <h1>Финансовый отчёт</h1>
        <div class="subtitle">Период: <strong>${filters.period.start} — ${filters.period.end}</strong> · Инвестор: <strong>${selectedInvestorName}</strong></div>
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
        </body></html>`;

        const win = window.open('', '_blank', 'width=900,height=700');
        if (win) {
            win.document.write(html);
            win.document.close();
            setTimeout(() => win.print(), 300);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50/30 pb-24 w-full">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 animate-in fade-in slide-in-from-top-4 duration-500">

                {/* Header */}
                <header className="flex items-start justify-between flex-wrap gap-3">
                    <div>
                        <h2 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-indigo-400 bg-clip-text text-transparent">
                            Отчеты
                        </h2>
                        <p className="text-slate-500 text-sm mt-1 flex items-center gap-2">
                            <span className="w-1 h-1 bg-indigo-400 rounded-full inline-block"></span>
                            Финансовая аналитика · {filters.period.start} — {filters.period.end}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {hasData && (
                            <div className={`hidden sm:block px-4 py-2 rounded-xl text-sm font-semibold ${efficiencyColor === 'emerald' ? 'bg-emerald-100 text-emerald-700' : efficiencyColor === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                                Эффективность {efficiency}%
                            </div>
                        )}
                        <button
                            onClick={exportCSV}
                            className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
                        >
                            <span>📥</span> CSV
                        </button>
                        <button
                            onClick={exportPDF}
                            className="flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-indigo-600 to-indigo-500 text-white rounded-xl text-xs font-semibold hover:shadow-lg hover:shadow-indigo-200 hover:-translate-y-0.5 transition-all shadow-sm"
                        >
                            <span>🖨️</span> PDF
                        </button>
                    </div>
                </header>

                {/* Filters */}
                <div className="bg-white/80 backdrop-blur-sm p-5 rounded-2xl shadow-lg border border-white/20 hover:shadow-xl transition-all duration-300 space-y-4">
                    <div className="flex items-center gap-2">
                        <span className="w-1 h-5 bg-indigo-500 rounded-full"></span>
                        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Фильтры</h3>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {(Object.keys(PRESET_LABELS) as PeriodPreset[]).map(preset => {
                            const dates = getPeriodDates(preset);
                            const isActive = filters.period.start === dates.start && filters.period.end === dates.end;
                            return (
                                <button key={preset} onClick={() => applyPreset(preset)}
                                    className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 ${isActive ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-200 scale-105' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:scale-105'}`}>
                                    {PRESET_LABELS[preset]}
                                </button>
                            );
                        })}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full"></span>Инвестор
                            </label>
                            <div className="relative">
                                <select
                                    className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none text-sm appearance-none cursor-pointer hover:border-indigo-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all"
                                    value={filters.investorId}
                                    onChange={e => onFiltersChange(prev => ({ ...prev, investorId: e.target.value }))}
                                >
                                    <option value="ALL">Все инвесторы</option>
                                    {investors.map(inv => <option key={inv.id} value={inv.id}>{inv.name}</option>)}
                                </select>
                                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none text-xs">▼</div>
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></span>Начало периода
                            </label>
                            <input type="date" className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none text-sm hover:border-indigo-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all"
                                value={filters.period.start} onChange={e => handlePeriodInput('start', e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                <span className="w-1.5 h-1.5 bg-amber-400 rounded-full"></span>Конец периода
                            </label>
                            <input type="date" className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none text-sm hover:border-indigo-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all"
                                value={filters.period.end} onChange={e => handlePeriodInput('end', e.target.value)} />
                        </div>
                    </div>
                </div>

                {!hasData ? (
                    <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-dashed border-slate-200 p-16 text-center">
                        <div className="text-7xl mb-4 opacity-30">📊</div>
                        <h3 className="text-xl font-bold text-slate-700 mb-2">Нет данных за выбранный период</h3>
                        <p className="text-slate-400 max-w-md mx-auto">Выберите другой период или инвестора для просмотра аналитики</p>
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

                        {/* Payment timeline — area chart */}
                        {paymentTimeline.length > 1 && (
                            <div className="bg-white/90 backdrop-blur-sm p-6 rounded-2xl shadow-lg border border-slate-100">
                                <div className="flex items-center gap-2 mb-5">
                                    <span className="w-1 h-5 bg-emerald-500 rounded-full"></span>
                                    <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Динамика поступлений</h4>
                                    <span className="ml-auto text-xs text-slate-400">{paymentTimeline.length} точек · всего {formatCurrency(data.customerPaymentsInPeriod, appSettings.showCents)} ₽</span>
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
                            <div className="lg:col-span-3 bg-white/90 backdrop-blur-sm p-6 rounded-2xl shadow-lg border border-slate-100">
                                <div className="flex items-center gap-2 mb-5">
                                    <span className="w-1 h-5 bg-indigo-500 rounded-full"></span>
                                    <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Ожидаемое vs Полученное</h4>
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
                                <div className="mt-5 pt-5 border-t border-slate-100 space-y-3">
                                    <ProgressRow label="Менеджер — план/факт" realized={data.realizedManagerProfit} expected={data.expectedManagerProfit} color="emerald" showCents={appSettings.showCents} />
                                    {hasInvestors && (
                                        <ProgressRow label="Инвесторы — план/факт" realized={data.realizedInvestorProfit} expected={data.expectedInvestorProfit} color="indigo" showCents={appSettings.showCents} />
                                    )}
                                </div>
                            </div>

                            <div className="lg:col-span-2 bg-white/90 backdrop-blur-sm p-6 rounded-2xl shadow-lg border border-slate-100">
                                <div className="flex items-center gap-2 mb-4">
                                    <span className="w-1 h-5 bg-emerald-500 rounded-full"></span>
                                    <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Распределение прибыли</h4>
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
                                                        <span className="text-slate-600">{entry.name}</span>
                                                    </div>
                                                    <span className="font-semibold text-slate-700">{formatCurrency(entry.value, appSettings.showCents)} ₽</span>
                                                </div>
                                            ))}
                                            <div className="pt-2 border-t border-slate-100 flex justify-between text-sm">
                                                <span className="text-slate-500">Итого получено</span>
                                                <span className="font-bold text-slate-700">{formatCurrency(totalRealized, appSettings.showCents)} ₽</span>
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="h-48 flex items-center justify-center text-slate-400 text-sm">Нет данных о прибыли</div>
                                )}
                            </div>
                        </div>

                        {/* Expected profit section */}
                        <div className="bg-white/90 backdrop-blur-sm p-6 rounded-2xl shadow-lg border border-slate-100">
                            <div className="flex items-center gap-2 mb-5">
                                <span className="w-1 h-5 bg-slate-400 rounded-full"></span>
                                <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Ожидаемая прибыль по контрактам</h4>
                                <span className="ml-auto text-xs font-medium text-slate-500 bg-slate-100 px-3 py-1 rounded-full">Прогноз</span>
                            </div>
                            <div className={`grid grid-cols-1 gap-4 ${hasInvestors ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                                <div className="bg-gradient-to-br from-slate-50 to-white p-4 rounded-xl border border-slate-100">
                                    <p className="text-xs font-medium text-slate-500 mb-1">Итого ожидается</p>
                                    <p className="text-2xl font-bold text-slate-700">{formatCurrency(totalExpected, appSettings.showCents)} ₽</p>
                                    <p className="text-xs text-slate-400 mt-1">из активных и завершённых контрактов</p>
                                </div>
                                <div className="bg-gradient-to-br from-sky-50 to-white p-4 rounded-xl border border-sky-100">
                                    <p className="text-xs font-medium text-sky-600 mb-1">Прогноз менеджера</p>
                                    <p className="text-2xl font-bold text-sky-700">{formatCurrency(data.expectedManagerProfit, appSettings.showCents)} ₽</p>
                                    <p className="text-xs text-sky-500 mt-1">{totalExpected > 0 ? Math.round((data.expectedManagerProfit / totalExpected) * 100) : 0}% от общей суммы</p>
                                </div>
                                {hasInvestors && (
                                    <div className="bg-gradient-to-br from-indigo-50 to-white p-4 rounded-xl border border-indigo-100">
                                        <p className="text-xs font-medium text-indigo-600 mb-1">Прогноз инвесторов</p>
                                        <p className="text-2xl font-bold text-indigo-700">{formatCurrency(data.expectedInvestorProfit, appSettings.showCents)} ₽</p>
                                        <p className="text-xs text-indigo-500 mt-1">{totalExpected > 0 ? Math.round((data.expectedInvestorProfit / totalExpected) * 100) : 0}% от общей суммы</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Expenses section */}
                        {expenseStats && (
                            <div className="bg-white/90 backdrop-blur-sm p-6 rounded-2xl shadow-lg border border-slate-100">
                                <div className="flex items-center gap-2 mb-5">
                                    <span className="w-1 h-5 bg-red-400 rounded-full"></span>
                                    <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Расходы за период</h4>
                                    <span className="ml-auto text-xs text-slate-400">{expenseStats.count} операций</span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                                    <div className="bg-gradient-to-br from-emerald-50 to-white p-4 rounded-xl border border-emerald-100">
                                        <p className="text-xs font-medium text-emerald-600 mb-1">Поступления</p>
                                        <p className="text-xl font-bold text-emerald-700">{formatCurrency(data.customerPaymentsInPeriod, appSettings.showCents)} ₽</p>
                                        <p className="text-xs text-emerald-500 mt-1">от клиентов</p>
                                    </div>
                                    <div className="bg-gradient-to-br from-indigo-50 to-white p-4 rounded-xl border border-indigo-100">
                                        <p className="text-xs font-medium text-indigo-600 mb-1">Выплаты инвесторам</p>
                                        <p className="text-xl font-bold text-indigo-700">{formatCurrency(expenseStats.investorPayouts, appSettings.showCents)} ₽</p>
                                        <p className="text-xs text-indigo-500 mt-1">прибыль и капитал</p>
                                    </div>
                                    <div className="bg-gradient-to-br from-red-50 to-white p-4 rounded-xl border border-red-100">
                                        <p className="text-xs font-medium text-red-500 mb-1">Прочие расходы</p>
                                        <p className="text-xl font-bold text-red-600">{formatCurrency(expenseStats.otherExpenses, appSettings.showCents)} ₽</p>
                                        <p className="text-xs text-red-400 mt-1">операционные</p>
                                    </div>
                                    <div className={`p-4 rounded-xl border ${data.customerPaymentsInPeriod - expenseStats.total >= 0 ? 'bg-gradient-to-br from-teal-50 to-white border-teal-100' : 'bg-gradient-to-br from-rose-50 to-white border-rose-100'}`}>
                                        <p className={`text-xs font-medium mb-1 ${data.customerPaymentsInPeriod - expenseStats.total >= 0 ? 'text-teal-600' : 'text-rose-500'}`}>Чистый поток</p>
                                        <p className={`text-xl font-bold ${data.customerPaymentsInPeriod - expenseStats.total >= 0 ? 'text-teal-700' : 'text-rose-600'}`}>
                                            {data.customerPaymentsInPeriod - expenseStats.total >= 0 ? '+' : ''}{formatCurrency(data.customerPaymentsInPeriod - expenseStats.total, appSettings.showCents)} ₽
                                        </p>
                                        <p className={`text-xs mt-1 ${data.customerPaymentsInPeriod - expenseStats.total >= 0 ? 'text-teal-500' : 'text-rose-400'}`}>поступления − расходы</p>
                                    </div>
                                </div>

                                {/* Income vs expense visual bar */}
                                {data.customerPaymentsInPeriod > 0 && (
                                    <div className="mt-4">
                                        <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                                            <span>Расходы {expenseStats.total > 0 ? Math.round((expenseStats.total / data.customerPaymentsInPeriod) * 100) : 0}% от поступлений</span>
                                            <span className={data.customerPaymentsInPeriod - expenseStats.total >= 0 ? 'text-teal-600 font-semibold' : 'text-rose-500 font-semibold'}>
                                                {data.customerPaymentsInPeriod - expenseStats.total >= 0 ? 'Положительный баланс' : 'Отрицательный баланс'}
                                            </span>
                                        </div>
                                        <div className="h-3 bg-slate-100 rounded-full overflow-hidden flex gap-0.5">
                                            {expenseStats.investorPayouts > 0 && (
                                                <div className="h-full bg-indigo-400 rounded-l-full transition-all duration-700" style={{ width: `${Math.min((expenseStats.investorPayouts / data.customerPaymentsInPeriod) * 100, 100)}%` }}></div>
                                            )}
                                            {expenseStats.otherExpenses > 0 && (
                                                <div className="h-full bg-red-400 transition-all duration-700" style={{ width: `${Math.min((expenseStats.otherExpenses / data.customerPaymentsInPeriod) * 100, 100)}%` }}></div>
                                            )}
                                        </div>
                                        <div className="flex gap-4 mt-2">
                                            <div className="flex items-center gap-1 text-xs text-slate-500"><span className="w-2.5 h-2.5 rounded-sm bg-indigo-400"></span>Инвесторам</div>
                                            <div className="flex items-center gap-1 text-xs text-slate-500"><span className="w-2.5 h-2.5 rounded-sm bg-red-400"></span>Прочее</div>
                                            <div className="flex items-center gap-1 text-xs text-slate-500"><span className="w-2.5 h-2.5 rounded-sm bg-slate-100 border border-slate-200"></span>Остаток</div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Per-investor breakdown */}
                        {showInvestorBreakdown && accurateInvestorBreakdown.length > 0 && (
                            <div className="bg-white/90 backdrop-blur-sm p-6 rounded-2xl shadow-lg border border-slate-100">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="w-1 h-5 bg-purple-500 rounded-full"></span>
                                    <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Разбивка по инвесторам</h4>
                                </div>
                                <p className="text-xs text-slate-400 mb-5 ml-3">Прибыль рассчитана из реальных сделок каждого инвестора с учётом его процентной ставки</p>
                                <div className="overflow-x-auto -mx-1">
                                    <table className="w-full text-sm min-w-[600px]">
                                        <thead>
                                            <tr>
                                                <th className="pb-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider pl-1">Инвестор</th>
                                                <th className="pb-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Капитал</th>
                                                <th className="pb-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Доля капитала</th>
                                                <th className="pb-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Ожидается</th>
                                                <th className="pb-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Получено</th>
                                                <th className="pb-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider pr-1">% плана</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {accurateInvestorBreakdown.map(({ inv, share, expectedProfit, realizedProfit, salesCount, color }) => {
                                                const pct = expectedProfit > 0 ? Math.round((realizedProfit / expectedProfit) * 100) : 0;
                                                const rowPctColor = pct >= 80 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-500';
                                                return (
                                                    <tr key={inv.id} className="hover:bg-slate-50/70 transition-colors">
                                                        <td className="py-3 pl-1">
                                                            <div className="flex items-center gap-2.5">
                                                                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: color }}>
                                                                    {inv.name.charAt(0).toUpperCase()}
                                                                </div>
                                                                <div>
                                                                    <p className="font-medium text-slate-700">{inv.name}</p>
                                                                    <p className="text-xs text-slate-400">{inv.profitPercentage}% ставка · {salesCount} контр.</p>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="py-3 text-right font-medium text-slate-600">{formatCurrency(inv.initialAmount, appSettings.showCents)} ₽</td>
                                                        <td className="py-3 text-right">
                                                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: color + '18', color }}>
                                                                {share}%
                                                            </span>
                                                        </td>
                                                        <td className="py-3 text-right text-slate-500">{formatCurrency(expectedProfit, appSettings.showCents)} ₽</td>
                                                        <td className="py-3 text-right font-semibold text-emerald-600">{formatCurrency(realizedProfit, appSettings.showCents)} ₽</td>
                                                        <td className="py-3 pr-1">
                                                            <div className="flex flex-col items-end gap-1">
                                                                <span className={`text-xs font-bold ${rowPctColor}`}>{pct}%</span>
                                                                <div className="w-14 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }}></div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                        <tfoot>
                                            <tr className="border-t-2 border-slate-200">
                                                <td className="pt-3 pl-1 font-semibold text-slate-700">Итого</td>
                                                <td className="pt-3 text-right font-semibold text-slate-700">{formatCurrency(totalInvestment, appSettings.showCents)} ₽</td>
                                                <td className="pt-3 text-right text-slate-500">100%</td>
                                                <td className="pt-3 text-right font-semibold text-slate-600">{formatCurrency(data.expectedInvestorProfit, appSettings.showCents)} ₽</td>
                                                <td className="pt-3 text-right font-bold text-emerald-600">{formatCurrency(data.realizedInvestorProfit, appSettings.showCents)} ₽</td>
                                                <td className="pt-3 pr-1 text-right">
                                                    <span className={`text-xs font-bold ${efficiency >= 80 ? 'text-emerald-600' : efficiency >= 50 ? 'text-amber-600' : 'text-red-500'}`}>{efficiency}%</span>
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
        </div>
    );
};

export default Reports;
