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
}

const PREFS_KEY = 'finuchet_share_debtors';
type Prefs = { amount: boolean; phone: boolean; product: boolean };
const DEFAULTS: Prefs = { amount: true, phone: false, product: false };

const fmtBirth = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : `${d.toLocaleDateString('ru-RU')} г.р.`;
};

export const debtorsText = (rows: DebtorRow[], p: Prefs, showCents?: boolean): string => {
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

const ShareDebtorsSheet: React.FC<{ rows: DebtorRow[]; showCents?: boolean; onClose: () => void }> = ({ rows, showCents, onClose }) => {
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
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
    && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  return (
    <GlassSheet
      title="Поделиться списком"
      subtitle={`${rows.length} ${rows.length === 1 ? 'клиент' : rows.length % 10 >= 2 && rows.length % 10 <= 4 && (rows.length % 100 < 10 || rows.length % 100 >= 20) ? 'клиента' : 'клиентов'}${withBirth < rows.length ? ` · без даты рождения: ${rows.length - withBirth}` : ''}`}
      onClose={onClose}
      cancelLabel="Закрыть"
      action={{ label: copied ? 'Скопировано ✓' : 'Скопировать', onClick: () => { copy(); } }}
    >
      <div className="space-y-6">
        <SheetSection title="Что в списке" hint="ФИО, дата рождения и срок просрочки — всегда. Порядок и отбор — как на экране.">
          <SheetToggle label="Сумма просрочки" checked={prefs.amount} onChange={v => set('amount', v)} tone="indigo" />
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
          {canShare && (
            <button type="button" onClick={() => navigator.share({ text }).catch(() => {})}
                    className="flex-1 py-3 rounded-2xl bg-white/80 dark:bg-white/10 text-indigo-600 dark:text-indigo-300 font-bold text-[15px] active:scale-[0.98] transition">
              Поделиться…
            </button>
          )}
        </div>
      </div>
    </GlassSheet>
  );
};

export default ShareDebtorsSheet;
