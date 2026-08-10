import React, { useMemo, useState, useEffect } from 'react';
import { Sale, Customer, Account, User, AppSettings, Task } from '../types';
import { ICONS } from '../constants';
import { Phone, Search, Wallet, MoreVertical, FileText, Calendar, Edit3, Printer, Trash2, X, User as UserIcon } from 'lucide-react';
import { formatCurrency, formatDate, escapeHtml, calculateSaleOverdue } from '../src/utils';
import { createPortal } from 'react-dom';
import { api } from '../services/api';

interface ContractsProps {
  sales: Sale[];
  customers: Customer[];
  accounts: Account[];
  activeTab: 'ALL' | 'ACTIVE' | 'OVERDUE' | 'ARCHIVE';
  onTabChange: (tab: 'ALL' | 'ACTIVE' | 'OVERDUE' | 'ARCHIVE') => void;
  onViewSchedule: (sale: Sale) => void;
  onEditSale: (sale: Sale) => void;
  onDeleteSale: (saleId: string) => void;
  readOnly?: boolean;
  user?: User | null;
  employees?: User[];
  appSettings?: AppSettings;
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
  activeTab,
  readOnly
}: {
  sale: Sale,
  customer?: Customer,
  onClose: () => void,
  appSettings?: AppSettings,
  activeTab?: 'ALL' | 'ACTIVE' | 'OVERDUE' | 'ARCHIVE',
  readOnly?: boolean
}) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 🔥 STATE для подтверждения отправки напоминания
  const [showConfirmReminder, setShowConfirmReminder] = useState(false);
  const [isSending, setIsSending] = useState(false);


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
    if (customer?.phone) {
      const phone = customer.phone.replace(/[^0-9]/g, '');
      const formattedPhone = phone.startsWith('7') ? phone : '7' + phone;
      const text = `Здравствуйте, ${customer.name}. Напоминаем о задолженности по договору "${sale.productName}" в размере ${formatCurrency(realOverdueAmount, appSettings?.showCents)} ₽.`;
      window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(text)}`, '_blank');
    }
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

    alert('✅ Напоминание отправлено!');
    setShowConfirmReminder(false);
  } catch (e: any) {
    console.error('❌ Reminder error:', e);
    alert(`⚠️ ${e.message || 'Ошибка отправки'}`);
    handleWhatsApp(); // Fallback
    setShowConfirmReminder(false);
  } finally {
    setIsSending(false);
  }
};

   return createPortal(
    <div
      className={`fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
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
            className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-fade-in"
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
// 📋 Основной компонент Contracts
// ─────────────────────────────────────────────────────────────
const Contracts: React.FC<ContractsProps> = ({
  sales, customers, accounts, activeTab, onTabChange,
  onViewSchedule, onEditSale, onDeleteSale, readOnly = false,
  user, employees = [], appSettings, onCreateTask
}) => {
  const isEmployee = user?.role === 'employee';
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAccountId, setFilterAccountId] = useState('');
  const [filterEmployeeId, setFilterEmployeeId] = useState('');
  const getCreatorName = (sale: Sale) => employees.find(e => e.id === sale.createdByUserId)?.name;
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [isMenuClosing, setIsMenuClosing] = useState(false);
  const [deletingSale, setDeletingSale] = useState<Sale | null>(null);
  const [selectedSaleForInfo, setSelectedSaleForInfo] = useState<Sale | null>(null);
  const [currentMenuSale, setCurrentMenuSale] = useState<Sale | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number, left: number } | null>(null);
  const [showConfirmRemindAll, setShowConfirmRemindAll] = useState(false);
