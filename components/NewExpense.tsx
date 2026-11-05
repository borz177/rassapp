import React, { useState, useEffect, useMemo, useRef } from 'react';
import TabPill from './TabPill';
import TopBarBack from './TopBarBack';
import { Account, Investor, Expense, User, Supplier, Sale, StockMovement, Product, RetailSale } from '../types';
import { supplierSupplyBalances } from '../src/supplierLedger';
import { ICONS } from '../constants';
import { getInvestorAccount, formatCurrency, accountInvestment } from '../src/utils';
import { SuccessCheck, hapticSuccess } from './feedback';
import { appConfirm } from '../src/dialogs';
import { dateFromInput, toInputDate } from '../src/saleMath';
import { expensePreview, expenseChoiceKey, canReturnOwnCapital, type ExpenseChoice } from '../src/expensePreview';
import ExpenseBeforeAfter from './ExpenseBeforeAfter';

interface NewExpenseProps {
  investors: Investor[];
  accounts: Account[];
  expenses?: Expense[]; // ← Добавлено для проверки дубликатов
  employees?: User[];
  suppliers?: Supplier[];
  sales?: Sale[];
  /** Приходы на склад и товары — чтобы оплату партнёру можно было привязать к приходу */
  movements?: StockMovement[];
  products?: Product[];
  showSupplierCategory?: boolean;
  appSettings?: any;
  retailSales?: RetailSale[];
  userId?: string;
  initialData?: {
    accountId?: string;
    supplierId?: string;
    saleId?: string;
    category?: string;
    title?: string;
    amount?: number;
    maxAmount?: number;
    /** Общий долг поставщику (договоры и поставки на склад) — подсказка при оплате из списка партнёров */
    supplierDebt?: number;
    /** Выплата закята из окна «Закят»: сразу из прибыли */
    fromProfit?: boolean;
    profitSource?: ExpenseChoice;
    /** Закят за инвестора: выплата инвестору из его прибыли */
    investorId?: string;
    payoutType?: 'INVESTMENT' | 'PROFIT';
    /** Комментарий, например «Закят» */
    description?: string;
  } | null;
  onClose: () => void;
  onSubmit: (data: any) => void;
  /** Свои категории из настроек — те же, что заводят в приходе */
  categories?: string[];
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

