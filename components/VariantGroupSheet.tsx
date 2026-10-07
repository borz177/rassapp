import React, { useMemo, useState } from 'react';
import type { Product, StockLocation, VariantOption } from '../types';
import GlassSheet, { SheetField, SheetSection, sheetInputClass } from './GlassSheet';
import ProductImage from './ProductImage';
import UnitPicker from './UnitPicker';
import { OPTION_PRESETS, combinations, variantName, variantsOf } from '../src/variants';
import { nextSku } from '../src/sku';
import { barcodeOwner, extractProductCode, generateInternalBarcodes, normalizeBarcode } from '../src/barcode';
import { DEFAULT_UNIT, isPackUnit } from '../src/units';
import { compressImageFile } from '../src/imageCompress';
import { api } from '../services/api';
import { appConfirm } from '../src/dialogs';

/**
 * Модель с вариантами: фото, характеристики (размер, цвет, память), их
 * значения и таблица вариантов — у каждого своя цена продажи и закупа,
 * остаток, артикул и штрихкод.
 *
 * Одна форма для новой модели, для правки и для превращения обычного товара
 * в модель (adopt): существующие варианты узнаются по значениям характеристик
 * и обновляются, новые сочетания заводятся товарами, выключенные и убранные —
 * уходят в архив (не удаляются: по ним есть продажи и движения склада).
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
  buy: string;
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

/** Общие фото модели — картинки варианта без его «фото по цвету» */
const modelImagesOf = (p?: Product): string[] =>
  (p?.images || []).filter(i => i !== p?.variantPhoto);

