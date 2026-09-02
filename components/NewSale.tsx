import React, {useState, useMemo, useEffect, useRef} from 'react';
import { Customer, Product, Account, AppSettings, Sale, SaleStockItem, Payment, Supplier } from '../types';
import { DEFAULT_WAREHOUSE_ID } from '../types';
import { ICONS } from '../constants';
import TabPill from './TabPill';
import StockPicker from './StockPicker';
import TopBarBack from './TopBarBack';
import { getAppSettings } from '../services/storage';
import { sendWhatsAppFile } from '../services/whatsapp';
import { api } from '../services/api';
import { getSellerPhone, escapeHtml, formatDate, addMonthsClamped, stockAtWarehouse, formatCurrency } from '../src/utils';
import { buildContractHtml, buildContractFragment, resolveContractTemplate, CONTRACT_SHEET_WIDTH_PX } from '../src/contractTemplates';
import { isStaleBundleError, reloadForNewBuild } from '../src/staleBundle';
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
  /**
   * Открыть розничную продажу вместо режима «Наличные».
   * Передаётся только при включённом магазине: тогда наличные оформляются
   * корзиной со списанием со склада, а не договором с нулевым сроком.
   */
  onOpenRetail?: () => void;
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
  /** Вторая печатная форма доступна со «Стандарта» и выше */
  contractTemplatesAllowed?: boolean;
  /** Магазин включён: товар можно взять со склада, а не набирать строкой */
  showShop?: boolean;
  /** Склад, с которого отгружают. Тот же, с которого торгует касса. */
  warehouseId?: string;
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
// Разбор и вывод даты из <input type="date"> строго в локальном времени.
// new Date('2026-08-15') трактуется как полночь UTC, и обратный toISOString()
// в поясах восточнее/западнее Гринвича легко сдвигает дату на сутки.
const parseInputDate = (value: string): Date => {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const toInputDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

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


/**
 * График для печатного договора: каждое фактическое поступление — своя строка с
 * датой и суммой, ещё не покрытые месяцы — только дата, без суммы.
 *
 * Покрытие считаем от ОБЩЕЙ суммы реальных платежей, а не по флагу isPaid у
 * планового слота: флаг бывает неактуален, и рядом с уже оплаченной датой
 * оставался «призрачный» пустой дубль той же даты.
 *
 * Один расчёт на печать и на PDF: раньше их было два, и разойдись они — клиент
 * получил бы график, отличающийся от того, что ему дали подписать.
 */
const contractScheduleRows = (sale: Sale) => {
  const plan = sale.paymentPlan || [];
  const real = plan.filter(p => p.isRealPayment === true);
  let surplus = real.reduce((sum, p) => sum + p.amount, 0);

  const uncovered = plan
    .filter(p => p.isRealPayment !== true)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .filter(p => {
      if (surplus >= p.amount - 0.01) { surplus -= p.amount; return false; }
      return true;
    });

  let debt = sale.totalAmount - sale.downPayment;
  return [
    ...real.map(p => ({ date: p.date, paid: p.amount })),
    ...uncovered.map(p => ({ date: p.date, paid: 0 })),
  ]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map(p => {
      if (p.paid > 0) debt -= p.paid;
      return { date: p.date, paid: p.paid, remaining: Math.max(0, debt) };
    });
};

const NewSale: React.FC<NewSaleProps> = ({
  initialData, customers, products, accounts, sales, suppliers, showSupplierField,
  onClose, onSelectCustomer, onSubmit, onUpdateSale, onShowNotification, user, propAppSettings,
  onOpenRetail, contractTemplatesAllowed = true, showShop = false, warehouseId = DEFAULT_WAREHOUSE_ID,
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
      stockItems: [] as SaleStockItem[],
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
      stockItems: initialData.stockItems || [],
      startDate: initialData.startDate
        ? new Date(initialData.startDate).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0],
      paymentDate: initialData.paymentDate
        ? new Date(initialData.paymentDate).toISOString().split('T')[0]
        : '',
      roundingMode: initialData.roundingMode || 'NONE',
    };
  });

  const [stockPickerOpen, setStockPickerOpen] = useState(false);
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
  // Формула обязана совпадать с эффектом автозаполнения выше, иначе сравнение
  // «менял ли пользователь дату вручную» начнёт врать. Обе используют addMonthsClamped.
  const base = addMonthsClamped(new Date(initialData.startDate), 1);
  const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  base.setDate(Math.min(Number(initialData.paymentDay), lastDay));
  return toInputDate(base);
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
  // 🔒 Платежи считаем ЦЕЛЫМИ РУБЛЯМИ, а остаток от деления кладём в ПОСЛЕДНИЙ платёж.
  // Раньше все платежи получали одну сумму с копейками (91 000 / 3 = 30 333,33), и их сумма
  // не сходилась с долгом (30 333,33 × 3 = 90 999,99). А так как принимают платежи целыми
  // рублями, каждый раз недоплачивалось 33 копейки: они копились в остатке долга, из-за чего
  // график показывал 30 333 ₽, а «Остаток долга» — 30 334 ₽, и в графике вылезали строки-хвосты.
  // Теперь 91 000 / 3 → 30 333 + 30 333 + 30 334: сумма сходится точно, копеек нет.
  // Если сама сумма договора с копейками (например, 43 312,50) — они уйдут в последний платёж.
  const baseAmount = remainingInstallments > 0
    ? Math.floor(remainingAmount / remainingInstallments)
    : 0;
  const lastAmount = remainingInstallments > 0
    ? Math.round((remainingAmount - baseAmount * (remainingInstallments - 1)) * 100) / 100
    : 0;

  // 🔹 7. Генерируем новые даты для будущих платежей
  const firstDate = new Date(newFirstPaymentDate);

  // 🔹 8. Пропускаем месяцы, которые уже заняты сохранёнными платежами
  const usedMonths = new Set(preservedPayments.map(p => new Date(p.date).toISOString().slice(0, 7)));

  const futurePayments: Payment[] = [];
  let monthOffset = 0;

  while (futurePayments.length < remainingInstallments) {
    // 🔒 addMonthsClamped, а не pDate.setMonth(...): при дне платежа 29-31 обычный setMonth
    // "переливает" несуществующую дату в следующий месяц (30 февраля → 2 марта). Из-за этого
    // февральский платёж не создавался вовсе — его месяц оказывался занят сбойной мартовской
    // датой, настоящий март отсекался проверкой usedMonths ниже, и весь оставшийся график
    // сдвигался на месяц (в печатном договоре это выглядело как пропущенный месяц).
    const pDate = addMonthsClamped(firstDate, monthOffset);

    const monthKey = pDate.toISOString().slice(0, 7);

    // 🔹 Пропускаем месяцы, которые уже заняты
    if (!usedMonths.has(monthKey)) {
      futurePayments.push({
        id: `pay_${Date.now()}_${futurePayments.length}_${Math.random().toString(36).substr(2, 6)}`,
        saleId: saleData.id,
        // Последнему платежу достаётся остаток от деления, чтобы сумма графика сошлась точно.
        amount: futurePayments.length === remainingInstallments - 1 ? lastAmount : baseAmount,
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

  // Пользователь сам выбрал дату первого платежа — тогда смена даты договора её не трогает.
  // Иначе выбранную вручную дату затирало бы при любой правке даты оформления.
  const paymentDateTouched = useRef(false);

  // Авто-расчёт даты первого платежа: ровно месяц от даты оформления.
  useEffect(() => {
    // При редактировании существующего договора дату не пересчитываем:
    // график уже построен, и сдвиг задним числом сломал бы историю платежей.
    if (initialData.id) return;
    if (paymentDateTouched.current) return;
    if (!formData.startDate) return;

    // Раньше здесь стояло условие `if (!formData.paymentDate)`, то есть пересчёт
    // срабатывал только пока поле пустое. Заполнялось оно при первой же отрисовке,
    // поэтому дальше смена даты оформления на дату первого платежа не влияла вовсе.
    //
    // addMonthsClamped вместо setMonth(+1): обычное прибавление месяца на 29-31 числе
    // «переливается» в следующий месяц (31 января + 1 мес = 3 марта, потому что
    // 31 февраля не существует). Хелпер прижимает день к последнему числу месяца.
    const next = toInputDate(addMonthsClamped(parseInputDate(formData.startDate), 1));
    setFormData(prev => (prev.paymentDate === next ? prev : { ...prev, paymentDate: next, paymentDay: String(new Date(next).getDate()) }));
  }, [formData.startDate, initialData.id]);

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

  /**
   * Товар взят со склада: сумма продажи выбранного становится закупом договора.
   *
   * Название собираем из позиций только если человек ещё ничего не написал сам —
   * набранное вручную название договора важнее автоматического, его пишут для
   * печатной формы. При нескольких позициях складываем суммы: договор один, и
   * себестоимость у него одна.
   */
  const applyStockItems = (items: SaleStockItem[]) => {
    const sum = items.reduce((n, i) => n + i.price * i.quantity, 0);
    setFormData(prev => {
      const wasAuto = !prev.productName
        || prev.productName === (prev.stockItems || [])
             .map((i: SaleStockItem) => i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name).join(', ');
      const autoName = items
        .map(i => i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name).join(', ');
      return {
        ...prev,
        stockItems: items,
        productName: wasAuto ? autoName : prev.productName,
        // Ссылку на одиночный товар каталога снимаем: состав теперь описан
        // позициями, и старое поле только путало бы списание.
        productId: '',
        buyPrice: items.length > 0 ? sum : prev.buyPrice,
      };
    });
    setIsPriceManual(false);
    setStockPickerOpen(false);
  };

  const handleSuggestionClick = (product: Product) => {
    // При включённом магазине подсказка — это тот же склад, только другим путём:
    // выбрали товар — он попал в состав договора, его цена продажи встала в
    // закуп и он спишется при оформлении. Разное поведение у кнопки «+» и у
    // подсказки означало бы, что один и тот же выбор даёт разный результат.
    if (showShop) {
      const already = (formData.stockItems || []) as SaleStockItem[];
      // Повторный выбор того же товара количество не удваивает: чтобы взять две
      // штуки, есть счётчик в окне склада.
      const items = already.some(i => i.productId === product.id)
        ? already
        : [...already, {
            productId: product.id,
            name: product.name,
            quantity: 1,
            price: product.price,
            unit: product.unit,
          }];
      applyStockItems(items);
      setShowSuggestions(false);
      return;
    }

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
    // Дальше дата первого платежа за датой оформления не тянется — выбор пользователя главнее
    paymentDateTouched.current = true;

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

    // 🔒 Закуп обязателен: все расчёты прибыли пропускают договоры с buyPrice <= 0.
    // Без него договор попадает в кассу и в список, деньги по нему приходят,
    // но в прибыли он не участвует вообще — ни у менеджера, ни у инвесторов.
    // Исключение — редактирование договора, по которому уже есть платежи: там поле
    // закупа заблокировано, и требование его заполнить сделало бы договор
    // нередактируемым навсегда.
    if (!isFinancialLocked && !(Number(formData.buyPrice) > 0)) {
      alert("Укажите цену закупа.\n\nБез неё договор не будет учитываться в прибыли — ни в вашей, ни в доле инвесторов.");
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
        // Состав со склада и склад отгрузки — по ним договор спишет товар и
        // вернёт его, если договор удалят.
        stockItems: formData.stockItems || [],
        stockWarehouseId: (formData.stockItems || []).length > 0 ? warehouseId : undefined,
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
  /**
   * Скрытый лист договора, с которого снимается PDF для WhatsApp.
   *
   * Раньше здесь была отдельная React-разметка — третья копия договора после
   * печати с этого экрана и печати из списка. Копии жили своей жизнью: правка
   * формулировки в печати не доходила до PDF, и клиент получал не тот документ,
   * который ему потом давали подписать. Теперь лист собирается тем же шаблоном,
   * что и печать, и подчиняется тому же выбору в настройках.
   *
   * Ширина — ровно лист A4 в точках экрана: html2canvas снимает пиксели, и без
   * фиксированной ширины пропорции PDF зависели бы от размера окна.
   */
  const renderContractContent = () => {
    if (!createdSale || !selectedCustomer) return null;
    const sale = createdSale;
    const { html, styles } = buildContractFragment(
      resolveContractTemplate(appSettings?.contractTemplate, contractTemplatesAllowed),
      {
        companyName: appSettings?.companyName || 'Компания',
        sellerPhone: formatPhone(getSellerPhone(user, appSettings)),
        customerName: selectedCustomer.name,
        customerPhone: selectedCustomer.phone,
        passportSeries: selectedCustomer.passportSeries,
        passportNumber: selectedCustomer.passportNumber,
        passportIssuedBy: selectedCustomer.passportIssuedBy,
        customerAddress: selectedCustomer.address,
        guarantorName: sale.guarantorName,
        guarantorPhone: sale.guarantorPhone,
        productName: sale.productName,
        totalAmount: sale.totalAmount,
        downPayment: sale.downPayment,
        installments: sale.installments,
        monthlyPayment: sale.paymentPlan?.[0]?.amount || 0,
        startDate: sale.startDate,
        rows: contractScheduleRows(sale),
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

    // Лист держим ЗА ПРЕДЕЛАМИ экрана. Раньше здесь было left: 0 и z-index: 9999 —
    // договор выкладывался поверх интерфейса и висел 300 мс ожидания плюс время
    // отрисовки, из-за чего при сохранении на секунду выскакивал полный лист.
    // Видимым он быть обязан (visibility: hidden html2canvas снял бы пустотой),
    // но положение за краем экрана на снимок не влияет — проверено.
    element.style.display = 'block';
    element.style.position = 'fixed';
    element.style.left = '-10000px';
    element.style.top = '0';
    element.style.visibility = 'visible';
    element.style.zIndex = '-1';
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

      // Старая сборка на руках: нужного куска приложения на сервере уже нет.
      // Перезагружаемся сами — выбора у человека всё равно нет, а окно
      // «Требуется обновление» выглядит поломкой и пугает. Договор при этом уже
      // сохранён: сюда попадают только с отправки PDF, после записи на сервер.
      if (isStaleBundleError(error)) {
        if (!reloadForNewBuild() && onShowNotification) {
          onShowNotification(
            'Не удалось отправить',
            'Приложение обновилось. Закройте и откройте его — договор уже сохранён.',
            'warning'
          );
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

    const printScheduleRows = contractScheduleRows(sale);

    // Разметка обеих форм живёт в src/contractTemplates.ts: договор печатают из
    // нескольких мест, и копии вёрстки разошлись бы на первой же правке.
    const htmlContent = buildContractHtml(
      resolveContractTemplate(appSettings?.contractTemplate, contractTemplatesAllowed),
      {
        companyName,
        sellerPhone: formatPhone(sellerPhone),
        customerName: customer?.name,
        customerPhone: customer?.phone,
        passportSeries: customer?.passportSeries,
        passportNumber: customer?.passportNumber,
        passportIssuedBy: customer?.passportIssuedBy,
        customerAddress: customer?.address,
        guarantorName: sale.guarantorName,
        guarantorPhone: sale.guarantorPhone,
        productName: sale.productName,
        totalAmount: sale.totalAmount,
        downPayment: sale.downPayment,
        installments: sale.installments,
        monthlyPayment: sale.paymentPlan[0]?.amount || 0,
        startDate: sale.startDate,
        rows: printScheduleRows,
      },
      { withPrintButton: true }
    );

    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  return (
    <div className="space-y-4 animate-fade-in pb-20">
      {/* === СКРЫТЫЙ КОНТРАКТ ДЛЯ PDF === */}
      {renderContractContent()}

      <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-700 pb-4 pt-2">
        <TopBarBack onClick={onClose} />
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

      <div className="relative flex p-1 rounded-[26px] bg-white/60 dark:bg-slate-800/60 border border-white/70 dark:border-slate-700 shadow-sm">
        <TabPill index={mode === 'INSTALLMENT' ? 0 : 1} count={2} />
        <button type="button" onClick={() => !formData.id && updateMode('INSTALLMENT')} disabled={!!formData.id}
                className={`relative z-10 flex-1 py-3 text-sm font-bold rounded-lg transition-colors ${mode === 'INSTALLMENT' ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400'} ${formData.id ? 'cursor-not-allowed opacity-70' : ''}`}>Рассрочка</button>
        {/* При включённом магазине наличные ведут в розничную продажу: там корзина,
            количество и списание со склада. Договор с нулевым сроком для этого не
            нужен, а держать две формы для одного и того же — верный путь к тому,
            что данные разъедутся. */}
        <button type="button" onClick={() => { if (formData.id) return; if (onOpenRetail) onOpenRetail(); else updateMode('CASH'); }} disabled={!!formData.id}
                className={`relative z-10 flex-1 py-3 text-sm font-bold rounded-lg transition-colors ${mode === 'CASH' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'} ${formData.id ? 'cursor-not-allowed opacity-70' : ''}`}>Наличные</button>
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
                     onChange={e => setFormData(prev => ({ ...prev, startDate: e.target.value }))}/>
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
          {/* autoComplete/autoCorrect выключены намеренно: у поля своя подсказка
              по каталогу, а системное автозаполнение Android на переходе фокуса
              подставляет собственное значение поверх набранного. */}
          <div className="flex items-stretch gap-2">
            <input type="text"
                   autoComplete="off"
                   autoCorrect="off"
                   autoCapitalize="off"
                   spellCheck={false}
                   className="flex-1 min-w-0 p-3 border rounded-lg outline-none text-slate-900 dark:text-white placeholder:text-slate-400 bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600"
                   placeholder="Введите название товара..."
                   value={formData.productName}
                   onChange={(e) => handleProductChange(e.target.value)}/>
            {/* Товар со склада. Кнопка только при включённом магазине: без склада
                выбирать не из чего. При уже внесённых платежах состав не трогаем —
                он определяет закуп, а закуп в этот момент заблокирован. */}
            {showShop && !isFinancialLocked && (
              <button type="button" onClick={() => setStockPickerOpen(true)}
                      title="Выбрать со склада"
                      className="shrink-0 w-12 rounded-lg bg-indigo-600 text-white text-xl font-bold active:scale-95 transition-transform">
                +
              </button>
            )}
          </div>

          {/* Состав со склада. Показываем строками, а не одной суммой: человек
              должен видеть, что именно спишется, до того как нажмёт «Оформить». */}
          {(formData.stockItems || []).length > 0 && (
            <div className="mt-3 rounded-xl border border-indigo-100 dark:border-indigo-900/40 bg-indigo-50/50 dark:bg-indigo-900/10 divide-y divide-indigo-100 dark:divide-indigo-900/40">
              {(formData.stockItems as SaleStockItem[]).map(item => (
                <div key={item.productId} className="px-3 py-2 flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-700 dark:text-slate-200 truncate">
                    {item.name} <span className="text-slate-400">× {item.quantity}</span>
                  </p>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 shrink-0">
                    {formatCurrency(item.price * item.quantity, appSettings.showCents)} ₽
                  </p>
                </div>
              ))}
              <div className="px-3 py-2 flex items-center justify-between gap-3">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  {isFinancialLocked ? 'Списано со склада' : 'Спишется со склада'}
                </span>
                <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400 shrink-0">
                  {formatCurrency(
                    (formData.stockItems as SaleStockItem[]).reduce((n, i) => n + i.price * i.quantity, 0),
                    appSettings.showCents
                  )} ₽
                </span>
              </div>
            </div>
          )}

          {stockPickerOpen && (
            <StockPicker
              products={products}
              warehouseId={warehouseId}
              initial={formData.stockItems || []}
              showCents={appSettings.showCents}
              onCancel={() => setStockPickerOpen(false)}
              onApply={applyStockItems}
            />
          )}
          {showSuggestions && suggestions.length > 0 && (
              <div
                  className="absolute left-4 right-4 top-[72px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-20 max-h-40 overflow-y-auto">
                {suggestions.map(s => (
                    <div key={s.id}
                         className="p-3 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer border-b border-slate-50 dark:border-slate-700 last:border-0 text-slate-800 dark:text-white"
                         onClick={() => handleSuggestionClick(s)}>
                      <p className="font-medium text-slate-800 dark:text-white">{s.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Цена: {s.price} ₽
                        {/* Остаток по складу отгрузки: выбирая товар из подсказки,
                            человек списывает его со склада, и знать, сколько там
                            лежит, нужно до нажатия, а не после. */}
                        {showShop && ` · остаток ${stockAtWarehouse(s, warehouseId)} ${s.unit || 'шт'}`}
                      </p>
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
                  onChange={e => setFormData(prev => ({ ...prev, accountId: e.target.value }))}>
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
                onChange={e => { if (isFinancialLocked) return; setFormData(prev => ({ ...prev, supplierId: e.target.value || undefined })); }}>
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
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Закуп (Себест.){!isFinancialLocked && <span className="text-rose-500 ml-0.5">*</span>}
              </label>
              <input
                  type="number"
                  min="0"
                  className={`w-full p-3 border rounded-lg outline-none bg-white dark:bg-slate-900 text-slate-900 dark:text-white ${isFinancialLocked ? 'border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-700 cursor-not-allowed' : 'border-slate-300 dark:border-slate-600'}`}
                  value={formData.buyPrice === 0 ? '' : formData.buyPrice}
                  onChange={e => {
                    if (isFinancialLocked) return;
                    setFormData(prev => ({ ...prev, buyPrice: e.target.value }));
                    setIsPriceManual(false);
                  }}
                  placeholder="0"
                  disabled={isFinancialLocked}/>
              {(formData.stockItems || []).length > 0 && (
                <p className="text-[11px] text-indigo-500 dark:text-indigo-400 mt-1">
                  Сумма товаров со склада
                </p>
              )}
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
                        setFormData(prev => ({ ...prev, interestRate: e.target.value }));
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
                    setFormData(prev => ({ ...prev, price: val === '' ? 0 : Number(val) }));
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
                      onChange={e => !isFinancialLocked && setFormData(prev => ({ ...prev, installments: e.target.value }))}
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
                          setFormData(prev => ({ ...prev, downPayment: e.target.value }));
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
                onChange={e => setFormData(prev => ({ ...prev, guarantorName: e.target.value }))}/></div>
            <div><label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Телефон поручителя</label><input
                type="text"
                className="w-full p-3 border rounded-lg outline-none bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-slate-300 dark:border-slate-600"
                value={formData.guarantorPhone}
                onChange={e => setFormData(prev => ({ ...prev, guarantorPhone: e.target.value }))}/></div>
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
              className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
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
              className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
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
          className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
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