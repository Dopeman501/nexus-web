import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MultiplexContext, type MultiplexContextValue } from '../../hooks/useMultiplexSocket';
import { useAudioTrigger } from './useAudioTrigger';
import { normalizeAudioTrigger, type AudioTriggerSettings } from './audioTrigger';

describe('Audio Trigger feed lifecycle', () => {
  afterEach(() => vi.useRealTimers());
  function setup(delay = 0) {
    vi.useFakeTimers();
    let listener: (value: unknown) => void = () => {};
    const subscribe = vi.fn((_topic, callback) => { listener = callback; });
    const unsubscribe = vi.fn();
    const ctx = { subscribe, unsubscribe, connected: true } as unknown as MultiplexContextValue;
    const settings = normalizeAudioTrigger({ enabled: true, switchDelay: delay, backgrounds: [{ mode: 'solid', color: '#ff0000' }] });
    const wrapper = ({ children }: { children: React.ReactNode }) => <MultiplexContext.Provider value={ctx}>{children}</MultiplexContext.Provider>;
    const hook = renderHook(({ enabled, owner, value }: { enabled: boolean; owner: string; value?: AudioTriggerSettings }) => useAudioTrigger(value ?? settings, enabled, owner), { initialProps: { enabled: true, owner: 'one' }, wrapper });
    return { ...hook, subscribe, unsubscribe, send: (data: unknown) => act(() => listener(data)) };
  }
  it('releases demand and timer on unmount; ignores late callbacks', () => {
    const hook = setup();
    hook.send({ level: 0.8, bass: 0, beat: 0 });
    expect(hook.result.current?.color).toBe('#ff0000');
    hook.unmount();
    expect(hook.unsubscribe).toHaveBeenCalledWith('audio', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    hook.send({ level: 1, bass: 1, beat: 1 });
  });
  it('restores the normal background after feed stalls instead of holding stale audio', () => {
    const hook = setup(0.5);
    for (let i = 0; i <= 10; i++) {
      hook.send({ level: 0.8, bass: 0, beat: 0 });
      act(() => vi.advanceTimersByTime(50));
    }
    expect(hook.result.current).not.toBeNull();
    act(() => vi.advanceTimersByTime(1000));
    expect(hook.result.current).toBeNull();
    hook.unmount();
  });
  it('clears detection for hidden backgrounds and device changes', () => {
    const hook = setup();
    hook.send({ level: 0.8, bass: 1, beat: 1 });
    hook.rerender({ enabled: false, owner: 'one' });
    expect(hook.result.current).toBeNull();
    expect(hook.unsubscribe).toHaveBeenCalledTimes(1);
    hook.rerender({ enabled: true, owner: 'one' });
    expect(hook.result.current).toBeNull();
    hook.rerender({ enabled: true, owner: 'two' });
    expect(hook.result.current).toBeNull();
    hook.unmount();
  });
  it('retains active detection across an equivalent record refresh, but resets for a real setting change', () => {
    const hook = setup(0.2);
    for (let i = 0; i <= 5; i++) {
      hook.send({ level: 0.8, bass: 0, beat: 0 });
      act(() => vi.advanceTimersByTime(50));
    }
    expect(hook.result.current).not.toBeNull();
    const equivalent = normalizeAudioTrigger({ enabled: true, switchDelay: 0.2, backgrounds: [{ mode: 'solid', color: '#ff0000' }] });
    hook.rerender({ enabled: true, owner: 'one', value: equivalent });
    expect(hook.result.current).not.toBeNull();
    expect(hook.subscribe).toHaveBeenCalledTimes(1);
    hook.rerender({ enabled: true, owner: 'one', value: { ...equivalent, intensity: 75 } });
    expect(hook.result.current).toBeNull();
    hook.unmount();
  });
});
