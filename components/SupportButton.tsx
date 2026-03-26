// components/SupportButton.tsx
import React from 'react';
import { ICONS } from '../constants';

interface SupportButtonProps {
  unreadCount: number;
  onClick: () => void;
  isMobile?: boolean;
}

const SupportButton: React.FC<SupportButtonProps> = ({
  unreadCount,
  onClick,
  isMobile = false
}) => {
  if (isMobile) {
    // 📱 Мобильная версия - кнопка в меню "Ещё"
    return (
      <button
        onClick={onClick}
        className="w-full bg-white rounded-xl border border-slate-100 p-4
                   flex items-center justify-between hover:bg-slate-50
                   active:bg-slate-100 transition-colors relative"
        aria-label="Открыть техподдержку"
      >
        <div className="flex items-center gap-3">
          <div className="bg-indigo-100 p-2 rounded-full text-indigo-600">
            {ICONS.Chat}
          </div>
          <span className="font-medium text-slate-700">Техподдержка</span>
        </div>

        {/* 🔴 Счётчик непрочитанных */}
        {unreadCount > 0 && (
          <span
            className="bg-red-500 text-white text-xs font-bold
                       rounded-full min-w-[20px] h-5 px-1.5
                       flex items-center justify-center animate-bounce"
            aria-label={`${unreadCount} непрочитанных сообщений`}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
    );
  }

  // 💻 Десктопная версия - плавающая кнопка
  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 right-6 w-14 h-14
                 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800
                 text-white rounded-full shadow-lg shadow-indigo-300/50
                 flex items-center justify-center
                 transition-all duration-200
                 hover:scale-110 active:scale-95
                 z-40 group"
      aria-label="Открыть техподдержку"
    >
      {/* Иконка чата с анимацией при наведении */}
      <div className="group-hover:rotate-3 transition-transform duration-200">
        {ICONS.Chat}
      </div>

      {/* 🔴 Счётчик непрочитанных */}
      {unreadCount > 0 && (
        <>
          <span
            className="absolute -top-1 -right-1
                       bg-red-500 text-white
                       text-[10px] font-bold
                       rounded-full min-w-[18px] h-[18px]
                       flex items-center justify-center px-1
                       animate-pulse"
            aria-label={`${unreadCount} непрочитанных сообщений`}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
          {/* Пульсирующее кольцо для привлечения внимания */}
          <span
            className="absolute inset-0 rounded-full
                       bg-red-500 animate-ping opacity-30"
            aria-hidden="true"
          />
        </>
      )}
    </button>
  );
};

export default SupportButton;