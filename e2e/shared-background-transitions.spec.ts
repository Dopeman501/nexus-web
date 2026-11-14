import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { kick, quiet, sound } from './backgroundTransitionsFixture';
import {
  openSharedBackground, openSharedPicker, SharedTransitionHost, sharedSeed, sharedEffects,
  type SharedTransitionEvent,
} from './sharedBackgroundTransitionsFixture';
import { stillItem, videoItem, videoMedia } from './backgroundVideoFixtures';
import { observeVideos } from './backgroundVideoObservation';
import { difference, pixels } from './backgroundTransitionPixels';

const active = (page: Page) => page.locator('[data-background-transition-preview]');
const gpu = (page: Page) => page.locator('canvas[data-picture-transition-renderer]');
const contexts = new WeakMap<Page, SharedTransitionHost>();
const createdPages = new WeakMap<Page, Page[]>();
async function setup(page: Page, host = new SharedTransitionHost()) {
  const fixture = await host.attach(page); contexts.set(page, host); return { fixture, host };
}
async function devicePage(ui: Page, host: SharedTransitionHost) {
  const page = await ui.context().newPage();
  await page.setViewportSize({ width: 1200, height: 540 });
  const fixture = await host.attach(page);
  createdPages.set(ui, [...(createdPages.get(ui) ?? []), page]);
  await fixture.open();
  await expect.poll(() => [...fixture.sockets].some(socket => socket.topics.has('panel/transition-preview'))).toBe(true);
  return { page, fixture };
}
const events = (page: Page) => page.evaluate(() => window.sharedTransitionEvents().filter(event => event.channel !== 'preview'));
const tile = (page: Page, key: string) => page.getByRole('dialog', { name: 'Transitions', exact: true }).locator(`[data-transition-key="${key}"]`);
async function untilFinished(page: Page) {
  await expect(page.locator('[data-slideshow-picture-transition], [data-background-picture-hold]')).toHaveCount(0, { timeout: 7000 });
}
function addVideos(host: SharedTransitionHost) {
  for (const id of ['mp4-a', 'mp4-b', 'webm']) host.state.media.set(id, videoMedia(id));
}
async function attachObservation(page: Page, info: TestInfo, host: SharedTransitionHost) {
  await info.attach('shared-host-evidence', { contentType: 'application/json', body: JSON.stringify({
    builds: host.fixtures.map(fixture => ({ index: fixture.buildHash, assetRoot: fixture.assetRoot, target: fixture.target })),
    writes: host.state.writes, previewRequests: host.previewRequests, previewFrames: host.previewFrames,
    errors: host.state.errors, blocked: host.state.blocked, warnings: host.state.warnings,
    events: await page.evaluate(() => window.sharedTransitionEvents?.() ?? []).catch(() => []),
  }, null, 2) });
}
test.afterEach(async ({ page }, info) => {
  const host = contexts.get(page);
  if (host) { await attachObservation(page, info, host); await host.check(); }
  for (const extra of createdPages.get(page) ?? []) await extra.close();
});

