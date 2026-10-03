import React, { useState } from 'react';

/**
 * Плитки или список — для списков в приложении Mac/Windows (Клиенты, Инвесторы).
 * По умолчанию — привычный список; выбор свой у каждого списка и запоминается.
 */
export type ViewMode = 'tiles' | 'list';

export const useViewMode = (key: string): [ViewMode, (m: ViewMode) => void] => {
  const storageKey = `finuchet_view_${key}`;
  const [mode, setMode] = useState<ViewMode>(() => {
    try { return localStorage.getItem(storageKey) === 'tiles' ? 'tiles' : 'list'; } catch { return 'list'; }
  });
  const set = (m: ViewMode) => {
    setMode(m);
    try { localStorage.setItem(storageKey, m); } catch { /* не критично */ }
  };
  return [mode, set];
};

const ViewModeToggle: React.FC<{ value: ViewMode; onChange: (m: ViewMode) => void }> = ({ value, onChange }) => (
  <div role="radiogroup" aria-label="Вид списка" className="glass-surface flex items-center gap-0.5 p-1 rounded-full">
    {([
      ['tiles', 'Плитки', <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>],
      ['list', 'Список', <><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>],
    ] as const).map(([id, label, icon]) => (
      <button key={id} type="button" role="radio" aria-checked={value === id} title={label}
              onClick={() => onChange(id)}
              className={`w-9 h-8 flex items-center justify-center rounded-full transition-colors ${
                value === id ? 'mode-seg-on bg-indigo-600 text-white shadow-sm' : 'text-slate-500 dark:text-slate-300 hover:text-indigo-600'
              }`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>
      </button>
    ))}
  </div>
);

export default ViewModeToggle;
