import React from 'react';
import { createPortal } from 'react-dom';

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
 *     <ModalPortal>
 *       <div className="fixed inset-0 z-modal …">…</div>
 *     </ModalPortal>
 *   )}
 */
const ModalPortal: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // document.body существует к моменту рендера в браузере; на всякий случай
  // (SSR/тесты) возвращаем содержимое как есть, а не падаем.
  if (typeof document === 'undefined') return <>{children}</>;
  return createPortal(children, document.body);
};

export default ModalPortal;
