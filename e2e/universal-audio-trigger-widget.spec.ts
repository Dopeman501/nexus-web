import { expect, test, type Locator, type Page, type WebSocketRoute } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { PanelDeviceRecord } from '../src/api/panel';

type Surface = 'y70' | 'monitor' | 'phone';
interface Target { id: string; kind: 'background' | 'lighting'; name: string; enabled: boolean; intensity: number }
interface Patch { targetIds?: string[]; enabled?: boolean; intensity?: number }
interface Fixture {
  record: PanelDeviceRecord;
  targets: Target[];
  writes: Patch[];
  unexpectedMutations: string[];
  targetReads: number;
  unavailable: boolean;
}

function seed(surface: Surface, accent = '#d72f38'): Fixture {
  return {
    targets: [
      { id: 'background:y70', kind: 'background', name: 'HYTE Y70 Touch', enabled: false, intensity: 40 },
      { id: 'lighting:keyboard', kind: 'lighting', name: 'Keyboard', enabled: true, intensity: 70 },
    ],
    writes: [], unexpectedMutations: [], targetReads: 0, unavailable: false,
    record: {
      id: 'audio-trigger-widget-spec', displayName: 'Audio Trigger test panel',
      firstSeenAt: 1, lastSeenAt: 1,
      displayId: surface === 'monitor' ? 'mock-xeneon-edge' : undefined,
      themeMode: 'dark', themeSyncWithDesktop: false, accentColor: accent, accentSyncWithDesktop: false,
      backgroundMode: 'solid', backgroundColor: '#151515', backdrop: 'theme',
      capabilities: { surface, touch: true, dpr: 1,
        family: surface === 'monitor' ? 'xeneon-edge' : undefined,
        cssWidth: surface === 'y70' ? 688 : surface === 'monitor' ? 1280 : 390,
        cssHeight: surface === 'y70' ? 2560 : surface === 'monitor' ? 720 : 844 },
      layout: { layoutSchemaVersion: 2, surface, pages: [{ id: 'main', widgets: [
        { id: 'audio-trigger-tile', type: 'audio-trigger', size: '4x2', col: 0, row: 0 },
      ] }] },
    },
  };
}

