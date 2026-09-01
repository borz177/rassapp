import React, { useState } from 'react';
import ModalPortal from './ModalPortal';

export interface SyncQueueItem {
  id: string;
  collection?: string;
  action: string;
  failed: boolean;
  retryCount: number;
  error?: string;
  timestamp: number;
  payload?: any;
  itemId?: string;
  /** Чем запись является для человека: платёж, отмена платежа, договор */
  intent?: { kind: string; label?: string };
}

export interface SyncStatusData {
  pending: number;
  failed: number;
  items: SyncQueueItem[];
}

interface SyncStatusProps {
  status: SyncStatusData;
  isOnline: boolean;
  isSyncing: boolean;
  onRetry: () => Promise<void> | void;
  /** Убрать застрявшую запись: сервер её не примет, а висеть вечно она не должна */
  onDiscard?: (id: string) => Promise<void> | void;
}

const COLLECTION_LABEL: Record<string, string> = {
  sales: 'Договор',
  customers: 'Клиент',
  expenses: 'Расход',
  accounts: 'Счёт',
  investors: 'Инвестор',
  suppliers: 'Поставщик',
  products: 'Товар',
  retailSales: 'Чек магазина',
  stockMovements: 'Движение по складу',
  warehouses: 'Склад',
  tasks: 'Задача',
  settings: 'Настройки',
  partnerships: 'Партнёрство',
};

/**
 * Понятное имя записи. Берём то, что человек узнает в лицо: название договора,
 * имя клиента, номер чека. Идентификатор показывать бессмысленно — по нему
 * ничего не вспомнить.
 */
const INTENT_LABEL: Record<string, string> = {
  payment: 'Платёж',
  paymentUndo: 'Отмена платежа',
  contract: 'Договор',
  retailPayment: 'Оплата долга',
  retailSale: 'Чек магазина',
};

const describe = (item: SyncQueueItem): string => {
  // Смысл операции важнее того, в какой коллекции она лежит: приём платежа
  // сохраняется как договор, и без этого список называл платёж «Договором».
  if (item.intent) {
    const kind = INTENT_LABEL[item.intent.kind] || item.intent.kind;
    return item.intent.label ? `${kind} · ${item.intent.label}` : kind;
  }
  const p = item.payload || {};
  const name = p.productName || p.name || p.title
    || (p.docNumber ? `№${p.docNumber}` : null)
    || (typeof p.amount === 'number' ? `${p.amount.toLocaleString('ru-RU')} ₽` : null);
  const label = COLLECTION_LABEL[item.collection || ''] || item.collection || 'Запись';
  if (item.action === 'deleteItem') return `${label} · удаление`;
  return name ? `${label} · ${name}` : label;
};

/**
 * Ответ сервера человеческим языком. В поле error лежит сырой JSON — он ничего не
 * объясняет тому, кто его читает, а объяснение внутри есть.
 */
const readableError = (raw: string): string => {
  try {
    const parsed = JSON.parse(raw);
    return parsed.msg || parsed.error || parsed.hint || raw.slice(0, 200);
  } catch {
    return raw.slice(0, 200);
  }
};

const when = (ts: number) =>
  new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * Показывает, что ещё не уехало на сервер.
 *
 * Появляется только когда есть что показать: постоянный значок «всё хорошо»
 * быстро перестают замечать, а вот возникшая из ниоткуда плашка — нет.
 *
 * Различает два состояния, потому что они требуют разного. «В очереди» — просто
 * ждёт связи, делать ничего не нужно. «Не удалось отправить» — сервер отказал, и
 * без человека это не разрешится: истёк тариф, кончился лимит, нет прав.
 */
const SyncStatus: React.FC<SyncStatusProps> = ({ status, isOnline, isSyncing, onRetry, onDiscard }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const total = status.pending + status.failed;
  if (total === 0) return null;

  const alarming = status.failed > 0;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`pointer-events-auto shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors ${
          alarming
            ? 'bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-300 border-rose-200 dark:border-rose-800'
            : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
        }`}
        title={alarming ? 'Часть записей не принята сервером' : 'Записи ждут связи'}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${alarming ? 'bg-rose-500' : 'bg-amber-500'}`} />
        {total}
      </button>

      {open && (
        <ModalPortal onClose={() => setOpen(false)}>
          <div className="fixed inset-0 z-modal flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm"
               onClick={() => setOpen(false)}>
            <div className="bg-white dark:bg-slate-800 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[85vh] flex flex-col"
                 onClick={e => e.stopPropagation()}>
              <div className="px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-700 shrink-0">
                <h3 className="font-bold text-slate-800 dark:text-white">Не отправлено на сервер</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {status.pending > 0 && `${status.pending} ждёт отправки`}
                  {status.pending > 0 && status.failed > 0 && ' · '}
                  {status.failed > 0 && `${status.failed} сервер не принял`}
                </p>
              </div>

              <div className="px-5 py-3 shrink-0">
                {/* Прямым текстом, что это значит: «висит в очереди» звучит
                    безобидно, а на деле записи нет ни у коллеги, ни на другом
                    устройстве. */}
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  Эти записи есть только на этом устройстве. Коллеги и другие устройства их не видят.
                  {status.failed > 0
                    ? ' Сервер отказал — посмотрите причину и нажмите «Отправить снова».'
                    : isOnline
                      ? ' Отправятся при ближайшей синхронизации.'
                      : ' Отправятся, когда появится связь.'}
                </p>
              </div>

              <div className="overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700 border-t border-slate-100 dark:border-slate-700">
                {status.items.map(item => (
                  <div key={item.id} className="px-5 py-3 flex items-start gap-3">
                    <span className={`mt-1.5 w-2 h-2 shrink-0 rounded-full ${item.failed ? 'bg-rose-500' : 'bg-amber-500'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-800 dark:text-white truncate">{describe(item)}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {when(item.timestamp)}
                        {item.retryCount > 0 ? ` · попыток: ${item.retryCount}` : ''}
                      </p>
                      {item.failed && item.error && (
                        <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-0.5 break-words">
                          {readableError(item.error)}
                        </p>
                      )}
                      {/* Снять можно только то, что сервер уже отверг: запись,
                          которая просто ждёт связи, убирать нельзя — она ещё уедет. */}
                      {item.failed && onDiscard && (
                        <button
                          onClick={() => {
                            if (window.confirm('Убрать эту запись из списка? Отправить её на сервер уже не получится.')) {
                              onDiscard(item.id);
                            }
                          }}
                          className="mt-1 text-[11px] font-bold text-slate-400 underline underline-offset-2"
                        >
                          Убрать из списка
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-4 border-t border-slate-100 dark:border-slate-700 space-y-2 shrink-0">
                <button
                  disabled={busy || isSyncing}
                  onClick={async () => { setBusy(true); try { await onRetry(); } finally { setBusy(false); } }}
                  className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm disabled:opacity-50">
                  {busy || isSyncing ? 'Отправляем…' : 'Отправить снова'}
                </button>
                <button onClick={() => setOpen(false)}
                        className="w-full py-2 rounded-xl text-slate-400 font-bold text-sm">
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  );
};

export default SyncStatus;
