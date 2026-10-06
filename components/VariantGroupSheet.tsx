import React, { useMemo, useState } from 'react';
import type { Product, StockLocation, VariantOption } from '../types';
import GlassSheet, { SheetField, SheetSection, sheetInputClass } from './GlassSheet';
import { OPTION_PRESETS, combinations, variantName, variantsOf } from '../src/variants';
import { nextSku } from '../src/sku';
import { barcodeOwner, extractProductCode, normalizeBarcode } from '../src/barcode';
import { DEFAULT_UNIT } from '../src/units';

/**
 * Модель с вариантами: характеристики (размер, цвет, память), их значения и
 * таблица вариантов — у каждого своя цена, остаток, артикул и штрихкод.
 *
 * Одна форма и для новой модели, и для правки: при правке существующие
 * варианты узнаются по значениям характеристик и обновляются, новые сочетания
 * заводятся товарами, а убранные — уходят в архив (не удаляются: по ним есть
 * продажи и движения склада).
 */

interface OptionDraft {
  key: string;
  name: string;
  values: string[];
  /** Имя характеристики до правки — по нему узнаём существующие варианты */
  orig?: string;
  input: string;
}

interface RowDraft {
  enabled: boolean;
  price: string;
  qty: string;
  sku: string;
  barcode: string;
}

export interface VariantSaveRow {
  product: Product;
  /** Начальный остаток нового варианта — приходом на выбранный склад */
  startQty: number;
}

