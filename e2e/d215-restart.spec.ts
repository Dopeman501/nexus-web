import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { PanelDeviceRecord } from '../src/api/panel';
import type { D215RestartResult } from '../src/api/d215Restart';

test.use({ colorScheme: 'dark' });

interface MockService {
  record: PanelDeviceRecord; writes: unknown[]; restarts: number;
  connectionFailed?: boolean;
  controls?: unknown[];
  controlReply?: () => Promise<boolean>;
}

function seed(): MockService {
  return { writes: [], restarts: 0, record: {
    id: 'restart-ui-d215', displayName: 'Jungle Leopard D215', streamed: true, portrait: false, flip180: false,
    themeMode: 'dark', themeSyncWithDesktop: false, accentColor: '#d72f38', accentSyncWithDesktop: false,
    backgroundMode: 'solid', backgroundColor: '#362520', backgroundOpacity: 1, fpsCap: 30,
    firstSeenAt: 1, lastSeenAt: 1,
    capabilities: { surface: 'lcd-wide', family: 'jungle-leopard-d215', cssWidth: 1680, cssHeight: 756, dpr: 1,
      touch: false, supportsPortrait: true },
    layout: { layoutSchemaVersion: 2, surface: 'lcd-wide', pages: [{ id: 'main', widgets: [] }],
      d215Widget: { enabled: false, x: 0.5, y: 0.5, scale: 1 }, d215Panels: { enabled: false, items: [] } },
  } };
}

/** All HTTP/WebSocket requests remain intercepted, including frame/asset loads. */
async function mockService(page: Page, state: MockService, reply: () => Promise<D215RestartResult>) {
  const root = resolve(process.env.D215_DIST ?? 'dist');
  const devices = () => [{ id: 'jungle-leopard-d215', name: state.record.displayName, category: 'display',
    connected: true, nexusControlEnabled: true, supportsNexusControl: true,
    warning: state.connectionFailed ? 'The display connection failed. Reconnect it or retry Nexus Control.' : undefined }];
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
    if ((type !== 'fetch' && type !== 'xhr') || path.startsWith('/assets/')) {
      const file = resolve(root, type === 'document' ? 'index.html' : `.${decodeURIComponent(path)}`);
      if (file.startsWith(root + sep) && existsSync(file)) return route.fulfill({ path: file });
      return route.fulfill({ status: 404, body: '' });
    }
    if (path === '/ping') return json({ service: 'nexus', version: 'restart-ui-isolated-test', initialized: true, platform: 'windows' });
    if (path === '/pair') return json({ token: 'test-token' });
    if (path === '/onboarding') return json({ completed: true });
    if (path === '/preferences') return json({ language: 'en', themeMode: 'dark', accentColor: '#d72f38' });
    if (path === '/profiles') return json({ profiles: [{ id: 'default', name: 'Default' }], activeId: 'default' });
    if (path === '/defaults') return json({ panel: { layouts: {} } });
    if (path === '/apps-api/installed') return json({ apps: [] });
    if (path === '/devices/all') return json(devices());
    if (path === '/devices/control' && request.method() === 'POST') {
      const body = request.postDataJSON();
      expect(body).toEqual({ id: 'jungle-leopard-d215', enabled: true });
      state.controls?.push(body);
      if (state.controlReply && !await state.controlReply()) return route.fulfill({ status: 503, body: '' });
      return json(devices());
    }
    if (path === '/panel/devices') return json({ devices: [state.record] });
    if (path.endsWith('/background-media/library')) return json({ items: [] });
    // An unavailable readback must not disable the explicit recovery action.
    if (path === `/panel/devices/${state.record.id}/d215-brightness`) return json({ status: 'unavailable', value: null });
    if (path === `/panel/devices/${state.record.id}/d215-restart` && request.method() === 'POST') {
      expect(request.postDataJSON()).toEqual({});
      state.restarts++;
      return json(await reply());
    }
    // Navigation and memory reporting are ordinary UI housekeeping. Keep all
    // other unexpected writes visible so this still catches settings changes.
    if (request.method() === 'POST' && (path === '/diagnostics/client-mem'
      || path.startsWith('/telemetry/page-viewed/') || path === '/session/last-route')) {
      return json({ error: false, msg: 'Ok' });
    }
    if (request.method() !== 'GET') state.writes.push({ path, body: request.postData() });
    if (path === `/panel/devices/${state.record.id}`) return json(state.record);
    return route.fulfill({ status: 404, body: '' });
  });
}

async function openSettings(page: Page) {
  await page.locator('[class*="sidebarColumn"]').getByRole('button', { name: 'Jungle Leopard D215' }).first().click();
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
}

