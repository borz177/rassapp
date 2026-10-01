/**
 * Push-уведомления в iOS-приложении.
 *
 * Веб-push (service worker + VAPID) во встроенном браузере приложения не работает,
 * поэтому на iPhone уведомления идут через APNs: плагин отдаёт токен устройства,
 * сервер шлёт по нему (server/apns.js). Только iOS: на Android регистрация без
 * настроенного Firebase роняет приложение, а сайт пользуется веб-push как раньше.
 *
 * Пока на сервере нет ключа APNs, nativePushAvailable() возвращает false, и
 * настройки пункт push на iPhone не показывают.
 */
import { PushNotifications } from '@capacitor/push-notifications';
import { api } from '../services/api';
import { isIOSApp } from './platform';

// Токен этого устройства, привязанный к аккаунту. Есть — устройство подписано.
const TOKEN_KEY = 'finuchet_native_push_token';

const readToken = (): string | null => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
const writeToken = (token: string | null) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* хранилище недоступно — переживём */ }
};

/** Включены ли нативные push: iOS-приложение и ключ APNs на сервере */
export const nativePushAvailable = async (): Promise<boolean> => {
  if (!isIOSApp()) return false;
  try {
    const { ios } = await api.getNativePushConfig();
    return !!ios;
  } catch {
    return false;
  }
};

/** Подписано ли это устройство: токен привязан и разрешение не отозвано в настройках iOS */
export const isNativePushSubscribed = async (): Promise<boolean> => {
  if (!isIOSApp() || !readToken()) return false;
  try {
    return (await PushNotifications.checkPermissions()).receive === 'granted';
  } catch {
    return false;
  }
};

// Запросить у iOS токен устройства. Ответ приходит событием, а не результатом
// register(), поэтому ждём одно из двух событий.
const obtainToken = (): Promise<string> => new Promise((resolve, reject) => {
  let done = false;
  const handles: { remove: () => Promise<void> }[] = [];
  const finish = (fn: () => void) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    handles.forEach(h => h.remove().catch(() => {}));
    fn();
  };
  const timer = setTimeout(() => finish(() => reject(new Error('Нет ответа от iOS'))), 15000);
  Promise.all([
    PushNotifications.addListener('registration', t => finish(() => resolve(t.value))),
    PushNotifications.addListener('registrationError', e => finish(() => reject(new Error(e.error)))),
  ]).then(hs => {
    handles.push(...hs);
    if (done) hs.forEach(h => h.remove().catch(() => {}));
    return PushNotifications.register();
  }).catch(e => finish(() => reject(e)));
});

/**
 * Подписать устройство: спросить разрешение (iOS покажет системное окно один
 * раз), получить токен и привязать к аккаунту. false — разрешение не дали.
 */
export const enableNativePush = async (): Promise<boolean> => {
  let { receive } = await PushNotifications.checkPermissions();
  if (receive === 'prompt' || receive === 'prompt-with-rationale') {
    ({ receive } = await PushNotifications.requestPermissions());
  }
  if (receive !== 'granted') return false;

  const token = await obtainToken();
  await api.subscribeNativePush(token);
  writeToken(token);
  return true;
};

/** Отписать устройство от уведомлений этого аккаунта */
export const disableNativePush = async (): Promise<void> => {
  const token = readToken();
  if (token) await api.unsubscribeNativePush(token).catch(() => {});
  writeToken(null);
};

/**
 * После входа и при каждом запуске: если устройство было подписано, обновить
 * привязку. iOS может сменить токен (переустановка, восстановление из копии), а
 * на телефоне могли войти под другим аккаунтом — уведомления должны идти ему.
 * Окон не показывает: без выданного раньше разрешения ничего не делает.
 */
export const refreshNativePush = async (): Promise<void> => {
  if (!readToken() || !(await nativePushAvailable())) return;
  try {
    if ((await PushNotifications.checkPermissions()).receive !== 'granted') return;
    const token = await obtainToken();
    await api.subscribeNativePush(token);
    writeToken(token);
  } catch { /* не вышло сейчас — попробуем при следующем запуске */ }
};

/** При выходе из аккаунта: этот телефон больше не получает его уведомления */
export const forgetNativePushOnLogout = async (): Promise<void> => {
  if (!isIOSApp()) return;
  await disableNativePush();
};
