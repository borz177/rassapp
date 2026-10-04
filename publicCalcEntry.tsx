import React from 'react';
import ReactDOM from 'react-dom/client';
import PublicCalculator from './components/PublicCalculator';

/**
 * Лёгкий вход публичного калькулятора: только сама страница, без приложения,
 * его данных, офлайн-хранилища и service worker.
 */
// Страница клиента всегда светлая — тёмную тему ставит скрипт index.html по
// настройке приложения, а у клиента её нет
document.documentElement.classList.remove('dark');
const splash = document.getElementById('static-splash');
if (splash) { splash.classList.add('hidden'); setTimeout(() => splash.remove(), 400); }

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <PublicCalculator />
    </React.StrictMode>
  );
}
