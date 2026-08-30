/**
 * Что делать, когда у приложения на руках старая сборка.
 *
 * После выкладки файлы получают новые имена с хешем, а старые с раздачи
 * исчезают. Устройство, которое держит в кэше прежний index.html, просит чанк,
 * которого больше нет, — и получает не 404, а страницу index.html с кодом 200
 * (так устроен SPA-фолбэк на сервере). Браузер отказывается исполнять HTML как
 * модуль, и приложение ломается там, где подгружался этот кусок: у одних не
 * открывался экран, у других не отправлялся PDF.
 *
 * Раньше в ответ показывали окно «Требуется обновление» с кнопкой «Перезагрузить».
 * Но это не выбор человека: другого варианта, кроме перезагрузки, не существует,
 * а сообщение выглядит поломкой и пугает. Перезагружаемся сами.
 */

const LAST_RELOAD_KEY = 'finuchet_stale_bundle_reload_at';

// Минута между попытками. Без паузы можно попасть в петлю: перезагрузились,
// снова получили старый файл из кэша, снова перезагрузились. С паузой хуже, чем
// одна лишняя перезагрузка в минуту, не станет, а петля исключена.
const MIN_INTERVAL_MS = 60_000;

/**
 * Перезагружает приложение, если это не делалось только что.
 * @returns true, если перезагрузка запущена
 */
export const reloadForNewBuild = (): boolean => {
  try {
    const last = Number(sessionStorage.getItem(LAST_RELOAD_KEY) || 0);
    if (Date.now() - last < MIN_INTERVAL_MS) return false;
    sessionStorage.setItem(LAST_RELOAD_KEY, String(Date.now()));
  } catch {
    // Приватный режим или запрет на хранилище — защиты от петли нет, поэтому
    // не перезагружаемся вовсе: зациклиться хуже, чем не обновиться.
    return false;
  }
  window.location.reload();
  return true;
};

/** Похожа ли ошибка на «пришёл HTML вместо модуля». */
export const isStaleBundleError = (error: any): boolean => {
  const msg = String(error?.message || error || '');
  return error?.isUpdateRequired === true
    || msg === 'APP_UPDATE_REQUIRED'
    || msg.includes('MIME')
    || msg.includes('text/html')
    || msg.includes('Failed to fetch dynamically imported module')
    || msg.includes('error loading dynamically imported module');
};

/**
 * Ставит перехват на подгрузку кусков приложения.
 *
 * vite:preloadError приходит именно тогда, когда не удалось подтянуть чанк, —
 * это самый ранний момент, когда о старой сборке вообще можно узнать. Ловим и
 * его, и общий unhandledrejection: часть импортов идёт не через предзагрузку.
 */
export const installStaleBundleGuard = (): void => {
  window.addEventListener('vite:preloadError', event => {
    event.preventDefault();
    reloadForNewBuild();
  });

  window.addEventListener('unhandledrejection', event => {
    if (isStaleBundleError(event.reason)) {
      event.preventDefault();
      reloadForNewBuild();
    }
  });
};
