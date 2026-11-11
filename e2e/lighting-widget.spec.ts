import { expect, test, type Locator, type Page, type WebSocketRoute } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { PanelDeviceRecord } from '../src/api/panel';
import type { LightingDevice, Pin } from '../src/api/lighting';
import { BASE_DEFAULTS, EFFECTS, type EffectTemplateBundle } from '../src/types/lighting';

type Surface = 'y70' | 'monitor' | 'phone';
interface Mutation { path: string; body: Record<string, unknown> }
const CUSTOM = 'custom:widgetfixture';
const OTHER_CUSTOM = 'custom:preservefixture';
const viewport = (surface: Surface) => surface === 'y70' ? { width: 688, height: 2560 }
  : surface === 'monitor' ? { width: 1280, height: 720 } : { width: 390, height: 844 };

function bundle(selected = 0): EffectTemplateBundle {
  return { selected, slots: [0.3, 0.5, 0.7, 0.9].map((intensity, index) => ({
    ...BASE_DEFAULTS, speed: 30 + index * 10, intensity,
    params: { u_saved_knob: index + 0.25, u_background_rotation: index * 15 },
  })) };
}

function fixture(surface: Surface) {
  const size = viewport(surface);
  const record: PanelDeviceRecord = {
    id: 'lighting-widget-spec', displayName: 'Lighting widget test panel', firstSeenAt: 1, lastSeenAt: 1,
    displayId: surface === 'monitor' ? 'mock-xeneon-edge' : undefined,
    themeMode: 'dark', themeSyncWithDesktop: false, accentColor: '#20bfa5', accentSyncWithDesktop: false,
    backgroundMode: 'solid', backgroundColor: '#151515', backdrop: 'theme',
    capabilities: { surface, touch: true, dpr: 1, family: surface === 'monitor' ? 'xeneon-edge' : undefined,
      cssWidth: size.width, cssHeight: size.height },
    layout: { layoutSchemaVersion: 2, surface, pages: [{ id: 'main', widgets: [
      { id: 'lighting-tile', type: 'lighting', size: '4x2', col: 0, row: 0, config: { showRecents: false } },
    ] }] },
  };
  const devices: LightingDevice[] = ['a', 'b'].map((id, index) => ({
    id, name: `Fixture ${id.toUpperCase()}`, ledsOn: true, ledCount: 10, controlled: true,
    canvasX: index * 150, canvasY: 0, canvasW: 120, canvasH: 50,
  } as LightingDevice));
  return {
    record, devices, activeEffect: CUSTOM, paused: true, staticColor: '',
    pins: { a: { kind: 'animate', effect: CUSTOM }, b: { kind: 'static', color: '#334455' } } as Record<string, Pin>,
    templates: { ...Object.fromEntries(EFFECTS.map(({ key }) => [key, bundle()])),
      [CUSTOM]: bundle(2), [OTHER_CUSTOM]: bundle(1) } as Record<string, EffectTemplateBundle>,
    failStart: false, writes: [] as Mutation[], unexpectedWrites: [] as string[],
    pageErrors: [] as string[], broadcast: () => {},
  };
}
type Fixture = ReturnType<typeof fixture>;

function thumbnail() {
  const image = Buffer.alloc(54 + 8 * 8 * 3);
  image.write('BM'); image.writeUInt32LE(image.length, 2); image.writeUInt32LE(54, 10);
  image.writeUInt32LE(40, 14); image.writeInt32LE(8, 18); image.writeInt32LE(8, 22);
  image.writeUInt16LE(1, 26); image.writeUInt16LE(24, 28);
  for (let offset = 54; offset < image.length; offset += 3) {
    image[offset] = 170; image[offset + 1] = 130; image[offset + 2] = 30;
  }
  return image;
}

// A self-contained shader supplies real WebGL rendering and the same hint-range
// contract used by the production editor. No native renderer or hardware runs.
const SHADER = `#version 330 core
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_speed; // hint_range(-2, 2) = 1
uniform float u_saturation; // hint_range(0, 2) = 1
uniform float u_contrast; // hint_range(0, 2) = 1
uniform float u_intensity; // hint_range(0, 1) = 1
uniform float u_background_rotation; // hint_range(0, 360, 1) = 0
uniform float u_background_zoom; // hint_range(0.1, 3, 0.05) = 1
out vec4 fragColor;
void main() { vec2 uv = gl_FragCoord.xy / max(u_resolution, vec2(1.0));
  fragColor = vec4(0.1 + uv.x * 0.4, 0.4 + uv.y * 0.3, 0.7, 1.0); }
`;

