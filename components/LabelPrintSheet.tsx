import React, { useState } from 'react';
import type { Product } from '../types';
import Sheet from './Sheet';
import { barcodeSvg, escapeHtml, generateInternalBarcodes, labelCode } from '../src/barcode';
import { formatCurrency } from '../src/utils';

type LabelSize = '58x40' | '43x25' | 'A4';

const SIZES: { id: LabelSize; title: string; hint: string }[] = [
  { id: '58x40', title: '58 × 40', hint: 'термопринтер' },
  { id: '43x25', title: '43 × 25', hint: 'мелкий товар' },
  { id: 'A4', title: 'Лист A4', hint: '24 наклейки' },
];

const SIZE_KEY = 'finuchet_label_size';
/** Больше за раз не печатают, а тысяча страниц подвесила бы окно печати */
const MAX_LABELS = 500;

const readSize = (): LabelSize => {
  try {
    const v = localStorage.getItem(SIZE_KEY);
    return v === '43x25' || v === 'A4' ? v : '58x40';
  } catch { return '58x40'; }
};

/**
 * CSS этикеток. Размеры — в миллиметрах, @page подгоняет страницу под
 * этикетку: у термопринтера одна «страница» и есть одна наклейка.
 */
const labelCss = (size: LabelSize) => {
  const base = `
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #000; }
    .label { overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; }
    .name { font-weight: 600; line-height: 1.15; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; }
    .price { font-weight: 800; white-space: nowrap; }
    .code svg { display: block; width: 100%; }
    .digits { text-align: center; letter-spacing: 0.08em; font-variant-numeric: tabular-nums; }
    @media screen { body { background: #e2e8f0; padding: 12px; } .label { background: #fff; margin: 0 auto 8px; box-shadow: 0 1px 3px rgba(0,0,0,.2); } }
  `;
  if (size === 'A4') {
    return `${base}
      /* Лист 70 × 37 — 24 наклейки встык, без полей: восемь рядов по 37 мм и
         есть высота A4. Поля страницы сдвинули бы сетку с вырубки уже на
         втором ряду, и печать поехала бы мимо наклеек. */
      @page { size: A4; margin: 0; }
      .sheet { display: grid; grid-template-columns: repeat(3, 70mm); grid-auto-rows: 37mm; width: 210mm; margin: 0 auto; }
      .label { width: 70mm; height: 37mm; padding: 3mm 4mm; margin: 0 !important; box-shadow: none !important; border: 0.2mm dashed #ccc; break-inside: avoid; }
      .name { font-size: 9pt; -webkit-line-clamp: 2; }
      .price { font-size: 12pt; }
      .code svg { height: 12mm; }
      .digits { font-size: 7.5pt; }
      @media print { .label { border: 0; } }
    `;
  }
  const small = size === '43x25';
  const [w, h] = small ? [43, 25] : [58, 40];
  return `${base}
    @page { size: ${w}mm ${h}mm; margin: 0; }
    .label { width: ${w}mm; height: ${h}mm; padding: ${small ? '1.2mm 1.8mm' : '2mm 2.5mm'}; page-break-after: always; break-after: page; }
    .label:last-child { page-break-after: auto; break-after: auto; }
    .name { font-size: ${small ? '6.5pt' : '8.5pt'}; -webkit-line-clamp: ${small ? 1 : 2}; }
    .price { font-size: ${small ? '9pt' : '13pt'}; }
    .code svg { height: ${small ? '9mm' : '14mm'}; }
    .digits { font-size: ${small ? '6pt' : '7.5pt'}; }
  `;
};

interface LabelPrintSheetProps {
  /** Товары, для которых печатаем */
  products: Product[];
  /** Весь каталог — чтобы новый внутренний код не совпал ни с одним существующим */
  allProducts: Product[];
  onSaveProduct: (product: Product) => Promise<void> | void;
  onClose: () => void;
  showCents?: boolean;
}

/**
 * Печать этикеток со штрихкодом.
 *
 * Товару без кода этикетку не напечатать — и молча пропустить его нельзя:
 * человек пересчитал бы наклейки уже у полки. Поэтому такие товары видны
 * списком, и код им создаётся одной кнопкой прямо здесь, с сохранением в
 * карточку: иначе на этикетке оказался бы код, которого касса не знает.
 */
