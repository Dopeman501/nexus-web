import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const evidence = fileURLToPath(new URL('../builds/video-transitions-20261114/', import.meta.url));
export default defineConfig({
  testDir: './e2e', testMatch: ['background-video-transitions.spec.ts', 'background-video-core.spec.ts'],
  globalSetup: './e2e/backgroundVideoSetup.ts', workers: 1, fullyParallel: false, retries: 0, timeout: 55_000,
  outputDir: `${evidence}/browser-artifacts`,
  reporter: [['list'], ['json', { outputFile: `${evidence}/browser-results.json` }]],
  use: { baseURL: 'http://localhost:9400', browserName: 'chromium', channel: 'msedge', headless: true,
    viewport: { width: 1200, height: 540 }, deviceScaleFactor: 1, colorScheme: 'dark', serviceWorkers: 'block',
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
