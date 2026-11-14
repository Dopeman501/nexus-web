import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const evidence = fileURLToPath(new URL('../builds/shared-transition-picker-20261114/', import.meta.url));
const run = process.env.SHARED_TRANSITIONS_RUN ?? 'browser';
if (!/^[\w-]+$/.test(run)) throw new Error('Invalid shared-transition acceptance run name.');
if (!process.argv.includes('--list') && (!process.env.BACKGROUND_TRANSITIONS_ASSET_ROOT
  || !/^[a-f\d]{64}$/i.test(process.env.BACKGROUND_TRANSITIONS_EXPECTED_INDEX_SHA256 ?? ''))) {
  throw new Error('Shared-transition acceptance requires an explicit asset root and pinned dashboard index hash.');
}
export default defineConfig({
  testDir: './e2e', testMatch: 'shared-background-transitions.spec.ts',
  globalSetup: './e2e/backgroundVideoSetup.ts', workers: 1, fullyParallel: false, retries: 0, timeout: 60_000,
  outputDir: `${evidence}/${run}-artifacts`,
  reporter: [['list'], ['json', { outputFile: `${evidence}/${run}-results.json` }]],
  use: { baseURL: 'http://localhost:9400', browserName: 'chromium', channel: 'msedge', headless: true,
    viewport: { width: 1600, height: 1050 }, deviceScaleFactor: 1, colorScheme: 'dark', serviceWorkers: 'block',
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
