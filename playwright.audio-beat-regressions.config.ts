import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import shared from './playwright.shared-background-transitions.config';
import video from './playwright.background-video-transitions.config';
import legacy from './playwright.background-transitions.config';

const suite = process.env.AUDIO_BEAT_REGRESSION_SUITE ?? 'shared';
if (!['shared', 'video', 'legacy'].includes(suite)) throw new Error('Unknown audio-beat regression suite.');
const run = process.env.AUDIO_BEAT_REGRESSION_RUN ?? suite;
if (!/^[\w-]+$/.test(run)) throw new Error('Invalid regression evidence name.');
const evidence = fileURLToPath(new URL('../builds/audio-beat-transitions-20261114/', import.meta.url));
const base = suite === 'shared' ? shared : suite === 'video' ? video : legacy;
export default defineConfig({ ...base,
  globalSetup: './e2e/backgroundVideoSetup.ts',
  ...(suite === 'legacy' ? { grepInvert: /production settings save and reopen independent slideshow and audio choices/ } : {}),
  outputDir: `${evidence}/${run}-artifacts`,
  reporter: [['list'], ['json', { outputFile: `${evidence}/${run}-results.json` }]],
});
