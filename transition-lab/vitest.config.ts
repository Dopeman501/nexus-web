import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['transition-lab/tests/**/*.test.{ts,tsx}'],
    pool: 'threads',
    maxWorkers: 2,
  },
});
