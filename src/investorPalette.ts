// Единая палитра участников: аватары, проценты и суммы используют цвет темы.
// Денежные расчёты от оформления не зависят.
const INVESTOR_PALETTES = [
  { color: '#6366f1', bg: 'bg-indigo-100 dark:bg-indigo-500/20', text: 'text-indigo-700 dark:text-indigo-300', bar: 'bg-indigo-500' },
  { color: '#0ea5e9', bg: 'bg-sky-100 dark:bg-sky-500/20', text: 'text-sky-700 dark:text-sky-300', bar: 'bg-sky-500' },
  { color: '#8b5cf6', bg: 'bg-violet-100 dark:bg-violet-500/20', text: 'text-violet-700 dark:text-violet-300', bar: 'bg-violet-500' },
  { color: '#14b8a6', bg: 'bg-teal-100 dark:bg-teal-500/20', text: 'text-teal-700 dark:text-teal-300', bar: 'bg-teal-500' },
  { color: '#f59e0b', bg: 'bg-amber-100 dark:bg-amber-500/20', text: 'text-amber-700 dark:text-amber-300', bar: 'bg-amber-500' },
  { color: '#f43f5e', bg: 'bg-rose-100 dark:bg-rose-500/20', text: 'text-rose-700 dark:text-rose-300', bar: 'bg-rose-500' },
] as const;

export const MANAGER_PALETTE = {
  color: '#10b981', bg: 'bg-emerald-100 dark:bg-emerald-500/20',
  text: 'text-emerald-700 dark:text-emerald-300', bar: 'bg-emerald-500',
} as const;
export const INVESTOR_GROUP_PALETTE = INVESTOR_PALETTES[0];
export const POOL_PARTICIPANT_PALETTE = INVESTOR_GROUP_PALETTE;
export const FINANCE_ACCENTS = {
  emerald: MANAGER_PALETTE.color, teal: INVESTOR_PALETTES[3].color,
  sky: INVESTOR_PALETTES[1].color, indigo: INVESTOR_PALETTES[0].color,
  purple: INVESTOR_PALETTES[2].color, amber: INVESTOR_PALETTES[4].color,
  red: INVESTOR_PALETTES[5].color,
} as const;

export function investorPalette(_id: string) {
  return POOL_PARTICIPANT_PALETTE;
}

export const POOL_PANEL_CLASS = 'rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800';
export const POOL_COUNT_CLASS = 'shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300';
export const POOL_PROGRESS_CLASS = 'bg-indigo-500';