const LabelPrintSheet: React.FC<LabelPrintSheetProps> = ({
  products, allProducts, onSaveProduct, onClose, showCents = false,
}) => {
  const [counts, setCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(products.map(p => [p.id, 1])));
  const [size, setSize] = useState<LabelSize>(readSize);
  const [withPrice, setWithPrice] = useState(true);
  // Созданные здесь коды: карточка товара в родителе обновится не мгновенно,
  // а печатать нужно уже сейчас.
  const [generated, setGenerated] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const codeOf = (p: Product) => generated[p.id] || labelCode(p);
  const missing = products.filter(p => !codeOf(p));
  const printable = products.filter(p => codeOf(p));
  const totalLabels = printable.reduce((s, p) => s + (counts[p.id] || 0), 0);

  const pickSize = (s: LabelSize) => {
    setSize(s);
    try { localStorage.setItem(SIZE_KEY, s); } catch { /* не запомнится — не страшно */ }
  };

  const createCodes = async () => {
    setBusy(true);
    setError(null);
    try {
      const withGenerated = allProducts.map(p => (generated[p.id] ? { ...p, barcodes: [generated[p.id]] } : p));
      const codes = generateInternalBarcodes(withGenerated, missing.length);
      for (let i = 0; i < missing.length; i++) {
        const p = missing[i];
        await onSaveProduct({ ...p, barcodes: [...(p.barcodes || []), codes[i]], updatedAt: new Date().toISOString() });
        setGenerated(prev => ({ ...prev, [p.id]: codes[i] }));
      }
    } catch (e: any) {
      setError(e?.message || 'Не удалось сохранить штрихкоды');
    } finally {
      setBusy(false);
    }
  };

  const print = () => {
    if (totalLabels === 0) return;
    if (totalLabels > MAX_LABELS) { setError(`За раз можно напечатать до ${MAX_LABELS} этикеток`); return; }

    // Цена на ценнике — ровно та, что пробьёт касса. Копейки прячутся только у
    // целых цен: пирожок за 45,50 без них напечатался бы как «46 ₽».
    const priceText = (price: number) => formatCurrency(price, showCents || !Number.isInteger(price));

    const labels = printable.flatMap(p => {
      const code = codeOf(p);
      const svg = barcodeSvg(code) || '';
      const html = `
        <div class="label">
          <div class="name">${escapeHtml(p.name)}</div>
          ${withPrice ? `<div class="price">${escapeHtml(priceText(p.price || 0))} ₽</div>` : ''}
          <div><div class="code">${svg}</div><div class="digits">${escapeHtml(code)}</div></div>
        </div>`;
      return Array.from({ length: counts[p.id] || 0 }, () => html);
    }).join('');

    const win = window.open('', '_blank', 'width=720,height=900');
    if (!win) { setError('Окно печати заблокировано — разрешите всплывающие окна для сайта.'); return; }
    win.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8">
      <title>Этикетки</title><style>${labelCss(size)}</style></head>
      <body>${size === 'A4' ? `<div class="sheet">${labels}</div>` : labels}</body></html>`);
    win.document.close();
    win.focus();
    window.setTimeout(() => win.print(), 300);
  };

  const step = (id: string, delta: number) =>
    setCounts(prev => ({ ...prev, [id]: Math.max(0, Math.min(MAX_LABELS, (prev[id] || 0) + delta)) }));

  return (
    <Sheet onClose={onClose} className="sm:max-w-md max-h-[92vh] flex flex-col">
      {(close: () => void) => (
        <>
          <div className="px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between shrink-0">
            <h3 className="font-bold text-slate-800 dark:text-white">Этикетки</h3>
            <button type="button" onClick={close}
                    className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 font-bold active:scale-90 transition-transform">×</button>
          </div>

          <div className="overflow-y-auto p-4 space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {SIZES.map(s => (
                <button key={s.id} type="button" onClick={() => pickSize(s.id)}
                        className={`py-2.5 rounded-xl border-2 text-center transition-colors ${
                          size === s.id
                            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                            : 'border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                        }`}>
                  <span className="block text-sm font-bold">{s.title}</span>
                  <span className="block text-[10px] text-slate-400">{s.hint}</span>
                </button>
              ))}
            </div>

            <label className="flex items-center justify-between gap-3 px-1">
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Печатать цену</span>
              <input type="checkbox" checked={withPrice} onChange={e => setWithPrice(e.target.checked)} className="w-5 h-5 accent-indigo-600" />
            </label>

            {missing.length > 0 && (
              <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 space-y-2">
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  {missing.length === 1 ? 'У товара нет штрихкода' : `У ${missing.length} товаров нет штрихкода`} — этикетку не напечатать.
                </p>
                <button type="button" disabled={busy} onClick={createCodes}
                        className="w-full py-2.5 rounded-xl bg-amber-500 text-white font-bold text-sm disabled:opacity-60 active:scale-[0.98] transition-transform">
                  {busy ? 'Создаём…' : 'Создать штрихкоды'}
                </button>
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700 overflow-hidden">
              {products.map(p => {
                const code = codeOf(p);
                return (
                  <div key={p.id} className="flex items-center gap-3 p-3 bg-white dark:bg-slate-800">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm text-slate-800 dark:text-white truncate">{p.name}</p>
                      <p className={`text-[11px] truncate ${code ? 'text-slate-400' : 'text-amber-600 dark:text-amber-400'}`}>
                        {code || 'нет штрихкода'}
                      </p>
                    </div>
                    {code && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button type="button" onClick={() => step(p.id, -1)}
                                className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold">−</button>
                        <span className="w-8 text-center font-bold text-slate-800 dark:text-white">{counts[p.id] || 0}</span>
                        <button type="button" onClick={() => step(p.id, 1)}
                                className="w-8 h-8 rounded-lg bg-indigo-600 text-white font-bold">+</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {error && (
              <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
            )}
          </div>

          <div className="p-4 border-t border-slate-100 dark:border-slate-700 shrink-0">
            <button type="button" disabled={totalLabels === 0} onClick={print}
                    className="w-full py-3.5 rounded-2xl bg-indigo-600 text-white font-bold disabled:opacity-40 active:scale-[0.99] transition-transform">
              {totalLabels === 0 ? 'Нечего печатать' : `Печать · ${totalLabels} шт`}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
};

export default LabelPrintSheet;
