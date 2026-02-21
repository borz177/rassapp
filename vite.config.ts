// vite.config.ts
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      // 🔥 КРИТИЧЕСКИ ВАЖНО: исключаем xlsx из сборки
      optimizeDeps: {
        exclude: ['xlsx']
      },
      build: {
        chunkSizeWarningLimit: 1000,
        rollupOptions: {
          external: ['xlsx'], // <-- Эта строка решает вашу ошибку!
          output: {
            globals: {
              xlsx: 'XLSX' // <-- Глобальная переменная из CDN
            }
          }
        }
      }
    };
});