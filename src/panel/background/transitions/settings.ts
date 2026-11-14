import { isBackgroundTransitionEffect, isPictureTransitionEffect } from './catalogue';

export interface BackgroundTransitionSettings {
  effect: string;
  durationMs: number;
}
export const defaultBackgroundTransition: Readonly<BackgroundTransitionSettings> = Object.freeze({
  effect: 'default', durationMs: 800,
});

export function normalizeBackgroundTransition(value: unknown): BackgroundTransitionSettings {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  return {
    effect: isBackgroundTransitionEffect(record.effect) ? record.effect : defaultBackgroundTransition.effect,
    durationMs: typeof record.durationMs === 'number' && Number.isInteger(record.durationMs)
      && record.durationMs >= 80 && record.durationMs <= 5000 ? record.durationMs : defaultBackgroundTransition.durationMs,
  };
}

export interface SharedBackgroundTransitionSettings {
  enabled: boolean;
  effects: string[];
  durationMs: number;
}
export interface AudioTriggerBeatTransitionSettings { enabled: boolean; durationMs: number }
export const MAX_SHARED_TRANSITIONS = 226;
export const DEFAULT_SHARED_TRANSITION = 'gl-transitions:WaterDrop';

/** Stored selections are ordered, unique custom effects; Off retains the list. */
export function normalizeSharedBackgroundTransitions(value?: unknown): SharedBackgroundTransitionSettings {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const effects = Array.isArray(record.effects)
    ? [...new Set(record.effects.slice(0, MAX_SHARED_TRANSITIONS).filter(isPictureTransitionEffect))]
    : [DEFAULT_SHARED_TRANSITION];
  return { enabled: record.enabled === true && effects.length > 0, effects,
    durationMs: normalizeBackgroundTransition({ durationMs: record.durationMs }).durationMs };
}

/** Read older comparison preferences without writing/migrating any saved background. */
export function resolveSharedBackgroundTransitions(record?: {
  backgroundTransitions?: unknown; backgroundMediaTransition?: unknown; backgroundAudioTriggerTransition?: unknown;
} | null): SharedBackgroundTransitionSettings {
  if (record?.backgroundTransitions != null) return normalizeSharedBackgroundTransitions(record.backgroundTransitions);
  const media = normalizeBackgroundTransition(record?.backgroundMediaTransition);
  const audio = normalizeBackgroundTransition(record?.backgroundAudioTriggerTransition);
  const effects = [...new Set([media.effect, audio.effect].filter(isPictureTransitionEffect))];
  return { enabled: effects.length > 0, effects: effects.length ? effects : [DEFAULT_SHARED_TRANSITION],
    durationMs: isPictureTransitionEffect(media.effect) ? media.durationMs : isPictureTransitionEffect(audio.effect) ? audio.durationMs : 800 };
}

export function normalizeAudioTriggerBeatTransition(value: unknown,
  inherited: AudioTriggerBeatTransitionSettings = { enabled: false, durationMs: 800 }): AudioTriggerBeatTransitionSettings {
  if (value == null) return { enabled: inherited.enabled, durationMs: inherited.durationMs };
  const record = typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return { enabled: record.enabled === true, durationMs: normalizeBackgroundTransition(record).durationMs };
}

export function resolveAudioTriggerBeatTransition(record?: {
  backgroundAudioTriggerBeatTransition?: unknown; backgroundTransitions?: unknown;
  backgroundMediaTransition?: unknown; backgroundAudioTriggerTransition?: unknown;
} | null): AudioTriggerBeatTransitionSettings {
  return normalizeAudioTriggerBeatTransition(record?.backgroundAudioTriggerBeatTransition, resolveSharedBackgroundTransitions(record));
}
