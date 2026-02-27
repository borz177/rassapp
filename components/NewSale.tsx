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

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [createdSale, setCreatedSale] = useState<any>(null);

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

  // === ОБНОВЛЁННАЯ generatePDFBlob ===
  const generatePDFBlob = async (): Promise<Blob> => {
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      try {
          const fontUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.66/fonts/Roboto/Roboto-Regular.ttf';
          const response = await fetch(fontUrl);
          if (response.ok) {
              const buffer = await response.arrayBuffer();
              const bytes = new Uint8Array(buffer);
              let binary = '';
              for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
              const base64 = window.btoa(binary);
              doc.addFileToVFS('Roboto-Regular.ttf', base64);
              doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
              doc.setFont('Roboto');
          }
      } catch (error) { console.error("Error loading font for PDF:", error); }

      const sale = createdSale;
      const customer = selectedCustomer;
      const company = appSettings?.companyName || "Компания";
      const sellerPhone = appSettings?.sellerPhone
        || (appSettings?.whatsapp?.idInstance ? `+${appSettings.whatsapp.idInstance}` : '+7 (___) ___-__-__');
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 20;
      const contentWidth = pageWidth - (margin * 2);

      const SIGNATURES_Y = 250;
      const SIGNATURE_HEIGHT = 25;
      let y = 20;

      const drawField = (label: string, value: string, x: number, y: number, maxWidth: number) => {
          doc.setFont('Roboto', 'bold');
          doc.text(label, x, y);
          const labelWidth = doc.getTextWidth(label);
          doc.setFont('Roboto', 'normal');
          doc.text(value, x + labelWidth + 2, y, { maxWidth: maxWidth - labelWidth - 2 });
      };

      const drawFieldWithRightValue = (label: string, value: string, x: number, y: number, colWidth: number) => {
          const colEnd = x + colWidth;
          doc.setFont('Roboto', 'bold');
          doc.text(label, x, y);
          const labelWidth = doc.getTextWidth(label);
          doc.setFont('Roboto', 'normal');
          doc.text(value, colEnd - 2, y, { align: 'right', maxWidth: colWidth - 10 });
      };

      // Title
      doc.setFontSize(14);
      doc.setFont('Roboto', 'bold');
      doc.text("ДОГОВОР КУПЛИ-ПРОДАЖИ ТОВАРА В РАССРОЧКУ", pageWidth / 2, y, { align: "center" });
      y += 10;

      // Date
      doc.setFontSize(10);
      doc.setFont('Roboto', 'normal');
      doc.text(`Дата: ${new Date(sale.startDate).toLocaleDateString()}`, pageWidth - margin, y, { align: "right" });
      y += 12;

      // Parties - с телефонами справа
      const halfWidth = contentWidth / 2;
      drawFieldWithRightValue("Продавец:", company, margin, y, halfWidth);
      drawFieldWithRightValue("Тел:", sellerPhone, margin + halfWidth, y, halfWidth);
      y += 7;

      drawFieldWithRightValue("Покупатель:", customer?.name || '', margin, y, halfWidth);
      drawFieldWithRightValue("Тел:", customer?.phone || '', margin + halfWidth, y, halfWidth);
      y += 7;

      if (sale.guarantorName) {
          drawFieldWithRightValue("Поручитель:", sale.guarantorName, margin, y, halfWidth);
          drawFieldWithRightValue("Тел:", sale.guarantorPhone || '', margin + halfWidth, y, halfWidth);
          y += 7;
      }
      y += 3;
      doc.line(margin, y, pageWidth - margin, y);
      y += 12;

      // Product Info - с одинаковыми отступами
      drawField("Товар:", sale.productName, margin, y, contentWidth);
      y += 7;

      drawField("Срок рассрочки:", `${sale.installments} мес.`, margin, y, halfWidth);
      drawField("Стоимость:", `${sale.totalAmount.toLocaleString()} ₽`, margin + halfWidth, y, halfWidth);
      y += 7;

      const monthlyPayment = sale.paymentPlan.length > 0 ? sale.paymentPlan[0].amount : 0;
      drawField("Ежемесячный платеж:", `${monthlyPayment.toLocaleString()} ₽`, margin, y, halfWidth);
      drawField("Первый взнос:", `${sale.downPayment.toLocaleString()} ₽`, margin + halfWidth, y, halfWidth);
      y += 12;

      // Table
      const headers = ["№", "Дата", "Сумма", "Остаток долга"];
      const colWidths = [15, 40, 40, 45];
      const totalColWidth = colWidths.reduce((a, b) => a + b, 0);
      const scale = contentWidth / totalColWidth;
      const scaledWidths = colWidths.map(w => w * scale);
      const startX = margin;

      if (y > 200) { doc.addPage(); y = 20; }

      doc.setFillColor(240, 240, 240);
      doc.rect(startX, y - 4, contentWidth, 8, 'F');
      doc.setFont('Roboto', 'bold');
      let currentX = startX;
      headers.forEach((h, i) => { doc.text(h, currentX + 2, y + 1); currentX += scaledWidths[i]; });
      y += 7;

      doc.setFont('Roboto', 'normal');
      let currentDebt = sale.totalAmount - sale.downPayment;

      sale.paymentPlan.forEach((p: any, i: number) => {
          if (y > 260) {
              doc.addPage(); y = 20;
              doc.setFillColor(240, 240, 240);
              doc.rect(startX, y - 4, contentWidth, 8, 'F');
              doc.setFont('Roboto', 'bold');
              currentX = startX;
              headers.forEach((h, idx) => { doc.text(h, currentX + 2, y + 1); currentX += scaledWidths[idx]; });
              y += 7;
              doc.setFont('Roboto', 'normal');
          }
          currentDebt -= p.amount;
          const displayDebt = Math.max(0, currentDebt);
          const rowData = [(i + 1).toString(), new Date(p.date).toLocaleDateString(), `${p.amount.toLocaleString()} ₽`, `${displayDebt.toLocaleString()} ₽`];
          currentX = startX;
          rowData.forEach((d, colIdx) => { doc.text(d, currentX + 2, y + 1, { maxWidth: scaledWidths[colIdx] - 4 }); currentX += scaledWidths[colIdx]; });
          doc.setDrawColor(220, 220, 220);
          doc.line(startX, y + 3, startX + contentWidth, y + 3);
          y += 7;
      });
      y += 8;

      // Footer text
      if (y > 240) { doc.addPage(); y = 20; }
      doc.setFontSize(9);
      doc.text("Продавец обязуется передать Покупателю товар, а Покупатель обязуется принять и оплатить его в рассрочку.", margin, y, { maxWidth: contentWidth, align: 'justify' });
      y += 15;

      // === Signatures ALWAYS at bottom ===
      if (y < SIGNATURES_Y) { y = SIGNATURES_Y; }
      else if (y + SIGNATURE_HEIGHT > pageHeight - margin) { doc.addPage(); y = SIGNATURES_Y; }

      const sigY = y;
      const hasGuarantor = !!sale.guarantorName;
      const sigCount = hasGuarantor ? 3 : 2;
      const sigBlockWidth = (contentWidth - (sigCount - 1) * 10) / sigCount;

      const drawSignature = (label: string, x: number, width: number) => {
          doc.setDrawColor(0, 0, 0);
          doc.setLineWidth(0.3);
          doc.line(x, sigY, x + width, sigY);
          doc.setFontSize(8);
          doc.setFont('Roboto', 'italic');
          doc.text(label, x + width / 2, sigY + 5, { align: "center" });
      };

      if (hasGuarantor) {
          drawSignature("Продавец", margin, sigBlockWidth);
          drawSignature("Поручитель", margin + sigBlockWidth + 10, sigBlockWidth);
          drawSignature("Покупатель", margin + (sigBlockWidth + 10) * 2, sigBlockWidth);
      } else {
          const twoSigWidth = (contentWidth - 10) / 2;
          drawSignature("Продавец", margin, twoSigWidth);
          drawSignature("Покупатель", margin + twoSigWidth + 10, twoSigWidth);
      }

      return doc.output('blob');
  };

  const handleSendContract = async () => {
      if (!createdSale || !selectedCustomer || !appSettings.whatsapp?.enabled) return;
      try {
          const blob = await generatePDFBlob();
          const fileName = `Contract_${selectedCustomer.name.replace(/\s/g, '_')}.pdf`;
          const success = await sendWhatsAppFile(appSettings.whatsapp.idInstance, appSettings.whatsapp.apiTokenInstance, selectedCustomer.phone, blob, fileName);
          if (success) alert("Договор успешно отправлен!");
          else alert("Ошибка отправки WhatsApp");
      } catch (error) { console.error("Error:", error); alert("Ошибка при создании или отправке файла."); }
  };

  // === ОБНОВЛЁННАЯ handlePrintContract ===
  const handlePrintContract = () => {
      if (!createdSale) return;
      const sale = createdSale;
      const customer = selectedCustomer;
      const companyName = appSettings?.companyName || "Компания";
      const sellerPhone = appSettings?.sellerPhone
        || (appSettings?.whatsapp?.idInstance ? `+${appSettings.whatsapp.idInstance}` : '+7 (___) ___-__-__');
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
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <title>Договор купли-продажи</title>
            <style>
                * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                body { 
                    font-family: 'Times New Roman', Times, serif; 
                    font-size: 12pt; 
                    line-height: 1.5; 
                    padding: 30px 25px;
                    padding-bottom: 180px;
                    width: 100%;
                    max-width: 210mm;
                    margin: 0 auto;
                    zoom: 1 !important;
                    -webkit-text-size-adjust: 100%;
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
                
                .footer-container { margin-top: auto; padding-top: 20px; width: 100%; break-inside: avoid; page-break-inside: avoid; }
                .footer { display: flex; justify-content: space-between; align-items: flex-end; width: 100%; }
                .signature-block { text-align: center; break-inside: avoid; page-break-inside: avoid; }
                .signature-line { border-bottom: 1px solid #000; margin: 35px 0 5px 0; min-height: 1px; }
                .signature-label { font-size: 10pt; font-style: italic; }

                .no-print { position: fixed; top: 15px; right: 15px; padding: 10px 18px; background: #ef4444; color: white; border: none; border-radius: 6px; cursor: pointer; font-family: sans-serif; font-weight: 600; font-size: 13px; z-index: 1000; }

                @media print {
                    @page { margin: 1cm; size: A4 portrait; }
                    body { padding: 0 1cm; margin: 0; width: 100%; max-width: none; min-height: 297mm; }
                    .field-row { flex-wrap: nowrap !important; gap: 0 !important; justify-content: space-between !important; }
                    .field-row > span:first-child { flex-shrink: 0; }
                    .field-row > span:last-child { text-align: right !important; flex-shrink: 0; margin-left: 10px; }
                    
                    .footer-container { position: absolute !important; bottom: 1cm !important; left: 1cm !important; right: 1cm !important; width: calc(100% - 2cm) !important; margin: 0 !important; padding-top: 10px !important; background: white !important; }
                    .footer { display: flex !important; justify-content: space-between !important; width: 100% !important; }
                    .signature-block { display: block !important; visibility: visible !important; opacity: 1 !important; }
                    .content-wrapper { flex: none !important; margin-bottom: 170px; }
                    
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
                    th, td { padding: 4px 6px; }
                }
                
                @media print and (max-width: 768px) {
                    body { font-size: 10.5pt; padding: 15px 10px !important; min-height: 297mm; }
                    h1 { font-size: 12pt; }
                    .field-row { flex-wrap: nowrap !important; gap: 0 !important; }
                    .field-row > span { font-size: 10pt; }
                    .field-row > span:last-child { text-align: right !important; margin-left: 8px; }
                    table { font-size: 9pt; }
                    th, td { padding: 4px 5px; }
                    .footer-container { bottom: 0.8cm !important; left: 0.8cm !important; right: 0.8cm !important; width: calc(100% - 1.6cm) !important; }
                    .signature-line { margin: 25px 0 3px 0 !important; }
                    .signature-label { font-size: 9pt !important; }
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