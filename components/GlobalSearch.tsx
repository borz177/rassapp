import React, { useEffect, useMemo, useRef, useState } from 'react';
import ModalPortal from './ModalPortal';
import { search, groupHits, KIND_TITLES, SearchData, SearchHit } from '../src/search';

/**
 * Сквозной поиск: одно поле на клиентов, договоры, товары и операции.
 *
 * До него у каждого раздела был свой поиск, и человеку приходилось сперва
 * вспомнить, где искать: клиент — в «Клиентах», его договор — в «Договорах»,
 * товар — на складе. Звонит незнакомый номер, и продавец обходит три экрана.
 *
 * Ищем прямо в памяти по тем данным, что приложение уже загрузило: выдача
 * появляется сразу и работает без сети, а сотрудник видит только то, что ему
 * и так открыто — других данных у него на руках нет.
 */

interface GlobalSearchProps {
  data: SearchData;
  onOpenCustomer: (customerId: string) => void;
  onOpenProducts: () => void;
  onOpenOperations: () => void;
  /** Искать ли в расходах и прочих приходах */
  includeOperations?: boolean;
  /** Вид кнопки: в тёмной боковой панели и в светлой шапке она разная */
  variant?: 'sidebar' | 'topbar';
}

const GlobalSearch: React.FC<GlobalSearchProps> = ({
  data, onOpenCustomer, onOpenProducts, onOpenOperations, includeOperations = true, variant = 'topbar',
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Ctrl+K — привычное сочетание для поиска; на Маке ⌘K.
  //
  // Слушает только копия из бокового меню. Копий на странице две — в шапке
  // телефона и в меню компьютера, — и видна всегда одна, но смонтированы обе:
  // без этого условия одно нажатие открывало бы сразу два окна друг на друге.
  // Клавиатура есть там же, где и меню, так что ничего не теряется.
  useEffect(() => {
    if (variant !== 'sidebar') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [variant]);

  useEffect(() => {
    if (!open) { setQuery(''); setActive(0); return; }
    // Фокус после отрисовки: иначе поле ещё не в документе и клавиатура на
    // телефоне не поднимется.
    const id = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, [open]);

  const hits = useMemo(
    () => search(query, data, { includeOperations }),
    [query, data, includeOperations]
  );
  const groups = useMemo(() => groupHits(hits), [hits]);
  // Стрелки должны ходить ровно по тому порядку, в котором строки видны на
  // экране. Выдача отсортирована по совпадению, а показывается по группам —
  // если считать по ней, подсветка прыгает через строку.
  const flat = useMemo(() => groups.flatMap(g => g.items), [groups]);

  useEffect(() => { setActive(0); }, [query]);

  const go = (hit: SearchHit) => {
    setOpen(false);
    if (hit.kind === 'customer' && hit.customerId) return onOpenCustomer(hit.customerId);
    // У договора открываем карточку клиента: там и сам договор, и график, и
    // история платежей — то, зачем его искали.
    if (hit.kind === 'contract' && hit.customerId) return onOpenCustomer(hit.customerId);
    if (hit.kind === 'product') return onOpenProducts();
    return onOpenOperations();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!flat.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % flat.length); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + flat.length) % flat.length); }
    if (e.key === 'Enter') { e.preventDefault(); go(flat[active]); }
  };

  // Выбранная строка не должна уезжать за край при листании стрелками.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const button = variant === 'sidebar' ? (
    <button
      onClick={() => setOpen(true)}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors text-sm"
      aria-label="Поиск"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <span className="flex-1 text-left">Поиск</span>
      <span className="text-[10px] font-bold text-slate-500 border border-slate-600 rounded px-1.5 py-0.5">Ctrl K</span>
    </button>
  ) : (
    <button
      onClick={() => setOpen(true)}
      className="glass-surface rounded-full pointer-events-auto shrink-0 w-11 h-11 flex items-center justify-center text-slate-600 dark:text-slate-200 active:scale-95 transition-transform"
      aria-label="Поиск"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    </button>
  );

  let index = -1;

  return (
    <>
      {button}

      {open && (
        <ModalPortal onClose={() => setOpen(false)}>
          <div
            className="fixed inset-0 z-modal bg-slate-900/60 backdrop-blur-sm flex items-start justify-center p-0 sm:p-6 sm:pt-24 animate-fade-in"
            onClick={() => setOpen(false)}
          >
            <div
              onClick={e => e.stopPropagation()}
              onKeyDown={onKeyDown}
              className="w-full sm:max-w-xl bg-white dark:bg-slate-800 sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-screen sm:max-h-[70vh] h-full sm:h-auto"
            >
              <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-700 safe-area-top">
                <span className="text-slate-400 shrink-0">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </span>
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  autoComplete="off" autoCorrect="off" spellCheck={false}
                  placeholder="Имя, телефон, номер договора, товар"
                  aria-label="Поиск по всем данным"
                  className="flex-1 bg-transparent outline-none text-base text-slate-800 dark:text-white placeholder:text-slate-400"
                />
                <button
                  onClick={() => setOpen(false)}
                  className="shrink-0 text-sm font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  Закрыть
                </button>
              </div>

              <div ref={listRef} className="flex-1 overflow-y-auto">
                {query.trim().length < 2 ? (
                  <p className="px-4 py-6 text-sm text-slate-400">
                    Введите хотя бы две буквы. Телефон можно набирать как угодно — с восьмёркой, с плюсом или последние цифры.
                  </p>
                ) : hits.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-slate-400">Ничего не нашлось.</p>
                ) : (
                  groups.map(group => (
                    <div key={group.kind}>
                      <p className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                        {KIND_TITLES[group.kind]}
                      </p>
                      {group.items.map(hit => {
                        index += 1;
                        const isActive = index === active;
                        const myIndex = index;
                        return (
                          <button
                            key={`${hit.kind}-${hit.id}`}
                            data-active={isActive}
                            onMouseEnter={() => setActive(myIndex)}
                            onClick={() => go(hit)}
                            className={`w-full text-left px-4 py-2.5 flex flex-col gap-0.5 transition-colors ${
                              isActive ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                            }`}
                          >
                            <span className="text-sm font-semibold text-slate-800 dark:text-white truncate">{hit.title}</span>
                            <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{hit.subtitle}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>

              <div className="hidden sm:flex items-center gap-4 px-4 py-2 border-t border-slate-100 dark:border-slate-700 text-[11px] text-slate-400">
                <span>↑↓ — выбрать</span>
                <span>Enter — открыть</span>
                <span>Esc — закрыть</span>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  );
};

export default GlobalSearch;
