import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { homeFixtureId } from './y70HomeFixture';
import {
  cornerHandle, editorActive, grab, idle, moveIds, orderOf, PageReorderHost, preview, reorderRoot,
} from './y70PageReorderFixture';

const hosts = new WeakMap<Page, PageReorderHost>();
const extras = new WeakMap<Page, Page[]>();
async function setup(page: Page, count = 7, selected = 3) {
  const host = new PageReorderHost(count, selected); hosts.set(page, host);
  await host.attach(page); await host.editor(page); await editorActive(page, `page-${selected}`);
  await expect(cornerHandle(page, 'left')).toBeVisible();
  await expect(cornerHandle(page, 'right')).toBeVisible();
  return host;
}
async function assertPreserved(host: PageReorderHost, before: NonNullable<PageReorderHost['record']['layout']>) {
  const after = host.record.layout!;
  expect(after.activePageId).toBe(before.activePageId); expect(after.homePageId).toBe(before.homePageId);
  expect([...after.pages].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...before.pages].sort((a, b) => a.id.localeCompare(b.id)));
}
async function attachEvidence(page: Page, info: TestInfo, host: PageReorderHost) {
  await info.attach('reorder-production-evidence', { contentType: 'application/json', body: JSON.stringify({
    builds: host.fixtures.map(fixture => ({ assetRoot: fixture.assetRoot, indexSha256: fixture.buildHash })),
    attempts: host.reorderAttempts, writes: host.state.writes, finalRecord: host.record,
    errors: host.state.errors, blocked: host.state.blocked, warnings: host.state.warnings,
  }, null, 2) });
}
test.afterEach(async ({ page }, info) => {
  const host = hosts.get(page);
  if (host) { await attachEvidence(page, info, host); await host.check(); }
  for (const extra of extras.get(page) ?? []) await extra.close();
});

for (const corner of ['left', 'right'] as const) {
  test(`${corner} mouse corner stays attached through opening and commits the whole page once`, async ({ page }, info) => {
    const host = await setup(page), before = structuredClone(host.record.layout!);
    const iframe = await page.locator('iframe[title="Panel simulator"]').elementHandle();
    const { point, frame } = await grab(page, corner);
    const offset = { x: point.x - frame.x, y: point.y - frame.y };
    const sign = corner === 'left' ? -1 : 1;
    const samples = [];
    for (const [wait, dx, dy] of [[0, 10, 3], [100, 40, 10], [200, 110, 22]]) {
      if (wait) await page.waitForTimeout(wait);
      const target = { x: point.x + dx * sign, y: point.y + dy };
      await page.mouse.move(target.x, target.y);
      const now = await preview(page).boundingBox(); expect(now).not.toBeNull();
      const error = { x: now!.x + offset.x - target.x, y: now!.y + offset.y - target.y };
      expect(Math.abs(error.x)).toBeLessThanOrEqual(1.5); expect(Math.abs(error.y)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(now!.width - frame.width)).toBeLessThanOrEqual(1);
      samples.push({ wait, target, frame: now, error });
    }
    await info.attach('pointer-attachment-samples', { contentType: 'application/json', body: JSON.stringify(samples, null, 2) });
    await expect(page.locator('iframe[title="Panel simulator"]')).toHaveCount(1);
    expect(await page.evaluate(node => node === document.querySelector('iframe[title="Panel simulator"]'), iframe)).toBe(true);
    // A second contact must not enter the iframe's separate document while
    // the parent owns a captured page grab.
    const iframeCanReceiveContact = await preview(page).evaluate(element => {
      const box = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    });
    expect(iframeCanReceiveContact).toBe(false);
    await page.screenshot({ path: info.outputPath(`${corner}-mouse-held-stack.png`) });
    await page.mouse.up(); await idle(page);
    const to = corner === 'left' ? 2 : 4;
    expect(orderOf(host)).toEqual(moveIds(before.pages.map(value => value.id), 'page-3', to));
    expect(host.reorderAttempts).toHaveLength(1); await assertPreserved(host, before); await editorActive(page, 'page-3');
  });

  test(`${corner} native touch corner uses one continuous captured grab and an early drop`, async ({ page }, info) => {
    const host = await setup(page), before = structuredClone(host.record.layout!);
    const handle = cornerHandle(page, corner); await handle.click({ trial: true });
    const box = await handle.boundingBox(), frame = await preview(page).boundingBox();
    expect(box).not.toBeNull(); expect(frame).not.toBeNull();
    const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
    const sign = corner === 'left' ? -1 : 1;
    const client = await page.context().newCDPSession(page);
    try {
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 7 }] });
      await expect(reorderRoot(page)).toHaveAttribute('data-page-reorder-phase', 'grabbed');
      for (let step = 1; step <= 5; step++) {
        const target = { x: start.x + frame!.width * 0.65 * sign * step / 5, y: start.y + step * 2 };
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...target, id: 7 }] });
        const now = await preview(page).boundingBox();
        expect(Math.abs(now!.x + start.x - frame!.x - target.x)).toBeLessThanOrEqual(1.5);
        await page.waitForTimeout(12);
      }
      await page.screenshot({ path: info.outputPath(`${corner}-native-touch-held.png`) });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await idle(page);
      expect(orderOf(host)).toEqual(moveIds(before.pages.map(value => value.id), 'page-3', corner === 'left' ? 2 : 4));
      expect(host.reorderAttempts).toHaveLength(1); await assertPreserved(host, before);
    } finally { await client.detach(); }
  });
}

