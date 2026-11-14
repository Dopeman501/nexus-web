import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

type Library = 'gl-transitions' | 'curtains';
interface Effect { key: string; library: Library }
interface Backend { backend: string; renderer: string; contextLost: boolean; software: boolean }
interface FixtureApi {
  effects(): Effect[];
  mount(key: string): Promise<Backend>;
  reference(which: number): Promise<void>;
  seek(progress: number): void;
  clear(): Promise<{children: number; canvases: number}>;
  backend(): Backend;
}
declare global { interface Window { productionTransitionFixture: FixtureApi } }
const compiledRoot = fileURLToPath(new URL('../.playwright/transition-engines/', import.meta.url));
const seen = new WeakMap<Page, { errors: string[]; blocked: string[] }>();
const counts: Record<Library, number> = { 'gl-transitions': 214, curtains: 12 };
const rgbHash = (rgb: Uint8Array) => createHash('sha256').update(rgb).digest('hex');

test.beforeEach(async ({ page }) => {
  const observations = { errors: [] as string[], blocked: [] as string[] };
  seen.set(page, observations);
  page.on('pageerror', error => observations.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') observations.errors.push(message.text()); });
  await page.routeWebSocket(/.*/, route => { observations.blocked.push(route.url()); route.close(); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:19437') { observations.blocked.push(url.href); return route.abort(); }
    const path = resolve(compiledRoot, url.pathname === '/' ? 'index.html' : '.' + decodeURIComponent(url.pathname));
    if (!path.startsWith(compiledRoot + (compiledRoot.endsWith(sep) ? '' : sep))) return route.abort();
    return existsSync(path) ? route.fulfill({ path }) : route.fulfill({ status: 404, body: '' });
  });
  await page.goto('/');
  await page.waitForFunction(() => !!window.productionTransitionFixture);
});

test.afterEach(async ({ page }, info) => {
  await page.evaluate(() => window.productionTransitionFixture?.clear());
  await info.attach('network-console', { body: JSON.stringify(seen.get(page)), contentType: 'application/json' });
  expect(seen.get(page)?.blocked).toEqual([]);
  expect(seen.get(page)?.errors).toEqual([]);
});

function pixels(png: Buffer): Uint8Array {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!png.subarray(0, 8).equals(signature)) throw new Error('Expected PNG screenshot');
  let width = 0, height = 0, channels = 0;
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const kind = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (data[8] !== 8 || !channels || data[12] !== 0) throw new Error('Unsupported screenshot PNG layout');
    }
    if (kind === 'IDAT') chunks.push(data);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const decoded = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x;
      const left = x >= channels ? decoded[at - channels] : 0;
      const above = y ? decoded[at - stride] : 0;
      const upperLeft = y && x >= channels ? decoded[at - stride - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) {
        const p = left + above - upperLeft;
        const a = Math.abs(p - left), b = Math.abs(p - above), c = Math.abs(p - upperLeft);
        predictor = a <= b && a <= c ? left : b <= c ? above : upperLeft;
      } else if (filter !== 0) throw new Error('Unsupported screenshot PNG filter');
      decoded[at] = raw[y * (stride + 1) + x + 1] + predictor;
    }
  }
  const rgb = new Uint8Array(width * height * 3);
  for (let source = 0, target = 0; source < decoded.length; source += channels) {
    rgb[target++] = decoded[source]; rgb[target++] = decoded[source + 1]; rgb[target++] = decoded[source + 2];
  }
  return rgb;
}

function difference(a: Uint8Array, b: Uint8Array) {
  expect(a.length).toBe(b.length);
  let changed = 0, absolute = 0;
  for (let at = 0; at < a.length; at += 3) {
    let largest = 0;
    for (let channel = 0; channel < 3; channel++) {
      const delta = Math.abs(a[at + channel] - b[at + channel]);
      absolute += delta; largest = Math.max(largest, delta);
    }
    if (largest > 12) changed++;
  }
  return { changedFraction: changed / (a.length / 3), meanChannelError: absolute / a.length };
}


