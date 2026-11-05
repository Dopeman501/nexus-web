/** Centers are normalized to the canvas; diameter is a share of its short side. */
export interface D215CircleGeometry {
  x: number;
  y: number;
  diameter: number;
}

export interface D215PanelCanvas { width: number; height: number }
export type D215ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
export interface D215AlignmentGuides { vertical: number[]; horizontal: number[] }
export interface D215CircleBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export const D215_MIN_PANEL_DIAMETER = 0.12;
export const D215_DEFAULT_PANEL_DIAMETER = 0.4;

const finite = (value: number, fallback: number): number => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const dimensions = (canvas: D215PanelCanvas): D215PanelCanvas => ({
  width: Math.max(1, finite(canvas.width, 1)),
  height: Math.max(1, finite(canvas.height, 1)),
});

/** Re-fits saved geometry after an orientation change, without changing the input. */
export function clampCircle<T extends D215CircleGeometry>(circle: T, canvas: D215PanelCanvas): T {
  const { width, height } = dimensions(canvas);
  const diameter = clamp(finite(circle.diameter, D215_DEFAULT_PANEL_DIAMETER), D215_MIN_PANEL_DIAMETER, 1);
  const radius = diameter * Math.min(width, height) / 2;
  return {
    ...circle,
    x: clamp(finite(circle.x, 0.5), radius / width, 1 - radius / width),
    y: clamp(finite(circle.y, 0.5), radius / height, 1 - radius / height),
    diameter,
  };
}

export function circleBounds(circle: D215CircleGeometry, canvas: D215PanelCanvas): D215CircleBounds {
  const { width, height } = dimensions(canvas);
  const fitted = clampCircle(circle, canvas);
  const side = fitted.diameter * Math.min(width, height);
  const centerX = fitted.x * width;
  const centerY = fitted.y * height;
  return {
    left: centerX - side / 2,
    top: centerY - side / 2,
    right: centerX + side / 2,
    bottom: centerY + side / 2,
    width: side,
    height: side,
  };
}

/** Six reading-order slots; a custom placement may overlap, so use the least-covered fallback. */
export function nextCirclePlacement(existing: readonly D215CircleGeometry[], canvas: D215PanelCanvas): D215CircleGeometry {
  const { width, height } = dimensions(canvas);
  const shortSide = Math.min(width, height);
  const columns = width >= height ? 3 : 2;
  const rows = width >= height ? 2 : 3;
  const diameter = Math.max(D215_MIN_PANEL_DIAMETER,
    Math.min(D215_DEFAULT_PANEL_DIAMETER, 0.8 * width / columns / shortSide, 0.8 * height / rows / shortSide));
  const slots = Array.from({ length: 6 }, (_, index) => clampCircle({
    x: ((index % columns) + 0.5) / columns,
    y: (Math.floor(index / columns) + 0.5) / rows,
    diameter,
  }, canvas));
  const overlap = (slot: D215CircleGeometry) => existing.reduce((total, item) => {
    const other = clampCircle(item, canvas);
    const distance = Math.hypot((slot.x - other.x) * width, (slot.y - other.y) * height);
    return total + Math.max(0, (slot.diameter + other.diameter) * shortSide / 2 - distance);
  }, 0);
  return slots.reduce((best, slot) => overlap(slot) < overlap(best) ? slot : best);
}

interface AxisSnap { center: number; guides: number[] }

function snapAxis(center: number, radius: number, extent: number, targets: readonly number[], threshold: number): AxisSnap {
  if (!(threshold > 0)) return { center, guides: [] };
  const anchors = [center, center - radius, center + radius];
  const matches = targets.flatMap(target => anchors.flatMap(anchor => {
    const delta = target - anchor;
    const snapped = center + delta;
    return Math.abs(delta) <= threshold && snapped >= radius && snapped <= extent - radius
      ? [{ delta, target }] : [];
  }));
  const nearest = matches.reduce<{ delta: number; target: number } | undefined>((best, match) => (
    !best || Math.abs(match.delta) < Math.abs(best.delta) ? match : best
  ), undefined);
  if (!nearest) return { center, guides: [] };
  return { center: center + nearest.delta, guides: [nearest.target] };
}

/** Other circles exclude the one being moved. Set snapDistance to zero for free movement. */
export function moveCircle<T extends D215CircleGeometry>(
  circle: T, dx: number, dy: number, canvas: D215PanelCanvas,
  others: readonly D215CircleGeometry[] = [], snapDistance = 6,
): { circle: T; guides: D215AlignmentGuides } {
  const { width, height } = dimensions(canvas);
  const start = clampCircle(circle, canvas);
  const moved = clampCircle({ ...start, x: start.x + finite(dx, 0) / width, y: start.y + finite(dy, 0) / height }, canvas);
  const radius = moved.diameter * Math.min(width, height) / 2;
  const targetBounds = others.map(other => circleBounds(other, canvas));
  const vertical = [width / 2, 0, width, ...targetBounds.flatMap(bounds => [(bounds.left + bounds.right) / 2, bounds.left, bounds.right])];
  const horizontal = [height / 2, 0, height, ...targetBounds.flatMap(bounds => [(bounds.top + bounds.bottom) / 2, bounds.top, bounds.bottom])];
  const threshold = Math.max(0, finite(snapDistance, 0));
  const x = snapAxis(moved.x * width, radius, width, vertical, threshold);
  const y = snapAxis(moved.y * height, radius, height, horizontal, threshold);
  return {
    circle: { ...moved, x: x.center / width, y: y.center / height },
    guides: { vertical: x.guides, horizontal: y.guides },
  };
}

/** Keep the opposite corner fixed; the pointer's dominant axis determines the square's side. */
export function resizeCircle<T extends D215CircleGeometry>(
  circle: T, corner: D215ResizeCorner, dx: number, dy: number, canvas: D215PanelCanvas,
): T {
  const { width, height } = dimensions(canvas);
  const fitted = clampCircle(circle, canvas);
  const deltaX = finite(dx, 0);
  const deltaY = finite(dy, 0);
  if (deltaX === 0 && deltaY === 0) return fitted;
  const bounds = circleBounds(fitted, canvas);
  const signX = corner.endsWith('e') ? 1 : -1;
  const signY = corner.startsWith('s') ? 1 : -1;
  const anchorX = signX > 0 ? bounds.left : bounds.right;
  const anchorY = signY > 0 ? bounds.top : bounds.bottom;
  const delta = Math.abs(deltaX) >= Math.abs(deltaY) ? signX * deltaX : signY * deltaY;
  const shortSide = Math.min(width, height);
  const maximum = Math.min(shortSide, signX > 0 ? width - anchorX : anchorX, signY > 0 ? height - anchorY : anchorY);
  const side = clamp(bounds.width + delta, D215_MIN_PANEL_DIAMETER * shortSide, maximum);
  return {
    ...fitted,
    x: (anchorX + signX * side / 2) / width,
    y: (anchorY + signY * side / 2) / height,
    diameter: side / shortSide,
  };
}
