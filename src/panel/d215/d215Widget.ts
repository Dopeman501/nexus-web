import type { PanelLayout } from '../types';
import { circleBounds, type D215AlignmentGuides, type D215CircleGeometry, type D215PanelCanvas, type D215ResizeCorner } from './d215PanelGeometry';

/** Center and size are canvas fractions, so the native canvas aspect is retained. */
export interface D215WidgetState {
  enabled: boolean;
  x: number;
  y: number;
  scale: number;
}

interface WidgetGeometry { x: number; y: number; scale: number }
export interface D215WidgetBounds { left: number; top: number; right: number; bottom: number; width: number; height: number }

export const D215_MIN_WIDGET_SCALE = 0.12;
const finite = (value: number, fallback: number): number => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const dimensions = (canvas: D215PanelCanvas): D215PanelCanvas => ({
  width: Math.max(1, finite(canvas.width, 1)), height: Math.max(1, finite(canvas.height, 1)),
});

export function clampD215Widget<T extends WidgetGeometry>(state: T): T {
  const scale = clamp(finite(state.scale, 1), D215_MIN_WIDGET_SCALE, 1);
  return { ...state, scale, x: clamp(finite(state.x, 0.5), scale / 2, 1 - scale / 2),
    y: clamp(finite(state.y, 0.5), scale / 2, 1 - scale / 2) };
}

/** Legacy Panels mode hid the Widget; records without either mode still show it. */
export function readD215Widget(value: unknown, legacyPanelsEnabled = false): D215WidgetState {
  if (!value || typeof value !== 'object') return { enabled: !legacyPanelsEnabled, x: 0.5, y: 0.5, scale: 1 };
  const input = value as Partial<D215WidgetState>;
  return clampD215Widget({ enabled: input.enabled === true, x: input.x ?? 0.5, y: input.y ?? 0.5, scale: input.scale ?? 1 });
}

export function setD215WidgetEnabled(layout: PanelLayout, enabled: boolean): PanelLayout {
  const legacyPanelsEnabled = layout.d215Panels?.enabled === true;
  const current = readD215Widget(layout.d215Widget, legacyPanelsEnabled);
  const scale = enabled && !layout.d215Widget && legacyPanelsEnabled ? 0.6 : current.scale;
  return { ...layout, d215Widget: { ...current, enabled, scale } };
}

export function d215WidgetBounds(state: WidgetGeometry, canvas: D215PanelCanvas): D215WidgetBounds {
  const { width, height } = dimensions(canvas);
  const fitted = clampD215Widget(state);
  const sideX = width * fitted.scale;
  const sideY = height * fitted.scale;
  const left = fitted.x * width - sideX / 2;
  const top = fitted.y * height - sideY / 2;
  return { left, top, right: left + sideX, bottom: top + sideY, width: sideX, height: sideY };
}

function snapAxis(center: number, radius: number, extent: number, targets: readonly number[], threshold: number) {
  if (!(threshold > 0)) return { center, guides: [] as number[] };
  const matches = targets.flatMap(target => [center, center - radius, center + radius].flatMap(anchor => {
    const delta = target - anchor;
    return Math.abs(delta) <= threshold && center + delta >= radius && center + delta <= extent - radius
      ? [{ target, delta }] : [];
  }));
  const nearest = matches.reduce<{ target: number; delta: number } | undefined>((best, match) => (
    !best || Math.abs(match.delta) < Math.abs(best.delta) ? match : best
  ), undefined);
  return nearest ? { center: center + nearest.delta, guides: [nearest.target] } : { center, guides: [] };
}

export function moveD215Widget<T extends WidgetGeometry>(
  state: T, dx: number, dy: number, canvas: D215PanelCanvas,
  peers: readonly D215CircleGeometry[] = [], snapDistance = 6,
): { state: T; guides: D215AlignmentGuides } {
  const { width, height } = dimensions(canvas);
  const start = clampD215Widget(state);
  const moved = clampD215Widget({ ...start, x: start.x + finite(dx, 0) / width, y: start.y + finite(dy, 0) / height });
  const peersBounds = peers.map(peer => circleBounds(peer, canvas));
  const threshold = Math.max(0, finite(snapDistance, 0));
  const x = snapAxis(moved.x * width, moved.scale * width / 2, width,
    [width / 2, 0, width, ...peersBounds.flatMap(peer => [(peer.left + peer.right) / 2, peer.left, peer.right])], threshold);
  const y = snapAxis(moved.y * height, moved.scale * height / 2, height,
    [height / 2, 0, height, ...peersBounds.flatMap(peer => [(peer.top + peer.bottom) / 2, peer.top, peer.bottom])], threshold);
  return { state: { ...moved, x: x.center / width, y: y.center / height }, guides: { vertical: x.guides, horizontal: y.guides } };
}

/** The opposite corner stays fixed while one uniform scale changes both axes. */
export function resizeD215Widget<T extends WidgetGeometry>(
  state: T, corner: D215ResizeCorner, dx: number, dy: number, canvas: D215PanelCanvas,
): T {
  const { width, height } = dimensions(canvas);
  const fitted = clampD215Widget(state);
  const deltaX = finite(dx, 0) / width;
  const deltaY = finite(dy, 0) / height;
  if (deltaX === 0 && deltaY === 0) return fitted;
  const signX = corner.endsWith('e') ? 1 : -1;
  const signY = corner.startsWith('s') ? 1 : -1;
  const anchorX = fitted.x - signX * fitted.scale / 2;
  const anchorY = fitted.y - signY * fitted.scale / 2;
  const requested = fitted.scale + (Math.abs(deltaX) >= Math.abs(deltaY) ? signX * deltaX : signY * deltaY);
  const maximum = Math.min(1, signX > 0 ? 1 - anchorX : anchorX, signY > 0 ? 1 - anchorY : anchorY);
  const scale = clamp(requested, D215_MIN_WIDGET_SCALE, maximum);
  return { ...fitted, x: anchorX + signX * scale / 2, y: anchorY + signY * scale / 2, scale };
}
