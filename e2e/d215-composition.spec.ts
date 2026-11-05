import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { PanelDeviceRecord } from '../src/api/panel';
import type { AppInstalledListing } from '../src/widgets/types';

test.use({ viewport: { width: 1600, height: 1100 }, colorScheme: 'dark' });

const BACKGROUND = '#362520';
function seed(): PanelDeviceRecord {
  return {
    id: 'composition-d215', displayName: 'Jungle Leopard D215', streamed: true, portrait: false, flip180: false,
    themeMode: 'dark', themeSyncWithDesktop: false, accentColor: '#d72f38', accentSyncWithDesktop: false,
    backgroundMode: 'solid', backgroundColor: BACKGROUND, backgroundOpacity: 100,
    capabilities: { surface: 'lcd-wide', family: 'jungle-leopard-d215', cssWidth: 1680, cssHeight: 756, dpr: 1,
      touch: false, supportsPortrait: true },
    layout: { layoutSchemaVersion: 2, surface: 'lcd-wide', pages: [{ id: 'main', widgets: [
      { id: 'main-clock', type: 'clock', size: '4x2', col: 0, row: 0, config: { showSeconds: false } },
    ] }], d215Panels: { enabled: true, items: ['clock', 'calendar', 'monitoring', 'media', 'weather', 'gallery'].map((type, index) => ({
      id: `circle-${index}`, type, x: ((index % 3) + 0.5) / 3, y: (Math.floor(index / 3) + 0.5) / 2, diameter: 0.4,
    })) } },
  };
}

interface MockService { record: PanelDeviceRecord; writes: Partial<PanelDeviceRecord>[] }

