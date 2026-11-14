import { useCallback, useLayoutEffect, useRef } from 'react';
import { normalizeBackgroundTransition, normalizeSharedBackgroundTransitions, type AudioTriggerBeatTransitionSettings, type BackgroundTransitionSettings, type SharedBackgroundTransitionSettings } from './settings';

export type ChooseBackgroundTransition = (eventKey: string, controls?: AudioTriggerBeatTransitionSettings) => BackgroundTransitionSettings;

/** PanelApp owns the cursor so audio selection cannot reset a slideshow's cycle. */
export function useBackgroundTransitionCycle(ownerKey: string, value?: SharedBackgroundTransitionSettings) {
  const settings = normalizeSharedBackgroundTransitions(value);
  const orderKey = JSON.stringify([ownerKey, settings.effects]);
  const current = useRef(settings);
  const cycle = useRef({ orderKey, next: 0, reserved: new Map<string, BackgroundTransitionSettings>() });
  useLayoutEffect(() => {
    current.current = settings;
    if (cycle.current.orderKey !== orderKey) cycle.current = { orderKey, next: 0, reserved: new Map() };
  });
  const chooseTransition = useCallback<ChooseBackgroundTransition>((eventKey, controls) => {
    const selected = current.current;
    const durationMs = controls ? normalizeBackgroundTransition(controls).durationMs : selected.durationMs;
    if (!(controls?.enabled ?? selected.enabled) || !selected.effects.length) return { effect: 'none', durationMs };
    const state = cycle.current;
    const existing = state.reserved.get(eventKey);
    if (existing) return existing;
    const result = { effect: selected.effects[state.next % selected.effects.length], durationMs };
    state.next = (state.next + 1) % selected.effects.length;
    if (state.reserved.size >= 64) state.reserved.delete(state.reserved.keys().next().value!);
    state.reserved.set(eventKey, result);
    return result;
  }, []);
  return { chooseTransition, effectsAvailable: settings.effects.length > 0,
    transition: { effect: settings.enabled ? settings.effects[0] : 'none', durationMs: settings.durationMs } };
}
