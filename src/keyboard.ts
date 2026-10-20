/**
 * Экранная клавиатура телефона «как в нативных приложениях».
 *
 * Окно под клавиатуру не сжимается (Capacitor Keyboard.resize: 'none', Safari
 * и PWA на iPhone тоже), поэтому всё делаем сами:
 *  • installKeyboardClass — пока открыта клавиатура, на <html> класс kb-open:
 *    нижняя навигация (класс .kb-hide) уезжает вниз, как панель вкладок в
 *    нативных приложениях; иначе iPhone при прокрутке тянул её вверх вместе со
 *    страницей;
 *  • useKeyboardAvoidance — форма в прокручиваемом слое: касание поля не дёргает
 *    страницу (iPhone сам прокручивал её к полю рывком), а слой плавно, по кривой
 *    клавиатуры, доезжает так, чтобы поле встало над ней; снизу на это время —
 *    запас места, на закрытии — плавно обратно.
 * Высота клавиатуры — та же, что запоминает страница ИИ (общий ключ).
 */
import { useEffect, type RefObject } from 'react';
import { animateScrollTop, KEYBOARD_MS } from './easing';

const coarse = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

/** Ключ запомненной высоты клавиатуры — общий со страницей ИИ (AIAssistant.tsx) */
export const kbStorageKey = () => `finuchet_ai_kb_${window.innerWidth > window.innerHeight ? 'l' : 'p'}`;
export const readSavedKeyboard = (): number => {
  try { const v = Number(localStorage.getItem(kbStorageKey())) || 0; return v > 80 ? v : 0; } catch { return 0; }
};
const saveKeyboard = (k: number) => { try { localStorage.setItem(kbStorageKey(), String(k)); } catch { /* без памяти */ } };

/** Поле, которое открывает клавиатуру (не выпадающий список и не выбор даты — у них свои барабаны) */
const TEXT_TYPES = new Set(['text', 'number', 'tel', 'email', 'search', 'url', 'password', '']);
export const isTextField = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement => {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return !(el as HTMLTextAreaElement).readOnly;
  if (el.tagName !== 'INPUT') return false;
  const input = el as HTMLInputElement;
  return TEXT_TYPES.has((input.getAttribute('type') || '').toLowerCase()) && !input.readOnly && !input.disabled;
};

/** Текущая высота клавиатуры по видимой области (0 — закрыта) */
const keyboardNow = (): number => {
  const vv = window.visualViewport;
  if (!vv) return 0;
  const layoutH = Math.max(window.innerHeight, document.documentElement.clientHeight);
  const k = Math.round(layoutH - vv.height);
  return k > 80 ? k : 0;
};

/** Класс kb-open на <html>, пока на телефоне в фокусе поле ввода */
export function installKeyboardClass() {
  if (typeof window === 'undefined' || !coarse()) return;
  const root = document.documentElement;
  let off = 0;
  document.addEventListener('focusin', (e) => {
    const t = e.target as Element;
    if (!isTextField(t) && !(t as HTMLElement)?.isContentEditable) return;
    window.clearTimeout(off);
    root.classList.add('kb-open');
  });
  // Фокус переходит с поля на поле — не мигаем панелью
  document.addEventListener('focusout', () => {
    window.clearTimeout(off);
    off = window.setTimeout(() => {
      if (!isTextField(document.activeElement)) root.classList.remove('kb-open');
    }, 120);
  });
  // Страховка: страницу закрыли, пока поле было в фокусе, — iPhone не присылает
  // focusout для удалённого поля, и навигация оставалась спрятанной. Ни одно поле
  // не в фокусе (касание, смена размера экрана) — значит, клавиатуры нет
  const settle = () => {
    if (root.classList.contains('kb-open') && !isTextField(document.activeElement) && !(document.activeElement as HTMLElement)?.isContentEditable) {
      root.classList.remove('kb-open');
    }
  };
  document.addEventListener('touchstart', settle, { capture: true, passive: true });
  window.visualViewport?.addEventListener('resize', settle);
  window.addEventListener('popstate', () => window.setTimeout(settle, 50));
}

