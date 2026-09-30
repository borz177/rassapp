import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AppSettings, Sale } from '../types';
import { ProfitTotalRow } from '../src/profitTotals';
import { formatCurrency, formatDate } from '../src/utils';

/**
 * Что стоит за числом на карточках «Всего ожидается» и «Всего получено».
 *
 * Одна сумма за всё время ничего не объясняет: непонятно, из скольких договоров
 * она сложена, какие из них весят больше всего и кому звонить, если ожидаемое
 * не приходит. Здесь тот же итог разложен по договорам — крупные сверху,
 * с долей каждого в общей сумме.
 *
 * Строки приходят из src/profitTotals — того же счёта, что и число на карточке,
 * поэтому сумма внизу сходится с ней по построению, а не по совпадению.
 */

interface ProfitTotalsModalProps {
  type: 'expected' | 'received';
  rows: ProfitTotalRow[];
  /** Итог с карточки: показываем его, а не пересумму — они обязаны совпадать */
  total: number;
  appSettings: AppSettings;
  onClose: () => void;
  onSelectCustomer?: (customerId: string) => void;
  /** Открыть сам договор у клиента */
  onOpenContract?: (saleId: string, customerId: string) => void;
}

const ProfitTotalsModal: React.FC<ProfitTotalsModalProps> = ({
  type, rows, total, appSettings, onClose, onSelectCustomer, onOpenContract,
}) => {
  const [isClosing, setIsClosing] = useState(false);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(30);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(onClose, 280);
  };

  const cents = appSettings?.showCents;
  const isExpected = type === 'expected';

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return rows;
    return rows.filter(r =>
      r.customerName.toLowerCase().includes(text) ||
      (r.productName || '').toLowerCase().includes(text)
    );
  }, [rows, query]);

  // Пока ничего не искали, показываем итог с карточки — он обязан совпасть.
  // Под поиском сумма уже про найденное, и подписана иначе.
  const shownTotal = useMemo(
    () => (query.trim() ? filtered.reduce((sum, r) => sum + r.profit, 0) : total),
    [filtered, query, total]
  );

  const customers = useMemo(() => new Set(filtered.map(r => r.customerId)).size, [filtered]);
  const visible = filtered.slice(0, limit);

  const title = isExpected ? 'Ожидается прибыли' : 'Получено прибыли';
  const amountLabel = isExpected ? 'Осталось получить' : 'Получено денег';

  return createPortal(
    <div
      className={`fixed inset-0 z-modal flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
      onClick={handleClose}
    >
      <div
        className={`bg-white dark:bg-slate-800 w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col ${isClosing ? 'animate-slide-down-sheet' : 'animate-slide-up-sheet'}`}
        onClick={e => e.stopPropagation()}
      >
        <div className={`px-4 py-3 flex items-center justify-between shrink-0 ${
          isExpected
            ? 'bg-gradient-to-r from-slate-600 to-blue-600'
            : 'bg-gradient-to-r from-emerald-500 to-teal-500'
        }`}>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-white truncate">{title}</h3>
            <p className="text-[11px] text-white/80">За всё время · по договорам</p>
          </div>
          <button
            onClick={handleClose}
            aria-label="Закрыть"
            className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-xl transition-colors shrink-0"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center gap-3">
          <div className="min-w-0">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {query.trim() ? 'Найдено' : 'Итого'}
            </p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              {filtered.length} догов. · {customers} клиент.
            </p>
          </div>
          <span className={`text-lg font-bold shrink-0 ${
            shownTotal < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-white'
          }`}>
            {formatCurrency(shownTotal, cents)} ₽
          </span>
        </div>

        {rows.length > 8 && (
          <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-700 shrink-0">
            <input
              value={query}
              onChange={e => { setQuery(e.target.value); setLimit(30); }}
              placeholder="Клиент или товар"
              autoComplete="off" autoCorrect="off" spellCheck={false}
              className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-slate-800 dark:text-white outline-none focus:border-indigo-400"
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {visible.length === 0 ? (
            <div className="text-center py-10 text-slate-400">
              <div className="text-4xl mb-2 opacity-30">📭</div>
              <p className="text-sm">
                {query.trim()
                  ? 'Ничего не нашлось'
                  : isExpected
                    ? 'Нечего ждать: по действующим договорам всё получено'
                    : 'Прибыли пока нет — деньги по договорам ещё не приходили'}
              </p>
            </div>
          ) : visible.map(row => {
            // Доля договора в общей сумме: сразу видно, на ком держится итог
            const share = total !== 0 ? Math.round((row.profit / total) * 100) : 0;
            return (
              <div
                key={row.saleId}
                onClick={() => {
                  if (onOpenContract) { onOpenContract(row.saleId, row.customerId); handleClose(); }
                  else if (onSelectCustomer) { onSelectCustomer(row.customerId); handleClose(); }
                }}
                className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-100 dark:border-slate-700 hover:border-indigo-200 dark:hover:border-indigo-800 hover:shadow-sm transition-all cursor-pointer active:scale-[0.99]"
              >
                <div className="flex justify-between items-start gap-3 mb-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-800 dark:text-white text-sm truncate">{row.customerName}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{row.productName}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`font-bold text-sm ${
                      row.profit < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-white'
                    }`}>
                      {formatCurrency(row.profit, cents)} ₽
                    </p>
                
                  </div>
                </div>

                {/* Полоса закрытия договора: у «ожидается» она показывает, сколько
                    уже прошло, у «получено» — сколько ещё впереди. */}
                <div className="h-1 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden mb-2">
                  <div
                    className={isExpected ? 'h-full bg-blue-400' : 'h-full bg-emerald-400'}
                    style={{ width: `${Math.round(row.progress * 100)}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>{amountLabel}: {formatCurrency(row.amount, cents)} ₽</span>
                  <span>
                    {row.status === 'DRAFT' ? 'Черновик · ' : ''}
                    от {formatDate(row.startDate)}
                  </span>
                </div>
              </div>
            );
          })}

          {filtered.length > visible.length && (
            <button
              onClick={() => setLimit(l => l + 50)}
              className="w-full py-2.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
            >
              Показать ещё {Math.min(50, filtered.length - visible.length)}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ProfitTotalsModal;
