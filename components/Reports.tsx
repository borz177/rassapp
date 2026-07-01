import React, { useMemo } from 'react';
import { Investor, AppSettings } from '../types';
import { formatCurrency } from '../src/utils';
import {
    PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend
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
}

type PeriodPreset = 'today' | 'week' | 'month' | 'lastMonth' | 'quarter' | 'year' | 'all';

const PRESET_LABELS: Record<PeriodPreset, string> = {
    today: 'Сегодня',
    week: '7 дней',
    month: 'Месяц',
    lastMonth: 'Пр. месяц',
    quarter: 'Квартал',
    year: 'Год',
    all: 'Всё время',
};

function getPeriodDates(preset: PeriodPreset): { start: string; end: string } {
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().split('T')[0];
    const todayStr = fmt(today);
    switch (preset) {
        case 'today':
            return { start: todayStr, end: todayStr };
        case 'week': {
            const d = new Date(today); d.setDate(today.getDate() - 7);
            return { start: fmt(d), end: todayStr };
        }
        case 'month':
            return { start: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), end: todayStr };
        case 'lastMonth': {
            const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            const e = new Date(today.getFullYear(), today.getMonth(), 0);
            return { start: fmt(s), end: fmt(e) };
        }
        case 'quarter': {
            const d = new Date(today); d.setMonth(today.getMonth() - 3);
            return { start: fmt(d), end: todayStr };
        }
        case 'year': {
            const d = new Date(today); d.setFullYear(today.getFullYear() - 1);
            return { start: fmt(d), end: todayStr };
        }
        case 'all':
            return { start: '2020-01-01', end: todayStr };
    }
}

const INVESTOR_PALETTE = ['#6366F1', '#8B5CF6', '#EC4899', '#F59E0B', '#06B6D4', '#84CC16', '#EF4444'];

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
    icon: string;
    label: string;
    value: string;
    badge: string;
    color: KpiColor;
    subtext?: string;
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
    label: string;
    realized: number;
    expected: number;
    color: 'emerald' | 'indigo';
    showCents?: boolean;
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

