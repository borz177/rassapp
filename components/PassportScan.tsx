import React, { useRef, useState } from 'react';
import { api } from '../services/api';
import PassportCamera from './PassportCamera';

export interface PassportFields {
  name: string;
  series: string;
  number: string;
  issuedBy: string;
  address: string;
  birthDate: string;
}

interface PassportScanProps {
  /** Подставить распознанное в форму — сразу после распознавания */
  onApply: (fields: PassportFields) => void;
  /** Вернуть форму как была до подстановки */
  onUndo?: () => void;
  className?: string;
}

const LABELS: { key: keyof PassportFields; label: string }[] = [
  { key: 'name', label: 'ФИО' },
  { key: 'series', label: 'Серия' },
  { key: 'number', label: 'Номер' },
  { key: 'issuedBy', label: 'Кем выдан' },
  { key: 'address', label: 'Адрес' },
  { key: 'birthDate', label: 'Дата рождения' },
];

/**
 * Заполнение карточки клиента с фотографии паспорта.
 *
 * Снимок делают камерой прямо из формы (`capture` открывает её сразу, без
 * галереи) или выбирают готовый файл. Отдельного «сканера» нет намеренно:
 * камера телефона и есть сканер, а свой видоискатель с рамкой добавил бы шаг
 * там, где системный уже всё умеет.
 *
 * Распознанное подставляется в поля сразу — лишнее нажатие мешало. Но молча
 * не подставляем: под кнопками пишем, какие поля заполнены, просим проверить и
 * даём «Отменить». Ошибка в паспортных данных стоит дорого, и человек должен
 * видеть, что этот текст ввёл не он.
 */
const PassportScan: React.FC<PassportScanProps> = ({ onApply, onUndo, className = '' }) => {
  // Два отдельных поля вместо одного: `capture` заставляет систему открыть
  // камеру, и снять его на лету нельзя — атрибут читается в момент нажатия.
  // Дёргать DOM ради этого не стоит, а два скрытых поля ничего не стоят.
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PassportFields | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  // Одна кнопка «Сканировать паспорт». На телефоне — камера прямо в приложении
  // со своим автоснимком (PassportCamera), там же «Из галереи». Нет доступа к
  // камере из страницы (не https, старый браузер) — системная камера. На
  // компьютере камеры для документов обычно нет — сразу выбор файла.
  const [cameraOpen, setCameraOpen] = useState(false);
  const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  const inAppCamera = typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
  const startScan = () => {
    if (!isTouch) galleryRef.current?.click();
    else if (inAppCamera) { setError(null); setCameraOpen(true); }
    else cameraRef.current?.click();
  };
  const applyFields = (fields: PassportFields, dataUrl: string) => {
    setPreview(dataUrl);
    setResult(fields);
    if (LABELS.some(l => (fields[l.key] || '').trim())) onApply(fields);
  };

  const readFile = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Значение сбрасываем сразу: иначе выбор того же файла второй раз не
    // вызовет onChange, и кнопка будет выглядеть сломанной.
    e.target.value = '';
    if (!file) return;

    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const dataUrl = await readFile(file);
      setPreview(dataUrl);
      applyFields(await api.recognizePassport(dataUrl), dataUrl);
    } catch (err: any) {
      setError(err?.message || 'Не удалось распознать паспорт');
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const filled = result ? LABELS.filter(l => (result[l.key] || '').trim()) : [];

  return (
    <div className={className}>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment"
             className="hidden" onChange={handleFile} />
      <input ref={galleryRef} type="file" accept="image/*"
             className="hidden" onChange={handleFile} />

      <button
        type="button"
        disabled={busy}
        onClick={startScan}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 text-sm font-bold disabled:opacity-60 active:scale-[0.98] transition-transform"
      >
        {busy ? 'Распознаём…' : '📷 Сканировать паспорт'}
      </button>
      {cameraOpen && (
        <PassportCamera
          recognize={dataUrl => api.recognizePassport(dataUrl)}
          onDone={(fields, dataUrl) => { setCameraOpen(false); applyFields(fields, dataUrl); }}
          onGallery={() => { setCameraOpen(false); galleryRef.current?.click(); }}
          onClose={() => setCameraOpen(false)}
        />
      )}

      {error && (
        <div className="mt-2 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-2 flex items-center gap-3 rounded-xl border border-emerald-100 dark:border-emerald-900/40 bg-emerald-50/60 dark:bg-emerald-900/15 px-3 py-2">
          {preview && filled.length > 0 && (
            <img src={preview} alt="" decoding="sync"
                 className="w-9 h-9 rounded-md object-cover shrink-0 border border-emerald-100 dark:border-emerald-900/40" />
          )}
          <p className="min-w-0 flex-1 text-xs leading-snug text-slate-600 dark:text-slate-300">
            {filled.length === 0
              ? 'Ничего не прочиталось. Снимите паспорт целиком, без бликов.'
              : <><span className="font-semibold text-emerald-700 dark:text-emerald-400">✓ Заполнено:</span> {filled.map(l => (l.key === 'name' ? l.label : l.label.toLowerCase())).join(', ')}. Проверьте поля.</>}
          </p>
          {filled.length > 0 && onUndo && (
            <button type="button"
                    onClick={() => { onUndo(); setResult(null); setPreview(null); }}
                    className="shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-400 active:opacity-60">
              Отменить
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default PassportScan;
