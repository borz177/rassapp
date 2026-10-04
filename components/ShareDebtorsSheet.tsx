import React, { useMemo, useState } from 'react';
import GlassSheet, { SheetSection, SheetToggle } from './GlassSheet';
import { daysWord } from '../src/contractMetrics';
import { formatCurrency } from '../src/utils';

/**
 * «Поделиться» списком просроченных: ФИО, дата рождения (если есть в карточке)
 * и срок просрочки — текстом, чтобы вставить в мессенджер, заметки или письмо.
 *
 * Список — тот, что сейчас на экране: с выбранными фильтрами и в выбранном
 * порядке. Что ещё добавить (сумма, телефон, товар) — переключателями; выбор
 * запоминается на устройстве.
 */
export interface DebtorRow {
  name: string;
  birthDate?: string;
  phone?: string;
  product?: string;
  days: number;
  amount: number;
  // Для одного договора (меню действий договора) — карточка подробнее
  contractNo?: string;
  startDate?: string;
  remaining?: number;
  missed?: number;
}

const PREFS_KEY = 'finuchet_share_debtors';
type Prefs = { amount: boolean; phone: boolean; product: boolean };
const DEFAULTS: Prefs = { amount: true, phone: false, product: false };

const fmtBirth = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : `${d.toLocaleDateString('ru-RU')} г.р.`;
};

/** Один договор — карточкой в несколько строк, а не строкой списка */
const singleText = (r: DebtorRow, p: Prefs, showCents?: boolean): string => {
  const money = (n: number) => `${formatCurrency(n, showCents)} ₽`;
  return [
    [r.name, fmtBirth(r.birthDate)].filter(Boolean).join(', '),
    r.contractNo || r.startDate
      ? `Договор${r.contractNo ? ` №${r.contractNo}` : ''}${r.startDate ? ` от ${new Date(r.startDate).toLocaleDateString('ru-RU')}` : ''}${p.product && r.product ? ` · ${r.product}` : ''}`
      : (p.product && r.product ? r.product : ''),
    r.days > 0
      ? `Просрочка: ${r.days} ${daysWord(r.days)}${p.amount ? `, ${money(r.amount)}` : ''}${r.missed ? ` (${r.missed} ${r.missed === 1 ? 'платёж' : r.missed < 5 ? 'платежа' : 'платежей'})` : ''}`
      : 'Просрочки нет',
    p.amount && r.remaining !== undefined ? `Остаток долга: ${money(r.remaining)}` : '',
    p.phone && r.phone ? `Телефон: ${r.phone}` : '',
  ].filter(Boolean).join('\n');
};

export const debtorsText = (rows: DebtorRow[], p: Prefs, showCents?: boolean): string => {
  if (rows.length === 1 && rows[0].contractNo !== undefined) return singleText(rows[0], p, showCents);
  const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const lines = rows.map((r, i) => {
    const who = [r.name, fmtBirth(r.birthDate)].filter(Boolean).join(', ');
    const extra = [
      `просрочка ${r.days} ${daysWord(r.days)}`,
      p.amount ? `${formatCurrency(r.amount, showCents)} ₽` : '',
      p.product && r.product ? r.product : '',
      p.phone && r.phone ? r.phone : '',
    ].filter(Boolean).join(', ');
    return `${i + 1}. ${who} — ${extra}`;
  });
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return [
    `Просроченные договоры на ${date}`,
    '',
    ...lines,
    ...(p.amount ? ['', `Итого просрочено: ${formatCurrency(total, showCents)} ₽`] : []),
  ].join('\n');
};

