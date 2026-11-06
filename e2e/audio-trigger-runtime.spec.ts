import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { PanelDeviceRecord } from '../src/api/panel';

test.use({ viewport: { width: 1200, height: 700 }, colorScheme: 'dark' });

async function fixture(page: Page, count = 2) {
  let record: PanelDeviceRecord = { id: 'audio-trigger', displayName: 'Audio Trigger fixture', firstSeenAt: 0, lastSeenAt: 0,
    themeMode: 'dark', themeSyncWithDesktop: false, backgroundMode: 'solid', backgroundColor: '#101010', backgroundOpacity: 1,
    capabilities: { surface: 'lcd-wide', family: 'jungle-leopard-d215', cssWidth: 1680, cssHeight: 756, dpr: 1, touch: false },
    layout: { layoutSchemaVersion: 2, surface: 'lcd-wide', pages: [{ id: 'main', widgets: [] }],
      d215Widget: { enabled: false, x: 0.5, y: 0.5, scale: 1 }, d215Panels: { enabled: false, items: [] } },
    backgroundAudioTrigger: { enabled: true, intensity: 50, switchDelay: 0.3, shuffle: false,
      backgrounds: [{ mode: 'solid' as const, color: '#ff0000' }, { mode: 'solid' as const, color: '#0000ff' }].slice(0, count) } };
  const root = resolve(process.env.D215_DIST ?? 'dist');
  const sockets: { route: WebSocketRoute; topics: Set<string> }[] = [];
  const writes: unknown[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('nexus_token', 'test-token');
    localStorage.setItem('nexus_settings', JSON.stringify({ general: { language: 'en', themeMode: 'dark' } }));
    if ('serviceWorker' in navigator) Object.defineProperty(navigator, 'serviceWorker', { configurable: true,
      value: { getRegistrations: async () => [], controller: null } });
  });
  await page.routeWebSocket(/\/ws(\?|$)/, route => {
    const socket = { route, topics: new Set<string>() };
    sockets.push(socket);
    route.onMessage(message => {
      const frame = JSON.parse(String(message)) as { sub?: string[]; unsub?: string[] };
      frame.sub?.forEach(topic => socket.topics.add(topic));
      frame.unsub?.forEach(topic => socket.topics.delete(topic));
    });
  });
  // Every request, including documents and sockets, stays inside this fixture.
  await page.route('**/*', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (request.resourceType() === 'document' || path.startsWith('/assets/')) {
      const file = resolve(root, request.resourceType() === 'document' ? 'index.html' : `.${decodeURIComponent(path)}`);
      return file.startsWith(root + sep) && existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404 });
    }
    if (path === '/ping') return json({ service: 'nexus', version: 'audio-trigger-fixture', initialized: true, platform: 'windows' });
    if (path === '/pair') return json({ token: 'test-token' });
    if (path === '/onboarding') return json({ completed: true });
    if (path === '/preferences') return json({ language: 'en', themeMode: 'dark' });
    if (path === '/profiles') return json({ profiles: [{ id: 'default', name: 'Default' }], activeId: 'default' });
    if (path === '/defaults') return json({ panel: { layouts: {} } });
    if (path === '/apps-api/installed') return json({ apps: [] });
    if (path === '/panel/devices') return json({ devices: [record] });
    if (path === '/panel/devices/audio-trigger') {
      if (request.method() === 'POST') { const patch = request.postDataJSON(); writes.push(patch); record = { ...record, ...patch }; }
      return json(record);
    }
    return route.fulfill({ status: 404, body: '' });
  });
  const send = (data: unknown) => sockets.forEach(socket => { if (socket.topics.has('audio')) socket.route.send(JSON.stringify({ t: 'audio', d: data })); });
  const sustain = async (data: unknown, ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 50) { send(data); await page.waitForTimeout(50); }
  };
  return { sockets, sustain, writes, changed: () => sockets.forEach(socket => socket.route.send(JSON.stringify({ t: 'panel/device', d: { deviceId: record.id } }))) };
}

const sound = { level: 0.8, bass: 0.05, beat: 0 };
const kick = { level: 0.8, bass: 0.8, beat: 1 };
const quiet = { level: 0, bass: 0, beat: 0 };
const selected = (page: Page) => page.locator('[data-audio-trigger-background]');

test('production renderer rejects pings, follows distinct attacks and restores normal after silence', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const state = await fixture(page);
  await page.goto('/panel/audio-trigger');
  await expect.poll(() => state.sockets.some(socket => socket.topics.has('audio'))).toBe(true);
  await state.sustain(sound, 100);
  await state.sustain(quiet, 400);
  await expect(selected(page)).toHaveCount(0);
  await state.sustain(sound, 550);
  await expect(selected(page)).toHaveCSS('--panel-background-solid', '#ff0000');
  await state.sustain(kick, 250);
  await expect(selected(page)).toHaveCSS('--panel-background-solid', '#0000ff');
  await state.sustain(sound, 100);
  await state.sustain(kick, 50);
  await expect(selected(page)).toHaveCSS('--panel-background-solid', '#ff0000');
  await state.sustain(quiet, 150);
  await expect(selected(page)).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('audio-trigger-active.png') });
  await state.sustain(sound, 150);
  await state.sustain(quiet, 450);
  await expect(selected(page)).toHaveCount(0);
  await expect(page.locator('.panel-root')).toHaveCSS('--panel-background-solid', '#101010');
  expect(state.writes).toEqual([]);
  expect(errors).toEqual([]);
});

test('one choice holds through beats, stale feed returns and disable releases audio demand', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const state = await fixture(page, 1);
  await page.goto('/panel/audio-trigger');
  await expect.poll(() => state.sockets.some(socket => socket.topics.has('audio'))).toBe(true);
  await state.sustain(sound, 500);
  await state.sustain(kick, 150);
  await expect(selected(page)).toHaveCSS('--panel-background-solid', '#ff0000');
  await expect(selected(page)).toHaveCount(0, { timeout: 1500 });
  await state.sustain(sound, 500);
  await expect(selected(page)).toHaveCount(1);
  await page.evaluate(async () => {
    await fetch('/panel/devices/audio-trigger', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      backgroundAudioTrigger: { enabled: false, intensity: 50, switchDelay: 0.3, shuffle: false, backgrounds: [] },
    }) });
  });
  state.changed();
  await expect(selected(page)).toHaveCount(0);
  await expect.poll(() => state.sockets.every(socket => !socket.topics.has('audio'))).toBe(true);
  expect(errors).toEqual([]);
});
