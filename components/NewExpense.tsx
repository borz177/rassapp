import React, { useState, useEffect } from 'react';
import { Account, Investor, Expense, User } from '../types';
import { ICONS } from '../constants';

interface NewExpenseProps {
  investors: Investor[];
  accounts: Account[];
  expenses?: Expense[]; // ← Добавлено для проверки дубликатов
  onClose: () => void;
  onSubmit: (data: any) => void;
}

// 🔍 Проверка: есть ли уже похожий расход?
const checkDuplicateExpense = (
  expenses: Expense[] | undefined,
  amount: number,
  date: string,
  accountId: string,
  category: string,
  excludeId?: string
) => {
  if (!Array.isArray(expenses) || expenses.length === 0) return undefined;
  if (typeof amount !== 'number' || isNaN(amount)) return undefined;

  const expenseDate = new Date(date).toDateString();

  return expenses.find(exp => {
    if (!exp) return false;
    if (excludeId && exp.id === excludeId) return false;

    const sameAmount = Math.abs((exp.amount || 0) - amount) < 0.01;
    const sameDate = new Date(exp.date).toDateString() === expenseDate;
    const sameAccount = exp.accountId === accountId;
    const sameCategory = exp.category === category;

    return sameAmount && sameDate && sameAccount && sameCategory;
  });
};