/** All transport, including documents, assets and WebSockets, is fulfilled locally. */
async function isolate(page: Page, state: Fixture) {
  const root = resolve(process.env.AUDIO_TRIGGER_WIDGET_DIST ?? process.env.D215_DIST ?? 'dist');
  const sockets = new Set<WebSocketRoute>();
  await page.addInitScript(() => {
    localStorage.setItem('nexus_token', 'isolated-audio-trigger-test');
    localStorage.setItem('nexus_settings', JSON.stringify({ general: {
      language: 'en', themeMode: 'dark', accentColor: '#d72f38', accentSource: 'custom',
    } }));
    if ('serviceWorker' in navigator) Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true, get: () => undefined,
    });
  });
  await page.routeWebSocket(/.*/, socket => {
    sockets.add(socket);
    socket.onClose(() => sockets.delete(socket));
  });
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
    if (path === '/audio-trigger/targets') {
      if (request.method() === 'GET') state.targetReads++;
      if (state.unavailable) return route.fulfill({ status: 503, body: '' });
      if (request.method() === 'POST') {
        const patch = request.postDataJSON() as Patch;
        state.writes.push(patch);
        state.targets = state.targets.map(target => !patch.targetIds || patch.targetIds.includes(target.id)
          ? { ...target, ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
            ...(patch.intensity !== undefined ? { intensity: patch.intensity } : {}) } : target);
      }
      return json({ epoch: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', targets: state.targets });
    }
    if (path === `/panel/devices/${state.record.id}`) {
      if (request.method() === 'POST') state.record = { ...state.record, ...request.postDataJSON() };
      return json(state.record);
    }
    // The panel shell publishes memory telemetry and materializes preferences on boot.
    // Keep every other mutation visible, including normal backgrounds/lighting settings.
    if (request.method() !== 'GET' && path !== '/diagnostics/client-mem' && path !== '/preferences') state.unexpectedMutations.push(path);
    if (path === '/ping') return json({ service: 'nexus', version: 'audio-trigger-widget-isolated', initialized: true, platform: 'windows' });
    if (path === '/pair') return json({ token: 'isolated-audio-trigger-test' });
    if (path === '/onboarding') return json({ completed: true });
    if (path === '/preferences') return json({ language: 'en', themeMode: 'dark', accentColor: '#d72f38' });
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
  return page.locator('[data-audio-trigger-widget]');
}

async function horizontal(slider: Locator) {
  const rect = await slider.boundingBox();
  expect(rect).not.toBeNull();
  expect(rect!.width).toBeGreaterThan(rect!.height * 2);
}

async function fitsViewport(locator: Locator) {
  await expect(locator).toBeVisible();
  expect(await locator.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}

for (const surface of ['y70', 'monitor', 'phone'] as const) {
  test(`global and individual Audio Trigger controls on ${surface}`, async ({ page }, testInfo) => {
    await page.setViewportSize(surface === 'y70' ? { width: 688, height: 2560 }
      : surface === 'monitor' ? { width: 1280, height: 720 } : { width: 390, height: 844 });
    const state = seed(surface);
    const tile = await openPanel(page, state);
    await expect(tile.getByRole('button', { name: 'Turn all Audio Trigger off', exact: true })).toBeVisible();
    const intensity = tile.getByRole('slider', { name: 'Audio intensity', exact: true });
    await horizontal(intensity);
    await fitsViewport(tile);
    await tile.screenshot({ path: testInfo.outputPath(`tile-${surface}-mixed.png`) });

    await tile.getByRole('button', { name: 'Turn all Audio Trigger off', exact: true }).click();
    await expect.poll(() => state.targets.map(target => target.enabled)).toEqual([false, false]);
    expect(state.targets.map(target => target.intensity)).toEqual([40, 70]);
    await expect(page.locator('[data-audio-trigger-immersive]')).toHaveCount(0);
    await tile.screenshot({ path: testInfo.outputPath(`tile-${surface}-off.png`) });
    await tile.getByRole('button', { name: 'Turn all Audio Trigger on', exact: true }).click();
    await expect.poll(() => state.targets.map(target => target.enabled)).toEqual([true, true]);

    await intensity.focus();
    await intensity.press('End');
    await expect.poll(() => state.targets.map(target => target.intensity)).toEqual([100, 100]);
    await expect(page.locator('[data-audio-trigger-immersive]')).toHaveCount(0);
    await tile.screenshot({ path: testInfo.outputPath(`tile-${surface}-on.png`) });

    await tile.getByRole('button', { name: 'Device controls', exact: true }).click();
    const immersive = page.locator('[data-audio-trigger-immersive]');
    await fitsViewport(immersive);
    const background = immersive.getByRole('switch', { name: 'HYTE Y70 Touch Audio Trigger', exact: true });
    const lighting = immersive.getByRole('switch', { name: 'Keyboard Audio Trigger', exact: true });
    await expect(background).toHaveAttribute('aria-checked', 'true');
    await lighting.click();
    await expect.poll(() => state.targets.map(target => target.enabled)).toEqual([true, false]);
    const individual = immersive.getByRole('slider', { name: 'Keyboard audio intensity', exact: true });
    await horizontal(individual);
    await individual.focus();
    await individual.press('Home');
    await expect.poll(() => state.targets.map(target => target.intensity)).toEqual([100, 0]);
    await expect(lighting).toHaveAttribute('aria-checked', 'false');
    await expect(background).toHaveAttribute('aria-checked', 'true');
    await immersive.screenshot({ path: testInfo.outputPath(`immersive-${surface}-individual.png`) });
    expect(state.writes.at(-1)).toMatchObject({ targetIds: ['lighting:keyboard'], intensity: 0 });
    expect(state.unexpectedMutations).toEqual([]);
  });
}

test('panel accent changes the button and horizontal fader', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const state = seed('monitor', '#00bfa5');
  state.targets = state.targets.map(target => ({ ...target, enabled: true, intensity: 70 }));
  const tile = await openPanel(page, state);
  const button = tile.getByRole('button', { name: 'Turn all Audio Trigger off', exact: true });
  await expect(button).toBeVisible();
  await expect(button).toHaveCSS('background-color', 'rgb(0, 191, 165)');
  const fill = tile.locator('[style*="--audio-intensity-fill"] > div').first();
  expect(await fill.evaluate(element => getComputedStyle(element).backgroundImage)).toContain('0, 191, 165');
  await tile.screenshot({ animations: 'disabled', path: testInfo.outputPath('tile-teal-accent.png') });
});

for (const surface of ['y70', 'monitor', 'phone'] as const) {
  for (const size of ['2x2', '4x2', '4x4'] as const) {
    test(`Audio Trigger button is narrower than the slider on ${surface} ${size}`, async ({ page }, testInfo) => {
      await page.setViewportSize(surface === 'y70' ? { width: 688, height: 2560 }
        : surface === 'monitor' ? { width: 1280, height: 720 } : { width: 390, height: 844 });
      const state = seed(surface);
      const layout = state.record.layout!;
      const firstPage = layout.pages![0];
      state.record = { ...state.record, layout: { ...layout, pages: [{ ...firstPage,
        widgets: [{ ...firstPage.widgets[0], size }],
      }] } };
      const tile = await openPanel(page, state);
      const button = tile.getByRole('button', { name: 'Turn all Audio Trigger off', exact: true });
      const slider = tile.getByRole('slider', { name: 'Audio intensity', exact: true });
      await expect(button).toBeVisible();
      const buttonBox = (await button.boundingBox())!;
      const sliderBox = (await slider.boundingBox())!;
      expect(buttonBox.width).toBeLessThan(sliderBox.width * 0.85);
      expect(await button.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await testInfo.attach('control-geometry', { contentType: 'application/json', body: JSON.stringify({ button: buttonBox, slider: sliderBox }) });
      await tile.screenshot({ animations: 'disabled', path: testInfo.outputPath(`compact-${surface}-${size}.png`) });
    });
  }
}

test('touching the fader controls intensity while a tile tap opens immersive', async ({ page }) => {
  await page.setViewportSize({ width: 688, height: 2560 });
  const state = seed('y70');
  const tile = await openPanel(page, state);
  const slider = tile.getByRole('slider', { name: 'Audio intensity', exact: true });
  const fader = (await slider.boundingBox())!;
  await page.touchscreen.tap(fader.x + fader.width * 0.75, fader.y + fader.height / 2);
  await expect.poll(() => state.targets.every(target => target.intensity >= 72 && target.intensity <= 78)).toBe(true);
  await expect(slider).toHaveValue(/7[2-8]/);
  await expect(page.locator('[data-audio-trigger-immersive]')).toHaveCount(0);
  const writes = state.writes.length;
  const bounds = (await tile.boundingBox())!;
  expect(await tile.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height - 14)?.closest('[data-audio-trigger-widget]') === element;
  })).toBe(true);
  await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height - 14);
  await expect(page.locator('[data-audio-trigger-immersive]')).toBeVisible();
  expect(state.writes).toHaveLength(writes);
});

