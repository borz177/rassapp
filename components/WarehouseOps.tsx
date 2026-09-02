import React, { useMemo, useState } from 'react';
import type { Product, StockLocation, StockMovement, Supplier } from '../types';
import { DEFAULT_WAREHOUSE_ID } from '../types';
import { stockAtWarehouse as stockAt, applyStockDelta as withDelta } from '../src/utils';
import ModalPortal from './ModalPortal';

type OpTab = 'IN' | 'TRANSFER' | 'WRITE_OFF' | 'INVENTORY';

interface WarehouseOpsProps {
  products: Product[];
  /** Нужны, чтобы продолжить нумерацию документов, а не начать её заново */
  movements: StockMovement[];
  warehouses: StockLocation[];
  suppliers: Supplier[];
  /** Проводит документ целиком: движения и обновлённые остатки одной операцией */
  onPost: (movements: StockMovement[], products: Product[]) => Promise<void> | void;
  showCents?: boolean;
}

const money = (v: number, cents = false) =>
  v.toLocaleString('ru-RU', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });

const num = (v: string) => {
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const input = 'w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200 outline-none focus:border-indigo-400';

const TABS: { id: OpTab; label: string }[] = [
  { id: 'IN', label: 'Приход' },
  { id: 'TRANSFER', label: 'Перемещение' },
  { id: 'WRITE_OFF', label: 'Списание' },
  { id: 'INVENTORY', label: 'Инвентаризация' },
];

const WRITE_OFF_REASONS = ['Порча', 'Брак', 'Потеря', 'Недостача', 'Другое'];

/**
 * Складские операции: приход от поставщика, перемещение, списание,
 * инвентаризация.
 *
 * Всё проводится документом, а не по одной строке: товар принимают накладной,
 * а не по штуке, и общий batchId позволяет потом увидеть, что именно пришло
 * одной поставкой. Пока документ не проведён, ничего не меняется — очередь
 * можно править и отменить.
 *
 * Инвентаризация устроена иначе прочих: вводят не движение, а фактический
 * остаток, а разницу система считает сама. Просить человека посчитать
 * недостачу — верный способ получить ошибку в самом важном месте.
 */
const WarehouseOps: React.FC<WarehouseOpsProps> = ({
  products, movements, warehouses, suppliers, onPost, showCents = false,
}) => {
  const liveWarehouses = useMemo(() => {
    const live = warehouses.filter(w => !w.isArchived);
    return live.length ? live : [{ id: DEFAULT_WAREHOUSE_ID, userId: '', name: 'Основной склад', isMain: true }];
  }, [warehouses]);

  const [tab, setTab] = useState<OpTab>('IN');
  const [docNumber, setDocNumber] = useState('');
  const [fromWh, setFromWh] = useState(liveWarehouses.find(w => w.isMain)?.id || liveWarehouses[0].id);
  const [toWh, setToWh] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');

  // Очередь документа: id товара → количество и цена
  const [batch, setBatch] = useState<Record<string, { qty: number; cost: number }>>({});
  const [docOpen, setDocOpen] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [docDate, setDocDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState(WRITE_OFF_REASONS[0]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  const [picking, setPicking] = useState<Product | null>(null);
  const [pickQty, setPickQty] = useState('1');
  const [pickCost, setPickCost] = useState('0');

  // Инвентаризация пишется корректировками — тип движения у неё другой, чем
  // имя вкладки. Держим соответствие в одном месте: разойдись оно, документы
  // считались бы по одному признаку, а писались по другому.
  const movementTypeFor = (t: OpTab): StockMovement['type'] =>
    t === 'IN' ? 'IN' : t === 'TRANSFER' ? 'TRANSFER' : t === 'WRITE_OFF' ? 'WRITE_OFF' : 'CORRECTION';

  /**
   * Следующий номер документа этого вида. Считаем документы, а не движения:
   * приход из двадцати позиций — одна накладная, а не двадцать.
   */
  const nextDocNumber = useMemo(() => {
    const type = movementTypeFor(tab);
    const docs = new Set<string>();
    movements.forEach(m => { if (m.type === type) docs.add(m.batchId || m.id); });
    return String(docs.size + 1).padStart(4, '0');
  }, [movements, tab]);

  const categories = useMemo(
    () => Array.from(new Set(products.filter(p => !p.isArchived).map(p => p.category).filter(Boolean))).sort(),
    [products]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter(p => !p.isArchived)
      .filter(p => category === 'ALL' || p.category === category)
      .filter(p => !q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [products, category, search]);

  const batchIds = Object.keys(batch);
  const batchTotal = batchIds.reduce((s, id) => s + batch[id].qty * batch[id].cost, 0);

  const switchTab = (t: OpTab) => {
    // Очередь принадлежит документу: перенести приход в списание нельзя, и
    // молча оставить её при смене вкладки — прямой путь провести не то.
    setTab(t);
    setBatch({});
    setDocNumber('');
    setError(null);
  };

  const openPick = (p: Product) => {
    setPicking(p);
    const inBatch = batch[p.id];
    if (tab === 'INVENTORY') {
      // Подставляем текущий остаток: чаще всего он и подтверждается.
      setPickQty(String(inBatch ? inBatch.qty : stockAt(p, fromWh)));
    } else {
      setPickQty(String(inBatch ? inBatch.qty : 1));
    }
    setPickCost(String(inBatch ? inBatch.cost : (p.buyPrice || 0)));
  };

  const applyPick = () => {
    if (!picking) return;
    const qty = num(pickQty);
    const cost = num(pickCost);
    setBatch(prev => {
      const next = { ...prev };
      // Ноль в инвентаризации осмыслен: «на складе ничего нет». В остальных
      // операциях это просто удаление строки из очереди.
      if (qty <= 0 && tab !== 'INVENTORY') delete next[picking.id];
      else next[picking.id] = { qty, cost };
      return next;
    });
    setPicking(null);
    setError(null);
  };

  const post = async () => {
    if (batchIds.length === 0) { setError('Очередь пуста'); return; }
    if (tab === 'IN' && !supplierId) { setError('Выберите поставщика'); return; }
    if (tab === 'TRANSFER' && !toWh) { setError('Выберите склад-получатель'); return; }
    if (tab === 'TRANSFER' && toWh === fromWh) { setError('Склады совпадают'); return; }

    setSaving(true);
    try {
      const now = new Date();
      const [y, m, d] = docDate.split('-').map(Number);
      const date = new Date(y, (m || 1) - 1, d || 1, now.getHours(), now.getMinutes(), now.getSeconds()).toISOString();
      const batchId = `doc_${Date.now()}`;
      const number = docNumber.trim() || nextDocNumber;

      const movements: StockMovement[] = [];
      const updated: Product[] = [];

      for (const id of batchIds) {
        const product = products.find(p => p.id === id);
        if (!product) continue;
        const { qty, cost } = batch[id];

        if (tab === 'IN') {
          movements.push({
            id: crypto.randomUUID(), userId: product.userId, productId: id, type: 'IN',
            quantity: qty, unitPrice: cost, warehouseId: fromWh, supplierId, batchId, docNumber: number, date,
            note: note.trim() || undefined,
          });
          let next = withDelta(product, fromWh, qty);
          // Цену закупа обновляем по последнему приходу: она нужна для маржи, и
          // держать её вручную в карточке никто не будет.
          if (cost > 0) next = { ...next, buyPrice: cost };
          updated.push(next);
        } else if (tab === 'WRITE_OFF') {
          movements.push({
            id: crypto.randomUUID(), userId: product.userId, productId: id, type: 'WRITE_OFF',
            quantity: -qty, warehouseId: fromWh, batchId, docNumber: number, date,
            note: [reason, note.trim()].filter(Boolean).join(' · '),
          });
          updated.push(withDelta(product, fromWh, -qty));
        } else if (tab === 'TRANSFER') {
          // Две записи: минус на источнике, плюс на получателе. Одной строкой
          // перемещение не описать — иначе по складу-получателю прихода не видно.
          movements.push({
            id: crypto.randomUUID(), userId: product.userId, productId: id, type: 'TRANSFER',
            quantity: -qty, warehouseId: fromWh, toWarehouseId: toWh, batchId, docNumber: number, date,
            note: note.trim() || undefined,
          });
          movements.push({
            id: crypto.randomUUID(), userId: product.userId, productId: id, type: 'TRANSFER',
            quantity: qty, warehouseId: toWh, batchId, docNumber: number, date,
            note: note.trim() || undefined,
          });
          updated.push(withDelta(withDelta(product, fromWh, -qty), toWh, qty));
        } else {
          // Инвентаризация: вводят факт, разницу считаем сами.
          const delta = qty - stockAt(product, fromWh);
          if (delta === 0) continue;
          movements.push({
            id: crypto.randomUUID(), userId: product.userId, productId: id, type: 'CORRECTION',
            quantity: delta, warehouseId: fromWh, batchId, docNumber: number, date,
            note: ['Инвентаризация', note.trim()].filter(Boolean).join(' · '),
          });
          updated.push(withDelta(product, fromWh, delta));
        }
      }

      if (movements.length === 0) {
        setError('Расхождений нет — проводить нечего');
        setSaving(false);
        return;
      }

      await onPost(movements, updated);
      setBatch({});
      setDocOpen(false);
      setNote('');
      setDocNumber('');
      setError(null);
      setOkMessage(`Документ проведён: ${movements.length} движ.`);
      window.setTimeout(() => setOkMessage(null), 3000);
    } catch (e: any) {
      setError(e.message || 'Не удалось провести документ');
    } finally {
      setSaving(false);
    }
  };

  const docTitle = tab === 'IN' ? 'Приход' : tab === 'TRANSFER' ? 'Перемещение'
                 : tab === 'WRITE_OFF' ? 'Списание' : 'Инвентаризация';

  return (
    <div className="space-y-3">
      {/* Операции. Ряд прокручивается: их пять, и в одну строку без прокрутки
          они сжались бы до нечитаемых огрызков. */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {TABS.map(t => (
          <button key={t.id} onClick={() => switchTab(t.id)}
                  className={`shrink-0 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap ${
                    tab === t.id ? 'glass-surface text-indigo-600 dark:text-indigo-300'
                                 : 'bg-white/60 dark:bg-slate-800/60 border border-white/70 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}>{t.label}</button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}
      {okMessage && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {okMessage}
        </div>
      )}

      {/* Склады операции */}
      <div className={`grid gap-2 ${tab === 'TRANSFER' ? 'sm:grid-cols-2' : ''}`}>
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
            {tab === 'TRANSFER' ? 'Откуда' : 'Склад'}
          </p>
          <select value={fromWh} onChange={e => { setFromWh(e.target.value); setBatch({}); }} className={input}>
            {liveWarehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        {tab === 'TRANSFER' && (
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Куда</p>
            <select value={toWh} onChange={e => setToWh(e.target.value)} className={input}>
              <option value="">Выберите склад…</option>
              {liveWarehouses.filter(w => w.id !== fromWh).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {categories.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          <button onClick={() => setCategory('ALL')}
                  className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold ${
                    category === 'ALL' ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                                       : 'bg-white/60 dark:bg-slate-800/60 border border-white/70 dark:border-slate-700 text-slate-500'
                  }`}>Все</button>
          {categories.map(c => (
            <button key={c} onClick={() => setCategory(c)}
                    className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold ${
                      category === c ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                                     : 'bg-white/60 dark:bg-slate-800/60 border border-white/70 dark:border-slate-700 text-slate-500'
                    }`}>{c}</button>
          ))}
        </div>
      )}

      <input value={search} onChange={e => setSearch(e.target.value)}
             placeholder="Поиск по названию или артикулу" className={input} />

      {visible.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">
          {products.length === 0 ? 'Сначала добавьте товары на вкладке «Товары».' : 'Ничего не найдено.'}
        </p>
      ) : (
        // Плитки крупнее витрины кассы: здесь по ним не пробивают чек за
        // секунду, а сверяют остаток и попадают пальцем в нужный товар.
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pb-24">
          {visible.map(p => {
            const inBatch = batch[p.id];
            const here = stockAt(p, fromWh);
            return (
              <button key={p.id} onClick={() => openPick(p)}
                      className={`relative bg-white dark:bg-slate-800 rounded-2xl border p-3.5 text-left active:scale-95 transition-transform ${
                        inBatch ? 'border-indigo-500 border-2' : 'border-slate-100 dark:border-slate-700'
                      }`}>
                {inBatch && (
                  <span className="absolute top-1.5 right-1.5 bg-indigo-600 text-white text-[10px] font-bold min-w-[22px] h-5 px-1 rounded-full flex items-center justify-center">
                    {money(inBatch.qty)}
                  </span>
                )}
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-xl bg-slate-100 dark:bg-slate-700 overflow-hidden shrink-0 flex items-center justify-center">
                    {p.images?.[0]
                      ? <img src={p.images[0]} alt="" className="w-full h-full object-cover" loading="lazy" />
                      : <span className="text-slate-400 text-lg">📦</span>}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-slate-800 dark:text-white text-sm leading-tight line-clamp-2">{p.name}</p>
                    {p.sku && <p className="text-[11px] text-slate-400 truncate">{p.sku}</p>}
                    <p className={`text-sm font-bold mt-0.5 ${here < 0 ? 'text-rose-500' : 'text-slate-500 dark:text-slate-400'}`}>
                      {money(here)} {p.unit || 'шт'}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Очередь документа */}
      {batchIds.length > 0 && !picking && (
        <button onClick={() => setDocOpen(true)}
                className="fixed left-4 right-4 lg:left-auto lg:right-28 lg:w-96 z-40 rounded-2xl bg-indigo-600 text-white py-3.5 px-5 shadow-2xl flex items-center justify-between active:scale-[0.98] transition-transform"
                style={{ bottom: 'calc(5.5rem + env(safe-area-inset-bottom, 0px))' }}>
          <span className="flex items-center gap-2 font-bold">
            <span className="bg-white/20 rounded-full min-w-[26px] h-6 px-1.5 flex items-center justify-center text-xs">
              {batchIds.length}
            </span>
            {docTitle}
          </span>
          <span className="font-extrabold">
            {tab === 'IN' ? `${money(batchTotal, showCents)} ₽` : 'Открыть'}
          </span>
        </button>
      )}

      {/* Ввод количества */}
      {picking && (
        <ModalPortal>
          <div className="fixed inset-0 z-modal flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm"
               onClick={() => setPicking(null)}>
            <div className="bg-white dark:bg-slate-800 w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 space-y-3"
                 onClick={e => e.stopPropagation()}>
              <div>
                <h3 className="font-bold text-slate-800 dark:text-white truncate">{picking.name}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  На складе {money(stockAt(picking, fromWh))} {picking.unit || 'шт'}
                </p>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {tab === 'INVENTORY' ? 'Фактический остаток' : 'Количество'}
                </label>
                <div className="flex items-center gap-2 mt-1">
                  <button onClick={() => setPickQty(p => String(Math.max(0, num(p) - 1)))}
                          className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xl font-bold shrink-0">−</button>
                  <input value={pickQty} onChange={e => setPickQty(e.target.value)} inputMode="decimal"
                         className="flex-1 min-w-0 p-2.5 text-center text-2xl font-extrabold rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white outline-none" />
                  <button onClick={() => setPickQty(p => String(num(p) + 1))}
                          className="w-11 h-11 rounded-xl bg-indigo-600 text-white text-xl font-bold shrink-0">+</button>
                </div>
              </div>

              {tab === 'INVENTORY' && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Разницу с учётным остатком система посчитает сама:
                  {' '}<span className="font-bold">{money(num(pickQty) - stockAt(picking, fromWh))}</span>
                </p>
              )}

              {tab === 'IN' && (
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Цена закупа за единицу</label>
                  <input value={pickCost} onChange={e => setPickCost(e.target.value)} inputMode="decimal"
                         className={`${input} mt-1 text-center font-bold`} />
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={() => setPicking(null)}
                        className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-sm">
                  Отмена
                </button>
                <button onClick={applyPick}
                        className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm">
                  В документ
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Документ */}
      {docOpen && (
        <ModalPortal>
          <div className="fixed inset-0 z-modal flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm"
               onClick={() => setDocOpen(false)}>
            <div className="bg-white dark:bg-slate-800 w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[90vh] flex flex-col"
                 onClick={e => e.stopPropagation()}>
              <div className="px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between shrink-0">
                <div>
                  <h3 className="font-bold text-slate-800 dark:text-white">{docTitle}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {liveWarehouses.find(w => w.id === fromWh)?.name}
                    {tab === 'TRANSFER' && toWh ? ` → ${liveWarehouses.find(w => w.id === toWh)?.name}` : ''}
                  </p>
                </div>
                <button onClick={() => setDocOpen(false)}
                        className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 font-bold">×</button>
              </div>

              <div className="overflow-y-auto p-4 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Номер</label>
                    <input value={docNumber} onChange={e => setDocNumber(e.target.value)}
                           placeholder={nextDocNumber} className={`${input} mt-1`} />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Дата</label>
                    <input type="date" value={docDate} onChange={e => setDocDate(e.target.value)} className={`${input} mt-1`} />
                  </div>
                  {tab === 'WRITE_OFF' && (
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Причина</label>
                      <select value={reason} onChange={e => setReason(e.target.value)} className={`${input} mt-1`}>
                        {WRITE_OFF_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  )}
                </div>

                {tab === 'IN' && (
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Поставщик</label>
                    <select value={supplierId} onChange={e => setSupplierId(e.target.value)} className={`${input} mt-1`}>
                      <option value="">Выберите поставщика…</option>
                      {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    {suppliers.length === 0 && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                        Поставщиков пока нет — заведите их в разделе «Поставщики».
                      </p>
                    )}
                  </div>
                )}

                <input value={note} onChange={e => setNote(e.target.value)} placeholder="Комментарий к документу" className={input} />

                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700 overflow-hidden">
                  {batchIds.map(id => {
                    const p = products.find(x => x.id === id);
                    if (!p) return null;
                    const row = batch[id];
                    const diff = row.qty - stockAt(p, fromWh);
                    return (
                      <div key={id} className="p-3 bg-white dark:bg-slate-800">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-slate-800 dark:text-white text-sm truncate">{p.name}</p>
                          <button onClick={() => setBatch(prev => { const n = { ...prev }; delete n[id]; return n; })}
                                  className="w-7 h-7 shrink-0 rounded-lg bg-rose-50 dark:bg-rose-900/20 text-rose-500 font-bold">×</button>
                        </div>
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <div>
                            <label className="text-[9px] font-bold text-slate-400 uppercase">
                              {tab === 'INVENTORY' ? 'Факт' : 'Кол-во'}
                            </label>
                            <input value={String(row.qty)} inputMode="decimal"
                                   onChange={e => setBatch(prev => ({ ...prev, [id]: { ...prev[id], qty: num(e.target.value) } }))}
                                   className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-center font-bold text-slate-800 dark:text-white" />
                          </div>
                          {tab === 'IN' ? (
                            <div>
                              <label className="text-[9px] font-bold text-slate-400 uppercase">Закуп, ₽</label>
                              <input value={String(row.cost)} inputMode="decimal"
                                     onChange={e => setBatch(prev => ({ ...prev, [id]: { ...prev[id], cost: num(e.target.value) } }))}
                                     className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-center font-bold text-indigo-600 dark:text-indigo-400" />
                            </div>
                          ) : tab === 'INVENTORY' ? (
                            <div>
                              <label className="text-[9px] font-bold text-slate-400 uppercase">Расхождение</label>
                              <p className={`p-2 text-sm text-center font-bold ${
                                diff === 0 ? 'text-slate-400' : diff > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'
                              }`}>
                                {diff > 0 ? '+' : ''}{money(diff)}
                              </p>
                            </div>
                          ) : (
                            <div>
                              <label className="text-[9px] font-bold text-slate-400 uppercase">Останется</label>
                              <p className="p-2 text-sm text-center font-bold text-slate-500 dark:text-slate-400">
                                {money(stockAt(p, fromWh) - row.qty)}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="p-4 border-t border-slate-100 dark:border-slate-700 space-y-2 shrink-0">
                {tab === 'IN' && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500 dark:text-slate-400">Сумма прихода</span>
                    <span className="text-2xl font-extrabold text-slate-900 dark:text-white">
                      {money(batchTotal, showCents)} ₽
                    </span>
                  </div>
                )}
                <button disabled={saving} onClick={post}
                        className="w-full py-3.5 rounded-2xl bg-indigo-600 text-white font-bold disabled:opacity-50 active:scale-[0.99] transition-transform">
                  Провести
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};

export default WarehouseOps;
