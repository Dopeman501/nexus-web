import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from '../../lib/i18n';
import { appAvailableForSurface, lookupApp } from '../widgets/registry';
import { PanelOpaqueProvider } from '../widgets/common/PanelOpaqueContext';
import { clampCircle, circleBounds, moveCircle, resizeCircle, type D215AlignmentGuides, type D215PanelCanvas, type D215ResizeCorner } from './d215PanelGeometry';
import { MAX_D215_PANELS, type D215PanelInstance, type D215PanelsState } from './d215PanelTypes';
import styles from './D215PanelsLayer.module.scss';
import { D215PanelFace } from './D215PanelFace';

const DESIGN_SIDE = 190;
const NO_GUIDES: D215AlignmentGuides = { vertical: [], horizontal: [] };
const CORNERS = { nw: 'topLeft', ne: 'topRight', sw: 'bottomLeft', se: 'bottomRight' } as const;

interface LayerProps {
  panels: D215PanelsState;
  editing?: boolean;
  selectedId?: string | null;
  previewScale?: number;
  deviceId?: string;
  themeMode?: 'dark' | 'light';
  onChange?: (panels: D215PanelsState) => void;
  onSelect?: (id: string) => void;
}

interface Draft { item: D215PanelInstance; guides: D215AlignmentGuides }
interface Gesture {
  item: D215PanelInstance;
  corner?: D215ResizeCorner;
  x: number;
  y: number;
  pointerId: number;
  target: HTMLElement;
  canvas: D215PanelCanvas;
  sourceKey: string;
  deviceId?: string;
}