  const expenseDate = dateFromInput(date).toDateString();

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
  investors, accounts, expenses, employees, suppliers, sales, movements = [], products = [], showSupplierCategory, initialData, onClose, onSubmit
, categories = [], appSettings, retailSales = [], userId}) => {
  const employeeList: User[] = employees || [];
  const supplierList: Supplier[] = suppliers || [];
  const saleList: Sale[] = sales || [];
  const isSupplierPayment = !!initialData?.saleId;

  const [sourceType, setSourceType] = useState<'INVESTOR' | 'OTHER'>(initialData?.investorId ? 'INVESTOR' : 'OTHER');

  // Form States
  const [selectedInvestorId, setSelectedInvestorId] = useState(initialData?.investorId || '');
  const [sourceAccountId, setSourceAccountId] = useState(initialData?.accountId || '');
  const [amount, setAmount] = useState(initialData?.amount ? String(initialData.amount) : '');
  const [title, setTitle] = useState(initialData?.title || '');
  const [category, setCategory] = useState(initialData?.category || 'General');
  const [date, setDate] = useState(toInputDate(new Date()));
  // Комментарий к расходу (Expense.description): видно в «Все операции»
  const [comment, setComment] = useState(initialData?.description || '');
  const [payoutType, setPayoutType] = useState<'INVESTMENT' | 'PROFIT' | null>(initialData?.payoutType || null);
  const [managerPayoutSource, setManagerPayoutSource] = useState<'CAPITAL' | 'PROFIT' | null>(null);
  // Общий расход списывается из заработанной прибыли (делится по долям счёта)
  const [profitSource, setProfitSource] = useState<ExpenseChoice | null>(null);
  const [acceptNegative, setAcceptNegative] = useState(false);
  const [pendingSignature, setPendingSignature] = useState('');
  // Чью прибыль уменьшает: MANAGER — только менеджера, SHARED — общее дело (делится по долям)
  const ordinaryExpense = !isSupplierPayment && sourceType === 'OTHER' && category !== 'Моя выплата' && category !== 'Оплата партнёру';
  const fromProfit = ordinaryExpense && profitSource !== null;

  // 🔥 НОВЫЕ СТЕЙТЫ для защиты от дублей и подтверждения
  const [isSubmitting, setIsSubmitting] = useState(false);
  const saving = useRef(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  // Подтверждение списания: раньше окно просто закрывалось, и было непонятно,
  // прошла операция или нет — из-за этого расход проводили повторно.
  const [expenseDone, setExpenseDone] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [pendingExpenseData, setPendingExpenseData] = useState<any>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  // Со страницы партнёров приходят уже с поставщиком — выбирать его второй раз незачем.
  // У оплаты по конкретному договору (saleId) поставщик задан своим экраном.
  const [selectedSupplierId, setSelectedSupplierId] = useState(
    initialData?.supplierId && !initialData?.saleId ? initialData.supplierId : ''
  );
  const [selectedDebtSaleId, setSelectedDebtSaleId] = useState('');
  const [selectedSupplyDocId, setSelectedSupplyDocId] = useState('');

  const selectedInvestor = investors.find(i => i.id === selectedInvestorId);
  const selectedAccount = accounts.find(a => a.id === sourceAccountId);
  // Сколько своих денег осталось вложено в этот счёт — та же цифра, что на
  // карточке «Инвестировано» в кассе. Без неё «Из инвестиций» пришлось бы
  // выбирать вслепую, не зная, есть ли что возвращать.
  const investment = accountInvestment(selectedAccount, saleList, expenses || []);

  const previewOf = (data: any) => expensePreview({
    expense: { ...data, id: '__expense_preview__', userId: userId || '' },
    accounts, sales: saleList, expenses: expenses || [], investors, retailSales,
    profitFromPaymentsOnly: !!appSettings?.profitFromPaymentsOnly,
  });
  const readyForPreview = isSupplierPayment ? true
    : sourceType === 'INVESTOR' ? !!payoutType
    : category === 'Моя выплата' ? !!managerPayoutSource
    : category === 'Оплата партнёру' || !!profitSource;
  const formPreview = useMemo(() => {
    if (!readyForPreview || !sourceAccountId || !Number.isFinite(Number(amount)) || Number(amount) <= 0 || !date) return null;
    return previewOf({ amount:Number(amount), accountId:sourceAccountId, date:dateFromInput(date).toISOString(),
      category:isSupplierPayment?'Оплата партнёру':sourceType==='INVESTOR'?'Выплата инвестора':category,
      fromProfit:fromProfit || undefined, profitSource:fromProfit ? profitSource : undefined,
      managerPayoutSource:sourceType==='OTHER'&&category==='Моя выплата'?managerPayoutSource:undefined,
      investorId:sourceType==='INVESTOR'?selectedInvestorId:undefined, payoutType:sourceType==='INVESTOR'?payoutType:undefined,
    });
  },[readyForPreview,sourceAccountId,amount,date,category,fromProfit,profitSource,managerPayoutSource,sourceType,selectedInvestorId,payoutType,accounts,sales,expenses,investors,retailSales,appSettings?.profitFromPaymentsOnly]);
  const confirmPreview = useMemo(() => pendingExpenseData ? previewOf(pendingExpenseData) : null,
    [pendingExpenseData,accounts,sales,expenses,investors,retailSales,appSettings?.profitFromPaymentsOnly]);
  const needsNegativeConsent = !!(confirmPreview || formPreview)?.warnings.length;
  useEffect(()=>setAcceptNegative(false),[formPreview?.signature]);

  // Открытые (непогашенные) долги выбранного поставщика — для опциональной привязки оплаты к конкретному договору
  const supplierOpenDebts = selectedSupplierId
    ? saleList.filter(s => s.supplierId === selectedSupplierId && !s.isPartnerDebtPaid && (s.buyPrice - (s.partnerDebtPaidAmount || 0)) > 0)
    : [];
  const selectedDebtSale = supplierOpenDebts.find(s => s.id === selectedDebtSaleId);
  const selectedDebtRemaining = selectedDebtSale ? selectedDebtSale.buyPrice - (selectedDebtSale.partnerDebtPaidAmount || 0) : null;

  // Приходы на склад с остатком долга — оплату можно привязать и к ним
  const supplierOpenSupplies = selectedSupplierId
    ? supplierSupplyBalances(movements, products, expenses || [], selectedSupplierId).filter(d => d.remaining > 0.01)
    : [];
  const selectedSupply = supplierOpenSupplies.find(d => d.id === selectedSupplyDocId);

  // Auto-fill Account logic when Investor changes
  useEffect(() => {
      // Счёт уже выбран тем, кто открыл форму (закят за инвестора по этому счёту)
      if (initialData?.accountId && initialData.investorId === selectedInvestorId) return;
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
          const availableAccounts = accounts.filter(a=>!a.isArchived);
          const mainAccount = availableAccounts.find(a => a.isMain || a.type === 'MAIN') || availableAccounts[0];
          if (!mainAccount) return;
          setSourceAccountId(mainAccount.id);
      }
  }, [accounts, sourceAccountId]);
  
  // Reset payout type when switching away from investor
  useEffect(() => {
    if (sourceType !== 'INVESTOR') {
        setPayoutType(null);
    }
  }, [sourceType]);

  useEffect(() => {
    if (category !== 'Моя выплата') setManagerPayoutSource(null);
    if (category !== 'Salary') setSelectedEmployeeId('');
    if (category !== 'Оплата партнёру') {
      setSelectedSupplierId('');
      setSelectedDebtSaleId('');
      setSelectedSupplyDocId('');
    }
  }, [category]);

  // Первый выбор явный; после успешной записи запоминаем его для пользователя,
  // категории и счёта. Данные старых расходов не переписываются.
  useEffect(() => {
    if (!ordinaryExpense) return;
    if (initialData?.fromProfit && (!initialData.accountId || initialData.accountId===sourceAccountId) && (!initialData.category || initialData.category===category)) {
      setProfitSource(initialData.profitSource || (category==='Salary'||category==='Закят'?'MANAGER':'SHARED')); return;
    }
    const key=expenseChoiceKey(userId,sourceAccountId,category);
    let saved: string | null = null;
    try { if(key) saved=localStorage.getItem(key); } catch { /* Недоступное хранилище не мешает форме. */ }
    setProfitSource(saved==='MANAGER'||saved==='SHARED'?saved:category==='Salary'||category==='Закят'?'MANAGER':null);
  },[category,sourceAccountId,sourceType,userId]);
  useEffect(()=>{
    if(managerPayoutSource==='CAPITAL'&&!canReturnOwnCapital(selectedAccount))setManagerPayoutSource(null);
  },[sourceAccountId,accounts,managerPayoutSource]);

  const prepareConfirmation = (data: any) => {
    const preview=previewOf(data);
    if(preview.errors.length){alert(preview.errors[0]);return;}
    setAcceptNegative(false);
    setPendingSignature(preview.signature);
    setPendingExpenseData(data);
    setShowConfirmModal(true);
  };

  // Сбрасываем выбранный договор при смене поставщика
  useEffect(() => {
      setSelectedDebtSaleId('');
      setSelectedSupplyDocId('');
  }, [selectedSupplierId]);

  // Автоподстановка суммы остатком долга при выборе прихода
  useEffect(() => {
      if (selectedSupply) setAmount(String(selectedSupply.remaining));
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSupplyDocId]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 🛡️ Защита от повторных отправок
    if (isSubmitting) return;
    
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
        alert("Введите сумму больше нуля");
        return;
    }

    // 🔒 Оплата поставщику — отдельный упрощённый флоу (частичная оплата долга по конкретному договору)
    if (isSupplierPayment) {
        // Отдать больше остатка можно: переплата зачтётся в следующие поставки и
        // видна в карточке партнёра как «+». Раньше такую оплату не пропускали.
        if (initialData?.maxAmount != null && numAmount > initialData.maxAmount + 0.01) {
            const over = numAmount - initialData.maxAmount;
            if (!await appConfirm(`Сумма больше остатка долга (${initialData.maxAmount.toLocaleString('ru-RU')} ₽) на ${over.toLocaleString('ru-RU')} ₽.\n\nПереплата зачтётся в следующие поставки. Провести оплату?`)) return;
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
            description: comment.trim() || undefined,
        };
        prepareConfirmation(supplierExpenseData);
        return;
    }

    if (ordinaryExpense && !profitSource) { alert('Выберите: общий расход или за мой счёт.'); return; }

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
    const selectedDate = dateFromInput(date);
    const isToday = selectedDate.getDate() === now.getDate() &&
                    selectedDate.getMonth() === now.getMonth() &&
                    selectedDate.getFullYear() === now.getFullYear();
    if (isToday) {
        finalDate = now.toISOString();
    } else if (date) {
        // Полдень выбранного дня — тот же день в любом часовом поясе
        selectedDate.setHours(12, 0, 0, 0);
        finalDate = selectedDate.toISOString();
    }

    const commonData = { amount: numAmount, date: finalDate, description: comment.trim() || undefined };

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
            // Больше остатка платить можно: партнёру часто отдают округлённой суммой
            // или вперёд. Раньше такую оплату просто не пропускали, и переплату
            // некуда было записать. Спрашиваем подтверждение — чтобы лишний ноль
            // не ушёл молча, — а дальше она видна в карточке партнёра как «+».
            const over = selectedDebtRemaining != null
                ? numAmount - selectedDebtRemaining
                : selectedSupply ? numAmount - selectedSupply.remaining : 0;
            if (over > 0.01) {
                const what = selectedDebtRemaining != null
                    ? `остатка долга по договору (${selectedDebtRemaining.toLocaleString('ru-RU')} ₽)`
                    : `остатка по приходу №${selectedSupply!.number} (${selectedSupply!.remaining.toLocaleString('ru-RU')} ₽)`;
                if (!await appConfirm(`Сумма больше ${what} на ${over.toLocaleString('ru-RU')} ₽.\n\nПереплата зачтётся в следующие поставки. Провести оплату?`)) return;
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
            // Списание из прибыли делится между менеджером и инвесторами по долям счёта
            fromProfit: (fromProfit && category !== 'Оплата партнёру') || undefined,
            profitSource: fromProfit && category !== 'Оплата партнёру' ? profitSource : undefined,
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
            } else if (selectedSupplyDocId) {
                expenseData.supplyDocId = selectedSupplyDocId;
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
    prepareConfirmation(expenseData);
  };

  // 🔥 Подтверждение отправки расхода
  const handleConfirm = async () => {
    if (saving.current || isSubmitting || !pendingExpenseData) return;
    
    const current=previewOf(pendingExpenseData);
    if (current.signature!==pendingSignature) { alert('Данные изменились. Проверьте расчёт ещё раз.'); handleCancel(); return; }
    if(current.errors.length || current.warnings.length&&!acceptNegative)return;
    saving.current = true;
    setIsSubmitting(true);
    
    try {
      // 🔥 ОТПРАВКА НА СЕРВЕР
      await onSubmit(pendingExpenseData);
      if(pendingExpenseData.fromProfit) {
        const key=expenseChoiceKey(userId,pendingExpenseData.accountId,pendingExpenseData.category);
        try{if(key)localStorage.setItem(key,pendingExpenseData.profitSource);}catch{}
      }

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
      saving.current = false;
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
      <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-700 pb-4 pt-2">
          <TopBarBack onClick={onClose} />
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">Оформление расхода</h2>
      </div>

      {isSupplierPayment && (
          <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-900/50 rounded-xl p-4 space-y-1">
              <p className="font-bold text-amber-800 dark:text-amber-300">{initialData?.title}</p>
              <p className="text-sm text-amber-700 dark:text-amber-400">
                  Остаток долга: {initialData?.maxAmount?.toLocaleString('ru-RU')} ₽.
                  Можно оплатить частично, а если отдать больше — переплата зачтётся в следующие поставки.
              </p>
          </div>
      )}

      {/* Switcher */}
      {!isSupplierPayment && (
      <div className="relative flex p-1 rounded-[22px] bg-white/60 dark:bg-slate-800/60 border border-white/70 dark:border-slate-700 shadow-sm">
        {/* Вкладка инвестора есть не всегда: без неё ряд из одной кнопки, и
            капсула не рисуется — подсвечивать нечего. */}
        <TabPill index={sourceType === 'OTHER' ? 0 : 1} count={investors.length > 0 ? 2 : 1} />
        <button
            onClick={() => { setSourceType('OTHER'); setAmount(''); }}
            className={`relative z-10 flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
                sourceType === 'OTHER' ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'
            }`}
        >
            Расходы
        </button>
        {investors.length > 0 && (
            <button
                onClick={() => { setSourceType('INVESTOR'); setAmount(''); }}
                className={`relative z-10 flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
                    sourceType === 'INVESTOR' ? 'text-purple-600 dark:text-purple-400' : 'text-slate-500 dark:text-slate-400'
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
                    aria-label="Счёт списания" value={sourceAccountId}
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
                        aria-label="Счёт списания" value={sourceAccountId}
                        onChange={e => setSourceAccountId(e.target.value)}
                     >
                         {accounts.filter(a => !a.isArchived || a.id === sourceAccountId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                     </select>
                 </div>
                 <div className="pt-2">
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Источник списания</label>
                      <div className="grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => setPayoutType('INVESTMENT')} className={`p-4 rounded-xl border-2 text-center ${payoutType === 'INVESTMENT' ? 'border-purple-600 bg-purple-50 dark:bg-purple-900/30' : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900'}`}>
                              <span className="font-bold text-sm text-purple-800 dark:text-purple-300">Вернуть вложения</span>
                              <span className="text-xs text-slate-500 dark:text-slate-400 block">Уменьшит вложения</span>
                          </button>
                          <button type="button" onClick={() => setPayoutType('PROFIT')} className={`p-4 rounded-xl border-2 text-center ${payoutType === 'PROFIT' ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-900/30' : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900'}`}>
                              <span className="font-bold text-sm text-emerald-800 dark:text-emerald-300">Выплатить прибыль</span>
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
                            aria-label="Назначение расхода" placeholder="Например: Аренда офиса"
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
                        aria-label="Категория расхода" value={category}
                        onChange={e => setCategory(e.target.value)}
                     >
                         <option value="General">Общее</option>
                         <option value="Моя выплата">Моя выплата</option>
                         <option value="Rent">Аренда</option>
                         <option value="Salary">Зарплата</option>
                         <option value="Marketing">Маркетинг</option>
                         <option value="Taxes">Налоги</option>
                         <option value="Закят">Закят</option>
                         <option value="Equipment">Оборудование</option>
                         {showSupplierCategory && <option value="Оплата партнёру">Партнер</option>}
                        {/* Свои категории — следом за базовыми: их завели в приходе,
                            и здесь они нужны ровно так же. */}
                        {categories.map(c => <option key={c} value={c}>{c}</option>)}
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

                                 {selectedSupplierId && initialData?.supplierId === selectedSupplierId && !!initialData?.supplierDebt && (
                                     <p className="text-sm text-amber-800 dark:text-amber-300">
                                         Долг поставщику: <b>{formatCurrency(initialData.supplierDebt)} ₽</b>
                                     </p>
                                 )}

                                 {/* Одно поле на оба вида долга: договор рассрочки или приход на
                                     склад. Двумя полями можно было бы выбрать и то, и другое —
                                     а одна оплата гасит один документ. */}
                                 {selectedSupplierId && (supplierOpenDebts.length > 0 || supplierOpenSupplies.length > 0) && (
                                     <div>
                                         <label className="block text-xs font-medium text-amber-700 dark:text-amber-400 mb-1">Привязать к документу (необязательно)</label>
                                         <select
                                            className="w-full p-3 border border-amber-200 dark:border-amber-800 rounded-xl bg-white dark:bg-slate-900 outline-none text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-300"
                                            value={selectedDebtSaleId ? `sale:${selectedDebtSaleId}` : selectedSupplyDocId ? `supply:${selectedSupplyDocId}` : ''}
                                            onChange={e => {
                                                const [kind, ...rest] = e.target.value.split(':');
                                                const id = rest.join(':');
                                                setSelectedDebtSaleId(kind === 'sale' ? id : '');
                                                setSelectedSupplyDocId(kind === 'supply' ? id : '');
                                            }}
                                         >
                                             <option value="">Без привязки — гасит долг по очереди</option>
                                             {supplierOpenDebts.length > 0 && (
                                                 <optgroup label="Договоры рассрочки">
                                                     {supplierOpenDebts.map(s => (
                                                         <option key={s.id} value={`sale:${s.id}`}>
                                                             {s.productName} — остаток {(s.buyPrice - (s.partnerDebtPaidAmount || 0)).toLocaleString('ru-RU')} ₽
                                                         </option>
                                                     ))}
                                                 </optgroup>
                                             )}
                                             {supplierOpenSupplies.length > 0 && (
                                                 <optgroup label="Приходы на склад">
                                                     {supplierOpenSupplies.map(d => (
                                                         <option key={d.id} value={`supply:${d.id}`}>
                                                             Приход №{d.number} от {new Date(d.date).toLocaleDateString('ru-RU')} — остаток {d.remaining.toLocaleString('ru-RU')} ₽
                                                         </option>
                                                     ))}
                                                 </optgroup>
                                             )}
                                         </select>
                                         {(selectedDebtSale || selectedSupply) && (
                                             <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                                                 Остаток долга: {(selectedDebtSale ? selectedDebtRemaining : selectedSupply!.remaining)?.toLocaleString('ru-RU')} ₽.
                                                 Можно оплатить частично, а если отдать больше — переплата зачтётся в следующие поставки.
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
                        aria-label="Счёт списания" value={sourceAccountId}
                        onChange={e => setSourceAccountId(e.target.value)}
                     >
                         {accounts.filter(a => !a.isArchived || a.id === sourceAccountId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                     </select>
                 </div>
                 {ordinaryExpense && <div className="pt-2">
                   <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Как учесть</p>
                   <div className="grid grid-cols-2 gap-2">
                     {([{key:'SHARED',label:'Общий расход',hint:'По долям счёта'},{key:'MANAGER',label:'За мой счёт',hint:'Только ваша прибыль'}] as const).map(opt=><button
                       key={opt.key} type="button" aria-pressed={profitSource===opt.key} onClick={()=>setProfitSource(opt.key)}
                       className={`p-3 rounded-xl border-2 text-left ${profitSource===opt.key?'border-emerald-600 bg-emerald-50 dark:bg-emerald-900/20':'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900'}`}>
                       <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{opt.label}</span>
                       <span className="block text-xs text-slate-500 mt-1">{opt.hint}</span>
                     </button>)}
                   </div>
                 </div>}
                 {category === 'Моя выплата' && (
                     <div className="pt-2">
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Источник списания</label>
                          <div className={`grid ${canReturnOwnCapital(selectedAccount) ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
                              {canReturnOwnCapital(selectedAccount) && (
                                  <button type="button" onClick={() => setManagerPayoutSource('CAPITAL')} className={`p-4 rounded-xl border-2 text-center ${managerPayoutSource === 'CAPITAL' ? 'border-purple-600 bg-purple-50 dark:bg-purple-900/30' : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900'}`}>
                                      {/* Раньше называлось «Из Капитала» — слово ничего не
                                          говорило о том, откуда деньги и что уменьшается.
                                          Сохранённое значение прежнее, менять историю незачем. */}
                                      <span className="font-bold text-sm text-purple-800 dark:text-purple-300">Вернуть вложенное</span>
                                      <span className="text-xs text-slate-500 dark:text-slate-400 block">Возврат вложенного</span>
                                  </button>
                              )}
                              <button type="button" onClick={() => setManagerPayoutSource('PROFIT')} className={`p-4 rounded-xl border-2 text-center ${managerPayoutSource === 'PROFIT' ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-900/30' : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900'}`}>
                                  <span className="font-bold text-sm text-emerald-800 dark:text-emerald-300">Забрать прибыль</span>
                                  <span className="text-xs text-slate-500 dark:text-slate-400 block">Заработанные</span>
                              </button>
                          </div>
                          {/* Сколько ещё можно вернуть: выплата «Из инвестиций»
                              уменьшает именно эту сумму, и видеть её надо до
                              нажатия, а не идти потом сверять в кассу. */}
                          {managerPayoutSource === 'CAPITAL' && (
                              <p className={`text-xs mt-2 ${Number(amount) > investment.left ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`}>
                                  {investment.left > 0
                                      ? `Вложено в счёт: ${formatCurrency(investment.left, false)} ₽`
                                      : 'По этому счёту вложенного не числится'}
                                  {Number(amount) > investment.left && ' — сумма больше вложенного'}
                              </p>
                          )}
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
                        aria-label="Сумма расхода" min="0.01" step="0.01" required
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
                    type="date" aria-label="Дата расхода" required
                    className="w-full p-3 text-lg border border-slate-200 dark:border-slate-600 rounded-xl outline-none bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Комментарий <span className="font-normal text-slate-400 dark:text-slate-500">— необязательно</span>
                </label>
                <textarea
                    rows={2}
                    maxLength={1000}
                    placeholder="Например: за что, кому, по какому договору"
                    className="w-full p-3 text-base border border-slate-200 dark:border-slate-600 rounded-xl outline-none resize-none bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500"
                    value={comment}
                    onChange={e => setComment(e.target.value)}
                />
            </div>
        </div>

        {formPreview && <ExpenseBeforeAfter preview={formPreview} showCents={appSettings?.showCents} />}

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
          disabled={isSubmitting || !!formPreview?.errors.length || ordinaryExpense && !profitSource}
          className={`w-full disabled:opacity-50 disabled:cursor-not-allowed text-white py-4 rounded-xl font-bold transition-transform active:scale-95 flex items-center justify-center gap-2 ${
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
          className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
          onClick={() => { if (!isSubmitting && !expenseDone) handleCancel(); }}
        >
          <div
            className="bg-white dark:bg-slate-800 w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl shadow-2xl p-5 space-y-4 animate-dialog-in"
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
            <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto text-3xl">
              {ICONS.Expense}
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
                  {pendingExpenseData.type === 'INVESTOR_WITHDRAWAL' ? 'Выплата инвестору' : pendingExpenseData.category === 'Оплата партнёру' ? 'Оплата поставщику' : pendingExpenseData.category === 'Моя выплата' ? 'Выплата себе' : pendingExpenseData.profitSource==='MANAGER' ? 'За мой счёт' : 'Общий расход'}
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

              {pendingExpenseData.description && (
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500 dark:text-slate-400 shrink-0">Комментарий:</span>
                  <span className="font-medium text-slate-800 dark:text-white text-right break-words min-w-0 line-clamp-3">
                    {pendingExpenseData.description}
                  </span>
                </div>
              )}

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
            
            {confirmPreview && <ExpenseBeforeAfter preview={confirmPreview} showCents={appSettings?.showCents} />}
            {needsNegativeConsent && !confirmPreview?.errors.length && <label className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-300">
              <input type="checkbox" checked={acceptNegative} onChange={e=>setAcceptNegative(e.target.checked)} className="w-4 h-4" />
              Провести с минусом
            </label>}

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
                disabled={isSubmitting || !!confirmPreview?.errors.length || needsNegativeConsent && !acceptNegative}
                className={`btn-press flex-1 py-3 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-bold shadow-lg flex items-center justify-center gap-2 ${
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