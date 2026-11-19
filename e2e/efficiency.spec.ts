import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { audioBeatFixture, audioBeatSeed } from './audioBeatTransitionsFixture';
import { fixtureId } from './backgroundTransitionsFixture';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { videoItem, videoMedia } from './backgroundVideoFixtures';

type Role = 'normal' | 'audio' | 'circle';
interface Work { draws: number; copies: number; programs: number; speed?: number }
declare global { interface Window { efficiencyWork: Record<Role, Work>; efficiencyPosts: Record<string, unknown>[] } }

async function observe(page: Page) {
  await page.addInitScript(() => {
    window.efficiencyWork = Object.fromEntries(['normal', 'audio', 'circle'].map(role => [role, { draws: 0, copies: 0, programs: 0 }])) as Record<Role, Work>;
    const roleOf = (canvas: HTMLCanvasElement): Role => canvas.closest('[data-d215-panel-background]') ? 'circle'
      : canvas.closest('[data-audio-trigger-background]') ? 'audio' : 'normal';
    const shader = (canvas: unknown): canvas is HTMLCanvasElement => canvas instanceof HTMLCanvasElement && !!canvas.closest('[data-panel-bg-layer][data-ready]');
    const draw = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function (...args) {
      if (shader(this.canvas)) window.efficiencyWork[roleOf(this.canvas)].draws++;
      return Reflect.apply(draw, this, args);
    };
    const compile = WebGL2RenderingContext.prototype.createProgram;
    WebGL2RenderingContext.prototype.createProgram = function () {
      if (shader(this.canvas)) window.efficiencyWork[roleOf(this.canvas)].programs++;
      return Reflect.apply(compile, this, []);
    };
    const uniformNames = new WeakMap<WebGLUniformLocation, string>();
    const getUniform = WebGL2RenderingContext.prototype.getUniformLocation;
    WebGL2RenderingContext.prototype.getUniformLocation = function (program, name) {
      const location = Reflect.apply(getUniform, this, [program, name]);
      if (location) uniformNames.set(location, name);
      return location;
    };
    const setFloat = WebGL2RenderingContext.prototype.uniform1f;
    WebGL2RenderingContext.prototype.uniform1f = function (location, value) {
      if (shader(this.canvas) && location && uniformNames.get(location) === 'u_speed') window.efficiencyWork[roleOf(this.canvas)].speed = value;
      return Reflect.apply(setFloat, this, [location, value]);
    };
    const copy = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (source: CanvasImageSource, ...args: number[]) {
      if (shader(source)) window.efficiencyWork[roleOf(source)].copies++;
      return Reflect.apply(copy, this, [source, ...args]);
    };
  });
}

async function sample(page: Page, role: Role, ms = 650) {
  const first = await page.evaluate(role => ({ ...window.efficiencyWork[role], at: performance.now() }), role);
  await page.waitForTimeout(ms);
  const last = await page.evaluate(role => ({ ...window.efficiencyWork[role], at: performance.now() }), role);
  return { draws: last.draws - first.draws, copies: last.copies - first.copies,
    programs: last.programs - first.programs, elapsedMs: last.at - first.at };
}

async function sleep(page: Page, isolatedCircle = false) {
  if (isolatedCircle) {
    await page.getByRole('button', { name: 'Screen sleep', exact: true }).tap();
    await expect(page.locator('.panel-root')).toHaveAttribute('data-screen-sleep', 'true');
    return;
  }
  const x = page.viewportSize()!.width / 2;
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: 3 }] });
    for (let y = 20; y <= 350; y += 30) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await cdp.detach(); }
  await page.getByRole('button', { name: 'Screen sleep', exact: true }).tap();
  await expect(page.locator('.panel-root')).toHaveAttribute('data-screen-sleep', 'true');
}

