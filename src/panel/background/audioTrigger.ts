import { readD215PanelBackground, type D215PanelBackground } from '../d215/d215PanelBackground';

export interface AudioTriggerSettings {
  enabled: boolean;
  /** Sensitivity: higher values admit quieter audio and smaller attacks. */
  intensity: number;
  /** Seconds, used only for entry and return to the normal background. */
  switchDelay: number;
  shuffle: boolean;
  backgrounds: D215PanelBackground[];
}

export const AUDIO_TRIGGER_MAX_BACKGROUNDS = 32;
export const AUDIO_TRIGGER_STALE_MS = 350;
export const AUDIO_TRIGGER_REFRACTORY_MS = 120;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const bounded = (value: unknown, fallback: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback;

/** Imports can reach the renderer before a privileged save validates them. */
export function normalizeAudioTrigger(value: unknown): AudioTriggerSettings {
  const raw = object(value) ? value : {};
  const backgrounds = Array.isArray(raw.backgrounds) ? raw.backgrounds.slice(0, 256).flatMap(entry => {
    if (!object(entry) || !['solid', 'shader', 'media'].includes(entry.mode as string)) return [];
    const bg = readD215PanelBackground(entry);
    if (!bg || (bg.mode === 'media' && (!bg.mediaId || !bg.mediaType))) return [];
    return [{ ...bg, slideshow: false, mediaOrder: [] }];
  }).slice(0, AUDIO_TRIGGER_MAX_BACKGROUNDS) : [];
  return { enabled: raw.enabled === true, intensity: bounded(raw.intensity, 50, 100),
    switchDelay: bounded(raw.switchDelay, 1, 10), shuffle: raw.shuffle === true, backgrounds };
}

export interface AudioTriggerSample { level: number; bass: number; beat: number }
export interface AudioTriggerState {
  index: number | null;
  playingSince: number | null;
  quietSince: number | null;
  lastAttackAt: number;
  previousPeak: number;
}

export const initialAudioTriggerState = (): AudioTriggerState => ({
  index: null, playingSince: null, quietSince: null, lastAttackAt: -Infinity, previousPeak: 0,
});

export function readAudioTriggerSample(raw: unknown): AudioTriggerSample | null {
  if (!object(raw)) return null;
  if (![raw.level, raw.bass, raw.beat].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) return null;
  return { level: raw.level as number, bass: raw.bass as number, beat: raw.beat as number };
}

function nextIndex(current: number | null, count: number, shuffle: boolean, random: () => number): number {
  if (!shuffle) return current === null ? 0 : (current + 1) % count;
  const pick = Math.min(0.999999, Math.max(0, random()));
  if (current === null) return Math.floor(pick * count);
  // Choose from all *other* entries without retry loops or adjacent repeats.
  return (current + 1 + Math.floor(pick * (count - 1))) % count;
}

/** Pure transitions: the caller supplies monotonic time and fresh samples. */
export function advanceAudioTrigger(state: AudioTriggerState, settings: AudioTriggerSettings,
  sample: AudioTriggerSample | null, now: number, random: () => number = Math.random): AudioTriggerState {
  const count = settings.backgrounds.length;
  if (!settings.enabled || count === 0) return initialAudioTriggerState();
  const valid = readAudioTriggerSample(sample);
  const sensitivity = settings.intensity / 100;
  const levelThreshold = 0.55 - sensitivity * 0.535;
  const playing = valid !== null && valid.level >= levelThreshold;
  const peak = playing ? Math.max(valid.bass, valid.beat) : 0;
  const delay = settings.switchDelay * 1000;
  if (!playing) {
    const quietSince = state.quietSince ?? now;
    return { ...state, playingSince: null, quietSince, previousPeak: 0,
      index: now - quietSince >= delay ? null : state.index };
  }
  const playingSince = state.playingSince ?? now;
  if (state.index === null) {
    const entered = now - playingSince >= delay;
    return { ...state, playingSince, quietSince: null, previousPeak: peak,
      index: entered ? nextIndex(null, count, settings.shuffle, random) : null,
      lastAttackAt: entered ? now : state.lastAttackAt };
  }
  const threshold = 0.65 - sensitivity * 0.6;
  const attackDelta = 0.22 - sensitivity * 0.19;
  const attack = peak >= threshold && (state.previousPeak < threshold * 0.55 || peak - state.previousPeak >= attackDelta);
  const advance = count > 1 && attack && now - state.lastAttackAt >= AUDIO_TRIGGER_REFRACTORY_MS;
  return { ...state, playingSince, quietSince: null, previousPeak: peak,
    index: advance ? nextIndex(state.index, count, settings.shuffle, random) : state.index,
    lastAttackAt: advance ? now : state.lastAttackAt };
}
