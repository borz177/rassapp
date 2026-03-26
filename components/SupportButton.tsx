import React from 'react';

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
    // Мобильная версия - кнопка в меню
    return (
      <button
        onClick={onClick}
        className="w-full bg-white rounded-xl border border-slate-100 p-4 flex items-center justify-between hover:bg-slate-50 relative"
      >
        <div className="flex items-center gap-3">
          <div className="bg-indigo-100 p-2 rounded-full text-indigo-600">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
            </svg>
          </div>
          <span className="font-medium text-slate-700">Техподдержка</span>
        </div>
        {unreadCount > 0 && (
          <span className="bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 px-1.5 flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
    );
  }

  // Десктопная версия - плавающая кнопка
  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 right-6 w-14 h-14 bg-indigo-600 hover:bg-indigo-700
                 text-white rounded-full shadow-lg shadow-indigo-300
                 flex items-center justify-center transition-all
                 hover:scale-110 active:scale-95 z-40 group"
      aria-label="Техподдержка"
    >
      {/* Иконка чата/поддержки */}
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
           className="group-hover:rotate-3 transition-transform">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
      </svg>

      {/* Счётчик непрочитанных */}
      {unreadCount > 0 && (
        <>
          <span className="absolute -top-1 -right-1 bg-red-500 text-white
                          text-[10px] font-bold rounded-full min-w-[18px] h-[18px]
                          flex items-center justify-center px-1 animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
          <span className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-30"/>
        </>
      )}
    </button>
  );
};

export default SupportButton;