import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Account, AppSettings, Customer, Product, RetailSale, Sale, StockLocation, StockMovement, Supplier, User } from '../types';
import { DEFAULT_WAREHOUSE_ID } from '../types';
import { applyStockDelta, listedWarehouses, stockOnWarehouse, stockInScope, scopeStockMovements } from '../src/utils';
import { api } from '../services/api';
import { compressImageFile } from '../src/imageCompress';
import TopBarBack from './TopBarBack';
import ModalPortal from './ModalPortal';
import Sheet from './Sheet';
import TabPill from './TabPill';
import WarehouseOps from './WarehouseOps';
import ProductDetails from './ProductDetails';
import SubPage from './transitions/SubPage';
import BarcodeScanner, { ScanButton, type ScanOutcome } from './BarcodeScanner';
import LabelPrintSheet from './LabelPrintSheet';
import { barcodeOwner, extractProductCode, findProductByCode, generateInternalBarcodes, normalizeBarcode, productMatchesQuery } from '../src/barcode';
import { useBarcodeScanInput } from '../src/barcodeWedge';
import { scanBeep } from '../src/scanFeedback';

interface WarehouseProps {
  products: Product[];
  movements: StockMovement[];
  warehouses: StockLocation[];
  suppliers: Supplier[];
  accounts: Account[];
  /** Для карточки товара: его история — это чеки и накладные */
  retailSales?: RetailSale[];
  customers?: Customer[];
  employees?: User[];
  /** Договоры рассрочки — карточке товара, чтобы показать отгрузку по договору */
  contracts?: Sale[];
  appSettings?: AppSettings;
  user?: User | null;
  onSelectCustomer?: (id: string) => void;
  onAcceptPayment?: (sale: RetailSale) => void;
  onUpdateSale?: (sale: RetailSale) => Promise<void> | void;
  onUpdateStockDoc?: (movements: StockMovement[]) => Promise<void> | void;
  /** Проведение складского документа: движения и обновлённые остатки разом */
  onPostBatch: (movements: StockMovement[], products: Product[]) => Promise<void> | void;
  onSaveWarehouse: (w: StockLocation) => Promise<void> | void;
  onDeleteWarehouse: (id: string) => Promise<void> | void;
  onSaveProduct: (product: Product) => Promise<void> | void;
  onDeleteProduct: (id: string) => Promise<void> | void;
  onAddMovement: (movement: StockMovement) => Promise<void> | void;
  onBack: () => void;
  currency?: string;
  /**
   * Склады сотрудника. null — без ограничений. Остатки и история показываются
   * только по ним; список warehouses приходит уже отобранным.
   */
  warehouseScope?: string[] | null;
}

const emptyForm = {
  name: '', sku: '', price: '', buyPrice: '', category: '', unit: 'шт',
  minStock: '', description: '', images: [] as string[],
  /** Куда положить товар: склад начального остатка */
  warehouseId: '',
  /** Начальный остаток — только у нового товара, дальше остаток правят движения */
  stock: '',
  /** Дополнительные штрихкоды — второй и дальше. Основной стоит в поле barcodeDraft */
  barcodes: [] as string[],
  /** Основной штрихкод — то, что видно в поле «Штрихкод» */
  barcodeDraft: '',
};

const num = (v: string) => {
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const money = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 2 });

const MOVEMENT_LABELS: Record<StockMovement['type'], string> = {
  IN: 'Приход',
  SALE: 'Продажа',
  WRITE_OFF: 'Списание',
  RETURN: 'Возврат',
  CORRECTION: 'Корректировка',
  TRANSFER: 'Перемещение',
};

/**
 * Склад.
 *
 * Остаток здесь — не просто число в карточке товара, а следствие движений:
 * приход, продажа, списание, возврат, корректировка. Поле Product.stock
 * остаётся быстрым снимком для списков, но каждое его изменение сопровождается
 * записью движения. Без истории остаток невозможно объяснить, а именно на нём
 * сходятся все споры о недостаче.
 */
