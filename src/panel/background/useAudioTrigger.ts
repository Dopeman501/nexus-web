import { useContext, useEffect, useMemo, useState } from 'react';
import { MultiplexContext } from '../../hooks/useMultiplexSocket';
import { advanceAudioTrigger, AUDIO_TRIGGER_STALE_MS, initialAudioTriggerState,
  normalizeAudioTrigger, readAudioTriggerSample, type AudioTriggerSettings } from './audioTrigger';
import type { D215PanelBackground } from '../d215/d215PanelBackground';

/** Demand is held only by an enabled, visible local background. No per-frame renders. */
export function useAudioTrigger(value: AudioTriggerSettings | undefined, enabled: boolean, owner: string | null): D215PanelBackground | null {
  const ctx = useContext(MultiplexContext);
  // Device pushes also refresh unrelated fields. Equal settings keep the
  // current song/entry deadline rather than treating that refresh as an edit.
  const settingsKey = useMemo(() => JSON.stringify(normalizeAudioTrigger(value)), [value]);
  const settings = useMemo(() => JSON.parse(settingsKey) as AudioTriggerSettings, [settingsKey]);
  const subscribe = ctx?.subscribe;
  const unsubscribe = ctx?.unsubscribe;
  const active = enabled && settings.enabled && settings.backgrounds.length > 0 && !!ctx?.connected;
  const generation = useMemo(() => ({ settings, active, owner, subscribe, unsubscribe }), [settings, active, owner, subscribe, unsubscribe]);
  const [selection, setSelection] = useState<{ generation: object; index: number } | null>(null);
  useEffect(() => {
    if (!active || !subscribe || !unsubscribe) return;
    let live = true;
    let state = initialAudioTriggerState();
    let lastSeen = -Infinity;
    const update = (raw: unknown, now: number) => {
      if (!live) return;
      const previous = state.index;
      state = advanceAudioTrigger(state, settings, readAudioTriggerSample(raw), now);
      if (state.index !== previous) setSelection(state.index === null ? null : { generation, index: state.index });
    };
    const listener = (raw: unknown) => { lastSeen = performance.now(); update(raw, lastSeen); };
    subscribe('audio', listener);
    // Covers loss of audio packets without a socket close. Fresh frames drive
    // entry/attacks themselves, so this timer never repeats a cached beat.
    const timer = window.setInterval(() => {
      const now = performance.now();
      if (now - lastSeen >= AUDIO_TRIGGER_STALE_MS) update(null, now);
    }, 50);
    return () => { live = false; window.clearInterval(timer); unsubscribe('audio', listener); };
  }, [subscribe, unsubscribe, active, settings, generation]);
  // The effect generation's selection cannot leak through a disable/device/config change.
  return active && selection?.generation === generation
    ? settings.backgrounds[selection.index] ?? null : null;
}
