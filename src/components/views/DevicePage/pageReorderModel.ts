import type { PanelLayout } from '../../../panel/types';
import { BLANK_PAGE_ID } from '../../../panel/engine/panelLayoutOps';

export interface StackNeighbour {
  id: string;
  distance: number;
  side: -1 | 1;
  scale: number;
  /** Signed distance from the foreground centre, in foreground-width units. */
  offset: number;
}

const DEPTHS = [
  { scale: 0.8, offset: 0.68 },
  { scale: 0.65, offset: 1.1 },
  { scale: 0.52, offset: 1.42 },
] as const;

function validOrder(pageIds: readonly string[]): boolean {
  return pageIds.length > 0 && new Set(pageIds).size === pageIds.length
    && pageIds.every(id => typeof id === 'string' && id.trim().length > 0 && id !== BLANK_PAGE_ID);
}

function validDestination(destination: number, count: number): boolean {
  return Number.isSafeInteger(destination) && destination >= 0 && destination < count;
}

function moved<T>(items: readonly T[], from: number, to: number): T[] {
  const remaining = items.filter((_, index) => index !== from);
  return [...remaining.slice(0, to), items[from], ...remaining.slice(to)];
}

/** Change only order, after checking the drag still owns the complete base order. */
export function movePanelPage(layout: PanelLayout, pageId: string, to: number, expectedOrder: readonly string[]): PanelLayout {
  const pageIds = layout.pages.map(page => page.id);
  if (!validOrder(pageIds) || !validDestination(to, pageIds.length)
    || expectedOrder.length !== pageIds.length || !expectedOrder.every((id, index) => id === pageIds[index])) return layout;
  const from = pageIds.indexOf(pageId);
  if (from < 0 || from === to) return layout;
  return { ...layout, pages: moved(layout.pages, from, to) };
}

/** Describe blank cards only; callers never need another live page renderer. */
export function stackNeighbours(pageIds: readonly string[], selectedId: string, destination: number): StackNeighbour[] {
  if (!validOrder(pageIds) || !validDestination(destination, pageIds.length)) return [];
  const from = pageIds.indexOf(selectedId);
  if (from < 0) return [];
  return moved(pageIds, from, destination).flatMap((id, index): StackNeighbour[] => {
    const distance = Math.abs(index - destination);
    if (distance < 1 || distance > DEPTHS.length) return [];
    const side = index < destination ? -1 : 1;
    const depth = DEPTHS[distance - 1];
    return [{ id, distance, side, scale: depth.scale, offset: side * depth.offset }];
  });
}

/** Adjacent insertion boundaries are symmetric for left and right drags. */
export function targetIndexFromDrag(startIndex: number, dx: number, stepPx: number, count: number): number {
  if (!Number.isSafeInteger(count) || count < 1) return 0;
  const start = Number.isSafeInteger(startIndex) ? Math.min(count - 1, Math.max(0, startIndex)) : 0;
  if (!Number.isFinite(dx) || !Number.isFinite(stepPx) || stepPx <= 0) return start;
  const delta = Math.sign(dx) * Math.floor(Math.abs(dx) / stepPx + 0.5);
  return Math.min(count - 1, Math.max(0, start + delta));
}
