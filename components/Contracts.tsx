import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Sale, Customer, Account, User, AppSettings, Task, Payment } from '../types';
import { ICONS } from '../constants';
import { Phone, Search, Wallet, MoreVertical, FileText, Calendar, Edit3, Printer, Trash2, X, User as UserIcon } from 'lucide-react';
import { contractNumbers, formatCurrency, formatDate, calculateSaleOverdue, normalizePhoneForWhatsApp, pluralRu } from '../src/utils';
import { SuccessCheck, hapticSuccess } from './feedback';
import { printContract as printContractDocument } from './contractPrint';
import UnsyncedMark from './UnsyncedMark';
import { createPortal } from 'react-dom';
import { api } from '../services/api';
import GlassSheet, { SheetSection, SheetChoice, sheetInputClass } from './GlassSheet';
import { FilterChip, ChipGroup } from './FilterChips';
import ShareDebtorsSheet, { type DebtorRow } from './ShareDebtorsSheet';
import { contractMetrics, AGING, daysWord, type AgingBucket, type ContractMetrics } from '../src/contractMetrics';
import { expectedPaymentsInPeriod } from '../src/utils';

interface ContractsProps {
  sales: Sale[];
  customers: Customer[];
  accounts: Account[];
  activeTab: 'ALL' | 'ACTIVE' | 'OVERDUE' | 'ARCHIVE';
  onTabChange: (tab: 'ALL' | 'ACTIVE' | 'OVERDUE' | 'ARCHIVE') => void;
  onViewSchedule: (sale: Sale) => void;
  onEditSale: (sale: Sale) => void;
  onDeleteSale: (saleId: string) => void | Promise<void>;
  readOnly?: boolean;
  user?: User | null;
  employees?: User[];
  appSettings?: AppSettings;
  /** Вторая печатная форма доступна со «Стандарта» и выше */
  contractTemplatesAllowed?: boolean;
  onCreateTask?: (draft: Partial<Task>) => void;

}

// ─────────────────────────────────────────────────────────────
// 📋 Модалка с информацией о договоре
// ─────────────────────────────────────────────────────────────
const ContractInfoModal = ({
  sale,
  customer,
  onClose,
  appSettings,
  contractTemplatesAllowed = true,
  activeTab,
  readOnly
}: {
  sale: Sale,
  customer?: Customer,
  onClose: () => void,
  appSettings?: AppSettings,
  contractTemplatesAllowed?: boolean,
  activeTab?: 'ALL' | 'ACTIVE' | 'OVERDUE' | 'ARCHIVE',
  readOnly?: boolean
}) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 🔥 STATE для подтверждения отправки напоминания
  const [showConfirmReminder, setShowConfirmReminder] = useState(false);
  const [isSending, setIsSending] = useState(false);

  /**
   * Сообщение об исходе действия — полосой внутри самого листа, а не alert'ом.
   *
   * Системное окно выглядит чужим: оно перекрывает лист, пишет заголовком адрес
   * сайта и закрывается единственной кнопкой «ОК». Здесь же человек стоит в
   * карточке должника и хочет остаться в ней — ответ должен появиться рядом с
   * кнопками, которые он нажал.
   */
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = (kind: 'ok' | 'warn', text: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ kind, text });
    // Удача уходит сама: она подтверждает уже случившееся, держать её незачем.
    // Проблема остаётся на экране — её надо прочитать и что-то сделать.
    if (kind === 'ok') noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  };

  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);


  const [isClosing, setIsClosing] = useState(false);
  const handleClose = () => {
    setIsClosing(true);
    setTimeout(onClose, 280);
  };

  const planPayments = sale.paymentPlan.filter(p => !p.isRealPayment);
const realPayments = sale.paymentPlan.filter(p => p.isRealPayment && p.isPaid);

// Ежемесячный платёж берём из плана
const monthlyPayment = planPayments[0]?.amount || 0;

// 🔹 Оплаченные месяцы: считаем по реальным оплатам, сопоставляя с планом
// Сортируем план по дате
const sortedPlan = [...planPayments].sort((a, b) => 
  new Date(a.date).getTime() - new Date(b.date).getTime()
);

// Сумма, оплаченная сверх первого взноса
const paidExcludingDown = (sale.totalAmount - sale.remainingAmount) - sale.downPayment;

// Проходим по плану и считаем, сколько полных платежей покрыто
let remaining = Math.max(0, paidExcludingDown);
let paidMonths = 0;

for (const p of sortedPlan) {
  if (remaining >= p.amount * 0.99) { // 99% для погрешности копеек
    remaining -= p.amount;
    paidMonths++;
  } else {
    break;
  }
}

// 🔹 Пропущенные платежи: плановые, дата в прошлом, И не вошли в оплаченные
const overduePaymentsList = sortedPlan.filter((p, index) => {
  const isPast = new Date(p.date) < today;
  const isCovered = index < paidMonths; // если вошёл в счёт оплаченных
  return isPast && !isCovered;
});

  const realOverdueAmount = calculateSaleOverdue(sale, today);

  const nextUnpaidPayment = sale.paymentPlan.find(p => !p.isPaid && new Date(p.date) >= today);
  const nextPaymentDate = nextUnpaidPayment
    ? formatDate(nextUnpaidPayment.date)
    : (sale.remainingAmount > 0 ? 'Просрочен' : 'Закрыт');

  // 📞 Позвонить
  const handleCall = () => {
    if (customer?.phone) {
      const cleanPhone = customer.phone.replace(/\D/g, '');
      const formattedPhone = cleanPhone.startsWith('7') ? cleanPhone : '7' + cleanPhone;
      window.open(`tel:+${formattedPhone}`);
    }
  };

  // 💬 WhatsApp (без подтверждения, прямая ссылка)
  const handleWhatsApp = () => {
    // Здесь номер собирался как phone.startsWith('7') ? phone : '7' + phone.
    // На 89001234567 это давало 789001234567 — лишняя восьмёрка внутри номера,
    // а украинский +380... превращался в 7380... Пустая строка давала wa.me/7.
    const phone = normalizePhoneForWhatsApp(customer?.phone);
    if (!phone) {
      // Говорим не только о проблеме, но и о том, где её чинить: телефон
      // правится в карточке клиента, а не здесь.
      showNotice('warn', `У клиента${customer?.name ? ` «${customer.name}»` : ''} не указан корректный номер телефона. Добавьте его в карточке клиента.`);
      return;
    }
    // Тот же вид, что у напоминаний с Главной: обращение, пустая строка, суть,
    // сумма отдельной строкой и подпись компании. Одной сплошной строкой в
    // WhatsApp это читалось хуже всего — там сообщение видно узкой колонкой.
    const missed = overduePaymentsList.length;
    const sum = `*${formatCurrency(realOverdueAmount, appSettings?.showCents)} ₽*`;
    const company = appSettings?.companyName;

    const body = missed > 0
      ? `По договору «${sale.productName}» есть просроченная задолженность: ${missed} ${pluralRu(missed, 'платёж', 'платежа', 'платежей')}.`
      : `По договору «${sale.productName}» есть просроченная задолженность.`;

    const text = [
      `${customer?.name || 'Здравствуйте'}!`,
      '',
      body,
      '',
      `💰 К оплате: ${sum}`,
      '',
      'Просим погасить задолженность.',
      ...(company ? ['', company] : []),
    ].join('\n');

    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
  };


