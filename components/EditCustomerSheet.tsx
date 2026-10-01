import React, { useMemo, useState } from 'react';
import GlassSheet, { SheetSection as Section } from './GlassSheet';
import { Customer } from '../types';

/**
 * Редактирование клиента — лист, как в системных формах iOS (GlassSheet).
 *
 * Было окно во весь экран: шапка «Редактировать клиента» стояла под самой
 * чёлкой и не уходила при прокрутке, кнопки прибиты к низу (их закрывала
 * клавиатура), поля шли одной простынёй с эмодзи вместо заголовков.
 *
 * Теперь поля сгруппированы карточками, «Готово» сверху активна, только когда
 * есть что сохранить, а закрыть с несохранёнными правками можно лишь
 * подтвердив это.
 */

interface EditCustomerSheetProps {
  customer: Customer;
  onClose: () => void;
  onUpdate: (c: Customer) => void;
}

// Строка формы: подпись сверху, поле во всю ширину — длинные ФИО и адреса не режутся
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block px-4 py-2.5">
    <span className="block text-[12px] font-medium text-slate-500 dark:text-slate-400">{label}</span>
    {children}
  </label>
);

const inputClass =
  'mt-0.5 w-full bg-transparent outline-none text-[16px] text-slate-900 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-600';

const EditCustomerSheet: React.FC<EditCustomerSheetProps> = ({ customer, onClose, onUpdate }) => {
  const initial = useMemo(() => ({
    name: customer.name || '',
    phone: customer.phone || '',
    address: customer.address || '',
    notes: customer.notes || '',
    allowWhatsapp: customer.allowWhatsappNotification !== false,
    passportSeries: customer.passportSeries || '',
    passportNumber: customer.passportNumber || '',
    passportIssuedBy: customer.passportIssuedBy || '',
    birthDate: customer.birthDate || '',
  }), [customer]);
  const [form, setForm] = useState(initial);
  const set = <K extends keyof typeof initial>(key: K, value: (typeof initial)[K]) =>
    setForm(f => ({ ...f, [key]: value }));

  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some(k => form[k] !== initial[k]);
  const valid = form.name.trim().length > 0 && form.phone.trim().length > 0;

  const save = (close: () => void) => {
    if (!valid || !dirty) return;
    onUpdate({
      ...customer,
      name: form.name.trim(),
      phone: form.phone.trim(),
      address: form.address,
      notes: form.notes,
      allowWhatsappNotification: form.allowWhatsapp,
      passportSeries: form.passportSeries.trim() || undefined,
      passportNumber: form.passportNumber.trim() || undefined,
      passportIssuedBy: form.passportIssuedBy.trim() || undefined,
      birthDate: form.birthDate || undefined,
    });
    close();
  };

  return (
    <GlassSheet
      title="Клиент"
      subtitle={form.name.trim() || 'Без имени'}
      onClose={onClose}
      cancelLabel="Отмена"
      action={{ label: 'Готово', submit: true, disabled: !(valid && dirty) }}
      onSubmit={save}
      confirmClose={() => !dirty || window.confirm('Закрыть без сохранения? Изменения пропадут.')}
    >
        <div className="space-y-6">
          <Section>
            <Field label="ФИО">
              <input className={inputClass} value={form.name} onChange={e => set('name', e.target.value)}
                     autoComplete="off" autoCorrect="off" spellCheck={false} autoCapitalize="words"
                     enterKeyHint="next" placeholder="Иванов Иван Иванович" required />
            </Field>
            <Field label="Телефон">
              <input className={inputClass} value={form.phone} onChange={e => set('phone', e.target.value)}
                     type="tel" inputMode="tel" autoComplete="off" enterKeyHint="next"
                     placeholder="+7 900 000-00-00" required />
            </Field>
          </Section>

          <Section title="Адрес и документы" hint="Паспорт необязателен — нужен для печати полного договора.">
            <Field label="Адрес">
              <input className={inputClass} value={form.address} onChange={e => set('address', e.target.value)}
                     autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="next"
                     placeholder="г. Москва, ул. Ленина, д. 1" />
            </Field>
            <Field label="Дата рождения">
              {/* Пустое поле даты на iPhone — высокая пустая полоса без подсказки.
                  Высота фиксирована, значение прижато влево, а пока даты нет —
                  подпись под прозрачным полем. */}
              <span className="relative block">
                {!form.birthDate && (
                  <span className="pointer-events-none absolute inset-0 flex items-center text-[16px] text-slate-300 dark:text-slate-600">Не указана</span>
                )}
                <input className={`${inputClass} h-7 appearance-none [&::-webkit-date-and-time-value]:text-left ${form.birthDate ? '' : 'text-transparent'}`}
                       type="date" value={form.birthDate}
                       max={new Date().toISOString().slice(0, 10)}
                       onChange={e => set('birthDate', e.target.value)} />
              </span>
            </Field>
            <div className="grid grid-cols-2 divide-x divide-slate-100 dark:divide-slate-700/70">
              <Field label="Серия паспорта">
                <input className={`${inputClass} font-mono tracking-wider`} value={form.passportSeries}
                       onChange={e => set('passportSeries', e.target.value.replace(/[^0-9A-ZА-Я]/gi, '').toUpperCase().slice(0, 4))}
                       inputMode="numeric" maxLength={4} placeholder="4501" autoComplete="off" />
              </Field>
              <Field label="Номер">
                <input className={`${inputClass} font-mono tracking-wider`} value={form.passportNumber}
                       onChange={e => set('passportNumber', e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                       inputMode="numeric" maxLength={6} placeholder="123456" autoComplete="off" />
              </Field>
            </div>
            <Field label="Кем выдан">
              <input className={inputClass} value={form.passportIssuedBy}
                     onChange={e => set('passportIssuedBy', e.target.value)} maxLength={100}
                     autoComplete="off" autoCorrect="off" spellCheck={false}
                     placeholder="УФМС России по г. Москве" />
            </Field>
          </Section>

          <Section title="Заметки">
            <textarea
              className="block w-full px-4 py-3 bg-transparent outline-none resize-none text-[16px] text-slate-900 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-600"
              rows={3} value={form.notes} onChange={e => set('notes', e.target.value)}
              placeholder="Что важно помнить об этом клиенте"
            />
          </Section>

          <Section hint="Автоматические напоминания о платежах этому клиенту.">
            <label className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer">
              <span className="text-[16px] text-slate-900 dark:text-white">Напоминания в WhatsApp</span>
              <span className="relative inline-flex shrink-0">
                <input type="checkbox" className="sr-only peer" checked={form.allowWhatsapp}
                       onChange={e => set('allowWhatsapp', e.target.checked)} />
                <span className="w-[51px] h-[31px] rounded-full bg-slate-200 dark:bg-slate-700 peer-checked:bg-emerald-500 transition-colors" />
                <span className="absolute top-[2px] left-[2px] w-[27px] h-[27px] rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
              </span>
            </label>
          </Section>
        </div>
    </GlassSheet>
  );
};

export default EditCustomerSheet;
