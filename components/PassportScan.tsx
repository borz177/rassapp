import React, { useRef, useState } from 'react';
import { api } from '../services/api';

export interface PassportFields {
  name: string;
  series: string;
  number: string;
  issuedBy: string;
  address: string;
  birthDate: string;
}

interface PassportScanProps {
  /** Что подставить в форму. Вызывается только после подтверждения человеком */
  onApply: (fields: PassportFields) => void;
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
 * Распознанное не подставляется молча: сперва показываем, что прочиталось, и
 * только по кнопке переносим в поля. Ошибка распознавания в паспортных данных
 * стоит дорого, а заметить её в уже заполненной форме почти невозможно —
 * человек видит текст и считает, что сам его ввёл.
 */
const PassportScan: React.FC<PassportScanProps> = ({ onApply, className = '' }) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PassportFields | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

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
      const fields = await api.recognizePassport(dataUrl);
      setResult(fields);
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
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFile}
      />

      <button
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 text-sm font-bold disabled:opacity-60 active:scale-95 transition-transform"
      >
        {busy ? 'Распознаём…' : '📷 Заполнить из фото паспорта'}
      </button>

      {error && (
        <div className="mt-2 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-xl border border-indigo-100 dark:border-indigo-900/40 bg-indigo-50/50 dark:bg-indigo-900/10 p-3 space-y-2">
          <div className="flex items-start gap-3">
            {preview && (
              <img src={preview} alt="" decoding="sync"
                   className="w-14 h-14 rounded-lg object-cover shrink-0 border border-indigo-100 dark:border-indigo-900/40" />
            )}
            <div className="min-w-0 flex-1 space-y-1">
              {filled.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Ничего не прочиталось. Снимите паспорт целиком при хорошем освещении.
                </p>
              ) : filled.map(({ key, label }) => (
                <div key={key} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="text-slate-400 dark:text-slate-500 shrink-0">{label}</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-200 text-right break-words">
                    {result[key]}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {filled.length > 0 && (
            <div className="flex gap-2 pt-1">
              <button type="button"
                      onClick={() => { setResult(null); setPreview(null); }}
                      className="flex-1 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-xs font-bold">
                Не подставлять
              </button>
              <button type="button"
                      onClick={() => { onApply(result); setResult(null); setPreview(null); }}
                      className="flex-[1.5] py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold active:scale-95 transition-transform">
                Подставить в форму
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PassportScan;
