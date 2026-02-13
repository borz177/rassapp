import React from 'react';
import { Investor } from '../types';
import { ICONS } from '../constants';
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
}

const COLORS = ['#10B981', '#6366F1'];

const Reports: React.FC<ReportsProps> = ({ investors, filters, onFiltersChange, data }) => {

    const handleFilterChange = (key: 'investorId' | 'period', value: any) => {
        onFiltersChange(prev => ({...prev, [key]: value}));
    }

    const profitChartData = [
        { name: 'Моя прибыль', value: data.realizedManagerProfit },
        { name: 'Прибыль инвестора', value: data.realizedInvestorProfit }
    ];

    return (
        <div className="space-y-6 animate-fade-in pb-20">
            <header>
                <h2 className="text-2xl font-bold text-slate-800">Отчеты</h2>
                <p className="text-slate-500 text-sm">Финансовая аналитика</p>
            </header>

            {/* Filters */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                    <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Инвестор</label>
                    <select 
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm"
                        value={filters.investorId}
                        onChange={e => handleFilterChange('investorId', e.target.value)}
                    >
                        <option value="ALL">Все инвесторы</option>
                        {investors.map(inv => (
                            <option key={inv.id} value={inv.id}>{inv.name}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Начало периода</label>
                    <input 
                        type="date"
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm"
                        value={filters.period.start}
                        onChange={e => handleFilterChange('period', {...filters.period, start: e.target.value})}
                    />
                </div>
                <div>
                    <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Конец периода</label>
                    <input 
                        type="date"
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm"
                        value={filters.period.end}
                        onChange={e => handleFilterChange('period', {...filters.period, end: e.target.value})}
                    />
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">{ICONS.Income}</div>
                        <h3 className="font-semibold text-slate-700">Поступления</h3>
                    </div>
                    <p className="text-2xl font-bold text-emerald-700">{data.customerPaymentsInPeriod.toLocaleString(undefined, {maximumFractionDigits: 0})} ₽</p>
                    <p className="text-xs text-slate-400 mt-1">Оплачено клиентами за период</p>
                </div>
                 <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">{ICONS.Dashboard}</div>
                        <h3 className="font-semibold text-slate-700">Ожидаемая прибыль</h3>
                    </div>
                    <p className="text-2xl font-bold text-indigo-700">{(data.expectedManagerProfit + data.expectedInvestorProfit).toLocaleString(undefined, {maximumFractionDigits: 0})} ₽</p>
                    <p className="text-xs text-slate-400 mt-1">С активных договоров</p>
                </div>
                 <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-sky-100 text-sky-600 rounded-lg">{ICONS.Users}</div>
                        <h3 className="font-semibold text-slate-700">Моя доля (ожид.)</h3>
                    </div>
                    <p className="text-2xl font-bold text-sky-700">{data.expectedManagerProfit.toLocaleString(undefined, {maximumFractionDigits: 0})} ₽</p>
                    <p className="text-xs text-slate-400 mt-1">С активных договоров</p>
                </div>
                 <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-purple-100 text-purple-600 rounded-lg">{ICONS.Users}</div>
                        <h3 className="font-semibold text-slate-700">Доля инвесторов (ожид.)</h3>
                    </div>
                    <p className="text-2xl font-bold text-purple-700">{data.expectedInvestorProfit.toLocaleString(undefined, {maximumFractionDigits: 0})} ₽</p>
                    <p className="text-xs text-slate-400 mt-1">С активных договоров</p>
                </div>
            </div>

            {/* Realized Profit Section */}
            <div>
                <h3 className="text-lg font-bold text-slate-800 mb-4 mt-6">Полученная прибыль за период</h3>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 bg-white p-5 rounded-xl shadow-sm border border-slate-100 flex flex-col justify-center">
                        <div className="space-y-4">
                            <div>
                                <p className="text-sm text-slate-500">Прибыль инвестора</p>
                                <p className="text-3xl font-bold text-indigo-600">{data.realizedInvestorProfit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</p>
                            </div>
                             <div>
                                <p className="text-sm text-slate-500">Моя прибыль</p>
                                <p className="text-3xl font-bold text-emerald-600">{data.realizedManagerProfit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</p>
                            </div>
                        </div>
                    </div>
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 h-64">
                         <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie data={profitChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={60} fill="#8884d8" paddingAngle={5}>
                                    {profitChartData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                                </Pie>
                                <Tooltip formatter={(value: number) => `${value.toFixed(2)} ₽`} />
                                <Legend verticalAlign="bottom" height={36}/>
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Reports;