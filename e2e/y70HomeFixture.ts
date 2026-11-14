import { expect, type Page, type Route } from '@playwright/test';
import type { PanelDeviceRecord } from '../src/api/panel';
import type { PanelLayout } from '../src/panel/types';
import {
  createProductionFixtureBus, createProductionFixtureState, fixtureId, productionFixture,
} from './backgroundTransitionsFixture';

export const Y70_NAME = 'HYTE Y70 Touch Infinite';
export const homeFixtureId = fixtureId;
export function homeSeed(): PanelDeviceRecord {
  return {
    id: fixtureId, displayName: Y70_NAME, firstSeenAt: 1, lastSeenAt: 1,
    themeMode: 'dark', themeSyncWithDesktop: false, backdrop: 'theme', backgroundMode: 'solid',
    backgroundColor: '#142b43', backgroundOpacity: 1, accentColor: '#ff4141',
    capabilities: { surface: 'y70', touch: true, cssWidth: 1100, cssHeight: 3840, dpi: 337, dpr: 1 },
    layout: {
      layoutSchemaVersion: 2, surface: 'y70', activePageId: 'away', homePageId: 'home',
      pages: ['first', 'home', 'away'].map((id, index) => ({ id,
        widgets: [{ id: `clock-${id}`, type: 'clock', size: '4x2', col: 0, row: 0,
          config: { format24h: index !== 0, showSeconds: index === 1 } }],
      })),
    },
  };
}

export class Y70HomeHost {
  readonly state;
  readonly bus = createProductionFixtureBus();
  readonly fixtures: Awaited<ReturnType<typeof productionFixture>>[] = [];
  readonly saveAttempts: PanelLayout[] = [];
  readonly recordRequests: { method: string; at: number; savedPage: string | undefined; requestedPage?: string }[] = [];
  failNextHomeSave = false;
  delayNextHomeSaveMs = 0;
  constructor(record = homeSeed()) { this.state = createProductionFixtureState(record); }
  get record() { return this.state.record; }

  async attach(page: Page) {
    // Reuse the proven disk-only production router. The wrapper requires an
    // explicit root/hash, including for iframe requests; no live server starts.
    if (!process.env.Y70_HOME_ASSET_ROOT || !process.env.Y70_HOME_EXPECTED_INDEX_SHA256) {
      throw new Error('Missing explicit Y70 Home build identity.');
    }
    process.env.BACKGROUND_TRANSITIONS_ASSET_ROOT = process.env.Y70_HOME_ASSET_ROOT;
    process.env.BACKGROUND_TRANSITIONS_EXPECTED_INDEX_SHA256 = process.env.Y70_HOME_EXPECTED_INDEX_SHA256;
    await page.addInitScript(() => {
      const observation = { frames: [] as string[] };
      Object.assign(window, { y70HomeObservation: observation });
      const sample = () => {
        const active = document.querySelector('.panel-root [data-panel-page-id][aria-hidden="false"]');
        if (active && observation.frames.length < 24) observation.frames.push(active.getAttribute('data-panel-page-id') ?? '');
        if (observation.frames.length < 24) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const fixture = await productionFixture(page, this.record, {
      state: this.state, bus: this.bus, additionalRoute: route => this.route(route),
    });
    this.fixtures.push(fixture);
    return fixture;
  }

  private async route(route: Route): Promise<boolean> {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === `/panel/devices/${fixtureId}` && this.recordRequests.length < 64) this.recordRequests.push({
      method: request.method(), at: Date.now(), savedPage: this.record.layout?.activePageId,
      requestedPage: request.method() === 'POST' ? (request.postDataJSON() as { layout?: PanelLayout }).layout?.activePageId : undefined,
    });
    const json = async (body: unknown, status = 200) => {
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      return true;
    };
    if (path === '/devices/all') return json([{ id: 'y70', name: Y70_NAME, category: 'display', connected: true }]);
    if (path === '/preferences') return json({ language: 'en', themeMode: 'dark',
      general: { language: 'en', themeMode: 'dark' }, panel: { autoLaunch: true, reserveMonitor: true } });
    if (path === '/panel/status') return json({ msg: 'running', kioskRunning: true, phoneConnected: false, phoneSubscribers: 0 });
    if (path === '/displays') return json({ displays: [] });
    if (path === `/panel/devices/${fixtureId}` && request.method() === 'POST') {
      const patch = request.postDataJSON() as { layout?: PanelLayout };
      if (patch.layout && patch.layout.homePageId !== this.record.layout?.homePageId) {
        this.saveAttempts.push(structuredClone(patch.layout));
        if (this.delayNextHomeSaveMs) {
          const delay = this.delayNextHomeSaveMs; this.delayNextHomeSaveMs = 0;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        if (this.failNextHomeSave) { this.failNextHomeSave = false; return json({ error: 'fixture save failure' }, 503); }
      }
    }
    return false;
  }

  navigate(id: string) {
    this.state.record = { ...this.record, layout: { ...this.record.layout!, activePageId: id } };
    this.bus.send('panel/device', { deviceId: fixtureId });
  }

  async editor(page: Page) {
    await page.goto('/');
    await page.getByRole('button', { name: /^(Expand|Collapse) sidebar$/ }).waitFor({ state: 'visible' });
    const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true });
    if (await expand.isVisible()) await expand.click();
    await page.locator('[class*="sidebarColumn"]').getByRole('button', { name: Y70_NAME }).first().click();
    await expect(page.getByRole('button', { name: 'Set current page as Home', exact: true })).toBeVisible();
    await expect(page.frameLocator('iframe[title="Panel simulator"]').locator('.panel-root')).toBeVisible();
  }

  async kiosk(page: Page) {
    await page.setViewportSize({ width: 550, height: 1920 });
    await page.goto(`/panel/${fixtureId}`);
    await expect(page.locator('.panel-root')).toBeVisible();
    await page.waitForFunction(() => (window as unknown as { y70HomeObservation?: { frames: string[] } }).y70HomeObservation!.frames.length >= 12);
    await expect(page.locator('[data-panel-page-id="home"]')).toHaveAttribute('aria-hidden', 'false');
    await expect.poll(() => this.record.layout?.activePageId).toBe('home');
  }

  async check() {
    for (const fixture of this.fixtures) await fixture.check();
  }
}

/** A genuine empty page point, checked through production hit testing. */
export async function backgroundPoint(page: Page, pageId: string) {
  const target = page.locator(`[data-panel-page-id="${pageId}"]`);
  return target.evaluate(element => {
    const box = element.getBoundingClientRect();
    for (const fraction of [0.7, 0.6, 0.5, 0.8]) {
      const x = box.left + box.width * 0.5, y = box.top + box.height * fraction;
      const hit = document.elementFromPoint(x, y);
      if (hit && !hit.closest('[data-panel-widget-id], [data-panel-hit], button, [role="tablist"]')) return { x, y };
    }
    throw new Error('The fixture has no hittable empty grid point.');
  });
}

/** Native browser touch delivery, including pointer events synthesized by Chromium. */
export async function nativeTap(page: Page, point: { x: number; y: number }, count = 1) {
  const client = await page.context().newCDPSession(page);
  try {
    for (let index = 0; index < count; index++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
      await page.waitForTimeout(35);
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      if (index + 1 < count) await page.waitForTimeout(75);
    }
  } finally { await client.detach(); }
}
