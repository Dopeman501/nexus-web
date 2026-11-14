import { expect, type Page, type Route, type WebSocketRoute } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { PanelDevicePatch, PanelDeviceRecord } from '../src/api/panel';
import type { BackgroundMediaItem } from '../src/api/panelBackgroundMedia';
import type { D215PanelBackground } from '../src/panel/d215/d215PanelBackground';

export const sound = { level: 0.8, bass: 0.05, beat: 0 };
export const kick = { level: 0.8, bass: 0.8, beat: 1 };
export const quiet = { level: 0, bass: 0, beat: 0 };
export const fixtureId = 'transition-fixture';
export const durationMs = 2200;
const colors: Record<string, [string, string]> = {
  normal: ['#a21235', '#ffd46b'], next: ['#072b96', '#76eeff'],
  'audio-a': ['#075a9e', '#ff8d34'], 'audio-b': ['#075e28', '#f2f15c'], preview: ['#7a1d8f', '#a5f2a1'],
};
export function picture(id: string) {
  const [base, accent] = colors[id] ?? colors.normal;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="540"><rect width="1200" height="540" fill="${base}"/><path d="M0 0L1200 540H700L0 200Z" fill="${accent}"/><circle cx="910" cy="160" r="105" fill="${accent}"/><rect x="140" y="330" width="260" height="120" fill="${accent}"/></svg>`;
}
const animatedGif = Buffer.from('47494638396101000100800000ff00000000ff21ff0b4e45545343415045322e30030100000021f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b', 'hex');
const mediaItem = (id: string, index: number): BackgroundMediaItem => ({ id, name: `${id}.svg`, sourceExt: '.svg',
  type: 'static', width: 1200, height: 540, importedAtUnixMs: index + 1, durationSec: 0, alpha: false });
export interface FixtureMedia { body: Buffer; contentType: string; delayMs?: number }
async function mediaResponse(route: Route, media: FixtureMedia) {
  if (media.delayMs) await new Promise(resolve => setTimeout(resolve, media.delayMs));
  const range = route.request().headers().range;
  if (!range) return route.fulfill({ body: media.body, contentType: media.contentType, headers: { 'Accept-Ranges': 'bytes' } });
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  const length = media.body.length;
  const start = match?.[1] ? Number(match[1]) : match?.[2] ? Math.max(0, length - Number(match[2])) : -1;
  const end = match?.[1] && match?.[2] ? Math.min(length - 1, Number(match[2])) : length - 1;
  if (!match || start < 0 || start > end) return route.fulfill({ status: 416, headers: { 'Content-Range': `bytes */${length}` } });
  return route.fulfill({ status: 206, body: media.body.subarray(start, end + 1), contentType: media.contentType,
    headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${length}` } });
}

export function seed(effect = 'gl-transitions:WaterDrop'): PanelDeviceRecord {
  return { id: fixtureId, displayName: 'Jungle Leopard D215', streamed: true, portrait: false,
    firstSeenAt: 1, lastSeenAt: 1, themeMode: 'dark', themeSyncWithDesktop: false, backdrop: 'theme',
    backgroundMode: 'media', backgroundColor: '#101010', backgroundOpacity: 1, backgroundFrostLevel: 0,
    backgroundMediaId: 'normal', backgroundMediaType: 'static', backgroundMediaAlpha: false,
    backgroundMediaSlideshow: false, backgroundMediaInterval: 5, backgroundMediaShuffle: false,
    backgroundMediaFinishVideos: false, backgroundMediaOrder: ['normal', 'next'],
    backgroundMediaTransition: { effect, durationMs }, backgroundAudioTriggerTransition: { effect, durationMs },
    backgroundAudioTrigger: { enabled: true, intensity: 50, switchDelay: 0.3, shuffle: false, backgrounds: [
      { mode: 'media', mediaId: 'audio-a', mediaType: 'static', opacity: 1 },
      { mode: 'media', mediaId: 'audio-b', mediaType: 'static', opacity: 1 },
    ] },
    capabilities: { surface: 'lcd-wide', family: 'jungle-leopard-d215', cssWidth: 1680, cssHeight: 756,
      dpr: 1, touch: false, supportsPortrait: true },
    layout: { layoutSchemaVersion: 2, surface: 'lcd-wide', pages: [{ id: 'main', widgets: [] }],
      d215Widget: { enabled: false, x: 0.5, y: 0.5, scale: 1 }, d215Panels: { enabled: false, items: [] } },
  };
}