const VariantGroupSheet: React.FC<{
  products: Product[];
  /** Правка существующей модели */
  groupId?: string;
  /** Новая модель — поля из формы товара */
  seed?: Partial<Product>;
  /** Обычный товар, который становится первым вариантом новой модели */
  adopt?: Product;
  categories?: string[];
  warehouses: StockLocation[];
  defaultWarehouseId: string;
  onClose: () => void;
  onSave: (rows: VariantSaveRow[], warehouseId: string) => Promise<void>;
  /** Удалить модель целиком (все варианты) */
  onDeleteGroup?: (ids: string[]) => Promise<void>;
}> = ({ products, groupId, seed, adopt, categories = [], warehouses, defaultWarehouseId, onClose, onSave, onDeleteGroup }) => {
  const existing = useMemo(
    () => (groupId ? variantsOf(products, groupId) : adopt ? [adopt] : []),
    [products, groupId, adopt]);
  const first = existing.find(p => !p.isArchived) || existing[0];
  const source: Partial<Product> = first || seed || {};
  const oldModelImages = useMemo(() => modelImagesOf(first), [first]);

  const [base, setBase] = useState(first?.variantBase || first?.name || seed?.name || '');
  const [category, setCategory] = useState(source.category && source.category !== 'Общее' ? source.category : '');
  const [price, setPrice] = useState(source.price ? String(source.price) : '');
  const [buyPrice, setBuyPrice] = useState(source.buyPrice !== undefined ? String(source.buyPrice) : '');
  const [unit, setUnit] = useState({
    unit: source.unit || DEFAULT_UNIT,
    packSize: source.packSize ? String(source.packSize) : '',
    packUnit: source.packUnit || DEFAULT_UNIT,
  });
  const [minStock, setMinStock] = useState(source.minStock !== undefined ? String(source.minStock) : '');
  const [description, setDescription] = useState(source.description || '');
  const [images, setImages] = useState<string[]>(first ? oldModelImages : seed?.images || []);
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId);
  const [options, setOptions] = useState<OptionDraft[]>(() => {
    const src = first?.variantOptions;
    if (src?.length) return src.map(o => ({ key: uid(), name: o.name, values: [...o.values], orig: o.name, input: '' }));
    return [{ key: uid(), name: 'Размер', values: [], input: '' }];
  });
  const [photoBy, setPhotoBy] = useState<string>(() =>
    first?.variantPhotoBy || first?.variantOptions?.find(o => /цвет/i.test(o.name))?.name || '');
  const [valuePhotos, setValuePhotos] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    existing.forEach(p => {
      const v = p.variantPhotoBy ? p.variantAttrs?.[p.variantPhotoBy] : undefined;
      if (v && p.variantPhoto && !out[v]) out[v] = p.variantPhoto;
    });
    return out;
  });
  const [uploading, setUploading] = useState<string | null>(null);
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
  const photoOption = cleanOptions.find(o => o.name === photoBy);

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
    buy: match && match.buyPrice !== undefined && String(match.buyPrice) !== buyPrice ? String(match.buyPrice) : '',
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

  // ── фото ──
  const upload = async (files: FileList | null, target: 'model' | string) => {
    if (!files?.length) return;
    setUploading(target);
    setError(null);
    try {
      const list = Array.from(files).slice(0, target === 'model' ? 5 : 1);
      const urls: string[] = [];
      for (const file of list) {
        const { file: compressed } = await compressImageFile(file);
        urls.push(await api.uploadProductImage(compressed));
      }
      if (target === 'model') setImages(prev => [...prev, ...urls].slice(0, 5));
      else setValuePhotos(prev => ({ ...prev, [target]: urls[0] }));
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить фото');
    } finally {
      setUploading(null);
    }
  };

  // Внутренние штрихкоды всем включённым вариантам без своего кода — для этикеток
  const generateCodes = () => {
    const need = combos.filter(a => { const r = rowOf(keyOf(a), matchExisting(a)); return r.enabled && !normalizeBarcode(r.barcode); });
    if (!need.length) return;
    const taken = combos.map(a => rowOf(keyOf(a), matchExisting(a)).barcode).filter(Boolean);
    const codes = generateInternalBarcodes([...products, { id: '__draft__', barcodes: taken } as Product], need.length);
    setRows(r => {
      const next = { ...r };
      need.forEach((a, i) => { next[keyOf(a)] = { ...rowOf(keyOf(a), matchExisting(a)), barcode: codes[i] }; });
      return next;
    });
  };

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
    const pack = isPackUnit(unit.unit) && unit.packSize !== '';

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

      // Фото: своё фото по цвету первым, дальше общие фото модели. Вариант,
      // которому раньше вручную поставили свои картинки, не трогаем.
      const photo = photoOption ? valuePhotos[attrs[photoOption.name]] : undefined;
      const custom = !!match?.images?.some(i => !oldModelImages.includes(i) && i !== match.variantPhoto);
      const variantImages = custom ? match!.images
        : photo ? [photo, ...images.filter(i => i !== photo)]
        : images.length ? images : undefined;

      const product: Product = {
        ...(match || {}),
        id: match?.id || crypto.randomUUID(),
        userId: match?.userId || seed?.userId || '',
        name: variantName(base, cleanOptions, attrs),
        price: row.price !== '' ? num(row.price) : num(price),
        category: category.trim() || 'Общее',
        stock: match?.stock ?? 0,
        warehouseStocks: match?.warehouseStocks,
        sku,
        barcodes,
        buyPrice: row.buy !== '' ? num(row.buy) : buyPrice === '' ? match?.buyPrice : num(buyPrice),
        unit: unit.unit || DEFAULT_UNIT,
        packSize: pack ? num(unit.packSize) : undefined,
        packUnit: pack ? unit.packUnit || DEFAULT_UNIT : undefined,
        images: variantImages,
        variantPhoto: custom ? match?.variantPhoto : photo,
        variantPhotoBy: photo ? photoOption!.name : undefined,
        description: description.trim() || undefined,
        minStock: minStock === '' ? undefined : num(minStock),
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

  const removeGroup = async (close: () => void) => {
    if (!onDeleteGroup || !groupId) return;
    const sold = existing.some(p => (p.stock || 0) !== 0);
    const ok = await appConfirm({
      title: `Удалить модель «${base || first?.variantBase}»?`,
      message: `Удалятся все ${existing.length} ${variantsWord(existing.length)}.${sold ? ' На складе ещё есть остаток — если товар просто больше не продаёте, лучше отправить его в архив.' : ''} Продажи и движения склада в журнале останутся.`,
      confirmLabel: 'Удалить',
      destructive: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      await onDeleteGroup(existing.map(p => p.id));
      close();
    } finally {
      setSaving(false);
    }
  };

  const chip = 'h-8 pl-3 pr-1.5 rounded-full text-[13px] font-semibold flex items-center gap-1 bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-200';
  const cell = 'h-9 w-full rounded-lg bg-slate-100 dark:bg-slate-900/70 px-2 text-[14px] text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-400/50 placeholder:text-slate-400 tabular-nums';
  const tile = 'relative w-16 h-16 shrink-0 rounded-xl overflow-hidden ring-1 ring-slate-200 dark:ring-slate-700 bg-slate-100 dark:bg-slate-900';
  const addTile = 'w-16 h-16 shrink-0 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 flex flex-col items-center justify-center text-slate-400 cursor-pointer hover:border-indigo-400 hover:text-indigo-500 transition-colors';
  const catHints = categories.filter(c => c && c !== 'Общее' && c.toLowerCase() !== category.trim().toLowerCase()
    && (!category.trim() || c.toLowerCase().includes(category.trim().toLowerCase()))).slice(0, 8);

  return (
    <GlassSheet
      title={groupId ? 'Варианты модели' : adopt ? 'Добавить варианты' : 'Товар с вариантами'}
      subtitle={combos.length ? `${enabledCount} из ${combos.length} ${variantsWord(combos.length)}` : 'Размер, цвет, память'}
      onClose={onClose}
      cancelLabel="Отмена"
      action={{ label: saving ? 'Сохраняем…' : 'Готово', onClick: save, disabled: saving || !!uploading }}
    >
      {close => (
        <div className="space-y-6">
          {/* Фото модели — общие для всех вариантов */}
          <SheetSection title="Фото" plain>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {images.map((src, i) => (
                <div key={src} className={tile}>
                  <ProductImage src={src} className="w-full h-full object-cover" fallback={<span className="flex h-full items-center justify-center text-slate-400">📦</span>} />
                  {i === 0 && <span className="absolute bottom-0 inset-x-0 text-[9px] font-bold text-white bg-black/50 text-center py-0.5">обложка</span>}
                  <button type="button" onClick={() => setImages(list => list.filter(x => x !== src))} aria-label="Убрать фото"
                          className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-slate-900/70 text-white text-xs leading-none">×</button>
                </div>
              ))}
              {images.length < 5 && (
                <label className={addTile}>
                  {uploading === 'model' ? <span className="text-xs">…</span> : (
                    <>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" /><circle cx="12" cy="13" r="3" /></svg>
                      <span className="text-[10px] font-semibold mt-0.5">Фото</span>
                    </>
                  )}
                  <input type="file" accept="image/*" multiple className="hidden" onChange={e => { upload(e.target.files, 'model'); e.target.value = ''; }} />
                </label>
              )}
            </div>
          </SheetSection>

          <SheetSection title="Модель">
            <SheetField label="Название без размера и цвета">
              <input value={base} onChange={e => setBase(e.target.value)} placeholder="Кроссовки Air Max" className={sheetInputClass} />
            </SheetField>
            <div className="px-4 py-2.5">
              <span className="block text-[12px] font-medium text-slate-500 dark:text-slate-400">Категория</span>
              <input value={category} onChange={e => setCategory(e.target.value)} placeholder="Обувь" className={sheetInputClass} />
              {catHints.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {catHints.map(c => (
                    <button key={c} type="button" onClick={() => setCategory(c)}
                            className="h-7 px-2.5 rounded-full bg-slate-100 dark:bg-slate-700 text-[12px] font-semibold text-slate-600 dark:text-slate-300">{c}</button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 divide-x divide-slate-100 dark:divide-slate-700/70">
              <SheetField label="Цена продажи">
                <input value={price} onChange={e => setPrice(e.target.value)} inputMode="decimal" placeholder="0" className={sheetInputClass} />
              </SheetField>
              <SheetField label="Цена закупа">
                <input value={buyPrice} onChange={e => setBuyPrice(e.target.value)} inputMode="decimal" placeholder="—" className={sheetInputClass} />
              </SheetField>
            </div>
            <div className="px-4 py-2.5">
              <UnitPicker unit={unit.unit} packSize={unit.packSize} packUnit={unit.packUnit}
                          onChange={next => setUnit(next)}
                          labelClassName="block text-[12px] font-medium text-slate-500 dark:text-slate-400 mb-1"
                          inputClassName="w-full h-10 px-3 rounded-xl bg-slate-100 dark:bg-slate-900/70 text-[15px] text-slate-900 dark:text-white outline-none" />
            </div>
            <SheetField label="Мало на складе, если меньше" hint="Для каждого варианта отдельно — покажет, какой размер заканчивается">
              <input value={minStock} onChange={e => setMinStock(e.target.value)} inputMode="decimal" placeholder="Не следить" className={sheetInputClass} />
            </SheetField>
            <SheetField label="Описание">
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="Материал, гарантия…"
                        className={`${sheetInputClass} resize-none`} />
            </SheetField>
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
                              onClick={() => {
                                setOptions(list => list.map(x => (x.key === o.key ? { ...x, name: pr.name } : x)));
                                if (/цвет/i.test(pr.name) && !photoBy) setPhotoBy(pr.name);
                              }}
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

          {/* Фото по значению: одно фото на цвет — сразу всем его размерам */}
          {cleanOptions.length > 0 && (
            <SheetSection title="Фото по характеристике"
                          hint={photoOption ? `Фото каждого значения «${photoOption.name}» встанет обложкой всем его вариантам` : 'Например, своё фото у каждого цвета'}>
              <div className="px-4 py-3 space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {[{ name: '' }, ...cleanOptions].map(o => (
                    <button key={o.name || '__none'} type="button" onClick={() => setPhotoBy(o.name)}
                            className={`h-8 px-3 rounded-full text-[13px] font-semibold transition-colors ${photoBy === o.name
                              ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                              : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                      {o.name || 'Общие для всех'}
                    </button>
                  ))}
                </div>
                {photoOption && (
                  <div className="flex gap-3 overflow-x-auto pb-1">
                    {photoOption.values.map(v => (
                      <div key={v} className="shrink-0 w-16 text-center">
                        {valuePhotos[v] ? (
                          <div className={tile}>
                            <ProductImage src={valuePhotos[v]} className="w-full h-full object-cover" fallback={<span />} />
                            <button type="button" onClick={() => setValuePhotos(m => { const n = { ...m }; delete n[v]; return n; })}
                                    aria-label={`Убрать фото ${v}`}
                                    className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-slate-900/70 text-white text-xs leading-none">×</button>
                          </div>
                        ) : (
                          <label className={addTile}>
                            {uploading === v ? <span className="text-xs">…</span> : <span className="text-xl leading-none">+</span>}
                            <input type="file" accept="image/*" className="hidden" onChange={e => { upload(e.target.files, v); e.target.value = ''; }} />
                          </label>
                        )}
                        <span className="block mt-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 truncate">{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </SheetSection>
          )}

          {combos.length > 0 && (
            <section>
              <div className="px-4 pb-1.5 flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[12px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Варианты · {enabledCount}
                </span>
                <span className="flex items-center gap-1.5">
                  <button type="button" onClick={generateCodes}
                          className="h-7 px-2.5 rounded-lg bg-white dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 text-[12px] font-semibold text-slate-600 dark:text-slate-300">
                    Штрихкоды
                  </button>
                  {/* Один и тот же начальный остаток всем новым — частый случай */}
                  {combos.some(a => !matchExisting(a)) && (
                    <>
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
                    </>
                  )}
                </span>
              </div>
              <div className="rounded-2xl bg-white dark:bg-slate-800 ring-1 ring-slate-200/70 dark:ring-slate-700/70 divide-y divide-slate-100 dark:divide-slate-700/70 overflow-hidden">
                {combos.map(attrs => {
                  const key = keyOf(attrs);
                  const match = matchExisting(attrs);
                  const row = rowOf(key, match);
                  const label = cleanOptions.map(o => attrs[o.name]).join(' · ');
                  const photo = (photoOption && valuePhotos[attrs[photoOption.name]]) || images[0];
                  return (
                    <div key={key} className={`px-3 py-2.5 ${row.enabled ? '' : 'opacity-50'}`}>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setRow(key, match, { enabled: !row.enabled })}
                                aria-label={row.enabled ? 'Выключить вариант' : 'Включить вариант'}
                                className={`shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[13px] font-bold transition-colors ${row.enabled
                                  ? 'bg-indigo-600 text-white' : 'ring-2 ring-slate-300 dark:ring-slate-600 text-transparent'}`}>✓</button>
                        <span className="w-8 h-8 shrink-0 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-900 flex items-center justify-center">
                          <ProductImage src={photo} className="w-full h-full object-cover" fallback={<span className="text-[11px]">📦</span>} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14px] font-bold text-slate-900 dark:text-white truncate">{label}</span>
                          <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                            {match ? (match.isArchived ? 'был в архиве' : `на складе ${match.stock || 0}`) : 'новый'}
                          </span>
                        </span>
                        <input value={row.price} onChange={e => setRow(key, match, { price: e.target.value })} disabled={!row.enabled}
                               inputMode="decimal" placeholder={price || 'Цена'} aria-label="Цена продажи" className={`${cell} !w-[84px] text-right`} />
                        {!match && (
                          <input value={row.qty} onChange={e => setRow(key, match, { qty: e.target.value })} disabled={!row.enabled}
                                 inputMode="decimal" placeholder="0" aria-label="Количество" className={`${cell} !w-12 text-center`} />
                        )}
                      </div>
                      {row.enabled && (
                        <div className="mt-1.5 pl-8 grid grid-cols-3 gap-1.5">
                          <input value={row.buy} onChange={e => setRow(key, match, { buy: e.target.value })} inputMode="decimal"
                                 placeholder={buyPrice ? `Закуп ${buyPrice}` : 'Закуп'} aria-label="Цена закупа" className={`${cell} !h-8 text-[12px]`} />
                          <input value={row.sku} onChange={e => setRow(key, match, { sku: e.target.value })}
                                 placeholder="Артикул" aria-label="Артикул" className={`${cell} !h-8 text-[12px]`} />
                          <input value={row.barcode} onChange={e => setRow(key, match, { barcode: e.target.value })}
                                 placeholder="Штрихкод" aria-label="Штрихкод" inputMode="numeric" className={`${cell} !h-8 text-[12px]`} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="px-4 pt-1.5 text-[12px] leading-snug text-slate-400 dark:text-slate-500">
                Пустые цены — общие цены модели, пустой артикул проставится сам. Количество — начальный остаток нового варианта; дальше остаток меняют приход и продажи.
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

          <div className="space-y-2">
            <button type="button" onClick={() => save(close)} disabled={saving || !!uploading}
                    className="w-full h-12 rounded-2xl bg-indigo-600 text-white font-bold disabled:opacity-40 active:scale-[0.99] transition">
              {saving ? 'Сохраняем…' : groupId ? 'Сохранить варианты' : enabledCount ? `Создать ${enabledCount} ${variantsWord(enabledCount)}` : 'Создать'}
            </button>
            {groupId && onDeleteGroup && (
              <button type="button" onClick={() => removeGroup(close)} disabled={saving}
                      className="w-full h-11 rounded-2xl text-rose-600 dark:text-rose-400 font-semibold text-sm disabled:opacity-40">
                Удалить модель
              </button>
            )}
          </div>
        </div>
      )}
    </GlassSheet>
  );
};

export default VariantGroupSheet;
