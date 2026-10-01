import React, { useEffect, useRef, useState } from 'react';
import GlassSheet, { SheetSection } from './GlassSheet';
import DocumentViewer from './DocumentViewer';
import { Customer, CustomerDocument } from '../types';
import {
  DOC_CATEGORIES, DocCategory, docCategoryLabel, docObjectUrl, formatFileSize,
  isPendingDoc, uploadCustomerDocument, deleteDocumentFile,
} from '../src/customerDocs';

/**
 * Документы клиента — лист (GlassSheet) с сеткой карточек.
 *
 * Было: список с эмодзи, а добавление пряталось под «▶ Добавить документ» и
 * шло в три шага — выбрать категорию в списке, выбрать файл, нажать
 * «Прикрепить». Теперь категория выбирается чипом, а «Снять» или «Выбрать
 * файлы» сразу загружают (можно несколько файлов за раз). Фото видны
 * миниатюрами; касание открывает просмотр на весь экран (DocumentViewer).
 */

interface Props {
  customer: Customer;
  onClose: () => void;
  onUpdate: (c: Customer) => void;
  isOnline?: boolean;
}

type Upload = { key: string; name: string; error?: string };

const Icon: React.FC<{ d: React.ReactNode; size?: number; className?: string }> = ({ d, size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>{d}</svg>
);

// Миниатюра фото: грузится, только когда карточка видна
const Thumb: React.FC<{ doc: CustomerDocument }> = ({ doc }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (doc.fileType !== 'image') return;
    const el = ref.current;
    if (!el) return;
    let made: string | null = null;
    let alive = true;
    const load = () => docObjectUrl(doc)
      .then(u => { made = u; if (alive) setUrl(u); else if (u.startsWith('blob:')) URL.revokeObjectURL(u); })
      .catch(() => alive && setFailed(true));
    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { io?.disconnect(); load(); } })
      : null;
    if (io) io.observe(el); else load();
    return () => {
      alive = false;
      io?.disconnect();
      if (made?.startsWith('blob:')) URL.revokeObjectURL(made);
    };
  }, [doc.id]);

  return (
    <div ref={ref} className="absolute inset-0 flex items-center justify-center">
      {doc.fileType === 'pdf' ? (
        <span className="flex flex-col items-center gap-1 text-rose-500 dark:text-rose-400">
          <Icon size={30} d={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>} />
          <span className="text-[11px] font-bold tracking-wide">PDF</span>
        </span>
      ) : url ? (
        <img src={url} alt="" draggable={false} className="w-full h-full object-cover animate-modal-fade-in" />
      ) : failed ? (
        <Icon size={26} className="text-slate-300 dark:text-slate-600" d={<><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></>} />
      ) : (
        <span className="w-6 h-6 rounded-full border-2 border-slate-200 dark:border-slate-700 border-t-slate-400 animate-spin" />
      )}
    </div>
  );
};