const shaderCanvas = (page: Page, role: Role = 'normal') => page.locator(role === 'circle'
  ? '[data-d215-panel-background] [data-panel-bg-layer][data-ready="true"] canvas'
  : role === 'audio' ? '[data-audio-trigger-background] [data-panel-bg-layer][data-ready="true"] canvas'
    : '[data-panel-bg-layer][data-ready="true"] canvas').first();

function record() {
  const initial = audioBeatSeed({ mainDuration: 400 });
  return { ...initial, backgroundMode: 'shader' as const, backgroundEffect: 'plasma', backgroundTemplate: 0,
    backgroundAudioTrigger: { ...initial.backgroundAudioTrigger!, enabled: false },
    capabilities: { surface: 'y70' as const, touch: true, cssWidth: 550, cssHeight: 1920, dpr: 1 },
    layout: { layoutSchemaVersion: 2 as const, surface: 'y70' as const, pages: [{ id: 'main', widgets: [] }] } };
}

async function saveEvidence(info: TestInfo, value: unknown) {
  await info.attach('efficiency-work', { body: JSON.stringify(value, null, 2), contentType: 'application/json' });
}

for (const remote of [false, true]) for (const effects of [false, true]) {
  test(`ineligible ${remote ? 'remote Y70' : 'Q60'} effects=${effects}: shader keeps drawing with zero mirrors`, async ({ page }, info) => {
    if (!remote) await page.setViewportSize({ width: 480, height: 1280 });
    await observe(page);
    const initial = record();
    initial.backgroundTransitions.enabled = effects;
    initial.backgroundAudioTriggerBeatTransition.enabled = effects;
    if (!remote) {
      Object.assign(initial.capabilities, { surface: 'q60', cssWidth: 480, cssHeight: 1280 });
      Object.assign(initial.layout, { surface: 'q60' });
    }
    const fixture = await audioBeatFixture(page, initial);
    await page.goto(`http://${remote ? 'my.localhost' : 'localhost'}:9400/panel/${fixtureId}?streamFps=30`);
    await expect(shaderCanvas(page)).toHaveCount(1);
    const work = await sample(page, 'normal');
    await saveEvidence(info, { index: fixture.buildHash, shaderHashes: fixture.shaderHashes, work });
    expect(work.draws).toBeGreaterThan(5);
    expect(work.copies).toBe(0);
    await fixture.check();
  });
}

test('local initial/New previews keep entry and return effects while the saved trigger is disabled', async ({ page }, info) => {
  await observe(page);
  const fixture = await audioBeatFixture(page, record());
  await page.goto(`/panel/${fixtureId}?streamFps=30`);
  await expect(shaderCanvas(page)).toHaveCount(1);
  await expect.poll(() => [...fixture.sockets].some(socket => socket.topics.has('panel/audio-trigger-preview'))).toBe(true);
  const normal = await sample(page, 'normal', 300);
  expect(normal.copies).toBeGreaterThan(0);
  fixture.preview({ mode: 'shader', effect: 'scope', template: 0, opacity: 1 }, 30_000);
  await expect(page.locator('[data-background-picture-hold] [data-transition-effect]')).toHaveCount(1);
  await expect(shaderCanvas(page, 'audio')).toHaveCount(1);
  await expect(page.locator('[data-background-picture-hold]')).toHaveCount(0);
  fixture.preview(null);
  await expect(page.locator('[data-background-picture-hold] [data-transition-effect]')).toHaveCount(1);
  await expect(page.locator('[data-background-picture-hold]')).toHaveCount(0);
  await fixture.check();
  expect(fixture.state.writes.every(write => !('backgroundAudioTrigger' in write))).toBe(true);
  await saveEvidence(info, { index: fixture.buildHash, normal, events: await page.evaluate(() => window.audioBeatTransitionEvents()) });
});

