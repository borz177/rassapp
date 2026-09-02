import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface TopBarBackProps {
  onClick: () => void;
  label?: string;
  /** Толкнутым страницам стрелка на десктопе не нужна — там постоянный сайдбар. */
  hideOnDesktop?: boolean;
  /**
   * Стрелка сама по себе, а не внутри шапки страницы. На десктопе такая рисуется
   * заметной кнопкой с подписью: голый значок в углу слоя терялся — его почти не
   * видно и непонятно, что он кликабелен. Внутри чужой шапки подпись, наоборот,
   * лишняя — там рядом заголовок.
   */
  standalone?: boolean;
}

/**
 * Стрелка «назад» отдельным стеклянным пузырём в верхней панели.
 *
 * На телефоне уходит порталом в слот #topbar-back-slot (см. Layout) и встаёт
 * перед названием компании, рядом с колокольчиком. На десктопе верхней панели
 * нет — она md:hidden, — поэтому там стрелка рисуется на своём месте в потоке
 * обычной кнопкой, иначе навигация просто исчезла бы.
 */
// Слот в верхней панели один, а открытых страниц может быть несколько: под
// деталями сотрудника лежит список сотрудников, под деталями инвестора — список
// инвесторов, и обе страницы просят свою стрелку. Раньше нижняя пряталась за
// верхним слоем сама собой, а в общем слоте они встали рядом — было две стрелки.
// Держим стопку и рисуем только верхнюю: последняя смонтированная и есть та
// страница, которую видит пользователь.
const backStack: symbol[] = [];
const backListeners = new Set<() => void>();
const notifyBackStack = () => backListeners.forEach(l => l());

const TopBarBack: React.FC<TopBarBackProps> = ({ onClick, label = 'Назад', hideOnDesktop = false, standalone = false }) => {
  const findSlot = () => {
    if (typeof document === 'undefined') return null;
    return window.matchMedia('(max-width: 767px)').matches
      ? document.getElementById('topbar-back-slot')
      : null;
  };

  // Ищем слот сразу при первом рендере: Layout уже смонтирован к моменту, когда
  // страница открывается. Иначе стрелка кадр помигала бы на старом месте.
  const [slot, setSlot] = useState<HTMLElement | null>(findSlot);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const sync = () => setSlot(findSlot());
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const [token] = useState(() => Symbol('back'));
  const [isTop, setIsTop] = useState(true);
  useEffect(() => {
    backStack.push(token);
    const update = () => setIsTop(backStack[backStack.length - 1] === token);
    backListeners.add(update);
    notifyBackStack();
    return () => {
      const i = backStack.indexOf(token);
      if (i >= 0) backStack.splice(i, 1);
      backListeners.delete(update);
      notifyBackStack();
    };
  }, [token]);

  const arrow = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );

  if (slot) {
    if (!isTop) return null;
    return createPortal(
      <button type="button" onClick={onClick} aria-label={label} className="topbar-back-btn glass-surface">
        {arrow}
      </button>,
      slot
    );
  }

  if (hideOnDesktop) return null;

  if (standalone) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="glass-surface inline-flex items-center gap-1.5 rounded-full pl-3 pr-4 py-2 mb-4 text-sm font-bold text-slate-600 dark:text-slate-200 active:scale-95 transition-transform"
      >
        {arrow}
        <span>{label}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white shrink-0"
    >
      {arrow}
    </button>
  );
};

export default TopBarBack;
