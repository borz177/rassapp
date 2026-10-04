import './src/index.css';

/**
 * Точка входа. Публичный калькулятор (/calc/Компания?cfg=…, ?view=public_calc)
 * открывает клиент продавца — ему не нужен весь учёт, поэтому он грузит только
 * свою страницу (publicCalcEntry.tsx), а не приложение целиком: страница
 * открывается за доли секунды даже на медленном мобильном интернете.
 * Всё остальное — приложение (appEntry.tsx).
 */
const q = new URLSearchParams(window.location.search);
const isPublicCalc = q.get('view') === 'public_calc' || q.get('v') === 'calc'
  || decodeURIComponent(window.location.pathname).startsWith('/calc');

// Новая сборка на сервере, а страница старая — кусок не загрузится; одна перезагрузка
const load = (p: Promise<unknown>) => p.catch((e) => {
  let last = 0;
  try { last = Number(sessionStorage.getItem('finuchet_entry_reload_at') || 0); } catch { /* нет доступа */ }
  if (Date.now() - last > 30000) {
    try { sessionStorage.setItem('finuchet_entry_reload_at', String(Date.now())); } catch { /* нет доступа */ }
    window.location.reload();
  } else {
    console.error(e);
  }
});

load(isPublicCalc ? import('./publicCalcEntry') : import('./appEntry'));
