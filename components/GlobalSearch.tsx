import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ModalPortal from './ModalPortal';
import { search, groupHits, KIND_TITLES, SearchData, SearchHit, SearchKind } from '../src/search';

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
 *
 * На телефоне это лист, как в нативных приложениях: выезжает снизу и не доходит
 * до чёлки (под ней видно затемнённый экран — понятно, откуда пришли и куда
 * вернёмся), уезжает обратно тем же движением, смахивается вниз за шапку. На
 * компьютере — окно по центру с подсказками клавиш.
 */

interface GlobalSearchProps {
  data: SearchData;
  onOpenCustomer: (customerId: string) => void;
  /** Открыть сам договор в карточке клиента */
  onOpenContract?: (saleId: string, customerId: string) => void;
  /** Открыть товар: карточку на складе или строку в списке товаров */
  onOpenProducts: (productId?: string) => void;
  /** Открыть ленту операций сразу на этой записи */
  onOpenOperations: (operationId?: string) => void;
  /** Искать ли в расходах и прочих приходах */
  includeOperations?: boolean;
  /** Вид кнопки: в тёмной боковой панели и в светлой шапке она разная */
  variant?: 'sidebar' | 'topbar';
}

type Filter = 'all' | SearchKind;

// Длительность ухода — совпадает с переходом в стилях листа ниже
const OUT_MS = 300;
// Смахнули дальше или быстрее — лист закрывается, иначе возвращается на место
const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 0.6; // px/мс

const RECENT_KEY = 'finuchet_recent_searches';
const RECENT_MAX = 8;

const readRecent = (): string[] => {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(list) ? list.filter(x => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch { return []; }
};
const writeRecent = (list: string[]) => {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* приватный режим — без истории */ }
};

