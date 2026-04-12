import React from 'react';
import { APP_NAME } from '../constants.tsx';

interface CustomTitleBarProps {
  backgroundColor?: string;
  textColor?: string;
}

const CustomTitleBar: React.FC<CustomTitleBarProps> = ({
  backgroundColor = 'var(--navbar-bg)',
  textColor = 'var(--navbar-text)'
}) => {
  return (
    <div
      className="flex items-center justify-between h-11 px-3 select-none"
      style={{
        backgroundColor,
        color: textColor,
        WebkitAppRegion: 'drag',  // 🔹 Позволяет перетаскивать окно
        borderBottom: '1px solid var(--navbar-border)'
      }}
    >
      {/* Левая часть: Логотип + Название */}
      <div className="flex items-center gap-2">
        <div
          className="w-5 h-5 rounded flex items-center justify-center text-xs font-bold"
          style={{ backgroundColor: 'var(--color-primary-400)', color: '#fff' }}
        >
          Ф
        </div>
        <span className="text-sm font-semibold tracking-wide">{APP_NAME}</span>
      </div>

      {/* Правая часть: Кнопки управления окном */}
      <div
        className="flex items-center gap-0"
        style={{ WebkitAppRegion: 'no-drag' }}  // 🔹 Кнопки не draggable
      >
        {/* Minimize */}
        <button
          onClick={() => window.electronAPI?.minimize()}
          className="w-12 h-11 flex items-center justify-center hover:bg-white/10 transition-colors"
          title="Свернуть"
        >
          <svg width="10" height="1" viewBox="0 0 10 1">
            <rect width="10" height="1" fill="currentColor"/>
          </svg>
        </button>

        {/* Maximize/Restore */}
        <button
          onClick={() => window.electronAPI?.maximize()}
          className="w-12 h-11 flex items-center justify-center hover:bg-white/10 transition-colors"
          title="Развернуть"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0.5" y="0.5" width="9" height="9"/>
          </svg>
        </button>

        {/* Close */}
        <button
          onClick={() => window.electronAPI?.close()}
          className="w-12 h-11 flex items-center justify-center hover:bg-red-600 transition-colors"
          title="Закрыть"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2">
            <line x1="0.5" y1="0.5" x2="9.5" y2="9.5"/>
            <line x1="9.5" y1="0.5" x2="0.5" y2="9.5"/>
          </svg>
        </button>
      </div>
    </div>
  );
};

export default CustomTitleBar;