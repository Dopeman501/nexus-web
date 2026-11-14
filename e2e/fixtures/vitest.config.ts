import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['e2e/backgroundVideoFixtures.test.ts'],
  pool: 'threads', maxWorkers: 2 } });