async function mockService(page: Page, state: MockService, apps: AppInstalledListing[] = [], backgroundFixtures = false) {
  const root = resolve(process.env.D215_DIST ?? 'dist');
  await page.addInitScript(() => {
    localStorage.setItem('nexus_token', 'test-token');
    localStorage.setItem('nexus_settings', JSON.stringify({
      general: { language: 'en', themeMode: 'dark', accentColor: '#d72f38', accentSource: 'custom' },
    }));
    if ('serviceWorker' in navigator) Object.defineProperty(navigator, 'serviceWorker', { configurable: true, get: () => undefined });
  });
  await page.routeWebSocket(/\/ws(\?|$)/, () => {});
  // Static files and every API call are intercepted, including iframe calls.
  // No request can fall through to the installed service or physical hardware.
  await page.route('**/*', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const type = request.resourceType();
    if (backgroundFixtures && path.endsWith('/background-media/paint/file')) return route.fulfill({ contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#ffbb00"/><circle cx="32" cy="32" r="16" fill="#9900aa"/></svg>' });
    if ((type !== 'fetch' && type !== 'xhr') || path.startsWith('/assets/')) {
      const file = resolve(root, type === 'document' ? 'index.html' : `.${decodeURIComponent(path)}`);
      if (file.startsWith(root + sep) && existsSync(file)) return route.fulfill({ path: file });
      return route.fulfill({ status: 404, body: '' });
    }
    const json = (body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (backgroundFixtures && path.startsWith('/lighting/shaders/')) {
      const shaderRoot = resolve('../nexus-service/src/Lighting/Engine/Gpu/Shaders');
      return json({ frag: readFileSync(resolve(shaderRoot, '_prelude.frag'), 'utf8') + '\n' + readFileSync(resolve(shaderRoot, 'plasma.frag'), 'utf8') });
    }
    if (backgroundFixtures && path.endsWith('/background-media/library')) return json({ items: [{ id: 'paint', name: 'Paint fixture',
      type: 'static', sourceExt: '.svg', width: 64, height: 64, importedAtUnixMs: 1, durationSec: 0, alpha: false }] });
    if (path === '/ping') return json({ service: 'nexus', version: 'composition-test', initialized: true, platform: 'windows' });
    if (path === '/pair') return json({ token: 'test-token' });
    if (path === '/onboarding') return json({ completed: true });
    if (path === '/preferences') return json({ language: 'en', themeMode: 'dark', accentColor: '#d72f38' });
    if (path === '/profiles') return json({ profiles: [{ id: 'default', name: 'Default' }], activeId: 'default' });
    if (path === '/defaults') return json({ panel: { layouts: {} } });
    if (path === '/apps-api/installed') return json({ apps });
    if (path === '/devices/all') return json([{ id: 'jungle-leopard-d215', name: state.record.displayName, category: 'display',
      connected: true, nexusControlEnabled: true, supportsNexusControl: true }]);
    if (path === '/panel/devices') return json({ devices: [state.record] });
    if (path === `/panel/devices/${state.record.id}/d215-brightness`) return json({ status: 'confirmed', value: 100 });
    if (path === `/panel/devices/${state.record.id}`) {
      if (request.method() === 'POST') {
        const patch = request.postDataJSON() as Partial<PanelDeviceRecord>;
        state.writes.push(patch);
        state.record = { ...state.record, ...patch };
      }
      return json(state.record);
    }
    return route.fulfill({ status: 404, body: '' });
  });
}

async function openDevice(page: Page, tab = 'Widgets') {
  await page.locator('[class*="sidebarColumn"]').getByRole('button', { name: 'Jungle Leopard D215' }).first().click();
  await page.getByRole('tab', { name: tab, exact: true }).click();
}

test('D215 Panel backgrounds toggle, stay independent, clip to circles and survive reload', async ({ page }, testInfo) => {
  const record = seed();
  record.layout!.d215Panels = { enabled: true, items: record.layout!.d215Panels!.items.slice(0, 2).map((item, index) => ({
    ...item, x: index === 0 ? 0.3 : 0.7, y: 0.5, diameter: 0.7,
    background: { mode: 'solid', color: index === 0 ? '#7f1d1d' : '#1e3a8a' },
  })) };
  const state: MockService = { record, writes: [] };
  await mockService(page, state);
  await page.goto('/');
  await openDevice(page, 'Panels');
  const frame = page.frameLocator('iframe');
  const circle = (index: number) => frame.locator(`[data-d215-panel-id="circle-${index}"]`);
  const backgrounds = page.getByRole('switch', { name: 'Backgrounds', exact: true });
  await expect(backgrounds).toBeChecked();
  await expect(circle(0).locator('[data-d215-panel-background]')).toHaveCSS('--panel-background-solid', '#7f1d1d');
  await expect(circle(1).locator('[data-d215-panel-background]')).toHaveCSS('--panel-background-solid', '#1e3a8a');
  await page.getByRole('button', { name: 'Clock 1', exact: true }).click();
  await page.getByRole('button', { name: '#064e3b', exact: true }).click();
  await expect.poll(() => state.record.layout?.d215Panels?.items[0].background?.color).toBe('#064e3b');
  expect(state.record.layout!.d215Panels!.items[1].background?.color).toBe('#1e3a8a');
  expect(state.record.backgroundColor).toBe(BACKGROUND);
  await expect(circle(0).locator('[data-d215-panel-background]')).toHaveCSS('--panel-background-solid', '#064e3b');

  const bounds = await circle(0).evaluate(element => {
    const circle = element.getBoundingClientRect();
    const layer = element.querySelector('[data-panel-bg-layer]')!.getBoundingClientRect();
    const background = element.querySelector('[data-d215-panel-background]')!;
    return { dx: Math.abs(circle.left - layer.left), dy: Math.abs(circle.top - layer.top),
      dw: Math.abs(circle.width - layer.width), dh: Math.abs(circle.height - layer.height),
      clip: getComputedStyle(background).overflow, radius: getComputedStyle(background).borderRadius };
  });
  // The standard card contributes a one-pixel border on each side.
  expect(Math.max(bounds.dx, bounds.dy, bounds.dw, bounds.dh)).toBeLessThanOrEqual(2);
  expect(bounds.clip).toBe('hidden');
  expect(bounds.radius).toBe('50%');
  await frame.locator('.panel-root').screenshot({ path: testInfo.outputPath('independent-panel-backgrounds.png') });
  await page.screenshot({ path: testInfo.outputPath('panel-background-controls.png') });

  await backgrounds.click();
  await expect(frame.locator('[data-d215-panel-background]')).toHaveCount(0);
  await expect(circle(0)).toHaveCSS('--panel-card-bg-opacity', '0%');
  const saved = JSON.stringify(state.record.layout!.d215Panels!.items.map(item => item.background));
  await backgrounds.click();
  await expect(frame.locator('[data-d215-panel-background]')).toHaveCount(2);
  expect(JSON.stringify(state.record.layout!.d215Panels!.items.map(item => item.background))).toBe(saved);
  await page.reload();
  await openDevice(page, 'Panels');
  await expect(backgrounds).toBeChecked();
  await expect(circle(0).locator('[data-d215-panel-background]')).toHaveCSS('--panel-background-solid', '#064e3b');
  await expect(circle(1).locator('[data-d215-panel-background]')).toHaveCSS('--panel-background-solid', '#1e3a8a');
  expect(state.record.backgroundColor).toBe(BACKGROUND);
});

test('D215 circle animations render, edit locally over the full shader range, and coexist with media', async ({ page }, testInfo) => {
  const record = seed();
  const effectState = { speed: 27, intensity: 1, hue: 0, colorize: 0, saturation: 1, contrast: 1, params: { u_zoom: 1, u_warp: 1 } };
  record.layout!.d215Panels = { enabled: true, backgroundsEnabled: true, items: record.layout!.d215Panels!.items.slice(0, 3).map((item, index) => ({
    ...item, x: 0.2 + index * 0.3, y: 0.5, diameter: 0.5,
    background: index === 2 ? { mode: 'media', mediaId: 'paint', mediaType: 'static' }
      : { mode: 'shader', effect: 'plasma', template: 0, effectState: { ...effectState, speed: index === 0 ? 27 : 85 } },
  })) };
  const state: MockService = { record, writes: [] };
  await mockService(page, state, [], true);
  const globalWrites: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET' && request.url().includes('/lighting/')) globalWrites.push(request.url()); });
  await page.goto('/');
  await openDevice(page, 'Panels');
  const frame = page.frameLocator('iframe');
  const first = frame.locator('[data-d215-panel-id="circle-0"]');
  await expect(first.locator('[data-panel-bg-layer]')).toHaveAttribute('data-ready', 'true');
  const media = frame.locator('[data-d215-panel-id="circle-2"] img');
  await expect.poll(() => media.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  await page.getByRole('button', { name: 'Clock 1', exact: true }).click();
  await page.getByRole('radio', { name: 'Effect Editor', exact: true }).click();
  await page.getByRole('slider', { name: 'Saturation', exact: true }).press('End');
  await expect.poll(() => state.record.layout?.d215Panels?.items[0].background?.effectState?.saturation).toBe(4);
  expect(state.record.layout!.d215Panels!.items[1].background?.effectState?.saturation).toBe(1);
  expect(state.record.layout!.d215Panels!.items[1].background?.effectState?.speed).toBe(85);
  expect(globalWrites).toEqual([]);
  await frame.locator('.panel-root').screenshot({ path: testInfo.outputPath('circle-animations-and-media.png') });
  await page.getByRole('switch', { name: 'Backgrounds', exact: true }).click();
  await expect(frame.locator('[data-d215-panel-background]')).toHaveCount(0);
  await expect(frame.locator('[data-d215-panel-id]')).toHaveCount(3);
});