test('shared transition settings use one toggle and a real still-image gallery with one internal duration control', async ({ page }, info) => {
  const { host } = await setup(page); await openSharedBackground(page);
  await expect(page.getByRole('switch', { name: 'Transitions', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Transitions', exact: true })).toHaveCount(1);
  await expect(page.getByText('Transitions apply to Slideshows and Audio Trigger', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Audio Trigger transition', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Slideshow transition', exact: true })).toHaveCount(0);
  await expect(page.getByRole('slider', { name: 'Transition duration', exact: true })).toHaveCount(0);
  const picker = await openSharedPicker(page);
  await expect(picker.locator('[data-transition-key]')).toHaveCount(226);
  await expect(picker.getByRole('slider', { name: 'Transition duration', exact: true })).toHaveCount(1);
  await expect(picker.getByRole('option')).toHaveCount(0);
  // Gallery tiles load lazily. Decode their actual asset URLs independently so
  // all 226 thumbnails are verified without changing the product's loading policy.
  const images = await picker.locator('[data-transition-key] img').evaluateAll(async elements => Promise.all(elements.map(async element => {
    const image = new Image(); image.src = (element as HTMLImageElement).src; await image.decode();
    return { url: image.src, width: image.naturalWidth, height: image.naturalHeight };
  })));
  expect(images).toHaveLength(226); expect(new Set(images.map(image => image.url)).size).toBe(226);
  expect(images.every(image => image.width === 240 && image.height === 135)).toBe(true);
  await page.screenshot({ path: info.outputPath('desktop-shared-transition-gallery.png') });
  const before = host.state.writes.length;
  await picker.getByRole('button', { name: 'Done', exact: true }).click();
  expect(host.state.writes.length).toBe(before);
});

test('ordered multi-selection, accent highlight and shared duration persist without changing either background mode', async ({ page }, info) => {
  const host = new SharedTransitionHost(sharedSeed({ enabled: false, effects: [], durationMs: 900 }));
  await setup(page, host); const before = JSON.stringify({ ...host.record, backgroundTransitions: undefined });
  await openSharedBackground(page); await openSharedPicker(page);
  await tile(page, sharedEffects[0]).click(); await tile(page, sharedEffects[1]).click();
  await expect(tile(page, sharedEffects[0])).toHaveAttribute('aria-pressed', 'true');
  await expect(tile(page, sharedEffects[1])).toHaveAttribute('aria-pressed', 'true');
  await tile(page, sharedEffects[0]).click(); await tile(page, sharedEffects[0]).click();
  await expect.poll(() => host.record.backgroundTransitions?.effects).toEqual([sharedEffects[1], sharedEffects[0]]);
  await expect(tile(page, sharedEffects[1])).toHaveAttribute('data-selection-order', '1');
  await expect(tile(page, sharedEffects[0])).toHaveAttribute('data-selection-order', '2');
  const ring = await tile(page, sharedEffects[0]).evaluate(element => {
    const style = getComputedStyle(element); const marker = document.createElement('span');
    marker.style.color = 'var(--accent)'; element.append(marker); const accent = getComputedStyle(marker).color; marker.remove();
    return { accent, border: style.borderColor, shadow: style.boxShadow };
  });
  expect(ring.border === ring.accent || ring.shadow.includes(ring.accent)).toBe(true);
  const picker = page.getByRole('dialog', { name: 'Transitions', exact: true });
  await picker.getByRole('button', { name: 'Transition duration', exact: true }).click();
  await picker.getByRole('spinbutton').fill('1750'); await picker.getByRole('spinbutton').press('Enter');
  await expect.poll(() => host.record.backgroundTransitions?.durationMs).toBe(1750);
  await picker.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('switch', { name: 'Transitions', exact: true }).click();
  await expect.poll(() => host.record.backgroundTransitions?.enabled).toBe(true);
  expect(JSON.stringify({ ...host.record, backgroundTransitions: undefined })).toBe(before);
  await openSharedBackground(page); await openSharedPicker(page);
  await expect(tile(page, sharedEffects[1])).toHaveAttribute('data-selection-order', '1');
  await expect(page.getByRole('slider', { name: 'Transition duration', exact: true })).toHaveValue('1750');
  await page.screenshot({ path: info.outputPath('saved-accent-multi-selection.png') });
});

test('a clicked transition previews on the actual simulator iframe and a separate device view while the picker leaves preview visible', async ({ page }, info) => {
  const { host, fixture } = await setup(page, new SharedTransitionHost(sharedSeed({ enabled: false, durationMs: 2400 })));
  await openSharedBackground(page);
  const remote = await devicePage(page, host);
  const iframe = page.locator('iframe[title="Panel simulator"]'); await expect(iframe).toBeVisible();
  const simulator = page.frameLocator('iframe[title="Panel simulator"]');
  await expect(simulator.locator('.panel-root')).toBeVisible();
  await expect.poll(() => [...fixture.sockets].some(socket => socket.topics.has('panel/transition-preview'))).toBe(true);
  const picker = await openSharedPicker(page);
  const frameBox = await iframe.boundingBox(), pickerBox = await picker.locator(':scope > div').first().boundingBox();
  expect(frameBox).not.toBeNull(); expect(pickerBox).not.toBeNull();
  expect(pickerBox!.x + pickerBox!.width).toBeLessThanOrEqual(frameBox!.x + 2);
  const unoccluded = await iframe.evaluate(element => {
    const box = element.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element;
  });
  expect(unoccluded).toBe(true);
  await tile(page, sharedEffects[1]).click();
  await expect(active(remote.page)).toHaveAttribute('data-effect', sharedEffects[1]);
  await expect(simulator.locator('[data-background-transition-preview]')).toHaveAttribute('data-effect', sharedEffects[1]);
  const id = await active(remote.page).getAttribute('data-preview-id');
  await expect(simulator.locator('[data-background-transition-preview]')).toHaveAttribute('data-preview-id', id!);
  await expect(gpu(remote.page)).toHaveCount(1);
  await expect(simulator.locator('canvas[data-picture-transition-renderer]')).toHaveCount(1);
  await page.waitForTimeout(500);
  await remote.page.screenshot({ path: info.outputPath('device-click-preview.png') });
  await page.screenshot({ path: info.outputPath('picker-and-nexus-simulator-preview.png') });
  await picker.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(active(remote.page)).toHaveCount(0); await expect(simulator.locator('[data-background-transition-preview]')).toHaveCount(0);
  expect(host.record.backgroundTransitions?.enabled).toBe(false);
});

test('an actual immersive-on-load clock remains mounted underneath the visible transition audition', async ({ page }, info) => {
  await page.setViewportSize({ width: 1200, height: 540 });
  const record = sharedSeed({ durationMs: 2400 });
  record.capabilities = { ...record.capabilities!, surface: 'monitor', family: 'generic-monitor', touch: true,
    cssWidth: 1200, cssHeight: 540 };
  record.layout = { layoutSchemaVersion: 2, surface: 'monitor', activePageId: 'clock-home',
    pages: [{ id: 'clock-home', widgets: [{ id: 'clock-immersive', type: 'clock', size: '4x4', col: 0, row: 0,
      config: { design: 'digital', showSeconds: false } }] }], immersiveOnLoadWidgetId: 'clock-immersive' };
  const { host } = await setup(page, new SharedTransitionHost(record));
  await page.goto('/panel/transition-fixture');
  const immersive = page.locator('.panel-root[role="dialog"]');
  await expect(immersive).toHaveAttribute('data-state', 'open');
  await expect(immersive).toHaveAttribute('data-entered', 'true');
  await expect(page.getByRole('button', { name: 'Close immersive view', exact: true })).toHaveCount(1);
  const before = await page.screenshot({ path: info.outputPath('actual-clock-immersive-before.png') });
  host.externalPreview(sharedEffects[1], 2400);
  await expect(active(page)).toHaveAttribute('data-effect', sharedEffects[1]);
  await expect(gpu(page)).toHaveCount(1);
  await page.waitForTimeout(350);
  const hit = await active(page).evaluate(element => {
    const node = element as HTMLElement;
    const previous = node.style.pointerEvents;
    // Pointer-events:none intentionally ignores a decorative painted layer.
    // Enable hit-testing only for this measurement; no geometry/paint/z changes.
    node.style.pointerEvents = 'auto';
    const top = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    const foreground = document.querySelector('.panel-root[role="dialog"]')!;
    const result = { previewOwnsCenter: top?.closest('[data-background-transition-preview]') === element,
      previewZ: getComputedStyle(element).zIndex, immersiveZ: getComputedStyle(foreground).zIndex,
      immersiveBackground: getComputedStyle(foreground).backgroundColor, immersiveOpacity: getComputedStyle(foreground).opacity };
    node.style.pointerEvents = previous;
    return result;
  });
  const middle = await page.screenshot({ path: info.outputPath('actual-clock-immersive-audition.png') });
  const delta = difference(pixels(before), pixels(middle));
  await info.attach('real-immersive-layer-order', { contentType: 'application/json', body: JSON.stringify({ ...hit, meanRgbDelta: delta }) });
  expect(hit.previewOwnsCenter).toBe(true);
  expect(delta).toBeGreaterThan(5);
  await expect(immersive).toHaveAttribute('data-state', 'open');
  await expect(active(page)).toHaveCount(0, { timeout: 6000 });
  await expect(immersive).toHaveAttribute('data-state', 'open');
  expect(host.state.writes).toEqual([]);
});

test('latest click wins, close releases both views and stale pushes cannot revive the retired preview', async ({ page }) => {
  const { host } = await setup(page, new SharedTransitionHost(sharedSeed({ enabled: false, durationMs: 3000 })));
  await openSharedBackground(page); const remote = await devicePage(page, host); await openSharedPicker(page);
  host.delayNextPreviewPostMs = 450;
  for (const key of [sharedEffects[0], sharedEffects[1], 'curtains:ripple']) { await tile(page, key).click(); await page.waitForTimeout(40); }
  await expect(active(remote.page)).toHaveAttribute('data-effect', 'curtains:ripple');
  const latest = host.preview!;
  await page.getByRole('dialog', { name: 'Transitions', exact: true }).getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(() => host.preview?.preview).toBeNull();
  await expect(active(remote.page)).toHaveCount(0); await expect(gpu(remote.page)).toHaveCount(0);
  host.rawPush(latest); await page.waitForTimeout(250);
  await expect(active(remote.page)).toHaveCount(0);
  expect(host.previewRequests.filter(request => request.preview).length).toBeLessThanOrEqual(3);
});

test('preview failure is visible and a later click can retry without touching saved media or Audio Trigger', async ({ page }) => {
  const { host } = await setup(page); await openSharedBackground(page); const remote = await devicePage(page, host);
  const before = JSON.stringify({ ...host.record, backgroundTransitions: undefined });
  await openSharedPicker(page); host.failNextPreviewPosts = 1;
  await tile(page, sharedEffects[1]).click();
  await expect(page.getByRole('alert')).toHaveText('Preview unavailable. Try again.');
  await expect(active(remote.page)).toHaveCount(0);
  await tile(page, sharedEffects[1]).click();
  await expect(active(remote.page)).toHaveAttribute('data-effect', sharedEffects[1]);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(JSON.stringify({ ...host.record, backgroundTransitions: undefined })).toBe(before);
});

test('leaving the device editor releases the temporary preview without persisting a look', async ({ page }) => {
  const { host } = await setup(page); await openSharedBackground(page); const remote = await devicePage(page, host);
  const before = JSON.stringify({ ...host.record, backgroundTransitions: undefined });
  await openSharedPicker(page); await tile(page, sharedEffects[1]).click();
  await expect(active(remote.page)).toHaveAttribute('data-effect', sharedEffects[1]);
  await page.goBack();
  await expect(page.getByRole('dialog', { name: 'Transitions', exact: true })).toHaveCount(0);
  await expect.poll(() => host.preview?.preview).toBeNull();
  await expect(active(remote.page)).toHaveCount(0); await expect(gpu(remote.page)).toHaveCount(0);
  expect(JSON.stringify({ ...host.record, backgroundTransitions: undefined })).toBe(before);
});

test('an older GET, duplicated completed command and another-device push never replay a stale preview', async ({ page }) => {
  const host = new SharedTransitionHost(); host.externalPreview(sharedEffects[0], 2200);
  host.delayNextPreviewGetMs = 1000;
  const { fixture } = await setup(page, host); await fixture.open();
  await expect.poll(() => [...fixture.sockets].some(socket => socket.topics.has('panel/transition-preview'))).toBe(true);
  const latest = host.externalPreview(sharedEffects[1], 2000);
  await expect(active(page)).toHaveAttribute('data-preview-id', latest.preview!.previewId);
  await page.waitForTimeout(1100);
  await expect(active(page)).toHaveAttribute('data-preview-id', latest.preview!.previewId);
  host.rawPush({ ...latest, revision: latest.revision + 2, deviceId: 'another-device' });
  await expect(active(page)).toHaveAttribute('data-preview-id', latest.preview!.previewId);
  await expect(active(page)).toHaveCount(0, { timeout: 5000 });
  host.rawPush({ ...latest, revision: latest.revision + 3, sequence: latest.sequence + 1 });
  await page.waitForTimeout(350); await expect(active(page)).toHaveCount(0); await expect(gpu(page)).toHaveCount(0);
  expect(host.state.writes).toEqual([]);
});

test('preview expires on lost ownership and disconnect retires the temporary renderer', async ({ page }) => {
  const { host, fixture } = await setup(page); await fixture.open();
  const frame = host.externalPreview(sharedEffects[0], 5000, 700);
  await expect(active(page)).toHaveAttribute('data-preview-id', frame.preview!.previewId);
  await expect(active(page)).toHaveCount(0, { timeout: 2500 }); await expect(gpu(page)).toHaveCount(0);
  host.externalPreview(sharedEffects[1], 5000);
  await expect(active(page)).toHaveAttribute('data-effect', sharedEffects[1]);
  fixture.disconnect();
  await expect(active(page)).toHaveCount(0); await expect(gpu(page)).toHaveCount(0);
  expect(host.state.writes).toEqual([]);
});

test('one ordered cycle survives Slideshow→Audio MP4/WebM→normal and duration-only hydration', async ({ page }, info) => {
  const chosen = [...sharedEffects, 'curtains:ripple'];
  const record = sharedSeed({ effects: chosen, durationMs: 1100 }); record.backgroundMediaSlideshow = true;
  record.backgroundMediaOrder = ['normal', 'mp4-a', 'next'];
  record.backgroundAudioTrigger = { ...record.backgroundAudioTrigger!, backgrounds: [
    { mode: 'media', mediaId: 'mp4-b', mediaType: 'animated', opacity: 1 },
    { mode: 'media', mediaId: 'webm', mediaType: 'animated', opacity: 1 },
  ] };
  const host = new SharedTransitionHost(record); addVideos(host);
  host.state.library = [stillItem('normal'), videoItem('mp4-a', 1), stillItem('next', 2)];
  await observeVideos(page); const { fixture } = await setup(page, host); await fixture.open(); await fixture.audioReady();
  const audition = host.externalPreview('curtains:ripple', 450);
  await expect(active(page)).toHaveAttribute('data-preview-id', audition.preview!.previewId);
  await expect(active(page)).toHaveCount(0, { timeout: 5000 });
  expect(await events(page)).toEqual([]); // Manual audition does not consume the saved cycle.
  await expect.poll(() => events(page), { timeout: 10_000 }).toEqual([{ effect: chosen[0], channel: 'slideshow', at: expect.any(Number) }]);
  await untilFinished(page);
  host.record = { ...host.record, backgroundTransitions: { ...host.record.backgroundTransitions!, durationMs: 900 } }; host.changed();
  await fixture.sustain(sound, 550); const pumping = setInterval(() => fixture.sound(sound), 50);
  try {
    await expect.poll(async () => (await events(page)).map(event => event.effect)).toEqual(chosen.slice(0, 2));
    await untilFinished(page); await fixture.sustain(kick, 100);
    await expect.poll(async () => (await events(page)).map(event => event.effect)).toEqual(chosen);
    await untilFinished(page);
  } finally { clearInterval(pumping); }
  await fixture.sustain(quiet, 550);
  await expect.poll(async () => (await events(page)).map(event => event.effect)).toEqual([...chosen, chosen[0]]);
  await untilFinished(page);
  const sequence: SharedTransitionEvent[] = await events(page);
  expect(sequence.map(event => event.channel)).toEqual(['slideshow', 'audio', 'audio', 'audio']);
  const media = await page.evaluate(() => window.videoObservation()); expect(media.peakSources).toBeLessThanOrEqual(1);
  await info.attach('shared-cycle-and-video-ownership', { contentType: 'application/json', body: JSON.stringify({ sequence, media }) });
  expect(host.state.writes).toEqual([]);
});

test('shared Off cuts both Slideshow and Audio while keeping compatible videos playing', async ({ page }) => {
  const record = sharedSeed({ enabled: false }); record.backgroundMediaSlideshow = true;
  record.backgroundMediaOrder = ['normal', 'mp4-a'];
  record.backgroundAudioTrigger = { ...record.backgroundAudioTrigger!, backgrounds: [{ mode: 'media', mediaId: 'webm', mediaType: 'animated', opacity: 1 }] };
  const host = new SharedTransitionHost(record); addVideos(host); host.state.library = [stillItem('normal'), videoItem('mp4-a', 1)];
  await observeVideos(page); const { fixture } = await setup(page, host); await fixture.open(); await fixture.audioReady();
  const video = page.locator('video[src*="/mp4-a/file"]'); await expect(video).toBeVisible({ timeout: 9000 });
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0.1);
  await expect(gpu(page)).toHaveCount(0); expect(await events(page)).toEqual([]);
  await fixture.sustain(sound, 550); const pumping = setInterval(() => fixture.sound(sound), 50);
  try {
    const audio = page.locator('[data-audio-trigger-background] video[src*="/webm/file"]'); await expect(audio).toBeVisible();
    await expect.poll(() => audio.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0.1);
    await expect(gpu(page)).toHaveCount(0); expect(await events(page)).toEqual([]);
  } finally { clearInterval(pumping); }
  expect((await page.evaluate(() => window.videoObservation())).peakSources).toBeLessThanOrEqual(1);
  expect(host.state.writes).toEqual([]);
});

test('compact picker keeps the duration and Done controls reachable while scrolling the full catalogue', async ({ page }, info) => {
  await setup(page); await openSharedBackground(page);
  await page.setViewportSize({ width: 540, height: 960 });
  const picker = await openSharedPicker(page);
  await expect(picker.getByRole('slider', { name: 'Transition duration', exact: true })).toBeVisible();
  const last = picker.locator('[data-transition-key]').last(); await last.scrollIntoViewIfNeeded();
  await expect(picker.getByRole('slider', { name: 'Transition duration', exact: true })).toBeVisible();
  await expect(picker.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  const box = await picker.locator(':scope > div').first().boundingBox(); expect(box!.width).toBeLessThanOrEqual(540);
  await page.screenshot({ path: info.outputPath('compact-scrolled-gallery.png') });
});
