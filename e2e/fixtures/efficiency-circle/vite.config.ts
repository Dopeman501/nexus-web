import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)), base: '/efficiency-fixture/', publicDir: false,
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify('isolated-efficiency'), __SERVICE_BUILD__: 'true',
    __DEV_TOOLS__: 'false', __OFFICIAL_BUILD__: 'false' },
  build: { outDir: fileURLToPath(new URL('../../../.playwright/efficiency-circle/', import.meta.url)),
    emptyOutDir: true, target: 'es2019' },
});
