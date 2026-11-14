import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MultiplexContext, type MultiplexContextValue } from '../../hooks/useMultiplexSocket';
import { useBackgroundTransitionPreview } from './useBackgroundTransitionPreview';
const api = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../api/panelTransitionPreview', async original => ({
  ...await original<typeof import('../../api/panelTransitionPreview')>(), fetchTransitionPreview: api.read,
}));
const guid = '12345678-1234-1234-1234-123456789abc';
const frame = (revision: number, patch: object = {}) => ({ deviceId: 'one', sessionId: guid, sequence: revision, revision,
  startedAtUnixMs: Date.now(), expiresAtUnixMs: Date.now() + 6800,
  preview: { previewId: `${String(revision).padStart(8, '0')}-1234-1234-1234-123456789abc`, effect: 'curtains:wave', durationMs: 800 }, ...patch });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
function setup() {
  vi.useFakeTimers(); api.read.mockResolvedValue(null);
  let listener: (raw: unknown) => void = () => {};
  const subscribe = vi.fn((_topic, callback) => { listener = callback; }); const unsubscribe = vi.fn();
  const ctx = { connected: true, subscribe, unsubscribe } as unknown as MultiplexContextValue;
  const wrapper = ({ children }: { children: React.ReactNode }) => <MultiplexContext.Provider value={ctx}>{children}</MultiplexContext.Provider>;
  const hook = renderHook(({ id, enabled }) => useBackgroundTransitionPreview(id, enabled), { initialProps: { id: 'one', enabled: true }, wrapper });
  return { ...hook, ctx, unsubscribe, send: (raw: unknown) => act(() => listener(raw)) };
}
describe('one-shot device/simulator transition preview', () => {
  it('accepts only its device/new revisions, expires and releases subscriptions', async () => {
    const hook = setup(); await act(async () => {});
    hook.send(frame(1001, { deviceId: 'other' })); expect(hook.result.current.frame).toBeNull();
    hook.send(frame(1002)); expect(hook.result.current.frame?.revision).toBe(1002);
    hook.send(frame(1001, { preview: null })); expect(hook.result.current.frame?.revision).toBe(1002);
    act(() => vi.advanceTimersByTime(6800)); expect(hook.result.current.frame).toBeNull();
    hook.unmount(); expect(hook.unsubscribe).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('never replays a completed preview after duplicate publications or reconnect hydration', async () => {
    const hook = setup(); await act(async () => {});
    const value = frame(2001); hook.send(value);
    act(() => hook.result.current.complete(value.preview.previewId)); expect(hook.result.current.frame).toBeNull();
    hook.send({ ...value, revision: 2002 }); expect(hook.result.current.frame).toBeNull();
    hook.ctx.connected = false; hook.rerender({ id: 'one', enabled: true });
    api.read.mockResolvedValue({ ...value, revision: 2003 });
    hook.ctx.connected = true; hook.rerender({ id: 'one', enabled: true }); await act(async () => {});
    expect(hook.result.current.frame).toBeNull(); hook.unmount();
  });
  it('locks a preview event and rejects old completion, late GET and retired device callbacks', async () => {
    let finish!: (value: unknown) => void;
    api.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const hook = setup();
    // setup's default mock only affects subsequent calls, preserving this deferred first read.
    const old = frame(3001); hook.send(old); const complete = hook.result.current.complete;
    const current = frame(3002); hook.send(current);
    act(() => complete(old.preview.previewId)); expect(hook.result.current.frame?.revision).toBe(3002);
    await act(async () => finish(old)); expect(hook.result.current.frame?.revision).toBe(3002);
    hook.rerender({ id: 'two', enabled: true }); hook.send(frame(3003));
    expect(hook.result.current.frame).toBeNull(); hook.unmount();
  });
  it('clears on hidden/disconnect and never accepts an expired request', async () => {
    const hook = setup(); await act(async () => {});
    hook.send(frame(4001, { expiresAtUnixMs: Date.now() - 1 })); expect(hook.result.current.frame).toBeNull();
    hook.send(frame(4002)); expect(hook.result.current.frame).not.toBeNull();
    hook.rerender({ id: 'one', enabled: false }); expect(hook.result.current.frame).toBeNull();
    hook.send(frame(4003)); expect(hook.result.current.frame).toBeNull();
    hook.unmount(); expect(vi.getTimerCount()).toBe(0);
  });
});
