import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePanelLayoutWriter } from './usePanelLayoutWriter';
import type { PanelDevicePatch } from '../../../api/panel';

const deferred = () => {
  let resolve!: (ok: boolean) => void;
  const promise = new Promise<boolean>(done => { resolve = done; });
  return { resolve, promise };
};
describe('ordered panel layout writes', () => {
  it('finishes a delayed Home save before newer navigation and coalesces pending layouts', async () => {
    const first = deferred();
    const send = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(true);
    const { result } = renderHook(() => usePanelLayoutWriter('y70', send));
    const home: PanelDevicePatch = { layout: { surface: 'y70', layoutSchemaVersion: 2, homePageId: 'b', activePageId: 'b', pages: [] } };
    const a = result.current('y70', home);
    const b = result.current('y70', { widgetSize: 'small', layout: { ...home.layout!, activePageId: 'a' } });
    const c = result.current('y70', { layout: { ...home.layout!, activePageId: 'c' } });
    expect(b).toBe(c);
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve(true); await a; await b; });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('y70', { widgetSize: 'small', layout: { ...home.layout!, activePageId: 'c' } });
  });
  it('does not send retired pending edits into another device and settles callers', async () => {
    const first = deferred();
    const send = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(true);
    const { result, rerender, unmount } = renderHook(({ owner }) => usePanelLayoutWriter(owner, send), { initialProps: { owner: 'a' } });
    const active = result.current('a', {});
    const pending = result.current('a', { widgetSize: 'small' });
    rerender({ owner: 'b' });
    expect(await pending).toBe(false);
    await act(async () => { first.resolve(true); });
    expect(await active).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await result.current('b', {})).toBe(true);
    const retired = result.current;
    unmount();
    expect(await retired('b', {})).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('continues after a rejected request and tolerates StrictMode setup cleanup', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(true);
    const { result } = renderHook(() => usePanelLayoutWriter('a', send), { wrapper: StrictMode });
    const a = result.current('a', {});
    const b = result.current('a', { widgetSize: 'small' });
    expect(await a).toBe(false);
    expect(await b).toBe(true);
  });
});
