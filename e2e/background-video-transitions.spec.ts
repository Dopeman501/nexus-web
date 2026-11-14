import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { productionFixture, seed, sound, kick, quiet } from './backgroundTransitionsFixture';
import { stillItem, videoItem, videoMedia } from './backgroundVideoFixtures';
import { observeVideos } from './backgroundVideoObservation';
import { difference, reference, shot } from './backgroundTransitionPixels';

const effects = ['gl-transitions:WaterDrop', 'curtains:wave'];
const duration = 2800;
type Fixture = Awaited<ReturnType<typeof productionFixture>>;
const fixtures = new WeakMap<Page, Fixture>();
const responses = new WeakMap<Page, { id: string; status: number; contentRange?: string; mime?: string }[]>();
const hold = (page: Page) => page.locator('[data-background-picture-hold], [data-slideshow-picture-transition]');
const canvas = (page: Page) => hold(page).locator('canvas[data-picture-transition-renderer]').filter({ visible: true });
const currentVideo = (page: Page, id: string) => page.locator(`video[src*="/${id}/file"]`);
async function setup(page: Page, effect: string, slideshow = false) {
  await observeVideos(page);
  const base = seed(effect);
  const fixture = await productionFixture(page, { ...base, backgroundMediaSlideshow: slideshow,
    backgroundMediaOrder: ['normal', 'mp4-a', 'webm', 'next'], backgroundMediaFinishVideos: false,
    backgroundMediaTransition: { effect, durationMs: duration }, backgroundAudioTriggerTransition: { effect, durationMs: duration },
    backgroundAudioTrigger: { ...base.backgroundAudioTrigger!, enabled: !slideshow, backgrounds: [
      { mode: 'media', mediaId: 'mp4-a', mediaType: 'animated', opacity: 1 },
      { mode: 'media', mediaId: 'webm', mediaType: 'animated', opacity: 1 },
    ] } });
  for (const id of ['mp4-a', 'mp4-b', 'webm', 'mp4-short']) fixture.state.media.set(id, videoMedia(id));
  fixture.state.library = [stillItem('normal'), videoItem('mp4-a', 1), videoItem('webm', 2), stillItem('next', 3)];
  const seen: NonNullable<ReturnType<typeof responses.get>> = []; responses.set(page, seen);
  page.on('response', response => {
    const match = /\/background-media\/(mp4-a|mp4-b|mp4-short|webm)\/file$/.exec(new URL(response.url()).pathname);
    if (match) seen.push({ id: match[1], status: response.status(),
      contentRange: response.headers()['content-range'], mime: response.headers()['content-type'] });
  });
  fixtures.set(page, fixture); return fixture;
}
const pump = (fixture: Fixture) => {
  const timer = setInterval(() => fixture.sound(sound), 50); return () => clearInterval(timer);
};
async function moving(page: Page, info: TestInfo, name: string, id: string) {
  await expect(canvas(page)).toHaveCount(1, { timeout: 10_000 });
  await expect(currentVideo(page, id)).toBeAttached();
  const before = await currentVideo(page, id).evaluate(video => (video as HTMLVideoElement).currentTime);
  await page.waitForTimeout(300); const first = await shot(page, info, `${name}-moving-1`);
  await page.waitForTimeout(450); const second = await shot(page, info, `${name}-moving-2`);
  const after = await currentVideo(page, id).evaluate(video => (video as HTMLVideoElement).currentTime);
  expect(after - before).toBeGreaterThan(0.25); expect(difference(first, second)).toBeGreaterThan(1);
  await expect(hold(page)).toHaveCount(0, { timeout: duration + 3000 });
  expect((await page.evaluate(() => window.videoObservation())).peakSources).toBeLessThanOrEqual(1);
}
async function release(page: Page, fixture: Fixture) {
  fixture.state.record = { ...fixture.state.record, backgroundMode: 'solid', backgroundAudioTrigger: {
    ...fixture.state.record.backgroundAudioTrigger!, enabled: false }, backgroundMediaSlideshow: false };
  fixture.changed();
  await expect(page.locator('video')).toHaveCount(0);
  await expect(hold(page)).toHaveCount(0);
  const observed = await page.evaluate(() => window.videoObservation());
  expect(observed.videos.every(video => !video.src && video.paused)).toBe(true);
  expect(observed.peakSources).toBeLessThanOrEqual(1);
}
async function frozenBeforeRetirement(page: Page, id: string) {
  const observed = await page.evaluate(() => window.videoObservation());
  const retirements = observed.events.filter(event => event.action === 'retire' && event.src.includes(`/${id}/file`));
  expect(retirements.length).toBeGreaterThan(0);
  expect(retirements.every(event => event.capturedAt > 0 && event.at - event.capturedAt < 250)).toBe(true);
}
test.afterEach(async ({ page }, info) => {
  const fixture = fixtures.get(page); if (!fixture) return;
  await info.attach('video-acceptance', { contentType: 'application/json', body: JSON.stringify({
    buildIndexSha256: fixture.buildHash, assetRoot: fixture.assetRoot, errors: fixture.state.errors,
    blocked: fixture.state.blocked, mediaRequests: fixture.state.mediaRequests, mediaResponses: responses.get(page),
    media: await page.evaluate(() => window.videoObservation()),
  }, null, 2) });
  expect(responses.get(page)?.some(response => response.status === 206 && /^bytes \d+-\d+\/\d+$/.test(response.contentRange ?? ''))).toBe(true);
  await fixture.check(); expect(fixture.state.writes).toEqual([]);
});

