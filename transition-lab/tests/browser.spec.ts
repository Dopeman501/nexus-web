import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

type Library = 'gl-transitions' | 'codrops' | 'curtains' | 'motion' | 'anime';
interface Snapshot {
  activeAdapters: number;
  pendingFrames: number;
  progress: number;
  drawnFrames: number;
  p95FrameMs: number;
  error?: string;
}
interface LabApi {
  select(id: Library): Promise<boolean>;
  seek(progress: number): void;
  play(durationMs?: number): void;
  clear(): Promise<void>;
  snapshot(): Snapshot;
  next(): Promise<void>;
}
declare global { interface Window { transitionLab: LabApi } }

const libraries: Library[] = ['gl-transitions', 'codrops', 'curtains', 'motion', 'anime'];
const gpuLibraries: Library[] = ['gl-transitions', 'codrops', 'curtains'];
const observations = new WeakMap<Page, { blocked: string[]; errors: string[]; consoleErrors: string[] }>();
const compiledRoot = fileURLToPath(new URL('../dist/', import.meta.url));
const fixtures = ['dawn', 'night'].map(name => 'data:image/svg+xml;base64,' +
  readFileSync(fileURLToPath(new URL(`../fixtures/${name}.svg`, import.meta.url))).toString('base64'));

test.beforeEach(async ({ page }) => {
  const seen = { blocked: [] as string[], errors: [] as string[], consoleErrors: [] as string[] };
  observations.set(page, seen);
  page.on('pageerror', error => seen.errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && seen.consoleErrors.length < 20) seen.consoleErrors.push(message.text());
  });
  await page.routeWebSocket(/.*/, route => {
    seen.blocked.push(route.url());
    route.close();
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    const apiPath = /^\/(?:panel|lighting|audio-trigger|ping|pair|preferences|service|ws)(?:\/|$)/;
    if (url.origin !== 'http://127.0.0.1:19431' || apiPath.test(url.pathname)) {
      seen.blocked.push(url.origin + url.pathname);
      return route.abort();
    }
    const file = resolve(compiledRoot, url.pathname === '/' ? 'index.html' : `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(compiledRoot + (compiledRoot.endsWith(sep) ? '' : sep))) return route.abort();
    return existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
  });
});

test.afterEach(async ({ page }, info) => {
  await page.evaluate(async () => { await window.transitionLab?.clear(); });
  await info.attach('browser-console-errors', {
    body: JSON.stringify(observations.get(page)?.consoleErrors ?? []), contentType: 'application/json',
  });
  expect(observations.get(page)?.blocked).toEqual([]);
  expect(observations.get(page)?.errors).toEqual([]);
});

async function open(page: Page, library: Library) {
  await page.goto('/');
  await page.waitForFunction(() => !!window.transitionLab);
  await expect(page.getByTestId('lab-status')).toHaveText(/^(Ready|Fallback)$/);
  const mounted = await page.evaluate(id => window.transitionLab.select(id), library);
  expect(mounted).toBe(true);
  await expect(page.getByTestId('lab-status')).toHaveText('Ready');
  expect(await page.evaluate(() => window.transitionLab.snapshot().activeAdapters)).toBe(1);
}

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

// Decode the browser's non-interlaced, eight-bit screenshot PNGs using Node's
// built-in zlib. This measures actual pixels without another runtime package.
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

function expectNonblank(rgb: Uint8Array) {
  const colors = new Set<string>();
  for (let at = 0; at < rgb.length; at += 3 * 101) colors.add(`${rgb[at]},${rgb[at + 1]},${rgb[at + 2]}`);
  expect(colors.size).toBeGreaterThan(30);
}

async function frame(page: Page, info: TestInfo, name: string) {
  await settle(page);
  const png = await page.getByTestId('transition-stage').screenshot({ path: info.outputPath(`${name}.png`) });
  const rgb = pixels(png);
  expectNonblank(rgb);
  return { rgb, sha256: createHash('sha256').update(rgb).digest('hex') };
}

async function reference(page: Page, source: string) {
  await page.getByTestId('transition-stage').evaluate((stage, url) => new Promise<void>((resolve, reject) => {
    const image = document.createElement('img');
    image.dataset.pixelReference = 'true';
    image.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:10000';
    image.onload = () => { stage.append(image); resolve(); };
    image.onerror = () => reject(new Error('Local reference fixture did not decode'));
    image.src = url;
  }), source);
  await settle(page);
  const result = pixels(await page.getByTestId('transition-stage').screenshot());
  await page.locator('[data-pixel-reference]').evaluate(image => image.remove());
  return result;
}

async function existingRenderer(page: Page, library: Library) {
  return page.getByTestId('transition-stage').evaluate((stage, id) => {
    if (id === 'motion' || id === 'anime') return { backend: 'DOM' };
    const canvas = stage.querySelector('canvas') ?? stage.querySelector('iframe')?.contentDocument?.querySelector('canvas');
    if (!canvas) return { backend: 'Unavailable' };
    // Successful mounting already created this canvas's context. Query its
    // existing type; do not allocate a separate probe canvas or renderer.
    const webgl2 = canvas.getContext('webgl2');
    const gl = webgl2 ?? canvas.getContext('webgl');
    if (!gl) return { backend: canvas.getContext('webgpu') ? 'WebGPU' : 'Unavailable' };
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { backend: webgl2 ? 'WebGL2' : 'WebGL',
      renderer: String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)),
      vendor: String(gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR)) };
  }, library);
}

for (const library of libraries) {
  test(`${library}: actual start, intermediate and end pixels`, async ({ page }, info) => {
    await open(page, library);
    const startReference = await reference(page, fixtures[0]);
    const endReference = await reference(page, fixtures[1]);
    const frames = [];
    for (const progress of [0, 0.5, 1]) {
      await page.evaluate(value => window.transitionLab.seek(value), progress);
      frames.push(await frame(page, info, `${library}-${progress}`));
    }
    expect(difference(frames[0].rgb, startReference).changedFraction).toBeLessThan(0.05);
    expect(difference(frames[2].rgb, endReference).changedFraction).toBeLessThan(0.05);
    expect(difference(frames[0].rgb, frames[1].rgb).changedFraction).toBeGreaterThan(0.01);
    expect(difference(frames[1].rgb, frames[2].rgb).changedFraction).toBeGreaterThan(0.01);
    expect(new Set(frames.map(value => value.sha256)).size).toBe(3);
    await info.attach('pixel-evidence', { body: JSON.stringify(frames.map(({ sha256 }) => sha256)), contentType: 'application/json' });
  });

  test(`${library}: timed playback reaches the endpoint and reports browser frame timing`, async ({ page }, info) => {
    await open(page, library);
    await page.evaluate(() => window.transitionLab.play(650));
    await expect.poll(() => page.evaluate(() => window.transitionLab.snapshot().progress)).toBe(1);
    const result = await page.evaluate(() => window.transitionLab.snapshot());
    expect(result.activeAdapters).toBe(1);
    expect(result.pendingFrames).toBe(0);
    expect(result.drawnFrames).toBeGreaterThan(2);
    expect(Number.isFinite(result.p95FrameMs) && result.p95FrameMs > 0).toBe(true);
    const renderer = await existingRenderer(page, library);
    expect(renderer.backend).not.toBe('Unavailable');
    writeFileSync(info.outputPath(`${library}-browser-timing.json`), JSON.stringify({ library, ...result, renderer,
      scope: 'Browser host frame intervals; excludes capture, USB and physical rendering. Different effects are not an engine speed ranking.' }, null, 2));
  });

  test(`${library}: rapid changes converge, portrait renders and Clear releases resources`, async ({ page }, info) => {
    await open(page, library);
    await page.evaluate(() => window.transitionLab.seek(1));
    const expectedEnd = await frame(page, info, `${library}-expected-end`);
    await page.evaluate(() => Promise.all(Array.from({ length: 6 }, () => window.transitionLab.next())));
    await expect(page.getByTestId('lab-status')).toHaveText('Ready');
    await expect.poll(() => page.evaluate(() => window.transitionLab.snapshot().progress)).toBe(1);
    const result = await page.evaluate(() => window.transitionLab.snapshot());
    expect(result.activeAdapters).toBe(1);
    expect(result.pendingFrames).toBe(0);
    const latestEnd = await frame(page, info, `${library}-latest-end`);
    expect(difference(expectedEnd.rgb, latestEnd.rgb).changedFraction).toBeLessThan(0.01);
    await page.setViewportSize({ width: 1000, height: 1940 });
    await page.getByLabel('Size', { exact: true }).selectOption('portrait');
    await settle(page);
    const bounds = await page.getByTestId('transition-stage').boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.height / bounds!.width).toBeCloseTo(1680 / 756, 2);
    await frame(page, info, `${library}-portrait`);
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.transitionLab.snapshot().activeAdapters)).toBe(0);
    expect(await page.evaluate(() => window.transitionLab.snapshot().pendingFrames)).toBe(0);
    await expect(page.getByTestId('transition-stage').locator('canvas')).toHaveCount(0);
  });
}

test('all five selector choices and repeated mounting leave only one renderer', async ({ page }) => {
  await open(page, 'motion');
  for (const library of [...libraries, ...libraries].reverse()) {
    await page.getByLabel('Library', { exact: true }).selectOption(library);
    await expect(page.getByTestId('lab-status')).toHaveText('Ready');
    expect(await page.evaluate(() => window.transitionLab.snapshot().activeAdapters)).toBe(1);
    expect(await page.getByTestId('transition-stage').locator('canvas').count()).toBeLessThanOrEqual(1);
  }
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('button', { name: 'Mount sample', exact: true }).click();
  await expect(page.getByTestId('lab-status')).toHaveText('Ready');
  await page.getByRole('button', { name: 'Play transition', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.transitionLab.snapshot().progress)).toBe(1);
});

for (const library of gpuLibraries) {
  test(`${library}: unavailable WebGL presents a safe visible fallback`, async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
        if (String(args[0]).startsWith('webgl') || args[0] === 'experimental-webgl') return null;
        return original.apply(this, args);
      } as typeof original;
    });
    await page.goto('/');
    await page.waitForFunction(() => !!window.transitionLab);
    expect(await page.evaluate(id => window.transitionLab.select(id), library)).toBe(false);
    const result = await page.evaluate(() => window.transitionLab.snapshot());
    expect(result.error).toBeTruthy();
    expect(result.activeAdapters).toBe(0);
    expect(result.pendingFrames).toBe(0);
    await expect(page.getByTestId('transition-fallback')).toBeVisible();
    await expect(page.getByTestId('transition-stage').locator('canvas')).toHaveCount(0);
  });
}

for (const library of gpuLibraries) {
  test(`${library}: actual context loss releases resources and shows the safe fallback`, async ({ page }) => {
    if (library === 'codrops') {
      await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true }));
    }
    await open(page, library);
    const stage = page.getByTestId('transition-stage');
    const canvas = library === 'codrops' ? stage.frameLocator('iframe').locator('canvas') : stage.locator('canvas');
    const lost = await canvas.evaluate(canvas => new Promise<boolean>(resolve => {
      const element = canvas as HTMLCanvasElement;
      const gl = element.getContext('webgl2') ?? element.getContext('webgl');
      const extension = gl?.getExtension('WEBGL_lose_context');
      if (!extension) { resolve(false); return; }
      canvas.addEventListener('webglcontextlost', () => resolve(true), { once: true });
      extension.loseContext();
    }));
    expect(lost).toBe(true);
    await page.evaluate(() => window.transitionLab.seek(0.5));
    await expect.poll(() => page.evaluate(() => window.transitionLab.snapshot().activeAdapters)).toBe(0);
    expect(await page.evaluate(() => window.transitionLab.snapshot().error)).toBeTruthy();
    expect(await page.evaluate(() => window.transitionLab.snapshot().pendingFrames)).toBe(0);
    await expect(page.getByTestId('transition-fallback')).toBeVisible();
    await expect(page.getByTestId('transition-stage').locator('canvas')).toHaveCount(0);
  });
}
