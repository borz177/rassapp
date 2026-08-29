import React from 'react';
import { createPortal } from 'react-dom';
import { useBackInterceptor } from './transitions/PagePush';

/**
 * Выносит модальное окно из текущего поддерева прямо в document.body.
 *
 * Зачем: почти все экраны приложения отрисованы внутри PagePush, а его слой
 * `.page-push-layer` имеет `position: fixed`. Позиция fixed создаёт новый
 * контекст наложения САМА ПО СЕБЕ, независимо от z-index — это поведение
 * Chrome и Safari по спецификации. Из-за этого любое окно, отрисованное внутри
 * такого экрана, оказывается прижато к уровню слоя (z-index: 30) и перекрывается
 * нижней навигацией (z-50). Увеличивать z-index у самого окна бесполезно:
 * оно сравнивается с навигацией не напрямую, а через свой контекст.
 *
 * Портал переносит разметку в конец body — там окно попадает в корневой
 * контекст наложения, и класс .z-modal (z-index: 100) наконец работает.
 *
 * Использование:
 *   {isOpen && (
 *     <ModalPortal onClose={() => setOpen(false)}>
 *       <div className="fixed inset-0 z-modal …">…</div>
 *     </ModalPortal>
 *   )}
 *
 * `onClose` необязателен, но его стоит передавать всегда: без него
 * свайп назад и аппаратная кнопка Android закроют СТРАНИЦУ ПОД окном,
 * а само окно останется висеть над чужим экраном.
 */
interface ModalPortalProps {
  children: React.ReactNode;
  /** Закрытие по шагу «назад»: свайп от края и кнопка Android */
  onClose?: () => void;
}

const ModalPortal: React.FC<ModalPortalProps> = ({ children, onClose }) => {
  // Открытое окно — верхний шаг в стеке, и «назад» принадлежит ему: иначе
  // жест закрывал бы страницу под окном и окно оставалось бы над чужим экраном.
  useBackInterceptor(!!onClose, () => onClose?.());
  // document.body существует к моменту рендера в браузере; на всякий случай
  // (SSR/тесты) возвращаем содержимое как есть, а не падаем.
  if (typeof document === 'undefined') return <>{children}</>;
  return createPortal(children, document.body);
};

export default ModalPortal;
