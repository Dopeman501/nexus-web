import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { targetIndexFromDrag } from './pageReorderModel';

export interface PageReorderGestureOptions {
  enabled: boolean;
  ownerKey: string;
  pageId: string;
  pageIds: readonly string[];
  frameWidth: number;
  bounds: { left: number; right: number; top: number; bottom: number };
  reducedMotion: boolean;
  onCommit: (id: string, to: number, baseOrder: readonly string[]) => Promise<boolean>;
  onBusyChange?: (busy: boolean) => void;
}
type Corner = 'left' | 'right';
type Input = 'pointer' | 'keyboard';
interface View {
  phase: 'idle' | 'grabbed' | 'saving' | 'settling';
  destination: number;
  dx: number;
  dy: number;
  corner: Corner | null;
  input: Input | null;
}
interface Session {
  ownerKey: string;
  pageId: string;
  order: readonly string[];
  startIndex: number;
  startX: number;
  startY: number;
  pointerId: number | null;
  captureTarget: HTMLButtonElement | null;
  frameWidth: number;
  bounds: PageReorderGestureOptions['bounds'];
  moved: boolean;
  bias: number;
  edge: -1 | 0 | 1;
}
const IDLE: View = { phase: 'idle', destination: 0, dx: 0, dy: 0, corner: null, input: null };
const MOVE_THRESHOLD = 6;
const EDGE_PX = 32;
const EDGE_MS = 450;
const SETTLE_MS = 300;

function release(session: Session | null) {
  const target = session?.captureTarget;
  if (!target || session.pointerId === null) return;
  session.captureTarget = null;
  try {
    if (target.hasPointerCapture(session.pointerId)) target.releasePointerCapture(session.pointerId);
  } catch { /* The browser may have already retired a cancelled pointer. */ }
}
function within(x: number, y: number, bounds: Session['bounds']) {
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}
function edgeAt(x: number, y: number, bounds: Session['bounds']): -1 | 0 | 1 {
  if (!within(x, y, bounds)) return 0;
  return x - bounds.left <= EDGE_PX ? -1 : bounds.right - x <= EDGE_PX ? 1 : 0;
}
function canBegin(options: PageReorderGestureOptions) {
  return options.enabled && options.pageIds.length > 1 && options.pageIds.includes(options.pageId)
    && new Set(options.pageIds).size === options.pageIds.length
    && Number.isFinite(options.frameWidth) && options.frameWidth > 0
    && Object.values(options.bounds).every(Number.isFinite)
    && options.bounds.left < options.bounds.right && options.bounds.top < options.bounds.bottom;
}

