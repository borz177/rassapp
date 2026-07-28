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
      overlaysWebView: false, // Контент НЕ залезает под статус-бар
      // 🔒 'DARK' = светлые иконки (см. @capacitor/status-bar definitions.d.ts: "Style.Dark —
      // Light text for dark backgrounds") — верная пара для тёмно-синего фона сплеша ниже.
      // Как только сплеш скрывается, App.tsx сам переключает и цвет, и стиль под реальную
      // тему приложения (см. useEffect на resolvedTheme).
      style: 'DARK',
      backgroundColor: '#1e3a8a', // Тот же цвет, что и у сплеш-экрана — до его скрытия
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