const [isSendingAll, setIsSendingAll] = useState(false);
const [sentStats, setSentStats] = useState<{ sent: number; total: number } | null>(null);
// 🔒 Массовая рассылка похожих сообщений подряд — то, за что WhatsApp банит номера/аккаунты.
// Требуем осознанное подтверждение риска, а не просто текст предупреждения, который легко пропустить.
const [riskAcknowledged, setRiskAcknowledged] = useState(false);

  const getCustomerName = (id: string) => customers.find(c => c.id === id)?.name || 'Неизвестно';

  const { filteredList } = useMemo(() => {
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
    if (filterAccountId) list = list.filter(sale => sale.accountId === filterAccountId);
    if (filterEmployeeId) list = list.filter(sale => sale.createdByUserId === filterEmployeeId);

    return { filteredList: list.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()) };
  }, [sales, customers, activeTab, searchTerm, filterAccountId, filterEmployeeId]);

  const totalOverdueSum = useMemo(() => {
    if (activeTab !== 'OVERDUE') return 0;
    return filteredList.reduce((sum, s) => sum + calculateSaleOverdue(s), 0);
  }, [filteredList, activeTab]);

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




const closeActionMenu = (after?: () => void) => {
  setIsMenuClosing(true);
  setTimeout(() => {
    setActiveMenuId(null);
    setCurrentMenuSale(null);
    setMenuPosition(null);
    setIsMenuClosing(false);
    after?.();
  }, 250);
};