for (const viewport of [{ width: 1600, height: 1100 }, { width: 800, height: 650 }]) {
  test(`D215 Settings restarts once and keeps saved settings at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const state = seed();
    const before = JSON.stringify(state.record);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let complete!: (result: D215RestartResult) => void;
    const pending = new Promise<D215RestartResult>(resolve => { complete = resolve; });
    await mockService(page, state, () => pending);
    await page.goto('/');
    await openSettings(page);
    const restart = page.getByRole('button', { name: 'Restart screen', exact: true });
    await expect(restart).toBeEnabled();
    expect(state.restarts).toBe(0);
    await restart.click();
    const restarting = page.getByRole('button', { name: 'Restarting…', exact: true });
    await expect(restarting).toBeDisabled();
    await restarting.evaluate((element: HTMLButtonElement) => element.click());
    await expect.poll(() => state.restarts).toBe(1);
    complete({ status: 'restarted' });
    await expect(page.getByRole('status').filter({ hasText: 'The screen restarted and reconnected. Check the display.' })).toBeVisible();
    await expect(restart).toBeEnabled();
    await restart.locator('xpath=ancestor::section[1]').screenshot({ path: testInfo.outputPath('restart-screen-setting.png') });
    expect(state.restarts).toBe(1);
    expect(state.writes).toEqual([]);
    expect(JSON.stringify(state.record)).toBe(before);
    expect(errors).toEqual([]);
  });
}

test('D215 Settings reports unavailable and uncertain outcomes without automatic retry', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  const state = seed();
  const responses: D215RestartResult[] = [{ status: 'unavailable' }, { status: 'uncertain' }];
  await mockService(page, state, async () => responses.shift()!);
  await page.goto('/');
  await openSettings(page);
  const restart = page.getByRole('button', { name: 'Restart screen', exact: true });
  await restart.click();
  await expect(page.getByRole('status').filter({ hasText: 'Screen restart is unavailable. Check USB and enable Nexus Control.' })).toBeVisible();
  expect(state.restarts).toBe(1);
  await restart.click();
  await expect(page.getByRole('status').filter({ hasText: 'Restart could not be confirmed. Wait for the screen to reconnect before trying again.' })).toBeVisible();
  expect(state.restarts).toBe(2);
  expect(state.writes).toEqual([]);
});

for (const viewport of [{ width: 1600, height: 900 }, { width: 800, height: 650 }]) {
  test(`D215 failed connection exposes both recovery actions at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const state = seed();
    state.connectionFailed = true; state.record.streamed = false; state.controls = [];
    const before = JSON.stringify(state.record);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let finishControl!: (accepted: boolean) => void;
    state.controlReply = () => new Promise<boolean>(resolve => { finishControl = resolve; });
    let finishScreen!: (result: D215RestartResult) => void;
    await mockService(page, state, () => new Promise<D215RestartResult>(resolve => { finishScreen = resolve; }));
    await page.goto('/');
    await page.locator('[class*="sidebarColumn"]').getByRole('button', { name: /Jungle Leopard D215/ }).first().click();
    const soft = page.getByRole('button', { name: 'Restart Nexus Control', exact: true });
    const hard = page.getByRole('button', { name: 'Restart screen', exact: true });
    const group = page.getByRole('group', { name: 'Display recovery', exact: true });
    await expect(soft).toBeEnabled(); await expect(hard).toBeEnabled();
    expect(state.controls).toEqual([]); expect(state.restarts).toBe(0);
    const bounds = await group.boundingBox();
    expect(bounds).not.toBeNull(); expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath('connection-failed-recovery.png') });
    await soft.click();
    const controlBusy = page.getByRole('button', { name: 'Restarting Nexus Control…', exact: true });
    await expect(controlBusy).toBeDisabled(); await expect(hard).toBeDisabled();
    await controlBusy.evaluate((element: HTMLButtonElement) => element.click());
    await expect.poll(() => state.controls?.length).toBe(1);
    finishControl(true);
    await expect(page.getByText('Nexus Control is restarting. Wait for the display to reconnect.', { exact: true })).toBeVisible();
    await expect(soft).toBeEnabled();
    await hard.click();
    await expect(soft).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Restarting…', exact: true })).toBeDisabled();
    await expect.poll(() => state.restarts).toBe(1);
    finishScreen({ status: 'restarted' });
    await expect(page.getByText('The screen restarted and reconnected. Check the display.', { exact: true })).toBeVisible();
    await expect(hard).toBeEnabled();
    expect(state.controls).toEqual([{ id: 'jungle-leopard-d215', enabled: true }]);
    expect(state.restarts).toBe(1); expect(state.writes).toEqual([]);
    expect(JSON.stringify(state.record)).toBe(before); expect(errors).toEqual([]);
  });
}

test('D215 failed connection reports control refusal and uncertain hard restart without retries', async ({ page }) => {
  const state = seed();
  state.connectionFailed = true; state.record.streamed = false; state.controls = [];
  state.controlReply = async () => false;
  await mockService(page, state, async () => ({ status: 'uncertain' }));
  await page.goto('/');
  await page.locator('[class*="sidebarColumn"]').getByRole('button', { name: /Jungle Leopard D215/ }).first().click();
  await page.getByRole('button', { name: 'Restart Nexus Control', exact: true }).click();
  await expect(page.getByText('Nexus Control restart could not be confirmed. Check the connection and try again.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restart screen', exact: true }).click();
  await expect(page.getByText('Restart could not be confirmed. Wait for the screen to reconnect before trying again.', { exact: true })).toBeVisible();
  expect(state.controls).toHaveLength(1); expect(state.restarts).toBe(1); expect(state.writes).toEqual([]);
});
