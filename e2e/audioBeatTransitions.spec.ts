import { expect, test, type Page } from '@playwright/test';
import { audioBeatFixture, audioBeatSeed, audioBeatSound, audioBeatKick, beatCanvas, beatEvents, completedDuration } from './audioBeatTransitionsFixture';
import { difference, pixels } from './backgroundTransitionPixels';
import { openSharedBackground } from './sharedBackgroundTransitionsFixture';
import { fixtureId } from './backgroundTransitionsFixture';
import { videoItem, videoMedia } from './backgroundVideoFixtures';
import { observeVideos } from './backgroundVideoObservation';

type Fixture = Awaited<ReturnType<typeof audioBeatFixture>>;
const fixtures = new WeakMap<Page, Fixture>();
async function setup(page: Page, record = audioBeatSeed()) {
  const fixture = await audioBeatFixture(page, record); fixtures.set(page, fixture); return fixture;
}
async function activate(page: Page, fixture: Fixture) {
  await fixture.sustain(audioBeatSound, 500);
  await expect(page.locator('[data-audio-trigger-background] canvas')).toHaveCount(1);
}
const mean = (values: Uint8Array) => values.reduce((total, value) => total + value, 0) / values.length;

test.afterEach(async ({ page }, info) => {
  const fixture = fixtures.get(page); if (!fixture) return;
  await info.attach('audio-beat-evidence', { contentType: 'application/json', body: JSON.stringify({
    assetRoot: fixture.assetRoot, indexSha256: fixture.buildHash, target: fixture.target,
    shaderSourceSha256: fixture.shaderHashes,
    record: fixture.state.record, writes: fixture.state.writes, blocked: fixture.state.blocked,
    errors: fixture.state.errors, warnings: fixture.state.warnings,
    transitions: await beatEvents(page).catch(() => []),
    canvasCaptures: await page.evaluate(() => window.audioBeatCanvasCaptures()).catch(() => []),
    media: await page.evaluate(() => window.videoObservation?.() ?? null).catch(() => null),
  }, null, 2) });
  await fixture.check();
});

for (const effect of ['gl-transitions:WaterDrop', 'curtains:wave']) {
  test(`initial solid to Oscilloscope activation renders ${effect} using the main duration`, async ({ page }, info) => {
    const fixture = await setup(page, audioBeatSeed({ effect, beat: false })); await fixture.openSolid();
    const start = pixels(await page.locator('.panel-root').screenshot({ path: info.outputPath('normal-solid.png') }));
    const stop = fixture.pump();
    try {
      await activate(page, fixture);
      await expect(beatCanvas(page)).toHaveCount(1);
      await expect.poll(async () => (await beatEvents(page))[0]?.effect).toBe(effect);
      await expect.poll(() => page.evaluate(() => window.audioBeatCanvasCaptures()
        .some(capture => capture.role === 'audio' && capture.litPixels > 0 && !capture.error))).toBe(true);
      await page.waitForTimeout(650);
      const middle = pixels(await page.locator('.panel-root').screenshot({ path: info.outputPath('activation-middle.png') }));
      expect(mean(middle)).toBeGreaterThan(8); // The captured live shader must not make a black transition frame.
      expect(difference(start, middle)).toBeGreaterThan(2);
      const duration = await completedDuration(page, 0);
      expect(duration).toBeGreaterThanOrEqual(2300); expect(duration).toBeLessThan(4200);
      await page.locator('.panel-root').screenshot({ path: info.outputPath('oscilloscope-active.png') });
      expect(fixture.state.writes).toEqual([]);
    } finally { stop(); }
  });
}

test('shader beat swaps use their shorter duration while initial activation retains the main duration', async ({ page }, info) => {
  const fixture = await setup(page); await fixture.openSolid(); const stop = fixture.pump();
  try {
    await activate(page, fixture); const activation = await completedDuration(page, 0);
    await fixture.sustain(audioBeatKick, 100);
    await expect.poll(async () => (await beatEvents(page)).length).toBe(2);
    await expect(beatCanvas(page)).toHaveCount(1);
    await page.locator('.panel-root').screenshot({ path: info.outputPath('between-beats-middle.png') });
    const beat = await completedDuration(page, 1);
    expect(activation).toBeGreaterThanOrEqual(2300);
    expect(beat).toBeGreaterThanOrEqual(450); expect(beat).toBeLessThan(1500);
    expect(activation - beat).toBeGreaterThan(1300);
    expect(fixture.state.writes).toEqual([]);
  } finally { stop(); }
});

