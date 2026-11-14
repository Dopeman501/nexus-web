// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { PanelLayout } from '../../../panel/types';
import { BLANK_PAGE_ID } from '../../../panel/engine/panelLayoutOps';
import { movePanelPage, stackNeighbours, targetIndexFromDrag } from './pageReorderModel';

const seed = (): PanelLayout => ({
  layoutSchemaVersion: 2, surface: 'y70', activePageId: 'b', homePageId: 'c', immersiveOnLoadWidgetId: 'clock-c',
  pages: ['a', 'b', 'c', 'd'].map((id, index) => ({ id, label: `Screen ${id}`, widgets: [{
    id: `clock-${id}`, type: 'clock', size: '4x2', col: index, row: 3, config: { color: '#ff0000', format24h: true },
  }] })),
});
const ids = (layout: PanelLayout) => layout.pages.map(page => page.id);

describe('complete page reordering', () => {
  it.each([
    ['b', 3, ['a', 'c', 'd', 'b']],
    ['d', 0, ['d', 'a', 'b', 'c']],
    ['a', 1, ['b', 'a', 'c', 'd']],
  ] as const)('moves %s to %i while preserving whole pages and every targeting reference', (id, destination, order) => {
    const before = seed();
    const oldPages = [...before.pages];
    Object.freeze(before.pages);
    Object.freeze(before);
    const next = movePanelPage(before, id, destination, ids(before));
    expect(ids(next)).toEqual(order);
    expect(ids(before)).toEqual(['a', 'b', 'c', 'd']);
    expect(next.activePageId).toBe('b');
    expect(next.homePageId).toBe('c');
    expect(next.immersiveOnLoadWidgetId).toBe('clock-c');
    for (const page of next.pages) expect(page).toBe(oldPages.find(original => original.id === page.id));
  });

  it('returns the same object for an unchanged drop', () => {
    const before = seed();
    expect(movePanelPage(before, 'b', 1, ids(before))).toBe(before);
  });

  it.each([-1, 4, 1.5, NaN, Infinity])('rejects invalid destination %s', destination => {
    const before = seed();
    expect(movePanelPage(before, 'b', destination, ids(before))).toBe(before);
  });

  it.each([
    [], ['a', 'b', 'c'], ['a', 'b', 'c', 'd', 'e'], ['a', 'c', 'b', 'd'], ['a', 'b', 'b', 'd'],
  ].map(order => [order]))('rejects a base order that no longer matches the complete collection: %s', expected => {
    const before = seed();
    expect(movePanelPage(before, 'b', 2, expected)).toBe(before);
  });

  it('rejects missing, duplicate, empty and transient page identities', () => {
    const before = seed();
    expect(movePanelPage(before, 'missing', 1, ids(before))).toBe(before);
    for (const id of ['b', '', ' ', BLANK_PAGE_ID]) {
      const invalid = { ...before, pages: before.pages.map((page, index) => index === 0 ? { ...page, id } : page) };
      expect(movePanelPage(invalid, 'b', 2, ids(invalid))).toBe(invalid);
    }
    const single = { ...before, pages: before.pages.slice(0, 1) };
    expect(movePanelPage(single, 'a', 0, ['a'])).toBe(single);
  });
});

describe('blank glass neighbours', () => {
  it('uses only three real neighbours on each side, with the reference depth and signed offsets', () => {
    const pages = Array.from({ length: 10 }, (_, index) => `p${index}`);
    const neighbours = stackNeighbours(pages, 'p4', 4);
    expect(neighbours).toEqual([
      { id: 'p1', distance: 3, side: -1, scale: 0.52, offset: -1.42 },
      { id: 'p2', distance: 2, side: -1, scale: 0.65, offset: -1.1 },
      { id: 'p3', distance: 1, side: -1, scale: 0.8, offset: -0.68 },
      { id: 'p5', distance: 1, side: 1, scale: 0.8, offset: 0.68 },
      { id: 'p6', distance: 2, side: 1, scale: 0.65, offset: 1.1 },
      { id: 'p7', distance: 3, side: 1, scale: 0.52, offset: 1.42 },
    ]);
    expect(pages).toEqual(Array.from({ length: 10 }, (_, index) => `p${index}`));
  });

  it('shows prospective neighbours after moving the selected page without filler at either end', () => {
    const pages = ['a', 'b', 'c', 'd'];
    expect(stackNeighbours(pages, 'a', 3).map(page => page.id)).toEqual(['b', 'c', 'd']);
    expect(stackNeighbours(pages, 'd', 0).map(page => page.id)).toEqual(['a', 'b', 'c']);
    expect(stackNeighbours(['a', 'b'], 'a', 1)).toEqual([
      { id: 'b', distance: 1, side: -1, scale: 0.8, offset: -0.68 },
    ]);
    expect(stackNeighbours(['a'], 'a', 0)).toEqual([]);
  });

  it('rejects invalid destinations or collections rather than manufacturing a card', () => {
    expect(stackNeighbours([], 'a', 0)).toEqual([]);
    expect(stackNeighbours(['a', 'b'], 'missing', 0)).toEqual([]);
    expect(stackNeighbours(['a', 'a'], 'a', 0)).toEqual([]);
    expect(stackNeighbours(['a', BLANK_PAGE_ID], 'a', 0)).toEqual([]);
    for (const destination of [-1, 2, 0.5, NaN, Infinity]) expect(stackNeighbours(['a', 'b'], 'a', destination)).toEqual([]);
  });
});

describe('pointer destination geometry', () => {
  it.each([
    [3, 0, 100, 10, 3], [3, 49, 100, 10, 3], [3, 50, 100, 10, 4],
    [3, -49, 100, 10, 3], [3, -50, 100, 10, 2], [3, -150, 100, 10, 1],
    [0, -10000, 100, 10, 0], [9, 10000, 100, 10, 9], [0, 10000, 100, 10, 9],
    [0, 800, 100, 10, 8], [8, -800, 100, 10, 0],
  ])('maps (%i, %i, %i, %i) to %i symmetrically', (start, dx, step, count, expected) => {
    expect(targetIndexFromDrag(start, dx, step, count)).toBe(expected);
  });

  it('ignores invalid geometry and bounds malformed starting positions', () => {
    for (const step of [0, -1, NaN, Infinity]) expect(targetIndexFromDrag(2, 100, step, 4)).toBe(2);
    for (const dx of [NaN, Infinity, -Infinity]) expect(targetIndexFromDrag(2, dx, 100, 4)).toBe(2);
    for (const count of [0, -1, 1.5, NaN, Infinity]) expect(targetIndexFromDrag(2, 100, 100, count)).toBe(0);
    expect(targetIndexFromDrag(-1, 0, 100, 4)).toBe(0);
    expect(targetIndexFromDrag(20, 0, 100, 4)).toBe(3);
    expect(targetIndexFromDrag(NaN, 0, 100, 4)).toBe(0);
  });
});
