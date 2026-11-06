// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  circleBounds,
  clampCircle,
  moveCircle,
  nextCirclePlacement,
  resizeCircle,
  resizeCircleWithGuides,
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

describe('D215 circle resize guides', () => {
  const square = { width: 1000, height: 1000 };
  const initial = { id: 'active', x: 0.5, y: 0.5, diameter: 0.2 };
  const peer = { id: 'peer', x: 0.2, y: 0.2, diameter: 0.3 };

  it('snaps to a nearby peer diameter and identifies both matching square bounds', () => {
    const result = resizeCircleWithGuides(initial, 'se', 97, 97, square, [peer]);
    expect(result.circle.diameter).toBe(0.3);
    expect(result.guides.matchingSize).toEqual(circleBounds(peer, square));
    expect(result.guides.vertical).toEqual([400, 700]);
    expect(result.guides.horizontal).toEqual([400, 700]);
    expect(circleBounds(result.circle, square)).toMatchObject({ left: 400, top: 400, width: 300, height: 300 });
  });

  it.each([landscape, portrait])('matches sizes in either orientation while retaining every opposite corner: %o', canvas => {
    for (const corner of ['nw', 'ne', 'sw', 'se'] as const) {
      const start = { ...circle, diameter: 0.3 };
      const other = { ...peer, x: 0.6, y: 0.6, diameter: 0.4 };
      const side = Math.min(canvas.width, canvas.height);
      const delta = side * 0.1 - 3;
      const result = resizeCircleWithGuides(start, corner, corner.endsWith('e') ? delta : -delta,
        corner.startsWith('s') ? delta : -delta, canvas, [other]);
      const before = circleBounds(start, canvas);
      const after = circleBounds(result.circle, canvas);
      expect(result.circle.diameter).toBeCloseTo(0.4);
      expect(result.guides.matchingSize).toEqual(circleBounds(other, canvas));
      expect(corner.endsWith('e') ? after.left : after.right).toBeCloseTo(corner.endsWith('e') ? before.left : before.right);
      expect(corner.startsWith('s') ? after.top : after.bottom).toBeCloseTo(corner.startsWith('s') ? before.top : before.bottom);
      expectInside(result.circle, canvas);
    }
  });

  it('chooses the nearest feasible peer size and prioritizes an equal-size match over a nearby alignment', () => {
    const near = { ...peer, id: 'near', diameter: 0.3 };
    const farther = { ...peer, id: 'farther', diameter: 0.305 };
    const alignment = { id: 'line', x: 0.8, y: 0.8, diameter: 0.196 };
    const result = resizeCircleWithGuides(initial, 'se', 102, 102, square, [farther, near, alignment]);
    expect(result.circle.diameter).toBe(0.3);
    expect(result.guides.matchingSize).toEqual(circleBounds(near, square));
  });

  it('does not attract a far peer or report an unequal circle as matching', () => {
    const result = resizeCircleWithGuides(initial, 'se', 80, 80, square, [peer]);
    expect(result.circle).toEqual(resizeCircle(initial, 'se', 80, 80, square));
    expect(result.guides).toEqual({ vertical: [], horizontal: [] });
  });

  it('supports the exact threshold and disables all snapping when the threshold is zero', () => {
    const atThreshold = resizeCircleWithGuides(initial, 'se', 94, 94, square, [peer], 6);
    expect(atThreshold.circle.diameter).toBe(0.3);
    const free = resizeCircleWithGuides(initial, 'se', 97, 97, square, [peer], 0);
    expect(free.circle).toEqual(resizeCircle(initial, 'se', 97, 97, square));
    expect(free.guides).toEqual({ vertical: [], horizontal: [] });
  });

  it('does not snap back to the active circle when the caller includes itself or a same-id copy', () => {
    const canvas = { width: 1000, height: 800 };
    const start = { id: 'active', x: 0.27, y: 0.31, diameter: 0.2 };
    const result = resizeCircleWithGuides(start, 'se', 1, 1, canvas, [start, { ...start }]);
    expect(result.circle).toEqual(resizeCircle(start, 'se', 1, 1, canvas));
    expect(result.guides.matchingSize).toBeUndefined();
  });

  it('continues to resize without peers and snaps the moving edge to the canvas center', () => {
    const start = { id: 'active', x: 0.2, y: 0.2, diameter: 0.2 };
    const result = resizeCircleWithGuides(start, 'se', 423.4, 423.4, landscape);
    expect(circleBounds(result.circle, landscape).right).toBeCloseTo(840);
    expect(result.guides.vertical).toContain(840);
    expect(result.guides.matchingSize).toBeUndefined();
    expectInside(result.circle, landscape);
  });

  it('shows a canvas edge guide while keeping the circle within its maximum available room', () => {
    const start = { id: 'active', x: 0.6, y: 0.25, diameter: 0.4 };
    const result = resizeCircleWithGuides(start, 'se', 410, 410, landscape);
    expect(circleBounds(result.circle, landscape).bottom).toBeCloseTo(756);
    expect(result.guides.horizontal).toContain(756);
    expectInside(result.circle, landscape);
  });

  it('can align a moving edge to a peer edge without changing to that peer size', () => {
    const start = { id: 'active', x: 0.2, y: 0.25, diameter: 0.2 };
    const other = { id: 'peer', x: 0.6, y: 0.7, diameter: 0.4 };
    const result = resizeCircleWithGuides(start, 'se', 442.2, 442.2, landscape, [other]);
    const target = circleBounds(other, landscape).left;
    expect(circleBounds(result.circle, landscape).right).toBeCloseTo(target);
    expect(result.guides.vertical).toContain(target);
    expect(result.guides.matchingSize).toBeUndefined();
  });

  it('can align a moving edge to a peer center when its diameter is different', () => {
    const other = { id: 'peer', x: 0.7, y: 0.8, diameter: 0.12 };
    const result = resizeCircleWithGuides(initial, 'se', 97, 97, square, [other]);
    expect(circleBounds(result.circle, square).right).toBeCloseTo(700);
    expect(result.guides.vertical).toContain(700);
    expect(result.guides.matchingSize).toBeUndefined();
  });

  it('rejects an unreachable peer diameter even when it is within the snapping threshold', () => {
    const result = resizeCircleWithGuides(initial, 'se', 398, 398, square, [{ ...peer, diameter: 0.603 }]);
    expect(result.guides.matchingSize).toBeUndefined();
    expect(circleBounds(result.circle, square).width).toBeLessThanOrEqual(600);
    expectInside(result.circle, square);
  });

  it('matches the minimum size while leaving frozen inputs and peer collections unchanged', () => {
    const start = Object.freeze({ ...initial, config: Object.freeze({ label: 'CPU' }) });
    const others = Object.freeze([Object.freeze({ ...peer, diameter: 0.12 })]);
    const result = resizeCircleWithGuides(start, 'se', -77, -77, square, others);
    expect(result.circle.diameter).toBe(0.12);
    expect(result.circle.config).toBe(start.config);
    expect(result.guides.matchingSize).toEqual(circleBounds(others[0], square));
    expect(start.diameter).toBe(0.2);
    expectInside(result.circle, square);
  });
});
