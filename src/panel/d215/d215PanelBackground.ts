import { cleanBinding, isSensorBinding } from '../../lib/sensorBinding';
import { defaultStateFor, type EffectState } from '../../types/lighting';
import type { PanelDeviceRecord } from '../../api/panel';
import { normalizePanelBackgroundEffect, normalizePanelBackgroundFrost, normalizePanelBackgroundMode, normalizePanelBackgroundOpacity,
  normalizePanelBackgroundTemplate, normalizePanelSlideshowInterval, type PanelBackgroundMode } from '../background/panelBackground';
import { buildPanelTheme } from '../theme/panelTheme';

/** Per-circle state, separate from both widget config and the device-wide theme. */
export interface D215PanelBackground {
  mode?: PanelBackgroundMode;
  color?: string;
  colorLight?: string;
  effect?: string;
  template?: number;
  effectState?: EffectState;
  opacity?: number;
  mediaId?: string | null;
  mediaType?: 'static' | 'animated' | null;
  mediaAlpha?: boolean;
  slideshow?: boolean;
  interval?: number;
  shuffle?: boolean;
  finishVideos?: boolean;
  mediaOrder?: string[];
  frost?: number;
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const color = (value: unknown) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : undefined;
const assetId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,64}$/.test(value);
const uniform = (value: string) => /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(value);

function readEffectState(value: unknown, effect: string): EffectState | undefined {
  if (!object(value)) return undefined;
  const base = defaultStateFor(effect);
  const number = (key: keyof EffectState, low: number, high: number): number => {
    const n = value[key];
    return typeof n === 'number' && Number.isFinite(n) ? Math.max(low, Math.min(high, n)) : base[key] as number;
  };
  const params = object(value.params) ? Object.fromEntries(Object.entries(value.params).slice(0, 128)
    .flatMap(([key, n]) => uniform(key) && typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e9 ? [[key, n]] : [])) : {};
  const sensors = object(value.sensors) ? Object.fromEntries(Object.entries(value.sensors).slice(0, 64)
    .flatMap(([key, binding]) => uniform(key) && isSensorBinding(binding) ? [[key, cleanBinding(binding)]] : [])) : undefined;
  return { speed: number('speed', -100, 100), intensity: number('intensity', 0, 1), hue: number('hue', 0, 1),
    colorize: number('colorize', 0, 1), saturation: number('saturation', 0, 4), contrast: number('contrast', 0, 4),
    params, ...(sensors ? { sensors } : {}) };
}

/** Imported layouts can reach the browser before a privileged save validates them. */
export function readD215PanelBackground(value: unknown): D215PanelBackground | undefined {
  if (!object(value)) return undefined;
  const effect = normalizePanelBackgroundEffect(typeof value.effect === 'string' ? value.effect : undefined);
  return {
    mode: normalizePanelBackgroundMode(typeof value.mode === 'string' ? value.mode : undefined),
    color: color(value.color), colorLight: color(value.colorLight), effect,
    template: normalizePanelBackgroundTemplate(typeof value.template === 'number' ? value.template : undefined),
    effectState: readEffectState(value.effectState, effect),
    opacity: normalizePanelBackgroundOpacity(typeof value.opacity === 'number' ? value.opacity : undefined),
    mediaId: assetId(value.mediaId) ? value.mediaId : null,
    mediaType: value.mediaType === 'static' || value.mediaType === 'animated' ? value.mediaType : null,
    mediaAlpha: value.mediaAlpha === true, slideshow: value.slideshow === true,
    interval: normalizePanelSlideshowInterval(typeof value.interval === 'number' ? value.interval : undefined),
    shuffle: value.shuffle === true, finishVideos: value.finishVideos !== false,
    mediaOrder: Array.isArray(value.mediaOrder) ? [...new Set(value.mediaOrder.filter(assetId))].slice(0, 1000) : [],
    frost: normalizePanelBackgroundFrost(typeof value.frost === 'number' ? value.frost : undefined),
  };
}

/** Adapt to existing controls/renderers without writing to the device theme. */
export function d215BackgroundTheme(value: D215PanelBackground | undefined) {
  const bg = readD215PanelBackground(value) ?? {};
  const record: PanelDeviceRecord = { id: '', displayName: '', firstSeenAt: 0, lastSeenAt: 0,
    backgroundMode: bg.mode, backgroundColor: bg.color, backgroundColorLight: bg.colorLight,
    backgroundEffect: bg.effect, backgroundTemplate: bg.template, backgroundOpacity: bg.opacity,
    backgroundMediaId: bg.mediaId, backgroundMediaType: bg.mediaType, backgroundMediaAlpha: bg.mediaAlpha,
    backgroundMediaSlideshow: bg.slideshow, backgroundMediaInterval: bg.interval,
    backgroundMediaShuffle: bg.shuffle, backgroundMediaFinishVideos: bg.finishVideos,
    backgroundMediaOrder: bg.mediaOrder, backgroundFrostLevel: bg.frost, backdrop: 'theme' };
  const theme = buildPanelTheme(null, record);
  return { ...theme, backgroundEffectState: bg.effectState ?? theme.backgroundEffectState };
}
