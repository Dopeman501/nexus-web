import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { BASE_DEFAULTS } from '../src/types/lighting';
import type { LightingAudioTriggerSettings } from '../src/api/lightingAudioTrigger';

const MICROPHONE = 'Test Microphone — USB Audio Interface with a deliberately long endpoint name for layout verification';

/** Production assets with every HTTP request and websocket isolated from the installed service. */
async function mockService(page: Page) {
  const root = resolve(process.env.D215_DIST ?? 'dist');
  const state = {
    trigger: { enabled: false, intensity: 50, switchDelay: 1, shuffle: false, looks: [] } as LightingAudioTriggerSettings,
    source: { direction: 'output', deviceId: '', deviceName: '' },
    writes: [] as string[],
    modeWrites: [] as string[],
    rejectSave: false,
  };
  await page.addInitScript(() => {
    localStorage.setItem('nexus_token', 'test-token');
    localStorage.setItem('nexus_settings', JSON.stringify({ general: {
      language: 'en', themeMode: 'dark', accentColor: '#d72f38', accentSource: 'custom', lightingDashboardMode: 'advanced',
    } }));
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
    if (type !== 'fetch' && type !== 'xhr') {
      const file = resolve(root, type === 'document' ? 'index.html' : `.${decodeURIComponent(path)}`);
      if (file.startsWith(root + sep) && existsSync(file)) return route.fulfill({ path: file });
      return route.fulfill({ status: 404, body: '' });
    }
    if (request.method() !== 'GET') {
      state.writes.push(path);
      if ((path.startsWith('/lighting/') && path !== '/lighting/audio-trigger' && path !== '/lighting/audio-output')
        || path.startsWith('/devices/lighting-devices/')) state.modeWrites.push(path);
    }
    if (path.startsWith('/lighting/shaders/')) {
      const shaderRoot = resolve('../nexus-service/src/Lighting/Engine/Gpu/Shaders');
      return json({ frag: readFileSync(resolve(shaderRoot, '_prelude.frag'), 'utf8') + '\n'
        + readFileSync(resolve(shaderRoot, 'scope.frag'), 'utf8') });
    }
    if (path === '/ping') return json({ service: 'nexus', version: 'lighting-audio-menu-test', initialized: true, platform: 'windows' });
    if (path === '/pair') return json({ token: 'test-token' });
    if (path === '/onboarding') return json({ completed: true });
    if (path === '/preferences') return json({ language: 'en', themeMode: 'dark', ui: { lightingDashboardMode: 'advanced' } });
    if (path === '/profiles') return json({ profiles: [{ id: 'default', name: 'Default' }], activeId: 'default' });
    if (path === '/defaults') return json({ panel: { layouts: {} } });
    if (path === '/panel/devices') return json({ devices: [] });
    if (path === '/apps-api/installed') return json({ apps: [] });
    if (path === '/devices/all') return json([]);
    if (path === '/media/library') return json({ items: [{ id: 'clip-one', name: 'Local Clip.gif', type: 'animated', frames: 30, fps: 30, width: 160, height: 90, importedAtUnixMs: 0 }] });
    if (path === '/media/current') return json({ mediaId: null, item: null });
    if (path === '/lighting/current') return json({ sync: 'scope', paused: false });
    if (path === '/lighting/animate/defaults') return json({ scope: { selected: 0, slots: Array.from({ length: 4 }, () => ({ ...BASE_DEFAULTS, params: {} })) } });
    if (path === '/lighting/animate/settings') return json({ effect: 'scope', states: { scope: { ...BASE_DEFAULTS, params: {} } }, templates: {} });
    if (path === '/lighting/animate/headless-start') return json({ error: false });
    if (path === '/lighting/status') return json({ available: true, gpuAvailable: true, rgbRunning: true, scanning: false });
    if (path === '/lighting/screen/effect' || path === '/lighting/media/effect') return json(BASE_DEFAULTS);
    if (path === '/devices/lighting-devices/all') return json({ isInit: true, devices: [
      { id: 'fixture-led', name: 'Fixture LEDs', ledsOn: true, ledCount: 10, canvasX: 0, canvasY: 0, canvasW: 80, canvasH: 40, canvasRotation: 0 },
    ] });
    if (path === '/devices/lighting-devices/pins') return json({ pins: {} });
    if (path === '/devices/lighting-devices/stacks') return json({ stacks: [] });
    if (path === '/devices/lighting-devices/layout-presets') return json({ presets: [], activeId: null });
    if (path === '/lighting/music-reactive') return json({ enabled: false });
    if (path === '/lighting/audio-trigger') {
      if (request.method() === 'POST') {
        if (state.rejectSave) return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
        state.trigger = request.postDataJSON();
      }
      return json(state.trigger);
    }
    if (path === '/lighting/audio-output') {
      if (request.method() === 'POST') state.source = request.postDataJSON();
      return json(state.source);
    }
    if (path === '/system/audio/devices') return json({ outputs: [
      { id: 'speakers', name: 'Test Speakers', isDefault: true },
    ], inputs: [{ id: 'mic', name: MICROPHONE, isDefault: true }] });
    return route.fulfill({ status: 404, body: '' });
  });
  return state;
}

