import { describe, expect, it } from 'vitest';
import { normalizeSharedBackgroundTransitions, resolveSharedBackgroundTransitions, resolveAudioTriggerBeatTransition } from './settings';

describe('shared Slideshow/Audio Trigger transition settings', () => {
  it('inherits missing beat settings for legacy records and respects explicit independent Off/duration', () => {
    const record = { backgroundTransitions: { enabled: true, effects: ['curtains:wave'], durationMs: 1500 } };
    expect(resolveAudioTriggerBeatTransition(record)).toEqual({ enabled: true, durationMs: 1500 });
    expect(resolveAudioTriggerBeatTransition({ ...record, backgroundAudioTriggerBeatTransition: { enabled: false, durationMs: 200 } }))
      .toEqual({ enabled: false, durationMs: 200 });
    expect(resolveAudioTriggerBeatTransition({ backgroundAudioTriggerTransition: { effect: 'curtains:wave', durationMs: 900 } }))
      .toEqual({ enabled: true, durationMs: 900 });
  });
  it('keeps one ordered selection/duration and bounds untrusted input', () => {
    expect(normalizeSharedBackgroundTransitions({ enabled: true, effects: ['curtains:wave', 'curtains:wave', 'anime:fade', 'gl-transitions:WaterDrop'], durationMs: 1230 }))
      .toEqual({ enabled: true, effects: ['curtains:wave', 'gl-transitions:WaterDrop'], durationMs: 1230 });
    expect(normalizeSharedBackgroundTransitions({ enabled: true, effects: ['default', 'none'], durationMs: 5001 }))
      .toEqual({ enabled: false, effects: [], durationMs: 800 });
  });
  it('retains selections when off and returns independent copies', () => {
    const effects = ['curtains:wave'];
    const first = normalizeSharedBackgroundTransitions({ enabled: false, effects, durationMs: 80 });
    expect(first).toEqual({ enabled: false, effects, durationMs: 80 });
    expect(first.effects).not.toBe(effects);
    expect(normalizeSharedBackgroundTransitions().effects).not.toBe(normalizeSharedBackgroundTransitions().effects);
  });
  it('migrates in memory from both legacy settings with slideshow duration priority', () => {
    expect(resolveSharedBackgroundTransitions({
      backgroundMediaTransition: { effect: 'curtains:wave', durationMs: 900 },
      backgroundAudioTriggerTransition: { effect: 'gl-transitions:WaterDrop', durationMs: 5000 },
    })).toEqual({ enabled: true, effects: ['curtains:wave', 'gl-transitions:WaterDrop'], durationMs: 900 });
  });
  it('uses audio duration when only audio had a custom effect and prefers the new shared object', () => {
    expect(resolveSharedBackgroundTransitions({ backgroundAudioTriggerTransition: { effect: 'curtains:wave', durationMs: 5000 } }))
      .toEqual({ enabled: true, effects: ['curtains:wave'], durationMs: 5000 });
    expect(resolveSharedBackgroundTransitions({ backgroundTransitions: { enabled: false, effects: [], durationMs: 120 },
      backgroundMediaTransition: { effect: 'curtains:wave', durationMs: 900 } }))
      .toEqual({ enabled: false, effects: [], durationMs: 120 });
  });
  it('leaves legacy input immutable and removes duplicates during migration', () => {
    const legacy = Object.freeze({ backgroundMediaTransition: Object.freeze({ effect: 'curtains:wave', durationMs: 200 }),
      backgroundAudioTriggerTransition: Object.freeze({ effect: 'curtains:wave', durationMs: 500 }) });
    expect(resolveSharedBackgroundTransitions(legacy)).toEqual({ enabled: true, effects: ['curtains:wave'], durationMs: 200 });
  });
});
