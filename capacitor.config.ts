import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.finuchet.app',
  appName: 'FinUchet',
  webDir: 'dist',

  server: {
    url: 'https://rassrochka.pro',
    cleartext: true
  },

  // 🔥 Настройки плагинов для нативного вида
  plugins: {
    StatusBar: {
      // Приложение рисуется под статус-баром: сплошной шапки нет, часы и значки
      // лежат прямо на контенте, как в нативных приложениях. Вырез отдаётся
      // вёрстке через env(safe-area-inset-top) — см. .safe-area-top,
      // .mobile-main-offset и .topbar-scrim.
      overlaysWebView: true,
      // Названия у плагина обратные интуиции: 'LIGHT' = тёмные иконки (под светлый
      // фон), 'DARK' = светлые. Это значение действует до загрузки веб-приложения,
      // то есть поверх сплеш-экрана — а он светлый. Дальше иконки переключает
      // App.tsx по теме приложения.
      style: 'LIGHT',
      backgroundColor: '#00000000', // прозрачный: под полосой видно страницу
    },
    SplashScreen: {
      launchShowDuration: 0, // Отключаем нативный сплеш (у вас свой есть)
      launchAutoHide: true,
    },
    Keyboard: {
      resize: 'none', // Не менять размер WebView при открытии клавиатуры
      resizeOnFullScreen: true,
    },
  },

  // 🔥 Настройки для Android
  android: {
    allowMixedContent: true, // Разрешаем HTTP контент на HTTPS странице
    captureInput: true,
    webContentsDebuggingEnabled: false,
  }
};

export default config;