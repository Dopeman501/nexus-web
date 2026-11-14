import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const suite = process.env.TRANSITION_PUBLISH_SUITE ?? 'engines';
if (!['engines', 'core', 'beat'].includes(suite)) throw new Error('Unknown publication suite.');
const run = process.env.TRANSITION_PUBLISH_RUN ?? suite;
if (!/^[\w-]+$/.test(run)) throw new Error('Invalid publication evidence name.');
const evidence = fileURLToPath(new URL('../builds/transition-main-publish-20261114/', import.meta.url));
// Load only the selected suite: beat's production index guard must not require
// a dashboard build when exercising the source-only engine/core fixtures.
const base = (await (suite === 'engines' ? import('./playwright.background-transitions-engines.config')
  : suite === 'core' ? import('./playwright.background-video-transitions.config')
    : import('./e2e/audioBeatTransitions.config'))).default;
export default defineConfig({ ...base, testDir: './e2e',
  testMatch: suite === 'engines' ? 'background-transition-engines.spec.ts'
    : suite === 'core' ? 'background-video-core.spec.ts' : 'audioBeatTransitions.spec.ts',
  globalSetup: suite === 'engines' ? './e2e/backgroundEngineSetup.ts' : './e2e/backgroundVideoSetup.ts',
  outputDir: `${evidence}/${run}-artifacts`,
  reporter: [['list'], ['json', { outputFile: `${evidence}/${run}-results.json` }]],
});