/** Owns one captured corner gesture; committed pages remain the parent's authority. */
export function usePageReorderGesture(options: PageReorderGestureOptions) {
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  const [view, setView] = useState<View>(IDLE);
  const viewRef = useRef<View>(IDLE);
  const session = useRef<Session | null>(null);
  const mounted = useRef(true);
  const busy = useRef(false);
  const epoch = useRef(0);
  const edgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publish = useCallback((next: View) => {
    viewRef.current = next;
    if (mounted.current) setView(next);
  }, []);
  const notifyBusy = useCallback((next: boolean) => {
    if (busy.current === next) return;
    busy.current = next;
    latest.current.onBusyChange?.(next);
  }, []);
  const clearEdge = useCallback(() => {
    if (edgeTimer.current !== null) clearTimeout(edgeTimer.current);
    edgeTimer.current = null;
  }, []);
  const retire = useCallback(() => {
    epoch.current++;
    clearEdge();
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    settleTimer.current = null;
    release(session.current);
    session.current = null;
    publish(IDLE);
    notifyBusy(false);
  }, [clearEdge, publish, notifyBusy]);
  const settle = useCallback(() => {
    clearEdge();
    release(session.current);
    if (latest.current.reducedMotion) { retire(); return; }
    publish({ ...viewRef.current, phase: 'settling', dx: 0, dy: 0 });
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(retire, SETTLE_MS);
  }, [clearEdge, retire, publish]);
  const cancel = useCallback(() => {
    if (viewRef.current.phase === 'grabbed') settle();
  }, [settle]);

  const armEdge = useCallback(function armEdge() {
    const active = session.current;
    if (!active || !active.moved || active.edge === 0 || edgeTimer.current !== null
      || viewRef.current.phase !== 'grabbed') return;
    const next = Math.min(active.order.length - 1, Math.max(0, viewRef.current.destination + active.edge));
    if (next === viewRef.current.destination) return;
    edgeTimer.current = setTimeout(() => {
      edgeTimer.current = null;
      if (session.current !== active || viewRef.current.phase !== 'grabbed' || active.edge === 0) return;
      const destination = Math.min(active.order.length - 1, Math.max(0, viewRef.current.destination + active.edge));
      active.bias += destination - viewRef.current.destination;
      publish({ ...viewRef.current, destination });
      armEdge();
    }, EDGE_MS);
  }, [publish]);

  const begin = useCallback((input: Input, corner: Corner, x = 0, y = 0, pointerId: number | null = null,
    captureTarget: HTMLButtonElement | null = null) => {
    const current = latest.current;
    if (viewRef.current.phase !== 'idle' || !canBegin(current)) return false;
    const startIndex = current.pageIds.indexOf(current.pageId);
    session.current = { ownerKey: current.ownerKey, pageId: current.pageId, order: [...current.pageIds],
      startIndex, startX: x, startY: y, pointerId, captureTarget, frameWidth: current.frameWidth,
      bounds: { ...current.bounds }, moved: false, bias: 0, edge: 0 };
    epoch.current++;
    publish({ phase: 'grabbed', destination: startIndex, dx: 0, dy: 0, corner, input });
    notifyBusy(true);
    return true;
  }, [publish, notifyBusy]);
  const finish = useCallback(() => {
    const active = session.current;
    if (!active || viewRef.current.phase !== 'grabbed') return;
    const current = latest.current;
    if (active.ownerKey !== current.ownerKey || active.pageId !== current.pageId
      || active.order.length !== current.pageIds.length || !active.order.every((id, index) => id === current.pageIds[index])) {
      settle(); return;
    }
    clearEdge(); release(active);
    if (!active.moved || viewRef.current.destination === active.startIndex) { settle(); return; }
    const mine = epoch.current;
    const destination = viewRef.current.destination;
    publish({ ...viewRef.current, phase: 'saving', dx: 0, dy: 0 });
    const completed = () => { if (mounted.current && epoch.current === mine) settle(); };
    try { void Promise.resolve(current.onCommit(active.pageId, destination, active.order)).then(completed, completed); }
    catch { completed(); }
  }, [clearEdge, settle, publish]);

  const onPointerDown = useCallback((event: PointerEvent<HTMLButtonElement>, corner: Corner) => {
    if (!event.isPrimary || event.button !== 0 || viewRef.current.phase !== 'idle' || !canBegin(latest.current)) return;
    try { event.currentTarget.setPointerCapture(event.pointerId); }
    catch { return; }
    event.preventDefault();
    begin('pointer', corner, event.clientX, event.clientY, event.pointerId, event.currentTarget);
  }, [begin]);
  const onPointerMove = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const active = session.current;
    if (!active || active.pointerId !== event.pointerId || viewRef.current.phase !== 'grabbed') return;
    const dx = event.clientX - active.startX, dy = event.clientY - active.startY;
    if (Math.hypot(dx, dy) >= MOVE_THRESHOLD) active.moved = true;
    const destination = active.moved
      ? targetIndexFromDrag(active.startIndex + active.bias, dx, active.frameWidth * 0.55, active.order.length)
      : active.startIndex;
    const edge = active.moved ? edgeAt(event.clientX, event.clientY, active.bounds) : 0;
    if (edge !== active.edge) clearEdge();
    active.edge = edge;
    event.preventDefault();
    publish({ ...viewRef.current, dx, dy, destination });
    armEdge();
  }, [publish, clearEdge, armEdge]);
  const onPointerUp = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const active = session.current;
    if (!active || active.pointerId !== event.pointerId || viewRef.current.phase !== 'grabbed') return;
    event.preventDefault();
    if (!within(event.clientX, event.clientY, active.bounds)) { cancel(); return; }
    onPointerMove(event);
    finish();
  }, [cancel, onPointerMove, finish]);
  const onPointerCancel = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (session.current?.pointerId === event.pointerId) cancel();
  }, [cancel]);
  const onLostPointerCapture = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (session.current?.captureTarget && session.current.pointerId === event.pointerId) cancel();
  }, [cancel]);
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>, corner: Corner) => {
    if (event.repeat) return;
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape' && viewRef.current.phase === 'grabbed') event.preventDefault();
      cancel(); return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (viewRef.current.phase === 'idle') begin('keyboard', corner);
      else if (viewRef.current.input === 'keyboard') finish();
      return;
    }
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1
      : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0;
    const active = session.current;
    if (!direction || !active || viewRef.current.phase !== 'grabbed' || viewRef.current.input !== 'keyboard') return;
    event.preventDefault(); active.moved = true;
    publish({ ...viewRef.current, destination: Math.min(active.order.length - 1, Math.max(0, viewRef.current.destination + direction)) });
  }, [begin, finish, cancel, publish]);

  useLayoutEffect(() => {
    const active = session.current;
    if (!active) return;
    if (active.ownerKey !== options.ownerKey) { retire(); return; }
    if (viewRef.current.phase === 'grabbed' && (!options.enabled || active.pageId !== options.pageId
      || active.order.length !== options.pageIds.length || !active.order.every((id, index) => id === options.pageIds[index])
      || active.frameWidth !== options.frameWidth || Object.keys(active.bounds).some(key => (
        active.bounds[key as keyof Session['bounds']] !== options.bounds[key as keyof Session['bounds']]
      )))) retire();
  });
  useEffect(() => {
    mounted.current = true;
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) { cancel(); }
    };
    const hidden = () => { if (document.visibilityState === 'hidden') cancel(); };
    const ignoreExtraPointer = (event: globalThis.PointerEvent) => {
      const active = session.current;
      if (viewRef.current.phase === 'grabbed' && active?.pointerId !== null && active?.pointerId !== event.pointerId) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    };
    const ignoreGrabClick = (event: MouseEvent) => {
      if (viewRef.current.phase === 'grabbed') { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', escape);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    document.addEventListener('visibilitychange', hidden);
    document.addEventListener('pointerdown', ignoreExtraPointer, true);
    document.addEventListener('click', ignoreGrabClick, true);
    return () => {
      mounted.current = false;
      window.removeEventListener('keydown', escape);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      document.removeEventListener('visibilitychange', hidden);
      document.removeEventListener('pointerdown', ignoreExtraPointer, true);
      document.removeEventListener('click', ignoreGrabClick, true);
      retire();
    };
  }, [cancel, retire]);

  return { ...view, destination: view.phase === 'idle' ? Math.max(0, options.pageIds.indexOf(options.pageId)) : view.destination,
    onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture, onKeyDown, cancel };
}
