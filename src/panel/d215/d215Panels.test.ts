import { describe, expect, it, vi } from 'vitest';
import type { PanelLayout } from '../types';
import { addD215Panel, d215PanelWidget, readD215Panels, removeD215Panel, setD215PanelsEnabled, setD215PanelBackgroundsEnabled, updateD215PanelBackground, updateD215PanelConfig } from './d215Panels';

vi.mock('../widgets/registry', () => ({
  lookupApp: (type: string) => ['clock', 'monitoring', 'exclusive'].includes(type)
    ? { meta: { type, sizes: ['2x2round'], singleInstance: type === 'exclusive' } } : undefined,
  appAvailableForSurface: (meta: { sizes: string[] }, surface: string) => surface === 'lcd-round' && meta.sizes.includes('2x2round'),
}));

const seed = (): PanelLayout => ({
  layoutSchemaVersion: 2, surface: 'lcd-wide',
  pages: [{ id: 'page', widgets: [{ id: 'main', type: 'clock', size: '4x2', col: 0, row: 0 }] }],
  singleWidgetConfigs: { clock: { showSeconds: true } },
  widgetPlaylist: { enabled: true, interval: 15, shuffle: false, types: ['clock'], order: ['clock'] },
});
const canvas = { width: 1680, height: 756 };

