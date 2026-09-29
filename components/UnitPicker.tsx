import React, { useMemo, useState } from 'react';
import ModalPortal from './ModalPortal';
import {
  UNITS, GROUP_ORDER, GROUP_TITLES, CONTENT_UNITS, UnitGroup,
  findUnit, isPackUnit, packLabel, unitOf, DEFAULT_UNIT,
} from '../src/units';

/**
 * Единица измерения товара: выбор из списка вместо пустого поля.
 *
 * Пустое поле люди заполняли как умели — на боевой базе рядом со «шт» лежат
 * «5 комплект» и «6 комплект»: человек хотел сказать «комплект из пяти», а
 * отдельного места для вложения не было. Поэтому единицу здесь выбирают, а
 * «сколько внутри» спрашивается отдельной строкой и только у упаковок,
 * коробок, ящиков и комплектов — у килограмма такого вопроса не возникает.
 *
 * Вариант «Своя единица» остался: в карточках встречаются «пар», «рулон» и
 * прочее, и отнимать у людей то, чем они уже пользуются, нельзя.
 */

interface UnitPickerProps {
  unit: string;
  packSize: string;
  packUnit: string;
  onChange: (next: { unit: string; packSize: string; packUnit: string }) => void;
  labelClassName?: string;
  inputClassName?: string;
}

const UnitPicker: React.FC<UnitPickerProps> = ({
  unit, packSize, packUnit, onChange, labelClassName = '', inputClassName = '',
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [customMode, setCustomMode] = useState(false);
  const [custom, setCustom] = useState('');

  const current = findUnit(unit);
  const showPack = isPackUnit(unit);
  const hint = packLabel({ unit, packSize: Number(packSize.replace(',', '.')), packUnit });

  const groups = useMemo(() => {
    const text = query.trim().toLowerCase();
    const matched = text
      ? UNITS.filter(u => u.name.toLowerCase().includes(text) || u.id.toLowerCase().includes(text))
      : UNITS;
    const seen: UnitGroup[] = [];
    return GROUP_ORDER
      .map(group => {
        // Длина и площадь показываются одним разделом — их мало, и порознь
        // раздел из одной строки выглядит случайным.
        const inGroup = matched.filter(u => (u.group === 'area' ? 'length' : u.group) === group);
        if (!inGroup.length || seen.includes(group)) return null;
        seen.push(group);
        return { group, items: inGroup };
      })
      .filter(Boolean) as { group: UnitGroup; items: typeof UNITS }[];
  }, [query]);

  const pick = (id: string) => {
    // Со штучной единицы вложение уходит: «12 шт по 6 шт» — бессмыслица.
    const keepPack = isPackUnit(id);
    onChange({
      unit: id,
      packSize: keepPack ? packSize : '',
      packUnit: keepPack ? (packUnit || DEFAULT_UNIT) : '',
    });
    setOpen(false);
    setQuery('');
    setCustomMode(false);
  };

  const applyCustom = () => {
    const value = custom.trim();
    if (!value) return;
    onChange({ unit: value, packSize: '', packUnit: '' });
    setOpen(false);
    setQuery('');
    setCustomMode(false);
    setCustom('');
  };

  return (
    <>
      <label className="block min-w-0">
        <span className={`${labelClassName} mb-1`}>Ед. изм.</span>
        <button
          type="button"
          onClick={() => { setCustom(current ? '' : unit); setOpen(true); }}
          className={`${inputClassName} flex items-center justify-between gap-2 text-left`}
        >
          <span className="truncate">
            {unitOf(unit)}
            {hint && <span className="text-slate-400 dark:text-slate-500 font-normal"> · {hint}</span>}
          </span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
               strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 shrink-0">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </label>

      {/* Вложение — отдельной строкой под единицей, во всю ширину: два поля
          рядом («сколько» и «чего») на телефоне уже не читаются. */}
      {showPack && (
        <div className="col-span-2 min-w-0">
          <span className={`${labelClassName} mb-1 block`}>
            Сколько внутри <span className="normal-case font-normal text-slate-400">— необязательно</span>
          </span>
          <div className="flex gap-2">
            <input
              value={packSize}
              onChange={e => onChange({ unit, packSize: e.target.value, packUnit: packUnit || DEFAULT_UNIT })}
              placeholder="Например, 12"
              inputMode="decimal"
              autoComplete="off" autoCorrect="off" spellCheck={false}
              className={`${inputClassName} flex-1 min-w-0`}
            />
            <select
              value={packUnit || DEFAULT_UNIT}
              onChange={e => onChange({ unit, packSize, packUnit: e.target.value })}
              className={`${inputClassName} w-24 shrink-0`}
            >
              {CONTENT_UNITS.map(u => (
                <option key={u.id} value={u.id}>{u.id}</option>
              ))}
            </select>
          </div>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            Остаток считается в «{unitOf(unit)}»: на складе лежат упаковки, а это — что в них.
          </p>
        </div>
      )}

      {open && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-sheet-select flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
            onClick={() => setOpen(false)}
          >
            <div
              className="bg-white dark:bg-slate-800 w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[80vh] flex flex-col animate-slide-up-sheet"
              onClick={e => e.stopPropagation()}
            >
              <div className="px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-700">
                <h3 className="font-bold text-slate-800 dark:text-white mb-3">Единица измерения</h3>
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Поиск: коробка, кг, метр…"
                  autoComplete="off" autoCorrect="off" spellCheck={false}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-slate-800 dark:text-white outline-none"
                />
              </div>

              <div className="p-2 overflow-y-auto flex-1">
                {groups.length === 0 && !customMode && (
                  <p className="px-3 py-6 text-sm text-slate-400 text-center">Ничего не нашлось</p>
                )}

                {groups.map(({ group, items }) => (
                  <div key={group} className="mb-1">
                    <p className="px-3.5 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      {GROUP_TITLES[group]}
                    </p>
                    {items.map(u => {
                      const isActive = u.id === unit;
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => pick(u.id)}
                          className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-left transition-colors ${
                            isActive ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'active:bg-slate-50 dark:active:bg-slate-700'
                          }`}
                        >
                          <span className={`font-semibold truncate ${
                            isActive ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-200'
                          }`}>
                            {u.name}
                          </span>
                          <span className="shrink-0 text-sm font-bold text-slate-400 dark:text-slate-500">{u.id}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}

                {/* Своя единица — для «пар», «рулон бумаги» и всего, чего нет в списке */}
                <div className="border-t border-slate-100 dark:border-slate-700 mt-2 pt-2">
                  {customMode ? (
                    <div className="px-2 pb-2 flex gap-2">
                      <input
                        value={custom}
                        onChange={e => setCustom(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyCustom(); } }}
                        placeholder="Своя единица"
                        autoFocus
                        autoComplete="off" autoCorrect="off" spellCheck={false}
                        className="flex-1 min-w-0 p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-slate-800 dark:text-white outline-none"
                      />
                      <button
                        type="button"
                        onClick={applyCustom}
                        className="shrink-0 px-4 rounded-xl bg-indigo-600 text-white text-sm font-bold"
                      >
                        Готово
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setCustomMode(true)}
                      className="w-full px-3.5 py-3 rounded-xl text-left text-sm font-semibold text-indigo-600 dark:text-indigo-400 active:bg-slate-50 dark:active:bg-slate-700"
                    >
                      Своя единица{!current && unit ? ` — сейчас «${unit}»` : ''}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  );
};

export default UnitPicker;
