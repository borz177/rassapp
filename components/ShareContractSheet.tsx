import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, Share2 } from 'lucide-react';
import GlassSheet, { SheetSection, SheetToggle } from './GlassSheet';
import {
  contractShareText,
  normalizeContractSharePrefs,
  type ContractShareData,
  type ContractShareField,
  type ContractSharePrefs,
} from '../src/contractShare';
import { formatRuPhone, normalizePhoneForWhatsApp } from '../src/utils';
import { friendlyError } from '../src/friendlyError';

const FIELDS: { key: ContractShareField; label: string }[] = [
  { key: 'number', label: 'Номер договора' },
  { key: 'date', label: 'Дата оформления' },
  { key: 'product', label: 'Товар' },
  { key: 'total', label: 'Сумма договора' },
  { key: 'downPayment', label: 'Первоначальный взнос' },
  { key: 'monthly', label: 'Ежемесячный платёж' },
  { key: 'paymentDay', label: 'День оплаты' },
  { key: 'remaining', label: 'Остаток долга' },
  { key: 'manager', label: 'Связь с менеджером' },
];
const EXTRAS: { key: ContractShareField; label: string }[] = [
  { key: 'customer', label: 'ФИО клиента' },
  { key: 'birth', label: 'Дата рождения клиента' },
  { key: 'phone', label: 'Телефон клиента' },
  { key: 'overdue', label: 'Сумма просрочки' },
];
// В буфер и мессенджер уходит исходный текст со звёздочками WhatsApp.
// Предпросмотр выделяет те же значения; HTML из названий не выполняется.
const preview = (text: string) =>
  text
    .split(/(\*[^*\n]+\*)/g)
    .map((part, i) =>
      part.startsWith('*') && part.endsWith('*') ? <strong key={i}>{part.slice(1, -1)}</strong> : part
    );
export default function ShareContractSheet({
  data,
  showCents,
  userId,
  onClose,
}: {
  data: ContractShareData;
  showCents?: boolean;
  userId?: string;
  onClose: () => void;
}) {
  const key = `finuchet_share_contract_${userId || 'local'}`;
  const [prefs, setPrefs] = useState<ContractSharePrefs>(() => {
    try {
      return normalizeContractSharePrefs(JSON.parse(localStorage.getItem(key) || 'null'));
    } catch {
      return normalizeContractSharePrefs(null);
    }
  });
  const [copied, setCopied] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  const set = (field: ContractShareField, value: boolean) =>
    setPrefs((p) => {
      const next = { ...p, [field]: value };
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {}
      return next;
    });
  const text = useMemo(() => contractShareText(data, prefs, showCents), [data, prefs, showCents]);
  useEffect(() => {
    setCopied(false);
  }, [text]);
  const copy = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
          if (!document.execCommand('copy'))
            throw new Error('Не удалось скопировать. Выделите текст сообщения вручную.');
        } finally {
          ta.remove();
        }
      }
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  const share = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await navigator.share({ text });
    } catch (e: any) {
      if (e?.name !== 'AbortError') setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  const canShare = typeof navigator.share === 'function' && matchMedia('(pointer: coarse)').matches;
  const manager = normalizePhoneForWhatsApp(data.managerPhone);
  return (
    <GlassSheet
      title="Поделиться"
      subtitle={data.contractNo ? `Договор № ${data.contractNo}` : data.sale.productName}
      onClose={onClose}
      cancelLabel="Закрыть"
      action={{
        label: copied ? 'Скопировано ✓' : 'Скопировать',
        onClick: () => {
          void copy();
        },
        disabled: busy,
      }}
    >
      <div className="space-y-5">
        <SheetSection title="Сообщение">
          <div
            aria-label="Предпросмотр сообщения"
            className="px-4 py-4 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-slate-700 dark:text-slate-200 select-text"
          >
            {preview(text)}
          </div>
        </SheetSection>
        <details className="group">
          <summary className="list-none cursor-pointer flex items-center justify-between gap-2 px-1 py-2 text-[15px] font-semibold text-slate-700 dark:text-slate-200">
            Выбрать поля
            <ChevronDown size={17} className="transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-4 mt-2">
            <SheetSection title="Условия договора">
              {FIELDS.filter(
                (f) => data.sale.type !== 'CASH' || !['downPayment', 'monthly', 'paymentDay'].includes(f.key)
              ).map((f) => (
                <SheetToggle
                  key={f.key}
                  label={f.label}
                  checked={prefs[f.key]}
                  onChange={(v) => set(f.key, v)}
                  tone="indigo"
                  description={
                    f.key === 'manager'
                      ? manager
                        ? formatRuPhone(data.managerPhone)
                        : 'Телефон менеджера не указан в профиле'
                      : undefined
                  }
                />
              ))}
            </SheetSection>
            <SheetSection title="Дополнительно">
              {EXTRAS.map((f) => (
                <SheetToggle
                  key={f.key}
                  label={f.label}
                  checked={prefs[f.key]}
                  onChange={(v) => set(f.key, v)}
                  tone="indigo"
                />
              ))}
            </SheetSection>
            <p className="px-1 text-[12px] text-slate-500">
              Выбор сохранится. В сообщении — только заполненные данные.
            </p>
          </div>
        </details>
        {error && (
          <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void copy()}
            className="flex-1 inline-flex justify-center items-center gap-2 py-3 px-3 rounded-2xl bg-indigo-600 text-white text-sm font-bold active:scale-[.98] transition disabled:opacity-50"
          >
            {copied ? <Check size={17} /> : <Copy size={17} />} {copied ? 'Скопировано' : 'Скопировать'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
            }
            className="flex-1 py-3 px-3 rounded-2xl bg-emerald-600 text-white text-sm font-bold active:scale-[.98] transition disabled:opacity-50"
          >
            WhatsApp
          </button>
          {canShare && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void share()}
              className="px-4 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-sm font-bold inline-flex items-center gap-1.5"
            >
              <Share2 size={16} />
              Ещё
            </button>
          )}
        </div>
      </div>
    </GlassSheet>
  );
}
