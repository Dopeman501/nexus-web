import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), publicDir: false,
  build: { outDir: fileURLToPath(new URL('../../../.playwright/video-core/', import.meta.url)),
    emptyOutDir: true, target: 'es2022' } });