// 🔔 Отправка напоминания через бэкенд (с подтверждением)
const handleSendReminder = async () => {
  if (!customer?.phone) return;

  setIsSending(true);
  try {
    // 🔹 Рассчитываем фиксированный ежемесячный платёж из графика
    const monthlyPayment = sale.paymentPlan
      .filter(p => !p.isRealPayment) // Только плановые платежи
      .map(p => p.amount)[0] || 0;   // Берём первый (все обычно одинаковые)

    // 🔹 Итого к оплате = текущий платёж + вся просрочка
    const totalToPay = monthlyPayment + realOverdueAmount;

    await api.sendOverdueReminder({
  customerId: customer.id,
  phone: customer.phone,
  customerName: customer.name,
  productName: sale.productName,
  monthlyPayment: monthlyPayment,    // ← фиксированный платёж
  overdueAmount: realOverdueAmount,  // ← реальный долг
  monthsOverdue: overduePaymentsList.length,
  template: 'overdue'
});

    setShowConfirmReminder(false);
    showNotice('ok', `Напоминание отправлено${customer?.name ? ` клиенту ${customer.name}` : ''} в WhatsApp.`);
  } catch (e: any) {
    console.error('❌ Reminder error:', e);
    setShowConfirmReminder(false);
    // Полосу ставим до запасного пути: если у клиента ещё и номер негодный,
    // handleWhatsApp напишет об этом поверх — там причина конкретнее.
    showNotice('warn', `${e.message || 'Не удалось отправить напоминание'}. Открываем WhatsApp — отправьте сообщение вручную.`);
    handleWhatsApp(); // Fallback
  } finally {
    setIsSending(false);
  }
};

   return createPortal(
    <div
      className={`fixed inset-0 z-modal flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
      onClick={handleClose}
    >
      <div
        className={`bg-white dark:bg-slate-800 w-full sm:max-w-sm sm:rounded-3xl rounded-t-3xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col ${isClosing ? 'animate-slide-down-sheet' : 'animate-slide-up-sheet'}`}
        onClick={e => e.stopPropagation()}
      >
        {/* 🔥 ШАПКА С КНОПКОЙ «НАПОМНИТЬ» */}
        <div className="px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="text-white bg-white/20 p-2 rounded-xl"><FileText size={18} /></div>
            <h3 className="text-base font-bold text-white">Информация о договоре</h3>
          </div>

          {/* 🔔 Кнопка «Напомнить» в шапке — по реальной просрочке договора, а не по вкладке,
              с которой открыли карточку (актуально и для вкладки «Все») */}
          {realOverdueAmount > 0 && !readOnly && (
    <button
      onClick={(e) => { e.stopPropagation(); setShowConfirmReminder(true); }}
      className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 rounded-xl text-white transition-colors active:scale-95 flex items-center gap-1.5 text-xs font-bold shadow-sm"
      title="Отправить напоминание в WhatsApp"
    >
      {ICONS.Send}
      Напомнить
    </button>
  )}
        </div>

        <div className="p-4 space-y-3 overflow-y-auto flex-1">
          <div className="bg-slate-50 dark:bg-slate-700/50 p-3 rounded-xl">
            <label className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1">Товар</label>
            <p className="font-semibold text-slate-800 dark:text-white text-sm">{sale.productName}</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <InfoItem label="Срок" value={`${sale.installments} мес.`} />
            <InfoItem label="Оплачено" value={`${paidMonths} мес.`} color="text-emerald-600 dark:text-emerald-400" />
            <InfoItem label="Платёж" value={`${formatCurrency(monthlyPayment, appSettings?.showCents)} ₽`} small />
            <InfoItem label="След. платеж" value={nextPaymentDate} color="text-indigo-600 dark:text-indigo-400" small />
          </div>

          {/* Блок просрочки — тоже по факту, а не по вкладке */}
          {realOverdueAmount > 0 && (
            <div className="bg-gradient-to-r from-red-50 to-orange-50 dark:from-red-900/30 dark:to-orange-900/30 p-3 rounded-xl border border-red-100 dark:border-red-900/50">
              <div className="flex justify-between items-center">
                <label className="text-[11px] text-red-600 dark:text-red-400 font-medium">Просрочка</label>
                <p className="font-bold text-red-600 dark:text-red-400 text-lg">{formatCurrency(realOverdueAmount, appSettings?.showCents)} ₽</p>
              </div>
              <div className="flex justify-between items-center mt-1">
                <label className="text-[11px] text-slate-600 dark:text-slate-300">Остаток</label>
                <p className="font-semibold text-slate-700 dark:text-slate-300 text-sm">{formatCurrency(sale.remainingAmount, appSettings?.showCents)} ₽</p>
              </div>
            </div>
          )}

          {realOverdueAmount <= 0 && (
            <div className="bg-slate-50 dark:bg-slate-700/50 p-3 rounded-xl border border-slate-100 dark:border-slate-700">
              <div className="flex justify-between items-center">
                <label className="text-[11px] text-slate-600 dark:text-slate-300">Остаток</label>
                <p className="font-bold text-slate-800 dark:text-white text-lg">{formatCurrency(sale.remainingAmount, appSettings?.showCents)} ₽</p>
              </div>
            </div>
          )}

          {overduePaymentsList.length > 0 && (
            <div className="bg-slate-50 dark:bg-slate-700/50 p-3 rounded-xl">
              <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block mb-2">Пропущенные платежи</label>
              <div className="space-y-1.5 max-h-24 overflow-y-auto">
                {overduePaymentsList.map(p => (
                  <div key={p.id} className="flex justify-between items-center bg-white dark:bg-slate-800 px-2.5 py-2 rounded-lg">
                    <span className="text-red-600 dark:text-red-400 text-xs font-medium">{formatDate(p.date)}</span>
                    <span className="text-slate-500 dark:text-slate-400 text-[11px]">{formatCurrency(p.amount, appSettings?.showCents)} ₽</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Ответ на действие — здесь же, у кнопок, которые его вызвали.
            shrink-0: полоса не должна съедаться прокруткой списка выше. */}
        {notice && (
          <div className={`shrink-0 mx-3 mt-3 rounded-xl border px-3 py-2.5 text-sm flex items-start justify-between gap-3 ${
            notice.kind === 'ok'
              ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
              : 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
          }`}>
            <span className="min-w-0">{notice.text}</span>
            <button type="button" onClick={() => setNotice(null)}
                    aria-label="Скрыть сообщение"
                    className="shrink-0 font-bold opacity-60">✕</button>
          </div>
        )}

        {/* 🔘 НИЖНИЕ КНОПКИ: Позвонить / WhatsApp */}
        <div className="p-3 bg-slate-50 dark:bg-slate-700/50 border-t border-slate-100 dark:border-slate-700 flex gap-2 shrink-0">
          <button onClick={handleCall} className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl font-medium text-sm flex items-center justify-center gap-1.5 active:scale-95 transition-transform">
            <Phone size={16} /> Позвонить
          </button>
          <button onClick={handleWhatsApp} className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl font-medium text-sm flex items-center justify-center gap-1.5 active:scale-95 transition-transform">
            <Phone size={16} /> WhatsApp
          </button>
        </div>

        <button
          onClick={handleClose}
          className="py-3 text-slate-400 dark:text-slate-500 text-sm hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shrink-0"
        >
          Закрыть
        </button>

        {/* 🔔 МОДАЛКА ПОДТВЕРЖДЕНИЯ ОТПРАВКИ */}
        {showConfirmReminder && createPortal(
          <div
            className="fixed inset-0 z-modal-top flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-fade-in"
            onClick={() => !isSending && setShowConfirmReminder(false)}
          >
            <div
              className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-3xl p-5 shadow-2xl animate-scale-in"
              onClick={e => e.stopPropagation()}
            >
              <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Phone size={24} className="rotate-90" />
              </div>
              <h4 className="text-center font-bold text-slate-800 dark:text-white mb-1">Отправить напоминание?</h4>
              <p className="text-center text-slate-500 dark:text-slate-400 text-sm mb-4">
                Клиент <b>{customer?.name}</b> получит сообщение в WhatsApp о задолженности{' '}
                <b>{formatCurrency(realOverdueAmount, appSettings?.showCents)} ₽</b>
              </p>

              <div className="flex gap-2.5">
                <button
                  onClick={() => setShowConfirmReminder(false)}
                  disabled={isSending}
                  className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-medium text-sm hover:bg-slate-200 dark:hover:bg-slate-600 transition-all disabled:opacity-50"
                >
                  Отмена
                </button>
                <button
                  onClick={handleSendReminder}
                  disabled={isSending}
                  className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSending ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      Отправка...
                    </>
                  ) : (
                    '✅ Отправить'
                  )}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>,
    document.body
  );
};

const InfoItem = ({ label, value, color = 'text-slate-800 dark:text-white', small = false }: {
  label: string, value: string | number, color?: string, small?: boolean
}) => (
  <div className="bg-white dark:bg-slate-800 p-2.5 rounded-xl border border-slate-100 dark:border-slate-700">
    <label className="text-[10px] text-slate-400 dark:text-slate-500 block mb-0.5">{label}</label>
    <p className={`font-semibold ${color} ${small ? 'text-xs' : 'text-sm'}`}>{value}</p>
  </div>
);

const formatPhone = (raw: string | undefined): string => {
    if (!raw) return '+7 (___) ___-__-__';
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 11 && (digits[0] === '8' || digits[0] === '7')) {
        const clean = digits[0] === '8' ? '7' + digits.slice(1) : digits;
        return `+${clean[0]} (${clean.slice(1, 4)}) ${clean.slice(4, 7)}-${clean.slice(7, 9)}-${clean.slice(9)}`;
    }
    return raw;
};

// ─────────────────────────────────────────────────────────────
// Сортировки и фильтры списка договоров
// ─────────────────────────────────────────────────────────────
type ContractTab = 'ALL' | 'ACTIVE' | 'OVERDUE' | 'ARCHIVE';
type SortKey = 'overdue' | 'days' | 'last' | 'remaining' | 'next' | 'percent' | 'end' | 'date' | 'name';

// У каждой вкладки свой главный вопрос: в просроченных — кто должен больше и
// дольше всех, в активных — кто и когда платит следующим.
const SORTS: Record<ContractTab, { id: SortKey; label: string }[]> = {
  OVERDUE: [
    { id: 'overdue', label: 'По сумме просрочки' },
    { id: 'days', label: 'По сроку просрочки' },
    { id: 'last', label: 'Давно не платил' },
    { id: 'remaining', label: 'По остатку долга' },
    { id: 'date', label: 'По дате оформления' },
    { id: 'name', label: 'По имени' },
  ],
  ACTIVE: [
    { id: 'next', label: 'По ближайшему платежу' },
    { id: 'remaining', label: 'По остатку долга' },
    { id: 'percent', label: 'По проценту выплаты' },
    { id: 'end', label: 'Скоро закроются' },
    { id: 'date', label: 'По дате оформления' },
    { id: 'name', label: 'По имени' },
  ],
  ALL: [
    { id: 'date', label: 'По дате оформления' },
    { id: 'remaining', label: 'По остатку долга' },
    { id: 'name', label: 'По имени' },
  ],
  ARCHIVE: [
    { id: 'date', label: 'По дате оформления' },
    { id: 'name', label: 'По имени' },
  ],
};
const SORT_KEY = 'finuchet_contracts_sort';

interface ContractFilters {
  accountId: string;
  employeeId: string;
  amountFrom: string;
  amountTo: string;
  period: 'ALL' | 'THIS_MONTH' | 'LAST_MONTH' | 'CUSTOM';
  dateFrom: string;
  dateTo: string;
  // Просроченные
  aging: AgingBucket | '';
  overdueFrom: number;
  missed: number;        // 0 — любые, 3 — «3 и больше»
  silentDays: number;    // не платил больше N дней
  // Активные
  due: '' | 'TODAY' | 'WEEK' | 'MONTH';
  paid: '' | 'LOW' | 'MID' | 'HIGH';
  hadLate: boolean;
  noPayments: boolean;
}
const EMPTY_FILTERS: ContractFilters = {
  accountId: '', employeeId: '', amountFrom: '', amountTo: '', period: 'ALL', dateFrom: '', dateTo: '',
  aging: '', overdueFrom: 0, missed: 0, silentDays: 0,
  due: '', paid: '', hadLate: false, noPayments: false,
};
const DAY_MS = 86400000;
const time = (d?: string | null) => (d ? new Date(d).getTime() : 0);

// ─────────────────────────────────────────────────────────────
// 📋 Основной компонент Contracts
// ─────────────────────────────────────────────────────────────
const Contracts: React.FC<ContractsProps> = ({
  sales, customers, accounts, activeTab, onTabChange,
  onViewSchedule, onEditSale, onDeleteSale, readOnly = false,
  user, employees = [], appSettings, contractTemplatesAllowed = true, onCreateTask
}) => {
  const isEmployee = user?.role === 'employee';
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<ContractFilters>(EMPTY_FILTERS);
  const setF = <K extends keyof ContractFilters>(k: K, v: ContractFilters[K]) => setFilters(f => ({ ...f, [k]: v }));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // Сортировка запоминается для каждой вкладки
  const [sortByTab, setSortByTab] = useState<Partial<Record<ContractTab, SortKey>>>(() => {
    try { return JSON.parse(localStorage.getItem(SORT_KEY) || '{}'); } catch { return {}; }
  });
  const sortKey: SortKey = (SORTS[activeTab].some(o => o.id === sortByTab[activeTab]) && sortByTab[activeTab]) || SORTS[activeTab][0].id;
  const setSortKey = (k: SortKey) => setSortByTab(prev => {
    const next = { ...prev, [activeTab]: k };
    try { localStorage.setItem(SORT_KEY, JSON.stringify(next)); } catch { /* не критично */ }
    return next;
  });
  const filterAccountId = filters.accountId;
  const filterEmployeeId = filters.employeeId;
  const canFilterEmployee = employees.length > 0 && !isEmployee && !readOnly;
  const getCreatorName = (sale: Sale) => employees.find(e => e.id === sale.createdByUserId)?.name;
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [isMenuClosing, setIsMenuClosing] = useState(false);
  const [deletingSale, setDeletingSale] = useState<Sale | null>(null);
  const [deleteStage, setDeleteStage] = useState<'idle' | 'working' | 'done'>('idle');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [selectedSaleForInfo, setSelectedSaleForInfo] = useState<Sale | null>(null);
  const [currentMenuSale, setCurrentMenuSale] = useState<Sale | null>(null);
  const [showConfirmRemindAll, setShowConfirmRemindAll] = useState(false);
const [isSendingAll, setIsSendingAll] = useState(false);
const [sentStats, setSentStats] = useState<{ sent: number; total: number } | null>(null);
// 🔒 Массовая рассылка похожих сообщений подряд — то, за что WhatsApp банит номера/аккаунты.
// Требуем осознанное подтверждение риска, а не просто текст предупреждения, который легко пропустить.
const [riskAcknowledged, setRiskAcknowledged] = useState(false);

  const getCustomerName = (id: string) => customers.find(c => c.id === id)?.name || 'Неизвестно';

  // Номера считаем по всему списку, а не по отфильтрованному: у пятидесятого
  // договора номер 0050 и в архиве, и в поиске по одному клиенту.
  const contractNo = useMemo(() => contractNumbers(sales), [sales]);

  // Показатели каждого договора — один раз на набор данных (src/contractMetrics.ts)
  const metrics = useMemo(() => {
    const map = new Map<string, ContractMetrics>();
    const now = new Date();
    sales.forEach(sale => map.set(sale.id, contractMetrics(sale, now)));
    return map;
  }, [sales]);

  const { filteredList, beforeAging } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const active: Sale[] = [], overdue: Sale[] = [], archive: Sale[] = [];
    const customerIdSet = new Set(customers.map(c => c.id));
    const actualSales = sales.filter(sale => customerIdSet.has(sale.customerId));

    actualSales.forEach(sale => {
      if (sale.status === 'COMPLETED' || sale.remainingAmount === 0) {
        archive.push(sale);
        return;
      }
      if (calculateSaleOverdue(sale) > 0) overdue.push(sale);
      else active.push(sale);
    });

    let list = activeTab === 'ACTIVE' ? active
      : activeTab === 'OVERDUE' ? overdue
      : activeTab === 'ARCHIVE' ? archive
      : actualSales; // 'ALL' — все три категории разом (actualSales уже их полная сумма)

    if (searchTerm) {
      const lowerTerm = searchTerm.toLowerCase();
      list = list.filter(sale => {
        const customer = customers.find(c => c.id === sale.customerId);
        return (customer?.name.toLowerCase().includes(lowerTerm)) || sale.productName.toLowerCase().includes(lowerTerm);
      });
    }
    const f = filters;
    if (f.accountId) list = list.filter(sale => sale.accountId === f.accountId);
    if (f.employeeId) list = list.filter(sale => sale.createdByUserId === f.employeeId);
    const from = Number(f.amountFrom) || 0, to = Number(f.amountTo) || 0;
    if (from) list = list.filter(sale => sale.totalAmount >= from);
    if (to) list = list.filter(sale => sale.totalAmount <= to);

    // Период оформления
    if (f.period !== 'ALL') {
      const now = new Date();
      let a = 0, b = Infinity;
      if (f.period === 'THIS_MONTH') { a = new Date(now.getFullYear(), now.getMonth(), 1).getTime(); }
      else if (f.period === 'LAST_MONTH') {
        a = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
        b = new Date(now.getFullYear(), now.getMonth(), 1).getTime() - 1;
      } else {
        if (f.dateFrom) a = new Date(`${f.dateFrom}T00:00:00`).getTime();
        if (f.dateTo) b = new Date(`${f.dateTo}T23:59:59`).getTime();
      }
      list = list.filter(sale => { const t = time(sale.startDate); return t >= a && t <= b; });
    }

    const m = (sale: Sale) => metrics.get(sale.id)!;
    const todayMs = today.getTime();
    let beforeAging = list;
    if (activeTab === 'OVERDUE') {
      if (f.overdueFrom) list = list.filter(sale => m(sale).overdue >= f.overdueFrom);
      if (f.missed) list = list.filter(sale => f.missed >= 3 ? m(sale).missed >= 3 : m(sale).missed === f.missed);
      if (f.silentDays) list = list.filter(sale => {
        const last = m(sale).lastPayment;
        return !last || (todayMs - time(last)) / DAY_MS > f.silentDays;
      });
      beforeAging = list;
      if (f.aging) { const bucket = AGING.find(x => x.id === f.aging)!; list = list.filter(sale => bucket.test(m(sale).overdueDays)); }
    }
    if (activeTab === 'ACTIVE') {
      if (f.due) {
        const end = f.due === 'TODAY' ? todayMs + DAY_MS
          : f.due === 'WEEK' ? todayMs + 7 * DAY_MS
          : new Date(today.getFullYear(), today.getMonth() + 1, 1).getTime();
        list = list.filter(sale => { const n = m(sale).nextDue; return !!n && time(n.date) < end; });
      }
      if (f.paid) list = list.filter(sale => {
        const pct = m(sale).paidPercent;
        return f.paid === 'LOW' ? pct < 25 : f.paid === 'MID' ? pct >= 25 && pct <= 75 : pct > 75;
      });
      if (f.hadLate) list = list.filter(sale => m(sale).hadLate);
      if (f.noPayments) list = list.filter(sale => m(sale).noPayments);
    }

    const name = (sale: Sale) => customers.find(c => c.id === sale.customerId)?.name || '';
    const byDate = (a: Sale, b: Sale) => time(b.startDate) - time(a.startDate);
    const cmp: Record<SortKey, (a: Sale, b: Sale) => number> = {
      overdue: (a, b) => m(b).overdue - m(a).overdue,
      days: (a, b) => m(b).overdueDays - m(a).overdueDays,
      // Давно не платил: без платежей вообще — первыми, дальше по дате последнего
      last: (a, b) => (time(m(a).lastPayment) || 0) - (time(m(b).lastPayment) || 0),
      remaining: (a, b) => m(b).remaining - m(a).remaining,
      next: (a, b) => (time(m(a).nextDue?.date) || Infinity) - (time(m(b).nextDue?.date) || Infinity),
      percent: (a, b) => m(b).paidPercent - m(a).paidPercent,
      end: (a, b) => (time(m(a).endDate) || Infinity) - (time(m(b).endDate) || Infinity),
      date: byDate,
      name: (a, b) => name(a).localeCompare(name(b), 'ru'),
    };
    return { filteredList: [...list].sort((a, b) => cmp[sortKey](a, b) || byDate(a, b)), beforeAging };
  }, [sales, customers, activeTab, searchTerm, filters, sortKey, metrics]);

  const totalOverdueSum = useMemo(() => {
    if (activeTab !== 'OVERDUE') return 0;
    return filteredList.reduce((sum, s) => sum + calculateSaleOverdue(s), 0);
  }, [filteredList, activeTab]);

  // Сводки над списком — по тому, что сейчас отобрано
  const overdueSummary = useMemo(() => {
    if (activeTab !== 'OVERDUE') return null;
    const rows = filteredList.map(s => ({ sale: s, m: metrics.get(s.id)! }));
    const clients = new Set(filteredList.map(s => s.customerId)).size;
    const avgDays = rows.length ? Math.round(rows.reduce((sum, r) => sum + r.m.overdueDays, 0) / rows.length) : 0;
    const top = [...rows].sort((a, b) => b.m.overdue - a.m.overdue).slice(0, 5);
    // Сроки — по списку БЕЗ фильтра срока: кнопки показывают, что будет, если нажать
    const all = beforeAging.map(s => metrics.get(s.id)!);
    const aging = AGING.map(b => {
      const inBucket = all.filter(m => b.test(m.overdueDays)).map(m => ({ m }));
      return { ...b, count: inBucket.length, sum: inBucket.reduce((sum, r) => sum + r.m.overdue, 0) };
    });
    return { clients, avgDays, top, aging };
  }, [filteredList, beforeAging, metrics, activeTab]);

  const activeSummary = useMemo(() => {
    if (activeTab !== 'ACTIVE') return null;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    let remaining = 0, thisMonth = 0;
    for (const s of filteredList) {
      remaining += metrics.get(s.id)?.remaining || 0;
      thisMonth += expectedPaymentsInPeriod(s, monthStart, monthEnd).reduce((sum, p) => sum + p.amount, 0);
    }
    return { remaining, thisMonth };
  }, [filteredList, metrics, activeTab]);

  // Сколько фильтров включено — число на кнопке
  const filtersOn = (() => {
    const f = filters;
    let n = 0;
    if (f.accountId) n++;
    if (f.employeeId) n++;
    if (f.amountFrom || f.amountTo) n++;
    if (f.period !== 'ALL') n++;
    if (activeTab === 'OVERDUE') { if (f.aging) n++; if (f.overdueFrom) n++; if (f.missed) n++; if (f.silentDays) n++; }
    if (activeTab === 'ACTIVE') { if (f.due) n++; if (f.paid) n++; if (f.hadLate) n++; if (f.noPayments) n++; }
    return n;
  })();
  const resetFilters = () => setFilters(EMPTY_FILTERS);

  const debtorRows: DebtorRow[] = activeTab === 'OVERDUE' ? filteredList.map(s => {
    const c = customers.find(x => x.id === s.customerId);
    const mm = metrics.get(s.id)!;
    return { name: c?.name || 'Без имени', birthDate: c?.birthDate, phone: c?.phone, product: s.productName, days: mm.overdueDays, amount: mm.overdue };
  }) : [];

  const getTabTitle = () => {
    switch(activeTab) {
      case 'ALL': return 'Все договоры';
      case 'ACTIVE': return 'Активные договоры';
      case 'OVERDUE': return 'Просроченные';
      case 'ARCHIVE': return 'Архив';
    }
  };



  const handleRemindAll = async () => {
  setIsSendingAll(true);
  setSentStats(null);

  try {
    const result = await api.sendOverdueReminderAll();
    setSentStats({ sent: result.results.sent, total: result.results.total });
    alert(`✅ Готово!\n\nОтправлено: ${result.results.sent} из ${result.results.total}\n` +
          (result.results.failed > 0 ? `Не удалось: ${result.results.failed}` : ''));
    setShowConfirmRemindAll(false);
  } catch (e: any) {
    alert(`❌ Ошибка: ${e.message}`);
  } finally {
    setIsSendingAll(false);
  }
};




// Закрытие отложено на время анимации. Раньше отложенная уборка гасила и МЕНЮ,
// ОТКРЫТОЕ ЗАНОВО за эти четверть секунды: нажал Escape (или мимо) и сразу открыл
// другой договор — окно мигало и пропадало. Теперь у каждого открытия свой номер,
// и уборка срабатывает, только если с тех пор ничего не открывали.
// Второй запрос на закрытие (клик по пункту доходит и до обработчика «клик мимо»)
// нового таймера не ставит, но его действие не теряется — очередь closeAftersRef.
const menuSeqRef = React.useRef(0);
const activeMenuIdRef = React.useRef<string | null>(null);
const closeTimerRef = React.useRef<number | null>(null);
const closeAftersRef = React.useRef<(() => void)[]>([]);

const runCloseAfters = () => {
  const queued = closeAftersRef.current;
  closeAftersRef.current = [];
  queued.forEach(fn => fn());
};

const closeActionMenu = (after?: () => void) => {
  if (after) closeAftersRef.current.push(after);
  if (!activeMenuIdRef.current) { runCloseAfters(); return; }  // закрывать нечего
  if (closeTimerRef.current) return;                           // закрытие уже идёт
  const seq = menuSeqRef.current;
  setIsMenuClosing(true);
  closeTimerRef.current = window.setTimeout(() => {
    closeTimerRef.current = null;
    if (menuSeqRef.current === seq) {
      activeMenuIdRef.current = null;
      setActiveMenuId(null);
      setCurrentMenuSale(null);
      setIsMenuClosing(false);
    }
    runCloseAfters();
  }, 250);
};

React.useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); }, []);



// Меню действий: на телефоне лист снизу, на компьютере окно по центру —
// координаты кнопки для этого не нужны.
const handleActionClick = (e: React.MouseEvent, sale: Sale) => {
  e.stopPropagation();

  if (activeMenuId === sale.id) {
    closeActionMenu();
    return;
  }

  // Открываем заново: отменяем незавершённое закрытие, чтобы оно не погасило это окно
  if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; runCloseAfters(); }
  menuSeqRef.current += 1;
  activeMenuIdRef.current = sale.id;
  setIsMenuClosing(false);
  setActiveMenuId(sale.id);
  setCurrentMenuSale(sale);
};

  // Удаление подтверждается в этой же модалке: «Удаляем…» → галочка → закрытие.
  // Причину отказа (платежи по графику, долг поставщику, нет прав) onDeleteSale
  // бросает исключением — показываем её здесь же, а не системным alert поверх окна.
  const handleDeleteConfirm = async () => {
    if (!deletingSale || deleteStage === 'working') return;
    setDeleteStage('working');
    setDeleteError(null);
    try {
      await onDeleteSale(deletingSale.id);
      setDeleteStage('done');
      hapticSuccess();
      await new Promise(r => setTimeout(r, 1100));
      setDeletingSale(null);
      setDeleteStage('idle');
    } catch (e: any) {
      setDeleteError(e?.message || 'Не удалось удалить договор');
      setDeleteStage('idle');
    }
  };

  const closeDeleteModal = () => {
    if (deleteStage !== 'idle') return;
    setDeletingSale(null);
    setDeleteError(null);
  };

  // Печать живёт в общем модуле: тем же кодом печатает карточка клиента,
  // и правила графика в двух местах разойтись не могут — см. contractPrint.ts
  const printContract = (sale: Sale) => printContractDocument({
    sale, sales, customers, appSettings, user, contractTemplatesAllowed,
  });

  // Действия по договору — один список и для телефона, и для компьютера.
  // На телефоне это лист снизу, на компьютере — окно по центру экрана. Раньше на
  // компьютере меню выпадало у кнопки: на длинном списке оно оказывалось то внизу,
  // то сбоку, и половины действий там не было — «Создать задачу» была только на телефоне.
  const ActionMenu = () => {
    if (!currentMenuSale) return null;
    const sale = currentMenuSale;
    const customer = customers.find(c => c.id === sale.customerId);
    const isMobile = window.innerWidth < 640;

    const items: { key: string; label: string; icon: React.ReactNode; color: string; hover: string; run: () => void }[] = [
      {
        key: 'info', label: 'Информация о договоре', icon: <FileText size={18} />,
        color: 'text-blue-500 dark:text-blue-400', hover: 'hover:bg-blue-50 dark:hover:bg-blue-900/30',
        run: () => setSelectedSaleForInfo(sale),
      },
      {
        key: 'schedule', label: 'График платежей', icon: <Calendar size={18} />,
        color: 'text-indigo-500 dark:text-indigo-400', hover: 'hover:bg-indigo-50 dark:hover:bg-indigo-900/30',
        run: () => onViewSchedule(sale),
      },
      ...(!isEmployee || user?.permissions?.canEdit ? [{
        key: 'edit', label: 'Редактировать', icon: <Edit3 size={18} />,
        color: 'text-slate-500 dark:text-slate-400', hover: 'hover:bg-slate-50 dark:hover:bg-slate-700',
        run: () => onEditSale(sale),
      }] : []),
      {
        key: 'print', label: 'Печать договора', icon: <Printer size={18} />,
        color: 'text-slate-500 dark:text-slate-400', hover: 'hover:bg-slate-50 dark:hover:bg-slate-700',
        run: () => printContract(sale),
      },
      // Задача по договору: для просроченных подсказываем текст сразу
      ...(onCreateTask ? [{
        key: 'task', label: 'Создать задачу', icon: ICONS.Tasks,
        color: 'text-emerald-500 dark:text-emerald-400', hover: 'hover:bg-slate-50 dark:hover:bg-slate-700',
        run: () => {
          const overdueSum = calculateSaleOverdue(sale);
          const noteParts = [
            customer?.phone ? `Телефон: ${customer.phone}` : null,
            overdueSum > 0 ? `Долг: ${Math.round(overdueSum).toLocaleString('ru-RU')} ₽` : null,
            `Товар: ${sale.productName}`,
          ].filter(Boolean);
          onCreateTask({
            title: overdueSum > 0
              ? `Связаться по просрочке — ${customer?.name || 'клиент'}`
              : `По договору — ${customer?.name || sale.productName}`,
            note: noteParts.join('\n'),
            customerId: sale.customerId,
            customerName: customer?.name,
            saleId: sale.id,
          });
        },
      }] : []),
    ];
    const canDelete = !isEmployee || user?.permissions?.canDelete;

    const content = (
      <>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Действия</span>
          <button
            onClick={() => closeActionMenu()}
            className="p-1 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
            aria-label="Закрыть"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700">
          <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{customer?.name}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{sale.productName}</p>
        </div>

        <div className="py-2">
          {items.map(item => (
            <button
              key={item.key}
              onClick={() => closeActionMenu(item.run)}
              className={`w-full text-left px-4 py-3.5 text-sm text-slate-700 dark:text-slate-300 flex items-center gap-3 transition-colors ${item.hover}`}
            >
              <span className={item.color}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        {canDelete && (
          <div className="border-t border-slate-100 dark:border-slate-700 py-2">
            <button
              onClick={() => closeActionMenu(() => setDeletingSale(sale))}
              className="w-full text-left px-4 py-3.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 flex items-center gap-3 transition-colors"
            >
              <span className="text-red-500 dark:text-red-400"><Trash2 size={18} /></span>
              <span>Удалить договор</span>
            </button>
          </div>
        )}

        <div className="px-4 pb-4 pt-2">
          <button
            onClick={() => closeActionMenu()}
            className="w-full py-3 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-medium text-sm hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
          >
            Отмена
          </button>
        </div>
      </>
    );

    return createPortal(
      <>
        <div
          className={`fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9998] ${isMenuClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
          onClick={() => closeActionMenu()}
        />

        {isMobile ? (
          <div className={`fixed left-0 right-0 bottom-0 z-[9999] ${isMenuClosing ? 'animate-slide-down-sheet' : 'animate-slide-up-sheet'}`}>
            <div className="bg-white dark:bg-slate-800 rounded-t-3xl shadow-2xl w-full mx-auto overflow-hidden">
              {content}
            </div>
          </div>
        ) : (
          // Компьютер: по центру экрана, независимо от того, где в списке нажали
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
            onClick={() => closeActionMenu()}
          >
            <div
              className={`w-full max-w-sm bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-700 overflow-hidden max-h-[85vh] overflow-y-auto ${isMenuClosing ? 'animate-fade-out' : 'animate-dialog-in'}`}
              onClick={e => e.stopPropagation()}
            >
              {content}
            </div>
          </div>
        )}
      </>,
    document.body
  );
};

