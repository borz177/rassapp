import React, { useState, useMemo, useEffect } from 'react';
import { Sale, Expense, Account, Customer, User } from '../types';
import { ICONS } from '../constants';

interface OperationsProps {
  sales: Sale[];
  expenses: Expense[];
  accounts: Account[];
  customers: Customer[];
  employees?: User[];
  initialAccountId?: string | null;
  onClose?: () => void;
}

const Operations: React.FC<OperationsProps> = ({ 
    sales, expenses, accounts, customers, employees = [], initialAccountId 
}) => {
  const [filterType, setFilterType] = useState<'ALL' | 'INCOME' | 'EXPENSE'>('ALL');
  const [filterAccountId, setFilterAccountId] = useState<string>(initialAccountId || '');
  const [selectedOp, setSelectedOp] = useState<any | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('ALL');
  const [filterEmployeeId, setFilterEmployeeId] = useState<string>('');

  useEffect(() => {
      if (initialAccountId) setFilterAccountId(initialAccountId);
  }, [initialAccountId]);

  const getAccountName = (id: string) => accounts.find(a => a.id === id)?.name || 'Неизвестный счет';
  const getCustomerName = (id: string) => customers.find(c => c.id === id)?.name || 'Системная операция';
  const getAccountInitialBalance = (id: string) => accounts.find(a => a.id === id)?.initialBalance || 0;

  // 🔥 Красивые названия категорий
  const getCategoryLabel = (cat: string) => {
      const labels: Record<string, string> = {
          'General': 'Общее',
          'Моя выплата': 'Моя выплата',
          'Rent': 'Аренда',
          'Salary': 'Зарплата',
          'Marketing': 'Маркетинг',
          'Taxes': 'Налоги',
          'Equipment': 'Оборудование',
          'Выплата инвестора': 'Выплата инвестора',
          'Investment Return': 'Выплата инвестора',
          'Себестоимость': 'Закуп',
          'Возврат клиенту': 'Возврат клиенту',
          'Продажа': 'Приход',
          'Платеж': 'Платеж'
      };
      return labels[cat] || cat;
  };

  // 🔥 Получение имени сотрудника
  const getEmployeeName = (id?: string) => {
      if (!id || employees.length === 0) return null;
      return employees.find(e => e.id === id)?.name;
  };

  // 🔥 Уникальные категории для фильтра
  const availableCategories = useMemo(() => {
      const cats = new Set<string>();
      expenses.forEach(e => { if (e.category) cats.add(e.category); });
      sales.forEach(s => cats.add(s.type === 'CASH' ? 'Продажа' : 'Платеж'));
      return Array.from(cats).sort();
  }, [expenses, sales]);

  const operations = useMemo(() => {
    const incomeOps: any[] = [];

    // Process all sales to generate cash-flow based income operations
    sales.forEach(s => {
        const customerName = getCustomerName(s.customerId);

        if (s.type === 'CASH') {
            incomeOps.push({
                id: s.id,
                date: s.startDate,
                amount: s.downPayment, 
                title: customerName,
                description: s.productName,
                accountId: s.accountId,
                type: 'INCOME',
                category: 'Продажа',
                raw: s
            });
        } else { // INSTALLMENT
            // 1. Down payment
            if (s.downPayment > 0) {
                incomeOps.push({
                    id: `${s.id}_dp`,
                    date: s.startDate,
                    amount: s.downPayment,
                    title: customerName,
                    description: `Первый взнос: ${s.productName}`,
                    accountId: s.accountId,
                    type: 'INCOME',
                    category: 'Платеж',
                    raw: s
                });
            }
            // 2. Paid installments
            s.paymentPlan.forEach(p => {
                if (p.isPaid && p.isRealPayment !== false) {
                    // 🆕 Приводим к any, чтобы TS не ругался на новые поля скидки
                    const paymentAny = p as any; 
                    incomeOps.push({
                        id: p.id,
                        date: p.date,
                        amount: p.amount,
                        title: customerName,
                        description: `Платеж: ${s.productName}`,
                        accountId: s.accountId,
                        type: 'INCOME',
                        category: 'Платеж',
                        raw: s,
                        // 🆕 Передаем данные о скидке из платежа
                        discountAmount: paymentAny.discountAmount || 0,
                        discountPercent: paymentAny.discountPercent || 0,
                        note: paymentAny.note || ''
                    });
                }
            });
        }
    });

    const expenseOps = expenses.filter(e => e.isRefund !== true).map(e => ({
        id: e.id,
        date: e.date,
        amount: e.amount,
        title: e.title,
        description: e.category,
        accountId: e.accountId,
        type: 'EXPENSE',
        category: e.category,
        raw: e
    }));

    let all = [...incomeOps, ...expenseOps];

    // 🔹 ШАГ 1: Рассчитываем скользящий баланс для каждого счёта
    const sortedForCalc = [...all].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const accountBalances: Record<string, number> = {};

    accounts.forEach(acc => {
        accountBalances[acc.id] = acc.initialBalance || 0;
    });

    sortedForCalc.forEach(op => {
        const currentBalance = accountBalances[op.accountId] || 0;
        const newBalance = op.type === 'INCOME'
            ? currentBalance + op.amount
            : currentBalance - op.amount;

        op.balanceAfter = newBalance;
        op.balanceBefore = currentBalance;
        accountBalances[op.accountId] = newBalance;
    });

    // 🔹 ШАГ 2: Применяем фильтры
    if (filterType !== 'ALL') {
        all = all.filter(op => op.type === filterType);
    }
    if (filterAccountId) {
        all = all.filter(op => op.accountId === filterAccountId);
    }
    if (filterCategory !== 'ALL') {
        all = all.filter(op => op.category === filterCategory);
    }
    if (filterEmployeeId) {
        all = all.filter(op => op.raw?.createdByUserId === filterEmployeeId);
    }

    // 🔹 ШАГ 3: Сортируем для отображения (от новых к старым)
    return all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  }, [sales, expenses, filterType, filterAccountId, filterCategory, filterEmployeeId, customers, accounts]);

  const groupedOperations = useMemo(() => {
    const groups: { title: string; items: typeof operations }[] = [];
    const now = new Date();

    const getMskDateString = (date: Date) => {
        return date.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });
    };

    const todayStr = getMskDateString(now);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getMskDateString(yesterday);

    operations.forEach(op => {
        const opDate = new Date(op.date);
        const opDateStr = getMskDateString(opDate);

        let title = opDate.toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'long',
            timeZone: 'Europe/Moscow'
        });

        if (opDateStr === todayStr) {
            title = 'Сегодня';
        } else if (opDateStr === yesterdayStr) {
            title = 'Вчера';
        }

        const lastGroup = groups[groups.length - 1];
        if (lastGroup && lastGroup.title === title) {
            lastGroup.items.push(op);
        } else {
            groups.push({ title, items: [op] });
        }
    });

    return groups;
  }, [operations]);

  const getTimeMsk = (dateStr: string) => {
      return new Date(dateStr).toLocaleTimeString('ru-RU', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Europe/Moscow'
      });
  };

  return (
    <div className="space-y-4 animate-fade-in pb-20 w-full">
      <header>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-white">История операций</h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm">Финансовый поток</p>
      </header>

      <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 space-y-3">
          <div>
              <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Счет</label>
              <select className="w-full p-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-lg outline-none text-sm text-slate-700 dark:text-slate-300" value={filterAccountId} onChange={e => setFilterAccountId(e.target.value)}>
                  <option value="">Все счета</option>
                  {accounts.map(acc => (<option key={acc.id} value={acc.id}>{acc.name}</option>))}
              </select>
          </div>

          <div>
              <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Категория</label>
              <select
                  className="w-full p-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-lg outline-none text-sm text-slate-700 dark:text-slate-300"
                  value={filterCategory}
                  onChange={e => setFilterCategory(e.target.value)}
              >
                  <option value="ALL">Все категории</option>
                  {availableCategories.map(cat => (
                      <option key={cat} value={cat}>{getCategoryLabel(cat)}</option>
                  ))}
              </select>
          </div>

          {employees.length > 0 && (
              <div>
                  <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Сотрудник</label>
                  <select
                      className="w-full p-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-lg outline-none text-sm text-slate-700 dark:text-slate-300"
                      value={filterEmployeeId}
                      onChange={e => setFilterEmployeeId(e.target.value)}
                  >
                      <option value="">Все сотрудники</option>
                      {employees.map(emp => (
                          <option key={emp.id} value={emp.id}>{emp.name}</option>
                      ))}
                  </select>
              </div>
          )}

          <div className="flex bg-slate-100 dark:bg-slate-700 p-1 rounded-lg">
              <button onClick={() => setFilterType('ALL')} className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${filterType === 'ALL' ? 'bg-white dark:bg-slate-600 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}>Все</button>
              <button onClick={() => setFilterType('INCOME')} className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${filterType === 'INCOME' ? 'bg-white dark:bg-slate-600 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}>Приход</button>
              <button onClick={() => setFilterType('EXPENSE')} className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${filterType === 'EXPENSE' ? 'bg-white dark:bg-slate-600 text-red-600 dark:text-red-400 shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}>Расход</button>
          </div>

          {(filterAccountId || filterCategory !== 'ALL' || filterType !== 'ALL' || filterEmployeeId) && (
              <button
                  onClick={() => {
                      setFilterAccountId('');
                      setFilterCategory('ALL');
                      setFilterType('ALL');
                      setFilterEmployeeId('');
                  }}
                  className="w-full py-2 text-xs text-slate-500 dark:text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors flex items-center justify-center gap-1"
              >
                  ✕ Сбросить фильтры
              </button>
          )}
      </div>

      <div className="space-y-6">
          {groupedOperations.length === 0 && (<div className="text-center py-10 text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">Операций не найдено</div>)}

          {groupedOperations.map((group, idx) => (
    <div key={idx} className="space-y-2">
        <h3 className="text-sm font-bold text-slate-400 px-2 uppercase tracking-wider">{group.title}</h3>
        <div className="space-y-2">
            {group.items.map(op => (
    <div
        key={op.id}
        onClick={() => setSelectedOp(op)}
        className={`bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm flex items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-[0.99] transition-transform border-l-4 ${
            op.category === 'Salary' 
                ? 'border-l-blue-500' 
                : op.type === 'INCOME' 
                ? 'border-l-emerald-500' 
                : 'border-l-red-500'
        }`}
    >
        <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-full ${
                op.type === 'EXPENSE'
                    ? op.category === 'Salary'
                        ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                        : 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                    : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
            }`}>
                {op.type === 'EXPENSE'
                    ? op.category === 'Salary'
                        ? <span className="text-lg">💼</span>
                        : ICONS.Expense
                    : ICONS.Income}
            </div>
            <div>
                <p className="font-bold text-slate-800 dark:text-white text-sm">
                    {op.title}
                    {op.category === 'Salary' && op.raw?.employeeId && (
                        <span className="ml-1 text-xs text-blue-600 dark:text-blue-400 font-normal">
                            → {getEmployeeName(op.raw.employeeId)}
                        </span>
                    )}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    {getTimeMsk(op.date)} • {getCategoryLabel(op.description)}
                </p>
                {employees.length > 0 && getEmployeeName(op.raw?.createdByUserId) && op.raw?.createdByUserId !== op.raw?.employeeId && (
                    <p className="text-[10px] text-indigo-500 dark:text-indigo-400 mt-0.5">
                        Добавил: {getEmployeeName(op.raw.createdByUserId)}
                    </p>
                )}
            </div>
        </div>
        <div className="text-right">
            <span className={`font-bold block ${op.type === 'EXPENSE' ? 'text-slate-800 dark:text-white' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {op.type === 'EXPENSE' ? '-' : '+'}{op.amount.toLocaleString()} ₽
            </span>

            {/* 🆕 Бейдж скидки, если она была применена */}
            {op.discountAmount > 0 && (
                <span className="inline-block mt-1 text-[10px] font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-900/50">
                    🎁 −{op.discountAmount.toLocaleString()} ₽
                </span>
            )}

            <div className="mt-1 flex flex-col items-end gap-1">
                <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded">
                    {getAccountName(op.accountId)}
                </span>
                <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded border border-emerald-100 dark:border-emerald-900/50">
                    Баланс: {op.balanceAfter?.toLocaleString('ru-RU')} ₽
                </span>
            </div>
        </div>
    </div>
))}
        </div>
    </div>
))}
      </div>

      {selectedOp && (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={() => setSelectedOp(null)}>
        <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className={`p-6 text-white ${
                selectedOp.type === 'EXPENSE' 
                    ? selectedOp.category === 'Salary' 
                        ? 'bg-blue-500' 
                        : 'bg-red-500'
                    : 'bg-emerald-500'
            }`}>
                <p className="text-white/80 text-sm font-medium mb-1">
                    {selectedOp.type === 'EXPENSE' 
                        ? selectedOp.category === 'Salary' 
                            ? 'Выплата зарплаты' 
                            : 'Расходная операция' 
                        : 'Приходная операция'}
                </p>
                <h3 className="text-3xl font-bold">
                    {selectedOp.type === 'EXPENSE' ? '-' : '+'}{selectedOp.amount.toLocaleString()} ₽
                </h3>
                <p className="text-white/80 text-sm mt-2 flex items-center gap-1 opacity-80">
                    {ICONS.Clock} {new Date(selectedOp.date).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} (МСК)
                </p>
            </div>
            <div className="p-6 space-y-4">
                <div className="flex justify-between border-b border-slate-100 dark:border-slate-700 pb-2">
                    <span className="text-slate-500 dark:text-slate-400 text-sm">Счет</span>
                    <span className="font-semibold text-slate-800 dark:text-white">{getAccountName(selectedOp.accountId)}</span>
                </div>

                <div className="flex justify-between border-b border-slate-100 dark:border-slate-700 pb-2">
                    <span className="text-slate-500 dark:text-slate-400 text-sm">Баланс до операции</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">{selectedOp.balanceBefore?.toLocaleString('ru-RU')} ₽</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 dark:border-slate-700 pb-2">
                    <span className="text-slate-500 dark:text-slate-400 text-sm">Баланс после операции</span>
                    <span className="font-semibold text-emerald-600">{selectedOp.balanceAfter?.toLocaleString('ru-RU')} ₽</span>
                </div>

                <div className="flex justify-between border-b border-slate-100 dark:border-slate-700 pb-2">
                    <span className="text-slate-500 dark:text-slate-400 text-sm">Категория</span>
                    <span className="font-semibold text-slate-800 dark:text-white">{getCategoryLabel(selectedOp.category)}</span>
                </div>
                
                {selectedOp.category === 'Salary' && selectedOp.raw?.employeeId && (
                    <div className="flex justify-between border-b border-slate-100 dark:border-slate-700 pb-2 bg-blue-50 dark:bg-blue-900/30 -mx-6 px-6 py-3">
                        <span className="text-slate-500 dark:text-slate-400 text-sm flex items-center gap-1">
                            👤 Сотрудник
                        </span>
                        <span className="font-bold text-blue-700 dark:text-blue-400">
                            {getEmployeeName(selectedOp.raw.employeeId)}
                        </span>
                    </div>
                )}
                
                {selectedOp.type === 'INCOME' && (
                    <>
                        {/* 🆕 Красивый блок со скидкой (появляется только если она была) */}
                        {selectedOp.discountAmount > 0 && (
                            <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-900/50 p-3 rounded-xl space-y-2 mb-3">
                                <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-bold text-sm">
                                    🎁 Скидка при полном погашении
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-600 dark:text-slate-300">Сумма скидки:</span>
                                    <span className="font-bold text-red-600 dark:text-red-400">−{selectedOp.discountAmount.toLocaleString()} ₽</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-600 dark:text-slate-300">Процент скидки:</span>
                                    <span className="font-bold text-red-600 dark:text-red-400">{selectedOp.discountPercent.toFixed(1)}%</span>
                                </div>
                                {selectedOp.note && (
                                    <div className="text-xs text-amber-700 dark:text-amber-400 italic pt-1 border-t border-amber-200 dark:border-amber-900/50">
                                        {selectedOp.note}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="flex justify-between border-b border-slate-100 dark:border-slate-700 pb-2">
                            <span className="text-slate-500 dark:text-slate-400 text-sm">Клиент / Источник</span>
                            <span className="font-semibold text-slate-800 dark:text-white">{getCustomerName(selectedOp.raw.customerId)}</span>
                        </div>
                        <div className="flex justify-between border-b border-slate-100 dark:border-slate-700 pb-2">
                            <span className="text-slate-500 dark:text-slate-400 text-sm">Товар</span>
                            <span className="font-semibold text-slate-800 dark:text-white">{selectedOp.raw.productName}</span>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-xl text-sm space-y-1">
                            <div className="flex justify-between">
                                <span className="text-slate-500 dark:text-slate-400">Тип сделки:</span>
                                <span className="font-medium dark:text-slate-200">{selectedOp.raw.type === 'CASH' ? 'Наличные' : 'Рассрочка'}</span>
                            </div>
                            {selectedOp.raw.type === 'INSTALLMENT' && (
                                <div className="flex justify-between">
                                    <span className="text-slate-500 dark:text-slate-400">Полная сумма:</span>
                                    <span className="font-medium dark:text-slate-200">{selectedOp.raw.totalAmount.toLocaleString()} ₽</span>
                                </div>
                            )}
                        </div>
                    </>
                )}
                {selectedOp.type === 'EXPENSE' && (
                    <div className="flex justify-between border-b border-slate-100 dark:border-slate-700 pb-2">
                        <span className="text-slate-500 dark:text-slate-400 text-sm">Назначение</span>
                        <span className="font-semibold text-slate-800 dark:text-white">{selectedOp.title}</span>
                    </div>
                )}
                <button onClick={() => setSelectedOp(null)} className="w-full py-3 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl mt-4 hover:bg-slate-200 dark:hover:bg-slate-600">
                    Закрыть
                </button>
            </div>
        </div>
    </div>
)}
    </div>
  );
};

export default Operations;