function release(gesture: Gesture | null): void {
  if (!gesture) return;
  try {
    if (gesture.target.hasPointerCapture?.(gesture.pointerId)) gesture.target.releasePointerCapture(gesture.pointerId);
  } catch {
    // The browser may already have released capture after removal or cancellation.
  }
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

function sameGeometry(left: D215PanelInstance, right: D215PanelInstance): boolean {
  return left.x === right.x && left.y === right.y && left.diameter === right.diameter;
}

/** Shared by the actual framebuffer and its desktop preview; only the latter edits. */
export function D215PanelsLayer({ panels, editing = false, selectedId = null, previewScale = 1, deviceId, themeMode = 'dark', onChange, onSelect }: LayerProps) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [canvas, setCanvas] = useState<D215PanelCanvas>({ width: 1, height: 1 });
  const [draft, setDraft] = useState<Draft | null>(null);
  const sourceKey = useMemo(() => JSON.stringify(panels), [panels]);
  const scale = Number.isFinite(previewScale) ? Math.max(0.05, Math.min(1, previewScale)) : 1;
  const singleInstances = new Set<string>();
  const entries = panels.items.slice(0, MAX_D215_PANELS).flatMap(item => {
    const app = lookupApp(item.type);
    if (!app || !appAvailableForSurface(app.meta, 'lcd-round', { deviceTouch: false })) return [];
    if (app.meta.singleInstance) {
      if (singleInstances.has(app.meta.type)) return [];
      singleInstances.add(app.meta.type);
    }
    return [{ item, app }];
  });

  const cancel = useCallback(() => {
    const active = gesture.current;
    gesture.current = null;
    release(active);
    setDraft(null);
  }, []);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      const next = { width: element.clientWidth || bounds.width, height: element.clientHeight || bounds.height };
      if (!(next.width > 0 && next.height > 0)) return;
      setCanvas(current => current.width === next.width && current.height === next.height ? current : next);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [panels.enabled]);

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

  const commit = (item: D215PanelInstance) => {
    const original = panels.items.find(current => current.id === item.id);
    if (!original || sameGeometry(original, item)) return;
    onChange?.({ ...panels, items: panels.items.map(current => current.id === item.id ? item : current) });
  };

  const begin = (event: PointerEvent<HTMLElement>, item: D215PanelInstance, corner?: D215ResizeCorner) => {
    if (!editing || event.button !== 0 || gesture.current || !onChange) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect?.(item.id);
    event.currentTarget.focus({ preventScroll: true });
    const active = {
      item: clampCircle(item, canvas), corner, x: event.clientX, y: event.clientY,
      pointerId: event.pointerId, target: event.currentTarget, canvas, sourceKey, deviceId,
    };
    try { event.currentTarget.setPointerCapture(event.pointerId); }
    catch { return; }
    gesture.current = active;
  };

  const update = (event: PointerEvent<HTMLElement>): Draft | null => {
    const active = gesture.current;
    if (!active || event.pointerId !== active.pointerId) return null;
    event.stopPropagation();
    const dx = event.clientX - active.x;
    const dy = event.clientY - active.y;
    if (Math.hypot(dx, dy) < 2 / scale) { setDraft(null); return null; }
    const next = active.corner
      ? { item: resizeCircle(active.item, active.corner, dx, dy, canvas), guides: NO_GUIDES }
      : (() => {
        const moved = moveCircle(active.item, dx, dy, canvas, entries.filter(entry => entry.item.id !== active.item.id).map(entry => entry.item), 6 / scale);
        return { item: moved.circle, guides: moved.guides };
      })();
    setDraft(next);
    return next;
  };

  const finish = (event: PointerEvent<HTMLElement>) => {
    const active = gesture.current;
    if (!active || event.pointerId !== active.pointerId) return;
    const final = update(event);
    gesture.current = null;
    release(active);
    setDraft(null);
    if (final && active.sourceKey === sourceKey && active.deviceId === deviceId) commit(final.item);
  };

  const key = (event: KeyboardEvent<HTMLElement>, item: D215PanelInstance, corner?: D215ResizeCorner) => {
    if (!editing || !onChange) return;
    const delta = direction(event);
    if (!delta) {
      if (!corner && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect?.(item.id); }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onSelect?.(item.id);
    const step = (event.shiftKey ? 10 : 1) / scale;
    commit(corner ? resizeCircle(item, corner, delta.x * step, delta.y * step, canvas)
      : moveCircle(item, delta.x * step, delta.y * step, canvas, [], 0).circle);
  };

  if (!panels.enabled) return null;
  return (
    <PanelOpaqueProvider value={null}>
      <div ref={root} className={styles.layer} data-d215-panels-canvas data-editing={editing || undefined}
        style={{ '--d215-edit-scale': 1 / scale } as CSSProperties}>
        {entries.map(({ item, app }) => {
          const shown = draft?.item.id === item.id ? draft.item : item;
          const bounds = circleBounds(shown, canvas);
          const label = t(app.meta.i18nKey) || item.type;
          const selected = editing && selectedId === item.id;
          const fullBleed = item.type === 'gallery' || item.type.startsWith('app:') || item.type.startsWith('marketplace:');
          const contentStyle = {
            width: DESIGN_SIDE, height: DESIGN_SIDE,
            transform: `scale(${bounds.width / DESIGN_SIDE * (fullBleed ? 1 : 0.85)})`,
          };
          return (
            <div key={item.id} className={styles.item} data-d215-panel-id={item.id} data-selected={selected || undefined}
              data-backgrounds={panels.backgroundsEnabled !== false} data-custom-background={!!item.background || undefined}
              role={editing ? 'button' : undefined} tabIndex={editing ? 0 : undefined}
              aria-label={editing ? t('devices.jungle-leopard-d215.panels.move', { name: label }) : undefined}
              style={{ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }}
              onPointerDown={event => begin(event, item)} onPointerMove={update} onPointerUp={finish}
              onPointerCancel={event => { if (event.pointerId === gesture.current?.pointerId) cancel(); }}
              onLostPointerCapture={event => { if (event.pointerId === gesture.current?.pointerId) cancel(); }}
              onKeyDown={event => key(event, item)}
              onClick={editing ? event => { event.stopPropagation(); onSelect?.(item.id); } : undefined}>
              <D215PanelFace item={item} app={app} backgroundsEnabled={panels.backgroundsEnabled !== false}
                deviceId={deviceId} themeMode={themeMode} editing={editing} contentStyle={contentStyle} />
              {selected && (Object.keys(CORNERS) as D215ResizeCorner[]).map(corner => (
                <button key={corner} type="button" className={styles.handle} data-corner={corner}
                  aria-label={t(`panel.freeform.handle.${CORNERS[corner]}`, { name: label })}
                  onPointerDown={event => begin(event, item, corner)} onPointerMove={update} onPointerUp={finish}
                  onKeyDown={event => key(event, item, corner)} onClick={event => event.stopPropagation()} />
              ))}
            </div>
          );
        })}
        {editing && draft?.guides.vertical.map(position => <div key={`v${position}`} className={styles.verticalGuide}
          data-d215-guide-axis="vertical" aria-hidden style={{ left: position }} />)}
        {editing && draft?.guides.horizontal.map(position => <div key={`h${position}`} className={styles.horizontalGuide}
          data-d215-guide-axis="horizontal" aria-hidden style={{ top: position }} />)}
      </div>
    </PanelOpaqueProvider>
  );
}
