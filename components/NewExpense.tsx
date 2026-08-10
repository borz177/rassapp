import React, { useState, useEffect } from 'react';
import { Account, Investor, Expense, User, Supplier, Sale } from '../types';
import { ICONS } from '../constants';
import { getInvestorAccount } from '../src/utils';
import { SuccessCheck, hapticSuccess } from './feedback';

interface NewExpenseProps {
  investors: Investor[];
  accounts: Account[];
  expenses?: Expense[]; // ← Добавлено для проверки дубликатов
  employees?: User[];
  suppliers?: Supplier[];
  sales?: Sale[];
  showSupplierCategory?: boolean;
  appSettings?: any;
  initialData?: {
    accountId?: string;
    supplierId?: string;
    saleId?: string;
    category?: string;
    title?: string;
    amount?: number;
    maxAmount?: number;
  } | null;
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
  investors, accounts, expenses, employees, suppliers, sales, showSupplierCategory, initialData, onClose, onSubmit
}) => {
  const employeeList: User[] = employees || [];
  const supplierList: Supplier[] = suppliers || [];
  const saleList: Sale[] = sales || [];
  const isSupplierPayment = !!initialData?.saleId;

  const [sourceType, setSourceType] = useState<'INVESTOR' | 'OTHER'>('OTHER');

  // Form States
  const [selectedInvestorId, setSelectedInvestorId] = useState('');
  const [sourceAccountId, setSourceAccountId] = useState(initialData?.accountId || '');
  const [amount, setAmount] = useState(initialData?.amount ? String(initialData.amount) : '');
  const [title, setTitle] = useState(initialData?.title || '');
  const [category, setCategory] = useState(initialData?.category || 'General');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [payoutType, setPayoutType] = useState<'INVESTMENT' | 'PROFIT' | null>(null);
  const [managerPayoutSource, setManagerPayoutSource] = useState<'CAPITAL' | 'PROFIT' | null>(null);

  // 🔥 НОВЫЕ СТЕЙТЫ для защиты от дублей и подтверждения
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  // Подтверждение списания: раньше окно просто закрывалось, и было непонятно,
  // прошла операция или нет — из-за этого расход проводили повторно.
  const [expenseDone, setExpenseDone] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [pendingExpenseData, setPendingExpenseData] = useState<any>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [selectedDebtSaleId, setSelectedDebtSaleId] = useState('');

  const selectedInvestor = investors.find(i => i.id === selectedInvestorId);
  const selectedAccount = accounts.find(a => a.id === sourceAccountId);

  // Открытые (непогашенные) долги выбранного поставщика — для опциональной привязки оплаты к конкретному договору
  const supplierOpenDebts = selectedSupplierId
    ? saleList.filter(s => s.supplierId === selectedSupplierId && !s.isPartnerDebtPaid && (s.buyPrice - (s.partnerDebtPaidAmount || 0)) > 0)
    : [];
  const selectedDebtSale = supplierOpenDebts.find(s => s.id === selectedDebtSaleId);
  const selectedDebtRemaining = selectedDebtSale ? selectedDebtSale.buyPrice - (selectedDebtSale.partnerDebtPaidAmount || 0) : null;

  // Auto-fill Account logic when Investor changes
  useEffect(() => {
      if (selectedInvestor) {
          // 🔒 getInvestorAccount учитывает и обычный счёт (ownerId), и общий пул (poolMemberIds) —
          // раньше здесь был accounts.find(a => a.ownerId === ...), из-за чего выплата/списание
          // для инвестора из общего пула не находило счёт вообще.
          const invAccount = getInvestorAccount(selectedInvestor.id, accounts);
          if (invAccount) {
              setSourceAccountId(invAccount.id);
          }
      }
  }, [selectedInvestorId, accounts, investors]);

  // Default account
  useEffect(() => {
      if (accounts.length > 0 && !sourceAccountId) {
          const mainAccount = accounts.find(a => a.isMain || a.type === 'MAIN') || accounts[0];
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
      // Сбрасываем поставщика/договор, если категория не "Партнер"
      if (category !== 'Оплата партнёру') {
          setSelectedSupplierId('');
          setSelectedDebtSaleId('');
      }
  }, [category]);

  // Сбрасываем выбранный договор при смене поставщика
  useEffect(() => {
      setSelectedDebtSaleId('');
  }, [selectedSupplierId]);

  // Автоподстановка суммы остатком долга при выборе конкретного договора
  useEffect(() => {
      if (selectedDebtSale) {
          setAmount(String(selectedDebtSale.buyPrice - (selectedDebtSale.partnerDebtPaidAmount || 0)));
      }
  }, [selectedDebtSaleId]);

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

    // 🔒 Оплата поставщику — отдельный упрощённый флоу (частичная оплата долга по конкретному договору)
    if (isSupplierPayment) {
        if (initialData?.maxAmount != null && numAmount > initialData.maxAmount + 0.01) {
            alert(`Сумма не может превышать остаток долга: ${initialData.maxAmount} ₽`);
            return;
        }
        if (!sourceAccountId) {
            alert("Выберите счёт списания");
            return;
        }
        const supplierExpenseData = {
            amount: numAmount,
            date: new Date().toISOString(),
            accountId: sourceAccountId,
            title: initialData?.title || 'Оплата поставщику',
            category: 'Оплата партнёру',
            supplierId: initialData?.supplierId,
            saleId: initialData?.saleId,
        };
        setPendingExpenseData(supplierExpenseData);
        setShowConfirmModal(true);
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
        if (!title && category !== 'Моя выплата' && category !== 'Salary' && category !== 'Оплата партнёру' || !sourceAccountId) {
            alert("Заполните название и выберите счет");
            return;
        }

        // 🔥 НОВОЕ: Проверка сотрудника для зарплаты
        if (category === 'Salary' && !selectedEmployeeId) {
            alert("Выберите сотрудника для выплаты зарплаты");
            return;
        }

        // 🔒 Партнер: обязателен выбор поставщика; если выбран конкретный договор — сумма не может превышать остаток долга
        if (category === 'Оплата партнёру') {
            if (!selectedSupplierId) {
                alert("Выберите поставщика");
                return;
            }
            if (selectedDebtRemaining != null && numAmount > selectedDebtRemaining + 0.01) {
                alert(`Сумма не может превышать остаток долга: ${selectedDebtRemaining} ₽`);
                return;
            }
        }

        const selectedEmployee = employeeList.find(e => e.id === selectedEmployeeId);
        const selectedSupplierForExpense = supplierList.find(s => s.id === selectedSupplierId);

        expenseData = {
            ...commonData,
            type: 'OTHER_EXPENSE',
            accountId: sourceAccountId,
            title: category === 'Моя выплата'
                ? 'Выплата менеджеру'
                : category === 'Salary'
                    ? `Зарплата: ${selectedEmployee?.name || 'Сотрудник'}`
                    : category === 'Оплата партнёру'
                        ? `Оплата поставщику: ${selectedSupplierForExpense?.name || 'Партнер'}`
                        : title,
            category: category,
        };

        // 🔥 Сохраняем ID сотрудника в расходе
        if (category === 'Salary' && selectedEmployeeId) {
            expenseData.employeeId = selectedEmployeeId;
        }

        // 🔥 Сохраняем ID поставщика и (опционально) договора, долг по которому гасится
        if (category === 'Оплата партнёру' && selectedSupplierId) {
            expenseData.supplierId = selectedSupplierId;
            if (selectedDebtSaleId) {
                expenseData.saleId = selectedDebtSaleId;
            }
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

      // ✅ Успех — показываем подтверждение и только потом уходим с экрана
      setExpenseDone(true);
      hapticSuccess();
      await new Promise(r => setTimeout(r, 1100));

      setShowConfirmModal(false);
      setExpenseDone(false);
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
      <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-700 pb-4 bg-white dark:bg-slate-800 sticky top-0 z-10 pt-2">
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
             {ICONS.Back}
          </button>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">Оформление расхода</h2>
      </div>

      {isSupplierPayment && (
          <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-900/50 rounded-xl p-4 space-y-1">
              <p className="font-bold text-amber-800 dark:text-amber-300">{initialData?.title}</p>
              <p className="text-sm text-amber-700 dark:text-amber-400">
                  Остаток долга: {initialData?.maxAmount?.toLocaleString('ru-RU')} ₽. Можно оплатить частично.
              </p>
          </div>
      )}

      {/* Switcher */}
      {!isSupplierPayment && (
      <div className="flex bg-slate-100 dark:bg-slate-700 p-1 rounded-xl">
        <button
            onClick={() => { setSourceType('OTHER'); setAmount(''); }}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
                sourceType === 'OTHER' ? 'bg-white dark:bg-slate-800 text-red-600 dark:text-red-400 shadow-sm' : 'text-slate-500 dark:text-slate-400'
            }`}
        >
            Общие расходы
        </button>
        {investors.length > 0 && (
            <button
                onClick={() => { setSourceType('INVESTOR'); setAmount(''); }}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
                    sourceType === 'INVESTOR' ? 'bg-white dark:bg-slate-800 text-purple-600 dark:text-purple-400 shadow-sm' : 'text-slate-500 dark:text-slate-400'
                }`}
            >
                Выплата инвестору
            </button>
        )}
      </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {isSupplierPayment && (
            <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Списать со счета</label>
                <select
                    className="w-full p-3 border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 outline-none text-slate-900 dark:text-white"
                    value={sourceAccountId}
                    onChange={e => setSourceAccountId(e.target.value)}
                >
                    {accounts.filter(a => !a.isArchived || a.id === sourceAccountId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
            </div>
        )}
        {/* INVESTOR FORM */}
        {!isSupplierPayment && sourceType === 'INVESTOR' && (
            <div className="space-y-4 bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm animate-fade-in">
                <div>
                     <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Выберите инвестора</label>
                     <select
                        className="w-full p-3 border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 outline-none text-slate-900 dark:text-white"
                        value={selectedInvestorId}
                        onChange={e => setSelectedInvestorId(e.target.value)}
                     >
                         <option value="">-- Список инвесторов --</option>
                         {investors.map(inv => <option key={inv.id} value={inv.id}>{inv.name}</option>)}
                     </select>
                 </div>
                 <div>
                     <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Списать со счета</label>
                     <select
                        className="w-full p-3 border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 outline-none text-slate-900 dark:text-white"
                        value={sourceAccountId}
                        onChange={e => setSourceAccountId(e.target.value)}
                     >
                         {accounts.filter(a => !a.isArchived || a.id === sourceAccountId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                     </select>
                 </div>
                 <div className="pt-2">
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Источник списания</label>
                      <div className="grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => setPayoutType('INVESTMENT')} className={`p-4 rounded-xl border-2 text-center ${payoutType === 'INVESTMENT' ? 'border-purple-600 bg-purple-50 dark:bg-purple-900/30' : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900'}`}>
                              <span className="font-bold text-sm text-purple-800 dark:text-purple-300">Из Инвестиций</span>
                              <span className="text-xs text-slate-500 dark:text-slate-400 block">Уменьшить тело вклада</span>
                          </button>
                          <button type="button" onClick={() => setPayoutType('PROFIT')} className={`p-4 rounded-xl border-2 text-center ${payoutType === 'PROFIT' ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-900/30' : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900'}`}>
                              <span className="font-bold text-sm text-emerald-800 dark:text-emerald-300">Из Прибыли</span>
                              <span className="text-xs text-slate-500 dark:text-slate-400 block">Выплатить доход</span>
                          </button>
                      </div>
                 </div>
            </div>
        )}

        {/* OTHER FORM */}
        {!isSupplierPayment && sourceType === 'OTHER' && (
            <div className="space-y-4 bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm animate-fade-in">
                {category !== 'Моя выплата' && category !== 'Оплата партнёру' && (
                    <div>
                         <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Название / Назначение</label>
                         <input
                            placeholder="Например: Аренда офиса"
                            className="w-full p-3 border border-slate-200 dark:border-slate-600 rounded-xl outline-none bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                         />
                     </div>
                )}
                 <div>
                     <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Категория</label>
                     <select
                        className="w-full p-3 border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 outline-none text-slate-900 dark:text-white"
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
                         {showSupplierCategory && <option value="Оплата партнёру">Партнер</option>}
                     </select>
                 </div>

                {category === 'Оплата партнёру' && (
                     <div className="bg-amber-50 dark:bg-amber-900/30 p-4 rounded-xl border border-amber-200 dark:border-amber-900/50 animate-fade-in space-y-3">
                         <label className="block text-sm font-bold text-amber-800 dark:text-amber-300 mb-1 flex items-center gap-2">
                             🤝 Поставщик
                         </label>
                         {supplierList.length === 0 ? (
                             <p className="text-sm text-amber-700 dark:text-amber-400 bg-white dark:bg-slate-800 p-3 rounded-lg border border-amber-100 dark:border-amber-900/50">
                                 ⚠️ Нет поставщиков. Добавьте их в разделе «Партнеры».
                             </p>
                         ) : (
                             <>
                                 <select
                                    className="w-full p-3 border border-amber-200 dark:border-amber-800 rounded-xl bg-white dark:bg-slate-900 outline-none text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-300"
                                    value={selectedSupplierId}
                                    onChange={e => setSelectedSupplierId(e.target.value)}
                                 >
                                     <option value="">-- Выберите поставщика --</option>
                                     {supplierList.map(s => (
                                         <option key={s.id} value={s.id}>{s.name}</option>
                                     ))}
                                 </select>

                                 {selectedSupplierId && supplierOpenDebts.length > 0 && (
                                     <div>
                                         <label className="block text-xs font-medium text-amber-700 dark:text-amber-400 mb-1">Погасить долг по договору (опционально)</label>
                                         <select
                                            className="w-full p-3 border border-amber-200 dark:border-amber-800 rounded-xl bg-white dark:bg-slate-900 outline-none text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-300"
                                            value={selectedDebtSaleId}
                                            onChange={e => setSelectedDebtSaleId(e.target.value)}
                                         >
                                             <option value="">Без привязки к договору</option>
                                             {supplierOpenDebts.map(s => (
                                                 <option key={s.id} value={s.id}>
                                                     {s.productName} — остаток {(s.buyPrice - (s.partnerDebtPaidAmount || 0)).toLocaleString('ru-RU')} ₽
                                                 </option>
                                             ))}
                                         </select>
                                         {selectedDebtSale && (
                                             <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                                                 Сумма ограничена остатком долга: {selectedDebtRemaining?.toLocaleString('ru-RU')} ₽ (можно оплатить частично).
                                             </p>
                                         )}
                                     </div>
                                 )}
                             </>
                         )}
                     </div>
                 )}

                {category === 'Salary' && (
                     <div className="bg-blue-50 dark:bg-blue-900/30 p-4 rounded-xl border border-blue-200 dark:border-blue-900/50 animate-fade-in">
                         <label className="block text-sm font-bold text-blue-800 dark:text-blue-300 mb-2 flex items-center gap-2">
                             👤 Кому выплачиваем зарплату
                         </label>
                         {employeeList.length === 0 ? (
                             <p className="text-sm text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-800 p-3 rounded-lg border border-blue-100 dark:border-blue-900/50">
                                 ⚠️ Нет активных сотрудников. Создайте их в разделе «Сотрудники».
                             </p>
                         ) : (
                             <select
                                className="w-full p-3 border border-blue-200 dark:border-blue-800 rounded-xl bg-white dark:bg-slate-900 outline-none text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-300"
                                value={selectedEmployeeId}
                                onChange={e => setSelectedEmployeeId(e.target.value)}
                             >
                                 <option value="">-- Выберите сотрудника --</option>
                                 {employeeList.map(emp => (
                                     <option key={emp.id} value={emp.id}>
                                         {emp.name} ({emp.email})
                                     </option>
                                 ))}
                             </select>
                         )}
                     </div>
                 )}

                 <div>
                     <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Списать со счета</label>
                     <select
                        className="w-full p-3 border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 outline-none text-slate-900 dark:text-white"
                        value={sourceAccountId}
                        onChange={e => setSourceAccountId(e.target.value)}
                     >
                         {accounts.filter(a => !a.isArchived || a.id === sourceAccountId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                     </select>
                 </div>
                 {category === 'Моя выплата' && (
                     <div className="pt-2">
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Источник списания</label>
                          <div className={`grid ${selectedAccount?.ownerId ? 'grid-cols-1' : 'grid-cols-2'} gap-2`}>
                              {!selectedAccount?.ownerId && (
                                  <button type="button" onClick={() => setManagerPayoutSource('CAPITAL')} className={`p-4 rounded-xl border-2 text-center ${managerPayoutSource === 'CAPITAL' ? 'border-purple-600 bg-purple-50 dark:bg-purple-900/30' : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900'}`}>
                                      <span className="font-bold text-sm text-purple-800 dark:text-purple-300">Из Капитала</span>
                                      <span className="text-xs text-slate-500 dark:text-slate-400 block">Личные средства</span>
                                  </button>
                              )}
                              <button type="button" onClick={() => setManagerPayoutSource('PROFIT')} className={`p-4 rounded-xl border-2 text-center ${managerPayoutSource === 'PROFIT' ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-900/30' : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900'}`}>
                                  <span className="font-bold text-sm text-emerald-800 dark:text-emerald-300">Из Прибыли</span>
                                  <span className="text-xs text-slate-500 dark:text-slate-400 block">Заработанные</span>
                              </button>
                          </div>
                     </div>
                 )}
            </div>
        )}

        {/* AMOUNT & DATE INPUT (Shared) */}
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
            <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Сумма расхода</label>
                <div className="relative">
                    <span className="absolute left-4 top-3.5 text-slate-400 dark:text-slate-500 text-lg">₽</span>
                    <input
                        type="number"
                        placeholder="0"
                        className="w-full p-3 pl-8 text-2xl font-bold border border-slate-200 dark:border-slate-600 rounded-xl outline-none bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                    />
                </div>
            </div>
            <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Дата</label>
                <input
                    type="date"
                    className="w-full p-3 text-lg border border-slate-200 dark:border-slate-600 rounded-xl outline-none bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
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
          className={`w-full text-white py-4 rounded-xl font-bold transition-transform active:scale-95 flex items-center justify-center gap-2 ${
            isSubmitting 
              ? 'bg-slate-400 cursor-not-allowed' 
              : 'bg-red-600 hover:bg-red-700'
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
          onClick={() => { if (!isSubmitting && !expenseDone) handleCancel(); }}
        >
          <div
            className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-4 animate-dialog-in"
            onClick={e => e.stopPropagation()}
          >
            {/* Расход проведён. Галочка красная, а не зелёная: списание не должно
                выглядеть так же, как поступление денег. */}
            {expenseDone ? (
              <div className="py-4 text-center space-y-5">
                <SuccessCheck tone="danger" />
                <div className="animate-stage-in" style={{ animationDelay: '0.55s' }}>
                  <h3 className="text-xl font-bold text-slate-800 dark:text-white">Расход проведён</h3>
                  <p className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-2">
                    −{Number(pendingExpenseData.amount).toLocaleString('ru-RU')} ₽
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    {getAccountName(pendingExpenseData.accountId)}
                  </p>
                </div>
              </div>
            ) : (
            <>
            {/* Иконка */}
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto text-3xl">
              {ICONS.Expenses}
            </div>

            {/* Заголовок */}
            <h3 className="text-xl font-bold text-slate-800 dark:text-white text-center">
              Подтвердить расход?
            </h3>

            {/* Детали расхода */}
            <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl space-y-2 text-sm border border-slate-100 dark:border-slate-700">
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Тип:</span>
                <span className="font-bold text-slate-800 dark:text-white">
                  {pendingExpenseData.type === 'INVESTOR_WITHDRAWAL' ? 'Выплата инвестору' : pendingExpenseData.category === 'Оплата партнёру' ? 'Оплата поставщику' : 'Общий расход'}
                </span>
              </div>

              {pendingExpenseData.investorId && (
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Инвестор:</span>
                  <span className="font-medium text-slate-800 dark:text-white">
                    {investors.find(i => i.id === pendingExpenseData.investorId)?.name}
                  </span>
                </div>
              )}

              {pendingExpenseData.employeeId && (
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Сотрудник:</span>
                  <span className="font-medium text-blue-600 dark:text-blue-400">
                    👤 {employeeList.find(e => e.id === pendingExpenseData.employeeId)?.name}
                  </span>
                </div>
              )}

              {pendingExpenseData.supplierId && (
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Поставщик:</span>
                  <span className="font-medium text-amber-600 dark:text-amber-400">
                    🤝 {supplierList.find(s => s.id === pendingExpenseData.supplierId)?.name}
                    {pendingExpenseData.saleId ? ' (погашение долга)' : ''}
                  </span>
                </div>
              )}

              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Назначение:</span>
                <span className="font-medium text-slate-800 dark:text-white truncate max-w-[180px]">
                  {pendingExpenseData.title || pendingExpenseData.category}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Счёт:</span>
                <span className="font-medium text-slate-800 dark:text-white">
                  {getAccountName(pendingExpenseData.accountId)}
                </span>
              </div>

              <div className="flex justify-between pt-2 border-t border-slate-200 dark:border-slate-700">
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
                className="btn-press flex-1 py-3 bg-slate-100 rounded-xl font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-50"
              >
                Отмена
              </button>
              <button 
                onClick={handleConfirm}
                disabled={isSubmitting}
                className={`btn-press flex-1 py-3 rounded-xl font-bold shadow-lg flex items-center justify-center gap-2 ${
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
            </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NewExpense;