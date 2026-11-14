import { defineConfig } from '@playwright/test';
import base from './playwright.background-transitions.config';
import { fileURLToPath } from 'node:url';
const evidence = fileURLToPath(new URL('../builds/shared-transition-picker-20261114/', import.meta.url));
const target = process.env.BACKGROUND_TRANSITIONS_TARGET ?? 'production';
export default defineConfig({ ...base, grepInvert: /production settings save and reopen independent slideshow and audio choices/,
  outputDir: `${evidence}/${target}-legacy-regression-artifacts`,
  reporter: [['list'], ['json', { outputFile: `${evidence}/${target}-legacy-regression-results.json` }]],
});
