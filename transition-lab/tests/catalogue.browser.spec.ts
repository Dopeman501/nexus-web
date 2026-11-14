import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

type Library = 'gl-transitions' | 'codrops' | 'curtains' | 'motion' | 'anime';
interface Effect { key: string; id: string; label: string; library: Library }
interface LabApi {
  selectEffect(key: string): Promise<boolean>;
  effects(): Effect[];
  selected(): string;
  shortlisted(): string[];
  seek(value: number): void;
  clear(): Promise<void>;
  play(duration?: number): void;
  snapshot(): { activeAdapters: number; pendingFrames: number; error?: string };
}
declare global { interface Window { transitionLab: LabApi } }

const compiledRoot = fileURLToPath(new URL('../dist/', import.meta.url));
const observations = new WeakMap<Page, { errors: string[]; blocked: string[] }>();
const counts: Record<Library, number> = { 'gl-transitions': 214, codrops: 32, curtains: 12, motion: 16, anime: 16 };
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');

test.beforeEach(async ({ page }) => {
  const seen = { errors: [] as string[], blocked: [] as string[] };
  observations.set(page, seen);
  page.on('pageerror', error => seen.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') seen.errors.push(message.text()); });
  await page.routeWebSocket(/.*/, route => { seen.blocked.push(route.url()); route.close(); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:19431') { seen.blocked.push(url.href); return route.abort(); }
    const file = resolve(compiledRoot, url.pathname === '/' ? 'index.html' : `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(compiledRoot + (compiledRoot.endsWith(sep) ? '' : sep))) return route.abort();
    return existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
  });
  await page.goto('/');
  await page.waitForFunction(() => !!window.transitionLab);
  await expect(page.getByTestId('lab-status')).toHaveText(/^(Ready|Fallback)$/);
  // Fixed integral preview size makes screenshot hashes comparable, and keeps
  // hundreds of real GPU compilations bounded without changing the adapters.
  await page.addStyleTag({ content: '.stage{width:640px!important;height:288px!important;aspect-ratio:auto!important}' });
});

test.afterEach(async ({ page }, info) => {
  await page.evaluate(() => window.transitionLab.clear());
  await info.attach('console-and-network', { body: JSON.stringify(observations.get(page)), contentType: 'application/json' });
  expect(observations.get(page)?.blocked).toEqual([]);
});

for (const library of Object.keys(counts) as Library[]) {
  test(`every ${library} catalogue entry renders and releases`, async ({ page }, info) => {
    const effects = await page.evaluate(id => window.transitionLab.effects().filter(effect => effect.library === id), library);
    expect(effects).toHaveLength(counts[library]);
    const stage = page.getByTestId('transition-stage');
    const results: Record<string, unknown>[] = [];
    for (const effect of effects) {
      const startErrors = observations.get(page)!.errors.length;
      const mounted = await page.evaluate(key => window.transitionLab.selectEffect(key), effect.key);
      const snapshot = await page.evaluate(() => window.transitionLab.snapshot());
      const record: Record<string, unknown> = { key: effect.key, mounted, setupError: snapshot.error };
      results.push(record);
      if (!mounted) continue;
      await page.evaluate(() => window.transitionLab.seek(0));
      const start = hash(await stage.screenshot());
      await page.evaluate(() => window.transitionLab.seek(1));
      const end = hash(await stage.screenshot());
      await page.evaluate(() => window.transitionLab.seek(0.37));
      // The iframe bridge renders on a message task; screenshot follows at least
      // two browser frames so captures cannot accidentally observe its endpoint.
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const middlePng = await stage.screenshot({ path: info.outputPath(`${effect.key.replace(/[^a-zA-Z0-9-]/g, '_')}.png`) });
      const middle = hash(middlePng);
      record.hashes = { start, middle, end };
      record.intermediate = middle !== start && middle !== end;
      record.errors = observations.get(page)!.errors.slice(startErrors);
      record.snapshot = await page.evaluate(() => window.transitionLab.snapshot());
      await page.evaluate(() => window.transitionLab.clear());
      record.released = await stage.locator('.transition-layer').count() === 0;
    }
    writeFileSync(info.outputPath(`${library}-results.json`), JSON.stringify(results, null, 2));
    await info.attach('effect-results', { body: JSON.stringify(results), contentType: 'application/json' });
    expect(results.filter(row => !row.mounted || !row.intermediate || !row.released || (row.errors as string[] | undefined)?.length
      || (row.snapshot as { error?: string } | undefined)?.error)).toEqual([]);
    expect(observations.get(page)?.errors).toEqual([]);
  });
}

test('search, selection, shortlist persistence and export', async ({ page }, info) => {
  expect(await page.evaluate(() => window.transitionLab.effects().length)).toBe(290);
  await page.getByLabel('Search transitions', { exact: true }).fill('Water Drop');
  await expect(page.getByTestId('effect-list').locator('article')).toHaveCount(1);
  await page.getByRole('button', { name: 'Add to shortlist: Water Drop', exact: true }).click();
  await page.getByLabel('Library', { exact: true }).selectOption('codrops');
  await page.getByLabel('Search transitions', { exact: true }).fill('');
  await page.getByLabel('Transition', { exact: true }).selectOption('codrops:codrops-01');
  await expect(page.getByTestId('lab-status')).toHaveText('Ready');
  await page.getByRole('button', { name: 'Add to shortlist: Parallax', exact: true }).click();
  expect(await page.evaluate(() => window.transitionLab.shortlisted())).toEqual(['gl-transitions:WaterDrop', 'codrops:codrops-01']);
  await page.reload();
  await page.waitForFunction(() => !!window.transitionLab);
  expect(await page.evaluate(() => window.transitionLab.shortlisted())).toHaveLength(2);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export choices', exact: true }).click();
  const download = await downloading;
  const destination = info.outputPath(download.suggestedFilename());
  await download.saveAs(destination);
  const payload = JSON.parse(readFileSync(destination, 'utf8'));
  expect(payload.schemaVersion).toBe(1);
  expect(payload.choices.map((choice: Effect) => choice.key)).toEqual(['gl-transitions:WaterDrop', 'codrops:codrops-01']);
  expect(observations.get(page)?.errors).toEqual([]);
});

test('wide browser keeps the preview beside effect browsing', async ({ page }, info) => {
  await page.setViewportSize({ width: 1920, height: 1120 });
  await page.addStyleTag({ content: '.stage{width:100%!important;height:auto!important;aspect-ratio:1680 / 756!important}' });
  await page.getByLabel('Library', { exact: true }).selectOption('motion');
  await expect(page.getByTestId('lab-status')).toHaveText('Ready');
  await page.evaluate(() => window.transitionLab.seek(0.37));
  const preview = await page.getByTestId('transition-stage').boundingBox();
  const browser = await page.getByRole('region', { name: 'Transition catalogue', exact: true }).boundingBox();
  expect(preview).not.toBeNull(); expect(browser).not.toBeNull();
  expect(browser!.x).toBeGreaterThan(preview!.x + preview!.width);
  await page.screenshot({ path: info.outputPath('sampler-wide.png'), fullPage: true });
  expect(observations.get(page)?.errors).toEqual([]);
});
