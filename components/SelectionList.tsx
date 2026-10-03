import React, { useState } from 'react';
import { ICONS } from '../constants';
import CustomerFormSheet from './CustomerFormSheet';

interface SelectionItem {
  id: string;
  title: string;
  subtitle?: string;
}

interface SelectionListProps {
  title: string;
  items: SelectionItem[];
  onSelect: (id: string) => void;
  onCancel: () => void;
  // 🔹 Обновляем тип: добавляем паспортные данные (все необязательные)
  onAddNew: (customerData: {
    name: string;
    phone: string;
    address?: string;
    passportSeries?: string;
    passportNumber?: string;
    passportIssuedBy?: string;
    photo?: string;
    birthDate?: string;
  }) => unknown;
  /** Распознавание паспорта — только там, где его разрешает тариф */
  canScanPassport?: boolean;
  /**
   * Записи другого раздела (клиенты рассрочки при продаже в кассе и наоборот).
   * В списке их нет, чтобы не мешали искать своих, но поиск их находит —
   * отдельной группой ниже, а кнопка внизу показывает их целиком.
   */
  secondaryIds?: ReadonlySet<string>;
  /** Как назвать ту группу: «Клиенты рассрочки» */
  secondaryLabel?: string;
}

const SelectionList: React.FC<SelectionListProps> = ({
  title, items, onSelect, onCancel, onAddNew, canScanPassport = false, secondaryIds, secondaryLabel = 'Остальные',
}) => {
  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [showSecondary, setShowSecondary] = useState(false);

  const q = search.toLowerCase();
  const matching = items.filter(item =>
    item.title.toLowerCase().includes(q) ||
    (item.subtitle && item.subtitle.toLowerCase().includes(q))
  );
  const isSecondary = (id: string) => !!secondaryIds?.has(id);
  const filteredItems = matching.filter(i => !isSecondary(i.id));
  const secondaryAll = items.filter(i => isSecondary(i.id));
  const secondaryItems = search || showSecondary ? matching.filter(i => isSecondary(i.id)) : [];

  const renderItem = (item: SelectionItem) => (
    <div
        key={item.id}
        onClick={() => onSelect(item.id)}
        className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm active:bg-slate-50 dark:active:bg-slate-700 cursor-pointer flex justify-between items-center"
    >
        <div>
        <h3 className="font-bold text-slate-800 dark:text-white">{item.title}</h3>
        {item.subtitle && <p className="text-sm text-slate-500 dark:text-slate-400">{item.subtitle}</p>}
        </div>
        <div className="text-slate-300 dark:text-slate-600">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
    </div>
  );

  // Заполняем только пустые поля: набранное руками важнее — его вводили
  // осознанно, а распознавание ошибается. Затирать чужой ввод нельзя.
  return (
    <div className="space-y-4 h-full flex flex-col animate-fade-in">
      <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-700 pb-4">
        <button onClick={onCancel} className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">
           <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
        </button>
        <h2 className="text-xl font-bold text-slate-800 dark:text-white">{title}</h2>
      </div>

      {/* Список остаётся под листом нового клиента — видно, откуда пришли */}
      {(
          <>
            <div className="relative">
                <input autoComplete="off" autoCorrect="off" spellCheck={false}
                type="text"
                placeholder="Поиск..."
                className="w-full p-3 pl-10 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 dark:text-white rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
                />
                <div className="absolute left-3 top-3.5 text-slate-400 dark:text-slate-500">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                </div>
            </div>

            <button
                onClick={() => setIsCreating(true)}
                className="w-full py-3 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-indigo-100 dark:hover:bg-indigo-900/50"
            >
                {ICONS.AddSmall} Добавить нового клиента
            </button>

            <div className="flex-1 overflow-y-auto space-y-2">
                {filteredItems.map(renderItem)}
                {filteredItems.length === 0 && secondaryItems.length === 0 && (
                    <div className="text-center py-10 text-slate-400 dark:text-slate-500">Ничего не найдено</div>
                )}
                {secondaryItems.length > 0 && (
                    <>
                      <p className="px-1 pt-3 text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{secondaryLabel}</p>
                      {secondaryItems.map(renderItem)}
                    </>
                )}
                {!search && !showSecondary && secondaryAll.length > 0 && (
                    <button type="button" onClick={() => setShowSecondary(true)}
                            className="w-full py-3 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-indigo-600">
                      Показать: {secondaryLabel.toLowerCase()} ({secondaryAll.length})
                    </button>
                )}
            </div>
          </>
)}

      {/* Новый клиент — той же формой, что в «Клиентах» (CustomerFormSheet), листом поверх выбора */}
      {isCreating && (
        <CustomerFormSheet
          canScanPassport={canScanPassport}
          onClose={() => setIsCreating(false)}
          onCreate={data => onAddNew(data)}
        />
      )}
    </div>
  );
};

export default SelectionList;