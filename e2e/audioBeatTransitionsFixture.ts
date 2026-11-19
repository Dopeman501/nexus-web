import { expect, type Page, type Route } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PanelDeviceRecord } from '../src/api/panel';
import { fixtureId, productionFixture, seed, sound, kick } from './backgroundTransitionsFixture';
import type { AudioSnapshot } from '../src/hooks/useAudioState';

export interface AudioBeatRecord extends PanelDeviceRecord {
  backgroundTransitions: { enabled: boolean; effects: string[]; durationMs: number };
  backgroundAudioTriggerBeatTransition: { enabled: boolean; durationMs: number };
}
export interface AudioBeatTransitionEvent { effect: string; startedAt: number; endedAt: number | null; opacityAtEnd?: number | null }
export interface AudioBeatCanvasCapture { role: string; width: number; height: number; litPixels: number; pixels: number; error?: string }
declare global { interface Window {
  audioBeatTransitionEvents(): AudioBeatTransitionEvent[];
  audioBeatCanvasCaptures(): AudioBeatCanvasCapture[];
} }
export const audioBeatSound: AudioSnapshot = { ...sound, mid: 0.3, high: 0.15,
  spectrum: Array.from({ length: 16 }, (_, index) => 0.2 + index / 80),
  spectrum64: Array.from({ length: 64 }, (_, index) => 0.1 + index / 160) };
export const audioBeatKick: AudioSnapshot = { ...audioBeatSound, ...kick };

export function audioBeatSeed({ effect = 'gl-transitions:WaterDrop', main = true, beat = true,
  mainDuration = 2800, beatDuration = 600 }: {
  effect?: string; main?: boolean; beat?: boolean; mainDuration?: number; beatDuration?: number;
} = {}): AudioBeatRecord {
  return { ...seed('none'), backgroundMode: 'solid', backgroundColor: '#b21848',
    backgroundTransitions: { enabled: main, effects: [effect], durationMs: mainDuration },
    backgroundAudioTriggerBeatTransition: { enabled: beat, durationMs: beatDuration },
    backgroundAudioTrigger: { enabled: true, intensity: 50, switchDelay: 0.3, shuffle: false,
      backgrounds: [{ mode: 'shader', effect: 'scope', template: 0, opacity: 1, frost: 0 },
        { mode: 'shader', effect: 'rainbow', template: 0, opacity: 1, frost: 0 }] } };
}

/** Times actual production transition stages. All HTTP/socket traffic is intercepted by productionFixture. */
export async function audioBeatFixture(page: Page, record = audioBeatSeed(), additionalRoute?: (route: Route) => Promise<boolean>) {
  await page.addInitScript(() => {
    const events: AudioBeatTransitionEvent[] = [];
    const captures: AudioBeatCanvasCapture[] = [];
    const sampled = new WeakSet<object>();
    const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;
    // Observe only the first live-canvas copy per destination. The original draw
    // always runs unchanged; the bounded scratch buffer never enters the DOM.
    CanvasRenderingContext2D.prototype.drawImage = function (source: CanvasImageSource, ...coordinates: number[]) {
      Reflect.apply(originalDrawImage, this, [source, ...coordinates]);
      if (!(source instanceof HTMLCanvasElement) || sampled.has(this.canvas) || captures.length >= 32) return;
      sampled.add(this.canvas);
      const role = source.closest('[data-audio-trigger-background]') ? 'audio'
        : source.closest('[data-panel-bg-layer]') ? 'normal' : 'derived';
      const capture: AudioBeatCanvasCapture = { role, width: this.canvas.width, height: this.canvas.height, litPixels: 0, pixels: 0 };
      try {
        const scratch = document.createElement('canvas'); scratch.width = 64; scratch.height = 29;
        const context = scratch.getContext('2d')!;
        Reflect.apply(originalDrawImage, context, [this.canvas, 0, 0, scratch.width, scratch.height]);
        const values = context.getImageData(0, 0, scratch.width, scratch.height).data;
        capture.pixels = values.length / 4;
        for (let index = 0; index < values.length; index += 4) {
          if (values[index] + values[index + 1] + values[index + 2] > 24 && values[index + 3] > 0) capture.litPixels++;
        }
      } catch (error) { capture.error = String(error).slice(0, 200); }
      captures.push(capture);
    };
    const stages = new Map<Element, AudioBeatTransitionEvent>();
    new MutationObserver(() => {
      for (const stage of document.querySelectorAll('[data-background-picture-hold] [data-transition-effect]')) {
        if (stages.has(stage)) continue;
        const event = { effect: stage.getAttribute('data-transition-effect') ?? '', startedAt: performance.now(), endedAt: null };
        stages.set(stage, event); events.push(event);
      }
      for (const [stage, event] of stages) {
        if (!stage.isConnected && event.endedAt === null) {
          event.endedAt = performance.now();
          const shader = document.querySelector('[data-audio-trigger-background] [data-panel-bg-layer][data-ready]');
          event.opacityAtEnd = shader ? Number(getComputedStyle(shader).opacity) : null;
        }
      }
    }).observe(document, { subtree: true, childList: true });
    window.audioBeatTransitionEvents = () => events.map(event => ({ ...event }));
    window.audioBeatCanvasCaptures = () => captures.map(capture => ({ ...capture }));
  });
  const shaderRoot = resolve('../nexus-service/src/Lighting/Engine/Gpu/Shaders');
  const prelude = readFileSync(resolve(shaderRoot, '_prelude.frag'), 'utf8');
  const shaders = Object.fromEntries(['scope', 'rainbow', 'plasma'].map(effect => [effect,
    prelude + '\n' + readFileSync(resolve(shaderRoot, `${effect}.frag`), 'utf8')]));
  const shaderHashes = Object.fromEntries(Object.entries(shaders)
    .map(([effect, source]) => [effect, createHash('sha256').update(source).digest('hex')]));
  const fixture = await productionFixture(page, record, { additionalRoute: async route => {
    if (additionalRoute && await additionalRoute(route)) return true;
    const request = route.request();
    if (request.method() !== 'GET') return false;
    const path = new URL(request.url()).pathname;
    const effect = /^\/lighting\/shaders\/(scope|rainbow|plasma)$/.exec(path)?.[1];
    if (effect) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ frag: shaders[effect] }) }); return true;
    }
    if (path === '/lighting/music-reactive') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ enabled: true }) }); return true;
    }
    return false;
  } });
  return { ...fixture,
    shaderHashes,
    async openSolid() {
      await page.goto(`/panel/${fixtureId}`);
      await expect(page.locator('.panel-root')).toBeVisible();
      await expect(page.locator('.panel-root')).toHaveCSS('--panel-background-solid', '#b21848');
      await fixture.audioReady();
      await expect.poll(() => [...fixture.sockets].some(socket => socket.topics.has('panel/audio-trigger-preview'))).toBe(true);
      await page.waitForTimeout(400);
    },
    pump() { const timer = setInterval(() => fixture.sound(audioBeatSound), 50); return () => clearInterval(timer); },
  };
}
export const beatEvents = (page: Page) => page.evaluate(() => window.audioBeatTransitionEvents());
export const beatCanvas = (page: Page) => page.locator('[data-background-picture-hold] canvas[data-picture-transition-renderer]');
export async function completedDuration(page: Page, index: number) {
  await expect.poll(async () => (await beatEvents(page))[index]?.endedAt, { timeout: 6000 }).toEqual(expect.any(Number));
  const event = (await beatEvents(page))[index];
  return event.endedAt! - event.startedAt;
}
