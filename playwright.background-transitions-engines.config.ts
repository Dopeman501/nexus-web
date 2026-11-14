import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const evidence = fileURLToPath(new URL('../builds/background-transitions-20261114/', import.meta.url));
export default defineConfig({
  testDir: './e2e', testMatch: 'background-transition-engines.spec.ts',
  globalSetup: './e2e/backgroundEngineSetup.ts',
  fullyParallel: false, workers: 1, retries: 0, timeout: 180_000,
  outputDir: `${evidence}/engine-artifacts`,
  reporter: [['list'], ['json', { outputFile: `${evidence}/engine-results.json` }]],
  use: {
    baseURL: 'http://127.0.0.1:19437', browserName: 'chromium', channel: 'msedge', headless: true,
    viewport: { width: 900, height: 600 }, deviceScaleFactor: 1,
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
});
