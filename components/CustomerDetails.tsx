
import React, { useState, useMemo, useEffect } from 'react';
import { Customer, Sale, Payment, Account, Investor } from '../types';
import { ICONS } from '../constants';

interface CustomerDetailsProps {
  customer: Customer;
  sales: Sale[];
  accounts: Account[]; // Added
  investors: Investor[]; // Added
  onBack: () => void;
  onInitiatePayment: (sale: Sale, payment: Payment) => void;
  onUndoPayment?: (saleId: string, paymentId: string) => void;
  onEditPayment?: (saleId: string, paymentId: string, newDate: string) => void;
  onUpdateCustomer?: (customer: Customer) => void;
  initialSaleId?: string | null;
}

const EditCustomerModal = ({ customer, onClose, onUpdate }: { customer: Customer, onClose: () => void, onUpdate: (c: Customer) => void }) => {
    const [name, setName] = useState(customer.name);
    const [phone, setPhone] = useState(customer.phone);
    const [address, setAddress] = useState(customer.address || '');
    const [notes, setNotes] = useState(customer.notes || '');
    const [allowWhatsapp, setAllowWhatsapp] = useState(customer.allowWhatsappNotification !== false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onUpdate({
            ...customer,
            name,
            phone,
            address,
            notes,
            allowWhatsappNotification: allowWhatsapp
        });
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl p-5" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-slate-800 mb-4">Редактировать клиента</h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">ФИО</label>
                        <input className="w-full p-3 border border-slate-200 rounded-xl outline-none" value={name} onChange={e => setName(e.target.value)} required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Телефон</label>
                        <input className="w-full p-3 border border-slate-200 rounded-xl outline-none" value={phone} onChange={e => setPhone(e.target.value)} required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Адрес</label>
                        <input className="w-full p-3 border border-slate-200 rounded-xl outline-none" value={address} onChange={e => setAddress(e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Заметки</label>
                        <textarea className="w-full p-3 border border-slate-200 rounded-xl outline-none resize-none" rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
                    </div>
                    
                    {/* WhatsApp Setting */}
                    <div className="flex items-center justify-between bg-emerald-50 p-3 rounded-xl border border-emerald-100">
                        <div className="flex items-center gap-2">
                            <span className="text-emerald-600">{ICONS.Send}</span>
                            <div>
                                <p className="text-sm font-bold text-slate-800">Напоминания WhatsApp</p>
                                <p className="text-xs text-slate-500">Авто-отправка сообщений</p>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" checked={allowWhatsapp} onChange={() => setAllowWhatsapp(!allowWhatsapp)} className="sr-only peer" />
                            <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                        </label>
                    </div>

                    <div className="flex gap-3 mt-4">
                        <button type="button" onClick={onClose} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold">Отмена</button>
                        <button type="submit" className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold">Сохранить</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const CustomerDetails: React.FC<CustomerDetailsProps> = ({ 
    customer, sales, accounts, investors, onBack, onInitiatePayment, onUndoPayment, onEditPayment, onUpdateCustomer, initialSaleId
}) => {
  const [activeTab, setActiveTab] = useState<'INFO' | 'INSTALLMENTS'>('INFO');
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [editDate, setEditDate] = useState('');
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);

  useEffect(() => {
    if (initialSaleId) {
      setSelectedSaleId(initialSaleId);
      setActiveTab('INSTALLMENTS');
    }
  }, [initialSaleId]);

  const customerSales = sales.filter(s => s.customerId === customer.id);
  const selectedSale = customerSales.find(s => s.id === selectedSaleId);

  const handleEditClick = (payment: Payment) => { setEditingPayment(payment); setEditDate(payment.date ? new Date(payment.date).toISOString().split('T')[0] : ''); };
  const saveEdit = () => { if (selectedSale && editingPayment && editDate && onEditPayment) { onEditPayment(selectedSale.id, editingPayment.id, editDate); setEditingPayment(null); } };
  const handleDeleteClick = (paymentId: string) => { setDeletingPaymentId(paymentId); }
  const confirmDelete = () => { if (selectedSale && deletingPaymentId && onUndoPayment) { onUndoPayment(selectedSale.id, deletingPaymentId); setDeletingPaymentId(null); } }

  const handleSendSaleReminder = () => {
      if (!selectedSale) return;
      const upcomingPayments = selectedSale.paymentPlan.filter(p => !p.isPaid).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const nextPayment = upcomingPayments[0];
      
      const message = `
Здравствуйте, ${customer.name}!

Напоминание по вашей рассрочке на "${selectedSale.productName}".

*Детали:*
- *Общая сумма:* ${selectedSale.totalAmount.toLocaleString()} ₽
- *Уже оплачено:* ${(selectedSale.totalAmount - selectedSale.remainingAmount).toLocaleString()} ₽
- *Остаток долга:* *${selectedSale.remainingAmount.toLocaleString()} ₽*

${nextPayment ? `- *Ближайший платеж:* ${nextPayment.amount.toLocaleString()} ₽ до ${new Date(nextPayment.date).toLocaleDateString()}` : ''}

С уважением,
Команда InstallMate.
      `.trim().replace(/^\s+/gm, '');

      const phone = customer.phone.replace(/[^0-9]/g, '');
      const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
      window.open(url, '_blank');
  };

  const handleSendFullReport = () => {
      let report = `Здравствуйте, ${customer.name}!\n\nВаш полный отчет по всем рассрочкам в InstallMate:\n\n`;
      customerSales.forEach((sale, index) => {
          report += `*Рассрочка №${index + 1}: ${sale.productName}*\n`;
          report += ` - Статус: ${sale.remainingAmount === 0 ? '✅ Закрыто' : '⏳ Активно'}\n`;
          report += ` - Остаток долга: *${sale.remainingAmount.toLocaleString()} ₽*\n`;
          report += ` - Всего выплачено: ${(sale.totalAmount - sale.remainingAmount).toLocaleString()} ₽\n\n`;
      });
      report += `Спасибо, что выбираете нас!`;
      const phone = customer.phone.replace(/[^0-9]/g, '');
      const url = `https://wa.me/${phone}?text=${encodeURIComponent(report)}`;
      window.open(url, '_blank');
  };

  const { paidPayments, paymentSchedule } = useMemo(() => {
    if (!selectedSale || !selectedSale.paymentPlan) return { paidPayments: [], paymentSchedule: [] };

    // 1. History: Show Real Payments (for new data) OR Paid Plan Items (for legacy data)
    const paidPayments = selectedSale.paymentPlan
      .filter(p => p.isPaid && p.isRealPayment !== false)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // 2. Schedule Calculation
    // Calculate total money actually received (Real Payments)
    const totalRealMoney = selectedSale.paymentPlan
      .filter(p => p.isRealPayment === true)
      .reduce((sum, p) => sum + p.amount, 0);

    // Calculate total plan amount already marked as paid
    const totalAllocated = selectedSale.paymentPlan
      .filter(p => p.isPaid && p.isRealPayment !== true) // Plan items (false or undefined)
      .reduce((sum, p) => sum + p.amount, 0);

    // Determine surplus (money received but not yet allocated to a specific plan item)
    // For legacy data, totalRealMoney is 0, so surplus is 0.
    let surplus = Math.max(0, totalRealMoney - totalAllocated);

    const scheduled = selectedSale.paymentPlan
      .filter(p => !p.isPaid && p.isRealPayment !== true) // Unpaid Plan Items
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const scheduleForDisplay = scheduled.map(p => {
      const amountDue = p.amount;
      const covered = Math.min(amountDue, surplus);
      surplus = Math.max(0, surplus - covered);

      return {
        ...p,
        amountToPay: amountDue - covered,
      };
    }).filter(p => p.amountToPay > 0.01);

    return {
        paidPayments,
        paymentSchedule: scheduleForDisplay
    };
  }, [selectedSale]);

  const getInvestorInfo = (sale: Sale) => {
      const account = accounts.find(a => a.id === sale.accountId);
      if (account && account.type === 'INVESTOR' && account.ownerId) {
          const investor = investors.find(i => i.id === account.ownerId);
          return investor ? investor.name : null;
      }
      return null;
  };

  if (selectedSale) {
      const paidAmount = selectedSale.totalAmount - selectedSale.remainingAmount;
      const profit = selectedSale.buyPrice > 0 ? selectedSale.totalAmount - selectedSale.buyPrice : 0;
      const monthlyProfit = selectedSale.installments > 0 && profit > 0 ? profit / selectedSale.installments : 0;
      const firstPaymentDate = selectedSale.paymentPlan.length > 0 ? selectedSale.paymentPlan[0].date : null;
      
      return (
          <div className="space-y-4 animate-fade-in pb-20 relative">
              <div className="flex items-center justify-between border-b border-slate-200 pb-4 bg-white sticky top-0 z-10 pt-2">
                  <div className="flex items-center gap-3">
                    <button onClick={() => setSelectedSaleId(null)} className="text-slate-500 hover:text-slate-800">{ICONS.Back}</button>
                    <h2 className="text-xl font-bold text-slate-800 truncate">{selectedSale.productName}</h2>
                  </div>
                  <button onClick={handleSendSaleReminder} className="bg-emerald-50 text-emerald-600 px-3 py-2 rounded-lg font-semibold text-sm flex items-center gap-2">
                      {ICONS.Send} WhatsApp
                  </button>
              </div>

              <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 space-y-3">
                  {firstPaymentDate && (
                      <div className="flex justify-between border-b border-slate-50 pb-2">
                          <span className="text-slate-500">Первый платеж</span>
                          <span className="font-medium text-slate-800">{new Date(firstPaymentDate).toLocaleDateString()}</span>
                      </div>
                  )}
                  <div className="flex justify-between border-b border-slate-50 pb-2"><span className="text-slate-500">Цена закупа</span><span className="font-medium text-slate-800">{selectedSale.buyPrice.toLocaleString()} ₽</span></div>
                  <div className="flex justify-between border-b border-slate-50 pb-2"><span className="text-slate-500">Цена в рассрочку</span><span className="font-bold text-indigo-600">{selectedSale.totalAmount.toLocaleString()} ₽</span></div>
                  {selectedSale.downPayment > 0 && (
                     <div className="flex justify-between border-b border-slate-50 pb-2"><span className="text-slate-500">Первый взнос</span><span className="font-bold text-slate-800">{selectedSale.downPayment.toLocaleString()} ₽</span></div>
                  )}
                  <div className="flex justify-between border-b border-slate-50 pb-2"><span className="text-slate-500">Остаток долга</span><span className="font-bold text-amber-600">{selectedSale.remainingAmount.toLocaleString()} ₽</span></div>
                  <div className="flex justify-between border-b border-slate-50 pb-2"><span className="text-slate-500">Оплачено</span><span className="font-bold text-emerald-600">{paidAmount.toLocaleString()} ₽</span></div>
                  {selectedSale.guarantorName && (
                    <>
                        <div className="flex justify-between border-b border-slate-50 pb-2 pt-2"><span className="text-slate-500">Поручитель</span><span className="font-medium text-slate-800">{selectedSale.guarantorName}</span></div>
                        {selectedSale.guarantorPhone && <div className="flex justify-between border-b border-slate-50 pb-2"><span className="text-slate-500">Телефон поручителя</span><span className="font-medium text-slate-800">{selectedSale.guarantorPhone}</span></div>}
                    </>
                  )}
                  <div className="pt-2 mt-2 border-t border-slate-100 grid grid-cols-2 gap-4">
                      <div className="bg-emerald-50 p-3 rounded-xl"><p className="text-xs text-emerald-600 mb-1">Прибыль (Общ)</p><p className="font-bold text-emerald-800">{profit.toLocaleString()} ₽</p></div>
                      <div className="bg-blue-50 p-3 rounded-xl"><p className="text-xs text-blue-600 mb-1">Прибыль / мес</p><p className="font-bold text-blue-800">~{Math.round(monthlyProfit).toLocaleString()} ₽</p></div>
                  </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                  <div className="p-4 border-b border-slate-100 bg-emerald-50/50 flex justify-between items-center"><h3 className="font-bold text-emerald-800">История поступлений</h3><span className="bg-emerald-100 text-emerald-700 text-xs px-2 py-1 rounded-full font-bold">{paidPayments.length}</span></div>
                  {paidPayments.length === 0 ? <div className="p-6 text-center text-slate-400 text-sm">Нет поступлений</div> : (
                      <table className="w-full text-sm text-left">
                          <thead className="text-xs text-slate-500 uppercase bg-slate-50"><tr><th className="px-4 py-3">Дата</th><th className="px-4 py-3">Сумма</th><th className="px-4 py-3 text-right">Действия</th></tr></thead>
                          <tbody>{paidPayments.map((payment) => (<tr key={payment.id} className="border-b border-slate-50 hover:bg-slate-50"><td className="px-4 py-3 text-slate-700">{new Date(payment.date).toLocaleDateString()}</td><td className="px-4 py-3 font-bold text-emerald-600">+{payment.amount.toLocaleString()}</td><td className="px-4 py-3 text-right"><div className="flex justify-end gap-2"><button onClick={() => handleEditClick(payment)} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded">{ICONS.Edit}</button><button onClick={() => handleDeleteClick(payment.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-100 rounded">{ICONS.Delete}</button></div></td></tr>))}</tbody>
                      </table>
                  )}
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                  <div className="p-4 border-b border-slate-100 bg-slate-50"><h3 className="font-bold text-slate-700">График платежей</h3></div>
                  {paymentSchedule.length === 0 ? <div className="p-6 text-center text-slate-400 text-sm">Все оплачено! 🎉</div> : (
                      <table className="w-full text-sm text-left">
                          <thead className="text-xs text-slate-500 uppercase bg-slate-50"><tr><th className="px-4 py-3">Дата</th><th className="px-4 py-3">Осталось</th><th className="px-4 py-3">Действие</th></tr></thead>
                          <tbody>{paymentSchedule.map((payment) => (<tr key={payment.id} className="border-b border-slate-50 hover:bg-slate-50"><td className={`px-4 py-3 ${new Date(payment.date) < new Date() ? 'text-red-500 font-bold' : 'text-slate-700'}`}>{new Date(payment.date).toLocaleDateString()}</td><td className="px-4 py-3 font-bold text-slate-800">{payment.amountToPay.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td className="px-4 py-3"><button onClick={() => onInitiatePayment(selectedSale, { ...payment, amount: payment.amountToPay })} className="text-indigo-600 font-bold text-xs border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-600 hover:text-white transition-colors">Принять</button></td></tr>))}</tbody>
                      </table>
                  )}
              </div>

              {editingPayment && (<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in"><div className="bg-white w-full max-w-sm p-6 rounded-2xl shadow-xl"><h3 className="text-lg font-bold text-slate-800 mb-4">Изменить дату платежа</h3><p className="text-sm text-slate-500 mb-4">Сумма: {editingPayment.amount.toLocaleString()} ₽</p><input type="date" className="w-full p-3 border border-slate-300 rounded-xl mb-6 outline-none" value={editDate} onChange={(e) => setEditDate(e.target.value)} /><div className="flex gap-3"><button onClick={() => setEditingPayment(null)} className="flex-1 py-3 bg-slate-100 rounded-xl font-medium text-slate-600">Отмена</button><button onClick={saveEdit} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold">Сохранить</button></div></div></div>)}
              {deletingPaymentId && (<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in"><div className="bg-white w-full max-w-sm p-6 rounded-2xl shadow-xl"><div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">{ICONS.Delete}</div><h3 className="text-lg font-bold text-slate-800 text-center mb-2">Отменить платеж?</h3><p className="text-center text-slate-500 mb-6 text-sm">Сумма вернется в долг, а статус платежа изменится на "Не оплачено".</p><div className="flex gap-3"><button onClick={() => setDeletingPaymentId(null)} className="flex-1 py-3 bg-slate-100 rounded-xl font-medium text-slate-600">Нет</button><button onClick={confirmDelete} className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold">Да, отменить</button></div></div></div>)}
          </div>
      );
  }

  return (
    <div className="space-y-4 animate-fade-in pb-20">
      <div className="flex items-center gap-3 border-b border-slate-200 pb-4 bg-white sticky top-0 z-10 pt-2"><button onClick={onBack} className="text-slate-500 hover:text-slate-800">{ICONS.Back}</button><h2 className="text-xl font-bold text-slate-800">{customer.name}</h2></div>
      <div className="flex border-b border-slate-200"><button onClick={() => setActiveTab('INFO')} className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'INFO' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}>Информация</button><button onClick={() => setActiveTab('INSTALLMENTS')} className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'INSTALLMENTS' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}>Рассрочки</button></div>
      {activeTab === 'INFO' && (
          <div className="space-y-4 pt-2">
              <div className="flex justify-center"><div className="w-32 h-32 rounded-full bg-slate-200 overflow-hidden border-4 border-white shadow-lg">{customer.photo ? <img src={customer.photo} alt={customer.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-slate-400 text-4xl font-bold">{customer.name.charAt(0)}</div>}</div></div>
              
              {/* Info Card with Edit Button */}
              <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 space-y-4 relative">
                  {onUpdateCustomer && (
                      <button 
                        onClick={() => setShowEditModal(true)}
                        className="absolute top-4 right-4 p-2 bg-slate-50 rounded-full text-slate-400 hover:text-indigo-600 hover:bg-slate-100 transition-colors"
                      >
                          {ICONS.Edit}
                      </button>
                  )}
                  <div><label className="text-xs text-slate-400 uppercase">Телефон</label><p className="text-lg font-medium text-slate-800">{customer.phone}</p></div>
                  {customer.address && (
                      <div><label className="text-xs text-slate-400 uppercase">Адрес</label><p className="text-base font-medium text-slate-800">{customer.address}</p></div>
                  )}
                  <div><label className="text-xs text-slate-400 uppercase">Рейтинг доверия</label><div className="flex items-center gap-2 mt-1"><div className="flex-1 bg-slate-100 h-2 rounded-full overflow-hidden"><div className="bg-emerald-500 h-full" style={{ width: `${customer.trustScore}%` }}></div></div><span className="text-sm font-bold">{customer.trustScore}%</span></div></div>
                  <div><label className="text-xs text-slate-400 uppercase">Заметки</label><p className="text-sm text-slate-600 mt-1">{customer.notes || 'Нет заметок'}</p></div>
                  <div>
                      <label className="text-xs text-slate-400 uppercase">Напоминания WhatsApp</label>
                      <p className={`text-sm mt-1 font-bold ${customer.allowWhatsappNotification !== false ? 'text-emerald-600' : 'text-slate-400'}`}>
                          {customer.allowWhatsappNotification !== false ? 'Включены' : 'Отключены'}
                      </p>
                  </div>
              </div>

              <div className="pt-2">
                  <button onClick={handleSendFullReport} className="w-full bg-slate-800 text-white py-4 rounded-xl font-semibold flex items-center justify-center gap-2">
                      {ICONS.Send} Отправить отчет в WhatsApp
                  </button>
              </div>
          </div>
      )}
      {activeTab === 'INSTALLMENTS' && (
          <div className="space-y-3 pt-2">
              {customerSales.length === 0 && <div className="text-center py-10 text-slate-400">Нет активных рассрочек</div>}
              {customerSales.map(sale => {
                  const investorName = getInvestorInfo(sale);
                  return (
                    <div key={sale.id} onClick={() => setSelectedSaleId(sale.id)} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm active:bg-slate-50 cursor-pointer">
                        <div className="flex justify-between items-start mb-2">
                            <h3 className="font-bold text-slate-800">{sale.productName}</h3>
                            <span className={`text-xs px-2 py-1 rounded-full ${sale.remainingAmount === 0 ? 'bg-slate-100 text-slate-600' : 'bg-indigo-100 text-indigo-700'}`}>{sale.remainingAmount === 0 ? 'Закрыто' : 'Активно'}</span>
                        </div>
                        <p className="text-xs text-slate-500 mb-2">от {new Date(sale.startDate).toLocaleDateString()}</p>
                        {investorName && (
                            <div className="mb-2">
                                <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded font-bold">Инвестор: {investorName}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-sm mt-3 pt-3 border-t border-slate-100">
                            <span className="text-slate-500">Остаток:</span>
                            <span className="font-bold text-slate-800">{sale.remainingAmount.toLocaleString()} ₽</span>
                        </div>
                    </div>
                  );
              })}
          </div>
      )}

      {showEditModal && onUpdateCustomer && (
          <EditCustomerModal 
            customer={customer} 
            onClose={() => setShowEditModal(false)} 
            onUpdate={onUpdateCustomer} 
          />
      )}
    </div>
  );
};

export default CustomerDetails;
