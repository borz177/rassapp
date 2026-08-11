import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },

    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon-192.png'],
        manifestFilename: 'manifest.json',
        devOptions: {
          enabled: true
        },
        manifest: {
          name: 'FinUchet',
          short_name: 'FinUchet',
          description: 'Управление рассрочками и продажами',
          theme_color: '#ffffff',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          orientation: 'portrait',
          icons: [
            {
              src: 'icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any maskable'
            },
            {
              src: 'icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable'
            }
          ]
        },
        workbox: {
          // 🔔 Подключаем обработчики Web Push (push/notificationclick) к автогенерируемому SW
          importScripts: ['/push-sw.js'],
          globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
          // увеличиваем лимит файла для PWA
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          // игнорируем electron сборки
  globIgnores: [
    '**/win-unpacked/**',
    '**/release/**',
    '**/android/**',
    '**/electron.cjs'
  ],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/downloads\//],
          // 🔒 Ответы /api НАМЕРЕННО не кэшируются Service Worker'ом.
          // Здесь стоял NetworkFirst с networkTimeoutSeconds: 2 и хранением до недели. На
          // медленной связи (LTE, VPN) запрос за 2 секунды не укладывался — у тяжёлых аккаунтов
          // ответ /api/data весит сотни килобайт — и Workbox молча отдавал ответ недельной
          // давности, неотличимый от свежего. Приложение считало его актуальным: писало
          // устаревший снимок поверх рабочего кэша в IndexedDB (см. setCache('all_data') в
          // services/api.ts) и откатывало свежие правки в mergeServerData. Дальше пользователь
          // работал с устаревшим договором, а при сохранении этот снимок уходил на сервер целиком.
          // Офлайн от этого не зависит: и данные, и пользователь, и очередь несинхронизированных
          // изменений живут в IndexedDB (services/offlineStorage.ts) и читаются оттуда при любой
          // ошибке сети. Кэш приложения (HTML/JS/CSS) обеспечивается precache выше и не меняется.
          runtimeCaching: []
        }
      })
    ],

    // ИИ-функции отключены. Раньше здесь ключ Gemini подставлялся прямо в публичный
    // бандл — то есть любой мог достать его из исходников страницы. Возвращать этот
    // блок нельзя: ключ должен жить на сервере, а не в браузере.

    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },

    // 🔹 Настройки сборки
    // xlsx больше не помечен как external/CDN-глобал: раньше сборка полагалась на то, что
    // cdn.sheetjs.com успеет загрузиться в рантайме (см. index.html), а если сеть блокировала
    // или тормозила этот CDN — DataExport падал с "не удалось загрузить библиотеку", хотя пакет
    // уже установлен в node_modules. Раз DataExport.tsx использует `await import('xlsx')`,
    // Vite/Rollup и так вынесет его в отдельный чанк по требованию (та же лень загрузки без
    // раздувания основного бандла) — просто из собственного бандла, а не с внешнего CDN.
    build: {
      chunkSizeWarningLimit: 1000
    }
  };
});