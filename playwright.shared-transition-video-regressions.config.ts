import { defineConfig } from '@playwright/test';
import base from './playwright.background-video-transitions.config';
import { fileURLToPath } from 'node:url';
const evidence = fileURLToPath(new URL('../builds/shared-transition-picker-20261114/', import.meta.url));
export default defineConfig({ ...base, outputDir: `${evidence}/video-regression-artifacts`,
  reporter: [['list'], ['json', { outputFile: `${evidence}/video-regression-results.json` }]],
});
