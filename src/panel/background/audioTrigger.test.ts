import { describe, expect, it } from 'vitest';
import { advanceAudioTrigger, initialAudioTriggerState, normalizeAudioTrigger } from './audioTrigger';

const backgrounds = [{ mode: 'solid', color: '#ff0000' }, { mode: 'media', mediaId: 'clip', mediaType: 'animated' }, { mode: 'shader', effect: 'plasma' }];
const config = normalizeAudioTrigger({ enabled: true, switchDelay: 1, backgrounds });
const sound = { level: 0.8, bass: 0.1, beat: 0 };
const kick = { level: 0.8, bass: 0.8, beat: 1 };
const quiet = { level: 0, bass: 0, beat: 0 };

describe('Audio Trigger transitions', () => {
  it('rejects a short notification and cancels pending entry on silence', () => {
    const pending = advanceAudioTrigger(initialAudioTriggerState(), config, sound, 0);
    const canceled = advanceAudioTrigger(pending, config, quiet, 300);
    expect(advanceAudioTrigger(canceled, config, quiet, 2000).index).toBeNull();
    expect(advanceAudioTrigger(canceled, config, sound, 2000).index).toBeNull();
  });
  it('waits for sustained audio then advances on attacks without applying Switch Delay', () => {
    let state = advanceAudioTrigger(initialAudioTriggerState(), config, sound, 0);
    state = advanceAudioTrigger(state, config, sound, 999);
    expect(state.index).toBeNull();
    state = advanceAudioTrigger(state, config, sound, 1000);
    expect(state.index).toBe(0);
    state = advanceAudioTrigger(state, config, kick, 1150);
    expect(state.index).toBe(1);
    state = advanceAudioTrigger(state, config, kick, 1350);
    expect(state.index).toBe(1);
    state = advanceAudioTrigger(state, config, sound, 1400);
    expect(advanceAudioTrigger(state, config, kick, 1500).index).toBe(2);
  });
  it('holds one choice and returns only after sustained silence, canceling short gaps', () => {
    const single = { ...config, backgrounds: config.backgrounds.slice(0, 1) };
    let state = advanceAudioTrigger(initialAudioTriggerState(), single, sound, 0);
    state = advanceAudioTrigger(state, single, kick, 1000);
    state = advanceAudioTrigger(state, single, quiet, 1100);
    state = advanceAudioTrigger(state, single, sound, 1700);
    expect(state.index).toBe(0);
    state = advanceAudioTrigger(state, single, quiet, 1800);
    expect(advanceAudioTrigger(state, single, quiet, 2799).index).toBe(0);
    expect(advanceAudioTrigger(state, single, quiet, 2800).index).toBeNull();
  });
  it('supports zero delay, disabled/empty settings, sensitivity and invalid frames', () => {
    const instant = { ...config, switchDelay: 0 };
    const active = advanceAudioTrigger(initialAudioTriggerState(), instant, sound, 0);
    expect(active.index).toBe(0);
    expect(advanceAudioTrigger(active, { ...instant, enabled: false }, sound, 1).index).toBeNull();
    expect(advanceAudioTrigger(active, { ...instant, backgrounds: [] }, sound, 1).index).toBeNull();
    expect(advanceAudioTrigger(initialAudioTriggerState(), { ...instant, intensity: 0 }, { ...sound, level: 0.1 }, 0).index).toBeNull();
    expect(advanceAudioTrigger(initialAudioTriggerState(), { ...instant, intensity: 100 }, { ...sound, level: 0.1 }, 0).index).toBe(0);
    expect(advanceAudioTrigger(active, instant, { ...sound, level: NaN }, 1).index).toBeNull();
    expect(advanceAudioTrigger(active, instant, null, 1).index).toBeNull();
  });
  it('bounds rhythm rate, wraps ordered selections and never shuffles to the same selection', () => {
    const instant = { ...config, switchDelay: 0 };
    let state = advanceAudioTrigger(initialAudioTriggerState(), instant, sound, 0);
    expect(advanceAudioTrigger(state, instant, kick, 50).index).toBe(0);
    for (let i = 1; i <= 3; i++) {
      state = advanceAudioTrigger(state, instant, sound, i * 200);
      state = advanceAudioTrigger(state, instant, kick, i * 200 + 50);
      expect(state.index).toBe(i % 3);
    }
    const shuffled = { ...instant, shuffle: true };
    state = advanceAudioTrigger(state, shuffled, sound, 900);
    expect(advanceAudioTrigger(state, shuffled, kick, 1000, () => 0).index).not.toBe(state.index);
    state = advanceAudioTrigger(state, shuffled, sound, 1100);
    expect(advanceAudioTrigger(state, shuffled, kick, 1200, () => 0.999).index).not.toBe(state.index);
  });
});

describe('Audio Trigger untrusted settings', () => {
  it('defaults off and normalizes bounded independent backgrounds', () => {
    expect(normalizeAudioTrigger(null)).toEqual({ enabled: false, intensity: 50, switchDelay: 1, shuffle: false, backgrounds: [] });
    const normalized = normalizeAudioTrigger({ enabled: 1, intensity: Infinity, switchDelay: -3, shuffle: true,
      backgrounds: [...backgrounds, { mode: 'bad' }, { mode: 'media', mediaId: '../bad' }, ...Array(40).fill(backgrounds[0])] });
    expect(normalized).toMatchObject({ enabled: false, intensity: 50, switchDelay: 0, shuffle: true });
    expect(normalized.backgrounds).toHaveLength(32);
    expect(normalized.backgrounds.every(bg => bg.slideshow === false)).toBe(true);
    expect(normalized.backgrounds[0]).not.toBe(backgrounds[0]);
    expect(normalizeAudioTrigger({ intensity: 200, switchDelay: 20 }).intensity).toBe(100);
    expect(normalizeAudioTrigger({ switchDelay: 20 }).switchDelay).toBe(10);
  });
});