/** Every document, asset, API call and WebSocket is fulfilled inside this fixture. */
async function isolate(page: Page, state: Fixture) {
  const root = resolve(process.env.D215_DIST ?? 'dist');
  const sockets = new Set<WebSocketRoute>();
  page.on('pageerror', error => state.pageErrors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('nexus_token', 'isolated-lighting-widget-test');
    localStorage.setItem('nexus_settings', JSON.stringify({ general: {
      language: 'en', themeMode: 'dark', widgetAdvancedMode: true,
    } }));
    if ('serviceWorker' in navigator) Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true, get: () => ({ getRegistrations: async () => [], register: async () => null }),
    });
  });
  await page.routeWebSocket(/.*/, socket => {
    sockets.add(socket);
    socket.onClose(() => sockets.delete(socket));
  });
  state.broadcast = () => {
    for (const socket of sockets) if (new URL(socket.url()).pathname === '/ws') {
      socket.send(JSON.stringify({ t: 'lighting', d: {} }));
    }
  };
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
    const method = request.method();
    const body = method === 'GET' ? {} : request.postDataJSON() ?? {};
    if (method !== 'GET' && (path.startsWith('/lighting/') || path === '/devices/lighting-devices/pins')) {
      state.writes.push({ path, body });
    }
    if (/^\/lighting\/effects\/[^/]+\/thumbnail\.bmp$/.test(path)) {
      return route.fulfill({ contentType: 'image/bmp', body: thumbnail() });
    }
    if (path.startsWith('/lighting/shaders/')) return json({ frag: SHADER });
    if (path === '/lighting/current') return json({ sync: state.activeEffect, paused: state.paused });
    if (path === '/lighting/animate/defaults') return json(Object.fromEntries(EFFECTS.map(({ key }) => [key, bundle()])));
    if (path === '/lighting/animate/settings') return json({ effect: state.activeEffect === 'static' ? CUSTOM : state.activeEffect,
      states: {}, templates: state.templates });
    if (path === '/lighting/static/settings') return json({ effect: 'gradientlinear', color: state.staticColor, states: {} });
    if (path === '/lighting/status') return json({ gpuAvailable: true, rgbRunning: true, scanning: false });
    if (path === '/lighting/custom-effects') return json([
      { id: 'widgetfixture', name: 'Saved laser fixture', recipe: '{"blocks":[]}', updatedAt: 1, audio: false },
      { id: 'preservefixture', name: 'Other saved fixture', recipe: '{"blocks":[]}', updatedAt: 2, audio: false },
    ]);
    if (path === '/lighting/pause') { state.paused = body.paused; return json({ paused: state.paused }); }
    if (path === '/lighting/animate/headless-start' || path === '/lighting/static/headless-start') {
      if (state.failStart) return json({ error: true, msg: 'Fixture refuses start' });
      state.activeEffect = path.includes('/static/') ? 'static' : body.effect;
      state.staticColor = body.color ?? '';
      return json({ error: false });
    }
    if (path === '/lighting/animate/templates') { state.templates = body.templates; return json({ error: false }); }
    if (path === '/lighting/screen/effect' || path === '/lighting/media/effect') return json(BASE_DEFAULTS);
    if (path === '/lighting/audio-trigger') return json({ enabled: false, intensity: 50, switchDelay: 1, shuffle: false, looks: [] });
    if (path === '/lighting/audio-output') return json({ direction: 'output', deviceId: '', deviceName: '' });
    if (path === '/lighting/music-reactive') return json({ enabled: false });
    if (path === '/devices/lighting-devices/pins') {
      if (method === 'POST') {
        const next = { ...state.pins };
        for (const id of body.ids as string[]) { if (body.pin) next[id] = body.pin as Pin; else delete next[id]; }
        state.pins = next;
      }
      return json({ pins: state.pins });
    }
    if (path === '/devices/lighting-devices/all') return json({ isInit: true, devices: state.devices });
    if (path === '/devices/lighting-devices/stacks') return json({ stacks: [] });
    if (path === '/devices/lighting-devices/layout-presets') return json({ presets: [], activeId: null });
    if (path === `/panel/devices/${state.record.id}`) {
      if (method === 'POST') state.record = { ...state.record, ...body };
      return json(state.record);
    }
    if (method !== 'GET' && path !== '/diagnostics/client-mem' && path !== '/preferences') state.unexpectedWrites.push(path);
    if (path === '/ping') return json({ service: 'nexus', version: 'isolated-lighting-widget', initialized: true, platform: 'windows' });
    if (path === '/pair') return json({ token: 'isolated-lighting-widget-test' });
    if (path === '/onboarding') return json({ completed: true });
    if (path === '/preferences') return json({ language: 'en', themeMode: 'dark', ui: { widgetAdvancedMode: true } });
    if (path === '/profiles') return json({ profiles: [{ id: 'default', name: 'Default' }], activeId: 'default' });
    if (path === '/defaults') return json({ panel: { layouts: {} } });
    if (path === '/apps-api/installed') return json({ apps: [] });
    if (path === '/panel/devices') return json({ devices: [state.record] });
    if (path === '/devices/all') return json([]);
    return route.fulfill({ status: 404, body: '' });
  });
}

