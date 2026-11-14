import { expect, type Page, type Route } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  createProductionFixtureBus, createProductionFixtureState, fixtureId, productionFixture, seed,
} from './backgroundTransitionsFixture';
import type { PanelDeviceRecord } from '../src/api/panel';

export interface SharedSettings { enabled: boolean; effects: string[]; durationMs: number }
export interface TransitionPreview { previewId: string; effect: string; durationMs: number }
export interface TransitionPreviewRequest { sessionId: string; sequence: number; preview: TransitionPreview | null }
export interface TransitionPreviewFrame extends TransitionPreviewRequest {
  deviceId: string; revision: number; startedAtUnixMs: number; expiresAtUnixMs: number;
}
export type SharedRecord = PanelDeviceRecord & { backgroundTransitions?: SharedSettings };
export const sharedEffects = ['gl-transitions:WaterDrop', 'curtains:wave'];
export function sharedSeed(settings: Partial<SharedSettings> = {}): SharedRecord {
  return { ...seed('none'), backgroundTransitions: {
    enabled: true, effects: [...sharedEffects], durationMs: 1300, ...settings,
  } };
}
export interface SharedTransitionEvent { effect: string; channel: string; at: number }
declare global { interface Window { sharedTransitionEvents(): SharedTransitionEvent[] } }

/** Isolated in-memory host shared by dashboard, its real simulator iframe and a device page. */
export class SharedTransitionHost {
  readonly bus = createProductionFixtureBus();
  readonly state;
  readonly fixtures: Awaited<ReturnType<typeof productionFixture>>[] = [];
  readonly previewRequests: TransitionPreviewRequest[] = [];
  readonly failedPreviewRequests: TransitionPreviewRequest[] = [];
  readonly previewFrames: TransitionPreviewFrame[] = [];
  failNextPreviewPosts = 0;
  delayNextPreviewPostMs = 0;
  delayNextPreviewGetMs = 0;
  dropPreviewPushes = false;
  private current: TransitionPreviewFrame | null = null;
  private revision = 0;

  constructor(initial: SharedRecord = sharedSeed()) { this.state = createProductionFixtureState(initial); }
  get record() { return this.state.record as SharedRecord; }
  set record(record: SharedRecord) { this.state.record = record; }
  get preview() { return this.current; }
  changed() { this.bus.send('panel/device', { deviceId: fixtureId }); }
  publish(frame: TransitionPreviewFrame) {
    this.current = frame;
    this.previewFrames.push(frame);
    if (!this.dropPreviewPushes) this.bus.send('panel/transition-preview', frame);
  }
  externalPreview(effect: string, durationMs = 1300, remainingMs?: number) {
    const startedAtUnixMs = Date.now() + 150;
    const frame: TransitionPreviewFrame = { deviceId: fixtureId, sessionId: randomUUID(), sequence: 1,
      preview: { previewId: randomUUID(), effect, durationMs }, revision: ++this.revision,
      startedAtUnixMs, expiresAtUnixMs: remainingMs === undefined ? startedAtUnixMs + durationMs + 6000 : Date.now() + remainingMs };
    this.publish(frame); return frame;
  }
  rawPush(frame: TransitionPreviewFrame) { this.bus.send('panel/transition-preview', frame); }
  async attach(page: Page) {
    await page.addInitScript(() => {
      const events: SharedTransitionEvent[] = [];
      const seen = new WeakMap<Element, string>();
      new MutationObserver(() => {
        document.querySelectorAll('[data-transition-effect]').forEach(element => {
          const effect = element.getAttribute('data-transition-effect') ?? '';
          if (!effect || seen.get(element) === effect) return;
          seen.set(element, effect);
          events.push({ effect, at: performance.now(), channel: element.closest('[data-background-transition-preview]') ? 'preview'
            : element.closest('[data-slideshow-picture-transition]') ? 'slideshow' : 'audio' });
        });
      }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-transition-effect'] });
      window.sharedTransitionEvents = () => [...events];
    });
    const fixture = await productionFixture(page, this.record, { state: this.state, bus: this.bus,
      additionalRoute: route => this.handlePreview(route) });
    this.fixtures.push(fixture); return fixture;
  }
  async check() {
    for (const fixture of this.fixtures) await fixture.check();
    expect(this.state.writes.every(patch => Object.keys(patch).every(key => key === 'backgroundTransitions'))).toBe(true);
  }
  private async handlePreview(route: Route): Promise<boolean> {
    const request = route.request();
    if (new URL(request.url()).pathname !== `/panel/devices/${fixtureId}/transition-preview`) return false;
    const respond = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
    if (request.method() === 'GET') {
      const snapshot = this.current && this.current.expiresAtUnixMs > Date.now() ? this.current : null;
      const delay = this.delayNextPreviewGetMs; this.delayNextPreviewGetMs = 0;
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      await respond(snapshot); return true;
    }
    if (request.method() !== 'POST') { await respond(null, 405); return true; }
    const body = request.postDataJSON() as TransitionPreviewRequest;
    this.previewRequests.push(body);
    if (this.failNextPreviewPosts > 0) {
      this.failNextPreviewPosts--; this.failedPreviewRequests.push(body);
      await respond({ error: true, message: 'preview unavailable' }, 503); return true;
    }
    const delay = this.delayNextPreviewPostMs; this.delayNextPreviewPostMs = 0;
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (this.current?.sessionId === body.sessionId && body.sequence <= this.current.sequence) {
      await respond({ error: true, message: 'superseded' }, 409); return true;
    }
    const startedAtUnixMs = body.preview ? Date.now() + 150 : 0;
    const frame = { ...body, deviceId: fixtureId, revision: ++this.revision, startedAtUnixMs,
      expiresAtUnixMs: body.preview ? startedAtUnixMs + body.preview.durationMs + 6000 : Date.now() };
    this.publish(frame); await respond(frame); return true;
  }
}

export async function openSharedBackground(page: Page) {
  await page.goto('/');
  await page.locator('[class*="sidebarColumn"]').getByRole('button', { name: 'Jungle Leopard D215' }).first().click();
  await page.getByRole('tab', { name: 'Background', exact: true }).click();
}
export async function openSharedPicker(page: Page) {
  await page.getByRole('button', { name: 'Transitions', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Transitions', exact: true });
  await expect(picker).toBeVisible(); return picker;
}
