import React from 'react';

/** Кнопка «поменять местами» для пары «Рассрочка / Наличные» (см. src/modeOrder.ts) */
const SwapModesButton: React.FC<{ onClick: () => void; className?: string }> = ({ onClick, className = '' }) => (
  <button type="button" onClick={onClick}
          title="Поменять местами «Рассрочка» и «Наличные»"
          aria-label="Поменять местами «Рассрочка» и «Наличные»"
          className={`glass-surface shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-slate-500 dark:text-slate-300 hover:text-indigo-600 active:scale-95 transition ${className}`}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 4 3 8l4 4" /><path d="M3 8h14" /><path d="m17 20 4-4-4-4" /><path d="M21 16H7" />
    </svg>
  </button>
);

export default SwapModesButton;