useEffect(() => {
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && activeMenuId) {
      closeActionMenu();
    }
  };

  const handleClickOutside = (e: MouseEvent) => {
    if (activeMenuId && !(e.target as HTMLElement).closest('[aria-label="Меню"]')) {
      closeActionMenu();
    }
  };

  if (activeMenuId) {
    document.addEventListener('keydown', handleEscape);
    document.addEventListener('click', handleClickOutside);
    document.body.style.overflow = 'hidden';
  }

  return () => {
    document.removeEventListener('keydown', handleEscape);
    document.removeEventListener('click', handleClickOutside);
    document.body.style.overflow = '';
  };
}, [activeMenuId]);

  return (
    <div className="space-y-4 pb-20 w-full max-w-5xl mx-auto px-3 sm:px-4" onClick={() => closeActionMenu()}>

      {/* Заголовок вкладки */}
      {activeTab === 'OVERDUE' && overdueSummary ? (
        <div className="bg-gradient-to-br from-red-50 to-orange-50 dark:from-red-900/30 dark:to-orange-900/30 border border-red-200 dark:border-red-900/50 p-4 rounded-2xl">
          <div className="flex justify-between items-start gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">Просроченные договоры</h2>
              <p className="text-slate-500 dark:text-slate-400 text-xs">
                {filteredList.length} {pluralRu(filteredList.length, 'договор', 'договора', 'договоров')} · {overdueSummary.clients} {pluralRu(overdueSummary.clients, 'клиент', 'клиента', 'клиентов')}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Список должников текстом: ФИО, дата рождения, срок */}
              <button
                onClick={() => setShareOpen(true)}
                disabled={filteredList.length === 0}
                title="Поделиться списком"
                className="px-3 py-2 bg-white/80 dark:bg-white/10 text-slate-700 dark:text-slate-200 disabled:opacity-50 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" /><path d="m16 6-4-4-4 4" /><path d="M12 2v13" /></svg>
                Поделиться
              </button>
              {!readOnly && (
                <button
                    onClick={() => { setRiskAcknowledged(false); setShowConfirmRemindAll(true); }}
                    disabled={filteredList.length === 0 || isSendingAll}
                    className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm"
                >
                  {isSendingAll ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                        {sentStats ? `${sentStats.sent}/${sentStats.total}` : 'Отправка...'}
                      </>
                  ) : (
                      <>
                        <Phone size={14} className="rotate-90"/>
                        Напомнить всем
                      </>
                  )}
                </button>
              )}
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-red-200 dark:border-red-900/50 grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Общая просрочка</p>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400">{formatCurrency(totalOverdueSum, appSettings?.showCents)} ₽</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Средний срок</p>
              <p className="text-2xl font-bold text-slate-800 dark:text-white">{overdueSummary.avgDays} <span className="text-sm font-semibold text-slate-500">{daysWord(overdueSummary.avgDays)}</span></p>
            </div>
          </div>

          {/* Больше всех должны — пять строк, сразу видно, кому звонить */}
          {overdueSummary.top.length > 1 && (
            <div className="mt-3 pt-3 border-t border-red-200 dark:border-red-900/50">
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mb-1.5">Больше всех должны</p>
              <div className="space-y-1">
                {overdueSummary.top.map((r, i) => (
                  <button key={r.sale.id} type="button" onClick={() => setSelectedSaleForInfo(r.sale)}
                          className="w-full flex items-center gap-2 text-left text-sm rounded-lg px-1 py-0.5 hover:bg-white/50 dark:hover:bg-white/5">
                    <span className="w-4 text-xs font-bold text-slate-400">{i + 1}</span>
                    <span className="flex-1 min-w-0 truncate font-semibold text-slate-700 dark:text-slate-200">{getCustomerName(r.sale.customerId)}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">{r.m.overdueDays} дн.</span>
                    <span className="w-24 text-right font-bold text-red-600 dark:text-red-400 shrink-0 tabular-nums">{formatCurrency(r.m.overdue, appSettings?.showCents)} ₽</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : activeTab === 'ACTIVE' && activeSummary ? (
        <div className="py-2">
          <h2 className="text-2xl font-bold text-slate-800 dark:text-white">{getTabTitle()}</h2>
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-0.5">Найдено: {filteredList.length}</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-3">
              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Осталось получить</p>
              <p className="text-lg font-bold text-slate-800 dark:text-white tabular-nums">{formatCurrency(activeSummary.remaining, appSettings?.showCents)} ₽</p>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-3">
              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Ожидается в этом месяце</p>
              <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{formatCurrency(activeSummary.thisMonth, appSettings?.showCents)} ₽</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex justify-between items-center py-2">
          <div>
            <h2 className="text-2xl font-bold text-slate-800 dark:text-white">{getTabTitle()}</h2>
            <p className="text-slate-400 dark:text-slate-500 text-xs mt-0.5">Найдено: {filteredList.length}</p>
          </div>
        </div>
      )}

      {/* Сроки просрочки кнопками: число договоров и сумма в каждом */}
      {overdueSummary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {overdueSummary.aging.map(b => {
            const on = filters.aging === b.id;
            return (
              <button key={b.id} type="button" onClick={() => setF('aging', on ? '' : b.id)}
                      className={`text-left rounded-2xl px-3 py-2.5 border transition-all active:scale-[0.98] ${on
                        ? 'bg-red-600 border-red-600 text-white shadow-sm'
                        : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-slate-700 dark:text-slate-200'}`}>
                <p className={`text-[11px] font-semibold ${on ? 'text-white/80' : 'text-slate-500 dark:text-slate-400'}`}>{b.label}</p>
                <p className="text-sm font-bold tabular-nums">{b.count} · {formatCurrency(b.sum, false)} ₽</p>
              </button>
            );
          })}
        </div>
      )}

      {/* Поиск, сортировка, фильтр — одной строкой */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" size={16}/>
          <input
              type="text"
              placeholder="Поиск по имени или товару..."
              className="w-full pl-9 pr-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 dark:text-white rounded-xl text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200 outline-none transition-all"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        {SORTS[activeTab].length > 1 && (
          <button type="button" onClick={() => setSortOpen(true)} title="Сортировка"
                  className="shrink-0 h-[42px] px-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 flex items-center gap-1.5 text-sm font-semibold">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m3 16 4 4 4-4" /><path d="M7 20V4" /><path d="m21 8-4-4-4 4" /><path d="M17 4v16" /></svg>
            <span className="hidden sm:inline max-w-[160px] truncate">{SORTS[activeTab].find(o => o.id === sortKey)?.label}</span>
          </button>
        )}
        <button type="button" onClick={() => setFiltersOpen(true)} title="Фильтры" aria-label="Фильтры"
                className={`relative shrink-0 w-[42px] h-[42px] rounded-xl flex items-center justify-center transition-colors ${filtersOn
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300'}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
          {filtersOn > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">{filtersOn}</span>
          )}
        </button>
      </div>
      {filtersOn > 0 && (
        <div className="-mt-2 flex items-center gap-2 text-xs">
          <span className="text-slate-500 dark:text-slate-400">Фильтров: {filtersOn}</span>
          <button type="button" onClick={resetFilters} className="font-semibold text-slate-500 dark:text-slate-400 hover:text-rose-600">✕ Сбросить</button>
        </div>
      )}

      {/* Список договоров */}
      <div className="space-y-2.5">
        {filteredList.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
            <div className="text-4xl mb-2">📄</div>
            <p className="text-slate-400 dark:text-slate-500 text-sm">Ничего не найдено</p>
          </div>
        ) : filteredList.map((sale, index) => {
          const customer = customers.find(c => c.id === sale.customerId);
          const overdueSum = calculateSaleOverdue(sale);
          const isOverdue = activeTab === 'OVERDUE' || overdueSum > 0;
          const isCompleted = sale.status === 'COMPLETED' || sale.remainingAmount === 0;
          const displayNumber = filteredList.length - index;

          return (
            <div
              key={sale.id}
              className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-3.5 border border-slate-100 dark:border-slate-700 hover:border-blue-200 dark:hover:border-blue-800 hover:shadow transition-all cursor-pointer"
              onClick={() => setSelectedSaleForInfo(sale)}
            >
              <div className="flex items-start justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <span className="w-5.5 h-5.5 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-lg flex items-center justify-center text-white font-bold text-[10px] shadow-sm shrink-0">
                    {displayNumber}
                  </span>
                  <span className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide rounded-md ${
                    isOverdue ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' : isCompleted ? 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                  }`}>
                    {isOverdue ? 'Просрочено' : isCompleted ? 'Закрыто' : 'Активно'}
                  </span>
                </div>
                {!readOnly && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleActionClick(e, sale); }}
                    className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-all shrink-0"
                    aria-label="Меню"
                  >
                    <MoreVertical size={16} />
                  </button>
                )}
              </div>

              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 dark:text-white text-sm truncate flex items-center gap-1.5" title={customer?.name}>
                    <span className="truncate">{customer?.name || 'Неизвестно'}</span>
                    {/* Точка, если договор ещё только на этом устройстве. */}
                    <UnsyncedMark id={sale.id} />
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5" title={sale.productName}>
                    {sale.productName}
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                    {/* Номер договора — тот же, что в журнале склада: одна бумага,
                        один номер, где бы на неё ни смотрели. */}
                    №{contractNo[sale.id] || '—'} • {formatDate(sale.startDate)} • {sale.installments} мес.
                  </p>
                  {/* Просрочка: сколько дней, сколько платежей, когда платил последний раз */}
                  {activeTab === 'OVERDUE' && (() => {
                    const mm = metrics.get(sale.id);
                    if (!mm) return null;
                    return (
                      <p className="text-[11px] text-red-600 dark:text-red-400 mt-1 font-medium">
                        <b>{mm.overdueDays} {daysWord(mm.overdueDays)}</b>
                        {' · '}{mm.missed} {pluralRu(mm.missed, 'платёж', 'платежа', 'платежей')}
                        <span className="text-slate-500 dark:text-slate-400 font-normal">
                          {' · '}{mm.lastPayment ? `платил ${formatDate(mm.lastPayment)}` : 'платежей не было'}
                        </span>
                      </p>
                    );
                  })()}
                  {employees.length > 0 && getCreatorName(sale) && (
                    <p className="text-[10px] text-indigo-500 dark:text-indigo-400 mt-0.5 flex items-center gap-1">
                      <UserIcon size={10} /> {getCreatorName(sale)}
                    </p>
                  )}
                </div>

                <div className="text-right shrink-0">
                  <p className={`text-base font-bold ${isOverdue ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-white'}`}>
                    {formatCurrency(isOverdue ? overdueSum : sale.totalAmount, appSettings?.showCents)} ₽
                  </p>
                </div>
              </div>

              {/* Активный: ближайший платёж и полоса выплаты */}
              {activeTab === 'ACTIVE' && (() => {
                const mm = metrics.get(sale.id);
                if (!mm) return null;
                const soon = mm.nextDue && (time(mm.nextDue.date) - Date.now()) / DAY_MS < 3;
                return (
                  <div className="mb-2">
                    {mm.nextDue && (
                      <p className={`text-[11px] mb-1.5 ${soon ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-slate-500 dark:text-slate-400'}`}>
                        Следующий платёж {new Date(mm.nextDue.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} · {formatCurrency(mm.nextDue.amount, appSettings?.showCents)} ₽
                        {mm.hadLate && <span className="ml-1.5 text-rose-500 font-semibold">· были опоздания</span>}
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${mm.paidPercent}%` }} />
                      </div>
                      <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums">{mm.paidPercent}%</span>
                    </div>
                  </div>
                );
              })()}

              {activeTab !== 'OVERDUE' && !isCompleted && (
                <div className="flex items-center justify-between pt-2 border-t border-slate-50 dark:border-slate-700">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">
                    Оплачено: <span className="font-medium text-emerald-600 dark:text-emerald-400">{formatCurrency(sale.totalAmount - sale.remainingAmount, appSettings?.showCents)} ₽</span>
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">
                    Остаток: <span className="font-medium text-slate-700 dark:text-slate-300">{formatCurrency(sale.remainingAmount, appSettings?.showCents)} ₽</span>
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Меню действий */}
      {activeMenuId && <ActionMenu />}

      {/* Сортировка */}
      {sortOpen && (
        <GlassSheet title="Сортировка" fit="content" cancelLabel="Закрыть" onClose={() => setSortOpen(false)}>
          {(close: () => void) => (
            <SheetSection>
              {SORTS[activeTab].map(o => (
                <SheetChoice key={o.id} selected={sortKey === o.id} label={o.label}
                             onSelect={() => { setSortKey(o.id); close(); }} />
              ))}
            </SheetSection>
          )}
        </GlassSheet>
      )}

      {/* Фильтры: общие и свои для вкладки */}
      {filtersOpen && (
        <GlassSheet
          title="Фильтры"
          subtitle={`Найдётся ${filteredList.length}`}
          onClose={() => setFiltersOpen(false)}
          cancelLabel="Закрыть"
          action={{ label: 'Показать', onClick: close => close() }}
        >
          <div className="space-y-6">
            {activeTab === 'OVERDUE' && (
              <SheetSection title="Просрочка">
                <div className="px-4 py-3.5 space-y-3">
                  <ChipGroup label="Срок">
                    <FilterChip on={!filters.aging} onClick={() => setF('aging', '')}>Любой</FilterChip>
                    {AGING.map(b => <FilterChip key={b.id} on={filters.aging === b.id} onClick={() => setF('aging', filters.aging === b.id ? '' : b.id)}>{b.label}</FilterChip>)}
                  </ChipGroup>
                  <ChipGroup label="Сумма просрочки от">
                    {[0, 5000, 10000, 30000, 50000].map(v => (
                      <FilterChip key={v} on={filters.overdueFrom === v} onClick={() => setF('overdueFrom', v)}>{v ? `${(v / 1000).toLocaleString('ru-RU')} тыс ₽` : 'Любая'}</FilterChip>
                    ))}
                  </ChipGroup>
                  <ChipGroup label="Пропущено платежей">
                    {[0, 1, 2, 3].map(v => (
                      <FilterChip key={v} on={filters.missed === v} onClick={() => setF('missed', v)}>{v === 0 ? 'Сколько угодно' : v === 3 ? '3 и больше' : String(v)}</FilterChip>
                    ))}
                  </ChipGroup>
                  <ChipGroup label="Не платил больше">
                    {[0, 30, 60, 90].map(v => (
                      <FilterChip key={v} on={filters.silentDays === v} onClick={() => setF('silentDays', v)}>{v ? `${v} дней` : 'Неважно'}</FilterChip>
                    ))}
                  </ChipGroup>
                </div>
              </SheetSection>
            )}

            {activeTab === 'ACTIVE' && (
              <SheetSection title="Платежи">
                <div className="px-4 py-3.5 space-y-3">
                  <ChipGroup label="Следующий платёж">
                    {([['', 'Когда угодно'], ['TODAY', 'Сегодня'], ['WEEK', 'На этой неделе'], ['MONTH', 'В этом месяце']] as const).map(([v, l]) => (
                      <FilterChip key={v} on={filters.due === v} onClick={() => setF('due', v)}>{l}</FilterChip>
                    ))}
                  </ChipGroup>
                  <ChipGroup label="Выплачено">
                    {([['', 'Сколько угодно'], ['LOW', 'меньше 25%'], ['MID', '25–75%'], ['HIGH', 'больше 75%']] as const).map(([v, l]) => (
                      <FilterChip key={v} on={filters.paid === v} onClick={() => setF('paid', v)}>{l}</FilterChip>
                    ))}
                  </ChipGroup>
                  <ChipGroup label="Особые">
                    <FilterChip on={filters.hadLate} onClick={() => setF('hadLate', !filters.hadLate)}>Платил с опозданием</FilterChip>
                    <FilterChip on={filters.noPayments} onClick={() => setF('noPayments', !filters.noPayments)}>Ни одного платежа</FilterChip>
                  </ChipGroup>
                </div>
              </SheetSection>
            )}

            <SheetSection title="Оформлен">
              <div className="px-4 py-3.5 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {([['ALL', 'За всё время'], ['THIS_MONTH', 'В этом месяце'], ['LAST_MONTH', 'В прошлом'], ['CUSTOM', 'Свой период']] as const).map(([v, l]) => (
                    <FilterChip key={v} on={filters.period === v} onClick={() => setF('period', v)}>{l}</FilterChip>
                  ))}
                </div>
                {filters.period === 'CUSTOM' && (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block"><span className="text-[12px] text-slate-400">с</span>
                      <input type="date" value={filters.dateFrom} onChange={e => setF('dateFrom', e.target.value)} className={`${sheetInputClass} rounded-xl bg-slate-100 dark:bg-white/10 px-3 py-2`} /></label>
                    <label className="block"><span className="text-[12px] text-slate-400">по</span>
                      <input type="date" value={filters.dateTo} onChange={e => setF('dateTo', e.target.value)} className={`${sheetInputClass} rounded-xl bg-slate-100 dark:bg-white/10 px-3 py-2`} /></label>
                  </div>
                )}
              </div>
            </SheetSection>

            <SheetSection title="Сумма договора, ₽">
              <div className="px-4 py-3.5 grid grid-cols-2 gap-2">
                <input inputMode="numeric" placeholder="от" value={filters.amountFrom} onChange={e => setF('amountFrom', e.target.value.replace(/\D/g, ''))}
                       className={`${sheetInputClass} rounded-xl bg-slate-100 dark:bg-white/10 px-3 py-2`} />
                <input inputMode="numeric" placeholder="до" value={filters.amountTo} onChange={e => setF('amountTo', e.target.value.replace(/\D/g, ''))}
                       className={`${sheetInputClass} rounded-xl bg-slate-100 dark:bg-white/10 px-3 py-2`} />
              </div>
            </SheetSection>

            {accounts.length > 1 && (
              <SheetSection title="Счёт">
                <div className="px-4 py-3.5 flex flex-wrap gap-2">
                  <FilterChip on={!filters.accountId} onClick={() => setF('accountId', '')}>Все счета</FilterChip>
                  {accounts.filter(acc => !acc.isArchived || acc.id === filters.accountId).map(acc => (
                    <FilterChip key={acc.id} on={filters.accountId === acc.id} onClick={() => setF('accountId', filters.accountId === acc.id ? '' : acc.id)}>{acc.name}</FilterChip>
                  ))}
                </div>
              </SheetSection>
            )}

            {/* Сотрудник — инструмент менеджера: сам сотрудник и инвестор его не видят */}
            {canFilterEmployee && (
              <SheetSection title="Кто оформил">
                <div className="px-4 py-3.5 flex flex-wrap gap-2">
                  <FilterChip on={!filters.employeeId} onClick={() => setF('employeeId', '')}>Все</FilterChip>
                  {employees.map(emp => (
                    <FilterChip key={emp.id} on={filters.employeeId === emp.id} onClick={() => setF('employeeId', filters.employeeId === emp.id ? '' : emp.id)}>{emp.name}</FilterChip>
                  ))}
                </div>
              </SheetSection>
            )}

            {filtersOn > 0 && (
              <button type="button" onClick={resetFilters}
                      className="w-full py-3 rounded-2xl text-[15px] font-semibold text-rose-600 dark:text-rose-400 bg-white/70 dark:bg-white/5 active:opacity-70">
                Сбросить все фильтры
              </button>
            )}
          </div>
        </GlassSheet>
      )}

      {shareOpen && (
        <ShareDebtorsSheet rows={debtorRows} showCents={appSettings?.showCents} onClose={() => setShareOpen(false)} />
      )}

      {/* Модалка удаления */}
      {deletingSale && !readOnly && (
        <div className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={closeDeleteModal}>
          <div className="bg-white dark:bg-slate-800 w-full max-w-sm p-6 rounded-3xl shadow-2xl animate-dialog-in" onClick={e => e.stopPropagation()}>
            {deleteStage === 'done' ? (
              <div className="py-2 text-center space-y-5">
                <SuccessCheck tone="danger" />
                <div className="animate-stage-in" style={{ animationDelay: '0.55s' }}>
                  <h3 className="text-lg font-bold text-slate-800 dark:text-white">Договор удалён</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 break-words">
                    {deletingSale.productName}
                  </p>
                </div>
              </div>
            ) : (
            <>
            <div className="w-14 h-14 bg-red-500 text-white rounded-2xl flex items-center justify-center mx-auto mb-4"><Trash2 size={28} /></div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white text-center mb-1.5">Удалить договор?</h3>
            <p className="text-center text-slate-500 dark:text-slate-400 mb-6 text-sm">Все данные о платежах будут удалены. Товар вернётся на склад.</p>

            {/* Отказ показываем здесь же — раньше он прилетал системным alert */}
            {deleteError && (
              <div className="mb-4 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-900/50 rounded-xl p-3 flex gap-2 items-start animate-stage-in">
                <span className="text-rose-500 shrink-0 mt-0.5">⛔</span>
                <p className="text-xs text-rose-800 dark:text-rose-300">{deleteError}</p>
              </div>
            )}

            <div className="flex gap-2.5">
              <button onClick={closeDeleteModal} disabled={deleteStage === 'working'}
                      className="btn-press flex-1 py-2.5 bg-slate-100 dark:bg-slate-700 rounded-xl font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50">
                {deleteError ? 'Закрыть' : 'Отмена'}
              </button>
              {!deleteError && (
                <button onClick={handleDeleteConfirm} disabled={deleteStage === 'working'}
                        className="btn-press flex-1 py-2.5 bg-red-500 text-white rounded-xl font-bold hover:bg-red-600 disabled:bg-slate-400 flex items-center justify-center gap-2">
                  {deleteStage === 'working' ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                      Удаляем…
                    </>
                  ) : 'Удалить'}
                </button>
              )}
            </div>
            </>
            )}
          </div>
        </div>
      )}


      {showConfirmRemindAll && createPortal(
  <div
    className="fixed inset-0 z-modal-top flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-fade-in"
    onClick={() => !isSendingAll && setShowConfirmRemindAll(false)}
  >
    <div
      className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-3xl p-5 shadow-2xl animate-scale-in"
      onClick={e => e.stopPropagation()}
    >
      <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-2xl flex items-center justify-center mx-auto mb-3">
        <Phone size={24} className="rotate-90" />
      </div>
      <h4 className="text-center font-bold text-slate-800 dark:text-white mb-1">Напомнить всем клиентам?</h4>
      <p className="text-center text-slate-500 dark:text-slate-400 text-sm mb-4">
        Будет отправлено <b>{filteredList.length}</b> напоминаний в WhatsApp о просроченной задолженности.
      </p>

      <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-900/50 rounded-xl p-3 mb-3">
        <p className="text-[11px] text-amber-800 dark:text-amber-300">
          💡 Отправка займёт около {Math.ceil(filteredList.length * 0.3 / 60)} мин.
          Между сообщениями будет пауза 300ms.
        </p>
      </div>

      {/* ⚠️ Риск блокировки WhatsApp при массовой рассылке похожих сообщений */}
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-xl p-3 mb-3">
        <p className="text-[11px] text-red-700 dark:text-red-400 leading-relaxed">
          ⚠️ <b>Риск блокировки номера в WhatsApp.</b> Рассылка большого числа однотипных сообщений подряд
          похожа на спам-рассылку, и WhatsApp может временно или насовсем заблокировать номер/аккаунт —
          особенно если получатели пожалуются или не отвечают. Рекомендуем не рассылать слишком часто
          и по возможности разбивать большие списки на части.
        </p>
      </div>

      <label className="flex items-start gap-2.5 mb-4 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={riskAcknowledged}
          onChange={e => setRiskAcknowledged(e.target.checked)}
          className="mt-0.5 w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-500 shrink-0"
        />
        <span className="text-[11px] text-slate-600 dark:text-slate-300">
          Я понимаю риск блокировки WhatsApp и хочу продолжить
        </span>
      </label>

      <div className="flex gap-2.5">
        <button
          onClick={() => setShowConfirmRemindAll(false)}
          disabled={isSendingAll}
          className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-medium text-sm hover:bg-slate-200 dark:hover:bg-slate-600 transition-all disabled:opacity-50"
        >
          Отмена
        </button>
        <button
          onClick={handleRemindAll}
          disabled={isSendingAll || !riskAcknowledged}
          className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isSendingAll ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
              Отправка...
            </>
          ) : (
            '✅ Отправить всем'
          )}
        </button>
      </div>
    </div>
  </div>,
  document.body
)}

      {/* Модалка информации */}
      {selectedSaleForInfo && (
        <ContractInfoModal
          // 🔒 Берём свежую запись из sales по id, а не сохранённый в state снимок —
          // иначе модалка может показывать устаревшие данные, если платёж провели
          // с другого экрана, пока эта модалка уже была открыта.
          sale={sales.find(s => s.id === selectedSaleForInfo.id) || selectedSaleForInfo}
          customer={customers.find(c => c.id === selectedSaleForInfo.customerId)}
          onClose={() => setSelectedSaleForInfo(null)}
          contractTemplatesAllowed={contractTemplatesAllowed}
          appSettings={appSettings}
          activeTab={activeTab}
          readOnly={readOnly}
        />
      )}
    </div>
  );
};

export default Contracts;