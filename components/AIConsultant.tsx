import React, { useState } from 'react';
import { Customer, Sale } from '../types';
import { analyzeCustomerRisk } from '../services/geminiService';
import { ICONS } from '../constants';

interface AIConsultantProps {
  customers: Customer[];
  sales: Sale[];
}

const AIConsultant: React.FC<AIConsultantProps> = ({ customers, sales }) => {
  const [selectedCustomer, setSelectedCustomer] = useState<string>('');
  const [analysis, setAnalysis] = useState<{ score: number, reason: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAnalyze = async () => {
    if (!selectedCustomer) return;
    setLoading(true);
    setAnalysis(null);
    
    const customer = customers.find(c => c.id === selectedCustomer);
    if (customer) {
      const history = sales.filter(s => s.customerId === customer.id);
      const result = await analyzeCustomerRisk(customer, history);
      setAnalysis(result);
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <span className="text-purple-600">{ICONS.AI}</span> ИИ Ассистент
        </h2>
        <p className="text-slate-500 dark:text-slate-400 text-sm">Оценка надежности заемщика</p>
      </header>

      <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Выберите клиента</label>
        <select
          className="w-full p-3 bg-slate-50 dark:bg-slate-900 dark:text-white border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-purple-500 mb-4"
          value={selectedCustomer}
          onChange={(e) => setSelectedCustomer(e.target.value)}
        >
          <option value="">-- Список клиентов --</option>
          {customers.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <button
          onClick={handleAnalyze}
          disabled={loading || !selectedCustomer}
          className="w-full py-3 bg-purple-600 text-white rounded-xl font-semibold shadow-lg shadow-purple-200 disabled:opacity-50 hover:bg-purple-700 transition-colors"
        >
          {loading ? 'Анализирую...' : 'Проверить риск'}
        </button>
      </div>

      {analysis && (
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 animate-fade-in">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-800 dark:text-white">Результат</h3>
            <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                analysis.score > 75 ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' :
                analysis.score > 40 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
            }`}>
                Доверие: {analysis.score}%
            </span>
          </div>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-700/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700">
            {analysis.reason}
          </p>
        </div>
      )}
    </div>
  );
};

export default AIConsultant;
