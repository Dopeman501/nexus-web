import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAudioTriggerTargets, setAudioTriggerTargets,
  type AudioTriggerPatch, type AudioTriggerTarget } from '../../../api/audioTriggerTargets';
import { useTopicCallback } from '../../../hooks/useMultiplexSocket';

interface View { targets: AudioTriggerTarget[]; loading: boolean; saving: boolean; error: 'load' | 'save' | null }
interface Owner {
  active: boolean; abort: AbortController; readAbort: AbortController | null; revision: number; reading: boolean; deferred: boolean; epoch: string;
  confirmed: AudioTriggerTarget[]; queue: AudioTriggerPatch[]; inflight: AudioTriggerPatch | null; view: View;
  listeners: Set<(view: View) => void>; timer?: number;
}
let sharedOwner: Owner | null = null;
const PREVIEW: AudioTriggerTarget[] = [
  { id: 'background:preview', kind: 'background', name: 'Y70 Touch', enabled: true, intensity: 65 },
  { id: 'lighting:preview', kind: 'lighting', name: 'Lighting', enabled: true, intensity: 65 },
];
const initial = (preview: boolean): View => ({ targets: preview ? PREVIEW : [], loading: !preview, saving: false, error: null });
const scope = (patch: AudioTriggerPatch) => patch.targetIds?.join('\n') ?? '*';
const apply = (targets: AudioTriggerTarget[], patch: AudioTriggerPatch) => targets.map(target =>
  !patch.targetIds || patch.targetIds.includes(target.id) ? { ...target,
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.intensity !== undefined ? { intensity: patch.intensity } : {}) } : target);

/** Latest intent per target/field, with ordering retained across universal and individual actions. */
function enqueue(queue: AudioTriggerPatch[], patch: AudioTriggerPatch): AudioTriggerPatch[] {
  const next = queue.flatMap(previous => {
    if (scope(previous) !== scope(patch)) return [previous];
    const remaining = { ...previous };
    if (patch.enabled !== undefined) delete remaining.enabled;
    if (patch.intensity !== undefined) delete remaining.intensity;
    return remaining.enabled !== undefined || remaining.intensity !== undefined ? [remaining] : [];
  });
  return [...next, patch];
}

export function useAudioTriggerTargets(preview: boolean) {
  const ownerRef = useRef<Owner | null>(null);
  const [view, setView] = useState(() => preview ? initial(true) : sharedOwner?.view ?? initial(false));
  const live = useCallback((owner: Owner) => owner.active && sharedOwner === owner, []);
  const publish = useCallback((owner: Owner, patch: Partial<View> = {}) => {
    if (!live(owner)) return;
    const intents = [...(owner.inflight ? [owner.inflight] : []), ...owner.queue];
    owner.view = { ...owner.view, ...patch, targets: intents.reduce(apply, owner.confirmed), saving: intents.length > 0 };
    owner.listeners.forEach(listener => listener(owner.view));
  }, [live]);

  const load = useCallback(function read(manual = false) {
    const owner = sharedOwner;
    if (preview || !owner || !live(owner)) return;
    if (owner.inflight || owner.queue.length || owner.reading) { owner.deferred = true; return; }
    owner.reading = true;
    const revision = ++owner.revision;
    const abort = new AbortController();
    owner.readAbort = abort;
    void fetchAudioTriggerTargets(abort.signal).then(value => {
      if (!live(owner) || revision !== owner.revision) return;
      owner.reading = false;
      owner.readAbort = null;
      if (value) { owner.confirmed = value.targets; owner.epoch = value.epoch; }
      publish(owner, { loading: false, error: value ? (manual ? null : owner.view.error === 'save' ? 'save' : null) : 'load' });
      const deferred = owner.deferred;
      owner.deferred = false;
      if (deferred) read();
    });
  }, [preview, live, publish]);

  useEffect(() => {
    if (preview) { setView(initial(true)); return; }
    const created = sharedOwner === null;
    const owner: Owner = sharedOwner ?? { active: true, abort: new AbortController(), readAbort: null,
      revision: 0, reading: false, deferred: false, epoch: '', confirmed: [], queue: [], inflight: null,
      view: initial(false), listeners: new Set() };
    sharedOwner = owner;
    ownerRef.current = owner;
    owner.listeners.add(setView);
    setView(owner.view);
    if (created) { load(); owner.timer = window.setInterval(() => load(), 5000); }
    return () => {
      ownerRef.current = null;
      owner.listeners.delete(setView);
      if (owner.listeners.size) return;
      owner.active = false;
      owner.queue = [];
      owner.abort.abort();
      owner.readAbort?.abort();
      window.clearInterval(owner.timer);
      if (sharedOwner === owner) sharedOwner = null;
    };
  }, [preview, load]);

  const refresh = useCallback(() => load(true), [load]);
  const changed = useCallback(() => load(), [load]);
  useTopicCallback('lighting', !preview, changed);
  useTopicCallback('panel/device', !preview, changed);
  useTopicCallback('prefs', !preview, changed);

  const drain = useCallback(async (owner: Owner) => {
    if (owner.inflight || !live(owner)) return;
    while (owner.queue.length && live(owner)) {
      const patch = owner.queue[0];
      owner.queue = owner.queue.slice(1);
      owner.inflight = patch;
      publish(owner);
      const value = await setAudioTriggerTargets({ ...patch, expectedEpoch: owner.epoch }, owner.abort.signal);
      if (!live(owner)) return;
      owner.inflight = null;
      if (!value || value.epoch !== owner.epoch) {
        owner.queue = [];
        publish(owner, { error: 'save' });
        load();
        return;
      }
      owner.confirmed = value.targets;
      publish(owner);
    }
    if (owner.deferred) { owner.deferred = false; load(); }
  }, [live, publish, load]);

  const change = useCallback((patch: AudioTriggerPatch) => {
    const owner = ownerRef.current;
    if (preview || !owner || !live(owner) || owner.view.loading || owner.view.error === 'load' || owner.view.targets.length === 0
      || (patch.enabled === undefined && patch.intensity === undefined)) return;
    if (patch.targetIds && (patch.targetIds.length === 0 || patch.targetIds.some(id => !owner.view.targets.some(target => target.id === id)))) return;
    owner.revision++;
    owner.readAbort?.abort();
    owner.readAbort = null;
    owner.reading = false;
    owner.queue = enqueue(owner.queue, patch);
    publish(owner, { error: null });
    void drain(owner);
  }, [preview, live, publish, drain]);

  return { ...view, change, refresh };
}