describe('D215 independent circle state', () => {
  it('stores independent backgrounds, preserving them across toggles, additions and widget settings edits', () => {
    const original = addD215Panel(addD215Panel(seed(), 'monitoring', 'cpu', canvas), 'monitoring', 'gpu', canvas);
    const red = updateD215PanelBackground(original, 'cpu', { mode: 'solid', color: '#ff0000', opacity: 0.5 });
    const blue = updateD215PanelBackground(red, 'gpu', { mode: 'solid', color: '#0000ff' });
    expect(blue.d215Panels?.items.map(item => item.background?.color)).toEqual(['#ff0000', '#0000ff']);
    expect(original.d215Panels?.items[0].background).toBeUndefined();
    const off = setD215PanelBackgroundsEnabled(blue, false);
    const added = addD215Panel(off, 'monitoring', 'third', canvas);
    expect(added.d215Panels?.backgroundsEnabled).toBe(false);
    const configured = updateD215PanelConfig(added, 'cpu', { label: 'new' });
    const restored = setD215PanelBackgroundsEnabled(setD215PanelsEnabled(configured, false), true);
    expect(restored.d215Panels?.items[0].background).toEqual(red.d215Panels?.items[0].background);
    expect(restored.d215Panels?.items[1].background).toEqual(blue.d215Panels?.items[1].background);
    expect(restored.pages).toBe(original.pages);
    expect(updateD215PanelBackground(original, 'missing', { color: '#ffffff' })).toBe(original);
  });

  it('normalizes malformed background values and copies nested background state', () => {
    const effectState = { speed: 20, intensity: 1, hue: 0, colorize: 0, saturation: 1, contrast: 1, params: { zoom: 1 } };
    const input = { enabled: true, backgroundsEnabled: false, items: [{ id: 'one', type: 'monitoring', x: 0.5, y: 0.5,
      diameter: 0.4, background: { mode: 'shader', color: 'url(evil)', opacity: Infinity, frost: -10,
        mediaId: '../bad', mediaType: 'script', mediaOrder: ['safe-asset', '../bad'], effectState } }] };
    const normalized = readD215Panels(input);
    expect(normalized.backgroundsEnabled).toBe(false);
    expect(normalized.items[0].background).toMatchObject({ mode: 'shader', opacity: 1, frost: 0, mediaOrder: ['safe-asset'] });
    expect(normalized.items[0].background?.color).toBeUndefined();
    expect(normalized.items[0].background?.mediaId).toBeNull();
    expect(normalized.items[0].background?.mediaType).toBeNull();
    expect(normalized.items[0].background?.effectState).toEqual(effectState);
    expect(normalized.items[0].background?.effectState?.params).not.toBe(effectState.params);
  });

  it('leaves an old layout unchanged when Panels is disabled without being configured', () => {
    const layout = seed();
    expect(setD215PanelsEnabled(layout, false)).toBe(layout);
    expect(readD215Panels(undefined)).toEqual({ enabled: false, items: [] });
  });

  it('adds up to six simultaneous circles without changing the retained Widget or playlist', () => {
    const original = seed();
    let layout = original;
    for (let i = 0; i < 6; i++) layout = addD215Panel(layout, 'monitoring', `circle-${i}`, canvas);
    expect(layout.d215Panels?.enabled).toBe(true);
    expect(layout.d215Panels?.items).toHaveLength(6);
    expect(new Set(layout.d215Panels?.items.map(item => `${item.x}:${item.y}`)).size).toBe(6);
    expect(addD215Panel(layout, 'clock', 'seventh', canvas)).toBe(layout);
    expect(layout.pages).toBe(original.pages);
    expect(layout.widgetPlaylist).toBe(original.widgetPlaylist);
    expect(layout.singleWidgetConfigs).toBe(original.singleWidgetConfigs);
    expect(original.d215Panels).toBeUndefined();
  });

  it('keeps duplicate widget types independently configured, then restores Widgets without deleting circles', () => {
    const two = addD215Panel(addD215Panel(seed(), 'monitoring', 'cpu', canvas), 'monitoring', 'gpu', canvas);
    const configured = updateD215PanelConfig(two, 'cpu', { label: 'CPU', gauge: { color: 'red' } });
    const again = updateD215PanelConfig(configured, 'cpu', { label: 'CPU temperature' });
    expect(again.d215Panels?.items[0].config).toEqual({ label: 'CPU temperature', gauge: { color: 'red' } });
    expect(again.d215Panels?.items[1].config).toBeUndefined();
    expect(two.d215Panels?.items[0].config).toBeUndefined();
    const disabled = setD215PanelsEnabled(again, false);
    expect(disabled.d215Panels).toEqual({ ...again.d215Panels, enabled: false });
    expect(disabled.pages).toBe(two.pages);
    expect(removeD215Panel(disabled, 'gpu').d215Panels?.items.map(item => item.id)).toEqual(['cpu']);
  });

  it('rejects unsupported types, reused instance ids and single-instance duplicates', () => {
    const layout = addD215Panel(seed(), 'exclusive', 'one', canvas);
    expect(addD215Panel(layout, 'deck', 'bad', canvas)).toBe(layout);
    expect(addD215Panel(layout, 'clock', 'main', canvas)).toBe(layout);
    expect(addD215Panel(layout, 'clock', 'one', canvas)).toBe(layout);
    expect(addD215Panel(layout, 'exclusive', 'two', canvas)).toBe(layout);
  });

  it('sanitizes invalid wire state without discarding an unavailable saved SDK instance', () => {
    const item = { id: 'sdk', type: 'app:example.round', x: 0.5, y: 0.5, diameter: 0.4, config: { theme: 'blue' } };
    const state = readD215Panels({ enabled: true, items: [
      item, { ...item }, { ...item, id: 'nan', x: NaN }, { ...item, id: '', type: '' },
      { ...item, id: 'clamp', x: -2, y: 3, diameter: 2 },
    ] });
    expect(state.items.map(circle => circle.id)).toEqual(['sdk', 'clamp']);
    expect(state.items[1]).toMatchObject({ x: 0, y: 1, diameter: 1 });
    expect(state.items[0].config).toEqual({ theme: 'blue' });
    expect(readD215Panels({ enabled: 'yes', items: null })).toEqual({ enabled: false, items: [] });
  });

  it('adapts a circle to the existing round widget/settings contract without losing its id or config', () => {
    const item = { id: 'gpu', type: 'monitoring', x: 0.2, y: 0.7, diameter: 0.3, config: { label: 'GPU' } };
    expect(d215PanelWidget(item)).toEqual({ id: 'gpu', type: 'monitoring', size: '2x2round', col: 0, row: 0, config: item.config });
    expect(updateD215PanelConfig(seed(), 'missing', {})).toEqual(seed());
    expect(removeD215Panel(seed(), 'missing')).toEqual(seed());
  });
});
