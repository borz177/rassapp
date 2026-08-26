import React, { useState } from 'react';
import ModalPortal from './ModalPortal';

export interface SelectSheetOption {
  id: string;
  name: string;
  /** Пояснение справа в списке — например баланс счёта */
  hint?: string;
}

interface SelectSheetProps {
  label?: string;
  /** Заголовок листа; по умолчанию совпадает с label */
  title?: string;
  value: string;
  options: SelectSheetOption[];
  onChange: (id: string) => void;
}

/**
 * Выбор одного значения нижним листом вместо системного <select>.
 *
 * Нативный список на телефоне открывается колесом поверх всего экрана, живёт по
 * своим правилам оформления и не умеет показывать ничего, кроме строки текста.
 * Здесь рядом со значением видно пояснение (баланс счёта), а сам лист выглядит
 * как остальные окна приложения.
 *
 * Лист уходит порталом в body: на страницах он часто оказывается внутри блока с
 * анимацией появления, а та задаёт transform — и position: fixed цепляется за
 * неё вместо экрана, лист не доходит до краёв. См. ModalPortal.
 */
const SelectSheet: React.FC<SelectSheetProps> = ({ label, title, value, options, onChange }) => {
  const [open, setOpen] = useState(false);
  const current = options.find(o => o.id === value);
  // Выбирать не из чего — показываем значение, но не делаем его кнопкой.
  const disabled = options.length < 2;

  return (
    <div>
      {label && (
        <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5 block">
          {label}
        </label>
      )}
      <button
        type="button"
        onClick={() => !disabled && setOpen(true)}
        aria-disabled={disabled}
        className={`w-full flex items-center justify-between gap-2 p-2.5 sm:p-3 rounded-xl border text-sm font-semibold text-left transition-colors
          bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300
          ${disabled ? 'opacity-70' : 'active:scale-[0.99]'}`}
      >
        <span className="truncate">{current?.name ?? '—'}</span>
        {!disabled && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
               strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 shrink-0">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>

      {open && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-modal flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
            onClick={() => setOpen(false)}
          >
            <div
              className="bg-white dark:bg-slate-800 w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[70vh] flex flex-col animate-slide-up-sheet"
              onClick={e => e.stopPropagation()}
            >
              <div className="px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-700">
                <h3 className="font-bold text-slate-800 dark:text-white">{title ?? label ?? 'Выбор'}</h3>
              </div>
              <div className="p-2 overflow-y-auto">
                {options.map(o => {
                  const isActive = o.id === value;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => { onChange(o.id); setOpen(false); }}
                      className={`w-full flex items-center justify-between gap-3 px-3.5 py-3 rounded-xl text-left transition-colors ${
                        isActive ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'active:bg-slate-50 dark:active:bg-slate-700'
                      }`}
                    >
                      <span className={`font-semibold truncate ${
                        isActive ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-200'
                      }`}>
                        {o.name}
                      </span>
                      {o.hint && (
                        <span className="shrink-0 text-sm font-bold text-slate-500 dark:text-slate-400">{o.hint}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};

export default SelectSheet;
