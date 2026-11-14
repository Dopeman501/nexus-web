import { expect, test, type Page } from '@playwright/test';
import { productionFixture, seed, sound, kick, quiet, durationMs } from './backgroundTransitionsFixture';
import { videoMedia } from './backgroundVideoFixtures';
import { difference, endpoints, reference, shot } from './backgroundTransitionPixels';

type Fixture = Awaited<ReturnType<typeof productionFixture>>;
const fixtures = new WeakMap<Page, Fixture>();
const engines = ['gl-transitions:WaterDrop', 'curtains:wave'];
const audio = (page: Page) => page.locator('[data-audio-trigger-background]');
const audioCanvas = (page: Page) => page.locator('[data-background-picture-hold] canvas[data-picture-transition-renderer]');
const slideCanvas = (page: Page) => page.locator('[data-slideshow-picture-transition] canvas[data-picture-transition-renderer]');
async function setup(page: Page, record = seed()) {
  const fixture = await productionFixture(page, record); fixtures.set(page, fixture); return fixture;
}
const pump = (fixture: Fixture) => {
  const timer = setInterval(() => fixture.sound(sound), 50);
  return () => clearInterval(timer);
};
async function canvasCounts(page: Page) {
  return page.evaluate(() => ({ added: Number(document.documentElement.dataset.fixtureCanvasesAdded ?? 0),
    peak: Number(document.documentElement.dataset.fixtureCanvasesPeak ?? 0), active: document.querySelectorAll('canvas').length }));
}
async function openBackground(page: Page) {
  await page.locator('[class*="sidebarColumn"]').getByRole('button', { name: 'Jungle Leopard D215' }).first().click();
  await page.getByRole('tab', { name: 'Background', exact: true }).click();
}
test.afterEach(async ({ page }, info) => {
  const fixture = fixtures.get(page);
  if (!fixture) return;
  await info.attach('isolated-production-evidence', { contentType: 'application/json', body: JSON.stringify({
    buildIndexSha256: fixture.buildHash, assetRoot: fixture.assetRoot, target: fixture.target,
    blocked: fixture.state.blocked, errors: fixture.state.errors,
    warnings: fixture.state.warnings, writes: fixture.state.writes, canvases: await canvasCounts(page),
  }, null, 2) });
  await fixture.check();
});

test('production settings save and reopen independent slideshow and audio choices', async ({ page }, info) => {
  await page.setViewportSize({ width: 1600, height: 1050 });
  const record = seed('default'); record.backgroundMediaSlideshow = true;
  const fixture = await setup(page, record);
  const originalAudio = JSON.stringify(record.backgroundAudioTrigger);
  await page.goto('/'); await openBackground(page);
  await page.getByRole('button', { name: 'Slideshow transition', exact: true }).click();
  await expect(page.getByRole('option')).toHaveCount(228);
  await page.getByRole('option', { name: 'Water Drop', exact: true }).click();
  // Audio remains on Default here, so only the slideshow duration is editable.
  await page.getByRole('button', { name: 'Transition duration', exact: true }).first().click();
  await page.getByRole('spinbutton').fill('1250'); await page.getByRole('spinbutton').press('Enter');
  await page.getByRole('button', { name: 'Audio Trigger transition', exact: true }).click();
  await page.getByRole('option', { name: 'Wave displacement', exact: true }).click();
  await page.getByRole('button', { name: 'Transition duration', exact: true }).nth(0).click();
  await page.getByRole('spinbutton').fill('1550'); await page.getByRole('spinbutton').press('Enter');
  await expect.poll(() => fixture.state.record.backgroundMediaTransition).toEqual({ effect: 'gl-transitions:WaterDrop', durationMs: 1250 });
  await expect.poll(() => fixture.state.record.backgroundAudioTriggerTransition).toEqual({ effect: 'curtains:wave', durationMs: 1550 });
  expect(JSON.stringify(fixture.state.record.backgroundAudioTrigger)).toBe(originalAudio);
  expect(fixture.state.writes.every(patch => Object.keys(patch).every(key => ['backgroundMediaTransition', 'backgroundAudioTriggerTransition'].includes(key)))).toBe(true);
  await page.reload(); await openBackground(page);
  await expect(page.getByRole('button', { name: 'Slideshow transition', exact: true })).toHaveText('Water Drop');
  await expect(page.getByRole('button', { name: 'Audio Trigger transition', exact: true })).toHaveText('Wave displacement');
  await expect(page.getByRole('slider', { name: 'Transition duration', exact: true }).nth(0)).toHaveValue('1550');
  await expect(page.getByRole('slider', { name: 'Transition duration', exact: true }).nth(1)).toHaveValue('1250');
  await page.screenshot({ path: info.outputPath('saved-transition-controls.png') });
});

