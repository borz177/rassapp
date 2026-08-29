import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {Customer, Sale, Payment, Account, Investor, AppSettings, CustomerDocument, User, Supplier, Task, RetailSale} from '../types';
import { ICONS } from '../constants';
import TopBarBack from './TopBarBack';
import { useBackInterceptor } from './transitions/PagePush';
import { formatCurrency, formatDate, normalizePhoneForWhatsApp, retailPaidAmount, retailRemaining } from '../src/utils';
import { offlineStorage } from '../services/offlineStorage';
import { api } from '../services/api';

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
  suppliers?: Supplier[];
  onPaySupplier?: (sale: Sale) => void;
  onCreateTask?: (draft: Partial<Task>) => void;
  /** Покупки клиента в магазине. Пусто, когда магазин выключен. */
  retailSales?: RetailSale[];
  /** Открывает «Приход» с подставленным долгом магазина */
  onInitiateRetailPayment?: (sale: RetailSale) => void;
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
}: {
    customer: Customer,
    onClose: () => void,
    onUpdate: (c: Customer) => void,
}) => {
    const [name, setName] = useState(customer.name);
    const [phone, setPhone] = useState(customer.phone);
    const [address, setAddress] = useState(customer.address || '');
    const [notes, setNotes] = useState(customer.notes || '');
    const [allowWhatsapp, setAllowWhatsapp] = useState(customer.allowWhatsappNotification !== false);
    const [passportSeries, setPassportSeries] = useState(customer.passportSeries || '');
    const [passportNumber, setPassportNumber] = useState(customer.passportNumber || '');
    const [passportIssuedBy, setPassportIssuedBy] = useState(customer.passportIssuedBy || '');

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

    return createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
    <div className="bg-white dark:bg-slate-800 w-full h-full sm:h-auto sm:max-w-sm sm:rounded-2xl shadow-xl flex flex-col sm:max-h-[90vh]" onClick={e => e.stopPropagation()}>
        {/* 🔹 Заголовок — всегда виден сверху */}
        <div className="p-5 pb-3 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
            <h3 className="text-lg font-bold text-slate-800 dark:text-white">Редактировать клиента</h3>
        </div>

        {/* 🔹 Контент формы — прокручивается */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
            <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">ФИО</label>
                <input className="w-full p-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none" value={name} onChange={e => setName(e.target.value)} required/>
            </div>
            <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Телефон</label>
                <input className="w-full p-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none" value={phone} onChange={e => setPhone(e.target.value)} required/>
            </div>
            <details className="group" open>
                <summary className="flex items-center gap-2 text-sm font-medium cursor-pointer list-none text-indigo-600 dark:text-indigo-400">
                    <span className="transition-transform group-open:rotate-90">▶</span> 📍 Адрес и паспорт
                </summary>
                <div className="mt-3 space-y-4 p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Адрес</label>
                        <input className="w-full p-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none" placeholder="г. Москва, ул. Ленина, д. 1" value={address} onChange={e => setAddress(e.target.value)}/>
                    </div>
                    <div className="border-t border-slate-200 dark:border-slate-700 pt-3">
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-3">🪪 Паспортные данные <span className="font-normal text-slate-400 dark:text-slate-500">(необязательно)</span></p>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Серия</label>
                                <input type="text" placeholder="4501" className="w-full p-2.5 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-lg outline-none text-sm font-mono uppercase" value={passportSeries} onChange={e => setPassportSeries(e.target.value.replace(/[^0-9A-ZА-Я]/gi, '').toUpperCase().slice(0, 4))} maxLength={4}/>
                            </div>
                            <div>
                                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Номер</label>
                                <input type="text" placeholder="123456" className="w-full p-2.5 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-lg outline-none text-sm font-mono" value={passportNumber} onChange={e => setPassportNumber(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))} maxLength={6}/>
                            </div>
                        </div>
                        <div className="mt-3">
                            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Кем выдан</label>
                            <input type="text" placeholder="УФМС России по г. Москве" className="w-full p-2.5 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-lg outline-none text-sm" value={passportIssuedBy} onChange={e => setPassportIssuedBy(e.target.value)} maxLength={100}/>
                        </div>
                    </div>
                </div>
            </details>
            <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Заметки</label>
                <textarea className="w-full p-3 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl outline-none resize-none" rows={3} value={notes} onChange={e => setNotes(e.target.value)}/>
            </div>
            <div className="flex items-center justify-between bg-emerald-50 dark:bg-emerald-900/30 p-3 rounded-xl border border-emerald-100 dark:border-emerald-900/50">
                <div className="flex items-center gap-2">
                    <span className="text-emerald-600 dark:text-emerald-400">{ICONS.Send}</span>
                    <div>
                        <p className="text-sm font-bold text-slate-800 dark:text-white">Напоминания WhatsApp</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Авто-отправка сообщений</p>
                    </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={allowWhatsapp} onChange={() => setAllowWhatsapp(!allowWhatsapp)} className="sr-only peer"/>
                    <div className="w-11 h-6 bg-slate-300 dark:bg-slate-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
            </div>
        </form>

        {/* 🔹 Футер с кнопками — всегда виден снизу */}
        <div className="p-5 pt-3 border-t border-slate-100 dark:border-slate-700 flex-shrink-0 bg-white dark:bg-slate-800 rounded-b-2xl">
            <div className="flex gap-3">
                <button type="button" onClick={onClose} className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold">Отмена</button>
                <button type="submit" onClick={handleSubmit} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold">Сохранить</button>
            </div>
        </div>
    </div>
</div>,
        document.body
    );
};

