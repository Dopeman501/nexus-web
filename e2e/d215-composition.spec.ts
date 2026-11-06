import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { PanelDeviceRecord } from '../src/api/panel';
import type { AppInstalledListing } from '../src/widgets/types';

test.use({ viewport: { width: 1600, height: 1100 }, colorScheme: 'dark' });

const BACKGROUND = '#362520';
const AQUARIUM_TYPE = 'app:com.hellonexus.aquarium';
// Availability fields from the installed Aquarium 2.5.1 manifest. Its bundle is
// never loaded: this fixture verifies catalog conflicts, not SDK rendering.
const AQUARIUM: AppInstalledListing = {
  id: 'com.hellonexus.aquarium', name: 'Aquarium', version: '2.5.1', runtime: 'sdk', source: 'user',
  sizes: ['2x2', '4x2', '2x4', '4x4', '2x2round'], defaultSize: '4x4', gridSizes: ['4x4'],
  surfaces: ['dashboard', 'desktop', 'y70', 'phone', 'monitor', 'q60', 'kraken', 'lcd-round', 'lcd-square', 'lcd-wide'],
  singleInstance: true, immersive: true, freeform: true,
  capabilities: { 'sensors.read': [], 'rgb.read': false, 'rgb.write': false, 'net.fetch': [],
    dispatch: [], config: false, appData: true, audio: true, code: 'worker' },
};

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

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).click();

