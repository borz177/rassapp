import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.finuchet.app',
  appName: 'FinUchet',
  webDir: 'dist',

  server: {
    url: 'https://rassrochka.pro',
    cleartext: true
  }
};

export default config;