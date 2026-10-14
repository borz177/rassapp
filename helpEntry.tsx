import React from 'react';
import ReactDOM from 'react-dom/client';
import Help from './components/Help';

/**
 * Открытая страница обучения rassrochka.pro/help — для тех, кто спрашивает
 * «как пользоваться», в том числе ещё без аккаунта. Лёгкий вход, как у
 * публичного калькулятора: только инструкции, без приложения и его данных.
 * Статья открывается по ссылке с якорем: /help#sale.
 */
document.title = 'Обучение — FinUchet';
const splash = document.getElementById('static-splash');
if (splash) { splash.classList.add('hidden'); setTimeout(() => splash.remove(), 400); }
document.body.classList.add('bg-slate-50', 'dark:bg-slate-900');

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <Help standalone />
    </React.StrictMode>
  );
}