const Reports: React.FC<ReportsProps> = ({ investors, filters, onFiltersChange, data, appSettings }) => {

    const handlePeriodInput = (field: 'start' | 'end', value: string) => {
        onFiltersChange(prev => ({ ...prev, period: { ...prev.period, [field]: value } }));
    };

    const applyPreset = (preset: PeriodPreset) => {
        onFiltersChange(prev => ({ ...prev, period: getPeriodDates(preset) }));
    };

    const totalExpected = data.expectedManagerProfit + data.expectedInvestorProfit;
    const totalRealized = data.realizedManagerProfit + data.realizedInvestorProfit;
    const efficiency = totalExpected > 0 ? Math.round((totalRealized / totalExpected) * 100) : 0;
    const managerSharePct = totalRealized > 0 ? Math.round((data.realizedManagerProfit / totalRealized) * 100) : 0;
    const investorSharePct = totalRealized > 0 ? Math.round((data.realizedInvestorProfit / totalRealized) * 100) : 0;
    const hasData = data.customerPaymentsInPeriod > 0 || totalExpected > 0 || totalRealized > 0;
    const showInvestorBreakdown = filters.investorId === 'ALL' && investors.length > 1;

    const pieData = [
        { name: 'Моя прибыль', value: data.realizedManagerProfit, color: '#10B981' },
        { name: 'Прибыль инвесторов', value: data.realizedInvestorProfit, color: '#6366F1' },
    ].filter(d => d.value > 0);

    const barData = [
        { name: 'Менеджер', Ожидается: data.expectedManagerProfit, Получено: data.realizedManagerProfit },
        { name: 'Инвесторы', Ожидается: data.expectedInvestorProfit, Получено: data.realizedInvestorProfit },
    ];

    const totalInvestment = investors.reduce((s, inv) => s + inv.initialAmount, 0);
    const investorBreakdown = useMemo(() => {
        if (totalInvestment === 0 || investors.length === 0) return [];
        return investors.map((inv, idx) => {
            const share = inv.initialAmount / totalInvestment;
            return {
                inv,
                share: Math.round(share * 100),
                expectedProfit: share * data.expectedInvestorProfit,
                realizedProfit: share * data.realizedInvestorProfit,
                color: INVESTOR_PALETTE[idx % INVESTOR_PALETTE.length],
            };
        });
    }, [investors, totalInvestment, data.expectedInvestorProfit, data.realizedInvestorProfit]);

    const efficiencyColor: KpiColor = efficiency >= 80 ? 'emerald' : efficiency >= 50 ? 'amber' : 'red';
    const efficiencyLabel = efficiency >= 80 ? 'Отлично' : efficiency >= 50 ? 'Норма' : 'Низкая';

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
                    {hasData && (
                        <div className={`px-4 py-2 rounded-xl text-sm font-semibold ${efficiencyColor === 'emerald' ? 'bg-emerald-100 text-emerald-700' : efficiencyColor === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                            Эффективность {efficiency}%
                        </div>
                    )}
                </header>

                {/* Filters */}
                <div className="bg-white/80 backdrop-blur-sm p-5 rounded-2xl shadow-lg border border-white/20 hover:shadow-xl transition-all duration-300 space-y-4">
                    <div className="flex items-center gap-2">
                        <span className="w-1 h-5 bg-indigo-500 rounded-full"></span>
                        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Фильтры</h3>
                    </div>

                    {/* Period presets */}
                    <div className="flex flex-wrap gap-2">
                        {(Object.keys(PRESET_LABELS) as PeriodPreset[]).map(preset => {
                            const dates = getPeriodDates(preset);
                            const isActive = filters.period.start === dates.start && filters.period.end === dates.end;
                            return (
                                <button
                                    key={preset}
                                    onClick={() => applyPreset(preset)}
                                    className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 ${
                                        isActive
                                            ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-200 scale-105'
                                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:scale-105'
                                    }`}
                                >
                                    {PRESET_LABELS[preset]}
                                </button>
                            );
                        })}
                    </div>

                    {/* Investor + custom dates */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full"></span>
                                Инвестор
                            </label>
                            <div className="relative">
                                <select
                                    className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none text-sm appearance-none cursor-pointer hover:border-indigo-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all"
                                    value={filters.investorId}
                                    onChange={e => onFiltersChange(prev => ({ ...prev, investorId: e.target.value }))}
                                >
                                    <option value="ALL">Все инвесторы</option>
                                    {investors.map(inv => (
                                        <option key={inv.id} value={inv.id}>{inv.name}</option>
                                    ))}
                                </select>
                                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none text-xs">▼</div>
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></span>
                                Начало периода
                            </label>
                            <input
                                type="date"
                                className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none text-sm hover:border-indigo-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all"
                                value={filters.period.start}
                                onChange={e => handlePeriodInput('start', e.target.value)}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                <span className="w-1.5 h-1.5 bg-amber-400 rounded-full"></span>
                                Конец периода
                            </label>
                            <input
                                type="date"
                                className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none text-sm hover:border-indigo-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all"
                                value={filters.period.end}
                                onChange={e => handlePeriodInput('end', e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                {!hasData ? (
                    <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-dashed border-slate-200 p-16 text-center">
                        <div className="text-7xl mb-4 opacity-30">📊</div>
                        <h3 className="text-xl font-bold text-slate-700 mb-2">Нет данных за выбранный период</h3>
                        <p className="text-slate-400 max-w-md mx-auto">Выберите другой период или инвестора для просмотра аналитики</p>
                        <button
                            onClick={() => applyPreset('month')}
                            className="mt-6 px-6 py-3 bg-gradient-to-r from-indigo-600 to-indigo-500 text-white rounded-xl font-semibold shadow-lg shadow-indigo-200 hover:shadow-xl hover:-translate-y-0.5 transition-all"
                        >
                            Показать текущий месяц
                        </button>
                    </div>
                ) : (
                    <>
                        {/* KPI Cards */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                            <KpiCard
                                icon="💰"
                                label="Поступления"
                                value={`${formatCurrency(data.customerPaymentsInPeriod, appSettings.showCents)} ₽`}
                                badge="Получено"
                                color="emerald"
                            />
                            <KpiCard
                                icon="✅"
                                label="Реализованная прибыль"
                                value={`${formatCurrency(totalRealized, appSettings.showCents)} ₽`}
                                badge="Факт"
                                color="teal"
                            />
                            <KpiCard
                                icon="👤"
                                label="Моя прибыль"
                                value={`${formatCurrency(data.realizedManagerProfit, appSettings.showCents)} ₽`}
                                badge={`${managerSharePct}%`}
                                color="sky"
                                subtext="от общей прибыли"
                            />
                            <KpiCard
                                icon="👥"
                                label="Прибыль инвесторов"
                                value={`${formatCurrency(data.realizedInvestorProfit, appSettings.showCents)} ₽`}
                                badge={`${investorSharePct}%`}
                                color="indigo"
                                subtext="от общей прибыли"
                            />
                            <KpiCard
                                icon={efficiency >= 80 ? '🎯' : efficiency >= 50 ? '📊' : '⚠️'}
                                label="Эффективность"
                                value={`${efficiency}%`}
                                badge={efficiencyLabel}
                                color={efficiencyColor}
                                subtext="план / факт"
                            />
                        </div>

                        {/* Main charts */}
                        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                            {/* Bar chart + progress bars */}
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
                                    <ProgressRow
                                        label="Менеджер — план/факт"
                                        realized={data.realizedManagerProfit}
                                        expected={data.expectedManagerProfit}
                                        color="emerald"
                                        showCents={appSettings.showCents}
                                    />
                                    <ProgressRow
                                        label="Инвесторы — план/факт"
                                        realized={data.realizedInvestorProfit}
                                        expected={data.expectedInvestorProfit}
                                        color="indigo"
                                        showCents={appSettings.showCents}
                                    />
                                </div>
                            </div>

                            {/* Pie chart */}
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
                                                    <Pie
                                                        data={pieData}
                                                        dataKey="value"
                                                        nameKey="name"
                                                        cx="50%"
                                                        cy="50%"
                                                        innerRadius={52}
                                                        outerRadius={86}
                                                        paddingAngle={4}
                                                        animationDuration={800}
                                                        animationEasing="ease-out"
                                                    >
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
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div className="bg-gradient-to-br from-slate-50 to-white p-4 rounded-xl border border-slate-100">
                                    <p className="text-xs font-medium text-slate-500 mb-1">Итого ожидается</p>
                                    <p className="text-2xl font-bold text-slate-700">{formatCurrency(totalExpected, appSettings.showCents)} ₽</p>
                                    <p className="text-xs text-slate-400 mt-1">из всех активных контрактов</p>
                                </div>
                                <div className="bg-gradient-to-br from-sky-50 to-white p-4 rounded-xl border border-sky-100">
                                    <p className="text-xs font-medium text-sky-600 mb-1">Прогноз менеджера</p>
                                    <p className="text-2xl font-bold text-sky-700">{formatCurrency(data.expectedManagerProfit, appSettings.showCents)} ₽</p>
                                    <p className="text-xs text-sky-500 mt-1">
                                        {totalExpected > 0 ? Math.round((data.expectedManagerProfit / totalExpected) * 100) : 0}% от общей суммы
                                    </p>
                                </div>
                                <div className="bg-gradient-to-br from-indigo-50 to-white p-4 rounded-xl border border-indigo-100">
                                    <p className="text-xs font-medium text-indigo-600 mb-1">Прогноз инвесторов</p>
                                    <p className="text-2xl font-bold text-indigo-700">{formatCurrency(data.expectedInvestorProfit, appSettings.showCents)} ₽</p>
                                    <p className="text-xs text-indigo-500 mt-1">
                                        {totalExpected > 0 ? Math.round((data.expectedInvestorProfit / totalExpected) * 100) : 0}% от общей суммы
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Per-investor breakdown */}
                        {showInvestorBreakdown && investorBreakdown.length > 0 && (
                            <div className="bg-white/90 backdrop-blur-sm p-6 rounded-2xl shadow-lg border border-slate-100">
                                <div className="flex items-center gap-2 mb-5">
                                    <span className="w-1 h-5 bg-purple-500 rounded-full"></span>
                                    <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Разбивка по инвесторам</h4>
                                    <span className="ml-auto text-xs text-slate-400 font-normal hidden sm:block">Расчёт пропорционален капиталу</span>
                                </div>
                                <div className="overflow-x-auto -mx-1">
                                    <table className="w-full text-sm min-w-[560px]">
                                        <thead>
                                            <tr>
                                                <th className="pb-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider pl-1">Инвестор</th>
                                                <th className="pb-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Капитал</th>
                                                <th className="pb-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Доля</th>
                                                <th className="pb-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Ожидается</th>
                                                <th className="pb-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Получено</th>
                                                <th className="pb-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider pr-1">% плана</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {investorBreakdown.map(({ inv, share, expectedProfit, realizedProfit, color }) => {
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
                                                                    <p className="text-xs text-slate-400">{inv.profitPercentage}% годовых</p>
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
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
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