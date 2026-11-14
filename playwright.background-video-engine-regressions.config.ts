import base from './playwright.background-transitions-engines.config';
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const evidence = fileURLToPath(new URL('../builds/video-transitions-20261114/', import.meta.url));
export default defineConfig({ ...base,
  outputDir: `${evidence}/engine-regression-artifacts`,
  reporter: [['list'], ['json', { outputFile: `${evidence}/engine-regression-results.json` }]],
});
