import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { ANIMATE_EFFECTS, BASE_DEFAULTS, type EffectTemplateBundle } from '../src/types/lighting';
import type { LightingDevice, Pin } from '../src/api/lighting';
import type { LightingAudioTriggerSettings } from '../src/api/lightingAudioTrigger';
import type { KeyReaction } from '../src/api/keyReactive';

const THUMB_COLOURS: Record<string, [number, number, number]> = {
  fire: [230, 30, 20], rainbow: [20, 220, 30], ball: [20, 30, 230], wave: [210, 200, 20],
  ridgeline: [180, 20, 210], chevron: [20, 190, 160], terrace: [220, 100, 20],
};

function thumbnail(key: string, slot: number) {
  const image = Buffer.alloc(54 + 8 * 8 * 3);
  image.write('BM'); image.writeUInt32LE(image.length, 2); image.writeUInt32LE(54, 10);
  image.writeUInt32LE(40, 14); image.writeInt32LE(8, 18); image.writeInt32LE(8, 22);
  image.writeUInt16LE(1, 26); image.writeUInt16LE(24, 28);
  const rgb = (THUMB_COLOURS[key] ?? [120, 100, 80]).map(channel => Math.round(channel * [1, 0.75, 0.4, 0.2][slot]));
  for (let offset = 54; offset < image.length; offset += 3) {
    image[offset] = rgb[2]; image[offset + 1] = rgb[1]; image[offset + 2] = rgb[0];
  }
  return image;
}

interface FixtureOptions {
  triggerEnabled?: boolean;
  selectedCount?: number;
  globalEffect?: string;
  replayPath?: string;
  stream?: boolean;
  customSources?: string;
  coreKeyboard?: boolean;
}

/** A stable blue-dot global canvas; device pins deliberately do not change this stream. */
function globalFrame() {
  const width = 64, height = 40;
  const frame = Buffer.alloc(6 + width * height * 3);
  frame[0] = 3; frame.writeUInt16LE(width, 1); frame.writeUInt16LE(height, 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x % 8 < 4 && y % 8 < 4) {
      const offset = 5 + (y * width + x) * 3;
      frame[offset] = 5; frame[offset + 1] = 35; frame[offset + 2] = 110;
    }
  }
  return frame;
}