const ShareDebtorsSheet: React.FC<{ rows: DebtorRow[]; showCents?: boolean; onClose: () => void; title?: string }> = ({ rows, showCents, onClose, title }) => {
  const single = rows.length === 1 && rows[0].contractNo !== undefined;
  const [prefs, setPrefs] = useState<Prefs>(() => {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return DEFAULTS; }
  });
  const set = (k: keyof Prefs, v: boolean) => setPrefs(p => {
    const next = { ...p, [k]: v };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* не критично */ }
    return next;
  });
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => debtorsText(rows, prefs, showCents), [rows, prefs, showCents]);
  const withBirth = rows.filter(r => r.birthDate).length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Старый WebView без доступа к буферу — через скрытое поле
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } finally { ta.remove(); }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  // Без номера: WhatsApp откроет выбор чата с уже вставленным текстом
  const openWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
    && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  return (
    <GlassSheet
      title={title || (single ? 'Поделиться договором' : 'Поделиться списком')}
      subtitle={single ? rows[0].name : `${rows.length} ${rows.length === 1 ? 'клиент' : rows.length % 10 >= 2 && rows.length % 10 <= 4 && (rows.length % 100 < 10 || rows.length % 100 >= 20) ? 'клиента' : 'клиентов'}${withBirth < rows.length ? ` · без даты рождения: ${rows.length - withBirth}` : ''}`}
      onClose={onClose}
      cancelLabel="Закрыть"
      action={{ label: copied ? 'Скопировано ✓' : 'Скопировать', onClick: () => { copy(); } }}
    >
      <div className="space-y-6">
        <SheetSection title={single ? 'Что отправить' : 'Что в списке'}
                      hint={single ? 'ФИО, дата рождения, договор и просрочка — всегда.' : 'ФИО, дата рождения и срок просрочки — всегда. Порядок и отбор — как на экране.'}>
          <SheetToggle label={single ? 'Суммы' : 'Сумма просрочки'} checked={prefs.amount} onChange={v => set('amount', v)} tone="indigo" />
          <SheetToggle label="Телефон" checked={prefs.phone} onChange={v => set('phone', v)} tone="indigo" />
          <SheetToggle label="Товар" checked={prefs.product} onChange={v => set('product', v)} tone="indigo" />
        </SheetSection>

        <SheetSection title="Так будет выглядеть">
          <pre className="px-4 py-3.5 max-h-[45vh] overflow-y-auto whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-slate-700 dark:text-slate-200 select-text">{text}</pre>
        </SheetSection>

        <div className="flex gap-2">
          <button type="button" onClick={copy}
                  className="flex-1 py-3 rounded-2xl bg-indigo-600 text-white font-bold text-[15px] active:scale-[0.98] transition">
            {copied ? 'Скопировано ✓' : 'Скопировать'}
          </button>
          {/* WhatsApp — сам выберет, кому отправить: чат, группа, себе */}
          <button type="button" onClick={openWhatsApp}
                  className="flex-1 py-3 rounded-2xl bg-emerald-600 text-white font-bold text-[15px] active:scale-[0.98] transition flex items-center justify-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Zm5.8 14.06c-.24.68-1.42 1.3-1.95 1.35-.5.05-1.13.22-3.8-.79-3.2-1.26-5.26-4.53-5.42-4.74-.16-.21-1.29-1.72-1.29-3.28s.82-2.33 1.11-2.65c.29-.32.63-.4.84-.4l.6.01c.19.01.45-.07.71.54.26.63.88 2.18.96 2.34.08.16.13.34.03.55-.1.21-.16.34-.32.53-.16.18-.33.41-.48.55-.16.16-.32.33-.14.65.19.32.83 1.37 1.78 2.22 1.23 1.09 2.26 1.43 2.58 1.59.32.16.5.13.69-.08.18-.21.79-.92 1-1.24.21-.32.42-.26.71-.16.29.11 1.83.86 2.14 1.02.32.16.53.24.6.37.08.13.08.76-.16 1.44Z"/></svg>
            WhatsApp
          </button>
          {canShare && (
            <button type="button" onClick={() => navigator.share({ text }).catch(() => {})}
                    className="flex-1 py-3 rounded-2xl bg-white/80 dark:bg-white/10 text-indigo-600 dark:text-indigo-300 font-bold text-[15px] active:scale-[0.98] transition">
              Ещё…
            </button>
          )}
        </div>
      </div>
    </GlassSheet>
  );
};

export default ShareDebtorsSheet;
