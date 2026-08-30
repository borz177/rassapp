import React from 'react';
import { useIsUnsynced } from '../src/unsynced';

/**
 * Метка «эта запись есть только на устройстве».
 *
 * Ничего не рисует, пока запись синхронизирована, — то есть в обычной жизни её
 * не видно вовсе. Появляется ровно тогда, когда человеку важно знать, что
 * коллега этой строки пока не видит.
 *
 * Точка, а не слово: она стоит внутри строк списка, где место дорого, а смысл
 * прочитывается по цвету. Полный разбор — по значку в шапке.
 */
const UnsyncedMark: React.FC<{ id?: string; className?: string }> = ({ id, className = '' }) => {
  const unsynced = useIsUnsynced(id);
  if (!unsynced) return null;
  return (
    <span
      title="Ещё не отправлено на сервер — видно только на этом устройстве"
      aria-label="Не отправлено на сервер"
      className={`inline-block w-2 h-2 shrink-0 rounded-full bg-amber-500 ${className}`}
    />
  );
};

export default UnsyncedMark;
