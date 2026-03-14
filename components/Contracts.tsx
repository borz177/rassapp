import React, { useMemo, useState, useEffect } from 'react';
import { Sale, Customer, Account, User, AppSettings } from '../types';
import { ICONS } from '../constants';
import { Phone } from 'lucide-react';
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

const ContractInfoModal = ({ sale, customer, onClose, appSettings }: { sale: Sale, customer?: Customer, onClose: () => void, appSettings?: AppSettings }) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const monthlyPayment = sale.paymentPlan.length > 0 ? sale.paymentPlan[0].amount : 0;
    const paidMonths = sale.paymentPlan.filter(p => p.isPaid).length;

    let expectedPaidByNow = sale.downPayment;
    sale.paymentPlan.forEach(p => {
        if (new Date(p.date) < today) {
            expectedPaidByNow += p.amount;
        }
    });

    const actualPaidTotal = sale.totalAmount - sale.remainingAmount;
    const realOverdueAmount = Math.max(0, expectedPaidByNow - actualPaidTotal);

    const overduePaymentsList = sale.paymentPlan.filter(p => !p.isPaid && new Date(p.date) < today);
    const overdueMonths = overduePaymentsList.length;

    const nextUnpaidPayment = sale.paymentPlan.find(p => !p.isPaid && new Date(p.date) >= today);
    const nextPaymentDate = nextUnpaidPayment ? formatDate(nextUnpaidPayment.date) : (sale.remainingAmount > 0 ? 'Просрочен' : 'Закрыт');

    const handleCall = () => {
        if (customer?.phone) {
            window.open(`tel:${customer.phone}`);
        }
    };

    const handleWhatsApp = () => {
        if (customer?.phone) {
            const phone = customer.phone.replace(/[^0-9]/g, '');
            const text = `Здравствуйте, ${customer.name}. Напоминаем о задолженности по договору "${sale.productName}" в размере ${formatCurrency(realOverdueAmount, appSettings?.showCents)} ₽.`;
            window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-gradient-to-br from-slate-900/70 to-slate-800/70 backdrop-blur-sm animate-fade-in overflow-hidden" onClick={onClose}>
            <div className="bg-white dark:bg-slate-900/95 backdrop-blur w-full max-w-md rounded-3xl shadow-2xl overflow-hidden border border-white/20 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="px-6 py-5 bg-gradient-to-r from-blue-600 to-indigo-600 flex items-center gap-3 shrink-0">
                    <div className="text-white bg-white dark:bg-slate-900/20 p-2 rounded-xl">{ICONS.File}</div>
                    <h3 className="text-lg font-bold text-white">Информация о договоре</h3>
                </div>

                <div className="p-6 space-y-6">
                    <div className="grid grid-cols-2 gap-y-4 gap-x-3">
                        <div className="col-span-2 bg-slate-50 p-3 rounded-xl min-w-0">
                            <label className="text-xs text-slate-500 block mb-1">Товар</label>
                            <p className="font-bold text-slate-800 text-sm leading-tight break-words">{sale.productName}</p>
                        </div>
                        <div className="bg-slate-50 p-3 rounded-xl">
                            <label className="text-xs text-slate-500 block mb-1">Общий срок</label>
                            <p className="font-bold text-slate-800">{sale.installments} мес.</p>
                        </div>

                        <div className="bg-slate-50 p-3 rounded-xl">
                            <label className="text-xs text-slate-500 block mb-1">Оплачено</label>
                            <p className="font-bold text-emerald-600">{paidMonths} мес.</p>
                        </div>
                        <div className="bg-slate-50 p-3 rounded-xl">
                            <label className="text-xs text-slate-500 block mb-1">Просрочено</label>
                            <p className="font-bold text-red-600">{overdueMonths} платежей</p>
                        </div>

                        <div className="bg-slate-50 p-3 rounded-xl">
                            <label className="text-xs text-slate-500 block mb-1">Ежемесячный платёж</label>
                            <p className="font-bold text-slate-800 text-sm">{formatCurrency(monthlyPayment, appSettings?.showCents)} ₽</p>
                        </div>
                        <div className="bg-slate-50 p-3 rounded-xl">
                            <label className="text-xs text-slate-500 block mb-1">След. платеж</label>
                            <p className="font-bold text-indigo-600 text-sm">{nextPaymentDate}</p>
                        </div>

                        <div className="col-span-2 bg-gradient-to-r from-red-50 to-orange-50 p-4 rounded-xl border border-red-100 mt-2">
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-red-600 font-medium">Сумма просрочки</label>
                                <p className="font-bold text-red-600 text-xl">{formatCurrency(realOverdueAmount, appSettings?.showCents)} ₽</p>
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <label className="text-xs text-slate-600 font-medium">Общий остаток</label>
                                <p className="font-bold text-slate-800">{formatCurrency(sale.remainingAmount, appSettings?.showCents)} ₽</p>
                            </div>
                        </div>
                    </div>

                    {overduePaymentsList.length > 0 && (
                        <div className="bg-slate-50 p-4 rounded-xl">
                            <label className="text-xs font-medium text-slate-500 block mb-3">Пропущенные платежи</label>
                            <div className="space-y-2 max-h-32 overflow-y-auto pr-2">
                                {overduePaymentsList.map(p => (
                                    <div key={p.id} className="flex justify-between items-center bg-white dark:bg-slate-900 p-2 rounded-lg min-w-0">
                                        <span className="text-red-600 font-medium text-sm">{formatDate(p.date)}</span>
                                        <span className="text-slate-400 text-xs bg-slate-100 px-2 py-1 rounded-full">{formatCurrency(p.amount, appSettings?.showCents)} ₽</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-4 bg-gradient-to-r from-slate-50 to-white border-t border-slate-100 flex gap-3 shrink-0">
                    <button onClick={handleCall} className="flex-1 py-3.5 bg-blue-600 text-white rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-blue-700 transition-all hover:shadow-lg active:scale-95">
                        <Phone size={18} /> <span>Позвонить</span>
                    </button>
                    <button onClick={handleWhatsApp} className="flex-1 py-3.5 bg-emerald-600 text-white rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-emerald-700 transition-all hover:shadow-lg active:scale-95">
                        {ICONS.Send} <span>Написать</span>
                    </button>
                </div>

                <button onClick={onClose} className="w-full py-3 text-slate-400 text-sm hover:text-slate-600 hover:bg-slate-50 transition-colors shrink-0">Закрыть</button>
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

  const [menuPosition, setMenuPosition] = useState<{ top: number, right: number } | null>(null);
  const [currentMenuSale, setCurrentMenuSale] = useState<Sale | null>(null);

  const getCustomerName = (id: string) => customers.find(c => c.id === id)?.name || 'Неизвестно';

  const calculateSaleOverdue = (sale: Sale) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let expectedTotal = sale.downPayment;
    sale.paymentPlan.forEach(p => {
        if (!p.isRealPayment && new Date(p.date) < today) {
            expectedTotal += p.amount;
        }
    });

    const totalPaid = sale.totalAmount - sale.remainingAmount;
    return Math.max(0, expectedTotal - totalPaid);
  };

  const { filteredList } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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
        if (calculateSaleOverdue(sale) > 0) overdue.push(sale);
        else active.push(sale);
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

    if (filterDate) list = list.filter(sale => sale.startDate.startsWith(filterDate));
    if (filterAccountId) list = list.filter(sale => sale.accountId === filterAccountId);

    return {
        filteredList: list.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()),
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

  const handleActionClick = (e: React.MouseEvent, sale: Sale) => {
      e.stopPropagation();

      if (activeMenuId === sale.id) {
          setActiveMenuId(null);
          setMenuPosition(null);
          setCurrentMenuSale(null);
          return;
      }

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const menuHeight = 240;
      const spaceBelow = window.innerHeight - rect.bottom;

      const topPosition = spaceBelow < menuHeight
          ? rect.top + window.scrollY - menuHeight + 30
          : rect.bottom + window.scrollY + 8;

      setMenuPosition({
          top: topPosition,
          right: window.innerWidth - rect.right
      });

      setActiveMenuId(sale.id);
      setCurrentMenuSale(sale);
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
                    <td style="text-align: center;">${formatDate(p.date)}</td>
                    <td style="text-align: center;">${formatCurrency(p.amount, appSettings?.showCents)} ₽</td>
                    <td style="text-align: center;">${formatCurrency(displayDebt, appSettings?.showCents)} ₽</td>
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
        </html>
      `;

      printWindow.document.write(htmlContent);
      printWindow.document.close();
  };

  const ActionMenu = () => {
      if (!currentMenuSale || !menuPosition) return null;

      return (
          <div
              className="absolute bg-white dark:bg-slate-900/95 backdrop-blur-xl shadow-2xl rounded-2xl z-[100] w-56 overflow-hidden animate-scale-in border border-slate-100"
              style={{
                  top: `${menuPosition.top}px`,
                  right: `${menuPosition.right}px`
              }}
              onClick={e => e.stopPropagation()}
          >
              <button onClick={() => { setSelectedSaleForInfo(currentMenuSale); setActiveMenuId(null); }} className="w-full text-left px-4 py-3.5 text-sm text-slate-700 hover:bg-blue-50 flex items-center gap-3 transition-colors">
                <span className="text-blue-500">{ICONS.File}</span> Инфо о договоре
              </button>
              <button onClick={() => { onViewSchedule(currentMenuSale); setActiveMenuId(null); }} className="w-full text-left px-4 py-3.5 text-sm text-slate-700 hover:bg-indigo-50 flex items-center gap-3 transition-colors">
                <span className="text-indigo-500">{ICONS.List}</span> График
              </button>
              <button onClick={() => { onEditSale(currentMenuSale); setActiveMenuId(null); }} className="w-full text-left px-4 py-3.5 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors">
                <span className="text-slate-500">{ICONS.Edit}</span> Редактировать
              </button>
              <button onClick={() => { printContract(currentMenuSale); setActiveMenuId(null); }} className="w-full text-left px-4 py-3.5 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors">
                <span className="text-slate-500">{ICONS.File}</span> Печать
              </button>
              <button onClick={() => { setDeletingSale(currentMenuSale); setActiveMenuId(null); }} className="w-full text-left px-4 py-3.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors border-t border-slate-100">
                <span>{ICONS.Delete}</span> Удалить
              </button>
          </div>
      );
  };

  useEffect(() => {
      const handleClickOutside = () => {
          if (activeMenuId) {
              setActiveMenuId(null);
              setMenuPosition(null);
              setCurrentMenuSale(null);
          }
      };

      if (activeMenuId) {
          document.addEventListener('click', handleClickOutside);
      }

      return () => {
          document.removeEventListener('click', handleClickOutside);
      };
  }, [activeMenuId]);

  return (
    <div className="space-y-6 pb-20 w-full max-w-7xl mx-auto px-4 overflow-x-hidden" onClick={() => setActiveMenuId(null)}>
      {activeTab !== 'OVERDUE' && (
        <div className="flex justify-between items-center mb-2">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent min-w-0">
                <h2 className="text-3xl font-bold truncate">{getTabTitle()}</h2>
                <p className="text-slate-500 text-sm mt-1">Найдено: {filteredList.length}</p>
            </div>
        </div>
      )}

       {activeTab === 'OVERDUE' && (
          <div className="bg-gradient-to-br from-red-50 via-white to-orange-50 border border-red-200 p-6 rounded-3xl shadow-lg animate-fade-in mb-4 overflow-hidden">
              <div className="flex justify-between items-start">
                  <div className="min-w-0">
                      <h2 className="text-2xl font-bold text-slate-800 mb-1 truncate">Просроченные договоры</h2>
                      <p className="text-slate-500 text-xs uppercase font-bold tracking-wide">Всего договоров: {filteredList.length}</p>
                  </div>
                  <div className="bg-gradient-to-br from-red-400 to-red-500 p-3 rounded-2xl text-white shadow-lg shrink-0">
                      {ICONS.Alert}
                  </div>
              </div>
              <div className="mt-6 pt-4 border-t border-red-200">
                  <p className="text-xs text-slate-500 font-medium mb-2">Общая сумма просрочки (по факту)</p>
                  <p className="text-4xl font-bold bg-gradient-to-r from-red-600 to-orange-600 bg-clip-text text-transparent">{formatCurrency(totalOverdueSum, appSettings?.showCents)} ₽</p>
              </div>
          </div>
        )}

      <div className="bg-white dark:bg-slate-900/80 backdrop-blur p-5 rounded-2xl shadow-lg border border-slate-100 space-y-4 overflow-hidden">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="relative group min-w-0">
                  <span className="absolute left-4 top-3.5 text-slate-400 scale-90 group-focus-within:text-blue-500 transition-colors shrink-0">{ICONS.Users}</span>
                  <input
                    type="text"
                    placeholder="Поиск по имени или товару..."
                    className="w-full pl-12 p-3.5 border border-slate-200 dark:border-slate-700 rounded-xl outline-none text-sm focus:border-blue-500 bg-white dark:bg-slate-900/90 text-slate-900 transition-all group-focus-within:shadow-md"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                  />
              </div>
              <div className="relative group min-w-0">
                  <input
                      type="date"
                      className="w-full pl-4 sm:pl-12 p-3 sm:p-3.5 border border-slate-200 dark:border-slate-700 rounded-xl outline-none text-sm text-slate-900 bg-white dark:bg-slate-900/90 focus:border-blue-500 transition-all group-focus-within:shadow-md"
                      value={filterDate}
                      onChange={e => setFilterDate(e.target.value)}
                  />
              </div>
              <div className="relative group min-w-0">
                  <span className="absolute left-4 top-3.5 text-slate-400 scale-75 group-focus-within:text-blue-500 transition-colors shrink-0">{ICONS.Wallet}</span>
                  <select
                      className="w-full pl-12 p-3.5 border border-slate-200 dark:border-slate-700 rounded-xl outline-none text-sm text-slate-900 bg-white dark:bg-slate-900/90 focus:border-blue-500 transition-all group-focus-within:shadow-md appearance-none"
                      value={filterAccountId}
                      onChange={e => setFilterAccountId(e.target.value)}
                  >
                      <option value="">Все счета / Инвесторы</option>
                      {accounts.map(acc => (<option key={acc.id} value={acc.id}>{acc.name}</option>))}
                  </select>
              </div>
          </div>
      </div>

      <div className="space-y-4 pt-4 overflow-hidden relative">
        {filteredList.length === 0 ? (
            <div className="text-center py-16 bg-white dark:bg-slate-900/80 backdrop-blur rounded-3xl border border-dashed border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="text-slate-300 text-6xl mb-4">📄</div>
                <p className="text-slate-400 text-lg">Ничего не найдено</p>
            </div>
        ) : (
        filteredList.map((sale, index) => {
            const progress = sale.totalAmount > 0 ? ((sale.totalAmount - sale.remainingAmount) / sale.totalAmount) * 100 : 0;
            let statusLabel = 'АКТИВНО';
            let statusColor = 'bg-blue-100 text-blue-700';
            if (sale.status === 'COMPLETED') {
                statusLabel = 'ЗАКРЫТО';
                statusColor = 'bg-slate-100 text-slate-600';
            }
            if (activeTab === 'OVERDUE') {
                statusLabel = 'ПРОСРОЧЕНО';
                statusColor = 'bg-red-100 text-red-700';
            }

            const displayNumber = filteredList.length - index;
            const overdueSum = calculateSaleOverdue(sale);

            return (
              <div
                key={sale.id}
                className="bg-white dark:bg-slate-900/95 backdrop-blur rounded-2xl shadow-sm p-4 sm:p-5 relative animate-fade-in transition-all hover:shadow-md border border-slate-100"
              >
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 mb-4">

                  <div className="flex items-start gap-3 flex-1">
                    <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-lg flex items-center justify-center text-white font-bold text-xs shadow-sm shrink-0 mt-1">
                      {displayNumber}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-slate-800 text-base leading-tight break-words pr-2">
                          {getCustomerName(sale.customerId)}
                      </h3>
                      <p className="text-sm text-slate-500 break-words mt-1 leading-snug">{sale.productName}</p>
                      <p className="text-xs text-slate-400 mt-2 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-slate-300 rounded-full shrink-0"></span>
                        <span>Оформлен: {formatDate(sale.startDate)}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center sm:items-start justify-between sm:justify-end gap-4 w-full sm:w-auto border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-100">
                    <div className="text-left sm:text-right flex-1 sm:flex-none">
                      <span className={`inline-block px-2.5 py-1 text-[11px] font-bold tracking-wider rounded-md uppercase ${statusColor}`}>
                          {statusLabel}
                      </span>
                      {activeTab === 'OVERDUE' ? (
                          <p className="text-sm font-bold text-red-600 mt-1.5">{formatCurrency(overdueSum, appSettings?.showCents)} ₽</p>
                      ) : (
                          <p className="text-sm font-semibold mt-1.5 text-slate-700">{formatCurrency(sale.totalAmount, appSettings?.showCents)} ₽</p>
                      )}
                    </div>

                    {!readOnly && (
                        <button
                          onClick={(e) => handleActionClick(e, sale)}
                          className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all shrink-0 -mt-1 sm:mt-0"
                        >
                          {ICONS.More}
                        </button>
                    )}
                  </div>
                </div>

                <div className="w-full bg-slate-100 rounded-full h-2 mt-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${activeTab === 'OVERDUE' ? 'bg-gradient-to-r from-red-500 to-orange-400' : 'bg-gradient-to-r from-blue-500 to-indigo-500'}`}
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
                <div className="flex justify-between text-[11px] mt-2 font-medium">
                  <span className="text-slate-500">Оплачено: <span className="text-emerald-600">{formatCurrency(sale.totalAmount - sale.remainingAmount, appSettings?.showCents)} ₽</span></span>
                  {activeTab !== 'OVERDUE' && (
                    <span className="text-slate-500">Остаток: <span className="text-slate-700">{formatCurrency(sale.remainingAmount, appSettings?.showCents)} ₽</span></span>
                  )}
                </div>
              </div>
            )
        }))}
      </div>

        {activeMenuId && menuPosition && createPortal(
            <ActionMenu />,
            document.body
        )}

        {deletingSale && !readOnly && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gradient-to-br from-slate-900/70 to-slate-800/70 backdrop-blur-sm animate-fade-in overflow-hidden" onClick={() => setDeletingSale(null)}>
                <div className="bg-white dark:bg-slate-900/95 backdrop-blur w-full max-w-sm p-8 rounded-3xl shadow-2xl border border-white/20" onClick={e => e.stopPropagation()}>
                    <div className="w-16 h-16 bg-gradient-to-br from-red-400 to-red-500 text-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shrink-0">
                      {ICONS.Delete}
                    </div>
                    <h3 className="text-xl font-bold text-slate-800 text-center mb-2">Удалить договор?</h3>
                    <p className="text-center text-slate-500 mb-8 text-sm">Это действие необратимо. Будут удалены все записи о платежах и расходах (закуп), а товар вернется на склад. Вы уверены?</p>
                    <div className="flex gap-3">
                        <button onClick={() => setDeletingSale(null)} className="flex-1 py-3.5 bg-slate-100 rounded-xl font-medium text-slate-600 hover:bg-slate-200 transition-all active:scale-95">
                            Отмена
                        </button>
                        <button onClick={handleDeleteConfirm} className="flex-1 py-3.5 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-xl font-bold hover:from-red-600 hover:to-red-700 transition-all active:scale-95 shadow-lg shadow-red-200">
                            Удалить
                        </button>
                    </div>
                </div>
            </div>
        )}

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