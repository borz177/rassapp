import React, { useState, useMemo } from 'react';
import { Investor, Sale, Expense, Account, Payment, AppSettings, Customer, InvestmentPeriod, LossEvent } from '../types';
import { ICONS } from '../constants';
import { formatCurrency, formatDate, getAccountShares, getManagerSharePercent, getCapitalShares, getActivePeriodAt } from '../src/utils';

interface InvestorDetailsProps {
  investor: Investor;
  investors: Investor[];
  account?: Account;
  sales: Sale[];
  expenses: Expense[];
  customers: Customer[];
  appSettings: AppSettings;
  onBack: () => void;
  onUpdateInvestor?: (investor: Investor, password?: string) => void;
  onDeleteInvestor?: (id: string) => void;
  onUpdateAccount?: (account: Account) => void;
}

const POOL_MEMBER_PALETTE = [
  { bar: 'bg-sky-500', text: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-50 dark:bg-sky-900/30' },
  { bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/30' },
  { bar: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-900/30' },
  { bar: 'bg-teal-500', text: 'text-teal-600 dark:text-teal-400', bg: 'bg-teal-50 dark:bg-teal-900/30' },
  { bar: 'bg-violet-500', text: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-900/30' },
];

type HistoryFilter = 'ALL' | 'DEPOSIT' | 'PAYOUT' | 'PROFIT';
type PeriodMode = 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM';

type HistoryOp = {
  id: string; date: string; amount: number;
  opType: 'DEPOSIT' | 'PAYOUT' | 'PROFIT';
  title: string;
  productName?: string; customerId?: string; customerName?: string;
  paymentAmount?: number; payoutType?: string; expenseTitle?: string;
};

const todayStr = () => new Date().toISOString().split('T')[0];
const weekAgoStr = () => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0]; };
const monthStartStr = () => { const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]; };

const InvestorDetails: React.FC<InvestorDetailsProps> = ({
  investor, investors, account, sales, expenses, customers, appSettings, onBack, onUpdateInvestor, onDeleteInvestor, onUpdateAccount
}) => {
  const currentSharePercent = useMemo(() => {
    const share = getAccountShares(account, investors).find(m => m.investor.id === investor.id);
    return share ? share.percentage : 0;
  }, [account, investors, investor.id]);

  const [activeTab, setActiveTab] = useState<'INFO' | 'HISTORY'>('INFO');
  const [expandedOpId, setExpandedOpId] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('ALL');

  const [periodMode, setPeriodMode] = useState<PeriodMode>('MONTH');
  const [customPeriod, setCustomPeriod] = useState({ start: monthStartStr(), end: todayStr() });

  const period = useMemo(() => {
    if (periodMode === 'TODAY') return { start: todayStr(), end: todayStr() };
    if (periodMode === 'WEEK') return { start: weekAgoStr(), end: todayStr() };
    if (periodMode === 'MONTH') return { start: monthStartStr(), end: todayStr() };
    return customPeriod;
  }, [periodMode, customPeriod]);

  const [showProfitDetails, setShowProfitDetails] = useState(false);
  const [profitDetailsTab, setProfitDetailsTab] = useState<'accruals' | 'payouts'>('accruals');
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Edit modal state
  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editProfit, setEditProfit] = useState('');
  const [editLeftDate, setEditLeftDate] = useState('');

  // Investment periods state
  const [showNewPeriod, setShowNewPeriod] = useState(false);
  const [newPeriodDate, setNewPeriodDate] = useState(todayStr());
  const [newPeriodAmount, setNewPeriodAmount] = useState('');
  const [newPeriodNote, setNewPeriodNote] = useState('');

  // Loss events state
  const [showNewLoss, setShowNewLoss] = useState(false);
  const [lossDate, setLossDate] = useState(todayStr());
  const [lossAmount, setLossAmount] = useState('');
  const [lossDesc, setLossDesc] = useState('');
  const [expandedLossId, setExpandedLossId] = useState<string | null>(null);

  const isPoolMember = account?.type === 'POOL';

  // Все периоды инвестора (с миграцией legacy → periods)
  const allPeriods = useMemo((): InvestmentPeriod[] => {
    if (investor.investmentPeriods && investor.investmentPeriods.length > 0) {
      return [...investor.investmentPeriods].sort((a, b) => new Date(a.joinedDate).getTime() - new Date(b.joinedDate).getTime());
    }
    return [{
      id: 'legacy',
      joinedDate: investor.joinedDate,
      leftPoolDate: investor.leftPoolDate,
      initialAmount: investor.initialAmount,
    }];
  }, [investor]);

  const latestPeriod = allPeriods[allPeriods.length - 1];
  const isCurrentlyActive = !latestPeriod.leftPoolDate || new Date(latestPeriod.leftPoolDate) > new Date();
  const canReenter = isPoolMember && !isCurrentlyActive;

  const isExited = isPoolMember && !isCurrentlyActive && !!latestPeriod.leftPoolDate && new Date(latestPeriod.leftPoolDate) <= new Date();
  const willExit = isPoolMember && !!latestPeriod.leftPoolDate && new Date(latestPeriod.leftPoolDate) > new Date();

  const openEdit = () => {
    setEditName(investor.name);
    setEditPhone(investor.phone || '');
    setEditEmail(investor.email || '');
    setEditPassword('');
    setEditProfit(investor.profitPercentage.toString());
    setEditLeftDate((investor.leftPoolDate || '').split('T')[0]);
    setShowEdit(true);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim() || !onUpdateInvestor) return;

    const originalLeftStr = (investor.leftPoolDate || '').split('T')[0];
    const leftPoolDate = !editLeftDate
      ? undefined
      : editLeftDate !== originalLeftStr
        ? new Date(editLeftDate).toISOString()
        : investor.leftPoolDate;

    onUpdateInvestor({
      ...investor,
      name: editName.trim(),
      phone: editPhone,
      email: editEmail,
      profitPercentage: Number(editProfit),
      leftPoolDate,
    }, editPassword || undefined);
    setShowEdit(false);
  };

  const handleDelete = () => {
    onDeleteInvestor?.(investor.id);
    onBack();
  };

  const handleAddPeriod = () => {
    if (!newPeriodDate || !newPeriodAmount || !onUpdateInvestor) return;
    const newPeriod: InvestmentPeriod = {
      id: `period_${Date.now()}`,
      joinedDate: new Date(newPeriodDate).toISOString(),
      initialAmount: Number(newPeriodAmount),
      note: newPeriodNote || undefined,
    };
    // Migrate legacy → periods if needed, then append new period
    const existing = investor.investmentPeriods && investor.investmentPeriods.length > 0
      ? investor.investmentPeriods
      : [{ id: 'legacy', joinedDate: investor.joinedDate, leftPoolDate: investor.leftPoolDate, initialAmount: investor.initialAmount }];
    onUpdateInvestor({ ...investor, investmentPeriods: [...existing, newPeriod], leftPoolDate: undefined });
    setShowNewPeriod(false);
    setNewPeriodDate(todayStr());
    setNewPeriodAmount('');
    setNewPeriodNote('');
  };

  const handleAddLoss = () => {
    if (!lossDate || !lossAmount || !account || !onUpdateAccount) return;
    const event: LossEvent = {
      id: `loss_${Date.now()}`,
      date: lossDate,
      amount: Number(lossAmount),
      description: lossDesc,
    };
    onUpdateAccount({ ...account, lossEvents: [...(account.lossEvents || []), event] });
    setShowNewLoss(false);
    setLossDate(todayStr());
    setLossAmount('');
    setLossDesc('');
  };

  const handleDeleteLoss = (lossId: string) => {
    if (!account || !onUpdateAccount) return;
    onUpdateAccount({ ...account, lossEvents: (account.lossEvents || []).filter(e => e.id !== lossId) });
  };

  const balance = useMemo(() => {
    if (!account) return 0;
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
    return sales
      .filter(s => s.accountId === account.id && (s.status === 'ACTIVE' || s.status === 'DRAFT') && s.buyPrice > 0 && s.totalAmount > 0)
      .reduce((sum, sale) => {
        const profitMargin = (sale.totalAmount - sale.buyPrice) / sale.totalAmount;
        return sum + (sale.remainingAmount * profitMargin * currentSharePercent / 100);
      }, 0);
  }, [sales, account, currentSharePercent]);

  const { totalProfitEarned, totalProfitWithdrawn, profitAccruals } = useMemo(() => {
    if (!account) return { totalProfitEarned: 0, totalProfitWithdrawn: 0, profitAccruals: [] };

    const investorSales = sales.filter(s => s.accountId === account.id && s.buyPrice > 0);
    let profitSum = 0;
    const accruals: {
      id: string; date: string; amount: number; source: string;
      productName: string; customerId: string; paymentAmount: number;
    }[] = [];

    investorSales.forEach(sale => {
      const totalSaleProfit = sale.totalAmount - sale.buyPrice;
      if (sale.totalAmount <= 0 || totalSaleProfit <= 0) return;
      const profitMargin = totalSaleProfit / sale.totalAmount;

      const allPayments: (Payment | { date: string; amount: number; id: string; isRealPayment?: boolean })[] = [
        { date: sale.startDate, amount: sale.downPayment, id: `${sale.id}_dp`, isRealPayment: true },
        ...sale.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false)
      ];

      allPayments.forEach(p => {
        if (p.amount > 0) {
          const share = getAccountShares(account, investors, p.date).find(m => m.investor.id === investor.id);
          const myPercent = share ? share.percentage : 0;
          if (myPercent <= 0) return;
          const profitFromPayment = p.amount * profitMargin * myPercent / 100;
          profitSum += profitFromPayment;
          accruals.push({
            id: p.id, date: p.date, amount: profitFromPayment,
            source: `Платеж по '${sale.productName}'`,
            productName: sale.productName,
            customerId: sale.customerId,
            paymentAmount: p.amount,
          });
        }
      });
    });

    const withdrawnSum = expenses
      .filter(e => e.accountId === account.id && e.payoutType === 'PROFIT' && (!e.investorId || e.investorId === investor.id))
      .reduce((sum, e) => sum + e.amount, 0);

    return {
      totalProfitEarned: profitSum,
      totalProfitWithdrawn: withdrawnSum,
      profitAccruals: accruals.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    };
  }, [sales, expenses, account, investor.id, investors]);

  const { periodProfit, periodPaidOut } = useMemo(() => {
    const startDate = new Date(period.start);
    const endDate = new Date(period.end);
    endDate.setHours(23, 59, 59, 999);

    const profit = profitAccruals
      .filter(p => { const d = new Date(p.date); return d >= startDate && d <= endDate; })
      .reduce((sum, p) => sum + p.amount, 0);

    const paidOut = expenses
      .filter(e => e.accountId === account?.id && (!e.investorId || e.investorId === investor.id) &&
        (e.category === 'Выплата инвестору' || e.category === 'Investment Return'))
      .filter(e => { const d = new Date(e.date); return d >= startDate && d <= endDate; })
      .reduce((sum, e) => sum + e.amount, 0);

    return { periodProfit: profit, periodPaidOut: paidOut };
  }, [period, profitAccruals, expenses, account, investor.id]);

  const profitWithdrawals = useMemo(() => {
    return expenses
      .filter(e => e.accountId === account?.id && e.payoutType === 'PROFIT' && (!e.investorId || e.investorId === investor.id))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [expenses, account, investor.id]);

  // Loss events with this investor's share (capital-based, Islamic principle)
  const lossData = useMemo(() => {
    if (!account || !isPoolMember) return { events: [], totalMyLoss: 0 };
    const events = (account.lossEvents || []).map(ev => {
      const shares = getCapitalShares(account, investors, ev.date);
      const myShare = shares.find(s => s.investor.id === investor.id);
      return { ...ev, myLoss: myShare ? ev.amount * myShare.percentage / 100 : 0, myPercent: myShare?.percentage ?? 0 };
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return { events, totalMyLoss: events.reduce((s, e) => s + e.myLoss, 0) };
  }, [account, investors, investor.id, isPoolMember]);

  const poolComposition = useMemo(() => {
    if (!account || account.type !== 'POOL') return null;
    const allMembers = (account.poolMemberIds || [])
      .map(id => investors.find(i => i.id === id))
      .filter((i): i is Investor => !!i);
    const nowMs = Date.now();
    const activeMembers = allMembers.filter(m => getActivePeriodAt(m, nowMs) !== null);
    const totalCapital = activeMembers.reduce((sum, m) => {
      const p = getActivePeriodAt(m, nowMs);
      return sum + (p ? p.initialAmount : 0);
    }, 0);
    const mgrPercent = getManagerSharePercent(account, investors);
    const rows = allMembers.map((m, idx) => {
      const activePeriod = getActivePeriodAt(m, nowMs);
      const isActive = activePeriod !== null;
      const amount = activePeriod ? activePeriod.initialAmount : 0;
      const capitalShare = (isActive && totalCapital > 0) ? amount / totalCapital * 100 : 0;
      const profitShare = getAccountShares(account, investors).find(s => s.investor.id === m.id)?.percentage ?? 0;
      return { investor: m, capitalShare, profitShare, isActive, palette: POOL_MEMBER_PALETTE[idx % POOL_MEMBER_PALETTE.length] };
    });
    const myActivePeriod = getActivePeriodAt(investor, nowMs);
    const myAmount = myActivePeriod ? myActivePeriod.initialAmount : 0;
    const myCapitalShare = (myActivePeriod !== null && totalCapital > 0) ? myAmount / totalCapital * 100 : 0;
    return { rows, totalCapital, mgrPercent, myCapitalShare };
  }, [account, investors, investor]);

  const history = useMemo((): HistoryOp[] => {
    if (!account) return [];
    const ops: HistoryOp[] = [];

    sales
      .filter(s => s.accountId === account.id
        && (s.productName === 'Начальный депозит' || s.productName === 'Депозит инвестора'))
      .forEach(s => ops.push({
        id: s.id, date: s.startDate, amount: s.totalAmount,
        opType: 'DEPOSIT', title: s.productName,
      }));

    expenses
      .filter(e => e.accountId === account.id && (!e.investorId || e.investorId === investor.id) &&
        (e.category === 'Выплата инвестору' || e.category === 'Investment Return'))
      .forEach(e => ops.push({
        id: e.id, date: e.date, amount: e.amount,
        opType: 'PAYOUT',
        title: e.payoutType === 'INVESTMENT' ? 'Возврат инвестиций' : 'Выплата прибыли',
        payoutType: e.payoutType,
        expenseTitle: e.title,
      }));

    profitAccruals.forEach(p => {
      const customerName = customers.find(c => c.id === p.customerId)?.name || '';
      ops.push({
        id: `profit_${p.id}`, date: p.date, amount: p.amount,
        opType: 'PROFIT', title: p.productName,
        productName: p.productName, customerId: p.customerId,
        customerName, paymentAmount: p.paymentAmount,
      });
    });

    return ops.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [sales, expenses, account, investor.id, profitAccruals, customers]);

  const filteredHistory = useMemo(() =>
    historyFilter === 'ALL' ? history : history.filter(op => op.opType === historyFilter),
    [history, historyFilter]);

  const FILTER_CONFIG: { key: HistoryFilter; label: string; activeClass: string; inactiveClass: string }[] = [
    { key: 'ALL', label: 'Все', activeClass: 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900', inactiveClass: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
    { key: 'PROFIT', label: 'Прибыль', activeClass: 'bg-emerald-600 text-white', inactiveClass: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
    { key: 'PAYOUT', label: 'Выплаты', activeClass: 'bg-red-600 text-white', inactiveClass: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
    { key: 'DEPOSIT', label: 'Взносы', activeClass: 'bg-indigo-600 text-white', inactiveClass: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' },
  ];

  const PERIOD_CONFIG: { key: PeriodMode; label: string }[] = [
    { key: 'TODAY', label: 'Сегодня' },
    { key: 'WEEK', label: 'Неделя' },
    { key: 'MONTH', label: 'Месяц' },
    { key: 'CUSTOM', label: 'Свой' },
  ];

  return (
    <div className="space-y-4 animate-fade-in pb-20">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 pb-4 bg-white dark:bg-slate-900 sticky top-0 z-10 pt-2">
        <button onClick={onBack} className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white shrink-0 p-1">{ICONS.Back}</button>
        <h2 className="text-xl font-bold text-slate-800 dark:text-white flex-1 truncate">{investor.name}</h2>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-700">
        <button onClick={() => setActiveTab('INFO')} className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'INFO' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 dark:text-slate-400'}`}>Детали и Прибыль</button>
        <button onClick={() => setActiveTab('HISTORY')} className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'HISTORY' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 dark:text-slate-400'}`}>Все операции</button>
      </div>

      {/* INFO TAB */}
      {activeTab === 'INFO' && (
        <div className="space-y-4 pt-2">
          {/* Basic info */}
          <div className="bg-white dark:bg-slate-800 rounded-xl p-5 shadow-sm border border-slate-100 dark:border-slate-700 space-y-4" onClick={() => showActionMenu && setShowActionMenu(false)}>
            <div className="flex items-center gap-4 border-b border-slate-50 dark:border-slate-700 pb-4">
              <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-full flex items-center justify-center text-2xl font-bold shrink-0">{investor.name.charAt(0)}</div>
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-lg text-slate-800 dark:text-white truncate">{investor.name}</h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm truncate">{investor.email}</p>
                {isExited && <span className="inline-flex items-center gap-1 text-xs bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full mt-1">Вышел из пула · {new Date(latestPeriod.leftPoolDate!).toLocaleDateString()}</span>}
                {willExit && <span className="inline-flex items-center gap-1 text-xs bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400 px-2 py-0.5 rounded-full mt-1">Выйдет · {new Date(latestPeriod.leftPoolDate!).toLocaleDateString()}</span>}
                {!isExited && !willExit && isPoolMember && <span className="inline-flex items-center gap-1 text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full mt-1">● Активный участник пула</span>}
              </div>
              {(onUpdateInvestor || onDeleteInvestor) && (
                <div className="relative shrink-0">
                  <button onClick={e => { e.stopPropagation(); setShowActionMenu(v => !v); }}
                    className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
                    {ICONS.More}
                  </button>
                  {showActionMenu && (
                    <div className="absolute right-0 top-10 bg-white dark:bg-slate-800 shadow-xl border border-slate-100 dark:border-slate-700 rounded-xl z-30 w-44 overflow-hidden animate-fade-in">
                      {onUpdateInvestor && (
                        <button onClick={e => { e.stopPropagation(); setShowActionMenu(false); openEdit(); }}
                          className="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2.5 transition-colors">
                          <span className="text-indigo-500">{ICONS.Edit}</span>
                          Редактировать
                        </button>
                      )}
                      {onDeleteInvestor && (
                        <button onClick={e => { e.stopPropagation(); setShowActionMenu(false); setShowDeleteConfirm(true); }}
                          className="w-full text-left px-4 py-3 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2.5 transition-colors border-t border-slate-100 dark:border-slate-700">
                          <span>{ICONS.Delete}</span>
                          Удалить
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="text-xs text-slate-400 uppercase">Телефон</label><p className="font-medium text-slate-800 dark:text-white">{investor.phone || '-'}</p></div>
              <div><label className="text-xs text-slate-400 uppercase">Дата регистрации</label><p className="font-medium text-slate-800 dark:text-white">{new Date(investor.joinedDate).toLocaleDateString()}</p></div>
              <div><label className="text-xs text-slate-400 uppercase">{isPoolMember ? 'Вложено в пул' : 'Баланс инвестиций'}</label><p className="font-semibold text-slate-700 dark:text-slate-300">{formatCurrency(isPoolMember ? latestPeriod.initialAmount : investor.initialAmount, appSettings.showCents)} ₽</p></div>
              <div><label className="text-xs text-slate-400 uppercase">Доля прибыли</label><p className="font-semibold text-indigo-600 dark:text-indigo-400">{Math.round(currentSharePercent * 10) / 10}%</p></div>
              {isPoolMember && poolComposition && <div><label className="text-xs text-slate-400 uppercase">Доля капитала</label><p className="font-semibold text-purple-600 dark:text-purple-400">{Math.round(poolComposition.myCapitalShare * 10) / 10}%</p></div>}
            </div>
            <div className="pt-2">
              <label className="text-xs text-slate-400 uppercase">{isPoolMember ? 'Баланс пула (общий)' : 'Текущий баланс счета'}</label>
              <p className="text-3xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">{formatCurrency(balance, appSettings.showCents)} ₽</p>
              {isPoolMember && poolComposition && poolComposition.myCapitalShare > 0 && <p className="text-sm font-semibold text-purple-600 dark:text-purple-400 mt-1">Ваша доля: ~{formatCurrency(balance * poolComposition.myCapitalShare / 100, appSettings.showCents)} ₽</p>}
              {isPoolMember && <p className="text-xs text-slate-400 mt-1">Общая касса пула — включает деньги всех участников</p>}
            </div>
          </div>

          {/* Pool composition */}
          {isPoolMember && poolComposition && (
            <div className="bg-white dark:bg-slate-800 rounded-xl p-5 shadow-sm border border-slate-100 dark:border-slate-700 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
                <div>
                  <h3 className="font-bold text-slate-800 dark:text-white">Состав пула</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Общий капитал: {formatCurrency(poolComposition.totalCapital, appSettings.showCents)} ₽</p>
                </div>
                <span className="text-xs font-semibold bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-700 dark:text-fuchsia-400 px-2 py-1 rounded-full">{poolComposition.rows.length} участн.</span>
              </div>
              <div className="flex items-center gap-3 py-1">
                <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-xs font-bold text-emerald-600 dark:text-emerald-400 shrink-0">М</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Менеджер</span>
                    <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{Math.round(poolComposition.mgrPercent * 10) / 10}% приб.</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-1.5">
                    <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${Math.min(poolComposition.mgrPercent, 100)}%` }} />
                  </div>
                </div>
              </div>
              {poolComposition.rows.map(({ investor: m, capitalShare, profitShare, isActive, palette }) => (
                <div key={m.id} className={`flex items-center gap-3 py-1 rounded-xl transition-colors ${m.id === investor.id ? 'bg-slate-50 dark:bg-slate-700/50 -mx-2 px-2' : ''}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${palette.bg} ${palette.text}`}>{m.name.charAt(0)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={`text-sm truncate ${m.id === investor.id ? 'font-bold text-slate-900 dark:text-white' : 'font-medium text-slate-700 dark:text-slate-300'}`}>{m.name}</span>
                        {m.id === investor.id && <span className="text-xs bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded-full shrink-0">вы</span>}
                        {!isActive && <span className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-500 px-1.5 py-0.5 rounded-full shrink-0">вышел</span>}
                      </div>
                      <div className="flex items-center gap-3 ml-2 shrink-0">
                        <span className="text-xs text-slate-400">{Math.round(capitalShare * 10) / 10}% кап.</span>
                        <span className={`text-sm font-bold ${palette.text}`}>{Math.round(profitShare * 10) / 10}% приб.</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-100 dark:bg-slate-700 rounded-full h-1.5">
                        <div className={`${palette.bar} h-1.5 rounded-full`} style={{ width: `${Math.min(capitalShare, 100)}%` }} />
                      </div>
                      <span className="text-xs text-slate-400 shrink-0">{formatCurrency(m.initialAmount, false)} ₽</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Profit cards */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-100 dark:border-slate-700">
              <h3 className="font-bold text-sm text-slate-800 dark:text-white mb-1">Ожидаемая прибыль</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">С активных договоров</p>
              <p className="text-xl font-bold text-indigo-800 dark:text-indigo-400">{formatCurrency(expectedTotalProfit, appSettings.showCents)} ₽</p>
            </div>
            <div onClick={() => setShowProfitDetails(true)} className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-100 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700">
              <h3 className="font-bold text-sm text-slate-800 dark:text-white mb-1">К выплате</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Начислено − выплачено</p>
              <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400">{formatCurrency(totalProfitEarned - totalProfitWithdrawn, appSettings.showCents)} ₽</p>
            </div>
          </div>
          {/* Investment periods */}
          {isPoolMember && (
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
                <div>
                  <h3 className="font-bold text-slate-800 dark:text-white">Периоды инвестирования</h3>
                  <p className="text-xs text-slate-400 mt-0.5">{allPeriods.length} {allPeriods.length === 1 ? 'период' : 'периода'}</p>
                </div>
                {canReenter && onUpdateInvestor && (
                  <button onClick={() => setShowNewPeriod(v => !v)}
                    className="text-xs font-bold px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                    + Повторный вход
                  </button>
                )}
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {allPeriods.map((p, idx) => {
                  const isActive = !p.leftPoolDate || new Date(p.leftPoolDate) > new Date();
                  const isFuture = !!p.leftPoolDate && new Date(p.leftPoolDate) > new Date();
                  return (
                    <div key={p.id} className="px-5 py-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                        <div>
                          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                            Период {idx + 1}
                            {p.note && <span className="text-xs text-slate-400 ml-2">{p.note}</span>}
                          </p>
                          <p className="text-xs text-slate-400">
                            {new Date(p.joinedDate).toLocaleDateString()}
                            {p.leftPoolDate && ` → ${isFuture ? '(выйдет) ' : ''}${new Date(p.leftPoolDate).toLocaleDateString()}`}
                            {!p.leftPoolDate && ' → сейчас'}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-slate-800 dark:text-white">{formatCurrency(p.initialAmount, false)} ₽</p>
                        {isActive && <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">активен</span>}
                        {!isActive && <span className="text-[10px] text-slate-400">завершён</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              {showNewPeriod && (
                <div className="px-5 py-4 bg-indigo-50 dark:bg-indigo-900/20 border-t border-indigo-100 dark:border-indigo-900/40 space-y-3 animate-fade-in">
                  <p className="text-sm font-bold text-indigo-700 dark:text-indigo-400">Новый период участия</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-500 mb-1 block">Дата входа</label>
                      <input type="date" className="w-full p-2.5 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-lg text-sm" value={newPeriodDate} onChange={e => setNewPeriodDate(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 mb-1 block">Сумма вложения</label>
                      <div className="relative">
                        <span className="absolute right-3 top-2.5 text-slate-400 text-xs">₽</span>
                        <input type="number" placeholder="0" className="w-full p-2.5 pr-7 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-lg text-sm font-bold" value={newPeriodAmount} onChange={e => setNewPeriodAmount(e.target.value)} />
                      </div>
                    </div>
                  </div>
                  <input placeholder="Примечание (необязательно)" className="w-full p-2.5 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-lg text-sm" value={newPeriodNote} onChange={e => setNewPeriodNote(e.target.value)} />
                  <div className="flex gap-2">
                    <button onClick={() => setShowNewPeriod(false)} className="flex-1 py-2 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-sm font-medium">Отмена</button>
                    <button onClick={handleAddPeriod} disabled={!newPeriodDate || !newPeriodAmount} className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold disabled:opacity-50">Добавить</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Loss events (Islamic: al-ghunm bil-ghurm) */}
          {isPoolMember && (lossData.events.length > 0 || onUpdateAccount) && (
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
                <div>
                  <h3 className="font-bold text-slate-800 dark:text-white">Убытки пула</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Аль-гунм биль-гурм · пропорционально капиталу</p>
                </div>
                {onUpdateAccount && (
                  <button onClick={() => setShowNewLoss(v => !v)}
                    className="text-xs font-bold px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">
                    + Убыток
                  </button>
                )}
              </div>

              {lossData.events.length === 0 && !showNewLoss && (
                <p className="text-center text-slate-400 text-sm py-6">Убытков нет</p>
              )}

              {lossData.events.map(ev => (
                <div key={ev.id} className="border-b border-slate-100 dark:border-slate-700 last:border-0">
                  <div className="px-5 py-3 flex items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700"
                    onClick={() => setExpandedLossId(expandedLossId === ev.id ? null : ev.id)}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">{ev.description}</p>
                      <p className="text-xs text-slate-400">{new Date(ev.date).toLocaleDateString()} · {Math.round(ev.myPercent * 10) / 10}% кап.</p>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className="text-sm font-bold text-red-600 dark:text-red-400">−{formatCurrency(ev.myLoss, appSettings.showCents)} ₽</p>
                      <p className="text-xs text-slate-400">из {formatCurrency(ev.amount, false)} ₽</p>
                    </div>
                  </div>
                  {expandedLossId === ev.id && (
                    <div className="px-5 pb-3 bg-red-50 dark:bg-red-900/10 animate-fade-in">
                      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
                        <span>Полный убыток пула: <b className="text-slate-700 dark:text-slate-300">{formatCurrency(ev.amount, false)} ₽</b></span>
                        <span>Доля капитала: <b>{Math.round(ev.myPercent * 10) / 10}%</b></span>
                      </div>
                      <div className="flex items-center justify-between text-sm font-bold">
                        <span className="text-slate-600 dark:text-slate-300">Ваш убыток:</span>
                        <span className="text-red-600 dark:text-red-400">−{formatCurrency(ev.myLoss, appSettings.showCents)} ₽</span>
                      </div>
                      {onUpdateAccount && (
                        <button onClick={() => handleDeleteLoss(ev.id)} className="mt-2 text-xs text-red-500 hover:text-red-700 underline">Удалить запись</button>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {lossData.events.length > 0 && (
                <div className="px-5 py-3 bg-red-50 dark:bg-red-900/10 flex items-center justify-between">
                  <span className="text-sm text-slate-600 dark:text-slate-400 font-medium">Итого ущерб инвестора:</span>
                  <span className="text-lg font-bold text-red-700 dark:text-red-400">−{formatCurrency(lossData.totalMyLoss, appSettings.showCents)} ₽</span>
                </div>
              )}

              {showNewLoss && (
                <div className="px-5 py-4 bg-red-50 dark:bg-red-900/20 border-t border-red-100 dark:border-red-900/40 space-y-3 animate-fade-in">
                  <p className="text-sm font-bold text-red-700 dark:text-red-400">Новый убыток пула</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-500 mb-1 block">Дата убытка</label>
                      <input type="date" className="w-full p-2.5 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-lg text-sm" value={lossDate} onChange={e => setLossDate(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 mb-1 block">Сумма убытка</label>
                      <div className="relative">
                        <span className="absolute right-3 top-2.5 text-slate-400 text-xs">₽</span>
                        <input type="number" placeholder="0" className="w-full p-2.5 pr-7 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-lg text-sm font-bold" value={lossAmount} onChange={e => setLossAmount(e.target.value)} />
                      </div>
                    </div>
                  </div>
                  <input placeholder="Описание (дефолт по договору, кража и т.д.)" className="w-full p-2.5 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-lg text-sm" value={lossDesc} onChange={e => setLossDesc(e.target.value)} />
                  <div className="flex gap-2">
                    <button onClick={() => setShowNewLoss(false)} className="flex-1 py-2 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-sm font-medium">Отмена</button>
                    <button onClick={handleAddLoss} disabled={!lossDate || !lossAmount} className="flex-1 py-2 bg-red-600 text-white rounded-lg text-sm font-bold disabled:opacity-50">Добавить</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Period block */}
          <div className="bg-white dark:bg-slate-800 rounded-xl p-5 shadow-sm border border-slate-100 dark:border-slate-700 space-y-4">
            <h3 className="font-bold text-slate-800 dark:text-white">Прибыль за период</h3>
            <div className="flex gap-2">
              {PERIOD_CONFIG.map(({ key, label }) => (
                <button key={key} onClick={() => setPeriodMode(key)}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors ${periodMode === key ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                  {label}
                </button>
              ))}
            </div>
            {periodMode === 'CUSTOM' && (
              <div className="grid grid-cols-2 gap-3 animate-fade-in">
                <div>
                  <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Начало</label>
                  <input type="date" className="w-full p-2 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-lg" value={customPeriod.start} onChange={e => setCustomPeriod(p => ({ ...p, start: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Конец</label>
                  <input type="date" className="w-full p-2 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-lg" value={customPeriod.end} onChange={e => setCustomPeriod(p => ({ ...p, end: e.target.value }))} />
                </div>
              </div>
            )}
            <p className="text-xs text-slate-400 text-center">
              {period.start === period.end
                ? new Date(period.start).toLocaleDateString()
                : `${new Date(period.start).toLocaleDateString()} — ${new Date(period.end).toLocaleDateString()}`}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-emerald-50 dark:bg-emerald-900/30 p-4 rounded-xl text-center">
                <p className="text-xs text-emerald-700 dark:text-emerald-400 mb-1 font-medium">Получено</p>
                <p className="text-2xl font-bold text-emerald-800 dark:text-emerald-400">{formatCurrency(periodProfit, appSettings.showCents)} ₽</p>
              </div>
              <div className="bg-red-50 dark:bg-red-900/30 p-4 rounded-xl text-center">
                <p className="text-xs text-red-700 dark:text-red-400 mb-1 font-medium">Выплачено</p>
                <p className="text-2xl font-bold text-red-700 dark:text-red-400">{formatCurrency(periodPaidOut, appSettings.showCents)} ₽</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* HISTORY TAB */}
      {activeTab === 'HISTORY' && (
        <div className="space-y-3 pt-2">
          <div className="flex gap-2 flex-wrap">
            {FILTER_CONFIG.map(({ key, label, activeClass, inactiveClass }) => {
              const count = key === 'ALL' ? history.length : history.filter(op => op.opType === key).length;
              return (
                <button key={key} onClick={() => { setHistoryFilter(key); setExpandedOpId(null); }}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${historyFilter === key ? activeClass : inactiveClass}`}>
                  {label} {count > 0 && <span className="opacity-75">({count})</span>}
                </button>
              );
            })}
          </div>

          {filteredHistory.length === 0 && (
            <div className="text-center py-10 text-slate-400">Нет операций</div>
          )}

          {filteredHistory.map(op => {
            const isProfit = op.opType === 'PROFIT';
            const isDeposit = op.opType === 'DEPOSIT';
            const isPayout = op.opType === 'PAYOUT';
            const isExpanded = expandedOpId === op.id;

            return (
              <div key={op.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                <div className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700"
                  onClick={() => setExpandedOpId(isExpanded ? null : op.id)}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`p-2 rounded-full shrink-0 ${
                      isProfit ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' :
                      isDeposit ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' :
                      'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                    }`}>
                      {isPayout ? ICONS.Expense : ICONS.Income}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-800 dark:text-white text-sm truncate">{op.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{new Date(op.date).toLocaleDateString()}</p>
                      {isProfit && op.customerName && <p className="text-xs text-slate-400 truncate">{op.customerName}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <div className="text-right">
                      <p className={`font-bold text-sm ${isPayout ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {isPayout ? '−' : '+'}{formatCurrency(op.amount, appSettings.showCents)} ₽
                      </p>
                      {isProfit && op.paymentAmount && <p className="text-xs text-slate-400">взнос {formatCurrency(op.paymentAmount, false)} ₽</p>}
                    </div>
                    <span className={`text-slate-300 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                    </span>
                  </div>
                </div>
                {isExpanded && (
                  <div className="bg-slate-50 dark:bg-slate-900 p-4 border-t border-slate-100 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 space-y-2 animate-fade-in">
                    {isDeposit && (
                      <>
                        <div className="flex justify-between"><span className="text-slate-400">Тип:</span><span className="font-medium">Пополнение счёта</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Сумма:</span><span className="font-medium text-indigo-600 dark:text-indigo-400">+{formatCurrency(op.amount, appSettings.showCents)} ₽</span></div>
                      </>
                    )}
                    {isPayout && (
                      <>
                        <div className="flex justify-between"><span className="text-slate-400">Тип выплаты:</span><span className="font-medium">{op.payoutType === 'INVESTMENT' ? 'Возврат инвестиций' : 'Выплата прибыли'}</span></div>
                        {op.expenseTitle && <div className="flex justify-between"><span className="text-slate-400">Примечание:</span><span className="font-medium">{op.expenseTitle}</span></div>}
                        <div className="flex justify-between"><span className="text-slate-400">Сумма:</span><span className="font-medium text-red-600 dark:text-red-400">−{formatCurrency(op.amount, appSettings.showCents)} ₽</span></div>
                      </>
                    )}
                    {isProfit && (
                      <>
                        <div className="flex justify-between"><span className="text-slate-400">Товар:</span><span className="font-medium">{op.productName}</span></div>
                        {op.customerName && <div className="flex justify-between"><span className="text-slate-400">Клиент:</span><span className="font-medium">{op.customerName}</span></div>}
                        <div className="flex justify-between"><span className="text-slate-400">Платёж клиента:</span><span className="font-medium">{formatCurrency(op.paymentAmount, appSettings.showCents)} ₽</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Прибыль инвестора:</span><span className="font-medium text-emerald-600 dark:text-emerald-400">+{formatCurrency(op.amount, appSettings.showCents)} ₽</span></div>
                        {op.paymentAmount && <div className="flex justify-between"><span className="text-slate-400">Доля от платежа:</span><span className="font-medium">{Math.round(op.amount / op.paymentAmount * 1000) / 10}%</span></div>}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Profit detail modal */}
      {showProfitDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={() => setShowProfitDetails(false)}>
          <div className="bg-white dark:bg-slate-800 w-full max-w-md rounded-2xl shadow-2xl flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-lg font-bold text-slate-800 dark:text-white">Детализация прибыли</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">К выплате: <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(totalProfitEarned - totalProfitWithdrawn, appSettings.showCents)} ₽</span></p>
            </div>
            <div className="flex border-b border-slate-200 dark:border-slate-700 px-2">
              <button onClick={() => setProfitDetailsTab('accruals')} className={`flex-1 py-3 text-sm font-semibold transition-colors ${profitDetailsTab === 'accruals' ? 'text-emerald-600 dark:text-emerald-400 border-b-2 border-emerald-600' : 'text-slate-500 dark:text-slate-400'}`}>Начисления</button>
              <button onClick={() => setProfitDetailsTab('payouts')} className={`flex-1 py-3 text-sm font-semibold transition-colors ${profitDetailsTab === 'payouts' ? 'text-red-600 dark:text-red-400 border-b-2 border-red-600' : 'text-slate-500 dark:text-slate-400'}`}>Выплаты</button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {profitDetailsTab === 'accruals' && (
                <div className="animate-fade-in space-y-2">
                  {profitAccruals.length === 0
                    ? <p className="text-center text-slate-400 py-4">Начислений нет</p>
                    : profitAccruals.map(p => (
                      <div key={p.id} className="flex justify-between items-center text-sm p-2 bg-emerald-50 dark:bg-emerald-900/30 rounded-lg">
                        <div className="flex flex-col min-w-0"><span className="text-slate-800 dark:text-white truncate">{p.source}</span><span className="text-xs text-slate-400">{new Date(p.date).toLocaleDateString()}</span></div>
                        <span className="font-bold text-emerald-600 dark:text-emerald-400 shrink-0 ml-2">+{formatCurrency(p.amount, appSettings.showCents)} ₽</span>
                      </div>
                    ))}
                </div>
              )}
              {profitDetailsTab === 'payouts' && (
                <div className="animate-fade-in space-y-2">
                  {profitWithdrawals.length === 0
                    ? <p className="text-center text-slate-400 py-4">Выплат нет</p>
                    : profitWithdrawals.map(e => (
                      <div key={e.id} className="flex justify-between items-center text-sm p-2 bg-red-50 dark:bg-red-900/30 rounded-lg">
                        <div className="flex flex-col"><span className="text-slate-800 dark:text-white">{e.title}</span><span className="text-xs text-slate-400">{new Date(e.date).toLocaleDateString()}</span></div>
                        <span className="font-bold text-red-600 dark:text-red-400 shrink-0 ml-2">−{formatCurrency(e.amount, appSettings.showCents)} ₽</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-slate-100 dark:border-slate-700">
              <button onClick={() => setShowProfitDetails(false)} className="w-full py-3 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600">Закрыть</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-fade-in" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="bg-red-50 dark:bg-red-900/20 p-6 text-center">
              <div className="w-16 h-16 bg-red-100 dark:bg-red-900/40 rounded-full flex items-center justify-center mx-auto mb-4 text-red-500 dark:text-red-400">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-1">Удалить инвестора?</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                <span className="font-semibold text-slate-700 dark:text-slate-300">{investor.name}</span> будет удалён без возможности восстановления. Его счёт и история также будут удалены.
              </p>
            </div>
            <div className="p-4 flex gap-3">
              <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
                Отмена
              </button>
              <button onClick={handleDelete} className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-colors">
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {showEdit && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={() => setShowEdit(false)}>
          <form onSubmit={handleEditSubmit} className="bg-white dark:bg-slate-800 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 space-y-4 animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
              <h3 className="text-lg font-bold text-slate-800 dark:text-white">Редактировать инвестора</h3>
              <button type="button" onClick={() => setShowEdit(false)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-xl leading-none">✕</button>
            </div>
            <input required placeholder="Имя Фамилия" className="w-full p-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none" value={editName} onChange={e => setEditName(e.target.value)} />
            <input placeholder="Телефон" className="w-full p-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none" value={editPhone} onChange={e => setEditPhone(e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <input type="email" placeholder="Email" className="w-full p-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none" value={editEmail} onChange={e => setEditEmail(e.target.value)} />
              <input type="text" placeholder="Новый пароль" className="w-full p-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none" value={editPassword} onChange={e => setEditPassword(e.target.value)} />
            </div>
            <div className="relative">
              <span className="absolute right-4 top-3.5 text-slate-400">%</span>
              <input required type="number" placeholder="Процент прибыли" className="w-full p-3 pr-8 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none font-bold" value={editProfit} onChange={e => setEditProfit(e.target.value)} />
            </div>
            {isPoolMember && (
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Дата выхода из пула (необязательно)</label>
                <input type="date" className="w-full p-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none" value={editLeftDate} onChange={e => setEditLeftDate(e.target.value)} />
                <p className="text-xs text-slate-400 mt-1">Оставьте пустым, если инвестор ещё активен.</p>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setShowEdit(false)} className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 rounded-xl font-medium text-slate-600 dark:text-slate-300">Отмена</button>
              <button type="submit" className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold">Сохранить</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default InvestorDetails;
