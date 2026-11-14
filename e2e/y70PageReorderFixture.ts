import { expect, type Page } from '@playwright/test';
import type { PanelDevicePatch } from '../src/api/panel';
import { homeFixtureId, homeSeed, Y70HomeHost } from './y70HomeFixture';

export function reorderSeed(count = 7, selected = 3) {
  const record = homeSeed();
  record.layout = { layoutSchemaVersion: 2, surface: 'y70', activePageId: `page-${selected}`, homePageId: `page-${selected}`,
    pages: Array.from({ length: count }, (_, index) => ({ id: `page-${index}`, label: `Screen ${index + 1}`,
      widgets: [{ id: `clock-${index}`, type: 'clock', size: '4x2', col: 0, row: 0,
        config: { showSeconds: index % 2 === 0, format24h: true, savedMarker: `contents-${index}`, targetPageId: 'page-0' } }],
    })) };
  return record;
}
export const orderOf = (host: Y70HomeHost) => host.record.layout!.pages.map(page => page.id);
export class PageReorderHost extends Y70HomeHost {
  readonly reorderAttempts: PanelDevicePatch[] = [];
  failNextReorder = false;
  delayNextReorderMs = 0;
  constructor(count = 7, selected = 3) { super(reorderSeed(count, selected)); }
  override async attach(page: Page) {
    const fixture = await super.attach(page);
    await page.route(`**/panel/devices/${homeFixtureId}`, async route => {
      const request = route.request();
      if (request.method() === 'POST') {
        const patch = request.postDataJSON() as PanelDevicePatch;
        if (patch.layout && JSON.stringify(patch.layout.pages.map(page => page.id)) !== JSON.stringify(orderOf(this))) {
          this.reorderAttempts.push(structuredClone(patch));
          const delay = this.delayNextReorderMs; this.delayNextReorderMs = 0;
          if (delay) await new Promise(resolve => setTimeout(resolve, delay));
          if (this.failNextReorder) {
            this.failNextReorder = false;
            await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"isolated reorder save failure"}' });
            return;
          }
        }
      }
      await route.fallback();
    });
    return fixture;
  }
  change(update: (record: ReturnType<typeof reorderSeed>) => ReturnType<typeof reorderSeed>) {
    this.state.record = update(structuredClone(this.record));
    this.bus.send('panel/device', { deviceId: homeFixtureId });
  }
}

export const reorderRoot = (page: Page) => page.locator('[data-page-reorder-phase]');
export const cornerHandle = (page: Page, corner: 'left' | 'right') => page.locator(`[data-reorder-corner="${corner}"]`);
export const preview = (page: Page) => page.locator('[data-panel-preview-frame]');
export async function editorActive(page: Page, id: string) {
  await expect(page.frameLocator('iframe[title="Panel simulator"]').locator(`[data-panel-page-id="${id}"]`)).toHaveAttribute('aria-hidden', 'false');
}
export async function grab(page: Page, corner: 'left' | 'right' = 'left') {
  const handle = cornerHandle(page, corner);
  await handle.click({ trial: true });
  const box = await handle.boundingBox(), frame = await preview(page).boundingBox();
  if (!box || !frame) throw new Error('The real preview corner is not measurable.');
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await expect(reorderRoot(page)).toHaveAttribute('data-page-reorder-phase', 'grabbed');
  return { point, frame, handle };
}
export async function idle(page: Page) {
  await expect(reorderRoot(page)).toHaveAttribute('data-page-reorder-phase', 'idle', { timeout: 5000 });
}
export function moveIds(ids: string[], id: string, to: number) {
  const others = ids.filter(value => value !== id);
  return [...others.slice(0, to), id, ...others.slice(to)];
}