const Warehouse: React.FC<WarehouseProps> = ({
  products, movements, warehouses, suppliers, accounts,
  retailSales = [], customers = [], employees = [], contracts = [], appSettings, user,
  onSelectCustomer, onAcceptPayment, onUpdateSale, onUpdateStockDoc, onAddDocLines,
  onSaveProduct, onDeleteProduct, onAddMovement, onPostBatch,
  onSaveWarehouse, onDeleteWarehouse, onBack, warehouseScope = null,
}) => {
  // Три разных занятия под одной крышей: каталог (что у нас за товар),
  // операции (движение) и сами склады (где лежит). Их разделение — не
  // украшение: в каталоге правят описание и картинки, в операциях считают
  // количество, и смешанные в одном списке они мешали бы друг другу.
  const [section, setSection] = useState<'catalog' | 'ops' | 'places'>('catalog');
  const [whForm, setWhForm] = useState<Partial<StockLocation> | null>(null);
  // Карточка товара и меню его действий — два разных состояния: меню
  // открывается по троеточию и не должно уводить с экрана.
  const [openProductId, setOpenProductId] = useState<string | null>(null);
  const [menuProduct, setMenuProduct] = useState<Product | null>(null);
  // Выбор нескольких товаров. Пустой набор — обычный режим: пока ничего не
  // выбрано, каталог ведёт себя как всегда, и лишнего состояния у экрана нет.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkCategory, setBulkCategory] = useState<string | null>(null);
  // Перетаскивание — отдельный режим, а не жест поверх списка: длинное нажатие
  // уже занято выбором, а таскать строки во время обычной прокрутки нельзя.
  const [reorder, setReorder] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const rowRects = useRef<Record<string, DOMRect>>({});
  const longPress = useRef<{ timer: number; x: number; y: number; id: string } | null>(null);

  const selection = selectedIds.length > 0;

  // Выбор и перетаскивание принадлежат каталогу: уходя на операции или склады,
  // человек оставляет их позади, и вернуться в наполовину выбранный список —
  // неприятная неожиданность.
  useEffect(() => {
    if (section !== 'catalog') { setSelectedIds([]); setReorder(false); setDragId(null); }
  }, [section]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('ALL');
  // Склад, на который смотрим. 'ALL' — весь магазин: остатки складываются,
  // как и раньше. Выбранный склад меняет и цифры, и состав списка — иначе
  // «на складе 12» значило бы одно в каталоге и другое на самом складе.
  const [warehouseFilter, setWarehouseFilter] = useState<string>('ALL');
  const [showArchived, setShowArchived] = useState(false);
  const [onlyLow, setOnlyLow] = useState(false);

  const [editing, setEditing] = useState<Product | null>(null);
  // Видимость карточки держим отдельным флагом: сравнивать состояние формы
  // с пустым образцом нельзя — «новый товар» ставит ровно ту же ссылку,
  // и окно не открывалось бы.
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Камера открыта ради одного из двух: найти товар в каталоге или вписать код в карточку.
  const [scanFor, setScanFor] = useState<'catalog' | 'form' | null>(null);
  // Отсканировали код, которого в каталоге нет, — предлагаем завести товар с ним.
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const [labelIds, setLabelIds] = useState<string[] | null>(null);
  // Товар заводят прямо из прихода по отсканированному коду: после сохранения
  // он должен сам встать в документ, ради которого его и заводили.
  const [opsPending, setOpsPending] = useState<string | null>(null);
  const [opsAdded, setOpsAdded] = useState<{ productId: string; at: number } | null>(null);

  // Лист выбора склада: складов бывает много, и в строку чипсами они не влезали.
  const [whPickerOpen, setWhPickerOpen] = useState(false);
  const [movementFor, setMovementFor] = useState<Product | null>(null);
  const [movementWh, setMovementWh] = useState<string>(DEFAULT_WAREHOUSE_ID);
  const [movementType, setMovementType] = useState<StockMovement['type']>('IN');
  const [movementQty, setMovementQty] = useState('');
  const [movementPrice, setMovementPrice] = useState('');
  const [movementNote, setMovementNote] = useState('');


  const categories = useMemo(
    () => Array.from(new Set(products.map(p => p.category).filter(Boolean))).sort(),
    [products]
  );

  // Основной склад показываем карточкой всегда, даже если ничего не заводили:
  // товары до появления складов лежат именно на нём, и без карточки к нему
  // нельзя было бы привязать счёт. Список общий для всего приложения —
  // операции, права сотрудника и журнал должны видеть ровно эти склады.
  const shownWarehouses = useMemo(
    () => listedWarehouses(warehouses, warehouseScope),
    [warehouses, warehouseScope]
  );

  // Основной склад заводим по-настоящему, как любой другой: подставная карточка
  // существовала только на экране и не давала ни переименовать его, ни привязать
  // счёт, ни выбрать в чужих списках. Пишем один раз, с постоянным id, — повтор
  // с другого устройства перезапишет ту же запись, а не создаст вторую.
  // Сотрудник склады не заводит: запись ему всё равно запретит сервер.
  const canManageWarehouses = !warehouseScope && user?.role !== 'employee' && user?.role !== 'investor';
  useEffect(() => {
    if (!canManageWarehouses) return;
    // Архивный основной не воскрешаем: его убрали намеренно.
    if (warehouses.some(w => w.id === DEFAULT_WAREHOUSE_ID)) return;
    if (warehouses.some(w => w.isMain && !w.isArchived)) return;
    void onSaveWarehouse({
      id: DEFAULT_WAREHOUSE_ID,
      userId: '',
      name: 'Основной склад',
      isMain: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouses, canManageWarehouses]);

  // Куда по умолчанию кладут товар: основной склад, а если его нет — первый
  // доступный. Сотруднику подставляем его склад, чужой ему всё равно закрыт.
  const defaultWarehouseId = useMemo(
    () => shownWarehouses.find(w => w.isMain)?.id || shownWarehouses[0]?.id || DEFAULT_WAREHOUSE_ID,
    [shownWarehouses]
  );

  // Товары, заведённые до складов, лежат в ячейке «main»: если основным назначен
  // свой склад, это его остатки — иначе товар пропал бы из разрезов по складам.
  const stockAt = (p: Product, warehouseId: string) => stockOnWarehouse(p, warehouseId, shownWarehouses);

  // Товар относится к складу, если на нём есть остаток или заведена ячейка этого
  // склада. Ноль после продажи — тоже принадлежность: товар кончился, но он
  // здешний, и пропадать из списка ему незачем.
  const onWarehouse = (p: Product, warehouseId: string) =>
    stockAt(p, warehouseId) !== 0
    || !!(p.warehouseStocks && Object.prototype.hasOwnProperty.call(p.warehouseStocks, warehouseId));

  // Пометку «основной» не вешаем на склад, который так и называется: «Основной
  // склад · основной» — подпись ни о чём.
  const whLabel = (w: StockLocation) =>
    w.isMain && !/основн/i.test(w.name) ? `${w.name} · основной` : w.name;

  // Остаток в пределах складов сотрудника: продавцу одной точки общий остаток по
  // всем складам ничего не говорит — продать он может только то, что у него.
  // Выбран конкретный склад — считаем по нему одному.
  const stockOf = (p: Product) =>
    warehouseFilter === 'ALL' ? stockInScope(p, warehouseScope) : stockAt(p, warehouseFilter);

  const isLow = (p: Product) =>
    p.minStock !== undefined && p.minStock !== null && stockOf(p) <= p.minStock;

  const visible = useMemo(() => {
    return products
      .filter(p => (showArchived ? p.isArchived : !p.isArchived))
      .filter(p => category === 'ALL' || p.category === category)
      .filter(p => !onlyLow || isLow(p))
      // На складе показываем то, что на нём числится: чужой товар в списке только
      // мешает искать, а свой с нулём остатка — по-прежнему свой.
      .filter(p => warehouseFilter === 'ALL' || onWarehouse(p, warehouseFilter))
      .filter(p => productMatchesQuery(p, search))
      // Расставленные вручную идут первыми и в своём порядке, остальные —
      // по алфавиту следом. Так один переставленный товар не выбрасывает
      // остальные в случайный порядок.
      .sort((a, b) => {
        const ao = a.sortOrder, bo = b.sortOrder;
        if (ao !== undefined && bo !== undefined) return ao - bo;
        if (ao !== undefined) return -1;
        if (bo !== undefined) return 1;
        return a.name.localeCompare(b.name, 'ru');
      });
  }, [products, search, category, showArchived, onlyLow, warehouseFilter, warehouseScope]);

  // В режиме перетаскивания порядок держим локально: строки должны следовать за
  // пальцем сразу, не дожидаясь ответа сервера на каждое движение.
  const listed = useMemo(() => {
    if (!reorder || order.length === 0) return visible;
    const byId = new Map(visible.map(p => [p.id, p]));
    const ordered = order.map(id => byId.get(id)).filter(Boolean) as Product[];
    const rest = visible.filter(p => !order.includes(p.id));
    return [...ordered, ...rest];
  }, [visible, reorder, order]);

  const totals = useMemo(() => {
    const live = products.filter(p => !p.isArchived);
    return {
      items: live.length,
      units: live.reduce((s, p) => s + stockOf(p), 0),
      cost: live.reduce((s, p) => s + stockOf(p) * (p.buyPrice || 0), 0),
      low: live.filter(isLow).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, warehouseScope, warehouseFilter]);

  const warehouseStats = (warehouseId: string) => {
    const live = products.filter(p => !p.isArchived);
    const onIt = live.filter(p => stockAt(p, warehouseId) !== 0);
    return {
      items: onIt.length,
      units: onIt.reduce((s, p) => s + stockAt(p, warehouseId), 0),
      cost: onIt.reduce((s, p) => s + stockAt(p, warehouseId) * (p.buyPrice || 0), 0),
    };
  };

  const toggleSelected = (id: string) =>
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const startLongPress = (id: string, x: number, y: number) => {
    cancelLongPress();
    longPress.current = {
      id, x, y,
      timer: window.setTimeout(() => {
        longPress.current = null;
        // Отклик телефона на удержание: без него непонятно, сработало ли.
        if (navigator.vibrate) navigator.vibrate(12);
        setSelectedIds(prev => prev.includes(id) ? prev : [...prev, id]);
      }, 450),
    };
  };

  const cancelLongPress = () => {
    if (longPress.current) window.clearTimeout(longPress.current.timer);
    longPress.current = null;
  };

  // Палец, поехавший вбок или вниз, — это прокрутка, а не удержание.
  const moveLongPress = (x: number, y: number) => {
    const s2 = longPress.current;
    if (!s2) return;
    if (Math.abs(x - s2.x) > 10 || Math.abs(y - s2.y) > 10) cancelLongPress();
  };

  /** Массовое действие. Ошибку показываем, но остальные товары всё равно
      дообрабатываем: половина применённого лучше, чем откат всего из-за одного. */
  const runBulk = async (fn: (p: Product) => Promise<void> | void) => {
    setBulkBusy(true);
    let failed = 0;
    for (const id of selectedIds) {
      const p2 = products.find(x => x.id === id);
      if (!p2) continue;
      try { await fn(p2); } catch { failed++; }
    }
    setBulkBusy(false);
    setSelectedIds([]);
    if (failed) setError(`Не удалось обработать ${failed} товар(ов)`);
  };

  const enterReorder = () => {
    setSelectedIds([]);
    setOrder(visible.map(p => p.id));
    setReorder(true);
  };

  /**
   * Сохраняем порядок. Пишем только те карточки, у которых номер действительно
   * изменился: переставили один товар — уходит одна запись, а не весь каталог.
   */
  const saveOrder = async () => {
    setBulkBusy(true);
    try {
      for (let i = 0; i < listed.length; i++) {
        const p2 = listed[i];
        const next = i * 1000;
        if (p2.sortOrder === next) continue;
        await onSaveProduct({ ...p2, sortOrder: next, updatedAt: new Date().toISOString() });
      }
    } finally {
      setBulkBusy(false);
      setReorder(false);
      setOrder([]);
    }
  };

  // Перетаскивание: меряем строки один раз в начале жеста. Мерить на каждом
  // движении — значит просить браузер о layout по сорок раз в секунду.
  const startDrag = (id: string) => {
    const rects: Record<string, DOMRect> = {};
    listed.forEach(p2 => {
      const el = document.getElementById(`prow_${p2.id}`);
      if (el) rects[p2.id] = el.getBoundingClientRect();
    });
    rowRects.current = rects;
    setOrder(listed.map(p2 => p2.id));
    setDragId(id);
  };

  const dragOver = (y: number) => {
    if (!dragId) return;
    const ids = order.length ? order : listed.map(p2 => p2.id);
    const from = ids.indexOf(dragId);
    if (from < 0) return;
    // Целевую позицию ищем по исходным серединам строк: список под пальцем
    // уже переставлен, и мерить его заново — гоняться за собственным хвостом.
    const centers = ids.map(id => {
      const r = rowRects.current[id];
      return r ? r.top + r.height / 2 : Number.MAX_SAFE_INTEGER;
    });
    let to = centers.findIndex(c => y < c);
    if (to < 0) to = ids.length - 1;
    if (to === from) return;
    const next = [...ids];
    next.splice(to, 0, next.splice(from, 1)[0]);
    setOrder(next);
  };

  const openNew = (barcode?: string) => {
    setEditing(null);
    // Склад берём тот, на который сейчас смотрят, иначе основной: товар заводят
    // там, где он лежит перед глазами.
    setForm({
      ...emptyForm,
      barcodeDraft: barcode || '',
      warehouseId: warehouseFilter === 'ALL' ? defaultWarehouseId : warehouseFilter,
    });
    setError(null);
    setShowForm(true);
  };
  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      name: p.name, sku: p.sku || '', price: String(p.price ?? ''),
      buyPrice: String(p.buyPrice ?? ''), category: p.category || '',
      unit: p.unit || 'шт', minStock: p.minStock === undefined ? '' : String(p.minStock),
      description: p.description || '', images: p.images || [],
      barcodes: (p.barcodes || []).slice(1), barcodeDraft: p.barcodes?.[0] || '',
      warehouseId: warehouseFilter === 'ALL' ? defaultWarehouseId : warehouseFilter,
      stock: '',
    });
    setError(null);
    setShowForm(true);
  };

  /**
   * Код в карточку товара. Код другого товара не принимаем и называем, чей он:
   * один код на два товара — и касса пробьёт не тот.
   * @returns текст ошибки или null
   */
  const addFormBarcode = (raw: string): string | null => {
    if (!normalizeBarcode(raw)) return null;
    // Ссылку в поле штрихкода не пускаем и при ручном вводе — это не код товара.
    const extracted = extractProductCode(raw);
    if ('error' in extracted) return extracted.error;
    const { code } = extracted;
    const owner = barcodeOwner(products, code, editing?.id);
    if (owner) return `Штрихкод ${code} уже у товара «${owner.name}»`;
    // Код встаёт прямо в поле «Штрихкод» — туда, куда человек смотрит после скана.
    // Раньше он уходил строкой под поле, а само поле оставалось пустым, и казалось,
    // что скан не сработал.
    setForm(f => ({ ...f, barcodeDraft: code, barcodes: f.barcodes.filter(c => c !== code) }));
    return null;
  };

  // Внутренний код для товара без заводского штрихкода: развес, своё производство.
  const generateFormBarcode = () => {
    const [code] = generateInternalBarcodes(
      [...products, { ...(editing || {}), id: '__form__', barcodes: [form.barcodeDraft, ...form.barcodes].filter(Boolean) } as Product], 1);
    setForm(f => ({ ...f, barcodeDraft: code }));
  };

  /** Код из каталога: известный товар открываем, неизвестный предлагаем завести. */
  const handleCatalogCode = (code: string): ScanOutcome => {
    const match = findProductByCode(products, code);
    if (match) {
      setUnknownCode(null);
      if (match.product.isArchived) setShowArchived(true);
      setOpenProductId(match.product.id);
      return { tone: 'ok', title: match.product.name };
    }
    setUnknownCode(code);
    return { tone: 'warn', title: 'Товара с таким кодом нет', subtitle: code, close: true };
  };

  // Ручной сканер. В открытую карточку он вписывает код, в каталоге ищет товар.
  // На вкладке операций коды принимает сама операция — у неё свой обработчик.
  useBarcodeScanInput(code => {
    if (showForm) { setError(addFormBarcode(code)); return; }
    scanBeep(handleCatalogCode(code).tone);
  }, (section === 'catalog' || showForm) && !labelIds && !scanFor);

  const addImages = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const file of Array.from(files).slice(0, 5)) {
        const { file: compressed } = await compressImageFile(file);
        urls.push(await api.uploadProductImage(compressed));
      }
      setForm(f => ({ ...f, images: [...f.images, ...urls].slice(0, 5) }));
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Не удалось загрузить картинку');
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!form.name.trim()) { setError('Название обязательно'); return; }
    // Основной код — из поля «Штрихкод», дополнительные — из списка под ним.
    let draftCode = '';
    if (normalizeBarcode(form.barcodeDraft)) {
      const extracted = extractProductCode(form.barcodeDraft);
      if ('error' in extracted) { setError(extracted.error); return; }
      draftCode = extracted.code;
    }
    // Ссылка, сохранённая раньше, пока камера принимала QR, тоже не проходит:
    // человек увидит ошибку и уберёт её из списка кодов.
    const badSaved = form.barcodes.find(c => 'error' in extractProductCode(c));
    if (badSaved) { setError(`«${badSaved}» — ссылка, а не штрихкод. Уберите её из списка кодов.`); return; }
    const codes = Array.from(new Set([draftCode, ...form.barcodes].filter(Boolean)));
    for (const code of codes) {
      const owner = barcodeOwner(products, code, editing?.id);
      if (owner) { setError(`Штрихкод ${code} уже у товара «${owner.name}»`); return; }
    }
    setSaving(true);
    try {
      const product: Product = {
        id: editing?.id || crypto.randomUUID(),
        userId: editing?.userId || '',
        name: form.name.trim(),
        price: num(form.price),
        category: form.category.trim() || 'Общее',
        // Остаток правится только движениями — здесь берём текущий, чтобы
        // редактирование карточки не превращалось в тихую корректировку склада.
        stock: editing?.stock ?? 0,
        // Раскладку по складам переносим как есть: карточку пересобирают заново,
        // и без этой строки правка названия стирала принадлежность складам —
        // остаток схлопывался в общий и «переезжал» на основной склад.
        warehouseStocks: editing?.warehouseStocks,
        sku: form.sku.trim() || undefined,
        barcodes: codes.length ? codes : undefined,
        buyPrice: form.buyPrice === '' ? undefined : num(form.buyPrice),
        unit: form.unit.trim() || 'шт',
        images: form.images.length ? form.images : undefined,
        minStock: form.minStock === '' ? undefined : num(form.minStock),
        description: form.description.trim() || undefined,
        isArchived: editing?.isArchived,
        updatedAt: new Date().toISOString(),
      };
      // Начальный остаток нового товара — это приход, а не тихая правка числа:
      // без движения остаток нечем объяснить, и склад перестаёт сходиться.
      const startQty = editing ? 0 : num(form.stock);
      const warehouseId = form.warehouseId || defaultWarehouseId;
      // Ячейку выбранного склада заводим всегда, даже с нулём: выбранный склад —
      // это «где товар живёт», а не только «сколько привезли». Без ячейки товар
      // не принадлежал никакому складу и был виден лишь при «Всех складах».
      await onSaveProduct(editing ? product : applyStockDelta(product, warehouseId, startQty));
      if (startQty > 0) {
        await onAddMovement({
          id: crypto.randomUUID(),
          userId: product.userId,
          productId: product.id,
          type: 'IN',
          quantity: startQty,
          unitPrice: product.buyPrice,
          warehouseId,
          note: 'Начальный остаток',
          date: new Date().toISOString(),
        });
      }
      // Только что заведённый товар должен быть виден: если смотрят на другой склад,
      // переводим взгляд на тот, куда его положили. Иначе сохранение выглядит как
      // «товар не сохранился».
      if (!editing) {
        setWarehouseFilter(prev => (prev === 'ALL' ? prev : warehouseId));
      }
      if (opsPending && codes.includes(opsPending)) setOpsAdded({ productId: product.id, at: Date.now() });
      setOpsPending(null);
      setShowForm(false);
      setEditing(null);
      setForm(emptyForm);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Не удалось сохранить товар');
    } finally {
      setSaving(false);
    }
  };

  const submitMovement = async () => {
    if (!movementFor) return;
    const qty = num(movementQty);
    if (qty <= 0) { setError('Количество должно быть больше нуля'); return; }
    // Приход и возврат увеличивают остаток, списание и продажа уменьшают.
    const sign = movementType === 'IN' || movementType === 'RETURN' ? 1 : -1;
    // Корректировку считаем от остатка выбранного склада, а не от общего по
    // магазину: иначе пересчёт одной точки увёл бы в минус остальные.
    const warehouseId = movementWh || defaultWarehouseId;
    const delta = movementType === 'CORRECTION' ? qty - stockAt(movementFor, warehouseId) : sign * qty;

    setSaving(true);
    try {
      await onAddMovement({
        id: crypto.randomUUID(),
        userId: movementFor.userId,
        productId: movementFor.id,
        type: movementType,
        quantity: delta,
        unitPrice: movementPrice === '' ? undefined : num(movementPrice),
        note: movementNote.trim() || undefined,
        warehouseId,
        date: new Date().toISOString(),
      });
      await onSaveProduct(applyStockDelta(movementFor, warehouseId, delta));
      setMovementFor(null); setMovementQty(''); setMovementPrice(''); setMovementNote('');
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Не удалось записать движение');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200 outline-none focus:border-indigo-400';
  // Подпись над полем карточки товара. Название внутри поля пропадало, как только
  // в нём появлялось значение, — и в заполненной карточке было не понять, где
  // цена закупа, а где продажи.
  const labelCls = 'block text-[11px] font-bold text-slate-500 dark:text-slate-400 px-0.5';

  const openProduct = products.find(p => p.id === openProductId) || null;

  return (
    <>
    <div className="space-y-4 pb-10">
      <div className="flex items-center gap-3">
        {/* На десктопе стрелка не нужна: раздел виден в сайдбаре, и уходить
            из него некуда — это не подстраница, а сам раздел. */}
        <TopBarBack onClick={onBack} hideOnDesktop />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">Склад</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {totals.items} позиций · {money(totals.units)} ед. · закуп {money(totals.cost)} ₽
          </p>
        </div>
        {/* Действие принадлежит вкладке: на операциях добавлять нечего, а
            «+ Склад» на своей вкладке живёт там же, где «+ Товар» на своей —
            рука ищет кнопку в одном месте. */}
        {section === 'catalog' && (
          <button onClick={() => openNew()}
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-sm active:scale-95 transition-transform shrink-0">
            + Товар
          </button>
        )}
        {section === 'places' && (
          <button onClick={() => setWhForm({ name: '', address: '' })}
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-sm active:scale-95 transition-transform shrink-0">
            + Склад
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="relative flex p-1 rounded-[26px] bg-white/60 dark:bg-slate-800/60 border border-white/70 dark:border-slate-700 shadow-sm">
        <TabPill index={section === 'catalog' ? 0 : section === 'ops' ? 1 : 2} count={3} pad={4} />
        {([['catalog', 'Товары'], ['ops', 'Операции'], ['places', 'Склады']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setSection(id)}
                  className={`relative z-10 flex-1 min-w-0 py-2.5 text-sm font-bold rounded-xl transition-colors ${
                    section === id ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-500'
                  }`}>{label}</button>
        ))}
      </div>

      {section === 'ops' && (
        <WarehouseOps
          products={products}
          movements={movements}
          warehouses={shownWarehouses}
          warehouseId={warehouseFilter === 'ALL' ? undefined : warehouseFilter}
          onWarehouseChange={setWarehouseFilter}
          suppliers={suppliers}
          onPost={onPostBatch}
          showCents={appSettings?.showCents}
          onCreateProduct={code => { setOpsPending(code); openNew(code); }}
          addedProduct={opsAdded}
          paused={showForm || !!scanFor}
        />
      )}

      {section === 'places' && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Операции идут на выбранный склад, а выручка магазина — на привязанный к нему счёт.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {shownWarehouses.map(w => {
              const account = accounts.find(a => a.id === w.accountId);
              const stat = warehouseStats(w.id);
              return (
                <div key={w.id}
                     className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-3.5 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-slate-800 dark:text-white truncate">{w.name}</p>
                    {w.isMain && (
                      <span className="shrink-0 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-[10px] font-bold uppercase tracking-wide">
                        Основной
                      </span>
                    )}
                  </div>

                  {/* Цифры в строку: их три, и каждая в своей коробке растягивала
                      карточку в высоту, ничего не добавляя к пониманию. */}
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {stat.items} поз. · {money(stat.units)} ед. · {money(stat.cost)} ₽ в закупе
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {w.address || 'Адрес не указан'}
                  </p>
                  <p className="text-xs truncate">
                    <span className="text-slate-400">Счёт: </span>
                    <span className={account ? 'font-semibold text-slate-700 dark:text-slate-200' : 'text-slate-400'}>
                      {account ? account.name : 'не привязан'}
                    </span>
                  </p>

                  <div className="flex gap-2 pt-0.5">
                    <button onClick={() => setWhForm(w)}
                            className="flex-1 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold">
                      Изменить
                    </button>
                    {!w.isMain && (
                      <button onClick={async () => {
                                if (!window.confirm(`Удалить склад «${w.name}»? Остатки на нём останутся в истории движений.`)) return;
                                await onDeleteWarehouse(w.id);
                              }}
                              className="px-3 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 text-xs font-bold">
                        Удалить
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {section === 'catalog' && (<>
      {/* Склад — первым делом: он задаёт, про какие остатки вообще весь экран.
          Отдельной карточкой, а не рядом чипсов: складов бывает десяток, и
          строка чипсов превращалась в ленту, где текущий склад ещё поискать. */}
      {!selection && !reorder && shownWarehouses.length > 1 && (
        <button type="button" onClick={() => setWhPickerOpen(true)}
                className="w-full flex items-center gap-3 p-3 pr-5 rounded-[28px] border border-indigo-100 dark:border-indigo-900/40 bg-white/70 dark:bg-slate-800/60 text-left active:scale-[0.99] transition-transform">
          <span className="shrink-0 w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-slate-900 flex items-center justify-center text-indigo-500 dark:text-indigo-300">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
              <path d="M7 12h10M7 15.5h10M7 19h10" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-indigo-500 dark:text-indigo-300">
              Текущий склад
            </span>
            <span className="block text-lg font-bold text-slate-800 dark:text-white truncate">
              {warehouseFilter === 'ALL'
                ? 'Все склады'
                : shownWarehouses.find(w => w.id === warehouseFilter)?.name || 'Все склады'}
            </span>
          </span>
          <svg className="shrink-0 text-slate-400" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="8 9 12 5 16 9" />
            <polyline points="16 15 12 19 8 15" />
          </svg>
        </button>
      )}

      {/* Панель выбора заменяет фильтры целиком: пока идёт выбор, человек
          занят другим делом, и поиск с категориями ему только мешают. */}
      {selection ? (
        <div className="sticky top-0 z-20 bg-white dark:bg-slate-800 rounded-2xl border border-indigo-200 dark:border-indigo-900/50 shadow-sm p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-bold text-slate-800 dark:text-white">Выбрано {selectedIds.length}</p>
            <div className="flex gap-2">
              <button onClick={() => setSelectedIds(listed.map(p => p.id))}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold">
                Все
              </button>
              <button onClick={() => setSelectedIds([])}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold">
                Снять
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button disabled={bulkBusy} onClick={() => setLabelIds(selectedIds)}
                    className="py-2 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300 text-xs font-bold disabled:opacity-50">
              Этикетки
            </button>
            <button disabled={bulkBusy} onClick={() => setBulkCategory('')}
                    className="py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold disabled:opacity-50">
              Категория
            </button>
            <button disabled={bulkBusy}
                    onClick={() => runBulk(p => onSaveProduct({ ...p, isArchived: !showArchived, updatedAt: new Date().toISOString() }))}
                    className="py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold disabled:opacity-50">
              {showArchived ? 'Вернуть' : 'В архив'}
            </button>
            <button disabled={bulkBusy}
                    onClick={() => {
                      if (!window.confirm(`Удалить ${selectedIds.length} товар(ов) без возможности восстановления?`)) return;
                      runBulk(p => onDeleteProduct(p.id));
                    }}
                    className="py-2 rounded-xl bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 text-xs font-bold disabled:opacity-50">
              Удалить
            </button>
          </div>
        </div>
      ) : reorder ? (
        <div className="sticky top-0 z-20 bg-white dark:bg-slate-800 rounded-2xl border border-indigo-200 dark:border-indigo-900/50 shadow-sm p-3 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Тяните за ручку слева, чтобы поменять порядок
          </p>
          <button disabled={bulkBusy} onClick={saveOrder}
                  className="shrink-0 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold disabled:opacity-50">
            {bulkBusy ? 'Сохраняем…' : 'Готово'}
          </button>
        </div>
      ) : null}

      {!selection && !reorder && (
      <div className="flex gap-2">
        <input value={search} onChange={e => setSearch(e.target.value)}
               placeholder="Название, артикул или штрихкод" className={inputCls} />
        <ScanButton onClick={() => setScanFor('catalog')} />
        <button onClick={enterReorder} aria-label="Порядок"
                className="shrink-0 px-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-300 text-lg">
          ⇅
        </button>
      </div>
      )}

      {unknownCode && !selection && !reorder && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 flex items-center gap-3">
          <p className="flex-1 min-w-0 text-sm text-amber-800 dark:text-amber-300">
            Товара со штрихкодом <span className="font-bold break-all">{unknownCode}</span> нет в каталоге
          </p>
          <button onClick={() => { const code = unknownCode; setUnknownCode(null); openNew(code); }}
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-bold">
            Создать
          </button>
          <button onClick={() => setUnknownCode(null)} aria-label="Скрыть"
                  className="shrink-0 font-bold text-amber-700 dark:text-amber-300 opacity-60">✕</button>
        </div>
      )}

      {!selection && !reorder && (
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setCategory('ALL')}
                className={`px-3.5 py-2 rounded-full text-xs font-bold ${category === 'ALL' ? 'glass-surface text-indigo-600 dark:text-indigo-300' : 'bg-white/60 dark:bg-slate-800/60 border border-white/70 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
          Все
        </button>
        {categories.map(c => (
          <button key={c} onClick={() => setCategory(c)}
                  className={`px-3.5 py-2 rounded-full text-xs font-bold ${category === c ? 'glass-surface text-indigo-600 dark:text-indigo-300' : 'bg-white/60 dark:bg-slate-800/60 border border-white/70 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
            {c}
          </button>
        ))}
        {totals.low > 0 && (
          <button onClick={() => setOnlyLow(v => !v)}
                  className={`px-3.5 py-2 rounded-full text-xs font-bold ${onlyLow ? 'bg-amber-500 text-white' : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800'}`}>
            Мало на складе · {totals.low}
          </button>
        )}
        <button onClick={() => setShowArchived(v => !v)}
                className={`px-3.5 py-2 rounded-full text-xs font-bold ${showArchived ? 'bg-slate-700 text-white' : 'bg-white/60 dark:bg-slate-800/60 border border-white/70 dark:border-slate-700 text-slate-500 dark:text-slate-400'}`}>
          Архив
        </button>
      </div>
      )}

      {listed.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">
          {products.length === 0
            ? 'Товаров пока нет. Добавьте первый.'
            : warehouseFilter !== 'ALL' && !search && category === 'ALL' && !onlyLow
            ? `На складе «${shownWarehouses.find(w => w.id === warehouseFilter)?.name || ''}» пока пусто — оприходуйте товар в операциях.`
            : 'Ничего не найдено.'}
        </p>
      ) : (
        <div className="grid gap-3"
             onPointerMove={e => { if (dragId) dragOver(e.clientY); }}
             onPointerUp={() => setDragId(null)}
             onPointerCancel={() => setDragId(null)}>
          {listed.map(p => {
            const checked = selectedIds.includes(p.id);
            return (
            <div key={p.id} id={`prow_${p.id}`}
                 onPointerDown={e => { if (!reorder && e.pointerType !== 'mouse') startLongPress(p.id, e.clientX, e.clientY); }}
                 onPointerMove={e => moveLongPress(e.clientX, e.clientY)}
                 onPointerUp={cancelLongPress}
                 onPointerCancel={cancelLongPress}
                 onContextMenu={e => { if (!reorder) { e.preventDefault(); toggleSelected(p.id); } }}
                 onClick={() => {
                   if (reorder) return;
                   if (selection) { toggleSelected(p.id); return; }
                   setOpenProductId(p.id);
                 }}
                 className={`bg-white dark:bg-slate-800 rounded-2xl border p-3 flex items-center gap-3 cursor-pointer transition-colors ${
                   dragId === p.id
                     ? 'border-indigo-500 shadow-lg opacity-90'
                     : checked
                     ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/30'
                     : 'border-slate-100 dark:border-slate-700 active:bg-slate-50 dark:active:bg-slate-700/50'
                 }`}>
              {reorder && (
                // Тянуть можно только за ручку: строка целиком осталась бы
                // конфликтовать с прокруткой списка.
                <span
                  onPointerDown={e => {
                    e.preventDefault(); e.stopPropagation();
                    // Захват указателя: палец может уехать за пределы ручки, а
                    // события должны продолжать приходить сюда — иначе строка
                    // «отцепляется» на первом же резком движении.
                    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                    startDrag(p.id);
                  }}
                  onPointerMove={e => { if (dragId) dragOver(e.clientY); }}
                  onPointerUp={() => setDragId(null)}
                  onPointerCancel={() => setDragId(null)}
                  className="shrink-0 w-8 h-10 flex items-center justify-center text-slate-400 text-lg cursor-grab touch-none select-none"
                  aria-label="Перетащить">⣿</span>
              )}

              {selection && (
                <span className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold ${
                  checked ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 dark:border-slate-600 text-transparent'
                }`}>✓</span>
              )}

              <div className="w-16 h-16 rounded-xl bg-slate-100 dark:bg-slate-700 overflow-hidden shrink-0 flex items-center justify-center">
                {p.images?.[0] ? (
                  <img src={p.images[0]} alt="" className="w-full h-full object-cover" loading="lazy" decoding="sync" draggable={false} />
                ) : (
                  <span className="text-slate-400 text-xl">📦</span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="font-bold text-slate-800 dark:text-white truncate">{p.name}</p>
                {/* Цена закупа из строки убрана: список открывают, чтобы найти
                    товар и вспомнить, почём он продаётся, — а закуп виден
                    посторонним через плечо. Он остался в карточке товара. */}
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {p.sku ? `${p.sku} · ` : ''}{money(p.price)} ₽
                </p>
                <p className={`text-xs font-bold mt-0.5 ${isLow(p) ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`}>
                  {money(stockOf(p))} {p.unit || 'шт'}
                  {isLow(p) ? ' · мало' : ''}
                </p>
              </div>

              {/* Три кнопки в строке съедали место у названия и цены — ради
                  действий, которые нужны не в каждой строке. Само нажатие на
                  товар теперь открывает карточку, а действия ушли под
                  троеточие. */}
              {!reorder && !selection && (
                <button onClick={e => { e.stopPropagation(); setMenuProduct(p); }}
                        aria-label="Действия"
                        className="shrink-0 w-9 h-9 rounded-lg text-slate-400 text-lg leading-none active:bg-slate-100 dark:active:bg-slate-700">
                  ⋮
                </button>
              )}
            </div>
            );
          })}
        </div>
      )}

      </>)}

      {/* Действия над товаром. Отдельным листом, а не рядом кнопок в строке:
          так строка остаётся про товар, а не про то, что с ним можно сделать. */}
      {menuProduct && (
        <ModalPortal onClose={() => setMenuProduct(null)}>
          <div className="fixed inset-0 z-modal flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm"
               onClick={() => setMenuProduct(null)}>
            <div className="bg-white dark:bg-slate-800 w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-2"
                 onClick={e => e.stopPropagation()}>
              <p className="px-4 pt-3 pb-2 text-sm font-bold text-slate-500 dark:text-slate-400 truncate">
                {menuProduct.name}
              </p>
              <button onClick={() => { const p2 = menuProduct; setMenuProduct(null); openEdit(p2); }}
                      className="w-full text-left px-4 py-3 rounded-xl font-semibold text-slate-700 dark:text-slate-200 active:bg-slate-50 dark:active:bg-slate-700">
                Редактировать
              </button>
              <button onClick={() => { const p2 = menuProduct; setMenuProduct(null); setMovementFor(p2); setMovementType('IN');
                setMovementWh(warehouseFilter === 'ALL' ? defaultWarehouseId : warehouseFilter); setError(null); }}
                      className="w-full text-left px-4 py-3 rounded-xl font-semibold text-slate-700 dark:text-slate-200 active:bg-slate-50 dark:active:bg-slate-700">
                Добавить в документ
              </button>
              <button onClick={() => { const p2 = menuProduct; setMenuProduct(null); setLabelIds([p2.id]); }}
                      className="w-full text-left px-4 py-3 rounded-xl font-semibold text-slate-700 dark:text-slate-200 active:bg-slate-50 dark:active:bg-slate-700">
                Печать этикетки
              </button>
              <button onClick={() => { const p2 = menuProduct; setMenuProduct(null); setOpenProductId(p2.id); }}
                      className="w-full text-left px-4 py-3 rounded-xl font-semibold text-slate-700 dark:text-slate-200 active:bg-slate-50 dark:active:bg-slate-700">
                История
              </button>
              {/* Архив и удаление — соседи по смыслу: и то и другое убирает товар
                  из работы, разница лишь в том, можно ли вернуть. В форме правки
                  им было не место: там правят карточку, а не судьбу товара. */}
              <button
                onClick={async () => {
                  const p2 = menuProduct;
                  setMenuProduct(null);
                  await onSaveProduct({ ...p2, isArchived: !p2.isArchived, updatedAt: new Date().toISOString() });
                }}
                className="w-full text-left px-4 py-3 rounded-xl font-semibold text-slate-700 dark:text-slate-200 active:bg-slate-50 dark:active:bg-slate-700">
                {menuProduct.isArchived ? 'Вернуть из архива' : 'В архив'}
              </button>
              <button
                onClick={async () => {
                  const p2 = menuProduct;
                  if (!window.confirm(`Удалить «${p2.name}» без возможности восстановления?`)) return;
                  setMenuProduct(null);
                  await onDeleteProduct(p2.id);
                }}
                className="w-full text-left px-4 py-3 rounded-xl font-semibold text-rose-600 dark:text-rose-400 active:bg-slate-50 dark:active:bg-slate-700">
                Удалить
              </button>
              <button onClick={() => setMenuProduct(null)}
                      className="w-full text-left px-4 py-3 rounded-xl font-semibold text-slate-400 active:bg-slate-50 dark:active:bg-slate-700">
                Отмена
              </button>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Категория для выбранных. Существующие списком, плюс поле для новой:
          заводить категорию отдельным экраном ради одного слова — лишний шаг. */}
      {bulkCategory !== null && (
        <ModalPortal onClose={() => setBulkCategory(null)}>
          <div className="fixed inset-0 z-modal flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm"
               onClick={() => setBulkCategory(null)}>
            <div className="bg-white dark:bg-slate-800 w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[75vh] flex flex-col"
                 onClick={e => e.stopPropagation()}>
              <div className="p-4 border-b border-slate-100 dark:border-slate-700 shrink-0">
                <h3 className="font-bold text-slate-800 dark:text-white mb-2">
                  Категория для {selectedIds.length} товар(ов)
                </h3>
                <input value={bulkCategory} onChange={e => setBulkCategory(e.target.value)}
                       placeholder="Новая категория" className={inputCls} />
              </div>
              <div className="overflow-y-auto p-2">
                {categories.map(c => (
                  <button key={c} onClick={() => setBulkCategory(c)}
                          className={`w-full text-left px-4 py-3 rounded-xl font-semibold active:bg-slate-50 dark:active:bg-slate-700 ${
                            bulkCategory === c ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-200'
                          }`}>
                    {c}
                  </button>
                ))}
              </div>
              <div className="p-4 border-t border-slate-100 dark:border-slate-700 flex gap-2">
                <button onClick={() => setBulkCategory(null)}
                        className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-sm">
                  Отмена
                </button>
                <button
                  disabled={bulkBusy || !bulkCategory.trim()}
                  onClick={async () => {
                    const value = bulkCategory.trim();
                    setBulkCategory(null);
                    await runBulk(p => onSaveProduct({ ...p, category: value, updatedAt: new Date().toISOString() }));
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm disabled:opacity-50">
                  Перенести
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Форма склада */}
      {whForm && (
        <ModalPortal>
          <div className="fixed inset-0 z-modal flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm"
               onClick={() => setWhForm(null)}>
            <div className="bg-white dark:bg-slate-800 w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 space-y-3"
                 onClick={e => e.stopPropagation()}>
              <h3 className="font-bold text-slate-800 dark:text-white">
                {whForm.id ? 'Склад' : 'Новый склад'}
              </h3>
              <input value={whForm.name || ''} onChange={e => setWhForm(prev => ({ ...prev, name: e.target.value }))}
                     placeholder="Название" className={inputCls} />
              <input value={whForm.address || ''} onChange={e => setWhForm(prev => ({ ...prev, address: e.target.value }))}
                     placeholder="Адрес" className={inputCls} />
              <div>
                <select value={whForm.accountId || ''} onChange={e => setWhForm(prev => ({ ...prev, accountId: e.target.value }))}
                        className={inputCls}>
                  <option value="">Счёт выручки не выбран</option>
                  {accounts.filter(a => !a.isArchived).map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                  Продажи с этого склада будут по умолчанию попадать на выбранный счёт.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={!!whForm.isMain}
                       onChange={e => setWhForm(prev => ({ ...prev, isMain: e.target.checked }))} />
                Основной склад
              </label>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setWhForm(null)}
                        className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-sm">
                  Отмена
                </button>
                <button
                  onClick={async () => {
                    if (!whForm.name?.trim()) { setError('Название склада обязательно'); return; }
                    await onSaveWarehouse({
                      id: whForm.id || crypto.randomUUID(),
                      userId: whForm.userId || '',
                      name: whForm.name.trim(),
                      address: whForm.address?.trim() || undefined,
                      accountId: whForm.accountId || undefined,
                      isMain: !!whForm.isMain,
                    });
                    setWhForm(null);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm">
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Модальное окно карточки */}
      {showForm && (
        <ModalPortal>
          <div className="fixed inset-0 z-modal flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm"
               onClick={() => { setShowForm(false); setEditing(null); setForm(emptyForm); }}>
            <div className="bg-white dark:bg-slate-800 w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[88vh] overflow-y-auto p-5 space-y-3"
                 onClick={e => e.stopPropagation()}>
              <h3 className="font-bold text-slate-800 dark:text-white">
                {editing ? 'Товар' : 'Новый товар'}
              </h3>

              <div className="flex gap-2 flex-wrap">
                {form.images.map((src, i) => (
                  <div key={src} className="relative w-20 h-20 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-600">
                    <img src={src} alt="" className="w-full h-full object-cover" />
                    <button
                      onClick={() => setForm(f => ({ ...f, images: f.images.filter((_, n) => n !== i) }))}
                      className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-slate-900/70 text-white text-xs leading-none">×</button>
                  </div>
                ))}
                {form.images.length < 5 && (
                  <label className="w-20 h-20 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 flex items-center justify-center text-slate-400 cursor-pointer">
                    {uploading ? '…' : '+'}
                    <input type="file" accept="image/*" multiple className="hidden"
                           onChange={e => addImages(e.target.files)} />
                  </label>
                )}
              </div>

              <label className="block">
                <span className={`${labelCls} mb-1`}>Название</span>
                <input value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Например, вода 0,5 л" className={inputCls} />
              </label>
              <div className="grid grid-cols-2 gap-x-2 gap-y-3">
                <label className="block min-w-0">
                  <span className={`${labelCls} mb-1`}>Артикул</span>
                  <input value={form.sku} onChange={e => setForm(prev => ({ ...prev, sku: e.target.value }))} placeholder="Необязательно" className={inputCls} />
                </label>
                <label className="block min-w-0">
                  <span className={`${labelCls} mb-1`}>Категория</span>
                  <input value={form.category} onChange={e => setForm(prev => ({ ...prev, category: e.target.value }))} placeholder="Общее" className={inputCls} list="warehouse-categories" />
                </label>
                {/* Закуп первым: товар заводят с накладной поставщика, и цену продажи
                    считают от закупа, а не наоборот. */}
                <label className="block min-w-0">
                  <span className={`${labelCls} mb-1`}>Цена закупа</span>
                  <input value={form.buyPrice} onChange={e => setForm(prev => ({ ...prev, buyPrice: e.target.value }))} placeholder="0" inputMode="decimal" className={inputCls} />
                </label>
                <label className="block min-w-0">
                  <span className={`${labelCls} mb-1`}>Цена продажи</span>
                  <input value={form.price} onChange={e => setForm(prev => ({ ...prev, price: e.target.value }))} placeholder="0" inputMode="decimal" className={inputCls} />
                </label>
                <label className="block min-w-0">
                  <span className={`${labelCls} mb-1`}>Ед. изм.</span>
                  <input value={form.unit} onChange={e => setForm(prev => ({ ...prev, unit: e.target.value }))} placeholder="шт" className={inputCls} />
                </label>
                <label className="block min-w-0">
                  <span className={`${labelCls} mb-1`}>Мин. остаток</span>
                  <input value={form.minStock} onChange={e => setForm(prev => ({ ...prev, minStock: e.target.value }))} placeholder="Не следить" inputMode="decimal" className={inputCls} />
                </label>
                {/* Новый товар сразу кладут на склад: указывать его отдельным
                    приходом после каждой карточки — лишний шаг, который все
                    забывают, и товар остаётся числиться нулём. */}
                {/* Склад спрашиваем, только когда их несколько: с одним складом
                    выбор из одного пункта — лишний вопрос. */}
                {!editing && shownWarehouses.length > 1 && (
                  <label className="block min-w-0">
                    <span className={`${labelCls} mb-1`}>Склад</span>
                    <select value={form.warehouseId || defaultWarehouseId}
                            onChange={e => setForm(prev => ({ ...prev, warehouseId: e.target.value }))}
                            className={inputCls}>
                      {shownWarehouses.map(w => (
                        <option key={w.id} value={w.id}>{whLabel(w)}</option>
                      ))}
                    </select>
                  </label>
                )}
                {!editing && (
                  <label className="block min-w-0">
                    <span className={`${labelCls} mb-1`}>Остаток</span>
                    <input value={form.stock} onChange={e => setForm(prev => ({ ...prev, stock: e.target.value }))}
                           placeholder="0" inputMode="decimal" className={inputCls} />
                  </label>
                )}
              </div>

              {/* Штрихкоды отдельно от артикула: артикул — внутреннее имя товара,
                  а штрихкодов у него бывает несколько, и по ним товар находят
                  касса и приход. */}
              <div className="space-y-2">
                {/* Не <label>: в строке ещё две кнопки, и нажатие на подпись не должно их задевать */}
                <span className={`${labelCls} -mb-1`}>Штрихкод</span>
                <div className="flex gap-2">
                  <input value={form.barcodeDraft}
                         onChange={e => setForm(prev => ({ ...prev, barcodeDraft: e.target.value }))}
                         onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setError(addFormBarcode(form.barcodeDraft)); } }}
                         onBlur={() => { if (form.barcodeDraft.trim()) setError(addFormBarcode(form.barcodeDraft)); }}
                         placeholder="Отсканируйте или введите" enterKeyHint="done" className={`${inputCls} tabular-nums`} />
                  <ScanButton onClick={() => setScanFor('form')} />
                  <button type="button" onClick={generateFormBarcode} title="Создать внутренний штрихкод"
                          className="shrink-0 px-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-xs font-bold text-slate-600 dark:text-slate-300 active:scale-95 transition-transform">
                    Создать
                  </button>
                </div>
                {/* Второй и следующие коды — у разных поставщиков или на групповой упаковке */}
                {form.barcodes.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="w-full text-[11px] text-slate-400 dark:text-slate-500">Дополнительные коды</span>
                    {form.barcodes.map(code => (
                      <span key={code}
                            className="inline-flex items-center gap-1 pl-3 pr-1 py-1 rounded-full bg-slate-100 dark:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 tabular-nums">
                        {code}
                        <button type="button" aria-label={`Убрать ${code}`}
                                onClick={() => setForm(f => ({ ...f, barcodes: f.barcodes.filter(c => c !== code) }))}
                                className="w-5 h-5 rounded-full text-slate-400 hover:text-rose-500 leading-none">×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Уже заведённые категории — нажатием. Набирать их заново значит
                  рано или поздно завести «Телефоны» и «телефоны» двумя разными
                  разделами каталога; новую по-прежнему можно просто напечатать. */}
              {categories.length > 0 && (
                <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-0.5 px-0.5">
                  <datalist id="warehouse-categories">
                    {categories.map(c => <option key={c} value={c} />)}
                  </datalist>
                  {categories.map(c => (
                    <button key={c} type="button"
                            onClick={() => setForm(prev => ({ ...prev, category: prev.category === c ? '' : c }))}
                            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${
                              form.category === c
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                            }`}>
                      {c}
                    </button>
                  ))}
                </div>
              )}
              <label className="block">
                <span className={`${labelCls} mb-1`}>Описание</span>
                <textarea value={form.description} onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                          placeholder="Необязательно" rows={2} className={inputCls} />
              </label>

              {/* Ошибка — прямо в карточке: строка ошибки экрана склада лежит под
                  окном, и человек не видел бы, почему «Сохранить» не сработало. */}
              {error && (
                <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
              )}

              {editing && (
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  Остаток здесь не меняется — только через движения, иначе история склада не сойдётся.
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={() => { setShowForm(false); setEditing(null); setForm(emptyForm); }}
                        className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-sm">
                  Отмена
                </button>
                <button disabled={saving} onClick={save}
                        className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm disabled:opacity-50">
                  Сохранить
                </button>
              </div>

            </div>
          </div>
        </ModalPortal>
      )}

      {/* Движение по складу */}
      {/* Выбор склада листом: имя склада целиком, с остатком — по нему и узнают
          нужный, а не по обрезанному чипу. */}
      {whPickerOpen && (
        <Sheet onClose={() => setWhPickerOpen(false)} className="w-full sm:max-w-md p-2">
          {(requestClose: () => void) => (
            <>
              <p className="px-4 pt-3 pb-2 text-sm font-bold text-slate-500 dark:text-slate-400">Склад</p>
              {[{ id: 'ALL', name: 'Все склады' } as StockLocation, ...shownWarehouses].map(w => {
                const active = warehouseFilter === w.id;
                const stat = w.id === 'ALL' ? null : warehouseStats(w.id);
                return (
                  <button key={w.id} type="button"
                          onClick={() => { setWarehouseFilter(w.id); requestClose(); }}
                          className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 ${
                            active ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'active:bg-slate-50 dark:active:bg-slate-700'
                          }`}>
                    <span className="min-w-0 flex-1">
                      <span className={`block font-semibold truncate ${active ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-200'}`}>
                        {whLabel(w)}
                      </span>
                      <span className="block text-xs text-slate-400">
                        {stat ? `${stat.items} поз. · ${money(stat.units)} ед.` : 'Остатки всех складов вместе'}
                      </span>
                    </span>
                    {active && <span className="shrink-0 text-indigo-600 dark:text-indigo-300 font-bold">✓</span>}
                  </button>
                );
              })}
            </>
          )}
        </Sheet>
      )}

      {movementFor && (
        <ModalPortal>
          <div className="fixed inset-0 z-modal flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm"
               onClick={() => setMovementFor(null)}>
            <div className="bg-white dark:bg-slate-800 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 space-y-3"
                 onClick={e => e.stopPropagation()}>
              <h3 className="font-bold text-slate-800 dark:text-white">{movementFor.name}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Сейчас на складе: {money(stockAt(movementFor, movementWh || defaultWarehouseId))} {movementFor.unit || 'шт'}
              </p>

              {/* Склад движения выбирают до количества: одно и то же число
                  означает разное на разных точках. */}
              {shownWarehouses.length > 1 && (
                <label className="block">
                  <span className={`${labelCls} mb-1`}>Склад</span>
                  <select value={movementWh || defaultWarehouseId} onChange={e => setMovementWh(e.target.value)} className={inputCls}>
                    {shownWarehouses.map(w => (
                      <option key={w.id} value={w.id}>{whLabel(w)}</option>
                    ))}
                  </select>
                </label>
              )}

              <div className="grid grid-cols-2 gap-2">
                {(['IN', 'WRITE_OFF', 'RETURN', 'CORRECTION'] as const).map(t => (
                  <button key={t} onClick={() => setMovementType(t)}
                          className={`py-2 rounded-xl text-xs font-bold ${movementType === t ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                    {MOVEMENT_LABELS[t]}
                  </button>
                ))}
              </div>

              <input value={movementQty} onChange={e => setMovementQty(e.target.value)} inputMode="decimal"
                     placeholder={movementType === 'CORRECTION' ? 'Фактический остаток' : 'Количество'} className={inputCls} />
              {movementType === 'IN' && (
                <input value={movementPrice} onChange={e => setMovementPrice(e.target.value)} inputMode="decimal"
                       placeholder="Цена закупа за единицу" className={inputCls} />
              )}
              <input value={movementNote} onChange={e => setMovementNote(e.target.value)}
                     placeholder="Комментарий" className={inputCls} />

              <div className="flex gap-2 pt-1">
                <button onClick={() => setMovementFor(null)}
                        className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-sm">
                  Отмена
                </button>
                <button disabled={saving} onClick={submitMovement}
                        className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-sm disabled:opacity-50">
                  Записать
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

    </div>

    {/* Карточка товара выезжает справа, как остальные страницы, и держит
        список смонтированным под собой — при возврате каталог остаётся на том
        же месте прокрутки. */}
    {openProduct && appSettings && (
      <SubPage onClose={() => setOpenProductId(null)}>
        {(close: () => void) => (
          <ProductDetails
            product={openProduct}
            movements={scopeStockMovements(movements, warehouseScope)}
            warehouseScope={warehouseScope}
            retailSales={retailSales}
            products={products}
            customers={customers}
            warehouses={shownWarehouses}
            suppliers={suppliers}
            accounts={accounts}
            employees={employees}
            contracts={contracts}
            appSettings={appSettings}
            user={user}
            onBack={close}
            // Форма правки — портал в body, поэтому ложится поверх карточки
            // товара. Закрывать карточку перед ней не нужно: человек правил
            // товар, а не уходил из него, и после сохранения должен остаться
            // там же.
            onEdit={p2 => openEdit(p2)}
            onSelectCustomer={onSelectCustomer}
            onAcceptPayment={onAcceptPayment}
            onUpdateSale={onUpdateSale}
            onUpdateStockDoc={onUpdateStockDoc}
            onAddDocLines={onAddDocLines}
            onPrintLabels={p2 => setLabelIds([p2.id])}
          />
        )}
      </SubPage>
    )}

    {scanFor && (
      <BarcodeScanner
        title={scanFor === 'form' ? 'Штрихкод товара' : 'Найти товар'}
        onClose={() => setScanFor(null)}
        onCode={code => {
          if (scanFor !== 'form') return handleCatalogCode(code);
          const problem = addFormBarcode(code);
          return problem
            ? { tone: 'error', title: problem }
            : { tone: 'ok', title: `Штрихкод ${normalizeBarcode(code)} добавлен` };
        }}
      />
    )}

    {labelIds && (
      <LabelPrintSheet
        products={products.filter(p => labelIds.includes(p.id))}
        allProducts={products}
        onSaveProduct={onSaveProduct}
        showCents={appSettings?.showCents}
        onClose={() => { setLabelIds(null); setSelectedIds([]); }}
      />
    )}
    </>
  );
};

export default Warehouse;