for (const effect of engines) {
  test(`production slideshow renders ${effect} endpoints and a distinct intermediate frame`, async ({ page }, info) => {
    const record = seed(effect); record.backgroundMediaSlideshow = true; record.backgroundAudioTrigger!.enabled = false;
    const fixture = await setup(page, record); await fixture.open();
    const expectedStart = await reference(page, 'normal'), expectedEnd = await reference(page, 'next');
    const start = await shot(page, info, 'slideshow-start');
    await expect(slideCanvas(page)).toBeVisible({ timeout: 9000 });
    await page.waitForTimeout(650); const middle = await shot(page, info, 'slideshow-middle');
    await info.attach('slideshow-layer-styles', { contentType: 'application/json', body: JSON.stringify(await slideCanvas(page).evaluate(canvas => {
      const rows = []; let current: Element | null = canvas;
      while (current && rows.length < 6) {
        const css = getComputedStyle(current);
        rows.push({ tag: current.tagName, class: current.className, zIndex: css.zIndex, position: css.position,
          visibility: css.visibility, opacity: css.opacity, box: current.getBoundingClientRect().toJSON() });
        current = current.parentElement;
      }
      return rows;
    }), null, 2) });
    if (difference(middle, expectedEnd) < 2) {
      const incoming = page.locator('[data-panel-bg-layer]').filter({ has: page.locator('img[src*="/next/file"]') });
      await incoming.evaluate(element => { (element as HTMLElement).style.visibility = 'hidden'; });
      await shot(page, info, 'diagnostic-hidden-incoming');
      await incoming.evaluate(element => { (element as HTMLElement).style.visibility = ''; });
    }
    await expect(page.locator('[data-slideshow-picture-transition]')).toHaveCount(0, { timeout: durationMs + 2500 });
    const end = await shot(page, info, 'slideshow-end');
    endpoints(start, middle, end, expectedStart, expectedEnd);
    expect(await canvasCounts(page)).toMatchObject({ added: 1, peak: 1, active: 0 });
    expect(fixture.state.writes).toEqual([]);
  });

  test(`production audio renders ${effect} on entry, a beat and normal restoration`, async ({ page }, info) => {
    const fixture = await setup(page, seed(effect)); await fixture.open(); await fixture.audioReady();
    const expectedStart = await reference(page, 'normal'), expectedEnd = await reference(page, 'audio-a');
    const start = await shot(page, info, 'audio-normal');
    await fixture.sustain(sound, 550); const stop = pump(fixture);
    try {
      await expect(audioCanvas(page)).toBeVisible(); await page.waitForTimeout(650);
      const middle = await shot(page, info, 'audio-entry-middle');
      await expect(page.locator('[data-background-picture-hold]')).toHaveCount(0, { timeout: durationMs + 2500 });
      const end = await shot(page, info, 'audio-entry-end'); endpoints(start, middle, end, expectedStart, expectedEnd);
      await fixture.sustain(kick, 100);
      await expect(audio(page).locator('img[src*="/audio-b/file"]')).toBeVisible();
      await expect(audioCanvas(page)).toBeVisible();
      await page.waitForTimeout(durationMs + 250);
      expect(difference(await shot(page, info, 'audio-beat-end'), await reference(page, 'audio-b'))).toBeLessThan(5);
    } finally { stop(); }
    await fixture.sustain(quiet, 500);
    await expect(audio(page)).toHaveCount(0);
    await expect(page.locator('[data-background-picture-hold]')).toHaveCount(0, { timeout: durationMs + 2500 });
    expect(difference(await shot(page, info, 'audio-restored'), expectedStart)).toBeLessThan(5);
    expect((await canvasCounts(page)).peak).toBe(1);
    expect(fixture.state.writes).toEqual([]);
  });
}

