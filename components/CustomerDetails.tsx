import React, { useState, useMemo, useEffect } from 'react';
import {Customer, Sale, Payment, Account, Investor, AppSettings, CustomerDocument, User} from '../types';
import { ICONS } from '../constants';
import { formatCurrency, formatDate } from '../src/utils';
import { offlineStorage } from '../services/offlineStorage';
import { parsePhoneNumberFromString, CountryCode } from 'libphonenumber-js';

interface CustomerDetailsProps {
  customer: Customer;
  sales: Sale[];
  accounts: Account[];
  investors: Investor[];
  appSettings: AppSettings;
  onBack: () => void;
  onInitiatePayment: (sale: Sale, payment: Payment) => void;
  onUndoPayment?: (saleId: string, paymentId: string) => void;
  onEditPayment?: (saleId: string, paymentId: string, newDate: string) => void;
  onUpdateCustomer?: (customer: Customer) => void;
  initialSaleId?: string | null;
  onDeleteCustomer?: (customerId: string) => void;
  user?: User | null;
}

const compressImage = (file: File, maxWidth = 1920): Promise<Blob> => {
  return new Promise((resolve) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    img.onload = () => {
      let { width, height } = img;
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else resolve(file);
      }, 'image/jpeg', 0.8);
    };

    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
};

