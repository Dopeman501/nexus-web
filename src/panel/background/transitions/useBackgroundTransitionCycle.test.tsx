import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useBackgroundTransitionCycle } from './useBackgroundTransitionCycle';
const initial = { enabled: true, effects: ['curtains:wave', 'gl-transitions:WaterDrop'], durationMs: 800 };
describe('one Slideshow/Audio transition cycle owner', () => {
  it('lets beat controls override main Off and duration without resetting or consuming disabled events', () => {
    const hook = renderHook(() => useBackgroundTransitionCycle('one', { ...initial, enabled: false }));
    expect(hook.result.current.chooseTransition('entry').effect).toBe('none');
    expect(hook.result.current.chooseTransition('beat/1', { enabled: true, durationMs: 150 })).toEqual({ effect: 'curtains:wave', durationMs: 150 });
    expect(hook.result.current.chooseTransition('beat/off', { enabled: false, durationMs: 250 }).effect).toBe('none');
    expect(hook.result.current.chooseTransition('beat/2', { enabled: true, durationMs: 350 })).toEqual({ effect: 'gl-transitions:WaterDrop', durationMs: 350 });
  });
  it('cycles across channels and reserves duplicate readiness only once', () => {
    const hook = renderHook(() => useBackgroundTransitionCycle('one', initial));
    let first; act(() => { first = hook.result.current.chooseTransition('slideshow/1'); });
    expect(first).toEqual({ effect: 'curtains:wave', durationMs: 800 });
    expect(hook.result.current.chooseTransition('slideshow/1')).toBe(first);
    expect(hook.result.current.chooseTransition('audio/1').effect).toBe('gl-transitions:WaterDrop');
    expect(hook.result.current.chooseTransition('audio/2').effect).toBe('curtains:wave');
  });
  it('locks an existing reservation and does not reset order on duration or enabled changes', () => {
    const hook = renderHook(({ settings }) => useBackgroundTransitionCycle('one', settings), { initialProps: { settings: initial } });
    hook.result.current.chooseTransition('slideshow/1');
    hook.rerender({ settings: { ...initial, durationMs: 1500 } });
    expect(hook.result.current.chooseTransition('slideshow/1')).toEqual({ effect: 'curtains:wave', durationMs: 800 });
    expect(hook.result.current.chooseTransition('audio/1')).toEqual({ effect: 'gl-transitions:WaterDrop', durationMs: 1500 });
    hook.rerender({ settings: { ...initial, enabled: false } });
    expect(hook.result.current.chooseTransition('off/1').effect).toBe('none');
    hook.rerender({ settings: initial });
    expect(hook.result.current.chooseTransition('audio/2').effect).toBe('curtains:wave');
  });
  it('starts a fresh cycle only for a different ordered list or owner', () => {
    const hook = renderHook(({ owner, settings }) => useBackgroundTransitionCycle(owner, settings), { initialProps: { owner: 'one', settings: initial } });
    hook.result.current.chooseTransition('slideshow/1');
    hook.rerender({ owner: 'one', settings: { ...initial, effects: [...initial.effects] } });
    expect(hook.result.current.chooseTransition('audio/1').effect).toBe('gl-transitions:WaterDrop');
    hook.rerender({ owner: 'two', settings: initial });
    expect(hook.result.current.chooseTransition('slideshow/1').effect).toBe('curtains:wave');
    hook.rerender({ owner: 'two', settings: { ...initial, effects: [...initial.effects].reverse() } });
    expect(hook.result.current.chooseTransition('audio/1').effect).toBe('gl-transitions:WaterDrop');
  });
});
