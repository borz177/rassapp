

import React, { useState, useEffect } from 'react';
import { Account, Investor } from '../types';
import { ICONS } from '../constants';

interface NewExpenseProps {
  investors: Investor[];
  accounts: Account[];
  onClose: () => void;
  onSubmit: (data: any) => void;
}

const NewExpense: React.FC<NewExpenseProps> = ({ 
    investors, accounts, onClose, onSubmit 
}) => {
  const [sourceType, setSourceType] = useState<'INVESTOR' | 'OTHER'>('OTHER');
  
  // Form States
  const [selectedInvestorId, setSelectedInvestorId] = useState('');
  const [sourceAccountId, setSourceAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('General');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [payoutType, setPayoutType] = useState<'INVESTMENT' | 'PROFIT' | null>(null);
  const [managerPayoutSource, setManagerPayoutSource] = useState<'CAPITAL' | 'PROFIT' | null>(null);

  const selectedInvestor = investors.find(i => i.id === selectedInvestorId);
  const selectedAccount = accounts.find(a => a.id === sourceAccountId);

  // Auto-fill Account logic when Investor changes
  useEffect(() => {
      if (selectedInvestor) {
          const invAccount = accounts.find(a => a.ownerId === selectedInvestor.id);
          if (invAccount) {
              setSourceAccountId(invAccount.id);
          }
      }
  }, [selectedInvestorId, accounts, investors]);

  // Default account
  useEffect(() => {
      if (accounts.length > 0 && !sourceAccountId) {
          const mainAccount = accounts.find(a => a.type === 'MAIN') || accounts[0];
          setSourceAccountId(mainAccount.id);
      }
  }, [accounts, sourceAccountId]);
  
  // Reset payout type when switching away from investor
  useEffect(() => {
    if (sourceType !== 'INVESTOR') {
        setPayoutType(null);
    }
  }, [sourceType]);

  // Reset manager payout source if category changes
  useEffect(() => {
      if (category !== 'Моя выплата') {
          setManagerPayoutSource(null);
      }
  }, [category]);

  const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      
      const numAmount = Number(amount);
      if (numAmount <= 0) {
          alert("Введите сумму больше нуля");
          return;
      }

      const commonData = { amount: numAmount, date };

      if (sourceType === 'INVESTOR') {
          if (!selectedInvestorId || !sourceAccountId) {
              alert("Ошибка выбора инвестора или счета");
              return;
          }
          if (!payoutType) {
              alert("Выберите, откуда списать средства: из инвестиций или из прибыли.");
              return;
          }
          onSubmit({
              ...commonData,
              type: 'INVESTOR_WITHDRAWAL',
              investorId: selectedInvestorId,
              accountId: sourceAccountId,
              title: payoutType === 'INVESTMENT' ? "Возврат инвестиций" : "Выплата прибыли",
              category: "Investment Return",
              payoutType: payoutType
          });
      } else {
          if (!title && category !== 'Моя выплата' || !sourceAccountId) {
              alert("Заполните название и выберите счет");
              return;
          }
          let expenseData: any = {
              ...commonData,
              type: 'OTHER_EXPENSE',
              accountId: sourceAccountId,
              title: category === 'Моя выплата' ? 'Выплата менеджеру' : title,
              category: category,
          };
          if (category === 'Моя выплата') {
              if (!managerPayoutSource) {
                  alert("Выберите источник списания для выплаты.");
                  return;
              }
              expenseData.managerPayoutSource = managerPayoutSource;
          }
          onSubmit(expenseData);
      }
  };

  const getAccountName = (id: string) => {
      return accounts.find(a => a.id === id)?.name || 'Неизвестный счет';
  }

  return (
    <div className="space-y-4 animate-fade-in pb-20">
      <div className="flex items-center gap-3 border-b border-slate-200 pb-4 bg-white sticky top-0 z-10 pt-2">
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800">
             {ICONS.Back}
          </button>
          <h2 className="text-xl font-bold text-slate-800">Оформление расхода</h2>
      </div>

      {/* Switcher */}
      <div className="flex bg-slate-100 p-1 rounded-xl">
          <button 
             onClick={() => { setSourceType('OTHER'); setAmount(''); }}
             className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${sourceType === 'OTHER' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500'}`}
          >
              Общие расходы
          </button>
          <button 
             onClick={() => { setSourceType('INVESTOR'); setAmount(''); }}
             className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${sourceType === 'INVESTOR' ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-500'}`}
          >
              Выплата инвестору
          </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* INVESTOR FORM */}
          {sourceType === 'INVESTOR' && (
              <div className="space-y-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm animate-fade-in">
                  <div>
                       <label className="block text-sm font-medium text-slate-700 mb-1">Выберите инвестора</label>
                       <select 
                          className="w-full p-3 border border-slate-200 rounded-xl bg-white outline-none text-slate-900"
                          value={selectedInvestorId}
                          onChange={e => setSelectedInvestorId(e.target.value)}
                       >
                           <option value="">-- Список инвесторов --</option>
                           {investors.map(inv => <option key={inv.id} value={inv.id}>{inv.name}</option>)}
                       </select>
                   </div>
                   
                   <div>
                       <label className="block text-sm font-medium text-slate-700 mb-1">Списать со счета</label>
                       <select 
                          className="w-full p-3 border border-slate-200 rounded-xl bg-white outline-none text-slate-900"
                          value={sourceAccountId}
                          onChange={e => setSourceAccountId(e.target.value)}
                       >
                           {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                       </select>
                   </div>
                   <div className="pt-2">
                        <label className="block text-sm font-medium text-slate-700 mb-2">Источник списания</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button type="button" onClick={() => setPayoutType('INVESTMENT')} className={`p-4 rounded-xl border-2 text-center ${payoutType === 'INVESTMENT' ? 'border-purple-600 bg-purple-50' : 'border-slate-200 bg-white'}`}>
                                <span className="font-bold text-sm text-purple-800">Из Инвестиций</span>
                                <span className="text-xs text-slate-500 block">Уменьшить тело вклада</span>
                            </button>
                            <button type="button" onClick={() => setPayoutType('PROFIT')} className={`p-4 rounded-xl border-2 text-center ${payoutType === 'PROFIT' ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
                                <span className="font-bold text-sm text-emerald-800">Из Прибыли</span>
                                <span className="text-xs text-slate-500 block">Выплатить доход</span>
                            </button>
                        </div>
                   </div>
              </div>
          )}

          {/* OTHER FORM */}
          {sourceType === 'OTHER' && (
              <div className="space-y-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm animate-fade-in">
                  {category !== 'Моя выплата' && (
                      <div>
                           <label className="block text-sm font-medium text-slate-700 mb-1">Название / Назначение</label>
                           <input 
                              placeholder="Например: Аренда офиса"
                              className="w-full p-3 border border-slate-200 rounded-xl outline-none bg-white text-slate-900"
                              value={title}
                              onChange={e => setTitle(e.target.value)}
                           />
                       </div>
                  )}
                   
                   <div>
                       <label className="block text-sm font-medium text-slate-700 mb-1">Категория</label>
                       <select 
                          className="w-full p-3 border border-slate-200 rounded-xl bg-white outline-none text-slate-900"
                          value={category}
                          onChange={e => setCategory(e.target.value)}
                       >
                           <option value="General">Общее</option>
                           <option value="Моя выплата">Моя выплата</option>
                           <option value="Rent">Аренда</option>
                           <option value="Salary">Зарплата</option>
                           <option value="Marketing">Маркетинг</option>
                           <option value="Taxes">Налоги</option>
                           <option value="Equipment">Оборудование</option>
                       </select>
                   </div>

                   <div>
                       <label className="block text-sm font-medium text-slate-700 mb-1">Списать со счета</label>
                       <select 
                          className="w-full p-3 border border-slate-200 rounded-xl bg-white outline-none text-slate-900"
                          value={sourceAccountId}
                          onChange={e => setSourceAccountId(e.target.value)}
                       >
                           {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                       </select>
                   </div>
                   
                   {category === 'Моя выплата' && (
                       <div className="pt-2">
                            <label className="block text-sm font-medium text-slate-700 mb-2">Источник списания</label>
                            <div className={`grid ${selectedAccount?.ownerId ? 'grid-cols-1' : 'grid-cols-2'} gap-2`}>
                                {!selectedAccount?.ownerId && (
                                    <button type="button" onClick={() => setManagerPayoutSource('CAPITAL')} className={`p-4 rounded-xl border-2 text-center ${managerPayoutSource === 'CAPITAL' ? 'border-purple-600 bg-purple-50' : 'border-slate-200 bg-white'}`}>
                                        <span className="font-bold text-sm text-purple-800">Из Капитала</span>
                                        <span className="text-xs text-slate-500 block">Личные средства</span>
                                    </button>
                                )}
                                <button type="button" onClick={() => setManagerPayoutSource('PROFIT')} className={`p-4 rounded-xl border-2 text-center ${managerPayoutSource === 'PROFIT' ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
                                    <span className="font-bold text-sm text-emerald-800">Из Прибыли</span>
                                    <span className="text-xs text-slate-500 block">Заработанные</span>
                                </button>
                            </div>
                       </div>
                   )}
              </div>
          )}

          {/* AMOUNT & DATE INPUT (Shared) */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Сумма расхода</label>
                  <div className="relative">
                      <span className="absolute left-4 top-3.5 text-slate-400 text-lg">₽</span>
                      <input
                          type="number"
                          placeholder="0"
                          className="w-full p-3 pl-8 text-2xl font-bold border border-slate-200 rounded-xl outline-none bg-white text-slate-900"
                          value={amount}
                          onChange={e => setAmount(e.target.value)}
                      />
                  </div>
              </div>
              <div className="ml-3">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Дата</label>
                  <input
                      type="date"
                      className="max-w-xs w-full p-3 text-lg border border-slate-200 rounded-xl outline-none bg-white text-slate-900"
                      value={date}
                      onChange={e => setDate(e.target.value)}
                  />
              </div>
          </div>

          <button
              type="submit"
              className="w-full bg-red-600 text-white py-4 rounded-xl font-bold hover:bg-red-700 shadow-lg shadow-red-200 transition-transform active:scale-95"
          >
              Подтвердить расход
          </button>
      </form>
    </div>
  );
};

export default NewExpense;