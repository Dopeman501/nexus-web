import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { PanelDeviceRecord } from '../src/api/panel';

test.use({ viewport: { width: 1600, height: 1100 }, colorScheme: 'dark' });

const NORMAL_COLOR = '#362520';
const NORMAL_MEDIA = 'normal-media';
interface MockService { record: PanelDeviceRecord; writes: Partial<PanelDeviceRecord>[]; globalWrites: string[] }

function seed(): MockService {
  return { writes: [], globalWrites: [], record: {
    id: 'audio-ui-d215', displayName: 'Jungle Leopard D215', streamed: true, portrait: false, flip180: false,
    themeMode: 'dark', themeSyncWithDesktop: false, accentColor: '#d72f38', accentSyncWithDesktop: false,
    backgroundMode: 'media', backgroundColor: NORMAL_COLOR, backgroundOpacity: 1,
    backgroundMediaId: NORMAL_MEDIA, backgroundMediaType: 'static', backgroundMediaSlideshow: false,
    firstSeenAt: 1, lastSeenAt: 1,
    capabilities: { surface: 'lcd-wide', family: 'jungle-leopard-d215', cssWidth: 1680, cssHeight: 756, dpr: 1,
      touch: false, supportsPortrait: true },
    layout: { layoutSchemaVersion: 2, surface: 'lcd-wide', pages: [{ id: 'main', widgets: [] }],
      d215Widget: { enabled: false, x: 0.5, y: 0.5, scale: 1 }, d215Panels: { enabled: false, items: [] } },
  } };
}