test('beat Off cuts shader swaps and keeps the main activation transition', async ({ page }) => {
  const fixture = await setup(page, audioBeatSeed({ beat: false })); await fixture.openSolid(); const stop = fixture.pump();
  try {
    await activate(page, fixture); await completedDuration(page, 0);
    await fixture.sustain(audioBeatKick, 100); await page.waitForTimeout(450);
    expect(await beatEvents(page)).toHaveLength(1); await expect(beatCanvas(page)).toHaveCount(0);
    await expect(page.locator('[data-audio-trigger-background] canvas')).toHaveCount(1);
  } finally { stop(); }
});

test('main Off with beat On cuts activation and still transitions between shader beats', async ({ page }) => {
  const fixture = await setup(page, audioBeatSeed({ main: false })); await fixture.openSolid(); const stop = fixture.pump();
  try {
    await activate(page, fixture); expect(await beatEvents(page)).toEqual([]); await expect(beatCanvas(page)).toHaveCount(0);
    await fixture.sustain(audioBeatKick, 100);
    await expect.poll(async () => (await beatEvents(page)).length).toBe(1);
    const duration = await completedDuration(page, 0);
    expect(duration).toBeGreaterThanOrEqual(450); expect(duration).toBeLessThan(1500);
  } finally { stop(); }
});

