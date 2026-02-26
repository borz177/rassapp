import React, { useState, useMemo, useEffect } from 'react';
import { Sale, Expense, Account, Customer } from '../types';
import { ICONS } from '../constants';

interface OperationsProps {
  sales: Sale[];
  expenses: Expense[];
  accounts: Account[];
  customers: Customer[];
  initialAccountId?: string | null;
  onClose?: () => void;
}

const Operations: React.FC<OperationsProps> = ({ 
    sales, expenses, accounts, customers, initialAccountId 
}) => {
  const [filterType, setFilterType] = useState<'ALL' | 'INCOME' | 'EXPENSE'>('ALL');
  const [filterAccountId, setFilterAccountId] = useState<string>(initialAccountId || '');
  const [selectedOp, setSelectedOp] = useState<any | null>(null);

  useEffect(() => {
      if (initialAccountId) setFilterAccountId(initialAccountId);
  }, [initialAccountId]);

  const getAccountName = (id: string) => accounts.find(a => a.id === id)?.name || 'Неизвестный счет';
  const getCustomerName = (id: string) => customers.find(c => c.id === id)?.name || 'Системная операция';

  const operations = useMemo(() => {
    const incomeOps: any[] = [];

    // Process all sales to generate cash-flow based income operations
    sales.forEach(s => {
        const customerName = getCustomerName(s.customerId);

        if (s.type === 'CASH') {
            incomeOps.push({
                id: s.id,
                date: s.startDate,
                amount: s.totalAmount,
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
                    incomeOps.push({
                        id: p.id,
                        date: p.date,
                        amount: p.amount,
                        title: customerName,
                        description: `Платеж: ${s.productName}`,
                        accountId: s.accountId,
                        type: 'INCOME',
                        category: 'Платеж',
                        raw: s
                    });
                }
            });
        }
    });

    const expenseOps = expenses.map(e => ({
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

    let all = [...incomeOps, ...expenseOps].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    if (filterType !== 'ALL') {
        all = all.filter(op => op.type === filterType);
    }
    if (filterAccountId) {
        all = all.filter(op => op.accountId === filterAccountId);
    }
    return all;
  }, [sales, expenses, filterType, filterAccountId, customers, accounts]);

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
          <h2 className="text-2xl font-bold text-slate-800">История операций</h2>
          <p className="text-slate-500 text-sm">Финансовый поток</p>
      </header>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 space-y-3">
          <div>
              <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Счет</label>
              <select className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm text-slate-700" value={filterAccountId} onChange={e => setFilterAccountId(e.target.value)}>
                  <option value="">Все счета</option>
                  {accounts.map(acc => (<option key={acc.id} value={acc.id}>{acc.name}</option>))}
              </select>
          </div>
          <div className="flex bg-slate-100 p-1 rounded-lg">
              <button onClick={() => setFilterType('ALL')} className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${filterType === 'ALL' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>Все</button>
              <button onClick={() => setFilterType('INCOME')} className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${filterType === 'INCOME' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}>Приход</button>
              <button onClick={() => setFilterType('EXPENSE')} className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${filterType === 'EXPENSE' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500'}`}>Расход</button>
          </div>
      </div>

      <div className="space-y-6">
          {groupedOperations.length === 0 && (<div className="text-center py-10 text-slate-400 border border-dashed border-slate-200 rounded-xl">Операций не найдено</div>)}

          {groupedOperations.map((group, idx) => (
              <div key={idx} className="space-y-2">
                  <h3 className="text-sm font-bold text-slate-400 px-2 uppercase tracking-wider">{group.title}</h3>
                  <div className="space-y-2">
                      {group.items.map(op => (
                          <div key={op.id} onClick={() => setSelectedOp(op)} className="bg-white p-4 rounded-xl shadow-sm flex items-center justify-between cursor-pointer hover:bg-slate-50 active:scale-[0.99] transition-transform">
                              <div className="flex items-center gap-3">
                                  <div className={`p-2.5 rounded-full ${op.type === 'EXPENSE' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>{op.type === 'EXPENSE' ? ICONS.Expense : ICONS.Income}</div>
                                  <div>
                                      <p className="font-bold text-slate-800 text-sm">{op.title}</p>
                                      <p className="text-xs text-slate-500">{getTimeMsk(op.date)} • {op.description}</p>
                                  </div>
                              </div>
                              <div className="text-right">
                                  <span className={`font-bold block ${op.type === 'EXPENSE' ? 'text-slate-800' : 'text-emerald-600'}`}>{op.type === 'EXPENSE' ? '-' : '+'}{op.amount.toLocaleString()} ₽</span>
                                  <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{getAccountName(op.accountId)}</span>
                              </div>
                          </div>
                      ))}
                  </div>
              </div>
          ))}
      </div>

      {selectedOp && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={() => setSelectedOp(null)}>
              <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                  <div className={`p-6 text-white ${selectedOp.type === 'EXPENSE' ? 'bg-red-500' : 'bg-emerald-500'}`}>
                      <p className="text-white/80 text-sm font-medium mb-1">{selectedOp.type === 'EXPENSE' ? 'Расходная операция' : 'Приходная операция'}</p>
                      <h3 className="text-3xl font-bold">{selectedOp.type === 'EXPENSE' ? '-' : '+'}{selectedOp.amount.toLocaleString()} ₽</h3>
                      <p className="text-white/80 text-sm mt-2 flex items-center gap-1 opacity-80">{ICONS.Clock} {new Date(selectedOp.date).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} (МСК)</p>
                  </div>
                  <div className="p-6 space-y-4">
                      <div className="flex justify-between border-b border-slate-100 pb-2"><span className="text-slate-500 text-sm">Счет</span><span className="font-semibold text-slate-800">{getAccountName(selectedOp.accountId)}</span></div>
                      <div className="flex justify-between border-b border-slate-100 pb-2"><span className="text-slate-500 text-sm">Категория</span><span className="font-semibold text-slate-800">{selectedOp.category}</span></div>
                      {selectedOp.type === 'INCOME' && (
                          <>
                              <div className="flex justify-between border-b border-slate-100 pb-2"><span className="text-slate-500 text-sm">Клиент / Источник</span><span className="font-semibold text-slate-800">{getCustomerName(selectedOp.raw.customerId)}</span></div>
                              <div className="flex justify-between border-b border-slate-100 pb-2"><span className="text-slate-500 text-sm">Товар</span><span className="font-semibold text-slate-800">{selectedOp.raw.productName}</span></div>
                              <div className="bg-slate-50 p-3 rounded-xl text-sm space-y-1">
                                  <div className="flex justify-between"><span className="text-slate-500">Тип сделки:</span><span className="font-medium">{selectedOp.raw.type === 'CASH' ? 'Наличные' : 'Рассрочка'}</span></div>
                                  {selectedOp.raw.type === 'INSTALLMENT' && (<div className="flex justify-between"><span className="text-slate-500">Полная сумма:</span><span className="font-medium">{selectedOp.raw.totalAmount.toLocaleString()} ₽</span></div>)}
                              </div>
                          </>
                      )}
                      {selectedOp.type === 'EXPENSE' && (<div className="flex justify-between border-b border-slate-100 pb-2"><span className="text-slate-500 text-sm">Назначение</span><span className="font-semibold text-slate-800">{selectedOp.title}</span></div>)}
                      <button onClick={() => setSelectedOp(null)} className="w-full py-3 bg-slate-100 text-slate-700 font-bold rounded-xl mt-4 hover:bg-slate-200">Закрыть</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default Operations;