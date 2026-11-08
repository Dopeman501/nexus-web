import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LIGHTING_AUDIO_TRIGGER, fetchLightingAudioTrigger, setLightingAudioTrigger,
  type LightingAudioTriggerSettings,
} from '../api/lightingAudioTrigger';
import { useLightingAudioTrigger } from './useLightingAudioTrigger';

const listeners = vi.hoisted(() => new Set<() => void>());
vi.mock('../api/lightingAudioTrigger', async importOriginal => ({
  ...(await importOriginal<typeof import('../api/lightingAudioTrigger')>()),
  fetchLightingAudioTrigger: vi.fn(), setLightingAudioTrigger: vi.fn(),
}));
vi.mock('./useMultiplexSocket', async () => {
  const { useEffect } = await import('react');
  return { useTopicCallback: (_topic: string, active: boolean, cb: () => void) => {
    useEffect(() => { if (!active) return; listeners.add(cb); return () => { listeners.delete(cb); }; }, [active, cb]);
  } };
});
const settings = (patch: Partial<LightingAudioTriggerSettings> = {}): LightingAudioTriggerSettings => ({ ...DEFAULT_LIGHTING_AUDIO_TRIGGER, looks: [], ...patch });
const deferred = <T,>() => {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
beforeEach(() => {
  vi.resetAllMocks(); listeners.clear();
  vi.mocked(fetchLightingAudioTrigger).mockResolvedValue(settings());
  vi.mocked(setLightingAudioTrigger).mockImplementation(async value => value);
});

describe('lighting Audio Trigger owner', () => {
  it('does not read or write while inactive and hydrates when activated', async () => {
    const { result, rerender } = renderHook(({ active }) => useLightingAudioTrigger(active, 'profile'), { initialProps: { active: false } });
    act(() => { result.current.refresh(); result.current.change({ enabled: true }); });
    expect(fetchLightingAudioTrigger).not.toHaveBeenCalled();
    expect(setLightingAudioTrigger).not.toHaveBeenCalled();
    expect(result.current.available).toBe(false);
    rerender({ active: true });
    await waitFor(() => expect(result.current.available).toBe(true));
    expect(result.current.loading).toBe(false);
    expect(result.current.value).toEqual(settings());
  });

  it('saves one full snapshot, ignores duplicate/conflicting commits while busy, and uses host canonical readback', async () => {
    const write = deferred<LightingAudioTriggerSettings | null>();
    vi.mocked(setLightingAudioTrigger).mockReturnValueOnce(write.promise);
    const { result } = renderHook(() => useLightingAudioTrigger(true, 'profile'));
    await waitFor(() => expect(result.current.available).toBe(true));
    act(() => {
      result.current.change({ intensity: 80 });
      result.current.change({ intensity: 80 });
      result.current.change({ enabled: true });
    });
    expect(setLightingAudioTrigger).toHaveBeenCalledExactlyOnceWith(settings({ intensity: 80 }), expect.any(AbortSignal));
    expect(result.current.saving).toBe(true);
    expect(result.current.value.intensity).toBe(80);
    await act(async () => write.resolve(settings({ intensity: 75 })));
    expect(result.current.value.intensity).toBe(75);
    expect(result.current.saving).toBe(false);
    act(() => result.current.change({ intensity: 75 }));
    expect(setLightingAudioTrigger).toHaveBeenCalledTimes(1);
  });

  it.each(['null', 'reject'])('restores the last saved value after a %s save failure', async failure => {
    if (failure === 'null') vi.mocked(setLightingAudioTrigger).mockResolvedValueOnce(null);
    else vi.mocked(setLightingAudioTrigger).mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useLightingAudioTrigger(true, 'profile'));
    await waitFor(() => expect(result.current.available).toBe(true));
    act(() => result.current.change({ enabled: true }));
    await waitFor(() => expect(result.current.error).toBe('save'));
    expect(result.current.value.enabled).toBe(false);
    expect(result.current.saving).toBe(false);
    act(() => result.current.change({ enabled: true }));
    await waitFor(() => expect(result.current.value.enabled).toBe(true));
    await waitFor(() => expect(result.current.saving).toBe(false));
    expect(result.current.error).toBeNull();
  });

  it('defers lighting-topic reloads until the single write settles', async () => {
    const write = deferred<LightingAudioTriggerSettings | null>();
    vi.mocked(setLightingAudioTrigger).mockReturnValueOnce(write.promise);
    const { result } = renderHook(() => useLightingAudioTrigger(true, 'profile'));
    await waitFor(() => expect(result.current.available).toBe(true));
    act(() => result.current.change({ enabled: true }));
    act(() => { listeners.forEach(cb => cb()); listeners.forEach(cb => cb()); });
    expect(fetchLightingAudioTrigger).toHaveBeenCalledTimes(1);
    vi.mocked(fetchLightingAudioTrigger).mockResolvedValue(settings({ enabled: true, intensity: 90 }));
    await act(async () => write.resolve(settings({ enabled: true })));
    await waitFor(() => expect(result.current.value.intensity).toBe(90));
    expect(fetchLightingAudioTrigger).toHaveBeenCalledTimes(2);
  });

  it('rejects an old read that lands after a newer save', async () => {
    const stale = deferred<LightingAudioTriggerSettings | null>();
    const { result } = renderHook(() => useLightingAudioTrigger(true, 'profile'));
    await waitFor(() => expect(result.current.available).toBe(true));
    vi.mocked(fetchLightingAudioTrigger).mockReturnValueOnce(stale.promise);
    act(() => result.current.refresh());
    act(() => result.current.change({ enabled: true }));
    await waitFor(() => expect(result.current.saving).toBe(false));
    await act(async () => stale.resolve(settings()));
    expect(result.current.value.enabled).toBe(true);
  });

  it('clears old profile data, cancels its write, and ignores a late completion', async () => {
    const write = deferred<LightingAudioTriggerSettings | null>();
    const loadNew = deferred<LightingAudioTriggerSettings | null>();
    const { result, rerender } = renderHook(({ profile }) => useLightingAudioTrigger(true, profile), { initialProps: { profile: 'old' } });
    await waitFor(() => expect(result.current.available).toBe(true));
    vi.mocked(setLightingAudioTrigger).mockReturnValueOnce(write.promise);
    act(() => result.current.change({ enabled: true }));
    const signal = vi.mocked(setLightingAudioTrigger).mock.calls[0][1]!;
    vi.mocked(fetchLightingAudioTrigger).mockReturnValueOnce(loadNew.promise);
    rerender({ profile: 'new' });
    expect(signal.aborted).toBe(true);
    expect(result.current.value.enabled).toBe(false);
    expect(result.current.available).toBe(false);
    expect(result.current.loading).toBe(true);
    await act(async () => loadNew.resolve(settings({ intensity: 20 })));
    await act(async () => write.resolve(settings({ enabled: true, intensity: 100 })));
    expect(result.current.value).toEqual(settings({ intensity: 20 }));
    expect(result.current.saving).toBe(false);
    expect(fetchLightingAudioTrigger).toHaveBeenCalledTimes(2);
  });

  it('ignores a previous profile read and aborts pending reads on unmount', async () => {
    const stale = deferred<LightingAudioTriggerSettings | null>();
    vi.mocked(fetchLightingAudioTrigger).mockReturnValueOnce(stale.promise);
    const { result, rerender, unmount } = renderHook(({ profile }) => useLightingAudioTrigger(true, profile), { initialProps: { profile: 'old' } });
    const oldSignal = vi.mocked(fetchLightingAudioTrigger).mock.calls[0][0]!;
    rerender({ profile: 'new' });
    await waitFor(() => expect(result.current.available).toBe(true));
    expect(oldSignal.aborted).toBe(true);
    await act(async () => stale.resolve(settings({ enabled: true })));
    expect(result.current.value.enabled).toBe(false);
    const currentSignal = vi.mocked(fetchLightingAudioTrigger).mock.calls[1][0]!;
    unmount();
    expect(currentSignal.aborted).toBe(true);
    expect(listeners.size).toBe(0);
  });

  it('shows a load failure and recovers only after a valid refresh', async () => {
    vi.mocked(fetchLightingAudioTrigger).mockResolvedValueOnce(null);
    const { result } = renderHook(() => useLightingAudioTrigger(true));
    await waitFor(() => expect(result.current.error).toBe('load'));
    expect(result.current.loading).toBe(false);
    expect(result.current.available).toBe(false);
    act(() => result.current.change({ enabled: true }));
    expect(setLightingAudioTrigger).not.toHaveBeenCalled();
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.available).toBe(true));
    expect(result.current.error).toBeNull();
  });
});
