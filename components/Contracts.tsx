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
    const overduePaymentsList = sale.paymentPlan.filter(p => !p.isPaid && new Date(p.date) < today);
    const overdueMonths = overduePaymentsList.length;

    // Calculate actual overdue amount: Sum of all unpaid payments in the past
    const actualOverdueAmount = overduePaymentsList.reduce((sum, p) => sum + p.amount, 0);

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
            const text = `Здравствуйте, ${customer.name}. Напоминаем о задолженности по договору "${sale.productName}" в размере ${actualOverdueAmount.toLocaleString()} ₽.`;
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
                            <p className="font-bold text-red-600">{overdueMonths} мес.</p>
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
                                <label className="text-xs text-slate-500 block">Сумма просрочки</label>
                                <p className="font-bold text-red-600 text-xl">{actualOverdueAmount.toLocaleString()} ₽</p>
                            </div>
                            <div className="flex justify-between items-center mt-1">
                                <label className="text-xs text-slate-500 block">Общий остаток</label>
                                <p className="font-bold text-slate-800">{sale.remainingAmount.toLocaleString()} ₽</p>
                            </div>
                        </div>
                    </div>

                    {/* Overdue Dates */}
                    {overduePaymentsList.length > 0 && (
                        <div className="max-h-32 overflow-y-auto pr-2">
                            <label className="text-xs text-slate-500 block mb-2 sticky top-0 bg-white">Просроченные даты</label>
                            <div className="space-y-1">
                                {overduePaymentsList.map(p => (
                                    <div key={p.id} className="flex justify-between text-sm">
                                        <span className="text-red-600 font-medium">{new Date(p.date).toLocaleDateString()}</span>
                                        <span className="text-slate-700 font-bold">{p.amount.toLocaleString()} ₽</span>
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

  // Helper to calculate accurate overdue amount: SUM of unpaid payments strictly in the past
  const calculateSaleOverdue = (sale: Sale) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      return sale.paymentPlan
          .filter(p => !p.isPaid && new Date(p.date) < today)
          .reduce((sum, p) => sum + p.amount, 0);
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

      // Filter ONLY REAL PAID PAYMENTS
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
            <title>Договор купли-продажи</title>
            <style>
                body { 
                    font-family: 'Times New Roman', serif; 
                    font-size: 12pt; 
                    line-height: 1.5; 
                    padding: 40px;
                    padding-bottom: 150px; 
                }
                h1 { text-align: center; font-size: 16pt; font-weight: bold; margin-bottom: 30px; text-transform: uppercase; }
                .header-info { text-align: right; margin-bottom: 20px; }
                .field-row { display: flex; justify-content: space-between; margin-bottom: 10px; }
                .field-label { font-weight: bold; }
                .section { margin: 20px 0; }
                table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                th, td { border: 1px solid #000; padding: 5px 10px; font-size: 11pt; }
                
                .footer { 
                    display: flex; 
                    justify-content: space-between; 
                    align-items: flex-end;
                }
                
                .signature-block { 
                    text-align: center;
                }
                .signature-line { 
                    border-bottom: 1px solid #000; 
                    margin-top: 40px; 
                    margin-bottom: 5px;
                }
                .signature-label {
                    font-size: 10pt;
                    font-style: italic;
                }

                @media print {
                    @page { margin: 1.0cm; size: A4; }
                    .footer-container {
                        position: fixed;
                        bottom: 0;
                        left: 0;
                        width: 100%;
                        background: white;
                        padding-top: 20px;
                    }
                }
            </style>
        </head>
        <body>
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
                        <th>№</th>
                        <th>Дата</th>
                        <th>Сумма</th>
                        <th>Остаток долга</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>

            <div style="margin-top: 20px;">
                Продавец обязуется передать Покупателю товар, а Покупатель обязуется принять и оплатить его в рассрочку.
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
                window.onload = function() { window.print(); }
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
                  <p className="text-xs text-slate-400 font-medium mb-1">Сумма просрочки (только платежи)</p>
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
                          <p className="text-sm font-bold text-red-600 mt-1">Просрочено: {overdueSum.toLocaleString()} ₽</p>
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
                <div className="flex justify-between text-xs text-slate-400 mt-1"><span>Оплачено: {(sale.totalAmount - sale.remainingAmount).toLocaleString()} ₽</span><span>Остаток: {sale.remainingAmount.toLocaleString()} ₽</span></div>

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