import { useEffect, useLayoutEffect, type RefObject } from 'react';
import { getScrollPosition, saveScrollPosition } from '../scrollMemory';

/**
 * Запоминает и восстанавливает прокрутку под ключом `key` — как в мобильных приложениях,
 * где список открывается там же, где его оставили, а не с самого верха.
 *
 * Без `ref` следит за прокруткой окна (для "базовых" экранов вроде Клиентов, которые
 * не оборачиваются в PagePush и скроллятся через document/body). С `ref` — за конкретным
 * элементом (используется в PagePush для "выехавших" страниц со своим overflow-y).
 *
 * `active` — необязательный флаг: когда он переключается в true, позиция переустанавливается
 * повторно. Нужен для страниц, которые не размонтируются при переходе на дочерний экран
 * (Клиенты остаются под карточкой клиента) — обычный layout-эффект в этом случае не
 * перезапустится сам, а страховка от неожиданного сброса скролла браузером нужна.
 */
export function useScrollRestoration(
  key: string | null | undefined,
  ref?: RefObject<HTMLElement | null>,
  active: boolean = true,
) {
  useLayoutEffect(() => {
    if (!key || !active) return;
    const y = getScrollPosition(key);
    if (ref) {
      if (ref.current) ref.current.scrollTop = y;
    } else {
      window.scrollTo(0, y);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active]);

  useEffect(() => {
    if (!key) return;
    const target: EventTarget = ref?.current ?? window;
    const read = () => (ref?.current ? ref.current.scrollTop : window.scrollY);

    // Держим последнее значение в переменной, а не перечитываем DOM в cleanup: React
    // отвязывает ref от узла (ref.current становится null) до того, как отрабатывают
    // cleanup-функции обычных useEffect (в отличие от useLayoutEffect) — без этого
    // финальный снимок при размонтировании молча съезжал на window.scrollY (обычно ~0)
    // вместо настоящей прокрутки списка.
    let last = read();
    let raf = 0;
    const onScroll = () => {
      last = read();
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        saveScrollPosition(key, last);
      });
    };

    target.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      target.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
      saveScrollPosition(key, last);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ref?.current]);
}
