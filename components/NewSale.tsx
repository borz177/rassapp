import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Customer, Product, Account, AppSettings, Sale } from '../types';
import { ICONS } from '../constants';
import { getAppSettings } from '../services/storage';
import { sendWhatsAppFile } from '../services/whatsapp';
import jsPDF from "jspdf";
import html2canvas from 'html2canvas';

interface NewSaleProps {
  initialData: any;
  customers: Customer[];
  products: Product[];
  accounts: Account[];
  onClose: () => void;
  onSelectCustomer: (currentData: any) => void;
  onSubmit: ( any) => void;
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
  const [createdSale, setCreatedSale] = useState<any>(null);
  const contractRef = useRef<HTMLDivElement>(null);

  const mainAccount = accounts.find(a => a.type === 'MAIN');
  const appSettings = getAppSettings();

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
    if (mode === 'CASH') return { totalAmount: basePrice, remainingAmount: 0, monthlyPayment: 0 };
    let totalAmount = basePrice;
    let remainingAmount = totalAmount - downPayment;
    let monthlyPayment = installments > 0 ? remainingAmount / installments : 0;
    if (roundingMode !== 'NONE' && monthlyPayment > 0) {
        const roundedMonthly = roundingMode === 'DOWN' ? Math.floor(monthlyPayment / 100) * 100 : Math.ceil(monthlyPayment / 100) * 100;
        if (roundedMonthly > 0) {
            monthlyPayment = roundedMonthly;
            remainingAmount = monthlyPayment * installments;
            totalAmount = remainingAmount + downPayment;
        }
    }
    return { totalAmount, remainingAmount, monthlyPayment };
  }, [formData.price, formData.downPayment, formData.installments, roundingMode, mode]);

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
    if (!formData.customerId || !formData.productName || !formData.accountId) { alert("Заполните все обязательные поля"); return; }
    setShowConfirmModal(true);
  };

  const handleConfirm = () => {
    const pDay = formData.paymentDate ? new Date(formData.paymentDate).getDate() : new Date(formData.startDate).getDate();
    const saleId = formData.id || Date.now().toString();
    let finalStartDate = formData.startDate;
    const now = new Date();
    const selectedDate = new Date(formData.startDate);
    const isToday = selectedDate.getDate() === now.getDate() && selectedDate.getMonth() === now.getMonth() && selectedDate.getFullYear() === now.getFullYear();
    if (isToday) { finalStartDate = now.toISOString(); }

    const submissionData = { ...formData, id: saleId, startDate: finalStartDate, paymentDay: pDay, buyPrice: Number(formData.buyPrice), price: Number(formData.price), downPayment: Number(formData.downPayment), installments: Number(formData.installments), interestRate: Number(formData.interestRate) };
    let finalSaleData;
    if (mode === 'CASH') {
        finalSaleData = { ...submissionData, type: 'CASH', totalAmount: calculatedValues.totalAmount, downPayment: calculatedValues.totalAmount, remainingAmount: 0, installments: 0, interestRate: 0 };
    } else {
        finalSaleData = { ...submissionData, type: 'INSTALLMENT', totalAmount: calculatedValues.totalAmount, remainingAmount: calculatedValues.remainingAmount };
    }
    const paymentPlan = mode === 'CASH' ? [] : Array.from({ length: finalSaleData.installments }).map((_, idx) => {
        const pDate = new Date(finalSaleData.paymentDate || finalSaleData.startDate);
        pDate.setMonth(pDate.getMonth() + idx);
        return { id: `pay_${Date.now()}_${idx}`, saleId, amount: Number((finalSaleData.remainingAmount / finalSaleData.installments).toFixed(2)), date: pDate.toISOString(), isPaid: false };
    });
    const fullSaleObject = { ...finalSaleData, paymentPlan };
    setCreatedSale(fullSaleObject);
    setShowConfirmModal(false);
    onSubmit(fullSaleObject);
    setShowSuccessModal(true);
  };

  const updateMode = (newMode: 'INSTALLMENT' | 'CASH') => { setMode(newMode); setFormData(prev => ({ ...prev, mode: newMode })); };

  // === renderContractContent (Скрытый рендер для PDF) ===
  const renderContractContent = () => {
      if (!createdSale || !selectedCustomer) return null;

      const sale = createdSale;
      const companyName = appSettings?.companyName || "Компания";
      const hasGuarantor = !!sale.guarantorName;
      const sellerPhone = appSettings?.sellerPhone || (appSettings?.whatsapp?.idInstance ? `+${appSettings.whatsapp.idInstance}` : '+7 (___) ___-__-__');

      const styles = {
          page: {
              width: '210mm', minHeight: '297mm', padding: '20mm', background: 'white', color: 'black',
              fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '12pt', lineHeight: '1.5',
              display: 'flex', flexDirection: 'column' as const, boxSizing: 'border-box' as const, margin: '0 auto',
              position: 'absolute' as const, left: '-9999px', top: '-9999px', visibility: 'hidden' as const
          },
          contentWrapper: { flex: 1 },
          h1: { textAlign: 'center' as const, fontSize: '16pt', fontWeight: 'bold' as const, marginBottom: '30px', textTransform: 'uppercase' as const, marginTop: 0, lineHeight: 1.3 },
          headerInfo: { textAlign: 'right' as const, marginBottom: '20px', fontSize: '11pt' },
          fieldRow: { display: 'flex', justifyContent: 'space-between' as const, marginBottom: '10px', alignItems: 'flex-start' as const },
          fieldLabel: { fontWeight: 'bold' as const },
          phoneField: { textAlign: 'right' as const, marginLeft: '10px', flexShrink: 0, whiteSpace: 'nowrap' as const },
          section: { margin: '0 0 20px 0' },
          sectionItem: { marginBottom: '12px' },
          sectionItemLast: { marginBottom: 0 },
          table: { width: '100%' as const, borderCollapse: 'collapse' as const, margin: '20px 0', fontSize: '11pt' },
          th: { border: '1px solid #000', padding: '10px', textAlign: 'center' as const, verticalAlign: 'middle' as const, fontWeight: 'bold' as const, background: '#f9f9f9' },
          td: { border: '1px solid #000', padding: '10px', textAlign: 'center' as const, verticalAlign: 'middle' as const },
          footerContainer: { marginTop: 'auto', paddingTop: '20px', width: '100%', breakInside: 'avoid' as const },
          footer: { display: 'flex', justifyContent: 'space-between' as const, alignItems: 'flex-end' as const, width: '100%' },
          signatureBlock: (width: string) => ({ textAlign: 'center' as const, width, breakInside: 'avoid' as const }),
          signatureLine: { borderBottom: '1px solid #000', margin: '35px 0 5px 0', minHeight: '1px' },
          signatureLabel: { fontSize: '10pt', fontStyle: 'italic' as const }
      };

      let currentDebt = sale.totalAmount - sale.downPayment;

      return (
          <div ref={contractRef} style={styles.page}>
              <h1 style={styles.h1}>ДОГОВОР КУПЛИ-ПРОДАЖИ<br/>ТОВАРА В РАССРОЧКУ</h1>
              <div style={styles.headerInfo}>Дата: {new Date(sale.startDate).toLocaleDateString()}</div>

              <div style={styles.contentWrapper}>
                  <div style={styles.section}>
                      <div style={styles.fieldRow}>
                          <span><span style={styles.fieldLabel}>Продавец:</span> {companyName}</span>
                          <span style={styles.phoneField}>Тел: {sellerPhone}</span>
                      </div>
                      <div style={styles.fieldRow}>
                          <span><span style={styles.fieldLabel}>Покупатель:</span> {selectedCustomer.name}</span>
                          <span style={styles.phoneField}>Тел: {selectedCustomer.phone}</span>
                      </div>
                      {hasGuarantor && (
                          <div style={styles.fieldRow}>
                              <span><span style={styles.fieldLabel}>Поручитель:</span> {sale.guarantorName}</span>
                              <span style={styles.phoneField}>Тел: {sale.guarantorPhone}</span>
                          </div>
                      )}
                  </div>

                  <div style={styles.section}>
                      <div style={styles.sectionItem}><span style={styles.fieldLabel}>Товар:</span> {sale.productName}</div>
                      <div style={{...styles.sectionItem, display: 'flex', justifyContent: 'space-between', marginTop: '10px'}}>
                          <span><span style={styles.fieldLabel}>Срок рассрочки:</span> {sale.installments} мес.</span>
                          <span><span style={styles.fieldLabel}>Стоимость:</span> {sale.totalAmount.toLocaleString()} ₽</span>
                      </div>
                      <div style={{...styles.sectionItemLast, display: 'flex', justifyContent: 'space-between'}}>
                          <span><span style={styles.fieldLabel}>Ежемесячный платеж:</span> {(sale.paymentPlan[0]?.amount || 0).toLocaleString()} ₽</span>
                          <span><span style={styles.fieldLabel}>Первый взнос:</span> {sale.downPayment.toLocaleString()} ₽</span>
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
                          {sale.paymentPlan.map((p: any, index: number) => {
                              currentDebt -= p.amount;
                              const displayDebt = Math.max(0, currentDebt);
                              return (
                                  <tr key={index}>
                                      <td style={styles.td}>{index + 1}</td>
                                      <td style={styles.td}>{new Date(p.date).toLocaleDateString()}</td>
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

  // === generatePDFBlob using html2canvas ===
  const generatePDFBlob = async (): Promise<Blob> => {
      if (!contractRef.current) throw new Error("Contract element not found");
      const element = contractRef.current;

      const originalStyle = {
          display: element.style.display,
          position: element.style.position,
          left: element.style.left,
          top: element.style.top,
          visibility: element.style.visibility,
          zIndex: element.style.zIndex
      };

      // Temporarily make visible for capture
      element.style.display = 'block';
      element.style.position = 'absolute';
      element.style.left = '0';
      element.style.top = '0';
      element.style.visibility = 'visible';
      element.style.zIndex = '9999'; // Bring to front to ensure no overlays
      element.style.background = 'white'; // Ensure background is white

      try {
          // Wait for render
          await new Promise(resolve => setTimeout(resolve, 300));

          const canvas = await html2canvas(element, {
              scale: 2, // Higher scale for better quality
              useCORS: true,
              logging: false,
              backgroundColor: '#ffffff'
          });

          const imgData = canvas.toDataURL('image/jpeg', 0.8);
          const pdf = new jsPDF('p', 'mm', 'a4');
          const pdfWidth = pdf.internal.pageSize.getWidth();
          const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

          pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
          return pdf.output('blob');
      } finally {
          // Restore original styles
          element.style.display = originalStyle.display;
          element.style.position = originalStyle.position;
          element.style.left = originalStyle.left;
          element.style.top = originalStyle.top;
          element.style.visibility = originalStyle.visibility;
          element.style.zIndex = originalStyle.zIndex;
      }
  };

   const handleSendContract = async () => {
      if (!createdSale || !selectedCustomer || !appSettings.whatsapp?.enabled) return;
      try {
          const blob = await generatePDFBlob();

          // Очищаем название товара: оставляем только буквы (рус/анг), цифры и пробелы
          // Заменяем все лишние символы (/, \, :, *, ?, ", <, >, |) на подчеркивание
          let cleanProductName = createdSale.productName
              .replace(/[^а-яА-ЯёЁa-zA-Z0-9\s-]/g, '_')
              .replace(/\s+/g, '_'); // Заменяем пробелы на подчеркивание

          // Формируем имя: Договор_НазваниеТовара.pdf
          const fileName = `Договор_${cleanProductName}.pdf`;

          const success = await sendWhatsAppFile(
              appSettings.whatsapp.idInstance,
              appSettings.whatsapp.apiTokenInstance,
              selectedCustomer.phone,
              blob,
              fileName
          );

          if (success) alert("Договор успешно отправлен!");
          else alert("Ошибка отправки WhatsApp");
      } catch (error) {
          console.error("Error generating or sending PDF:", error);
          alert("Ошибка при создании или отправке файла.");
      }
  };

  const handlePrintContract = () => {
    if (!createdSale) return;
    const sale = createdSale;
    const customer = selectedCustomer;
    const companyName = appSettings?.companyName || "Компания";
    // Исправлено: получение телефона без ошибки user
    const sellerPhone = appSettings?.sellerPhone || (appSettings?.whatsapp?.idInstance ? `+${appSettings.whatsapp.idInstance}` : '+7 (___) ___-__-__');
    const hasGuarantor = !!sale.guarantorName;

    const printWindow = window.open('', '_blank');
    if (!printWindow) { alert("Разрешите всплывающие окна для печати"); return; }

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
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Договор купли-продажи</title>
            <style>
                * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                body { 
                    font-family: 'Arial', Helvetica, sans-serif; 
                    font-size: 12pt; 
                    line-height: 1.5; 
                    padding: 20mm;
                    width: 100%;
                    max-width: 210mm;
                    margin: 0 auto;
                    /* Убрали flex/min-height, чтобы работал естественный поток страницы */
                }
                h1 { text-align: center; font-size: 15pt; font-weight: bold; margin: 0 0 25px 0; text-transform: uppercase; }
                .header-info { text-align: right; margin-bottom: 20px; font-size: 11pt; }
                
                .field-row { display: flex; justify-content: space-between; margin-bottom: 10px; }
                .field-label { font-weight: bold; }
                
                .section { margin: 0 0 20px 0; }
                .section > div { margin-bottom: 12px; }
                .section > div:last-child { margin-bottom: 0; }
                
                table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 10.5pt; }
                th, td { border: 1px solid #000; padding: 8px; text-align: center; }
                th { font-weight: bold; background: #f9f9f9; }
                
                /* Контейнер контента */
                .content-wrapper { 
                    width: 100%;
                }

                /* Футер с подписями */
                .footer-container {
                    width: 100%;
                    margin-top: 40px; /* Отступ от текста */
                    /* Запрещаем разрыв внутри блока подписей */
                    break-inside: avoid;
                    page-break-inside: avoid;
                }
                .footer { display: flex; justify-content: space-between; align-items: flex-end; width: 100%; }
                .signature-block { 
                    text-align: center; 
                    break-inside: avoid;
                    page-break-inside: avoid;
                }
                .signature-line { border-bottom: 1px solid #000; margin: 40px 0 5px 0; min-height: 1px; }
                .signature-label { font-size: 10pt; font-style: italic; }

                .no-print { 
                    position: fixed; top: 15px; right: 15px; padding: 10px 18px;
                    background: #ef4444; color: white; border: none; border-radius: 6px;
                    cursor: pointer; font-family: sans-serif; font-weight: 600; z-index: 1000;
                }

                @media print {
                    @page { margin: 1.5cm; size: A4 portrait; }
                    
                    body { 
                        padding: 0; 
                        margin: 0; 
                        width: 100%; 
                        max-width: none; 
                    }

                    .field-row { flex-wrap: nowrap !important; gap: 0 !important; }
                    .field-row > span:last-child { text-align: right !important; margin-left: 10px; }
                    
                    /* === ГЛАВНОЕ ИСПРАВЛЕНИЕ === */
                    /* 1. Резервируем место внизу страницы под подписи (высота ~170px) */
                    .content-wrapper {
                        margin-bottom: 170px; 
                    }
                    
                    /* 2. Возвращаем футер в поток (убираем absolute) */
                    .footer-container {
                        position: relative !important;
                        bottom: auto !important;
                        left: auto !important;
                        right: auto !important;
                        width: 100% !important;
                        margin: 0 !important;
                        padding-top: 0 !important;
                        /* Тянем его вверх, чтобы он встал в зарезервированное место */
                        margin-top: -150px !important; 
                        
                        /* Гарантируем, что он не разорвется */
                        break-inside: avoid !important;
                        page-break-inside: avoid !important;
                    }

                    .footer { display: flex !important; justify-content: space-between !important; }
                    .signature-block { display: block !important; visibility: visible !important; }
                    
                    .no-print { display: none !important; }
                    h1 { font-size: 14pt; }
                    table { font-size: 10pt; }
                }
                
                @media screen and (max-width: 768px) {
                    body { font-size: 11pt; padding: 15px; }
                    .field-row { flex-wrap: wrap; gap: 5px; }
                    table { font-size: 9.5pt; }
                }
            </style>
        </head>
        <body>
            <button class="no-print" onclick="window.close()">✕ Закрыть</button>
            <h1>ДОГОВОР КУПЛИ-ПРОДАЖИ<br>ТОВАРА В РАССРОЧКУ</h1>
            
            <div class="header-info">Дата: ${new Date(sale.startDate).toLocaleDateString()}</div>

            <div class="content-wrapper">
                <div class="section">
                    <div class="field-row">
                        <span><span class="field-label">Продавец:</span> ${companyName}</span>
                        <span>Тел: ${sellerPhone}</span>
                    </div>
                    <div class="field-row">
                        <span><span class="field-label">Покупатель:</span> ${customer?.name || '__________________'}</span>
                        <span>Тел: ${customer?.phone || '+7 (___) ___-__-__'}</span>
                    </div>
                    ${hasGuarantor ? `<div class="field-row"><span><span class="field-label">Поручитель:</span> ${sale.guarantorName}</span><span>Тел: ${sale.guarantorPhone || ''}</span></div>` : ''}
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
                    <thead><tr><th style="width: 10%;">№</th><th style="width: 30%;">Дата</th><th style="width: 25%;">Сумма</th><th style="width: 35%;">Остаток долга</th></tr></thead>
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
                    ${hasGuarantor ? `<div class="signature-block" style="width: 30%"><div class="signature-line"></div><div class="signature-label">Поручитель</div></div>` : ''}
                    <div class="signature-block" style="width: ${hasGuarantor ? '30%' : '45%'}">
                        <div class="signature-line"></div>
                        <div class="signature-label">Покупатель</div>
                    </div>
                </div>
            </div>

            <script>window.onload = function() { setTimeout(() => { window.print(); }, 300); }</script>
        </body>
        </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
};

  return (
    <div className="space-y-4 animate-fade-in pb-20">
      {/* === СКРЫТЫЙ КОНТРАКТ ДЛЯ PDF === */}
      {renderContractContent()}

      <div className="flex items-center gap-3 border-b border-slate-200 pb-4 bg-white sticky top-0 z-10 pt-2">
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800">{ICONS.Back}</button>
          <h2 className="text-xl font-bold text-slate-800">{formData.id ? 'Редактирование' : 'Новое оформление'}</h2>
      </div>

      <div className="flex bg-white p-1 rounded-xl shadow-sm border border-slate-100">
          <button onClick={() => updateMode('INSTALLMENT')} className={`flex-1 py-3 text-sm font-bold rounded-lg transition-all ${mode === 'INSTALLMENT' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>Рассрочка</button>
          <button onClick={() => updateMode('CASH')} className={`flex-1 py-3 text-sm font-bold rounded-lg transition-all ${mode === 'CASH' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>Наличные</button>
      </div>

      <form onSubmit={handleFormSubmit} className="space-y-4">
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

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <label className="block text-sm font-medium text-slate-700 mb-1">Клиент</label>
              <div onClick={() => onSelectCustomer({ ...formData, mode })} className={`w-full p-3 border rounded-lg cursor-pointer flex justify-between items-center ${formData.customerId ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-dashed border-slate-300'}`}>
                  <div className="flex items-center gap-2">
                      {formData.customerId && <div className="text-indigo-600">{ICONS.Customers}</div>}
                      <span className={formData.customerId ? 'text-slate-800 font-bold' : 'text-slate-400'}>{selectedCustomer ? selectedCustomer.name : 'Выбрать клиента...'}</span>
                  </div>
                  <span className="text-slate-400"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>
              </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm relative">
              <label className="block text-sm font-medium text-slate-700 mb-1">Товар</label>
              <input type="text" className="w-full p-3 border border-slate-300 rounded-lg outline-none text-slate-900 placeholder:text-slate-400 bg-white" placeholder="Введите название товара..." value={formData.productName} onChange={(e) => handleProductChange(e.target.value)} />
              {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute left-4 right-4 top-[72px] bg-white border border-slate-200 rounded-lg shadow-lg z-20 max-h-40 overflow-y-auto">
                      {suggestions.map(s => (
                          <div key={s.id} className="p-3 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0 text-slate-800" onClick={() => handleSuggestionClick(s)}>
                              <p className="font-medium text-slate-800">{s.name}</p>
                              <p className="text-xs text-slate-500">Цена: {s.price} ₽</p>
                          </div>
                      ))}
                  </div>
              )}
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <label className="block text-sm font-medium text-slate-700 mb-1">Касса (Приход)</label>
              <select required className="w-full p-3 bg-white border border-slate-300 rounded-lg outline-none text-slate-900" value={formData.accountId} onChange={e => setFormData({...formData, accountId: e.target.value})}>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div className="grid grid-cols-2 gap-4">
                  <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Закуп (Себест.)</label>
                      <input type="number" min="0" className="w-full p-3 border border-slate-300 rounded-lg outline-none bg-white text-slate-900" value={formData.buyPrice === 0 ? '' : formData.buyPrice} onChange={e => setFormData({...formData, buyPrice: e.target.value})} placeholder="0" />
                  </div>
                  {mode === 'INSTALLMENT' && (
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Наценка (%)</label>
                          <input type="number" min="0" className="w-full p-3 border border-slate-300 rounded-lg outline-none bg-white text-slate-900" value={formData.interestRate === 0 ? '' : formData.interestRate} onChange={e => setFormData({...formData, interestRate: e.target.value})} placeholder="0" />
                      </div>
                  )}
              </div>
              <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{mode === 'INSTALLMENT' ? 'Цена в рассрочку' : 'Цена продажи'}</label>
                  <input type="number" min="0" className="w-full p-3 border border-slate-300 rounded-lg outline-none font-bold text-slate-900 bg-white" value={formData.price === 0 ? '' : formData.price} onChange={e => setFormData({...formData, price: e.target.value})} placeholder="0" />
                  {mode === 'INSTALLMENT' && Number(formData.buyPrice) > 0 && (<p className="text-xs text-indigo-600 mt-1">Автоматически рассчитано: {formData.buyPrice} + {formData.interestRate}%</p>)}
              </div>

              {mode === 'INSTALLMENT' && (
                  <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4">
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Срок (мес.)</label>
                          <input type="number" min="1" max="24" className="w-full p-3 border border-slate-300 rounded-lg outline-none text-slate-900 bg-white" value={formData.installments === 0 ? '' : formData.installments} onChange={e => setFormData({...formData, installments: e.target.value})} placeholder="0" />
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Первый взнос (₽)</label>
                          <input type="number" min="0" max={calculatedValues.totalAmount} className="w-full p-3 border border-slate-300 rounded-lg outline-none text-slate-900 bg-white" value={formData.downPayment === 0 ? '' : formData.downPayment} onChange={e => setFormData({...formData, downPayment: e.target.value})} placeholder="0" />
                      </div>
                  </div>
              )}
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <h3 className="text-sm font-semibold text-slate-600">Поручитель (необязательно)</h3>
              <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-xs font-medium text-slate-500 mb-1">ФИО Поручителя</label><input type="text" className="w-full p-3 border border-slate-300 rounded-lg outline-none bg-white text-slate-900" value={formData.guarantorName} onChange={e => setFormData({...formData, guarantorName: e.target.value})} /></div>
                  <div><label className="block text-xs font-medium text-slate-500 mb-1">Телефон поручителя</label><input type="text" className="w-full p-3 border border-slate-300 rounded-lg outline-none bg-white text-slate-900" value={formData.guarantorPhone} onChange={e => setFormData({...formData, guarantorPhone: e.target.value})} /></div>
              </div>
          </div>

          <div className={`${mode === 'INSTALLMENT' ? 'bg-indigo-50 border-indigo-100' : 'bg-emerald-50 border-emerald-100'} p-5 rounded-xl space-y-3 border`}>
              <div className="flex justify-between text-sm"><span className="text-slate-500">{mode === 'INSTALLMENT' ? 'Итоговая цена' : 'Цена продажи'}</span><span className="font-medium text-slate-900">{calculatedValues.totalAmount.toLocaleString()} ₽</span></div>
              {mode === 'INSTALLMENT' && (
                  <>
                    <div className="flex justify-between text-sm"><span className="text-slate-500">Чистая прибыль</span><span className="font-medium text-emerald-600">+{Math.round(calculatedValues.totalAmount - Number(formData.buyPrice)).toLocaleString()} ₽</span></div>
                    <div className="flex flex-col gap-2 text-sm pt-3 border-t border-indigo-100">
                        <span className="text-slate-500 font-medium">Округление платежа (до 100 ₽)</span>
                        <div className="flex bg-slate-100 p-1 rounded-lg">
                            <button type="button" onClick={() => setRoundingMode('NONE')} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${roundingMode === 'NONE' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>Нет</button>
                            <button type="button" onClick={() => setRoundingMode('DOWN')} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${roundingMode === 'DOWN' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>Вниз</button>
                            <button type="button" onClick={() => setRoundingMode('UP')} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${roundingMode === 'UP' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>Вверх</button>
                        </div>
                    </div>
                    <div className="flex justify-between text-sm pt-3 border-t border-indigo-100"><span className="text-indigo-800 font-semibold">Платёж в месяц</span><span className="text-indigo-800 font-bold">{calculatedValues.monthlyPayment.toLocaleString(undefined, {maximumFractionDigits: 0})} ₽</span></div>
                  </>
              )}
          </div>

          <button type="submit" className={`w-full text-white py-4 rounded-xl font-bold transition-colors shadow-lg ${mode === 'INSTALLMENT' ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200' : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200'}`}>
              {formData.id ? 'Сохранить изменения' : (mode === 'INSTALLMENT' ? 'Оформить рассрочку' : 'Провести продажу')}
          </button>
      </form>

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

      {showSuccessModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
              <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 text-center space-y-5" onClick={e => e.stopPropagation()}>
                  <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto text-3xl">{ICONS.Check}</div>
                  <div>
                      <h3 className="text-2xl font-bold text-slate-800">Успешно!</h3>
                      <p className="text-slate-500 text-sm mt-1">Сделка оформлена и сохранена.</p>
                  </div>
                  <div className="flex flex-col gap-3">
                      <button onClick={handlePrintContract} className="w-full py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 flex items-center justify-center gap-2">{ICONS.File} Печать договора</button>
                      {appSettings.whatsapp?.enabled && (
                          <button onClick={handleSendContract} className="w-full py-3 bg-emerald-50 text-emerald-600 font-bold rounded-xl hover:bg-emerald-100 flex items-center justify-center gap-2">{ICONS.Send} Отправить договор (PDF)</button>
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