for (const role of ['normal', 'audio', 'circle'] as const) {
  test(`${role} shader stops draws/mirrors after the real sleep fade and wakes without rebuilding its program`, async ({ page }, info) => {
    await observe(page);
    const initial = record();
    if (role === 'audio') initial.backgroundTransitions.durationMs = 2200;
    if (role === 'circle') {
      await page.setViewportSize({ width: 1680, height: 756 });
      Object.assign(initial.capabilities, { surface: 'lcd-wide', family: 'jungle-leopard-d215', cssWidth: 1680, cssHeight: 756 });
      Object.assign(initial.layout, { surface: 'lcd-wide', d215Widget: { enabled: false, x: 0.5, y: 0.5, scale: 1 },
        d215Panels: { enabled: true, backgroundsEnabled: true, items: [{ id: 'circle-one', type: 'clock', x: 0.5, y: 0.5, diameter: 0.4,
          config: {}, background: { mode: 'shader', effect: 'plasma' } }] } });
    }
    const root = resolve(fileURLToPath(new URL('../.playwright/efficiency-circle/', import.meta.url)));
    const fixture = await audioBeatFixture(page, initial, role === 'circle' ? async route => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith('/efficiency-fixture/')) return false;
      const file = resolve(root, path.slice('/efficiency-fixture/'.length) || 'index.html');
      if (!file.startsWith(root + sep) || !existsSync(file)) { await route.abort(); return true; }
      await route.fulfill({ path: file }); return true;
    } : undefined);
    await page.goto(role === 'circle' ? '/efficiency-fixture/index.html?streamFps=30' : `/panel/${fixtureId}?streamFps=30`);
    await expect(shaderCanvas(page)).toHaveCount(1);
    if (role === 'audio') {
      await expect.poll(() => [...fixture.sockets].some(socket => socket.topics.has('panel/audio-trigger-preview'))).toBe(true);
      fixture.preview({ mode: 'shader', effect: 'scope', template: 0, opacity: 1 }, 30_000);
      await expect(shaderCanvas(page, role)).toHaveCount(1);
      // Sleep may begin during a transition; the current authored source remains selected.
    }
    const canvas = await shaderCanvas(page, role).elementHandle();
    const awake = await sample(page, role, 300);
    expect(awake.draws).toBeGreaterThan(0);
    if (role === 'audio') await expect(page.locator('[data-background-picture-hold]')).toHaveCount(1);
    const writes = fixture.state.writes.length;
    await sleep(page, role === 'circle');
    if (role === 'audio') await expect(page.locator('[data-background-picture-hold]')).toHaveCount(0);
    let programs = await page.evaluate(role => window.efficiencyWork[role].programs, role);
    const asleep = await sample(page, role);
    await saveEvidence(info, { phase: 'fully-hidden', index: fixture.buildHash, role, awake, asleep, programs });
    expect(asleep.draws).toBe(0);
    expect(asleep.copies).toBe(0);
    if (role === 'normal') {
      fixture.state.record = { ...fixture.state.record, backgroundEffect: 'rainbow', backgroundTemplate: 0 };
      fixture.changed();
      await expect.poll(() => page.evaluate(() => window.efficiencyWork.normal.programs)).toBeGreaterThan(programs);
      programs = await page.evaluate(() => window.efficiencyWork.normal.programs);
      expect((await sample(page, role, 150)).draws).toBe(0);
    }
    if (role === 'audio') expect([...fixture.sockets].some(socket => socket.topics.has('audio'))).toBe(true);
    await page.getByRole('button', { name: 'Screen asleep. Touch to wake.', exact: true }).tap();
    await expect(page.locator('.panel-root')).not.toHaveAttribute('data-screen-sleep');
    await expect.poll(() => page.evaluate(role => window.efficiencyWork[role].draws, role)).toBeGreaterThan(awake.draws);
    expect(await shaderCanvas(page, role).evaluate((element, previous) => element === previous, canvas)).toBe(true);
    expect(await page.evaluate(role => window.efficiencyWork[role].programs, role)).toBe(programs);
    expect(fixture.state.writes.length).toBe(writes);
    await fixture.check();
    await saveEvidence(info, { index: fixture.buildHash, shaderHashes: fixture.shaderHashes, role,
      scope: role === 'circle' ? 'Source-built production circle owners plus real fade; D215 has no native sleep input' : 'Production SPA',
      awake, asleep, programs });
  });
}

