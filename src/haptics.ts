import { Capacitor } from '@capacitor/core';

/**
 * Тактильная отдача — как в нативных приложениях.
 *
 * На iPhone веб-вибрации нет вовсе (navigator.vibrate в Safari и WKWebView
 * отсутствует), поэтому в приложении из App Store и в APK работаем через
 * системный Taptic Engine (@capacitor/haptics): лёгкий щелчок, «выбор»,
 * «успех», «ошибка» — те же отклики, что у системных переключателей.
 *
 * В браузере и в старой сборке APK, где плагина ещё нет, — короткая веб-вибрация
 * (Android Chrome), на остальном — тишина. Плагин подгружается лениво: на сайте
 * и на компьютере он не нужен и не должен утяжелять стартовый бандл.
 */

type Impact = 'light' | 'medium' | 'heavy';
type Notice = 'success' | 'warning' | 'error';

let native: Promise<typeof import('@capacitor/haptics') | null> | null = null;
const plugin = () => {
  if (!native) {
    native = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Haptics')
      ? import('@capacitor/haptics').catch(() => null)
      : Promise.resolve(null);
  }
  return native;
};

const vibrate = (pattern: number | number[]) => {
  try { navigator.vibrate?.(pattern); } catch { /* устройство без вибромотора */ }
};

// Выключатель на устройстве: localStorage['finuchet_haptics'] = 'off'
const muted = () => {
  try { return localStorage.getItem('finuchet_haptics') === 'off'; } catch { return false; }
};

const impact = (style: Impact, fallback: number | number[]) => {
  if (muted()) return;
  void plugin().then(h => {
    if (!h) { vibrate(fallback); return; }
    const map = { light: h.ImpactStyle.Light, medium: h.ImpactStyle.Medium, heavy: h.ImpactStyle.Heavy };
    h.Haptics.impact({ style: map[style] }).catch(() => vibrate(fallback));
  });
};

const notice = (type: Notice, fallback: number | number[]) => {
  if (muted()) return;
  void plugin().then(h => {
    if (!h) { vibrate(fallback); return; }
    const map = { success: h.NotificationType.Success, warning: h.NotificationType.Warning, error: h.NotificationType.Error };
    h.Haptics.notification({ type: map[type] }).catch(() => vibrate(fallback));
  });
};

export const haptics = {
  /** Нажатие кнопки, порог свайпа */
  light: () => impact('light', 8),
  /** Сработало действие: свайп до конца, долгое нажатие, обновление списка */
  medium: () => impact('medium', 14),
  heavy: () => impact('heavy', 22),
  /** Смена вкладки, переключатель, выбор в списке */
  selection: () => {
    if (muted()) return;
    void plugin().then(h => {
      if (!h) { vibrate(5); return; }
      h.Haptics.selectionStart()
        .then(() => h.Haptics.selectionChanged())
        .then(() => h.Haptics.selectionEnd())
        .catch(() => vibrate(5));
    });
  },
  success: () => notice('success', [12, 60, 18]),
  warning: () => notice('warning', [18, 80, 18]),
  error: () => notice('error', [30, 60, 30, 60, 30]),
};