/** Every browser request, including websockets/iframes, stays inside this fixture. */
async function mockService(page: Page, state: MockService) {
  const root = resolve(process.env.D215_DIST ?? 'dist');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1680" height="756"><rect width="1680" height="756" fill="#024f62"/><circle cx="840" cy="378" r="240" fill="#ffd273"/></svg>';
  await page.addInitScript(() => {
    localStorage.setItem('nexus_token', 'test-token');
    localStorage.setItem('nexus_settings', JSON.stringify({
      general: { language: 'en', themeMode: 'dark', accentColor: '#d72f38', accentSource: 'custom' },
    }));
    if ('serviceWorker' in navigator) Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true, get: () => ({ getRegistrations: async () => [], register: async () => null }),
    });
  });
  await page.routeWebSocket(/.*/, () => {});
  await page.route('**/*', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const type = request.resourceType();
    const json = (body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (path.includes('/background-media/') && (path.endsWith('/file') || path.endsWith('/thumbnail'))) {
      return route.fulfill({ contentType: 'image/svg+xml', body: svg });
    }
    if ((type !== 'fetch' && type !== 'xhr') || path.startsWith('/assets/')) {
      const file = resolve(root, type === 'document' ? 'index.html' : `.${decodeURIComponent(path)}`);
      if (file.startsWith(root + sep) && existsSync(file)) return route.fulfill({ path: file });
      return route.fulfill({ status: 404, body: '' });
    }
    if (request.method() !== 'GET' && path.startsWith('/lighting/')) state.globalWrites.push(path);
    if (path.startsWith('/lighting/shaders/')) {
      const shaderRoot = resolve('../nexus-service/src/Lighting/Engine/Gpu/Shaders');
      return json({ frag: readFileSync(resolve(shaderRoot, '_prelude.frag'), 'utf8') + '\n' + readFileSync(resolve(shaderRoot, 'plasma.frag'), 'utf8') });
    }
    if (path.endsWith('/background-media/library')) return json({ items: [
      { id: NORMAL_MEDIA, name: 'Normal background.svg', type: 'static', sourceExt: '.svg', width: 1680, height: 756, importedAtUnixMs: 1, durationSec: 0, alpha: false },
      { id: 'audio-cyan', name: 'Audio cyan.svg', type: 'static', sourceExt: '.svg', width: 1680, height: 756, importedAtUnixMs: 2, durationSec: 0, alpha: false },
    ] });
    if (path === '/ping') return json({ service: 'nexus', version: 'audio-ui-isolated-test', initialized: true, platform: 'windows' });
    if (path === '/pair') return json({ token: 'test-token' });
    if (path === '/onboarding') return json({ completed: true });
    if (path === '/preferences') return json({ language: 'en', themeMode: 'dark', accentColor: '#d72f38' });
    if (path === '/profiles') return json({ profiles: [{ id: 'default', name: 'Default' }], activeId: 'default' });
    if (path === '/defaults') return json({ panel: { layouts: {} } });
    if (path === '/apps-api/installed') return json({ apps: [] });
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

async function openBackground(page: Page) {
  await page.locator('[class*="sidebarColumn"]').getByRole('button', { name: 'Jungle Leopard D215' }).first().click();
  await page.getByRole('tab', { name: 'Background', exact: true }).click();
}

test('Audio Trigger menu saves mixed selections and settings independently of the normal background', async ({ page }, testInfo) => {
  const state = seed();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await mockService(page, state);
  await page.goto('/');
  await openBackground(page);
  const trigger = page.getByRole('switch', { name: 'Audio Trigger', exact: true });
  await expect(trigger).not.toBeChecked();
  const order = await trigger.evaluate(element => {
    const slideshow = [...document.querySelectorAll('[role="switch"]')].find(switchElement => switchElement.getAttribute('aria-label') === 'Slideshow');
    return slideshow ? !!(element.compareDocumentPosition(slideshow) & Node.DOCUMENT_POSITION_FOLLOWING) : false;
  });
  expect(order).toBe(true);
  await trigger.click();
  await expect.poll(() => state.record.backgroundAudioTrigger?.enabled).toBe(true);
  await page.getByRole('button', { name: 'Backgrounds', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Audio Trigger backgrounds', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(':scope > div')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(dialog.getByRole('switch', { name: 'Slideshow', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '#7f1d1d', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add background', exact: true }).click();
  await expect.poll(() => state.record.backgroundAudioTrigger?.backgrounds.length).toBe(1);
  await dialog.getByRole('radio', { name: 'Animations', exact: true }).click();
  await dialog.getByRole('button', { name: 'Plasma', exact: true }).click();
  await dialog.getByRole('radio', { name: 'Effect Editor', exact: true }).click();
  await dialog.getByRole('slider', { name: 'Saturation', exact: true }).press('End');
  await dialog.getByRole('button', { name: 'Add background', exact: true }).click();
  await expect.poll(() => state.record.backgroundAudioTrigger?.backgrounds.length).toBe(2);
  expect(state.record.backgroundAudioTrigger!.backgrounds[1].effectState!.saturation).toBe(4);
  await dialog.getByRole('radio', { name: 'Media', exact: true }).click();
  await dialog.getByRole('button', { name: 'Audio cyan', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add background', exact: true }).click();
  await expect.poll(() => state.record.backgroundAudioTrigger?.backgrounds.length).toBe(3);
  expect(state.record.backgroundAudioTrigger!.backgrounds.map(background => background.mode)).toEqual(['solid', 'shader', 'media']);
  await dialog.getByRole('slider', { name: 'Audio Intensity', exact: true }).press('End');
  await expect.poll(() => state.record.backgroundAudioTrigger?.intensity).toBe(100);
  await dialog.getByRole('slider', { name: 'Switch Delay', exact: true }).press('Home');
  await dialog.getByRole('slider', { name: 'Switch Delay', exact: true }).press('ArrowRight');
  await expect.poll(() => state.record.backgroundAudioTrigger?.switchDelay).toBe(0.1);
  await dialog.getByRole('switch', { name: 'Shuffle', exact: true }).click();
  await expect.poll(() => state.record.backgroundAudioTrigger?.shuffle).toBe(true);
  await dialog.locator(':scope > div').screenshot({ path: testInfo.outputPath('audio-trigger-mixed-backgrounds.png') });
  await dialog.getByRole('button', { name: 'Edit background 1', exact: true }).click();
  await dialog.getByRole('button', { name: '#1e3a8a', exact: true }).click();
  await dialog.getByRole('button', { name: 'Update background', exact: true }).click();
  await expect.poll(() => state.record.backgroundAudioTrigger?.backgrounds[0].color).toBe('#1e3a8a');
  expect(state.record.backgroundAudioTrigger!.backgrounds[2].mediaId).toBe('audio-cyan');
  await dialog.getByRole('button', { name: 'Remove background 2', exact: true }).click();
  await expect.poll(() => state.record.backgroundAudioTrigger?.backgrounds.length).toBe(2);
  const saved = JSON.stringify(state.record.backgroundAudioTrigger);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Backgrounds', exact: true })).toBeFocused();
  expect(state.record.backgroundMediaId).toBe(NORMAL_MEDIA);
  expect(state.record.backgroundColor).toBe(NORMAL_COLOR);
  expect(state.record.backgroundMode).toBe('media');
  expect(state.globalWrites).toEqual([]);
  await page.reload();
  await openBackground(page);
  await expect(trigger).toBeChecked();
  expect(JSON.stringify(state.record.backgroundAudioTrigger)).toBe(saved);
  await page.getByRole('button', { name: 'Backgrounds', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Edit background 2', exact: true })).toContainText('Audio cyan.svg');
  await expect(dialog.getByRole('slider', { name: 'Switch Delay', exact: true })).toHaveValue('0.1');
  await page.setViewportSize({ width: 800, height: 650 });
  const compact = await dialog.locator(':scope > div').boundingBox();
  expect(compact).not.toBeNull();
  expect(compact!.x).toBeGreaterThanOrEqual(0);
  expect(compact!.x + compact!.width).toBeLessThanOrEqual(800);
  expect(compact!.height).toBeLessThanOrEqual(650);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await trigger.click();
  await expect.poll(() => state.record.backgroundAudioTrigger?.enabled).toBe(false);
  expect(state.record.backgroundAudioTrigger!.backgrounds.length).toBe(2);
  expect(state.record.backgroundMediaId).toBe(NORMAL_MEDIA);
  expect(errors).toEqual([]);
});
