import React, {useState, useMemo, useEffect, useRef} from 'react';
import { Customer, Product, Account, AppSettings, Sale, Payment, Supplier } from '../types';
import { ICONS } from '../constants';
import { getAppSettings } from '../services/storage';
import { sendWhatsAppFile } from '../services/whatsapp';
import { api } from '../services/api';
import { getSellerPhone, escapeHtml, formatDate } from '../src/utils';
import { SuccessCheck, SendStageView, hapticSuccess, haptic, type SendStage } from './feedback';

interface NewSaleProps {
  initialData: any;
  customers: Customer[];
  products: Product[];
  accounts: Account[];
  sales: Sale[];
  suppliers?: Supplier[];
  showSupplierField?: boolean;
  onClose: () => void;
  onSelectCustomer: (currentData: any) => void;
  onSubmit: (data: any) => Promise<any>;
  onUpdateSale?: (sale: Sale) => Promise<void>; // 🔹 Новый пропс для редактирования
  onShowNotification?: (
    title: string,
    message: string,
    type: 'success' | 'error' | 'warning',
    actionLabel?: string,
    onAction?: () => void
  ) => void;
  user?: any;
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

// 🔍 Проверка: есть ли уже похожий активный договор?
const checkDuplicateSale = (
  sales: Sale[] | undefined,
  customerId: string,
  productName: string,
  startDate: string,
  totalAmount: number,
  excludeId?: string
) => {
  if (!Array.isArray(sales) || sales.length === 0) return undefined;
  if (typeof totalAmount !== 'number' || isNaN(totalAmount)) return undefined;

  const saleDate = new Date(startDate).toDateString();

  return sales.find(sale => {
    if (!sale) return false;
    if (excludeId && sale.id === excludeId) return false;
    if (sale.status === 'DELETED' || sale.status === 'COMPLETED') return false;

    const sameCustomer = sale.customerId === customerId;
    const sameProduct = sale.productName?.toLowerCase() === productName.toLowerCase();
    const sameDate = new Date(sale.startDate).toDateString() === saleDate;
    const sameAmount = Math.abs((sale.totalAmount || 0) - totalAmount) < 0.01;

    return sameCustomer && sameProduct && sameDate && sameAmount;
  });
};

const NewSale: React.FC<NewSaleProps> = ({
  initialData, customers, products, accounts, sales, suppliers, showSupplierField,
  onClose, onSelectCustomer, onSubmit, onUpdateSale, onShowNotification, user, propAppSettings,
}) => {
  const supplierList: Supplier[] = suppliers || [];
  const [mode, setMode] = useState<'INSTALLMENT' | 'CASH'>(initialData.type || 'INSTALLMENT');
  const [roundingMode, setRoundingMode] = useState<'NONE' | 'DOWN' | 'UP'>(
    initialData.roundingMode || 'NONE'
  );
  // Шаг округления. 100 — прежнее поведение: у договоров, оформленных до появления
  // выбора, шаг не сохранён, и подставлять надо именно его.
  const [roundingStep, setRoundingStep] = useState<number>(initialData.roundingStep || 100);

  // Modals State
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showWhatsAppConfirmModal, setShowWhatsAppConfirmModal] = useState(false);
  const [isSendingWhatsApp, setIsSendingWhatsApp] = useState(false);
  const [sendStage, setSendStage] = useState<SendStage>('idle');
  const [createdSale, setCreatedSale] = useState<any>(null);
  const [isPriceManual, setIsPriceManual] = useState(false);

  const contractRef = useRef<HTMLDivElement>(null);
  const mainAccount = accounts.find(a => a.isMain || a.type === 'MAIN');
   const appSettings = propAppSettings || getAppSettings();

  const isSubscriptionExpired = useMemo(() => {
    if (!user?.subscription) return false;
    const { expiresAt } = user.subscription;
    return new Date() > new Date(expiresAt);
  }, [user?.subscription]);

