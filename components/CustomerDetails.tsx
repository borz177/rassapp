import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import SaleActionsMenu from './SaleActionsMenu';
import {Customer, Sale, Payment, Account, Investor, AppSettings, CustomerDocument, User, Supplier, Task, RetailSale} from '../types';
import { ICONS } from '../constants';
import TopBarBack from './TopBarBack';
import EditCustomerSheet from './EditCustomerSheet';
import CustomerDocumentsSheet from './CustomerDocumentsSheet';
import SubPage from './transitions/SubPage';
import { formatCurrency, formatDate, normalizePhoneForWhatsApp, retailPaidAmount, retailRemaining } from '../src/utils';
import { offlineStorage } from '../services/offlineStorage';
import { api, API_URL } from '../services/api';

interface CustomerDetailsProps {
  customer: Customer;
  sales: Sale[];
  accounts: Account[];
  investors: Investor[];
  appSettings: AppSettings;
  onBack: () => void;
  onInitiatePayment: (sale: Sale, payment: Payment) => void;
  onUndoPayment?: (saleId: string, paymentId: string) => void;
  onEditPayment?: (saleId: string, paymentId: string, newDate: string) => void;
  onUpdateCustomer?: (customer: Customer) => void;
  initialSaleId?: string | null;
  onDeleteCustomer?: (customerId: string) => void;
  user?: User | null;
  suppliers?: Supplier[];
  onPaySupplier?: (sale: Sale) => void;
  onCreateTask?: (draft: Partial<Task>) => void;
  /** Удаление договора из карточки клиента. Без него пункта в меню нет. */
  onDeleteSale?: (saleId: string) => void | Promise<void>;
  /** Вторая печатная форма доступна со «Стандарта» */
  contractTemplatesAllowed?: boolean;
  /** Покупки клиента в магазине. Пусто, когда магазин выключен. */
  retailSales?: RetailSale[];
  /** Открывает «Приход» с подставленным долгом магазина */
  onInitiateRetailPayment?: (sale: RetailSale) => void;
}


// 🔹 НОВОЕ: Модальное окно для управления документами

