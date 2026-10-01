import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ModalPortal from './ModalPortal';
import { Customer } from '../types';

/**
 * Редактирование клиента — лист, как в системных формах iOS.
 *
 * Было окно во весь экран: шапка «Редактировать клиента» стояла под самой
 * чёлкой и не уходила при прокрутке, кнопки прибиты к низу (их закрывала
 * клавиатура), поля шли одной простынёй с эмодзи вместо заголовков.
 *
 * Теперь: лист выезжает снизу и не заходит под чёлку; крупный заголовок с
 * именем клиента уходит при прокрутке, а в узкой панели сверху проявляется
 * короткое название — там же «Отмена» и «Готово», которые клавиатура не
 * закрывает. Поля сгруппированы карточками. «Готово» активна, только когда
 * есть что сохранить, а закрыть с несохранёнными правками можно лишь
 * подтвердив это.
 */

interface EditCustomerSheetProps {
  customer: Customer;
  onClose: () => void;
  onUpdate: (c: Customer) => void;
}

// Длительность ухода — совпадает с переходом листа ниже
const OUT_MS = 300;
const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 0.6; // px/мс

const isPhoneWidth = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches;

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const Section: React.FC<{ title?: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <section>
    {title && (
      <p className="px-4 pb-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{title}</p>
    )}
    <div className="rounded-2xl bg-white dark:bg-slate-800 ring-1 ring-slate-200/70 dark:ring-slate-700/70 divide-y divide-slate-100 dark:divide-slate-700/70 overflow-hidden">
      {children}
    </div>
    {hint && <p className="px-4 pt-1.5 text-[12px] leading-snug text-slate-400 dark:text-slate-500">{hint}</p>}
  </section>
);

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

  // ── Появление, уход и смахивание ─────────────────────────────────────────
  const phone = useRef(isPhoneWidth());
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ y0: number; t0: number; dy: number } | null>(null);

  const leave = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    (document.activeElement as HTMLElement | null)?.blur?.();
    setClosing(true);
    setTimeout(onClose, reducedMotion() ? 0 : OUT_MS);
  };

  // Закрыть без сохранения: с правками — только переспросив
  const requestClose = () => {
    if (dirty && !window.confirm('Закрыть без сохранения? Изменения пропадут.')) {
      setDragY(0);
      return;
    }
    leave();
  };

  const save = (e?: React.FormEvent) => {
    e?.preventDefault();
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
    leave();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Смахивание — за верхнюю панель. Список полей листается сам, тянуть за него
  // значило бы спорить с прокруткой.
  const onDragStart = (e: React.PointerEvent) => {
    if (!phone.current || e.pointerType === 'mouse') return;
    if ((e.target as HTMLElement).closest('button, input, textarea')) return;
    drag.current = { y0: e.clientY, t0: performance.now(), dy: 0 };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const raw = e.clientY - drag.current.y0;
    const dy = raw > 0 ? raw : raw / 6;
    drag.current.dy = dy;
    setDragY(dy);
  };
  const onDragEnd = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d) return;
    const velocity = d.dy / Math.max(1, performance.now() - d.t0);
    if (d.dy > DISMISS_DISTANCE || (d.dy > 24 && velocity > DISMISS_VELOCITY)) requestClose();
    else setDragY(0);
  };

  // ── Крупный заголовок уходит при прокрутке ───────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Короткое название в панели проявляется, когда крупное почти скрылось
    const onScroll = () => setScrolled(el.scrollTop > 44);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Клавиатура перекрывает низ листа — оставляем под полями место, чтобы
  // нижние можно было докрутить до видимой части (как в поиске).
  const [keyboardInset, setKeyboardInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setKeyboardInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    update();
    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  }, []);

  const isPhone = phone.current;
  const panelStyle: React.CSSProperties = isPhone
    ? {
        transform: `translateY(${closing ? '105%' : `${dragY}px`})`,
        transition: dragging ? 'none' : `transform ${OUT_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`,
      }
    : {
        transform: closing ? 'scale(0.97)' : undefined,
        opacity: closing ? 0 : undefined,
        transition: 'transform 180ms ease, opacity 180ms ease',
      };
  const backdropStyle: React.CSSProperties = {
    opacity: closing ? 0 : isPhone ? Math.max(0.35, 1 - Math.max(0, dragY) / 500) : 1,
    transition: dragging ? 'none' : `opacity ${OUT_MS}ms ease`,
  };

  const canSave = valid && dirty;

  return (
    <ModalPortal onClose={requestClose}>
      <div className="fixed inset-0 z-[200] flex justify-center sm:items-center sm:p-6">
        <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px] search-backdrop-in" style={backdropStyle} onClick={requestClose} />

        <form
          role="dialog"
          aria-label="Редактирование клиента"
          onSubmit={save}
          style={panelStyle}
          className="search-panel-in relative flex flex-col w-full sm:max-w-md overflow-hidden
                     bg-slate-50 dark:bg-slate-900 shadow-2xl
                     mt-[calc(env(safe-area-inset-top,0px)+10px)] sm:mt-0 rounded-t-[28px] sm:rounded-3xl
                     h-[calc(100%-env(safe-area-inset-top,0px)-10px)] sm:h-auto sm:max-h-[88vh]"
        >
          {/* Панель: ручка, «Отмена», короткое название, «Готово». За неё лист смахивается */}
          <div
            className={`shrink-0 touch-none select-none transition-colors duration-200 ${
              scrolled ? 'bg-slate-50/85 dark:bg-slate-900/85 backdrop-blur-xl' : ''
            }`}
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
          >
            <div className="sm:hidden flex justify-center pt-2">
              <span className="h-[5px] w-9 rounded-full bg-slate-300 dark:bg-slate-600" />
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center h-12 px-4">
              <button type="button" onClick={requestClose}
                      className="justify-self-start text-[16px] text-indigo-600 dark:text-indigo-400 active:opacity-60">
                Отмена
              </button>
              <span className={`text-[16px] font-semibold text-slate-900 dark:text-white transition-opacity duration-200 ${scrolled ? 'opacity-100' : 'opacity-0'}`}>
                Клиент
              </span>
              <button type="submit" disabled={!canSave}
                      className="justify-self-end text-[16px] font-semibold text-indigo-600 dark:text-indigo-400 disabled:text-slate-300 dark:disabled:text-slate-600 active:opacity-60 transition-colors">
                Готово
              </button>
            </div>
            <div className={`h-px transition-colors duration-200 ${scrolled ? 'bg-slate-200 dark:bg-slate-800' : 'bg-transparent'}`} />
          </div>

          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto overscroll-contain px-4"
            style={{ paddingBottom: `calc(${keyboardInset}px + env(safe-area-inset-bottom, 0px) + 24px)` }}
          >
            {/* Крупный заголовок — уезжает вместе с полями */}
            <header className="pt-1 pb-5">
              <h2 className="text-[28px] leading-tight font-bold tracking-tight text-slate-900 dark:text-white">Клиент</h2>
              <p className="mt-0.5 text-[15px] text-slate-500 dark:text-slate-400 truncate">{form.name.trim() || 'Без имени'}</p>
            </header>

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
          </div>
        </form>
      </div>
    </ModalPortal>
  );
};

export default EditCustomerSheet;
