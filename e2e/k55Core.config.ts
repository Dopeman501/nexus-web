import { defineConfig } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.K55_CORE_ASSET_ROOT;
const expected = process.env.K55_CORE_EXPECTED_INDEX_SHA256;
const run = process.env.K55_CORE_RUN ?? 'local';
const evidence = fileURLToPath(new URL('../.playwright/k55-core/', import.meta.url));
if (!/^[\w-]+$/.test(run)) throw new Error('Invalid K55 CORE browser run name.');
if (!process.argv.includes('--list')) {
  if (!root || !/^[a-f\d]{64}$/i.test(expected ?? '')) {
    throw new Error('K55 CORE browser acceptance requires an explicit asset root and production index hash.');
  }
  const actual = createHash('sha256').update(readFileSync(resolve(root, 'index.html'))).digest('hex');
  if (actual !== expected?.toLowerCase()) throw new Error('K55 CORE browser asset index hash mismatch.');
}

export default defineConfig({
  testDir: '.', testMatch: 'lighting-effect-preview.spec.ts', grep: /K55 CORE/,
  workers: 1, fullyParallel: false, retries: 0, timeout: 40_000,
  outputDir: `${evidence}/${run}-artifacts`,
  reporter: [['list'], ['json', { outputFile: `${evidence}/${run}-results.json` }]],
  use: {
    baseURL: 'http://localhost:9400', browserName: 'chromium', channel: 'msedge', headless: true,
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark', serviceWorkers: 'block',
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
});
