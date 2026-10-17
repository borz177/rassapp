/**
 * «В начало»: касание строки состояния на iPhone (событие statusTap от
 * @capacitor/status-bar) или названия в верхней панели прокручивает к началу
 * то, что сейчас перед глазами.
 *
 * Листается у нас не окно: у толкнутой страницы свой слой (.page-push-layer),
 * у окна-листа — своя область, на Mac с парящими панелями — карточка <main>
 * (src/rootScroll.ts). Поэтому не перечисляем их, а спрашиваем экран: что
 * лежит сверху посередине и какой его предок прокручивается. Припаркованные
 * слои (aria-hidden — под открытым поверх окном) пропускаем.
 */

import { rootScroller } from './rootScroll';

const scrollable = (el: Element): el is HTMLElement =>
  el instanceof HTMLElement
  && el.scrollHeight > el.clientHeight + 1
  && /(auto|scroll)/.test(getComputedStyle(el).overflowY);

/** Область, которая сейчас на экране и листается; null — листается само окно */
export const frontScroller = (): HTMLElement | null => {
  const w = window.innerWidth, h = window.innerHeight;
  // Несколько точек: окно-лист может закрывать только нижнюю часть экрана
  for (const [fx, fy] of [[0.5, 0.5], [0.5, 0.75], [0.5, 0.3]]) {
    const top = document.elementsFromPoint(w * fx, h * fy).find(e => !e.closest('[aria-hidden="true"]'));
    for (let el: Element | null = top || null; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      if (scrollable(el)) return el;
    }
  }
  return rootScroller();
};

export const scrollFrontToTop = (): void => {
  const behavior: ScrollBehavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  const el = frontScroller();
  if (el) el.scrollTo({ top: 0, behavior });
  else window.scrollTo({ top: 0, behavior });
};
