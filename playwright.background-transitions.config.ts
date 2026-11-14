import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const evidence = fileURLToPath(new URL('../builds/background-transitions-20261114/', import.meta.url));
const target = process.env.BACKGROUND_TRANSITIONS_TARGET ?? 'production';
if (target !== 'production' && target !== 'installed') throw new Error('Unknown transition acceptance target.');
if (target === 'installed' && (!process.env.BACKGROUND_TRANSITIONS_ASSET_ROOT || !process.env.BACKGROUND_TRANSITIONS_EXPECTED_INDEX_SHA256)) {
  throw new Error('Installed acceptance requires an explicit read-only asset root and expected index hash.');
}

export default defineConfig({
  testDir: './e2e', testMatch: 'background-transitions.spec.ts', workers: 1, fullyParallel: false,
  globalSetup: './e2e/backgroundVideoSetup.ts',
  timeout: 45_000, retries: 0, outputDir: `${evidence}/${target}-browser-artifacts`,
  reporter: [['list'], ['json', { outputFile: `${evidence}/${target}-browser-results.json` }]],
  use: { baseURL: 'http://localhost:9400', browserName: 'chromium', channel: 'msedge', headless: true,
    viewport: { width: 1200, height: 540 }, colorScheme: 'dark', deviceScaleFactor: 1,
    serviceWorkers: 'block', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  // Every HTTP request and WebSocket is intercepted. No listener or installed service is used.
});
