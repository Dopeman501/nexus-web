import { defineConfig } from '@playwright/test';

// Every request and WebSocket is fulfilled by the fixture. No server or live
// service is used; dist must first be generated with npm run build:service.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'lighting-widget.spec.ts',
  grep: /dashboard Red Shift/,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: 'list',
  outputDir: 'test-results/red-shift',
  use: {
    baseURL: 'http://localhost:9400',
    browserName: 'chromium', channel: 'msedge', headless: true,
    colorScheme: 'dark', trace: 'retain-on-failure', screenshot: 'only-on-failure',
  },
});
