import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: { host: '127.0.0.1', port: 19431, strictPort: true },
  preview: { host: '127.0.0.1', port: 19431, strictPort: true },
  build: {
    outDir: 'dist', emptyOutDir: true, target: 'es2019',
    rollupOptions: { input: {
      sampler: fileURLToPath(new URL('./index.html', import.meta.url)),
      codrops: fileURLToPath(new URL('./codrops-catalogue/frame.html', import.meta.url)),
    } },
  },
});
