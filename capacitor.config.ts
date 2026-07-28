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
      overlaysWebView: false, // 🔥 ИЗМЕНЯЕМ НА false (контент НЕ залезает под статус-бар)
      style: 'DARK',          // 🔥 ИЗМЕНЯЕМ НА 'DARK' (темные иконки для светлого фона)
      backgroundColor: '#ffffff', // Цвет самого статус-бара
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