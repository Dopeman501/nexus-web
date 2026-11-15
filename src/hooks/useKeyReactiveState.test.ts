import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEY_REACTION, type KeyReactiveState } from '../api/keyReactive';
import { useKeyReactiveState } from './useKeyReactiveState';

const api = vi.hoisted(() => ({ fetch: vi.fn(), prefs: null as null | (() => void) }));
vi.mock('../api/keyReactive', async original => ({
  ...(await original<typeof import('../api/keyReactive')>()), fetchKeyReactive: api.fetch,
}));
vi.mock('./useMultiplexSocket', () => ({
  useTopicCallback: (topic: string, _enabled: boolean, callback: () => void) => { if (topic === 'prefs') api.prefs = callback; },
}));

const snapshot = (epoch: string, layout: string): KeyReactiveState => ({ epoch, inputAvailable: true, devices: [{
  id: 'core', deviceId: 'physical-core', frameIndex: 0, ledCount: 10, namedKeys: 0, hardwareKeys: false,
  zoneLighting: true, supportedEffects: ['fade', 'ripple'], keyboardLayouts: ['US', 'UK', 'BR', 'JP'],
  config: { ...DEFAULT_KEY_REACTION, keyboardLayout: layout },
}] });

describe('profile-scoped key reaction reads', () => {
  beforeEach(() => { vi.clearAllMocks(); api.prefs = null; });

  it('aborts an old profile read and ignores its late same-card response', async () => {
    let finishOld: ((state: KeyReactiveState) => void) | undefined;
    api.fetch.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    api.fetch.mockResolvedValue(snapshot('b'.repeat(32), 'JP'));
    const { result, rerender } = renderHook(({ profile }) => useKeyReactiveState(profile, true), { initialProps: { profile: 'a' } });
    const signal = api.fetch.mock.calls[0][0] as AbortSignal;
    rerender({ profile: 'b' });
    expect(signal.aborted).toBe(true);
    await waitFor(() => expect(result.current.data?.devices[0].config.keyboardLayout).toBe('JP'));
    await act(async () => { finishOld?.(snapshot('a'.repeat(32), 'UK')); });
    expect(result.current.data?.epoch).toBe('b'.repeat(32));
  });

  it('keeps only the newest refresh in one profile generation', async () => {
    api.fetch.mockResolvedValue(snapshot('a'.repeat(32), 'US'));
    const { result } = renderHook(() => useKeyReactiveState('a', true));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    let finishOlder: ((state: KeyReactiveState) => void) | undefined;
    api.fetch.mockImplementationOnce(() => new Promise(resolve => { finishOlder = resolve; }));
    api.fetch.mockResolvedValueOnce(snapshot('a'.repeat(32), 'JP'));
    await act(async () => { void result.current.refresh(); await result.current.refresh(); });
    await act(async () => { finishOlder?.(snapshot('a'.repeat(32), 'UK')); });
    expect(result.current.data?.devices[0].config.keyboardLayout).toBe('JP');
  });

  it('retires the current editor immediately on prefs and waits for a fresh epoch', async () => {
    api.fetch.mockResolvedValueOnce(snapshot('a'.repeat(32), 'UK'));
    const { result } = renderHook(() => useKeyReactiveState('a', true));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    const retiredScope = result.current.scope;
    let finishFresh: ((state: KeyReactiveState) => void) | undefined;
    api.fetch.mockImplementationOnce(() => new Promise(resolve => { finishFresh = resolve; }));
    act(() => api.prefs?.());
    expect(retiredScope.isCurrent?.()).toBe(false);
    expect(result.current.data).toBeNull();
    await act(async () => { finishFresh?.(snapshot('b'.repeat(32), 'JP')); });
    expect(result.current.scope.epoch).toBe('b'.repeat(32));
    expect(result.current.scope.isCurrent?.()).toBe(true);
  });

  it('does not fall back to an old profile if its replacement read fails', async () => {
    api.fetch.mockResolvedValueOnce(snapshot('a'.repeat(32), 'UK'));
    const { result, rerender } = renderHook(({ profile }) => useKeyReactiveState(profile, true), { initialProps: { profile: 'a' } });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    api.fetch.mockResolvedValueOnce(null);
    rerender({ profile: 'b' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
  });

  it('retires a same-card geometry projection and physical owner without a profile change', async () => {
    const first = snapshot('a'.repeat(32), 'UK');
    first.devices[0].layoutRevision = 'c1:0123456789:000';
    api.fetch.mockResolvedValueOnce(first);
    const { result } = renderHook(() => useKeyReactiveState('a', true));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    const oldDeviceScope = result.current.scopeFor(first.devices[0]);
    const next = snapshot('a'.repeat(32), 'UK');
    next.devices[0] = { ...next.devices[0], ledCount: 2, layoutRevision: 'c1:89:000' };
    api.fetch.mockResolvedValueOnce(next);
    await act(async () => { await result.current.refresh(); });
    expect(oldDeviceScope.isCurrent?.()).toBe(false);
    const currentDeviceScope = result.current.scopeFor(next.devices[0]);
    expect(currentDeviceScope.key).not.toBe(oldDeviceScope.key);
    expect(currentDeviceScope.layoutRevision).toBe('c1:89:000');
    const reordered = snapshot('a'.repeat(32), 'UK');
    reordered.devices[0] = { ...next.devices[0], layoutRevision: 'c1:98:000' };
    api.fetch.mockResolvedValueOnce(reordered);
    await act(async () => { await result.current.refresh(); });
    expect(currentDeviceScope.isCurrent?.()).toBe(false);
    const reorderedScope = result.current.scopeFor(reordered.devices[0]);
    const disabled = snapshot('a'.repeat(32), 'UK');
    disabled.devices[0] = { ...reordered.devices[0], layoutRevision: 'c1:98:080' };
    api.fetch.mockResolvedValueOnce(disabled);
    await act(async () => { await result.current.refresh(); });
    expect(reorderedScope.isCurrent?.()).toBe(false);
    const disabledScope = result.current.scopeFor(disabled.devices[0]);
    const replacement = snapshot('a'.repeat(32), 'JP');
    replacement.devices[0] = { ...disabled.devices[0], deviceId: 'replacement-physical-core' };
    api.fetch.mockResolvedValueOnce(replacement);
    await act(async () => { await result.current.refresh(); });
    expect(disabledScope.isCurrent?.()).toBe(false);
  });
});
