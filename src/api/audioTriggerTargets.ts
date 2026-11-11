import { fetchService, postService } from './service';

export interface AudioTriggerTarget {
  id: string;
  kind: 'background' | 'lighting';
  name: string;
  enabled: boolean;
  intensity: number;
}
export interface AudioTriggerSnapshot { targets: AudioTriggerTarget[]; epoch: string }
export interface AudioTriggerPatch { targetIds?: string[]; enabled?: boolean; intensity?: number; expectedEpoch?: string }
const PATH = '/audio-trigger/targets';
const LIMIT = 1024;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const intensity = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length <= 512
  && /^(background|lighting):.+$/u.test(value) && !Array.from(value).some(char => char.charCodeAt(0) < 32);

function snapshot(raw: unknown): AudioTriggerSnapshot | null {
  if (!object(raw) || typeof raw.epoch !== 'string' || !/^[a-f\d]{32}$/i.test(raw.epoch)
    || !Array.isArray(raw.targets) || raw.targets.length > LIMIT) return null;
  const seen = new Set<string>();
  const targets: AudioTriggerTarget[] = [];
  for (const item of raw.targets) {
    if (!object(item) || !identifier(item.id) || seen.has(item.id)
      || (item.kind !== 'background' && item.kind !== 'lighting') || !item.id.startsWith(`${item.kind}:`)
      || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 512
      || typeof item.enabled !== 'boolean' || !intensity(item.intensity)) return null;
    seen.add(item.id);
    targets.push({ id: item.id, kind: item.kind, name: item.name, enabled: item.enabled, intensity: item.intensity });
  }
  return { targets, epoch: raw.epoch };
}

/** Cancellation settles even if a relay transport does not implement AbortSignal. Saves are never retried. */
async function request(work: (signal: AbortSignal) => Promise<unknown>, owner?: AbortSignal): Promise<AudioTriggerSnapshot | null> {
  if (owner?.aborted) return null;
  const controller = new AbortController();
  const abort = () => controller.abort();
  owner?.addEventListener('abort', abort, { once: true });
  let cancel = () => {};
  const cancelled = new Promise<null>(resolve => { cancel = () => resolve(null); });
  controller.signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(abort, 15000);
  try { return snapshot(await Promise.race([work(controller.signal), cancelled])); }
  catch { return null; }
  finally {
    clearTimeout(timer);
    owner?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', cancel);
  }
}

export function fetchAudioTriggerTargets(signal?: AbortSignal): Promise<AudioTriggerSnapshot | null> {
  return request(abort => fetchService<unknown>(PATH, abort), signal);
}

export function setAudioTriggerTargets(patch: AudioTriggerPatch, signal?: AbortSignal): Promise<AudioTriggerSnapshot | null> {
  if ((patch.enabled === undefined && patch.intensity === undefined)
    || (patch.enabled !== undefined && typeof patch.enabled !== 'boolean')
    || (patch.intensity !== undefined && !intensity(patch.intensity))
    || (patch.expectedEpoch !== undefined && !/^[a-f\d]{32}$/i.test(patch.expectedEpoch))
    || (patch.targetIds !== undefined && (!Array.isArray(patch.targetIds) || patch.targetIds.length === 0
      || patch.targetIds.length > LIMIT || !patch.targetIds.every(identifier)
      || new Set(patch.targetIds).size !== patch.targetIds.length))) return Promise.resolve(null);
  const value: AudioTriggerPatch = {
    ...(patch.targetIds ? { targetIds: [...patch.targetIds] } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.intensity !== undefined ? { intensity: patch.intensity } : {}),
    ...(patch.expectedEpoch !== undefined ? { expectedEpoch: patch.expectedEpoch } : {}),
  };
  return request(abort => postService<unknown>(PATH, value, abort), signal);
}
