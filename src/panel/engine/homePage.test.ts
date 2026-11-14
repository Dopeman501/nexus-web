// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { PanelLayout } from '../types';
import { resolveHomePage, setHomePage } from './homePage';
import { BLANK_PAGE_ID, pruneEmptyPages } from './panelLayoutOps';

const layout = (): PanelLayout => ({
  surface: 'y70', layoutSchemaVersion: 2,
  pages: [{ id: 'a', widgets: [] }, { id: 'b', widgets: [{ id: 'clock', type: 'clock', size: '4x2', col: 0, row: 0 }] }],
});

describe('Y70 Home identity', () => {
  it('defaults to the first page and resolves a chosen page without reordering or navigating', () => {
    const before = { ...layout(), activePageId: 'a' };
    expect(resolveHomePage(before)?.id).toBe('a');
    const next = setHomePage(before, 'b');
    expect(resolveHomePage(next)?.id).toBe('b');
    expect(next.pages).toBe(before.pages);
    expect(next.activePageId).toBe('a');
    expect(before).not.toHaveProperty('homePageId');
    expect(setHomePage(next, 'b')).toBe(next);
    expect(resolveHomePage({ ...next, pages: [...next.pages].reverse() })?.id).toBe('b');
  });

  it('rejects transient/unknown pages and falls back after a chosen page disappears', () => {
    const before = layout();
    expect(setHomePage(before, BLANK_PAGE_ID)).toBe(before);
    expect(setHomePage(before, 'missing')).toBe(before);
    expect(resolveHomePage({ ...before, homePageId: 'gone' })?.id).toBe('a');
    expect(resolveHomePage({ ...before, pages: [] })).toBeUndefined();
    const pruned = pruneEmptyPages({ ...before, homePageId: 'a' });
    expect(resolveHomePage(pruned)?.id).toBe('b');
  });

  it('preserves non-Y70 first-page behavior', () => {
    expect(resolveHomePage({ ...layout(), surface: 'phone', homePageId: 'b' })?.id).toBe('a');
  });
});