test('production preview overrides rhythm and expires back through the selected transition', async ({ page }, info) => {
  const fixture = await setup(page); await fixture.open(); await fixture.audioReady();
  await fixture.sustain(sound, 550); const stop = pump(fixture);
  try {
    await page.waitForTimeout(durationMs + 300);
    fixture.preview({ mode: 'media', mediaId: 'preview', mediaType: 'static', opacity: 1 }, 4500);
    await expect(audio(page).locator('img[src*="/preview/file"]')).toBeVisible();
    await fixture.sustain(kick, 150);
    await page.waitForTimeout(durationMs);
    expect(difference(await shot(page, info, 'preview-priority'), await reference(page, 'preview'))).toBeLessThan(5);
    await expect(audio(page).locator('img[src*="/preview/file"]')).toHaveCount(0, { timeout: 4000 });
    await expect(audio(page).locator('img[src*="/audio-a/file"]')).toBeVisible();
    await expect(page.locator('[data-background-picture-hold]')).toHaveCount(0, { timeout: durationMs + 2500 });
    expect(difference(await shot(page, info, 'preview-expired'), await reference(page, 'audio-a'))).toBeLessThan(5);
    expect(fixture.state.writes).toEqual([]); expect(fixture.state.previewWrites).toEqual([]);
  } finally { stop(); }
});

test('production interruptions converge on the latest preview and retire earlier canvases', async ({ page }, info) => {
  const fixture = await setup(page, seed('curtains:wave')); await fixture.open(); await fixture.audioReady();
  await fixture.sustain(sound, 550); const stop = pump(fixture);
  try {
    await expect(audioCanvas(page)).toBeVisible();
    for (const mediaId of ['preview', 'audio-b', 'preview', 'audio-a', 'audio-b']) {
      fixture.preview({ mode: 'media', mediaId, mediaType: 'static', opacity: 1 });
      await page.waitForTimeout(90);
    }
    await expect(audio(page).locator('img[src*="/audio-b/file"]')).toBeVisible();
    await expect(page.locator('[data-background-picture-hold]')).toHaveCount(0, { timeout: durationMs + 2500 });
    expect(difference(await shot(page, info, 'latest-interruption'), await reference(page, 'audio-b'))).toBeLessThan(5);
    expect(await canvasCounts(page)).toMatchObject({ peak: 1, active: 0 });
  } finally { stop(); }
});