const CustomerDetails: React.FC<CustomerDetailsProps> = ({
    customer, sales, accounts, investors, appSettings, onBack,
    onInitiatePayment, onUndoPayment, onEditPayment, onUpdateCustomer,
    initialSaleId, onDeleteCustomer, user, suppliers, onPaySupplier, onCreateTask,
    onDeleteSale, contractTemplatesAllowed,
    retailSales = [], onInitiateRetailPayment
}) => {
    const supplierList: Supplier[] = suppliers || [];
    const isEmployee = user?.role === 'employee';
    const [activeTab, setActiveTab] = useState<'INFO' | 'INSTALLMENTS' | 'HISTORY'>('INFO');
    const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showDocumentsModal, setShowDocumentsModal] = useState(false);
    const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
    const [editDate, setEditDate] = useState('');
    const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [showBlockedDeleteModal, setShowBlockedDeleteModal] = useState(false);
    const [showActionsMenu, setShowActionsMenu] = useState(false);

    const formatFileSize = (bytes: number): string => {
        if (bytes === 0) return '0 Б';
        const k = 1024;
        const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    useEffect(() => {
        if (initialSaleId) {
            setSelectedSaleId(initialSaleId);
            setActiveTab('INSTALLMENTS');
        }
    }, [initialSaleId]);

    useEffect(() => {
        setShowActionsMenu(false);
    }, [activeTab]);


    const customerSales = Array.isArray(sales) ? sales.filter(s => s.customerId === customer.id) : [];

    // Покупки в магазине и деньги по ним. Считаем по самим чекам: цена
    // зафиксирована в момент продажи, и пересчёт по нынешним ценам переписывал
    // бы прошлое после каждой переоценки.
    const customerRetail = useMemo(
        () => retailSales
            .filter(r => r.customerId === customer.id && !r.isCancelled)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        [retailSales, customer.id]
    );

    const retailTotals = useMemo(() => ({
        bought: customerRetail.reduce((sum, r) => sum + r.total, 0),
        received: customerRetail.reduce((sum, r) => sum + (r.isCredit ? retailPaidAmount(r) : r.total), 0),
        debt: customerRetail.reduce((sum, r) => sum + retailRemaining(r), 0),
    }), [customerRetail]);

    // Единая лента: покупка и полученные по ней деньги — события одной истории,
    // и разложенные по двум спискам они перестают отвечать на вопрос «а что
    // между ними произошло».
    const retailTimeline = useMemo(() => {
        const events: {
            key: string; kind: 'BUY' | 'PAY'; date: string; amount: number;
            title: string; subtitle?: string; sale: RetailSale;
        }[] = [];
        customerRetail.forEach(r => {
            events.push({
                key: `buy_${r.id}`, kind: 'BUY', date: r.date, amount: r.total, sale: r,
                title: r.items.map(i => `${i.name}${i.quantity > 1 ? ` × ${i.quantity}` : ''}`).join(', ') || 'Покупка',
                subtitle: [r.docNumber ? `Чек №${r.docNumber}` : null, r.isCredit ? 'в долг' : 'оплачено'].filter(Boolean).join(' · '),
            });
            (r.payments || []).forEach(pm => {
                events.push({
                    key: `pay_${pm.id}`, kind: 'PAY', date: pm.date, amount: pm.amount, sale: r,
                    title: 'Оплата',
                    subtitle: [r.docNumber ? `по чеку №${r.docNumber}` : null, pm.note].filter(Boolean).join(' · '),
                });
            });
        });
        return events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [customerRetail]);

    // Вкладку показываем только когда за ней что-то есть: пустая «Рассрочка» у
    // розничного покупателя — обещание раздела, которого нет.
    const showInstallmentsTab = customerSales.length > 0;
    const showHistoryTab = customerRetail.length > 0;


    // Последняя рассрочка может быть удалена, пока вкладка открыта — оставить
    // пользователя на исчезнувшем разделе нельзя.
    useEffect(() => {
        if (activeTab === 'INSTALLMENTS' && !showInstallmentsTab) setActiveTab('INFO');
        if (activeTab === 'HISTORY' && !showHistoryTab) setActiveTab('INFO');
    }, [activeTab, showInstallmentsTab, showHistoryTab]);
    const selectedSale = customerSales.find(s => s.id === selectedSaleId);

    const handleEditClick = (payment: Payment) => {
        setEditingPayment(payment);
        setEditDate(payment.date ? new Date(payment.date).toISOString().split('T')[0] : '');
    };

    const saveEdit = () => {
        if (selectedSale && editingPayment && editDate && onEditPayment) {
            onEditPayment(selectedSale.id, editingPayment.id, editDate);
            setEditingPayment(null);
        }
    };

    const handleDeleteClick = (paymentId: string) => {
        setDeletingPaymentId(paymentId);
    };

    const confirmDelete = () => {
        if (selectedSale && deletingPaymentId && onUndoPayment) {
            onUndoPayment(selectedSale.id, deletingPaymentId);
            setDeletingPaymentId(null);
        }
    };

    const formatPaymentHistory = (
        payments: Array<{
            id?: string;
            date: string | Date;
            amount: number;
            isPaid?: boolean;
            isRealPayment?: boolean;
            discountAmount?: number;
        }>,
        limit: number = 5
    ): string => {
        const paidPayments = payments
            .filter(p => p.isPaid && p.isRealPayment !== false)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        if (paidPayments.length === 0) return '';

        let history = `\n📜 *История платежей:*\n`;
        paidPayments.forEach(p => {
            const dateString = typeof p.date === 'string' ? p.date : p.date.toISOString();
            history += `   • ${formatDate(dateString)} — *${formatCurrency(p.amount, appSettings.showCents)} ₽* ✅`;
            if (p.discountAmount && p.discountAmount > 0) {
                history += ` (🎁 скидка ${formatCurrency(p.discountAmount, appSettings.showCents)} ₽)`;
            }
            history += `\n`;
        });
        return history;
    };

    const handleDeleteRequest = () => {
        if (customerSales.length > 0) {
            alert('⛔ Невозможно удалить клиента! У него есть привязанные договоры.');
            return;
        }
        setShowDeleteModal(true);
    };

    const confirmDeleteCustomer = () => {
        if (onDeleteCustomer) {
            onDeleteCustomer(customer.id);
            onBack();
        }
    };

    // Собирает ссылку на WhatsApp. Номер нормализуется общим помощником из src/utils.ts:
    // здесь была своя копия, которая вызывала parsePhoneNumberFromString без страны
    // по умолчанию и на номерах вида 89001234567 возвращала null — он подставлялся
    // в адрес, и WhatsApp открывался с «Имя пользователя null не зарегистрировано».
    const openWhatsApp = (text: string): void => {
        const phone = normalizePhoneForWhatsApp(customer.phone);
        if (!phone) {
            alert(`У клиента «${customer.name}» не указан корректный номер телефона — отправить сообщение в WhatsApp не получится.`);
            return;
        }
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
    };

    // 🔥 ИСПРАВЛЕНИЕ: теперь ближайший платеж берётся из paymentSchedule,
    // который уже учитывает авансовые оплаты (surplus от переплат и скидок)
    const handleSendSaleReminder = () => {
        if (!selectedSale) return;

        const paymentHistory = formatPaymentHistory(selectedSale.paymentPlan || [], 5);
        const isClosed = selectedSale.status === 'COMPLETED' || selectedSale.remainingAmount <= 0;

        // 🔹 Ближайший платёж — первый из графика, который уже рассчитан с учётом surplus
        const nextPayment = paymentSchedule[0];

        let message = `
${customer.name}!

Информация по договору на "${selectedSale.productName}".

*Детали:*
- *Общая сумма:* ${formatCurrency(selectedSale.totalAmount, appSettings.showCents)} ₽
- *Статус:* ${isClosed ? '✅ Закрыт' : '⏳ Активен'}
- *Остаток долга:* *${formatCurrency(selectedSale.remainingAmount, appSettings.showCents)} ₽*`;

        if (totalDiscounts > 0) {
            message += `\n- *Предоставлено скидок:* ${formatCurrency(totalDiscounts, appSettings.showCents)} ₽`;
        }

        if (!isClosed && nextPayment) {
            message += `\n- *Ближайший платеж:* ${formatCurrency(nextPayment.amountToPay, appSettings.showCents)} ₽ до ${formatDate(nextPayment.date)}`;
        }

        message += paymentHistory;

        openWhatsApp(message.trim().replace(/^\s+/gm, ''));
    };

    const handleSendFullReport = () => {
        let report = `${customer.name}!\n\nВаш полный отчет по всем рассрочкам!\n\n`;

        customerSales.forEach((sale, index) => {
            const totalDiscounts = sale.paymentPlan
                .filter(p => (p as any).discountAmount > 0)
                .reduce((sum, p) => sum + ((p as any).discountAmount || 0), 0);

            const isClosed = sale.status === 'COMPLETED' || sale.remainingAmount <= 0;

            report += `*Рассрочка №${index + 1}: ${sale.productName}*\n`;
            report += ` - Статус: ${isClosed ? '✅ Закрыто' : '⏳ Активно'}\n`;
            report += ` - Остаток долга: *${formatCurrency(sale.remainingAmount, appSettings.showCents)} ₽*\n`;
            
            if (totalDiscounts > 0) {
                report += ` - 🎁 Скидки: ${formatCurrency(totalDiscounts, appSettings.showCents)} ₽\n`;
            }

            const paymentHistory = formatPaymentHistory(sale.paymentPlan || [], 3);
            if (paymentHistory) {
                report += paymentHistory;
            }
            report += `\n`;
        });

        if (customerSales.length > 1) {
            const totalDebt = customerSales.reduce((sum, s) => sum + s.remainingAmount, 0);
            const totalDiscountsAll = customerSales.reduce((sum, s) => {
                return sum + s.paymentPlan
                    .filter(p => (p as any).discountAmount > 0)
                    .reduce((s2, p) => s2 + ((p as any).discountAmount || 0), 0);
            }, 0);

            report += `━━━━━━━━━━━━━━━━━\n`;
            report += `📊 *ОБЩИЙ ИТОГ:*\n`;
            report += `• Общий долг: *${formatCurrency(totalDebt, appSettings.showCents)} ₽*\n`;
            if (totalDiscountsAll > 0) {
                report += `• 🎁 Всего скидок: *${formatCurrency(totalDiscountsAll, appSettings.showCents)} ₽*\n`;
            }
        }

        openWhatsApp(report);
    };

    // 🔥 ИСПРАВЛЕННЫЙ useMemo с учётом скидок и статуса договора
    const { paidPayments, paymentSchedule, totalDiscounts, totalRealPaid } = useMemo(() => {
        if (!selectedSale || !selectedSale.paymentPlan) {
            return { paidPayments: [], paymentSchedule: [], totalDiscounts: 0, totalRealPaid: 0 };
        }

        const paidPayments = selectedSale.paymentPlan
            .filter(p => p.isPaid && p.isRealPayment !== false)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        const totalDiscounts = selectedSale.paymentPlan
            .filter(p => (p as any).discountAmount > 0)
            .reduce((sum, p) => sum + ((p as any).discountAmount || 0), 0);

        // 🔒 Тот же фильтр, что и у paidPayments (isPaid && isRealPayment !== false) — раньше здесь
        // была строгая проверка isRealPayment === true, из-за чего "Оплачено клиентом" не учитывала
        // платежи графика, помеченные оплаченными без явного isRealPayment (например, при импорте
        // Excel), хотя remainingAmount (см. NewSale.tsx preservedPaymentsInfo) их уже учитывает —
        // из-за этого расхождения "Остаток долга" + "Оплачено клиентом" не сходилось с общей суммой.
        const totalRealPaid = selectedSale.paymentPlan
            .filter(p => p.isPaid && p.isRealPayment !== false)
            .reduce((sum, p) => sum + p.amount, 0);

        const isClosed = selectedSale.status === 'COMPLETED' || selectedSale.remainingAmount <= 0;
        
        if (isClosed) {
            return { paidPayments, paymentSchedule: [], totalDiscounts, totalRealPaid };
        }

        const totalAllocated = selectedSale.paymentPlan
            .filter(p => p.isPaid && p.isRealPayment !== true)
            .reduce((sum, p) => sum + p.amount, 0);

        let surplus = Math.max(0, totalRealPaid - totalAllocated);

        const scheduled = selectedSale.paymentPlan
            .filter(p => !p.isPaid && p.isRealPayment !== true)
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        // 🔒 Порог отсечения — 1 ₽ от НЕокруглённого остатка, а не «больше копейки» от
        // округлённого. Суммы платежей — это доли вроде 91 000 / 3 = 30 333,33, поэтому при
        // приёме округлённых рублей на каждом платеже копится остаток в копейки. Раньше он
        // проходил фильтр и после второго-третьего платежа вылезал строкой «1 ₽» по месяцу,
        // который пользователь только что оплатил ровно той суммой, что показывал график.
        // Такой остаток — артефакт округления, а не долг (на проде так висело 20 договоров).
        const scheduleForDisplay = scheduled
            .map(p => {
                const amountDue = p.amount;
                const covered = Math.min(amountDue, surplus);
                surplus = Math.max(0, surplus - covered);
                return { payment: p, amountToPay: amountDue - covered };
            })
            .filter(x => x.amountToPay >= 1)
            .map(({ payment, amountToPay }) => ({
                ...payment,
                amountToPay: appSettings.showCents !== false ? amountToPay : Math.round(amountToPay),
            }));

        return { paidPayments, paymentSchedule: scheduleForDisplay, totalDiscounts, totalRealPaid };
    }, [selectedSale, appSettings.showCents]);

    const getInvestorInfo = (sale: Sale) => {
        if (!accounts || !investors) return null;
        const account = accounts.find(a => a.id === sale.accountId);
        if (account?.ownerId) {
            const investor = investors.find(i => i.id === account.ownerId);
            return investor ? investor.name : null;
        }
        return null;
    };

    /**
     * Карточка договора. Не ранний return: список должен остаться смонтированным
     * под ней — иначе выезжать не из-за чего, а при возврате он перерисовывался
     * бы заново и терял позицию прокрутки.
     */
    const renderSale = (selectedSale: Sale, close: () => void) => {
        const paidAmount = totalRealPaid + totalDiscounts;
        const profit = selectedSale.buyPrice > 0 ? selectedSale.totalAmount - selectedSale.buyPrice : 0;
        const monthlyProfit = selectedSale.installments > 0 && profit > 0 ? profit / selectedSale.installments : 0;
        const firstPaymentDate = (selectedSale.paymentPlan && selectedSale.paymentPlan.length > 0) ? selectedSale.paymentPlan[0].date : null;
        const isClosed = selectedSale.status === 'COMPLETED' || selectedSale.remainingAmount <= 0;

        return (
            <div className="space-y-4 animate-fade-in pb-20 relative">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-4 pt-2">
                    <div className="flex items-center gap-3">
                        <TopBarBack onClick={close} />
                        <h2 className="text-xl font-bold text-slate-800 dark:text-white truncate">{selectedSale.productName}</h2>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        <button onClick={handleSendSaleReminder} className="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-3 py-2 rounded-lg font-semibold text-sm flex items-center gap-2">
                            {ICONS.Send} WhatsApp
                        </button>
                        {/* Из поиска договор открывается сразу этой страницей — печать и
                            удаление должны быть здесь, а не только в списке рассрочек. */}
                        <SaleActionsMenu
                            sale={selectedSale}
                            sales={sales}
                            customer={customer}
                            appSettings={appSettings}
                            user={user}
                            contractTemplatesAllowed={contractTemplatesAllowed}
                            onDeleteSale={onDeleteSale && (async (saleId: string) => {
                                await onDeleteSale(saleId);
                                // Договора больше нет — страницу оставлять нельзя.
                                setSelectedSaleId(null);
                            })}
                        />
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm border border-slate-100 dark:border-slate-700 space-y-3">
                    {firstPaymentDate && (
                        <div className="flex justify-between border-b border-slate-50 dark:border-slate-700 pb-2">
                            <span className="text-slate-500 dark:text-slate-400">Первый платеж</span>
                            <span className="font-medium text-slate-800 dark:text-white">{formatDate(firstPaymentDate)}</span>
                        </div>
                    )}
                    <div className="flex justify-between border-b border-slate-50 dark:border-slate-700 pb-2">
                        <span className="text-slate-500 dark:text-slate-400">Цена закупа</span>
                        <span className="font-medium text-slate-800 dark:text-white">{formatCurrency(selectedSale.buyPrice, appSettings.showCents)} ₽</span>
                    </div>
                    {selectedSale.supplierId && (
                        <div className="border-b border-slate-50 dark:border-slate-700 pb-2 space-y-2">
                            <div className="flex justify-between">
                                <span className="text-slate-500 dark:text-slate-400">Поставщик</span>
                                <span className="font-medium text-slate-800 dark:text-white">{supplierList.find(s => s.id === selectedSale.supplierId)?.name || '—'}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-500 dark:text-slate-400">Долг поставщику</span>
                                {/* Отдали больше закупа — показываем переплату, а не «Оплачено»:
                                    это деньги вперёд, они зачтутся в следующие поставки. */}
                                <span className={`font-medium ${selectedSale.isPartnerDebtPaid ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                    {(selectedSale.partnerDebtPaidAmount || 0) > (selectedSale.buyPrice || 0)
                                        ? `Переплата +${formatCurrency((selectedSale.partnerDebtPaidAmount || 0) - (selectedSale.buyPrice || 0), appSettings.showCents)} ₽`
                                        : selectedSale.isPartnerDebtPaid
                                            ? 'Оплачено'
                                            : `${formatCurrency(selectedSale.buyPrice - (selectedSale.partnerDebtPaidAmount || 0), appSettings.showCents)} ₽`}
                                </span>
                            </div>
                            {!selectedSale.isPartnerDebtPaid && onPaySupplier && (
                                <button
                                    onClick={() => onPaySupplier(selectedSale)}
                                    className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-bold"
                                >
                                    Оплатить поставщику
                                </button>
                            )}
                        </div>
                    )}
                    <div className="flex justify-between border-b border-slate-50 dark:border-slate-700 pb-2">
                        <span className="text-slate-500 dark:text-slate-400">Цена в рассрочку</span>
                        <span className="font-medium text-slate-800 dark:text-white">{formatCurrency(selectedSale.totalAmount, appSettings.showCents)} ₽</span>
                    </div>
                    {selectedSale.downPayment > 0 && (
                        <div className="flex justify-between border-b border-slate-50 dark:border-slate-700 pb-2">
                            <span className="text-slate-500 dark:text-slate-400">Первый взнос</span>
                            <span className="font-bold text-slate-800 dark:text-white">{formatCurrency(selectedSale.downPayment, appSettings.showCents)} ₽</span>
                        </div>
                    )}
                    {selectedSale.installments > 0 && (
                        <div className="flex justify-between border-b border-slate-50 dark:border-slate-700 pb-2">
                            <span className="text-slate-500 dark:text-slate-400">Ежемесячный платеж</span>
                            <span className="font-bold text-indigo-600 dark:text-indigo-400">
                                {formatCurrency(Math.round((selectedSale.totalAmount - selectedSale.downPayment) / selectedSale.installments), appSettings.showCents)} ₽
                            </span>
                        </div>
                    )}

                    <div className="flex justify-between border-b border-slate-50 dark:border-slate-700 pb-2">
                        <span className="text-slate-500 dark:text-slate-400">Остаток долга</span>
                        <span className={`font-bold ${isClosed ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                            {isClosed ? '0 ₽' : `${formatCurrency(selectedSale.remainingAmount, appSettings.showCents)} ₽`}
                        </span>
                    </div>

                    <div className="flex justify-between border-b border-slate-50 dark:border-slate-700 pb-2">
                        <span className="text-slate-500 dark:text-slate-400">Оплачено клиентом</span>
                        <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(totalRealPaid, appSettings.showCents)} ₽</span>
                    </div>
                    
                    {totalDiscounts > 0 && (
                        <div className="flex justify-between border-b border-slate-50 dark:border-slate-700 pb-2 bg-amber-50/50 dark:bg-amber-900/20 -mx-5 px-5 py-2">
                            <span className="text-amber-800 dark:text-amber-300 font-medium flex items-center gap-1">
                                🎁 Предоставлено скидок
                            </span>
                            <span className="font-bold text-amber-700 dark:text-amber-400">−{formatCurrency(totalDiscounts, appSettings.showCents)} ₽</span>
                        </div>
                    )}

                    {selectedSale.guarantorName && (
                        <>
                            <div className="flex justify-between border-b border-slate-50 dark:border-slate-700 pb-2 pt-2">
                                <span className="text-slate-500 dark:text-slate-400">Поручитель</span>
                                <span className="font-medium text-slate-800 dark:text-white">{selectedSale.guarantorName}</span>
                            </div>
                            {selectedSale.guarantorPhone && (
                                <div className="flex justify-between border-b border-slate-50 dark:border-slate-700 pb-2">
                                    <span className="text-slate-500 dark:text-slate-400">Телефон поручителя</span>
                                    <span className="font-medium text-slate-800 dark:text-white">{selectedSale.guarantorPhone}</span>
                                </div>
                            )}
                        </>
                    )}
                    <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-700 grid grid-cols-2 gap-4">
                        <div className="bg-emerald-50 dark:bg-emerald-900/30 p-3 rounded-xl">
                            <p className="text-xs text-emerald-600 dark:text-emerald-400 mb-1">Прибыль (Общ)</p>
                            <p className="font-bold text-emerald-800 dark:text-emerald-300">{formatCurrency(profit, appSettings.showCents)} ₽</p>
                        </div>
                        <div className="bg-blue-50 dark:bg-blue-900/30 p-3 rounded-xl">
                            <p className="text-xs text-blue-600 dark:text-blue-400 mb-1">Прибыль / мес</p>
                            <p className="font-bold text-blue-800 dark:text-blue-300">~{formatCurrency(Math.round(monthlyProfit), appSettings.showCents)} ₽</p>
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
                    <div className="p-4 border-b border-slate-100 dark:border-slate-700 bg-emerald-50/50 dark:bg-emerald-900/20 flex justify-between items-center">
                        <h3 className="font-bold text-emerald-800 dark:text-emerald-300">История поступлений</h3>
                        <span className="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 text-xs px-2 py-1 rounded-full font-bold">{paidPayments.length}</span>
                    </div>
                    {paidPayments.length === 0 ? <div className="p-6 text-center text-slate-400 dark:text-slate-500 text-sm">Нет поступлений</div> : (
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-700/50">
                                <tr>
                                    <th className="px-4 py-3">Дата</th>
                                    <th className="px-4 py-3">Сумма</th>
                                    <th className="px-4 py-3 text-right">Действия</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paidPayments.map((payment) => {
                                    return (
                                        <tr key={payment.id} className="border-b border-slate-50 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                            <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{formatDate(payment.date)}</td>
                                            <td className="px-4 py-3">
                                                <div className="font-bold text-emerald-600 dark:text-emerald-400">
                                                    +{formatCurrency(payment.amount, appSettings.showCents)} ₽
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex justify-end gap-2">
                                                    {(!isEmployee || user?.permissions?.canEdit) && (
                                                        <button onClick={() => handleEditClick(payment)} className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded">
                                                            {ICONS.Edit}
                                                        </button>
                                                    )}
                                                    {(!isEmployee || user?.permissions?.canDelete) && (
                                                        <button onClick={() => handleDeleteClick(payment.id)} className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded">
                                                            {ICONS.Delete}
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
                    <div className="p-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50">
                        <h3 className="font-bold text-slate-700 dark:text-slate-300">График платежей</h3>
                    </div>
                    {paymentSchedule.length === 0 ? (
                        <div className="p-6 text-center text-slate-400 dark:text-slate-500 text-sm">
                            {isClosed ? '✅ Договор полностью закрыт! 🎉' : 'Все оплачено! 🎉'}
                        </div>
                    ) : (
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-700/50">
                                <tr>
                                    <th className="px-4 py-3">Дата</th>
                                    <th className="px-4 py-3">Осталось</th>
                                    <th className="px-4 py-3">Действие</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paymentSchedule.map((payment) => (
                                    <tr key={payment.id} className="border-b border-slate-50 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                        <td className={`px-4 py-3 ${new Date(payment.date) < new Date() ? 'text-red-500 dark:text-red-400 font-bold' : 'text-slate-700 dark:text-slate-300'}`}>
                                            {formatDate(payment.date)}
                                        </td>
                                        <td className="px-4 py-3 font-bold text-slate-800 dark:text-white">
                                            {formatCurrency(payment.amountToPay, appSettings.showCents)} ₽
                                        </td>
                                        <td className="px-4 py-3">
                                            <button
                                                onClick={() => {
                                                    const roundedAmount = appSettings.showCents !== false
                                                        ? payment.amountToPay
                                                        : Math.round(payment.amountToPay);
                                                    onInitiatePayment(selectedSale, {...payment, amount: roundedAmount});
                                                }}
                                                className="text-indigo-600 dark:text-indigo-400 font-bold text-xs border border-indigo-200 dark:border-indigo-800 px-3 py-1.5 rounded-lg hover:bg-indigo-600 hover:text-white transition-colors"
                                            >
                                                Принять
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {editingPayment && createPortal(
                    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
                        <div className="bg-white dark:bg-slate-800 w-full max-w-sm p-6 rounded-2xl shadow-xl">
                            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4">Изменить дату платежа</h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Сумма: {formatCurrency(editingPayment.amount, appSettings.showCents)} ₽</p>
                            <input type="date" className="w-full p-3 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl mb-6 outline-none" value={editDate} onChange={(e) => setEditDate(e.target.value)}/>
                            <div className="flex gap-3">
                                <button onClick={() => setEditingPayment(null)} className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 rounded-xl font-medium text-slate-600 dark:text-slate-300">Отмена</button>
                                <button onClick={saveEdit} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold">Сохранить</button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
                {deletingPaymentId && createPortal(
                    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
                        <div className="bg-white dark:bg-slate-800 w-full max-w-sm p-6 rounded-2xl shadow-xl">
                            <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto mb-4">{ICONS.Delete}</div>
                            <h3 className="text-lg font-bold text-slate-800 dark:text-white text-center mb-2">Отменить платеж?</h3>
                            <p className="text-center text-slate-500 dark:text-slate-400 mb-6 text-sm">Сумма вернется в долг, а статус платежа изменится на "Не оплачено".</p>
                            <div className="flex gap-3">
                                <button onClick={() => setDeletingPaymentId(null)} className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 rounded-xl font-medium text-slate-600 dark:text-slate-300">Нет</button>
                                <button onClick={confirmDelete} className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold">Да, отменить</button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
            </div>
        );
    };

    return (
        <>
        <div className="space-y-4 animate-fade-in pb-20">
            <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-700 pb-4 pt-2">
                <TopBarBack onClick={onBack} />
                <h2 className="flex-1 text-xl font-bold text-slate-800 dark:text-white truncate">{customer.name}</h2>
                {onCreateTask && (
                    <button
                        onClick={() => onCreateTask({
                            title: `Связаться — ${customer.name}`,
                            note: customer.phone ? `Телефон: ${customer.phone}` : undefined,
                            customerId: customer.id,
                            customerName: customer.name,
                        })}
                        className="shrink-0 flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-3 py-2 rounded-lg font-semibold text-sm hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
                        title="Создать задачу по клиенту"
                    >
                        {ICONS.Tasks}
                        <span className="hidden sm:inline">Задача</span>
                    </button>
                )}
            </div>
            {(showInstallmentsTab || showHistoryTab) && (
            <div className="flex border-b border-slate-200 dark:border-slate-700">
                <button onClick={() => setActiveTab('INFO')} className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'INFO' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 dark:text-slate-400'}`}>Информация</button>
                {showInstallmentsTab && (
                <button onClick={() => setActiveTab('INSTALLMENTS')} className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'INSTALLMENTS' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 dark:text-slate-400'}`}>Рассрочки</button>
                )}
                {showHistoryTab && (
                <button onClick={() => setActiveTab('HISTORY')} className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'HISTORY' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 dark:text-slate-400'}`}>История</button>
                )}
            </div>
            )}
            {activeTab === 'INFO' && (
                <div className="space-y-4 pt-2">
                    <div className="flex justify-center">
                        <div className="w-32 h-32 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden border-4 border-white dark:border-slate-800 shadow-lg">
                            {customer.photo ?
                                <img src={customer.photo} alt={customer.name} className="w-full h-full object-cover"/> :
                                <div className="w-full h-full flex items-center justify-center text-slate-400 text-4xl font-bold">{customer.name.charAt(0)}</div>
                            }
                        </div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-5 shadow-sm border border-slate-100 dark:border-slate-700 space-y-4 relative">
                        {(onUpdateCustomer || onDeleteCustomer) && (
                            <div className="absolute top-4 right-4 z-20">
                                <button onClick={(e) => {
                                    e.stopPropagation();
                                    setShowActionsMenu(!showActionsMenu);
                                }} className="p-2 bg-slate-50 dark:bg-slate-700 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors" title="Действия">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                        <circle cx="12" cy="6" r="2"/>
                                        <circle cx="12" cy="12" r="2"/>
                                        <circle cx="12" cy="18" r="2"/>
                                    </svg>
                                </button>
                                {showActionsMenu && (
                                    <>
                                        <div className="fixed inset-0 z-10" onClick={() => setShowActionsMenu(false)}/>
                                        <div className="absolute right-0 mt-2 w-52 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-100 dark:border-slate-700 py-1 z-20 animate-fade-in">
                                            {onUpdateCustomer && (!isEmployee || user?.permissions?.canEdit) && (
                                                <button onClick={() => {
                                                    setShowActionsMenu(false);
                                                    setShowEditModal(true);
                                                }} className="w-full px-4 py-2.5 text-left text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2">
                                                    <span className="text-indigo-600 dark:text-indigo-400">{ICONS.Edit}</span> Редактировать
                                                </button>
                                            )}
                                            {/* 🔹 НОВОЕ: пункт "Документы" в меню действий */}
                                            <button onClick={() => {
                                                setShowActionsMenu(false);
                                                setShowDocumentsModal(true);
                                            }} className="w-full px-4 py-2.5 text-left text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2">
                                                <span className="text-slate-600 dark:text-slate-300">{ICONS.File}</span>
                                                <span>Документы</span>
                                                {customer.documents && customer.documents.length > 0 && (
                                                    <span className="ml-auto text-xs bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded-full font-medium">
                                                        {customer.documents.length}
                                                    </span>
                                                )}
                                            </button>
                                            {onUpdateCustomer && onDeleteCustomer && (!isEmployee || (user?.permissions?.canEdit && user?.permissions?.canDelete)) && (
                                                <div className="my-1 border-t border-slate-100 dark:border-slate-700"/>
                                            )}
                                            {onDeleteCustomer && (!isEmployee || user?.permissions?.canDelete) && (
                                                <button onClick={() => {
                                                    setShowActionsMenu(false);
                                                    handleDeleteRequest();
                                                }} className="w-full px-4 py-2.5 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 flex items-center gap-2">
                                                    <span>{ICONS.Delete}</span> Удалить
                                                </button>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                        <div>
                            <label className="text-xs text-slate-400 uppercase">Телефон</label>
                            <p className="text-lg font-medium text-slate-800 dark:text-white">{customer.phone}</p>
                        </div>
                        {customer.address && (
                            <div>
                                <label className="text-xs text-slate-400 uppercase">Адрес</label>
                                <p className="text-base font-medium text-slate-800 dark:text-white">{customer.address}</p>
                            </div>
                        )}
                        {customer.birthDate && (
                            <div>
                                <label className="text-xs text-slate-400 uppercase">Дата рождения</label>
                                <p className="text-base font-medium text-slate-800 dark:text-white">
                                    {/* Из ISO в привычный вид. Возраст рядом: по дате рождения
                                        обычно и хотят узнать именно его. */}
                                    {new Date(customer.birthDate).toLocaleDateString('ru-RU')}
                                    {(() => {
                                        const born = new Date(customer.birthDate);
                                        const now = new Date();
                                        let age = now.getFullYear() - born.getFullYear();
                                        const m = now.getMonth() - born.getMonth();
                                        if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age--;
                                        return age >= 0 && age < 130
                                            ? <span className="text-slate-400 dark:text-slate-500 font-normal"> · {age} лет</span>
                                            : null;
                                    })()}
                                </p>
                            </div>
                        )}
                        {(customer.passportSeries || customer.passportNumber) && (
                            <div>
                                <label className="text-xs text-slate-400 uppercase flex items-center gap-1">Паспорт</label>
                                <p className="text-base font-medium text-slate-800 dark:text-white font-mono tracking-wider">
                                    {customer.passportSeries} {customer.passportNumber}
                                </p>
                                {customer.passportIssuedBy && (
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">{customer.passportIssuedBy}</p>
                                )}
                            </div>
                        )}
                        <div>
                            <label className="text-xs text-slate-400 uppercase">Рейтинг доверия</label>
                            <div className="flex items-center gap-2 mt-1">
                                <div className="flex-1 bg-slate-100 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                                    <div className="bg-emerald-500 h-full" style={{width: `${customer.trustScore}%`}}></div>
                                </div>
                                <span className="text-sm font-bold dark:text-white">{customer.trustScore}%</span>
                            </div>
                        </div>
                        <div>
                            <label className="text-xs text-slate-400 uppercase">Заметки</label>
                            <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">{customer.notes || 'Нет заметок'}</p>
                        </div>
                        <div>
                            <label className="text-xs text-slate-400 uppercase">Напоминания WhatsApp</label>
                            <p className={`text-sm mt-1 font-bold ${customer.allowWhatsappNotification !== false ? 'text-emerald-600' : 'text-slate-400'}`}>
                                {customer.allowWhatsappNotification !== false ? 'Включены' : 'Отключены'}
                            </p>
                        </div>
                    </div>

                    {/* 🔹 Компактная ссылка на документы вместо полного списка */}
                    <button
                        onClick={() => setShowDocumentsModal(true)}
                        className="w-full bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-100 dark:border-slate-700 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center">
                                {ICONS.File}
                            </div>
                            <div className="text-left">
                                <p className="font-bold text-slate-800 dark:text-white">Документы</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400">{customer.documents?.length || 0} файлов</p>
                            </div>
                        </div>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400">
                            <polyline points="9 18 15 12 9 6"/>
                        </svg>
                    </button>

                    <div className="pt-2">
                        <button onClick={handleSendFullReport} className="w-full bg-slate-800 text-white py-4 rounded-xl font-semibold flex items-center justify-center gap-2">
                            {ICONS.Send} Отправить отчет в WhatsApp
                        </button>
                    </div>
                </div>
            )}
            {activeTab === 'HISTORY' && (
                <div className="space-y-3 pt-2">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
                        <div className="grid grid-cols-3 gap-2 text-center">
                            <div>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Куплено на</p>
                                <p className="font-bold text-slate-800 dark:text-white">{formatCurrency(retailTotals.bought, appSettings.showCents)} ₽</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Получено</p>
                                <p className="font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(retailTotals.received, appSettings.showCents)} ₽</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Долг</p>
                                <p className={`font-bold ${retailTotals.debt > 0 ? 'text-rose-500' : 'text-slate-400'}`}>
                                    {formatCurrency(retailTotals.debt, appSettings.showCents)} ₽
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Незакрытые долги — отдельно и сверху: это то, ради чего в
                        историю чаще всего и заходят. */}
                    {customerRetail.filter(r => retailRemaining(r) > 0).map(r => (
                        <div key={`debt_${r.id}`} className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 rounded-2xl p-4 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <p className="font-bold text-amber-800 dark:text-amber-300 truncate">
                                    Долг {formatCurrency(retailRemaining(r), appSettings.showCents)} ₽
                                </p>
                                <p className="text-xs text-amber-700/80 dark:text-amber-400/80 truncate">
                                    {r.docNumber ? `Чек №${r.docNumber} · ` : ''}{formatDate(r.date)}
                                    {retailPaidAmount(r) > 0 ? ` · внесено ${formatCurrency(retailPaidAmount(r), appSettings.showCents)} ₽` : ''}
                                </p>
                            </div>
                            {onInitiateRetailPayment && !isEmployee && (
                                <button onClick={() => onInitiateRetailPayment(r)}
                                        className="shrink-0 px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold active:scale-95 transition-transform">
                                    Принять оплату
                                </button>
                            )}
                        </div>
                    ))}

                    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
                        {retailTimeline.map(e => (
                            <div key={e.key} className="px-4 py-3 flex items-center gap-3">
                                <div className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-sm ${
                                    e.kind === 'BUY'
                                        ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400'
                                        : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                                }`}>
                                    {e.kind === 'BUY' ? '🛒' : '₽'}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="font-semibold text-slate-800 dark:text-white truncate">{e.title}</p>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                        {formatDate(e.date)}{e.subtitle ? ` · ${e.subtitle}` : ''}
                                    </p>
                                </div>
                                <p className={`font-bold shrink-0 ${e.kind === 'BUY' ? 'text-slate-800 dark:text-white' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                    {e.kind === 'BUY' ? '' : '+'}{formatCurrency(e.amount, appSettings.showCents)} ₽
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {activeTab === 'INSTALLMENTS' && (
                <div className="space-y-3 pt-2">
                    {customerSales.length === 0 && <div className="text-center py-10 text-slate-400">Нет активных рассрочек</div>}
                    {customerSales.map(sale => {
                        const investorName = getInvestorInfo(sale);
                        const isClosed = sale.status === 'COMPLETED' || sale.remainingAmount <= 0;
                        return (
                            <div key={sale.id} onClick={() => setSelectedSaleId(sale.id)} className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm active:bg-slate-50 dark:active:bg-slate-700 cursor-pointer">
                                <div className="flex justify-between items-start mb-2 gap-2">
                                    <h3 className="font-bold text-slate-800 dark:text-white min-w-0 truncate">{sale.productName}</h3>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <span className={`text-xs px-2 py-1 rounded-full ${isClosed ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400'}`}>
                                            {isClosed ? 'Закрыто' : 'Активно'}
                                        </span>
                                        {/* Печать и удаление — здесь же, чтобы не возвращаться
                                            на общий экран договоров ради одного действия. */}
                                        <SaleActionsMenu
                                            sale={sale}
                                            sales={sales}
                                            customer={customer}
                                            appSettings={appSettings}
                                            user={user}
                                            contractTemplatesAllowed={contractTemplatesAllowed}
                                            onDeleteSale={onDeleteSale}
                                        />
                                    </div>
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">от {formatDate(sale.startDate)}</p>
                                {investorName && (
                                    <div className="mb-2">
                                        <span className="text-[10px] bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 px-2 py-0.5 rounded font-bold">Инвестор: {investorName}</span>
                                    </div>
                                )}
                                <div className="flex justify-between text-sm mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                                    <span className="text-slate-500 dark:text-slate-400">Остаток:</span>
                                    <span className={`font-bold ${isClosed ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-800 dark:text-white'}`}>
                                        {isClosed ? '0 ₽' : `${formatCurrency(sale.remainingAmount, appSettings.showCents)} ₽`}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            {showEditModal && onUpdateCustomer && (
                <EditCustomerSheet customer={customer} onClose={() => setShowEditModal(false)} onUpdate={onUpdateCustomer}/>
            )}
            {/* 🔹 НОВОЕ: модалка документов */}
            {showDocumentsModal && onUpdateCustomer && (
                <CustomerDocumentsSheet
                    customer={customer}
                    onClose={() => setShowDocumentsModal(false)}
                    onUpdate={onUpdateCustomer}
                    isOnline={navigator.onLine}
                />
            )}
            {showDeleteModal && createPortal(
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white dark:bg-slate-800 w-full max-w-sm p-6 rounded-2xl shadow-xl animate-scale-in">
                        <div className="w-14 h-14 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto mb-4">{ICONS.Delete}</div>
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white text-center mb-2">Удалить клиента?</h3>
                        <p className="text-center text-slate-500 dark:text-slate-400 mb-6 text-sm">Это действие нельзя отменить. Все данные клиента будут удалены безвозвратно.</p>
                        <div className="flex gap-3">
                            <button onClick={() => setShowDeleteModal(false)} className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-200 dark:hover:bg-slate-600 transition">Отмена</button>
                            <button onClick={confirmDeleteCustomer} className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition shadow-lg shadow-red-200 dark:shadow-red-900/30">Да, удалить</button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
            {showBlockedDeleteModal && createPortal(
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in" onClick={() => setShowBlockedDeleteModal(false)}>
                    <div className="bg-white dark:bg-slate-800 w-full max-w-sm p-6 rounded-2xl shadow-2xl animate-scale-in" onClick={e => e.stopPropagation()}>
                        <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10"/>
                                <line x1="12" y1="8" x2="12" y2="12"/>
                                <line x1="12" y1="16" x2="12.01" y2="16"/>
                            </svg>
                        </div>
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white text-center mb-1">Невозможно удалить</h3>
                        <p className="text-center text-slate-500 dark:text-slate-400 mb-4 text-sm">У клиента <strong>{customer.name}</strong> есть активные договоры</p>
                        <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-4 mb-6 max-h-48 overflow-y-auto">
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2 uppercase">Привязанные договоры ({sales.filter(s => s.customerId === customer.id).length})</p>
                            <ul className="space-y-2">
                                {sales.filter(s => s.customerId === customer.id).map(contract => (
                                    <li key={contract.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 px-3 py-2 rounded-lg border border-slate-100 dark:border-slate-700">
                                        <span className="text-slate-400 flex-shrink-0">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                                <polyline points="14 2 14 8 20 8"/>
                                            </svg>
                                        </span>
                                        <span className="truncate">{contract.productName}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <p className="text-center text-slate-500 dark:text-slate-400 text-sm mb-6">Сначала удалите привязанные договоры.</p>
                        <div className="flex gap-3">
                            <button onClick={() => {
                                setShowBlockedDeleteModal(false);
                                setActiveTab('INSTALLMENTS');
                            }} className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">Перейти к договорам</button>
                            <button onClick={() => setShowBlockedDeleteModal(false)} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200 dark:shadow-indigo-900/30">Понятно</button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>

        {/* Договор выезжает справа и уезжает обратно — тем же движением, что и
            остальные страницы. Держится до конца анимации ухода: состояние
            снимается в onClose, когда играть уже нечего. */}
        {selectedSale && (
            <SubPage onClose={() => setSelectedSaleId(null)}>
                {(close: () => void) => renderSale(selectedSale, close)}
            </SubPage>
        )}
        </>
    );
};

export default CustomerDetails;