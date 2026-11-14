import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const evidence = fileURLToPath(new URL('../../builds/audio-beat-transitions-20261114/', import.meta.url));
const run = process.env.AUDIO_BEAT_TRANSITIONS_RUN ?? 'browser';
if (!/^[\w-]+$/.test(run)) throw new Error('Invalid audio-beat acceptance run name.');
if (!process.argv.includes('--list') && (!process.env.BACKGROUND_TRANSITIONS_ASSET_ROOT
  || !/^[a-f\d]{64}$/i.test(process.env.BACKGROUND_TRANSITIONS_EXPECTED_INDEX_SHA256 ?? ''))) {
  throw new Error('Audio-beat acceptance requires an explicit asset root and pinned dashboard index hash.');
}
export default defineConfig({
  testDir: '.', testMatch: 'audioBeatTransitions.spec.ts', workers: 1, fullyParallel: false, retries: 0, timeout: 30_000,
  globalSetup: './backgroundVideoSetup.ts',
  outputDir: `${evidence}/${run}-artifacts`,
  reporter: [['list'], ['json', { outputFile: `${evidence}/${run}-results.json` }]],
  use: { baseURL: 'http://localhost:9400', browserName: 'chromium', channel: 'msedge', headless: true,
    viewport: { width: 1200, height: 540 }, deviceScaleFactor: 1, colorScheme: 'dark', serviceWorkers: 'block',
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