for (const kind of ['gif', 'video'] as const) {
  test(`production ${kind} audio preserves playback ${kind === 'video' ? 'through its selected transition' : 'without a picture canvas'}`, async ({ page }, info) => {
    const record = seed();
    record.backgroundAudioTrigger!.backgrounds = [{ mode: 'media', mediaId: kind, mediaType: 'animated', mediaAlpha: kind === 'gif', opacity: 1 }];
    const fixture = await setup(page, record); await fixture.open(); await fixture.audioReady();
    // Reuse the decoded VP8 fixture. Headless canvas MediaRecorder can emit an
    // invalid short clip before this test reaches any Nexus playback behavior.
    if (kind === 'video') fixture.state.video = videoMedia('webm').body;
    await fixture.sustain(sound, 550); const stop = pump(fixture);
    try {
      const element = audio(page).locator(kind === 'gif' ? 'img' : 'video'); await expect(element).toBeVisible();
      await expect.poll(() => element.evaluate(node => node instanceof HTMLVideoElement ? node.readyState >= 2 && node.currentTime > 0 : (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0)).toBe(true);
      if (kind === 'video') {
        await expect(audioCanvas(page)).toHaveCount(1);
        // This legacy fixture is a short looping clip; currentTime wraps.
        const before = await element.evaluate(node => (node as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames);
        await page.waitForTimeout(350);
        expect(await element.evaluate(node => (node as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(before);
        await expect(audioCanvas(page)).toHaveCount(0, { timeout: durationMs + 3000 });
        expect((await canvasCounts(page)).active).toBe(0);
      } else {
        await page.waitForTimeout(350);
        expect(await canvasCounts(page)).toMatchObject({ added: 0, peak: 0, active: 0 });
      }
      await page.screenshot({ path: info.outputPath(`${kind}-native-playback.png`) });
    } finally { stop(); }
  });
}

for (const effect of ['default', 'none']) {
  test(`production slideshow preserves ${effect} compatibility without a GPU renderer`, async ({ page }, info) => {
    const record = seed(effect); record.backgroundMediaSlideshow = true; record.backgroundAudioTrigger!.enabled = false;
    const fixture = await setup(page, record); await fixture.open();
    await expect(page.locator('[data-panel-bg-layer] img[src*="/normal/file"]')).toHaveCount(0, { timeout: 9000 });
    await expect(page.locator('[data-panel-bg-layer] img[src*="/next/file"]')).toBeVisible();
    expect(difference(await shot(page, info, effect + '-endpoint'), await reference(page, 'next'))).toBeLessThan(5);
    expect(await canvasCounts(page)).toMatchObject({ added: 0, peak: 0, active: 0 });
  });
}

test('production unavailable WebGL falls back to the selected audio picture', async ({ page }, info) => {
  await page.addInitScript(() => {
    const native = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
      return /webgl/i.test(kind) ? null : Reflect.apply(native, this, [kind, ...args]);
    } as typeof native;
  });
  const fixture = await setup(page); await fixture.open(); await fixture.audioReady();
  await fixture.sustain(sound, 550); const stop = pump(fixture);
  try {
    await expect(audio(page).locator('img[src*="/audio-a/file"]')).toBeVisible();
    await expect(page.locator('[data-background-picture-hold]')).toHaveCount(0, { timeout: 5000 });
    expect(difference(await shot(page, info, 'unavailable-webgl-fallback'), await reference(page, 'audio-a'))).toBeLessThan(5);
    await expect(page.locator('canvas')).toHaveCount(0);
  } finally { stop(); }
});

for (const effect of engines) {
  test(`production ${effect} context loss completes with the current picture`, async ({ page }, info) => {
    const fixture = await setup(page, seed(effect)); await fixture.open(); await fixture.audioReady();
    await fixture.sustain(sound, 550); const stop = pump(fixture);
    try {
      await expect(audioCanvas(page)).toBeVisible();
      await audioCanvas(page).evaluate(async element => {
        const canvas = element as HTMLCanvasElement;
        const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
        if (!gl) throw new Error('Expected an existing GPU context');
        const extension = gl.getExtension('WEBGL_lose_context');
        if (!extension) throw new Error('WEBGL_lose_context unavailable');
        const lost = new Promise<void>(resolve => canvas.addEventListener('webglcontextlost', () => resolve(), { once: true }));
        extension.loseContext(); await lost;
      });
      await expect(page.locator('[data-background-picture-hold]')).toHaveCount(0, { timeout: 3500 });
      expect(difference(await shot(page, info, 'context-loss-fallback'), await reference(page, 'audio-a'))).toBeLessThan(5);
      expect((await canvasCounts(page)).active).toBe(0);
    } finally { stop(); }
  });
}
