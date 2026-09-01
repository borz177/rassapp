import React, { useState, useEffect, useMemo, useRef } from 'react';
import TabPill from './TabPill';
import TopBarBack from './TopBarBack';
import { Customer, Account, Investor, Sale, User, RetailSale } from '../types';
import { ICONS } from '../constants';
import { getAppSettings } from '../services/storage';
import { sendWhatsAppMessage, sendWhatsAppFile } from '../services/whatsapp';
import { getInvestorAccount, retailRemaining } from '../src/utils';
import { buildContractFragment, CONTRACT_SHEET_WIDTH_PX } from '../src/contractTemplates';
import { isStaleBundleError, reloadForNewBuild } from '../src/staleBundle';
import { SuccessCheck, SendStageView, hapticSuccess, type SendStage } from './feedback';

interface NewIncomeProps {
  initialData?: any;
  customers: Customer[];
  investors: Investor[];
  accounts: Account[];
  sales: Sale[];
  /** Розничные продажи в долг — их гасят тем же приходом, что и рассрочку */
  retailSales?: RetailSale[];
  onClose: () => void;
  onSubmit: ( any) => void;
  onSelectCustomer: () => void;
  user?: User;
  appSettings?: AppSettings; 
}

// Форматирует любой российский номер в вид +7 (XXX) XXX-XX-XX
const formatPhone = (raw: string | undefined): string => {
  if (!raw) return '+7 (___) ___-__-__';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && (digits[0] === '8' || digits[0] === '7')) {
    const clean = digits[0] === '8' ? '7' + digits.slice(1) : digits;
    return `+${clean[0]} (${clean.slice(1, 4)}) ${clean.slice(4, 7)}-${clean.slice(7, 9)}-${clean.slice(9)}`;
  }
  return raw;
};