test('long device list stays usable on a compact phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = seed('phone');
  state.targets = Array.from({ length: 24 }, (_, index) => ({
    id: `lighting:device-${index}`, kind: 'lighting', name: `Lighting device ${index + 1}`,
    enabled: index % 2 === 0, intensity: index + 40,
  }));
  const tile = await openPanel(page, state);
  await tile.getByRole('button', { name: 'Device controls', exact: true }).click();
  const immersive = page.locator('[data-audio-trigger-immersive]');
  await fitsViewport(immersive);
  const last = immersive.getByRole('switch', { name: 'Lighting device 24 Audio Trigger', exact: true });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeVisible();
  await last.click();
  await expect.poll(() => state.targets.at(-1)?.enabled).toBe(true);
  expect(state.targets[1].enabled).toBe(false);
  await immersive.screenshot({ path: testInfo.outputPath('immersive-phone-long-list.png') });
});

test('empty and unavailable targets never perform a control write', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 688, height: 1100 });
  const state = seed('y70');
  state.targets = [];
  const tile = await openPanel(page, state);
  await expect(tile.getByRole('button', { name: 'Turn all Audio Trigger on', exact: true })).toBeDisabled();
  expect(state.writes).toEqual([]);
  await tile.screenshot({ path: testInfo.outputPath('tile-empty.png') });

  state.unavailable = true;
  await page.reload();
  const retry = tile.getByRole('button', { name: 'Retry', exact: true });
  await expect(retry).toBeVisible();
  expect(state.writes).toEqual([]);
  state.unavailable = false;
  state.targets = seed('y70').targets;
  await retry.click();
  await expect(tile.getByRole('button', { name: 'Turn all Audio Trigger off', exact: true })).toBeEnabled();
  expect(state.writes).toEqual([]);
  await tile.screenshot({ path: testInfo.outputPath('tile-recovered.png') });
});
