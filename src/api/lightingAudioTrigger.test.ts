import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchService, postService } from './service';
import {
  DEFAULT_LIGHTING_AUDIO_TRIGGER, LIGHTING_AUDIO_TRIGGER_MAX_LOOKS, normalizeLightingAudioTrigger,
  fetchLightingAudioTrigger, setLightingAudioTrigger,
} from './lightingAudioTrigger';

vi.mock('./service', () => ({ fetchService: vi.fn(), postService: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.useRealTimers());

describe('lighting Audio Trigger contract', () => {
  it('defaults old/missing values to a fresh disabled configuration', () => {
    const first = normalizeLightingAudioTrigger(undefined);
    expect(first).toEqual({ enabled: false, intensity: 50, switchDelay: 1, shuffle: false, looks: [] });
    expect(first).not.toBe(DEFAULT_LIGHTING_AUDIO_TRIGGER);
    expect(first.looks).not.toBe(DEFAULT_LIGHTING_AUDIO_TRIGGER.looks);
    expect(normalizeLightingAudioTrigger({ enabled: 'true', intensity: NaN, switchDelay: Infinity })).toEqual(first);
  });

  it('bounds settings, retains validated mixed looks and excludes unsupported sources', () => {
    const value = normalizeLightingAudioTrigger({ enabled: true, intensity: 200, switchDelay: -1, shuffle: true,
      looks: [{ mode: 'static', color: '#AABBCC' }, { mode: 'animate', effect: 'rainbow' },
        { mode: 'static', effect: 'checker' }, { mode: 'gif', color: '#ff0000' }, { mode: 'animate', effect: '../rainbow' },
        { mode: 'animate', effect: 'custom:abc' }, { mode: 'static', color: 'url(x)' }, null] });
    expect(value).toMatchObject({ enabled: true, intensity: 100, switchDelay: 0, shuffle: true });
    expect(value.looks).toHaveLength(3);
    expect(value.looks[0]).toEqual({ mode: 'static', color: '#aabbcc' });
    expect(value.looks[1]).toMatchObject({ mode: 'animate', effect: 'rainbow', state: { speed: 50, params: {} } });
    expect(value.looks[2]).toMatchObject({ mode: 'static', effect: 'checker' });
    expect(normalizeLightingAudioTrigger({ looks: Array.from({ length: 100 }, () => ({ mode: 'static', color: '#112233' })) }).looks)
      .toHaveLength(LIGHTING_AUDIO_TRIGGER_MAX_LOOKS);
  });

  it('retains isolated RGB media ids and rejects unsafe paths and empty media drafts', () => {
    const value = normalizeLightingAudioTrigger({ looks: [{ mode: 'media', mediaId: 'clip-one_1' },
      { mode: 'media', mediaId: '../private' }, { mode: 'media', mediaId: '' },
      { mode: 'media', mediaId: 'a'.repeat(65) }, { mode: 'media', mediaId: 'clip2', effect: 'rainbow' }] });
    expect(value.looks).toEqual([{ mode: 'media', mediaId: 'clip-one_1' }, { mode: 'media', mediaId: 'clip2' }]);
  });

  it('copies and sanitizes effect snapshots without sensor bindings or unsafe uniform values', () => {
    const state = { speed: -900, intensity: 7, hue: -1, colorize: Infinity, saturation: 9, contrast: NaN,
      params: { u_zoom: 2, bad: Infinity, enormous: 1e10, 'bad-key': 3 }, sensors: { u_sensor: { key: 'cpu' } } };
    const value = normalizeLightingAudioTrigger({ looks: [{ mode: 'animate', effect: 'rainbow', state }] });
    expect(value.looks[0].state).toEqual({ speed: -100, intensity: 1, hue: 0, colorize: 0,
      saturation: 4, contrast: 1, params: { u_zoom: 2 } });
    expect(value.looks[0].state?.params).not.toBe(state.params);
    expect(normalizeLightingAudioTrigger({ looks: [{ mode: 'animate', effect: 'rainbow', state: {
      params: Object.fromEntries(Array.from({ length: 200 }, (_, n) => [`u_${n}`, n])),
    } }] }).looks[0].state?.params).toHaveProperty('u_127');
    expect(Object.keys(normalizeLightingAudioTrigger({ looks: [{ mode: 'animate', effect: 'rainbow', state: {
      params: Object.fromEntries(Array.from({ length: 200 }, (_, n) => [`u_${n}`, n])),
    } }] }).looks[0].state!.params)).toHaveLength(128);
  });

  it('reads and saves canonical settings on the dedicated route with cancellation', async () => {
    const controller = new AbortController();
    vi.mocked(fetchService).mockResolvedValue({ ...DEFAULT_LIGHTING_AUDIO_TRIGGER, enabled: true });
    expect(await fetchLightingAudioTrigger(controller.signal)).toMatchObject({ enabled: true });
    expect(fetchService).toHaveBeenCalledWith('/lighting/audio-trigger', expect.any(AbortSignal));
    vi.mocked(postService).mockResolvedValue({ ...DEFAULT_LIGHTING_AUDIO_TRIGGER, intensity: 80 });
    expect(await setLightingAudioTrigger({ ...DEFAULT_LIGHTING_AUDIO_TRIGGER, intensity: 80 }, controller.signal))
      .toMatchObject({ intensity: 80 });
    expect(postService).toHaveBeenCalledWith('/lighting/audio-trigger', { ...DEFAULT_LIGHTING_AUDIO_TRIGGER, intensity: 80 }, expect.any(AbortSignal));
  });

  it.each([null, {}, [], { error: true }, { enabled: true, looks: 'invalid' }])('reports invalid/missing API responses as unavailable: %j', async response => {
    vi.mocked(fetchService).mockResolvedValue(response);
    vi.mocked(postService).mockResolvedValue(response);
    expect(await fetchLightingAudioTrigger()).toBeNull();
    expect(await setLightingAudioTrigger(DEFAULT_LIGHTING_AUDIO_TRIGGER)).toBeNull();
  });

  it('settles a failed request and an owner cancellation without retrying', async () => {
    vi.mocked(fetchService).mockRejectedValue(new Error('disconnected'));
    expect(await fetchLightingAudioTrigger()).toBeNull();
    const controller = new AbortController();
    vi.mocked(postService).mockReturnValue(new Promise(() => {}));
    const saved = setLightingAudioTrigger(DEFAULT_LIGHTING_AUDIO_TRIGGER, controller.signal);
    controller.abort();
    expect(await saved).toBeNull();
    expect(await setLightingAudioTrigger(DEFAULT_LIGHTING_AUDIO_TRIGGER, controller.signal)).toBeNull();
    expect(postService).toHaveBeenCalledTimes(1);
  });

  it('bounds a stalled request and releases its timeout', async () => {
    vi.useFakeTimers();
    vi.mocked(postService).mockReturnValue(new Promise(() => {}));
    const saved = setLightingAudioTrigger(DEFAULT_LIGHTING_AUDIO_TRIGGER);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await saved).toBeNull();
    expect(vi.mocked(postService).mock.calls[0][2]?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
