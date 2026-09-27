import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, Trash2, X, MoreVertical } from 'lucide-react';
import { Sale, Customer, User, AppSettings } from '../types';
import { printContract } from './contractPrint';

/**
 * Действия по договору в карточке клиента: печать и удаление.
 *
 * Раньше оба действия жили только на экране «Договоры»: чтобы распечатать
 * договор, открытый из карточки клиента, приходилось возвращаться назад и
 * искать его в общем списке. Печатает та же функция, что и там (contractPrint),
 * поэтому бланк получается ровно такой же.
 *
 * Удаление спрашивает подтверждение и показывает отказ здесь же: сервер может
 * не дать удалить договор, по которому уже прошли деньги, и человек должен
 * увидеть причину, а не молчание.
 */

interface SaleActionsMenuProps {
  sale: Sale;
  /** Все договоры — печати нужен номер, он зависит от порядка оформления */
  sales: Sale[];
  customer?: Customer;
  appSettings?: AppSettings;
  user?: User | null;
  contractTemplatesAllowed?: boolean;
  onDeleteSale?: (saleId: string) => void | Promise<void>;
}

const SaleActionsMenu: React.FC<SaleActionsMenuProps> = ({
  sale, sales, customer, appSettings, user, contractTemplatesAllowed, onDeleteSale,
}) => {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEmployee = user?.role === 'employee';
  const canDelete = !!onDeleteSale && (!isEmployee || !!user?.permissions?.canDelete);

  const print = () => {
    setOpen(false);
    printContract({
      sale, sales,
      customers: customer ? [customer] : [],
      appSettings, user, contractTemplatesAllowed,
    });
  };

  const remove = async () => {
    if (!onDeleteSale) return;
    setWorking(true);
    setError(null);
    try {
      await onDeleteSale(sale.id);
      setConfirming(false);
    } catch (e: any) {
      // Причина отказа приходит от сервера: по договору есть платежи, долг
      // поставщику или не хватает прав. Показываем её на месте.
      setError(e?.message || 'Не удалось удалить договор');
    } finally {
      setWorking(false);
    }
  };

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <>
      <button
        onClick={e => { stop(e); setOpen(true); }}
        aria-label="Действия по договору"
        className="shrink-0 -mr-1 -mt-1 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
      >
        <MoreVertical size={18} />
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-modal bg-slate-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center animate-fade-in"
          onClick={e => { stop(e); setOpen(false); }}
        >
          <div
            onClick={stop}
            className="bg-white dark:bg-slate-800 w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden animate-slide-up-sheet sm:animate-scale-in"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700">
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Действия</span>
              <button onClick={() => setOpen(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300" aria-label="Закрыть">
                <X size={20} />
              </button>
            </div>

            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700">
              <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{customer?.name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{sale.productName}</p>
            </div>

            <div className="py-2">
              <button
                onClick={print}
                className="w-full text-left px-4 py-3.5 text-sm text-slate-700 dark:text-slate-300 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                <span className="text-slate-500 dark:text-slate-400"><Printer size={18} /></span>
                <span>Печать договора</span>
              </button>
            </div>

            {canDelete && (
              <div className="border-t border-slate-100 dark:border-slate-700 py-2">
                <button
                  onClick={() => { setOpen(false); setError(null); setConfirming(true); }}
                  className="w-full text-left px-4 py-3.5 text-sm text-red-600 dark:text-red-400 flex items-center gap-3 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                >
                  <span className="text-red-500 dark:text-red-400"><Trash2 size={18} /></span>
                  <span>Удалить договор</span>
                </button>
              </div>
            )}

            <div className="px-4 pb-4 pt-2">
              <button
                onClick={() => setOpen(false)}
                className="w-full py-3 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-medium text-sm hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {confirming && createPortal(
        <div className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in" onClick={stop}>
          <div className="bg-white dark:bg-slate-800 w-full max-w-sm p-6 rounded-2xl shadow-xl animate-scale-in">
            <div className="w-14 h-14 bg-red-500 text-white rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Trash2 size={28} />
            </div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white text-center mb-1.5">Удалить договор?</h3>
            <p className="text-center text-slate-500 dark:text-slate-400 mb-6 text-sm">
              Все данные о платежах будут удалены. Товар вернётся на склад.
            </p>

            {error && (
              <div className="mb-4 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-900/50 rounded-xl p-3 flex gap-2 items-start">
                <span className="text-rose-500 shrink-0 mt-0.5">⛔</span>
                <p className="text-xs text-rose-800 dark:text-rose-300">{error}</p>
              </div>
            )}

            <div className="flex gap-2.5">
              <button
                onClick={() => { setConfirming(false); setError(null); }}
                disabled={working}
                className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-700 rounded-xl font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50"
              >
                {error ? 'Закрыть' : 'Отмена'}
              </button>
              {!error && (
                <button
                  onClick={remove}
                  disabled={working}
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold disabled:opacity-50"
                >
                  {working ? 'Удаляем…' : 'Удалить'}
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default SaleActionsMenu;
