import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useTranslation } from '../../lib/i18n';
import type { D215AlignmentGuides, D215CircleGeometry, D215PanelCanvas, D215ResizeCorner } from './d215PanelGeometry';
import { clampD215Widget, d215WidgetBounds, moveD215Widget, resizeD215Widget, type D215WidgetState } from './d215Widget';
import styles from './D215WidgetFrame.module.scss';

const CORNERS = { nw: 'topLeft', ne: 'topRight', sw: 'bottomLeft', se: 'bottomRight' } as const;
const NO_GUIDES: D215AlignmentGuides = { vertical: [], horizontal: [] };

interface FrameProps {
  state: D215WidgetState;
  editing?: boolean;
  selected?: boolean;
  previewScale?: number;
  deviceId?: string;
  label?: string;
  peers?: readonly D215CircleGeometry[];
  onChange?: (state: D215WidgetState) => void;
  onSelect?: () => void;
  children: ReactNode;
}

interface Draft { state: D215WidgetState; guides: D215AlignmentGuides }
interface Gesture {
  state: D215WidgetState;
  corner?: D215ResizeCorner;
  x: number;
  y: number;
  pointerId: number;
  target: HTMLElement;
  canvas: D215PanelCanvas;
  sourceKey: string;
  deviceId?: string;
  moved: boolean;
}

function release(gesture: Gesture | null): void {
  if (!gesture) return;
  try {
    if (gesture.target.hasPointerCapture?.(gesture.pointerId)) gesture.target.releasePointerCapture(gesture.pointerId);
  } catch {
    // Native pointer cancellation or removal can release capture before cleanup.
  }
}

function sameGeometry(left: D215WidgetState, right: D215WidgetState): boolean {
  return left.x === right.x && left.y === right.y && left.scale === right.scale;
}

function direction(event: KeyboardEvent): { x: number; y: number } | null {
  switch (event.key) {
    case 'ArrowLeft': return { x: -1, y: 0 };
    case 'ArrowRight': return { x: 1, y: 0 };
    case 'ArrowUp': return { x: 0, y: -1 };
    case 'ArrowDown': return { x: 0, y: 1 };
    default: return null;
  }
}

