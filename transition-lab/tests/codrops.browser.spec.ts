import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, pixelDifference } from './pngPixels';

interface CodropsLab {
  selectEffect(key: string): Promise<boolean>;
  seek(progress: number): void;
  play(duration: number): void;
  clear(): Promise<void>;
  snapshot(): { activeAdapters: number; pendingFrames: number; error?: string };
}
type PreviewWindow = Window & {
  transitionLab: CodropsLab;
  pendingCodrops?: Promise<boolean>;
  heldCodropsTextures?: number;
};
const compiledRoot = fileURLToPath(new URL('../dist/', import.meta.url));
const observations = new WeakMap<Page, { errors: string[]; console: string[]; blocked: string[]; expectedGpuFailure: boolean }>();

test.beforeEach(async ({ page }) => {
  const seen = { errors: [] as string[], console: [] as string[], blocked: [] as string[], expectedGpuFailure: false };
  observations.set(page, seen);
  page.on('pageerror', error => seen.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') seen.console.push(message.text()); });
  await page.routeWebSocket(/.*/, route => { seen.blocked.push(route.url()); route.close(); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:19431') { seen.blocked.push(url.href); return route.abort(); }
    const file = resolve(compiledRoot, url.pathname === '/' ? 'index.html' : `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(compiledRoot + (compiledRoot.endsWith(sep) ? '' : sep))) return route.abort();
    return existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
  });
});

test.afterEach(async ({ page }, info) => {
  await page.evaluate(() => (window as PreviewWindow).transitionLab?.clear());
  const seen = observations.get(page)!;
  await info.attach('codrops-console-and-network', { body: JSON.stringify(seen), contentType: 'application/json' });
  expect(seen.errors).toEqual([]);
  expect(seen.blocked).toEqual([]);
  if (!seen.expectedGpuFailure) expect(seen.console).toEqual([]);
  else expect(seen.console.filter(message => !/THREE\.|WebGL|WebGPU|GPU context/i.test(message))).toEqual([]);
});

async function open(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as PreviewWindow).transitionLab);
  await expect(page.getByTestId('lab-status')).toHaveText(/^(Ready|Fallback)$/);
  await page.addStyleTag({ content: '.stage{width:640px!important;height:288px!important;aspect-ratio:auto!important}' });
}
async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function imageHash(page: Page, path?: string) {
  await settle(page);
  return createHash('sha256').update(await page.getByTestId('transition-stage').screenshot({ path })).digest('hex');
}

for (const [id, label] of [['15', 'Shutters'], ['24', 'Pan'], ['20', 'Rearrange'], ['22', 'Stir']]) {
  test(`original Codrops ${label}: backwards seek and replay reproduce the same pixels`, async ({ page }, info) => {
    await open(page);
    expect(await page.evaluate(key => (window as PreviewWindow).transitionLab.selectEffect(key), `codrops:codrops-${id}`)).toBe(true);
    await page.evaluate(() => (window as PreviewWindow).transitionLab.seek(0.37));
    const expectedPath = info.outputPath('expected.png');
    const expected = await imageHash(page, expectedPath);
    const expectedPixels = decodePng(readFileSync(expectedPath));
    const domState = () => page.getByTestId('transition-stage').frameLocator('iframe').locator('.slide,.deco').evaluateAll(elements =>
      elements.map(element => ({ className: element.className, style: element.getAttribute('style'),
        transform: getComputedStyle(element).transform, opacity: getComputedStyle(element).opacity })));
    const expectedDom = await domState();
    const captured = [];
    for (const [step, progress] of [0.85, 0.12, 0.37, 1, 0, 0.37].entries()) {
      await page.evaluate(value => (window as PreviewWindow).transitionLab.seek(value), progress);
      const path = info.outputPath(`${step}-${progress}.png`);
      const sha256 = await imageHash(page, path);
      captured.push({ progress, sha256, dom: await domState(),
        difference: pixelDifference(expectedPixels, decodePng(readFileSync(path))) });
    }
    await info.attach('backwards-and-replay-pixels', { body: JSON.stringify({ expected, expectedDom, captured }), contentType: 'application/json' });
    for (const repeated of captured.filter(frame => frame.progress === 0.37)) {
      expect(repeated.dom).toEqual(expectedDom);
      // Identical transforms can rasterize a few antialiased shutter-edge pixels differently.
      // Measured baseline: 0.0011% changed pixels (>12 RGB) and 0.00017 mean channel error.
      expect(repeated.difference.changedFraction).toBeLessThan(0.0001);
      expect(repeated.difference.meanChannelError).toBeLessThan(0.005);
    }
    expect(captured.find(frame => frame.progress === 0)?.sha256).not.toBe(expected);
    expect(captured.find(frame => frame.progress === 1)?.sha256).not.toBe(expected);
    expect(await page.evaluate(() => (window as PreviewWindow).transitionLab.snapshot().error)).toBeFalsy();
  });
}

test('pending original GPU initialization is retired before rapid selection and Clear', async ({ page }) => {
  // Hold actual Three TextureLoader load callbacks, after its renderer and canvas exist.
  // This supplies a bounded, observable asynchronous GPU-init interval using local images.
  await page.addInitScript(() => {
    if (window.top === window) return;
    const create = document.createElementNS;
    document.createElementNS = function (namespace: string | null, name: string, options?: ElementCreationOptions) {
      const element = create.call(document, namespace, name, options);
      if (name === 'img') {
        const add = element.addEventListener.bind(element);
        element.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions) => {
          if (type !== 'load') { add(type, listener, options); return; }
          add(type, event => {
            const scope = window as PreviewWindow;
            scope.heldCodropsTextures = (scope.heldCodropsTextures ?? 0) + 1;
            window.setTimeout(() => {
              if (typeof listener === 'function') listener.call(element, event);
              else listener.handleEvent(event);
            }, 1200);
          }, options);
        }) as typeof element.addEventListener;
      }
      return element;
    } as typeof document.createElementNS;
  });
  await open(page);
  const beginPendingGpu = async () => {
    await page.evaluate(() => {
      const scope = window as PreviewWindow;
      scope.pendingCodrops = scope.transitionLab.selectEffect('codrops:codrops-17');
    });
    await expect(page.getByTestId('transition-stage').locator('iframe')).toHaveCount(1);
    const frame = await page.getByTestId('transition-stage').locator('iframe').elementHandle();
    const preview = await frame!.contentFrame();
    await preview!.waitForFunction(() => ((window as PreviewWindow).heldCodropsTextures ?? 0) > 0);
    expect(await preview!.locator('canvas').count()).toBe(1);
    expect(await page.evaluate(() => (window as PreviewWindow).transitionLab.snapshot().activeAdapters)).toBe(0);
  };
  await beginPendingGpu();
  expect(await page.evaluate(() => (window as PreviewWindow).transitionLab.selectEffect('codrops:codrops-24'))).toBe(true);
  expect(await page.evaluate(() => (window as PreviewWindow).pendingCodrops)).toBe(false);
  await expect(page.getByTestId('transition-stage').locator('iframe')).toHaveCount(1);
  expect(await page.getByTestId('transition-stage').locator('iframe').getAttribute('title')).toContain('Pan');
  await beginPendingGpu();
  await page.evaluate(() => (window as PreviewWindow).transitionLab.clear());
  expect(await page.evaluate(() => (window as PreviewWindow).pendingCodrops)).toBe(false);
  await expect(page.getByTestId('transition-stage').locator('iframe')).toHaveCount(0);
  await expect(page.getByTestId('transition-stage').locator('.transition-layer')).toHaveCount(0);
  expect(await page.evaluate(() => (window as PreviewWindow).transitionLab.snapshot().pendingFrames)).toBe(0);
  // The cancelled loader callbacks would otherwise fire at 1200 ms and revive old work.
  await page.waitForTimeout(1300);
  await expect(page.getByTestId('transition-stage').locator('iframe')).toHaveCount(0);
  expect(await page.evaluate(() => (window as PreviewWindow).transitionLab.selectEffect('codrops:codrops-15'))).toBe(true);
});

test('actual Codrops GPU context loss reaches a visible fallback and permits recovery', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true }));
  await open(page);
  expect(await page.evaluate(() => (window as PreviewWindow).transitionLab.selectEffect('codrops:codrops-18'))).toBe(true);
  const iframe = page.getByTestId('transition-stage').frameLocator('iframe');
  const lost = await iframe.locator('canvas').evaluate(canvas => new Promise<boolean>(resolve => {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) { resolve(false); return; }
    canvas.addEventListener('webglcontextlost', () => resolve(true), { once: true });
    extension.loseContext();
  }));
  expect(lost).toBe(true);
  await settle(page);
  await page.evaluate(() => (window as PreviewWindow).transitionLab.play(250));
  await expect.poll(() => page.evaluate(() => (window as PreviewWindow).transitionLab.snapshot().activeAdapters)).toBe(0);
  expect(await page.evaluate(() => (window as PreviewWindow).transitionLab.snapshot().error)).toMatch(/lost/i);
  await expect(page.getByTestId('transition-fallback')).toBeVisible();
  await expect(page.getByTestId('transition-stage').locator('iframe')).toHaveCount(0);
  expect(await page.evaluate(() => (window as PreviewWindow).transitionLab.snapshot().pendingFrames)).toBe(0);
  expect(await page.evaluate(() => (window as PreviewWindow).transitionLab.selectEffect('codrops:codrops-01'))).toBe(true);
});

test('unavailable original Codrops GPU reports failure without disguising a crossfade', async ({ page }) => {
  observations.get(page)!.expectedGpuFailure = true;
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof getContext>) {
      if (String(args[0]).startsWith('webgl') || args[0] === 'experimental-webgl') return null;
      return getContext.apply(this, args);
    } as typeof getContext;
  });
  await open(page);
  expect(await page.evaluate(() => (window as PreviewWindow).transitionLab.selectEffect('codrops:codrops-17'))).toBe(false);
  expect(await page.evaluate(() => (window as PreviewWindow).transitionLab.snapshot().error)).toBeTruthy();
  expect(await page.evaluate(() => (window as PreviewWindow).transitionLab.snapshot().activeAdapters)).toBe(0);
  await expect(page.getByTestId('transition-fallback')).toBeVisible();
  await expect(page.getByTestId('transition-stage').locator('iframe')).toHaveCount(0);
  expect(await page.evaluate(() => (window as PreviewWindow).transitionLab.selectEffect('codrops:codrops-01'))).toBe(true);
});

test('Codrops GSAP notice survives production asset copying', () => {
  const frame = readFileSync(resolve(compiledRoot, 'codrops-catalogue/frame.html'), 'utf8');
  expect(frame).toContain("connect-src 'none'");
  // The source-integrity test covers its exact bytes. This check ensures the notice
  // is also present in the emitted, untransformed local runtime used by the browser.
  const source = readFileSync(resolve('transition-lab/codrops-catalogue/vendor/js/gsap.min.js'), 'utf8');
  const emitted = readdirSync(resolve(compiledRoot, 'assets')).find(name => /^gsap\.min-.*\.js$/.test(name));
  expect(emitted).toBeTruthy();
  expect(readFileSync(resolve(compiledRoot, 'assets', emitted!), 'utf8')).toBe(source);
  expect(source.slice(0, 300)).toContain('GSAP 3.15.0');
  expect(source.slice(0, 300)).toContain('https://gsap.com/standard-license');
});
