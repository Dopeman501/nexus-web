import { BASE_DEFAULTS, EFFECTS, type EffectState } from '../types/lighting';
import { fetchService, postService } from './service';

export interface LightingAudioTriggerLook {
  mode: 'static' | 'animate' | 'media';
  mediaId?: string;
  color?: string;
  effect?: string;
  state?: Omit<EffectState, 'sensors'>;
}

export interface LightingAudioTriggerSettings {
  enabled: boolean;
  intensity: number;
  switchDelay: number;
  shuffle: boolean;
  looks: LightingAudioTriggerLook[];
  deviceOverrides?: Record<string, { enabled?: boolean; intensity?: number }>;
}

export const LIGHTING_AUDIO_TRIGGER_MAX_LOOKS = 32;
export const DEFAULT_LIGHTING_AUDIO_TRIGGER: LightingAudioTriggerSettings = {
  enabled: false, intensity: 50, switchDelay: 1, shuffle: false, looks: [],
};
const PATH = '/lighting/audio-trigger';
const REQUEST_TIMEOUT_MS = 15_000;
const effects = new Set(EFFECTS.map(effect => effect.key));
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const number = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

function normalizeState(value: unknown): Omit<EffectState, 'sensors'> {
  const raw = object(value) ? value : {};
  const params = object(raw.params) ? Object.fromEntries(Object.entries(raw.params).slice(0, 128)
    .filter(([key, n]) => /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)
      && typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e9)) as Record<string, number> : {};
  return { speed: number(raw.speed, BASE_DEFAULTS.speed, -100, 100),
    intensity: number(raw.intensity, BASE_DEFAULTS.intensity, 0, 1),
    hue: number(raw.hue, BASE_DEFAULTS.hue, 0, 1), colorize: number(raw.colorize, BASE_DEFAULTS.colorize, 0, 1),
    saturation: number(raw.saturation, BASE_DEFAULTS.saturation, 0, 4), contrast: number(raw.contrast, BASE_DEFAULTS.contrast, 0, 4), params };
}

function normalizeLook(value: unknown): LightingAudioTriggerLook[] {
  if (!object(value)) return [];
  if (value.mode === 'media' && typeof value.mediaId === 'string' && /^[\p{L}\p{N}_-]{1,64}$/u.test(value.mediaId)) {
    return [{ mode: 'media', mediaId: value.mediaId }];
  }
  if (value.mode !== 'static' && value.mode !== 'animate') return [];
  if (value.mode === 'static' && typeof value.color === 'string' && /^#[a-f\d]{6}$/i.test(value.color)) {
    return [{ mode: 'static', color: value.color.toLowerCase() }];
  }
  if (typeof value.effect !== 'string' || !effects.has(value.effect)) return [];
  return [{ mode: value.mode, effect: value.effect, state: normalizeState(value.state) }];
}

/** Validate host/imported data before it reaches controls, previews or subsequent writes. */
export function normalizeLightingAudioTrigger(value: unknown): LightingAudioTriggerSettings {
  const raw = object(value) ? value : {};
  const deviceOverrides = object(raw.deviceOverrides) ? Object.fromEntries(Object.entries(raw.deviceOverrides).slice(0, 512)
    .filter(([id, entry]) => id.length > 0 && id.length <= 512 && !Array.from(id).some(char => char.charCodeAt(0) < 32) && object(entry))
    .map(([id, entry]) => {
      const item = entry as Record<string, unknown>;
      return [id, { ...(typeof item.enabled === 'boolean' ? { enabled: item.enabled } : {}),
        ...(typeof item.intensity === 'number' && Number.isFinite(item.intensity) && item.intensity >= 0 && item.intensity <= 100
          ? { intensity: item.intensity } : {}) }];
    })) : undefined;
  return { enabled: raw.enabled === true, intensity: number(raw.intensity, 50, 0, 100),
    switchDelay: number(raw.switchDelay, 1, 0, 10), shuffle: raw.shuffle === true,
    ...(deviceOverrides ? { deviceOverrides } : {}),
    looks: Array.isArray(raw.looks) ? raw.looks.slice(0, 256).flatMap(normalizeLook).slice(0, LIGHTING_AUDIO_TRIGGER_MAX_LOOKS) : [] };
}

/** A request can time out after reaching the host; never retry a save automatically. */
async function request(work: (signal: AbortSignal) => Promise<unknown>, owner?: AbortSignal): Promise<LightingAudioTriggerSettings | null> {
  if (owner?.aborted) return null;
  const controller = new AbortController();
  const abort = () => controller.abort();
  owner?.addEventListener('abort', abort, { once: true });
  let settleAbort = () => {};
  const cancelled = new Promise<null>(resolve => { settleAbort = () => resolve(null); });
  controller.signal.addEventListener('abort', settleAbort, { once: true });
  const timer = setTimeout(abort, REQUEST_TIMEOUT_MS);
  try {
    const raw = await Promise.race([work(controller.signal), cancelled]);
    return object(raw) && typeof raw.enabled === 'boolean' && Array.isArray(raw.looks)
      ? normalizeLightingAudioTrigger(raw) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    owner?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', settleAbort);
  }
}

export function fetchLightingAudioTrigger(signal?: AbortSignal): Promise<LightingAudioTriggerSettings | null> {
  return request(abort => fetchService<unknown>(PATH, abort), signal);
}

export function setLightingAudioTrigger(value: LightingAudioTriggerSettings, signal?: AbortSignal,
  controls?: readonly ('enabled' | 'intensity')[]): Promise<LightingAudioTriggerSettings | null> {
  const path = controls === undefined ? PATH : `${PATH}?controls=${controls.join(',')}`;
  return request(abort => postService<unknown>(path, normalizeLightingAudioTrigger(value), abort), signal);
}