test('seven real pages show six inert frosted neighbours with correct scales, proportions and real collection ends', async ({ page }, info) => {
  const host = await setup(page); const original = orderOf(host);
  for (const selected of [3, 0, 6]) {
    if (selected !== 3) { host.navigate(`page-${selected}`); await editorActive(page, `page-${selected}`); }
    await grab(page); await page.waitForTimeout(340);
    const cards = page.locator('[data-reorder-glass]'); await expect(cards).toHaveCount(selected === 3 ? 6 : 3);
    await expect(cards.locator('iframe, canvas, video, [data-panel-widget-id]')).toHaveCount(0);
    const frame = await preview(page).boundingBox();
    const shapes = await cards.evaluateAll(elements => elements.map(element => {
      const matrix = new DOMMatrix(getComputedStyle(element).transform), box = element.getBoundingClientRect();
      return { id: element.getAttribute('data-reorder-glass'), depth: Number(element.getAttribute('data-depth')),
        scale: Math.hypot(matrix.a, matrix.b), ratio: box.width / box.height };
    }));
    for (const shape of shapes) {
      expect(original).toContain(shape.id);
      expect(shape.scale).toBeCloseTo([0.8, 0.65, 0.52][shape.depth - 1], 1);
      expect(shape.ratio).toBeCloseTo(frame!.width / frame!.height, 2);
    }
    await info.attach(`stack-${selected}-geometry`, { contentType: 'application/json', body: JSON.stringify(shapes, null, 2) });
    await page.screenshot({ path: info.outputPath(`seven-page-stack-selected-${selected}.png`) });
    await page.keyboard.press('Escape'); await page.mouse.up(); await idle(page);
  }
  expect(orderOf(host)).toEqual(original); expect(host.reorderAttempts).toHaveLength(0);
});

test('compact editor scales the held glass stack while keeping the actual preview and corner visible', async ({ page }, info) => {
  await page.setViewportSize({ width: 1024, height: 760 });
  const host = await setup(page); const { point, frame } = await grab(page, 'right');
  await page.mouse.move(point.x - 25, point.y + 5); await page.waitForTimeout(340);
  const now = await preview(page).boundingBox();
  expect(now!.x).toBeCloseTo(frame.x - 25, 0); expect(now!.y).toBeCloseTo(frame.y + 5, 0);
  await expect(page.locator('[data-reorder-glass]')).toHaveCount(6);
  await page.screenshot({ path: info.outputPath('compact-seven-page-glass-stack.png') });
  await page.keyboard.press('Escape'); await page.mouse.up(); await idle(page);
  expect(host.reorderAttempts).toHaveLength(0);
});

