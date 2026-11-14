import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBackgroundTransitionPreviewPublisher } from './useBackgroundTransitionPreviewPublisher';
const api = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock('../../api/panelTransitionPreview', async importOriginal => ({
  ...await importOriginal<typeof import('../../api/panelTransitionPreview')>(), postTransitionPreview: api.write,
}));
const reply = (deviceId: string, body: object) => ({ ...body, deviceId, revision: 1,
  startedAtUnixMs: Date.now() + 150, expiresAtUnixMs: Date.now() + 11000 });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('one-shot transition-preview publisher', () => {
  it('does not publish on open; coalesces clicks and never heartbeat-replays a preview', async () => {
    vi.useFakeTimers(); api.write.mockImplementation(async (id, body) => reply(id, body));
    const hook = renderHook(() => useBackgroundTransitionPreviewPublisher('one', true));
    expect(api.write).not.toHaveBeenCalled();
    act(() => { hook.result.current.preview('curtains:wave', 800); hook.result.current.preview('gl-transitions:WaterDrop', 900); });
    await act(async () => vi.advanceTimersByTimeAsync(50));
    expect(api.write).toHaveBeenCalledOnce();
    expect(api.write.mock.calls[0][1]).toMatchObject({ sequence: 1, preview: { effect: 'gl-transitions:WaterDrop', durationMs: 900 } });
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(api.write).toHaveBeenCalledOnce(); expect(hook.result.current.error).toBe(false);
    hook.unmount(); await act(async () => {});
    expect(api.write.mock.calls.at(-1)![1]).toMatchObject({ sequence: 2, preview: null });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('orders release after an in-flight click and releases the original owner on navigation', async () => {
    vi.useFakeTimers(); let finish!: () => void;
    api.write.mockImplementationOnce((id, body) => new Promise(resolve => { finish = () => resolve(reply(id, body)); }))
      .mockImplementation(async (id, body) => reply(id, body));
    const hook = renderHook(({ id }) => useBackgroundTransitionPreviewPublisher(id, true), { initialProps: { id: 'one' } });
    act(() => hook.result.current.preview('curtains:wave', 1000)); await act(async () => vi.advanceTimersByTimeAsync(50));
    const oldSession = api.write.mock.calls[0][1].sessionId;
    act(() => hook.result.current.preview('curtains:ripple', 1000));
    hook.rerender({ id: 'two' }); expect(api.write).toHaveBeenCalledOnce();
    await act(async () => finish());
    expect(api.write.mock.calls[1]).toEqual(['one', expect.objectContaining({ sessionId: oldSession, preview: null, sequence: 2 }), expect.any(AbortSignal)]);
    act(() => hook.result.current.preview('curtains:wave', 1000)); await act(async () => vi.advanceTimersByTimeAsync(50));
    expect(api.write.mock.calls[2][0]).toBe('two'); expect(api.write.mock.calls[2][1].sessionId).not.toBe(oldSession);
    hook.unmount(); await act(async () => {}); expect(vi.getTimerCount()).toBe(0);
  });
  it('reports rejected/malformed acknowledgements and recovers after a successful later click', async () => {
    vi.useFakeTimers(); api.write.mockResolvedValueOnce(null).mockImplementation(async (id, body) => reply(id, body));
    const hook = renderHook(() => useBackgroundTransitionPreviewPublisher('one', true));
    act(() => hook.result.current.preview('curtains:wave', 800)); await act(async () => vi.advanceTimersByTimeAsync(50));
    expect(hook.result.current.error).toBe(true);
    act(() => hook.result.current.preview('curtains:wave', 800)); await act(async () => vi.advanceTimersByTimeAsync(50));
    expect(hook.result.current.error).toBe(false);
    hook.unmount(); await act(async () => {});
  });
  it('cancels an unsent click on close and bounds an unresponsive request', async () => {
    vi.useFakeTimers(); api.write.mockImplementation(() => new Promise(() => {}));
    const hook = renderHook(({ open }) => useBackgroundTransitionPreviewPublisher('one', open), { initialProps: { open: true } });
    act(() => hook.result.current.preview('curtains:wave', 800)); hook.rerender({ open: false });
    await act(async () => vi.advanceTimersByTimeAsync(100)); expect(api.write).not.toHaveBeenCalled();
    hook.rerender({ open: true }); act(() => hook.result.current.preview('curtains:wave', 800));
    await act(async () => vi.advanceTimersByTimeAsync(3100)); expect(hook.result.current.error).toBe(true);
    expect(api.write.mock.calls[0][2].aborted).toBe(true);
    hook.unmount(); await act(async () => vi.advanceTimersByTimeAsync(3100)); expect(vi.getTimerCount()).toBe(0);
  });
});
