import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface TopBarBackProps {
  onClick: () => void;
  label?: string;
  /** Толкнутым страницам стрелка на десктопе не нужна — там постоянный сайдбар. */
  hideOnDesktop?: boolean;
}

/**
 * Стрелка «назад» отдельным стеклянным пузырём в верхней панели.
 *
 * На телефоне уходит порталом в слот #topbar-back-slot (см. Layout) и встаёт
 * перед названием компании, рядом с колокольчиком. На десктопе верхней панели
 * нет — она md:hidden, — поэтому там стрелка рисуется на своём месте в потоке
 * обычной кнопкой, иначе навигация просто исчезла бы.
 */
const TopBarBack: React.FC<TopBarBackProps> = ({ onClick, label = 'Назад', hideOnDesktop = false }) => {
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

  const arrow = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );

  if (slot) {
    return createPortal(
      <button onClick={onClick} aria-label={label} className="topbar-back-btn glass-surface">
        {arrow}
      </button>,
      slot
    );
  }

  if (hideOnDesktop) return null;

  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white shrink-0"
    >
      {arrow}
    </button>
  );
};

export default TopBarBack;