const isPhoneWidth = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches;

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const Icon: React.FC<{ d: React.ReactNode; size?: number; className?: string }> = ({ d, size = 18, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
    {d}
  </svg>
);

const SEARCH_ICON = <><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>;

const KIND_LOOK: Record<SearchKind, { icon: React.ReactNode; tone: string }> = {
  customer: {
    icon: <><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
    tone: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
  },
  contract: {
    icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" /></>,
    tone: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
  product: {
    icon: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.3 7 12 12l8.7-5M12 22V12" /></>,
    tone: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  },
  operation: {
    icon: <><path d="M17 3l4 4-4 4" /><path d="M21 7H7" /><path d="M7 21l-4-4 4-4" /><path d="M3 17h14" /></>,
    tone: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  },
};

// Что и как ищется — пустой экран объясняет это примерами, а не абзацем текста
const TIPS: { kind: SearchKind; text: string }[] = [
  { kind: 'customer', text: 'Клиента — по имени или телефону, хоть по последним цифрам' },
  { kind: 'contract', text: 'Договор — по номеру, товару или сумме' },
  { kind: 'product', text: 'Товар — по названию, артикулу или штрихкоду' },
  { kind: 'operation', text: 'Расход или приход — по названию и сумме' },
];

/** Подсветить в строке то, что набрали: видно, почему строка попала в выдачу */
const Highlight: React.FC<{ text: string; query: string }> = ({ text, query }) => {
  const q = query.trim().toLowerCase();
  const at = q ? text.toLowerCase().indexOf(q) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="bg-transparent text-indigo-600 dark:text-indigo-300">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
};

const GlobalSearch: React.FC<GlobalSearchProps> = ({
  data, onOpenCustomer, onOpenContract, onOpenProducts, onOpenOperations,
  includeOperations = true, variant = 'topbar',
}) => {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  const phone = useRef(false);
  const drag = useRef<{ y0: number; t0: number; dy: number } | null>(null);

  const openSearch = () => {
    phone.current = isPhoneWidth();
    closingRef.current = false;
    setClosing(false);
    setDragY(0);
    setRecent(readRecent());
    setOpen(true);
  };

  // Закрытие с уходом: лист уезжает вниз (окно на компьютере — гаснет), и только
  // потом снимается. Замок синхронный: второй жест приходит раньше отрисовки.
  const requestClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    inputRef.current?.blur();
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
      setDragY(0);
    }, reducedMotion() ? 0 : OUT_MS);
  };

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
        openSearch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [variant]);

  // Фокус — в том же такте, что и нажатие на кнопку: iOS поднимает клавиатуру
  // только в ответ на жест, и фокус из таймера она молча игнорирует.
  useLayoutEffect(() => {
    if (!open) { setQuery(''); setFilter('all'); setActive(0); return; }
    inputRef.current?.focus({ preventScroll: true });
  }, [open]);

  // Клавиатура телефона перекрывает низ листа (WebView не сжимается под неё —
  // см. Keyboard.resize в capacitor.config.ts). Оставляем под списком место,
  // чтобы последние строки можно было докрутить до видимой части.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!open || !vv) return;
    const update = () => setKeyboardInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    update();
    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  }, [open]);

  // Выбрана одна группа — показываем её целиком, а не первые пять
  const hits = useMemo(() => {
    const all = search(query, data, { includeOperations, perKind: filter === 'all' ? 5 : 50 });
    return filter === 'all' ? all : all.filter(h => h.kind === filter);
  }, [query, data, includeOperations, filter]);
  // Счётчики на фильтрах — по полной выдаче, чтобы было видно, где ещё есть совпадения
  const counts = useMemo(() => {
    const result: Partial<Record<SearchKind, number>> = {};
    for (const h of search(query, data, { includeOperations, perKind: 50 })) {
      result[h.kind] = (result[h.kind] || 0) + 1;
    }
    return result;
  }, [query, data, includeOperations]);
  const groups = useMemo(() => groupHits(hits), [hits]);
  // Стрелки должны ходить ровно по тому порядку, в котором строки видны на
  // экране. Выдача отсортирована по совпадению, а показывается по группам —
  // если считать по ней, подсветка прыгает через строку.
  const flat = useMemo(() => groups.flatMap(g => g.items), [groups]);

  useEffect(() => { setActive(0); }, [query, filter]);

  const filters: Filter[] = useMemo(() => {
    const list: Filter[] = ['all', 'customer', 'contract'];
    if ((data.products || []).length) list.push('product');
    if (includeOperations) list.push('operation');
    return list;
  }, [data.products, includeOperations]);

  const remember = (q: string) => {
    const value = q.trim();
    if (value.length < 2) return;
    const next = [value, ...readRecent().filter(x => x.toLowerCase() !== value.toLowerCase())].slice(0, RECENT_MAX);
    writeRecent(next);
  };

  const clearRecent = () => { writeRecent([]); setRecent([]); };

  const go = (hit: SearchHit) => {
    remember(query);
    // Переходим сразу, а лист уезжает поверх уже открытого экрана — так это
    // выглядит в нативных приложениях, без паузы «сначала закрыть, потом открыть».
    requestClose();
    if (hit.kind === 'customer' && hit.customerId) return onOpenCustomer(hit.customerId);
    // Договор открываем сразу развёрнутым — с графиком и историей платежей:
    // именно за ними его и искали. Если открыть просто карточку клиента, нужный
    // договор придётся искать второй раз, уже глазами.
    if (hit.kind === 'contract' && hit.customerId) {
      return onOpenContract
        ? onOpenContract(hit.id, hit.customerId)
        : onOpenCustomer(hit.customerId);
    }
    if (hit.kind === 'product') return onOpenProducts(hit.id);
    return onOpenOperations(hit.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { requestClose(); return; }
    if (!flat.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % flat.length); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + flat.length) % flat.length); }
    if (e.key === 'Enter') { e.preventDefault(); go(flat[active]); }
  };

  // Выбранная строка не должна уезжать за край при листании стрелками.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // Смахивание листа вниз — за шапку (ручка, поле, фильтры). Список под ней
  // листается сам, и тянуть за него значило бы спорить с прокруткой.
  const onDragStart = (e: React.PointerEvent) => {
    if (!phone.current || e.pointerType === 'mouse') return;
    // Нажатие на поле или кнопку — не начало смахивания
    if ((e.target as HTMLElement).closest('input, button')) return;
    drag.current = { y0: e.clientY, t0: performance.now(), dy: 0 };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const raw = e.clientY - drag.current.y0;
    // Вверх лист не тянется: упирается с сопротивлением, как в iOS
    const dy = raw > 0 ? raw : raw / 6;
    drag.current.dy = dy;
    setDragY(dy);
  };
  const onDragEnd = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d) return;
    const velocity = d.dy / Math.max(1, performance.now() - d.t0);
    if (d.dy > DISMISS_DISTANCE || (d.dy > 24 && velocity > DISMISS_VELOCITY)) requestClose();
    else setDragY(0);
  };

  const button = variant === 'sidebar' ? (
    <button
      onClick={openSearch}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors text-sm"
      aria-label="Поиск"
    >
      <Icon d={SEARCH_ICON} size={16} />
      <span className="flex-1 text-left">Поиск</span>
      <span className="text-[10px] font-bold text-slate-500 border border-slate-600 rounded px-1.5 py-0.5">Ctrl K</span>
    </button>
  ) : (
    <button
      onClick={openSearch}
      className="glass-surface rounded-full pointer-events-auto shrink-0 w-11 h-11 flex items-center justify-center text-slate-600 dark:text-slate-200 active:scale-95 transition-transform"
      aria-label="Поиск"
    >
      <Icon d={SEARCH_ICON} size={20} />
    </button>
  );

  const typed = query.trim().length >= 2;
  const isPhone = phone.current;

  // Лист: при уходе уезжает за низ экрана, при смахивании следует за пальцем.
  // Затемнение гаснет вместе с ним. Окно на компьютере при уходе чуть
  // уменьшается и гаснет.
  const panelStyle: React.CSSProperties = isPhone
    ? {
        transform: `translateY(${closing ? '105%' : `${dragY}px`})`,
        transition: dragging ? 'none' : `transform ${OUT_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`,
      }
    : {
        transform: closing ? 'scale(0.97)' : undefined,
        opacity: closing ? 0 : undefined,
        transition: 'transform 180ms ease, opacity 180ms ease',
      };
  const backdropStyle: React.CSSProperties = {
    opacity: closing ? 0 : isPhone ? Math.max(0.35, 1 - Math.max(0, dragY) / 500) : 1,
    transition: dragging ? 'none' : `opacity ${OUT_MS}ms ease`,
  };

  let index = -1;

  return (
    <>
      {button}

      {open && (
        <ModalPortal onClose={requestClose}>
          <div className="fixed inset-0 z-modal flex justify-center sm:items-start sm:p-6 sm:pt-[12vh]">
            <div
              className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px] search-backdrop-in"
              style={backdropStyle}
              onClick={requestClose}
            />

            <div
              role="dialog"
              aria-label="Поиск"
              onKeyDown={onKeyDown}
              style={panelStyle}
              className="search-panel-in relative flex flex-col w-full sm:max-w-xl overflow-hidden
                         bg-white dark:bg-slate-900 shadow-2xl
                         mt-[calc(env(safe-area-inset-top,0px)+10px)] sm:mt-0 rounded-t-[28px] sm:rounded-2xl
                         h-[calc(100%-env(safe-area-inset-top,0px)-10px)] sm:h-auto sm:max-h-[72vh]
                         sm:ring-1 sm:ring-slate-200 dark:sm:ring-slate-700"
            >
              {/* Шапка: ручка, поле, фильтры. За неё лист смахивается вниз */}
              <div
                className="shrink-0 touch-none select-none"
                onPointerDown={onDragStart}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
                onPointerCancel={onDragEnd}
              >
                <div className="sm:hidden flex justify-center pt-2 pb-1">
                  <span className="h-[5px] w-9 rounded-full bg-slate-300 dark:bg-slate-600" />
                </div>

                <div className="flex items-center gap-3 px-4 pt-2 sm:pt-4 pb-3">
                  <div className="flex-1 flex items-center gap-2 h-11 px-3 rounded-xl bg-slate-100 dark:bg-slate-800
                                  focus-within:ring-2 focus-within:ring-indigo-500/40 transition-shadow">
                    <Icon d={SEARCH_ICON} size={18} className="text-slate-400 shrink-0" />
                    <input
                      ref={inputRef}
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      type="search"
                      enterKeyHint="search"
                      autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                      placeholder="Клиент, телефон, договор, товар"
                      aria-label="Поиск по всем данным"
                      className="flex-1 min-w-0 bg-transparent outline-none text-[16px] text-slate-900 dark:text-white
                                 placeholder:text-slate-400 [&::-webkit-search-cancel-button]:hidden"
                    />
                    {query && (
                      <button
                        type="button"
                        onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                        aria-label="Очистить"
                        className="shrink-0 w-5 h-5 rounded-full bg-slate-400/80 dark:bg-slate-500 text-white flex items-center justify-center active:scale-90 transition-transform"
                      >
                        <Icon d={<path d="M18 6 6 18M6 6l12 12" />} size={11} />
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={requestClose}
                    className="shrink-0 text-[15px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-60"
                  >
                    Отмена
                  </button>
                </div>

                {typed && (
                  <div className="flex gap-2 px-4 pb-3 overflow-x-auto">
                    {filters.map(f => {
                      const count = f === 'all' ? undefined : counts[f] || 0;
                      const on = filter === f;
                      return (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setFilter(f)}
                          className={`shrink-0 h-8 px-3 rounded-full text-[13px] font-semibold transition-colors flex items-center gap-1.5 ${
                            on
                              ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {f === 'all' ? 'Все' : KIND_TITLES[f]}
                          {count !== undefined && (
                            <span className={on ? 'opacity-60' : 'text-slate-400 dark:text-slate-500'}>{count}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="h-px bg-slate-100 dark:bg-slate-800" />
              </div>

              <div
                ref={listRef}
                className="flex-1 overflow-y-auto overscroll-contain"
                style={{ paddingBottom: `calc(${keyboardInset}px + env(safe-area-inset-bottom, 0px) + 12px)` }}
              >
                {!typed ? (
                  <div key="idle" className="search-fade-in">
                    {recent.length > 0 && (
                      <section className="pt-2">
                        <div className="flex items-center justify-between px-4 py-2">
                          <p className="text-[13px] font-semibold text-slate-900 dark:text-white">Недавние</p>
                          <button type="button" onClick={clearRecent}
                                  className="text-[13px] font-medium text-indigo-600 dark:text-indigo-400 active:opacity-60">
                            Очистить
                          </button>
                        </div>
                        {recent.map(q => (
                          <button
                            key={q}
                            type="button"
                            onClick={() => { setQuery(q); inputRef.current?.focus(); }}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-left active:bg-slate-100 dark:active:bg-slate-800 transition-colors"
                          >
                            <Icon d={<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>} size={18} className="text-slate-400 shrink-0" />
                            <span className="flex-1 truncate text-[15px] text-slate-700 dark:text-slate-200">{q}</span>
                            <Icon d={<path d="M7 17 17 7M8 7h9v9" />} size={16} className="text-slate-300 dark:text-slate-600 shrink-0" />
                          </button>
                        ))}
                      </section>
                    )}

                    <section className="px-4 pt-4 pb-2">
                      <p className="text-[13px] font-semibold text-slate-900 dark:text-white mb-3">Что можно найти</p>
                      <div className="space-y-2.5">
                        {TIPS.filter(t => filters.includes(t.kind)).map(t => (
                          <div key={t.kind} className="flex items-center gap-3">
                            <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${KIND_LOOK[t.kind].tone}`}>
                              <Icon d={KIND_LOOK[t.kind].icon} size={18} />
                            </span>
                            <span className="text-[14px] leading-snug text-slate-600 dark:text-slate-300">{t.text}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                ) : hits.length === 0 ? (
                  <div key="empty" className="search-fade-in flex flex-col items-center text-center px-8 pt-14">
                    <span className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mb-4">
                      <Icon d={SEARCH_ICON} size={26} />
                    </span>
                    <p className="text-[16px] font-semibold text-slate-900 dark:text-white">Ничего не нашлось</p>
                    <p className="mt-1.5 text-[14px] leading-snug text-slate-500 dark:text-slate-400">
                      {filter === 'all'
                        ? 'Проверьте написание или наберите последние цифры телефона.'
                        : `В разделе «${KIND_TITLES[filter]}» совпадений нет.`}
                    </p>
                    {filter !== 'all' && (
                      <button type="button" onClick={() => setFilter('all')}
                              className="mt-4 text-[14px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-60">
                        Искать везде
                      </button>
                    )}
                  </div>
                ) : (
                  <div key="results">
                    {groups.map(group => (
                      <section key={group.kind}>
                        {/* Заголовок группы прилипает к верху, пока листаешь её строки */}
                        <p className="sticky top-0 z-10 px-4 pt-3 pb-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-400
                                      bg-white/90 dark:bg-slate-900/90 backdrop-blur">
                          {KIND_TITLES[group.kind]}
                        </p>
                        {group.items.map(hit => {
                          index += 1;
                          const isActive = index === active;
                          const myIndex = index;
                          return (
                            <button
                              key={`${hit.kind}-${hit.id}`}
                              type="button"
                              data-active={isActive}
                              onMouseEnter={() => setActive(myIndex)}
                              onClick={() => go(hit)}
                              className={`w-full text-left flex items-center gap-3 px-4 py-2.5 transition-colors
                                active:bg-slate-100 dark:active:bg-slate-800 ${
                                isActive ? 'sm:bg-indigo-50 sm:dark:bg-indigo-500/10' : ''
                              }`}
                            >
                              <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${KIND_LOOK[hit.kind].tone}`}>
                                <Icon d={KIND_LOOK[hit.kind].icon} size={18} />
                              </span>
                              <span className="flex-1 min-w-0">
                                <span className="block text-[15px] font-semibold text-slate-900 dark:text-white truncate">
                                  <Highlight text={hit.title} query={query} />
                                </span>
                                <span className="block text-[13px] text-slate-500 dark:text-slate-400 truncate">{hit.subtitle}</span>
                              </span>
                              <Icon d={<path d="m9 18 6-6-6-6" />} size={16} className="text-slate-300 dark:text-slate-600 shrink-0" />
                            </button>
                          );
                        })}
                      </section>
                    ))}
                  </div>
                )}
              </div>

              <div className="hidden sm:flex items-center gap-4 px-4 py-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-400">
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
