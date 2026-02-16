
import React, { useState, useEffect, useMemo } from 'react';
import { ICONS } from '../constants';
import { AppSettings } from '../types';

interface CalculatorProps {
  isPublic?: boolean;
  appSettings?: AppSettings;
  onBack?: () => void;
  onSaveSettings?: (settings: any) => void;
}

const Calculator: React.FC<CalculatorProps> = ({ isPublic = false, appSettings, onBack, onSaveSettings }) => {
  // Public URL Params parsing
  const searchParams = new URLSearchParams(window.location.search);
  const publicCompany = searchParams.get('company') || appSettings?.companyName || 'Наша Компания';
  const publicRate = parseFloat(searchParams.get('rate') || '30'); // Default 30% if not provided

  // State
  const [price, setPrice] = useState<string>('');
  const [months, setMonths] = useState<number>(3);
  const [downPayment, setDownPayment] = useState<string>('');

  // Admin Settings State (Only for internal view)
  const [defaultRate, setDefaultRate] = useState<string>(appSettings?.calculator?.defaultInterestRate?.toString() || '30');
  const [showSettings, setShowSettings] = useState(false);

  // Calculation
  const result = useMemo(() => {
      const p = parseFloat(price) || 0;
      const dp = parseFloat(downPayment) || 0;
      const rate = isPublic ? publicRate : parseFloat(defaultRate);

      const priceWithMarkup = p + (p * (rate / 100));
      const remaining = priceWithMarkup - dp;
      const monthly = months > 0 ? remaining / months : 0;
      const roundedMonthly = Math.ceil(monthly / 100) * 100; // Smart round up

      return {
          total: priceWithMarkup,
          monthly: roundedMonthly,
          totalPayable: (roundedMonthly * months) + dp
      };
  }, [price, months, downPayment, defaultRate, isPublic, publicRate]);

  const handleCopyLink = () => {
      const url = `${window.location.origin}${window.location.pathname}?view=public_calc&company=${encodeURIComponent(appSettings?.companyName || 'Company')}&rate=${defaultRate}`;
      navigator.clipboard.writeText(url);
      alert("Ссылка скопирована! Отправьте её клиенту.");
  };

  const handleSaveConfig = () => {
      if (onSaveSettings) {
          onSaveSettings({
              ...appSettings,
              calculator: {
                  defaultInterestRate: parseFloat(defaultRate),
                  maxMonths: 12
              }
          });
          setShowSettings(false);
      }
  };

  return (
    <div className={`min-h-screen ${isPublic ? 'bg-slate-50 flex items-center justify-center p-4' : 'animate-fade-in pb-20'}`}>

        <div className={`bg-white w-full ${isPublic ? 'max-w-md rounded-3xl shadow-xl' : 'rounded-none bg-transparent'}`}>

            {/* Header */}
            <div className={`p-6 ${isPublic ? 'bg-indigo-600 rounded-t-3xl text-white' : ''}`}>
                <div className="flex items-center gap-3 mb-2">
                    {!isPublic && onBack && (
                        <button onClick={onBack} className="text-slate-500 hover:text-slate-800">
                            {ICONS.Back}
                        </button>
                    )}
                    <div>
                        <h2 className={`text-2xl font-bold ${isPublic ? 'text-white' : 'text-slate-800'}`}>
                            {isPublic ? 'Калькулятор рассрочки' : 'Калькулятор'}
                        </h2>
                        {isPublic && <p className="text-indigo-200 text-sm">{publicCompany}</p>}
                        {!isPublic && <p className="text-slate-500 text-sm">Расчет условий и ссылка для клиента</p>}
                    </div>
                </div>
            </div>

            <div className={`space-y-6 ${isPublic ? 'p-6' : ''}`}>

                {/* Inputs */}
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 space-y-4">
                    <div>
                        <label className="block text-sm font-bold text-slate-500 mb-1">Стоимость товара</label>
                        <div className="relative">
                            <input
                                type="number"
                                className="w-full p-4 pl-4 pr-12 text-xl font-bold border border-slate-200 rounded-xl outline-none focus:border-indigo-500"
                                placeholder="0"
                                value={price}
                                onChange={e => setPrice(e.target.value)}
                            />
                            <span className="absolute right-4 top-4 text-slate-400">₽</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-slate-500 mb-1">Срок (мес)</label>
                            <select
                                className="w-full p-4 border border-slate-200 rounded-xl outline-none bg-white font-medium"
                                value={months}
                                onChange={e => setMonths(parseInt(e.target.value))}
                            >
                                {[3, 4, 5, 6, 9, 12].map(m => (
                                    <option key={m} value={m}>{m} мес.</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-slate-500 mb-1">Взнос</label>
                            <input
                                type="number"
                                className="w-full p-4 border border-slate-200 rounded-xl outline-none"
                                placeholder="0"
                                value={downPayment}
                                onChange={e => setDownPayment(e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                {/* Results */}
                <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 text-white shadow-lg">
                    <div className="flex justify-between items-end mb-4">
                        <span className="text-slate-400 text-sm">Ежемесячный платеж</span>
                        <span className="text-3xl font-bold text-emerald-400">{result.monthly.toLocaleString()} ₽</span>
                    </div>
                    <div className="border-t border-slate-700 pt-4 space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="text-slate-400">Сумма товаров</span>
                            <span>{parseFloat(price || '0').toLocaleString()} ₽</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-slate-400">Переплата (Наценка)</span>
                            <span className="text-amber-400">+{(result.total - parseFloat(price || '0')).toLocaleString()} ₽</span>
                        </div>
                        <div className="flex justify-between font-bold pt-2">
                            <span className="text-slate-200">Итого к выплате</span>
                            <span>{result.totalPayable.toLocaleString()} ₽</span>
                        </div>
                    </div>
                </div>

                {/* Admin Controls (Hidden in Public Mode) */}
                {!isPublic && (
                    <div className="bg-indigo-50 p-5 rounded-2xl border border-indigo-100">
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="font-bold text-indigo-900">Настройки для клиента</h3>
                            <button onClick={() => setShowSettings(!showSettings)} className="text-xs text-indigo-600 underline">
                                {showSettings ? 'Скрыть' : 'Изменить'}
                            </button>
                        </div>

                        {showSettings && (
                            <div className="mb-4">
                                <label className="block text-xs font-bold text-indigo-400 uppercase mb-1">Наценка по умолчанию (%)</label>
                                <div className="flex gap-2">
                                    <input
                                        type="number"
                                        className="flex-1 p-2 border border-indigo-200 rounded-lg outline-none"
                                        value={defaultRate}
                                        onChange={e => setDefaultRate(e.target.value)}
                                    />
                                    <button onClick={handleSaveConfig} className="bg-indigo-600 text-white px-3 rounded-lg text-sm">Сохранить</button>
                                </div>
                            </div>
                        )}

                        <button
                            onClick={handleCopyLink}
                            className="w-full py-3 bg-white border-2 border-indigo-200 text-indigo-700 font-bold rounded-xl hover:bg-indigo-100 flex items-center justify-center gap-2 transition-colors"
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                            Копировать публичную ссылку
                        </button>
                        <p className="text-center text-xs text-indigo-400 mt-2">Клиент сможет рассчитать рассрочку с наценкой {defaultRate}%</p>
                    </div>
                )}

                {isPublic && (
                    <div className="text-center">
                        <button className="w-full py-4 bg-emerald-500 text-white font-bold rounded-xl shadow-lg shadow-emerald-200 mb-2">
                            Связаться с менеджером
                        </button>
                        <p className="text-xs text-slate-400">Расчет является предварительным. {publicCompany}</p>
                    </div>
                )}
            </div>
        </div>
    </div>
  );
};

export default Calculator;