async function openPanel(page: Page, state: Fixture) {
  await isolate(page, state);
  await page.goto(`/panel/${state.record.id}`);
  const tile = page.locator('[class*="lighting"][data-size="4x2"]').first();
  await expect(tile.locator('[data-swatch-open]')).toBeVisible();
  return tile;
}

async function openImmersive(page: Page, tile: Locator) {
  await tile.getByRole('button', { name: 'Open Lighting', exact: true }).click();
  await expect(page.locator('[data-immersive="true"]')).toBeVisible();
  return page.getByRole('tablist', { name: 'Lighting panel', exact: true });
}

function assertIsolated(state: Fixture) {
  expect(state.unexpectedWrites).toEqual([]);
  expect(state.pageErrors).toEqual([]);
}

for (const surface of ['y70', 'monitor', 'phone'] as const) {
  test(`compact animation pick releases pins and resumes paused output on ${surface}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport(surface));
    const state = fixture(surface);
    state.activeEffect = 'plasma';
    const initialDevices = structuredClone(state.devices);
    const tile = await openPanel(page, state);
    expect(state.writes).toEqual([]);
    await tile.locator('[data-effect-key="plasma"]').click();
    await expect.poll(() => Object.keys(state.pins)).toEqual([]);
    expect(state.paused).toBe(false);
    expect(state.activeEffect).toBe('plasma');
    expect(state.writes.map(write => write.path)).toEqual([
      '/lighting/pause', '/lighting/animate/headless-start', '/devices/lighting-devices/pins',
    ]);
    expect(state.writes[1].body).toMatchObject({ effect: 'plasma', speed: 30, intensity: 0.3, persist: true });
    expect(state.devices).toEqual(initialDevices);
    await expect(page.locator('[data-immersive="true"]')).toHaveCount(0);
    await tile.screenshot({ path: testInfo.outputPath(`compact-${surface}-applied.png`) });
    assertIsolated(state);
  });
}

test('compact phone colour pick releases pins after the static start succeeds', async ({ page }, testInfo) => {
  await page.setViewportSize(viewport('phone'));
  const state = fixture('phone'); state.activeEffect = 'static'; state.paused = false;
  const tile = await openPanel(page, state);
  const swatch = tile.locator('[data-swatch-hex]').nth(1);
  const colour = await swatch.getAttribute('data-swatch-hex');
  await swatch.click();
  await expect.poll(() => Object.keys(state.pins)).toEqual([]);
  expect(state.staticColor).toBe(colour);
  expect(state.writes.map(write => write.path)).toEqual(['/lighting/static/headless-start', '/devices/lighting-devices/pins']);
  await tile.screenshot({ path: testInfo.outputPath('compact-phone-colour.png') });
  assertIsolated(state);
});

test('refused compact pick preserves every device pin and displays its failure', async ({ page }, testInfo) => {
  await page.setViewportSize(viewport('y70'));
  const state = fixture('y70'); state.failStart = true; state.paused = false;
  const before = structuredClone(state.pins);
  const tile = await openPanel(page, state);
  await tile.locator('[data-effect-key="plasma"]').click();
  await expect(tile.getByRole('alert')).toHaveText("Couldn't apply lighting. Try again.");
  expect(state.pins).toEqual(before);
  expect(state.activeEffect).toBe(CUSTOM);
  expect(state.writes.map(write => write.path)).toEqual(['/lighting/animate/headless-start']);
  await tile.screenshot({ path: testInfo.outputPath('compact-refused.png') });
  assertIsolated(state);
});

test('custom active effect retains immersive styles, controls and unrelated saved presets', async ({ page }, testInfo) => {
  await page.setViewportSize(viewport('y70'));
  const state = fixture('y70'); state.paused = false; state.pins = {};
  const before = structuredClone(state.templates);
  const tile = await openPanel(page, state);
  const tabs = await openImmersive(page, tile);
  const immersive = page.getByRole('dialog');
  await expect(tabs).toBeVisible();
  await expect(immersive.locator('[data-effect-key="custom:widgetfixture"]')).toBeVisible();
  await expect(immersive.getByRole('button', { name: 'Saved laser fixture', exact: true })).toBeVisible();
  await expect(immersive.getByRole('button', { name: 'Other saved fixture', exact: true })).toBeVisible();
  await expect(immersive.locator('[data-effect-key="rainbow"]')).toBeVisible();
  expect(state.writes).toEqual([]);
  await immersive.getByRole('button', { name: 'Saved laser fixture', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('immersive-y70-custom-styles.png'), fullPage: true });
  await tabs.getByRole('tab', { name: 'Effect Editor', exact: true }).click();
  const presets = page.getByRole('radiogroup', { name: 'Presets', exact: true });
  await expect(presets.getByRole('radio', { name: 'Preset 3', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('slider', { name: 'Speed', exact: true })).toBeVisible();
  await presets.getByRole('radio', { name: 'Preset 2', exact: true }).click();
  await expect.poll(() => state.templates[CUSTOM].selected).toBe(1);
  await expect.poll(() => state.writes.some(write => write.path === '/lighting/animate/headless-start')).toBe(true);
  expect(state.templates[CUSTOM].slots).toEqual(before[CUSTOM].slots);
  expect(state.templates[OTHER_CUSTOM]).toEqual(before[OTHER_CUSTOM]);
  expect(state.templates.rainbow).toEqual(before.rainbow);
  expect(state.writes.find(write => write.path === '/lighting/animate/headless-start')?.body).toMatchObject({
    effect: CUSTOM, speed: 40, intensity: 0.5,
  });
  await page.screenshot({ path: testInfo.outputPath('immersive-y70-custom-controls.png'), fullPage: true });
  assertIsolated(state);
});

test('immersive monitor picks pin only the selected device and preserve the global source', async ({ page }, testInfo) => {
  await page.setViewportSize(viewport('monitor'));
  const state = fixture('monitor'); state.paused = false; state.activeEffect = 'rainbow'; state.pins = {};
  const tile = await openPanel(page, state);
  const tabs = await openImmersive(page, tile);
  await tabs.getByRole('tab', { name: 'Devices', exact: true }).click();
  await page.getByText('Fixture A', { exact: true }).click();
  await tabs.getByRole('tab', { name: 'Effect', exact: true }).click();
  await page.locator('[data-effect-key="custom:widgetfixture"]').click();
  await expect.poll(() => state.pins.a).toMatchObject({ kind: 'animate', effect: CUSTOM });
  expect(state.pins.b).toBeUndefined();
  expect(state.activeEffect).toBe('rainbow');
  expect(state.writes.filter(write => write.path === '/lighting/animate/headless-start')).toEqual([]);
  expect(state.writes.filter(write => write.path === '/devices/lighting-devices/pins')).toEqual([
    { path: '/devices/lighting-devices/pins', body: { ids: ['a'], pin: { kind: 'animate', effect: CUSTOM } } },
  ]);
  await page.screenshot({ path: testInfo.outputPath('immersive-monitor-selected-custom.png'), fullPage: true });
  assertIsolated(state);
});
