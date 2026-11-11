import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAudioTriggerTargets, setAudioTriggerTargets, type AudioTriggerSnapshot } from '../../../api/audioTriggerTargets';
import { useAudioTriggerTargets } from './useAudioTriggerTargets';

vi.mock('../../../api/audioTriggerTargets', () => ({ fetchAudioTriggerTargets: vi.fn(), setAudioTriggerTargets: vi.fn() }));
const listeners = vi.hoisted(() => new Set<() => void>());
vi.mock('../../../hooks/useMultiplexSocket', async () => {
  const { useEffect } = await import('react');
  return { useTopicCallback: (_topic: string, active: boolean, callback: () => void) => {
    useEffect(() => { if (!active) return; listeners.add(callback); return () => { listeners.delete(callback); }; }, [active, callback]);
  } };
});
const epoch = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const seed = (): AudioTriggerSnapshot => ({ epoch, targets: [
  { id: 'background:y70', kind: 'background', name: 'Y70', enabled: false, intensity: 40 },
  { id: 'lighting:fan', kind: 'lighting', name: 'Fan', enabled: true, intensity: 60 },
] });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
beforeEach(() => {
  vi.resetAllMocks(); listeners.clear();
  vi.mocked(fetchAudioTriggerTargets).mockResolvedValue(seed());
  vi.mocked(setAudioTriggerTargets).mockImplementation(async patch => ({ epoch, targets: seed().targets.map(target =>
    !patch.targetIds || patch.targetIds.includes(target.id) ? { ...target,
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.intensity !== undefined ? { intensity: patch.intensity } : {}) } : target) }));
});

