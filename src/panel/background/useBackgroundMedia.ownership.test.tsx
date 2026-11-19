import { StrictMode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ library: vi.fn(), blob: vi.fn() }));
vi.mock('../../api/panelBackgroundMedia', () => ({
  fetchBackgroundMediaLibrary: (...args: unknown[]) => api.library(...args),
  backgroundMediaThumbnailPath: (device: string, item: string) => `/thumb/${device}/${item}`,
  onBackgroundMediaChanged: () => () => {},
}));
vi.mock('../../api/service', () => ({ fetchServiceBlob: (...args: unknown[]) => api.blob(...args) }));

import { useBackgroundMedia } from './useBackgroundMedia';

const item = { id: 'media-one', name: 'image', sourceExt: '.png', type: 'static' as const,
  width: 10, height: 10, importedAtUnixMs: 1, durationSec: 0, alpha: false };
const created: string[] = [];
const revoked: string[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  created.length = 0;
  revoked.length = 0;
  api.library.mockReset().mockImplementation(async () => ({ items: [item] }));
  api.blob.mockReset().mockResolvedValue(null);
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL() { const url = `blob:background-${created.length + 1}`; created.push(url); return url; }
    static revokeObjectURL(url: string) { revoked.push(url); }
  });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('background thumbnail ownership', () => {
  it('keeps a committed thumbnail usable until its owner unmounts', async () => {
    api.blob.mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
    const hook = renderHook(() => useBackgroundMedia('device-one'));
    await waitFor(() => {
      expect(created).toHaveLength(1);
      expect(hook.result.current.thumbs[item.id]).toBe(created[0]);
    });
    expect(created).toHaveLength(1);
    expect(revoked).toEqual([]);
    hook.unmount();
    expect(revoked).toEqual(created);
  });

  it('releases a newly fetched thumbnail when navigation discards its queued state update', async () => {
    const pending = deferred<Blob>();
    api.blob.mockReturnValue(pending.promise);
    const hook = renderHook(() => useBackgroundMedia('device-one'));
    await waitFor(() => expect(api.blob).toHaveBeenCalledTimes(1));
    expect(hook.result.current.thumbs).toEqual({});

    await act(async () => {
      // A successful library refresh queues another React update on this
      // component before the thumbnail resolves. Navigation then synchronously
      // removes the picker before React commits either queued update. No React
      // primitive or state setter is mocked: the actual renderer discards work.
      const refresh = hook.result.current.refresh();
      pending.resolve(new Blob(['image'], { type: 'image/png' }));
      await refresh;
      expect(created).toHaveLength(1);
      hook.unmount();
    });

    expect(revoked).toEqual(created);
  });

  it('never creates a URL for a fetch that finishes after unmount', async () => {
    const pending = deferred<Blob>();
    api.blob.mockReturnValue(pending.promise);
    const hook = renderHook(() => useBackgroundMedia('device-one'));
    await waitFor(() => expect(api.blob).toHaveBeenCalledTimes(1));
    hook.unmount();
    await act(async () => { pending.resolve(new Blob(['image'])); await pending.promise; });
    expect(created).toEqual([]);
    expect(revoked).toEqual([]);
  });

  it('retains live thumbnails through StrictMode replay and releases every URL after unmount', async () => {
    api.blob.mockResolvedValue(new Blob(['image']));
    const hook = renderHook(() => useBackgroundMedia('device-one'), { wrapper: StrictMode });
    await waitFor(() => expect(hook.result.current.thumbs[item.id]).toBeTruthy());
    expect(revoked).not.toContain(hook.result.current.thumbs[item.id]);
    hook.unmount();
    expect(new Set(revoked)).toEqual(new Set(created));
  });

  it('prunes removed items and removes a local item exactly once under StrictMode', async () => {
    const second = { ...item, id: 'media-two' };
    api.library.mockImplementation(async () => ({ items: [item, second] }));
    api.blob.mockResolvedValue(new Blob(['image']));
    const hook = renderHook(() => useBackgroundMedia('device-one'), { wrapper: StrictMode });
    await waitFor(() => expect(Object.keys(hook.result.current.thumbs)).toHaveLength(2));
    const firstUrl = hook.result.current.thumbs[item.id];
    const secondUrl = hook.result.current.thumbs[second.id];

    api.library.mockImplementation(async () => ({ items: [second] }));
    await act(async () => { await hook.result.current.refresh(); });
    expect(hook.result.current.thumbs).toEqual({ [second.id]: secondUrl });
    expect(revoked).toEqual([firstUrl]);
    await act(async () => { hook.result.current.removeLocal(second.id); });
    expect(hook.result.current.items).toEqual([]);
    expect(hook.result.current.thumbs).toEqual({});
    expect(revoked).toEqual([firstUrl, secondUrl]);
    hook.unmount();
    expect(revoked).toEqual([firstUrl, secondUrl]);
  });

  it('revokes an obsolete duplicate while retaining the thumbnail React committed', async () => {
    const first = deferred<Blob>();
    api.library.mockImplementation(async () => ({ items: [item, item] }));
    api.blob.mockReturnValueOnce(first.promise).mockResolvedValue(new Blob(['duplicate']));
    const hook = renderHook(() => useBackgroundMedia('device-one'));
    await waitFor(() => expect(api.blob).toHaveBeenCalledTimes(1));
    await act(async () => {
      const refresh = hook.result.current.refresh();
      first.resolve(new Blob(['first']));
      await refresh;
      await Promise.resolve();
    });
    expect(created).toHaveLength(2);
    expect(hook.result.current.thumbs[item.id]).toBe(created[0]);
    expect(revoked).toEqual([created[1]]);
    hook.unmount();
    expect(new Set(revoked)).toEqual(new Set(created));
    expect(revoked).toHaveLength(2);
  });

  it('ignores an old device fetch after the next device thumbnail becomes visible', async () => {
    const first = deferred<Blob>();
    const second = deferred<Blob>();
    api.blob.mockImplementation((path: string) => path.includes('device-one') ? first.promise : second.promise);
    const hook = renderHook(({ device }) => useBackgroundMedia(device), { initialProps: { device: 'device-one' } });
    await waitFor(() => expect(api.blob).toHaveBeenCalledWith('/thumb/device-one/media-one', { mayBeCached: true }));
    hook.rerender({ device: 'device-two' });
    await waitFor(() => expect(api.blob).toHaveBeenCalledWith('/thumb/device-two/media-one', { mayBeCached: true }));
    await act(async () => { second.resolve(new Blob(['new-device'])); await second.promise; });
    const visible = hook.result.current.thumbs[item.id];
    expect(visible).toBeTruthy();
    await act(async () => { first.resolve(new Blob(['old-device'])); await first.promise; });
    expect(hook.result.current.thumbs[item.id]).toBe(visible);
    expect(created).toEqual([visible]);
    expect(revoked).toEqual([]);
    hook.unmount();
    expect(revoked).toEqual([visible]);
  });

});