const NewExpense: React.FC<NewExpenseProps> = ({ 
  investors, accounts, expenses, employees, onClose, onSubmit 
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

  // 🔥 НОВЫЕ СТЕЙТЫ для защиты от дублей и подтверждения
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [pendingExpenseData, setPendingExpenseData] = useState<any>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');  

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
      // 🔥 Сбрасываем сотрудника, если категория не "Зарплата"
      if (category !== 'Salary') {
          setSelectedEmployeeId('');
      }
  }, [category]);

  useEffect(() => {
    if (sourceType === 'INVESTOR' && investors.length === 0) {
        setSourceType('OTHER');
        setSelectedInvestorId('');
        setPayoutType(null);
    }
  }, [investors, sourceType]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // 🛡️ Защита от повторных отправок
    if (isSubmitting) return;
    
    const numAmount = Number(amount);
    if (numAmount <= 0) {
        alert("Введите сумму больше нуля");
        return;
    }

    // 🔍 ПРОВЕРКА НА ДУБЛИКАТ (если есть массив расходов)
    if (expenses && expenses.length > 0) {
      const duplicate = checkDuplicateExpense(
        expenses,
        numAmount,
        date,
        sourceAccountId,
        category
      );
      
      if (duplicate) {
        setDuplicateWarning(
          `⚠️ Похожий расход уже существует от ${new Date(duplicate.date).toLocaleDateString('ru-RU')}. ` +
          `Проверьте, не создаёте ли вы дубликат.`
        );
        // Не блокируем — пользователь может создать осознанно
      } else {
        setDuplicateWarning(null);
      }
    }

    // Handle Date with Time
    let finalDate = date;
    const now = new Date();
    const selectedDate = new Date(date);
    const isToday = selectedDate.getDate() === now.getDate() &&
                    selectedDate.getMonth() === now.getMonth() &&
                    selectedDate.getFullYear() === now.getFullYear();
    if (isToday) {
        finalDate = now.toISOString();
    }

    const commonData = { amount: numAmount, date: finalDate };

    let expenseData: any;
    if (sourceType === 'INVESTOR') {
        if (!selectedInvestorId || !sourceAccountId) {
            alert("Ошибка выбора инвестора или счета");
            return;
        }
        if (!payoutType) {
            alert("Выберите, откуда списать средства: из инвестиций или из прибыли.");
            return;
        }
        expenseData = {
            ...commonData,
            type: 'INVESTOR_WITHDRAWAL',
            investorId: selectedInvestorId,
            accountId: sourceAccountId,
            title: payoutType === 'INVESTMENT' ? "Возврат инвестиций" : "Выплата прибыли",
            category: "Выплата инвестора",
            payoutType: payoutType
        };
        } else {
        if (!title && category !== 'Моя выплата' && category !== 'Salary' || !sourceAccountId) {
            alert("Заполните название и выберите счет");
            return;
        }
        
        // 🔥 НОВОЕ: Проверка сотрудника для зарплаты
        if (category === 'Salary' && !selectedEmployeeId) {
            alert("Выберите сотрудника для выплаты зарплаты");
            return;
        }

        const selectedEmployee = employees.find(e => e.id === selectedEmployeeId);
        
        expenseData = {
            ...commonData,
            type: 'OTHER_EXPENSE',
            accountId: sourceAccountId,
            title: category === 'Моя выплата' 
                ? 'Выплата менеджеру' 
                : category === 'Salary' 
                    ? `Зарплата: ${selectedEmployee?.name || 'Сотрудник'}`
                    : title,
            category: category,
        };
        
        // 🔥 Сохраняем ID сотрудника в расходе
        if (category === 'Salary' && selectedEmployeeId) {
            expenseData.employeeId = selectedEmployeeId;
        }
        
        if (category === 'Моя выплата') {
            if (!managerPayoutSource) {
                alert("Выберите источник списания для выплаты.");
                return;
            }
            expenseData.managerPayoutSource = managerPayoutSource;
        }
    }

    // 💾 Сохраняем данные и показываем модал подтверждения
    setPendingExpenseData(expenseData);
    setShowConfirmModal(true);
  };

  // 🔥 Подтверждение отправки расхода
  const handleConfirm = async () => {
    if (isSubmitting || !pendingExpenseData) return;
    
    setIsSubmitting(true);
    
    try {
      // 🔥 ОТПРАВКА НА СЕРВЕР
      await onSubmit(pendingExpenseData);
      
      // ✅ Успех — закрываем модалы и сбрасываем форму
      setShowConfirmModal(false);
      setPendingExpenseData(null);
      onClose();
      
    } catch (error: any) {
      console.error('❌ Expense save error:', error);
      alert(`Ошибка: ${error?.message || 'Не удалось сохранить расход'}`);
      
    } finally {
      // 🔓 Всегда разблокируем
      setIsSubmitting(false);
    }
  };

  // 🔔 Обработчик отмены
  const handleCancel = () => {
    setShowConfirmModal(false);
    setPendingExpenseData(null);
    setIsSubmitting(false);
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
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
                sourceType === 'OTHER' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500'
            }`}
        >
            Общие расходы
        </button>
        {investors.length > 0 && (
            <button
                onClick={() => { setSourceType('INVESTOR'); setAmount(''); }}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
                    sourceType === 'INVESTOR' ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-500'
                }`}
            >
                Выплата инвестору
            </button>
        )}
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


                {category === 'Salary' && (
                     <div className="bg-blue-50 p-4 rounded-xl border border-blue-200 animate-fade-in">
                         <label className="block text-sm font-bold text-blue-800 mb-2 flex items-center gap-2">
                             👤 Кому выплачиваем зарплату
                         </label>
                         {employees.length === 0 ? (
                             <p className="text-sm text-blue-600 bg-white p-3 rounded-lg border border-blue-100">
                                 ⚠️ Нет активных сотрудников. Создайте их в разделе «Сотрудники».
                             </p>
                         ) : (
                             <select
                                className="w-full p-3 border border-blue-200 rounded-xl bg-white outline-none text-slate-900 focus:ring-2 focus:ring-blue-300"
                                value={selectedEmployeeId}
                                onChange={e => setSelectedEmployeeId(e.target.value)}
                             >
                                 <option value="">-- Выберите сотрудника --</option>
                                 {employees.map(emp => (
                                     <option key={emp.id} value={emp.id}>
                                         {emp.name} ({emp.email})
                                     </option>
                                 ))}
                             </select>
                         )}
                     </div>
                 )}

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
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Дата</label>
                <input
                    type="date"
                    className="w-full p-3 text-lg border border-slate-200 rounded-xl outline-none bg-white text-slate-900"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                />
            </div>
        </div>

        {/* 🔔 Предупреждение о возможном дубликате */}
        {duplicateWarning && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3 items-start">
            <span className="text-amber-500 mt-0.5">⚠️</span>
            <p className="text-sm text-amber-800">{duplicateWarning}</p>
            <button 
              type="button"
              onClick={() => setDuplicateWarning(null)}
              className="ml-auto text-amber-400 hover:text-amber-600"
            >
              ✕
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className={`w-full text-white py-4 rounded-xl font-bold transition-transform active:scale-95 shadow-lg flex items-center justify-center gap-2 ${
            isSubmitting 
              ? 'bg-slate-400 cursor-not-allowed' 
              : 'bg-red-600 hover:bg-red-700 shadow-red-200'
          }`}
        >
          {isSubmitting ? (
            <>
              <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              Обработка...
            </>
          ) : (
            'Подтвердить расход'
          )}
        </button>
      </form>

      {/* 🔔 МОДАЛЬНОЕ ОКНО ПОДТВЕРЖДЕНИЯ РАСХОДА */}
      {showConfirmModal && pendingExpenseData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
          onClick={handleCancel}
        >
          <div 
            className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            {/* Иконка */}
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto text-3xl">
              {ICONS.Expenses}
            </div>
            
            {/* Заголовок */}
            <h3 className="text-xl font-bold text-slate-800 text-center">
              Подтвердить расход?
            </h3>
            
            {/* Детали расхода */}
            <div className="bg-slate-50 p-4 rounded-xl space-y-2 text-sm border border-slate-100">
              <div className="flex justify-between">
                <span className="text-slate-500">Тип:</span>
                <span className="font-bold text-slate-800">
                  {pendingExpenseData.type === 'INVESTOR_WITHDRAWAL' ? 'Выплата инвестору' : 'Общий расход'}
                </span>
              </div>
              
              {pendingExpenseData.investorId && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Инвестор:</span>
                  <span className="font-medium text-slate-800">
                    {investors.find(i => i.id === pendingExpenseData.investorId)?.name}
                  </span>
                </div>
              )}

              {pendingExpenseData.employeeId && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Сотрудник:</span>
                  <span className="font-medium text-blue-600">
                    👤 {employees.find(e => e.id === pendingExpenseData.employeeId)?.name}
                  </span>
                </div>
              )}
              
              <div className="flex justify-between">
                <span className="text-slate-500">Назначение:</span>
                <span className="font-medium text-slate-800 truncate max-w-[180px]">
                  {pendingExpenseData.title || pendingExpenseData.category}
                </span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-slate-500">Счёт:</span>
                <span className="font-medium text-slate-800">
                  {getAccountName(pendingExpenseData.accountId)}
                </span>
              </div>
              
              <div className="flex justify-between pt-2 border-t border-slate-200">
                <span className="text-slate-500">Сумма:</span>
                <span className="font-bold text-red-600 text-lg">
                  -{Number(pendingExpenseData.amount).toLocaleString('ru-RU')} ₽
                </span>
              </div>
              
              <div className="flex justify-between text-xs text-slate-400">
                <span>Дата:</span>
                <span>{new Date(pendingExpenseData.date).toLocaleDateString('ru-RU')}</span>
              </div>
            </div>
            
            {/* Предупреждение о дубликате */}
            {duplicateWarning && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2 items-start">
                <span className="text-amber-500 flex-shrink-0 mt-0.5">⚠️</span>
                <p className="text-xs text-amber-800">{duplicateWarning}</p>
              </div>
            )}
            
            {/* Кнопки */}
            <div className="flex gap-3 pt-2">
              <button 
                onClick={handleCancel}
                disabled={isSubmitting}
                className="flex-1 py-3 bg-slate-100 rounded-xl font-bold text-slate-600 hover:bg-slate-200 transition-colors disabled:opacity-50"
              >
                Отмена
              </button>
              <button 
                onClick={handleConfirm}
                disabled={isSubmitting}
                className={`flex-1 py-3 rounded-xl font-bold transition-colors shadow-lg flex items-center justify-center gap-2 ${
                  isSubmitting 
                    ? 'bg-slate-400 cursor-not-allowed text-white' 
                    : 'bg-red-600 hover:bg-red-700 text-white shadow-red-200'
                }`}
              >
                {isSubmitting ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    Обработка...
                  </>
                ) : (
                  'Подтвердить'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NewExpense;