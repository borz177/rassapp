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
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.startsWith('/api'),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api-cache',
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 60 * 60 * 24 * 7 // 1 week
                },
                networkTimeoutSeconds: 2
              }
            },
          ]
        }
      })
    ],

    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },

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