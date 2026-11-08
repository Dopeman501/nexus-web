import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { ANIMATE_EFFECTS, BASE_DEFAULTS } from '../src/types/lighting';
import type { LightingDevice, Pin } from '../src/api/lighting';
import type { LightingAudioTriggerSettings } from '../src/api/lightingAudioTrigger';

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
  const root = resolve(process.env.D215_DIST ?? 'dist');
  const shaderRoot = resolve('../nexus-service/src/Lighting/Engine/Gpu/Shaders');
  const captured: Record<string, unknown> = options.replayPath ? JSON.parse(readFileSync(options.replayPath, 'utf8')) : {};
  const defaults = Object.fromEntries(ANIMATE_EFFECTS.map(({ key }) => [key, {
    selected: 0, slots: [1, 0.75, 0.4, 0.2].map(intensity => ({ ...BASE_DEFAULTS, intensity, params: {} })),
  }]));
  const capturedAnimate = captured['/lighting/animate/settings'] as { effect: string; states: object; templates: typeof defaults } | undefined;
  const capturedPins = captured['/devices/lighting-devices/pins'] as { pins: Record<string, Pin> } | undefined;
  const capturedDevices = captured['/devices/lighting-devices/all'] as { devices: LightingDevice[] } | undefined;
  const trigger: LightingAudioTriggerSettings = structuredClone(captured['/lighting/audio-trigger'] as LightingAudioTriggerSettings
    ?? { enabled: options.triggerEnabled ?? false, intensity: 50, switchDelay: 1, shuffle: false,
      looks: options.triggerEnabled ? [{ mode: 'static', color: '#ff0000' }] : [] });
  const fixtureIds = options.selectedCount ? Array.from({ length: options.selectedCount }, (_, i) => `fixture-${i}`) : ['a', 'b'];
  const devices = capturedDevices?.devices ?? fixtureIds.map((id, index) => ({
    id, name: options.selectedCount ? `Fixture ${index + 1}` : `Fixture ${id.toUpperCase()}`, ledsOn: true, ledCount: 10,
    canvasX: (index % 5) * 180, canvasY: Math.floor(index / 5) * 240, canvasW: 160, canvasH: 200, canvasRotation: 0,
  }));
  const initialPins = structuredClone(capturedPins?.pins ?? {});
  const selectedIds = options.selectedCount
    ? devices.filter(device => !options.replayPath || initialPins[device.id]?.effect === 'terrace').map(device => device.id).slice(0, options.selectedCount)
    : [];
  const state = { pins: initialPins, writes: [] as string[], shaderReads: [] as string[], trigger,
    templates: structuredClone(capturedAnimate?.templates ?? defaults), animateStates: capturedAnimate?.states ?? {},
    activeEffect: capturedAnimate?.effect ?? options.globalEffect ?? 'fire', delayedEffect: '', failShaders: false,
    selectedIds, streamFrames: 0, triggerReads: 0, pendingShaderReleases: new Set<() => void>(),
    releaseShader: null as (() => void) | null };
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
      const key = source.match(/preview-effect:([\w-]+)/)?.[1];
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
      }
    };
  }, { selectedIds });
  await page.routeWebSocket(/.*/, socket => {
    if (!options.stream || new URL(socket.url()).pathname !== '/lighting/output') return;
    const frame = globalFrame();
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