for (const effect of effects) {
  test(`production Slideshow I→MP4→WebM→I uses ${effect} with live incoming frames`, async ({ page }, info) => {
    const fixture = await setup(page, effect, true); await fixture.open();
    await moving(page, info, 'image-to-mp4', 'mp4-a');
    await moving(page, info, 'mp4-to-webm', 'webm');
    await frozenBeforeRetirement(page, 'mp4-a');
    await expect(canvas(page)).toHaveCount(1, { timeout: 10_000 });
    await shot(page, info, 'webm-to-image-middle');
    await expect(hold(page)).toHaveCount(0, { timeout: duration + 3000 });
    expect(difference(await shot(page, info, 'final-still'), await reference(page, 'next'))).toBeLessThan(5);
    await release(page, fixture);
  });

  test(`production Audio normal→MP4→WebM→normal and preview interruption uses ${effect}`, async ({ page }, info) => {
    const fixture = await setup(page, effect); await fixture.open(); await fixture.audioReady();
    await fixture.sustain(sound, 550); const stop = pump(fixture);
    try {
      await moving(page, info, 'audio-entry-mp4', 'mp4-a');
      await fixture.sustain(kick, 100); await moving(page, info, 'audio-beat-webm', 'webm');
      await frozenBeforeRetirement(page, 'mp4-a');
      for (const mediaId of ['mp4-b', 'mp4-a', 'mp4-b']) {
        fixture.preview({ mode: 'media', mediaId, mediaType: 'animated', opacity: 1 }); await page.waitForTimeout(100);
      }
      await expect(currentVideo(page, 'mp4-b')).toBeVisible();
      await expect(hold(page)).toHaveCount(0, { timeout: duration + 3000 });
      await expect.poll(() => currentVideo(page, 'mp4-b').evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThan(0.2);
      await shot(page, info, 'latest-preview-mp4');
      fixture.preview(null); await page.waitForTimeout(500);
    } finally { stop(); }
    await fixture.sustain(quiet, 550);
    await expect(page.locator('[data-audio-trigger-background]')).toHaveCount(0);
    await expect(hold(page)).toHaveCount(0, { timeout: duration + 3000 });
    expect(difference(await shot(page, info, 'normal-restored'), await reference(page, 'normal'))).toBeLessThan(5);
    await release(page, fixture);
  });
}

for (const finish of [true, false]) {
  test(`production Finish Videos=${finish} preserves clip cadence and one decoder`, async ({ page }, info) => {
    const fixture = await setup(page, effects[0], true);
    fixture.state.record = { ...fixture.state.record, backgroundMediaId: finish ? 'normal' : 'mp4-short',
      backgroundMediaType: finish ? 'static' : 'animated',
      backgroundMediaOrder: finish ? ['normal', 'mp4-short', 'next'] : ['mp4-short', 'next'], backgroundMediaFinishVideos: finish,
      backgroundMediaTransition: { effect: effects[0], durationMs: finish ? 3800 : duration } };
    fixture.state.library = [...(finish ? [stillItem('normal')] : []), videoItem('mp4-short'), stillItem('next', 1)];
    await page.goto('/panel/transition-fixture');
    if (finish) {
      await expect(canvas(page)).toHaveCount(1, { timeout: 10_000 });
      await expect(hold(page)).toHaveCount(0, { timeout: 7000 });
    }
    await expect(currentVideo(page, 'mp4-short')).toBeVisible();
    const before = await page.evaluate(() => window.videoObservation());
    const previousEnded = before.events.filter(event => event.action === 'ended').length;
    const start = await page.evaluate(() => performance.now());
    await expect(canvas(page)).toHaveCount(1, { timeout: 10_000 });
    const elapsed = await page.evaluate(() => performance.now()) - start;
    const observed = await page.evaluate(() => window.videoObservation());
    const ended = observed.events.filter(event => event.action === 'ended').length - previousEnded;
    expect(elapsed).toBeGreaterThan(finish ? 4750 : 4500); expect(elapsed).toBeLessThan(finish ? 8000 : 6000);
    if (finish) expect(ended).toBeGreaterThanOrEqual(3); else expect(ended).toBe(0);
    await info.attach('cadence', { body: JSON.stringify({ finish, elapsed, ended, before, observed }), contentType: 'application/json' });
    await expect(hold(page)).toHaveCount(0, { timeout: 7000 }); await shot(page, info, 'cadence-next');
    await release(page, fixture);
  });
}

test('production late video readiness cannot replace the latest preview', async ({ page }, info) => {
  const fixture = await setup(page, effects[0]); await fixture.open(); await fixture.audioReady();
  fixture.state.media.set('mp4-b', { ...videoMedia('mp4-b'), delayMs: 1200 });
  fixture.preview({ mode: 'media', mediaId: 'mp4-b', mediaType: 'animated', opacity: 1 });
  await page.waitForTimeout(100);
  fixture.preview({ mode: 'media', mediaId: 'mp4-a', mediaType: 'animated', opacity: 1 });
  await moving(page, info, 'latest-after-delay', 'mp4-a');
  await expect(currentVideo(page, 'mp4-b')).toHaveCount(0);
  await release(page, fixture);
});

test('production corrupt video fails without pinning a retired frame or leaking a decoder', async ({ page }, info) => {
  const fixture = await setup(page, effects[1]); await fixture.open(); await fixture.audioReady();
  fixture.state.media.set('mp4-b', { body: Buffer.from('not a video'), contentType: 'video/mp4' });
  fixture.preview({ mode: 'media', mediaId: 'mp4-b', mediaType: 'animated', opacity: 1 });
  await expect.poll(() => fixture.state.mediaRequests.some(request => request.id === 'mp4-b')).toBe(true);
  await expect(page.locator('[data-audio-trigger-background]')).toBeVisible();
  await expect(currentVideo(page, 'mp4-b')).toHaveCount(0, { timeout: 5000 });
  await expect(hold(page)).toHaveCount(0, { timeout: 5000 });
  await shot(page, info, 'decode-failure-fallback'); await release(page, fixture);
});