// 🔹 НОВОЕ: Модальное окно для управления документами
const DocumentsModal = ({
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
    const [isUploading, setIsUploading] = useState(false);
    const [selectedDocument, setSelectedDocument] = useState<CustomerDocument | null>(null);
    const [isClosing, setIsClosing] = useState(false);

    // 🔹 Drag-to-dismiss
    const [dragY, setDragY] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const touchStartY = React.useRef<number | null>(null);
    const touchStartTime = React.useRef<number>(0);
    const sheetRef = React.useRef<HTMLDivElement>(null);

    const handleClose = () => {
        setIsClosing(true);
        setTimeout(onClose, 280); // совпадает с длительностью slide-down-sheet
    };

    const handleTouchStart = (e: React.TouchEvent) => {
        // Не начинаем драг, если внутри списка идёт скролл не с самого верха
        if (sheetRef.current && sheetRef.current.scrollTop > 0) return;
        touchStartY.current = e.touches[0].clientY;
        touchStartTime.current = Date.now();
        setIsDragging(true);
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (touchStartY.current === null) return;
        const delta = e.touches[0].clientY - touchStartY.current;
        if (delta > 0) {
            // тянем только вниз, наверх не пускаем (resistance = 1 для естественности)
            setDragY(delta);
            // блокируем скролл страницы, пока тянем шторку
            if (delta > 5) e.preventDefault();
        }
    };

    const handleTouchEnd = () => {
        if (touchStartY.current === null) return;
        const elapsed = Date.now() - touchStartTime.current;
        const velocity = dragY / Math.max(elapsed, 1); // px/ms

        const shouldClose = dragY > 120 || velocity > 0.5;

        touchStartY.current = null;
        setIsDragging(false);

        if (shouldClose) {
            // плавно доезжаем вниз и закрываем
            setDragY(window.innerHeight);
            setTimeout(onClose, 200);
        } else {
            // пружинисто возвращаем на место
            setDragY(0);
        }
    };

    const formatFileSize = (bytes: number): string => {
        if (bytes === 0) return '0 Б';
        const k = 1024;
        const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    const handleAddDocument = async () => {
        const categorySelect = document.getElementById('doc-category-modal') as HTMLSelectElement;
        const fileInput = document.getElementById('doc-file-modal') as HTMLInputElement;

        if (!fileInput.files?.[0]) {
            alert('Выберите файл');
            return;
        }

        setIsUploading(true);

        try {
            const file = fileInput.files[0];
            if (file.size > 5 * 1024 * 1024) {
                alert('Файл слишком большой. Максимальный размер: 5 МБ');
                return;
            }

            const docName = file.name;

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
                name: docName,
                category: categorySelect.value as CustomerDocument['category'],
                fileUrl,
                fileType: (file.type.includes('pdf') ? 'pdf' : 'image') as CustomerDocument['fileType'],
                uploadedAt: new Date().toISOString(),
                fileSize: fileToUpload.size,
                _isTemp: isTemp
            };

            const updatedDocs = [...(customer.documents || []), newDoc];
            onUpdate({ ...customer, documents: updatedDocs });

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

    // 🔒 Документы тянем с токеном и показываем как blob-URL: сервер больше не отдаёт
    // /uploads/... без проверки прав, поэтому <img src="/uploads/..."> вернул бы 401.
    const [docObjectUrl, setDocObjectUrl] = useState<string | null>(null);
    const [docLoading, setDocLoading] = useState(false);
    const [docError, setDocError] = useState<string | null>(null);

    const loadDocumentUrl = async (doc: CustomerDocument): Promise<string | null> => {
        setDocLoading(true);
        setDocError(null);
        try {
            return await api.getDocumentUrl(doc.fileUrl);
        } catch (e: any) {
            setDocError(e?.message || 'Не удалось открыть документ');
            return null;
        } finally {
            setDocLoading(false);
        }
    };

    const handleViewDocument = async (doc: CustomerDocument) => {
        if (doc.fileType !== 'image') return;
        setSelectedDocument(doc);
        const url = await loadDocumentUrl(doc);
        setDocObjectUrl(url);
    };

    // Закрытие просмотрщика — обязательно освобождаем blob, иначе он висит в памяти
    const closeDocumentViewer = () => {
        setSelectedDocument(null);
        setDocError(null);
        setDocObjectUrl(prev => {
            if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
            return null;
        });
    };

    // Тот же blob нужен и для скачивания PDF — ссылки <a href> без токена больше не работают
    const handleDownloadDocument = async (doc: CustomerDocument) => {
        const url = await loadDocumentUrl(doc);
        if (!url) return;
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 10000);
    };

    // Страховка от утечки: если компонент размонтируют с открытым документом
    useEffect(() => () => {
        if (docObjectUrl?.startsWith('blob:')) URL.revokeObjectURL(docObjectUrl);
    }, [docObjectUrl]);

    // 🔹 Итоговый transform: либо живой драг, либо CSS-анимация
    const sheetStyle: React.CSSProperties = isDragging || dragY > 0
        ? { transform: `translateY(${dragY}px)`, transition: isDragging ? 'none' : 'transform 0.25s cubic-bezier(0.32,0.72,0,1)' }
        : {};

    return createPortal(
        <>
            <div
                className={`fixed inset-0 z-[200] flex items-end sm:items-center justify-center sm:p-4 bg-slate-900/60 backdrop-blur-sm ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
                onClick={handleClose}
            >
                <div
                    className={`bg-white dark:bg-slate-800 w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl shadow-xl flex flex-col max-h-[85vh] overflow-hidden ${isClosing ? 'animate-slide-down-sheet' : 'animate-slide-up-sheet'}`}
                    style={sheetStyle}
                    onClick={e => e.stopPropagation()}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                >
                    {/* 🔹 Ручка как в Telegram — основная зона захвата для свайпа */}
                    <div className="flex-shrink-0 flex justify-center pb-1 pt-2 sm:hidden cursor-grab active:cursor-grabbing">
                        <div className="w-10 h-1.5 bg-slate-300 dark:bg-slate-600 rounded-full"/>
                    </div>

                    <h3 className="flex-shrink-0 text-lg font-bold text-slate-800 dark:text-white px-5 pt-2 sm:pt-5 pb-2 flex items-center justify-between">
                        <span>📎 Документы</span>
                        <span className="text-sm font-normal text-slate-400 dark:text-slate-500">{customer.documents?.length || 0} шт.</span>
                    </h3>

                    <div ref={sheetRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-4">
                    {!isOnline && (
                        <div className="mb-3 p-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-900/50 rounded-xl flex items-start gap-2">
                            <span className="text-amber-600 dark:text-amber-400 mt-0.5">⚠️</span>
                            <p className="text-xs text-amber-800 dark:text-amber-300"><strong>Офлайн-режим:</strong> Загрузка новых документов недоступна.</p>
                        </div>
                    )}

                    {customer.documents && customer.documents.length > 0 ? (
                        <div className="space-y-2 mb-4">
                            {customer.documents.map(doc => {
                                return (
                                    <div key={doc.id} className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors group">
                                        <div
                                            className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${doc.fileType === 'pdf' ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 cursor-pointer'}`}
                                            onClick={() => handleViewDocument(doc)}
                                        >
                                            {doc.fileType === 'pdf' ? ICONS.File : ICONS.Image}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-slate-800 dark:text-white truncate">{doc.name}</p>
                                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                                <span className="text-[10px] text-slate-500 dark:text-slate-400 bg-slate-200 dark:bg-slate-600 px-1.5 py-0.5 rounded">
                                                    {doc.category === 'passport' && '🪪 Паспорт'}
                                                    {doc.category === 'guarantor' && '🤝 Поручительство'}
                                                    {doc.category === 'contract' && '📄 Договор'}
                                                    {doc.category === 'photo' && '📷 Фото'}
                                                    {doc.category === 'other' && '📎 Другое'}
                                                </span>
                                                {doc._isTemp || doc.fileUrl?.startsWith('temp_doc_') ? (
                                                    <span className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 rounded">⏳ Ожидает</span>
                                                ) : doc.fileSize ? (
                                                    <span className="text-[10px] text-slate-400 dark:text-slate-500">{formatFileSize(doc.fileSize)}</span>
                                                ) : null}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1 flex-shrink-0">
                                            {doc.fileType === 'pdf' && (
                                                <button
                                                    type="button"
                                                    disabled={docLoading}
                                                    onClick={(e) => { e.stopPropagation(); handleDownloadDocument(doc); }}
                                                    className="p-1.5 text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg transition-colors disabled:opacity-50"
                                                    title="Скачать PDF"
                                                >
                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                                        <polyline points="7 10 12 15 17 10"/>
                                                        <line x1="12" y1="15" x2="12" y2="3"/>
                                                    </svg>
                                                </button>
                                            )}
                                            {doc.fileType === 'image' && (
                                                <button onClick={() => handleViewDocument(doc)} className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors" title="Просмотреть">
                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                                        <circle cx="12" cy="12" r="3"/>
                                                    </svg>
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    if (!window.confirm('Удалить документ?')) return;
                                                    // Сначала файл с диска — пока ссылка на него ещё есть в записи,
                                                    // по ней сервер проверяет права. Если не выйдет, всё равно
                                                    // убираем документ из карточки: не блокировать же пользователя
                                                    // из-за файла, его подберёт периодическая чистка.
                                                    try {
                                                        await api.deleteDocumentFile(doc.fileUrl);
                                                    } catch (e) {
                                                        console.warn('Не удалось удалить файл документа:', e);
                                                    }
                                                    const updatedDocs = customer.documents?.filter(d => d.id !== doc.id) || [];
                                                    onUpdate({...customer, documents: updatedDocs});
                                                }}
                                                className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                                                disabled={!isOnline && !(doc._isTemp || doc.fileUrl?.startsWith('temp_doc_'))}
                                                title="Удалить"
                                            >
                                                {ICONS.Delete}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="text-center py-8 text-slate-400 dark:text-slate-500 text-sm">
                            <div className="text-4xl mb-2">📂</div>
                            <p>Документов пока нет</p>
                        </div>
                    )}

                    <div className="border-t border-slate-100 dark:border-slate-700 pt-4">
                       <details className="group">
                            <summary className={`flex items-center gap-2 text-sm font-medium cursor-pointer list-none ${!isOnline ? 'text-slate-400 dark:text-slate-500' : 'text-indigo-600 dark:text-indigo-400'}`}>
                                <span className={`transition-transform ${!isOnline ? '' : 'group-open:rotate-90'}`}>▶</span> Добавить документ
                            </summary>
                            <div className="mt-3 space-y-3 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
                                <select className="w-full p-2.5 border border-slate-200 dark:border-slate-600 rounded-lg outline-none text-sm bg-white dark:bg-slate-900 dark:text-white disabled:bg-slate-100 dark:disabled:bg-slate-700 disabled:text-slate-400" id="doc-category-modal" disabled={!isOnline}>
                                    <option value="passport">🪪 Паспорт</option>
                                    <option value="guarantor">🤝 Поручительство</option>
                                    <option value="contract">📄 Договор</option>
                                    <option value="photo">📷 Фото клиента</option>
                                    <option value="other">📎 Другое</option>
                                </select>
                                <input type="file" accept="image/*,.pdf" className="w-full text-sm text-slate-500 dark:text-slate-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-indigo-50 dark:file:bg-indigo-900/30 file:text-indigo-600 dark:file:text-indigo-400 hover:file:bg-indigo-100 dark:hover:file:bg-indigo-900/50 disabled:file:bg-slate-100 dark:disabled:file:bg-slate-700 disabled:file:text-slate-400" id="doc-file-modal" disabled={!isOnline}/>
                                <button type="button" onClick={handleAddDocument} disabled={!isOnline || isUploading} className={`w-full py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2 ${!isOnline ? 'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed' : isUploading ? 'bg-indigo-400 text-white cursor-wait' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
                                    {isUploading ? (<><span className="animate-spin">⏳</span> Загрузка...</>) : !isOnline ? ('📴 Недоступно офлайн') : ('Прикрепить документ')}
                                </button>
                            </div>
                        </details>
                    </div>
                    </div>

                    <div className="flex-shrink-0 flex gap-3 px-5 py-4 border-t border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800">
                        <button type="button" onClick={handleClose} className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold">Закрыть</button>
                    </div>
                </div>
            </div>

            {selectedDocument && selectedDocument.fileType === 'image' && (
                <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-slate-900/90 backdrop-blur-sm animate-fade-in" onClick={closeDocumentViewer}>
                    <div className="relative max-w-2xl w-full" onClick={e => e.stopPropagation()}>
                        <button onClick={closeDocumentViewer} className="absolute -top-12 right-0 text-white/80 hover:text-white p-2">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18"/>
                                <line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                        </button>
                        <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden shadow-2xl">
                            {docLoading ? (
                                <div className="h-64 flex flex-col items-center justify-center gap-3 text-slate-400">
                                    <svg className="animate-spin h-8 w-8" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                                    </svg>
                                    <span className="text-sm">Загружаем документ…</span>
                                </div>
                            ) : docError ? (
                                <div className="h-64 flex flex-col items-center justify-center gap-2 px-6 text-center">
                                    <span className="text-3xl">⚠️</span>
                                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{docError}</p>
                                    <button
                                        onClick={async () => setDocObjectUrl(await loadDocumentUrl(selectedDocument))}
                                        className="btn-press mt-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold"
                                    >
                                        Повторить
                                    </button>
                                </div>
                            ) : docObjectUrl ? (
                                <img src={docObjectUrl} alt={selectedDocument.name} className="w-full h-auto max-h-[80vh] object-contain"/>
                            ) : null}
                            <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50 flex items-center justify-between">
                                <div>
                                    <p className="font-medium text-slate-800 dark:text-white">{selectedDocument.name}</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">{formatFileSize(selectedDocument.fileSize || 0)} • {new Date(selectedDocument.uploadedAt).toLocaleDateString('ru-RU')}</p>
                                </div>
                                <button
                                    type="button"
                                    disabled={docLoading}
                                    onClick={() => handleDownloadDocument(selectedDocument)}
                                    className="text-indigo-600 dark:text-indigo-400 text-sm font-medium hover:text-indigo-700 dark:hover:text-indigo-300 flex items-center gap-1 disabled:opacity-50"
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                        <polyline points="7 10 12 15 17 10"/>
                                        <line x1="12" y1="15" x2="12" y2="3"/>
                                    </svg>
                                    Скачать
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>,
        document.body
    );
};

const CustomerDetails: React.FC<CustomerDetailsProps> = ({
    customer, sales, accounts, investors, appSettings, onBack,
    onInitiatePayment, onUndoPayment, onEditPayment, onUpdateCustomer,
    initialSaleId, onDeleteCustomer, user, suppliers, onPaySupplier, onCreateTask,
    retailSales = [], onInitiateRetailPayment
}) => {
    const supplierList: Supplier[] = suppliers || [];
    const isEmployee = user?.role === 'employee';
    const [activeTab, setActiveTab] = useState<'INFO' | 'INSTALLMENTS' | 'HISTORY'>('INFO');
    const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showDocumentsModal, setShowDocumentsModal] = useState(false);
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

    // Покупки в магазине и деньги по ним. Считаем по самим чекам: цена
    // зафиксирована в момент продажи, и пересчёт по нынешним ценам переписывал
    // бы прошлое после каждой переоценки.
    const customerRetail = useMemo(
        () => retailSales
            .filter(r => r.customerId === customer.id && !r.isCancelled)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        [retailSales, customer.id]
    );

    const retailTotals = useMemo(() => ({
        bought: customerRetail.reduce((sum, r) => sum + r.total, 0),
        received: customerRetail.reduce((sum, r) => sum + (r.isCredit ? retailPaidAmount(r) : r.total), 0),
        debt: customerRetail.reduce((sum, r) => sum + retailRemaining(r), 0),
    }), [customerRetail]);

    // Единая лента: покупка и полученные по ней деньги — события одной истории,
    // и разложенные по двум спискам они перестают отвечать на вопрос «а что
    // между ними произошло».
    const retailTimeline = useMemo(() => {
        const events: {
            key: string; kind: 'BUY' | 'PAY'; date: string; amount: number;
            title: string; subtitle?: string; sale: RetailSale;
        }[] = [];
        customerRetail.forEach(r => {
            events.push({
                key: `buy_${r.id}`, kind: 'BUY', date: r.date, amount: r.total, sale: r,
                title: r.items.map(i => `${i.name}${i.quantity > 1 ? ` × ${i.quantity}` : ''}`).join(', ') || 'Покупка',
                subtitle: [r.docNumber ? `Чек №${r.docNumber}` : null, r.isCredit ? 'в долг' : 'оплачено'].filter(Boolean).join(' · '),
            });
            (r.payments || []).forEach(pm => {
                events.push({
                    key: `pay_${pm.id}`, kind: 'PAY', date: pm.date, amount: pm.amount, sale: r,
                    title: 'Оплата',
                    subtitle: [r.docNumber ? `по чеку №${r.docNumber}` : null, pm.note].filter(Boolean).join(' · '),
                });
            });
        });
        return events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [customerRetail]);

    // Вкладку показываем только когда за ней что-то есть: пустая «Рассрочка» у
    // розничного покупателя — обещание раздела, которого нет.
    const showInstallmentsTab = customerSales.length > 0;
    const showHistoryTab = customerRetail.length > 0;

    // Открытый договор — шаг внутрь карточки, а не отдельная страница,
    // и свайп назад должен вернуть к списку договоров, а не закрывать клиента.
    useBackInterceptor(!!selectedSaleId, () => setSelectedSaleId(null));
    // Последняя рассрочка может быть удалена, пока вкладка открыта — оставить
    // пользователя на исчезнувшем разделе нельзя.
    useEffect(() => {
        if (activeTab === 'INSTALLMENTS' && !showInstallmentsTab) setActiveTab('INFO');
        if (activeTab === 'HISTORY' && !showHistoryTab) setActiveTab('INFO');
    }, [activeTab, showInstallmentsTab, showHistoryTab]);
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

    // Собирает ссылку на WhatsApp. Номер нормализуется общим помощником из src/utils.ts:
    // здесь была своя копия, которая вызывала parsePhoneNumberFromString без страны
    // по умолчанию и на номерах вида 89001234567 возвращала null — он подставлялся
    // в адрес, и WhatsApp открывался с «Имя пользователя null не зарегистрировано».
    const openWhatsApp = (text: string): void => {
        const phone = normalizePhoneForWhatsApp(customer.phone);
        if (!phone) {
            alert(`У клиента «${customer.name}» не указан корректный номер телефона — отправить сообщение в WhatsApp не получится.`);
            return;
        }
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
    };

    // 🔥 ИСПРАВЛЕНИЕ: теперь ближайший платеж берётся из paymentSchedule,
    // который уже учитывает авансовые оплаты (surplus от переплат и скидок)
    const handleSendSaleReminder = () => {
        if (!selectedSale) return;

        const paymentHistory = formatPaymentHistory(selectedSale.paymentPlan || [], 5);
        const isClosed = selectedSale.status === 'COMPLETED' || selectedSale.remainingAmount <= 0;

        // 🔹 Ближайший платёж — первый из графика, который уже рассчитан с учётом surplus
        const nextPayment = paymentSchedule[0];

        let message = `
${customer.name}!

Информация по договору на "${selectedSale.productName}".

*Детали:*
- *Общая сумма:* ${formatCurrency(selectedSale.totalAmount, appSettings.showCents)} ₽
- *Статус:* ${isClosed ? '✅ Закрыт' : '⏳ Активен'}
- *Остаток долга:* *${formatCurrency(selectedSale.remainingAmount, appSettings.showCents)} ₽*`;

        if (totalDiscounts > 0) {
            message += `\n- *Предоставлено скидок:* ${formatCurrency(totalDiscounts, appSettings.showCents)} ₽`;
        }

        if (!isClosed && nextPayment) {
            message += `\n- *Ближайший платеж:* ${formatCurrency(nextPayment.amountToPay, appSettings.showCents)} ₽ до ${formatDate(nextPayment.date)}`;
        }

        message += paymentHistory;

        openWhatsApp(message.trim().replace(/^\s+/gm, ''));
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

        openWhatsApp(report);
    };

    // 🔥 ИСПРАВЛЕННЫЙ useMemo с учётом скидок и статуса договора
    const { paidPayments, paymentSchedule, totalDiscounts, totalRealPaid } = useMemo(() => {
        if (!selectedSale || !selectedSale.paymentPlan) {
            return { paidPayments: [], paymentSchedule: [], totalDiscounts: 0, totalRealPaid: 0 };
        }

        const paidPayments = selectedSale.paymentPlan
            .filter(p => p.isPaid && p.isRealPayment !== false)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        const totalDiscounts = selectedSale.paymentPlan
            .filter(p => (p as any).discountAmount > 0)
            .reduce((sum, p) => sum + ((p as any).discountAmount || 0), 0);

        // 🔒 Тот же фильтр, что и у paidPayments (isPaid && isRealPayment !== false) — раньше здесь
        // была строгая проверка isRealPayment === true, из-за чего "Оплачено клиентом" не учитывала
        // платежи графика, помеченные оплаченными без явного isRealPayment (например, при импорте
        // Excel), хотя remainingAmount (см. NewSale.tsx preservedPaymentsInfo) их уже учитывает —
        // из-за этого расхождения "Остаток долга" + "Оплачено клиентом" не сходилось с общей суммой.
        const totalRealPaid = selectedSale.paymentPlan
            .filter(p => p.isPaid && p.isRealPayment !== false)
            .reduce((sum, p) => sum + p.amount, 0);

        const isClosed = selectedSale.status === 'COMPLETED' || selectedSale.remainingAmount <= 0;
        
        if (isClosed) {
            return { paidPayments, paymentSchedule: [], totalDiscounts, totalRealPaid };
        }

        const totalAllocated = selectedSale.paymentPlan
            .filter(p => p.isPaid && p.isRealPayment !== true)
            .reduce((sum, p) => sum + p.amount, 0);

        let surplus = Math.max(0, totalRealPaid - totalAllocated);

        const scheduled = selectedSale.paymentPlan
            .filter(p => !p.isPaid && p.isRealPayment !== true)
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        // 🔒 Порог отсечения — 1 ₽ от НЕокруглённого остатка, а не «больше копейки» от
        // округлённого. Суммы платежей — это доли вроде 91 000 / 3 = 30 333,33, поэтому при
        // приёме округлённых рублей на каждом платеже копится остаток в копейки. Раньше он
        // проходил фильтр и после второго-третьего платежа вылезал строкой «1 ₽» по месяцу,
        // который пользователь только что оплатил ровно той суммой, что показывал график.
        // Такой остаток — артефакт округления, а не долг (на проде так висело 20 договоров).
        const scheduleForDisplay = scheduled
            .map(p => {
                const amountDue = p.amount;
                const covered = Math.min(amountDue, surplus);
                surplus = Math.max(0, surplus - covered);
                return { payment: p, amountToPay: amountDue - covered };
            })
            .filter(x => x.amountToPay >= 1)
            .map(({ payment, amountToPay }) => ({
                ...payment,
                amountToPay: appSettings.showCents !== false ? amountToPay : Math.round(amountToPay),
            }));

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
        const paidAmount = totalRealPaid + totalDiscounts;
        const profit = selectedSale.buyPrice > 0 ? selectedSale.totalAmount - selectedSale.buyPrice : 0;
        const monthlyProfit = selectedSale.installments > 0 && profit > 0 ? profit / selectedSale.installments : 0;
        const firstPaymentDate = (selectedSale.paymentPlan && selectedSale.paymentPlan.length > 0) ? selectedSale.paymentPlan[0].date : null;
        const isClosed = selectedSale.status === 'COMPLETED' || selectedSale.remainingAmount <= 0;

        return (
            <div className="space-y-4 animate-fade-in pb-20 relative">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-4 pt-2">
                    <div className="flex items-center gap-3">
                        <TopBarBack onClick={() => setSelectedSaleId(null)} />
                        <h2 className="text-xl font-bold text-slate-800 dark:text-white truncate">{selectedSale.productName}</h2>
                    </div>
                    <button onClick={handleSendSaleReminder} className="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-3 py-2 rounded-lg font-semibold text-sm flex items-center gap-2">
                        {ICONS.Send} WhatsApp
                    </button>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm border border-slate-100 dark:border-slate-700 space-y-3">
                    {firstPaymentDate && (
                        <div className="flex justify-between border-b border-slate-50 dark:border-slate-700 pb-2">
                            <span className="text-slate-500 dark:text-slate-400">Первый платеж</span>
                            <span className="font-medium text-slate-800 dark:text-white">{formatDate(firstPaymentDate)}</span>
                        </div>
                    )}
                    <div className="flex justify-between border-b border-slate-50 dark:border-slate-700 pb-2">
                        <span className="text-slate-500 dark:text-slate-400">Цена закупа</span>
                        <span className="font-medium text-slate-800 dark:text-white">{formatCurrency(selectedSale.buyPrice, appSettings.showCents)} ₽</span>
                    </div>
                    {selectedSale.supplierId && (
                        <div className="border-b border-slate-50 dark:border-slate-700 pb-2 space-y-2">
                            <div className="flex justify-between">
                                <span className="text-slate-500 dark:text-slate-400">Поставщик</span>
                                <span className="font-medium text-slate-800 dark:text-white">{supplierList.find(s => s.id === selectedSale.supplierId)?.name || '—'}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-500 dark:text-slate-400">Долг поставщику</span>
                                <span className={`font-medium ${selectedSale.isPartnerDebtPaid ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                    {selectedSale.isPartnerDebtPaid ? 'Оплачено' : `${formatCurrency(selectedSale.buyPrice - (selectedSale.partnerDebtPaidAmount || 0), appSettings.showCents)} ₽`}
                                </span>
                            </div>
                            {!selectedSale.isPartnerDebtPaid && onPaySupplier && (
                                <button
                                    onClick={() => onPaySupplier(selectedSale)}
                                    className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-bold"
                                >
                                    Оплатить поставщику
                                </button>
                            )}
                        </div>
                    )}
                    <div className="flex justify-between border-b border-slate-50 dark:border-slate-700 pb-2">
                        <span className="text-slate-500 dark:text-slate-400">Цена в рассрочку</span>
                        <span className="font-medium text-slate-800 dark:text-white">{formatCurrency(selectedSale.totalAmount, appSettings.showCents)} ₽</span>
                    </div>
                    {selectedSale.downPayment > 0 && (
                        <div className="flex justify-between border-b border-slate-50 dark:border-slate-700 pb-2">
                            <span className="text-slate-500 dark:text-slate-400">Первый взнос</span>
                            <span className="font-bold text-slate-800 dark:text-white">{formatCurrency(selectedSale.downPayment, appSettings.showCents)} ₽</span>
                        </div>
                    )}
                    {selectedSale.installments > 0 && (
                        <div className="flex justify-between border-b border-slate-50 dark:border-slate-700 pb-2">
                            <span className="text-slate-500 dark:text-slate-400">Ежемесячный платеж</span>
                            <span className="font-bold text-indigo-600 dark:text-indigo-400">
                                {formatCurrency(Math.round((selectedSale.totalAmount - selectedSale.downPayment) / selectedSale.installments), appSettings.showCents)} ₽
                            </span>
                        </div>
                    )}

                    <div className="flex justify-between border-b border-slate-50 dark:border-slate-700 pb-2">
                        <span className="text-slate-500 dark:text-slate-400">Остаток долга</span>
                        <span className={`font-bold ${isClosed ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                            {isClosed ? '0 ₽' : `${formatCurrency(selectedSale.remainingAmount, appSettings.showCents)} ₽`}
                        </span>
                    </div>

                    <div className="flex justify-between border-b border-slate-50 dark:border-slate-700 pb-2">
                        <span className="text-slate-500 dark:text-slate-400">Оплачено клиентом</span>
                        <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(totalRealPaid, appSettings.showCents)} ₽</span>
                    </div>
                    
                    {totalDiscounts > 0 && (
                        <div className="flex justify-between border-b border-slate-50 dark:border-slate-700 pb-2 bg-amber-50/50 dark:bg-amber-900/20 -mx-5 px-5 py-2">
                            <span className="text-amber-800 dark:text-amber-300 font-medium flex items-center gap-1">
                                🎁 Предоставлено скидок
                            </span>
                            <span className="font-bold text-amber-700 dark:text-amber-400">−{formatCurrency(totalDiscounts, appSettings.showCents)} ₽</span>
                        </div>
                    )}

                    {selectedSale.guarantorName && (
                        <>
                            <div className="flex justify-between border-b border-slate-50 dark:border-slate-700 pb-2 pt-2">
                                <span className="text-slate-500 dark:text-slate-400">Поручитель</span>
                                <span className="font-medium text-slate-800 dark:text-white">{selectedSale.guarantorName}</span>
                            </div>
                            {selectedSale.guarantorPhone && (
                                <div className="flex justify-between border-b border-slate-50 dark:border-slate-700 pb-2">
                                    <span className="text-slate-500 dark:text-slate-400">Телефон поручителя</span>
                                    <span className="font-medium text-slate-800 dark:text-white">{selectedSale.guarantorPhone}</span>
                                </div>
                            )}
                        </>
                    )}
                    <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-700 grid grid-cols-2 gap-4">
                        <div className="bg-emerald-50 dark:bg-emerald-900/30 p-3 rounded-xl">
                            <p className="text-xs text-emerald-600 dark:text-emerald-400 mb-1">Прибыль (Общ)</p>
                            <p className="font-bold text-emerald-800 dark:text-emerald-300">{formatCurrency(profit, appSettings.showCents)} ₽</p>
                        </div>
                        <div className="bg-blue-50 dark:bg-blue-900/30 p-3 rounded-xl">
                            <p className="text-xs text-blue-600 dark:text-blue-400 mb-1">Прибыль / мес</p>
                            <p className="font-bold text-blue-800 dark:text-blue-300">~{formatCurrency(Math.round(monthlyProfit), appSettings.showCents)} ₽</p>
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
                    <div className="p-4 border-b border-slate-100 dark:border-slate-700 bg-emerald-50/50 dark:bg-emerald-900/20 flex justify-between items-center">
                        <h3 className="font-bold text-emerald-800 dark:text-emerald-300">История поступлений</h3>
                        <span className="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 text-xs px-2 py-1 rounded-full font-bold">{paidPayments.length}</span>
                    </div>
                    {paidPayments.length === 0 ? <div className="p-6 text-center text-slate-400 dark:text-slate-500 text-sm">Нет поступлений</div> : (
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-700/50">
                                <tr>
                                    <th className="px-4 py-3">Дата</th>
                                    <th className="px-4 py-3">Сумма</th>
                                    <th className="px-4 py-3 text-right">Действия</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paidPayments.map((payment) => {
                                    return (
                                        <tr key={payment.id} className="border-b border-slate-50 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                            <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{formatDate(payment.date)}</td>
                                            <td className="px-4 py-3">
                                                <div className="font-bold text-emerald-600 dark:text-emerald-400">
                                                    +{formatCurrency(payment.amount, appSettings.showCents)} ₽
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex justify-end gap-2">
                                                    {(!isEmployee || user?.permissions?.canEdit) && (
                                                        <button onClick={() => handleEditClick(payment)} className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded">
                                                            {ICONS.Edit}
                                                        </button>
                                                    )}
                                                    {(!isEmployee || user?.permissions?.canDelete) && (
                                                        <button onClick={() => handleDeleteClick(payment.id)} className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded">
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

                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
                    <div className="p-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50">
                        <h3 className="font-bold text-slate-700 dark:text-slate-300">График платежей</h3>
                    </div>
                    {paymentSchedule.length === 0 ? (
                        <div className="p-6 text-center text-slate-400 dark:text-slate-500 text-sm">
                            {isClosed ? '✅ Договор полностью закрыт! 🎉' : 'Все оплачено! 🎉'}
                        </div>
                    ) : (
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-700/50">
                                <tr>
                                    <th className="px-4 py-3">Дата</th>
                                    <th className="px-4 py-3">Осталось</th>
                                    <th className="px-4 py-3">Действие</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paymentSchedule.map((payment) => (
                                    <tr key={payment.id} className="border-b border-slate-50 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                        <td className={`px-4 py-3 ${new Date(payment.date) < new Date() ? 'text-red-500 dark:text-red-400 font-bold' : 'text-slate-700 dark:text-slate-300'}`}>
                                            {formatDate(payment.date)}
                                        </td>
                                        <td className="px-4 py-3 font-bold text-slate-800 dark:text-white">
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
                                                className="text-indigo-600 dark:text-indigo-400 font-bold text-xs border border-indigo-200 dark:border-indigo-800 px-3 py-1.5 rounded-lg hover:bg-indigo-600 hover:text-white transition-colors"
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

                {editingPayment && createPortal(
                    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
                        <div className="bg-white dark:bg-slate-800 w-full max-w-sm p-6 rounded-2xl shadow-xl">
                            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4">Изменить дату платежа</h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Сумма: {formatCurrency(editingPayment.amount, appSettings.showCents)} ₽</p>
                            <input type="date" className="w-full p-3 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-white rounded-xl mb-6 outline-none" value={editDate} onChange={(e) => setEditDate(e.target.value)}/>
                            <div className="flex gap-3">
                                <button onClick={() => setEditingPayment(null)} className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 rounded-xl font-medium text-slate-600 dark:text-slate-300">Отмена</button>
                                <button onClick={saveEdit} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold">Сохранить</button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
                {deletingPaymentId && createPortal(
                    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
                        <div className="bg-white dark:bg-slate-800 w-full max-w-sm p-6 rounded-2xl shadow-xl">
                            <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto mb-4">{ICONS.Delete}</div>
                            <h3 className="text-lg font-bold text-slate-800 dark:text-white text-center mb-2">Отменить платеж?</h3>
                            <p className="text-center text-slate-500 dark:text-slate-400 mb-6 text-sm">Сумма вернется в долг, а статус платежа изменится на "Не оплачено".</p>
                            <div className="flex gap-3">
                                <button onClick={() => setDeletingPaymentId(null)} className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 rounded-xl font-medium text-slate-600 dark:text-slate-300">Нет</button>
                                <button onClick={confirmDelete} className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold">Да, отменить</button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
            </div>
        );
    }

    return (
        <div className="space-y-4 animate-fade-in pb-20">
            <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-700 pb-4 pt-2">
                <TopBarBack onClick={onBack} />
                <h2 className="flex-1 text-xl font-bold text-slate-800 dark:text-white truncate">{customer.name}</h2>
                {onCreateTask && (
                    <button
                        onClick={() => onCreateTask({
                            title: `Связаться — ${customer.name}`,
                            note: customer.phone ? `Телефон: ${customer.phone}` : undefined,
                            customerId: customer.id,
                            customerName: customer.name,
                        })}
                        className="shrink-0 flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-3 py-2 rounded-lg font-semibold text-sm hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
                        title="Создать задачу по клиенту"
                    >
                        {ICONS.Tasks}
                        <span className="hidden sm:inline">Задача</span>
                    </button>
                )}
            </div>
            {(showInstallmentsTab || showHistoryTab) && (
            <div className="flex border-b border-slate-200 dark:border-slate-700">
                <button onClick={() => setActiveTab('INFO')} className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'INFO' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 dark:text-slate-400'}`}>Информация</button>
                {showInstallmentsTab && (
                <button onClick={() => setActiveTab('INSTALLMENTS')} className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'INSTALLMENTS' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 dark:text-slate-400'}`}>Рассрочки</button>
                )}
                {showHistoryTab && (
                <button onClick={() => setActiveTab('HISTORY')} className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'HISTORY' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 dark:text-slate-400'}`}>История</button>
                )}
            </div>
            )}
            {activeTab === 'INFO' && (
                <div className="space-y-4 pt-2">
                    <div className="flex justify-center">
                        <div className="w-32 h-32 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden border-4 border-white dark:border-slate-800 shadow-lg">
                            {customer.photo ?
                                <img src={customer.photo} alt={customer.name} className="w-full h-full object-cover"/> :
                                <div className="w-full h-full flex items-center justify-center text-slate-400 text-4xl font-bold">{customer.name.charAt(0)}</div>
                            }
                        </div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-5 shadow-sm border border-slate-100 dark:border-slate-700 space-y-4 relative">
                        {(onUpdateCustomer || onDeleteCustomer) && (
                            <div className="absolute top-4 right-4 z-20">
                                <button onClick={(e) => {
                                    e.stopPropagation();
                                    setShowActionsMenu(!showActionsMenu);
                                }} className="p-2 bg-slate-50 dark:bg-slate-700 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors" title="Действия">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                        <circle cx="12" cy="6" r="2"/>
                                        <circle cx="12" cy="12" r="2"/>
                                        <circle cx="12" cy="18" r="2"/>
                                    </svg>
                                </button>
                                {showActionsMenu && (
                                    <>
                                        <div className="fixed inset-0 z-10" onClick={() => setShowActionsMenu(false)}/>
                                        <div className="absolute right-0 mt-2 w-52 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-100 dark:border-slate-700 py-1 z-20 animate-fade-in">
                                            {onUpdateCustomer && (!isEmployee || user?.permissions?.canEdit) && (
                                                <button onClick={() => {
                                                    setShowActionsMenu(false);
                                                    setShowEditModal(true);
                                                }} className="w-full px-4 py-2.5 text-left text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2">
                                                    <span className="text-indigo-600 dark:text-indigo-400">{ICONS.Edit}</span> Редактировать
                                                </button>
                                            )}
                                            {/* 🔹 НОВОЕ: пункт "Документы" в меню действий */}
                                            <button onClick={() => {
                                                setShowActionsMenu(false);
                                                setShowDocumentsModal(true);
                                            }} className="w-full px-4 py-2.5 text-left text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2">
                                                <span className="text-slate-600 dark:text-slate-300">{ICONS.File}</span>
                                                <span>Документы</span>
                                                {customer.documents && customer.documents.length > 0 && (
                                                    <span className="ml-auto text-xs bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded-full font-medium">
                                                        {customer.documents.length}
                                                    </span>
                                                )}
                                            </button>
                                            {onUpdateCustomer && onDeleteCustomer && (!isEmployee || (user?.permissions?.canEdit && user?.permissions?.canDelete)) && (
                                                <div className="my-1 border-t border-slate-100 dark:border-slate-700"/>
                                            )}
                                            {onDeleteCustomer && (!isEmployee || user?.permissions?.canDelete) && (
                                                <button onClick={() => {
                                                    setShowActionsMenu(false);
                                                    handleDeleteRequest();
                                                }} className="w-full px-4 py-2.5 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 flex items-center gap-2">
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
                            <p className="text-lg font-medium text-slate-800 dark:text-white">{customer.phone}</p>
                        </div>
                        {customer.address && (
                            <div>
                                <label className="text-xs text-slate-400 uppercase">Адрес</label>
                                <p className="text-base font-medium text-slate-800 dark:text-white">{customer.address}</p>
                            </div>
                        )}
                        {(customer.passportSeries || customer.passportNumber) && (
                            <div>
                                <label className="text-xs text-slate-400 uppercase flex items-center gap-1">Паспорт</label>
                                <p className="text-base font-medium text-slate-800 dark:text-white font-mono tracking-wider">
                                    {customer.passportSeries} {customer.passportNumber}
                                </p>
                                {customer.passportIssuedBy && (
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">{customer.passportIssuedBy}</p>
                                )}
                            </div>
                        )}
                        <div>
                            <label className="text-xs text-slate-400 uppercase">Рейтинг доверия</label>
                            <div className="flex items-center gap-2 mt-1">
                                <div className="flex-1 bg-slate-100 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                                    <div className="bg-emerald-500 h-full" style={{width: `${customer.trustScore}%`}}></div>
                                </div>
                                <span className="text-sm font-bold dark:text-white">{customer.trustScore}%</span>
                            </div>
                        </div>
                        <div>
                            <label className="text-xs text-slate-400 uppercase">Заметки</label>
                            <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">{customer.notes || 'Нет заметок'}</p>
                        </div>
                        <div>
                            <label className="text-xs text-slate-400 uppercase">Напоминания WhatsApp</label>
                            <p className={`text-sm mt-1 font-bold ${customer.allowWhatsappNotification !== false ? 'text-emerald-600' : 'text-slate-400'}`}>
                                {customer.allowWhatsappNotification !== false ? 'Включены' : 'Отключены'}
                            </p>
                        </div>
                    </div>

                    {/* 🔹 Компактная ссылка на документы вместо полного списка */}
                    <button
                        onClick={() => setShowDocumentsModal(true)}
                        className="w-full bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-100 dark:border-slate-700 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center">
                                {ICONS.File}
                            </div>
                            <div className="text-left">
                                <p className="font-bold text-slate-800 dark:text-white">Документы</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400">{customer.documents?.length || 0} файлов</p>
                            </div>
                        </div>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400">
                            <polyline points="9 18 15 12 9 6"/>
                        </svg>
                    </button>

                    <div className="pt-2">
                        <button onClick={handleSendFullReport} className="w-full bg-slate-800 text-white py-4 rounded-xl font-semibold flex items-center justify-center gap-2">
                            {ICONS.Send} Отправить отчет в WhatsApp
                        </button>
                    </div>
                </div>
            )}
            {activeTab === 'HISTORY' && (
                <div className="space-y-3 pt-2">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
                        <div className="grid grid-cols-3 gap-2 text-center">
                            <div>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Куплено на</p>
                                <p className="font-bold text-slate-800 dark:text-white">{formatCurrency(retailTotals.bought, appSettings.showCents)} ₽</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Получено</p>
                                <p className="font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(retailTotals.received, appSettings.showCents)} ₽</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Долг</p>
                                <p className={`font-bold ${retailTotals.debt > 0 ? 'text-rose-500' : 'text-slate-400'}`}>
                                    {formatCurrency(retailTotals.debt, appSettings.showCents)} ₽
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Незакрытые долги — отдельно и сверху: это то, ради чего в
                        историю чаще всего и заходят. */}
                    {customerRetail.filter(r => retailRemaining(r) > 0).map(r => (
                        <div key={`debt_${r.id}`} className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 rounded-2xl p-4 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <p className="font-bold text-amber-800 dark:text-amber-300 truncate">
                                    Долг {formatCurrency(retailRemaining(r), appSettings.showCents)} ₽
                                </p>
                                <p className="text-xs text-amber-700/80 dark:text-amber-400/80 truncate">
                                    {r.docNumber ? `Чек №${r.docNumber} · ` : ''}{formatDate(r.date)}
                                    {retailPaidAmount(r) > 0 ? ` · внесено ${formatCurrency(retailPaidAmount(r), appSettings.showCents)} ₽` : ''}
                                </p>
                            </div>
                            {onInitiateRetailPayment && !isEmployee && (
                                <button onClick={() => onInitiateRetailPayment(r)}
                                        className="shrink-0 px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold active:scale-95 transition-transform">
                                    Принять оплату
                                </button>
                            )}
                        </div>
                    ))}

                    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
                        {retailTimeline.map(e => (
                            <div key={e.key} className="px-4 py-3 flex items-center gap-3">
                                <div className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-sm ${
                                    e.kind === 'BUY'
                                        ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400'
                                        : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                                }`}>
                                    {e.kind === 'BUY' ? '🛒' : '₽'}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="font-semibold text-slate-800 dark:text-white truncate">{e.title}</p>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                        {formatDate(e.date)}{e.subtitle ? ` · ${e.subtitle}` : ''}
                                    </p>
                                </div>
                                <p className={`font-bold shrink-0 ${e.kind === 'BUY' ? 'text-slate-800 dark:text-white' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                    {e.kind === 'BUY' ? '' : '+'}{formatCurrency(e.amount, appSettings.showCents)} ₽
                                </p>
                            </div>
                        ))}
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
                            <div key={sale.id} onClick={() => setSelectedSaleId(sale.id)} className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm active:bg-slate-50 dark:active:bg-slate-700 cursor-pointer">
                                <div className="flex justify-between items-start mb-2">
                                    <h3 className="font-bold text-slate-800 dark:text-white">{sale.productName}</h3>
                                    <span className={`text-xs px-2 py-1 rounded-full ${isClosed ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400'}`}>
                                        {isClosed ? 'Закрыто' : 'Активно'}
                                    </span>
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">от {formatDate(sale.startDate)}</p>
                                {investorName && (
                                    <div className="mb-2">
                                        <span className="text-[10px] bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 px-2 py-0.5 rounded font-bold">Инвестор: {investorName}</span>
                                    </div>
                                )}
                                <div className="flex justify-between text-sm mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                                    <span className="text-slate-500 dark:text-slate-400">Остаток:</span>
                                    <span className={`font-bold ${isClosed ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-800 dark:text-white'}`}>
                                        {isClosed ? '0 ₽' : `${formatCurrency(sale.remainingAmount, appSettings.showCents)} ₽`}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            {showEditModal && onUpdateCustomer && (
                <EditCustomerModal customer={customer} onClose={() => setShowEditModal(false)} onUpdate={onUpdateCustomer}/>
            )}
            {/* 🔹 НОВОЕ: модалка документов */}
            {showDocumentsModal && onUpdateCustomer && (
                <DocumentsModal
                    customer={customer}
                    onClose={() => setShowDocumentsModal(false)}
                    onUpdate={onUpdateCustomer}
                    isOnline={navigator.onLine}
                />
            )}
            {showDeleteModal && createPortal(
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white dark:bg-slate-800 w-full max-w-sm p-6 rounded-2xl shadow-xl animate-scale-in">
                        <div className="w-14 h-14 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto mb-4">{ICONS.Delete}</div>
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white text-center mb-2">Удалить клиента?</h3>
                        <p className="text-center text-slate-500 dark:text-slate-400 mb-6 text-sm">Это действие нельзя отменить. Все данные клиента будут удалены безвозвратно.</p>
                        <div className="flex gap-3">
                            <button onClick={() => setShowDeleteModal(false)} className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-200 dark:hover:bg-slate-600 transition">Отмена</button>
                            <button onClick={confirmDeleteCustomer} className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition shadow-lg shadow-red-200 dark:shadow-red-900/30">Да, удалить</button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
            {showBlockedDeleteModal && createPortal(
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in" onClick={() => setShowBlockedDeleteModal(false)}>
                    <div className="bg-white dark:bg-slate-800 w-full max-w-sm p-6 rounded-2xl shadow-2xl animate-scale-in" onClick={e => e.stopPropagation()}>
                        <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10"/>
                                <line x1="12" y1="8" x2="12" y2="12"/>
                                <line x1="12" y1="16" x2="12.01" y2="16"/>
                            </svg>
                        </div>
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white text-center mb-1">Невозможно удалить</h3>
                        <p className="text-center text-slate-500 dark:text-slate-400 mb-4 text-sm">У клиента <strong>{customer.name}</strong> есть активные договоры</p>
                        <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-4 mb-6 max-h-48 overflow-y-auto">
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2 uppercase">Привязанные договоры ({sales.filter(s => s.customerId === customer.id).length})</p>
                            <ul className="space-y-2">
                                {sales.filter(s => s.customerId === customer.id).map(contract => (
                                    <li key={contract.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 px-3 py-2 rounded-lg border border-slate-100 dark:border-slate-700">
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
                        <p className="text-center text-slate-500 dark:text-slate-400 text-sm mb-6">Сначала удалите привязанные договоры.</p>
                        <div className="flex gap-3">
                            <button onClick={() => {
                                setShowBlockedDeleteModal(false);
                                setActiveTab('INSTALLMENTS');
                            }} className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">Перейти к договорам</button>
                            <button onClick={() => setShowBlockedDeleteModal(false)} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200 dark:shadow-indigo-900/30">Понятно</button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default CustomerDetails;