import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const evidence = fileURLToPath(new URL('../../builds/y70-home-20261114/', import.meta.url));
const run = process.env.Y70_REORDER_RUN ?? 'browser';
if (!/^[\w-]+$/.test(run)) throw new Error('Invalid Y70 reorder acceptance run name.');
if (!process.argv.includes('--list') && (!process.env.Y70_HOME_ASSET_ROOT
  || !/^[a-f\d]{64}$/i.test(process.env.Y70_HOME_EXPECTED_INDEX_SHA256 ?? ''))) {
  throw new Error('Y70 reorder acceptance requires an explicit asset root and pinned production index hash.');
}
export default defineConfig({
  testDir: '.', testMatch: 'y70PageReorder.spec.ts', workers: 1, fullyParallel: false, retries: 0, timeout: 40_000,
  outputDir: `${evidence}/reorder-${run}-artifacts`,
  reporter: [['list'], ['json', { outputFile: `${evidence}/reorder-${run}-results.json` }]],
  use: { baseURL: 'http://localhost:9400', browserName: 'chromium', channel: 'msedge', headless: true,
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark', hasTouch: true,
    serviceWorkers: 'block', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
