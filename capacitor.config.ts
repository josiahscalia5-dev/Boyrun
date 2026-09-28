import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.skizgairos.game',
  appName: 'SKIZGAIROS',
  webDir: 'dist',
  // Sky blue behind the WebView so there is never a black/grey flash.
  backgroundColor: '#6fb3ff',
  android: {
    backgroundColor: '#6fb3ff',
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