/** Every request, including sockets and replayed installed responses, stays inside this fixture. */
async function mockService(page: Page, options: FixtureOptions = {}) {
  const root = resolve(process.env.K55_CORE_ASSET_ROOT ?? process.env.D215_DIST ?? 'dist');
  const shaderRoot = resolve('../nexus-service/src/Lighting/Engine/Gpu/Shaders');
  const captured: Record<string, unknown> = options.replayPath ? JSON.parse(readFileSync(options.replayPath, 'utf8')) : {};
  const custom = options.customSources ? JSON.parse(readFileSync(options.customSources, 'utf8')) as { composed: string } : null;
  const customKey = 'custom:spatialfixture';
  const defaults: Record<string, EffectTemplateBundle> = Object.fromEntries(ANIMATE_EFFECTS.map(({ key }) => [key, {
    selected: 0, slots: [1, 0.75, 0.4, 0.2].map(intensity => ({ ...BASE_DEFAULTS, intensity, params: {} })),
  }]));
  const customEffects = custom ? [{ id: 'spatialfixture', name: 'Custom spatial fixture', updatedAt: 1, audio: false,
    recipe: JSON.stringify({ v: 1, speed: 50, hue: 0, saturation: 1, contrast: 1, blocks: [
      { uid: 'pattern', type: 'plasma', params: {} }, { uid: 'colour', type: 'palette', params: {} },
    ] }) }] : [];
  const capturedAnimate = captured['/lighting/animate/settings'] as { effect: string; states: object; templates: typeof defaults } | undefined;
  const capturedPins = captured['/devices/lighting-devices/pins'] as { pins: Record<string, Pin> } | undefined;
  const capturedDevices = captured['/devices/lighting-devices/all'] as { devices: LightingDevice[] } | undefined;
  const trigger: LightingAudioTriggerSettings = structuredClone(captured['/lighting/audio-trigger'] as LightingAudioTriggerSettings
    ?? { enabled: options.triggerEnabled ?? false, intensity: 50, switchDelay: 1, shuffle: false,
      looks: options.triggerEnabled ? [{ mode: 'static', color: '#ff0000' }] : [] });
  const fixtureIds = options.coreKeyboard ? ['core']
    : options.selectedCount ? Array.from({ length: options.selectedCount }, (_, i) => `fixture-${i}`) : ['a', 'b'];
  const devices = capturedDevices?.devices ?? fixtureIds.map((id, index) => ({
    id, name: options.coreKeyboard ? 'K55 CORE RGB' : options.selectedCount ? `Fixture ${index + 1}` : `Fixture ${id.toUpperCase()}`, ledsOn: true, ledCount: 10,
    canvasX: (index % 5) * 180, canvasY: Math.floor(index / 5) * 240, canvasW: 160, canvasH: 200, canvasRotation: 0,
  }));
  const initialPins = structuredClone(capturedPins?.pins ?? {});
  const prefsSockets = new Set<WebSocketRoute>();
  const selectedIds = options.selectedCount
    ? devices.filter(device => !options.replayPath || initialPins[device.id]?.effect === 'terrace').map(device => device.id).slice(0, options.selectedCount)
    : [];
  const state = { pins: initialPins, writes: [] as string[], shaderReads: [] as string[], trigger,
    templates: { ...structuredClone(capturedAnimate?.templates ?? defaults), ...(custom ? { [customKey]: { selected: 0,
      slots: Array.from({ length: 4 }, () => ({ ...BASE_DEFAULTS, params: { u_saved_knob: 0.75 } })) } } : {}) },
    animateStates: capturedAnimate?.states ?? {},
    activeEffect: capturedAnimate?.effect ?? options.globalEffect ?? 'fire', delayedEffect: '', failShaders: false,
    selectedIds, streamFrames: 0, triggerReads: 0, pendingShaderReleases: new Set<() => void>(),
    releaseShader: null as (() => void) | null,
    keyReaction: { enabled: false, effect: 'ripple', colorMode: 'custom', color: '#ff2d55',
      speed: 1, size: 1, background: 'effect' } as KeyReaction,
    keyPreviews: [] as KeyReaction[], keyPresses: [] as { led?: number }[],
    keyEpoch: 'a'.repeat(32), keyReads: 0, keyLayoutRevision: 'c1:0123456789:000',
    keySlots: Array.from({ length: 10 }, (_, i) => i), keyPreviewRevisions: [] as (string | null)[],
    keyPressRevisions: [] as (string | null)[],
    keyWrites: [] as { epoch: string | null; layoutRevision: string | null; config: KeyReaction }[],
    prefsClients: 0,
    broadcastPrefs: () => { for (const socket of prefsSockets) socket.send(JSON.stringify({ t: 'prefs', d: {} })); },
    broadcastLighting: () => { for (const socket of prefsSockets) socket.send(JSON.stringify({ t: 'lighting', d: {} })); },
  };
  await page.addInitScript(({ selectedIds }) => {
    localStorage.setItem('nexus_token', 'test-token');
    localStorage.setItem('nexus_settings', JSON.stringify({ general: {
      language: 'en', themeMode: 'dark', lightingDashboardMode: 'advanced',
    } }));
    localStorage.setItem('nexus.lighting.effectDockCollapsed', 'false');
    localStorage.setItem('nexus.lighting.pinSelection', JSON.stringify(selectedIds));
    if (selectedIds[0]) localStorage.setItem('nexus.lighting.primaryDevice', JSON.stringify(selectedIds[0]));
    if ('serviceWorker' in navigator) Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true, get: () => ({ getRegistrations: async () => [], register: async () => null }),
    });
    // Observe the program that actually drew into each WebGL canvas. Grid
    // thumbnails and prop values cannot satisfy this assertion.
    const sources = new WeakMap<WebGLShader, string>();
    const programs = new WeakMap<WebGLProgram, string>();
    const current = new WeakMap<WebGL2RenderingContext, WebGLProgram | null>();
    const prototype = WebGL2RenderingContext.prototype;
    const shaderSource = prototype.shaderSource;
    prototype.shaderSource = function(shader, source) {
      const key = source.match(/preview-effect:([\w:-]+)/)?.[1];
      if (key) sources.set(shader, key);
      shaderSource.call(this, shader, source);
    };
    const attachShader = prototype.attachShader;
    prototype.attachShader = function(program, shader) {
      const key = sources.get(shader);
      if (key) programs.set(program, key);
      attachShader.call(this, program, shader);
    };
    const useProgram = prototype.useProgram;
    prototype.useProgram = function(program) {
      current.set(this, program);
      useProgram.call(this, program);
    };
    const drawArrays = prototype.drawArrays;
    prototype.drawArrays = function(mode, first, count) {
      drawArrays.call(this, mode, first, count);
      const program = current.get(this);
      const key = program && programs.get(program);
      if (key && this.canvas instanceof HTMLCanvasElement) {
        const pixel = new Uint8Array(4);
        this.readPixels(Math.floor(this.drawingBufferWidth / 2), Math.floor(this.drawingBufferHeight / 2),
          1, 1, this.RGBA, this.UNSIGNED_BYTE, pixel);
        this.canvas.dataset.drawEffect = key;
        this.canvas.dataset.drawPixel = [...pixel].join(',');
        this.canvas.dataset.drawCount = String(Number(this.canvas.dataset.drawCount ?? 0) + 1);
        for (const [uniform, attribute] of [['u_background_rotation', 'drawPatternRotation'], ['u_background_zoom', 'drawPatternZoom']]) {
          const location = this.getUniformLocation(program, uniform);
          if (location) this.canvas.dataset[attribute] = String(this.getUniform(program, location));
        }
      }
    };
  }, { selectedIds });
  await page.routeWebSocket(/.*/, socket => {
    if (new URL(socket.url()).pathname === '/ws') {
      prefsSockets.add(socket); state.prefsClients = prefsSockets.size;
      socket.onClose(() => { prefsSockets.delete(socket); state.prefsClients = prefsSockets.size; });
      return;
    }
    if (!options.stream || new URL(socket.url()).pathname !== '/lighting/output') return;
    const frame = options.coreKeyboard
      ? Buffer.concat([globalFrame().subarray(0, -1), Buffer.from([1, 0, 10, 0,
        ...Array.from({ length: 10 }, (_, i) => [220 - i * 10, 40 + i * 15, 40 + i * 10]).flat()])])
      : globalFrame();
    const send = () => { socket.send(frame); state.streamFrames++; };
    send();
    const timer = setInterval(send, 50);
    socket.onClose(() => clearInterval(timer));
  });
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
    if (request.method() !== 'GET') state.writes.push(path);
    const thumb = path.match(/^\/lighting\/effects\/([^/]+)\/thumbnail\.bmp$/);
    if (thumb) return route.fulfill({ contentType: 'image/bmp', body: thumbnail(decodeURIComponent(thumb[1]), Number(new URL(request.url()).searchParams.get('slot') ?? 0)) });
    if (path.startsWith('/lighting/shaders/')) {
      const key = decodeURIComponent(path.slice('/lighting/shaders/'.length));
      state.shaderReads.push(key);
      if (state.failShaders) return route.fulfill({ status: 404, body: '' });
      if (key === state.delayedEffect) await new Promise<void>(resolveShader => {
        state.pendingShaderReleases.add(resolveShader);
        state.releaseShader = () => {
          for (const release of state.pendingShaderReleases) release();
          state.pendingShaderReleases.clear();
        };
      });
      if (custom && key === customKey) return json({ frag: custom.composed + `\n// preview-effect:${key}` });
      const body = readFileSync(resolve(shaderRoot, `${key}.frag`), 'utf8');
      const gain = /float\s+outGain\s*\(/.test(body) ? '' : '\nfloat outGain() { return 1.0; }\n';
      return json({ frag: readFileSync(resolve(shaderRoot, '_prelude.frag'), 'utf8') + '\n' + body + gain + `\n// preview-effect:${key}` });
    }
    if (path === '/ping') return json({ service: 'nexus', version: 'lighting-effect-preview-test', initialized: true, platform: 'windows' });
    if (path === '/pair') return json({ token: 'test-token' });
    if (path === '/onboarding') return json({ completed: true });
    if (path === '/preferences') return json({ language: 'en', themeMode: 'dark', ui: { lightingDashboardMode: 'advanced' } });
    if (path === '/profiles') return json({ profiles: [{ id: 'default', name: 'Default' }], activeId: 'default' });
    if (path === '/defaults') return json({ panel: { layouts: {} } });
    if (path === '/panel/devices') return json({ devices: [] });
    if (path === '/apps-api/installed') return json({ apps: [] });
    if (path === '/devices/all') return json([]);
    if (path === '/lighting/current') return json({ sync: state.activeEffect, paused: false });
    if (path === '/lighting/animate/defaults') return json(captured[path] ?? defaults);
    if (path === '/lighting/animate/settings') return json({ effect: state.activeEffect, states: state.animateStates, templates: state.templates });
    if (path === '/lighting/custom-effects') return json(customEffects);
    if (path === '/lighting/animate/templates') {
      state.templates = request.postDataJSON().templates;
      return json({ error: false });
    }
    if (path === '/lighting/animate/headless-start') {
      state.activeEffect = request.postDataJSON().effect;
      return json({ error: false });
    }
    if (path === '/lighting/status') return json(captured[path] ?? { gpuAvailable: true, rgbRunning: true, scanning: false });
    if (path === '/lighting/screen/effect' || path === '/lighting/media/effect') return json(BASE_DEFAULTS);
    if (path === '/devices/lighting-devices/all') return json(captured[path] ?? { isInit: true, devices });
    if (path === '/devices/lighting-devices/pins') {
      if (request.method() === 'POST') {
        const { ids, pin } = request.postDataJSON() as { ids: string[]; pin: Pin | null };
        const next = { ...state.pins };
        for (const id of ids) { if (pin) next[id] = pin; else delete next[id]; }
        state.pins = next;
      }
      return json({ pins: state.pins });
    }
    if (path === '/devices/lighting-devices/stacks') return json({ stacks: [] });
    if (path === '/devices/lighting-devices/layout-presets') return json({ presets: [], activeId: null });
    if (path === '/lighting/music-reactive') return json(captured[path] ?? { enabled: false });
    if (path === '/lighting/audio-trigger') { state.triggerReads++; return json(state.trigger); }
    if (path === '/lighting/audio-output') return json({ direction: 'output', deviceId: '', deviceName: '' });
    if (options.coreKeyboard && path === '/lighting/key-reactive') { state.keyReads++; return json({ epoch: state.keyEpoch, inputAvailable: true, devices: [{
      id: 'core', deviceId: 'corsair-core', frameIndex: 0, ledCount: state.keySlots.length, namedKeys: 0, hardwareKeys: false,
      layoutRevision: state.keyLayoutRevision,
      zoneLighting: true, supportedEffects: ['fade', 'ripple'], keyboardLayouts: ['US', 'UK', 'BR', 'JP'], config: state.keyReaction,
    }] }); }
    if (options.coreKeyboard && path.startsWith('/lighting/key-reactive/core')) {
      const query = new URL(request.url()).searchParams;
      const expectedEpoch = query.get('expectedEpoch'), expectedRevision = query.get('expectedLayoutRevision');
      if (request.method() === 'PUT') state.keyWrites.push({ epoch: expectedEpoch, layoutRevision: expectedRevision, config: request.postDataJSON() });
      if (expectedEpoch !== null && expectedEpoch !== state.keyEpoch) return route.fulfill({ status: 409, body: '' });
      if (expectedRevision !== null && expectedRevision !== state.keyLayoutRevision) return route.fulfill({ status: 409, body: '' });
    }
    if (options.coreKeyboard && path === '/lighting/key-reactive/core' && request.method() === 'PUT') {
      state.keyReaction = request.postDataJSON();
      return json(state.keyReaction);
    }
    if (options.coreKeyboard && path === '/lighting/key-reactive/core/preview') {
      state.keyPreviews.push(request.postDataJSON());
      state.keyPreviewRevisions.push(new URL(request.url()).searchParams.get('expectedLayoutRevision'));
      return json({ x: state.keySlots.map(i => i * 2 + 1), y: Array(state.keySlots.length).fill(2.5),
        width: 20, height: 6, fps: 30, frameCount: 1, frames: Buffer.alloc(state.keySlots.length * 3).toString('base64'), zoneLighting: true });
    }
    if (options.coreKeyboard && path === '/lighting/key-reactive/core/press') {
      state.keyPresses.push(request.postDataJSON());
      state.keyPressRevisions.push(new URL(request.url()).searchParams.get('expectedLayoutRevision'));
      return json({ ok: true });
    }
    if (request.method() === 'GET' && captured[path] !== undefined && typeof captured[path] !== 'string') return json(captured[path]);
    return route.fulfill({ status: 404, body: '' });
  });
  return state;
}

