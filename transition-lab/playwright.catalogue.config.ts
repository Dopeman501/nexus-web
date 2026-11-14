import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const evidence = fileURLToPath(new URL('../../builds/transitions-catalogue-20261111/', import.meta.url));

export default defineConfig({
  testDir: './tests', testMatch: ['catalogue.browser.spec.ts', 'codrops.browser.spec.ts'], workers: 1, retries: 0,
  timeout: 300_000,
  outputDir: `${evidence}/browser-artifacts`,
  reporter: [['list'], ['json', { outputFile: `${evidence}/browser-results.json` }]],
  use: {
    baseURL: 'http://127.0.0.1:19431', browserName: 'chromium', channel: 'msedge',
    headless: true, viewport: { width: 1100, height: 1000 }, deviceScaleFactor: 1,
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
});
