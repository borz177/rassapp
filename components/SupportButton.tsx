import React from 'react';
import { ICONS } from '../constants';

interface SupportButtonProps {
  unreadCount: number;
  onClick: () => void;           // Для пользователей: открыть чат
  onAdminClick?: () => void;     // Для админа: перейти в панель поддержки
  userRole?: string;             // 'admin' | 'manager' | 'employee' | 'investor'
  isMobile?: boolean;
}

const SupportButton: React.FC<SupportButtonProps> = ({
  unreadCount,
  onClick,
  onAdminClick,
  userRole = '',
  isMobile = false
}) => {
  const isAdmin = userRole === 'admin';

  // 🔹 Обработчик клика с учётом роли
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isAdmin && onAdminClick) {
      // Админ → переход в панель поддержки
      onAdminClick();
    } else {
      // Пользователь → открыть чат
      onClick();
    }
  };

  // 📱 Мобильная версия
  if (isMobile) {
    return (
      <button
        onClick={handleClick}
        className="w-full bg-white rounded-xl border border-slate-100 p-4
                   flex items-center justify-between hover:bg-slate-50
                   active:bg-slate-100 transition-colors relative"
        aria-label={isAdmin ? "Панель поддержки" : "Открыть техподдержку"}
      >
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-full ${
            isAdmin ? 'bg-purple-100 text-purple-600' : 'bg-indigo-100 text-indigo-600'
          }`}>
            {isAdmin ? ICONS.Crown : ICONS.Chat}
          </div>
          <span className="font-medium text-slate-700">
            {isAdmin ? 'Панель поддержки' : 'Техподдержка'}
          </span>
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
      onClick={handleClick}
      className={`fixed bottom-6 right-6 w-14 h-14
                 text-white rounded-full shadow-lg
                 flex items-center justify-center
                 transition-all duration-200
                 hover:scale-110 active:scale-95
                 z-40 group ${
                   isAdmin 
                     ? 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 shadow-purple-300/50' 
                     : 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 shadow-indigo-300/50'
                 }`}
      aria-label={isAdmin ? "Панель поддержки" : "Открыть техподдержку"}
      title={isAdmin ? "Панель поддержки (админ)" : "Техподдержка"}
    >
      {/* Иконка с анимацией */}
      <div className="group-hover:rotate-3 transition-transform duration-200">
        {isAdmin ? ICONS.Crown : ICONS.Chat}
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
          {/* Пульсирующее кольцо */}
          <span
            className="absolute inset-0 rounded-full
                       bg-red-500 animate-ping opacity-30"
            aria-hidden="true"
          />
        </>
      )}

      {/* Тултип при наведении */}
      <span className="absolute right-16 top-1/2 -translate-y-1/2
                       bg-slate-800 text-white text-xs px-3 py-1.5
                       rounded-lg opacity-0 group-hover:opacity-100
                       transition-opacity whitespace-nowrap pointer-events-none shadow-lg">
        {isAdmin ? 'Панель поддержки' : 'Техподдержка'}
      </span>
    </button>
  );
};

export default SupportButton;