const CustomerDocumentsSheet: React.FC<Props> = ({ customer, onClose, onUpdate, isOnline = navigator.onLine }) => {
  const docs = customer.documents || [];
  const [category, setCategory] = useState<DocCategory>('passport');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [viewAt, setViewAt] = useState<number | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);

  const addFiles = async (list: FileList | null) => {
    const files = Array.from(list || []);
    if (!files.length) return;
    const pending = files.map((f, i) => ({ key: `${Date.now()}_${i}`, name: f.name }));
    setUploads(u => [...u, ...pending]);

    const added: CustomerDocument[] = [];
    for (let i = 0; i < files.length; i++) {
      try {
        added.push(await uploadCustomerDocument(files[i], category, isOnline));
        setUploads(u => u.filter(x => x.key !== pending[i].key));
      } catch (e: any) {
        const message = e?.message || 'Не удалось загрузить';
        setUploads(u => u.map(x => x.key === pending[i].key ? { ...x, error: message } : x));
        setTimeout(() => setUploads(u => u.filter(x => x.key !== pending[i].key)), 4000);
      }
    }
    if (added.length) onUpdate({ ...customer, documents: [...docs, ...added] });
  };

  const removeDoc = async (doc: CustomerDocument) => {
    await deleteDocumentFile(doc);
    onUpdate({ ...customer, documents: docs.filter(d => d.id !== doc.id) });
  };

  // Без сети не добавляем: временные файлы (temp_doc_*) сейчас никто не
  // отправляет на сервер при возврате связи — они остались бы только на этом
  // устройстве. Уже загруженные документы открываются и без сети (кеш).
  const canAdd = isOnline;

  return (
    <>
      <GlassSheet
        title="Документы"
        subtitle={`${customer.name || 'Клиент'} · ${docs.length ? `${docs.length} ${docs.length === 1 ? 'файл' : docs.length < 5 ? 'файла' : 'файлов'}` : 'пока пусто'}`}
        onClose={onClose}
        cancelLabel={null}
        action={{ label: 'Готово', onClick: close => close() }}
        footer={
          <div className="space-y-3">
            {/* Категория — для всех файлов, которые добавят сейчас */}
            <div className="flex gap-2 overflow-x-auto -mx-4 px-4">
              {DOC_CATEGORIES.map(c => (
                <button key={c.id} type="button" onClick={() => setCategory(c.id)}
                        className={`shrink-0 h-8 px-3 rounded-full text-[13px] font-semibold transition-colors ${
                          category === c.id
                            ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                            : 'bg-white text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700'
                        }`}>
                  {c.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <button type="button" disabled={!canAdd} onClick={() => cameraRef.current?.click()}
                      className="h-12 rounded-2xl bg-indigo-600 text-white text-[15px] font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50">
                <Icon size={19} d={<><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" /><circle cx="12" cy="13" r="3.5" /></>} />
                Снять
              </button>
              <button type="button" disabled={!canAdd} onClick={() => filesRef.current?.click()}
                      className="h-12 rounded-2xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 text-[15px] font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50">
                <Icon size={19} d={<><path d="M21.4 11.6 12.2 20.8a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" /></>} />
                Выбрать файлы
              </button>
            </div>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
                   onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
            <input ref={filesRef} type="file" accept="image/*,.pdf" multiple className="hidden"
                   onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
          </div>
        }
      >
        <div className="space-y-5">
          {!isOnline && (
            <div className="flex items-start gap-3 rounded-2xl bg-amber-50 dark:bg-amber-500/10 ring-1 ring-amber-200/70 dark:ring-amber-500/20 px-4 py-3">
              <Icon size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" d={<><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></>} />
              <p className="text-[13px] leading-snug text-amber-800 dark:text-amber-200">
                Нет сети. Загруженные документы открываются, а добавить новые можно, когда связь вернётся.
              </p>
            </div>
          )}

          {docs.length === 0 && uploads.length === 0 ? (
            <div className="flex flex-col items-center text-center pt-6 pb-4 px-6">
              <span className="w-16 h-16 rounded-2xl bg-white dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 text-slate-400 flex items-center justify-center mb-4">
                <Icon size={28} d={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M12 12v6" /><path d="M9 15h6" /></>} />
              </span>
              <p className="text-[16px] font-semibold text-slate-900 dark:text-white">Документов пока нет</p>
              <p className="mt-1 text-[14px] leading-snug text-slate-500 dark:text-slate-400">
                Сфотографируйте паспорт или прикрепите файл — выберите категорию и нажмите кнопку внизу.
              </p>
            </div>
          ) : (
            <SheetSection plain hint="Касание — открыть на весь экран. Фото и PDF до 5 МБ.">
              <div className="grid grid-cols-2 gap-3">
                {docs.map((doc, i) => (
                  <button key={doc.id} type="button" onClick={() => setViewAt(i)}
                          className="text-left rounded-2xl bg-white dark:bg-slate-800 ring-1 ring-slate-200/70 dark:ring-slate-700/70 overflow-hidden active:scale-[0.98] transition-transform">
                    <div className="relative aspect-[4/3] bg-slate-100 dark:bg-slate-900/60">
                      <Thumb doc={doc} />
                      {isPendingDoc(doc) && (
                        <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-amber-500/90 text-white text-[11px] font-semibold">
                          Ждёт сети
                        </span>
                      )}
                    </div>
                    <div className="px-3 py-2.5">
                      <p className="text-[13px] font-semibold text-slate-900 dark:text-white truncate">{docCategoryLabel(doc.category)}</p>
                      <p className="text-[12px] text-slate-500 dark:text-slate-400 truncate">
                        {new Date(doc.uploadedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                        {doc.fileSize ? ` · ${formatFileSize(doc.fileSize)}` : ''}
                      </p>
                    </div>
                  </button>
                ))}

                {uploads.map(u => (
                  <div key={u.key} className="rounded-2xl bg-white dark:bg-slate-800 ring-1 ring-slate-200/70 dark:ring-slate-700/70 overflow-hidden animate-modal-fade-in">
                    <div className={`aspect-[4/3] flex flex-col items-center justify-center gap-2 ${u.error ? 'bg-rose-50 dark:bg-rose-500/10' : 'bg-slate-100 dark:bg-slate-900/60'}`}>
                      {u.error
                        ? <Icon size={24} className="text-rose-500" d={<><circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><path d="M12 16h.01" /></>} />
                        : <span className="w-6 h-6 rounded-full border-2 border-slate-200 dark:border-slate-700 border-t-indigo-500 animate-spin" />}
                    </div>
                    <div className="px-3 py-2.5">
                      <p className="text-[13px] font-semibold text-slate-900 dark:text-white truncate">{u.error ? 'Не загрузилось' : 'Загружаем…'}</p>
                      <p className={`text-[12px] truncate ${u.error ? 'text-rose-500' : 'text-slate-500 dark:text-slate-400'}`}>{u.error || u.name}</p>
                    </div>
                  </div>
                ))}
              </div>
            </SheetSection>
          )}
        </div>
      </GlassSheet>

      {viewAt !== null && docs.length > 0 && (
        <DocumentViewer
          documents={docs}
          startIndex={viewAt}
          onClose={() => setViewAt(null)}
          onDelete={removeDoc}
        />
      )}
    </>
  );
};

export default CustomerDocumentsSheet;
