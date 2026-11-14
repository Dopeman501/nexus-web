import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelDeviceRecord } from '../../api/panel';
import type { PanelRecordState } from './usePanelRecord';
import { usePanelLayout } from './usePanelLayout';

const patch = vi.fn();
vi.mock('../../api/panel', () => ({ patchPanelDeviceWithStatus: (...args: unknown[]) => patch(...args) }));
vi.mock('./panelSync', () => ({ broadcastLayoutChanged: () => {} }));
const record = (): PanelDeviceRecord => ({ id: 'y70', displayName: 'Y70', layout: {
  surface: 'y70', layoutSchemaVersion: 2, homePageId: 'b', activePageId: 'a',
  pages: ['a', 'b', 'c'].map(id => ({ id, widgets: [] })),
} });
const state = (value: PanelDeviceRecord): PanelRecordState => ({ record: value, loaded: true, missing: false, refetch: () => {} });
beforeEach(() => { vi.useFakeTimers(); patch.mockReset().mockResolvedValue({ ok: true }); });
afterEach(() => { vi.useRealTimers(); });

describe('local layout intent and incoming records', () => {
  it('accepts a previous own layout as intentional external navigation after both saves confirm', async () => {
    const base = record();
    const { result, rerender } = renderHook(({ input }) => usePanelLayout(input, 'y70', 'y70'), { initialProps: { input: state(base) } });
    const home = { ...result.current.layout, activePageId: 'b' };
    act(() => result.current.setLayout(home));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    act(() => result.current.setLayout({ ...home, activePageId: 'c' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    rerender({ input: state({ ...base, layout: home }) });
    expect(result.current.layout.activePageId).toBe('b');
  });
  it('accepts external navigation back to the original page after a confirmed save without an echo', async () => {
    const base = record();
    const refetch = vi.fn();
    const { result, rerender } = renderHook(({ input }) => usePanelLayout(input, 'y70', 'y70'), {
      initialProps: { input: { ...state(base), refetch } },
    });
    act(() => result.current.setLayout({ ...result.current.layout, activePageId: 'b' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    rerender({ input: { ...state(structuredClone(base)), refetch } });
    expect(result.current.layout.activePageId).toBe('a');
    expect(refetch).toHaveBeenCalledTimes(1); // invalidates any pre-ack record read
  });
  it('retires own-write protection when a different remote record replaces a sent edit', async () => {
    const base = record();
    const { result, rerender } = renderHook(({ input }) => usePanelLayout(input, 'y70', 'y70'), { initialProps: { input: state(base) } });
    act(() => result.current.setLayout({ ...result.current.layout, activePageId: 'b' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    rerender({ input: state({ ...base, layout: { ...base.layout!, activePageId: 'c', homePageId: 'c' } }) });
    expect(result.current.layout.activePageId).toBe('c');
    rerender({ input: state(structuredClone(base)) });
    expect(result.current.layout.activePageId).toBe('a');
  });
  it.each([0, 250])('keeps Home when reconnect rereads the unchanged base after %sms', async elapsed => {
    const base = record();
    let settle!: (value: unknown) => void;
    patch.mockImplementation(() => new Promise(resolve => { settle = resolve; }));
    const { result, rerender } = renderHook(({ input }) => usePanelLayout(input, 'y70', 'y70'), { initialProps: { input: state(base) } });
    act(() => result.current.setLayout({ ...result.current.layout, activePageId: 'b' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(elapsed); });
    rerender({ input: state(structuredClone(base)) });
    expect(result.current.layout.activePageId).toBe('b');
    await act(async () => { await vi.advanceTimersByTimeAsync(250); settle({ ok: true }); });
    expect(patch.mock.calls.at(-1)?.[1].layout.activePageId).toBe('b');
  });

  it('keeps newer local navigation on an older own echo, and accepts a genuinely different record', async () => {
    const base = record();
    const { result, rerender } = renderHook(({ input }) => usePanelLayout(input, 'y70', 'y70'), { initialProps: { input: state(base) } });
    const home = { ...result.current.layout, activePageId: 'b' };
    act(() => result.current.setLayout(home));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    act(() => result.current.setLayout({ ...home, activePageId: 'c' }));
    rerender({ input: state({ ...base, layout: home }) });
    expect(result.current.layout.activePageId).toBe('c');
    const foreign = { ...base, layout: { ...home, homePageId: 'c', activePageId: 'a' } };
    rerender({ input: state(foreign) });
    expect(result.current.layout).toEqual(expect.objectContaining({ homePageId: 'c', activePageId: 'a' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(patch).toHaveBeenCalledTimes(1); // unsent superseded local navigation was cancelled
  });
});