const num = (v: string) => {
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const variantsWord = (n: number) => n % 10 === 1 && n % 100 !== 11 ? 'вариант'
  : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'варианта' : 'вариантов';
const uid = () => Math.random().toString(36).slice(2, 9);

const VariantGroupSheet: React.FC<{
  products: Product[];
  /** Правка существующей модели */
  groupId?: string;
  /** Новая модель — поля из формы товара */
  seed?: Partial<Product>;
  warehouses: StockLocation[];
  defaultWarehouseId: string;
  onClose: () => void;
  onSave: (rows: VariantSaveRow[], warehouseId: string) => Promise<void>;
}> = ({ products, groupId, seed, warehouses, defaultWarehouseId, onClose, onSave }) => {
  const existing = useMemo(() => (groupId ? variantsOf(products, groupId) : []), [products, groupId]);
  const first = existing.find(p => !p.isArchived) || existing[0];
  const source: Partial<Product> = first || seed || {};

  const [base, setBase] = useState(first?.variantBase || seed?.name || '');
  const [category, setCategory] = useState(source.category || '');
  const [price, setPrice] = useState(source.price ? String(source.price) : '');
  const [buyPrice, setBuyPrice] = useState(source.buyPrice !== undefined ? String(source.buyPrice) : '');
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId);
  const [options, setOptions] = useState<OptionDraft[]>(() => {
    const src = first?.variantOptions;
    if (src?.length) return src.map(o => ({ key: uid(), name: o.name, values: [...o.values], orig: o.name, input: '' }));
    return [{ key: uid(), name: 'Размер', values: [], input: '' }];
  });
  const [rows, setRows] = useState<Record<string, RowDraft>>({});
  const [fillQty, setFillQty] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanOptions: VariantOption[] = options
    .map(o => ({ name: o.name.trim(), values: o.values }))
    .filter(o => o.name && o.values.length > 0);
  const combos = combinations(cleanOptions);
  // Ключ строки — значения по позициям характеристик: переименование
  // характеристики («Размер» → «Размер обуви») не превращает варианты в новые
  const keyOf = (attrs: Record<string, string>) => cleanOptions.map(o => (attrs[o.name] || '').toLowerCase()).join('|');

  // Существующий вариант для сочетания: сравниваем значения по позициям. Новая
  // характеристика, которой у старых вариантов нет, считается равной первому
  // своему значению — иначе добавление «Цвета» отправило бы всё в архив.
  const matchExisting = (attrs: Record<string, string>): Product | undefined =>
    existing.find(p => options.every(o => {
      const name = o.name.trim();
      if (!name || o.values.length === 0) return true;
      const had = o.orig ? p.variantAttrs?.[o.orig] : undefined;
      const want = (attrs[name] || '').toLowerCase();
      return had === undefined ? want === (o.values[0] || '').toLowerCase() : had.toLowerCase() === want;
    }));

  const rowOf = (key: string, match?: Product): RowDraft => rows[key] || {
    enabled: match ? !match.isArchived : true,
    price: match && match.price !== num(price) ? String(match.price ?? '') : '',
    qty: '',
    sku: match?.sku || '',
    barcode: match?.barcodes?.[0] || '',
  };
  const setRow = (key: string, match: Product | undefined, patch: Partial<RowDraft>) =>
    setRows(r => ({ ...r, [key]: { ...rowOf(key, match), ...patch } }));

  // ── характеристики ──
  const addValues = (key: string, raw: string) => {
    const parts = raw.split(/[,;\n]/).map(v => v.trim()).filter(Boolean);
    if (!parts.length) return;
    setOptions(list => list.map(o => o.key !== key ? o : {
      ...o, input: '',
      values: [...o.values, ...parts.filter(v => !o.values.some(x => x.toLowerCase() === v.toLowerCase()))],
    }));
  };
  const removeValue = (key: string, v: string) =>
    setOptions(list => list.map(o => (o.key === key ? { ...o, values: o.values.filter(x => x !== v) } : o)));
  const usedNames = new Set(options.map(o => o.name.trim().toLowerCase()));

  const enabledCount = combos.filter(a => rowOf(keyOf(a), matchExisting(a)).enabled).length;

  const save = async (close: () => void) => {
    setError(null);
    if (!base.trim()) { setError('Укажите название модели'); return; }
    if (combos.length === 0) { setError('Добавьте характеристику и хотя бы одно значение'); return; }
    if (enabledCount === 0) { setError('Включите хотя бы один вариант'); return; }

    const gid = groupId || crypto.randomUUID();
    const pool: Pick<Product, 'sku'>[] = [...products];
    const out: VariantSaveRow[] = [];
    const usedCodes = new Set<string>();
    const matched = new Set<string>();

    for (const attrs of combos) {
      const match = matchExisting(attrs);
      const row = rowOf(keyOf(attrs), match);
      if (match) matched.add(match.id);
      if (!row.enabled) {
        // Выключили существующий вариант — в архив, с историей
        if (match && !match.isArchived) out.push({ product: { ...match, isArchived: true, updatedAt: new Date().toISOString() }, startQty: 0 });
        continue;
      }

      let barcodes = match?.barcodes;
      if (normalizeBarcode(row.barcode)) {
        const ex = extractProductCode(row.barcode);
        if ('error' in ex) { setError(ex.error); return; }
        const owner = barcodeOwner(products, ex.code, match?.id);
        if (owner || usedCodes.has(ex.code)) { setError(`Штрихкод ${ex.code} уже у товара «${owner?.name || 'в этой модели'}»`); return; }
        usedCodes.add(ex.code);
        barcodes = [ex.code, ...(match?.barcodes || []).filter(c => c !== ex.code)];
      } else if (match?.barcodes?.length && !row.barcode) {
        barcodes = match.barcodes.slice(1).length ? match.barcodes.slice(1) : undefined;
      }

      let sku = row.sku.trim();
      if (!sku) { sku = nextSku(pool); }
      pool.push({ sku });

      const own = num(row.price);
      const product: Product = {
        ...(match || {}),
        id: match?.id || crypto.randomUUID(),
        userId: match?.userId || seed?.userId || '',
        name: variantName(base, cleanOptions, attrs),
        price: row.price !== '' ? own : num(price),
        category: category.trim() || 'Общее',
        stock: match?.stock ?? 0,
        warehouseStocks: match?.warehouseStocks,
        sku,
        barcodes,
        buyPrice: buyPrice === '' ? match?.buyPrice : num(buyPrice),
        unit: match?.unit || seed?.unit || DEFAULT_UNIT,
        images: match?.images || seed?.images || first?.images,
        description: match?.description ?? seed?.description,
        minStock: match?.minStock ?? seed?.minStock,
        isArchived: false,
        variantGroupId: gid,
        variantBase: base.trim(),
        variantAttrs: attrs,
        variantOptions: cleanOptions,
        updatedAt: new Date().toISOString(),
      };
      out.push({ product, startQty: match ? 0 : Math.max(0, num(row.qty)) });
    }

    // Варианты, сочетания которых больше нет (убрали значение), — в архив
    existing.filter(p => !matched.has(p.id) && !p.isArchived)
      .forEach(p => out.push({ product: { ...p, isArchived: true, updatedAt: new Date().toISOString() }, startQty: 0 }));

    setSaving(true);
    try {
      await onSave(out, warehouseId);
      close();
    } catch (e: any) {
      setError(e?.message || 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const chip = 'h-8 pl-3 pr-1.5 rounded-full text-[13px] font-semibold flex items-center gap-1 bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-200';
  const cell = 'h-9 w-full rounded-lg bg-slate-100 dark:bg-slate-900/70 px-2 text-[14px] text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-400/50 placeholder:text-slate-400 tabular-nums';

  return (
    <GlassSheet
      title={groupId ? 'Варианты модели' : 'Товар с вариантами'}
      subtitle={combos.length ? `${enabledCount} из ${combos.length} вариантов` : 'Размер, цвет, память'}
      onClose={onClose}
      cancelLabel="Отмена"
      action={{ label: saving ? 'Сохраняем…' : 'Готово', onClick: save, disabled: saving }}
    >
      {close => (
        <div className="space-y-6">
          <SheetSection title="Модель">
            <SheetField label="Название без размера и цвета">
              <input value={base} onChange={e => setBase(e.target.value)} placeholder="Кроссовки Air Max" className={sheetInputClass} />
            </SheetField>
            <SheetField label="Категория">
              <input value={category} onChange={e => setCategory(e.target.value)} placeholder="Обувь" className={sheetInputClass} />
            </SheetField>
            <div className="grid grid-cols-2 divide-x divide-slate-100 dark:divide-slate-700/70">
              <SheetField label="Цена продажи">
                <input value={price} onChange={e => setPrice(e.target.value)} inputMode="decimal" placeholder="0" className={sheetInputClass} />
              </SheetField>
              <SheetField label="Цена закупа">
                <input value={buyPrice} onChange={e => setBuyPrice(e.target.value)} inputMode="decimal" placeholder="—" className={sheetInputClass} />
              </SheetField>
            </div>
          </SheetSection>

          <SheetSection title="Характеристики" hint="Значения можно вводить через запятую: S, M, L, XL">
            {options.map((o, idx) => (
              <div key={o.key} className="px-4 py-3 space-y-2.5">
                <div className="flex items-center gap-2">
                  <input value={o.name} onChange={e => setOptions(list => list.map(x => (x.key === o.key ? { ...x, name: e.target.value } : x)))}
                         placeholder="Характеристика" className="flex-1 min-w-0 bg-transparent outline-none text-[16px] font-semibold text-slate-900 dark:text-white placeholder:text-slate-300" />
                  {options.length > 1 && (
                    <button type="button" onClick={() => setOptions(list => list.filter(x => x.key !== o.key))}
                            className="shrink-0 text-[13px] font-semibold text-rose-500">Убрать</button>
                  )}
                </div>
                {!o.name.trim() && (
                  <div className="flex flex-wrap gap-1.5">
                    {OPTION_PRESETS.filter(pr => !usedNames.has(pr.name.toLowerCase())).map(pr => (
                      <button key={pr.name} type="button"
                              onClick={() => setOptions(list => list.map(x => (x.key === o.key ? { ...x, name: pr.name } : x)))}
                              className="h-7 px-2.5 rounded-full bg-slate-100 dark:bg-slate-700 text-[12px] font-semibold text-slate-600 dark:text-slate-300">{pr.name}</button>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {o.values.map(v => (
                    <span key={v} className={chip}>
                      {v}
                      <button type="button" onClick={() => removeValue(o.key, v)} aria-label={`Убрать ${v}`}
                              className="w-5 h-5 rounded-full flex items-center justify-center text-indigo-400 hover:text-rose-500">×</button>
                    </span>
                  ))}
                  <input value={o.input}
                         onChange={e => {
                           const v = e.target.value;
                           if (/[,;]/.test(v)) addValues(o.key, v);
                           else setOptions(list => list.map(x => (x.key === o.key ? { ...x, input: v } : x)));
                         }}
                         onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addValues(o.key, o.input); } }}
                         onBlur={() => addValues(o.key, o.input)}
                         placeholder={o.values.length ? '+ ещё' : idx === 0 && /разм/i.test(o.name) ? '42, 43, 44' : 'Добавить значение'}
                         className="h-8 min-w-[110px] flex-1 px-2 rounded-full bg-transparent outline-none text-[14px] text-slate-900 dark:text-white placeholder:text-slate-400" />
                </div>
                {o.values.length === 0 && OPTION_PRESETS.find(pr => pr.name === o.name.trim())?.values.length ? (
                  <button type="button" onClick={() => addValues(o.key, OPTION_PRESETS.find(pr => pr.name === o.name.trim())!.values.join(','))}
                          className="text-[12px] font-semibold text-indigo-600 dark:text-indigo-300">
                    Подставить: {OPTION_PRESETS.find(pr => pr.name === o.name.trim())!.values.join(', ')}
                  </button>
                ) : null}
              </div>
            ))}
            {options.length < 3 && (
              <button type="button" onClick={() => setOptions(list => [...list, { key: uid(), name: '', values: [], input: '' }])}
                      className="w-full px-4 py-3 text-left text-[15px] font-semibold text-indigo-600 dark:text-indigo-300">
                + Ещё характеристика
              </button>
            )}
          </SheetSection>

          {combos.length > 0 && (
            <section>
              <div className="px-4 pb-1.5 flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Варианты · {enabledCount}
                </span>
                {/* Один и тот же начальный остаток всем новым — частый случай */}
                <span className="flex items-center gap-1.5">
                  <input value={fillQty} onChange={e => setFillQty(e.target.value)} inputMode="decimal" placeholder="Кол-во"
                         className="w-16 h-7 rounded-lg bg-white dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 px-2 text-[13px] outline-none text-slate-900 dark:text-white" />
                  <button type="button" disabled={fillQty === ''}
                          onClick={() => setRows(r => {
                            const next = { ...r };
                            combos.forEach(a => {
                              const m = matchExisting(a);
                              if (!m) next[keyOf(a)] = { ...rowOf(keyOf(a), m), qty: fillQty };
                            });
                            return next;
                          })}
                          className="h-7 px-2.5 rounded-lg bg-indigo-600 text-white text-[12px] font-bold disabled:opacity-40">всем</button>
                </span>
              </div>
              <div className="rounded-2xl bg-white dark:bg-slate-800 ring-1 ring-slate-200/70 dark:ring-slate-700/70 divide-y divide-slate-100 dark:divide-slate-700/70 overflow-hidden">
                {combos.map(attrs => {
                  const key = keyOf(attrs);
                  const match = matchExisting(attrs);
                  const row = rowOf(key, match);
                  const label = cleanOptions.map(o => attrs[o.name]).join(' · ');
                  return (
                    <div key={key} className={`px-3 py-2.5 ${row.enabled ? '' : 'opacity-50'}`}>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setRow(key, match, { enabled: !row.enabled })}
                                aria-label={row.enabled ? 'Выключить вариант' : 'Включить вариант'}
                                className={`shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[13px] font-bold transition-colors ${row.enabled
                                  ? 'bg-indigo-600 text-white' : 'ring-2 ring-slate-300 dark:ring-slate-600 text-transparent'}`}>✓</button>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14px] font-bold text-slate-900 dark:text-white truncate">{label}</span>
                          <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                            {match ? (match.isArchived ? 'был в архиве' : `на складе ${match.stock || 0}`) : 'новый'}
                          </span>
                        </span>
                        <input value={row.price} onChange={e => setRow(key, match, { price: e.target.value })} disabled={!row.enabled}
                               inputMode="decimal" placeholder={price || 'Цена'} aria-label="Цена" className={`${cell} !w-24 text-right`} />
                        {!match && (
                          <input value={row.qty} onChange={e => setRow(key, match, { qty: e.target.value })} disabled={!row.enabled}
                                 inputMode="decimal" placeholder="0" aria-label="Количество" className={`${cell} !w-14 text-center`} />
                        )}
                      </div>
                      {row.enabled && (
                        <div className="mt-1.5 pl-8 grid grid-cols-2 gap-1.5">
                          <input value={row.sku} onChange={e => setRow(key, match, { sku: e.target.value })}
                                 placeholder="Артикул — авто" aria-label="Артикул" className={`${cell} !h-8 text-[12px]`} />
                          <input value={row.barcode} onChange={e => setRow(key, match, { barcode: e.target.value })}
                                 placeholder="Штрихкод" aria-label="Штрихкод" inputMode="numeric" className={`${cell} !h-8 text-[12px]`} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="px-4 pt-1.5 text-[12px] leading-snug text-slate-400 dark:text-slate-500">
                Пустая цена — общая цена модели. Количество — начальный остаток нового варианта; дальше остаток меняют приход и продажи.
              </p>
            </section>
          )}

          {warehouses.length > 1 && combos.some(a => !matchExisting(a)) && (
            <SheetSection title="Склад">
              <SheetField label="Куда положить новые варианты">
                <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className={sheetInputClass}>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </SheetField>
            </SheetSection>
          )}

          {error && <p className="px-4 text-sm font-semibold text-rose-600 dark:text-rose-400">{error}</p>}

          <button type="button" onClick={() => save(close)} disabled={saving}
                  className="w-full h-12 rounded-2xl bg-indigo-600 text-white font-bold disabled:opacity-40 active:scale-[0.99] transition">
            {saving ? 'Сохраняем…' : groupId ? 'Сохранить варианты' : enabledCount ? `Создать ${enabledCount} ${variantsWord(enabledCount)}` : 'Создать'}
          </button>
        </div>
      )}
    </GlassSheet>
  );
};

export default VariantGroupSheet;
