import React from 'react';

/**
 * Иконка ИИ-ассистента: шар с переливающимся градиентом и искрой внутри
 * (анимации — .ai-orb в src/index.css). static — без движения, для мест, где
 * много иконок рядом.
 */
const AIOrb: React.FC<{ size?: number; className?: string; static?: boolean }> = ({ size = 40, className = '', static: still = false }) => (
  <span
    aria-hidden
    className={`${still ? 'ai-orb-static' : 'ai-orb'} inline-flex items-center justify-center rounded-full text-white shrink-0 ${className}`}
    style={{ width: size, height: size }}
  >
    <svg className="ai-orb-spark" width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.5c.5 3.9 2.1 6.6 4.6 8 1.3.7 2.8 1.1 4.6 1.3v.4c-1.8.2-3.3.6-4.6 1.3-2.5 1.4-4.1 4.1-4.6 8h-.4c-.5-3.9-2.1-6.6-4.6-8-1.3-.7-2.8-1.1-4.6-1.3v-.4c1.8-.2 3.3-.6 4.6-1.3 2.5-1.4 4.1-4.1 4.6-8h.4z" />
      <path opacity=".75" d="M19 2.2c.2 1.4.8 2.3 1.9 2.7v.2c-1.1.4-1.7 1.3-1.9 2.7h-.2c-.2-1.4-.8-2.3-1.9-2.7v-.2c1.1-.4 1.7-1.3 1.9-2.7h.2z" />
    </svg>
  </span>
);

export default AIOrb;
