import { useEffect, useRef, type RefObject } from 'react';
import { isPanelBackgroundTarget } from './panelLayoutHelpers';
import { LONG_PRESS_MOVE_THRESHOLD } from './useLongPress';

interface BackgroundHomeGestureOptions {
  enabled: boolean;
  rootRef: RefObject<HTMLElement | null>;
  onHome: () => void;
  resetKey: string;
}

const TAP_MAX_MS = 250;
const DOUBLE_TAP_MAX_MS = 350;
const DOUBLE_TAP_DISTANCE_PX = 32;
const MAX_CONTACTS = 16;

interface TapPoint { x: number; y: number; time: number }
interface Press extends TapPoint { pointerId: number; pointerType: string }

function near(a: TapPoint, b: TapPoint, distance: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= distance;
}

function point(event: PointerEvent): TapPoint {
  return { x: event.clientX, y: event.clientY, time: event.timeStamp };
}

/** Recognizes background taps without capturing pointers or consuming widget/swipe events. */
export function useBackgroundHomeGesture({ enabled, rootRef, onHome, resetKey }: BackgroundHomeGestureOptions): void {
  const onHomeRef = useRef(onHome);
  useEffect(() => { onHomeRef.current = onHome; }, [onHome]);

  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return;
    let press: Press | null = null;
    let previous: (TapPoint & { pointerType: string }) | null = null;
    const contacts = new Set<number>();
    const cancel = () => { press = null; previous = null; };
    const reset = () => { cancel(); contacts.clear(); };
    const emptyTarget = (target: EventTarget | null) => target instanceof Element
      && root.contains(target) && isPanelBackgroundTarget(target)
      && !target.closest('[contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="tablist"]');

    const down = (event: PointerEvent) => {
      if (contacts.size >= MAX_CONTACTS) { reset(); return; }
      contacts.add(event.pointerId);
      if (contacts.size > 1 || !event.isPrimary || event.button !== 0
        || document.visibilityState === 'hidden' || !emptyTarget(event.target)) {
        cancel();
        return;
      }
      const next = point(event);
      if (previous && (!near(previous, next, DOUBLE_TAP_DISTANCE_PX)
        || event.pointerType !== previous.pointerType
        || next.time - previous.time > DOUBLE_TAP_MAX_MS)) previous = null;
      press = { ...next, pointerId: event.pointerId, pointerType: event.pointerType };
    };
    const move = (event: PointerEvent) => {
      if (press?.pointerId === event.pointerId && !near(press, point(event), LONG_PRESS_MOVE_THRESHOLD)) cancel();
    };
    const up = (event: PointerEvent) => {
      contacts.delete(event.pointerId);
      if (!press || press.pointerId !== event.pointerId) return;
      const started = press;
      press = null;
      const end = point(event);
      const elapsed = end.time - started.time;
      if (elapsed < 0 || elapsed > TAP_MAX_MS || !near(started, end, LONG_PRESS_MOVE_THRESHOLD)
        || !emptyTarget(event.target)) { cancel(); return; }
      const gap = previous ? end.time - previous.time : Infinity;
      if (previous && gap >= 0 && gap <= DOUBLE_TAP_MAX_MS
        && near(previous, end, DOUBLE_TAP_DISTANCE_PX) && previous.pointerType === started.pointerType) {
        previous = null;
        onHomeRef.current();
      } else previous = { ...end, pointerType: started.pointerType };
    };
    const cancelled = (event: PointerEvent) => { contacts.delete(event.pointerId); cancel(); };
    // Implicit touch capture normally releases AFTER pointerup: that release
    // must leave the completed first tap available for the second contact.
    const lostCapture = (event: PointerEvent) => {
      if (press?.pointerId === event.pointerId) cancelled(event);
    };
    const visibility = () => { if (document.visibilityState === 'hidden') reset(); };

    // Capture sees exclusions and interrupted contacts even when widget code
    // stops propagation. Document releases also clean up presses that leave the root.
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', cancelled, true);
    document.addEventListener('lostpointercapture', lostCapture, true);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', reset);
    return () => {
      reset();
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', cancelled, true);
      document.removeEventListener('lostpointercapture', lostCapture, true);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', reset);
    };
  }, [enabled, rootRef, resetKey]);
}
