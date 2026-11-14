import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { difference, pixels } from './backgroundTransitionPixels';
import { fileURLToPath } from 'node:url';
import { observeVideos } from './backgroundVideoObservation';

interface CoreApi {
  mount(effect: string, pair: string): Promise<{ canPlayMp4: string; canPlayWebM: string }>;
  seek(progress: number): { from: string; to: string; time: number | null };
  disposeAdapter(): Promise<number>; clear(): Promise<void>;
}
declare global { interface Window { videoCore: CoreApi } }
const root = fileURLToPath(new URL('../.playwright/video-core', import.meta.url));
const decoded = (value: string) => pixels(Buffer.from(value.split(',')[1], 'base64'));
for (const effect of ['gl-transitions:WaterDrop', 'curtains:wave']) for (const pair of ['image-video', 'video-image', 'video-video']) {
  test(`production core ${effect} ${pair} preserves endpoints and decoded-frame motion`, async ({ page }, info) => {
    const blocked: string[] = [], errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await observeVideos(page);
    await page.routeWebSocket(/.*/, route => { blocked.push(route.url()); route.close(); });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://127.0.0.1:19443') { blocked.push(url.href); return route.abort(); }
      const path = resolve(root, url.pathname === '/' ? 'index.html' : '.' + decodeURIComponent(url.pathname));
      return path.startsWith(root + sep) && existsSync(path) ? route.fulfill({ path }) : route.fulfill({ status: 404 });
    });
    await page.goto('http://127.0.0.1:19443/'); await page.waitForFunction(() => !!window.videoCore);
    const codecs = await page.evaluate(([key, kind]) => window.videoCore.mount(key, kind), [effect, pair]);
    expect(codecs.canPlayMp4).not.toBe(''); expect(codecs.canPlayWebM).not.toBe('');
    const backend = await page.locator('#stage canvas[data-picture-transition-renderer]').evaluate(element => {
      const canvas = element as HTMLCanvasElement;
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (!gl) throw new Error('The owned transition context is unavailable');
      const detail = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = String(gl.getParameter(detail ? detail.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      return { api: gl instanceof WebGL2RenderingContext ? 'WebGL2' : 'WebGL1', renderer,
        unmasked: !!detail, software: detail ? /swiftshader|llvmpipe|software|basic render/i.test(renderer) : null,
        version: String(gl.getParameter(gl.VERSION)), userAgent: navigator.userAgent };
    });
    const initial = await page.evaluate(() => window.videoCore.seek(0));
    const start = pixels(await page.locator('#stage').screenshot({ path: info.outputPath('source-start.png') }));
    expect(difference(start, decoded(initial.from))).toBeLessThan(8);
    const first = await page.evaluate(() => window.videoCore.seek(0.6));
    const middle1 = pixels(await page.locator('#stage').screenshot({ path: info.outputPath('fixed-progress-1.png') }));
    await page.waitForTimeout(450);
    const second = await page.evaluate(() => window.videoCore.seek(0.6));
    const middle2 = pixels(await page.locator('#stage').screenshot({ path: info.outputPath('fixed-progress-2.png') }));
    const metrics = { startError: difference(start, decoded(initial.from)), sourceDelta: difference(decoded(first.to), decoded(second.to)),
      fixedProgressDelta: difference(middle1, middle2), mediaTimeAdvance: second.time === null ? null : second.time - first.time! };
    if (pair.endsWith('video')) {
      expect(second.time! - first.time!).toBeGreaterThan(0.25);
      expect(difference(decoded(first.to), decoded(second.to))).toBeGreaterThan(1);
      expect(difference(middle1, middle2)).toBeGreaterThan(0.5);
    } else expect(difference(middle1, middle2)).toBeLessThan(0.2);
    const final = await page.evaluate(() => window.videoCore.seek(1));
    const end = pixels(await page.locator('#stage').screenshot({ path: info.outputPath('source-end.png') }));
    expect(difference(end, decoded(final.to))).toBeLessThan(8);
    expect(difference(start, middle1)).toBeGreaterThan(1);
    const before = await page.evaluate(() => window.videoObservation());
    expect(await page.evaluate(() => window.videoCore.disposeAdapter())).toBe(0);
    const after = await page.evaluate(() => window.videoObservation());
    const lifecycle = (events: typeof after.events) => events.filter(event => ['play', 'pause', 'load', 'src', 'retire'].includes(event.action));
    expect(lifecycle(after.events)).toEqual(lifecycle(before.events));
    expect(after.peakSources).toBeLessThanOrEqual(1);
    await page.evaluate(() => window.videoCore.clear());
    expect((await page.evaluate(() => window.videoObservation())).videos.every(video => !video.src && video.paused)).toBe(true);
    await info.attach('video-core-evidence', { contentType: 'application/json', body: JSON.stringify({ effect, pair, codecs,
      backend, browserVersion: page.context().browser()?.version(), metrics: { ...metrics, endError: difference(end, decoded(final.to)) }, before, after }) });
    expect(blocked).toEqual([]); expect(errors).toEqual([]);
  });
}
