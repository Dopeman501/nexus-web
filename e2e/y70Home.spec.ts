import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { backgroundPoint, homeSeed, nativeTap, Y70HomeHost } from './y70HomeFixture';

test.use({ hasTouch: true });
const hosts = new WeakMap<Page, Y70HomeHost>();
const homeButton = (page: Page) => page.getByRole('button', { name: 'Set current page as Home', exact: true });
const activePage = (page: Page, id: string) => page.locator(id === 'blank-page'
  ? '[data-panel-page-index="3"]' : `[data-panel-page-id="${id}"]`);
async function attach(page: Page, host = new Y70HomeHost()) {
  hosts.set(page, host); await host.attach(page); return host;
}
async function assertActive(page: Page, id: string) {
  await expect(activePage(page, id)).toHaveAttribute('aria-hidden', 'false');
}
async function away(page: Page, host: Y70HomeHost) {
  host.navigate('away'); await assertActive(page, 'away');
  await expect.poll(async () => Math.abs((await activePage(page, 'away').boundingBox())!.x)).toBeLessThanOrEqual(1);
}
async function evidence(page: Page, info: TestInfo, host: Y70HomeHost) {
  const rendered = await Promise.all(page.frames().map(async frame => ({ url: frame.url(),
    pages: await frame.locator('[data-panel-page-id]').evaluateAll(elements => elements.map(element => ({
      id: element.getAttribute('data-panel-page-id'), hidden: element.getAttribute('aria-hidden'),
    }))).catch(() => []),
    startup: await frame.evaluate(() => (window as unknown as { y70HomeObservation?: { frames: string[] } }).y70HomeObservation).catch(() => null),
  })));
  await info.attach('home-production-evidence', { contentType: 'application/json', body: JSON.stringify({
    builds: host.fixtures.map(fixture => ({ assetRoot: fixture.assetRoot, indexSha256: fixture.buildHash })),
    writes: host.state.writes, homeSaveAttempts: host.saveAttempts, finalRecord: host.record,
    recordRequests: host.recordRequests,
    errors: host.state.errors, blocked: host.state.blocked, warnings: host.state.warnings, rendered,
  }, null, 2) });
}
test.afterEach(async ({ page }, info) => {
  const host = hosts.get(page);
  if (host) { await evidence(page, info, host); await host.check(); }
});