describe('universal Audio Trigger control ownership', () => {
  it('loads disabled configured targets and provides a pure catalog preview', async () => {
    const preview = renderHook(() => useAudioTriggerTargets(true));
    expect(preview.result.current.targets.length).toBeGreaterThan(0);
    expect(fetchAudioTriggerTargets).not.toHaveBeenCalled();
    act(() => preview.result.current.change({ enabled: true }));
    expect(setAudioTriggerTargets).not.toHaveBeenCalled();
    preview.unmount();
    const { result } = renderHook(() => useAudioTriggerTargets(false));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.targets).toEqual(seed().targets);
  });

  it('serializes global then individual intent and coalesces rapid trailing values', async () => {
    const first = deferred<AudioTriggerSnapshot | null>();
    const second = deferred<AudioTriggerSnapshot | null>();
    vi.mocked(setAudioTriggerTargets).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useAudioTriggerTargets(false));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.change({ intensity: 80 });
      result.current.change({ targetIds: ['background:y70'], intensity: 10 });
      result.current.change({ targetIds: ['background:y70'], intensity: 25 });
    });
    expect(setAudioTriggerTargets).toHaveBeenCalledTimes(1);
    expect(result.current.targets.map(t => t.intensity)).toEqual([25, 80]);
    await act(async () => first.resolve({ epoch, targets: seed().targets.map(t => ({ ...t, intensity: 80 })) }));
    expect(setAudioTriggerTargets).toHaveBeenCalledTimes(2);
    expect(vi.mocked(setAudioTriggerTargets).mock.calls[1][0]).toEqual({ expectedEpoch: epoch, targetIds: ['background:y70'], intensity: 25 });
    expect(result.current.targets.map(t => t.intensity)).toEqual([25, 80]);
    await act(async () => second.resolve({ epoch, targets: seed().targets.map((t, i) => ({ ...t, intensity: i === 0 ? 25 : 80 })) }));
    expect(result.current.saving).toBe(false);
    expect(result.current.targets.map(t => t.intensity)).toEqual([25, 80]);
  });

  it('does not reorder a newer universal action behind an older individual action', async () => {
    const first = deferred<AudioTriggerSnapshot | null>();
    vi.mocked(setAudioTriggerTargets).mockReturnValueOnce(first.promise);
    const { result } = renderHook(() => useAudioTriggerTargets(false));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.change({ enabled: true });
      result.current.change({ intensity: 80 });
      result.current.change({ targetIds: ['background:y70'], intensity: 20 });
      result.current.change({ intensity: 90 });
    });
    expect(result.current.targets.map(t => t.intensity)).toEqual([90, 90]);
    await act(async () => first.resolve({ epoch, targets: seed().targets.map(t => ({ ...t, enabled: true })) }));
    await waitFor(() => expect(result.current.saving).toBe(false));
    expect(vi.mocked(setAudioTriggerTargets).mock.calls.at(-1)?.[0]).toEqual({ expectedEpoch: epoch, intensity: 90 });
  });

  it('shares the write queue across tile and immersive instances', async () => {
    const first = deferred<AudioTriggerSnapshot | null>();
    vi.mocked(setAudioTriggerTargets).mockReturnValueOnce(first.promise);
    const tile = renderHook(() => useAudioTriggerTargets(false));
    await waitFor(() => expect(tile.result.current.loading).toBe(false));
    act(() => { tile.result.current.change({ intensity: 80 }); tile.result.current.change({ intensity: 90 }); });
    const immersive = renderHook(() => useAudioTriggerTargets(false));
    act(() => immersive.result.current.change({ targetIds: ['background:y70'], intensity: 25 }));
    expect(setAudioTriggerTargets).toHaveBeenCalledTimes(1);
    expect(immersive.result.current.targets.map(target => target.intensity)).toEqual([25, 90]);
    expect(tile.result.current.targets).toEqual(immersive.result.current.targets);
    tile.unmount();
    expect(vi.mocked(setAudioTriggerTargets).mock.calls[0][1]!.aborted).toBe(false);
    await act(async () => first.resolve({ epoch, targets: seed().targets.map(t => ({ ...t, intensity: 80 })) }));
    await waitFor(() => expect(immersive.result.current.saving).toBe(false));
    expect(vi.mocked(setAudioTriggerTargets).mock.calls.map(call => call[0])).toEqual([
      { expectedEpoch: epoch, intensity: 80 }, { expectedEpoch: epoch, intensity: 90 },
      { expectedEpoch: epoch, targetIds: ['background:y70'], intensity: 25 },
    ]);
    immersive.unmount();
    expect(vi.mocked(setAudioTriggerTargets).mock.calls[0][1]!.aborted).toBe(true);
  });

  it('rejects a stale read after a save and aborts owned work on unmount', async () => {
    const stale = deferred<AudioTriggerSnapshot | null>();
    const { result, unmount } = renderHook(() => useAudioTriggerTargets(false));
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.mocked(fetchAudioTriggerTargets).mockReturnValueOnce(stale.promise);
    act(() => result.current.refresh());
    act(() => result.current.change({ enabled: false }));
    await waitFor(() => expect(result.current.saving).toBe(false));
    await act(async () => stale.resolve(seed()));
    expect(result.current.targets.every(t => !t.enabled)).toBe(true);
    const signal = vi.mocked(setAudioTriggerTargets).mock.calls[0][1]!;
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it('discards queued work after an ambiguous failure, reads back, and exposes the error', async () => {
    const write = deferred<AudioTriggerSnapshot | null>();
    vi.mocked(setAudioTriggerTargets).mockReturnValueOnce(write.promise);
    const { result } = renderHook(() => useAudioTriggerTargets(false));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { result.current.change({ enabled: false }); result.current.change({ intensity: 90 }); });
    await act(async () => write.resolve(null));
    await waitFor(() => expect(fetchAudioTriggerTargets).toHaveBeenCalledTimes(2));
    expect(setAudioTriggerTargets).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe('save');
    expect(result.current.targets).toEqual(seed().targets);
  });

  it('shows a load failure, prevents edits, and supports explicit recovery', async () => {
    vi.mocked(fetchAudioTriggerTargets).mockResolvedValueOnce(null);
    const { result } = renderHook(() => useAudioTriggerTargets(false));
    await waitFor(() => expect(result.current.error).toBe('load'));
    act(() => result.current.change({ enabled: true }));
    expect(setAudioTriggerTargets).not.toHaveBeenCalled();
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.targets).toEqual(seed().targets));
    expect(result.current.error).toBeNull();
  });

  it('reads again after a change notification arrives during the previous read', async () => {
    const first = deferred<AudioTriggerSnapshot | null>();
    vi.mocked(fetchAudioTriggerTargets).mockReturnValueOnce(first.promise);
    const { result } = renderHook(() => useAudioTriggerTargets(false));
    act(() => listeners.forEach(callback => callback()));
    await act(async () => first.resolve(seed()));
    await waitFor(() => expect(fetchAudioTriggerTargets).toHaveBeenCalledTimes(2));
    expect(result.current.targets).toEqual(seed().targets);
  });

  it('retires all old queued intent after the service rejects a changed profile epoch', async () => {
    const write = deferred<AudioTriggerSnapshot | null>();
    vi.mocked(setAudioTriggerTargets).mockReturnValueOnce(write.promise);
    const { result } = renderHook(() => useAudioTriggerTargets(false));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { result.current.change({ intensity: 80 }); result.current.change({ enabled: false }); });
    vi.mocked(fetchAudioTriggerTargets).mockResolvedValue({ ...seed(), epoch: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });
    await act(async () => write.resolve(null));
    await waitFor(() => expect(result.current.saving).toBe(false));
    expect(setAudioTriggerTargets).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.targets).toEqual(seed().targets));
    act(() => result.current.change({ intensity: 20 }));
    expect(vi.mocked(setAudioTriggerTargets).mock.calls[1][0].expectedEpoch).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  });
});