for (const reason of ['click', 'escape', 'pointercancel', 'blur', 'outside', 'unchanged', 'resize'] as const) {
  test(`${reason} leaves the complete order unchanged without a reorder POST`, async ({ page }) => {
    const host = await setup(page), before = structuredClone(host.record.layout!);
    const { point, frame, handle } = await grab(page);
    if (reason !== 'click') await page.mouse.move(point.x - frame.width * 0.65, point.y + 8);
    if (reason === 'escape') await page.keyboard.press('Escape');
    if (reason === 'pointercancel') await handle.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', isPrimary: true });
    if (reason === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    if (reason === 'resize') await page.setViewportSize({ width: 1430, height: 890 });
    if (reason === 'unchanged') await page.mouse.move(point.x, point.y);
    if (reason === 'outside') await page.mouse.move(20, 20);
    await page.mouse.up(); await idle(page);
    expect(orderOf(host)).toEqual(before.pages.map(value => value.id)); expect(host.reorderAttempts).toHaveLength(0);
    await assertPreserved(host, before);
  });
}

test('one held page reaches both ends of a ten-page order through controlled edge dwell', async ({ page }, info) => {
  const host = await setup(page, 10, 0), before = structuredClone(host.record.layout!), original = orderOf(host);
  for (const to of [9, 0]) {
    const { point } = await grab(page, to === 9 ? 'right' : 'left');
    const area = await page.locator('[data-panel-editor-layout]').boundingBox(); expect(area).not.toBeNull();
    const edge = { x: to === 9 ? area!.x + area!.width - 10 : area!.x + 10, y: point.y + 10 };
    await page.mouse.move(edge.x, edge.y);
    await expect(page.locator(`[data-reorder-insertion="${to}"]`)).toHaveCount(1, { timeout: 6500 });
    await page.screenshot({ path: info.outputPath(`ten-page-destination-${to}.png`) });
    await page.mouse.up(); await idle(page);
    expect(orderOf(host).indexOf('page-0')).toBe(to); await assertPreserved(host, before);
  }
  expect(orderOf(host)).toEqual(original); expect(host.reorderAttempts).toHaveLength(2);
});

test('keyboard pickup, arrow drop and Escape work with reduced motion and visible focus', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const host = await setup(page), original = orderOf(host);
  await cornerHandle(page, 'left').focus(); await page.keyboard.press('Space');
  await expect(reorderRoot(page)).toHaveAttribute('data-page-reorder-phase', 'grabbed');
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Space');
  await idle(page); expect(orderOf(host)).toEqual(moveIds(original, 'page-3', 1));
  expect(await page.locator('[data-reorder-live]').evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
  await cornerHandle(page, 'right').focus(); await page.keyboard.press('Enter'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Escape');
  await idle(page); expect(host.reorderAttempts).toHaveLength(1);
  const outline = await cornerHandle(page, 'right').evaluate(element => getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe('none');
});

test('a rejected reorder restores a consistent selected page and complete original contents', async ({ page }, info) => {
  const host = await setup(page), before = structuredClone(host.record.layout!);
  host.failNextReorder = true; host.delayNextReorderMs = 250;
  const { point, frame } = await grab(page); await page.mouse.move(point.x - frame.width * 0.65, point.y + 10); await page.mouse.up();
  await expect(reorderRoot(page)).toHaveAttribute('data-page-reorder-phase', 'saving'); await idle(page);
  expect(orderOf(host)).toEqual(before.pages.map(value => value.id)); await assertPreserved(host, before);
  await editorActive(page, 'page-3'); expect(host.reorderAttempts).toHaveLength(1);
  await expect(page.getByText('Change not saved', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('reorder-save-failure-restored.png') });
});

test('saved order persists on reload and governs kiosk navigation while page identity and ordinary widget editing remain intact', async ({ page }) => {
  const host = await setup(page), before = structuredClone(host.record.layout!), original = orderOf(host);
  const kiosk = await page.context().newPage(); extras.set(page, [kiosk]); await host.attach(kiosk);
  await kiosk.setViewportSize({ width: 1100, height: 3840 }); await kiosk.goto(`/panel/${homeFixtureId}`);
  await expect(kiosk.locator('[data-panel-page-id="page-3"]')).toHaveAttribute('aria-hidden', 'false');
  await expect.poll(() => [...host.fixtures.at(-1)!.sockets].some(socket => socket.topics.has('panel/device'))).toBe(true);
  await page.bringToFront();
  const { point, frame } = await grab(page); await page.mouse.move(point.x - frame.width * 0.65, point.y + 10); await page.mouse.up(); await idle(page);
  expect(orderOf(host)).toEqual(moveIds(original, 'page-3', 2)); await assertPreserved(host, before);
  // Deliver the service's real layout-change topic to the already-running
  // kiosk; its unchanged active ID must follow the reordered identity.
  host.bus.send('panel/device', { deviceId: homeFixtureId });
  await expect.poll(() => kiosk.locator('[data-panel-page-id]').evaluateAll(elements => elements.slice(0, 7).map(element => element.getAttribute('data-panel-page-id'))))
    .toEqual(moveIds(original, 'page-3', 2));
  await expect(kiosk.locator('[data-panel-page-id="page-3"]')).toHaveAttribute('aria-hidden', 'false');
  await page.reload(); await editorActive(page, 'page-3');
  const simulator = page.frameLocator('iframe[title="Panel simulator"]');
  await simulator.locator('[data-panel-page-id="page-3"] [data-panel-widget-id="clock-3"]').click();
  await expect(simulator.locator('.panel-root')).toHaveAttribute('data-simulator-selected', 'clock-3');
  await expect(page.locator('iframe[title="Panel simulator"]')).toHaveCount(1);
  await editorActive(page, 'page-3');
  const client = await kiosk.context().newCDPSession(kiosk);
  try {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 420, y: 1000, id: 1 }] });
    for (let step = 1; step <= 8; step++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 420 - step * 45, y: 1000, id: 1 }] });
      await kiosk.waitForTimeout(12);
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(kiosk.locator('[data-panel-page-id="page-2"]')).toHaveAttribute('aria-hidden', 'false');
    await expect.poll(() => host.record.layout?.activePageId).toBe('page-2');
    expect(orderOf(host)).toEqual(moveIds(original, 'page-3', 2)); expect(host.record.layout?.homePageId).toBe('page-3');
  } finally { await client.detach(); }
});