export function createProductionFixtureState(initial = seed()) {
  return { record: initial, library: ['normal', 'next'].map(mediaItem), writes: [] as PanelDevicePatch[],
    previewWrites: [] as unknown[], blocked: [] as string[], errors: [] as string[], warnings: [] as string[], video: Buffer.alloc(0) as Buffer,
    media: new Map<string, FixtureMedia>(), mediaRequests: [] as { id: string; range?: string }[] };
}
export type ProductionFixtureState = ReturnType<typeof createProductionFixtureState>;
export interface ProductionFixtureBus {
  send(topic: string, data: unknown): void;
  subscribe(deliver: (topic: string, data: unknown) => void): () => void;
}
export function createProductionFixtureBus(): ProductionFixtureBus {
  const receivers = new Set<(topic: string, data: unknown) => void>();
  return {
    send: (topic, data) => receivers.forEach(deliver => deliver(topic, data)),
    subscribe(deliver) { receivers.add(deliver); return () => { receivers.delete(deliver); }; },
  };
}
interface ProductionFixtureOptions {
  state?: ProductionFixtureState;
  bus?: ProductionFixtureBus;
  /** Optional isolated routes return true after fulfilling/aborting their request. */
  additionalRoute?: (route: Route) => Promise<boolean>;
}

export async function productionFixture(page: Page, initial = seed(), options: ProductionFixtureOptions = {}) {
  // Asset files are read directly; even installed acceptance never opens a service connection.
  const root = resolve(process.env.BACKGROUND_TRANSITIONS_ASSET_ROOT ?? process.env.D215_DIST ?? 'dist');
  if (!existsSync(resolve(root, 'index.html'))) throw new Error('Build the production dashboard first.');
  const buildHash = createHash('sha256').update(readFileSync(resolve(root, 'index.html'))).digest('hex');
  const expectedHash = process.env.BACKGROUND_TRANSITIONS_EXPECTED_INDEX_SHA256;
  if (expectedHash && (!/^[a-f\d]{64}$/i.test(expectedHash) || buildHash !== expectedHash.toLowerCase())) {
    throw new Error('The read-only transition acceptance asset root does not match the expected dashboard.');
  }
  const state = options.state ?? createProductionFixtureState(initial);
  const sockets = new Set<{ route: WebSocketRoute; topics: Set<string> }>();
  let revision = 0;
  let preview: unknown = null;
  page.on('pageerror', error => state.errors.push(error.message));
  page.on('console', message => { if (['warning', 'error'].includes(message.type()) && state.warnings.length < 30) state.warnings.push(message.text()); });
  await page.addInitScript(() => {
    localStorage.setItem('nexus_token', 'isolated-transition-fixture');
    localStorage.setItem('nexus_settings', JSON.stringify({ general: { language: 'en', themeMode: 'dark' } }));
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true,
      value: { getRegistrations: async () => [], controller: null } });
    const observed = new WeakSet<HTMLCanvasElement>();
    let added = 0, peak = 0;
    new MutationObserver(() => {
      const canvases = document.querySelectorAll('canvas');
      canvases.forEach(canvas => { if (!observed.has(canvas)) { observed.add(canvas); added++; } });
      peak = Math.max(peak, canvases.length);
      if (document.documentElement) {
        document.documentElement.dataset.fixtureCanvasesAdded = String(added);
        document.documentElement.dataset.fixtureCanvasesPeak = String(peak);
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.routeWebSocket(/.*/, route => {
    if (new URL(route.url()).pathname !== '/ws') { state.blocked.push(route.url()); route.close(); return; }
    const socket = { route, topics: new Set<string>() };
    sockets.add(socket);
    route.onClose(() => sockets.delete(socket));
    route.onMessage(message => {
      const frame = JSON.parse(String(message)) as { sub?: string[]; unsub?: string[] };
      frame.sub?.forEach(topic => socket.topics.add(topic));
      frame.unsub?.forEach(topic => socket.topics.delete(topic));
    });
  });
  const deliver = (topic: string, data: unknown) => sockets.forEach(socket => {
    if (socket.topics.has(topic)) socket.route.send(JSON.stringify({ t: topic, d: data }));
  });
  const send = options.bus ? options.bus.send : deliver;
  const releaseBus = options.bus?.subscribe(deliver);
  page.on('close', () => releaseBus?.());
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const json = (body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (!['my.localhost', 'localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '9400') {
      state.blocked.push(url.origin + path); return route.abort();
    }
    if (options.additionalRoute && await options.additionalRoute(route)) return;
    const media = /\/background-media\/([^/]+)\/(file|thumbnail)$/.exec(path);
    if (media) {
      const id = decodeURIComponent(media[1]);
      const custom = state.media.get(id);
      if (custom && media[2] === 'file') {
        state.mediaRequests.push({ id, range: request.headers().range });
        return mediaResponse(route, custom);
      }
      if (id === 'gif') return route.fulfill({ contentType: 'image/gif', body: animatedGif });
      if (id === 'video') return route.fulfill({ contentType: 'video/webm', body: state.video });
      return route.fulfill({ contentType: 'image/svg+xml', body: picture(id) });
    }
    if (request.resourceType() === 'document' || path.startsWith('/assets/') || !['fetch', 'xhr'].includes(request.resourceType())) {
      const file = resolve(root, request.resourceType() === 'document' ? 'index.html' : `.${decodeURIComponent(path)}`);
      return file.startsWith(root + sep) && existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }
    if (path === '/ping') return json({ service: 'nexus', version: 'isolated-production-transitions', initialized: true, platform: 'windows' });
    if (path === '/pair') return json({ token: 'isolated-transition-fixture' });
    if (path === '/onboarding') return json({ completed: true });
    if (path === '/preferences') return json({ theme: { language: 'en', themeMode: 'dark' }, language: 'en', themeMode: 'dark' });
    if (path === '/profiles') return json({ profiles: [{ id: 'default', name: 'Default' }], activeId: 'default' });
    if (path === '/defaults') return json({ panel: { layouts: {} } });
    if (path === '/apps-api/installed') return json({ apps: [] });
    if (path === '/diagnostics/client-mem') return json({ ok: true });
    if (path.startsWith('/telemetry/page-viewed/')) return json({ ok: true });
    if (path === '/session/last-route') return json(request.method() === 'POST' ? request.postDataJSON() : null);
    if (path === '/devices/all') return json([{ id: 'jungle-leopard-d215', name: state.record.displayName,
      category: 'display', connected: true, nexusControlEnabled: true, supportsNexusControl: true }]);
    if (path === '/panel/devices') return json({ devices: [state.record] });
    if (path.endsWith('/background-media/library')) return json({ items: state.library });
    if (path === `/panel/devices/${fixtureId}/d215-brightness`) return json({ status: 'confirmed', value: 100 });
    if (path === `/panel/devices/${fixtureId}/audio-trigger-preview`) {
      if (request.method() === 'POST') state.previewWrites.push(request.postDataJSON());
      return json(preview);
    }
    if (path === `/panel/devices/${fixtureId}/transition-preview` && request.method() === 'GET') return json(null);
    if (path === `/panel/devices/${fixtureId}`) {
      if (request.method() === 'POST') {
        const patch = request.postDataJSON() as PanelDevicePatch;
        state.writes.push(patch); state.record = { ...state.record, ...patch } as PanelDeviceRecord;
      }
      return json(state.record);
    }
    if (request.method() !== 'GET') state.blocked.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 404, body: '' });
  });
  const sustain = async (data: unknown, milliseconds: number) => {
    for (let elapsed = 0; elapsed < milliseconds; elapsed += 50) { send('audio', data); await page.waitForTimeout(50); }
  };
  return { state, sockets, sustain, sound: (data: unknown) => send('audio', data),
    disconnect() { sockets.forEach(socket => socket.route.close()); sockets.clear(); },
    buildHash, assetRoot: root, target: process.env.BACKGROUND_TRANSITIONS_TARGET ?? 'production',
    changed: () => send('panel/device', { deviceId: fixtureId }),
    preview(background: D215PanelBackground | null, ttlMs = 6000) {
      preview = { deviceId: fixtureId, sessionId: '00000000-0000-0000-0000-000000000001',
        sequence: ++revision, revision, background, expiresAtUnixMs: Date.now() + ttlMs };
      send('panel/audio-trigger-preview', preview);
    },
    async open() {
      await page.goto(`/panel/${fixtureId}`);
      await expect(page.locator('.panel-root')).toBeVisible();
      await expect(page.locator('[data-panel-bg-layer] img[src*="/normal/file"]').first()).toBeVisible();
      await page.waitForTimeout(500);
    },
    async audioReady() { await expect.poll(() => [...sockets].some(socket => socket.topics.has('audio'))).toBe(true); },
    async check() { expect(state.errors).toEqual([]); expect(state.blocked).toEqual([]); },
  };
}

/** Actual browser encoder supplies a decodable clip; no media events are synthesized. */
export async function makeVideo(page: Page): Promise<Buffer> {
  const data = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 36;
    const context = canvas.getContext('2d')!;
    const stream = canvas.captureStream(15);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
    recorder.start();
    let frame = 0;
    const draw = () => {
      context.fillStyle = frame++ % 2 ? '#1a7eac' : '#e59921'; context.fillRect(0, 0, 80, 36);
    };
    draw(); const drawing = setInterval(draw, 50);
    await new Promise(resolve => setTimeout(resolve, 650)); clearInterval(drawing); recorder.stop(); await stopped;
    stream.getTracks().forEach(track => track.stop());
    const blob = new Blob(chunks, { type: recorder.mimeType });
    const clip = document.createElement('video'); clip.muted = true; clip.src = URL.createObjectURL(blob);
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Generated video fixture did not decode')), 3000);
        clip.oncanplay = () => { clearTimeout(timeout); resolve(); };
        clip.onerror = () => { clearTimeout(timeout); reject(new Error('Generated video fixture was invalid')); };
        clip.load();
      });
    } finally { URL.revokeObjectURL(clip.src); clip.removeAttribute('src'); clip.load(); }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return btoa(String.fromCharCode(...bytes));
  });
  return Buffer.from(data, 'base64');
}
