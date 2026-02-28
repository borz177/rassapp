import path from 'path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },

    plugins: [
      react(),

      // 🔥 PWA поддержка офлайн-режима
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',

        includeAssets: [
          'icon-192.png',
          'icon-512.png'
        ],

        manifest: {
          name: 'FinUchet',
          short_name: 'FinUchet',
          description: 'Умный учет рассрочек и клиентов',
          theme_color: '#4F46E5',
          background_color: '#f8fafc',
          display: 'standalone',
          start_url: '/',
          icons: [
            {
              src: '/icon-192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: '/icon-512.png',
              sizes: '512x512',
              type: 'image/png'
            }
          ]
        },

        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/esm\.sh\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'esm-cache',
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 60 * 60 * 24 * 30
                }
              }
            }
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

    // исключаем xlsx из сборки (как у тебя было)
    optimizeDeps: {
      exclude: ['xlsx']
    },

    build: {
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        external: ['xlsx'],
        output: {
          globals: {
            xlsx: 'XLSX'
          }
        }
      }
    }
  }
})