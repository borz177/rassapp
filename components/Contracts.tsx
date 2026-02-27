
import React, { useMemo, useState } from 'react';
import { Sale, Customer, Account, User, AppSettings } from '../types';
import { ICONS } from '../constants';
import { Phone } from 'lucide-react';

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

const ContractInfoModal = ({ sale, customer, onClose }: { sale: Sale, customer?: Customer, onClose: () => void }) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Calculations
    const monthlyPayment = sale.paymentPlan.length > 0 ? sale.paymentPlan[0].amount : 0;
    const paidMonths = sale.paymentPlan.filter(p => p.isPaid).length;
    
    // Calculate Actual Overdue based on expected vs paid
    let expectedPaidByNow = sale.downPayment;
    sale.paymentPlan.forEach(p => {
        if (new Date(p.date) < today) {
            expectedPaidByNow += p.amount;
        }
    });
    
    const actualPaidTotal = sale.totalAmount - sale.remainingAmount;
    const realOverdueAmount = Math.max(0, expectedPaidByNow - actualPaidTotal);

    // List of technically overdue dates (for display)
    const overduePaymentsList = sale.paymentPlan.filter(p => !p.isPaid && new Date(p.date) < today);
    const overdueMonths = overduePaymentsList.length;

    // Find next payment date
    const nextUnpaidPayment = sale.paymentPlan.find(p => !p.isPaid && new Date(p.date) >= today);
    const nextPaymentDate = nextUnpaidPayment ? new Date(nextUnpaidPayment.date).toLocaleDateString() : (sale.remainingAmount > 0 ? 'Просрочен' : 'Закрыт');

    const handleCall = () => {
        if (customer?.phone) {
            window.open(`tel:${customer.phone}`);
        }
    };

    const handleWhatsApp = () => {
        if (customer?.phone) {
            const phone = customer.phone.replace(/[^0-9]/g, '');
            const text = `Здравствуйте, ${customer.name}. Напоминаем о задолженности по договору "${sale.productName}" в размере ${realOverdueAmount.toLocaleString()} ₽.`;
            window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
                    <div className="text-blue-500">{ICONS.File}</div>
                    <h3 className="text-lg font-bold text-blue-600">Информация о договоре</h3>
                </div>

                <div className="p-6 space-y-6">
                    {/* Grid Info */}
                    <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                        <div>
                            <label className="text-xs text-slate-500 block mb-1">Товар</label>
                            <p className="font-bold text-slate-800 text-sm leading-tight">{sale.productName}</p>
                        </div>
                        <div>
                            <label className="text-xs text-slate-500 block mb-1">Общий срок</label>
                            <p className="font-bold text-slate-800">{sale.installments} мес.</p>
                        </div>
                        
                        <div>
                            <label className="text-xs text-slate-500 block mb-1">Оплачено</label>
                            <p className="font-bold text-emerald-600">{paidMonths} мес.</p>
                        </div>
                        <div>
                            <label className="text-xs text-slate-500 block mb-1">Просрочено</label>
                            <p className="font-bold text-red-600">{overdueMonths} платежей</p>
                        </div>

                        <div>
                            <label className="text-xs text-slate-500 block mb-1">Ежемесячный платёж</label>
                            <p className="font-bold text-slate-800">{monthlyPayment.toLocaleString()} ₽</p>
                        </div>
                        <div>
                            <label className="text-xs text-slate-500 block mb-1">След. платеж</label>
                            <p className="font-bold text-indigo-600">{nextPaymentDate}</p>
                        </div>
                        
                        <div className="col-span-2 border-t border-slate-100 pt-4 mt-2">
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-slate-500 block">Сумма просрочки (по факту)</label>
                                <p className="font-bold text-red-600 text-xl">{realOverdueAmount.toLocaleString()} ₽</p>
                            </div>
                            <div className="flex justify-between items-center mt-1">
                                <label className="text-xs text-slate-500 block">Общий остаток долга</label>
                                <p className="font-bold text-slate-800">{sale.remainingAmount.toLocaleString()} ₽</p>
                            </div>
                        </div>
                    </div>

                    {/* Overdue Dates */}
                    {overduePaymentsList.length > 0 && (
                        <div className="max-h-32 overflow-y-auto pr-2">
                            <label className="text-xs text-slate-500 block mb-2 sticky top-0 bg-white">Даты пропущенных платежей</label>
                            <div className="space-y-1">
                                {overduePaymentsList.map(p => (
                                    <div key={p.id} className="flex justify-between text-sm">
                                        <span className="text-red-600 font-medium">{new Date(p.date).toLocaleDateString()}</span>
                                        <span className="text-slate-400 text-xs">План: {p.amount.toLocaleString()} ₽</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Actions Footer */}
                <div className="p-4 border-t border-slate-100 bg-slate-50 flex gap-3">
                    <button 
                        onClick={handleCall}
                        className="flex-1 py-3 bg-blue-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2 hover:bg-blue-700 transition-colors"
                    >
                        <Phone size={18} /> Позвонить
                    </button>
                    <button 
                        onClick={handleWhatsApp}
                        className="flex-1 py-3 bg-emerald-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2 hover:bg-emerald-700 transition-colors"
                    >
                        {ICONS.Send} Написать
                    </button>
                </div>
                
                <button onClick={onClose} className="w-full py-3 text-slate-400 text-sm hover:text-slate-600">Закрыть</button>
            </div>
        </div>
    );
};

const Contracts: React.FC<ContractsProps> = ({ 
    sales, customers, accounts, activeTab, onTabChange,
    onViewSchedule, onEditSale, onDeleteSale, readOnly = false,
    user, appSettings
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [filterAccountId, setFilterAccountId] = useState('');
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [deletingSale, setDeletingSale] = useState<Sale | null>(null);
  const [selectedSaleForInfo, setSelectedSaleForInfo] = useState<Sale | null>(null);

  const getCustomerName = (id: string) => customers.find(c => c.id === id)?.name || 'Неизвестно';

  // Helper to calculate accurate overdue amount based on actual payments vs expected schedule
  const calculateSaleOverdue = (sale: Sale) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // 1. Calculate Total Expected to be paid by TODAY
      // Include DownPayment + All Installments strictly before today
      // IMPORTANT: Only count PLAN items (isRealPayment !== true), ignore real payments in this sum
      let expectedTotal = sale.downPayment;
      sale.paymentPlan.forEach(p => {
          if (!p.isRealPayment && new Date(p.date) < today) {
              expectedTotal += p.amount;
          }
      });

      // 2. Calculate Total Actually Paid
      const totalPaid = sale.totalAmount - sale.remainingAmount;

      // 3. Difference is the real overdue
      const overdue = expectedTotal - totalPaid;

      return Math.max(0, overdue);
  };

  const { filteredList } = useMemo(() => {
    const today = new Date();
    today.setHours(0,0,0,0);

    const active: Sale[] = [];
    const overdue: Sale[] = [];
    const archive: Sale[] = [];

    const customerIdSet = new Set(customers.map(c => c.id));
    const actualSales = sales.filter(sale => customerIdSet.has(sale.customerId));

    actualSales.forEach(sale => {
      if (sale.status === 'COMPLETED' || sale.remainingAmount === 0) {
        archive.push(sale);
        return;
      }
      const hasOverduePayment = sale.paymentPlan.some(p => !p.isPaid && new Date(p.date) < today);
      if (hasOverduePayment) {
        overdue.push(sale);
      } else {
        active.push(sale);
      }
    });

    let list = activeTab === 'ACTIVE' ? active : activeTab === 'OVERDUE' ? overdue : archive;

    if (searchTerm) {
        const lowerTerm = searchTerm.toLowerCase();
        list = list.filter(sale => {
            const customer = customers.find(c => c.id === sale.customerId);
            return (
                (customer && customer.name.toLowerCase().includes(lowerTerm)) ||
                (sale.productName.toLowerCase().includes(lowerTerm))
            );
        });
    }

    if (filterDate) {
        list = list.filter(sale => sale.startDate.startsWith(filterDate));
    }

    if (filterAccountId) {
        list = list.filter(sale => sale.accountId === filterAccountId);
    }

    return {
        filteredList: list.sort((a,b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()),
    };
  }, [sales, customers, activeTab, searchTerm, filterDate, filterAccountId]);

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
  }

  const handleActionClick = (e: React.MouseEvent, saleId: string) => {
      e.stopPropagation();
      setActiveMenuId(prev => prev === saleId ? null : saleId);
  };

  const handleDeleteConfirm = () => {
      if (deletingSale) {
          onDeleteSale(deletingSale.id);
          setDeletingSale(null);
      }
  }

 const printContract = (sale: Sale) => {
    const customer = customers.find(c => c.id === sale.customerId);
    const companyName = appSettings?.companyName || "Компания";
    const sellerPhone = user?.phone || "";
    const hasGuarantor = !!sale.guarantorName;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert("Разрешите всплывающие окна для печати");
        return;
    }

    const paidPlan = sale.paymentPlan
        .filter(p => p.isPaid)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let rows = '';
    if (paidPlan.length > 0) {
        let currentDebt = sale.totalAmount - sale.downPayment;
        rows = paidPlan.map((p, index) => {
            currentDebt -= p.amount;
            const displayDebt = Math.max(0, currentDebt);
            return `
              <tr>
                  <td style="text-align: center;">${index + 1}</td>
                  <td style="text-align: center;">${new Date(p.date).toLocaleDateString()}</td>
                  <td style="text-align: center;">${p.amount.toLocaleString()} ₽</td>
                  <td style="text-align: center;">${displayDebt.toLocaleString()} ₽</td>
              </tr>
            `;
        }).join('');
    } else {
        rows = Array.from({ length: sale.installments || 1 }).map((_, index) => `
          <tr>
              <td style="text-align: center;">${index + 1}</td>
              <td style="text-align: center; height: 30px;"></td>
              <td style="text-align: center;"></td>
              <td style="text-align: center;"></td>
          </tr>
        `).join('');
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
          <title>Договор купли-продажи</title>
          <style>
              * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              body { 
                  font-family: 'Times New Roman', Times, serif; 
                  font-size: 12pt; 
                  line-height: 1.5; 
                  padding: 30px 25px;
                  padding-bottom: 200px;
                  width: 100%;
                  max-width: 210mm;
                  margin: 0 auto;
                  zoom: 1 !important;
                  -webkit-text-size-adjust: 100%;
              }
              h1 { text-align: center; font-size: 15pt; font-weight: bold; margin: 0 0 25px 0; text-transform: uppercase; line-height: 1.3; }
              .header-info { text-align: right; margin-bottom: 20px; font-size: 11pt; }
              
              .field-row { 
                  display: flex; 
                  justify-content: space-between; 
                  margin-bottom: 10px; 
              }
              .field-label { font-weight: bold; }
              
              .section { margin: 0 0 20px 0; }
              .section > div { margin-bottom: 12px; }
              .section > div:last-child { margin-bottom: 0; }
              
              table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 10.5pt; }
              th, td { border: 1px solid #000; padding: 6px 8px; text-align: center; }
              th { font-weight: bold; background: #f9f9f9; }
              
              .footer { 
                  display: flex; 
                  justify-content: space-between; 
                  align-items: flex-end;
                  margin-top: 10px;
                  width: 100%;
              }
              .signature-block { 
                  text-align: center; 
                  break-inside: avoid;
                  page-break-inside: avoid;
              }
              .signature-line { 
                  border-bottom: 1px solid #000; 
                  margin: 35px 0 5px 0; 
                  min-height: 1px; 
              }
              .signature-label { 
                  font-size: 10pt; 
                  font-style: italic; 
              }

              .no-print {
                  position: fixed;
                  top: 15px;
                  right: 15px;
                  padding: 10px 18px;
                  background: #ef4444;
                  color: white;
                  border: none;
                  border-radius: 6px;
                  cursor: pointer;
                  font-family: sans-serif;
                  font-weight: 600;
                  font-size: 13px;
                  z-index: 1000;
                  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
              }

              /* === PRINT STYLES === */
              @media print {
                  @page { margin: 1cm; size: A4 portrait; }
                  body { 
                      padding: 0 1cm; 
                      margin: 0; 
                      width: 100%; 
                      max-width: none; 
                      padding-bottom: 180px !important;
                  }
                  
                  /* Force phone numbers to stay on the right */
                  .field-row { 
                      flex-wrap: nowrap !important; 
                      gap: 0 !important;
                      justify-content: space-between !important;
                  }
                  .field-row > span:first-child { 
                      flex-shrink: 0; 
                  }
                  .field-row > span:last-child { 
                      text-align: right; 
                      flex-shrink: 0;
                      margin-left: 10px;
                  }
                  
                  /* Footer with signatures - always visible on print */
                  .footer-container {
                      position: relative !important;
                      bottom: auto !important;
                      left: auto !important;
                      right: auto !important;
                      width: 100% !important;
                      background: white !important;
                      padding-top: 30px !important;
                      margin-top: 40px !important;
                      page-break-inside: avoid;
                      break-inside: avoid;
                      display: block !important;
                  }
                  .footer {
                      display: flex !important;
                      justify-content: space-between !important;
                      width: 100% !important;
                  }
                  .signature-block {
                      display: block !important;
                      visibility: visible !important;
                      opacity: 1 !important;
                  }
                  
                  .no-print { display: none !important; }
                  h1 { font-size: 14pt; }
                  table { font-size: 10pt; }
              }
              
              /* === MOBILE SCREEN (not print) === */
              @media screen and (max-width: 768px) {
                  body { font-size: 11pt; padding: 20px 15px; }
                  h1 { font-size: 13pt; }
                  .field-row { flex-wrap: wrap; gap: 5px; }
                  .field-row > span:last-child { 
                      text-align: right; 
                      min-width: 120px;
                  }
                  table { font-size: 9.5pt; }
                  th, td { padding: 4px 6px; }
              }
              
              /* === MOBILE PRINT FIXES === */
              @media print and (max-width: 768px) {
                  body { 
                      font-size: 10.5pt; 
                      padding: 15px 10px !important; 
                      padding-bottom: 190px !important;
                  }
                  h1 { font-size: 12pt; }
                  .field-row { 
                      flex-wrap: nowrap !important; 
                      gap: 0 !important;
                  }
                  .field-row > span { 
                      font-size: 10pt;
                  }
                  .field-row > span:last-child { 
                      text-align: right !important;
                      margin-left: 8px;
                  }
                  table { font-size: 9pt; }
                  th, td { padding: 4px 5px; }
                  
                  /* Ensure signatures show on mobile print */
                  .footer-container {
                      position: relative !important;
                      margin-top: 30px !important;
                      padding-top: 20px !important;
                  }
                  .signature-line { 
                      margin: 25px 0 3px 0 !important; 
                  }
                  .signature-label { 
                      font-size: 9pt !important; 
                  }
              }
          </style>
      </head>
      <body>
          <button class="no-print" onclick="window.close()">✕ Закрыть</button>
          <h1>ДОГОВОР КУПЛИ-ПРОДАЖИ ТОВАРА В РАССРОЧКУ</h1>
          
          <div class="header-info">
              Дата: ${new Date(sale.startDate).toLocaleDateString()}
          </div>

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
                  <span><span class="field-label">Стоимость:</span> ${sale.totalAmount.toLocaleString()} ₽</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                  <span><span class="field-label">Ежемесячный платеж:</span> ${(sale.paymentPlan[0]?.amount || 0).toLocaleString()} ₽</span>
                  <span><span class="field-label">Первый взнос:</span> ${sale.downPayment.toLocaleString()} ₽</span>
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
              <tbody>
                  ${rows}
              </tbody>
          </table>

          <div style="margin: 25px 0; font-size: 11pt; line-height: 1.4;">
              Продавец обязуется передать Покупателю товар, а Покупатель обязуется принять и оплатить его в рассрочку на указанных выше условиях.
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
              window.onload = function() { 
                  setTimeout(() => { window.print(); }, 300); 
              }
          </script>
      </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
};

  return (
    <div className="space-y-4 pb-20 w-full">
      {activeTab !== 'OVERDUE' && (
        <div className="flex justify-between items-center mb-2">
            <div>
                <h2 className="text-2xl font-bold text-slate-800">{getTabTitle()}</h2>
                <p className="text-slate-500 text-sm">Найдено: {filteredList.length}</p>
            </div>
        </div>
      )}

       {activeTab === 'OVERDUE' && (
          <div className="bg-gradient-to-r from-red-50 to-white border border-red-100 p-5 rounded-2xl shadow-sm animate-fade-in mb-4">
              <div className="flex justify-between items-start">
                  <div>
                      <h2 className="text-xl font-bold text-slate-800 mb-1">Просроченные договоры</h2>
                      <p className="text-slate-500 text-xs uppercase font-bold tracking-wide">Всего договоров: {filteredList.length}</p>
                  </div>
                  <div className="bg-red-100 p-2 rounded-full text-red-500">
                      {ICONS.Alert}
                  </div>
              </div>
              <div className="mt-4 pt-4 border-t border-red-100">
                  <p className="text-xs text-slate-400 font-medium mb-1">Общая сумма просрочки (по факту)</p>
                  <p className="text-3xl font-bold text-red-600">{totalOverdueSum.toLocaleString(undefined, {maximumFractionDigits: 0})} ₽</p>
              </div>
          </div>
        )}

      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="relative">
                  <span className="absolute left-3 top-3 text-slate-400 scale-90">{ICONS.Users}</span>
                  <input
                    type="text"
                    placeholder="Поиск по имени или товару..."
                    className="w-full pl-10 p-2.5 border border-slate-200 rounded-lg outline-none text-sm focus:border-indigo-500 bg-white text-slate-900"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                  />
              </div>
              <div className="relative">
                  <span className="absolute left-3 top-3 text-slate-400 scale-75">{ICONS.Clock}</span>
                  <input
                    type="date"
                    className="w-full max-w-[130px] pl-10 p-2.5 border border-slate-200 rounded-lg outline-none text-sm text-slate-900 bg-white focus:border-indigo-500"
                    value={filterDate}
                    onChange={e => setFilterDate(e.target.value)}
                  />
              </div>
              <div className="relative">
                  <span className="absolute left-3 top-3 text-slate-400 scale-75">{ICONS.Wallet}</span>
                  <select
                    className="w-full pl-10 p-2.5 border border-slate-200 rounded-lg outline-none text-sm text-slate-900 bg-white focus:border-indigo-500"
                    value={filterAccountId}
                    onChange={e => setFilterAccountId(e.target.value)}
                  >
                      <option value="">Все счета / Инвесторы</option>
                      {accounts.map(acc => (<option key={acc.id} value={acc.id}>{acc.name}</option>))}
                  </select>
              </div>
          </div>
      </div>

      <div className="space-y-3 pt-2" onClick={() => setActiveMenuId(null)}>
        {filteredList.length === 0 ? (<div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400">Ничего не найдено</div>) :
        (filteredList.map((sale, index) => {
            const progress = sale.totalAmount > 0 ? ((sale.totalAmount - sale.remainingAmount) / sale.totalAmount) * 100 : 0;
            let statusLabel = 'АКТИВНО';
            let statusColor = 'bg-blue-100 text-blue-700';
            if (sale.status === 'COMPLETED') { statusLabel = 'ЗАКРЫТО'; statusColor = 'bg-slate-100 text-slate-700'; }
            if (activeTab === 'OVERDUE') { statusLabel = 'ПРОСРОЧЕНО'; statusColor = 'bg-red-100 text-red-700'; }

            // Reverse numbering logic: Top is highest number, Bottom is 1
            const displayNumber = filteredList.length - index;

            // Calculate REAL overdue based on payments made vs expected
            const overdueSum = calculateSaleOverdue(sale);

            return (
              <div
                key={sale.id}
                className="bg-white rounded-xl shadow-sm p-4 relative animate-fade-in transition-transform"
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-start gap-3">
                    <span className="text-sm font-bold text-slate-400 mt-1">#{displayNumber}</span>
                    <div>
                      <h3 className="font-bold text-slate-800">{getCustomerName(sale.customerId)}</h3>
                      <p className="text-sm text-slate-500">{sale.productName}</p>
                      <p className="text-[10px] text-slate-400 mt-1">Оформлен: {new Date(sale.startDate).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <div className="text-right flex items-center gap-2">
                    <div>
                      <span className={`inline-block px-2 py-1 text-xs font-bold rounded-full ${statusColor}`}>{statusLabel}</span>
                      {activeTab === 'OVERDUE' ? (
                          <p className="text-sm font-bold text-red-600 mt-1">Просрочка: {overdueSum.toLocaleString()} ₽</p>
                      ) : (
                          <p className="text-sm font-semibold mt-1">{sale.totalAmount.toLocaleString()} ₽</p>
                      )}
                    </div>
                    {!readOnly && (
                        <button onClick={(e) => handleActionClick(e, sale.id)} className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg self-start">{ICONS.More}</button>
                    )}
                  </div>
                </div>

                <div className="w-full bg-slate-100 rounded-full h-2 mt-3"><div className={`h-2 rounded-full ${activeTab === 'OVERDUE' ? 'bg-red-500' : 'bg-indigo-600'}`} style={{ width: `${progress}%` }}></div></div>
                <div className="flex justify-between text-xs text-slate-400 mt-1"><span>Оплачено: {(sale.totalAmount - sale.remainingAmount).toLocaleString()} ₽</span>{activeTab !== 'OVERDUE' && <span>Остаток: {sale.remainingAmount.toLocaleString()} ₽</span>}</div>

                {!readOnly && activeMenuId === sale.id && (
                  <div className="absolute right-4 top-14 bg-white shadow-xl rounded-xl z-20 w-48 overflow-hidden animate-fade-in" onClick={e => e.stopPropagation()}>
                      <button onClick={() => setSelectedSaleForInfo(sale)} className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3 bg-blue-50/50"><span className="text-blue-500">{ICONS.File}</span> Инфо о договоре</button>
                      <button onClick={() => onViewSchedule(sale)} className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3"><span className="text-indigo-500">{ICONS.List}</span> График</button>
                      <button onClick={() => onEditSale(sale)} className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3"><span className="text-slate-500">{ICONS.Edit}</span> Редактировать</button>
                      <button onClick={() => printContract(sale)} className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3"><span className="text-slate-500">{ICONS.File}</span> Печать</button>
                      <button onClick={() => setDeletingSale(sale)} className="w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50 flex items-center gap-3"><span>{ICONS.Delete}</span> Удалить</button>
                  </div>
                )}
              </div>
            )
        }))}
      </div>

        {deletingSale && !readOnly && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in" onClick={() => setDeletingSale(null)}>
                <div className="bg-white w-full max-w-sm p-6 rounded-2xl shadow-xl" onClick={e => e.stopPropagation()}>
                    <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">{ICONS.Delete}</div>
                    <h3 className="text-lg font-bold text-slate-800 text-center mb-2">Удалить договор?</h3>
                    <p className="text-center text-slate-500 mb-6 text-sm">Это действие необратимо. Будут удалены все записи о платежах и расходах (закуп), а товар вернется на склад. Вы уверены?</p>
                    <div className="flex gap-3">
                        <button onClick={() => setDeletingSale(null)} className="flex-1 py-3 bg-slate-100 rounded-xl font-medium text-slate-600">Отмена</button>
                        <button onClick={handleDeleteConfirm} className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold">Удалить</button>
                    </div>
                </div>
            </div>
        )}

        {selectedSaleForInfo && (
            <ContractInfoModal 
                sale={selectedSaleForInfo} 
                customer={customers.find(c => c.id === selectedSaleForInfo.customerId)}
                onClose={() => setSelectedSaleForInfo(null)}
            />
        )}
    </div>
  );
};

export default Contracts;