const settle = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
interface Result {
  key: string; mounted: boolean; backend?: Backend; hashes?: { start: string; middle: string; end: string };
  startDifference?: number; endDifference?: number; intermediate?: boolean;
  released?: {children: number; canvases: number}; error?: string; errors?: string[];
}
for (const library of Object.keys(counts) as Library[]) {
  test('production engine sources: every ' + library + ' entry renders real pixels and releases', async ({ page }, info) => {
    const all = await page.evaluate(() => window.productionTransitionFixture.effects());
    expect(all).toHaveLength(226);
    const effects = all.filter(effect => effect.library === library);
    expect(effects).toHaveLength(counts[library]);
    const stage = page.getByTestId('engine-stage');
    await page.evaluate(() => window.productionTransitionFixture.reference(0)); await settle(page);
    const referenceStart = pixels(await stage.screenshot({ path: info.outputPath('reference-start.png') }));
    await page.evaluate(() => window.productionTransitionFixture.reference(1)); await settle(page);
    const referenceEnd = pixels(await stage.screenshot({ path: info.outputPath('reference-end.png') }));
    await page.evaluate(() => window.productionTransitionFixture.clear());
    const records: Result[] = [];
    for (const effect of effects) {
      const before = seen.get(page)!.errors.length;
      const row: Result = { key: effect.key, mounted: false };
      records.push(row);
      const basename = effect.key.replace(/[^a-zA-Z0-9-]/g, '_');
      try {
        row.backend = await page.evaluate(key => window.productionTransitionFixture.mount(key), effect.key);
        row.mounted = true;
        const frames: Uint8Array[] = [];
        for (const [label, progress] of [['start', 0], ['middle', 0.37], ['end', 1]] as const) {
          await page.evaluate(value => window.productionTransitionFixture.seek(value), progress);
          await settle(page);
          frames.push(pixels(await stage.screenshot({ path: info.outputPath(basename + '-' + label + '.png') })));
        }
        row.hashes = { start: rgbHash(frames[0]), middle: rgbHash(frames[1]), end: rgbHash(frames[2]) };
        row.startDifference = difference(frames[0], referenceStart).changedFraction;
        row.endDifference = difference(frames[2], referenceEnd).changedFraction;
        row.intermediate = difference(frames[0], frames[1]).changedFraction > 0.0001
          && difference(frames[1], frames[2]).changedFraction > 0.0001;
        row.backend = await page.evaluate(() => window.productionTransitionFixture.backend());
      } catch (error) { row.error = error instanceof Error ? error.message : String(error); }
      finally {
        try { row.released = await page.evaluate(() => window.productionTransitionFixture.clear()); }
        catch (error) { row.error = (row.error ?? '') + '; cleanup: ' + String(error); }
      }
      row.errors = seen.get(page)!.errors.slice(before);
      writeFileSync(info.outputPath(library + '-results.json'), JSON.stringify(records, null, 2));
    }
    await info.attach('production-engine-results', { body: JSON.stringify(records), contentType: 'application/json' });
    const failures = records.filter(row => !row.mounted || row.error || !row.intermediate || row.errors?.length
      || (row.startDifference ?? 1) > 0.001 || (row.endDifference ?? 1) > 0.001
      || row.backend?.backend !== 'WebGL2' || row.backend.contextLost || row.backend.software
      || row.released?.children !== 0 || row.released.canvases !== 0);
    expect(failures).toEqual([]);
    expect(records).toHaveLength(counts[library]);
  });
}

test('production engines resize the same live GL/Curtains canvas to a D215 portrait ratio', async ({ page }, info) => {
  await page.setViewportSize({ width: 900, height: 800 });
  const stage = page.getByTestId('engine-stage');
  const resize = async (portrait: boolean) => {
    await stage.evaluate((element, narrow) => {
      element.style.width = narrow ? '270px' : '640px';
      element.style.height = narrow ? '600px' : '360px';
    }, portrait);
    await settle(page);
  };
  const results: Record<string, unknown>[] = [];
  for (const key of ['gl-transitions:WaterDrop', 'curtains:wave']) {
    const basename = key.replace(/[^a-zA-Z0-9-]/g, '_');
    await resize(true);
    await page.evaluate(() => window.productionTransitionFixture.reference(0)); await settle(page);
    const referenceStart = pixels(await stage.screenshot());
    await page.evaluate(() => window.productionTransitionFixture.reference(1)); await settle(page);
    const referenceEnd = pixels(await stage.screenshot());
    await page.evaluate(() => window.productionTransitionFixture.clear());
    await resize(false);
    await page.evaluate(value => window.productionTransitionFixture.mount(value), key);
    await page.evaluate(() => window.productionTransitionFixture.seek(0.37)); await settle(page);
    const landscape = pixels(await stage.screenshot({ path: info.outputPath(basename + '-resize-landscape.png') }));
    await stage.locator('canvas').evaluate(canvas => { canvas.dataset.resizeIdentity = 'same-live-canvas'; });
    await resize(true);
    const dimensions = await stage.locator('canvas').evaluate(canvas => ({
      width: canvas.width, height: canvas.height, identity: canvas.dataset.resizeIdentity,
    }));
    expect(dimensions).toEqual({ width: 270, height: 600, identity: 'same-live-canvas' });
    const bounds = await stage.boundingBox();
    expect(bounds!.width / bounds!.height).toBeCloseTo(756 / 1680, 8);
    const frames: Uint8Array[] = [];
    for (const [label, progress] of [['start', 0], ['middle', 0.37], ['end', 1]] as const) {
      await page.evaluate(value => window.productionTransitionFixture.seek(value), progress); await settle(page);
      frames.push(pixels(await stage.screenshot({ path: info.outputPath(basename + '-portrait-' + label + '.png') })));
    }
    expect(difference(frames[0], referenceStart).changedFraction).toBeLessThan(0.001);
    expect(difference(frames[2], referenceEnd).changedFraction).toBeLessThan(0.001);
    expect(difference(frames[0], frames[1]).changedFraction).toBeGreaterThan(0.0001);
    expect(difference(frames[1], frames[2]).changedFraction).toBeGreaterThan(0.0001);
    const backend = await page.evaluate(() => window.productionTransitionFixture.backend());
    expect(backend.backend).toBe('WebGL2'); expect(backend.contextLost).toBe(false); expect(backend.software).toBe(false);
    const released = await page.evaluate(() => window.productionTransitionFixture.clear());
    expect(released).toEqual({ children: 0, canvases: 0 });
    results.push({ key, ratio: 756 / 1680, dimensions, backend, released,
      hashes: { landscape: rgbHash(landscape), start: rgbHash(frames[0]), middle: rgbHash(frames[1]), end: rgbHash(frames[2]) } });
    writeFileSync(info.outputPath('portrait-resize-results.json'), JSON.stringify(results, null, 2));
  }
});
