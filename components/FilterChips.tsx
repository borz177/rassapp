import React from 'react';

/**
 * Кнопки-«пилюли» окон фильтра (Журнал, Договоры): выбранная — синяя с галочкой.
 */
export const FilterChip: React.FC<{ on: boolean; onClick: () => void; children: React.ReactNode }> = ({ on, onClick, children }) => (
  <button type="button" onClick={onClick} aria-pressed={on}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-semibold transition-all active:scale-95 ${on
            ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
            : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/15'}`}>
    {on && (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
    )}
    {children}
  </button>
);

export const ChipGroup: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <p className="text-[12px] font-medium text-slate-400 dark:text-slate-500 mb-2">{label}</p>
    <div className="flex flex-wrap gap-2">{children}</div>
  </div>
);

