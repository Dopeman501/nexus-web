// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { PanelLayout } from '../types';
import { clampD215Widget, d215WidgetBounds, moveD215Widget, readD215Widget, resizeD215Widget, setD215WidgetEnabled, type D215WidgetState } from './d215Widget';

const wide = { width: 1000, height: 500 };
const tall = { width: 500, height: 1000 };
const frame = (patch: Partial<D215WidgetState> = {}): D215WidgetState => ({ enabled: true, x: 0.5, y: 0.5, scale: 0.4, ...patch });
const layout = (panels = false): PanelLayout => ({ layoutSchemaVersion: 2, surface: 'lcd-wide',
  pages: [{ id: 'page', widgets: [{ id: 'clock', type: 'clock', size: '4x2', col: 0, row: 0 }] }],
  d215Panels: { enabled: panels, items: [] }, widgetPlaylist: { enabled: true, interval: 15, shuffle: false, types: ['clock'], order: ['clock'] } });

describe('D215 Widget state', () => {
  it('preserves the legacy visible Widget when Panels is off and legacy hidden Widget when Panels is on', () => {
    expect(readD215Widget(undefined)).toEqual(frame({ scale: 1 }));
    expect(readD215Widget(undefined, true)).toEqual(frame({ enabled: false, scale: 1 }));
  });

  it('keeps explicit visibility independent from Panels and sanitizes malformed geometry', () => {
    expect(readD215Widget({ enabled: true, x: -4, y: 8, scale: 0 }, true)).toEqual(frame({ x: 0.06, y: 0.94, scale: 0.12 }));
    expect(readD215Widget({ enabled: false, x: NaN, y: Infinity, scale: NaN })).toEqual(frame({ enabled: false, scale: 1 }));
    expect(readD215Widget(null)).toEqual(frame({ scale: 1 }));
  });

  it('first enables a legacy combined composition at 60% without changing Widgets, playlists or circles', () => {
    const original = layout(true);
    const next = setD215WidgetEnabled(original, true);
    expect(next.d215Widget).toEqual(frame({ scale: 0.6 }));
    expect(next.pages).toBe(original.pages);
    expect(next.widgetPlaylist).toBe(original.widgetPlaylist);
    expect(next.d215Panels).toBe(original.d215Panels);
    expect(original.d215Widget).toBeUndefined();
  });

  it('keeps full-size legacy behavior without Panels and retains edited geometry across off/on', () => {
    expect(setD215WidgetEnabled(layout(), true).d215Widget?.scale).toBe(1);
    const original = { ...layout(true), d215Widget: frame({ x: 0.3, y: 0.4, scale: 0.3 }) };
    const hidden = setD215WidgetEnabled(original, false);
    expect(hidden.d215Widget).toEqual({ ...original.d215Widget, enabled: false });
    expect(setD215WidgetEnabled(hidden, true).d215Widget).toEqual(original.d215Widget);
  });
});

describe('D215 Widget frame geometry', () => {
  it.each([wide, tall])('scales both axes by one factor and stays in bounds on $width x $height', canvas => {
    const bounds = d215WidgetBounds(frame(), canvas);
    expect(bounds.width).toBe(canvas.width * 0.4);
    expect(bounds.height).toBe(canvas.height * 0.4);
    expect(bounds.width / bounds.height).toBe(canvas.width / canvas.height);
    expect(bounds.left).toBeCloseTo(canvas.width * 0.3);
    expect(bounds.top).toBeCloseTo(canvas.height * 0.3);
    expect(clampD215Widget(frame({ x: 0, y: 1, scale: 0.6 }))).toEqual(frame({ x: 0.3, y: 0.7, scale: 0.6 }));
  });

  it('keeps state immutable and clamps a full-size frame to the canvas center', () => {
    const original = Object.freeze(frame({ x: 1, y: 0, scale: 4 }));
    expect(clampD215Widget(original)).toEqual(frame({ scale: 1 }));
    expect(original.x).toBe(1);
  });

  it('snaps a move to canvas center and reports the actual guide position', () => {
    const result = moveD215Widget(frame({ x: 0.2 }), 299, 0, wide);
    expect(result.state.x).toBe(0.5);
    expect(result.guides.vertical).toEqual([500]);
    expect(result.guides.horizontal).toEqual([250]);
  });

  it('aligns with circle peers and can bypass snapping for keyboard nudges', () => {
    const peers = [{ x: 0.75, y: 0.75, diameter: 0.2 }];
    const result = moveD215Widget(frame({ x: 0.3, scale: 0.2 }), 448, 123, wide, peers);
    expect(result.state.x).toBe(0.75);
    expect(result.state.y).toBe(0.75);
    expect(result.guides.vertical).toEqual([750]);
    const free = moveD215Widget(frame(), 1, 1, wide, peers, 0);
    expect(free.state.x).toBe(0.501);
    expect(free.state.y).toBe(0.502);
    expect(free.guides).toEqual({ vertical: [], horizontal: [] });
  });

  it('clamps translated bounds and rejects nonfinite canvas or pointer input', () => {
    expect(moveD215Widget(frame(), 10000, -10000, wide).state).toEqual(frame({ x: 0.8, y: 0.2 }));
    expect(moveD215Widget(frame(), NaN, Infinity, wide, [], 0).state).toEqual(frame());
    const bounds = d215WidgetBounds(frame(), { width: NaN, height: 0 });
    expect(Object.values(bounds).every(Number.isFinite)).toBe(true);
  });

  it.each(['nw', 'ne', 'sw', 'se'] as const)('resizes from %s while preserving the opposite corner and canvas aspect', corner => {
    const original = frame();
    const dx = corner.endsWith('e') ? 100 : -100;
    const dy = corner.startsWith('s') ? 50 : -50;
    const before = d215WidgetBounds(original, wide);
    const resized = resizeD215Widget(original, corner, dx, dy, wide);
    const after = d215WidgetBounds(resized, wide);
    expect(resized.scale).toBeCloseTo(0.5);
    expect(corner.endsWith('e') ? after.left : after.right).toBeCloseTo(corner.endsWith('e') ? before.left : before.right);
    expect(corner.startsWith('s') ? after.top : after.bottom).toBeCloseTo(corner.startsWith('s') ? before.top : before.bottom);
    expect(after.width / after.height).toBe(2);
    expect(original.scale).toBe(0.4);
  });

  it('uses the dominant normalized resize axis and clamps the anchored frame at canvas edges and minimum size', () => {
    const larger = resizeD215Widget(frame(), 'se', 50, 100, wide);
    expect(larger.scale).toBeCloseTo(0.6);
    const maximum = resizeD215Widget(frame(), 'se', 10000, 10000, wide);
    expect(maximum.scale).toBeCloseTo(0.7);
    expect(d215WidgetBounds(maximum, wide).right).toBeCloseTo(1000);
    const minimum = resizeD215Widget(frame(), 'se', -10000, -10000, wide);
    expect(minimum.scale).toBe(0.12);
    expect(resizeD215Widget(frame(), 'se', NaN, Infinity, wide)).toEqual(frame());
  });
});
