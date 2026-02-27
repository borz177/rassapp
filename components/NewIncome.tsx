import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Customer, Account, Investor, Sale } from '../types';
import { ICONS } from '../constants';
import { getAppSettings } from '../services/storage';
import { sendWhatsAppMessage, sendWhatsAppFile } from '../services/whatsapp';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

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
  const contractRef = useRef<HTMLDivElement>(null); // Ref for hidden contract div

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

  // Helper for filename transliteration
  const transliterate = (text: string) => {
      const map: Record<string, string> = {
          'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
          'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
          'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts',
          'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu',
          'я': 'ya', ' ': '_'
      };
      return text.toLowerCase().split('').map(char => map[char] || char).join('').replace(/[^a-z0-9_]/g, '');
  };

  const generateContractPDF = async (sale: Sale, customer: Customer, currentPaymentAmount: number, paymentDate: string): Promise<Blob> => {
      if (!contractRef.current) throw new Error("Contract element not found");

      // Temporarily show the element to capture it
      const element = contractRef.current;
      const originalDisplay = element.style.display;
      const originalPosition = element.style.position;
      const originalLeft = element.style.left;

      element.style.display = 'block';
      element.style.position = 'absolute';
      element.style.left = '-9999px';

      try {
          // Use slightly lower scale for better performance/size, 1.5 is usually enough for screen/print
          const canvas = await html2canvas(element, { scale: 1.5 });
          // Use JPEG with 0.7 quality to drastically reduce file size compared to PNG
          const imgData = canvas.toDataURL('image/jpeg', 0.7);

          const pdf = new jsPDF('p', 'mm', 'a4');
          const pdfWidth = pdf.internal.pageSize.getWidth();
          const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

          pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
          return pdf.output('blob');
      } finally {
          element.style.display = originalDisplay;
          element.style.position = originalPosition;
          element.style.left = originalLeft;
      }
  };

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

      // Handle Date with Time
      let finalDate = date;
      const now = new Date();
      const selectedDate = new Date(date);

      const isToday = selectedDate.getDate() === now.getDate() &&
                      selectedDate.getMonth() === now.getMonth() &&
                      selectedDate.getFullYear() === now.getFullYear();

      if (isToday) {
          finalDate = now.toISOString();
      }

      const commonData = { amount: numAmount, date: finalDate };

      // Process Submission
      if (sourceType === 'CUSTOMER') {
          onSubmit({ ...commonData, type: 'CUSTOMER_PAYMENT', saleId: selectedSaleId, accountId: targetAccountId });

          // Process WhatsApp Sending if enabled
          if (sendHistory && selectedSale && selectedCustomer && appSettings.whatsapp?.enabled) {
              try {
                  const pdfBlob = await generateContractPDF(selectedSale, selectedCustomer, numAmount, finalDate);
                  // Use transliterated name to avoid encoding issues
                  const safeProductName = transliterate(selectedSale.productName);
                  const fileName = `Договор_${safeProductName}.pdf`;

                  const success = await sendWhatsAppFile(
                      appSettings.whatsapp.idInstance,
                      appSettings.whatsapp.apiTokenInstance,
                      selectedCustomer.phone,
                      pdfBlob,
                      fileName
                  );

                  if (success) {
                      alert("Договор (PDF) отправлен клиенту в WhatsApp");
                  } else {
                      alert("Ошибка отправки PDF в WhatsApp");
                  }
              } catch (error) {
                  console.error("Error generating/sending PDF:", error);
                  alert("Ошибка при создании или отправке PDF");
              }
          }

      } else if (sourceType === 'INVESTOR') {
          onSubmit({ ...commonData, type: 'INVESTOR_DEPOSIT', investorId: selectedInvestorId, accountId: targetAccountId, note: "Пополнение от инвестора" });
      } else {
          onSubmit({ ...commonData, type: 'OTHER_INCOME', accountId: targetAccountId, note: note || "Прочий приход" });
      }

      setShowConfirmModal(false);
  };

  // Helper to render contract content for PDF generation
  const renderContractContent = () => {
    if (!selectedSale || !selectedCustomer) return null;

    const companyName = appSettings?.companyName || "Компания";
    const hasGuarantor = !!selectedSale.guarantorName;

    // Construct History Data
    const existingPayments = selectedSale.paymentPlan
        ? selectedSale.paymentPlan.filter(p => p.isPaid).map(p => ({
            date: new Date(p.date),
            amount: p.amount
        }))
        : [];

    // Add current payment (preview)
    existingPayments.push({
        date: new Date(date),
        amount: Number(amount)
    });

    existingPayments.sort((a, b) => a.date.getTime() - b.date.getTime());

    // === ОБЩИЕ СТИЛИ (вынесены в переменные для чистоты) ===
    const styles = {
        page: {
            width: '210mm',
            minHeight: '297mm', // Высота A4
            padding: '20mm',
            background: 'white',
            color: 'black',
            fontFamily: 'Times New Roman, serif',
            fontSize: '12pt',
            lineHeight: '1.5',
            display: 'flex',
            flexDirection: 'column' as const, // Критично для прижатия футера
            boxSizing: 'border-box' as const,
            margin: '0 auto'
        },
        contentWrapper: {
            flex: 1 // Занимает всё свободное место, толкая футер вниз
        },
        h1: {
            textAlign: 'center' as const,
            fontSize: '16pt',
            fontWeight: 'bold' as const,
            marginBottom: '30px',
            textTransform: 'uppercase' as const,
            marginTop: 0,
            lineHeight: 1.3
        },
        headerInfo: {
            textAlign: 'right' as const,
            marginBottom: '20px',
            fontSize: '11pt'
        },
        fieldRow: {
            display: 'flex',
            justifyContent: 'space-between' as const,
            marginBottom: '10px',
            alignItems: 'flex-start' as const
        },
        fieldLabel: {
            fontWeight: 'bold' as const
        },
        phoneField: {
            textAlign: 'right' as const,
            marginLeft: '10px',
            flexShrink: 0, // Не давать телефону сжиматься
            whiteSpace: 'nowrap' as const
        },
        section: {
            margin: '0 0 20px 0'
        },
        sectionItem: {
            marginBottom: '12px' // Одинаковый отступ вниз для всех элементов
        },
        sectionItemLast: {
            marginBottom: 0 // Убираем отступ у последнего элемента
        },
        table: {
            width: '100%' as const,
            borderCollapse: 'collapse' as const,
            margin: '20px 0',
            fontSize: '11pt'
        },
        th: {
            border: '1px solid #000',
            padding: '6px 8px',
            textAlign: 'center' as const,
            verticalAlign: 'middle' as const,
            fontWeight: 'bold' as const,
            background: '#f9f9f9'
        },
        td: {
            border: '1px solid #000',
            padding: '6px 8px',
            textAlign: 'center' as const,
            verticalAlign: 'middle' as const
        },
        footerContainer: {
            marginTop: 'auto', // === ГЛАВНЫЙ ТРЮК: прижимает блок к низу ===
            paddingTop: '20px',
            width: '100%',
            breakInside: 'avoid' as const
        },
        footer: {
            display: 'flex',
            justifyContent: 'space-between' as const,
            alignItems: 'flex-end' as const,
            width: '100%'
        },
        signatureBlock: (width: string) => ({
            textAlign: 'center' as const,
            width: width,
            breakInside: 'avoid' as const
        }),
        signatureLine: {
            borderBottom: '1px solid #000',
            margin: '35px 0 5px 0',
            minHeight: '1px'
        },
        signatureLabel: {
            fontSize: '10pt',
            fontStyle: 'italic' as const
        }
    };

    let currentDebt = selectedSale.totalAmount - selectedSale.downPayment;

    return (
        <div ref={contractRef} style={styles.page}>
            <h1 style={styles.h1}>ДОГОВОР КУПЛИ-ПРОДАЖИ<br/>ТОВАРА В РАССРОЧКУ</h1>

            <div style={styles.headerInfo}>
                Дата: {new Date(selectedSale.startDate).toLocaleDateString()}
            </div>

            {/* === КОНТЕНТ, который растягивает страницу === */}
            <div style={styles.contentWrapper}>
                <div style={styles.section}>
                    <div style={styles.fieldRow}>
                        <span><span style={styles.fieldLabel}>Продавец:</span> {companyName}</span>
                        <span style={styles.phoneField}>Тел: {user?.phone || '+7 (___) ___-__-__'}</span>
                    </div>
                    <div style={styles.fieldRow}>
                        <span><span style={styles.fieldLabel}>Покупатель:</span> {selectedCustomer.name}</span>
                        <span style={styles.phoneField}>Тел: {selectedCustomer.phone}</span>
                    </div>
                    {hasGuarantor && (
                        <div style={styles.fieldRow}>
                            <span><span style={styles.fieldLabel}>Поручитель:</span> {selectedSale.guarantorName}</span>
                            <span style={styles.phoneField}>Тел: {selectedSale.guarantorPhone}</span>
                        </div>
                    )}
                </div>

                <div style={styles.section}>
                    <div style={styles.sectionItem}><span style={styles.fieldLabel}>Товар:</span> {selectedSale.productName}</div>

                    <div style={{...styles.sectionItem, display: 'flex', justifyContent: 'space-between', marginTop: '10px'}}>
                        <span><span style={styles.fieldLabel}>Срок рассрочки:</span> {selectedSale.installments} мес.</span>
                        <span><span style={styles.fieldLabel}>Стоимость:</span> {selectedSale.totalAmount.toLocaleString()} ₽</span>
                    </div>

                    <div style={{...styles.sectionItemLast, display: 'flex', justifyContent: 'space-between'}}>
                        <span><span style={styles.fieldLabel}>Ежемесячный платеж:</span> {(selectedSale.paymentPlan[0]?.amount || 0).toLocaleString()} ₽</span>
                        <span><span style={styles.fieldLabel}>Первый взнос:</span> {selectedSale.downPayment.toLocaleString()} ₽</span>
                    </div>
                </div>

                <table style={styles.table}>
                    <thead>
                        <tr>
                            <th style={{...styles.th, width: '10%'}}>№</th>
                            <th style={{...styles.th, width: '30%'}}>Дата</th>
                            <th style={{...styles.th, width: '25%'}}>Сумма</th>
                            <th style={{...styles.th, width: '35%'}}>Остаток долга</th>
                        </tr>
                    </thead>
                    <tbody>
                        {existingPayments.map((p, index) => {
                            currentDebt -= p.amount;
                            const displayDebt = Math.max(0, currentDebt);
                            return (
                                <tr key={index}>
                                    <td style={styles.td}>{index + 1}</td>
                                    <td style={styles.td}>{p.date.toLocaleDateString()}</td>
                                    <td style={styles.td}>{p.amount.toLocaleString()} ₽</td>
                                    <td style={styles.td}>{displayDebt.toLocaleString()} ₽</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>

                <div style={{ margin: '25px 0', fontSize: '11pt', lineHeight: 1.4 }}>
                    Продавец обязуется передать Покупателю товар, а Покупатель обязуется принять и оплатить его в рассрочку на указанных выше условиях.
                </div>
            </div>

            {/* === ПОДПИСИ (всегда внизу благодаря marginTop: auto) === */}
            <div style={styles.footerContainer}>
                <div style={styles.footer}>
                    <div style={styles.signatureBlock(hasGuarantor ? '30%' : '45%')}>
                        <div style={styles.signatureLine}></div>
                        <div style={styles.signatureLabel}>Продавец</div>
                    </div>
                    {hasGuarantor && (
                        <div style={styles.signatureBlock('30%')}>
                            <div style={styles.signatureLine}></div>
                            <div style={styles.signatureLabel}>Поручитель</div>
                        </div>
                    )}
                    <div style={styles.signatureBlock(hasGuarantor ? '30%' : '45%')}>
                        <div style={styles.signatureLine}></div>
                        <div style={styles.signatureLabel}>Покупатель</div>
                    </div>
                </div>
            </div>
        </div>
    );
};

  const getAccountName = (id: string) => accounts.find(a => a.id === id)?.name || 'Неизвестный счет';

  return (
    <div className="space-y-4 animate-fade-in pb-20">
      {/* Hidden Contract Render */}
      {renderContractContent()}

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
                  <input type="date" className="w-full p-3 text-lg border border-slate-200 rounded-xl outline-none bg-white text-slate-900" value={date} onChange={e => setDate(e.target.value)} />
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