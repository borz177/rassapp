
import React, { useState, useMemo, useEffect } from 'react';
import { ICONS } from '../constants';
import { AppSettings, TermRate } from '../types';

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
  const publicRate = parseFloat(searchParams.get('rate') || '30');

  // Parse Rules from URL for public view
  const publicRulesParam = searchParams.get('rules');
  let publicRules: TermRate[] = [];
  try {
      if (publicRulesParam) {
          publicRules = JSON.parse(decodeURIComponent(publicRulesParam));
      }
  } catch (e) {
      console.error("Failed to parse rules from URL", e);
  }

  // State
  const [price, setPrice] = useState<string>('');
  const [months, setMonths] = useState<number>(3);
  const [downPayment, setDownPayment] = useState<string>('');

  // Admin Settings State
  const [defaultRate, setDefaultRate] = useState<string>(appSettings?.calculator?.defaultInterestRate?.toString() || '30');
  const [termRates, setTermRates] = useState<TermRate[]>(appSettings?.calculator?.termRates || []);
  const [showSettings, setShowSettings] = useState(false);

  // New Rule State
  const [newRuleMonth, setNewRuleMonth] = useState<number>(3);
  const [newRuleRate, setNewRuleRate] = useState<string>('');

  // Determine Active Rate
  const activeRate = useMemo(() => {
      const ratesToUse = isPublic ? publicRules : termRates;
      const baseRate = isPublic ? publicRate : parseFloat(defaultRate);

      const specificRule = ratesToUse.find(r => r.months === months);
      return specificRule ? specificRule.rate : baseRate;
  }, [months, termRates, defaultRate, isPublic, publicRate, publicRules]);

  // Calculation
  const result = useMemo(() => {
      const p = parseFloat(price) || 0;
      const dp = parseFloat(downPayment) || 0;

      const priceWithMarkup = p + (p * (activeRate / 100));
      const remaining = priceWithMarkup - dp;
      const monthly = months > 0 ? remaining / months : 0;
      const roundedMonthly = Math.ceil(monthly / 100) * 100; // Smart round up

      return {
          total: priceWithMarkup,
          monthly: roundedMonthly,
          totalPayable: (roundedMonthly * months) + dp
      };
  }, [price, months, downPayment, activeRate]);

  const handleCopyLink = () => {
      const rulesString = encodeURIComponent(JSON.stringify(termRates));
      const url = `${window.location.origin}${window.location.pathname}?view=public_calc&company=${encodeURIComponent(appSettings?.companyName || 'Company')}&rate=${defaultRate}&rules=${rulesString}`;

      if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(() => {
              alert("Ссылка скопирована! Все текущие настройки ставок включены.");
          });
      } else {
          // Fallback
          const textArea = document.createElement("textarea");
          textArea.value = url;
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          try {
              document.execCommand('copy');
              alert("Ссылка скопирована!");
          } catch (err) {
              alert("Не удалось скопировать ссылку автоматически.");
          }
          document.body.removeChild(textArea);
      }
  };

  const handleSaveConfig = () => {
      if (onSaveSettings) {
          onSaveSettings({
              ...appSettings,
              calculator: {
                  defaultInterestRate: parseFloat(defaultRate),
                  maxMonths: 12,
                  termRates: termRates
              }
          });
          setShowSettings(false);
          alert("Настройки калькулятора сохранены");
      }
  };

  const addRule = () => {
      if (!newRuleRate) return;
      const rate = parseFloat(newRuleRate);
      if (isNaN(rate)) return;

      setTermRates(prev => {
          // Remove existing rule for this month if exists, then add new
          const filtered = prev.filter(r => r.months !== newRuleMonth);
          return [...filtered, { months: newRuleMonth, rate }].sort((a,b) => a.months - b.months);
      });
      setNewRuleRate('');
  };

  const removeRule = (month: number) => {
      setTermRates(prev => prev.filter(r => r.months !== month));
  };

  const availableTerms = [3, 4, 5, 6, 9, 12, 18, 24];

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
                                {availableTerms.map(m => (
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
                            <span className="text-slate-400">
                                Наценка ({activeRate}%)
                            </span>
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
                    <div className="bg-indigo-50 p-5 rounded-2xl border border-indigo-100 animate-fade-in">
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="font-bold text-indigo-900">Настройки ставок</h3>
                            <button onClick={() => setShowSettings(!showSettings)} className="text-xs text-indigo-600 underline font-bold">
                                {showSettings ? 'Свернуть' : 'Развернуть'}
                            </button>
                        </div>

                        {showSettings ? (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-indigo-400 uppercase mb-1">Базовая ставка (%)</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="number"
                                            className="flex-1 p-3 border border-indigo-200 rounded-xl outline-none"
                                            value={defaultRate}
                                            onChange={e => setDefaultRate(e.target.value)}
                                            placeholder="30"
                                        />
                                    </div>
                                    <p className="text-[10px] text-slate-500 mt-1">Применяется, если для срока нет отдельного правила.</p>
                                </div>

                                <div className="bg-white p-3 rounded-xl border border-indigo-100">
                                    <label className="block text-xs font-bold text-indigo-400 uppercase mb-2">Специальные ставки по срокам</label>

                                    {/* List of existing rules */}
                                    <div className="space-y-2 mb-3">
                                        {termRates.map(rule => (
                                            <div key={rule.months} className="flex justify-between items-center bg-indigo-50 p-2 rounded-lg text-sm">
                                                <span className="font-bold text-indigo-900">{rule.months} мес.</span>
                                                <div className="flex items-center gap-3">
                                                    <span className="font-bold text-indigo-600">{rule.rate}%</span>
                                                    <button onClick={() => removeRule(rule.months)} className="text-red-400 hover:text-red-600">
                                                        {ICONS.Close}
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                        {termRates.length === 0 && <p className="text-center text-xs text-slate-400 py-2">Нет специальных правил</p>}
                                    </div>

                                    {/* Add new rule */}
                                    <div className="flex gap-2 items-end">
                                        <div className="flex-1">
                                            <label className="text-[10px] text-slate-400 block mb-1">Срок</label>
                                            <select
                                                className="w-full p-2 border border-slate-200 rounded-lg text-sm bg-slate-50 outline-none"
                                                value={newRuleMonth}
                                                onChange={e => setNewRuleMonth(parseInt(e.target.value))}
                                            >
                                                {availableTerms.map(m => <option key={m} value={m}>{m} мес</option>)}
                                            </select>
                                        </div>
                                        <div className="w-20">
                                            <label className="text-[10px] text-slate-400 block mb-1">Ставка %</label>
                                            <input
                                                type="number"
                                                className="w-full p-2 border border-slate-200 rounded-lg text-sm outline-none"
                                                value={newRuleRate}
                                                onChange={e => setNewRuleRate(e.target.value)}
                                                placeholder="%"
                                            />
                                        </div>
                                        <button onClick={addRule} className="p-2 bg-indigo-600 text-white rounded-lg h-[38px] w-[38px] flex items-center justify-center">
                                            {ICONS.AddSmall}
                                        </button>
                                    </div>
                                </div>

                                <button onClick={handleSaveConfig} className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-200">
                                    Сохранить настройки
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <button
                                    onClick={handleCopyLink}
                                    className="w-full py-3 bg-white border-2 border-indigo-200 text-indigo-700 font-bold rounded-xl hover:bg-indigo-100 flex items-center justify-center gap-2 transition-colors"
                                >
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                                    Копировать публичную ссылку
                                </button>
                                <p className="text-center text-xs text-indigo-400">
                                    Ссылка включает все настроенные вами ставки.
                                </p>
                            </div>
                        )}
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