  // 🔥 Инициализация formData
  const [formData, setFormData] = useState<any>(() => {
    const defaultData = {
      id: null,
      customerId: '',
      productId: '',
      productName: '',
      buyPrice: 0,
      price: 0,
      accountId: mainAccount ? mainAccount.id : (accounts.length > 0 ? accounts[0].id : ''),
      startDate: new Date().toISOString().split('T')[0],
      paymentDate: '',
      paymentDay: '',
      downPayment: 0,
      installments: 3,
      interestRate: 30,
      guarantorName: '',
      guarantorPhone: '',
      roundingMode: 'NONE' as 'NONE' | 'DOWN' | 'UP',
      supplierId: '',
      partnerDebtPaidAmount: 0,
      isPartnerDebtPaid: false,
    };

    const merged = { ...defaultData, ...initialData };

    return {
      ...merged,
      price: initialData.id
        ? (initialData.price || initialData.totalAmount || 0)
        : (initialData.totalAmount || initialData.price || 0),
      buyPrice: initialData.buyPrice || 0,
      downPayment: initialData.downPayment || 0,
      installments: initialData.installments || 3,
      interestRate: initialData.interestRate || 30,
      startDate: initialData.startDate
        ? new Date(initialData.startDate).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0],
      paymentDate: initialData.paymentDate
        ? new Date(initialData.paymentDate).toISOString().split('T')[0]
        : '',
      roundingMode: initialData.roundingMode || 'NONE',
    };
  });

  const [suggestions, setSuggestions] = useState<Product[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [downPaymentFromMarkup, setDownPaymentFromMarkup] = useState(false);

  // 🔥 НОВЫЕ СТЕЙТЫ для защиты от дублей и двойных кликов
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

// 🔹 Сводка по уже зафиксированным (оплаченным/реальным) платежам —
// используется и для пересчёта графика, и для валидации перед сохранением.
const preservedPaymentsInfo = useMemo(() => {
  const existing: Payment[] = initialData.paymentPlan || [];
  const real = existing.filter((p: Payment) => p.isRealPayment === true);
  const legacyPaid = existing.filter(
    (p: Payment) => p.isPaid && p.isRealPayment !== true && !real.some((rp: Payment) => rp.id === p.id)
  );
  const preserved = [...real, ...legacyPaid];
  return {
    count: preserved.length,
    amount: preserved.reduce((sum: number, p: Payment) => sum + p.amount, 0)
  };
}, [initialData.paymentPlan]);

// 🔒 Если по договору уже есть хотя бы один платёж от клиента — блокируем поля,
// от которых зависит расчёт суммы/графика (закуп, наценка, цена, срок, первый взнос).
// Остальное (товар, касса, поручитель, клиент, даты) остаётся редактируемым всегда.
const isFinancialLocked = !!formData.id && (preservedPaymentsInfo.count > 0 || (formData.partnerDebtPaidAmount || 0) > 0);

// 🔹 Sale не хранит paymentDate как поле — только paymentDay. Чтобы понять, действительно
// ли пользователь поменял дату первого платежа (а не просто открыл форму редактирования),
// сравниваем с датой, которая была бы посчитана автоматически из исходных paymentDay/startDate
// (та же формула, что и в эффекте автозаполнения выше).
const impliedOriginalPaymentDate = useMemo(() => {
  if (!initialData.paymentDay || !initialData.startDate) return '';
  const d = new Date(initialData.startDate);
  d.setMonth(d.getMonth() + 1);
  d.setDate(initialData.paymentDay);
  return d.toISOString().split('T')[0];
}, [initialData.paymentDay, initialData.startDate]);

  const selectedCustomer = customers.find(c => c.id === formData.customerId);
  const selectedAccount = accounts.find(a => a.id === formData.accountId);

  // 🔹 Функция пересчёта графика платежей при изменении даты первого платежа
  // 🔹 Функция пересчёта графика платежей с ЗАЩИТОЙ реальных платежей
const regeneratePaymentPlan = (
  saleData: any,
  newFirstPaymentDate: string,
  existingPayments: Payment[] = []
): Payment[] => {
  // 🔹 1. Сохраняем ВСЕ реальные платежи (историю поступлений)
  // Это платежи с isRealPayment === true (фактически полученные деньги)
  const realPayments = existingPayments.filter(p => p.isRealPayment === true);

  // 🔹 2. Также сохраняем оплаченные плановые платежи (для совместимости со старыми данными)
  const legacyPaidPayments = existingPayments.filter(
    p => p.isPaid && p.isRealPayment !== true && !realPayments.some(rp => rp.id === p.id)
  );

  // 🔹 3. Объединяем сохранённые платежи
  const preservedPayments = [...realPayments, ...legacyPaidPayments];

  // 🔹 4. Считаем, сколько ещё нужно платежей и какую сумму распределять
  const preservedAmount = preservedPayments.reduce((sum, p) => sum + p.amount, 0);
  const remainingInstallments = saleData.installments - preservedPayments.length;

  // 🔹 5. Если все платежи уже сохранены — возвращаем их
  if (remainingInstallments <= 0) {
    return preservedPayments.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  // 🔹 6. Считаем сумму для будущих платежей.
  // 🔥 ВАЖНО: считаем ВСЕГДА от totalAmount/downPayment/preservedAmount, а не берём
  // saleData.remainingAmount "как есть" — это поле обычно равно (totalAmount - downPayment)
  // и НЕ учитывает уже оплаченные платежи по графику (preservedAmount). Раньше это было
  // безопасно, т.к. функция вызывалась только когда preservedAmount === 0, но теперь
  // редактирование пересчитывает график и при наличии оплаченных платежей — тут это критично.
  // 🔒 Защита от отрицательного остатка (не должно происходить — валидируется до вызова,
  // но подстраховываемся на случай прямого вызова функции с некорректными данными).
  const remainingAmount = Math.max(0, saleData.totalAmount - saleData.downPayment - preservedAmount);
  const monthlyAmount = remainingInstallments > 0
    ? Number((remainingAmount / remainingInstallments).toFixed(2))
    : 0;

  // 🔹 7. Генерируем новые даты для будущих платежей
  const firstDate = new Date(newFirstPaymentDate);

  // 🔹 8. Пропускаем месяцы, которые уже заняты сохранёнными платежами
  const usedMonths = new Set(preservedPayments.map(p => new Date(p.date).toISOString().slice(0, 7)));

  const futurePayments: Payment[] = [];
  let monthOffset = 0;

  while (futurePayments.length < remainingInstallments) {
    const pDate = new Date(firstDate);
    pDate.setMonth(pDate.getMonth() + monthOffset);

    const monthKey = pDate.toISOString().slice(0, 7);

    // 🔹 Пропускаем месяцы, которые уже заняты
    if (!usedMonths.has(monthKey)) {
      futurePayments.push({
        id: `pay_${Date.now()}_${futurePayments.length}_${Math.random().toString(36).substr(2, 6)}`,
        saleId: saleData.id,
        amount: monthlyAmount,
        date: pDate.toISOString(),
        isPaid: false,
        isRealPayment: false
      });
      usedMonths.add(monthKey);
    }

    monthOffset++;
  }

  // 🔹 9. Объединяем и сортируем по дате
  return [...preservedPayments, ...futurePayments].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
};

  // Авто-расчёт цены при вводе закупа (только для новых записей!)
  useEffect(() => {
    // 🔥 НЕ пересчитываем при редактировании — сохраняем оригинальные значения
    if (initialData.id) return;

    if (mode === 'INSTALLMENT' && Number(formData.buyPrice) > 0) {
      if (isPriceManual) return;

      const bp = Number(formData.buyPrice);
      const dp = Number(formData.downPayment) || 0;
      const rate = Number(formData.interestRate);
      const markupBase = appSettings.markupFromNetBuyPrice ? Math.max(0, bp - dp) : bp;
      const calculatedPrice = Math.round(bp + (markupBase * (rate / 100)));

      setFormData(prev => ({ ...prev, price: calculatedPrice }));
    }
  }, [formData.buyPrice, formData.downPayment, formData.interestRate, mode, initialData.id, isPriceManual, appSettings.markupFromNetBuyPrice]);

  useEffect(() => {
    if (mode === 'INSTALLMENT' && downPaymentFromMarkup && Number(formData.buyPrice) > 0) {
      const markupAmount = Math.round(Number(formData.buyPrice) * Number(formData.interestRate) / 100);
      setFormData(prev => ({ ...prev, downPayment: markupAmount }));
    }
  }, [downPaymentFromMarkup, formData.buyPrice, formData.interestRate, mode]);

  // Авто-расчёт даты первого платежа
  useEffect(() => {
    // 🔥 НЕ пересчитываем дату автоматически при редактировании, если пользователь уже менял
    if (initialData.id && formData.paymentDate) return;

    if (!formData.paymentDate) {
      if (initialData.paymentDay && initialData.startDate) {
        const firstPayment = new Date(initialData.startDate);
        firstPayment.setMonth(firstPayment.getMonth() + 1);
        firstPayment.setDate(initialData.paymentDay);
        setFormData(prev => ({ ...prev, paymentDate: firstPayment.toISOString().split('T')[0] }));
      } else if (formData.startDate) {
        const date = new Date(formData.startDate);
        date.setMonth(date.getMonth() + 1);
        setFormData(prev => ({ ...prev, paymentDate: date.toISOString().split('T')[0] }));
      }
    }
  }, [formData.startDate, initialData]);

  // 🔹 1. Базовая цена (Закуп + Наценка)
  const baseCalculatedPrice = useMemo(() => {
    const bp = Number(formData.buyPrice) || 0;
    const dp = Number(formData.downPayment) || 0;
    const rate = Number(formData.interestRate) || 0;
    const markupBase = appSettings.markupFromNetBuyPrice ? Math.max(0, bp - dp) : bp;
    return Math.round(bp + (markupBase * (rate / 100)));
  }, [formData.buyPrice, formData.downPayment, formData.interestRate, appSettings.markupFromNetBuyPrice]);

  // 🔹 1.5. Фактическая наценка. Когда цену вписали руками или включили округление,
  // итоговая сумма перестаёт соответствовать проценту в поле «Наценка» — считаем
  // обратной формулой от той же базы, что и прямой расчёт выше.
  const actualMarkupPercent = useMemo(() => {
    const bp = Number(formData.buyPrice) || 0;
    const dp = Number(formData.downPayment) || 0;
    if (bp <= 0) return null;
    const markupBase = appSettings.markupFromNetBuyPrice ? Math.max(0, bp - dp) : bp;
    if (markupBase <= 0) return null; // взнос покрыл весь закуп — процент считать не от чего
    return ((Number(formData.price) || 0) - bp) / markupBase * 100;
  }, [formData.buyPrice, formData.downPayment, formData.price, appSettings.markupFromNetBuyPrice]);

  // 🔹 2. Расчёт итоговых значений с учётом округления
  const calculatedValues = useMemo(() => {
    const downPayment = Number(formData.downPayment) || 0;
    const installments = Number(formData.installments) || 1;

    if (mode === 'CASH') {
      return {
        totalAmount: Number(formData.price) || 0,
        remainingAmount: 0,
        monthlyPayment: 0
      };
    }

    // 🔥 При редактировании считаем от актуального значения поля "Цена" (formData.price),
    // а не от замороженной исходной суммы — иначе редактирование цены не имело бы эффекта.
    let totalAmount: number;
    if (initialData.id) {
      totalAmount = Number(formData.price) || initialData.totalAmount || 0;
    } else if (roundingMode !== 'NONE' && !isPriceManual && baseCalculatedPrice > 0) {
      // Округляем всегда от исходной цены (закуп + наценка), а не от той, что уже
      // подтянулась под прошлое округление. Иначе после «Вверх» база становится
      // кратной шагу, и переключение на «Вниз» ничего не меняет — направление
      // «залипало» на первом выбранном.
      totalAmount = baseCalculatedPrice;
    } else {
      totalAmount = Number(formData.price) || baseCalculatedPrice;
    }

    // 🔥 ВАЖНО: при редактировании вычитаем уже фактически полученные платежи по графику
    // (preservedPaymentsInfo.amount), иначе remainingAmount ("долг клиента") будет пересчитан
    // так, как будто эти платежи никогда не приходили — именно так терялась информация
    // об уже принятых оплатах при сохранении любого редактирования договора.
    let remainingAmount = totalAmount - downPayment - (initialData.id ? preservedPaymentsInfo.amount : 0);
    let monthlyPayment = installments > 0 ? remainingAmount / installments : 0;

    // 🔹 Применяем округление к ежемесячному платежу
    if (!initialData.id && roundingMode !== 'NONE' && monthlyPayment > 0) {
      // Округление вниз на маленьких суммах могло бы обнулить платёж (500 / 12 при шаге
      // 1000 → 0) и создать договор, по которому клиент ничего не платит. Держим минимум
      // в один шаг.
      const roundedMonthly = roundingMode === 'DOWN'
        ? Math.max(Math.floor(monthlyPayment / roundingStep) * roundingStep, roundingStep)
        : Math.ceil(monthlyPayment / roundingStep) * roundingStep;

      monthlyPayment = roundedMonthly;
      remainingAmount = monthlyPayment * installments;
      totalAmount = remainingAmount + downPayment;
    }

    return { totalAmount, remainingAmount, monthlyPayment };
  }, [
    formData.price,
    formData.downPayment,
    formData.installments,
    roundingMode,
    roundingStep,
    isPriceManual,
    mode,
    baseCalculatedPrice,
    initialData.id,
    initialData.totalAmount,
    preservedPaymentsInfo.amount
  ]);

  useEffect(() => {
    if (mode !== 'INSTALLMENT' || initialData.id) return;
    if (!isPriceManual) return;
    if (roundingMode === 'NONE') return;

    if (calculatedValues.totalAmount !== Number(formData.price)) {
      setFormData(prev => ({ ...prev, price: calculatedValues.totalAmount }));
    }
  }, [roundingMode, calculatedValues.totalAmount, formData.price, mode, initialData.id, isPriceManual]);

  useEffect(() => {
    if (roundingMode === 'NONE') {
      setIsPriceManual(false);
    }
  }, [roundingMode]);

  // 🔹 3. Синхронизация поля "Цена" с режимом округления (только для новых!)
  useEffect(() => {
    if (mode !== 'INSTALLMENT' || initialData.id || isPriceManual) return;

    if (roundingMode !== 'NONE') {
      if (calculatedValues.totalAmount !== Number(formData.price)) {
        setFormData(prev => ({ ...prev, price: calculatedValues.totalAmount }));
      }
    } else {
      if (baseCalculatedPrice > 0 && Number(formData.price) !== baseCalculatedPrice) {
        setFormData(prev => ({ ...prev, price: baseCalculatedPrice }));
      }
    }
  }, [roundingMode, calculatedValues.totalAmount, baseCalculatedPrice, mode, initialData.id, isPriceManual]);

  const handleProductChange = (val: string) => {
    setFormData(prev => ({ ...prev, productName: val, productId: '' }));
    if (val.length > 0) {
      const matched = products.filter(p => p.name.toLowerCase().includes(val.toLowerCase()));
      setSuggestions(matched);
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  };

  const handleSuggestionClick = (product: Product) => {
    setFormData(prev => ({
      ...prev,
      productName: product.name,
      productId: product.id,
      price: product.price,
      buyPrice: 0
    }));
    setShowSuggestions(false);
  };

  const handlePaymentDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const dateVal = e.target.value;

    setFormData(prev => ({
      ...prev,
      paymentDate: dateVal,
      paymentDay: dateVal ? new Date(dateVal).getDate().toString() : ''
    }));
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (isSubscriptionExpired) {
      if (onShowNotification) {
        onShowNotification(
          '⛔ Подписка истекла',
          'Срок подписки истёк. Оформите или продлите подписку для создания и редактирования договоров.',
          'error',
          'Перейти к тарифам',
          () => { /* можно добавить переход к тарифам */ }
        );
      } else {
        alert("⛔ Срок подписки истёк. Оформите подписку для совершения операций.");
      }
      return;
    }

    if (isSubmitting) return;

    if (!formData.customerId || !formData.productName || !formData.accountId) {
      alert("Заполните все обязательные поля");
      return;
    }

    if (isSubmitting) return;

    if (!formData.customerId || !formData.productName || !formData.accountId) {
      alert("Заполните все обязательные поля");
      return;
    }

    // 🔍 ПРОВЕРКА НА ДУБЛИКАТ (только для новых договоров)
    if (!formData.id && mode === 'INSTALLMENT') {
      const duplicate = checkDuplicateSale(
        sales,
        formData.customerId,
        formData.productName,
        formData.startDate,
        calculatedValues.totalAmount,
        formData.id // 🔥 Передаём ID текущего договора для исключения
      );

      if (duplicate) {
        setDuplicateWarning(
          `⚠️ Похожий договор уже существует от ${new Date(duplicate.startDate).toLocaleDateString('ru-RU')}. ` +
          `Проверьте, не создаёте ли вы дубликат.`
        );
      } else {
        setDuplicateWarning(null);
      }
    }

    // 🔒 ЗАЩИТА ИСТОРИИ ПЛАТЕЖЕЙ (только при редактировании рассрочки с уже оплаченными платежами)
    if (formData.id && mode === 'INSTALLMENT' && preservedPaymentsInfo.count > 0) {
      const newInstallments = Number(formData.installments);
      if (newInstallments < preservedPaymentsInfo.count) {
        alert(
          `Нельзя установить срок меньше ${preservedPaymentsInfo.count} мес. — столько платежей по этому договору уже зафиксировано как оплаченные.`
        );
        return;
      }

      const newDownPayment = Number(formData.downPayment);
      const newRemaining = calculatedValues.totalAmount - newDownPayment - preservedPaymentsInfo.amount;
      if (newRemaining < 0) {
        alert(
          `Новая цена слишком мала: по договору уже получено ${preservedPaymentsInfo.amount.toLocaleString('ru-RU')} ₽ платежами` +
          (newDownPayment > 0 ? ` + первый взнос ${newDownPayment.toLocaleString('ru-RU')} ₽` : '') +
          `. Итоговая цена не может быть меньше этой суммы.`
        );
        return;
      }
    }

    setShowConfirmModal(true);
  };

  const handleConfirm = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    let fullSaleObject: any = null;

    try {
      const pDay = formData.paymentDate
        ? new Date(formData.paymentDate).getDate()
        : new Date(formData.startDate).getDate();

      const saleId = formData.id || `sale_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

      let finalStartDate = formData.startDate;
      const now = new Date();
      const selectedDate = new Date(formData.startDate);
      const isToday = selectedDate.getDate() === now.getDate() &&
                      selectedDate.getMonth() === now.getMonth() &&
                      selectedDate.getFullYear() === now.getFullYear();

      if (isToday) {
        finalStartDate = now.toISOString();
      }

      const submissionData = {
        ...formData,
        id: saleId,
        startDate: finalStartDate,
        paymentDay: pDay,
        buyPrice: Number(formData.buyPrice),
        price: Number(formData.price),
        downPayment: Number(formData.downPayment),
        installments: Number(formData.installments),
        interestRate: Number(formData.interestRate),
        roundingMode,
        roundingStep,
      };

      let finalSaleData;
      if (mode === 'CASH') {
        finalSaleData = {
          ...submissionData,
          type: 'CASH',
          totalAmount: calculatedValues.totalAmount,
          downPayment: calculatedValues.totalAmount,
          remainingAmount: 0,
          installments: 0,
          interestRate: 0,
          roundingMode: 'NONE' as const,
        };
      } else {
        finalSaleData = {
          ...submissionData,
          type: 'INSTALLMENT',
          totalAmount: calculatedValues.totalAmount,
          remainingAmount: calculatedValues.remainingAmount,
        };
      }

      // 🔥 КЛЮЧЕВОЙ МОМЕНТ: Генерация/обновление paymentPlan
     // 🔥 КЛЮЧЕВОЙ МОМЕНТ: Генерация/обновление paymentPlan
let paymentPlan: Payment[] = [];

if (mode === 'CASH') {
  // Наличные — графика платежей нет вообще
  paymentPlan = [];
} else if (initialData.id && initialData.paymentPlan) {
  // 🔹 При редактировании: пересчитываем график, если изменилось хоть одно поле,
  // влияющее на суммы/сроки платежей. Уже оплаченные/реальные платежи (isPaid/isRealPayment)
  // ВСЕГДА сохраняются как есть — regeneratePaymentPlan трогает только будущие записи.
  // Сравниваем с impliedOriginalPaymentDate, а не initialData.paymentDate — это поле
  // не персистится в Sale (только paymentDay), поэтому initialData.paymentDate всегда undefined.
  const scheduleAffectingFieldsChanged =
    formData.paymentDate !== impliedOriginalPaymentDate ||
    Number(formData.installments) !== Number(initialData.installments) ||
    Number(formData.downPayment) !== Number(initialData.downPayment) ||
    calculatedValues.totalAmount !== Number(initialData.totalAmount);

  if (scheduleAffectingFieldsChanged) {
    paymentPlan = regeneratePaymentPlan(
      {
        ...formData,
        totalAmount: calculatedValues.totalAmount,
        installments: Number(formData.installments),
        downPayment: Number(formData.downPayment)
      },
      formData.paymentDate,
      initialData.paymentPlan
    );
  } else {
    // Ничего не изменилось — сохраняем оригинальный план как есть.
    // Клонируем, чтобы избежать мутаций исходного объекта
    paymentPlan = initialData.paymentPlan.map((p: Payment) => ({ ...p }));
  }
} else {
  // Для новых договоров рассрочки — полная генерация
  paymentPlan = regeneratePaymentPlan(
    {
      ...formData,
      totalAmount: calculatedValues.totalAmount,
      installments: Number(formData.installments),
      downPayment: Number(formData.downPayment)
    },
    formData.paymentDate
  );
}

      fullSaleObject = {
        ...finalSaleData,
        paymentPlan,
        updatedAt: new Date().toISOString()
      };

      // 🔥 ОТПРАВКА НА СЕРВЕР
      await onSubmit(fullSaleObject);

      setCreatedSale(fullSaleObject);
      setShowConfirmModal(false);
      setShowSuccessModal(true);
      hapticSuccess(); // короткий двойной отклик — операция завершена

    } catch (error: any) {
      console.error('❌ Save error:', error);
      setShowConfirmModal(false);

      if (onShowNotification) {
        onShowNotification(
          'Ошибка сохранения',
          error?.message || 'Не удалось сохранить договор. Проверьте соединение и попробуйте снова.',
          'error',
          'Повторить',
          () => handleConfirm()
        );
      } else {
        alert(`❌ Ошибка: ${error?.message || 'Не удалось сохранить договор'}`);
      }

    } finally {
      setIsSubmitting(false);
    }
  };

  const updateMode = (newMode: 'INSTALLMENT' | 'CASH') => {
    setMode(newMode);
    setFormData(prev => ({ ...prev, mode: newMode }));
  };

  // === renderContractContent (Скрытый рендер для PDF) ===
  const renderContractContent = () => {


    if (!createdSale || !selectedCustomer) return null;
    const sale = createdSale;
    const companyName = appSettings?.companyName || "Компания";
    const hasGuarantor = !!sale.guarantorName;
    const sellerPhone = getSellerPhone(user, appSettings);

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
      sectionItemLast: { marginBottom: 0 },
      table: { width: '100%' as const, borderCollapse: 'collapse' as const, margin: '20px 0', fontSize: '11pt' },
      th: { border: '1px solid #000', padding: '10px', textAlign: 'center' as const, verticalAlign: 'middle' as const, fontWeight: 'bold' as const, background: '#f9f9f9' },
      td: { border: '1px solid #000', padding: '10px', textAlign: 'center' as const, verticalAlign: 'middle' as const },
      footerContainer: { marginTop: 'auto', paddingTop: '20px', width: '100%', breakInside: 'avoid' as const },
      footer: { display: 'flex', justifyContent: 'space-between' as const, alignItems: 'flex-end' as const, width: '100%' },
      signatureBlock: (width: string) => ({ textAlign: 'center' as const, width, breakInside: 'avoid' as const }),
      signatureLine: { borderBottom: '1px solid #000', margin: '35px 0 5px 0', minHeight: '1px' },
      signatureLabel: { fontSize: '10pt', fontStyle: 'italic' as const }
    };

    // 🔒 Та же модель графика, что и в печати договора (Contracts.tsx) и в чеке прихода
    // (NewIncome.tsx): плановая дата месяца видна ТОЛЬКО пока по нему не прошло ни одной реальной
    // оплаты. Как только на месяц пришли деньги (даже частично), его плановая строка заменяется
    // строкой(-ами) с ФАКТИЧЕСКИМИ датами и суммами платежей. Сколько месяцев уже задето деньгами,
    // считаем от ОБЩЕЙ суммы реальных платежей (surplus), а не доверяем сохранённому флагу isPaid
    // планового слота — он бывает неактуален.
    const realPaymentsForSchedule = (sale.paymentPlan || []).filter(p => p.isRealPayment === true);
    let scheduleSurplus = realPaymentsForSchedule.reduce((sum, p) => sum + p.amount, 0);
    const uncoveredScheduled = (sale.paymentPlan || [])
        .filter(p => p.isRealPayment !== true)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .filter(p => {
            if (scheduleSurplus > 0.01) {
                scheduleSurplus -= p.amount;
                return false;
            }
            return true;
        });

    let currentDebt = sale.totalAmount - sale.downPayment;
    const scheduleRows = [
        ...realPaymentsForSchedule.map(p => ({ date: p.date, paid: p.amount })),
        ...uncoveredScheduled.map(p => ({ date: p.date, paid: 0 }))
    ]
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .map(p => {
            if (p.paid > 0) currentDebt -= p.paid;
            return { date: new Date(p.date), paid: p.paid, remaining: Math.max(0, currentDebt) };
        });

    return (
      <div ref={contractRef} style={styles.page}>
        <h1 style={styles.h1}>ДОГОВОР КУПЛИ-ПРОДАЖИ ТОВАРА В РАССРОЧКУ</h1>
        <div style={styles.headerInfo}>Дата: {new Date(sale.startDate).toLocaleDateString()}</div>
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
                <span><span style={styles.fieldLabel}>Поручитель:</span> {sale.guarantorName}</span>
                <span style={styles.phoneField}>Тел: {formatPhone(sale.guarantorPhone)}</span>
              </div>
            )}
          </div>
          <div style={styles.section}>
            <div style={styles.sectionItem}><span style={styles.fieldLabel}>Товар:</span> {sale.productName}</div>
            <div style={{ ...styles.sectionItem, display: 'flex', justifyContent: 'space-between', marginTop: '10px' }}>
              <span><span style={styles.fieldLabel}>Срок рассрочки:</span> {sale.installments} мес.</span>
              <span><span style={styles.fieldLabel}>Стоимость:</span> {sale.totalAmount.toLocaleString()} ₽</span>
            </div>
            <div style={{ ...styles.sectionItemLast, display: 'flex', justifyContent: 'space-between' }}>
              <span><span style={styles.fieldLabel}>Ежемесячный платеж:</span> {(sale.paymentPlan[0]?.amount || 0).toLocaleString()} ₽</span>
              <span><span style={styles.fieldLabel}>Первый взнос:</span> {sale.downPayment.toLocaleString()} ₽</span>
            </div>
          </div>

          <table style={styles.table}>
            <thead>
              <tr>
                <th style={{ ...styles.th, width: '10%' }}>№</th>
                <th style={{ ...styles.th, width: '30%' }}>Дата</th>
                <th style={{ ...styles.th, width: '25%' }}>Сумма</th>
                <th style={{ ...styles.th, width: '35%' }}>Остаток долга</th>
              </tr>
            </thead>
            <tbody>
              {scheduleRows.length > 0 ? scheduleRows.map((p, index) => (
                <tr key={index}>
                  <td style={styles.td}>{index + 1}</td>
                  <td style={styles.td}>{p.date.toLocaleDateString()}</td>
                  <td style={styles.td}>{p.paid > 0.01 ? `${p.paid.toLocaleString()} ₽` : ''}</td>
                  <td style={styles.td}>{p.paid > 0.01 ? `${p.remaining.toLocaleString()} ₽` : ''}</td>
                </tr>
              )) : Array.from({ length: sale.installments || 1 }).map((_, index) => (
                <tr key={index}>
                  <td style={styles.td}>{index + 1}</td>
                  <td style={styles.td}></td>
                  <td style={styles.td}></td>
                  <td style={styles.td}></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ margin: '25px 0', fontSize: '11pt', lineHeight: 1.4 }}>
            Продавец обязуется передать Покупателю товар, а Покупатель обязуется принять и оплатить его в рассрочку на указанных выше условиях.
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

  // === generatePDFBlob using html2canvas ===
  // 🔹 jsPDF/html2canvas грузятся динамически — они нужны только для этого экспорта
  // (WhatsApp-отправка PDF), не для основного создания договора, и не должны попадать
  // в главный бандл.
  const generatePDFBlob = async (): Promise<Blob> => {
    if (!contractRef.current) throw new Error("Contract element not found");
    let jsPDF: any, html2canvas: any;
    try {
      [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'),
        import('html2canvas')
      ]);
    } catch (importErr: any) {
      // Старый кеш PWA после деплоя — сервер вернул HTML вместо JS-чанка
      if (importErr?.message?.includes('MIME') || importErr?.message?.includes('text/html')) {
        const err: any = new Error('APP_UPDATE_REQUIRED');
        err.isUpdateRequired = true;
        throw err;
      }
      throw importErr;
    }
    const element = contractRef.current;
    const originalStyle = {
      display: element.style.display,
      position: element.style.position,
      left: element.style.left,
      top: element.style.top,
      visibility: element.style.visibility,
      zIndex: element.style.zIndex
    };

    element.style.display = 'block';
    element.style.position = 'absolute';
    element.style.left = '0';
    element.style.top = '0';
    element.style.visibility = 'visible';
    element.style.zIndex = '9999';
    element.style.background = 'white';

    try {
      await new Promise(resolve => setTimeout(resolve, 300));
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.8);
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
      return pdf.output('blob');
    } finally {
      element.style.display = originalStyle.display;
      element.style.position = originalStyle.position;
      element.style.left = originalStyle.left;
      element.style.top = originalStyle.top;
      element.style.visibility = originalStyle.visibility;
      element.style.zIndex = originalStyle.zIndex;
    }
  };

  const handleSendContract = async () => {
    setShowWhatsAppConfirmModal(true);
  };

  const handleConfirmSendWhatsApp = async () => {
    if (isSendingWhatsApp) return;

    if (!createdSale || !selectedCustomer || !appSettings.whatsapp?.enabled) {
      setShowWhatsAppConfirmModal(false);
      return;
    }

    setIsSendingWhatsApp(true);
    setSendStage('pdf');
    haptic();

    try {
      const blob = await generatePDFBlob();
      setSendStage('upload');
      const dateStr = new Date(createdSale.startDate || Date.now()).toISOString().split('T')[0].replace(/-/g, '');
      const safeProductName = (createdSale.productName || 'Contract')
        .replace(/[^a-zA-Z0-9]/g, '_')
        .substring(0, 20);
      const fileName = `${safeProductName}_${dateStr}.pdf`;

      const cleanPhone = selectedCustomer.phone?.replace(/\D/g, '') || '';
      const whatsappPhone = cleanPhone.startsWith('8')
        ? '7' + cleanPhone.slice(1)
        : cleanPhone.startsWith('7')
          ? cleanPhone
          : '7' + cleanPhone;

      const success = await sendWhatsAppFile(
        appSettings.whatsapp.idInstance,
        appSettings.whatsapp.apiTokenInstance,
        whatsappPhone,
        blob,
        fileName
      );

      if (success) {
        // Показываем галочку прямо в окне отправки, даём ей доиграть и только потом закрываем —
        // подтверждение должно быть увидено, а не мелькнуть.
        setSendStage('done');
        hapticSuccess();
        await new Promise(resolve => setTimeout(resolve, 1100));
        setShowWhatsAppConfirmModal(false);
        setSendStage('idle');

     
      } else {
        throw new Error('Green API вернул ошибку отправки. Проверьте статус инстанса.');
      }

    } catch (error: any) {
      // При любой ошибке окно закрываем — дальше сообщение показывает вызывающая сторона
      setShowWhatsAppConfirmModal(false);
      setSendStage('idle');

      // Приложение обновилось, кеш устарел — просим перезагрузить
      if (error?.isUpdateRequired || error?.message === 'APP_UPDATE_REQUIRED' ||
          error?.message?.includes('MIME') || error?.message?.includes('text/html')) {
        if (onShowNotification) {
          onShowNotification(
            '🔄 Требуется обновление',
            'Приложение было обновлено. Перезагрузите страницу и попробуйте снова.',
            'warning',
            'Перезагрузить',
            () => window.location.reload()
          );
        } else {
          if (window.confirm('Приложение обновилось. Нажмите OK для перезагрузки.')) {
            window.location.reload();
          }
        }
        return;
      }

      console.error("❌ WhatsApp send error:", {
        message: error?.message,
        stack: error?.stack,
        customer: selectedCustomer?.name,
        phone: selectedCustomer?.phone
      });

      const errorMessage = error?.message || 'Неизвестная ошибка';

      if (onShowNotification) {
        onShowNotification(
          '❌ Ошибка отправки',
          `Не удалось отправить договор: ${errorMessage}`,
          'error',
          'Повторить',
          () => setShowWhatsAppConfirmModal(true)
        );
      } else {
        alert(`❌ Ошибка: ${errorMessage}\n\nПроверьте:\n• Статус WhatsApp инстанса\n• Корректность номера телефона\n• Соединение с интернетом`);
      }

    } finally {
      setIsSendingWhatsApp(false);
    }
  };

  const handlePrintContract = () => {
    if (!createdSale) return;
    const sale = createdSale;
    const customer = selectedCustomer;
    const companyName = appSettings?.companyName || "Компания";
    const sellerPhone = getSellerPhone(user, appSettings);
    const hasGuarantor = !!sale.guarantorName;
    const printWindow = window.open('', '_blank');
    if (!printWindow) { alert("Разрешите всплывающие окна для печати"); return; }

    // 🔒 Та же модель графика, что и в печати договора (Contracts.tsx), чеке прихода (NewIncome.tsx)
    // и PDF-отправке (renderContractContent выше): каждый реальный (в т.ч. частичный) платёж —
    // своя строка с датой и суммой; ещё не покрытые месяцы графика — только дата, без суммы.
    // Покрытие пересчитываем от ОБЩЕЙ суммы реальных платежей (surplus), а не доверяем сохранённому
    // флагу isPaid планового слота — он бывает неактуален, из-за чего рядом с уже оплаченной датой
    // оставался "призрачный" пустой дубль той же даты. Раньше здесь были всегда пустые строки без
    // единой даты.
    const printRealPayments = (sale.paymentPlan || []).filter(p => p.isRealPayment === true);
    let printSurplus = printRealPayments.reduce((sum, p) => sum + p.amount, 0);
    const printUncoveredScheduled = (sale.paymentPlan || [])
        .filter(p => p.isRealPayment !== true)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .filter(p => {
            if (printSurplus >= p.amount - 0.01) {
                printSurplus -= p.amount;
                return false;
            }
            return true;
        });

    let printCurrentDebt = sale.totalAmount - sale.downPayment;
    const printScheduleRows = [
        ...printRealPayments.map(p => ({ date: p.date, paid: p.amount })),
        ...printUncoveredScheduled.map(p => ({ date: p.date, paid: 0 }))
    ]
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .map(p => {
            if (p.paid > 0) printCurrentDebt -= p.paid;
            return { date: p.date, paid: p.paid, remaining: Math.max(0, printCurrentDebt) };
        });

    const rows = printScheduleRows.length > 0
        ? printScheduleRows.map((p, index) => `
      <tr>
        <td style="text-align: center;">${index + 1}</td>
        <td style="text-align: center;">${formatDate(p.date)}</td>
        <td style="text-align: center;">${p.paid > 0.01 ? `${p.paid.toLocaleString()} ₽` : ''}</td>
        <td style="text-align: center;">${p.paid > 0.01 ? `${p.remaining.toLocaleString()} ₽` : ''}</td>
      </tr>
    `).join('')
        : Array.from({ length: sale.installments || 1 }).map((_, index) => `
      <tr>
        <td style="text-align: center;">${index + 1}</td>
        <td style="text-align: center; height: 30px;"></td>
        <td style="text-align: center;"></td>
        <td style="text-align: center;"></td>
      </tr>
    `).join('');

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Договор купли-продажи</title>
        <style>
          * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          body {
            font-family: 'Arial', Helvetica, sans-serif;
            font-size: 12pt;
            line-height: 1.5;
            padding: 20mm;
            width: 100%;
            max-width: 210mm;
            margin: 0 auto;
          }
          h1 { text-align: center; font-size: 15pt; font-weight: bold; margin: 0 0 25px 0; text-transform: uppercase; }
          .header-info { text-align: right; margin-bottom: 20px; font-size: 11pt; }
          .field-row { display: flex; justify-content: space-between; margin-bottom: 10px; }
          .field-label { font-weight: bold; }
          .section { margin: 0 0 20px 0; }
          .section > div { margin-bottom: 12px; }
          .section > div:last-child { margin-bottom: 0; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 10.5pt; }
          th, td { border: 1px solid #000; padding: 8px; text-align: center; }
          th { font-weight: bold; background: #f9f9f9; }
          .content-wrapper { width: 100%; }
          .footer-container {
            width: 100%;
            margin-top: 40px;
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .footer { display: flex; justify-content: space-between; align-items: flex-end; width: 100%; }
          .signature-block { text-align: center; break-inside: avoid; page-break-inside: avoid; }
          .signature-line { border-bottom: 1px solid #000; margin: 40px 0 5px 0; min-height: 1px; }
          .signature-label { font-size: 10pt; font-style: italic; }
          .no-print {
            position: fixed; top: 15px; right: 15px; padding: 10px 18px;
            background: #ef4444; color: white; border: none; border-radius: 6px;
            cursor: pointer; font-family: sans-serif; font-weight: 600; z-index: 1000;
          }
          @media print {
            @page { margin: 1.5cm; size: A4 portrait; }
            body { padding: 0; margin: 0; width: 100%; max-width: none; }
            .field-row { flex-wrap: nowrap !important; gap: 0 !important; }
            .field-row > span:last-child { text-align: right !important; margin-left: 10px; }
            .content-wrapper { margin-bottom: 170px; }
            .footer-container {
              position: relative !important; bottom: auto !important; left: auto !important;
              right: auto !important; width: 100% !important; margin: 0 !important;
              padding-top: 0 !important; margin-top: -150px !important;
              break-inside: avoid !important; page-break-inside: avoid !important;
            }
            .footer { display: flex !important; justify-content: space-between !important; }
            .signature-block { display: block !important; visibility: visible !important; }
            .no-print { display: none !important; }
            h1 { font-size: 14pt; }
            table { font-size: 10pt; }
          }
          @media screen and (max-width: 768px) {
            body { font-size: 11pt; padding: 15px; }
            .field-row { flex-wrap: wrap; gap: 5px; }
            table { font-size: 9.5pt; }
          }
        </style>
      </head>
      <body>
        <button class="no-print" onclick="window.close()">✕ Закрыть</button>
        <h1>ДОГОВОР КУПЛИ-ПРОДАЖИ ТОВАРА В РАССРОЧКУ</h1>
        <div class="header-info">Дата: ${new Date(sale.startDate).toLocaleDateString()}</div>
        <div class="content-wrapper">
          <div class="section">
            <div class="field-row">
              <span><span class="field-label">Продавец:</span> ${escapeHtml(companyName)}</span>
              <span>Тел: ${escapeHtml(formatPhone(sellerPhone))}</span>
            </div>
            <div class="field-row">
              <span><span class="field-label">Покупатель:</span> ${customer?.name ? escapeHtml(customer.name) : '__________________'}</span>
              <span>Тел: ${customer?.phone ? escapeHtml(customer.phone) : '+7 (___) ___-__-__'}</span>
            </div>
            ${hasGuarantor ? `<div class="field-row"><span><span class="field-label">Поручитель:</span> ${escapeHtml(sale.guarantorName)}</span><span>Тел: ${escapeHtml(sale.guarantorPhone || '')}</span></div>` : ''}
          </div>
          <div class="section">
            <div><span class="field-label">Товар:</span> ${escapeHtml(sale.productName)}</div>
            <div style="display: flex; justify-content: space-between; margin-top: 10px;">
              <span><span class="field-label">Срок рассрочки:</span> ${sale.installments} мес.</span>
              <span><span class="field-label">Стоимость:</span> ${sale.totalAmount.toLocaleString()} ₽</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span><span class="field-label">Ежемесячный платеж:</span> ${(sale.paymentPlan[0]?.amount || 0).toLocaleString()} ₽</span>
              <span><span class="field-label">Первый взнос:</span> ${sale.downPayment.toLocaleString()} ₽</span>
            </div>
          </div>
          <table>
            <thead><tr><th style="width: 10%;">№</th><th style="width: 30%;">Дата</th><th style="width: 25%;">Сумма</th><th style="width: 35%;">Остаток долга</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <div style="margin: 25px 0; font-size: 11pt; line-height: 1.4;">
            Продавец обязуется передать Покупателю товар, а Покупатель обязуется принять и оплатить его в рассрочку на указанных выше условиях.
          </div>
        </div>
        <div class="footer-container">
          <div class="footer">
            <div class="signature-block" style="width: ${hasGuarantor ? '30%' : '45%'}">
              <div class="signature-line"></div>
              <div class="signature-label">Продавец</div>
            </div>
            ${hasGuarantor ? `<div class="signature-block" style="width: 30%"><div class="signature-line"></div><div class="signature-label">Поручитель</div></div>` : ''}
            <div class="signature-block" style="width: ${hasGuarantor ? '30%' : '45%'}">
              <div class="signature-line"></div>
              <div class="signature-label">Покупатель</div>
            </div>
          </div>
        </div>
        <script>window.onload = function() { setTimeout(() => { window.print(); }, 300); }</script>
      </body>
      </html>
    `;
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  return (
    <div className="space-y-4 animate-fade-in pb-20">
      {/* === СКРЫТЫЙ КОНТРАКТ ДЛЯ PDF === */}
      {renderContractContent()}

      <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-700 pb-4 bg-white dark:bg-slate-800 sticky top-0 z-10 pt-2">
        <button onClick={onClose} className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">{ICONS.Back}</button>
        <h2 className="text-xl font-bold text-slate-800 dark:text-white">
          {formData.id ? (
            <span className="flex items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              Редактирование договора
            </span>
          ) : 'Новое оформление'}
        </h2>
      </div>

      {/* 🔹 Индикатор режима редактирования */}
      {formData.id && (
        <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-2">
          <span>✏️</span>
          {preservedPaymentsInfo.count > 0
            ? `Вы редактируете договор. По нему уже есть платежи (${preservedPaymentsInfo.count}) от клиента, поэтому закуп, наценка, цена, срок и первый взнос заблокированы. Остальное (товар, касса, поручитель, даты) можно менять.`
            : 'Вы редактируете договор. При изменении суммы, срока или даты график платежей будет пересчитан заново.'}
        </div>
      )}

      <div className="flex bg-white dark:bg-slate-800 p-1 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700">
        <button type="button" onClick={() => !formData.id && updateMode('INSTALLMENT')} disabled={!!formData.id}
                className={`flex-1 py-3 text-sm font-bold rounded-lg transition-all ${mode === 'INSTALLMENT' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'} ${formData.id ? 'cursor-not-allowed opacity-70' : ''}`}>Рассрочка</button>
        <button type="button" onClick={() => !formData.id && updateMode('CASH')} disabled={!!formData.id}
                className={`flex-1 py-3 text-sm font-bold rounded-lg transition-all ${mode === 'CASH' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'} ${formData.id ? 'cursor-not-allowed opacity-70' : ''}`}>Наличные</button>
      </div>
      {formData.id && (
          <p className="text-[10px] text-slate-400 dark:text-slate-500 -mt-2">
            Тип сделки (рассрочка/наличные) нельзя изменить после создания договора
          </p>
      )}

      <form onSubmit={handleFormSubmit} className="space-y-4">
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <div className="flex flex-wrap gap-6">
            <div className="w-40">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Дата продажи</label>
              <input type="date" required
                     className="w-full p-2 border rounded-lg outline-none bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm border-slate-300 dark:border-slate-600 focus:border-indigo-500"
                     value={formData.startDate}
                     onChange={e => setFormData({...formData, startDate: e.target.value})}/>
            </div>
            {mode === 'INSTALLMENT' && (
                <div className="w-40">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Первый платеж
                  </label>
                  <input type="date" required
                         className="w-full p-2 border rounded-lg outline-none bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm border-slate-300 dark:border-slate-600 focus:border-indigo-500"
                         value={formData.paymentDate}
                         onChange={handlePaymentDateChange}/>
                  {/* 🔹 Подсказка */}
                  {formData.id && (
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                        💡 Изменение даты пересчитает график будущих (ещё не оплаченных) платежей
                      </p>
                  )}
                </div>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Клиент</label>
          <div onClick={() => onSelectCustomer({...formData, mode})}
               className={`w-full p-3 border rounded-lg cursor-pointer flex justify-between items-center ${formData.customerId ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800' : 'bg-slate-50 dark:bg-slate-700/50 border-dashed border-slate-300 dark:border-slate-600'}`}>
            <div className="flex items-center gap-2">
              {formData.customerId && <div className="text-indigo-600 dark:text-indigo-400">{ICONS.Customers}</div>}
              <span
                  className={formData.customerId ? 'text-slate-800 dark:text-white font-bold' : 'text-slate-400 dark:text-slate-500'}>{selectedCustomer ? selectedCustomer.name : 'Выбрать клиента...'}</span>
            </div>
            <span className="text-slate-400 dark:text-slate-500"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                                                  stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                                                  strokeLinejoin="round"><polyline
                points="9 18 15 12 9 6"/></svg></span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm relative">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Товар</label>
          <input type="text"
                 className="w-full p-3 border rounded-lg outline-none text-slate-900 dark:text-white placeholder:text-slate-400 bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600"
                 placeholder="Введите название товара..."
                 value={formData.productName}
                 onChange={(e) => handleProductChange(e.target.value)}/>
          {showSuggestions && suggestions.length > 0 && (
              <div
                  className="absolute left-4 right-4 top-[72px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-20 max-h-40 overflow-y-auto">
                {suggestions.map(s => (
                    <div key={s.id}
                         className="p-3 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer border-b border-slate-50 dark:border-slate-700 last:border-0 text-slate-800 dark:text-white"
                         onClick={() => handleSuggestionClick(s)}>
                      <p className="font-medium text-slate-800 dark:text-white">{s.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Цена: {s.price} ₽</p>
                    </div>
                ))}
              </div>
          )}
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Касса (Приход)</label>
          <select required
                  className="w-full p-3 bg-white dark:bg-slate-900 border rounded-lg outline-none text-slate-900 dark:text-white border-slate-300 dark:border-slate-600"
                  value={formData.accountId}
                  onChange={e => setFormData({...formData, accountId: e.target.value})}>
            {/* Скрытые счета не предлагаем, но уже выбранный оставляем — иначе при
                редактировании договора со скрытым счётом значение слетело бы на чужой */}
            {accounts.filter(a => !a.isArchived || a.id === formData.accountId)
                     .map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        {showSupplierField && (
          <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Поставщик (Партнер)</label>
            <select
                className={`w-full p-3 border rounded-lg outline-none bg-white dark:bg-slate-900 text-slate-900 dark:text-white ${isFinancialLocked ? 'border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-700 cursor-not-allowed' : 'border-slate-300 dark:border-slate-600'}`}
                value={formData.supplierId || ''}
                disabled={isFinancialLocked}
                onChange={e => { if (isFinancialLocked) return; setFormData({...formData, supplierId: e.target.value || undefined}); }}>
              <option value="">Без поставщика (списать закуп сразу)</option>
              {supplierList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {formData.supplierId && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                Закуп не будет списан со счёта — заведётся долг перед поставщиком, оплатить можно из деталей договора.
              </p>
            )}
          </div>
        )}

        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
          {/* 🔹 Закуп и Наценка */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Закуп (Себест.)</label>
              <input
                  type="number"
                  min="0"
                  className={`w-full p-3 border rounded-lg outline-none bg-white dark:bg-slate-900 text-slate-900 dark:text-white ${isFinancialLocked ? 'border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-700 cursor-not-allowed' : 'border-slate-300 dark:border-slate-600'}`}
                  value={formData.buyPrice === 0 ? '' : formData.buyPrice}
                  onChange={e => {
                    if (isFinancialLocked) return;
                    setFormData({...formData, buyPrice: e.target.value});
                    setIsPriceManual(false);
                  }}
                  placeholder="0"
                  disabled={isFinancialLocked}/>
            </div>
            {mode === 'INSTALLMENT' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Наценка (%)</label>
                  <input
                      type="number"
                      min="0"
                      className={`w-full p-3 border rounded-lg outline-none bg-white dark:bg-slate-900 text-slate-900 dark:text-white ${isFinancialLocked ? 'border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-700 cursor-not-allowed' : 'border-slate-300 dark:border-slate-600'}`}
                      value={formData.interestRate === 0 ? '' : formData.interestRate}
                      onChange={e => {
                        if (isFinancialLocked) return;
                        setFormData({...formData, interestRate: e.target.value});
                        setIsPriceManual(false);
                      }}
                      placeholder="0"
                      disabled={isFinancialLocked}/>
                  {formData.id && !isFinancialLocked && (
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                        Справочно: не пересчитывает цену автоматически при редактировании
                      </p>
                  )}
                  {/* Цену вписали руками — процент в поле выше больше не отражает
                      реальную наценку, показываем фактическую */}
                  {actualMarkupPercent !== null
                    && Math.abs(actualMarkupPercent - (Number(formData.interestRate) || 0)) >= 0.1 && (
                      <p className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 mt-1">
                        Фактически: {actualMarkupPercent.toFixed(1)}%
                      </p>
                  )}
                </div>
            )}
          </div>

          {/* 🔹 Цена в рассрочку / Цена продажи */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              {mode === 'INSTALLMENT' ? 'Цена в рассрочку' : 'Цена продажи'}
            </label>
            <div className="relative">
              <input
                  type="number"
                  min="0"
                  className={`w-full p-3 border rounded-lg outline-none font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-900 transition-all ${
                      isFinancialLocked
                          ? 'border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-700 cursor-not-allowed'
                          : isPriceManual && !formData.id
                              ? 'border-indigo-400 dark:border-indigo-500 ring-2 ring-indigo-100 dark:ring-indigo-900/40'
                              : 'border-slate-300 dark:border-slate-600 hover:border-indigo-300 dark:hover:border-indigo-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900/40'
                  }`}
                  value={formData.price === 0 ? '' : formData.price}
                  onChange={e => {
                    if (isFinancialLocked) return;
                    const val = e.target.value;
                    setFormData({
                      ...formData,
                      price: val === '' ? 0 : Number(val)
                    });
                    setIsPriceManual(true);
                  }}
                  placeholder="0"
                  disabled={isFinancialLocked}
              />
              {mode === 'INSTALLMENT' && !formData.id && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase">
                    {isPriceManual ? (
                        <span className="text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 rounded-full">Вручную</span>
                    ) : (
                        <span className="text-emerald-500 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full">Авто</span>
                    )}
                  </div>
              )}
            </div>
          </div>

          {/* 🔹 Срок и Первый взнос */}
          {mode === 'INSTALLMENT' && (
              <div className="grid grid-cols-2 gap-4 border-t border-slate-100 dark:border-slate-700 pt-4">
                {/* Срок */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Срок (мес.)</label>
                  <input
                      type="number"
                      min="1"
                      max="24"
                      className={`w-full p-3 border rounded-lg outline-none text-slate-900 dark:text-white bg-white dark:bg-slate-900 ${isFinancialLocked ? 'border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-700 cursor-not-allowed' : 'border-slate-300 dark:border-slate-600'}`}
                      value={formData.installments === 0 ? '' : formData.installments}
                      onChange={e => !isFinancialLocked && setFormData({...formData, installments: e.target.value})}
                      placeholder="0"
                      disabled={isFinancialLocked}/>
                  {isFinancialLocked && (
                      <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                        🔒 Заблокировано: по договору уже есть платёж от клиента
                      </p>
                  )}
                </div>

                {/* 🔹 Первый взнос + чекбокс в одну строку */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Первый взнос (₽)</label>
                  <div className="relative">
                    <input
                        type="number"
                        min="0"
                        max={calculatedValues.totalAmount}
                        className={`w-full p-3 pr-12 border rounded-lg outline-none text-slate-900 dark:text-white bg-white dark:bg-slate-900 transition-all ${
                            isFinancialLocked
                                ? 'border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-700 cursor-not-allowed'
                                : downPaymentFromMarkup && !formData.id
                                    ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-900/20 ring-2 ring-emerald-100 dark:ring-emerald-900/40'
                                    : 'border-slate-300 dark:border-slate-600 hover:border-indigo-300 dark:hover:border-indigo-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900/40'
                        }`}
                        value={formData.downPayment === 0 ? '' : formData.downPayment}
                        onChange={e => {
                          if (isFinancialLocked) return;
                          setFormData({...formData, downPayment: e.target.value});
                          if (downPaymentFromMarkup) setDownPaymentFromMarkup(false);
                        }}
                        placeholder="0"
                        disabled={downPaymentFromMarkup || isFinancialLocked}
                    />
                    {downPaymentFromMarkup && !formData.id && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
                          </svg>
                        </div>
                    )}
                  </div>

                  {/* ✅ Чекбокс в одну строку */}
                  {Number(formData.buyPrice) > 0 && !formData.id && (
                      <label
                          className="flex items-center gap-3 p-3 rounded-xl cursor-pointer group hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors border border-transparent hover:border-slate-200 dark:hover:border-slate-600">
                        <div className="relative flex-shrink-0">
                          <input
                              type="checkbox"
                              checked={downPaymentFromMarkup}
                              onChange={e => setDownPaymentFromMarkup(e.target.checked)}
                              className="w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-0 cursor-pointer"
                          />
                          {downPaymentFromMarkup && (
                              <span className="absolute inset-0 rounded-full bg-indigo-100 dark:bg-indigo-900/40 animate-ping opacity-20"/>
                          )}
                        </div>
                        <div className="flex-1 flex items-center justify-between gap-3 min-w-0">
              <span
                  className="text-xs text-slate-600 dark:text-slate-300 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors font-medium truncate">
                Взнос
              </span>
                          <span
                              className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-1 rounded-lg whitespace-nowrap flex-shrink-0">
                +{Math.round(Number(formData.buyPrice) * formData.interestRate / 100).toLocaleString()} ₽
              </span>
                        </div>
                      </label>
                  )}
                </div>
              </div>
          )}
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
          <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300">Поручитель (необязательно)</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">ФИО Поручителя</label><input
                type="text"
                className="w-full p-3 border rounded-lg outline-none bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-slate-300 dark:border-slate-600"
                value={formData.guarantorName}
                onChange={e => setFormData({...formData, guarantorName: e.target.value})}/></div>
            <div><label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Телефон поручителя</label><input
                type="text"
                className="w-full p-3 border rounded-lg outline-none bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-slate-300 dark:border-slate-600"
                value={formData.guarantorPhone}
                onChange={e => setFormData({...formData, guarantorPhone: e.target.value})}/></div>
          </div>
        </div>

        <div
            className={`${mode === 'INSTALLMENT' ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-100 dark:border-indigo-900/50' : 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-100 dark:border-emerald-900/50'} p-5 rounded-xl space-y-3 border`}>
          <div className="flex justify-between text-sm"><span
              className="text-slate-500 dark:text-slate-400">{mode === 'INSTALLMENT' ? 'Итоговая цена' : 'Цена продажи'}</span><span
              className="font-medium text-slate-900 dark:text-white">{calculatedValues.totalAmount.toLocaleString()} ₽</span></div>
          {mode === 'INSTALLMENT' && (
              <>
                <div className="flex justify-between text-sm"><span
                    className="text-slate-500 dark:text-slate-400">Чистая прибыль</span><span
                    className="font-medium text-emerald-600 dark:text-emerald-400">+{Math.round(calculatedValues.totalAmount - Number(formData.buyPrice)).toLocaleString()} ₽</span>
                </div>
                {!formData.id && (
                    <div className="flex flex-col gap-2 text-sm pt-3 border-t border-indigo-100 dark:border-indigo-900/50">
                      <span className="text-slate-500 dark:text-slate-400 font-medium">
                        Округление платежа{roundingMode !== 'NONE' ? ` (до ${roundingStep} ₽)` : ''}
                      </span>
                      <div className="flex bg-slate-100 dark:bg-slate-700 p-1 rounded-lg">
                        <button type="button" onClick={() => setRoundingMode('NONE')}
                                className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${roundingMode === 'NONE' ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}>Нет
                        </button>
                        <button type="button" onClick={() => setRoundingMode('DOWN')}
                                className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${roundingMode === 'DOWN' ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}>Вниз
                        </button>
                        <button type="button" onClick={() => setRoundingMode('UP')}
                                className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${roundingMode === 'UP' ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}>Вверх
                        </button>
                      </div>
                      {/* Шаг нужен только при включённом округлении — иначе не занимаем место */}
                      {roundingMode !== 'NONE' && (
                        <div className="flex bg-slate-100 dark:bg-slate-700 p-1 rounded-lg animate-fade-in">
                          {[100, 500, 1000].map(step => (
                            <button key={step} type="button" onClick={() => setRoundingStep(step)}
                                    className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${roundingStep === step ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}>
                              {step} ₽
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                )}
                <div className="flex justify-between text-sm pt-3 border-t border-indigo-100 dark:border-indigo-900/50"><span
                    className="text-indigo-800 dark:text-indigo-300 font-semibold">Платёж в месяц</span><span
                    className="text-indigo-800 dark:text-indigo-300 font-bold">{calculatedValues.monthlyPayment.toLocaleString(undefined, {maximumFractionDigits: 0})} ₽</span>
                </div>
              </>
          )}
        </div>

        <button
            type="submit"
            disabled={isSubmitting || isSubscriptionExpired}
            className={`btn-press w-full text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 ${
                isSubscriptionExpired
                    ? 'bg-slate-400 cursor-not-allowed shadow-none'
                    : isSubmitting
                        ? 'bg-slate-400 cursor-not-allowed'
                        : mode === 'INSTALLMENT'
                            ? 'bg-indigo-600 hover:bg-indigo-700'
                            : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
        >
          {isSubscriptionExpired ? (
              <span className="flex items-center justify-center gap-2">
                🔒 Подписка истекла — оформите для продолжения
              </span>
          ) : isSubmitting ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"
                          fill="none"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Сохранение...
              </>
          ) : (
              <>
                {formData.id ? 'Сохранить изменения' : (mode === 'INSTALLMENT' ? 'Оформить' : 'Провести продажу')}
              </>
          )}
        </button>
      </form>

      {showConfirmModal && (
          <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
              onClick={() => { if (!isSubmitting) setShowConfirmModal(false); }}>
            <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-4 animate-dialog-in"
                 onClick={e => e.stopPropagation()}>
              <h3 className="text-xl font-bold text-slate-800 dark:text-white text-center">Подтверждение</h3>
              <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-xl space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Клиент:</span><span
                    className="font-bold text-slate-800 dark:text-white">{selectedCustomer?.name}</span></div>
                <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Товар:</span><span
                    className="font-bold text-slate-800 dark:text-white">{formData.productName}</span></div>
                <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Сумма:</span><span
                    className="font-bold text-indigo-600 dark:text-indigo-400">{calculatedValues.totalAmount.toLocaleString()} ₽</span></div>
                <div className="border-t border-slate-200 dark:border-slate-700 pt-2 mt-2 flex justify-between items-center">
                  <span className="text-slate-500 dark:text-slate-400">Зачисление в:</span>
                  <span
                      className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-400 px-2 py-1 rounded text-xs font-bold">{selectedAccount?.name}</span>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowConfirmModal(false)} disabled={isSubmitting}
                        className="btn-press flex-1 py-3 bg-slate-100 dark:bg-slate-700 rounded-xl font-bold text-slate-600 dark:text-slate-300 disabled:opacity-50">Отмена
                </button>
                <button onClick={handleConfirm} disabled={isSubmitting}
                        className="btn-press flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                  {isSubmitting ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                      Сохранение...
                    </>
                  ) : 'Подтвердить'}
                </button>
              </div>
            </div>
          </div>
      )}

      {showSuccessModal && (
          <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
            <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-2xl shadow-2xl p-6 text-center space-y-5 animate-dialog-in"
                 onClick={e => e.stopPropagation()}>
              <SuccessCheck />
              {/* Заголовок и кнопки появляются с задержкой — сначала дорисовывается галочка */}
              <div className="animate-stage-in" style={{ animationDelay: '0.55s' }}>
                <h3 className="text-2xl font-bold text-slate-800 dark:text-white">Успешно!</h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Сделка оформлена и сохранена.</p>
              </div>
              <div className="flex flex-col gap-3 animate-stage-in" style={{ animationDelay: '0.7s' }}>
                <button onClick={handlePrintContract}
                        className="btn-press w-full py-3 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 flex items-center justify-center gap-2">{ICONS.File} Печать
                  договора
                </button>
                {appSettings.whatsapp?.enabled && (
                    <button onClick={handleSendContract}
                            className="btn-press w-full py-3 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 font-bold rounded-xl hover:bg-emerald-100 dark:hover:bg-emerald-900/50 flex items-center justify-center gap-2">{ICONS.Send} Отправить
                      договор (PDF)</button>
                )}
              </div>
              <div className="pt-2">
                <button onClick={() => {
                  setShowSuccessModal(false);
                  onClose();
                }} className="text-slate-400 dark:text-slate-500 text-sm font-medium hover:text-slate-600 dark:hover:text-slate-300">Закрыть и вернуться
                </button>
              </div>
            </div>
          </div>
      )}

      {/* 🔔 МОДАЛЬНОЕ ОКНО ПОДТВЕРЖДЕНИЯ ОТПРАВКИ В WHATSAPP */}
      {showWhatsAppConfirmModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
          onClick={() => { if (!isSendingWhatsApp) setShowWhatsAppConfirmModal(false); }}
        >
          <div
            className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-4 animate-dialog-in"
            onClick={e => e.stopPropagation()}
          >
            {/* Пока идёт отправка — окно превращается в индикатор стадий, а не закрывается */}
            {sendStage !== 'idle' ? (
              <SendStageView
                stage={sendStage}
                target={`${selectedCustomer?.name} · ${formatPhone(selectedCustomer?.phone)}`}
                icons={{ file: ICONS.File, send: ICONS.Send }}
              />
            ) : (
            <>
            <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto text-3xl">
              {ICONS.Send}
            </div>
            <h3 className="text-xl font-bold text-slate-800 dark:text-white text-center">
              Отправить договор в WhatsApp?
            </h3>
            <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-xl space-y-2 text-sm border border-slate-100 dark:border-slate-700">
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Клиент:</span>
                <span className="font-bold text-slate-800 dark:text-white">{selectedCustomer?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Телефон:</span>
                <span className="font-medium text-slate-800 dark:text-white">{formatPhone(selectedCustomer?.phone)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Договор:</span>
                <span className="font-medium text-slate-800 dark:text-white">{createdSale?.productName}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-200 dark:border-slate-700">
                <span className="text-slate-500 dark:text-slate-400">Сумма:</span>
                <span className="font-bold text-indigo-600 dark:text-indigo-400">{createdSale?.totalAmount.toLocaleString()} ₽</span>
              </div>
            </div>
            <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-900/50 rounded-lg p-3 flex gap-2 items-start">
              <span className="text-amber-500 dark:text-amber-400 flex-shrink-0 mt-0.5">⚠️</span>
              <p className="text-xs text-amber-800 dark:text-amber-300">
                PDF-файл будет отправлен на номер {formatPhone(selectedCustomer?.phone)}.
                Убедитесь, что номер корректен.
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                  onClick={() => setShowWhatsAppConfirmModal(false)}
                  className="btn-press flex-1 py-3 bg-slate-100 dark:bg-slate-700 rounded-xl font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
              >
                Отмена
              </button>
              <button
                  onClick={handleConfirmSendWhatsApp}
                  className="btn-press flex-1 py-3 rounded-xl font-bold shadow-lg flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200"
              >
                {ICONS.Send}
                Отправить
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

export default NewSale;