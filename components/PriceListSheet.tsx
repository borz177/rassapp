import React, { useMemo, useState } from 'react';
import GlassSheet, { SheetSection, SheetField, SheetToggle, SheetSegmented, sheetInputClass } from './GlassSheet';
import type { Product } from '../types';
import { priceListPdfBlob, priceListFileName, type PriceListLayout } from '../src/priceListPdf';
import { saveContractPdf } from '../src/contractPdf';
import { unitOf } from '../src/units';
import { appAlert } from '../src/dialogs';

/**
 * Прайс-лист: какие товары и как показать — и готовый PDF, чтобы отправить
 * клиенту или распечатать.
 *
 * Выбор запоминается на устройстве: прайс обычно отправляют часто и одинаковым,
 * и каждый раз заново выключать остатки и вписывать примечание — лишняя работа.
 */

interface Props {
  /** Товары каталога без архива */
  products: Product[];
  /** Отмеченные в каталоге — можно сделать прайс только из них */
  selectedIds: string[];
  stockOf: (p: Product) => number;
  companyName?: string;
  phone?: string;
  onClose: () => void;
}

const PREFS_KEY = 'finuchet_price_list';
type Prefs = { title: string; note: string; layout: PriceListLayout; showStock: boolean; showSku: boolean; inStockOnly: boolean };
const DEFAULTS: Prefs = { title: 'Прайс-лист', note: '', layout: 'grid', showStock: false, showSku: false, inStockOnly: true };
const readPrefs = (): Prefs => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return DEFAULTS; }
};

const PriceListSheet: React.FC<Props> = ({ products, selectedIds, stockOf, companyName, phone, onClose }) => {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs(p => ({ ...p, [k]: v }));
  const [source, setSource] = useState<'all' | 'selected'>(selectedIds.length > 0 ? 'selected' : 'all');
  const categories = useMemo(
    () => ([...new Set(products.map(p => p.category).filter(Boolean))] as string[]).sort((a, b) => a.localeCompare(b, 'ru')),
    [products]);
  const [cats, setCats] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  // Порядок прайса: по категориям, внутри — по названию. Клиент ищет «диваны»,
  // а не «то, что завели последним».
  const items = useMemo(() => products
    .filter(p => source === 'all' || selectedIds.includes(p.id))
    .filter(p => cats.length === 0 || cats.includes(p.category))
    .filter(p => !prefs.inStockOnly || stockOf(p) > 0)
    .filter(p => (Number(p.price) || 0) > 0)
    .sort((a, b) => (a.category || '').localeCompare(b.category || '', 'ru') || a.name.localeCompare(b.name, 'ru')),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [products, source, selectedIds, cats, prefs.inStockOnly]);

  const withPhoto = items.filter(p => p.images?.[0]).length;

  const make = async (close: () => void) => {
    if (!items.length || busy) return;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* не критично */ }
    setBusy('Готовим…');
    try {
      const blob = await priceListPdfBlob(items, {
        title: prefs.title.trim() || 'Прайс-лист',
        note: prefs.note.trim() || undefined,
        companyName, phone,
        layout: prefs.layout,
        showStock: prefs.showStock,
        showSku: prefs.showSku,
        stockOf,
        unitOf: p => unitOf(p.unit),
      }, setBusy);
      await saveContractPdf(blob, priceListFileName(prefs.title.trim()));
      close();
    } catch (e) {
      console.error('Прайс-лист:', e);
      await appAlert({ title: 'Не получилось', message: 'Не удалось собрать PDF. Попробуйте ещё раз.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <GlassSheet
      title="Прайс-лист"
      subtitle={`${items.length} ${items.length === 1 ? 'товар' : 'товаров'} в PDF${prefs.layout !== 'table' && withPhoto < items.length && items.length ? ` · с фото ${withPhoto}` : ''}`}
      onClose={onClose}
      cancelLabel="Отмена"
      action={{ label: busy || 'Создать PDF', onClick: make, disabled: !items.length || !!busy }}
    >
      <div className="space-y-6">
        <SheetSection>
          <SheetField label="Заголовок">
            <input className={sheetInputClass} value={prefs.title} onChange={e => set('title', e.target.value)}
                   placeholder="Прайс-лист" maxLength={60} />
          </SheetField>
          <SheetField label="Примечание под заголовком">
            <input className={sheetInputClass} value={prefs.note} onChange={e => set('note', e.target.value)}
                   placeholder="Например: рассрочка без переплаты до 12 месяцев" maxLength={140} />
          </SheetField>
        </SheetSection>

        <SheetSection title="Вид">
          <div className="px-4 py-3">
            <SheetSegmented value={prefs.layout} onChange={v => set('layout', v)}
                            options={[{ id: 'grid', label: 'Карточки' }, { id: 'list', label: 'Список' }, { id: 'table', label: 'Таблица' }]} />
            <p className="mt-2 text-[12px] text-slate-500 dark:text-slate-400">
              {prefs.layout === 'grid' ? 'До 9 товаров на странице, крупные фото — как витрина.'
                : prefs.layout === 'list' ? 'До 12 товаров на странице с фото — компактно, когда товаров много.'
                : 'Как в 1С: артикул, наименование, цена, по категориям. Без фото, текст в PDF настоящий — его можно скопировать и перевести в Excel или Word.'}
            </p>
          </div>
        </SheetSection>

        <SheetSection title="Какие товары">
          {selectedIds.length > 0 && (
            <div className="px-4 py-3">
              <SheetSegmented value={source} onChange={setSource}
                              options={[{ id: 'selected', label: `Отмеченные (${selectedIds.length})` }, { id: 'all', label: 'Весь каталог' }]} />
            </div>
          )}
          <SheetToggle label="Только в наличии" checked={prefs.inStockOnly} onChange={v => set('inStockOnly', v)} tone="indigo" />
          {categories.length > 1 && (
            <div className="px-4 py-3">
              <p className="text-[13px] text-slate-500 dark:text-slate-400 mb-2">Категории {cats.length ? '' : '— все'}</p>
              <div className="flex flex-wrap gap-2">
                {categories.map(c => {
                  const on = cats.includes(c);
                  return (
                    <button key={c} type="button"
                            onClick={() => setCats(list => on ? list.filter(x => x !== c) : [...list, c])}
                            className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors ${on
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </SheetSection>

        <SheetSection title="Показывать" hint="Цена закупа и маржа в прайс не попадают никогда.">
          <SheetToggle label="Остаток на складе" description="«В наличии: 5 шт» или «под заказ»"
                       checked={prefs.showStock} onChange={v => set('showStock', v)} tone="indigo" />
          <SheetToggle label="Артикул" description={prefs.layout === 'table' ? 'Отдельной колонкой' : undefined}
                       checked={prefs.showSku} onChange={v => set('showSku', v)} tone="indigo" />
        </SheetSection>

        {!items.length && (
          <p className="px-1 text-[13px] text-rose-600 dark:text-rose-400">
            Под условия не подходит ни один товар с ценой. Выключите «Только в наличии» или выберите другие категории.
          </p>
        )}
      </div>
    </GlassSheet>
  );
};

export default PriceListSheet;
