import React, { useMemo, useState, useEffect } from 'react';
import { Sale, Customer, Account, User, AppSettings } from '../types';
import { ICONS } from '../constants';
import { Phone, Search, Wallet, MoreVertical, FileText, Calendar, Edit3, Printer, Trash2, X } from 'lucide-react';
import { formatCurrency, formatDate } from '../src/utils';
import { createPortal } from 'react-dom';

interface ContractsProps {
  sales: Sale[];
  customers: Customer[];
  accounts: Account[];
  activeTab: 'ACTIVE' | 'OVERDUE' | 'ARCHIVE';
  onTabChange: (tab: 'ACTIVE' | 'OVERDUE' | 'ARCHIVE') => void;
  onViewSchedule: (sale: Sale) => void;
  onEditSale: (sale: Sale) => void;
  onDeleteSale: (saleId: string) => void;
  readOnly?: boolean;
  user?: User | null;
  appSettings?: AppSettings;
}

// ─────────────────────────────────────────────────────────────
// 📋 Модалка с информацией о договоре
// ─────────────────────────────────────────────────────────────
const ContractInfoModal = ({
  sale,
  customer,
  onClose,
  appSettings
}: {
  sale: Sale,
  customer?: Customer,
  onClose: () => void,
  appSettings?: AppSettings
}) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const monthlyPayment = sale.paymentPlan[0]?.amount || 0;
  const paidMonths = sale.paymentPlan.filter(p => p.isPaid).length;

  let expectedPaidByNow = sale.downPayment;
  sale.paymentPlan.forEach(p => {
    if (new Date(p.date) < today) expectedPaidByNow += p.amount;
  });

  const actualPaidTotal = sale.totalAmount - sale.remainingAmount;
  const realOverdueAmount = Math.max(0, expectedPaidByNow - actualPaidTotal);
  const overduePaymentsList = sale.paymentPlan.filter(p => !p.isPaid && new Date(p.date) < today);
  const nextUnpaidPayment = sale.paymentPlan.find(p => !p.isPaid && new Date(p.date) >= today);
  const nextPaymentDate = nextUnpaidPayment
    ? formatDate(nextUnpaidPayment.date)
    : (sale.remainingAmount > 0 ? 'Просрочен' : 'Закрыт');

  const handleCall = () => customer?.phone && window.open(`tel:${customer.phone}`);

  const handleWhatsApp = () => {
    if (customer?.phone) {
      const phone = customer.phone.replace(/[^0-9]/g, '');
      const text = `Здравствуйте, ${customer.name}. Напоминаем о задолженности по договору "${sale.productName}" в размере ${formatCurrency(realOverdueAmount, appSettings?.showCents)} ₽.`;
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-sm sm:rounded-3xl rounded-t-3xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 flex items-center gap-3 shrink-0">
          <div className="text-white bg-white/20 p-2 rounded-xl"><FileText size={18} /></div>
          <h3 className="text-base font-bold text-white">Информация о договоре</h3>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto flex-1">
          <div className="bg-slate-50 p-3 rounded-xl">
            <label className="text-[11px] text-slate-500 block mb-1">Товар</label>
            <p className="font-semibold text-slate-800 text-sm">{sale.productName}</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <InfoItem label="Срок" value={`${sale.installments} мес.`} />
            <InfoItem label="Оплачено" value={`${paidMonths} мес.`} color="text-emerald-600" />
            <InfoItem label="Платёж" value={`${formatCurrency(monthlyPayment, appSettings?.showCents)} ₽`} small />
            <InfoItem label="След. платеж" value={nextPaymentDate} color="text-indigo-600" small />
          </div>

          <div className="bg-gradient-to-r from-red-50 to-orange-50 p-3 rounded-xl border border-red-100">
            <div className="flex justify-between items-center">
              <label className="text-[11px] text-red-600 font-medium">Просрочка</label>
              <p className="font-bold text-red-600 text-lg">{formatCurrency(realOverdueAmount, appSettings?.showCents)} ₽</p>
            </div>
            <div className="flex justify-between items-center mt-1">
              <label className="text-[11px] text-slate-600">Остаток</label>
              <p className="font-semibold text-slate-700 text-sm">{formatCurrency(sale.remainingAmount, appSettings?.showCents)} ₽</p>
            </div>
          </div>

          {overduePaymentsList.length > 0 && (
            <div className="bg-slate-50 p-3 rounded-xl">
              <label className="text-[11px] font-medium text-slate-500 block mb-2">Пропущенные платежи</label>
              <div className="space-y-1.5 max-h-24 overflow-y-auto">
                {overduePaymentsList.map(p => (
                  <div key={p.id} className="flex justify-between items-center bg-white px-2.5 py-2 rounded-lg">
                    <span className="text-red-600 text-xs font-medium">{formatDate(p.date)}</span>
                    <span className="text-slate-500 text-[11px]">{formatCurrency(p.amount, appSettings?.showCents)} ₽</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-3 bg-slate-50 border-t border-slate-100 flex gap-2 shrink-0">
          <button onClick={handleCall} className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl font-medium text-sm flex items-center justify-center gap-1.5 active:scale-95 transition-transform">
            <Phone size={16} /> Позвонить
          </button>
          <button onClick={handleWhatsApp} className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl font-medium text-sm flex items-center justify-center gap-1.5 active:scale-95 transition-transform">
            <Phone size={16} /> WhatsApp
          </button>
        </div>

        <button onClick={onClose} className="py-3 text-slate-400 text-sm hover:text-slate-600 hover:bg-slate-50 transition-colors shrink-0">
          Закрыть
        </button>
      </div>
    </div>,
    document.body
  );
};

const InfoItem = ({ label, value, color = 'text-slate-800', small = false }: {
  label: string, value: string | number, color?: string, small?: boolean
}) => (
  <div className="bg-white p-2.5 rounded-xl border border-slate-100">
    <label className="text-[10px] text-slate-400 block mb-0.5">{label}</label>
    <p className={`font-semibold ${color} ${small ? 'text-xs' : 'text-sm'}`}>{value}</p>
  </div>
);

// ─────────────────────────────────────────────────────────────
// 📋 Основной компонент Contracts
// ─────────────────────────────────────────────────────────────
const Contracts: React.FC<ContractsProps> = ({
  sales, customers, accounts, activeTab, onTabChange,
  onViewSchedule, onEditSale, onDeleteSale, readOnly = false,
  user, appSettings
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAccountId, setFilterAccountId] = useState('');
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [deletingSale, setDeletingSale] = useState<Sale | null>(null);
  const [selectedSaleForInfo, setSelectedSaleForInfo] = useState<Sale | null>(null);
  const [currentMenuSale, setCurrentMenuSale] = useState<Sale | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number, left: number } | null>(null);

  const getCustomerName = (id: string) => customers.find(c => c.id === id)?.name || 'Неизвестно';

  const calculateSaleOverdue = (sale: Sale) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let expectedTotal = sale.downPayment;
    sale.paymentPlan.forEach(p => {
      if (!p.isRealPayment && new Date(p.date) < today) expectedTotal += p.amount;
    });
    const totalPaid = sale.totalAmount - sale.remainingAmount;
    return Math.max(0, expectedTotal - totalPaid);
  };

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

    let list = activeTab === 'ACTIVE' ? active : activeTab === 'OVERDUE' ? overdue : archive;

    if (searchTerm) {
      const lowerTerm = searchTerm.toLowerCase();
      list = list.filter(sale => {
        const customer = customers.find(c => c.id === sale.customerId);
        return (customer?.name.toLowerCase().includes(lowerTerm)) || sale.productName.toLowerCase().includes(lowerTerm);
      });
    }
    if (filterAccountId) list = list.filter(sale => sale.accountId === filterAccountId);

    return { filteredList: list.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()) };
  }, [sales, customers, activeTab, searchTerm, filterAccountId]);

  const totalOverdueSum = useMemo(() => {
    if (activeTab !== 'OVERDUE') return 0;
    return filteredList.reduce((sum, s) => sum + calculateSaleOverdue(s), 0);
  }, [filteredList, activeTab]);

  const getTabTitle = () => {
    switch(activeTab) {
      case 'ACTIVE': return 'Активные договоры';
      case 'OVERDUE': return 'Просроченные';
      case 'ARCHIVE': return 'Архив';
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 📍 Расчёт позиции меню для десктопа
  // ─────────────────────────────────────────────────────────────
  const handleActionClick = (e: React.MouseEvent, sale: Sale) => {
    e.stopPropagation();

    if (activeMenuId === sale.id) {
      setActiveMenuId(null);
      setCurrentMenuSale(null);
      setMenuPosition(null);
      return;
    }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isMobile = window.innerWidth < 640;

    if (!isMobile) {
      // Десктоп: позиционируем меню справа от кнопки
      setMenuPosition({
        top: rect.bottom + window.scrollY + 8,
        left: rect.right + window.scrollX - 200 // 200px = ширина меню
      });
    }

    setActiveMenuId(sale.id);
    setCurrentMenuSale(sale);
  };

  const handleDeleteConfirm = () => {
    if (deletingSale) { onDeleteSale(deletingSale.id); setDeletingSale(null); }
  };

  // ─────────────────────────────────────────────────────────────
  // 🖨 ПЕЧАТЬ (оригинальная версия)
  // ─────────────────────────────────────────────────────────────
  const printContract = (sale: Sale) => {
    const customer = customers.find(c => c.id === sale.customerId);
    const companyName = appSettings?.companyName || "Компания";
    const sellerPhone = user?.phone || "";
    const hasGuarantor = !!sale.guarantorName;
    const printWindow = window.open('', '_blank');

    if (!printWindow) { alert("Разрешите всплывающие окна для печати"); return; }

    const paidPlan = sale.paymentPlan.filter(p => p.isPaid).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let rows = '';

    if (paidPlan.length > 0) {
      let currentDebt = sale.totalAmount - sale.downPayment;
      rows = paidPlan.map((p, index) => {
        currentDebt -= p.amount;
        return `<tr><td style="text-align:center">${index + 1}</td><td style="text-align:center">${formatDate(p.date)}</td><td style="text-align:center">${formatCurrency(p.amount, appSettings?.showCents)} ₽</td><td style="text-align:center">${formatCurrency(Math.max(0, currentDebt), appSettings?.showCents)} ₽</td></tr>`;
      }).join('');
    } else {
      rows = Array.from({ length: sale.installments || 1 }).map((_, i) =>
        `<tr><td style="text-align:center">${i + 1}</td><td style="text-align:center;height:30px"></td><td style="text-align:center"></td><td style="text-align:center"></td></tr>`
      ).join('');
    }

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Договор</title>
    <style>
        * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body { 
            font-family: 'Times New Roman', Times, serif; 
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
                <span><span class="field-label">Продавец:</span> ${companyName}</span>
                <span>Тел: ${sellerPhone || '+7 (___) ___-__-__'}</span>
            </div>
            <div class="field-row">
                <span><span class="field-label">Покупатель:</span> ${customer?.name || '__________________'}</span>
                <span>Тел: ${customer?.phone || '+7 (___) ___-__-__'}</span>
            </div>
            ${hasGuarantor ? `
            <div class="field-row">
                <span><span class="field-label">Поручитель:</span> ${sale.guarantorName}</span>
                <span>Тел: ${sale.guarantorPhone || ''}</span>
            </div>` : ''}
        </div>
        <div class="section">
            <div><span class="field-label">Товар:</span> ${sale.productName}</div>
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
                    <th style="width: 25%;">Сумма</th>
                    <th style="width: 35%;">Остаток долга</th>
                </tr>
            </thead>
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

  // ─────────────────────────────────────────────────────────────
  // 📱 МЕНЮ ДЕЙСТВИЙ (Bottom Sheet для мобильных + Dropdown для десктопа)
  // ─────────────────────────────────────────────────────────────
  const ActionMenu = () => {
    if (!currentMenuSale) return null;

    const customer = customers.find(c => c.id === currentMenuSale.customerId);
    const isMobile = window.innerWidth < 640;

    return createPortal(
      <>
        {/* Затемнение фона */}
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9998] animate-fade-in"
          onClick={() => { setActiveMenuId(null); setCurrentMenuSale(null); setMenuPosition(null); }}
        />

        {/* Меню */}
        {isMobile ? (
          /* 📱 Mobile Bottom Sheet */
          <div className="fixed left-0 right-0 bottom-0 z-[9999] animate-slide-up">
            <div className="bg-white rounded-t-3xl shadow-2xl w-full mx-auto overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <span className="text-sm font-semibold text-slate-700">Действия</span>
                <button
                  onClick={() => { setActiveMenuId(null); setCurrentMenuSale(null); setMenuPosition(null); }}
                  className="p-1 text-slate-400 hover:text-slate-600"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
                <p className="text-sm font-semibold text-slate-800 truncate">{customer?.name}</p>
                <p className="text-xs text-slate-500 truncate">{currentMenuSale.productName}</p>
              </div>

              <div className="py-2">
                <button
                  onClick={() => { setSelectedSaleForInfo(currentMenuSale); setActiveMenuId(null); setCurrentMenuSale(null); setMenuPosition(null); }}
                  className="w-full text-left px-4 py-3.5 text-sm text-slate-700 hover:bg-blue-50 flex items-center gap-3 transition-colors"
                >
                  <span className="text-blue-500"><FileText size={18} /></span>
                  <span>Информация о договоре</span>
                </button>

                <button
                  onClick={() => { onViewSchedule(currentMenuSale); setActiveMenuId(null); setCurrentMenuSale(null); setMenuPosition(null); }}
                  className="w-full text-left px-4 py-3.5 text-sm text-slate-700 hover:bg-indigo-50 flex items-center gap-3 transition-colors"
                >
                  <span className="text-indigo-500"><Calendar size={18} /></span>
                  <span>График платежей</span>
                </button>

                <button
                  onClick={() => { onEditSale(currentMenuSale); setActiveMenuId(null); setCurrentMenuSale(null); setMenuPosition(null); }}
                  className="w-full text-left px-4 py-3.5 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                >
                  <span className="text-slate-500"><Edit3 size={18} /></span>
                  <span>Редактировать</span>
                </button>

                <button
                  onClick={() => { printContract(currentMenuSale); setActiveMenuId(null); setCurrentMenuSale(null); setMenuPosition(null); }}
                  className="w-full text-left px-4 py-3.5 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                >
                  <span className="text-slate-500"><Printer size={18} /></span>
                  <span>Печать договора</span>
                </button>
              </div>

              <div className="border-t border-slate-100 py-2">
                <button
                  onClick={() => { setDeletingSale(currentMenuSale); setActiveMenuId(null); setCurrentMenuSale(null); setMenuPosition(null); }}
                  className="w-full text-left px-4 py-3.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors"
                >
                  <span className="text-red-500"><Trash2 size={18} /></span>
                  <span>Удалить договор</span>
                </button>
              </div>

              <div className="px-4 pb-4 pt-2">
                <button
                  onClick={() => { setActiveMenuId(null); setCurrentMenuSale(null); setMenuPosition(null); }}
                  className="w-full py-3 bg-slate-100 text-slate-700 rounded-xl font-medium text-sm hover:bg-slate-200 transition-colors"
                >
                  Отмена
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* 🖥️ Desktop Dropdown */
          <div
            className="fixed z-[9999] bg-white rounded-2xl shadow-2xl w-64 overflow-hidden animate-scale-in border border-slate-100"
            style={{
              top: `${menuPosition?.top || 0}px`,
              left: `${menuPosition?.left || 0}px`
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
              <p className="text-sm font-semibold text-slate-800 truncate">{customer?.name}</p>
              <p className="text-xs text-slate-500 truncate">{currentMenuSale.productName}</p>
            </div>

            <div className="py-2">
              <button
                onClick={() => { setSelectedSaleForInfo(currentMenuSale); setActiveMenuId(null); setCurrentMenuSale(null); setMenuPosition(null); }}
                className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-blue-50 flex items-center gap-3 transition-colors"
              >
                <span className="text-blue-500"><FileText size={16} /></span>
                <span>Информация</span>
              </button>

              <button
                onClick={() => { onViewSchedule(currentMenuSale); setActiveMenuId(null); setCurrentMenuSale(null); setMenuPosition(null); }}
                className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-indigo-50 flex items-center gap-3 transition-colors"
              >
                <span className="text-indigo-500"><Calendar size={16} /></span>
                <span>График</span>
              </button>

              <button
                onClick={() => { onEditSale(currentMenuSale); setActiveMenuId(null); setCurrentMenuSale(null); setMenuPosition(null); }}
                className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
              >
                <span className="text-slate-500"><Edit3 size={16} /></span>
                <span>Редактировать</span>
              </button>

              <button
                onClick={() => { printContract(currentMenuSale); setActiveMenuId(null); setCurrentMenuSale(null); setMenuPosition(null); }}
                className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
              >
                <span className="text-slate-500"><Printer size={16} /></span>
                <span>Печать</span>
              </button>
            </div>

            <div className="border-t border-slate-100 py-2">
              <button
                onClick={() => { setDeletingSale(currentMenuSale); setActiveMenuId(null); setCurrentMenuSale(null); setMenuPosition(null); }}
                className="w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors"
              >
                <span className="text-red-500"><Trash2 size={16} /></span>
                <span>Удалить</span>
              </button>
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
        setActiveMenuId(null);
        setCurrentMenuSale(null);
        setMenuPosition(null);
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (activeMenuId && !(e.target as HTMLElement).closest('[aria-label="Меню"]')) {
        setActiveMenuId(null);
        setCurrentMenuSale(null);
        setMenuPosition(null);
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
            <h2 className="text-2xl font-bold text-slate-800">{getTabTitle()}</h2>
            <p className="text-slate-400 text-xs mt-0.5">Найдено: {filteredList.length}</p>
          </div>
        </div>
      ) : (
        <div className="bg-gradient-to-br from-red-50 to-orange-50 border border-red-200 p-4 rounded-2xl mb-3">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-lg font-bold text-slate-800">Просроченные договоры</h2>
              <p className="text-slate-500 text-xs">Всего: {filteredList.length}</p>
            </div>
            <div className="bg-red-500 p-2 rounded-xl text-white"><Phone size={20} className="rotate-45" /></div>
          </div>
          <div className="mt-3 pt-3 border-t border-red-200">
            <p className="text-xs text-slate-500 font-medium">Общая просрочка</p>
            <p className="text-2xl font-bold text-red-600">{formatCurrency(totalOverdueSum, appSettings?.showCents)} ₽</p>
          </div>
        </div>
      )}

      {/* Фильтры (без даты) */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="Поиск по имени или товару..."
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200 outline-none transition-all"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="relative">
            <Wallet className="absolute left-3 top-2.5 text-slate-400" size={16} />
            <select
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200 outline-none transition-all appearance-none bg-white"
              value={filterAccountId}
              onChange={e => setFilterAccountId(e.target.value)}
            >
              <option value="">Все счета / Инвесторы</option>
              {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Список договоров */}
      <div className="space-y-2.5">
        {filteredList.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-200">
            <div className="text-4xl mb-2">📄</div>
            <p className="text-slate-400 text-sm">Ничего не найдено</p>
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
              className="bg-white rounded-2xl shadow-sm p-3.5 border border-slate-100 hover:border-blue-200 hover:shadow transition-all cursor-pointer"
              onClick={() => !readOnly && setSelectedSaleForInfo(sale)}
            >
              <div className="flex items-start justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <span className="w-5.5 h-5.5 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-lg flex items-center justify-center text-white font-bold text-[10px] shadow-sm shrink-0">
                    {displayNumber}
                  </span>
                  <span className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide rounded-md ${
                    isOverdue ? 'bg-red-100 text-red-700' : isCompleted ? 'bg-slate-100 text-slate-600' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {isOverdue ? 'Просрочено' : isCompleted ? 'Закрыто' : 'Активно'}
                  </span>
                </div>
                {!readOnly && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleActionClick(e, sale); }}
                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all shrink-0"
                    aria-label="Меню"
                  >
                    <MoreVertical size={16} />
                  </button>
                )}
              </div>

              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 text-sm truncate" title={customer?.name}>
                    {customer?.name || 'Неизвестно'}
                  </p>
                  <p className="text-xs text-slate-500 truncate mt-0.5" title={sale.productName}>
                    {sale.productName}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {formatDate(sale.startDate)} • {sale.installments} мес.
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <p className={`text-base font-bold ${isOverdue ? 'text-red-600' : 'text-slate-800'}`}>
                    {formatCurrency(isOverdue ? overdueSum : sale.totalAmount, appSettings?.showCents)} ₽
                  </p>

                </div>
              </div>

              {activeTab !== 'OVERDUE' && !isCompleted && (
                <div className="flex items-center justify-between pt-2 border-t border-slate-50">
                  <span className="text-[10px] text-slate-500">
                    Оплачено: <span className="font-medium text-emerald-600">{formatCurrency(sale.totalAmount - sale.remainingAmount, appSettings?.showCents)} ₽</span>
                  </span>
                  <span className="text-[10px] text-slate-500">
                    Остаток: <span className="font-medium text-slate-700">{formatCurrency(sale.remainingAmount, appSettings?.showCents)} ₽</span>
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
          <div className="bg-white w-full max-w-sm p-6 rounded-3xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="w-14 h-14 bg-red-500 text-white rounded-2xl flex items-center justify-center mx-auto mb-4"><Trash2 size={28} /></div>
            <h3 className="text-lg font-bold text-slate-800 text-center mb-1.5">Удалить договор?</h3>
            <p className="text-center text-slate-500 mb-6 text-sm">Все данные о платежах будут удалены. Товар вернётся на склад.</p>
            <div className="flex gap-2.5">
              <button onClick={() => setDeletingSale(null)} className="flex-1 py-2.5 bg-slate-100 rounded-xl font-medium text-slate-600 hover:bg-slate-200 transition-all">Отмена</button>
              <button onClick={handleDeleteConfirm} className="flex-1 py-2.5 bg-red-500 text-white rounded-xl font-bold hover:bg-red-600 transition-all">Удалить</button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка информации */}
      {selectedSaleForInfo && (
        <ContractInfoModal
          sale={selectedSaleForInfo}
          customer={customers.find(c => c.id === selectedSaleForInfo.customerId)}
          onClose={() => setSelectedSaleForInfo(null)}
          appSettings={appSettings}
        />
      )}
    </div>
  );
};

export default Contracts;