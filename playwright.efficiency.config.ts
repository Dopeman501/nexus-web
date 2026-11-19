import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--list') && (!process.env.BACKGROUND_TRANSITIONS_ASSET_ROOT
  || !/^[a-f\d]{64}$/i.test(process.env.BACKGROUND_TRANSITIONS_EXPECTED_INDEX_SHA256 ?? ''))) {
  throw new Error('Efficiency acceptance requires an explicit asset root and pinned dashboard index hash.');
}
const run = process.env.EFFICIENCY_RUN ?? 'candidate';
if (!/^[\w-]+$/.test(run)) throw new Error('Invalid efficiency evidence name.');
const evidence = fileURLToPath(new URL('../builds/nexus-efficiency-20261117/web/', import.meta.url));
export default defineConfig({
  testDir: './e2e', testMatch: 'efficiency.spec.ts', workers: 1, fullyParallel: false, retries: 0,
  globalSetup: './e2e/efficiencySetup.ts',
  timeout: 45_000, expect: { timeout: 8000 }, outputDir: `${evidence}/${run}-artifacts`,
  reporter: [['list'], ['json', { outputFile: `${evidence}/${run}-results.json` }]],
  use: { baseURL: 'http://localhost:9400', browserName: 'chromium', channel: 'msedge', headless: true,
    viewport: { width: 550, height: 1920 }, deviceScaleFactor: 1, hasTouch: true,
    colorScheme: 'dark', serviceWorkers: 'block', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
