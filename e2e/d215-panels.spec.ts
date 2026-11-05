import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { PanelDeviceRecord } from '../src/api/panel';

test.use({ viewport: { width: 1600, height: 1100 }, colorScheme: 'dark' });

// Built dashboard plus real iframe/runtime; every service request is intercepted.
test('D215 composes six round Panels with settings, guides, resizing and reload', async ({ page }, testInfo) => {
  let record: PanelDeviceRecord = {
    id: 'panels-d215', displayName: 'Jungle Leopard D215', streamed: true, portrait: false, flip180: false,
    themeMode: 'dark', themeSyncWithDesktop: false, accentColor: '#d72f38', accentSyncWithDesktop: false,
    backgroundMode: 'solid', backgroundColor: '#362520',
    capabilities: { surface: 'lcd-wide', family: 'jungle-leopard-d215', cssWidth: 1680, cssHeight: 756, dpr: 1,
      touch: false, supportsPortrait: true },
    layout: { layoutSchemaVersion: 2, surface: 'lcd-wide', pages: [{ id: 'main', widgets: [
      { id: 'main-clock', type: 'clock', size: '4x2', col: 0, row: 0, config: { showSeconds: false } },
    ] }] },
  };
  const writes: unknown[] = [];
  const items = () => record.layout?.d215Panels?.items ?? [];
  await page.addInitScript(() => {
    localStorage.setItem('nexus_token', 'test-token');
    localStorage.setItem('nexus_settings', JSON.stringify({
      general: { language: 'en', themeMode: 'dark', accentColor: '#d72f38', accentSource: 'custom' },
    }));
    if ('serviceWorker' in navigator) Object.defineProperty(navigator, 'serviceWorker', { configurable: true, get: () => undefined });
  });
  await page.routeWebSocket(/\/ws(\?|$)/, () => {});
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const type = request.resourceType();
    if ((type !== 'fetch' && type !== 'xhr') || path.startsWith('/assets/')) {
      if (process.env.D215_DIST) {
        const root = resolve(process.env.D215_DIST);
        const file = resolve(root, type === 'document' ? 'index.html' : `.${decodeURIComponent(path)}`);
        if (file.startsWith(root + sep) && existsSync(file)) return route.fulfill({ path: file });
        return route.fulfill({ status: 404, body: '' });
      }
      return route.fallback();
    }
    const json = (body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/ping') return json({ service: 'nexus', version: 'panels-test', initialized: true, platform: 'windows' });
    if (path === '/pair') return json({ token: 'test-token' });
    if (path === '/onboarding') return json({ completed: true });
    if (path === '/preferences') return json({ language: 'en', themeMode: 'dark', accentColor: '#d72f38' });
    if (path === '/profiles') return json({ profiles: [{ id: 'default', name: 'Default' }], activeId: 'default' });
    if (path === '/defaults') return json({ panel: { layouts: {} } });
    if (path === '/apps-api/installed') return json({ apps: [] });
    if (path === '/devices/all') return json([{ id: 'jungle-leopard-d215', name: record.displayName, category: 'display', connected: true,
      nexusControlEnabled: true, supportsNexusControl: true }]);
    if (path === '/panel/devices') return json({ devices: [record] });
    if (path === `/panel/devices/${record.id}/d215-brightness`) return json({ status: 'confirmed', value: 100 });
    if (path === `/panel/devices/${record.id}`) {
      if (request.method() === 'POST') {
        const patch = request.postDataJSON() as Partial<PanelDeviceRecord>;
        writes.push(patch);
        record = { ...record, ...patch };
      }
      return json(record);
    }
    return route.fulfill({ status: 404, body: '' });
  });
  const openPanels = async () => {
    await page.locator('[class*="sidebarColumn"]').getByRole('button', { name: 'Jungle Leopard D215' }).first().click();
    await page.getByRole('tab', { name: 'Panels', exact: true }).click();
  };
  const frame = page.frameLocator('iframe');
  const circles = frame.locator('[data-d215-panel-id]');
  await page.goto('/');
  await openPanels();
  await expect(page.getByRole('tab').first()).toHaveText('Widgets');
  await expect(page.getByRole('tab').nth(1)).toHaveText('Panels');
  for (const [index, name] of ['Clock', 'Calendar', 'Monitoring', 'Media', 'Weather', 'Gallery'].entries()) {
    await page.locator(`[data-panel-catalog][role="button"][aria-label="${name}"]`).click();
    await expect.poll(() => items().length).toBe(index + 1);
    await expect(circles).toHaveCount(index + 1);
  }
  expect(items()).toHaveLength(6);
  await expect(page.getByText('Six panels are already on this display. Remove one to add another.', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Your dashboard is full. Remove or resize a widget to make room.', { exact: true })).toHaveCount(0);
  await expect(circles).toHaveCount(6);
  expect(record.backgroundColor).toBe('#362520');
  await expect(frame.locator('.panel-root')).toHaveCSS('--panel-background-solid', '#362520');
  await expect(frame.locator('[data-panel-widget-id="main-clock"]')).toHaveCount(0);
  await expect(page.locator('[data-panel-catalog][aria-label="Clock"]')).toHaveAttribute('aria-disabled', 'true');
  expect(record.layout?.pages[0].widgets[0].id).toBe('main-clock');
  await frame.locator('[data-d215-panels-canvas]').screenshot({ path: testInfo.outputPath('six-panels-default.png') });
  await page.screenshot({ path: testInfo.outputPath('panels-editor-default.png') });
  const clockId = items()[0].id;
  const clock = frame.locator(`[data-d215-panel-id="${clockId}"]`);
  await clock.click();
  await page.getByRole('switch', { name: 'Show seconds', exact: true }).click();
  await expect.poll(() => items()[0].config?.showSeconds).toBe(true);
  expect(record.layout?.pages[0].widgets[0].config?.showSeconds).toBe(false);
  expect(items().slice(1).every(item => item.config === undefined)).toBe(true);

  const canvas = frame.locator('[data-d215-panels-canvas]');
  const canvasBox = (await canvas.boundingBox())!;
  const beforeMove = (await clock.boundingBox())!;
  const writesBeforeMove = writes.length;
  await page.mouse.move(beforeMove.x + beforeMove.width / 2, beforeMove.y + beforeMove.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2, { steps: 8 });
  await expect(frame.locator('[data-d215-guide-axis="vertical"]')).toHaveCount(1);
  await expect(frame.locator('[data-d215-guide-axis="horizontal"]')).toHaveCount(1);
  expect(writes).toHaveLength(writesBeforeMove);
  await canvas.screenshot({ path: testInfo.outputPath('alignment-guides.png') });
  await page.mouse.up();
  await expect.poll(() => writes.length).toBe(writesBeforeMove + 1);
  expect(items()[0].x).toBeCloseTo(0.5, 3);
  expect(items()[0].y).toBeCloseTo(0.5, 3);
  await expect(frame.locator('[data-d215-guide-axis]')).toHaveCount(0);

  const diameter = items()[0].diameter;
  const handle = clock.locator('[data-corner="se"]');
  const handleBox = (await handle.boundingBox())!;
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 25, handleBox.y + handleBox.height / 2 + 25, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => items()[0].diameter).toBeGreaterThan(diameter);
  const resized = (await clock.boundingBox())!;
  expect(Math.abs(resized.width - resized.height)).toBeLessThan(1);

  const saved = JSON.stringify(items()[0]);
  const cancelWrites = writes.length;
  await page.mouse.move(resized.x + resized.width / 2, resized.y + resized.height / 2);
  await page.mouse.down();
  await page.mouse.move(resized.x + resized.width / 2 + 30, resized.y + resized.height / 2 + 20);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(writes).toHaveLength(cancelWrites);
  expect(JSON.stringify(items()[0])).toBe(saved);
  await page.reload();
  await openPanels();
  await expect(circles).toHaveCount(6);
  expect(JSON.stringify(items()[0])).toBe(saved);
  await canvas.screenshot({ path: testInfo.outputPath('six-panels.png') });
  await page.screenshot({ path: testInfo.outputPath('panels-editor.png') });

  await page.getByRole('switch', { name: 'Show Panels', exact: true }).click();
  await expect(circles).toHaveCount(0);
  await expect(frame.locator('[data-panel-widget-id="main-clock"]')).toHaveCount(1);
  expect(items()).toHaveLength(6);
  await page.getByRole('switch', { name: 'Show Panels', exact: true }).click();
  await expect(circles).toHaveCount(6);
  await clock.click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(circles).toHaveCount(5);
  expect(items().some(item => item.id === clockId)).toBe(false);

  record = { ...record, portrait: true, capabilities: { ...record.capabilities, surface: 'lcd-portrait', cssWidth: 756, cssHeight: 1680 } };
  await page.reload();
  await openPanels();
  await expect(circles).toHaveCount(5);
  const portrait = (await canvas.boundingBox())!;
  expect(portrait.height).toBeGreaterThan(portrait.width);
  for (const circle of await circles.all()) {
    const box = (await circle.boundingBox())!;
    expect(Math.abs(box.width - box.height)).toBeLessThan(1);
    expect(box.x).toBeGreaterThanOrEqual(portrait.x - 1);
    expect(box.y).toBeGreaterThanOrEqual(portrait.y - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(portrait.x + portrait.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(portrait.y + portrait.height + 1);
  }
  await canvas.screenshot({ path: testInfo.outputPath('portrait-panels.png') });
});