const handleActionClick = (e: React.MouseEvent, sale: Sale) => {
  e.stopPropagation();

  if (activeMenuId === sale.id) {
    closeActionMenu();
    return;
  }

  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const isMobile = window.innerWidth < 640;

  if (!isMobile) {
    const MENU_WIDTH = 256; // w-64
    const MENU_HEIGHT = 320; // примерная высота с запасом
    const GAP = 8; // отступ от кнопки

    // 🔹 Вертикаль: проверяем место снизу/сверху ОТНОСИТЕЛЬНО VIEWPORT
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    let menuTop: number;
    if (spaceBelow >= MENU_HEIGHT + GAP) {
      menuTop = rect.bottom + GAP; // снизу от кнопки
    } else if (spaceAbove >= MENU_HEIGHT + GAP) {
      menuTop = rect.top - MENU_HEIGHT - GAP; // сверху от кнопки
    } else {
      // центрируем по кнопке, но в пределах экрана
      menuTop = Math.max(GAP, Math.min(rect.top - MENU_HEIGHT / 2, window.innerHeight - MENU_HEIGHT - GAP));
    }

    // 🔹 Горизонталь: проверяем место справа/слева
    const spaceRight = window.innerWidth - rect.right;
    const spaceLeft = rect.left;

    let menuLeft: number;
    if (spaceRight >= MENU_WIDTH + GAP) {
      menuLeft = rect.right - MENU_WIDTH; // выравниваем по правому краю кнопки
    } else if (spaceLeft >= MENU_WIDTH + GAP) {
      menuLeft = rect.left; // выравниваем по левому краю кнопки
    } else {
      // центрируем по горизонтали
      menuLeft = Math.max(GAP, Math.min(rect.left - MENU_WIDTH / 2, window.innerWidth - MENU_WIDTH - GAP));
    }

    setMenuPosition({ top: menuTop, left: menuLeft });
  }

  setActiveMenuId(sale.id);
  setCurrentMenuSale(sale);
};

  const handleDeleteConfirm = () => {
    if (deletingSale) { onDeleteSale(deletingSale.id); setDeletingSale(null); }
  };

  const printContract = (sale: Sale) => {
    const customer = customers.find(c => c.id === sale.customerId);
    const companyName = appSettings?.companyName || "Компания";
    const sellerPhone = user?.phone || "";
    const hasGuarantor = !!sale.guarantorName;
    const printWindow = window.open('', '_blank');

    if (!printWindow) { alert("Разрешите всплывающие окна для печати"); return; }

    // 🔒 Одна таблица "График платежей": КАЖДЫЙ реальный платёж (в т.ч. частичный) — своя строка
    // на СВОЮ дату с фактической суммой; плановые месяцы графика, которые ещё не покрыты реальными
    // платежами, — строки-плейсхолдеры даты без суммы (деньги для них уже посчитаны на датах
    // соответствующих реальных платежей, показывать их ещё раз на дату месяца было бы задвоением).
    // 🔒 ВАЖНО: покрытие планового месяца пересчитываем от ОБЩЕЙ суммы реальных платежей (surplus),
    // а не доверяем сохранённому флагу isPaid планового слота — на практике он бывает неактуален
    // (например, платёж импортирован/добавлен без пересчёта reconcileSalePaymentPlan), из-за чего
    // рядом с уже оплаченной датой оставался "призрачный" пустой дубль той же даты.
    // "Остаток" — НАКОПИТЕЛЬНЫЙ остаток долга по договору, уменьшается только на реальных платежах.
    const realPayments = (sale.paymentPlan || []).filter(p => p.isRealPayment === true);
    let surplus = realPayments.reduce((sum, p) => sum + p.amount, 0);

    const uncoveredScheduled = (sale.paymentPlan || [])
        .filter(p => p.isRealPayment !== true)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .filter(p => {
            if (surplus >= p.amount - 0.01) {
                surplus -= p.amount; // покрыт целиком реальными деньгами — не показываем как отдельную строку
                return false;
            }
            return true;
        });

    let currentDebt = sale.totalAmount - sale.downPayment;
    const scheduleRows = [
        ...realPayments.map(p => ({ date: p.date, paid: p.amount })),
        ...uncoveredScheduled.map(p => ({ date: p.date, paid: 0 }))
    ]
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .map(p => {
            if (p.paid > 0) currentDebt -= p.paid;
            return { date: p.date, paid: p.paid, remaining: Math.max(0, currentDebt) };
        });

    const scheduleRowsHtml = scheduleRows.length > 0
        ? scheduleRows.map((p, index) => `<tr>
                <td style="text-align:center">${index + 1}</td>
                <td style="text-align:center">${formatDate(p.date)}</td>
                <td style="text-align:center">${p.paid > 0.01 ? `${formatCurrency(p.paid, appSettings?.showCents)} ₽` : ''}</td>
                <td style="text-align:center">${formatCurrency(p.remaining, appSettings?.showCents)} ₽</td>
            </tr>`).join('')
        : Array.from({ length: sale.installments || 1 }).map((_, i) =>
            `<tr>
                <td style="text-align:center">${i + 1}</td>
                <td style="text-align:center;height:30px"></td>
                <td style="text-align:center"></td>
                <td style="text-align:center"></td>
            </tr>`
        ).join('');

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Договор</title>
    <style>
        * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body { 
            font-family: 'Arial, Helvetica, sans-serif', Times, serif; 
            font-size: 12pt; 
            line-height: 1.5; 
            padding: 30px 25px;
            width: 100%;
            max-width: 210mm;
            margin: 0 auto;
            display: flex;
            flex-direction: column;
            min-height: 297mm;
        }
        h1 { text-align: center; font-size: 15pt; font-weight: bold; margin: 0 0 25px 0; text-transform: uppercase; line-height: 1.3; }
        .header-info { text-align: right; margin-bottom: 20px; font-size: 11pt; }
        .field-row { display: flex; justify-content: space-between; margin-bottom: 10px; }
        .field-label { font-weight: bold; }
        .section { margin: 0 0 20px 0; }
        .section > div { margin-bottom: 12px; }
        .section > div:last-child { margin-bottom: 0; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 10.5pt; }
        th, td { border: 1px solid #000; padding: 6px 8px; text-align: center; }
        th { font-weight: bold; background: #f9f9f9; }
        .content-wrapper { flex: 1 0 auto; }
        .footer-container {
            margin-top: auto;
            padding-top: 20px;
            width: 100%;
            break-inside: avoid;
            page-break-inside: avoid;
        }
        .footer { display: flex; justify-content: space-between; align-items: flex-end; width: 100%; }
        .signature-block { text-align: center; break-inside: avoid; page-break-inside: avoid; }
        .signature-line { border-bottom: 1px solid #000; margin: 35px 0 5px 0; min-height: 1px; }
        .signature-label { font-size: 10pt; font-style: italic; }
        .no-print {
            position: fixed; top: 15px; right: 15px; padding: 10px 18px;
            background: #ef4444; color: white; border: none; border-radius: 6px;
            cursor: pointer; font-family: sans-serif; font-weight: 600; z-index: 1000;
        }
        @media print {
            @page { margin: 1.5cm; size: A4 portrait; }
            body { padding: 0; margin: 0; width: 100%; max-width: none; min-height: auto; display: block; }
            .field-row { flex-wrap: nowrap !important; gap: 0 !important; justify-content: space-between !important; }
            .field-row > span:first-child { flex-shrink: 0; }
            .field-row > span:last-child { text-align: right !important; flex-shrink: 0; margin-left: 10px; }
            .content-wrapper { margin-bottom: 150px; }
            .footer-container { position: relative; margin-top: -130px; padding-top: 0; page-break-inside: avoid !important; break-inside: avoid !important; }
            .no-print { display: none !important; }
            h1 { font-size: 14pt; }
            table { font-size: 10pt; }
        }
        @media screen and (max-width: 768px) {
            body { font-size: 11pt; padding: 20px 15px; min-height: 100vh; }
            h1 { font-size: 13pt; }
            .field-row { flex-wrap: wrap; gap: 5px; }
            .field-row > span:last-child { text-align: right; min-width: 120px; }
            table { font-size: 9.5pt; }
        }
    </style>
</head>
<body>
    <button class="no-print" onclick="window.close()">✕ Закрыть</button>
    <h1>ДОГОВОР КУПЛИ-ПРОДАЖИ ТОВАРА В РАССРОЧКУ</h1>
    <div class="header-info">Дата: ${formatDate(sale.startDate)}</div>
    <div class="content-wrapper">
        <div class="section">
            <div class="field-row">
                <span><span class="field-label">Продавец:</span> ${escapeHtml(companyName)}</span>
                <span>Тел: ${escapeHtml(formatPhone(sellerPhone))}</span>
            </div>
            <div class="field-row">
                <span><span class="field-label">Покупатель:</span> ${customer?.name ? escapeHtml(customer.name) : '__________________'}</span>
                <span>Тел: ${escapeHtml(formatPhone(customer.phone))}</span>
            </div>
            ${hasGuarantor ? `
            <div class="field-row">
                <span><span class="field-label">Поручитель:</span> ${escapeHtml(sale.guarantorName)}</span>
                <span>Тел: ${escapeHtml(formatPhone(sale.guarantorPhone))}</span>
            </div>` : ''}
        </div>
        <div class="section">
            <div><span class="field-label">Товар:</span> ${escapeHtml(sale.productName)}</div>
            <div style="display: flex; justify-content: space-between; margin-top: 10px;">
                <span><span class="field-label">Срок рассрочки:</span> ${sale.installments} мес.</span>
                <span><span class="field-label">Стоимость:</span> ${formatCurrency(sale.totalAmount, appSettings?.showCents)} ₽</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
                <span><span class="field-label">Ежемесячный платеж:</span> ${formatCurrency(sale.paymentPlan[0]?.amount || 0, appSettings?.showCents)} ₽</span>
                <span><span class="field-label">Первый взнос:</span> ${formatCurrency(sale.downPayment, appSettings?.showCents)} ₽</span>
            </div>
        </div>
        <table>
            <thead>
                <tr>
                    <th style="width: 10%;">№</th>
                    <th style="width: 30%;">Дата</th>
                    <th style="width: 30%;">Оплачено</th>
                    <th style="width: 30%;">Остаток</th>
                </tr>
            </thead>
            <tbody>${scheduleRowsHtml}</tbody>
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
            ${hasGuarantor ? `
            <div class="signature-block" style="width: 30%">
                <div class="signature-line"></div>
                <div class="signature-label">Поручитель</div>
            </div>` : ''}
            <div class="signature-block" style="width: ${hasGuarantor ? '30%' : '45%'}">
                <div class="signature-line"></div>
                <div class="signature-label">Покупатель</div>
            </div>
        </div>
    </div>
    <script>
        window.onload = function() { setTimeout(() => { window.print(); }, 300); }
    </script>
</body>
</html>`;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  const ActionMenu = () => {
  if (!currentMenuSale) return null;

  const customer = customers.find(c => c.id === currentMenuSale.customerId);
  const isMobile = window.innerWidth < 640;

  return createPortal(
    <>
      <div
        className={`fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9998] ${isMenuClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
        onClick={() => closeActionMenu()}
      />

      {isMobile ? (
        <div className={`fixed left-0 right-0 bottom-0 z-[9999] ${isMenuClosing ? 'animate-slide-down-sheet' : 'animate-slide-up-sheet'}`}>
          <div className="bg-white dark:bg-slate-800 rounded-t-3xl shadow-2xl w-full mx-auto overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700">
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Действия</span>
              <button onClick={() => closeActionMenu()} className="p-1 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300">
                <X size={20} />
              </button>
            </div>

            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700">
              <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{customer?.name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{currentMenuSale.productName}</p>
            </div>

            <div className="py-2">
              <button
                onClick={() => closeActionMenu(() => setSelectedSaleForInfo(currentMenuSale))}
                className="w-full text-left px-4 py-3.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 flex items-center gap-3 transition-colors"
              >
                <span className="text-blue-500 dark:text-blue-400"><FileText size={18} /></span>
                <span>Информация о договоре</span>
              </button>

              <button
                onClick={() => closeActionMenu(() => onViewSchedule(currentMenuSale))}
                className="w-full text-left px-4 py-3.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 flex items-center gap-3 transition-colors"
              >
                <span className="text-indigo-500 dark:text-indigo-400"><Calendar size={18} /></span>
                <span>График платежей</span>
              </button>

              {(!isEmployee || user?.permissions?.canEdit) && (
                <button
                  onClick={() => closeActionMenu(() => onEditSale(currentMenuSale))}
                  className="w-full text-left px-4 py-3.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-3 transition-colors"
                >
                  <span className="text-slate-500 dark:text-slate-400"><Edit3 size={18} /></span>
                  <span>Редактировать</span>
                </button>
              )}

              <button
                onClick={() => closeActionMenu(() => printContract(currentMenuSale))}
                className="w-full text-left px-4 py-3.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-3 transition-colors"
              >
                <span className="text-slate-500 dark:text-slate-400"><Printer size={18} /></span>
                <span>Печать договора</span>
              </button>

              {/* Задача по договору: для просроченных подсказываем текст сразу */}
              {onCreateTask && (
                <button
                  onClick={() => closeActionMenu(() => {
                    const customer = customers.find(c => c.id === currentMenuSale.customerId);
                    const overdueSum = calculateSaleOverdue(currentMenuSale);
                    const noteParts = [
                      customer?.phone ? `Телефон: ${customer.phone}` : null,
                      overdueSum > 0 ? `Долг: ${Math.round(overdueSum).toLocaleString('ru-RU')} ₽` : null,
                      `Товар: ${currentMenuSale.productName}`,
                    ].filter(Boolean);
                    onCreateTask({
                      title: overdueSum > 0
                        ? `Связаться по просрочке — ${customer?.name || 'клиент'}`
                        : `По договору — ${customer?.name || currentMenuSale.productName}`,
                      note: noteParts.join('\n'),
                      customerId: currentMenuSale.customerId,
                      customerName: customer?.name,
                      saleId: currentMenuSale.id,
                    });
                  })}
                  className="w-full text-left px-4 py-3.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-3 transition-colors"
                >
                  <span className="text-emerald-500 dark:text-emerald-400">{ICONS.Tasks}</span>
                  <span>Создать задачу</span>
                </button>
              )}
            </div>

            <div className="border-t border-slate-100 dark:border-slate-700 py-2">
              {(!isEmployee || user?.permissions?.canDelete) && (
                <button
                  onClick={() => closeActionMenu(() => setDeletingSale(currentMenuSale))}
                  className="w-full text-left px-4 py-3.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 flex items-center gap-3 transition-colors"
                >
                  <span className="text-red-500 dark:text-red-400"><Trash2 size={18} /></span>
                  <span>Удалить договор</span>
                </button>
              )}
            </div>

            <div className="px-4 pb-4 pt-2">
              <button
                onClick={() => closeActionMenu()}
                className="w-full py-3 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-medium text-sm hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div
          className="fixed z-[9999] bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-64 overflow-hidden animate-scale-in border border-slate-100 dark:border-slate-700 max-h-[85vh] overflow-y-auto"
          style={{ top: `${menuPosition?.top ?? 0}px`, left: `${menuPosition?.left ?? 0}px` }}
          onClick={e => e.stopPropagation()}
        >
          <div className="px-4 py-3 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700">
            <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{customer?.name}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{currentMenuSale.productName}</p>
          </div>

          <div className="py-2">
            <button
              onClick={() => { setSelectedSaleForInfo(currentMenuSale); setActiveMenuId(null); setCurrentMenuSale(null); setMenuPosition(null); }}
              className="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 flex items-center gap-3 transition-colors"
            >
              <span className="text-blue-500 dark:text-blue-400"><FileText size={16}/></span>
              <span>Информация</span>
            </button>

            <button
              onClick={() => { onViewSchedule(currentMenuSale); setActiveMenuId(null); setCurrentMenuSale(null); setMenuPosition(null); }}
              className="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 flex items-center gap-3 transition-colors"
            >
              <span className="text-indigo-500 dark:text-indigo-400"><Calendar size={16}/></span>
              <span>График</span>
            </button>

   {(!isEmployee || user?.permissions?.canEdit) && (
    <button
        onClick={() => { onEditSale(currentMenuSale); setActiveMenuId(null); setCurrentMenuSale(null); setMenuPosition(null); }}
        className="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-3 transition-colors"
    >
        <span className="text-slate-500 dark:text-slate-400"><Edit3 size={16}/></span>
        <span>Редактировать</span>
    </button>
)}

<button
    onClick={() => { printContract(currentMenuSale); setActiveMenuId(null); setCurrentMenuSale(null); setMenuPosition(null); }}
    className="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-3 transition-colors"
>
    <span className="text-slate-500 dark:text-slate-400"><Printer size={16}/></span>
    <span>Печать</span>
</button>
</div>

<div className="border-t border-slate-100 dark:border-slate-700 py-2">
    {/* 🔥 Удалить - скрываем если нет прав canDelete */}
    {(!isEmployee || user?.permissions?.canDelete) && (
        <button
            onClick={() => { setDeletingSale(currentMenuSale); setActiveMenuId(null); setCurrentMenuSale(null); setMenuPosition(null); }}
            className="w-full text-left px-4 py-3 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 flex items-center gap-3 transition-colors"
        >
            <span className="text-red-500 dark:text-red-400"><Trash2 size={16}/></span>
            <span>Удалить</span>
        </button>
    )}
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
    <div className="space-y-4 pb-20 w-full max-w-5xl mx-auto px-3 sm:px-4" onClick={() => { setActiveMenuId(null); setCurrentMenuSale(null); setMenuPosition(null); }}>

      {/* Заголовок вкладки */}
      {activeTab !== 'OVERDUE' ? (
        <div className="flex justify-between items-center py-2">
          <div>
            <h2 className="text-2xl font-bold text-slate-800 dark:text-white">{getTabTitle()}</h2>
            <p className="text-slate-400 dark:text-slate-500 text-xs mt-0.5">Найдено: {filteredList.length}</p>
          </div>
        </div>
      ) : (
        <div className="bg-gradient-to-br from-red-50 to-orange-50 dark:from-red-900/30 dark:to-orange-900/30 border border-red-200 dark:border-red-900/50 p-4 rounded-2xl mb-3">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">Просроченные договоры</h2>
              <p className="text-slate-500 dark:text-slate-400 text-xs">Всего: {filteredList.length}</p>
            </div>
            {!readOnly && (
              <div className="flex items-center gap-2">
                {/* 🔔 КНОПКА "НАПОМНИТЬ ВСЕМ" */}
                <button
                    onClick={() => { setRiskAcknowledged(false); setShowConfirmRemindAll(true); }}
                    disabled={filteredList.length === 0 || isSendingAll}
                    className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm"
                >
                  {isSendingAll ? (
                      <>
                        <span
                            className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                        {sentStats ? `${sentStats.sent}/${sentStats.total}` : 'Отправка...'}
                      </>
                  ) : (
                      <>
                        <Phone size={14} className="rotate-90"/>
                        Напомнить всем
                      </>
                  )}
                </button>

              </div>
            )}

          </div>
          <div className="mt-3 pt-3 border-t border-red-200 dark:border-red-900/50">
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Общая просрочка</p>
            <p className="text-2xl font-bold text-red-600 dark:text-red-400">{formatCurrency(totalOverdueSum, appSettings?.showCents)} ₽</p>
          </div>
        </div>
      )}

      {/* Фильтры */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-slate-400 dark:text-slate-500" size={16}/>
            <input
                type="text"
                placeholder="Поиск по имени или товару..."
                className="w-full pl-9 pr-3 py-2 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200 outline-none transition-all"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="relative">
            <Wallet className="absolute left-3 top-2.5 text-slate-400 dark:text-slate-500" size={16} />
            <select
              className="w-full pl-9 pr-3 py-2 border border-slate-200 dark:border-slate-600 rounded-xl text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200 outline-none transition-all appearance-none bg-white dark:bg-slate-900 dark:text-white"
              value={filterAccountId}
              onChange={e => setFilterAccountId(e.target.value)}
            >
              <option value="">Все счета / Инвесторы</option>
              {accounts.filter(acc => !acc.isArchived || acc.id === filterAccountId)
                       .map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
            </select>
          </div>
        </div>

        {/* Фильтр по сотруднику — инструмент менеджера: сам сотрудник и инвестор его не видят */}
        {employees.length > 0 && !isEmployee && !readOnly && (
          <div className="relative">
            <UserIcon className="absolute left-3 top-2.5 text-slate-400 dark:text-slate-500" size={16} />
            <select
              className="w-full pl-9 pr-3 py-2 border border-slate-200 dark:border-slate-600 rounded-xl text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200 outline-none transition-all appearance-none bg-white dark:bg-slate-900 dark:text-white"
              value={filterEmployeeId}
              onChange={e => setFilterEmployeeId(e.target.value)}
            >
              <option value="">Все сотрудники</option>
              {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
          </div>
        )}
      </div>

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
                  <p className="font-semibold text-slate-800 dark:text-white text-sm truncate" title={customer?.name}>
                    {customer?.name || 'Неизвестно'}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5" title={sale.productName}>
                    {sale.productName}
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                    {formatDate(sale.startDate)} • {sale.installments} мес.
                  </p>
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

      {/* Модалка удаления */}
      {deletingSale && !readOnly && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={() => setDeletingSale(null)}>
          <div className="bg-white dark:bg-slate-800 w-full max-w-sm p-6 rounded-3xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="w-14 h-14 bg-red-500 text-white rounded-2xl flex items-center justify-center mx-auto mb-4"><Trash2 size={28} /></div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white text-center mb-1.5">Удалить договор?</h3>
            <p className="text-center text-slate-500 dark:text-slate-400 mb-6 text-sm">Все данные о платежах будут удалены. Товар вернётся на склад.</p>
            <div className="flex gap-2.5">
              <button onClick={() => setDeletingSale(null)} className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-700 rounded-xl font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-all">Отмена</button>
              <button onClick={handleDeleteConfirm} className="flex-1 py-2.5 bg-red-500 text-white rounded-xl font-bold hover:bg-red-600 transition-all">Удалить</button>
            </div>
          </div>
        </div>
      )}


      {showConfirmRemindAll && createPortal(
  <div
    className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-fade-in"
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
          appSettings={appSettings}
          activeTab={activeTab}
          readOnly={readOnly}
        />
      )}
    </div>
  );
};

export default Contracts;