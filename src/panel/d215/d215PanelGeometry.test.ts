// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  circleBounds,
  clampCircle,
  moveCircle,
  nextCirclePlacement,
  resizeCircle,
  type D215CircleGeometry,
  type D215PanelCanvas,
  type D215ResizeCorner,
} from './d215PanelGeometry';

const landscape = { width: 1680, height: 756 };
const portrait = { width: 756, height: 1680 };
const circle = { id: 'clock', x: 0.5, y: 0.5, diameter: 0.4 };

function expectInside(item: D215CircleGeometry, canvas: D215PanelCanvas) {
  const bounds = circleBounds(item, canvas);
  expect(bounds.left).toBeGreaterThanOrEqual(-1e-8);
  expect(bounds.top).toBeGreaterThanOrEqual(-1e-8);
  expect(bounds.right).toBeLessThanOrEqual(canvas.width + 1e-8);
  expect(bounds.bottom).toBeLessThanOrEqual(canvas.height + 1e-8);
  expect(bounds.width).toBeCloseTo(bounds.height);
}

describe('D215 circle geometry', () => {
  it('measures a square by the canvas short side and preserves the input', () => {
    const bounds = circleBounds(circle, landscape);
    expect(bounds.left).toBeCloseTo(688.8);
    expect(bounds.top).toBeCloseTo(226.8);
    expect(bounds.right).toBeCloseTo(991.2);
    expect(bounds.bottom).toBeCloseTo(529.2);
    expect(bounds.width).toBeCloseTo(302.4);
    expect(bounds.height).toBeCloseTo(302.4);
    expect(clampCircle(circle, landscape)).toEqual(circle);
    expect(clampCircle(circle, landscape)).not.toBe(circle);
    expect(circle).toEqual({ id: 'clock', x: 0.5, y: 0.5, diameter: 0.4 });
  });

  it.each([landscape, portrait])('keeps edge circles inside either orientation: %o', canvas => {
    const result = clampCircle({ ...circle, x: -1, y: 2, diameter: 2 }, canvas);
    expect(result.diameter).toBe(1);
    expect(result.id).toBe('clock');
    expectInside(result, canvas);
    expectInside(clampCircle({ ...circle, x: 1, y: 0, diameter: -1 }, canvas), canvas);
    expect(clampCircle({ ...circle, diameter: 0 }, canvas).diameter).toBe(0.12);
  });

  it('clamps a saved landscape placement after portrait rotation without stretching it', () => {
    const saved = { ...circle, x: 0.95, y: 0.3 };
    const result = clampCircle(saved, portrait);
    expect(result.x).toBeCloseTo(0.8);
    expect(result.y).toBe(0.3);
    expect(result.diameter).toBe(0.4);
    expectInside(result, portrait);
    expect(saved.x).toBe(0.95);
  });

  it('uses safe finite geometry when a transient measurement or value is invalid', () => {
    const result = clampCircle({ x: NaN, y: Infinity, diameter: NaN }, { width: 0, height: NaN });
    expect(result).toEqual({ x: 0.5, y: 0.5, diameter: 0.4 });
    expectInside(result, { width: 1, height: 1 });
  });

  it.each([
    { canvas: landscape, columns: 3, rows: 2 },
    { canvas: portrait, columns: 2, rows: 3 },
  ])('fills six independent slots in reading order: %o', ({ canvas, columns, rows }) => {
    const placed = Array.from({ length: 6 }).reduce<D215CircleGeometry[]>((items) => [
      ...items, nextCirclePlacement(items, canvas),
    ], []);
    placed.forEach((item, index) => {
      expect(item.x).toBeCloseTo(((index % columns) + 0.5) / columns);
      expect(item.y).toBeCloseTo((Math.floor(index / columns) + 0.5) / rows);
      expect(item.diameter).toBe(0.4);
      expectInside(item, canvas);
    });
    expect(new Set(placed.map(item => `${item.x}:${item.y}`)).size).toBe(6);
  });

  it('reuses the first empty slot and gives a bounded result when all slots are covered', () => {
    const first = nextCirclePlacement([], landscape);
    const second = nextCirclePlacement([first], landscape);
    expect(nextCirclePlacement([second], landscape)).toEqual(first);
    expectInside(nextCirclePlacement([{ ...circle, diameter: 1 }], landscape), landscape);
  });

  it('translates by canvas pixels, keeps extra instance fields and clamps at the edges', () => {
    const original = { ...circle, config: { design: 'analog' } };
    const moved = moveCircle(original, 168, -75.6, landscape, [], 0);
    expect(moved.circle.x).toBeCloseTo(0.6);
    expect(moved.circle.y).toBeCloseTo(0.4);
    expect(moved.circle.config).toBe(original.config);
    expect(moved.guides).toEqual({ vertical: [], horizontal: [] });
    expectInside(moveCircle(original, 1e6, -1e6, landscape).circle, landscape);
    expect(original.x).toBe(0.5);
  });

  it('snaps to the canvas center with visible horizontal and vertical guides', () => {
    const start = { ...circle, x: 0.4, y: 0.4 };
    const moved = moveCircle(start, 164, 72, landscape);
    expect(moved.circle.x).toBe(0.5);
    expect(moved.circle.y).toBe(0.5);
    expect(moved.guides).toEqual({ vertical: [840], horizontal: [378] });
  });

  it('chooses the nearest alignment and can align another circle center', () => {
    const other = { x: 0.52, y: 0.2, diameter: 0.2 };
    const moved = moveCircle({ ...circle, x: 0.516 }, 0, 0, landscape, [other], 40);
    expect(moved.circle.x).toBeCloseTo(other.x);
    expect(moved.guides.vertical).toContain(other.x * landscape.width);
  });

  it('aligns two circle edges and never snaps a circle beyond the canvas', () => {
    const other = { x: 0.3, y: 0.3, diameter: 0.2 };
    const targetLeft = other.x * landscape.width - other.diameter * landscape.height / 2;
    const start = { ...circle, x: (targetLeft + circle.diameter * landscape.height / 2 + 3) / landscape.width };
    const moved = moveCircle(start, 0, 0, landscape, [other]);
    expect(circleBounds(moved.circle, landscape).left).toBeCloseTo(targetLeft);
    expect(moved.guides.vertical).toContain(targetLeft);
    expectInside(moveCircle({ ...circle, x: 0.99 }, 0, 0, landscape, [{ ...other, x: 1 }], 1000).circle, landscape);
  });

  it('does not snap outside the threshold and handles nonfinite pointer deltas', () => {
    const start = { ...circle, x: 0.4, y: 0.4 };
    const moved = moveCircle(start, NaN, Infinity, landscape, [], 0);
    expect(moved.circle).toEqual(start);
    const free = moveCircle({ ...circle, x: 0.48, y: 0.45 }, 0, 0, landscape, [], 1);
    expect(free.guides).toEqual({ vertical: [], horizontal: [] });
    expect(free.circle.x).toBe(0.48);
  });

  it.each(['nw', 'ne', 'sw', 'se'] as const)('resizes from %s while preserving its opposite corner', corner => {
    const before = circleBounds(circle, landscape);
    const dx = corner.endsWith('e') ? 40 : -40;
    const dy = corner.startsWith('s') ? 40 : -40;
    const resized = resizeCircle(circle, corner, dx, dy, landscape);
    const after = circleBounds(resized, landscape);
    expect(after.width).toBeCloseTo(before.width + 40);
    expect(corner.endsWith('e') ? after.left : after.right).toBeCloseTo(corner.endsWith('e') ? before.left : before.right);
    expect(corner.startsWith('s') ? after.top : after.bottom).toBeCloseTo(corner.startsWith('s') ? before.top : before.bottom);
    expectInside(resized, landscape);
  });

  it.each([landscape, portrait])('limits corner resizing at the canvas and the minimum diameter: %o', canvas => {
    const grown = resizeCircle(circle, 'se', 1e6, 1e6, canvas);
    expectInside(grown, canvas);
    const shrunk = resizeCircle(circle, 'nw', 1e6, 1e6, canvas);
    expect(shrunk.diameter).toBeCloseTo(0.12);
    expectInside(shrunk, canvas);
  });

  it('supports resizing along either axis and ignores invalid deltas', () => {
    const before = circleBounds(circle, landscape);
    const x = circleBounds(resizeCircle(circle, 'se', 20, 0, landscape), landscape);
    const y = circleBounds(resizeCircle(circle, 'se', 0, 20, landscape), landscape);
    expect(x.width).toBeCloseTo(before.width + 20);
    expect(y.width).toBeCloseTo(before.width + 20);
    expect(resizeCircle(circle, 'se', NaN, Infinity, landscape)).toEqual(circle);
  });

  it('does not mutate frozen input circles or the neighbors list', () => {
    const original = Object.freeze({ ...circle });
    const others = Object.freeze([Object.freeze({ x: 0.2, y: 0.2, diameter: 0.2 })]);
    expect(() => moveCircle(original, 1, 1, landscape, others)).not.toThrow();
    expect(() => resizeCircle(original, 'ne' satisfies D215ResizeCorner, 10, -10, portrait)).not.toThrow();
    expect(() => nextCirclePlacement(others, landscape)).not.toThrow();
  });
});
