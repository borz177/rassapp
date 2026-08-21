import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Customer, Account, Investor, Sale, User } from '../types';
import { ICONS } from '../constants';
import { getAppSettings } from '../services/storage';
import { sendWhatsAppMessage, sendWhatsAppFile } from '../services/whatsapp';
import { getInvestorAccount } from '../src/utils';
import { SuccessCheck, SendStageView, hapticSuccess, type SendStage } from './feedback';

interface NewIncomeProps {
  initialData?: any;
  customers: Customer[];
  investors: Investor[];
  accounts: Account[];
  sales: Sale[];
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
  initialData, customers, investors, accounts, sales, onClose, onSubmit, onSelectCustomer, user, appSettings
}) => {
  const [sourceType, setSourceType] = useState<'CUSTOMER' | 'INVESTOR' | 'OTHER'>('CUSTOMER');
  const [selectedCustomerId, setSelectedCustomerId] = useState(initialData?.customerId || '');
  const [selectedSaleId, setSelectedSaleId] = useState('');
  const [selectedInvestorId, setSelectedInvestorId] = useState('');
  const [targetAccountId, setTargetAccountId] = useState('');
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
    if (sourceType === 'CUSTOMER' && !selectedSaleId) { alert("Выберите договор"); return; }
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
            if (error?.isUpdateRequired || error?.message === 'APP_UPDATE_REQUIRED' ||
                error?.message?.includes('MIME') || error?.message?.includes('text/html')) {
              if (window.confirm('Приложение было обновлено. Нажмите OK для перезагрузки, затем повторите отправку.')) {
                window.location.reload();
              }
            } else {
              alert(`Ошибка: ${error.message || "Неизвестная ошибка создания PDF"}`);
            }
          }
          setSendStage('idle');
        }

        await finishWithSuccess({ ...commonData, type: 'CUSTOMER_PAYMENT', saleId: selectedSaleId, accountId: targetAccountId });
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

  const renderContractContent = () => {
    if (!selectedSale || !selectedCustomer) return null;
    const companyName = appSettings?.companyName || "Компания";
    const hasGuarantor = !!selectedSale.guarantorName;
    const sellerPhone = formatPhone(user?.phone || appSettings?.sellerPhone);



 
 

   // Берём только РЕАЛЬНЫЕ оплаченные платежи из истории — каждый (в т.ч. частичный) своей строкой.
// 🔒 `isRealPayment !== false`, а не `isRealPayment && ...`: у старых записей поля isRealPayment
// нет вообще, и строгая проверка их отбрасывала — реально полученные деньги пропадали из чека.
// Тот же критерий, что на экране договора (CustomerDetails.tsx) и в печати (Contracts.tsx).
const existingPayments: { date: Date; amount: number; discountAmount: number; isSchedule?: false }[] = (selectedSale.paymentPlan || [])
    .filter(p => p.isPaid && p.isRealPayment !== false)
    .map(p => ({
        date: new Date(p.date),
        amount: p.amount,
        discountAmount: (p as any).discountAmount || 0  // 🆕 Добавляем скидку
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

// Добавляем ТЕКУЩИЙ платёж (он ещё не сохранён в sale, поэтому добавляем вручную)
const currentPaymentAlreadyExists = existingPayments.some(
    p => Math.abs(p.amount - Number(amount)) < 0.01 &&
         new Date(p.date).getTime() === new Date(date).getTime()
);

if (!currentPaymentAlreadyExists) {
    existingPayments.push({
        date: new Date(date),
        amount: Number(amount),
        discountAmount: 0  // Текущий платёж пока без скидки
    });
    existingPayments.sort((a, b) => a.date.getTime() - b.date.getTime());
}

// 🔹 РАСЧЁТ С УЧЁТОМ СКИДОК
const totalPaid = existingPayments.reduce((sum, p) => sum + p.amount, 0);
const totalDiscounts = existingPayments.reduce((sum, p) => sum + (p.discountAmount || 0), 0);

// 🔒 Оставшиеся к оплате месяцы считаем ТОЧНО ТАК ЖЕ, как экран договора (CustomerDetails.tsx)
// и печать договора (Contracts.tsx): берём месяцы БЕЗ отметки "оплачено", а излишек уже
// полученных денег над закрытыми месяцами гасит ближайшие из них.
// Раньше применялась эвристика "месяц скрываем, только если за ним закрепилась своя строка
// платежа" — из-за неё месяцы, погашенные ОДНИМ крупным платежом вперёд, всё равно печатались
// как неоплаченные (клиент внёс 72 900 ₽ за 7 месяцев вперёд, а в чеке эти месяцы висели как долг).
//
// Важно опираться именно на отметки, а не только на сумму денег: договор могли закрыть досрочно
// со скидкой/списанием — тогда внесено меньше суммы графика, но долга уже нет, и чисто денежный
// подсчёт ошибочно показывал бы разницу как долг.
const savedReceived = (selectedSale.paymentPlan || [])
    .filter(p => p.isPaid && p.isRealPayment !== false)
    .reduce((sum, p) => sum + p.amount, 0);
const allocatedOnSchedule = (selectedSale.paymentPlan || [])
    .filter(p => p.isPaid && p.isRealPayment !== true)
    .reduce((sum, p) => sum + p.amount, 0);
// Текущий платёж ещё не сохранён в договоре, поэтому отметок на месяцах по нему нет —
// добавляем его сумму к излишку вручную.
const currentPaymentExtra = Math.max(0, totalPaid - savedReceived);

// Скидки по УЖЕ сохранённым платежам сюда не добавляем: они и так учтены отметками "оплачено"
// на месяцах графика, а повторный зачёт гасил бы лишний месяц (расхождение с экраном договора).
let surplusToApply = Math.max(0, savedReceived - allocatedOnSchedule) + currentPaymentExtra;
const scheduleDates = (selectedSale.paymentPlan || [])
    .filter(p => !p.isPaid && p.isRealPayment !== true)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map(p => {
        const covered = Math.min(p.amount, surplusToApply);
        surplusToApply = Math.max(0, surplusToApply - covered);
        // Округляем до копеек: без этого накопленная погрешность double оставляла остаток
        // вида 0.0100000000002, который проходил проверку "> 0.01", и в чек попадала лишняя
        // строка с долгом в одну копейку по уже полностью оплаченному месяцу.
        return { date: p.date, due: Math.round((p.amount - covered) * 100) / 100 };
    })
    .filter(p => p.due > 0.01)
    .map(p => new Date(p.date));

// 🔥 ВАЖНО: Если договор закрыт (status === 'COMPLETED'), остаток = 0
// Иначе считаем: общая сумма - первый взнос - оплачено - скидки
const remainingDebt = selectedSale.status === 'COMPLETED' 
    ? 0 
    : Math.max(0, selectedSale.totalAmount - selectedSale.downPayment - totalPaid - totalDiscounts);

    const styles = {
      page: {
        width: '210mm', minHeight: '297mm', padding: '20mm', background: 'white', color: 'black',
        fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '12pt', lineHeight: '1.5',
        display: 'flex', flexDirection: 'column' as const, boxSizing: 'border-box' as const, margin: '0 auto',
        position: 'absolute' as const, left: '-9999px', top: '-9999px', visibility: 'hidden' as const
      },
      contentWrapper: { flex: 1 },
      h1: { textAlign: 'center' as const, fontSize: '16pt', fontWeight: 'bold' as const, marginBottom: '30px', textTransform: 'uppercase' as const, marginTop: 0, lineHeight: 1.3 },
      headerInfo: { textAlign: 'right' as const, marginBottom: '20px', fontSize: '11pt' },
      fieldRow: { display: 'flex', justifyContent: 'space-between' as const, marginBottom: '10px', alignItems: 'flex-start' as const },
      fieldLabel: { fontWeight: 'bold' as const },
      phoneField: { textAlign: 'right' as const, marginLeft: '10px', flexShrink: 0, whiteSpace: 'nowrap' as const },
      section: { margin: '0 0 20px 0' },
      sectionItem: { marginBottom: '12px' },
      table: { width: '100%' as const, borderCollapse: 'collapse' as const, margin: '20px 0', fontSize: '11pt' },
      th: { border: '1px solid #000', padding: '10px', textAlign: 'center' as const, verticalAlign: 'middle' as const, fontWeight: 'bold' as const, background: '#f9f9f9' },
      td: { border: '1px solid #000', padding: '10px', textAlign: 'center' as const, verticalAlign: 'middle' as const },
      footerContainer: { marginTop: 'auto', paddingTop: '20px', width: '100%', breakInside: 'avoid' as const },
      footer: { display: 'flex', justifyContent: 'space-between' as const, alignItems: 'flex-end' as const, width: '100%' },
      signatureBlock: (width: string) => ({ textAlign: 'center' as const, width, breakInside: 'avoid' as const }),
      signatureLine: { borderBottom: '1px solid #000', margin: '35px 0 5px 0', minHeight: '1px' },
      signatureLabel: { fontSize: '10pt', fontStyle: 'italic' as const }
    };

    let currentDebt = selectedSale.totalAmount - selectedSale.downPayment;

    // 🔒 Та же модель, что и в печати договора (Contracts.tsx): СНАЧАЛА все фактические платежи
    // (по возрастанию даты), ПОТОМ оставшиеся месяцы графика. Обе группы вместе по дате не
    // сортируем — иначе пустая плановая строка вклинивается между двумя оплатами.
    const tableRows: { date: Date; amount: number | null; discountAmount: number }[] = [
        ...[...existingPayments]
            .sort((a, b) => a.date.getTime() - b.date.getTime())
            .map(p => ({ date: p.date, amount: p.amount, discountAmount: p.discountAmount })),
        ...scheduleDates.map(d => ({ date: d, amount: null, discountAmount: 0 }))
    ];

    return (
      <div ref={contractRef} style={styles.page}>
        <h1 style={styles.h1}>ДОГОВОР КУПЛИ-ПРОДАЖИ ТОВАРА В РАССРОЧКУ</h1>
        <div style={styles.headerInfo}>Дата: {new Date(selectedSale.startDate).toLocaleDateString()}</div>
        <div style={styles.contentWrapper}>
          <div style={styles.section}>
            <div style={styles.fieldRow}>
              <span><span style={styles.fieldLabel}>Продавец:</span> {companyName}</span>
              <span style={styles.phoneField}>Тел: {formatPhone(sellerPhone)}</span>
            </div>
            <div style={styles.fieldRow}>
              <span><span style={styles.fieldLabel}>Покупатель:</span> {selectedCustomer.name}</span>
              <span style={styles.phoneField}>Тел: {formatPhone(selectedCustomer.phone)}</span>
            </div>
            {hasGuarantor && (
              <div style={styles.fieldRow}>
                <span><span style={styles.fieldLabel}>Поручитель:</span> {selectedSale.guarantorName}</span>
                <span style={styles.phoneField}>Тел: {formatPhone(selectedSale.guarantorPhone)} </span>
              </div>
            )}
          </div>
          <div style={styles.section}>
            <div style={{
              ...styles.sectionItem,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '15px'
            }}>
              <span><span style={styles.fieldLabel}>Товар:</span> {selectedSale.productName}</span>
              <span><span style={styles.fieldLabel}>Стоимость:</span> {formatNum(selectedSale.totalAmount)} ₽</span>
            </div>

            <div style={{
              ...styles.sectionItem,
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: '10px'
            }}>
              <span><span style={styles.fieldLabel}>Срок рассрочки:</span> {selectedSale.installments} мес.</span>
              <span><span style={styles.fieldLabel}>Первый взнос:</span> {formatNum(selectedSale.downPayment)} ₽</span>
            </div>

            <div style={{
              ...styles.sectionItem,
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: '10px'
            }}>
              <span><span style={styles.fieldLabel}>Ежемесячный платеж:</span> {formatNum(selectedSale.paymentPlan[0]?.amount || 0)} ₽</span>
              <span style={{
                fontWeight: 'bold',
                color: '#ef8228',
                fontSize: '12pt'
              }}>
                Остаток: {formatNum(remainingDebt)} ₽
              </span>
            </div>
          </div>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={{...styles.th, width: '10%'}}>№</th>
                <th style={{...styles.th, width: '30%'}}>Дата</th>
                <th style={{...styles.th, width: '25%'}}>Сумма</th>
                <th style={{...styles.th, width: '35%'}}>Остаток долга</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((p, index) => {
                const hasAmount = p.amount !== null;
                if (hasAmount) currentDebt -= p.amount as number;
                const displayDebt = Math.max(0, currentDebt);
                return (
                  <tr key={index}>
                    <td style={styles.td}>{index + 1}</td>
                    <td style={styles.td}>{p.date.toLocaleDateString()}</td>
                    <td style={styles.td}>
    {hasAmount && <div>{formatNum(p.amount as number)} ₽</div>}
    {/* 🆕 Показываем скидку, если она была */}
    {p.discountAmount > 0 && (
        <div style={{
            fontSize: '9pt',
            color: '#d97706',
            fontStyle: 'italic',
            marginTop: '2px'
        }}>
             Скидка: {formatNum(p.discountAmount)} ₽
        </div>
    )}
</td>
                    <td style={styles.td}>{hasAmount ? `${formatNum(displayDebt)} ₽` : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{margin: '25px 0', fontSize: '11pt', lineHeight: 1.4}}>
            Продавец обязуется передать Покупателю товар, а Покупатель обязуется принять и оплатить его в
            рассрочку на указанных выше условиях.
          </div>
        </div>
        <div style={styles.footerContainer}>
          <div style={styles.footer}>
            <div style={styles.signatureBlock(hasGuarantor ? '30%' : '45%')}>
              <div style={styles.signatureLine}></div>
              <div style={styles.signatureLabel}>Продавец</div>
            </div>
            {hasGuarantor && (
              <div style={styles.signatureBlock('30%')}>
                <div style={styles.signatureLine}></div>
                <div style={styles.signatureLabel}>Поручитель</div>
              </div>
            )}
            <div style={styles.signatureBlock(hasGuarantor ? '30%' : '45%')}>
              <div style={styles.signatureLine}></div>
              <div style={styles.signatureLabel}>Покупатель</div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const getAccountName = (id: string) => accounts.find(a => a.id === id)?.name || 'Неизвестный счет';

  return (
    <div className="space-y-4 animate-fade-in pb-20">
      {renderContractContent()}
      <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-700 pb-4 bg-white dark:bg-slate-800 sticky top-0 z-10 pt-2">
        <button onClick={onClose} className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">{ICONS.Back}</button>
        <h2 className="text-xl font-bold text-slate-800 dark:text-white">Оформление прихода</h2>
      </div>
      <div className="flex bg-slate-100 dark:bg-slate-700 p-1 rounded-xl">
        <button
          onClick={() => { setSourceType('CUSTOMER'); setAmount(''); }}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
            sourceType === 'CUSTOMER' ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400'
          }`}
        >Клиент</button>
        {investors.length > 0 && (
          <button
            onClick={() => { setSourceType('INVESTOR'); setAmount(''); }}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
              sourceType === 'INVESTOR' ? 'bg-white dark:bg-slate-800 text-purple-600 dark:text-purple-400 shadow-sm' : 'text-slate-500 dark:text-slate-400'
            }`}
          >Инвестор</button>
        )}
        <button
          onClick={() => { setSourceType('OTHER'); setAmount(''); }}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
            sourceType === 'OTHER' ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'text-slate-500 dark:text-slate-400'
          }`}
        >Прочее</button>
      </div>
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
                {activeCustomerSales.length > 0 ? (
                  <select
                    className="w-full p-3 border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 outline-none text-slate-900 dark:text-white"
                    value={selectedSaleId} onChange={e => setSelectedSaleId(e.target.value)}>
                    <option value="">-- Выберите товар/рассрочку --</option>
                    {activeCustomerSales.map(s => <option key={s.id}
                                                          value={s.id}>{s.productName} (Долг: {formatNum(s.remainingAmount)} ₽)</option>)}
                  </select>
                ) : <p className="text-slate-500 dark:text-slate-400 italic p-2">Нет активных долгов</p>}
              </div>
            )}
            {selectedSale && <div className="bg-slate-50 dark:bg-slate-700/50 p-3 rounded-lg border border-slate-100 dark:border-slate-700 text-sm flex gap-2 items-center">
              <span className="text-slate-500 dark:text-slate-400">Зачисление на счет:</span>
              <span className="font-bold text-slate-800 dark:text-white">{getAccountName(selectedSale.accountId)}</span>
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