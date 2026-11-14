import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';

export interface ReorderFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface ReorderBounds { left: number; right: number; top: number; bottom: number }

/** Measures the existing preview, without moving or cloning its iframe. */
export function useReorderFrame(
  rootRef: RefObject<HTMLDivElement | null>,
  busyRef: RefObject<boolean>,
  cancelRef: RefObject<() => void>,
  ownerKey: string,
) {
  const [geometry, setGeometry] = useState({
    frame: { left: 0, top: 0, width: 0, height: 0 },
    bounds: { left: 0, right: 0, top: 0, bottom: 0 },
    origin: { left: 0, top: 0 },
  });
  const measure = useCallback(() => {
    const root = rootRef.current;
    const preview = root?.querySelector<HTMLElement>('[data-panel-preview-frame]');
    if (!root || !preview || busyRef.current) return;
    const stage = root.getBoundingClientRect();
    const box = preview.getBoundingClientRect();
    const area = (root.closest('[data-panel-editor-layout]') ?? root).getBoundingClientRect();
    const next = {
      frame: { left: box.left - stage.left, top: box.top - stage.top, width: box.width, height: box.height },
      bounds: { left: area.left, right: area.right, top: area.top, bottom: area.bottom },
      origin: { left: stage.left, top: stage.top },
    };
    setGeometry(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }, [rootRef, busyRef]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const preview = root?.querySelector<HTMLElement>('[data-panel-preview-frame]');
    if (!root || !preview) return;
    measure();
    const readShape = () => {
      const area = root.getBoundingClientRect();
      const page = preview.getBoundingClientRect();
      return [area.left, area.top, area.width, area.height, page.width, page.height];
    };
    let previous = readShape();
    const observer = new ResizeObserver(() => {
      const next = readShape();
      const changed = next.some((value, index) => Math.abs(value - previous[index]) > 0.25);
      previous = next;
      if (busyRef.current) { if (changed) cancelRef.current(); }
      else measure();
    });
    observer.observe(root);
    observer.observe(preview);
    return () => observer.disconnect();
  }, [ownerKey, rootRef, busyRef, cancelRef, measure]);
  return { ...geometry, measure };
}
