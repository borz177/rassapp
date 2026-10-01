/**
 * Документы клиента: загрузка, подписи, получение файла.
 *
 * Общее для листа документов (components/CustomerDocumentsSheet.tsx) и
 * просмотрщика (components/DocumentViewer.tsx).
 */
import { CustomerDocument } from '../types';
import { api, API_URL } from '../services/api';
import { offlineStorage } from '../services/offlineStorage';
import { saveContractPdf } from './contractPdf';

export type DocCategory = CustomerDocument['category'];

export const DOC_CATEGORIES: { id: DocCategory; label: string }[] = [
  { id: 'passport', label: 'Паспорт' },
  { id: 'guarantor', label: 'Поручительство' },
  { id: 'contract', label: 'Договор' },
  { id: 'photo', label: 'Фото' },
  { id: 'other', label: 'Другое' },
];

export const docCategoryLabel = (c: DocCategory) =>
  DOC_CATEGORIES.find(x => x.id === c)?.label || 'Документ';

export const MAX_DOC_SIZE = 5 * 1024 * 1024;

export const formatFileSize = (bytes?: number): string => {
  if (!bytes) return '';
  const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(1))} ${sizes[i]}`;
};

/** Файл ещё не уехал на сервер — лежит на устройстве и ждёт сети */
export const isPendingDoc = (doc: CustomerDocument) =>
  !!doc._isTemp || !!doc.fileUrl?.startsWith('temp_doc_');

/** Фото с телефона весят по 5–10 МБ — ужимаем до 1920 px, этого хватает для паспорта */
export const compressImage = (file: File, maxWidth = 1920): Promise<Blob> =>
  new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > maxWidth) { height = (height * maxWidth) / width; width = maxWidth; }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => resolve(blob || file), 'image/jpeg', 0.8);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });

/**
 * Загрузить файл и вернуть запись документа. Без сети файл сохраняется на
 * устройстве и уезжает на сервер при первой связи (temp_doc_*).
 */
export const uploadCustomerDocument = async (
  file: File, category: DocCategory, online: boolean,
): Promise<CustomerDocument> => {
  if (file.size > MAX_DOC_SIZE * 2 && !file.type.startsWith('image/')) {
    throw new Error(`«${file.name}» больше 5 МБ`);
  }
  let toUpload: File = file;
  if (file.type.startsWith('image/')) {
    const compressed = await compressImage(file, 1920);
    toUpload = new File([compressed], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  }
  if (toUpload.size > MAX_DOC_SIZE) throw new Error(`«${file.name}» больше 5 МБ`);

  let fileUrl: string;
  let isTemp = false;
  if (!online) {
    fileUrl = await offlineStorage.saveTempFile(toUpload);
    isTemp = true;
  } else {
    const formData = new FormData();
    formData.append('file', toUpload);
    const res = await fetch(`${API_URL}/upload/document`, {
      method: 'POST',
      headers: { 'x-auth-token': localStorage.getItem('token') || '' },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Не удалось загрузить файл на сервер');
    }
    fileUrl = (await res.json()).fileUrl;
  }

  return {
    id: crypto.randomUUID(),
    name: toUpload.name,
    category,
    fileUrl,
    fileType: file.type.includes('pdf') ? 'pdf' : 'image',
    uploadedAt: new Date().toISOString(),
    fileSize: toUpload.size,
    _isTemp: isTemp,
  };
};

/** Адрес для показа (blob:/data:) — с токеном, сервер без него файл не отдаёт */
export const docObjectUrl = (doc: CustomerDocument) => api.getDocumentUrl(doc.fileUrl);

/**
 * Поделиться или сохранить. В приложении — системное окно «Поделиться» (оттуда
 * и «Сохранить в Файлы», и мессенджеры); в браузере PDF открывается во вкладке,
 * картинка скачивается.
 */
export const shareDocument = async (doc: CustomerDocument): Promise<void> => {
  const url = await docObjectUrl(doc);
  const blob = await (await fetch(url)).blob();
  if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  const native = !!(window as any).Capacitor?.isNativePlatform?.();
  if (!native && doc.fileType === 'pdf') {
    const tab = URL.createObjectURL(blob);
    window.open(tab, '_blank');
    setTimeout(() => URL.revokeObjectURL(tab), 60000);
    return;
  }
  await saveContractPdf(blob, doc.name);
};

/** Удалить документ: сначала файл на сервере, потом запись (см. комментарий внутри) */
export const deleteDocumentFile = async (doc: CustomerDocument) => {
  // Сначала файл — пока ссылка на него ещё есть в записи, по ней сервер проверяет
  // права. Не вышло — всё равно убираем из карточки: файл подберёт чистка.
  try { await api.deleteDocumentFile(doc.fileUrl); } catch (e) { console.warn('Не удалось удалить файл документа:', e); }
};
