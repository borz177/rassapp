import React, { useState, useEffect, useMemo } from 'react';
import { Customer, Product, Account, AppSettings, Sale } from '../types';
import { ICONS } from '../constants';
import { getAppSettings } from '../services/storage';
import { sendWhatsAppFile } from '../services/whatsapp';
import { jsPDF } from "jspdf";

interface NewSaleProps {
  initialData: any;
  customers: Customer[];
  products: Product[];
  accounts: Account[];
  onClose: () => void;
  onSelectCustomer: (currentData: any) => void;
  onSubmit: (data: any) => void;
}

const NewSale: React.FC<NewSaleProps> = ({
    initialData, customers, products, accounts,
    onClose, onSelectCustomer, onSubmit
}) => {
  const [mode, setMode] = useState<'INSTALLMENT' | 'CASH'>(initialData.type || 'INSTALLMENT');
  const [roundingMode, setRoundingMode] = useState<'NONE' | 'DOWN' | 'UP'>('NONE');

  // Modals State
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [createdSale, setCreatedSale] = useState<any>(null); // Store the sale object for the success modal

  const mainAccount = accounts.find(a => a.type === 'MAIN');
  const appSettings = getAppSettings();

  // Use string or number for inputs to handle empty state correctly (deleting the 0)
  const [formData, setFormData] = useState<any>(Object.assign({
    id: null,
    customerId: '',
    productId: '',
    productName: '',
    buyPrice: 0,
    price: 0,
    accountId: mainAccount ? mainAccount.id : (accounts.length > 0 ? accounts[0].id : ''),
    startDate: new Date().toISOString().split('T')[0],
    paymentDate: '',
    paymentDay: '',
    downPayment: 0,
    installments: 3,
    interestRate: 30,
    guarantorName: '',
    guarantorPhone: '',
  }, initialData, {
    // Override numbers with potentially passed values, default to 0 if undefined
    price: initialData.totalAmount || initialData.price || 0,
    buyPrice: initialData.buyPrice || 0,
    downPayment: initialData.downPayment || 0,
    installments: initialData.installments || 3,
    interestRate: initialData.interestRate || 30,
    startDate: initialData.startDate ? new Date(initialData.startDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
  }));

  const [suggestions, setSuggestions] = useState<Product[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const selectedCustomer = customers.find(c => c.id === formData.customerId);
  const selectedAccount = accounts.find(a => a.id === formData.accountId);

  useEffect(() => {
      // Auto-calculate price based on buyPrice + interest (only for new sales in installment mode)
      if (mode === 'INSTALLMENT' && Number(formData.buyPrice) > 0 && !initialData.id) {
          const bp = Number(formData.buyPrice);
          const rate = Number(formData.interestRate);
          const markup = bp * (rate / 100);
          const calculatedPrice = bp + markup;
          setFormData(prev => ({ ...prev, price: Math.round(calculatedPrice) }));
      }
  }, [formData.buyPrice, formData.interestRate, mode, initialData.id]);

  useEffect(() => {
    if (!formData.paymentDate) {
        if (initialData.paymentDay && initialData.startDate) {
            const firstPayment = new Date(initialData.startDate);
            firstPayment.setMonth(firstPayment.getMonth() + 1);
            firstPayment.setDate(initialData.paymentDay);
            setFormData(prev => ({ ...prev, paymentDate: firstPayment.toISOString().split('T')[0]}));
        } else if (formData.startDate) {
            const date = new Date(formData.startDate);
            date.setMonth(date.getMonth() + 1);
            setFormData(prev => ({ ...prev, paymentDate: date.toISOString().split('T')[0] }));
        }
    }
  }, [formData.startDate, initialData]);

  const calculatedValues = useMemo(() => {
    const basePrice = Number(formData.price) || 0;
    const downPayment = Number(formData.downPayment) || 0;
    const installments = Number(formData.installments) || 1;

    if (mode === 'CASH') {
        return { totalAmount: basePrice, remainingAmount: 0, monthlyPayment: 0 };
    }

    let totalAmount = basePrice;
    let remainingAmount = totalAmount - downPayment;
    let monthlyPayment = installments > 0 ? remainingAmount / installments : 0;

    if (roundingMode !== 'NONE' && monthlyPayment > 0) {
        // Round to nearest 100
        const roundedMonthly = roundingMode === 'DOWN'
            ? Math.floor(monthlyPayment / 100) * 100
            : Math.ceil(monthlyPayment / 100) * 100;

        if (roundedMonthly > 0) {
            monthlyPayment = roundedMonthly;
            remainingAmount = monthlyPayment * installments;
            totalAmount = remainingAmount + downPayment;
        }
    }

    return { totalAmount, remainingAmount, monthlyPayment };
  }, [formData.price, formData.downPayment, formData.installments, roundingMode, mode]);

  // Sync price with rounded total
  useEffect(() => {
      if (roundingMode !== 'NONE' && mode === 'INSTALLMENT') {
          if (calculatedValues.totalAmount !== Number(formData.price)) {
              setFormData(prev => ({ ...prev, price: calculatedValues.totalAmount }));
          }
      }
  }, [calculatedValues.totalAmount, roundingMode, mode]);

  const handleProductChange = (val: string) => { setFormData(prev => ({ ...prev, productName: val, productId: '' })); if (val.length > 0) { const matched = products.filter(p => p.name.toLowerCase().includes(val.toLowerCase())); setSuggestions(matched); setShowSuggestions(true); } else { setShowSuggestions(false); } };
  const handleSuggestionClick = (product: Product) => { setFormData(prev => ({ ...prev, productName: product.name, productId: product.id, price: product.price, buyPrice: 0 })); setShowSuggestions(false); };
  const handlePaymentDateChange = (e: React.ChangeEvent<HTMLInputElement>) => { const dateVal = e.target.value; setFormData(prev => ({ ...prev, paymentDate: dateVal, paymentDay: dateVal ? new Date(dateVal).getDate().toString() : '' })); };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.customerId || !formData.productName || !formData.accountId) {
        alert("Заполните все обязательные поля");
        return;
    }
    setShowConfirmModal(true);
  };

  const handleConfirm = () => {
    const pDay = formData.paymentDate ? new Date(formData.paymentDate).getDate() : new Date(formData.startDate).getDate();

    // Generate ID here so we can use it for printing/sending before App.tsx updates
    const saleId = formData.id || Date.now().toString();

    const submissionData = {
        ...formData,
        id: saleId,
        paymentDay: pDay,
        buyPrice: Number(formData.buyPrice),
        price: Number(formData.price),
        downPayment: Number(formData.downPayment),
        installments: Number(formData.installments),
        interestRate: Number(formData.interestRate),
    };

    let finalSaleData;

    if (mode === 'CASH') {
        finalSaleData = {
            ...submissionData,
            type: 'CASH',
            totalAmount: calculatedValues.totalAmount,
            downPayment: calculatedValues.totalAmount,
            remainingAmount: 0,
            installments: 0,
            interestRate: 0
        };
    } else {
        finalSaleData = {
            ...submissionData,
            type: 'INSTALLMENT',
            totalAmount: calculatedValues.totalAmount,
            remainingAmount: calculatedValues.remainingAmount
        };
    }

    const paymentPlan = mode === 'CASH' ? [] : Array.from({ length: finalSaleData.installments }).map((_, idx) => {
        const pDate = new Date(finalSaleData.paymentDate || finalSaleData.startDate);
        pDate.setMonth(pDate.getMonth() + idx);
        return {
            id: `pay_${Date.now()}_${idx}`,
            saleId: saleId,
            amount: Number((finalSaleData.remainingAmount / finalSaleData.installments).toFixed(2)),
            date: pDate.toISOString(),
            isPaid: false
        };
    });

    const fullSaleObject = { ...finalSaleData, paymentPlan };

    setCreatedSale(fullSaleObject);
    setShowConfirmModal(false);
    onSubmit(fullSaleObject);
    setShowSuccessModal(true);
  };

  const updateMode = (newMode: 'INSTALLMENT' | 'CASH') => { setMode(newMode); setFormData(prev => ({ ...prev, mode: newMode })); };

  // --- PDF Generation Logic ---

  const generatePDFBlob = async (): Promise<Blob> => {
      const doc = new jsPDF();

      // Load Cyrillic Font (Roboto)
      try {
          const fontUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.66/fonts/Roboto/Roboto-Regular.ttf';
          const response = await fetch(fontUrl);
          if (response.ok) {
              const buffer = await response.arrayBuffer();
              const bytes = new Uint8Array(buffer);
              let binary = '';
              for (let i = 0; i < bytes.byteLength; i++) {
                  binary += String.fromCharCode(bytes[i]);
              }
              const base64 = window.btoa(binary);

              doc.addFileToVFS('Roboto-Regular.ttf', base64);
              doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
              doc.setFont('Roboto');
          } else {
              console.error("Failed to fetch font:", response.statusText);
          }
      } catch (error) {
          console.error("Error loading font for PDF:", error);
      }

      const sale = createdSale;
      const customer = selectedCustomer;
      const company = appSettings.companyName;

      doc.setFontSize(16);
      doc.text("ДОГОВОР КУПЛИ-ПРОДАЖИ", 105, 20, { align: "center" });

      doc.setFontSize(10);
      doc.text(`Дата: ${new Date(sale.startDate).toLocaleDateString()}`, 180, 30, { align: "right" });

      doc.setFontSize(12);
      doc.text(`Продавец: ${company}`, 20, 40);
      doc.text(`Покупатель: ${customer?.name}`, 20, 48);
      if (customer?.phone) doc.text(`Телефон: ${customer.phone}`, 20, 56);
      if (customer?.address) doc.text(`Адрес: ${customer.address}`, 20, 64);

      doc.line(20, 70, 190, 70);

      doc.setFontSize(14);
      doc.text("Предмет договора", 20, 80);
      doc.setFontSize(12);
      doc.text(`Товар: ${sale.productName}`, 20, 90);
      doc.text(`Стоимость товара: ${sale.totalAmount.toLocaleString()} руб.`, 20, 98);

      if (mode === 'INSTALLMENT') {
          doc.text(`Первоначальный взнос: ${sale.downPayment.toLocaleString()} руб.`, 20, 106);
          doc.text(`Остаток долга: ${sale.remainingAmount.toLocaleString()} руб.`, 20, 114);
          doc.text(`Срок рассрочки: ${sale.installments} мес.`, 20, 122);

          doc.text("График платежей:", 20, 135);
          let y = 145;
          sale.paymentPlan.forEach((p: any, i: number) => {
              // Check for page break
              if (y > 270) {
                  doc.addPage();
                  y = 20;
              }
              doc.text(`${i + 1}. Дата: ${new Date(p.date).toLocaleDateString()} — Сумма: ${p.amount.toLocaleString()} руб.`, 30, y);
              y += 8;
          });

          y += 10;
          if (y > 270) {
              doc.addPage();
              y = 20;
          }
          doc.setFontSize(10);
          doc.text("Покупатель обязуется вносить платежи согласно графику.", 20, y);
          doc.text("Товар остается собственностью продавца до полной оплаты.", 20, y + 5);
      } else {
          doc.text("Оплата произведена полностью.", 20, 110);
      }

      doc.line(20, 250, 190, 250);
      doc.text("Подпись Продавца: _______________", 20, 260);
      doc.text("Подпись Покупателя: _______________", 110, 260);

      return doc.output('blob');
  };

  const handleSendContract = async () => {
      if (!createdSale || !selectedCustomer || !appSettings.whatsapp?.enabled) return;

      try {
          const blob = await generatePDFBlob();
          const fileName = `Contract_${selectedCustomer.name.replace(/\s/g, '_')}.pdf`;

          const success = await sendWhatsAppFile(
              appSettings.whatsapp.idInstance,
              appSettings.whatsapp.apiTokenInstance,
              selectedCustomer.phone,
              blob,
              fileName
          );

          if (success) alert("Договор успешно отправлен!");
          else alert("Ошибка отправки WhatsApp (проверьте подключение)");
      } catch (error) {
          console.error("Error generating or sending PDF:", error);
          alert("Ошибка при создании или отправке файла.");
      }
  };

  const handlePrintContract = () => {
      if (!createdSale) return;
      // Re-use logic or call window.print based logic similar to Contracts.tsx
      // For consistency with previous request, we keep the HTML print window logic here.
      // (The PDF logic above is specifically for sending file).

      const sale = createdSale;
      const customer = selectedCustomer;
      const companyName = appSettings.companyName;

      const printWindow = window.open('', '_blank');
      if (!printWindow) return;

      const rows = Array.from({ length: sale.installments || 1 }).map((_, index) => `
        <tr>
            <td style="text-align: center;">${index + 1}</td>
            <td style="text-align: center; height: 30px;"></td>
            <td style="text-align: center;"></td>
            <td style="text-align: center;"></td>
        </tr>
      `).join('');

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Договор</title>
            <style>
                body { font-family: 'Times New Roman', serif; padding: 40px; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #000; padding: 5px; }
            </style>
        </head>
        <body>
            <h1 style="text-align:center">ДОГОВОР КУПЛИ-ПРОДАЖИ</h1>
            <p>Продавец: ${companyName}</p>
            <p>Покупатель: ${customer?.name}</p>
            <p>Адрес: ${customer?.address || '________________'}</p>
            <p>Товар: ${sale.productName}</p>
            <p>Сумма: ${sale.totalAmount} руб.</p>
            <table><thead><tr><th>№</th><th>Дата</th><th>Сумма</th><th>Остаток</th></tr></thead><tbody>${rows}</tbody></table>
            <br/><br/>
            <div style="display:flex; justify-content:space-between">
                <span>Продавец: ____________</span>
                <span>Покупатель: ____________</span>
            </div>
            <script>window.onload = function() { window.print(); }</script>
        </body>
        </html>
      `;
      printWindow.document.write(htmlContent);
      printWindow.document.close();
  };

  return (
    <div className="space-y-4 animate-fade-in pb-20">
      <div className="flex items-center gap-3 border-b border-slate-200 pb-4 bg-white sticky top-0 z-10 pt-2"><button onClick={onClose} className="text-slate-500 hover:text-slate-800">{ICONS.Back}</button><h2 className="text-xl font-bold text-slate-800">{formData.id ? 'Редактирование' : 'Новое оформление'}</h2></div>
      <div className="flex bg-white p-1 rounded-xl shadow-sm border border-slate-100"><button onClick={() => updateMode('INSTALLMENT')} className={`flex-1 py-3 text-sm font-bold rounded-lg transition-all ${mode === 'INSTALLMENT' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>Рассрочка</button><button onClick={() => updateMode('CASH')} className={`flex-1 py-3 text-sm font-bold rounded-lg transition-all ${mode === 'CASH' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>Наличные</button></div>

      <form onSubmit={handleFormSubmit} className="space-y-4">
          {/* 1. Dates Section (Moved to Top) */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex flex-wrap gap-6">
                  <div className="w-40">
                      <label className="block text-sm font-medium text-slate-700 mb-1">Дата продажи</label>
                      <input type="date" required className="w-full p-2 border border-slate-300 rounded-lg outline-none bg-white text-slate-900 text-sm" value={formData.startDate} onChange={e => setFormData({...formData, startDate: e.target.value})} />
                  </div>
                  {mode === 'INSTALLMENT' && (
                      <div className="w-40">
                          <label className="block text-sm font-medium text-slate-700 mb-1">Первый платеж</label>
                          <input type="date" required className="w-full p-2 border border-slate-300 rounded-lg outline-none bg-white text-slate-900 text-sm" value={formData.paymentDate} onChange={handlePaymentDateChange} />
                      </div>
                  )}
              </div>
          </div>

          {/* 2. Customer Section */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm"><label className="block text-sm font-medium text-slate-700 mb-1">Клиент</label><div onClick={() => onSelectCustomer({ ...formData, mode })} className={`w-full p-3 border rounded-lg cursor-pointer flex justify-between items-center ${formData.customerId ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-dashed border-slate-300'}`}><div className="flex items-center gap-2">{formData.customerId && <div className="text-indigo-600">{ICONS.Customers}</div>}<span className={formData.customerId ? 'text-slate-800 font-bold' : 'text-slate-400'}>{selectedCustomer ? selectedCustomer.name : 'Выбрать клиента...'}</span></div><span className="text-slate-400"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span></div></div>

          {/* 3. Product Section */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm relative"><label className="block text-sm font-medium text-slate-700 mb-1">Товар</label><input type="text" className="w-full p-3 border border-slate-300 rounded-lg outline-none text-slate-900 placeholder:text-slate-400 bg-white" placeholder="Введите название товара..." value={formData.productName} onChange={(e) => handleProductChange(e.target.value)} />{showSuggestions && suggestions.length > 0 && (<div className="absolute left-4 right-4 top-[72px] bg-white border border-slate-200 rounded-lg shadow-lg z-20 max-h-40 overflow-y-auto">{suggestions.map(s => (<div key={s.id} className="p-3 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0 text-slate-800" onClick={() => handleSuggestionClick(s)}><p className="font-medium text-slate-800">{s.name}</p><p className="text-xs text-slate-500">Цена: {s.price} ₽</p></div>))}</div>)}</div>

          {/* 4. Account/Cash Register Section (Moved here) */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <label className="block text-sm font-medium text-slate-700 mb-1">Касса (Приход)</label>
              <select required className="w-full p-3 bg-white border border-slate-300 rounded-lg outline-none text-slate-900" value={formData.accountId} onChange={e => setFormData({...formData, accountId: e.target.value})}>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
          </div>

          {/* 5. Pricing & Installment Params */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div className="grid grid-cols-2 gap-4">
                  <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Закуп (Себест.)</label>
                      <input
                        type="number"
                        min="0"
                        className="w-full p-3 border border-slate-300 rounded-lg outline-none bg-white text-slate-900"
                        value={formData.buyPrice === 0 ? '' : formData.buyPrice}
                        onChange={e => setFormData({...formData, buyPrice: e.target.value})}
                        placeholder="0"
                      />
                  </div>
                  {mode === 'INSTALLMENT' && (
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Наценка (%)</label>
                          <input
                            type="number"
                            min="0"
                            className="w-full p-3 border border-slate-300 rounded-lg outline-none bg-white text-slate-900"
                            value={formData.interestRate === 0 ? '' : formData.interestRate}
                            onChange={e => setFormData({...formData, interestRate: e.target.value})}
                            placeholder="0"
                          />
                      </div>
                  )}
              </div>
              <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{mode === 'INSTALLMENT' ? 'Цена в рассрочку' : 'Цена продажи'}</label>
                  <input
                    type="number"
                    min="0"
                    className="w-full p-3 border border-slate-300 rounded-lg outline-none font-bold text-slate-900 bg-white"
                    value={formData.price === 0 ? '' : formData.price}
                    onChange={e => setFormData({...formData, price: e.target.value})}
                    placeholder="0"
                  />
                  {mode === 'INSTALLMENT' && Number(formData.buyPrice) > 0 && (<p className="text-xs text-indigo-600 mt-1">Автоматически рассчитано: {formData.buyPrice} + {formData.interestRate}%</p>)}
              </div>

              {/* Installment Params (Term & Down Payment) - Merged here */}
              {mode === 'INSTALLMENT' && (
                  <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4">
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Срок (мес.)</label>
                          <input
                            type="number"
                            min="1"
                            max="24"
                            className="w-full p-3 border border-slate-300 rounded-lg outline-none text-slate-900 bg-white"
                            value={formData.installments === 0 ? '' : formData.installments}
                            onChange={e => setFormData({...formData, installments: e.target.value})}
                            placeholder="0"
                          />
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Первый взнос (₽)</label>
                          <input
                            type="number"
                            min="0"
                            max={calculatedValues.totalAmount}
                            className="w-full p-3 border border-slate-300 rounded-lg outline-none text-slate-900 bg-white"
                            value={formData.downPayment === 0 ? '' : formData.downPayment}
                            onChange={e => setFormData({...formData, downPayment: e.target.value})}
                            placeholder="0"
                          />
                      </div>
                  </div>
              )}
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4"><h3 className="text-sm font-semibold text-slate-600">Поручитель (необязательно)</h3><div className="grid grid-cols-2 gap-4"><div><label className="block text-xs font-medium text-slate-500 mb-1">ФИО Поручителя</label><input type="text" className="w-full p-3 border border-slate-300 rounded-lg outline-none bg-white text-slate-900" value={formData.guarantorName} onChange={e => setFormData({...formData, guarantorName: e.target.value})} /></div><div><label className="block text-xs font-medium text-slate-500 mb-1">Телефон поручителя</label><input type="text" className="w-full p-3 border border-slate-300 rounded-lg outline-none bg-white text-slate-900" value={formData.guarantorPhone} onChange={e => setFormData({...formData, guarantorPhone: e.target.value})} /></div></div></div>

          <div className={`${mode === 'INSTALLMENT' ? 'bg-indigo-50 border-indigo-100' : 'bg-emerald-50 border-emerald-100'} p-5 rounded-xl space-y-3 border`}>
              <div className="flex justify-between text-sm"><span className="text-slate-500">{mode === 'INSTALLMENT' ? 'Итоговая цена' : 'Цена продажи'}</span><span className="font-medium text-slate-900">{calculatedValues.totalAmount.toLocaleString()} ₽</span></div>
              {mode === 'INSTALLMENT' && (
                  <>
                    <div className="flex justify-between text-sm"><span className="text-slate-500">Чистая прибыль</span><span className="font-medium text-emerald-600">+{Math.round(calculatedValues.totalAmount - Number(formData.buyPrice)).toLocaleString()} ₽</span></div>

                    {/* Smart Rounding Toggle */}
                    <div className="flex flex-col gap-2 text-sm pt-3 border-t border-indigo-100">
                        <span className="text-slate-500 font-medium">Округление платежа (до 100 ₽)</span>
                        <div className="flex bg-slate-100 p-1 rounded-lg">
                            <button
                                type="button"
                                onClick={() => setRoundingMode('NONE')}
                                className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${roundingMode === 'NONE' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
                            >
                                Нет
                            </button>
                            <button
                                type="button"
                                onClick={() => setRoundingMode('DOWN')}
                                className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${roundingMode === 'DOWN' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
                            >
                                Вниз
                            </button>
                            <button
                                type="button"
                                onClick={() => setRoundingMode('UP')}
                                className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${roundingMode === 'UP' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
                            >
                                Вверх
                            </button>
                        </div>
                    </div>

                    <div className="flex justify-between text-sm pt-3 border-t border-indigo-100"><span className="text-indigo-800 font-semibold">Платёж в месяц</span><span className="text-indigo-800 font-bold">{calculatedValues.monthlyPayment.toLocaleString(undefined, {maximumFractionDigits: 0})} ₽</span></div>
                  </>
              )}
          </div>
          <button type="submit" className={`w-full text-white py-4 rounded-xl font-bold transition-colors shadow-lg ${mode === 'INSTALLMENT' ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200' : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200'}`}>{formData.id ? 'Сохранить изменения' : (mode === 'INSTALLMENT' ? 'Оформить рассрочку' : 'Провести продажу')}</button>
      </form>

      {/* Confirmation Modal */}
      {showConfirmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={() => setShowConfirmModal(false)}>
              <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
                  <h3 className="text-xl font-bold text-slate-800 text-center">Подтверждение</h3>
                  
                  <div className="bg-slate-50 p-4 rounded-xl space-y-2 text-sm">
                      <div className="flex justify-between"><span className="text-slate-500">Клиент:</span><span className="font-bold text-slate-800">{selectedCustomer?.name}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Товар:</span><span className="font-bold text-slate-800">{formData.productName}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Сумма:</span><span className="font-bold text-indigo-600">{calculatedValues.totalAmount.toLocaleString()} ₽</span></div>
                      <div className="border-t border-slate-200 pt-2 mt-2 flex justify-between items-center">
                          <span className="text-slate-500">Зачисление в:</span>
                          <span className="bg-emerald-100 text-emerald-800 px-2 py-1 rounded text-xs font-bold">{selectedAccount?.name}</span>
                      </div>
                  </div>

                  <div className="flex gap-3 pt-2">
                      <button onClick={() => setShowConfirmModal(false)} className="flex-1 py-3 bg-slate-100 rounded-xl font-bold text-slate-600">Отмена</button>
                      <button onClick={handleConfirm} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold">Подтвердить</button>
                  </div>
              </div>
          </div>
      )}

      {/* Success Modal */}
      {showSuccessModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
              <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 text-center space-y-5" onClick={e => e.stopPropagation()}>
                  <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto text-3xl">
                      {ICONS.Check}
                  </div>
                  <div>
                      <h3 className="text-2xl font-bold text-slate-800">Успешно!</h3>
                      <p className="text-slate-500 text-sm mt-1">Сделка оформлена и сохранена.</p>
                  </div>

                  <div className="flex flex-col gap-3">
                      <button onClick={handlePrintContract} className="w-full py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 flex items-center justify-center gap-2">
                          {ICONS.File} Печать договора
                      </button>
                      
                      {appSettings.whatsapp?.enabled && (
                          <button onClick={handleSendContract} className="w-full py-3 bg-emerald-50 text-emerald-600 font-bold rounded-xl hover:bg-emerald-100 flex items-center justify-center gap-2">
                              {ICONS.Send} Отправить договор (PDF)
                          </button>
                      )}
                  </div>

                  <div className="pt-2">
                      <button onClick={() => { setShowSuccessModal(false); onClose(); }} className="text-slate-400 text-sm font-medium hover:text-slate-600">Закрыть и вернуться</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default NewSale;