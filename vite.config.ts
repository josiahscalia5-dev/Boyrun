import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the bundle works inside the Android WebView.
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
