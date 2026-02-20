import React, { useState, useEffect, useMemo } from 'react';
import { Customer, Account, Investor, Sale } from '../types';
import { ICONS } from '../constants';
import { getAppSettings } from '../services/storage';
import { sendWhatsAppMessage } from '../services/whatsapp';

interface NewIncomeProps {
  initialData?: any;
  customers: Customer[];
  investors: Investor[];
  accounts: Account[];
  sales: Sale[];
  onClose: () => void;
  onSubmit: (data: any) => void;
  onSelectCustomer: () => void;
}

const NewIncome: React.FC<NewIncomeProps> = ({ 
    initialData, customers, investors, accounts, sales, onClose, onSubmit, onSelectCustomer 
}) => {
  const [sourceType, setSourceType] = useState<'CUSTOMER' | 'INVESTOR' | 'OTHER'>('CUSTOMER');
  
  const [selectedCustomerId, setSelectedCustomerId] = useState(initialData?.customerId || '');
  const [selectedSaleId, setSelectedSaleId] = useState('');
  const [selectedInvestorId, setSelectedInvestorId] = useState('');
  const [targetAccountId, setTargetAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  
  // New Features State
  const [sendHistory, setSendHistory] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const selectedCustomer = useMemo(() => customers.find(c => c.id === selectedCustomerId), [customers, selectedCustomerId]);
  const activeCustomerSales = useMemo(() => sales.filter(s => s.customerId === selectedCustomerId && s.remainingAmount > 0), [sales, selectedCustomerId]);
  const selectedSale = useMemo(() => sales.find(s => s.id === selectedSaleId), [sales, selectedSaleId]);
  const selectedInvestor = useMemo(() => investors.find(i => i.id === selectedInvestorId), [investors, selectedInvestorId]);
  const appSettings = getAppSettings();

  useEffect(() => {
    if (initialData?.type === 'CUSTOMER_PAYMENT') {
        setSourceType('CUSTOMER');
        setSelectedCustomerId(initialData.customerId || '');
        setSelectedSaleId(initialData.saleId || '');
        setAmount(initialData.amount?.toString() || '');
    }
  }, [initialData]);

  useEffect(() => {
      if (selectedSale) {
          const paidTotal = selectedSale.paymentPlan
              .filter(p => p.isPaid)
              .reduce((sum, p) => sum + p.amount, 0);

          const scheduledPayments = selectedSale.paymentPlan
              .filter(p => !p.isPaid)
              .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
          
          let paymentPool = paidTotal;
          let suggestedAmount = selectedSale.remainingAmount;

          for (const p of scheduledPayments) {
              const paymentDue = p.amount;
              const coveredByPool = Math.min(paymentDue, paymentPool);
              paymentPool -= coveredByPool;
              const remainingForThisInstallment = paymentDue - coveredByPool;
              if (remainingForThisInstallment > 0.01) {
                  suggestedAmount = remainingForThisInstallment;
                  break;
              }
          }
          
          if (!amount) { // Only set amount if it's not already set by the user
              setAmount(suggestedAmount > 0 ? suggestedAmount.toFixed(2) : '');
          }
          setTargetAccountId(selectedSale.accountId);
      }
  }, [selectedSale]);

  useEffect(() => {
      if (selectedInvestor) {
          const invAccount = accounts.find(a => a.ownerId === selectedInvestor.id);
          if (invAccount) setTargetAccountId(invAccount.id);
      }
  }, [selectedInvestor, accounts]);

  useEffect(() => {
      if (sourceType === 'OTHER' && accounts.length > 0 && !targetAccountId) {
          setTargetAccountId(accounts[0].id);
      }
  }, [sourceType, accounts, targetAccountId]);
  
  const recommendedAmount = useMemo(() => {
      if (selectedSale) {
          const paidTotal = selectedSale.paymentPlan.filter(p => p.isPaid).reduce((sum, p) => sum + p.amount, 0);
          const scheduledPayments = selectedSale.paymentPlan.filter(p => !p.isPaid).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
          let paymentPool = paidTotal;
          for (const p of scheduledPayments) {
              const paymentDue = p.amount;
              const coveredByPool = Math.min(paymentDue, paymentPool);
              paymentPool -= coveredByPool;
              const remainingForThisInstallment = paymentDue - coveredByPool;
              if (remainingForThisInstallment > 0.01) {
                  return remainingForThisInstallment;
              }
          }
          return selectedSale.remainingAmount;
      }
      return 0;
  }, [selectedSale]);

  const currentPaymentProfit = useMemo(() => {
      if (!selectedSale || !amount) return 0;
      const numAmount = Number(amount);
      if (selectedSale.totalAmount <= 0) return 0;
      
      const totalProfit = selectedSale.totalAmount - selectedSale.buyPrice;
      const margin = totalProfit / selectedSale.totalAmount;
      
      return numAmount * margin;
  }, [selectedSale, amount]);

  const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      const numAmount = Number(amount);
      if (numAmount <= 0) { alert("Введите сумму больше нуля"); return; }

      // Validate inputs before showing modal
      if (sourceType === 'CUSTOMER' && !selectedSaleId) { alert("Выберите договор"); return; }
      if (sourceType === 'INVESTOR' && (!selectedInvestorId || !targetAccountId)) { alert("Ошибка выбора инвестора или счета"); return; }
      if (sourceType === 'OTHER' && !targetAccountId) { alert("Выберите счет"); return; }

      setShowConfirmModal(true);
  };

  const handleConfirm = async () => {
      const numAmount = Number(amount);
      const commonData = { amount: numAmount, date };

      // Process Submission
      if (sourceType === 'CUSTOMER') {
          onSubmit({ ...commonData, type: 'CUSTOMER_PAYMENT', saleId: selectedSaleId, accountId: targetAccountId });
          
          // Process WhatsApp Sending if enabled
          if (sendHistory && selectedSale && selectedCustomer && appSettings.whatsapp?.enabled) {
              const newRemaining = Math.max(0, selectedSale.remainingAmount - numAmount);
              const message = `
Здравствуйте, ${selectedCustomer.name}!

✅ *Оплата получена*
Сумма: ${numAmount.toLocaleString()} ₽
Дата: ${new Date(date).toLocaleDateString()}

📄 Договор: ${selectedSale.productName}
💰 Остаток долга: *${newRemaining.toLocaleString()} ₽*

Спасибо, что вы с нами!
${appSettings.companyName}
              `.trim();
              
              const success = await sendWhatsAppMessage(
                  appSettings.whatsapp.idInstance,
                  appSettings.whatsapp.apiTokenInstance,
                  selectedCustomer.phone,
                  message
              );
              if (success) alert("Уведомление отправлено клиенту в WhatsApp");
          }

      } else if (sourceType === 'INVESTOR') {
          onSubmit({ ...commonData, type: 'INVESTOR_DEPOSIT', investorId: selectedInvestorId, accountId: targetAccountId, note: "Пополнение от инвестора" });
      } else {
          onSubmit({ ...commonData, type: 'OTHER_INCOME', accountId: targetAccountId, note: note || "Прочий приход" });
      }
      
      setShowConfirmModal(false);
  };

  const getAccountName = (id: string) => accounts.find(a => a.id === id)?.name || 'Неизвестный счет';

  return (
    <div className="space-y-4 animate-fade-in pb-20">
      <div className="flex items-center gap-3 border-b border-slate-200 pb-4 bg-white sticky top-0 z-10 pt-2">
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800">{ICONS.Back}</button>
          <h2 className="text-xl font-bold text-slate-800">Оформление прихода</h2>
      </div>

      <div className="flex bg-slate-100 p-1 rounded-xl">
          <button onClick={() => { setSourceType('CUSTOMER'); setAmount(''); }} className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${sourceType === 'CUSTOMER' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>Клиент</button>
          <button onClick={() => { setSourceType('INVESTOR'); setAmount(''); }} className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${sourceType === 'INVESTOR' ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-500'}`}>Инвестор</button>
          <button onClick={() => { setSourceType('OTHER'); setAmount(''); }} className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${sourceType === 'OTHER' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}>Прочее</button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
          {sourceType === 'CUSTOMER' && (
              <div className="space-y-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm animate-fade-in">
                   <div>
                       <label className="block text-sm font-medium text-slate-700 mb-1">Клиент</label>
                       <div onClick={onSelectCustomer} className={`w-full p-3 border rounded-xl cursor-pointer flex justify-between items-center ${selectedCustomerId ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-dashed border-slate-300'}`}>
                            <div className="flex items-center gap-2">
                                {selectedCustomerId && <div className="text-indigo-600">{ICONS.Customers}</div>}
                                <span className={selectedCustomerId ? 'text-slate-800 font-bold' : 'text-slate-400'}>{selectedCustomer ? selectedCustomer.name : 'Нажмите для выбора...'}</span>
                            </div>
                            <span className="text-slate-400"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>
                        </div>
                   </div>
                   {selectedCustomerId && (
                       <div>
                           <label className="block text-sm font-medium text-slate-700 mb-1">Активный договор</label>
                           {activeCustomerSales.length > 0 ? (
                               <select className="w-full p-3 border border-slate-200 rounded-xl bg-white outline-none text-slate-900" value={selectedSaleId} onChange={e => setSelectedSaleId(e.target.value)}>
                                   <option value="">-- Выберите товар/рассрочку --</option>
                                   {activeCustomerSales.map(s => <option key={s.id} value={s.id}>{s.productName} (Долг: {s.remainingAmount.toLocaleString()} ₽)</option>)}
                               </select>
                           ) : <p className="text-slate-500 italic p-2">Нет активных долгов</p>}
                       </div>
                   )}
                   {selectedSale && <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-sm flex gap-2 items-center"><span className="text-slate-500">Зачисление на счет:</span><span className="font-bold text-slate-800">{getAccountName(selectedSale.accountId)}</span></div>}
              </div>
          )}

          {sourceType === 'INVESTOR' && (
              <div className="space-y-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm animate-fade-in">
                  <div>
                       <label className="block text-sm font-medium text-slate-700 mb-1">Выберите инвестора</label>
                       <select className="w-full p-3 border border-slate-200 rounded-xl bg-white outline-none text-slate-900" value={selectedInvestorId} onChange={e => setSelectedInvestorId(e.target.value)}>
                           <option value="">-- Список инвесторов --</option>
                           {investors.map(inv => <option key={inv.id} value={inv.id}>{inv.name}</option>)}
                       </select>
                   </div>
                   {targetAccountId && <div className="bg-purple-50 p-3 rounded-lg border border-purple-100 text-sm flex gap-2 items-center"><span className="text-purple-600 font-medium">Счет зачисления:</span><span className="font-bold text-purple-800">{getAccountName(targetAccountId)}</span></div>}
              </div>
          )}

          {sourceType === 'OTHER' && (
              <div className="space-y-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm animate-fade-in">
                  <div><label className="block text-sm font-medium text-slate-700 mb-1">Назначение / Описание</label><input placeholder="Например: Внесение личных средств" className="w-full p-3 border border-slate-200 rounded-xl outline-none bg-white text-slate-900" value={note} onChange={e => setNote(e.target.value)} /></div>
                  <div><label className="block text-sm font-medium text-slate-700 mb-1">Счет зачисления</label><select className="w-full p-3 border border-slate-200 rounded-xl bg-white outline-none text-slate-900" value={targetAccountId} onChange={e => setTargetAccountId(e.target.value)}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
              </div>
          )}

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Сумма прихода</label>
                  <div className="relative">
                      <span className="absolute left-4 top-3.5 text-slate-400 text-lg">₽</span>
                      <input type="number" placeholder="0" className="w-full p-3 pl-8 text-2xl font-bold border border-slate-200 rounded-xl outline-none bg-white text-slate-900" value={amount} onChange={e => setAmount(e.target.value)} />
                  </div>
                  
                  {sourceType === 'CUSTOMER' && selectedSale && (
                      <div className="flex justify-between items-start mt-2">
                          <p className="text-xs text-slate-400 mt-1">Рек: {recommendedAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</p>
                          {currentPaymentProfit > 0 && (
                              <div className="bg-emerald-50 px-2 py-1 rounded text-right">
                                  <p className="text-xs text-emerald-600 font-medium">Прибыль с платежа</p>
                                  <p className="text-sm font-bold text-emerald-700">+{currentPaymentProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })} ₽</p>
                              </div>
                          )}
                      </div>
                  )}
              </div>
              
              {sourceType === 'CUSTOMER' && appSettings.whatsapp?.enabled && (
                  <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                      <div className="flex items-center gap-2">
                          <span className="text-emerald-500">{ICONS.Send}</span>
                          <span className="text-sm font-medium text-slate-700">Отправить чек в WhatsApp</span>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" checked={sendHistory} onChange={() => setSendHistory(!sendHistory)} className="sr-only peer" />
                          <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                      </label>
                  </div>
              )}

              <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Дата</label>
                  <input type="date" className="w-48 p-3 text-lg border border-slate-200 rounded-xl outline-none bg-white text-slate-900" value={date} onChange={e => setDate(e.target.value)} />
              </div>
          </div>

          <button type="submit" className="w-full bg-emerald-600 text-white py-4 rounded-xl font-bold hover:bg-emerald-700 shadow-lg shadow-emerald-200 transition-transform active:scale-95">Подтвердить приход</button>
      </form>

      {/* Confirmation Modal */}
      {showConfirmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={() => setShowConfirmModal(false)}>
              <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
                  <h3 className="text-xl font-bold text-slate-800 text-center">Подтверждение прихода</h3>
                  
                  <div className="bg-slate-50 p-4 rounded-xl space-y-2 text-sm border border-slate-100">
                      {sourceType === 'CUSTOMER' && (
                          <>
                              <div className="flex justify-between"><span className="text-slate-500">От кого:</span><span className="font-bold text-slate-800">{selectedCustomer?.name}</span></div>
                              <div className="flex justify-between"><span className="text-slate-500">За что:</span><span className="font-medium text-slate-800">{selectedSale?.productName}</span></div>
                          </>
                      )}
                      {sourceType === 'INVESTOR' && (
                          <div className="flex justify-between"><span className="text-slate-500">Инвестор:</span><span className="font-bold text-slate-800">{selectedInvestor?.name}</span></div>
                      )}
                      {sourceType === 'OTHER' && (
                          <div className="flex justify-between"><span className="text-slate-500">Назначение:</span><span className="font-medium text-slate-800">{note}</span></div>
                      )}
                      
                      <div className="my-2 border-t border-slate-200"></div>
                      
                      <div className="flex justify-between items-center">
                          <span className="text-slate-500">Сумма:</span>
                          <span className="text-xl font-bold text-emerald-600">+{Number(amount).toLocaleString()} ₽</span>
                      </div>
                      
                      <div className="flex justify-between items-center pt-1">
                          <span className="text-slate-500">Счет:</span>
                          <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-xs font-bold">{getAccountName(targetAccountId)}</span>
                      </div>

                      {sourceType === 'CUSTOMER' && sendHistory && (
                          <div className="flex items-center gap-2 mt-2 text-xs text-emerald-600 font-medium bg-white p-2 rounded border border-emerald-100">
                              {ICONS.Send} Будет отправлен отчет в WhatsApp
                          </div>
                      )}
                  </div>

                  <div className="flex gap-3 pt-2">
                      <button onClick={() => setShowConfirmModal(false)} className="flex-1 py-3 bg-slate-100 rounded-xl font-bold text-slate-600 hover:bg-slate-200">Отмена</button>
                      <button onClick={handleConfirm} className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 shadow-lg shadow-emerald-200">Зачислить</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default NewIncome;