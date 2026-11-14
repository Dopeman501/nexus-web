import base from './playwright.background-transitions.config';
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const evidence = fileURLToPath(new URL('../builds/video-transitions-20261114/', import.meta.url));
const target = process.env.BACKGROUND_TRANSITIONS_TARGET ?? 'production';
export default defineConfig({ ...base,
  outputDir: `${evidence}/${target}-regression-browser-artifacts`,
  reporter: [['list'], ['json', { outputFile: `${evidence}/${target}-regression-browser-results.json` }]],
});