test('production Web View final release stays idle and re-add uses the persistent capability bridge', async ({ page }, info) => {
  await page.addInitScript(() => {
    window.efficiencyPosts = [];
    const loaded = new Set<string>();
    const bridge = new EventTarget() as EventTarget & { postMessage(message: Record<string, unknown>): void };
    const receive = (data: unknown) => bridge.dispatchEvent(new MessageEvent('message', { data }));
    bridge.postMessage = message => {
      window.efficiencyPosts.push(message);
      if (message.type === 'nexus.webview.hello') receive({ type: 'nexus.webview.caps', version: 1,
        supported: true, maxViews: 4, interactive: true, contextMenu: true, longPress: true, navControls: true });
      if (message.type === 'nexus.webview.sync') {
        const views = message.views as { id: string }[];
        for (const id of loaded) if (!views.some(view => view.id === id)) loaded.delete(id);
        for (const view of views) if (!loaded.has(view.id)) {
          loaded.add(view.id);
          receive({ type: 'nexus.webview.state', id: view.id, state: 'loaded', canGoBack: false });
        }
      }
    };
    const chrome = (window as unknown as { chrome?: object }).chrome ?? {};
    Object.defineProperty(chrome, 'webview', { value: bridge, configurable: true });
    Object.defineProperty(window, 'chrome', { value: chrome, configurable: true });
  });
  const initial = record();
  const widget = { id: 'web-one', type: 'web-view', size: '2x2', col: 0, row: 0,
    config: { url: 'https://example.test/', refreshMinutes: 1 } };
  Object.assign(initial.layout.pages[0], { widgets: [widget] });
  const fixture = await audioBeatFixture(page, initial);
  await page.goto(`/panel/${fixtureId}?streamFps=30`);
  await expect.poll(() => page.evaluate(() => window.efficiencyPosts.some(message => message.type === 'nexus.webview.sync'
    && (message.views as unknown[]).length === 1))).toBe(true);
  Object.assign(fixture.state.record.layout!.pages[0], { widgets: [] });
  fixture.changed();
  await expect.poll(() => page.evaluate(() => window.efficiencyPosts.filter(message => message.type === 'nexus.webview.sync'
    && (message.views as unknown[]).length === 0).length)).toBe(1);
  const before = await page.evaluate(() => window.efficiencyPosts.length);
  await page.evaluate(() => {
    for (const event of ['animationstart', 'transitionrun', 'scroll', 'resize']) window.dispatchEvent(new Event(event));
    document.body.append(document.createElement('span'));
  });
  await page.waitForTimeout(1400);
  expect(await page.evaluate(() => window.efficiencyPosts.length)).toBe(before);
  Object.assign(fixture.state.record.layout!.pages[0], { widgets: [widget] });
  fixture.changed();
  await expect.poll(() => page.evaluate(() => (window.efficiencyPosts.at(-1)?.views as unknown[] | undefined)?.length)).toBe(1);
  expect(await page.evaluate(() => window.efficiencyPosts.filter(message => message.type === 'nexus.webview.hello').length)).toBe(1);
  await fixture.check();
  await saveEvidence(info, { index: fixture.buildHash, posts: await page.evaluate(() => window.efficiencyPosts) });
});

