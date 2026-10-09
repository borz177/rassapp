import React, { useMemo, useRef, useState } from 'react';
import GlassSheet, { SheetSection, SheetField, SheetToggle, sheetInputClass } from './GlassSheet';
import PassportScan, { type PassportFields } from './PassportScan';
import { Customer } from '../types';
import { appAlert, appConfirm } from '../src/dialogs';

/**
 * Клиент — добавление и редактирование одной формой, листом (GlassSheet).
 *
 * Раньше форм было три: новая — прямо в списке клиентов, ещё одна — в выборе
 * клиента при оформлении договора, и окно редактирования. Поля и проверки в
 * них расходились (где-то нет даты рождения, где-то фото), а оформление —
 * раскрывашка «▶ 📍 Адрес и документы» с эмодзи вместо заголовков.
 */

export interface NewCustomerData {
  name: string;
  phone: string;
  photo?: string;
  address?: string;
  passportSeries?: string;
  passportNumber?: string;
  passportIssuedBy?: string;
  birthDate?: string;
}

interface Props {
  /** Есть — редактирование, нет — новый клиент */
  customer?: Customer;
  onClose: () => void;
  /** Новый клиент. Ошибка — форма остаётся открытой с сообщением */
  onCreate?: (data: NewCustomerData) => Promise<unknown> | unknown;
  /** Сохранить изменения существующего */
  onUpdate?: (customer: Customer) => void;
  /** Распознавание паспорта — только там, где его разрешает тариф */
  canScanPassport?: boolean;
}

/** Дата из паспорта (ДД.ММ.ГГГГ) — в вид для поля даты. Не разобралась — пусто */
const toIsoDate = (value: string | undefined): string => {
  const m = String(value || '').match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{4})$/);
  if (!m) return '';
  const [, dd, mm, yyyy] = m;
  const year = Number(yyyy);
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return '';
  if (year < 1900 || year > new Date().getFullYear()) return '';
  return `${yyyy}-${mm}-${dd}`;
};

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?';