const background = (page: Page) => page.locator('[class*="canvasArea"] canvas[class*="bgCanvas"]');
const backgroundPixel = (page: Page) => background(page).evaluate(canvas => {
  if (!(canvas instanceof HTMLCanvasElement)) return [];
  return [...canvas.getContext('2d')!.getImageData(2, 2, 1, 1).data];
});

test('K55 CORE Lighting card selects a physical layout, previews ten zones and preserves its saved reaction', async ({ page }, testInfo) => {
  const state = await mockService(page, { coreKeyboard: true, stream: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('[class*="sidebarColumn"]').getByRole('button', { name: 'Lighting', exact: true }).click();
  const card = page.locator('[class*="devicePane"]').getByText('K55 CORE RGB', { exact: true });
  const open = async () => {
    await card.click({ button: 'right' });
    await page.getByRole('button', { name: 'Type reactive', exact: true }).click();
  };
  await open();
  const enabled = page.getByRole('switch', { name: 'Type reactive', exact: true });
  await expect(enabled).toBeDisabled();
  expect(state.keyPreviews).toHaveLength(0);
  await page.getByRole('radio', { name: 'UK', exact: true }).click();
  await expect(enabled).toBeEnabled();
  const preview = page.getByRole('button', { name: 'Zone lighting preview. Press to trigger a random zone.', exact: true });
  await expect(preview).toHaveAttribute('data-zone-count', '10');
  await expect(preview).toHaveAttribute('data-live', 'true');
  await expect(page.getByText('10 shared lighting zones', { exact: true })).toBeVisible();
  const effects = page.getByRole('group', { name: 'Effect', exact: true });
  await expect(effects.getByRole('button')).toHaveCount(2);
  await expect(effects.getByRole('button', { name: 'Zone fade', exact: true })).toBeVisible();
  await expect.poll(() => preview.evaluate(canvas => {
    if (!(canvas instanceof HTMLCanvasElement)) return [];
    return [...canvas.getContext('2d')!.getImageData(Math.round(canvas.width / 20), Math.round(canvas.height * 2.5 / 6), 1, 1).data];
  })).toEqual([220, 56, 56, 255]);
  await enabled.click();
  await effects.getByRole('button', { name: 'Zone fade', exact: true }).click();
  await expect.poll(() => state.keyReaction).toMatchObject({ enabled: true, effect: 'fade', keyboardLayout: 'UK' });
  const box = await preview.boundingBox();
  if (!box) throw new Error('Missing shared-zone preview bounds');
  await preview.click({ position: { x: box.width * 19 / 20, y: box.height * 2.5 / 6 } });
  await expect.poll(() => state.keyPresses.some(press => press.led === 9)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('k55-core-ten-zone-editor.png') });
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await open();
  await expect(page.getByRole('radio', { name: 'UK', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(enabled).toBeChecked();
  await expect(effects.getByRole('button', { name: 'Zone fade', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(state.keyPreviews.every(config => config.keyboardLayout === 'UK')).toBe(true);
  expect(state.keyWrites.every(write => write.epoch === state.keyEpoch)).toBe(true);
  expect(state.keyWrites.every(write => write.layoutRevision === state.keyLayoutRevision)).toBe(true);
  expect(state.keyPreviewRevisions.every(revision => revision === state.keyLayoutRevision)).toBe(true);
  expect(state.keyPressRevisions.every(revision => revision === state.keyLayoutRevision)).toBe(true);
  expect(state.trigger.enabled).toBe(false);
  expect(state.pins).toEqual({});
  expect(errors).toEqual([]);
});

test('K55 CORE selects an ordered black and custom colour cycle and preserves it on reopen', async ({ page }, testInfo) => {
  const state = await mockService(page, { coreKeyboard: true, stream: true });
  state.keyReaction = { ...state.keyReaction, enabled: true, keyboardLayout: 'UK' };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('[class*="sidebarColumn"]').getByRole('button', { name: 'Lighting', exact: true }).click();
  const open = async () => {
    await page.locator('[class*="devicePane"]').getByText('K55 CORE RGB', { exact: true }).click({ button: 'right' });
    await page.getByRole('button', { name: 'Type reactive', exact: true }).click();
  };
  await open();
  const swatch = (hex: string) => page.getByRole('button', { name: hex, exact: true });
  await swatch('#000000').click();
  await swatch('#0a84ff').click();
  await swatch('#ff2d55').click();
  await expect(swatch('#000000')).toHaveAttribute('aria-pressed', 'true');
  await expect(swatch('#0a84ff')).toHaveAccessibleDescription('Colour 2 in the cycle');
  await page.getByRole('button', { name: 'Add custom colour', exact: true }).click();
  await page.getByRole('textbox', { name: 'Hex color', exact: true }).fill('#123456');
  await expect.poll(() => state.keyReaction.colors).toEqual(['#000000', '#0a84ff']);
  await page.getByRole('button', { name: 'Add colour', exact: true }).click();
  await expect.poll(() => state.keyReaction).toMatchObject({ color: '#000000', colors: ['#000000', '#0a84ff', '#123456'], speed: 1, size: 1 });
  await expect(swatch('#123456')).toHaveAccessibleDescription('Colour 3 in the cycle');
  await page.screenshot({ path: testInfo.outputPath('k55-core-custom-colour-cycle.png') });
  await page.keyboard.press('Escape');
  await open();
  await expect(swatch('#000000')).toHaveAttribute('aria-pressed', 'true');
  await expect(swatch('#0a84ff')).toHaveAttribute('aria-pressed', 'true');
  await expect(swatch('#123456')).toHaveAttribute('aria-pressed', 'true');
  expect(state.keyWrites.every(write => write.epoch === state.keyEpoch && write.layoutRevision === state.keyLayoutRevision)).toBe(true);
  expect(state.pins).toEqual({});
  expect(state.trigger.enabled).toBe(false);
  expect(errors).toEqual([]);
});

test('K55 CORE retires an old modal draft before a same-card profile reload', async ({ page }) => {
  const state = await mockService(page, { coreKeyboard: true, stream: true });
  state.keyReaction = { ...state.keyReaction, keyboardLayout: 'US' };
  await page.goto('/');
  await page.locator('[class*="sidebarColumn"]').getByRole('button', { name: 'Lighting', exact: true }).click();
  await expect.poll(() => state.prefsClients).toBeGreaterThan(0);
  const card = page.locator('[class*="devicePane"]').getByText('K55 CORE RGB', { exact: true });
  const open = async () => {
    await card.click({ button: 'right' });
    await page.getByRole('button', { name: 'Type reactive', exact: true }).click();
  };
  await open();
  await page.getByRole('radio', { name: 'UK', exact: true }).click();
  const previousReads = state.keyReads;
  state.keyEpoch = 'b'.repeat(32);
  state.keyReaction = { ...state.keyReaction, keyboardLayout: 'JP', color: '#0000ff' };
  state.broadcastPrefs();
  await expect(page.getByRole('radio', { name: 'UK', exact: true })).toHaveCount(0);
  await expect.poll(() => state.keyReads).toBeGreaterThan(previousReads);
  // Cross the old owner's explicit 250ms debounce deadline: it must not send.
  await page.waitForTimeout(350);
  expect(state.keyWrites).toHaveLength(0);
  expect(state.keyReaction).toMatchObject({ keyboardLayout: 'JP', color: '#0000ff' });
  await open();
  await expect(page.getByRole('radio', { name: 'JP', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: 'UK', exact: true }).click();
  await expect.poll(() => state.keyWrites.length).toBe(1);
  expect(state.keyWrites[0]).toMatchObject({ epoch: state.keyEpoch, config: { keyboardLayout: 'UK', color: '#0000ff' } });
});

test('K55 CORE retires old geometry and drafts when the same card is sliced or reordered', async ({ page }) => {
  const state = await mockService(page, { coreKeyboard: true, stream: true });
  state.keyReaction = { ...state.keyReaction, keyboardLayout: 'UK' };
  await page.goto('/');
  await page.locator('[class*="sidebarColumn"]').getByRole('button', { name: 'Lighting', exact: true }).click();
  await expect.poll(() => state.prefsClients).toBeGreaterThan(0);
  await page.locator('[class*="devicePane"]').getByText('K55 CORE RGB', { exact: true }).click({ button: 'right' });
  await page.getByRole('button', { name: 'Type reactive', exact: true }).click();
  const preview = page.getByRole('button', { name: 'Zone lighting preview. Press to trigger a random zone.', exact: true });
  await expect(preview).toHaveAttribute('data-zone-count', '10');
  for (const [slots, revision] of [[[8, 9], 'c1:89:000'], [[9, 8], 'c1:98:080']] as const) {
    await page.getByRole('radio', { name: 'JP', exact: true }).click();
    state.keySlots = [...slots]; state.keyLayoutRevision = revision;
    state.broadcastLighting();
    await expect.poll(() => state.keyPreviewRevisions.at(-1)).toBe(revision);
    await expect(preview).toHaveAttribute('data-zone-count', '2');
    await expect(page.getByText('2 shared lighting zones', { exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'UK', exact: true })).toHaveAttribute('aria-checked', 'true');
    await page.waitForTimeout(350);
    expect(state.keyWrites).toHaveLength(0);
  }
  await page.getByRole('switch', { name: 'Type reactive', exact: true }).click();
  await expect.poll(() => state.keyWrites.length).toBe(1);
  expect(state.keyWrites[0]).toMatchObject({ epoch: state.keyEpoch, layoutRevision: 'c1:98:080', config: { keyboardLayout: 'UK' } });
  await preview.focus(); await page.keyboard.press('Enter');
  await expect.poll(() => state.keyPressRevisions.at(-1)).toBe('c1:98:080');
});

for (const replay of [false, true]) {
  test(`enabled Audio Trigger keeps ten selected-device previews current (${replay ? 'installed response replay' : 'synthetic idle stream'})`, async ({ page }, testInfo) => {
    test.skip(replay && !process.env.D215_PREVIEW_CAPTURE, 'Set D215_PREVIEW_CAPTURE to the private captured responses.json for installed-state replay.');
    const state = await mockService(page, { triggerEnabled: true, selectedCount: 10, globalEffect: 'dotmatrix', stream: true,
      replayPath: replay ? process.env.D215_PREVIEW_CAPTURE : undefined });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    expect(state.selectedIds).toHaveLength(10);
    expect(state.trigger.enabled).toBe(true);
    expect(state.trigger.looks.length).toBeGreaterThan(0);
    const initialTrigger = structuredClone(state.trigger);
    await page.goto('/');
    await page.locator('[class*="sidebarColumn"]').getByRole('button', { name: 'Lighting', exact: true }).click();
    await expect.poll(() => state.triggerReads).toBeGreaterThan(0);
    await expect.poll(() => backgroundPixel(page)).toEqual([5, 35, 110, 255]);
    // Profile hydration replays its global effect once; finish that startup before measuring picks.
    await expect.poll(() => state.writes.filter(path => path === '/lighting/animate/headless-start').length).toBe(1);
    const initialStarts = state.writes.filter(path => path === '/lighting/animate/headless-start').length;
    for (const key of ['ridgeline', 'chevron', 'terrace']) {
      await pick(page, key);
      await expect.poll(() => state.selectedIds.every(id => state.pins[id]?.effect === key)).toBe(true);
      await expect(preview(page)).toHaveAttribute('data-draw-effect', key);
      await expect(preview(page)).toHaveCSS('opacity', '1');
      await expect(preview(page)).toHaveAttribute('data-draw-pixel', /,255$/);
      await expect.poll(() => backgroundPixel(page)).toEqual([5, 35, 110, 255]);
      if (replay) await page.screenshot({ path: testInfo.outputPath(`selected-trigger-captured-${key}.png`) });
    }
    const slot = state.templates.terrace?.selected === 2 ? 1 : 2;
    await page.getByRole('radio', { name: `Preset ${slot + 1}`, exact: true }).click();
    await expect.poll(() => state.templates.terrace?.selected).toBe(slot);
    await expect(preview(page)).toHaveAttribute('data-draw-effect', 'terrace');
    await expect(preview(page)).toHaveCSS('opacity', '1');
    await page.screenshot({ path: testInfo.outputPath(`selected-trigger-${replay ? 'captured' : 'synthetic'}.png`) });
    await page.getByRole('button', { name: 'Select none', exact: true }).click();
    await expect(preview(page)).toHaveCSS('opacity', '0');
    await expect(page.locator('[class*="canvasArea"] [data-effect-preview]')).toHaveCount(0);
    await expect.poll(() => backgroundPixel(page)).toEqual([5, 35, 110, 255]);
    expect(state.activeEffect).toBe('dotmatrix');
    expect(state.trigger).toEqual(initialTrigger);
    expect(state.writes.filter(path => path === '/lighting/animate/headless-start')).toHaveLength(initialStarts);
    expect(state.writes).not.toContain('/lighting/audio-trigger');
    expect(errors).toEqual([]);
  });
}

test('enabled Audio Trigger rejects a selected shader that arrives after deselection', async ({ page }) => {
  const state = await mockService(page, { triggerEnabled: true, selectedCount: 10, globalEffect: 'dotmatrix', stream: true });
  state.delayedEffect = 'ridgeline';
  await page.goto('/');
  await page.locator('[class*="sidebarColumn"]').getByRole('button', { name: 'Lighting', exact: true }).click();
  await expect.poll(() => state.triggerReads).toBeGreaterThan(0);
  await expect.poll(() => backgroundPixel(page)).toEqual([5, 35, 110, 255]);
  await pick(page, 'ridgeline');
  await expect.poll(() => state.pendingShaderReleases.size).toBeGreaterThan(0);
  await expect.poll(() => state.selectedIds.every(id => state.pins[id]?.effect === 'ridgeline')).toBe(true);
  await page.getByRole('button', { name: 'Select none', exact: true }).click();
  await expect(preview(page)).toHaveCSS('opacity', '0');
  const replies: Promise<unknown>[] = [];
  let responses = 0;
  const held = state.pendingShaderReleases.size;
  page.on('response', response => {
    if (new URL(response.url()).pathname === '/lighting/shaders/ridgeline') {
      replies.push(response.finished()); responses++;
    }
  });
  state.releaseShader?.();
  await expect.poll(() => responses).toBe(held);
  await Promise.all(replies);
  await page.evaluate(() => new Promise<void>(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))));
  await expect(preview(page)).toHaveCSS('opacity', '0');
  await expect(preview(page)).not.toHaveAttribute('data-draw-effect', 'ridgeline');
  expect(await backgroundPixel(page)).toEqual([5, 35, 110, 255]);
  expect(state.activeEffect).toBe('dotmatrix');
  expect(state.writes).not.toContain('/lighting/audio-trigger');
});

test('enabled Audio Trigger keeps the latest selected effect when an older shader arrives late', async ({ page }) => {
  const state = await mockService(page, { triggerEnabled: true, selectedCount: 10, globalEffect: 'dotmatrix', stream: true });
  state.delayedEffect = 'ridgeline';
  await page.goto('/');
  await page.locator('[class*="sidebarColumn"]').getByRole('button', { name: 'Lighting', exact: true }).click();
  await expect.poll(() => state.triggerReads).toBeGreaterThan(0);
  await pick(page, 'ridgeline');
  await expect.poll(() => state.pendingShaderReleases.size).toBeGreaterThan(0);
  await pick(page, 'chevron');
  await expect(preview(page)).toHaveAttribute('data-draw-effect', 'chevron');
  await expect(preview(page)).toHaveCSS('opacity', '1');
  state.releaseShader?.();
  await pick(page, 'terrace');
  await expect(preview(page)).toHaveAttribute('data-draw-effect', 'terrace');
  await expect(preview(page)).toHaveCSS('opacity', '1');
  expect(state.selectedIds.every(id => state.pins[id]?.effect === 'terrace')).toBe(true);
  expect(state.activeEffect).toBe('dotmatrix');
  expect(await backgroundPixel(page)).toEqual([5, 35, 110, 255]);
  expect(state.writes).not.toContain('/lighting/audio-trigger');
});

test('enabled Audio Trigger retains a focused preset fallback when WebGL is unavailable', async ({ page }, testInfo) => {
  const state = await mockService(page, { triggerEnabled: true, selectedCount: 10, globalEffect: 'dotmatrix', stream: true });
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      return type === 'webgl2' ? null : getContext.call(this, type, ...args);
    } as typeof getContext;
  });
  await page.goto('/');
  await page.locator('[class*="sidebarColumn"]').getByRole('button', { name: 'Lighting', exact: true }).click();
  await expect.poll(() => state.triggerReads).toBeGreaterThan(0);
  const fallback = page.locator('[class*="canvasArea"] [data-effect-preview]');
  for (const key of ['ridgeline', 'chevron', 'terrace']) {
    await pick(page, key);
    await expect(fallback).toHaveAttribute('data-effect-preview', key);
    await expect(fallback).toBeVisible();
    await expect.poll(() => fallback.locator('img').evaluate(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)).toBe(true);
  }
  expect(state.activeEffect).toBe('dotmatrix');
  expect(await backgroundPixel(page)).toEqual([5, 35, 110, 255]);
  await page.screenshot({ path: testInfo.outputPath('selected-trigger-no-webgl.png') });
  await page.getByRole('button', { name: 'Select none', exact: true }).click();
  await expect(fallback).toHaveCount(0);
  expect(state.writes).not.toContain('/lighting/audio-trigger');
});

const preview = (page: Page) => page.locator('[class*="canvasArea"] canvas[class*="glCanvas"]');
const pick = (page: Page, key: string) => page.locator(`[data-effect-key="${key}"]`).click();

test('custom animation pattern rotation and zoom save, reopen and reset through the production editor', async ({ page }, testInfo) => {
  const customSources = resolve(process.env.D215_CUSTOM_SOURCES ?? '../builds/custom-animation-spatial-20261108/runtime-sources.json');
  test.skip(!existsSync(customSources), 'Set D215_CUSTOM_SOURCES to an isolated native runtime-source export.');
  const state = await mockService(page, { customSources });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const key = 'custom:spatialfixture';
  const openLighting = () => page.locator('[class*="sidebarColumn"]').getByRole('button', { name: 'Lighting', exact: true }).click();
  const rotation = page.getByRole('slider', { name: 'Pattern rotation', exact: true });
  const zoom = page.getByRole('slider', { name: 'Pattern zoom', exact: true });
  await page.goto('/');
  await openLighting();
  await pick(page, key);
  await expect(preview(page)).toHaveAttribute('data-draw-effect', key);
  await expect(rotation).toHaveValue('0');
  await expect(rotation).toHaveAttribute('max', '360');
  await expect(zoom).toHaveValue('100');
  await expect(zoom).toHaveAttribute('min', '10');
  await expect(zoom).toHaveAttribute('max', '300');
  await expect(zoom).toHaveAttribute('step', '5');
  const edit = async (label: string, value: number) => {
    const row = page.locator('[class*="stacked"]').filter({ has: page.getByRole('slider', { name: label, exact: true }) });
    await row.getByRole('button').click();
    await row.getByRole('spinbutton').fill(String(value));
    await row.getByRole('spinbutton').press('Enter');
  };
  await edit('Pattern rotation', 90);
  await expect.poll(() => state.templates[key].slots[0].params.u_background_rotation).toBe(90);
  await edit('Pattern zoom', 200);
  await expect.poll(() => state.templates[key].slots[0].params).toEqual({
    u_saved_knob: 0.75, u_background_rotation: 90, u_background_zoom: 2,
  });
  await expect(preview(page)).toHaveAttribute('data-draw-pattern-rotation', '90');
  await expect(preview(page)).toHaveAttribute('data-draw-pattern-zoom', '2');
  await zoom.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('custom-animation-spatial-controls.png') });
  // A new document hydrates from the fixture's saved response, not React memory.
  await page.reload();
  await openLighting();
  await expect(rotation).toHaveValue('90');
  await expect(zoom).toHaveValue('200');
  await expect(preview(page)).toHaveAttribute('data-draw-pattern-rotation', '90');
  await expect(preview(page)).toHaveAttribute('data-draw-pattern-zoom', '2');
  await page.getByRole('button', { name: 'Reset preset 1', exact: true }).click();
  await expect.poll(() => state.templates[key].slots[0].params).toEqual({});
  await expect(rotation).toHaveValue('0');
  await expect(zoom).toHaveValue('100');
  await expect(preview(page)).toHaveAttribute('data-draw-pattern-rotation', '0');
  await expect(preview(page)).toHaveAttribute('data-draw-pattern-zoom', '1');
  expect(state.templates[key].slots[1].params).toEqual({ u_saved_knob: 0.75 });
  await testInfo.attach('custom-editor-writes.json', { body: JSON.stringify(state.writes), contentType: 'application/json' });
  // Page boot/navigation also reports diagnostics, remembers the route and
  // saves UI preferences. Keep those exact observed requests separate from edits.
  const allowedWrites = new Set(['/lighting/animate/headless-start', '/lighting/animate/templates',
    '/diagnostics/client-mem', '/telemetry/page-viewed/dashboard', '/telemetry/page-viewed/lighting',
    '/session/last-route', '/preferences']);
  expect(state.writes.filter(path => !allowedWrites.has(path))).toEqual([]);
  expect(errors).toEqual([]);
});

for (const selection of ['none', 'one', 'multiple']) {
  test(`large preview draws every selected effect with ${selection} devices selected`, async ({ page }, testInfo) => {
    const state = await mockService(page);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await page.locator('[class*="sidebarColumn"]').getByRole('button', { name: 'Lighting', exact: true }).click();
    await expect(preview(page)).toHaveAttribute('data-draw-effect', 'fire');
    const rail = page.locator('[class*="devicePane"]');
    if (selection !== 'none') await rail.getByText('Fixture A', { exact: true }).click();
    if (selection === 'multiple') await rail.getByText('Fixture B', { exact: true }).click({ modifiers: ['Control'] });
    const initialStarts = state.writes.filter(path => path === '/lighting/animate/headless-start').length;
    for (const key of ['rainbow', 'ball', 'wave', 'fire', 'ball']) {
      await pick(page, key);
      await expect(preview(page)).toHaveAttribute('data-draw-effect', key);
      await expect(preview(page)).toHaveAttribute('data-draw-pixel', /,255$/);
      if (selection !== 'none') {
        await expect.poll(() => state.pins.a?.effect).toBe(key);
        if (selection === 'multiple') expect(state.pins.b?.effect).toBe(key);
      }
    }
    await page.getByRole('radio', { name: 'Preset 3', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Preset 3', exact: true })).toBeChecked();
    await expect(preview(page)).toHaveAttribute('data-draw-effect', 'ball');
    await expect.poll(() => state.templates.ball?.selected).toBe(2);
    if (selection !== 'none') expect(state.writes.filter(path => path === '/lighting/animate/headless-start')).toHaveLength(initialStarts);
    await page.screenshot({ path: testInfo.outputPath(`large-preview-${selection}.png`) });
    expect(errors).toEqual([]);
  });
}

test('rapid selected-device picks keep the latest effect when an older shader arrives late', async ({ page }) => {
  const state = await mockService(page);
  state.delayedEffect = 'rainbow';
  await page.goto('/');
  await page.locator('[class*="sidebarColumn"]').getByRole('button', { name: 'Lighting', exact: true }).click();
  await expect(preview(page)).toHaveAttribute('data-draw-effect', 'fire');
  await page.locator('[class*="devicePane"]').getByText('Fixture A', { exact: true }).click();
  await pick(page, 'rainbow');
  await expect.poll(() => !!state.releaseShader).toBe(true);
  await pick(page, 'ball');
  await expect(preview(page)).toHaveAttribute('data-draw-effect', 'ball');
  state.releaseShader?.();
  await expect.poll(() => state.pins.a?.effect).toBe('ball');
  await expect(preview(page)).toHaveAttribute('data-draw-effect', 'ball');
  await pick(page, 'wave');
  await expect(preview(page)).toHaveAttribute('data-draw-effect', 'wave');
});

for (const failure of ['no-webgl', 'shader-unavailable']) {
  test(`selected effects retain the correct large preview when ${failure}`, async ({ page }, testInfo) => {
    const state = await mockService(page);
    state.failShaders = failure === 'shader-unavailable';
    if (failure === 'no-webgl') await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, type: string, ...args: unknown[]) {
        return type === 'webgl2' ? null : getContext.call(this, type, ...args);
      } as typeof getContext;
    });
    await page.goto('/');
    await page.locator('[class*="sidebarColumn"]').getByRole('button', { name: 'Lighting', exact: true }).click();
    const rail = page.locator('[class*="devicePane"]');
    await rail.getByText('Fixture A', { exact: true }).click();
    const fallback = page.locator('[class*="canvasArea"] [data-effect-preview]');
    await expect(fallback).toHaveCount(0);
    const assertThumbnail = async (key: string, slot = 0) => {
      await expect(fallback).toHaveAttribute('data-effect-preview', key);
      await expect(fallback).toBeVisible();
      await expect.poll(() => fallback.locator('img').evaluate(image => {
        if (!(image instanceof HTMLImageElement) || !image.complete || !image.naturalWidth) return null;
        const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
        const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
      })).toEqual(THUMB_COLOURS[key].map(channel => Math.round(channel * [1, 0.75, 0.4, 0.2][slot])));
    };
    for (const key of ['rainbow', 'ball']) {
      await pick(page, key);
      await expect.poll(() => state.pins.a?.effect).toBe(key);
      await assertThumbnail(key);
    }
    await page.getByRole('radio', { name: 'Preset 3', exact: true }).click();
    await assertThumbnail('ball', 2);
    await rail.getByText('Fixture B', { exact: true }).click({ modifiers: ['Control'] });
    await pick(page, 'wave');
    await expect.poll(() => state.pins.b?.effect).toBe('wave');
    await assertThumbnail('wave');
    await page.screenshot({ path: testInfo.outputPath(`large-preview-${failure}.png`) });
    await rail.getByText('Fixture A', { exact: true }).click({ modifiers: ['Control'] });
    await rail.getByText('Fixture B', { exact: true }).click({ modifiers: ['Control'] });
    await pick(page, 'rainbow');
    await expect.poll(() => state.activeEffect).toBe('rainbow');
    await expect(fallback).toHaveCount(0);
  });
}