test('a same-order external configuration and Home update during a grab survives the eventual drop', async ({ page }) => {
  const host = await setup(page), original = orderOf(host);
  const { point, frame } = await grab(page);
  await page.mouse.move(point.x - 20, point.y + 5);
  host.change(record => ({ ...record, backgroundColor: '#24689a', layout: { ...record.layout!, homePageId: 'page-1',
    pages: record.layout!.pages.map(value => value.id !== 'page-3' ? value : { ...value, widgets: value.widgets.map(widget => ({
      ...widget, config: { ...widget.config, savedMarker: 'newest-external-setting', targetPageId: 'page-6' },
    })) }),
  } }));
  await expect(page.getByRole('button', { name: 'Set current page as Home', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(reorderRoot(page)).toHaveAttribute('data-page-reorder-phase', 'grabbed');
  const latest = structuredClone(host.record.layout!);
  await page.mouse.move(point.x - frame.width * 0.65, point.y + 10); await page.mouse.up(); await idle(page);
  expect(orderOf(host)).toEqual(moveIds(original, 'page-3', 2)); await assertPreserved(host, latest);
  expect(host.record.backgroundColor).toBe('#24689a'); expect(host.record.layout?.homePageId).toBe('page-1');
  expect(host.record.layout?.pages.find(value => value.id === 'page-3')?.widgets[0].config?.savedMarker).toBe('newest-external-setting');
});

test('a preferences scope event cancels a held page even when the new record keeps the same page identities and order', async ({ page }) => {
  const host = await setup(page), original = orderOf(host);
  const { point, frame } = await grab(page);
  await page.mouse.move(point.x - frame.width * 0.65, point.y + 10);
  host.state.record = { ...host.record, layout: { ...host.record.layout!, homePageId: 'page-1',
    pages: host.record.layout!.pages.map(value => value.id !== 'page-3' ? value : { ...value,
      widgets: value.widgets.map(widget => ({ ...widget, config: { ...widget.config, savedMarker: 'new-profile-scope' } })),
    }),
  } };
  host.bus.send('prefs', {});
  await idle(page); await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Set current page as Home', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(orderOf(host)).toEqual(original); expect(host.reorderAttempts).toHaveLength(0);
  expect(host.record.layout?.homePageId).toBe('page-1');
  expect(host.record.layout?.pages.find(value => value.id === 'page-3')?.widgets[0].config?.savedMarker).toBe('new-profile-scope');
});