const CustomerFormSheet: React.FC<Props> = ({ customer, onClose, onCreate, onUpdate, canScanPassport = false }) => {
  const editing = !!customer;
  const initial = useMemo(() => ({
    name: customer?.name || '',
    phone: customer?.phone || '',
    photo: customer?.photo || '',
    address: customer?.address || '',
    birthDate: customer?.birthDate || '',
    passportSeries: customer?.passportSeries || '',
    passportNumber: customer?.passportNumber || '',
    passportIssuedBy: customer?.passportIssuedBy || '',
    notes: customer?.notes || '',
    allowWhatsapp: customer ? customer.allowWhatsappNotification !== false : true,
  }), [customer]);
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof initial>(key: K, value: (typeof initial)[K]) =>
    setForm(f => ({ ...f, [key]: value }));

  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some(k => form[k] !== initial[k]);
  const valid = form.name.trim().length > 0 && form.phone.trim().length > 0;
  const canSave = valid && !saving && (editing ? dirty : true);

  const onPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => set('photo', String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  // Распознанный паспорт заполняет только пустые поля: набранное руками
  // важнее — его вводили осознанно, а распознавание ошибается.
  // Форма до подстановки из паспорта — для «Отменить»
  const beforePassport = useRef<typeof form | null>(null);
  const applyPassport = (f: PassportFields) => setForm(prev => (beforePassport.current = prev, {
    ...prev,
    name: prev.name.trim() ? prev.name : f.name || prev.name,
    address: prev.address.trim() ? prev.address : f.address || prev.address,
    passportSeries: prev.passportSeries.trim() ? prev.passportSeries : f.series || prev.passportSeries,
    passportNumber: prev.passportNumber.trim() ? prev.passportNumber : f.number || prev.passportNumber,
    passportIssuedBy: prev.passportIssuedBy.trim() ? prev.passportIssuedBy : f.issuedBy || prev.passportIssuedBy,
    birthDate: prev.birthDate || toIsoDate(f.birthDate),
  }));

  const save = async (close: () => void) => {
    if (!canSave) return;
    const clean = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      address: form.address.trim() || undefined,
      passportSeries: form.passportSeries.trim() || undefined,
      passportNumber: form.passportNumber.trim() || undefined,
      passportIssuedBy: form.passportIssuedBy.trim() || undefined,
      birthDate: form.birthDate || undefined,
    };
    if (editing && customer) {
      onUpdate?.({
        ...customer,
        ...clean,
        photo: form.photo || undefined,
        notes: form.notes,
        allowWhatsappNotification: form.allowWhatsapp,
      });
      close();
      return;
    }
    setSaving(true);
    try {
      await onCreate?.({ ...clean, photo: form.photo || undefined });
      close();
    } catch (e) {
      console.error('Ошибка создания клиента:', e);
      await appAlert({ title: 'Клиент не сохранён', message: 'Проверьте связь и попробуйте ещё раз.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <GlassSheet
      title={editing ? 'Клиент' : 'Новый клиент'}
      subtitle={editing ? (form.name.trim() || 'Без имени') : 'Обязательны только имя и телефон'}
      onClose={onClose}
      cancelLabel="Отмена"
      action={{ label: saving ? 'Сохраняем…' : editing ? 'Готово' : 'Добавить', submit: true, disabled: !canSave }}
      onSubmit={save}
      confirmClose={() => !dirty || appConfirm({
        title: editing ? 'Закрыть без сохранения?' : 'Не добавлять клиента?',
        message: 'Введённые данные пропадут.',
        confirmLabel: 'Закрыть',
        cancelLabel: 'Остаться',
        destructive: true,
      })}
    >
      <div className="space-y-6">
        {/* Фото и основное — как карточка контакта */}
        <div className="flex flex-col items-center gap-2">
          <label className="relative w-24 h-24 rounded-full overflow-hidden cursor-pointer bg-gradient-to-br from-indigo-100 to-indigo-200 dark:from-indigo-500/20 dark:to-indigo-500/30 ring-4 ring-white dark:ring-slate-800 shadow-sm active:scale-95 transition-transform">
            {form.photo
              ? <img src={form.photo} alt="" className="w-full h-full object-cover" />
              : <span className="w-full h-full flex items-center justify-center text-[30px] font-bold text-indigo-600 dark:text-indigo-300">
                  {form.name.trim() ? initials(form.name) : (
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="opacity-80">
                      <circle cx="12" cy="8.5" r="4" /><path d="M4 20.5c.6-4 3.9-6.5 8-6.5s7.4 2.5 8 6.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
                    </svg>
                  )}
                </span>}
            <input type="file" accept="image/*" className="hidden" onChange={onPhoto} />
          </label>
          <div className="flex gap-4 text-[14px] font-medium">
            <label className="text-indigo-600 dark:text-indigo-400 cursor-pointer active:opacity-60">
              {form.photo ? 'Заменить фото' : 'Добавить фото'}
              <input type="file" accept="image/*" className="hidden" onChange={onPhoto} />
            </label>
            {form.photo && (
              <button type="button" onClick={() => set('photo', '')} className="text-rose-600 dark:text-rose-400 active:opacity-60">Убрать</button>
            )}
          </div>
        </div>

        <SheetSection>
          <SheetField label="ФИО">
            <input className={sheetInputClass} value={form.name} onChange={e => set('name', e.target.value)}
                   autoComplete="off" autoCorrect="off" spellCheck={false} autoCapitalize="words"
                   enterKeyHint="next" placeholder="Иванов Иван Иванович" required />
          </SheetField>
          <SheetField label="Телефон">
            <input className={sheetInputClass} value={form.phone} onChange={e => set('phone', e.target.value)}
                   type="tel" inputMode="tel" autoComplete="off" enterKeyHint="next"
                   placeholder="+7 900 000-00-00" required />
          </SheetField>
        </SheetSection>

        {/* Съёмка паспорта — перед полями: вручную набирать нужно, только когда фото нет */}
        {canScanPassport && (
          <SheetSection plain hint="Наведите камеру на разворот с фото — поля заполнятся сами.">
            <PassportScan onApply={applyPassport}
                          onUndo={() => { if (beforePassport.current) setForm(beforePassport.current); beforePassport.current = null; }} />
          </SheetSection>
        )}

        <SheetSection title="Адрес и документы" hint="Паспорт необязателен — нужен для печати полного договора.">
          <SheetField label="Адрес">
            <input className={sheetInputClass} value={form.address} onChange={e => set('address', e.target.value)}
                   autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="next"
                   placeholder="г. Москва, ул. Ленина, д. 1" />
          </SheetField>
          <SheetField label="Дата рождения">
            {/* Пустое поле даты на iPhone — пустая полоса без подсказки: подпись под прозрачным полем */}
            <span className="relative block">
              {!form.birthDate && (
                <span className="pointer-events-none absolute inset-0 flex items-center text-[16px] text-slate-300 dark:text-slate-600">Не указана</span>
              )}
              <input className={`${sheetInputClass} h-7 appearance-none [&::-webkit-date-and-time-value]:text-left ${form.birthDate ? '' : 'text-transparent'}`}
                     type="date" value={form.birthDate} max={new Date().toISOString().slice(0, 10)}
                     onChange={e => set('birthDate', e.target.value)} />
            </span>
          </SheetField>
          <div className="grid grid-cols-2 divide-x divide-slate-100 dark:divide-slate-700/70">
            <SheetField label="Серия паспорта">
              <input className={`${sheetInputClass} font-mono tracking-wider`} value={form.passportSeries}
                     onChange={e => set('passportSeries', e.target.value.replace(/[^0-9A-ZА-Я]/gi, '').toUpperCase().slice(0, 4))}
                     inputMode="numeric" maxLength={4} placeholder="4501" autoComplete="off" />
            </SheetField>
            <SheetField label="Номер">
              <input className={`${sheetInputClass} font-mono tracking-wider`} value={form.passportNumber}
                     onChange={e => set('passportNumber', e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                     inputMode="numeric" maxLength={6} placeholder="123456" autoComplete="off" />
            </SheetField>
          </div>
          <SheetField label="Кем выдан">
            <input className={sheetInputClass} value={form.passportIssuedBy}
                   onChange={e => set('passportIssuedBy', e.target.value)} maxLength={100}
                   autoComplete="off" autoCorrect="off" spellCheck={false} placeholder="УФМС России по г. Москве" />
          </SheetField>
        </SheetSection>

        {editing && (
          <>
            <SheetSection title="Заметки">
              <textarea
                className="block w-full px-4 py-3 bg-transparent outline-none resize-none text-[16px] text-slate-900 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-600"
                rows={3} value={form.notes} onChange={e => set('notes', e.target.value)}
                placeholder="Что важно помнить об этом клиенте"
              />
            </SheetSection>
            <SheetSection hint="Автоматические напоминания о платежах этому клиенту.">
              <SheetToggle label="Напоминания в WhatsApp" checked={form.allowWhatsapp} onChange={v => set('allowWhatsapp', v)} />
            </SheetSection>
          </>
        )}

      </div>
    </GlassSheet>
  );
};

export default CustomerFormSheet;
