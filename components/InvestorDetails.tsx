import React, { useState, useMemo } from 'react';
import { Investor, Sale, Expense, Account, Payment, AppSettings } from '../types';
import { ICONS } from '../constants';
import { formatCurrency, getAccountShares } from '../src/utils';

interface InvestorDetailsProps {
  investor: Investor;
  investors: Investor[];
  account?: Account;
  sales: Sale[];
  expenses: Expense[];
  appSettings: AppSettings;
  onBack: () => void;
}

const InvestorDetails: React.FC<InvestorDetailsProps> = ({ investor, investors, account, sales, expenses, appSettings, onBack }) => {
  // 🔒 Актуальная (на сегодня) доля этого инвестора в счёте. Для обычного счёта —
  // это его profitPercentage, как и раньше. Для общего пула — доля считается
  // автоматически по вложенной сумме (см. getAccountShares), а не задаётся вручную.
  const currentSharePercent = useMemo(() => {
    const share = getAccountShares(account, investors).find(m => m.investor.id === investor.id);
    return share ? share.percentage : 0;
  }, [account, investors, investor.id]);
  const [activeTab, setActiveTab] = useState<'INFO' | 'HISTORY'>('INFO');
  const [expandedOpId, setExpandedOpId] = useState<string | null>(null);

  const [period, setPeriod] = useState(() => {
    const today = new Date().toISOString().split('T')[0];
    const investorSales = account ? sales.filter(s => s.accountId === account.id) : [];

    if (investorSales.length > 0) {
        investorSales.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
        const firstDate = investorSales[0].startDate.split('T')[0];
        return { start: firstDate, end: today };
    }

    // Fallback to investor join date if no sales exist
    return { start: investor.joinedDate.split('T')[0], end: today };
  });

  const [showProfitDetails, setShowProfitDetails] = useState(false);
  const [profitDetailsTab, setProfitDetailsTab] = useState<'accruals' | 'payouts'>('accruals');

  const history = useMemo(() => {
    if (!account) return [];

    // 🔒 В общем пуле sales/expenses счёта относятся ко всем участникам — оставляем только
    // депозиты/выплаты именно этого инвестора (депозит помечается customerId при создании).
    const depositOps = sales
      .filter(s => s.accountId === account.id
        && (s.productName === 'Начальный депозит' || s.productName === 'Депозит инвестора')
        && (s.customerId === `system_deposit_${investor.id}` || !s.customerId?.startsWith('system_deposit_')))
      .map(s => ({
        id: s.id, date: s.startDate, amount: s.totalAmount, title: s.productName,
        description: `Поступление от ${investor.name}`, type: 'INCOME', details: s
      }));

    const withdrawalOps = expenses
    .filter(e => e.accountId === account.id && (!e.investorId || e.investorId === investor.id) && (
        e.category === 'Выплата инвестору' ||
        e.category === 'Investment Return'  // ← Поддержка старых данных
    ))
    .map(e => ({
        id: e.id, 
        date: e.date, 
        amount: e.amount,
        title: e.payoutType === 'INVESTMENT' ? 'Возврат инвестиций' : 'Выплата прибыли',
        description: `Выплата для ${investor.name}`, 
        type: 'EXPENSE', 
        details: e
    }));

    return [...depositOps, ...withdrawalOps].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [sales, expenses, account, investor]);

  const balance = useMemo(() => {
      if(!account) return 0;
      let total = account.initialBalance || 0;
      sales.filter(s => s.accountId === account.id).forEach(s => {
          total += s.downPayment;
          s.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false).forEach(p => total += p.amount);
      });
      expenses.filter(e => e.accountId === account.id && e.isRefund !== true).forEach(e => total -= e.amount);
      return total;
  }, [sales, expenses, account]);

  const expectedTotalProfit = useMemo(() => {
    if (!account || currentSharePercent <= 0) return 0;

    const activeSales = sales.filter(s =>
        s.accountId === account.id &&
        (s.status === 'ACTIVE' || s.status === 'DRAFT') && // 🔸 Только активные
        s.buyPrice > 0 && s.totalAmount > 0
    );

    return activeSales.reduce((sum, sale) => {
        const profitMargin = (sale.totalAmount - sale.buyPrice) / sale.totalAmount;
        return sum + (sale.remainingAmount * profitMargin * currentSharePercent / 100);
    }, 0);
}, [sales, account, currentSharePercent]);

  const { totalProfitEarned, totalProfitWithdrawn, profitAccruals } = useMemo(() => {
      if (!account) return { totalProfitEarned: 0, totalProfitWithdrawn: 0, profitAccruals: [] };

      const investorSales = sales.filter(s => s.accountId === account.id && s.buyPrice > 0);
      let profitSum = 0;
      const accruals: {id: string, date: string, amount: number, source: string}[] = [];

      investorSales.forEach(sale => {
          const totalSaleProfit = sale.totalAmount - sale.buyPrice;
          if (sale.totalAmount <= 0 || totalSaleProfit <= 0) return;
          const profitMargin = totalSaleProfit / sale.totalAmount;

          const allPayments: (Payment | {date: string, amount: number, id: string, isRealPayment?: boolean})[] = [
              { date: sale.startDate, amount: sale.downPayment, id: `${sale.id}_dp`, isRealPayment: true },
              ...sale.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false)
          ];

          allPayments.forEach(p => {
              if (p.amount > 0) {
                  // 🔒 Доля на дату КОНКРЕТНОГО платежа — если инвестор вступил в пул позже,
                  // к более ранним платежам его доля не применяется (не задним числом).
                  const share = getAccountShares(account, investors, p.date).find(m => m.investor.id === investor.id);
                  const myPercent = share ? share.percentage : 0;
                  if (myPercent <= 0) return;
                  const profitFromPayment = p.amount * profitMargin * myPercent / 100;
                  profitSum += profitFromPayment;
                  accruals.push({
                      id: p.id,
                      date: p.date,
                      amount: profitFromPayment,
                      source: `Платеж по '${sale.productName}'`
                  });
              }
          });
      });

      // 🔒 В общем пуле expenses счёта содержат выплаты ВСЕМ участникам — берём только выплаты этому инвестору.
      const withdrawnSum = expenses
        .filter(e => e.accountId === account.id && e.payoutType === 'PROFIT' && (!e.investorId || e.investorId === investor.id))
        .reduce((sum, e) => sum + e.amount, 0);

      return { totalProfitEarned: profitSum, totalProfitWithdrawn: withdrawnSum, profitAccruals: accruals.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()) };
  }, [sales, expenses, account, investor.id, investors]);

  const periodProfit = useMemo(() => {
    if (!account || profitAccruals.length === 0) return 0;
    const startDate = new Date(period.start);
    const endDate = new Date(period.end);
    endDate.setHours(23, 59, 59, 999);

    // 🔒 profitAccruals уже содержит долю ЭТОГО инвестора (посчитанную по дате каждого платежа) —
    // повторно умножать на процент больше не нужно.
    return profitAccruals
      .filter(p => {
          const pDate = new Date(p.date);
          return pDate >= startDate && pDate <= endDate;
      })
      .reduce((sum, p) => sum + p.amount, 0);
  }, [period, profitAccruals, account]);

  const profitWithdrawals = useMemo(() => {
      return expenses.filter(e => e.accountId === account?.id && e.payoutType === 'PROFIT' && (!e.investorId || e.investorId === investor.id))
                     .sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [expenses, account, investor.id]);

  return (
    <div className="space-y-4 animate-fade-in pb-20">
      <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-700 pb-4 bg-white dark:bg-slate-900 sticky top-0 z-10 pt-2">
          <button onClick={onBack} className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white">{ICONS.Back}</button>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">{investor.name}</h2>
      </div>

      <div className="flex border-b border-slate-200 dark:border-slate-700"><button onClick={() => setActiveTab('INFO')} className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'INFO' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 dark:text-slate-400'}`}>Детали и Прибыль</button><button onClick={() => setActiveTab('HISTORY')} className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'HISTORY' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 dark:text-slate-400'}`}>История операций</button></div>

      {activeTab === 'INFO' && (
          <div className="space-y-4 pt-2">
               <div className="bg-white dark:bg-slate-800 rounded-xl p-5 shadow-sm border border-slate-100 dark:border-slate-700 space-y-4">
                  <div className="flex items-center gap-4 border-b border-slate-50 dark:border-slate-700 pb-4"><div className="w-16 h-16 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-full flex items-center justify-center text-2xl font-bold">{investor.name.charAt(0)}</div><div><h3 className="font-bold text-lg text-slate-800 dark:text-white">{investor.name}</h3><p className="text-slate-500 dark:text-slate-400">{investor.email}</p></div></div>
                  <div className="grid grid-cols-2 gap-4">
                      <div><label className="text-xs text-slate-400 uppercase">Телефон</label><p className="font-medium text-slate-800 dark:text-white">{investor.phone || '-'}</p></div>
                      <div><label className="text-xs text-slate-400 uppercase">Дата регистрации</label><p className="font-medium text-slate-800 dark:text-white">{new Date(investor.joinedDate).toLocaleDateString()}</p></div>
                      <div><label className="text-xs text-slate-400 uppercase">Баланс инвестиций</label><p className="font-semibold text-slate-700 dark:text-slate-300">{formatCurrency(investor.initialAmount, appSettings.showCents)} ₽</p></div>
                      <div><label className="text-xs text-slate-400 uppercase">{account?.type === 'POOL' ? 'Доля в пуле (по вложению)' : 'Процент прибыли'}</label><p className="font-semibold text-indigo-600 dark:text-indigo-400">{Math.round(currentSharePercent * 10) / 10}%</p></div>
                  </div>
                  <div className="pt-2"><label className="text-xs text-slate-400 uppercase">{account?.type === 'POOL' ? 'Баланс пула (общий)' : 'Текущий баланс счета'}</label><p className="text-3xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">{formatCurrency(balance, appSettings.showCents)} ₽</p>{account?.type === 'POOL' && <p className="text-xs text-slate-400 mt-1">Общая касса пула — включает деньги всех участников</p>}</div>
               </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-100 dark:border-slate-700"><h3 className="font-bold text-sm text-slate-800 dark:text-white mb-1">Ожидаемая прибыль</h3><p className="text-xs text-slate-500 dark:text-slate-400 mb-2">С активных договоров</p><p className="text-2xl font-bold text-indigo-800 dark:text-indigo-400">{formatCurrency(expectedTotalProfit, appSettings.showCents)} ₽</p></div>
                    <div onClick={() => setShowProfitDetails(true)} className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-100 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700"><h3 className="font-bold text-sm text-slate-800 dark:text-white mb-1">Полученная прибыль</h3><p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Общий баланс</p><p className="text-2xl font-bold text-emerald-800 dark:text-emerald-400">{formatCurrency(totalProfitEarned - totalProfitWithdrawn, appSettings.showCents)} ₽</p></div>
                </div>

               <div className="bg-white dark:bg-slate-800 rounded-xl p-5 shadow-sm border border-slate-100 dark:border-slate-700 space-y-4">
                  <h3 className="font-bold text-slate-800 dark:text-white">Полученная прибыль за период</h3>
                  <div className="grid grid-cols-2 gap-3">
                      <div><label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Начало</label><input type="date" className="w-full p-2 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-lg" value={period.start} onChange={e => setPeriod(p => ({...p, start: e.target.value}))} /></div>
                      <div><label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Конец</label><input type="date" className="w-full p-2 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-lg" value={period.end} onChange={e => setPeriod(p => ({...p, end: e.target.value}))} /></div>
                  </div>
                   <div className="bg-emerald-50 dark:bg-emerald-900/30 p-4 rounded-xl text-center"><p className="text-sm text-emerald-700 dark:text-emerald-400 mb-1">Получено инвестором за период</p><p className="text-3xl font-bold text-emerald-800 dark:text-emerald-400">{formatCurrency(periodProfit, appSettings.showCents)} ₽</p></div>
               </div>
          </div>
      )}

      {activeTab === 'HISTORY' && (
          <div className="space-y-3 pt-2">
              {history.length === 0 && (<div className="text-center py-10 text-slate-400">Нет операций</div>)}
              {history.map(op => (<div key={op.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden"><div className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700" onClick={() => setExpandedOpId(expandedOpId === op.id ? null : op.id)}><div className="flex items-center gap-3"><div className={`p-2 rounded-full ${op.type === 'EXPENSE' ? 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'}`}>{op.type === 'EXPENSE' ? ICONS.Expense : ICONS.Income}</div><div><p className="font-bold text-slate-800 dark:text-white text-sm">{op.title}</p><p className="text-xs text-slate-500 dark:text-slate-400">{new Date(op.date).toLocaleDateString()}</p></div></div><div className="flex items-center gap-2"><span className={`font-bold ${op.type === 'EXPENSE' ? 'text-slate-800 dark:text-white' : 'text-emerald-600 dark:text-emerald-400'}`}>{op.type === 'EXPENSE' ? '-' : '+'}{formatCurrency(op.amount, appSettings.showCents)}</span><span className={`text-slate-300 transition-transform ${expandedOpId === op.id ? 'rotate-180' : ''}`}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span></div></div>{expandedOpId === op.id && (<div className="bg-slate-50 dark:bg-slate-900 p-4 border-t border-slate-100 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 space-y-2 animate-fade-in">{op.type === 'INCOME' ? (<><div className="flex justify-between"><span>Тип:</span><span className="font-medium">Пополнение</span></div><div className="flex justify-between"><span>Источник:</span><span className="font-medium">{(op.details as Sale).productName}</span></div><div className="flex justify-between"><span>Сумма:</span><span className="font-medium">{formatCurrency((op.details as Sale).totalAmount, appSettings.showCents)} ₽</span></div></>) : (<><div className="flex justify-between"><span>Тип:</span><span className="font-medium">{(op.details as Expense).payoutType === 'PROFIT' ? 'Выплата прибыли' : 'Возврат инвестиций'}</span></div><div className="flex justify-between"><span>Сумма:</span><span className="font-medium">{formatCurrency((op.details as Expense).amount, appSettings.showCents)} ₽</span></div></>)}</div>)}</div>))}
          </div>
      )}

      {showProfitDetails && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={() => setShowProfitDetails(false)}>
              <div className="bg-white dark:bg-slate-800 w-full max-w-md rounded-2xl shadow-2xl flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
                  <div className="p-5 border-b border-slate-200 dark:border-slate-700"><h3 className="text-lg font-bold text-slate-800 dark:text-white">Детализация прибыли</h3><p className="text-sm text-slate-500 dark:text-slate-400">Общий баланс: <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(totalProfitEarned - totalProfitWithdrawn, appSettings.showCents)} ₽</span></p></div>

                  <div className="flex border-b border-slate-200 dark:border-slate-700 px-2">
                      <button onClick={() => setProfitDetailsTab('accruals')} className={`flex-1 py-3 text-sm font-semibold transition-colors ${profitDetailsTab === 'accruals' ? 'text-emerald-600 dark:text-emerald-400 border-b-2 border-emerald-600' : 'text-slate-500 dark:text-slate-400'}`}>Начисления</button>
                      <button onClick={() => setProfitDetailsTab('payouts')} className={`flex-1 py-3 text-sm font-semibold transition-colors ${profitDetailsTab === 'payouts' ? 'text-red-600 dark:text-red-400 border-b-2 border-red-600' : 'text-slate-500 dark:text-slate-400'}`}>Выплаты</button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-5">
                      {profitDetailsTab === 'accruals' && (
                          <div className="animate-fade-in space-y-2">
                              {profitAccruals.length === 0 ? <p className="text-center text-slate-400 py-4">Начислений нет</p> : profitAccruals.map(p => (
                                  <div key={p.id} className="flex justify-between items-center text-sm p-2 bg-emerald-50 dark:bg-emerald-900/30 rounded-lg">
                                      <div className="flex flex-col"><span className="text-slate-800 dark:text-white">{p.source}</span><span className="text-xs text-slate-400">{new Date(p.date).toLocaleDateString()}</span></div>
                                      <span className="font-bold text-emerald-600 dark:text-emerald-400">+{formatCurrency(p.amount, appSettings.showCents)} ₽</span>
                                  </div>
                              ))}
                          </div>
                      )}
                      {profitDetailsTab === 'payouts' && (
                           <div className="animate-fade-in space-y-2">
                              {profitWithdrawals.length === 0 ? <p className="text-center text-slate-400 py-4">Выплат нет</p> : profitWithdrawals.map(e => (
                                  <div key={e.id} className="flex justify-between items-center text-sm p-2 bg-red-50 dark:bg-red-900/30 rounded-lg">
                                      <div className="flex flex-col"><span className="text-slate-800 dark:text-white">{e.title}</span><span className="text-xs text-slate-400">{new Date(e.date).toLocaleDateString()}</span></div>
                                      <span className="font-bold text-red-600 dark:text-red-400">-{formatCurrency(e.amount, appSettings.showCents)} ₽</span>
                                  </div>
                              ))}
                          </div>
                      )}
                  </div>
                  <div className="p-4 border-t border-slate-100 dark:border-slate-700"><button onClick={() => setShowProfitDetails(false)} className="w-full py-3 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600">Закрыть</button></div>
              </div>
          </div>
      )}
    </div>
  );
};

export default InvestorDetails;
