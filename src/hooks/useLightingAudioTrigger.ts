import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchLightingAudioTrigger, setLightingAudioTrigger, normalizeLightingAudioTrigger,
  type LightingAudioTriggerSettings,
} from '../api/lightingAudioTrigger';
import { useTopicCallback } from './useMultiplexSocket';

interface State {
  key: string;
  value: LightingAudioTriggerSettings;
  loading: boolean;
  saving: boolean;
  error: 'load' | 'save' | null;
  available: boolean;
}

interface Owner {
  key: string;
  active: boolean;
  abort: AbortController;
  request: number;
  busy: boolean;
  deferred: boolean;
  state: State;
}

function initialState(key: string, active: boolean): State {
  return { key, value: normalizeLightingAudioTrigger(undefined), loading: active, saving: false, error: null, available: false };
}

/** One service-owned configuration per profile. UI selection and live beat state are separate. */
export function useLightingAudioTrigger(active: boolean, profileId?: string) {
  const key = profileId ?? '';
  const ownerRef = useRef<Owner | null>(null);
  const [state, setState] = useState(() => initialState(key, active));
  const current = useCallback((owner: Owner) => ownerRef.current === owner && owner.active, []);
  const publish = useCallback((owner: Owner, patch: Partial<State>) => {
    if (!current(owner)) return;
    owner.state = { ...owner.state, ...patch };
    setState(owner.state);
  }, [current]);

  const load = useCallback((manual = false) => {
    const owner = ownerRef.current;
    if (!active || !owner || !current(owner) || owner.key !== key) return;
    if (owner.busy) { owner.deferred = true; return; }
    const request = ++owner.request;
    publish(owner, { loading: !owner.state.available, ...(manual ? { error: null } : {}) });
    const accept = (value: LightingAudioTriggerSettings | null) => {
      if (!current(owner) || request !== owner.request || owner.busy) return;
      if (value === null) {
        publish(owner, { loading: false, available: false, error: 'load' });
        return;
      }
      publish(owner, { value: normalizeLightingAudioTrigger(value), available: true, loading: false,
        error: owner.state.error === 'save' ? 'save' : null });
    };
    void fetchLightingAudioTrigger(owner.abort.signal).then(accept, () => accept(null));
  }, [active, key, current, publish]);

  useEffect(() => {
    const owner: Owner = { key, active, abort: new AbortController(), request: 0,
      busy: false, deferred: false, state: initialState(key, active) };
    ownerRef.current = owner;
    setState(owner.state);
    if (active) load();
    return () => { owner.active = false; owner.abort.abort(); };
  }, [active, key, load]);

  const refresh = useCallback(() => load(true), [load]);
  const topicRefresh = useCallback(() => load(), [load]);
  useTopicCallback('lighting', active, topicRefresh);

  const change = useCallback((patch: Partial<LightingAudioTriggerSettings>) => {
    const owner = ownerRef.current;
    if (!active || !owner || !current(owner) || owner.key !== key
      || !owner.state.available || owner.state.loading || owner.busy) return;
    const previous = owner.state.value;
    const next = normalizeLightingAudioTrigger({ ...previous, ...patch });
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    // Guard synchronously: sliders can call onChange(commit) and onCommit in one event.
    owner.busy = true;
    owner.request++;
    publish(owner, { value: next, saving: true, error: null });
    const finish = (value: LightingAudioTriggerSettings | null) => {
      if (!current(owner)) return;
      owner.busy = false;
      publish(owner, { value: value === null ? previous : normalizeLightingAudioTrigger(value), saving: false,
        error: value === null ? 'save' : null });
      if (owner.deferred) { owner.deferred = false; load(); }
    };
    void setLightingAudioTrigger(next, owner.abort.signal).then(finish, () => finish(null));
  }, [active, key, current, load, publish]);

  // A newly selected profile never paints its predecessor while its effect is being replaced.
  const view = active && state.key === key ? state : initialState(key, active);
  return { value: view.value, loading: view.loading, saving: view.saving, error: view.error,
    available: view.available, change, refresh };
}
