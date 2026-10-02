import { Capacitor } from '@capacitor/core';

/**
 * Приложение запущено как нативное iOS-приложение (Capacitor), а не в браузере.
 *
 * В App Store цифровую подписку разрешено продавать только через покупки Apple
 * (правило 3.1.1), а звать оплатить на сайте нельзя (3.1.3). Поэтому в iOS-сборке
 * тарифы только показываются: цены, кнопки оплаты и призывы «оформите подписку»
 * прячутся. Подписка, оплаченная в веб-версии или на Android, работает и здесь —
 * она хранится на сервере.
 */
export const isIOSApp = (): boolean => Capacitor.getPlatform() === 'ios';

/**
 * Открыто в настольном приложении (Electron, см. preload.js). Интерфейс там
 * лежит внутри приложения, поэтому service worker не нужен (и мешал бы: отдавал
 * бы из кэша прежнюю версию), а веб-push в Electron не работает вовсе.
 */
export const isDesktopShell = (): boolean =>
  typeof window !== 'undefined' && !!(window as any).finuchetShell;

/**
 * Приложение для Mac с парящими панелями (html.shell-floating, см. index.html).
 * Там экраны могут выглядеть по-своему — места больше, окно как у родных
 * приложений macOS. Сайт, Windows и телефоны этого не видят.
 */
export const isMacShell = (): boolean =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('shell-floating');

/** Боевой сервер: API, файлы и публичные страницы */
export const SERVER_ORIGIN = 'https://rassrochka.pro';

/**
 * Интерфейс лежит внутри приложения, а не открыт с сайта.
 *
 * Так собирается iOS-приложение (см. capacitor.config.ts): страница открыта с
 * capacitor://localhost, и относительные адреса (/api, /uploads) ведут внутрь
 * приложения, а не на сервер. Android и сайт открывают rassrochka.pro напрямую.
 */
export const isBundledApp = (): boolean =>
  typeof location !== 'undefined' && location.protocol === 'capacitor:';

/** Адрес сайта для ссылок, которые человек копирует или отправляет другим */
export const publicOrigin = (): string =>
  isBundledApp() ? SERVER_ORIGIN : window.location.origin;

/**
 * Путь файла на сервере (/uploads/…) → адрес, по которому его можно загрузить.
 * На сайте путь и так ведёт на сервер; base64, blob: и полные адреса не меняются.
 */
export const serverFileUrl = <T extends string | undefined>(src: T): T =>
  (src && isBundledApp() && src.startsWith('/') ? SERVER_ORIGIN + src : src) as T;
