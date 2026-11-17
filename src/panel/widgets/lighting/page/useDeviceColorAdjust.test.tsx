import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeviceColorAdjust } from './useDeviceColorAdjust';
import { fetchLightingColorAdjust, setLightingColorAdjust, NEUTRAL_COLOR_ADJUST } from '../../../../api/lighting';
vi.mock('../../../../api/lighting', () => ({
  fetchLightingColorAdjust: vi.fn(), setLightingColorAdjust: vi.fn(),
  NEUTRAL_COLOR_ADJUST: { red: 1, green: 1, blue: 1, temperature: 0, saturation: 1, colorOrder: 'RGB' },
}));
const initial = { a: { ...NEUTRAL_COLOR_ADJUST, red: 1.2, redShift: false }, b: { ...NEUTRAL_COLOR_ADJUST, redShift: true } };
beforeEach(() => { vi.mocked(fetchLightingColorAdjust).mockReset().mockResolvedValue({ adjustments: initial }); vi.mocked(setLightingColorAdjust).mockReset().mockResolvedValue({ error: false, msg: '' }); });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
describe('per-device Red Shift', () => {
  it('hydrates and writes only the chosen device and setting, leaving tuning and other cards alone', async () => {
    const { result } = renderHook(() => useDeviceColorAdjust('profile', true));
    await act(() => result.current.refresh());
    await act(() => result.current.toggleRedShift('a'));
    expect(setLightingColorAdjust).toHaveBeenCalledWith(['a'], { redShift: true });
    expect(result.current.adjustments.a).toEqual({ ...initial.a, redShift: true });
    expect(result.current.adjustments.b).toEqual(initial.b);
    await act(() => result.current.toggleRedShift('b'));
    expect(setLightingColorAdjust).toHaveBeenLastCalledWith(['b'], { redShift: false });
  });
  it('blocks duplicate writes and ignores reads begun before the write', async () => {
    const read = deferred<Awaited<ReturnType<typeof fetchLightingColorAdjust>>>();
    const write = deferred<Awaited<ReturnType<typeof setLightingColorAdjust>>>();
    const { result } = renderHook(() => useDeviceColorAdjust('profile', true));
    await act(() => result.current.refresh());
    vi.mocked(fetchLightingColorAdjust).mockReturnValueOnce(read.promise);
    let loading!: Promise<void>; act(() => { loading = result.current.refresh(); });
    vi.mocked(setLightingColorAdjust).mockReturnValueOnce(write.promise);
    let saving!: Promise<void>; act(() => { saving = result.current.toggleRedShift('a'); });
    await act(() => result.current.toggleRedShift('a'));
    expect(setLightingColorAdjust).toHaveBeenCalledTimes(1);
    await act(async () => { read.resolve({ adjustments: initial }); await loading; write.resolve({ error: false, msg: '' }); await saving; });
    expect(result.current.adjustments.a.redShift).toBe(true);
    expect(result.current.pendingIds.size).toBe(0);
  });
  it.each([null, { error: true, msg: 'rejected' }])('keeps stored state and exposes failed writes (%s)', async response => {
    const { result } = renderHook(() => useDeviceColorAdjust('profile', true));
    await act(() => result.current.refresh());
    vi.mocked(setLightingColorAdjust).mockResolvedValueOnce(response);
    await act(() => result.current.toggleRedShift('a'));
    expect(result.current.adjustments.a.redShift).toBe(false);
    expect(result.current.error).toBe(true);
  });
  it('enables a neutral device omitted from the sparse response', async () => {
    vi.mocked(fetchLightingColorAdjust).mockResolvedValueOnce({ adjustments: {} });
    const { result } = renderHook(() => useDeviceColorAdjust('profile', true));
    await act(() => result.current.refresh());
    await act(() => result.current.toggleRedShift('new-card'));
    expect(setLightingColorAdjust).toHaveBeenCalledWith(['new-card'], { redShift: true });
    expect(result.current.adjustments['new-card']).toEqual({ ...NEUTRAL_COLOR_ADJUST, redShift: true });
  });
  it('rejects unavailable/unloaded devices', async () => {
    const { result } = renderHook(() => useDeviceColorAdjust('profile', false));
    await act(() => result.current.toggleRedShift('a'));
    expect(setLightingColorAdjust).not.toHaveBeenCalled();
  });
  it('retires a pending write across profile changes', async () => {
    const write = deferred<Awaited<ReturnType<typeof setLightingColorAdjust>>>();
    const { result, rerender } = renderHook(({ scope }) => useDeviceColorAdjust(scope, true), { initialProps: { scope: 'first' } });
    await act(() => result.current.refresh());
    vi.mocked(setLightingColorAdjust).mockReturnValueOnce(write.promise);
    let saving!: Promise<void>; act(() => { saving = result.current.toggleRedShift('a'); });
    rerender({ scope: 'second' });
    rerender({ scope: 'first' });
    await act(() => result.current.refresh());
    await act(async () => { write.resolve({ error: false, msg: '' }); await saving; });
    expect(result.current.adjustments.a.redShift).toBe(false);
    expect(result.current.pendingIds.size).toBe(0);
  });
  it('reports a rejected transport and permits retry', async () => {
    const { result } = renderHook(() => useDeviceColorAdjust('profile', true));
    await act(() => result.current.refresh());
    vi.mocked(setLightingColorAdjust).mockRejectedValueOnce(new Error('offline'));
    await act(() => result.current.toggleRedShift('a'));
    expect(result.current.error).toBe(true);
    await act(() => result.current.toggleRedShift('a'));
    await waitFor(() => expect(result.current.adjustments.a.redShift).toBe(true));
    expect(result.current.error).toBe(false);
  });
});