/** Hosts the existing live Widget once; resizing changes only its scaled viewport. */
export function D215WidgetFrame({ state, editing = false, selected = false, previewScale = 1, deviceId,
  label, peers = [], onChange, onSelect, children }: FrameProps) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const [canvas, setCanvas] = useState<D215PanelCanvas>({ width: 1, height: 1 });
  const [draft, setDraft] = useState<Draft | null>(null);
  const sourceKey = useMemo(() => JSON.stringify(state), [state]);
  const preview = Number.isFinite(previewScale) ? Math.max(0.05, Math.min(1, previewScale)) : 1;
  const name = label ?? t('devices.y70.tab.widgets');

  const cancel = useCallback(() => {
    const active = gesture.current;
    gesture.current = null;
    if (active) suppressClick.current = true;
    release(active);
    setDraft(null);
  }, []);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const next = { width: element.clientWidth || box.width, height: element.clientHeight || box.height };
      if (!(next.width > 0 && next.height > 0)) return;
      setCanvas(current => current.width === next.width && current.height === next.height ? current : next);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [state.enabled]);

  useLayoutEffect(() => {
    const active = gesture.current;
    if (active && (!editing || !active.target.isConnected || active.sourceKey !== sourceKey || active.deviceId !== deviceId
      || active.canvas.width !== canvas.width || active.canvas.height !== canvas.height)) cancel();
  });

  useEffect(() => {
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) { event.preventDefault(); cancel(); }
    };
    window.addEventListener('keydown', escape);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', escape);
      window.removeEventListener('blur', cancel);
      release(gesture.current);
      gesture.current = null;
    };
  }, [cancel]);

  const commit = (next: D215WidgetState) => { if (!sameGeometry(state, next)) onChange?.(next); };
  const begin = (event: PointerEvent<HTMLElement>, corner?: D215ResizeCorner) => {
    if (!editing || event.button !== 0 || gesture.current || !onChange) return;
    event.preventDefault();
    event.stopPropagation();
    if (!selected) onSelect?.();
    event.currentTarget.focus({ preventScroll: true });
    suppressClick.current = false;
    try { event.currentTarget.setPointerCapture(event.pointerId); }
    catch { return; }
    gesture.current = { state: clampD215Widget(state), corner, x: event.clientX, y: event.clientY,
      pointerId: event.pointerId, target: event.currentTarget, canvas, sourceKey, deviceId, moved: false };
  };

  const update = (event: PointerEvent<HTMLElement>): Draft | null => {
    const active = gesture.current;
    if (!active || event.pointerId !== active.pointerId) return null;
    event.stopPropagation();
    const dx = event.clientX - active.x;
    const dy = event.clientY - active.y;
    if (Math.hypot(dx, dy) < 2 / preview) { setDraft(null); return null; }
    active.moved = true;
    const next = active.corner ? { state: resizeD215Widget(active.state, active.corner, dx, dy, canvas), guides: NO_GUIDES }
      : moveD215Widget(active.state, dx, dy, canvas, peers, 6 / preview);
    setDraft(next);
    return next;
  };

  const finish = (event: PointerEvent<HTMLElement>) => {
    const active = gesture.current;
    if (!active || event.pointerId !== active.pointerId) return;
    const final = update(event);
    suppressClick.current = active.moved;
    gesture.current = null;
    release(active);
    setDraft(null);
    if (final && active.sourceKey === sourceKey && active.deviceId === deviceId) commit(final.state);
  };

  const key = (event: KeyboardEvent<HTMLElement>, corner?: D215ResizeCorner) => {
    if (!editing || !onChange) return;
    const delta = direction(event);
    if (!delta) {
      if (!corner && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect?.(); }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!selected) onSelect?.();
    const step = (event.shiftKey ? 10 : 1) / preview;
    commit(corner ? resizeD215Widget(state, corner, delta.x * step, delta.y * step, canvas)
      : moveD215Widget(state, delta.x * step, delta.y * step, canvas, [], 0).state);
  };
  const pointerCancel = (event: PointerEvent<HTMLElement>) => { if (event.pointerId === gesture.current?.pointerId) cancel(); };
  const shown = clampD215Widget(draft?.state ?? state);
  const bounds = d215WidgetBounds(shown, canvas);
  const overlayStyle = { '--d215-widget-edit-scale': 1 / preview } as CSSProperties;

  if (!state.enabled) return null;
  return (
    <>
      <div ref={root} className={styles.layer} data-d215-widget-canvas data-editing={editing || undefined}>
        <div className={styles.frame} data-d215-widget-frame role={editing ? 'button' : undefined} tabIndex={editing ? 0 : undefined}
          aria-label={editing ? t('devices.jungle-leopard-d215.panels.move', { name }) : undefined}
          style={{ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }}
          onPointerDownCapture={event => begin(event)} onPointerMove={update} onPointerUp={finish}
          onPointerCancel={pointerCancel} onLostPointerCapture={pointerCancel} onKeyDown={event => key(event)}
          onClickCapture={editing ? event => {
            event.preventDefault(); event.stopPropagation();
            if (suppressClick.current) { suppressClick.current = false; return; }
            onSelect?.();
          } : undefined}>
          <div className={styles.content} data-d215-widget-content inert={editing}
            style={{ width: canvas.width, height: canvas.height, transform: `scale(${shown.scale})`, pointerEvents: editing ? 'none' : undefined }}>
            {children}
          </div>
        </div>
      </div>
      {editing && (
        <div className={styles.chrome} style={overlayStyle}>
          {selected && (
            <div className={styles.selection} data-d215-widget-selection
              style={{ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }}>
              {(Object.keys(CORNERS) as D215ResizeCorner[]).map(corner => (
                <button key={corner} type="button" className={styles.handle} data-d215-widget-corner={corner}
                  aria-label={t(`panel.freeform.handle.${CORNERS[corner]}`, { name })}
                  onPointerDown={event => begin(event, corner)} onPointerMove={update} onPointerUp={finish}
                  onPointerCancel={pointerCancel} onLostPointerCapture={pointerCancel}
                  onKeyDown={event => key(event, corner)}
                  onClick={event => { event.stopPropagation(); suppressClick.current = false; }} />
              ))}
            </div>
          )}
          {draft?.guides.vertical.map(position => <div key={`v${position}`} className={styles.verticalGuide}
            data-d215-widget-guide-axis="vertical" aria-hidden style={{ left: position }} />)}
          {draft?.guides.horizontal.map(position => <div key={`h${position}`} className={styles.horizontalGuide}
            data-d215-widget-guide-axis="horizontal" aria-hidden style={{ top: position }} />)}
        </div>
      )}
    </>
  );
}