const NewIncome: React.FC<NewIncomeProps> = ({
  initialData, customers, investors, accounts, sales, retailSales = [], onClose, onSubmit, onSelectCustomer, user, appSettings
}) => {
  const [sourceType, setSourceType] = useState<'CUSTOMER' | 'INVESTOR' | 'OTHER'>('CUSTOMER');
  const [selectedCustomerId, setSelectedCustomerId] = useState(initialData?.customerId || '');
  const [selectedSaleId, setSelectedSaleId] = useState('');
  const [selectedInvestorId, setSelectedInvestorId] = useState('');
  const [targetAccountId, setTargetAccountId] = useState(initialData?.accountId || '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [sendHistory, setSendHistory] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Стадии отправки PDF и финальное подтверждение — вместо системных alert(),
  // которые выглядели чужими и рвали ощущение приложения.
  const [sendStage, setSendStage] = useState<SendStage>('idle');
  const [paymentDone, setPaymentDone] = useState(false);
  // 🔒 Отдельно от isSubmitting (тот уже true с момента открытия модалки подтверждения) —
  // именно этот флаг отражает, что handleConfirm сейчас реально выполняется (генерация PDF,
  // отправка в WhatsApp, onSubmit), и используется, чтобы заблокировать повторный клик
  // "Зачислить"/"Отмена" во время этого окна — иначе второй клик создавал дубликат платежа.
  const [isConfirming, setIsConfirming] = useState(false);

  const [discountType, setDiscountType] = useState<'percent' | 'amount'>('percent');
  const [discountValue, setDiscountValue] = useState('');

  const isSubmittingRef = useRef(false);
const isConfirmingRef = useRef(false);

  const contractRef = useRef<HTMLDivElement>(null);

  const isSubscriptionExpired = useMemo(() => {
    if (!user?.subscription) return false;
    const { expiresAt } = user.subscription;
    return new Date() > new Date(expiresAt);
  }, [user?.subscription]);

  const selectedCustomer = useMemo(() => customers.find(c => c.id === selectedCustomerId), [customers, selectedCustomerId]);
  const activeCustomerSales = useMemo(() => sales.filter(s => s.customerId === selectedCustomerId && s.remainingAmount > 0), [sales, selectedCustomerId]);
  const selectedSale = useMemo(() => sales.find(s => s.id === selectedSaleId), [sales, selectedSaleId]);
  // Долги магазина попадают в тот же список, что и договоры: для клиента это
  // один и тот же вопрос «сколько я должен», и разводить его по двум экранам
  // значило бы заставлять кассира помнить, откуда именно долг.
  // Префикс в значении отличает их от договоров, не заводя второго поля.
  const RETAIL_PREFIX = 'retail:';
  const retailDebts = useMemo(
    () => retailSales.filter(r => r.customerId === selectedCustomerId && !r.isCancelled && retailRemaining(r) > 0),
    [retailSales, selectedCustomerId]
  );
  const selectedRetail = useMemo(
    () => retailDebts.find(r => RETAIL_PREFIX + r.id === selectedSaleId),
    [retailDebts, selectedSaleId]
  );
  const hasAnyDebt = activeCustomerSales.length > 0 || retailDebts.length > 0;
  const selectedInvestor = useMemo(() => investors.find(i => i.id === selectedInvestorId), [investors, selectedInvestorId]);

  
  const showCents = appSettings?.showCents || false;

  const formatNum = (val: number) => {
    return val.toLocaleString(undefined, {
      minimumFractionDigits: showCents ? 2 : 0,
      maximumFractionDigits: showCents ? 2 : 0,
    });
  };

  useEffect(() => {
    if (initialData?.type === 'CUSTOMER_PAYMENT') {
      setSourceType('CUSTOMER');
      setSelectedCustomerId(initialData.customerId || '');
      setSelectedSaleId(initialData.saleId || '');
      setAmount(initialData.amount?.toString() || '');
    }
    if (initialData?.type === 'RETAIL_PAYMENT') {
      setSourceType('CUSTOMER');
      setSelectedCustomerId(initialData.customerId || '');
      setSelectedSaleId(initialData.retailSaleId ? `retail:${initialData.retailSaleId}` : '');
      setAmount(initialData.amount?.toString() || '');
    }
  }, [initialData]);

  useEffect(() => {
    if (selectedSale) {
      const paidTotal = selectedSale.paymentPlan.filter(p => p.isPaid).reduce((sum, p) => sum + p.amount, 0);
      const scheduledPayments = selectedSale.paymentPlan.filter(p => !p.isPaid).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      let paymentPool = paidTotal;
      let suggestedAmount = selectedSale.remainingAmount;
      for (const p of scheduledPayments) {
        const paymentDue = p.amount;
        const coveredByPool = Math.min(paymentDue, paymentPool);
        paymentPool -= coveredByPool;
        const remainingForThisInstallment = paymentDue - coveredByPool;
        if (remainingForThisInstallment > 0.01) { suggestedAmount = remainingForThisInstallment; break; }
      }
      if (!amount) {
        setAmount(suggestedAmount > 0 ? (showCents ? suggestedAmount.toFixed(2) : Math.round(suggestedAmount).toString()) : '');
      }
      setTargetAccountId(selectedSale.accountId);
    }
  }, [selectedSale, showCents]);



  useEffect(() => {
    if (!selectedRetail) return;
    const left = retailRemaining(selectedRetail);
    setAmount(showCents ? left.toFixed(2) : Math.round(left).toString());
    setTargetAccountId(selectedRetail.accountId);
  }, [selectedRetail, showCents]);

  useEffect(() => {
    if (selectedInvestor) {
      // 🔒 getInvestorAccount учитывает и обычный счёт (ownerId), и общий пул (poolMemberIds) —
      // раньше здесь был accounts.find(a => a.ownerId === ...), из-за чего для инвестора из
      // общего пула счёт не находился вообще и приход денег было невозможно оформить.
      const invAccount = getInvestorAccount(selectedInvestor.id, accounts);
      if (invAccount) setTargetAccountId(invAccount.id);
    }
  }, [selectedInvestor, accounts]);

  useEffect(() => {
    setDiscountValue('');
    setDiscountType('percent');
  }, [selectedSaleId, selectedCustomerId]);




  useEffect(() => {
    if (sourceType === 'OTHER' && accounts.length > 0 && !targetAccountId) {
      setTargetAccountId(accounts[0].id);
    }
  }, [sourceType, accounts, targetAccountId]);

  useEffect(() => {
    if (sourceType === 'INVESTOR' && investors.length === 0) {
      setSourceType('CUSTOMER');
      setSelectedInvestorId('');
    }
  }, [investors, sourceType]);

  const recommendedAmount = useMemo(() => {
    if (selectedSale) {
      const paidTotal = selectedSale.paymentPlan.filter(p => p.isPaid).reduce((sum, p) => sum + p.amount, 0);
      const scheduledPayments = selectedSale.paymentPlan.filter(p => !p.isPaid).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      let paymentPool = paidTotal;
      for (const p of scheduledPayments) {
        const paymentDue = p.amount;
        const coveredByPool = Math.min(paymentDue, paymentPool);
        paymentPool -= coveredByPool;
        if (paymentDue - coveredByPool > 0.01) return paymentDue - coveredByPool;
      }
      return selectedSale.remainingAmount;
    }
    return 0;
  }, [selectedSale]);

  const currentPaymentProfit = useMemo(() => {
    if (!selectedSale || !amount) return 0;
    const numAmount = Number(amount);
    if (selectedSale.totalAmount <= 0) return 0;
    const totalProfit = selectedSale.totalAmount - selectedSale.buyPrice;
    const margin = totalProfit / selectedSale.totalAmount;
    const profit = numAmount * margin;
    return showCents ? profit : Math.round(profit);
  }, [selectedSale, amount, showCents]);

  const fullDebt = selectedSale?.remainingAmount || 0;
  const discountNum = parseFloat(discountValue) || 0;

  const discountAmount = useMemo(() => {
    if (!selectedSale || discountNum <= 0) return 0;
    if (discountType === 'percent') {
      return Math.min(fullDebt, (fullDebt * discountNum) / 100);
    } else {
      return Math.min(fullDebt, discountNum);
    }
  }, [discountType, discountValue, fullDebt, selectedSale]);

  const finalPaymentAmount = Math.max(0, fullDebt - discountAmount);
  const discountPercentDisplay = fullDebt > 0 ? (discountAmount / fullDebt) * 100 : 0;

  useEffect(() => {
  // Если сумма стала меньше долга — сбрасываем скидку
  if (Number(amount) < fullDebt && discountAmount === 0 && fullDebt > 0) {
    setDiscountValue('');
    setDiscountType('percent');
  }
}, [amount, fullDebt, discountAmount]);
  


    useEffect(() => {
    if (selectedSale && discountAmount > 0) {
      setAmount(showCents ? finalPaymentAmount.toFixed(2) : Math.round(finalPaymentAmount).toString());
    }
  }, [discountAmount, finalPaymentAmount, selectedSale, showCents]);

  const generateContractPDF = async (sale: Sale, customer: Customer, currentPaymentAmount: number, paymentDate: string): Promise<Blob> => {
    if (!contractRef.current) throw new Error("Contract element not found");
    let jsPDF: any, html2canvas: any;
    try {
      [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'),
        import('html2canvas')
      ]);
    } catch (importErr: any) {
      if (importErr?.message?.includes('MIME') || importErr?.message?.includes('text/html')) {
        const err: any = new Error('APP_UPDATE_REQUIRED');
        err.isUpdateRequired = true;
        throw err;
      }
      throw importErr;
    }
    // 🔒 Повторная проверка после await: если за время загрузки чанков форма всё же
    // размонтировалась — бросаем понятную ошибку вместо краша на cloneNode.
    if (!contractRef.current) throw new Error("Contract element not found");
    // Копию для снимка держим ЗА ПРЕДЕЛАМИ экрана.
    // Раньше здесь стояло left: 0 и z-index: 9999 — документ выкладывался поверх
    // всего интерфейса и висел там 300 мс ожидания плюс время отрисовки, из-за чего
    // при отправке чека на секунду выскакивал полный лист договора.
    // Видимой копия быть обязана: visibility: hidden html2canvas уважает и снимет пустоту.
    // А вот положение за краем экрана ему безразлично — проверено: холст и содержимое
    // получаются идентичными тому, что выходило при отрисовке на виду.
    const clonedElement = contractRef.current.cloneNode(true) as HTMLDivElement;
    clonedElement.style.position = 'fixed';
    clonedElement.style.left = '-10000px';
    clonedElement.style.top = '0';
    clonedElement.style.visibility = 'visible';
    clonedElement.style.zIndex = '-1';
    clonedElement.style.pointerEvents = 'none';
    clonedElement.style.width = '210mm';
    clonedElement.style.background = 'white';
    clonedElement.style.opacity = '1';
    document.body.appendChild(clonedElement);
    try {
      await new Promise(resolve => setTimeout(resolve, 300));
      const canvas = await html2canvas(clonedElement, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        scrollX: 0,
        scrollY: 0
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.9);
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
      return pdf.output('blob');
    } finally {
      document.body.removeChild(clonedElement);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (isSubscriptionExpired) {
      alert("⛔ Срок подписки истёк. Оформите подписку для совершения операций.");
      return;
    }

    if (isSubmittingRef.current) return;

    const numAmount = Number(amount);
    if (numAmount <= 0) { alert("Введите сумму больше нуля"); return; }
    if (sourceType === 'CUSTOMER' && !selectedSaleId) { alert("Выберите долг"); return; }
    if (sourceType === 'INVESTOR' && (!selectedInvestorId || !targetAccountId)) { alert("Ошибка выбора инвестора или счета"); return; }
    if (sourceType === 'OTHER' && !targetAccountId) { alert("Выберите счет"); return; }

    if (sourceType === 'CUSTOMER' && selectedSale) {
      const isDuplicate = selectedSale.paymentPlan.some(p =>
        p.isPaid && p.isRealPayment &&
        Math.abs(p.amount - numAmount) < 0.01 &&
        new Date(p.date).toDateString() === new Date(date).toDateString()
      );
      if (isDuplicate) {
        alert("⚠️ Платёж с такой суммой и датой уже зачислен!");
        return;
      }
    }

      isSubmittingRef.current = true;
  setIsSubmitting(true);
  setShowConfirmModal(true);
};

  // Показываем галочку и только потом отдаём данные наверх: onSubmit уводит на другой
  // экран и размонтирует форму, так что после его вызова показать что-либо уже нельзя.
  const finishWithSuccess = async (payload: any) => {
    setPaymentDone(true);
    hapticSuccess();
    await new Promise(r => setTimeout(r, 1100));
    onSubmit(payload);
  };

  const handleConfirm = async () => {
    if (isConfirmingRef.current) return;
  isConfirmingRef.current = true;
  setIsConfirming(true);
    try {
      const numAmount = Number(amount);
      let finalDate = date;
      const now = new Date();
      const selectedDate = new Date(date);
      const isToday = selectedDate.getDate() === now.getDate() &&
        selectedDate.getMonth() === now.getMonth() &&
        selectedDate.getFullYear() === now.getFullYear();
      if (isToday) { finalDate = now.toISOString(); }

      // 🔒 ЗАЩИТА: Применяем скидку только если сумма совпадает с рассчитанной
      // Если менеджер изменил сумму вручную — скидка игнорируется
      const isDiscountApplied = discountAmount > 0 
  && Math.abs(numAmount - finalPaymentAmount) < 0.01;

// 🆕 Проверяем переплату (сумма > долга, но без скидки)
const isOverpayment = sourceType === 'CUSTOMER' 
    && selectedSale 
    && numAmount > fullDebt 
    && discountAmount === 0;

const commonData = { 
  amount: isOverpayment ? fullDebt : numAmount, // 🔥 При переплате записываем только сумму долга
  date: finalDate,
  actualDate: now.toISOString(),
  discountAmount: isDiscountApplied ? discountAmount : 0,
  discountPercent: isDiscountApplied ? discountPercentDisplay : 0,
  isFullRepaymentWithDiscount: isDiscountApplied,
  overpaymentAmount: isOverpayment ? numAmount - fullDebt : 0 // 🆕 Сохраняем переплату
};

      if (sourceType === 'CUSTOMER') {
        // 🔒 Сначала генерируем и отправляем PDF, ПОКА форма ещё на экране (contractRef смонтирован).
        // onSubmit ниже переключает экран на CUSTOMER_DETAILS и размонтирует эту форму — если вызвать
        // его раньше, то за время await import('jspdf'/'html2canvas') React успевал размонтировать
        // компонент, и contractRef.current становился null прямо перед cloneNode (краш "null is not
        // an object (evaluating '...current.cloneNode')").
        if (sendHistory && selectedSale && selectedCustomer && appSettings.whatsapp?.enabled) {
          try {
            setSendStage('pdf');
            const pdfBlob = await generateContractPDF(selectedSale, selectedCustomer, numAmount, finalDate);
            setSendStage('upload');
            const dateStr = date.replace(/-/g, '');
            const fileName = `Payment_${dateStr}.pdf`;
            const success = await sendWhatsAppFile(
              appSettings.whatsapp.idInstance,
              appSettings.whatsapp.apiTokenInstance,
              selectedCustomer.phone,
              pdfBlob,
              fileName
            );
            if (success) {
              // Галочка отправки должна быть увидена, а не мелькнуть
              setSendStage('done');
              await new Promise(r => setTimeout(r, 900));
            } else {
              setSendStage('idle');
              alert("Ошибка отправки PDF в WhatsApp");
            }
          } catch (error: any) {
            setSendStage('idle');
            console.error("PDF generation error:", error);
            // Старая сборка: перезагружаемся сами, а не спрашиваем. Платёж уже
            // зачислен — сюда попадают только с отправки PDF.
            if (isStaleBundleError(error)) {
              reloadForNewBuild();
            } else {
              alert(`Ошибка: ${error.message || "Неизвестная ошибка создания PDF"}`);
            }
          }
          setSendStage('idle');
        }

        if (selectedRetail) {
          // Долг магазина гасится своим обработчиком: договора у него нет, а
          // значит нет ни графика, ни скидки за досрочное погашение.
          await finishWithSuccess({
            amount: Math.min(numAmount, retailRemaining(selectedRetail)),
            date: finalDate, actualDate: now.toISOString(),
            type: 'RETAIL_PAYMENT', retailSaleId: selectedRetail.id,
            customerId: selectedCustomerId, accountId: targetAccountId,
            note: note || undefined,
          });
        } else {
          await finishWithSuccess({ ...commonData, type: 'CUSTOMER_PAYMENT', saleId: selectedSaleId, accountId: targetAccountId });
        }
      } else if (sourceType === 'INVESTOR') {
        await finishWithSuccess({ ...commonData, type: 'INVESTOR_DEPOSIT', investorId: selectedInvestorId, accountId: targetAccountId, note: "Пополнение от инвестора" });
      } else {
        await finishWithSuccess({ ...commonData, type: 'OTHER_INCOME', accountId: targetAccountId, note: note || "Прочий приход" });
      }
    } finally {
      setShowConfirmModal(false);
      setIsSubmitting(false);
      setIsConfirming(false);
      isSubmittingRef.current = false;
    isConfirmingRef.current = false;
    }
  };

  const handleCancel = () => {
    setShowConfirmModal(false);
    setIsSubmitting(false);
    isSubmittingRef.current = false;
  };

  /**
   * Лист договора, который уходит клиенту в WhatsApp вместе с принятым платежом.
   *
   * Это была четвёртая копия договора в приложении, со своей вёрсткой и своим
   * расчётом графика. Клиент получал документ, не совпадающий с тем, что ему
   * печатали на подпись, и выбранная в настройках форма его не касалась.
   * Теперь лист собирается общим шаблоном и слушается той же настройки.
   */
  const renderContractContent = () => {
    if (!selectedSale || !selectedCustomer) return null;

    const plan = selectedSale.paymentPlan || [];
    const real = plan.filter(p => p.isPaid && p.isRealPayment !== false);

    // Платёж, который принимают прямо сейчас. В договоре его ещё нет: PDF
    // собирается ДО сохранения — форма должна быть на экране, пока с неё
    // снимают снимок. Без этой строки клиент получал документ, где только что
    // внесённых денег не видно вовсе.
    const payingNow = Number(String(amount).replace(',', '.')) || 0;
    const paidRows = [
      ...real.map(p => ({ date: p.date, paid: p.amount })),
      ...(payingNow > 0 ? [{ date, paid: payingNow }] : []),
    ];

    let surplus = paidRows.reduce((sum, p) => sum + p.paid, 0);
    const uncovered = plan
      .filter(p => !p.isPaid || p.isRealPayment === false)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .filter(p => {
        if (surplus >= p.amount - 0.01) { surplus -= p.amount; return false; }
        return true;
      });

    let debt = selectedSale.totalAmount - selectedSale.downPayment;
    const rows = [
      ...paidRows,
      ...uncovered.map(p => ({ date: p.date, paid: 0 })),
    ]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map(p => {
        if (p.paid > 0) debt -= p.paid;
        return { date: p.date, paid: p.paid, remaining: Math.max(0, debt) };
      });

    const { html, styles } = buildContractFragment(
      appSettings?.contractTemplate || 'MODERN',
      {
        companyName: appSettings?.companyName || 'Компания',
        sellerPhone: formatPhone(user?.phone || appSettings?.sellerPhone),
        customerName: selectedCustomer.name,
        customerPhone: formatPhone(selectedCustomer.phone),
        passportSeries: selectedCustomer.passportSeries,
        passportNumber: selectedCustomer.passportNumber,
        passportIssuedBy: selectedCustomer.passportIssuedBy,
        customerAddress: selectedCustomer.address,
        guarantorName: selectedSale.guarantorName,
        guarantorPhone: selectedSale.guarantorPhone,
        productName: selectedSale.productName,
        totalAmount: selectedSale.totalAmount,
        downPayment: selectedSale.downPayment,
        installments: selectedSale.installments,
        monthlyPayment: plan[0]?.amount || 0,
        startDate: selectedSale.startDate,
        rows,
      }
    );

    return (
      <div
        ref={contractRef}
        className="contract-sheet"
        style={{
          width: `${CONTRACT_SHEET_WIDTH_PX}px`,
          position: 'absolute',
          left: '-9999px',
          top: '-9999px',
          visibility: 'hidden',
        }}
      >
        <style>{styles}</style>
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    );
  };

  const getAccountName = (id: string) => accounts.find(a => a.id === id)?.name || 'Неизвестный счет';

  return (
    <div className="space-y-4 animate-fade-in pb-20">
      {renderContractContent()}
      <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-700 pb-4 pt-2">
        <TopBarBack onClick={onClose} />
        <h2 className="text-xl font-bold text-slate-800 dark:text-white">Оформление прихода</h2>
      </div>
      {(() => {
        // Вкладка инвестора появляется не всегда — считаем ряд по факту,
        // иначе капсула встала бы мимо.
        const tabs: string[] = ['CUSTOMER', ...(investors.length > 0 ? ['INVESTOR'] : []), 'OTHER'];
        return (
      <div className="relative flex p-1 rounded-[22px] bg-white/60 dark:bg-slate-800/60 border border-white/70 dark:border-slate-700 shadow-sm">
        <TabPill index={Math.max(0, tabs.indexOf(sourceType))} count={tabs.length} />
        <button
          onClick={() => { setSourceType('CUSTOMER'); setAmount(''); }}
          className={`relative z-10 flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
            sourceType === 'CUSTOMER' ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400'
          }`}
        >Клиент</button>
        {investors.length > 0 && (
          <button
            onClick={() => { setSourceType('INVESTOR'); setAmount(''); }}
            className={`relative z-10 flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
              sourceType === 'INVESTOR' ? 'text-purple-600 dark:text-purple-400' : 'text-slate-500 dark:text-slate-400'
            }`}
          >Инвестор</button>
        )}
        <button
          onClick={() => { setSourceType('OTHER'); setAmount(''); }}
          className={`relative z-10 flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
            sourceType === 'OTHER' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'
          }`}
        >Прочее</button>
      </div>
        );
      })()}
      <form onSubmit={handleSubmit} className="space-y-4">
        {sourceType === 'CUSTOMER' && (
          <div className="space-y-4 bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm animate-fade-in">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Клиент</label>
              <div onClick={onSelectCustomer}
                   className={`w-full p-3 border rounded-xl cursor-pointer flex justify-between items-center ${selectedCustomerId ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800' : 'bg-slate-50 dark:bg-slate-700/50 border-dashed border-slate-300 dark:border-slate-600'}`}>
                <div className="flex items-center gap-2">
                  {selectedCustomerId && <div className="text-indigo-600 dark:text-indigo-400">{ICONS.Customers}</div>}
                  <span className={selectedCustomerId ? 'text-slate-800 dark:text-white font-bold' : 'text-slate-400 dark:text-slate-500'}>{selectedCustomer ? selectedCustomer.name : 'Нажмите для выбора...'}</span>
                </div>
                <span className="text-slate-400 dark:text-slate-500"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                                                      stroke="currentColor" strokeWidth="2"
                                                      strokeLinecap="round" strokeLinejoin="round"><polyline
                  points="9 18 15 12 9 6"/></svg></span>
              </div>
            </div>
            {selectedCustomerId && (
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Активный договор</label>
                {hasAnyDebt ? (
                  <select
                    className="w-full p-3 border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 outline-none text-slate-900 dark:text-white"
                    value={selectedSaleId} onChange={e => setSelectedSaleId(e.target.value)}>
                    <option value="">-- Выберите долг --</option>
                    {activeCustomerSales.map(s => <option key={s.id}
                                                          value={s.id}>{s.productName} (Долг: {formatNum(s.remainingAmount)} ₽)</option>)}
                    {retailDebts.map(r => (
                      <option key={r.id} value={`retail:${r.id}`}>
                        Магазин{r.docNumber ? ` №${r.docNumber}` : ''} (Долг: {formatNum(retailRemaining(r))} ₽)
                      </option>
                    ))}
                  </select>
                ) : <p className="text-slate-500 dark:text-slate-400 italic p-2">Нет активных долгов</p>}
              </div>
            )}
            {(selectedSale || selectedRetail) && <div className="bg-slate-50 dark:bg-slate-700/50 p-3 rounded-lg border border-slate-100 dark:border-slate-700 text-sm flex gap-2 items-center">
              <span className="text-slate-500 dark:text-slate-400">Зачисление на счет:</span>
              <span className="font-bold text-slate-800 dark:text-white">{getAccountName((selectedSale || selectedRetail)!.accountId)}</span>
            </div>}
          </div>
        )}
        {sourceType === 'INVESTOR' && (
          <div className="space-y-4 bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm animate-fade-in">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Выберите инвестора</label>
              <select
                className="w-full p-3 border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 outline-none text-slate-900 dark:text-white"
                value={selectedInvestorId} onChange={e => setSelectedInvestorId(e.target.value)}>
                <option value="">-- Список инвесторов --</option>
                {investors.map(inv => <option key={inv.id} value={inv.id}>{inv.name}</option>)}
              </select>
            </div>
            {targetAccountId && <div className="bg-purple-50 dark:bg-purple-900/30 p-3 rounded-lg border border-purple-100 dark:border-purple-900/50 text-sm flex gap-2 items-center">
              <span className="text-purple-600 dark:text-purple-400 font-medium">Счет зачисления:</span>
              <span className="font-bold text-purple-800 dark:text-purple-300">{getAccountName(targetAccountId)}</span>
            </div>}
          </div>
        )}
        {sourceType === 'OTHER' && (
          <div className="space-y-4 bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm animate-fade-in">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Назначение / Описание</label>
              <input placeholder="Например: Внесение личных средств"
                     className="w-full p-3 border border-slate-200 dark:border-slate-600 rounded-xl outline-none bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                     value={note} onChange={e => setNote(e.target.value)}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Счет зачисления</label>
              <select
                className="w-full p-3 border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 outline-none text-slate-900 dark:text-white"
                value={targetAccountId} onChange={e => setTargetAccountId(e.target.value)}>
                {accounts.filter(a => !a.isArchived || a.id === targetAccountId)
                         .map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
        )}
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Сумма прихода</label>
            <div className="relative">
              <span className="absolute left-4 top-3.5 text-slate-400 dark:text-slate-500 text-lg">₽</span>
              <input type="number" step={showCents ? "0.01" : "1"} placeholder="0"
                     className="w-full p-3 pl-8 text-2xl font-bold border border-slate-200 dark:border-slate-600 rounded-xl outline-none bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                     value={amount} onChange={e => setAmount(e.target.value)}/>
            </div>

            {sourceType === 'CUSTOMER' && selectedSale && fullDebt > 0 && (Number(amount) >= fullDebt || discountAmount > 0) && (
              <div className="mt-4 p-4 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-900/50 rounded-xl">
                <label className="block text-sm font-semibold text-amber-900 dark:text-amber-300 mb-2">
                  🎁 Скидка при полном погашении (опционально)
                </label>

                <div className="flex gap-2 mb-3">
                  <select
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value as 'percent' | 'amount')}
                    className="px-3 py-2 border border-amber-300 dark:border-amber-700 rounded-lg bg-white dark:bg-slate-900 text-sm font-medium text-amber-900 dark:text-amber-300"
                  >
                    <option value="percent">%</option>
                    <option value="amount">₽</option>
                  </select>
                  
                  <input
                    type="number"
                    step={discountType === 'percent' ? '0.01' : showCents ? '0.01' : '1'}
                    placeholder={discountType === 'percent' ? 'Например: 5' : 'Например: 1000'}
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    className="flex-1 px-3 py-2 border border-amber-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500"
                    min="0"
                    max={discountType === 'percent' ? '100' : fullDebt}
                  />
                </div>
                
                {discountAmount > 0 && (
                  <div className="bg-white dark:bg-slate-800 p-3 rounded-lg border border-amber-200 dark:border-amber-900/50 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600 dark:text-slate-300">Остаток долга:</span>
                      <span className="font-semibold">{formatNum(fullDebt)} ₽</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-red-600 dark:text-red-400">
                        Скидка ({discountType === 'percent' ? `${discountNum}%` : `${formatNum(discountNum)} ₽`}):
                      </span>
                      <span className="font-semibold text-red-600 dark:text-red-400">−{formatNum(discountAmount)} ₽</span>
                    </div>
                    <div className="border-t border-amber-200 dark:border-amber-900/50 pt-2 flex justify-between">
                      <span className="font-bold text-amber-900 dark:text-amber-300">К оплате:</span>
                      <span className="font-bold text-xl text-amber-700 dark:text-amber-400">{formatNum(finalPaymentAmount)} ₽</span>
                    </div>
                  </div>
                )}

                {discountAmount > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
                    💡 Договор будет закрыт полностью. Скидка: {discountPercentDisplay.toFixed(1)}%
                  </p>
                )}
              </div>
            )}


          

            {sourceType === 'CUSTOMER' && selectedSale && (
              <div className="flex justify-between items-start mt-2">
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Рек: {formatNum(recommendedAmount)} ₽</p>
                {currentPaymentProfit > 0 && (
                  <div className="bg-emerald-50 dark:bg-emerald-900/30 px-2 py-1 rounded text-right">
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Прибыль с платежа</p>
                    <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">+{formatNum(currentPaymentProfit)} ₽</p>
                  </div>
                )}
              </div>
            )}
          </div>
          {sourceType === 'CUSTOMER' && appSettings.whatsapp?.enabled && (
            <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-700 pt-3">
              <div className="flex items-center gap-2">
                <span className="text-emerald-500">{ICONS.Send}</span>
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Отправить чек в WhatsApp</span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={sendHistory} onChange={() => setSendHistory(!sendHistory)}
                       className="sr-only peer"/>
                <div className="w-11 h-6 bg-slate-200 dark:bg-slate-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
              </label>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Дата</label>
            <input type="date"
                   className="w-full p-3 text-lg border border-slate-200 dark:border-slate-600 rounded-xl outline-none bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                   value={date} onChange={e => setDate(e.target.value)}/>
          </div>
        </div>
        <button
          type="submit"
          disabled={isSubmitting || isSubscriptionExpired}
          className={`w-full py-4 rounded-xl font-bold text-white  transition-transform active:scale-95 ${
            isSubmitting || isSubscriptionExpired
              ? isSubscriptionExpired
                ? 'bg-slate-400 cursor-not-allowed shadow-none'
                : 'bg-emerald-400 cursor-not-allowed'
              : 'bg-emerald-600 hover:bg-emerald-700'
          }`}
        >
          {isSubscriptionExpired ? (
            <span className="flex items-center justify-center gap-2">
              🔒 Подписка истекла — оформите для продолжения
            </span>
          ) : isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              Обработка...
            </span>
          ) : 'Подтвердить приход'}
        </button>
      </form>
      {showConfirmModal && (
        <div
          className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
          onClick={() => { if (!isConfirming && !paymentDone) handleCancel(); }}
        >
          <div
            className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-4 animate-dialog-in"
            onClick={e => e.stopPropagation()}
          >
            {/* Приход зачислен — подтверждение перед уходом на другой экран */}
            {paymentDone ? (
              <div className="py-4 text-center space-y-5">
                <SuccessCheck />
                <div className="animate-stage-in" style={{ animationDelay: '0.55s' }}>
                  <h3 className="text-xl font-bold text-slate-800 dark:text-white">Приход зачислен</h3>
                  <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-2">
                    +{formatNum(Number(amount))} ₽
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    {getAccountName(targetAccountId)}
                  </p>
                </div>
              </div>
            ) : sendStage !== 'idle' ? (
              <SendStageView
                stage={sendStage}
                target={selectedCustomer?.name}
                icons={{ file: ICONS.File, send: ICONS.Send }}
              />
            ) : (
            <>
            <h3 className="text-xl font-bold text-slate-800 dark:text-white text-center">Подтверждение прихода</h3>

            <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-xl space-y-2 text-sm border border-slate-100 dark:border-slate-700">
              {sourceType === 'CUSTOMER' && (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">От кого:</span>
                    <span className="font-bold text-slate-800 dark:text-white">{selectedCustomer?.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">За что:</span>
                    <span className="font-medium text-slate-800 dark:text-white">{selectedSale?.productName}</span>
                  </div>
                </>
              )}
              {sourceType === 'INVESTOR' && (
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Инвестор:</span>
                  <span className="font-bold text-slate-800 dark:text-white">{selectedInvestor?.name}</span>
                </div>
              )}
              {sourceType === 'OTHER' && (
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Назначение:</span>
                  <span className="font-medium text-slate-800 dark:text-white">{note}</span>
                </div>
              )}
              <div className="my-2 border-t border-slate-200 dark:border-slate-700"></div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400">Сумма:</span>
                <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400">+{formatNum(Number(amount))} ₽</span>
              </div>

              {/* 🎁 ПОКАЗЫВАЕМ СКИДКУ В МОДАЛКЕ, ЕСЛИ ОНА ПРИМЕНЯЕТСЯ */}
              {discountAmount > 0 && Math.abs(Number(amount) - finalPaymentAmount) < 0.01 && (
                <div className="flex justify-between items-center text-sm bg-amber-50 dark:bg-amber-900/30 px-3 py-2 rounded-lg border border-amber-100 dark:border-amber-900/50">
                  <span className="text-amber-800 dark:text-amber-300 font-medium">🎁 Скидка:</span>
                  <span className="font-bold text-red-600 dark:text-red-400">−{formatNum(discountAmount)} ₽ ({discountPercentDisplay.toFixed(1)}%)</span>
                </div>
              )}

              <div className="flex justify-between items-center pt-1">
                <span className="text-slate-500 dark:text-slate-400">Счет:</span>
                <span className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-400 px-2 py-0.5 rounded text-xs font-bold">
                  {getAccountName(targetAccountId)}
                </span>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleCancel}
                disabled={isConfirming}
                className={`btn-press flex-1 py-3 rounded-xl font-bold ${
                  isConfirming
                    ? 'bg-slate-50 dark:bg-slate-800 text-slate-300 dark:text-slate-600 cursor-not-allowed'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                }`}
              >
                Отмена
              </button>
              <button
                onClick={handleConfirm}
                disabled={isConfirming}
                className={`btn-press flex-1 py-3 rounded-xl font-bold text-white shadow-lg shadow-emerald-200 ${
                  isConfirming ? 'bg-emerald-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {/* 🔒 Пока идёт генерация/отправка PDF, кнопка заблокирована — иначе повторный клик
                    во время await запускает handleConfirm второй раз и создаёт дубликат платежа. */}
                {isConfirming ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    Обработка...
                  </span>
                ) : 'Зачислить'}
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

export default NewIncome;