import { useEffect, useState } from 'react';

/**
 * Порядок «Рассрочка / Наличные» — один на всё приложение: Главная, Отчёты,
 * оформление продажи. Кто торгует в основном за наличные, ставит их первыми, и
 * менять это в каждом окне по отдельности было бы странно. Поменяли в одном
 * месте — остальные открытые окна перестраиваются сразу.
 */
export type SaleMode = 'installments' | 'cash';

const KEY = 'finuchet_mode_order';
const EVENT = 'finuchet-mode-order';

const read = (): SaleMode[] => {
  try { return localStorage.getItem(KEY) === 'cash' ? ['cash', 'installments'] : ['installments', 'cash']; }
  catch { return ['installments', 'cash']; }
};

export const useModeOrder = (): [SaleMode[], () => void] => {
  const [order, setOrder] = useState<SaleMode[]>(read);
  useEffect(() => {
    const sync = () => setOrder(read());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  const swap = () => {
    const next = [order[1], order[0]];
    try { localStorage.setItem(KEY, next[0]); } catch { /* не критично */ }
    setOrder(next);
    window.dispatchEvent(new Event(EVENT));
  };
  return [order, swap];
};
