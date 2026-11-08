import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MultiplexContext, type MultiplexContextValue } from '../../hooks/useMultiplexSocket';
import { useAudioTriggerPreview } from './useAudioTriggerPreview';
import { useAudioTriggerPreviewPublisher } from './useAudioTriggerPreviewPublisher';

const api = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock('../../api/panelAudioTriggerPreview', () => ({
  fetchAudioTriggerPreview: api.read, postAudioTriggerPreview: api.write,
  AUDIO_TRIGGER_PREVIEW_TOPIC: 'panel/audio-trigger-preview', AUDIO_TRIGGER_PREVIEW_LEASE_MS: 6000,
  readAudioTriggerPreview: (raw: unknown) => raw,
}));

const background = { mode: 'solid' as const, color: '#ff0000' };
const frame = (revision = 1, patch: object = {}) => ({ deviceId: 'one', sessionId: 'session', sequence: revision,
  revision, expiresAtUnixMs: Date.now() + 6000, background, ...patch });

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('device preview receiver', () => {
  function setup() {
    vi.useFakeTimers();
    api.read.mockResolvedValue(null);
    let listener: (data: unknown) => void = () => {};
    const subscribe = vi.fn((_topic, cb) => { listener = cb; });
    const unsubscribe = vi.fn();
    const ctx = { connected: true, subscribe, unsubscribe } as unknown as MultiplexContextValue;
    const wrapper = ({ children }: { children: React.ReactNode }) => <MultiplexContext.Provider value={ctx}>{children}</MultiplexContext.Provider>;
    const hook = renderHook(({ id, enabled }) => useAudioTriggerPreview(id, enabled), { initialProps: { id: 'one', enabled: true }, wrapper });
    return { ...hook, ctx, subscribe, unsubscribe, send: (data: unknown) => act(() => listener(data)) };
  }

  it('fetches current state, ignores other devices and older revisions, and expires without a clear message', async () => {
    const hook = setup();
    await act(async () => {});
    expect(api.read).toHaveBeenCalledWith('one', expect.any(AbortSignal));
    hook.send(frame(1, { deviceId: 'two' }));
    expect(hook.result.current).toBeNull();
    hook.send(frame(2));
    expect(hook.result.current).toEqual(background);
    hook.send(frame(1, { background: null }));
    expect(hook.result.current).toEqual(background);
    act(() => vi.advanceTimersByTime(6000));
    expect(hook.result.current).toBeNull();
    hook.unmount();
    expect(hook.unsubscribe).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects late hydration and callbacks after switching devices, hiding, disconnecting or unmounting', async () => {
    let resolveRead!: (raw: unknown) => void;
    const hook = setup();
    api.read.mockReturnValueOnce(new Promise(resolve => { resolveRead = resolve; }));
    hook.rerender({ id: 'two', enabled: true });
    hook.send(frame(3, { deviceId: 'two' }));
    await act(async () => resolveRead(null));
    expect(hook.result.current).toEqual(background);
    hook.ctx.connected = false;
    hook.rerender({ id: 'two', enabled: true });
    expect(hook.result.current).toBeNull();
    hook.ctx.connected = true;
    hook.rerender({ id: 'one', enabled: false });
    hook.send(frame(4));
    expect(hook.result.current).toBeNull();
    hook.unmount();
    hook.send(frame(5));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('device preview publisher', () => {
  it('releases the original device and starts a fresh session when the editor changes device', async () => {
    vi.useFakeTimers();
    api.write.mockResolvedValue({});
    const hook = renderHook(({ id }) => useAudioTriggerPreviewPublisher(id, background), { initialProps: { id: 'one' } });
    await act(async () => vi.advanceTimersByTimeAsync(50));
    const original = api.write.mock.calls[0][1].sessionId;
    hook.rerender({ id: 'two' });
    await act(async () => vi.advanceTimersByTimeAsync(50));
    expect(api.write.mock.calls[1]).toEqual(['one', expect.objectContaining({ sessionId: original, background: null }), expect.any(AbortSignal)]);
    expect(api.write.mock.calls[2]).toEqual(['two', expect.objectContaining({ sequence: 1, background: expect.objectContaining(background) }), expect.any(AbortSignal)]);
    expect(api.write.mock.calls[2][1].sessionId).not.toBe(original);
    hook.unmount();
    await act(async () => {});
    expect(vi.getTimerCount()).toBe(0);
  });

  it('coalesces drag samples, renews while editing, and clears on close', async () => {
    vi.useFakeTimers();
    api.write.mockResolvedValue({});
    const hook = renderHook(({ bg }) => useAudioTriggerPreviewPublisher('one', bg), { initialProps: { bg: background as typeof background | null } });
    await act(async () => vi.advanceTimersByTimeAsync(50));
    const sessionId = api.write.mock.calls[0][1].sessionId;
    expect(api.write).toHaveBeenCalledWith('one', expect.objectContaining({ sessionId, sequence: 1, background: expect.objectContaining(background) }), expect.any(AbortSignal));
    for (let n = 0; n < 10; n++) hook.rerender({ bg: { ...background, color: '#00ff00' } });
    await act(async () => vi.advanceTimersByTimeAsync(50));
    expect(api.write).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(api.write.mock.calls.at(-1)![1]).toMatchObject({ sessionId, background: { color: '#00ff00' } });
    hook.rerender({ bg: null });
    await act(async () => {});
    expect(api.write.mock.calls.at(-1)![1]).toMatchObject({ sessionId, background: null });
    hook.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('serializes pending writes so closing cannot be followed by an old preview', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    api.write.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({}); })).mockResolvedValue({});
    const hook = renderHook(({ id, bg }) => useAudioTriggerPreviewPublisher(id, bg), { initialProps: { id: 'one', bg: background as typeof background | null } });
    await act(async () => vi.advanceTimersByTimeAsync(50));
    hook.rerender({ id: 'one', bg: { ...background, color: '#00ff00' } });
    hook.unmount();
    expect(api.write).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(api.write).toHaveBeenCalledTimes(2);
    expect(api.write.mock.calls[1][1]).toMatchObject({ sequence: 2, background: null });
    expect(vi.getTimerCount()).toBe(0);
  });
});