test('Monitoring Panel text color stays local, survives reload and resets to inherited text', async ({ page }, testInfo) => {
  const record = seed();
  record.layout!.d215Widget = { enabled: false, x: 0.5, y: 0.5, scale: 1 };
  record.layout!.d215Panels = { enabled: true, items: [0, 1].map(index => ({
    id: `monitor-${index}`, type: 'monitoring', x: index === 0 ? 0.3 : 0.7, y: 0.5, diameter: 0.7,
    config: { slot0_device: 'fps', slot0_design: index === 0 ? 'bar' : 'text' },
  })) };
  const state: MockService = { record, writes: [] };
  await mockService(page, state);
  await page.goto('/');
  await openDevice(page, 'Panels');
  await page.getByRole('button', { name: 'Monitoring 1', exact: true }).click();
  await expect(page.getByText('Text color', { exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Color by value', exact: true })).toBeVisible();
  const frame = page.frameLocator('iframe');
  const first = frame.locator('[data-d215-panel-id="monitor-0"] [data-monitoring-slot-index="0"]');
  const second = frame.locator('[data-d215-panel-id="monitor-1"] [data-monitoring-slot-index="0"]');
  const inherited = await first.evaluate(element => getComputedStyle(element).getPropertyValue('--text').trim());
  const other = await second.evaluate(element => getComputedStyle(element).getPropertyValue('--text').trim());
  await page.getByRole('button', { name: '#2563eb', exact: true }).click();
  await expect.poll(() => state.record.layout?.d215Panels?.items[0].config?.textColor).toBe('#2563eb');
  await expect(first).toHaveCSS('--text', '#2563eb');
  await expect(second).toHaveCSS('--text', other);
  expect(state.record.layout!.d215Panels!.items[1].config?.textColor).toBeUndefined();
  const textPicker = page.getByRole('group', { name: 'Text color', exact: true });
  // Settle editor scrolling before opening the portal, which dismisses on scroll.
  await textPicker.scrollIntoViewIfNeeded();
  await expect(textPicker).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath('monitoring-text-color-picker.png') });
  await frame.locator('.panel-root').screenshot({ path: testInfo.outputPath('independent-monitoring-text.png') });
  await textPicker.getByRole('button', { name: 'Custom color', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Custom color', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Hex color', exact: true }).fill('#12ab34');
  await expect.poll(() => state.record.layout?.d215Panels?.items[0].config?.textColor).toBe('#12ab34');
  await expect(first).toHaveCSS('--text', '#12ab34');
  await page.reload();
  await openDevice(page, 'Panels');
  await page.getByRole('button', { name: 'Monitoring 1', exact: true }).click();
  await expect(first).toHaveCSS('--text', '#12ab34');
  await expect(page.getByRole('group', { name: 'Text color', exact: true }).getByRole('button', { name: 'Custom color', exact: true })).toHaveAttribute('aria-current', 'true');
  await page.getByRole('group', { name: 'Text color', exact: true }).getByRole('button', { name: /Reset/ }).click();
  await expect.poll(() => state.record.layout?.d215Panels?.items[0].config?.textColor).toBeNull();
  await expect(first).toHaveCSS('--text', inherited);
});

test('Monitoring Micro simple captions use the selected text color', async ({ page }) => {
  const record = seed();
  record.layout!.d215Widget = { enabled: false, x: 0.5, y: 0.5, scale: 1 };
  record.layout!.d215Panels = { enabled: true, items: [{
    id: 'micro-color', type: 'monitoring', x: 0.5, y: 0.5, diameter: 0.8,
    config: { slotCount: 3, micro_device: 'fps', micro_design: 'simple',
      micro_sensor0: 'FPS', micro_sensor0_label: 'Alpha', micro_sensor0_labelMode: 'custom' },
  }] };
  await mockService(page, { record, writes: [] });
  await page.goto('/');
  await openDevice(page, 'Panels');
  await page.getByRole('button', { name: 'Monitoring 1', exact: true }).click();
  const caption = page.frameLocator('iframe').getByText('Alpha', { exact: true });
  await expect(caption).toBeVisible();
  await page.getByRole('group', { name: 'Text color', exact: true }).getByRole('button', { name: '#8b5cf6', exact: true }).click();
  await expect(caption).toHaveCSS('color', 'rgb(139, 92, 246)');
});

test('D215 Panel backgrounds toggle, stay independent, clip to circles and survive reload', async ({ page }, testInfo) => {
  const record = seed();
  record.layout!.d215Widget = { enabled: false, x: 0.5, y: 0.5, scale: 1 };
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
  record.layout!.d215Widget = { enabled: false, x: 0.5, y: 0.5, scale: 1 };
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

test('D215 combines Widget, six foreground Panels and background with persistent editing', async ({ page }, testInfo) => {
  const state: MockService = { record: seed(), writes: [] };
  await mockService(page, state);
  const frame = page.frameLocator('iframe');
  const widget = frame.locator('[data-d215-widget-frame]');
  const circles = frame.locator('[data-d215-panel-id]');
  const canvas = frame.locator('.panel-root');
  const panels = () => state.record.layout!.d215Panels!;
  await page.goto('/');
  await openDevice(page);
  const showWidgets = page.getByRole('switch', { name: 'Show Widgets', exact: true });
  const playlist = page.getByRole('switch', { name: 'Playlist', exact: true });
  await expect(showWidgets).not.toBeChecked();
  expect((await showWidgets.boundingBox())!.y).toBeLessThan((await playlist.boundingBox())!.y);
  await expect(page.getByRole('button', { name: 'Show Widgets', exact: true })).toHaveCount(0);
  await expect(page.getByText('Panels is active on the display. Your Widgets setup is kept.', { exact: true })).toHaveCount(0);
  await expect(widget).toHaveCount(0);
  await expect(circles).toHaveCount(6); // Panels only, preserving a legacy setup.

  await showWidgets.click();
  await expect(widget).toHaveCount(1);
  await expect(circles).toHaveCount(6); // Both independent layers.
  await expect.poll(() => state.record.layout?.d215Widget?.scale).toBe(0.6);
  await expect(widget.locator('[data-panel-widget-id]')).toHaveCount(1);
  await expect(widget.locator('[data-panel-widget-id="main-clock"]')).toHaveCount(1);

  await tab(page, 'Panels');
  const showPanels = page.getByRole('switch', { name: 'Show Panels', exact: true });
  const painted = await frame.locator('[data-d215-panel-id="circle-1"]').evaluate(element => {
    const ordinary = element.ownerDocument.querySelector('[data-d215-widget-frame]')!;
    const a = element.getBoundingClientRect();
    const b = ordinary.getBoundingClientRect();
    const left = Math.max(a.left, b.left);
    const right = Math.min(a.right, b.right);
    const top = Math.max(a.top, b.top);
    const bottom = Math.min(a.bottom, b.bottom);
    const hit = element.ownerDocument.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return { overlaps: right > left && bottom > top,
      followsWidget: !!(ordinary.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING),
      hitPanel: hit?.closest('[data-d215-panel-id]')?.getAttribute('data-d215-panel-id') };
  });
  expect(painted).toEqual({ overlaps: true, followsWidget: true, hitPanel: 'circle-1' });
  await canvas.screenshot({ path: testInfo.outputPath('widget-and-six-panels.png') });
  await page.screenshot({ path: testInfo.outputPath('composition-editor.png') });

  await showPanels.click();
  await expect(circles).toHaveCount(0);
  await expect(widget).toHaveCount(1); // Widget only.
  await tab(page, 'Widgets');
  await showWidgets.click();
  await expect(widget).toHaveCount(0);
  await expect(circles).toHaveCount(0); // Background only.
  await expect(canvas).toHaveCSS('--panel-background-solid', BACKGROUND);
  await expect(canvas.locator('[data-panel-bg-layer]')).toHaveCSS('background-color', 'rgb(54, 37, 32)');
  await canvas.screenshot({ path: testInfo.outputPath('background-only.png') });
  expect(state.record.backgroundColor).toBe(BACKGROUND);

  await tab(page, 'Panels');
  await showPanels.click();
  await expect(circles).toHaveCount(6);
  await expect(widget).toHaveCount(0);
  await tab(page, 'Widgets');
  await showWidgets.click();
  await expect(widget).toHaveCount(1);
  await expect(circles).toHaveCount(6);

  const beforeMove = (await widget.boundingBox())!;
  const beforeGeometry = { ...state.record.layout!.d215Widget! };
  const moveWrites = state.writes.length;
  await page.mouse.move(beforeMove.x + beforeMove.width / 2, beforeMove.y + beforeMove.height / 2);
  await page.mouse.down();
  await page.mouse.move(beforeMove.x + beforeMove.width / 2 + 37, beforeMove.y + beforeMove.height / 2 + 21, { steps: 7 });
  expect(state.writes).toHaveLength(moveWrites);
  expect(state.record.layout!.d215Widget).toEqual(beforeGeometry);
  await page.mouse.up();
  await expect.poll(() => state.writes.length).toBe(moveWrites + 1);
  expect(state.record.layout!.d215Widget!.x).toBeGreaterThan(beforeGeometry.x);
  expect(state.record.layout!.d215Widget!.y).toBeGreaterThan(beforeGeometry.y);

  const corner = frame.locator('[data-d215-widget-corner="se"]');
  const handle = (await corner.boundingBox())!;
  const beforeScale = state.record.layout!.d215Widget!.scale;
  const resizeWrites = state.writes.length;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 18, handle.y + handle.height / 2 + 10, { steps: 5 });
  expect(state.writes).toHaveLength(resizeWrites);
  await page.mouse.up();
  await expect.poll(() => state.writes.length).toBe(resizeWrites + 1);
  expect(state.record.layout!.d215Widget!.scale).toBeGreaterThan(beforeScale);
  const resized = (await widget.boundingBox())!;
  expect(resized.width / resized.height).toBeCloseTo(1680 / 756, 2);

  const savedWidget = { ...state.record.layout!.d215Widget! };
  const cancelWrites = state.writes.length;
  await page.mouse.move(resized.x + resized.width / 2, resized.y + resized.height / 2);
  await page.mouse.down();
  await page.mouse.move(resized.x + resized.width / 2 - 25, resized.y + resized.height / 2 + 17);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(state.writes).toHaveLength(cancelWrites);
  expect(state.record.layout!.d215Widget).toEqual(savedWidget);
  await expect(frame.locator('[data-d215-widget-guide-axis]')).toHaveCount(0);

  await tab(page, 'Panels');
  const active = frame.locator('[data-d215-panel-id="circle-0"]');
  const peer = frame.locator('[data-d215-panel-id="circle-1"]');
  await active.click();
  const shrink = (await active.locator('[data-corner="se"]').boundingBox())!;
  await page.mouse.move(shrink.x + shrink.width / 2, shrink.y + shrink.height / 2);
  await page.mouse.down();
  await page.mouse.move(shrink.x + shrink.width / 2 - 25, shrink.y + shrink.height / 2 - 25, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => panels().items[0].diameter).toBeLessThan(panels().items[1].diameter);
  const smaller = (await active.boundingBox())!;
  const peerBox = (await peer.boundingBox())!;
  const grow = (await active.locator('[data-corner="se"]').boundingBox())!;
  const difference = peerBox.width - smaller.width - 2;
  const guideWrites = state.writes.length;
  await page.mouse.move(grow.x + grow.width / 2, grow.y + grow.height / 2);
  await page.mouse.down();
  await page.mouse.move(grow.x + grow.width / 2 + difference, grow.y + grow.height / 2 + difference, { steps: 7 });
  await expect(frame.locator('[data-d215-matching-size]')).toHaveText('Matching size');
  await expect(frame.locator('[data-d215-guide-axis]')).toHaveCount(4);
  expect(state.writes).toHaveLength(guideWrites);
  await canvas.screenshot({ path: testInfo.outputPath('matching-size-guides.png') });
  await page.mouse.up();
  await expect.poll(() => state.writes.length).toBe(guideWrites + 1);
  expect(panels().items[0].diameter).toBeCloseTo(panels().items[1].diameter, 6);
  await expect(frame.locator('[data-d215-guide-axis], [data-d215-matching-size]')).toHaveCount(0);

  await page.reload();
  await openDevice(page, 'Panels');
  await expect(widget).toHaveCount(1);
  await expect(circles).toHaveCount(6);
  expect(state.record.layout!.d215Widget).toEqual(savedWidget);
  expect(state.record.layout!.pages[0].widgets[0]).toMatchObject({ id: 'main-clock', type: 'clock', config: { showSeconds: false } });
  await canvas.screenshot({ path: testInfo.outputPath('composition-reloaded.png') });

  state.record = { ...state.record, portrait: true, capabilities: { ...state.record.capabilities,
    surface: 'lcd-portrait', cssWidth: 756, cssHeight: 1680 } };
  await page.reload();
  await openDevice(page, 'Panels');
  await expect(widget).toHaveCount(1);
  await expect(circles).toHaveCount(6);
  const portrait = (await canvas.boundingBox())!;
  expect(portrait.height).toBeGreaterThan(portrait.width);
  for (const item of [widget, ...await circles.all()]) {
    const bounds = (await item.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(portrait.x - 1);
    expect(bounds.y).toBeGreaterThanOrEqual(portrait.y - 1);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(portrait.x + portrait.width + 1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(portrait.y + portrait.height + 1);
  }
  const portraitWidget = (await widget.boundingBox())!;
  expect(portraitWidget.width / portraitWidget.height).toBeCloseTo(756 / 1680, 2);
  await canvas.screenshot({ path: testInfo.outputPath('portrait-composition.png') });
});

test('D215 first Widget enable and playlist stand-in movement retain one complete gesture', async ({ page }, testInfo) => {
  const record = seed();
  record.layout!.d215Panels!.items = record.layout!.d215Panels!.items.slice(0, 1);
  const state: MockService = { record, writes: [] };
  await mockService(page, state);
  await page.goto('/');
  await openDevice(page);
  await page.getByRole('switch', { name: 'Show Widgets', exact: true }).click();
  await expect.poll(() => state.record.layout?.d215Widget?.scale).toBe(0.6);
  await page.getByRole('switch', { name: 'Playlist', exact: true }).click();
  await expect.poll(() => state.record.layout?.widgetPlaylist?.enabled).toBe(true);
  await page.getByRole('button', { name: 'Next widget', exact: true }).click();
  const frame = page.frameLocator('iframe');
  const widget = frame.locator('[data-d215-widget-frame]');
  const standIn = widget.locator('[data-panel-widget-id^="playlist:"]');
  await expect(standIn).toHaveCount(1);
  const id = await standIn.getAttribute('data-panel-widget-id');
  const before = (await widget.boundingBox())!;
  const writes = state.writes.length;
  const x = state.record.layout!.d215Widget!.x;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 42, before.y + before.height / 2 + 22, { steps: 8 });
  expect(state.writes).toHaveLength(writes);
  await expect(standIn).toHaveAttribute('data-panel-widget-id', id!);
  await page.mouse.up();
  await expect.poll(() => state.writes.length).toBe(writes + 1);
  expect(state.record.layout!.d215Widget!.x).toBeGreaterThan(x);
  expect(state.record.layout!.pages[0].widgets[0].id).toBe('main-clock');
  await expect(standIn).toHaveAttribute('data-panel-widget-id', id!);
  await frame.locator('.panel-root').screenshot({ path: testInfo.outputPath('playlist-widget-after-drag.png') });
  await page.screenshot({ path: testInfo.outputPath('playlist-composition-editor.png') });
});

test('D215 uses Aquarium manifest metadata to explain conflicts in Widgets and Panels', async ({ page }) => {
  const record = seed();
  record.layout!.d215Panels!.items = [{ id: 'fish-circle', type: AQUARIUM_TYPE, x: 0.5, y: 0.5, diameter: 0.4 }];
  const state: MockService = { record, writes: [] };
  await mockService(page, state, [AQUARIUM]);
  await page.goto('/');
  await openDevice(page);
  const choice = page.locator('[data-panel-catalog][role="button"][aria-label="Aquarium"]');
  await expect(choice).toHaveAttribute('aria-disabled', 'true');
  await expect(choice).toHaveAccessibleDescription('Aquarium is already used in Panels. Remove that panel to use it as a Widget.');
  await page.getByRole('switch', { name: 'Playlist', exact: true }).click();
  await expect.poll(() => state.record.layout?.widgetPlaylist?.enabled).toBe(true);
  expect(state.record.layout!.widgetPlaylist!.types).not.toContain(AQUARIUM_TYPE);
  expect(state.record.layout!.d215Panels!.items[0].id).toBe('fish-circle');

  state.record = { ...state.record, layout: { ...state.record.layout!, widgetPlaylist: undefined,
    pages: [{ id: 'main', widgets: [{ id: 'fish-widget', type: AQUARIUM_TYPE, size: '4x2', col: 0, row: 0 }] }],
    d215Widget: { enabled: true, x: 0.5, y: 0.5, scale: 0.6 }, d215Panels: { enabled: true, items: [] } } };
  await page.reload();
  await openDevice(page, 'Panels');
  await expect(choice).toHaveAttribute('aria-disabled', 'true');
  await expect(choice).toHaveAccessibleDescription('Aquarium is already used in Widgets. Choose another panel.');
});

test('D215 manually arranged fixture keeps one readable Widget left of six separate Panels', async ({ page }, testInfo) => {
  const original = seed();
  // Explicit user-arranged geometry for this demonstration, not an automatic
  // default arrangement. The other scenarios exercise the editing gestures.
  const record: PanelDeviceRecord = { ...original, layout: { ...original.layout!,
    d215Widget: { enabled: true, x: 0.32, y: 0.5, scale: 0.6 },
    d215Panels: { enabled: true, items: original.layout!.d215Panels!.items.map((item, index) => ({
      ...item, x: index % 2 === 0 ? 0.72 : 0.9, y: (Math.floor(index / 2) + 0.5) / 3, diameter: 0.25,
    })) },
  } };
  const state: MockService = { record, writes: [] };
  await mockService(page, state);
  await page.goto('/');
  await openDevice(page);
  const showWidgets = page.getByRole('switch', { name: 'Show Widgets', exact: true });
  const playlist = page.getByRole('switch', { name: 'Playlist', exact: true });
  await expect(showWidgets).toBeChecked();
  expect((await showWidgets.boundingBox())!.y).toBeLessThan((await playlist.boundingBox())!.y);

  const frame = page.frameLocator('iframe');
  const canvas = frame.locator('.panel-root');
  const widget = frame.locator('[data-d215-widget-frame]');
  const circles = frame.locator('[data-d215-panel-id]');
  await expect(widget).toHaveCount(1);
  await expect(circles).toHaveCount(6);
  const clock = widget.locator('[data-panel-widget-id="main-clock"]');
  await expect(clock).toBeVisible();
  const digits = clock.locator('[class*="glyph"]');
  await expect(digits).toHaveCount(4);
  await expect(digits.first()).toBeVisible();
  expect((await digits.first().boundingBox())!.height).toBeGreaterThan(24);
  expect((await digits.allTextContents()).join('')).toMatch(/^\d{4}$/);

  const output = (await canvas.boundingBox())!;
  const ordinary = (await widget.boundingBox())!;
  expect((ordinary.x + ordinary.width - output.x) / output.width).toBeCloseTo(0.62, 2);
  const bounds = [ordinary];
  for (const circle of await circles.all()) {
    await expect(circle).toBeVisible();
    const circleBounds = (await circle.boundingBox())!;
    expect(circleBounds.x).toBeGreaterThan(ordinary.x + ordinary.width);
    expect((circleBounds.x - output.x) / output.width).toBeGreaterThan(0.66);
    expect(circleBounds.width).toBeCloseTo(circleBounds.height, 1);
    bounds.push(circleBounds);
  }
  for (const item of bounds) {
    expect(item.x).toBeGreaterThanOrEqual(output.x - 1);
    expect(item.y).toBeGreaterThanOrEqual(output.y - 1);
    expect(item.x + item.width).toBeLessThanOrEqual(output.x + output.width + 1);
    expect(item.y + item.height).toBeLessThanOrEqual(output.y + output.height + 1);
  }
  for (let index = 1; index < bounds.length; index++) {
    for (let other = index + 1; other < bounds.length; other++) {
      const a = bounds[index];
      const b = bounds[other];
      expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
    }
  }
  expect(state.writes).toHaveLength(0);
  await canvas.screenshot({ path: testInfo.outputPath('manually-arranged-widget-and-six-panels.png') });
  await page.screenshot({ path: testInfo.outputPath('manually-arranged-widgets-editor.png') });
});