const scrollParent = (el: HTMLElement | null): HTMLElement | null => {
  let p = el?.parentElement || null;
  while (p && !(p.scrollHeight > p.clientHeight && /auto|scroll/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
  return p;
};

/**
 * Форма в прокручиваемом слое (PagePush): поле ввода встаёт над клавиатурой
 * плавно, без рывка iPhone. rootRef — корень формы.
 */
export function useKeyboardAvoidance(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !coarse() || !window.visualViewport) return;
    const vv = window.visualViewport;
    let stop = () => {};
    let focusAt = 0;
    let pad = 0;
    let shrink = 0;
    const basePad = parseFloat(getComputedStyle(root).paddingBottom) || 0;
    const setPad = (k: number) => { pad = k; root.style.paddingBottom = k ? `${basePad + k}px` : ''; };

    // Поднять слой так, чтобы поле встало над клавиатурой (если оно под ней)
    const reveal = (field: HTMLElement, k: number) => {
      const scroller = scrollParent(root);
      if (!scroller || !k) return;
      if (pad < k) setPad(k);
      const layoutH = Math.max(window.innerHeight, document.documentElement.clientHeight);
      const r = field.getBoundingClientRect();
      const visibleBottom = layoutH - k - 16;
      const topLimit = 96; // ниже верхних кнопок
      let delta = 0;
      if (r.bottom > visibleBottom) delta = r.bottom - visibleBottom;
      else if (r.top < topLimit) delta = r.top - topLimit;
      if (Math.abs(delta) < 4) return;
      stop();
      stop = animateScrollTop(scroller, scroller.scrollTop + delta);
    };

    // Касание текстового поля: фокус без прокрутки iPhone — двигаем сами.
    // Палец повёл — это прокрутка формы, а не выбор поля: не трогаем
    let startX = 0, startY = 0;
    const onTouchStart = (e: TouchEvent) => { startX = e.touches[0]?.clientX ?? 0; startY = e.touches[0]?.clientY ?? 0; };
    const onTouchEnd = (e: TouchEvent) => {
      const t = e.target as Element;
      if (!isTextField(t) || document.activeElement === t) return;
      const p = e.changedTouches[0];
      if (p && (Math.abs(p.clientX - startX) > 10 || Math.abs(p.clientY - startY) > 10)) return;
      e.preventDefault();
      (t as HTMLElement).focus({ preventScroll: true });
    };
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement;
      if (!isTextField(t)) return;
      window.clearTimeout(shrink);
      focusAt = Date.now();
      const k = keyboardNow() || readSavedKeyboard();
      reveal(t, k);
      // Высота уточнится, когда клавиатура выедет до конца
      window.setTimeout(() => { const kk = keyboardNow(); if (kk && document.activeElement === t) { saveKeyboard(kk); reveal(t, kk); } }, KEYBOARD_MS + 120);
    };
    // Клавиатура закрылась: слой плавно возвращается, запас снизу убираем после
    const onFocusOut = () => {
      window.clearTimeout(shrink);
      shrink = window.setTimeout(() => {
        if (isTextField(document.activeElement) || !pad) return;
        const scroller = scrollParent(root);
        if (scroller) {
          const max = scroller.scrollHeight - pad - scroller.clientHeight;
          if (scroller.scrollTop > max) { stop(); stop = animateScrollTop(scroller, max); }
        }
        window.setTimeout(() => { if (!isTextField(document.activeElement)) setPad(0); }, KEYBOARD_MS + 20);
      }, 120);
    };
    // iPhone всё же сдвинул страницу целиком к полю — сразу возвращаем (первые 700 мс)
    const snapBack = () => {
      if (Date.now() - focusAt > 700 || !isTextField(document.activeElement)) return;
      if (window.scrollY > 0 || vv.offsetTop > 0) window.scrollTo(0, 0);
    };
    const stopOnTouch = () => stop();

    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchend', onTouchEnd, { passive: false });
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);
    window.addEventListener('scroll', snapBack, { passive: true });
    vv.addEventListener('scroll', snapBack);
    vv.addEventListener('resize', snapBack);
    root.addEventListener('touchmove', stopOnTouch, { passive: true });
    return () => {
      stop();
      window.clearTimeout(shrink);
      setPad(0);
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchend', onTouchEnd);
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('scroll', snapBack);
      vv.removeEventListener('scroll', snapBack);
      vv.removeEventListener('resize', snapBack);
      root.removeEventListener('touchmove', stopOnTouch);
    };
  }, [rootRef]);
}