const EditCustomerModal = ({
    customer,
    onClose,
    onUpdate,
    isOnline = navigator.onLine
}: {
    customer: Customer,
    onClose: () => void,
    onUpdate: (c: Customer) => void,
    isOnline?: boolean
}) => {
    const [name, setName] = useState(customer.name);
    const [phone, setPhone] = useState(customer.phone);
    const [address, setAddress] = useState(customer.address || '');
    const [notes, setNotes] = useState(customer.notes || '');
    const [allowWhatsapp, setAllowWhatsapp] = useState(customer.allowWhatsappNotification !== false);
    const [passportSeries, setPassportSeries] = useState(customer.passportSeries || '');
    const [passportNumber, setPassportNumber] = useState(customer.passportNumber || '');
    const [passportIssuedBy, setPassportIssuedBy] = useState(customer.passportIssuedBy || '');
    const [isUploading, setIsUploading] = useState(false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onUpdate({
            ...customer,
            name, phone, address, notes,
            allowWhatsappNotification: allowWhatsapp,
            passportSeries: passportSeries.trim() || undefined,
            passportNumber: passportNumber.trim() || undefined,
            passportIssuedBy: passportIssuedBy.trim() || undefined,
        });
        onClose();
    };

    const handleAddDocument = async () => {
        const nameInput = document.getElementById('doc-name') as HTMLInputElement;
        const categorySelect = document.getElementById('doc-category') as HTMLSelectElement;
        const fileInput = document.getElementById('doc-file') as HTMLInputElement;

        if (!fileInput.files?.[0] || !nameInput.value) {
            alert('Заполните название и выберите файл');
            return;
        }

        setIsUploading(true);

        try {
            const file = fileInput.files[0];
            if (file.size > 5 * 1024 * 1024) {
                alert('Файл слишком большой. Максимальный размер: 5 МБ');
                return;
            }

            let fileToUpload: File = file;
            if (file.type.startsWith('image/')) {
                const compressedBlob = await compressImage(file, 1920);
                fileToUpload = new File([compressedBlob], file.name, { type: 'image/jpeg' });
            }

            let fileUrl: string;
            let isTemp = false;

            if (!isOnline) {
                const tempId = await offlineStorage.saveTempFile(fileToUpload);
                fileUrl = tempId;
                isTemp = true;
            } else {
                const formData = new FormData();
                formData.append('file', fileToUpload);

                const res: Response = await fetch('/api/upload/document', {
                    method: 'POST',
                    headers: { 'x-auth-token': localStorage.getItem('token') || '' },
                    body: formData
                } as RequestInit);

                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.error || 'Ошибка загрузки на сервер');
                }

                const uploadData = await res.json();
                fileUrl = uploadData.fileUrl;
            }

            const newDoc: CustomerDocument = {
                id: crypto.randomUUID() as string,
                name: nameInput.value,
                category: categorySelect.value as CustomerDocument['category'],
                fileUrl,
                fileType: (file.type.includes('pdf') ? 'pdf' : 'image') as CustomerDocument['fileType'],
                uploadedAt: new Date().toISOString(),
                fileSize: fileToUpload.size,
                _isTemp: isTemp
            };

            const updatedDocs = [...(customer.documents || []), newDoc];
            onUpdate({ ...customer, documents: updatedDocs });

            nameInput.value = '';
            fileInput.value = '';

            if (isTemp) {
                alert('📴 Файл сохранён локально. Загрузится автоматически при подключении.');
            }
        } catch (error: any) {
            console.error('❌ Failed to add document:', error);
            alert(error.message || 'Не удалось загрузить файл. Попробуйте ещё раз.');
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl p-5 max-h-[90vh] overflow-y-auto my-4" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-slate-800 mb-4 sticky top-0 bg-white pb-2 z-10">Редактировать клиента</h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">ФИО</label>
                        <input className="w-full p-3 border border-slate-200 rounded-xl outline-none" value={name} onChange={e => setName(e.target.value)} required/>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Телефон</label>
                        <input className="w-full p-3 border border-slate-200 rounded-xl outline-none" value={phone} onChange={e => setPhone(e.target.value)} required/>
                    </div>
                    <details className="group" open>
                        <summary className="flex items-center gap-2 text-sm font-medium cursor-pointer list-none text-indigo-600">
                            <span className="transition-transform group-open:rotate-90">▶</span> 📍 Адрес и документы
                        </summary>
                        <div className="mt-3 space-y-4 p-4 bg-slate-50 rounded-xl">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Адрес</label>
                                <input className="w-full p-3 border border-slate-200 rounded-xl outline-none" placeholder="г. Москва, ул. Ленина, д. 1" value={address} onChange={e => setAddress(e.target.value)}/>
                            </div>
                            <div className="border-t border-slate-200 pt-3">
                                <p className="text-xs font-medium text-slate-500 mb-3">🪪 Паспортные данные <span className="font-normal text-slate-400">(необязательно)</span></p>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">Серия</label>
                                        <input type="text" placeholder="4501" className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-sm font-mono uppercase" value={passportSeries} onChange={e => setPassportSeries(e.target.value.replace(/[^0-9A-ZА-Я]/gi, '').toUpperCase().slice(0, 4))} maxLength={4}/>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">Номер</label>
                                        <input type="text" placeholder="123456" className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-sm font-mono" value={passportNumber} onChange={e => setPassportNumber(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))} maxLength={6}/>
                                    </div>
                                </div>
                                <div className="mt-3">
                                    <label className="block text-xs text-slate-500 mb-1">Кем выдан</label>
                                    <input type="text" placeholder="УФМС России по г. Москве" className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-sm" value={passportIssuedBy} onChange={e => setPassportIssuedBy(e.target.value)} maxLength={100}/>
                                </div>
                            </div>
                        </div>
                    </details>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Заметки</label>
                        <textarea className="w-full p-3 border border-slate-200 rounded-xl outline-none resize-none" rows={3} value={notes} onChange={e => setNotes(e.target.value)}/>
                    </div>
                    <div className="flex items-center justify-between bg-emerald-50 p-3 rounded-xl border border-emerald-100">
                        <div className="flex items-center gap-2">
                            <span className="text-emerald-600">{ICONS.Send}</span>
                            <div>
                                <p className="text-sm font-bold text-slate-800">Напоминания WhatsApp</p>
                                <p className="text-xs text-slate-500">Авто-отправка сообщений</p>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" checked={allowWhatsapp} onChange={() => setAllowWhatsapp(!allowWhatsapp)} className="sr-only peer"/>
                            <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                        </label>
                    </div>
                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onClose} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold">Отмена</button>
                        <button type="submit" className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold">Сохранить</button>
                    </div>
                    <div className="border-t border-slate-100 pt-4">
                        <label className="block text-sm font-medium text-slate-700 mb-2">Документы клиента</label>
                        {!isOnline && (
                            <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2">
                                <span className="text-amber-600 mt-0.5">⚠️</span>
                                <p className="text-xs text-amber-800"><strong>Офлайн-режим:</strong> Загрузка новых документов недоступна.</p>
                            </div>
                        )}
                        {customer.documents?.length > 0 && (
                            <div className="space-y-2 mb-3">
                                {customer.documents.map(doc => (
                                    <div key={doc.id} className="flex items-center justify-between bg-slate-50 p-3 rounded-xl">
                                        <div className="flex items-center gap-3 min-w-0 flex-1">
                                            <div className={`p-2 rounded-lg flex-shrink-0 ${doc.fileType === 'pdf' ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}`}>
                                                {doc.fileType === 'pdf' ? ICONS.File : ICONS.Image}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium text-slate-800 truncate">{doc.name}</p>
                                                <p className="text-xs text-slate-500">
                                                    {doc.category === 'passport' && '🪪 Паспорт'}
                                                    {doc.category === 'guarantor' && '🤝 Поручительство'}
                                                    {doc.category === 'contract' && '📄 Договор'}
                                                    {doc.category === 'photo' && '📷 Фото'}
                                                    {doc.category === 'other' && '📎 Другое'}
                                                </p>
                                                {doc._isTemp || doc.fileUrl?.startsWith('temp_doc_') ? (
                                                    <span className="text-[10px] text-amber-600 bg-amber-100 px-2 py-0.5 rounded mt-1 inline-block">⏳ Ожидает загрузки</span>
                                                ) : doc.fileSize ? (
                                                    <p className="text-[10px] text-slate-400 mt-1">{(doc.fileSize / 1024).toFixed(1)} КБ</p>
                                                ) : null}
                                            </div>
                                        </div>
                                        <button type="button" onClick={() => {
                                            const updatedDocs = customer.documents?.filter(d => d.id !== doc.id) || [];
                                            onUpdate({...customer, documents: updatedDocs});
                                        }} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded flex-shrink-0 ml-2" disabled={!isOnline && !(doc._isTemp || doc.fileUrl?.startsWith('temp_doc_'))}>
                                            {ICONS.Delete}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                        <details className="group">
                            <summary className={`flex items-center gap-2 text-sm font-medium cursor-pointer list-none ${!isOnline ? 'text-slate-400' : 'text-indigo-600'}`}>
                                <span className={`transition-transform ${!isOnline ? '' : 'group-open:rotate-90'}`}>▶</span> Добавить документ
                            </summary>
                            <div className="mt-3 space-y-3 p-3 bg-slate-50 rounded-xl">
                                <input type="text" placeholder="Название документа" className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-sm" id="doc-name" disabled={!isOnline}/>
                                <select className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-sm bg-white disabled:bg-slate-100 disabled:text-slate-400" id="doc-category" disabled={!isOnline}>
                                    <option value="passport">🪪 Паспорт</option>
                                    <option value="guarantor">🤝 Поручительство</option>
                                    <option value="contract">📄 Договор</option>
                                    <option value="photo">📷 Фото клиента</option>
                                    <option value="other">📎 Другое</option>
                                </select>
                                <input type="file" accept="image/*,.pdf" className="w-full text-sm text-slate-500 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:text-indigo-600 hover:file:bg-indigo-100 disabled:file:bg-slate-100 disabled:file:text-slate-400 disabled:file:cursor-not-allowed" id="doc-file" disabled={!isOnline}/>
                                <button type="button" onClick={handleAddDocument} disabled={!isOnline || isUploading} className={`w-full py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2 ${!isOnline ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : isUploading ? 'bg-indigo-400 text-white cursor-wait' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
                                    {isUploading ? (<><span className="animate-spin">⏳</span> Загрузка...</>) : !isOnline ? ('📴 Недоступно офлайн') : ('Прикрепить документ')}
                                </button>
                            </div>
                        </details>
                    </div>
                    <div className="flex gap-3 mt-4 pt-4 border-t border-slate-100 sticky bottom-0 bg-white">
                        <button type="button" onClick={onClose} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold">Отмена</button>
                        <button type="submit" className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold">Сохранить</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const CustomerDetails: React.FC<CustomerDetailsProps> = ({
    customer, sales, accounts, investors, appSettings, onBack,
    onInitiatePayment, onUndoPayment, onEditPayment, onUpdateCustomer,
    initialSaleId, onDeleteCustomer, user
}) => {
    const isEmployee = user?.role === 'employee';
    const [activeTab, setActiveTab] = useState<'INFO' | 'INSTALLMENTS'>('INFO');
    const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
    const [showEditModal, setShowEditModal] = useState(false);
    const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
    const [editDate, setEditDate] = useState('');
    const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [showBlockedDeleteModal, setShowBlockedDeleteModal] = useState(false);
    const [showActionsMenu, setShowActionsMenu] = useState(false);

    const formatFileSize = (bytes: number): string => {
        if (bytes === 0) return '0 Б';
        const k = 1024;
        const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    const handleViewDocument = (e: React.MouseEvent, doc: CustomerDocument) => {
        e.stopPropagation();
        if (!doc.fileUrl) return;
        if (doc.fileType === 'image') {
            setSelectedDocument(doc);
        }
    };

    const [selectedDocument, setSelectedDocument] = useState<CustomerDocument | null>(null);

    useEffect(() => {
        if (initialSaleId) {
            setSelectedSaleId(initialSaleId);
            setActiveTab('INSTALLMENTS');
        }
    }, [initialSaleId]);

    useEffect(() => {
        setShowActionsMenu(false);
    }, [activeTab]);

    const customerSales = Array.isArray(sales) ? sales.filter(s => s.customerId === customer.id) : [];
    const selectedSale = customerSales.find(s => s.id === selectedSaleId);

    const handleEditClick = (payment: Payment) => {
        setEditingPayment(payment);
        setEditDate(payment.date ? new Date(payment.date).toISOString().split('T')[0] : '');
    };

    const saveEdit = () => {
        if (selectedSale && editingPayment && editDate && onEditPayment) {
            onEditPayment(selectedSale.id, editingPayment.id, editDate);
            setEditingPayment(null);
        }
    };

    const handleDeleteClick = (paymentId: string) => {
        setDeletingPaymentId(paymentId);
    };

    const confirmDelete = () => {
        if (selectedSale && deletingPaymentId && onUndoPayment) {
            onUndoPayment(selectedSale.id, deletingPaymentId);
            setDeletingPaymentId(null);
        }
    };

    const formatPaymentHistory = (
        payments: Array<{
            id?: string;
            date: string | Date;
            amount: number;
            isPaid?: boolean;
            isRealPayment?: boolean;
            discountAmount?: number;
        }>,
        limit: number = 5
    ): string => {
        const paidPayments = payments
            .filter(p => p.isPaid && p.isRealPayment !== false)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        if (paidPayments.length === 0) return '';

        let history = `\n📜 *История платежей:*\n`;
        paidPayments.forEach(p => {
            const dateString = typeof p.date === 'string' ? p.date : p.date.toISOString();
            history += `   • ${formatDate(dateString)} — *${formatCurrency(p.amount, appSettings.showCents)} ₽* ✅`;
            if (p.discountAmount && p.discountAmount > 0) {
                history += ` (🎁 скидка ${formatCurrency(p.discountAmount, appSettings.showCents)} ₽)`;
            }
            history += `\n`;
        });
        return history;
    };

    const handleDeleteRequest = () => {
        if (customerSales.length > 0) {
            alert('⛔ Невозможно удалить клиента! У него есть привязанные договоры.');
            return;
        }
        setShowDeleteModal(true);
    };

    const confirmDeleteCustomer = () => {
        if (onDeleteCustomer) {
            onDeleteCustomer(customer.id);
            onBack();
        }
    };

    const normalizePhoneForWhatsApp = (phone: string, defaultCountry?: CountryCode): string | null => {
        const phoneNumber = parsePhoneNumberFromString(phone, defaultCountry);
        if (!phoneNumber?.isValid()) return null;
        return phoneNumber.number.replace('+', '');
    };

    const handleSendSaleReminder = () => {
        if (!selectedSale) return;

        // 🔹 Считаем реальную сумму оплаченную клиентом и скидки
        const totalRealPaid = selectedSale.paymentPlan
            .filter(p => p.isRealPayment === true)
            .reduce((sum, p) => sum + p.amount, 0);
        
        const totalDiscounts = selectedSale.paymentPlan
            .filter(p => (p as any).discountAmount > 0)
            .reduce((sum, p) => sum + ((p as any).discountAmount || 0), 0);

        const upcomingPayments = (selectedSale.paymentPlan || [])
            .filter(p => !p.isPaid)
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const nextPayment = upcomingPayments[0];

        const paymentHistory = formatPaymentHistory(selectedSale.paymentPlan || [], 5);

        const isClosed = selectedSale.status === 'COMPLETED' || selectedSale.remainingAmount <= 0;

        let message = `
Здравствуйте, ${customer.name}!

Информация по договору на "${selectedSale.productName}".

*Детали:*
- *Общая сумма:* ${formatCurrency(selectedSale.totalAmount, appSettings.showCents)} ₽
- *Статус:* ${isClosed ? '✅ Закрыт' : '⏳ Активен'}
- *Остаток долга:* *${formatCurrency(selectedSale.remainingAmount, appSettings.showCents)} ₽*`;

        if (totalDiscounts > 0) {
            message += `\n- *Предоставлено скидок:* ${formatCurrency(totalDiscounts, appSettings.showCents)} ₽`;
        }

        if (!isClosed && nextPayment) {
            message += `\n- *Ближайший платеж:* ${formatCurrency(nextPayment.amount, appSettings.showCents)} ₽ до ${formatDate(nextPayment.date)}`;
        }

        message += paymentHistory;

        const phone = normalizePhoneForWhatsApp(customer.phone);
        const url = `https://wa.me/${phone}?text=${encodeURIComponent(message.trim().replace(/^\s+/gm, ''))}`;
        window.open(url, '_blank');
    };

    const handleSendFullReport = () => {
        let report = `${customer.name}!\n\nВаш полный отчет по всем рассрочкам!\n\n`;

        customerSales.forEach((sale, index) => {
            const totalDiscounts = sale.paymentPlan
                .filter(p => (p as any).discountAmount > 0)
                .reduce((sum, p) => sum + ((p as any).discountAmount || 0), 0);

            const isClosed = sale.status === 'COMPLETED' || sale.remainingAmount <= 0;

            report += `*Рассрочка №${index + 1}: ${sale.productName}*\n`;
            report += ` - Статус: ${isClosed ? '✅ Закрыто' : '⏳ Активно'}\n`;
            report += ` - Остаток долга: *${formatCurrency(sale.remainingAmount, appSettings.showCents)} ₽*\n`;
            
            if (totalDiscounts > 0) {
                report += ` - 🎁 Скидки: ${formatCurrency(totalDiscounts, appSettings.showCents)} ₽\n`;
            }

            const paymentHistory = formatPaymentHistory(sale.paymentPlan || [], 3);
            if (paymentHistory) {
                report += paymentHistory;
            }
            report += `\n`;
        });

        if (customerSales.length > 1) {
            const totalDebt = customerSales.reduce((sum, s) => sum + s.remainingAmount, 0);
            const totalDiscountsAll = customerSales.reduce((sum, s) => {
                return sum + s.paymentPlan
                    .filter(p => (p as any).discountAmount > 0)
                    .reduce((s2, p) => s2 + ((p as any).discountAmount || 0), 0);
            }, 0);

            report += `━━━━━━━━━━━━━━━━━\n`;
            report += `📊 *ОБЩИЙ ИТОГ:*\n`;
            report += `• Общий долг: *${formatCurrency(totalDebt, appSettings.showCents)} ₽*\n`;
            if (totalDiscountsAll > 0) {
                report += `• 🎁 Всего скидок: *${formatCurrency(totalDiscountsAll, appSettings.showCents)} ₽*\n`;
            }
        }

        const phone = normalizePhoneForWhatsApp(customer.phone);
        const url = `https://wa.me/${phone}?text=${encodeURIComponent(report)}`;
        window.open(url, '_blank');
    };

    // 🔥 ИСПРАВЛЕННЫЙ useMemo с учётом скидок и статуса договора
    const { paidPayments, paymentSchedule, totalDiscounts, totalRealPaid } = useMemo(() => {
        if (!selectedSale || !selectedSale.paymentPlan) {
            return { paidPayments: [], paymentSchedule: [], totalDiscounts: 0, totalRealPaid: 0 };
        }

        // 1. История реальных платежей
        const paidPayments = selectedSale.paymentPlan
            .filter(p => p.isPaid && p.isRealPayment !== false)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        // 2. 🔥 Считаем общую сумму всех скидок по договору
        const totalDiscounts = selectedSale.paymentPlan
            .filter(p => (p as any).discountAmount > 0)
            .reduce((sum, p) => sum + ((p as any).discountAmount || 0), 0);

        // 3. 🔥 Считаем реальную сумму, которую заплатил клиент
        const totalRealPaid = selectedSale.paymentPlan
            .filter(p => p.isRealPayment === true)
            .reduce((sum, p) => sum + p.amount, 0);

        // 4. 🔥 ГЛАВНОЕ ИСПРАВЛЕНИЕ: Если договор закрыт — график платежей ПУСТОЙ!
        const isClosed = selectedSale.status === 'COMPLETED' || selectedSale.remainingAmount <= 0;
        
        if (isClosed) {
            return { paidPayments, paymentSchedule: [], totalDiscounts, totalRealPaid };
        }

        // 5. Иначе считаем график как раньше
        const totalAllocated = selectedSale.paymentPlan
            .filter(p => p.isPaid && p.isRealPayment !== true)
            .reduce((sum, p) => sum + p.amount, 0);

        let surplus = Math.max(0, totalRealPaid - totalAllocated);

        const scheduled = selectedSale.paymentPlan
            .filter(p => !p.isPaid && p.isRealPayment !== true)
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        const scheduleForDisplay = scheduled.map(p => {
            const amountDue = p.amount;
            const covered = Math.min(amountDue, surplus);
            surplus = Math.max(0, surplus - covered);
            const amountToPay = amountDue - covered;

            return {
                ...p,
                amountToPay: appSettings.showCents !== false ? amountToPay : Math.round(amountToPay),
            };
        }).filter(p => p.amountToPay > 0.01);

        return { paidPayments, paymentSchedule: scheduleForDisplay, totalDiscounts, totalRealPaid };
    }, [selectedSale, appSettings.showCents]);

    const getInvestorInfo = (sale: Sale) => {
        if (!accounts || !investors) return null;
        const account = accounts.find(a => a.id === sale.accountId);
        if (account?.ownerId) {
            const investor = investors.find(i => i.id === account.ownerId);
            return investor ? investor.name : null;
        }
        return null;
    };

    if (selectedSale) {
        // 🔥 ИСПРАВЛЕННЫЙ расчёт оплаченной суммы
        // paidAmount = реальная сумма клиента + скидки = полная сумма закрытия
        const paidAmount = totalRealPaid + totalDiscounts;
        const profit = selectedSale.buyPrice > 0 ? selectedSale.totalAmount - selectedSale.buyPrice : 0;
        const monthlyProfit = selectedSale.installments > 0 && profit > 0 ? profit / selectedSale.installments : 0;
        const firstPaymentDate = (selectedSale.paymentPlan && selectedSale.paymentPlan.length > 0) ? selectedSale.paymentPlan[0].date : null;
        const isClosed = selectedSale.status === 'COMPLETED' || selectedSale.remainingAmount <= 0;

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
                            <span className="font-medium text-slate-800">{formatDate(firstPaymentDate)}</span>
                        </div>
                    )}
                    <div className="flex justify-between border-b border-slate-50 pb-2">
                        <span className="text-slate-500">Цена закупа</span>
                        <span className="font-medium text-slate-800">{formatCurrency(selectedSale.buyPrice, appSettings.showCents)} ₽</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-50 pb-2">
                        <span className="text-slate-500">Цена в рассрочку</span>
                        <span className="font-medium text-slate-800">{formatCurrency(selectedSale.totalAmount, appSettings.showCents)} ₽</span>
                    </div>
                    {selectedSale.downPayment > 0 && (
                        <div className="flex justify-between border-b border-slate-50 pb-2">
                            <span className="text-slate-500">Первый взнос</span>
                            <span className="font-bold text-slate-800">{formatCurrency(selectedSale.downPayment, appSettings.showCents)} ₽</span>
                        </div>
                    )}
                    {selectedSale.installments > 0 && (
                        <div className="flex justify-between border-b border-slate-50 pb-2">
                            <span className="text-slate-500">Ежемесячный платеж</span>
                            <span className="font-bold text-indigo-600">
                                {formatCurrency(Math.round((selectedSale.totalAmount - selectedSale.downPayment) / selectedSale.installments), appSettings.showCents)} ₽
                            </span>
                        </div>
                    )}
                    
                    <div className="flex justify-between border-b border-slate-50 pb-2">
                        <span className="text-slate-500">Остаток долга</span>
                        <span className={`font-bold ${isClosed ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {isClosed ? '0 ₽' : `${formatCurrency(selectedSale.remainingAmount, appSettings.showCents)} ₽`}
                        </span>
                    </div>
                    
                    {/* 🔥 НОВОЕ: Показываем реальную сумму, которую заплатил клиент */}
                    <div className="flex justify-between border-b border-slate-50 pb-2">
                        <span className="text-slate-500">Оплачено клиентом</span>
                        <span className="font-bold text-emerald-600">{formatCurrency(totalRealPaid, appSettings.showCents)} ₽</span>
                    </div>
                    
                    {/* 🔥 НОВОЕ: Показываем сумму скидок, если они были */}
                    {totalDiscounts > 0 && (
                        <div className="flex justify-between border-b border-slate-50 pb-2 bg-amber-50/50 -mx-5 px-5 py-2">
                            <span className="text-amber-800 font-medium flex items-center gap-1">
                                🎁 Предоставлено скидок
                            </span>
                            <span className="font-bold text-amber-700">−{formatCurrency(totalDiscounts, appSettings.showCents)} ₽</span>
                        </div>
                    )}
                    
                    {selectedSale.guarantorName && (
                        <>
                            <div className="flex justify-between border-b border-slate-50 pb-2 pt-2">
                                <span className="text-slate-500">Поручитель</span>
                                <span className="font-medium text-slate-800">{selectedSale.guarantorName}</span>
                            </div>
                            {selectedSale.guarantorPhone && (
                                <div className="flex justify-between border-b border-slate-50 pb-2">
                                    <span className="text-slate-500">Телефон поручителя</span>
                                    <span className="font-medium text-slate-800">{selectedSale.guarantorPhone}</span>
                                </div>
                            )}
                        </>
                    )}
                    <div className="pt-2 mt-2 border-t border-slate-100 grid grid-cols-2 gap-4">
                        <div className="bg-emerald-50 p-3 rounded-xl">
                            <p className="text-xs text-emerald-600 mb-1">Прибыль (Общ)</p>
                            <p className="font-bold text-emerald-800">{formatCurrency(profit, appSettings.showCents)} ₽</p>
                        </div>
                        <div className="bg-blue-50 p-3 rounded-xl">
                            <p className="text-xs text-blue-600 mb-1">Прибыль / мес</p>
                            <p className="font-bold text-blue-800">~{formatCurrency(Math.round(monthlyProfit), appSettings.showCents)} ₽</p>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                    <div className="p-4 border-b border-slate-100 bg-emerald-50/50 flex justify-between items-center">
                        <h3 className="font-bold text-emerald-800">История поступлений</h3>
                        <span className="bg-emerald-100 text-emerald-700 text-xs px-2 py-1 rounded-full font-bold">{paidPayments.length}</span>
                    </div>
                    {paidPayments.length === 0 ? <div className="p-6 text-center text-slate-400 text-sm">Нет поступлений</div> : (
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-500 uppercase bg-slate-50">
                                <tr>
                                    <th className="px-4 py-3">Дата</th>
                                    <th className="px-4 py-3">Сумма</th>
                                    <th className="px-4 py-3 text-right">Действия</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paidPayments.map((payment) => {
                                    const discountAmount = (payment as any).discountAmount || 0;
                                    return (
                                        <tr key={payment.id} className="border-b border-slate-50 hover:bg-slate-50">
                                            <td className="px-4 py-3 text-slate-700">{formatDate(payment.date)}</td>
                                           
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex justify-end gap-2">
                                                    {(!isEmployee || user?.permissions?.canEdit) && (
                                                        <button onClick={() => handleEditClick(payment)} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded">
                                                            {ICONS.Edit}
                                                        </button>
                                                    )}
                                                    {(!isEmployee || user?.permissions?.canDelete) && (
                                                        <button onClick={() => handleDeleteClick(payment.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-100 rounded">
                                                            {ICONS.Delete}
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* 🔥 ИСПРАВЛЕННЫЙ график платежей — теперь пустой при закрытом договоре */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                    <div className="p-4 border-b border-slate-100 bg-slate-50">
                        <h3 className="font-bold text-slate-700">График платежей</h3>
                    </div>
                    {paymentSchedule.length === 0 ? (
                        <div className="p-6 text-center text-slate-400 text-sm">
                            {isClosed ? '✅ Договор полностью закрыт! 🎉' : 'Все оплачено! 🎉'}
                        </div>
                    ) : (
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-500 uppercase bg-slate-50">
                                <tr>
                                    <th className="px-4 py-3">Дата</th>
                                    <th className="px-4 py-3">Осталось</th>
                                    <th className="px-4 py-3">Действие</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paymentSchedule.map((payment) => (
                                    <tr key={payment.id} className="border-b border-slate-50 hover:bg-slate-50">
                                        <td className={`px-4 py-3 ${new Date(payment.date) < new Date() ? 'text-red-500 font-bold' : 'text-slate-700'}`}>
                                            {formatDate(payment.date)}
                                        </td>
                                        <td className="px-4 py-3 font-bold text-slate-800">
                                            {formatCurrency(payment.amountToPay, appSettings.showCents)} ₽
                                        </td>
                                        <td className="px-4 py-3">
                                            <button
                                                onClick={() => {
                                                    const roundedAmount = appSettings.showCents !== false
                                                        ? payment.amountToPay
                                                        : Math.round(payment.amountToPay);
                                                    onInitiatePayment(selectedSale, {...payment, amount: roundedAmount});
                                                }}
                                                className="text-indigo-600 font-bold text-xs border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-600 hover:text-white transition-colors"
                                            >
                                                Принять
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {editingPayment && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
                        <div className="bg-white w-full max-w-sm p-6 rounded-2xl shadow-xl">
                            <h3 className="text-lg font-bold text-slate-800 mb-4">Изменить дату платежа</h3>
                            <p className="text-sm text-slate-500 mb-4">Сумма: {formatCurrency(editingPayment.amount, appSettings.showCents)} ₽</p>
                            <input type="date" className="w-full p-3 border border-slate-300 rounded-xl mb-6 outline-none" value={editDate} onChange={(e) => setEditDate(e.target.value)}/>
                            <div className="flex gap-3">
                                <button onClick={() => setEditingPayment(null)} className="flex-1 py-3 bg-slate-100 rounded-xl font-medium text-slate-600">Отмена</button>
                                <button onClick={saveEdit} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold">Сохранить</button>
                            </div>
                        </div>
                    </div>
                )}
                {deletingPaymentId && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
                        <div className="bg-white w-full max-w-sm p-6 rounded-2xl shadow-xl">
                            <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">{ICONS.Delete}</div>
                            <h3 className="text-lg font-bold text-slate-800 text-center mb-2">Отменить платеж?</h3>
                            <p className="text-center text-slate-500 mb-6 text-sm">Сумма вернется в долг, а статус платежа изменится на "Не оплачено".</p>
                            <div className="flex gap-3">
                                <button onClick={() => setDeletingPaymentId(null)} className="flex-1 py-3 bg-slate-100 rounded-xl font-medium text-slate-600">Нет</button>
                                <button onClick={confirmDelete} className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold">Да, отменить</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-4 animate-fade-in pb-20">
            <div className="flex items-center gap-3 border-b border-slate-200 pb-4 bg-white sticky top-0 z-10 pt-2">
                <button onClick={onBack} className="text-slate-500 hover:text-slate-800">{ICONS.Back}</button>
                <h2 className="text-xl font-bold text-slate-800">{customer.name}</h2>
            </div>
            <div className="flex border-b border-slate-200">
                <button onClick={() => setActiveTab('INFO')} className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'INFO' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}>Информация</button>
                <button onClick={() => setActiveTab('INSTALLMENTS')} className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'INSTALLMENTS' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}>Рассрочки</button>
            </div>
            {activeTab === 'INFO' && (
                <div className="space-y-4 pt-2">
                    <div className="flex justify-center">
                        <div className="w-32 h-32 rounded-full bg-slate-200 overflow-hidden border-4 border-white shadow-lg">
                            {customer.photo ?
                                <img src={customer.photo} alt={customer.name} className="w-full h-full object-cover"/> :
                                <div className="w-full h-full flex items-center justify-center text-slate-400 text-4xl font-bold">{customer.name.charAt(0)}</div>
                            }
                        </div>
                    </div>
                    <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 space-y-4 relative">
                        {(onUpdateCustomer || onDeleteCustomer) && (
                            <div className="absolute top-4 right-4 z-20">
                                <button onClick={(e) => {
                                    e.stopPropagation();
                                    setShowActionsMenu(!showActionsMenu);
                                }} className="p-2 bg-slate-50 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors" title="Действия">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                        <circle cx="12" cy="6" r="2"/>
                                        <circle cx="12" cy="12" r="2"/>
                                        <circle cx="12" cy="18" r="2"/>
                                    </svg>
                                </button>
                                {showActionsMenu && (
                                    <>
                                        <div className="fixed inset-0 z-10" onClick={() => setShowActionsMenu(false)}/>
                                        <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-slate-100 py-1 z-20 animate-fade-in">
                                            {onUpdateCustomer && (!isEmployee || user?.permissions?.canEdit) && (
                                                <button onClick={() => {
                                                    setShowActionsMenu(false);
                                                    setShowEditModal(true);
                                                }} className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                                                    <span className="text-indigo-600">{ICONS.Edit}</span> Редактировать
                                                </button>
                                            )}
                                            {onUpdateCustomer && onDeleteCustomer && (!isEmployee || (user?.permissions?.canEdit && user?.permissions?.canDelete)) && (
                                                <div className="my-1 border-t border-slate-100"/>
                                            )}
                                            {onDeleteCustomer && (!isEmployee || user?.permissions?.canDelete) && (
                                                <button onClick={() => {
                                                    setShowActionsMenu(false);
                                                    handleDeleteRequest();
                                                }} className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
                                                    <span>{ICONS.Delete}</span> Удалить
                                                </button>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                        <div>
                            <label className="text-xs text-slate-400 uppercase">Телефон</label>
                            <p className="text-lg font-medium text-slate-800">{customer.phone}</p>
                        </div>
                        {customer.address && (
                            <div>
                                <label className="text-xs text-slate-400 uppercase">Адрес</label>
                                <p className="text-base font-medium text-slate-800">{customer.address}</p>
                            </div>
                        )}
                        {(customer.passportSeries || customer.passportNumber) && (
                            <div>
                                <label className="text-xs text-slate-400 uppercase flex items-center gap-1">Паспорт</label>
                                <p className="text-base font-medium text-slate-800 font-mono tracking-wider">
                                    {customer.passportSeries} {customer.passportNumber}
                                </p>
                                {customer.passportIssuedBy && (
                                    <p className="text-xs text-slate-500 mt-0.5 leading-snug">{customer.passportIssuedBy}</p>
                                )}
                            </div>
                        )}
                        <div>
                            <label className="text-xs text-slate-400 uppercase">Рейтинг доверия</label>
                            <div className="flex items-center gap-2 mt-1">
                                <div className="flex-1 bg-slate-100 h-2 rounded-full overflow-hidden">
                                    <div className="bg-emerald-500 h-full" style={{width: `${customer.trustScore}%`}}></div>
                                </div>
                                <span className="text-sm font-bold">{customer.trustScore}%</span>
                            </div>
                        </div>
                        <div>
                            <label className="text-xs text-slate-400 uppercase">Заметки</label>
                            <p className="text-sm text-slate-600 mt-1">{customer.notes || 'Нет заметок'}</p>
                        </div>
                        <div>
                            <label className="text-xs text-slate-400 uppercase">Напоминания WhatsApp</label>
                            <p className={`text-sm mt-1 font-bold ${customer.allowWhatsappNotification !== false ? 'text-emerald-600' : 'text-slate-400'}`}>
                                {customer.allowWhatsappNotification !== false ? 'Включены' : 'Отключены'}
                            </p>
                        </div>
                    </div>
                    {customer.documents && customer.documents.length > 0 && (
                        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="font-bold text-slate-800 flex items-center gap-2">{ICONS.File} Документы</h3>
                                <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full font-medium">{customer.documents.length}</span>
                            </div>
                            <div className="space-y-3">
                                {customer.documents?.map(doc => {
                                    const fileUrl = doc.fileUrl.startsWith('http') ? doc.fileUrl : `${window.location.origin}${doc.fileUrl}`;
                                    return (
                                        <div key={doc.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors group" onClick={(e) => handleViewDocument(e, doc)}>
                                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${doc.fileType === 'pdf' ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600 cursor-pointer'}`}>
                                                {doc.fileType === 'pdf' ? ICONS.File : ICONS.Image}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-slate-800 truncate">{doc.name}</p>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <span className="text-[10px] text-slate-500 bg-slate-200 px-1.5 py-0.5 rounded">
                                                        {doc.category === 'passport' && '🪪 Паспорт'}
                                                        {doc.category === 'guarantor' && '🤝 Поручительство'}
                                                        {doc.category === 'contract' && '📄 Договор'}
                                                        {doc.category === 'photo' && '📷 Фото'}
                                                        {doc.category === 'other' && '📎 Другое'}
                                                    </span>
                                                    {doc.fileSize && (
                                                        <span className="text-[10px] text-slate-400">{formatFileSize(doc.fileSize)}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                {doc.fileType === 'pdf' && (
                                                    <a href={fileUrl} download={doc.name} className="p-2 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-lg transition-colors" title="Скачать PDF" onClick={(e) => e.stopPropagation()}>
                                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                                            <polyline points="7 10 12 15 17 10"/>
                                                            <line x1="12" y1="15" x2="12" y2="3"/>
                                                        </svg>
                                                    </a>
                                                )}
                                                {doc.fileType === 'image' && (
                                                    <button className="p-2 text-slate-400 group-hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-colors" title="Просмотреть фото">
                                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                                            <circle cx="12" cy="12" r="3"/>
                                                        </svg>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
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
                        const isClosed = sale.status === 'COMPLETED' || sale.remainingAmount <= 0;
                        return (
                            <div key={sale.id} onClick={() => setSelectedSaleId(sale.id)} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm active:bg-slate-50 cursor-pointer">
                                <div className="flex justify-between items-start mb-2">
                                    <h3 className="font-bold text-slate-800">{sale.productName}</h3>
                                    <span className={`text-xs px-2 py-1 rounded-full ${isClosed ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'}`}>
                                        {isClosed ? 'Закрыто' : 'Активно'}
                                    </span>
                                </div>
                                <p className="text-xs text-slate-500 mb-2">от {formatDate(sale.startDate)}</p>
                                {investorName && (
                                    <div className="mb-2">
                                        <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded font-bold">Инвестор: {investorName}</span>
                                    </div>
                                )}
                                <div className="flex justify-between text-sm mt-3 pt-3 border-t border-slate-100">
                                    <span className="text-slate-500">Остаток:</span>
                                    <span className={`font-bold ${isClosed ? 'text-emerald-600' : 'text-slate-800'}`}>
                                        {isClosed ? '0 ₽' : `${formatCurrency(sale.remainingAmount, appSettings.showCents)} ₽`}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            {showEditModal && onUpdateCustomer && (
                <EditCustomerModal customer={customer} onClose={() => setShowEditModal(false)} onUpdate={onUpdateCustomer} isOnline={navigator.onLine}/>
            )}
            {selectedDocument && selectedDocument.fileType === 'image' && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/90 backdrop-blur-sm animate-fade-in" onClick={() => setSelectedDocument(null)}>
                    <div className="relative max-w-2xl w-full" onClick={e => e.stopPropagation()}>
                        <button onClick={() => setSelectedDocument(null)} className="absolute -top-12 right-0 text-white/80 hover:text-white p-2">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18"/>
                                <line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                        </button>
                        <div className="bg-white rounded-2xl overflow-hidden shadow-2xl">
                            <img src={selectedDocument.fileUrl} alt={selectedDocument.name} className="w-full h-auto max-h-[80vh] object-contain"/>
                            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
                                <div>
                                    <p className="font-medium text-slate-800">{selectedDocument.name}</p>
                                    <p className="text-xs text-slate-500">{formatFileSize(selectedDocument.fileSize || 0)} • {new Date(selectedDocument.uploadedAt).toLocaleDateString('ru-RU')}</p>
                                </div>
                                <a href={selectedDocument.fileUrl} download={selectedDocument.name} className="text-indigo-600 text-sm font-medium hover:text-indigo-700 flex items-center gap-1">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                        <polyline points="7 10 12 15 17 10"/>
                                        <line x1="12" y1="15" x2="12" y2="3"/>
                                    </svg>
                                    Скачать
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {showDeleteModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white w-full max-w-sm p-6 rounded-2xl shadow-xl animate-scale-in">
                        <div className="w-14 h-14 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">{ICONS.Delete}</div>
                        <h3 className="text-lg font-bold text-slate-800 text-center mb-2">Удалить клиента?</h3>
                        <p className="text-center text-slate-500 mb-6 text-sm">Это действие нельзя отменить. Все данные клиента будут удалены безвозвратно.</p>
                        <div className="flex gap-3">
                            <button onClick={() => setShowDeleteModal(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition">Отмена</button>
                            <button onClick={confirmDeleteCustomer} className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition shadow-lg shadow-red-200">Да, удалить</button>
                        </div>
                    </div>
                </div>
            )}
            {showBlockedDeleteModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in" onClick={() => setShowBlockedDeleteModal(false)}>
                    <div className="bg-white w-full max-w-sm p-6 rounded-2xl shadow-2xl animate-scale-in" onClick={e => e.stopPropagation()}>
                        <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10"/>
                                <line x1="12" y1="8" x2="12" y2="12"/>
                                <line x1="12" y1="16" x2="12.01" y2="16"/>
                            </svg>
                        </div>
                        <h3 className="text-lg font-bold text-slate-800 text-center mb-1">Невозможно удалить</h3>
                        <p className="text-center text-slate-500 mb-4 text-sm">У клиента <strong>{customer.name}</strong> есть активные договоры</p>
                        <div className="bg-slate-50 rounded-xl p-4 mb-6 max-h-48 overflow-y-auto">
                            <p className="text-xs font-medium text-slate-500 mb-2 uppercase">Привязанные договоры ({sales.filter(s => s.customerId === customer.id).length})</p>
                            <ul className="space-y-2">
                                {sales.filter(s => s.customerId === customer.id).map(contract => (
                                    <li key={contract.id} className="flex items-center gap-2 text-sm text-slate-700 bg-white px-3 py-2 rounded-lg border border-slate-100">
                                        <span className="text-slate-400 flex-shrink-0">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                                <polyline points="14 2 14 8 20 8"/>
                                            </svg>
                                        </span>
                                        <span className="truncate">{contract.productName}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <p className="text-center text-slate-500 text-sm mb-6">Сначала удалите привязанные договоры.</p>
                        <div className="flex gap-3">
                            <button onClick={() => {
                                setShowBlockedDeleteModal(false);
                                setActiveTab('INSTALLMENTS');
                            }} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-colors">Перейти к договорам</button>
                            <button onClick={() => setShowBlockedDeleteModal(false)} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200">Понятно</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CustomerDetails;