test('render-only sleep preserves the running video node, playback clock and Finish Videos selection', async ({ page }, info) => {
  const initial = record();
  Object.assign(initial, { backgroundMode: 'media', backgroundMediaId: 'webm', backgroundMediaType: 'animated',
    backgroundMediaSlideshow: true, backgroundMediaFinishVideos: true, backgroundMediaInterval: 60,
    backgroundMediaOrder: ['webm', 'normal'] });
  const fixture = await audioBeatFixture(page, initial);
  fixture.state.library = [videoItem('webm'), ...fixture.state.library];
  fixture.state.media.set('webm', videoMedia('webm'));
  await page.goto(`/panel/${fixtureId}?streamFps=30`);
  const video = page.locator('video').first();
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0.1);
  const node = await video.elementHandle();
  await sleep(page);
  const before = await video.evaluate(element => ({ time: (element as HTMLVideoElement).currentTime, paused: (element as HTMLVideoElement).paused }));
  await page.waitForTimeout(650);
  const after = await video.evaluate(element => ({ time: (element as HTMLVideoElement).currentTime, paused: (element as HTMLVideoElement).paused }));
  expect(before.paused).toBe(false); expect(after.paused).toBe(false); expect(after.time).toBeGreaterThan(before.time + 0.3);
  await page.getByRole('button', { name: 'Screen asleep. Touch to wake.', exact: true }).tap();
  expect(await video.evaluate((element, prior) => element === prior, node)).toBe(true);
  expect(fixture.state.record.backgroundMediaId).toBe('webm');
  await fixture.check();
  await saveEvidence(info, { index: fixture.buildHash, before, after });
});

test('production Web View restores refresh after page revival without a native state echo', async ({ page }, info) => {
  await page.clock.install();
  await page.addInitScript(() => {
    window.efficiencyPosts = [];
    let loadedOnce = false;
    const bridge = new EventTarget() as EventTarget & { postMessage(message: Record<string, unknown>): void };
    const receive = (data: unknown) => bridge.dispatchEvent(new MessageEvent('message', { data }));
    bridge.postMessage = message => {
      window.efficiencyPosts.push(message);
      if (message.type === 'nexus.webview.hello') receive({ type: 'nexus.webview.caps', version: 1,
        supported: true, maxViews: 4, interactive: true, contextMenu: true, longPress: true, navControls: true });
      if (message.type === 'nexus.webview.sync' && !loadedOnce && (message.views as unknown[]).length > 0) {
        loadedOnce = true;
        receive({ type: 'nexus.webview.state', id: 'web-refresh', state: 'loaded', canGoBack: false });
      }
    };
    const chrome = (window as unknown as { chrome?: object }).chrome ?? {};
    Object.defineProperty(chrome, 'webview', { value: bridge, configurable: true });
    Object.defineProperty(window, 'chrome', { value: chrome, configurable: true });
  });
  const initial = { ...record(), backgroundMode: 'solid' as const };
  Object.assign(initial.layout.pages[0], { widgets: [{ id: 'web-refresh', type: 'web-view', size: '2x2', col: 0, row: 0,
    config: { url: 'https://example.test/refresh', refreshMinutes: 1 } }] });
  const fixture = await audioBeatFixture(page, initial);
  await page.goto(`/panel/${fixtureId}?streamFps=30`);
  await expect.poll(() => page.evaluate(() => window.efficiencyPosts.some(message => message.type === 'nexus.webview.sync'
    && (message.views as unknown[]).length === 1))).toBe(true);
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    window.dispatchEvent(new PageTransitionEvent('pageshow'));
  });
  await page.clock.fastForward(60_000);
  const reloads = () => page.evaluate(() => window.efficiencyPosts.filter(message => message.type === 'nexus.webview.command'
    && message.command === 'reload' && message.id === 'web-refresh').length);
  expect(await reloads()).toBe(1);
  Object.assign(fixture.state.record.layout!.pages[0], { widgets: [] });
  fixture.changed();
  await expect.poll(() => page.evaluate(() => window.efficiencyPosts.at(-1)?.type === 'nexus.webview.sync'
    && (window.efficiencyPosts.at(-1)?.views as unknown[]).length === 0)).toBe(true);
  await page.clock.fastForward(120_000);
  expect(await reloads()).toBe(1);
  await fixture.check();
  await saveEvidence(info, { index: fixture.buildHash, clockScope: 'Virtual60s interval; no elapsed performance claim',
    posts: await page.evaluate(() => window.efficiencyPosts) });
});
