import type { PanelLayout, PanelWidget, PanelConfigValue } from '../types';
import { appAvailableForSurface, lookupApp } from '../widgets/registry';
import { nextCirclePlacement, type D215PanelCanvas } from './d215PanelGeometry';
import { MAX_D215_PANELS, type D215PanelInstance, type D215PanelsState } from './d215PanelTypes';
import { readD215Widget } from './d215Widget';
import { readD215PanelBackground, type D215PanelBackground } from './d215PanelBackground';

const bounded = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

/** Preserve unavailable saved apps, but do not trust persisted geometry or counts. */
export function readD215Panels(value: unknown): D215PanelsState {
  if (!value || typeof value !== 'object') return { enabled: false, items: [] };
  const input = value as Partial<D215PanelsState>;
  const ids = new Set<string>();
  const items: D215PanelInstance[] = [];
  for (const item of Array.isArray(input.items) ? input.items : []) {
    if (!item || typeof item !== 'object'
      || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 128 || ids.has(item.id)
      || typeof item.type !== 'string' || !item.type.trim() || item.type.length > 256
      || !Number.isFinite(item.x) || !Number.isFinite(item.y) || !Number.isFinite(item.diameter)) continue;
    ids.add(item.id);
    items.push({
      id: item.id, type: item.type,
      x: bounded(item.x, 0, 1), y: bounded(item.y, 0, 1), diameter: bounded(item.diameter, 0.12, 1),
      ...(item.config && typeof item.config === 'object' && !Array.isArray(item.config) ? { config: { ...item.config } } : {}),
      ...(item.background ? { background: readD215PanelBackground(item.background) } : {}),
    });
    if (items.length === MAX_D215_PANELS) break;
  }
  return { enabled: input.enabled === true, items,
    ...(typeof input.backgroundsEnabled === 'boolean' ? { backgroundsEnabled: input.backgroundsEnabled } : {}) };
}

export function d215PanelWidget(item: D215PanelInstance): PanelWidget {
  return { id: item.id, type: item.type, size: '2x2round', col: 0, row: 0, config: item.config };
}

/** The exact visible set is shared by rendering, peer guides and SDK conflict suppression. */
export function visibleD215PanelEntries(panels: D215PanelsState) {
  const singleInstances = new Set<string>();
  return panels.enabled ? panels.items.slice(0, MAX_D215_PANELS).flatMap(item => {
    const app = lookupApp(item.type);
    if (!app || !appAvailableForSurface(app.meta, 'lcd-round', { deviceTouch: false })) return [];
    if (app.meta.singleInstance) {
      if (singleInstances.has(app.meta.type)) return [];
      singleInstances.add(app.meta.type);
    }
    return [{ item, app }];
  }) : [];
}

export function addD215Panel(layout: PanelLayout, type: string, id: string, canvas: D215PanelCanvas): PanelLayout {
  const state = readD215Panels(layout.d215Panels);
  const app = lookupApp(type);
  const reservedTypes = [...layout.pages.flatMap(page => page.widgets.map(widget => widget.type)),
    ...(readD215Widget(layout.d215Widget, state.enabled).enabled && layout.widgetPlaylist?.enabled ? layout.widgetPlaylist.types : [])];
  if (!id.trim() || id.length > 128 || state.items.length >= MAX_D215_PANELS
    || state.items.some(item => item.id === id) || layout.pages.some(page => page.widgets.some(widget => widget.id === id))
    || !app || !appAvailableForSurface(app.meta, 'lcd-round')
    || (app.meta.singleInstance && [...state.items.map(item => item.type), ...reservedTypes]
      .some(current => current === type || lookupApp(current)?.meta.type === app.meta.type))) return layout;
  const item: D215PanelInstance = { id, type, ...nextCirclePlacement(state.items, canvas) };
  return { ...layout, d215Widget: readD215Widget(layout.d215Widget, state.enabled), d215Panels: { ...state, enabled: true, items: [...state.items, item] } };
}

export function setD215PanelBackgroundsEnabled(layout: PanelLayout, backgroundsEnabled: boolean): PanelLayout {
  return { ...layout, d215Panels: { ...readD215Panels(layout.d215Panels), backgroundsEnabled } };
}

export function updateD215PanelBackground(layout: PanelLayout, id: string, patch: Partial<D215PanelBackground>): PanelLayout {
  const state = readD215Panels(layout.d215Panels);
  if (!state.items.some(item => item.id === id)) return layout;
  return { ...layout, d215Panels: { ...state, items: state.items.map(item => item.id === id
    ? { ...item, background: readD215PanelBackground({ ...item.background, ...patch }) } : item) } };
}

export function setD215PanelsEnabled(layout: PanelLayout, enabled: boolean): PanelLayout {
  if (!layout.d215Panels && !enabled) return layout;
  const state = readD215Panels(layout.d215Panels);
  return { ...layout, d215Widget: readD215Widget(layout.d215Widget, state.enabled), d215Panels: { ...state, enabled } };
}

export function updateD215PanelConfig(layout: PanelLayout, id: string, patch: Record<string, PanelConfigValue>): PanelLayout {
  const state = readD215Panels(layout.d215Panels);
  if (!state.items.some(item => item.id === id)) return layout;
  return { ...layout, d215Panels: { ...state, items: state.items.map(item => item.id === id
    ? { ...item, config: { ...item.config, ...patch } } : item) } };
}

export function removeD215Panel(layout: PanelLayout, id: string): PanelLayout {
  const state = readD215Panels(layout.d215Panels);
  if (!state.items.some(item => item.id === id)) return layout;
  return { ...layout, d215Panels: { ...state, items: state.items.filter(item => item.id !== id) } };
}
