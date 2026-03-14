import React from 'react';
import { Investor, AppSettings } from '../types';
import { ICONS } from '../constants';
import { formatCurrency } from '../src/utils';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

interface ReportFilters {
    investorId: string;
    period: {
        start: string;
        end: string;
    };
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

const COLORS = ['#10B981', '#6366F1', '#8B5CF6', '#EC4899'];

const Reports: React.FC<ReportsProps> = ({ investors, filters, onFiltersChange, data, appSettings }) => {

    const handleFilterChange = (key: 'investorId' | 'period', value: any) => {
        onFiltersChange(prev => ({...prev, [key]: value}));
    };

    const profitChartData = [
        { name: 'Моя прибыль', value: data.realizedManagerProfit, color: '#10B981' },
        { name: 'Прибыль инвестора', value: data.realizedInvestorProfit, color: '#6366F1' }
    ];

    const expectedProfitData = [
        { name: 'Моя ожидаемая прибыль', value: data.expectedManagerProfit, color: '#10B981' },
        { name: 'Ожидаемая прибыль инвестора', value: data.expectedInvestorProfit, color: '#6366F1' }
    ];

    const hasData = data.customerPaymentsInPeriod > 0 ||
                    data.expectedManagerProfit > 0 ||
                    data.expectedInvestorProfit > 0;

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50/30 pb-24 w-full">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 animate-in fade-in slide-in-from-top-4 duration-500">

                {/* Header with decorative elements */}
                <div className="relative">

                    <header className="relative">
                        <h2 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-indigo-400 bg-clip-text text-transparent">
                            Отчеты
                        </h2>
                        <p className="text-slate-500 text-sm mt-1 flex items-center gap-2">
                            <span className="w-1 h-1 bg-indigo-400 rounded-full"></span>
                            Финансовая аналитика и статистика
                        </p>
                    </header>
                </div>

                {/* Filters Card with glass morphism */}
                <div className="bg-white dark:bg-slate-900/80 backdrop-blur-sm p-6 rounded-2xl shadow-lg border border-white/20 hover:shadow-xl transition-all duration-300">
                    <div className="flex items-center gap-2 mb-4">
                        <span className="w-1 h-6 bg-indigo-500 rounded-full"></span>
                        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Фильтры отчета</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full"></span>
                                Инвестор
                            </label>
                            <div className="relative">
                                <select
                                    className="w-full p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none text-sm appearance-none cursor-pointer hover:border-indigo-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all"
                                    value={filters.investorId}
                                    onChange={e => handleFilterChange('investorId', e.target.value)}
                                >
                                    <option value="ALL">Все инвесторы</option>
                                    {investors.map(inv => (
                                        <option key={inv.id} value={inv.id}>{inv.name}</option>
                                    ))}
                                </select>
                                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                                    ▼
                                </div>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></span>
                                Начало периода
                            </label>
                            <div className="relative">
                                <input
                                    type="date"
                                    className="w-full p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none text-sm hover:border-indigo-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all"
                                    value={filters.period.start}
                                    onChange={e => handleFilterChange('period', {...filters.period, start: e.target.value})}
                                />
                                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                                    📅
                                </div>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                <span className="w-1.5 h-1.5 bg-amber-400 rounded-full"></span>
                                Конец периода
                            </label>
                            <div className="relative">
                                <input
                                    type="date"
                                    className="w-full p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none text-sm hover:border-indigo-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all"
                                    value={filters.period.end}
                                    onChange={e => handleFilterChange('period', {...filters.period, end: e.target.value})}
                                />
                                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                                    📅
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {!hasData ? (
                    // Empty State
                    <div className="bg-white dark:bg-slate-900/80 backdrop-blur-sm rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 p-16 text-center animate-in fade-in">
                        <div className="text-7xl mb-4 opacity-30">📊</div>
                        <h3 className="text-xl font-bold text-slate-700 mb-2">Нет данных для отображения</h3>
                        <p className="text-slate-400 max-w-md mx-auto">
                            Выберите период и инвестора для просмотра финансовой аналитики
                        </p>
                        <button
                            onClick={() => {
                                const today = new Date();
                                const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
                                onFiltersChange({
                                    investorId: 'ALL',
                                    period: {
                                        start: firstDay.toISOString().split('T')[0],
                                        end: today.toISOString().split('T')[0]
                                    }
                                });
                            }}
                            className="mt-6 px-6 py-3 bg-gradient-to-r from-indigo-600 to-indigo-500 text-white rounded-xl font-semibold shadow-lg shadow-indigo-200 hover:shadow-xl hover:-translate-y-0.5 transition-all"
                        >
                            Показать текущий месяц
                        </button>
                    </div>
                ) : (
                    <>
                        {/* KPI Cards with hover effects */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                            {/* Поступления */}
                            <div className="group bg-white dark:bg-slate-900/90 backdrop-blur-sm p-6 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-emerald-200 hover:-translate-y-1">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="p-3 bg-gradient-to-br from-emerald-500 to-emerald-400 text-white rounded-xl shadow-lg shadow-emerald-200 group-hover:scale-110 transition-transform">
                                        💰
                                    </div>
                                    <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">За период</span>
                                </div>
                                <h3 className="text-sm font-medium text-slate-500 mb-1">Поступления</h3>
                                <p className="text-2xl font-bold text-emerald-700">{formatCurrency(data.customerPaymentsInPeriod, appSettings.showCents)} ₽</p>
                                <div className="mt-3 h-1.5 w-full bg-emerald-100 rounded-full overflow-hidden">
                                    <div className="h-full w-3/4 bg-emerald-500 rounded-full group-hover:w-full transition-all duration-500"></div>
                                </div>
                            </div>

                            {/* Ожидаемая прибыль */}
                            <div className="group bg-white dark:bg-slate-900/90 backdrop-blur-sm p-6 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-indigo-200 hover:-translate-y-1">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="p-3 bg-gradient-to-br from-indigo-500 to-indigo-400 text-white rounded-xl shadow-lg shadow-indigo-200 group-hover:scale-110 transition-transform">
                                        📈
                                    </div>
                                    <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full">Прогноз</span>
                                </div>
                                <h3 className="text-sm font-medium text-slate-500 mb-1">Ожидаемая прибыль</h3>
                                <p className="text-2xl font-bold text-indigo-700">{formatCurrency(data.expectedManagerProfit + data.expectedInvestorProfit, appSettings.showCents)} ₽</p>
                                <div className="mt-3 h-1.5 w-full bg-indigo-100 rounded-full overflow-hidden">
                                    <div className="h-full w-2/3 bg-indigo-500 rounded-full group-hover:w-full transition-all duration-500"></div>
                                </div>
                            </div>

                            {/* Моя доля (ожид.) */}
                            <div className="group bg-white dark:bg-slate-900/90 backdrop-blur-sm p-6 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-sky-200 hover:-translate-y-1">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="p-3 bg-gradient-to-br from-sky-500 to-sky-400 text-white rounded-xl shadow-lg shadow-sky-200 group-hover:scale-110 transition-transform">
                                        👤
                                    </div>
                                    <span className="text-xs font-medium text-sky-600 bg-sky-50 px-2 py-1 rounded-full">Ожидание</span>
                                </div>
                                <h3 className="text-sm font-medium text-slate-500 mb-1">Моя доля (ожид.)</h3>
                                <p className="text-2xl font-bold text-sky-700">{formatCurrency(data.expectedManagerProfit, appSettings.showCents)} ₽</p>
                                <div className="mt-3 flex justify-between text-xs text-slate-400">
                                    <span>0%</span>
                                    <span className="text-sky-600 font-medium">
                                        {data.expectedManagerProfit + data.expectedInvestorProfit > 0
                                            ? Math.round((data.expectedManagerProfit / (data.expectedManagerProfit + data.expectedInvestorProfit)) * 100)
                                            : 0}%
                                    </span>
                                    <span>100%</span>
                                </div>
                            </div>

                            {/* Доля инвесторов (ожид.) */}
                            <div className="group bg-white dark:bg-slate-900/90 backdrop-blur-sm p-6 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-purple-200 hover:-translate-y-1">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="p-3 bg-gradient-to-br from-purple-500 to-purple-400 text-white rounded-xl shadow-lg shadow-purple-200 group-hover:scale-110 transition-transform">
                                        👥
                                    </div>
                                    <span className="text-xs font-medium text-purple-600 bg-purple-50 px-2 py-1 rounded-full">Ожидание</span>
                                </div>
                                <h3 className="text-sm font-medium text-slate-500 mb-1">Доля инвесторов (ожид.)</h3>
                                <p className="text-2xl font-bold text-purple-700">{formatCurrency(data.expectedInvestorProfit, appSettings.showCents)} ₽</p>
                                <div className="mt-3 flex justify-between text-xs text-slate-400">
                                    <span>0%</span>
                                    <span className="text-purple-600 font-medium">
                                        {data.expectedManagerProfit + data.expectedInvestorProfit > 0
                                            ? Math.round((data.expectedInvestorProfit / (data.expectedManagerProfit + data.expectedInvestorProfit)) * 100)
                                            : 0}%
                                    </span>
                                    <span>100%</span>
                                </div>
                            </div>
                        </div>

                        {/* Realized Profit Section with enhanced charts */}
                        <div className="mt-8">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-1 h-8 bg-gradient-to-b from-emerald-500 to-indigo-500 rounded-full"></div>
                                <h3 className="text-xl font-bold text-slate-800">Полученная прибыль за период</h3>
                                <span className="px-3 py-1 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-full">Факт</span>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                {/* Profit Numbers */}
                                <div className="lg:col-span-1 space-y-4">
                                    {/* Инвестор прибыль */}
                                    <div className="bg-gradient-to-br from-indigo-50 to-white p-6 rounded-2xl shadow-sm border border-indigo-100 hover:shadow-lg transition-all group">
                                        <div className="flex items-center gap-4">
                                            <div className="p-4 bg-gradient-to-br from-indigo-500 to-indigo-400 text-white rounded-xl shadow-lg shadow-indigo-200 group-hover:scale-110 transition-transform">
                                                👥
                                            </div>
                                            <div>
                                                <p className="text-sm text-indigo-600 font-medium">Прибыль инвестора</p>
                                                <p className="text-3xl font-bold text-indigo-700">{formatCurrency(data.realizedInvestorProfit, appSettings.showCents)} ₽</p>
                                            </div>
                                        </div>
                                        <div className="mt-4 pt-4 border-t border-indigo-200">
                                            <div className="flex justify-between text-sm">
                                                <span className="text-indigo-600">Доля в общей прибыли</span>
                                                <span className="font-bold text-indigo-700">
                                                    {data.realizedManagerProfit + data.realizedInvestorProfit > 0
                                                        ? Math.round((data.realizedInvestorProfit / (data.realizedManagerProfit + data.realizedInvestorProfit)) * 100)
                                                        : 0}%
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Моя прибыль */}
                                    <div className="bg-gradient-to-br from-emerald-50 to-white p-6 rounded-2xl shadow-sm border border-emerald-100 hover:shadow-lg transition-all group">
                                        <div className="flex items-center gap-4">
                                            <div className="p-4 bg-gradient-to-br from-emerald-500 to-emerald-400 text-white rounded-xl shadow-lg shadow-emerald-200 group-hover:scale-110 transition-transform">
                                                👤
                                            </div>
                                            <div>
                                                <p className="text-sm text-emerald-600 font-medium">Моя прибыль</p>
                                                <p className="text-3xl font-bold text-emerald-700">{formatCurrency(data.realizedManagerProfit, appSettings.showCents)} ₽</p>
                                            </div>
                                        </div>
                                        <div className="mt-4 pt-4 border-t border-emerald-200">
                                            <div className="flex justify-between text-sm">
                                                <span className="text-emerald-600">Доля в общей прибыли</span>
                                                <span className="font-bold text-emerald-700">
                                                    {data.realizedManagerProfit + data.realizedInvestorProfit > 0
                                                        ? Math.round((data.realizedManagerProfit / (data.realizedManagerProfit + data.realizedInvestorProfit)) * 100)
                                                        : 0}%
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Pie Chart */}
                                <div className="lg:col-span-2 bg-white dark:bg-slate-900/90 backdrop-blur-sm p-6 rounded-2xl shadow-lg border border-slate-100">
                                    <h4 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                                        <span className="w-1 h-4 bg-indigo-500 rounded-full"></span>
                                        Распределение полученной прибыли
                                    </h4>
                                    <div className="h-80">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <defs>
                                                    {profitChartData.map((entry, index) => (
                                                        <linearGradient key={`gradient-${index}`} id={`colorGradient-${index}`} x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="0%" stopColor={entry.color} stopOpacity={0.8}/>
                                                            <stop offset="100%" stopColor={entry.color} stopOpacity={0.5}/>
                                                        </linearGradient>
                                                    ))}
                                                </defs>
                                                <Pie
                                                    data={profitChartData}
                                                    dataKey="value"
                                                    nameKey="name"
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={60}
                                                    outerRadius={100}
                                                    paddingAngle={5}
                                                    animationBegin={0}
                                                    animationDuration={1000}
                                                    animationEasing="ease-out"
                                                >
                                                    {profitChartData.map((entry, index) => (
                                                        <Cell
                                                            key={`cell-${index}`}
                                                            fill={`url(#colorGradient-${index})`}
                                                            stroke={entry.color}
                                                            strokeWidth={2}
                                                        />
                                                    ))}
                                                </Pie>
                                                <Tooltip
                                                    formatter={(value: number) => [`${formatCurrency(value, appSettings.showCents)} ₽`, 'Сумма']}
                                                    contentStyle={{
                                                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                                                        borderRadius: '12px',
                                                        border: '1px solid #e2e8f0',
                                                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                                                        padding: '8px 12px'
                                                    }}
                                                />
                                                <Legend
                                                    verticalAlign="bottom"
                                                    height={36}
                                                    wrapperStyle={{
                                                        paddingTop: '20px',
                                                        fontSize: '12px'
                                                    }}
                                                />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>

                                    {/* Expected vs Realized comparison */}
                                    <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="text-center">
                                                <p className="text-xs text-slate-500 mb-1">Ожидалось</p>
                                                <p className="text-lg font-bold text-indigo-600">
                                                    {formatCurrency(data.expectedManagerProfit + data.expectedInvestorProfit, appSettings.showCents)} ₽
                                                </p>
                                            </div>
                                            <div className="text-center">
                                                <p className="text-xs text-slate-500 mb-1">Получено</p>
                                                <p className="text-lg font-bold text-emerald-600">
                                                    {formatCurrency(data.realizedManagerProfit + data.realizedInvestorProfit, appSettings.showCents)} ₽
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Additional Insights */}
                        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Expected Distribution Mini Chart */}
                            <div className="bg-white dark:bg-slate-900/90 backdrop-blur-sm p-5 rounded-2xl shadow-sm border border-slate-100">
                                <h4 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Ожидаемое распределение</h4>
                                <div className="h-32">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={expectedProfitData}
                                                dataKey="value"
                                                nameKey="name"
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={30}
                                                outerRadius={50}
                                                paddingAngle={5}
                                            >
                                                {expectedProfitData.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                                ))}
                                            </Pie>
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* Performance Summary */}
                            <div className="bg-gradient-to-br from-indigo-600 to-indigo-500 p-5 rounded-2xl shadow-lg text-white">
                                <h4 className="text-sm font-bold text-indigo-100 uppercase tracking-wider mb-3">Краткий итог</h4>
                                <div className="space-y-2">
                                    <div className="flex justify-between">
                                        <span>Поступления от клиентов:</span>
                                        <span className="font-bold">{formatCurrency(data.customerPaymentsInPeriod, appSettings.showCents)} ₽</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Реализованная прибыль:</span>
                                        <span className="font-bold">{formatCurrency(data.realizedManagerProfit + data.realizedInvestorProfit, appSettings.showCents)} ₽</span>
                                    </div>
                                    <div className="flex justify-between pt-2 border-t border-indigo-400">
                                        <span>Эффективность:</span>
                                        <span className="font-bold">
                                            {data.expectedManagerProfit + data.expectedInvestorProfit > 0
                                                ? Math.round(((data.realizedManagerProfit + data.realizedInvestorProfit) / (data.expectedManagerProfit + data.expectedInvestorProfit)) * 100)
                                                : 0}%
                                        </span>
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