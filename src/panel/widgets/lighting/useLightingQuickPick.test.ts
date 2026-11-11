import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPins, setLightingPaused, setPins } from '../../../api/lighting';
import { useLightingQuickPick } from './useLightingQuickPick';

vi.mock('../../../api/lighting', () => ({
  fetchPins: vi.fn(async () => ({ a: { kind: 'animate', effect: 'fire' } })),
  setPins: vi.fn(async () => true),
  setLightingPaused: vi.fn(async () => ({ paused: false })),
}));

describe('explicit lighting pick ordering', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('cancels a waiting pick when a newer mode intent arrives', async () => {
    let release!: () => void;
    vi.mocked(fetchPins).mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ a: { kind: 'animate', effect: 'fire' } }); }));
    const start = vi.fn(async () => true);
    const { result } = renderHook(() => useLightingQuickPick(false, async () => {}));
    act(() => { result.current.pick(start); result.current.cancel(); });
    await act(async () => { release(); });
    expect(start).not.toHaveBeenCalled();
    expect(setPins).not.toHaveBeenCalled();
  });

  it('keeps one active and only the latest pending pick', async () => {
    let release!: () => void;
    const first = vi.fn(() => new Promise<boolean>(resolve => { release = () => resolve(true); }));
    const skipped = vi.fn(async () => true);
    const last = vi.fn(async () => true);
    const reconcile = vi.fn(async () => {});
    const { result } = renderHook(() => useLightingQuickPick(false, reconcile));
    act(() => { result.current.pick(first); });
    await waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    act(() => { result.current.pick(skipped); result.current.pick(last); });
    await act(async () => { release(); });
    await waitFor(() => expect(last).toHaveBeenCalledTimes(1));
    expect(skipped).not.toHaveBeenCalled();
    expect(setPins).toHaveBeenCalledTimes(2);
  });

  it.each(['read', 'resume', 'start', 'pins', 'throw'] as const)('reports %s failure and reconciles without retry', async failure => {
    vi.mocked(fetchPins).mockResolvedValueOnce(failure === 'read' ? null : { a: { kind: 'animate', effect: 'fire' } });
    if (failure === 'resume') vi.mocked(setLightingPaused).mockResolvedValueOnce(null);
    if (failure === 'pins') vi.mocked(setPins).mockResolvedValueOnce(false);
    const start = vi.fn(async () => { if (failure === 'throw') throw new Error('offline'); return failure !== 'start'; });
    const reconcile = vi.fn(async () => {});
    const { result } = renderHook(() => useLightingQuickPick(failure === 'resume', reconcile));
    act(() => { result.current.pick(start); });
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(reconcile).toHaveBeenCalledTimes(1);
    if (failure !== 'pins') expect(setPins).not.toHaveBeenCalled();
  });

  it('drops pending work and pin writes after unmount', async () => {
    let release!: () => void;
    const first = vi.fn(() => new Promise<boolean>(resolve => { release = () => resolve(true); }));
    const last = vi.fn(async () => true);
    const reconcile = vi.fn(async () => {});
    const { result, unmount } = renderHook(() => useLightingQuickPick(false, reconcile));
    act(() => { result.current.pick(first); });
    await waitFor(() => expect(first).toHaveBeenCalled());
    act(() => { result.current.pick(last); });
    unmount();
    await act(async () => { release(); });
    expect(last).not.toHaveBeenCalled();
    expect(setPins).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('does not write pins when no device is pinned', async () => {
    vi.mocked(fetchPins).mockResolvedValueOnce({});
    const reconcile = vi.fn(async () => {});
    const { result } = renderHook(() => useLightingQuickPick(true, reconcile));
    const start = vi.fn(async () => true);
    await act(async () => { result.current.pick(start); });
    expect(start).toHaveBeenCalledTimes(1);
    expect(setLightingPaused).toHaveBeenCalledWith(false);
    expect(setPins).not.toHaveBeenCalled();
    expect(result.current.failed).toBe(false);
  });
});
