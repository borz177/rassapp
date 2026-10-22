import { useEffect, useRef, useState } from 'react';

/**
 * Длинный список рисуем частями: сначала `step` строк, следующие — когда до конца
 * осталось меньше ~1,5 экрана. Тысяча договоров или операций одним махом —
 * это тысячи DOM-узлов (у каждой строки свайп, иконки, бейджи), и переход на
 * страницу замирал на секунду и больше.
 *
 * Сколько строк уже показано, помним по `key` на время сеанса — как и прокрутку
 * (scrollMemory): вернувшись со страницы договора, список открывается той же длины,
 * и прокрутка встаёт на прежнее место. `resetKey` — фильтры, вкладка, поиск:
 * когда они меняются, снова начинаем с первых строк.
 */
const shownByKey = new Map<string, { count: number; reset: string }>();

export function useProgressiveList<T>(items: T[], key: string, resetKey: string, step = 40) {
  const [count, setCount] = useState(() => {
    const saved = shownByKey.get(key);
    return saved && saved.reset === resetKey ? Math.max(step, saved.count) : step;
  });
  const first = useRef(true);
  useEffect(() => {
    // Первый запуск — значение уже взято из памяти
    if (first.current) { first.current = false; return; }
    setCount(step);
  }, [resetKey, step]);
  useEffect(() => {
    shownByKey.set(key, { count, reset: resetKey });
  }, [key, count, resetKey]);

  const sentinel = useRef<HTMLDivElement | null>(null);
  const hasMore = count < items.length;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setCount((c) => Math.min(items.length, c + step));
      },
      { rootMargin: '1200px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, items.length, step, count]);

  return {
    visible: hasMore ? items.slice(0, count) : items,
    hasMore,
    sentinel,
    /** Показать строку с этим номером (переход из поиска к записи в глубине списка) */
    reveal: (index: number) => setCount((c) => Math.max(c, index + 1)),
  };
}