test('playing MP4 to Oscilloscope and return to the same clip use the main duration with beats Off', async ({ page }, info) => {
  await observeVideos(page);
  const record = audioBeatSeed({ beat: false });
  record.backgroundMode = 'media'; record.backgroundMediaId = 'mp4-a'; record.backgroundMediaType = 'animated';
  const fixture = await setup(page, record);
  fixture.state.media.set('mp4-a', videoMedia('mp4-a')); fixture.state.library = [videoItem('mp4-a')];
  await page.goto(`/panel/${fixtureId}`); await fixture.audioReady();
  const clip = page.locator('video[src*="/mp4-a/file"]');
  await expect(clip).toBeVisible();
  await expect.poll(() => clip.evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThan(0.15);
  const stop = fixture.pump();
  try {
    await activate(page, fixture); await expect(beatCanvas(page)).toHaveCount(1);
    await page.locator('.panel-root').screenshot({ path: info.outputPath('mp4-to-scope-middle.png') });
    expect(await completedDuration(page, 0)).toBeGreaterThanOrEqual(2300);
    await fixture.sustain(audioBeatKick, 100); await page.waitForTimeout(350);
    expect(await beatEvents(page)).toHaveLength(1);
  } finally { stop(); }
  await fixture.sustain({ ...audioBeatSound, level: 0, bass: 0, beat: 0 }, 500);
  await expect.poll(async () => (await beatEvents(page)).length).toBe(2);
  await expect(beatCanvas(page)).toHaveCount(1);
  await expect(clip).toBeAttached();
  await page.locator('.panel-root').screenshot({ path: info.outputPath('scope-to-mp4-middle.png') });
  expect(await completedDuration(page, 1)).toBeGreaterThanOrEqual(2300);
  await expect(clip).toBeVisible();
  const before = await clip.evaluate(video => (video as HTMLVideoElement).currentTime);
  await page.waitForTimeout(350);
  expect(await clip.evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThan(before + 0.1);
  const observed = await page.evaluate(() => window.videoObservation());
  expect(observed.peakSources).toBeLessThanOrEqual(1);
  const retired = observed.events.filter(event => event.action === 'retire' && event.src.includes('/mp4-a/file'));
  expect(retired.length).toBeGreaterThan(0);
  expect(retired.every(event => event.capturedAt > 0 && event.at - event.capturedAt < 250)).toBe(true);
  expect(fixture.state.writes).toEqual([]);
});

for (const beatDuration of [80, 150]) {
  test(`a ${beatDuration} ms shader beat reveals a fully opaque live frame when its custom transition ends`, async ({ page }, info) => {
    const fixture = await setup(page, audioBeatSeed({ main: false, beatDuration }));
    await fixture.openSolid(); const stop = fixture.pump();
    try {
      await activate(page, fixture); await page.waitForTimeout(350);
      await fixture.sustain(audioBeatKick, 100);
      await completedDuration(page, 0);
      const end = pixels(await page.locator('.panel-root').screenshot({ path: info.outputPath(`beat-${beatDuration}-end.png`) }));
      expect(mean(end)).toBeGreaterThan(8);
      expect((await beatEvents(page))[0].opacityAtEnd).toBeGreaterThanOrEqual(0.99);
      expect(fixture.state.writes).toEqual([]);
    } finally { stop(); }
  });
}

for (const main of [true, false]) {
  test(`editor shader preview follows main ${main ? 'On' : 'Off'} instead of the opposite beat toggle`, async ({ page }) => {
    const fixture = await setup(page, audioBeatSeed({ main, beat: !main })); await fixture.openSolid();
    fixture.preview({ mode: 'shader', effect: 'scope', template: 0, opacity: 1 });
    await expect(page.locator('[data-audio-trigger-background] canvas')).toHaveCount(1);
    if (main) {
      await expect(beatCanvas(page)).toHaveCount(1);
      const duration = await completedDuration(page, 0);
      expect(duration).toBeGreaterThanOrEqual(2300); expect(duration).toBeLessThan(4200);
    } else {
      await page.waitForTimeout(700); expect(await beatEvents(page)).toEqual([]);
      await expect(beatCanvas(page)).toHaveCount(0);
    }
    expect(fixture.state.writes).toEqual([]);
  });
}

test('Audio Trigger menu saves only beat preferences, keeps one picker, and reopens the retained disabled duration', async ({ page }, info) => {
  const fixture = await setup(page, audioBeatSeed({ main: false }));
  const originalAudio = JSON.stringify(fixture.state.record.backgroundAudioTrigger);
  await openSharedBackground(page);
  await page.getByRole('button', { name: 'Backgrounds', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Audio Trigger backgrounds', exact: true });
  await expect(dialog.getByRole('switch', { name: 'Beat transitions' })).toBeChecked();
  await expect(dialog.getByRole('slider', { name: 'Transition duration' })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Transitions', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Transition duration' }).click();
  await dialog.getByRole('spinbutton').fill('1350'); await dialog.getByRole('spinbutton').press('Enter');
  await expect.poll(() => (fixture.state.record as ReturnType<typeof audioBeatSeed>).backgroundAudioTriggerBeatTransition)
    .toEqual({ enabled: true, durationMs: 1350 });
  await dialog.getByRole('switch', { name: 'Beat transitions' }).click();
  await expect.poll(() => (fixture.state.record as ReturnType<typeof audioBeatSeed>).backgroundAudioTriggerBeatTransition)
    .toEqual({ enabled: false, durationMs: 1350 });
  await expect(dialog.getByRole('switch', { name: 'Beat transitions' })).not.toBeChecked();
  await expect(dialog.getByRole('slider', { name: 'Transition duration' })).toBeDisabled();
  await page.waitForTimeout(250); // Let the toggle's visible Off animation finish before recording the settings screen.
  await page.screenshot({ path: info.outputPath('beat-controls-disabled.png') });
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload(); await openSharedBackground(page);
  await page.getByRole('button', { name: 'Backgrounds', exact: true }).click();
  await expect(dialog.getByRole('slider', { name: 'Transition duration' })).toHaveValue('1350');
  await expect(dialog.getByRole('switch', { name: 'Beat transitions' })).not.toBeChecked();
  expect(JSON.stringify(fixture.state.record.backgroundAudioTrigger)).toBe(originalAudio);
  expect(fixture.state.writes.length).toBe(2);
  expect(fixture.state.writes.every(patch => Object.keys(patch).every(key => key === 'backgroundAudioTriggerBeatTransition'))).toBe(true);
});
