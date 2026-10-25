import type { CapacitorConfig } from '@capacitor/cli';

// Для какой платформы собираем: конфиг выполняется внутри `npx cap sync ios`
// (copy/run/update ios), и платформа видна в аргументах команды.
const forIOS = process.argv.includes('ios');

const config: CapacitorConfig = {
  appId: 'com.finuchet.app',
  appName: 'FinUchet',
  webDir: 'dist',

  // iOS: интерфейс (dist) лежит внутри приложения, к rassrochka.pro оно ходит
  // только за данными (src/platform.ts → isBundledApp). Сайт в обёртке App Store
  // отклоняет (правило 4.2), а так приложение и открывается без интернета.
  // Android по-прежнему открывает сайт: обновляется вместе с ним, без магазина.
  server: forIOS ? undefined : {
    url: 'https://rassrochka.pro',
    cleartext: true,
    // Без сети сайт не загрузится — вместо белого экрана показываем встроенную
    // страницу с кнопкой «Повторить» (лежит в dist, попадает в приложение при cap sync).
    errorPath: 'offline.html',
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
    PushNotifications: {
      // Уведомление показываем и когда приложение открыто — иначе iOS его молча глотает
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Keyboard: {
      resize: 'none', // Не менять размер WebView при открытии клавиатуры
      resizeOnFullScreen: true,
    },
  },

  // 🔥 Настройки для Android
  android: {
    allowMixedContent: true, // Разрешаем HTTP контент на HTTPS странице
    // captureInput не включать: с ним Capacitor отдаёт клавиатуре упрощённый канал
    // ввода (BaseInputConnection без режима редактора), и Gboard/Samsung с
    // подсказками и автозаменой стирают и подменяют набранное — «не могу ввести
    // имя клиента» (жалоба 25.10.2026, стояло с 17.06.2026)
    captureInput: false,
    webContentsDebuggingEnabled: false,
  }
};

export default config;