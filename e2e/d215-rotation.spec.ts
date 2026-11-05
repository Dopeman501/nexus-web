import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';

test.use({ viewport: { width: 1440, height: 960 }, colorScheme: 'dark' });

// This exercises the dashboard against a mock service; no device is opened.
test('D215 rotation and frame cap persist after reopening', async ({ page }, testInfo) => {
  let record = {
    id: 'rotation-d215', displayName: 'Jungle Leopard D215', streamed: true,
    portrait: false, flip180: false, fpsCap: null as number | null,
    capabilities: {
      surface: 'lcd-wide', family: 'jungle-leopard-d215',
      cssWidth: 1680, cssHeight: 756, dpr: 1, touch: false, supportsPortrait: true,
    },
    layout: { layoutSchemaVersion: 2, surface: 'lcd-wide', pages: [{ id: 'p1', widgets: [] }] },
  };
  const writes: unknown[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('nexus_token', 'test-token');
    localStorage.setItem('nexus_settings', JSON.stringify({
      general: { language: 'en', themeMode: 'dark', accentColor: '#d72f38', accentSource: 'custom' },
    }));
    if ('serviceWorker' in navigator) {
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, get: () => undefined });
    }
  });
  await page.routeWebSocket(/\/ws(\?|$)/, () => {});
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const type = request.resourceType();
    if ((type !== 'fetch' && type !== 'xhr') || path.startsWith('/assets/')) {
      // Direct build files avoid binding the live service's port on Windows.
      if (process.env.D215_DIST) {
        const root = resolve(process.env.D215_DIST);
        const file = resolve(root, type === 'document' ? 'index.html' : `.${decodeURIComponent(path)}`);
        if (file.startsWith(root + sep) && existsSync(file)) return route.fulfill({ path: file });
        return route.fulfill({ status: 404, body: '' });
      }
      return route.fallback();
    }
    const json = (body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/ping') return json({ service: 'nexus', version: 'rotation-test', initialized: true, platform: 'windows' });
    if (path === '/pair') return json({ token: 'test-token' });
    if (path === '/onboarding') return json({ completed: true });
    if (path === '/preferences') return json({ language: 'en', themeMode: 'dark', accentColor: '#d72f38' });
    if (path === '/profiles') return json({ profiles: [{ id: 'default', name: 'Default' }], activeId: 'default' });
    if (path === '/defaults') return json({ panel: { layouts: {} } });
    if (path === '/devices/all') return json([{
      id: 'jungle-leopard-d215', name: record.displayName, category: 'display', connected: true,
      nexusControlEnabled: true, supportsNexusControl: true,
    }]);
    if (path === '/panel/devices') return json({ devices: [record] });
    if (path === `/panel/devices/${record.id}/d215-brightness`) return json({ status: 'confirmed', value: 100 });
    if (path === `/panel/devices/${record.id}`) {
      if (request.method() === 'POST') {
        const patch = request.postDataJSON() as { portrait?: boolean; flip180?: boolean; fpsCap?: number };
        writes.push(patch);
        const portrait = patch.portrait ?? record.portrait;
        record = { ...record, ...patch, fpsCap: patch.fpsCap === undefined ? record.fpsCap : patch.fpsCap || null,
          capabilities: { ...record.capabilities,
          surface: portrait ? 'lcd-portrait' : 'lcd-wide',
          cssWidth: portrait ? 756 : 1680, cssHeight: portrait ? 1680 : 756,
        } };
      }
      return json(record);
    }
    return route.fulfill({ status: 404, body: '' });
  });

  await page.goto('/');
  await page.locator('[class*="sidebarColumn"]').getByRole('button', { name: 'Jungle Leopard D215' }).first().click();
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  const group = page.getByRole('radiogroup', { name: 'Rotation', exact: true });
  await expect(group.getByRole('radio', { name: '0°', exact: true })).toBeChecked();
  await expect(page.getByRole('switch', { name: 'Portrait mount', exact: true })).toHaveCount(0);
  for (const angle of [90, 180, 270, 0]) {
    await group.getByRole('radio', { name: `${angle}°`, exact: true }).click();
    await expect(group.getByRole('radio', { name: `${angle}°`, exact: true })).toBeChecked();
  }
  expect(writes).toEqual([
    { portrait: true, flip180: false }, { portrait: false, flip180: true },
    { portrait: true, flip180: true }, { portrait: false, flip180: false },
  ]);
  await page.getByRole('region', { name: 'Rotation', exact: true }).screenshot({ path: testInfo.outputPath('rotation-control.png') });
  await page.getByRole('tab', { name: 'Widgets', exact: true }).click();
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect(group.getByRole('radio', { name: '0°', exact: true })).toBeChecked();
  const frameCap = page.getByRole('button', { name: 'Frame cap', exact: true });
  for (const [label, cap] of [['60 Hz', 60], ['15 Hz', 15], ['Off', 0]] as const) {
    await frameCap.click();
    await page.getByRole('option', { name: label, exact: true }).click();
    await expect(frameCap).toContainText(label);
    await expect.poll(() => writes.at(-1)).toEqual({ fpsCap: cap });
  }
  await frameCap.click();
  await page.getByRole('option', { name: '60 Hz', exact: true }).click();
  await expect.poll(() => writes.at(-1)).toEqual({ fpsCap: 60 });
  await page.getByRole('tab', { name: 'Widgets', exact: true }).click();
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect(frameCap).toContainText('60 Hz');
  await frameCap.locator('xpath=ancestor::section[1]').screenshot({ path: testInfo.outputPath('frame-cap-60.png') });
});