// The expanded desktop shell has an established 1000px minimum width.
for (const viewport of [{ width: 1600, height: 1000 }, { width: 1000, height: 650 }]) {
  test(`Audio Trigger matches the lighting tabs and saves its top switch at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const state = await mockService(page);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    const openLighting = () => page.locator('[class*="sidebarColumn"]').getByRole('button', { name: 'Lighting', exact: true }).click();
    await openLighting();
    await expect.poll(() => state.modeWrites.includes('/lighting/animate/headless-start')).toBe(true);
    const trigger = page.getByRole('tab', { name: 'Audio Trigger', exact: true });
    const mirror = page.getByRole('tab', { name: 'Mirror', exact: true });
    expect(await trigger.getAttribute('class')).toBe(await mirror.getAttribute('class'));
    expect(await trigger.locator('svg').getAttribute('viewBox')).toBe('0 0 24 24');
    const tabs = page.getByRole('tablist', { name: 'Lighting', exact: true });
    await expect(tabs.getByRole('tab')).toHaveCount(6);
    expect((await tabs.getByRole('tab').allTextContents()).slice(-2)).toEqual(['Mirror', 'Audio Trigger']);
    const before = [...state.modeWrites];
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-selected', 'true');
    const panel = page.getByRole('tabpanel', { name: 'Audio Trigger', exact: true });
    const toggle = panel.getByRole('switch', { name: 'Audio Trigger', exact: true });
    await expect(toggle).not.toBeChecked();
    expect(await toggle.evaluate(element => element.closest('[role="tabpanel"]')?.querySelector('button') === element)).toBe(true);
    expect(state.modeWrites).toEqual(before);
    const box = await toggle.boundingBox();
    expect(box!.y).toBeLessThan(200);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(await toggle.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect.poll(() => state.trigger.enabled).toBe(true);
    await panel.getByRole('button', { name: '#1f0d36', exact: true }).click();
    await panel.getByRole('button', { name: 'Add look', exact: true }).click();
    await expect.poll(() => state.trigger.looks.length).toBe(1);
    await panel.getByRole('button', { name: '#2c0d0d', exact: true }).click();
    await panel.getByRole('button', { name: 'Add look', exact: true }).click();
    await expect.poll(() => state.trigger.looks.length).toBe(2);
    await expect(panel.getByRole('slider', { name: 'Frosted glass', exact: true })).toHaveCount(0);
    await expect(panel.getByRole('slider', { name: 'Background Opacity', exact: true })).toHaveCount(0);
    await panel.getByRole('radio', { name: 'Animations', exact: true }).click();
    await panel.getByRole('button', { name: 'Add look', exact: true }).click();
    await expect.poll(() => state.trigger.looks[2]?.effect).toBe('plasma');
    await panel.getByRole('button', { name: 'Remove look 3', exact: true }).click();
    await expect.poll(() => state.trigger.looks.length).toBe(2);
    await expect(panel.locator('canvas').first()).toBeVisible();
    await expect(panel.getByRole('radio', { name: 'Options', exact: true })).toBeVisible();
    await expect(panel.getByRole('radio', { name: 'Effect Editor', exact: true })).toBeVisible();
    await panel.getByRole('textbox', { name: 'Search effects', exact: true }).fill('Rainbow');
    await panel.getByRole('button', { name: 'Rainbow', exact: true }).click();
    await panel.getByRole('button', { name: 'Add look', exact: true }).click();
    await expect.poll(() => state.trigger.looks.length).toBe(3);
    expect(state.trigger.looks[2]).toMatchObject({ mode: 'animate', effect: 'rainbow', state: { params: {} } });
    await panel.getByRole('textbox', { name: 'Search effects', exact: true }).clear();
    await panel.locator('[class*="body"]').first().evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath(`lighting-shared-gallery-${viewport.width}.png`) });
    await panel.getByRole('radio', { name: 'Effect Editor', exact: true }).click();
    await panel.getByRole('radio', { name: 'Preset 3', exact: true }).click();
    await expect(panel.getByRole('radio', { name: 'Preset 3', exact: true })).toBeChecked();
    await panel.getByRole('slider', { name: 'Background zoom', exact: true }).press('End');
    await expect(panel.getByRole('radio', { name: 'Preset 3', exact: true })).toBeChecked();
    await panel.getByRole('button', { name: 'Add look', exact: true }).click();
    await expect.poll(() => state.trigger.looks[3]?.state?.params.u_background_zoom).toBe(3);
    const saveBox = await panel.getByRole('button', { name: 'Add look', exact: true }).boundingBox();
    expect(saveBox!.y).toBeLessThan(250);
    await expect(panel.getByRole('button', { name: 'Add look', exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`lighting-shared-editor-${viewport.width}.png`) });
    await panel.getByRole('radio', { name: 'Media', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Add look', exact: true })).toBeDisabled();
    await panel.getByRole('button', { name: 'Local Clip', exact: true }).click();
    await panel.getByRole('button', { name: 'Add look', exact: true }).click();
    await expect.poll(() => state.trigger.looks[4]).toEqual({ mode: 'media', mediaId: 'clip-one' });
    expect(state.writes.filter(path => path.startsWith('/media/'))).toEqual([]);
    await panel.getByRole('slider', { name: 'Audio Intensity', exact: true }).press('End');
    await expect.poll(() => state.trigger.intensity).toBe(100);
    await panel.getByRole('slider', { name: 'Switch Delay', exact: true }).press('Home');
    await expect.poll(() => state.trigger.switchDelay).toBe(0);
    await panel.getByRole('slider', { name: 'Switch Delay', exact: true }).press('ArrowRight');
    await expect.poll(() => state.trigger.switchDelay).toBe(0.1);
    await panel.getByRole('switch', { name: 'Shuffle', exact: true }).click();
    await expect.poll(() => state.trigger.shuffle).toBe(true);
    await panel.getByRole('button', { name: 'Audio source', exact: true }).click();
    await page.getByRole('option', { name: MICROPHONE, exact: true }).click();
    await expect.poll(() => state.source.deviceId).toBe('mic');
    expect(state.source.direction).toBe('input');
    const sourceBox = await panel.getByRole('button', { name: 'Audio source', exact: true }).boundingBox();
    expect(sourceBox!.x + sourceBox!.width).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath(`lighting-audio-trigger-${viewport.width}.png`) });
    await tabs.getByRole('tab', { name: 'Animation', exact: true }).click();
    await expect(panel).toHaveCount(0);
    expect(state.modeWrites).toEqual(before);
    await trigger.click();
    await expect(toggle).toBeChecked();
    await page.reload();
    await openLighting();
    await trigger.click();
    await expect(toggle).toBeChecked();
    await expect(panel.getByRole('button', { name: 'Audio source', exact: true })).toContainText('Test Microphone');
    state.rejectSave = true;
    await toggle.click();
    await expect(toggle).toBeChecked();
    expect(state.trigger.enabled).toBe(true);
    expect(state.trigger.looks).toHaveLength(5);
    expect(state.writes.filter(path => path === '/lighting/music-reactive')).toEqual([]);
    expect(errors).toEqual([]);
  });
}
