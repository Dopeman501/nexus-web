import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const evidence = fileURLToPath(new URL('../../builds/transitions-20261111/', import.meta.url));

export default defineConfig({
  testDir: './tests',
  testMatch: 'browser.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  outputDir: `${evidence}/browser-artifacts`,
  reporter: [['list'], ['json', { outputFile: `${evidence}/browser-results.json` }]],
  use: {
    baseURL: 'http://127.0.0.1:19431',
    browserName: 'chromium',
    channel: 'msedge',
    headless: true,
    viewport: { width: 1920, height: 1120 },
    deviceScaleFactor: 1,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  // The tests fulfill this isolated origin from the fresh local lab build.
  // No listener, webServer reuse or installed Nexus connection is required.
});