test('desktop Home control sits beside the upper-right preview and saves the displayed page without reordering', async ({ page }, info) => {
  const host = await attach(page); await host.editor(page);
  const simulator = page.frameLocator('iframe[title="Panel simulator"]');
  await expect(simulator.locator('[data-panel-page-id="away"]')).toHaveAttribute('aria-hidden', 'false');
  const button = await homeButton(page).boundingBox();
  const frame = await page.locator('iframe[title="Panel simulator"]').boundingBox();
  await info.attach('home-control-geometry', { contentType: 'application/json', body: JSON.stringify({ button, frame }) });
  expect(button).not.toBeNull(); expect(frame).not.toBeNull();
  expect(button!.x).toBeGreaterThanOrEqual(frame!.x + frame!.width + 4);
  expect(button!.y).toBeLessThan(frame!.y + frame!.height * 0.25);
  expect(button!.width).toBeGreaterThanOrEqual(44); expect(button!.height).toBeGreaterThanOrEqual(44);
  const before = structuredClone(host.record.layout!);
  await expect(homeButton(page)).toHaveAttribute('aria-pressed', 'false');
  host.delayNextHomeSaveMs = 350;
  await homeButton(page).click();
  await expect(homeButton(page)).toBeDisabled();
  await expect.poll(() => host.record.layout?.homePageId).toBe('away');
  await expect(homeButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(homeButton(page)).toBeEnabled();
  expect(host.record.layout?.pages).toEqual(before.pages);
  expect(host.record.layout?.activePageId).toBe('away');
  expect(host.saveAttempts).toHaveLength(1);
  await page.screenshot({ path: info.outputPath('desktop-home-control.png') });
  host.navigate('first');
  await expect(simulator.locator('[data-panel-page-id="first"]')).toHaveAttribute('aria-hidden', 'false');
  await expect(homeButton(page)).toHaveAttribute('aria-pressed', 'false');
  expect(host.record.layout?.homePageId).toBe('away');
  await page.reload();
  await expect(homeButton(page)).toBeVisible();
  await expect(simulator.locator('[data-panel-page-id="first"]')).toHaveAttribute('aria-hidden', 'false');
  expect(host.record.layout?.homePageId).toBe('away');
});

for (const variant of ['compact', 'landscape'] as const) {
  test(`${variant} editor keeps the Home target visible outside the preview`, async ({ page }, info) => {
    if (variant === 'compact') await page.setViewportSize({ width: 1024, height: 760 });
    const record = homeSeed();
    if (variant === 'landscape') record.capabilities = { ...record.capabilities, cssWidth: 3840, cssHeight: 1100 };
    const host = await attach(page, new Y70HomeHost(record)); await host.editor(page);
    const button = await homeButton(page).boundingBox();
    const frame = await page.locator('iframe[title="Panel simulator"]').boundingBox();
    await info.attach('home-control-geometry', { contentType: 'application/json', body: JSON.stringify({ button, frame }) });
    expect(button).not.toBeNull(); expect(frame).not.toBeNull();
    const overlapWidth = Math.min(button!.x + button!.width, frame!.x + frame!.width) - Math.max(button!.x, frame!.x);
    const overlapHeight = Math.min(button!.y + button!.height, frame!.y + frame!.height) - Math.max(button!.y, frame!.y);
    expect(overlapWidth <= 0 || overlapHeight <= 0).toBe(true);
    const hit = await homeButton(page).evaluate(element => {
      const box = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    });
    expect(hit).toBe(true);
    await homeButton(page).click();
    await expect.poll(() => host.record.layout?.homePageId).toBe('away');
    await page.screenshot({ path: info.outputPath(`${variant}-home-control.png`) });
  });
}

test('render-only blank page cannot become Home and failed saves restore the previous Home', async ({ page }, info) => {
  const host = await attach(page); await host.editor(page);
  const before = structuredClone(host.record.layout!);
  host.failNextHomeSave = true;
  await homeButton(page).click();
  await expect(page.getByText('Change not saved', { exact: true })).toBeVisible();
  await expect(homeButton(page)).toBeEnabled();
  await expect(homeButton(page)).toHaveAttribute('aria-pressed', 'false');
  expect(host.record.layout).toEqual(before);
  expect(host.saveAttempts).toHaveLength(1);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  const simulator = page.frameLocator('iframe[title="Panel simulator"]');
  await expect(simulator.locator('[data-panel-page-index="3"]')).toHaveAttribute('aria-hidden', 'false');
  await expect(homeButton(page)).toBeDisabled();
  expect(host.record.layout?.pages).toEqual(before.pages);
  expect(host.record.layout?.homePageId).toBe('home');
  expect(host.saveAttempts).toHaveLength(1);
  await page.screenshot({ path: info.outputPath('blank-page-home-disabled.png') });
});

test('a delayed Home save cannot overwrite a later navigation', async ({ page }) => {
  const host = await attach(page); await host.editor(page);
  const contents = structuredClone(host.record.layout!.pages);
  host.delayNextHomeSaveMs = 600;
  await homeButton(page).click();
  await expect(homeButton(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Previous page', exact: true }).click();
  await expect(page.frameLocator('iframe[title="Panel simulator"]').locator('[data-panel-page-id="home"]')).toHaveAttribute('aria-hidden', 'false');
  await expect.poll(() => host.record.layout?.activePageId).toBe('home');
  await expect.poll(() => host.record.layout?.homePageId).toBe('away');
  await expect(homeButton(page)).toBeEnabled();
  await expect(homeButton(page)).toHaveAttribute('aria-pressed', 'false');
  expect(host.record.layout?.pages).toEqual(contents);
});

test('kiosk starts on saved Home, reload returns Home, and external selection remains attached to its page', async ({ page }, info) => {
  const host = await attach(page); const before = structuredClone(host.record.layout!.pages);
  await host.kiosk(page);
  const initialFrames = await page.evaluate(() => (window as unknown as { y70HomeObservation: { frames: string[] } }).y70HomeObservation.frames);
  expect(initialFrames.length).toBeGreaterThan(0);
  expect(initialFrames.every(id => id === 'home')).toBe(true);
  await expect.poll(() => host.record.layout?.activePageId).toBe('home');
  await away(page, host);
  expect(host.record.layout?.homePageId).toBe('home');
  await page.reload();
  await assertActive(page, 'home');
  await expect.poll(() => host.record.layout?.activePageId).toBe('home');
  expect(host.record.layout?.pages).toEqual(before);
  await page.screenshot({ path: info.outputPath('kiosk-home-after-reload.png') });
});

test('a mouse double click on real empty grid returns Home once and preserves page contents', async ({ page }) => {
  const host = await attach(page); await host.kiosk(page); await away(page, host);
  const contents = structuredClone(host.record.layout!.pages);
  const point = await backgroundPoint(page, 'away');
  const beforeWrites = host.state.writes.length;
  await page.mouse.dblclick(point.x, point.y, { delay: 75 });
  await assertActive(page, 'home');
  await expect.poll(() => host.record.layout?.activePageId).toBe('home');
  expect(host.record.layout?.pages).toEqual(contents);
  const changes = host.state.writes.slice(beforeWrites).filter(patch => patch.layout?.activePageId === 'home');
  expect(changes).toHaveLength(1);
});

test('two native touchscreen taps return Home while widget and control taps retain the current page', async ({ page }, info) => {
  const host = await attach(page); await host.kiosk(page); await away(page, host);
  await nativeTap(page, await backgroundPoint(page, 'away'), 2);
  await assertActive(page, 'home');
  await expect.poll(() => host.record.layout?.activePageId).toBe('home');
  await away(page, host);
  const widget = await page.locator('[data-panel-page-id="away"] [data-panel-widget-id]').first().boundingBox();
  expect(widget).not.toBeNull();
  await nativeTap(page, { x: widget!.x + widget!.width / 2, y: widget!.y + widget!.height / 2 }, 2);
  await assertActive(page, 'away');
  expect(host.record.layout?.activePageId).toBe('away');
  // A fresh kiosk removes the widget's legitimate immersive response before
  // testing an unrelated tray control. Both interactions must remain usable.
  await host.kiosk(page); await away(page, host);
  const point = await backgroundPoint(page, 'away');
  await page.mouse.click(point.x, point.y, { button: 'right' });
  const control = page.getByRole('button', { name: 'Add widget', exact: true });
  await expect(control).toBeVisible();
  await control.click({ trial: true });
  const box = await control.boundingBox(); expect(box).not.toBeNull();
  await nativeTap(page, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }, 2);
  await expect(page.getByRole('dialog')).toBeVisible();
  await assertActive(page, 'away');
  expect(host.record.layout?.activePageId).toBe('away');
  await page.screenshot({ path: info.outputPath('native-control-retains-current-page.png') });
});

test('native swipes retain ordinary page navigation and a moved return gesture is not a double tap', async ({ page }) => {
  const host = await attach(page); await host.kiosk(page); await away(page, host);
  const client = await page.context().newCDPSession(page);
  try {
    const start = await backgroundPoint(page, 'away');
    await nativeTap(page, start);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
    for (let step = 1; step <= 8; step++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x - step * 28, y: start.y, id: 1 }] });
      await page.waitForTimeout(12);
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await assertActive(page, 'blank-page');
    await expect.poll(() => host.record.layout?.activePageId).toBe('blank-page');
    expect(host.record.layout?.homePageId).toBe('home');
    await page.waitForTimeout(280);
    const blankId = await activePage(page, 'blank-page').getAttribute('data-panel-page-id');
    const empty = await backgroundPoint(page, blankId!);
    await nativeTap(page, empty, 2);
    await assertActive(page, 'home');
  } finally { await client.detach(); }
});
