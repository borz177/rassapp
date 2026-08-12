
import React from 'react';
import ReactDOM from 'react-dom/client';
import './src/index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { ThemeProvider } from './src/theme/ThemeContext';
import { registerSW } from 'virtual:pwa-register';

// Register Service Worker for PWA offline support
const updateSW = registerSW({
  onNeedRefresh() {
    console.log('New content available, reload to update.');
  },
  onOfflineReady() {
    console.log('App is ready to work offline.');
  },
});

// 🔒 Отложенные куски кода запрашиваются вне дерева React — например, когда пользователь
// открывает экран, а сборка на сервере уже сменилась. Такая ошибка до границы ошибок не
// доходит и оставляет белый экран, поэтому ловим её здесь и перезагружаем страницу:
// свежий index.html подтянет новые имена файлов. Защита от петли — как в ErrorBoundary.
window.addEventListener('unhandledrejection', (event) => {
  const msg = String(event.reason?.message || event.reason || '');
  if (!/Loading chunk|dynamically imported module|Importing a module script failed|Unable to preload/i.test(msg)) return;

  let lastReload = 0;
  try { lastReload = Number(sessionStorage.getItem('finuchet_chunk_reload_at') || 0); } catch { /* нет доступа */ }
  if (Date.now() - lastReload < 30000) return;

  try { sessionStorage.setItem('finuchet_chunk_reload_at', String(Date.now())); } catch { /* нет доступа */ }
  console.warn('🔄 Не загрузился модуль новой версии — перезагружаем страницу');
  window.location.reload();
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    {/* Граница ошибок — снаружи всего: сбой в самой теме или в App не должен
        оставлять пользователя перед пустой белой страницей */}
    <ErrorBoundary>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
