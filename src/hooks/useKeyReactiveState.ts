import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { fetchKeyReactive, type KeyReactiveDevice, type KeyReactiveState } from '../api/keyReactive';
import type { TypeReactiveScope } from '../components/common/TypeReactiveEditor/useTypeReactiveConfig';
import { useTopicCallback } from './useMultiplexSocket';

interface Owner {
  id: number;
  key: string;
  version: number;
  enabled: boolean;
  retired: boolean;
  mounted: boolean;
  revision: number;
  epoch?: string;
  devices: KeyReactiveDevice[];
  abort: AbortController | null;
}

const deviceKey = (device: KeyReactiveDevice) => JSON.stringify([
  device.id, device.deviceId, device.ledCount, device.layoutRevision ?? '',
]);

/** A profile generation owns reads and an editor scope. An old response cannot
 * seed a same-id keyboard in a newer profile, including a same-profile reload. */
export function useKeyReactiveState(profileKey: string, enabled: boolean) {
  const [version, setVersion] = useState(0);
  const generationRef = useRef(0);
  const ownerRef = useRef<Owner | null>(null);
  if (!ownerRef.current || ownerRef.current.key !== profileKey || ownerRef.current.version !== version
    || ownerRef.current.enabled !== enabled) {
    ownerRef.current = { id: ++generationRef.current, key: profileKey, version, enabled,
      retired: false, mounted: false, revision: 0, devices: [], abort: null };
  }
  const owner = ownerRef.current;
  const [record, setRecord] = useState<{ owner: Owner; data: KeyReactiveState | null } | null>(null);
  const current = useCallback(() => ownerRef.current === owner && !owner.retired && owner.enabled, [owner]);

  const refresh = useCallback(async () => {
    if (!current()) return;
    const revision = ++owner.revision;
    owner.abort?.abort();
    const abort = new AbortController();
    owner.abort = abort;
    const data = await fetchKeyReactive(abort.signal).catch(() => null);
    if (!current() || !owner.mounted || revision !== owner.revision) return;
    owner.abort = null;
    if (data) {
      owner.epoch = data.epoch;
      owner.devices = data.devices;
    }
    setRecord(previous => data ? { owner, data } : previous?.owner === owner ? previous : { owner, data: null });
  }, [owner, current]);

  const invalidate = useCallback(() => {
    owner.retired = true;
    owner.abort?.abort();
    setVersion(value => value + 1);
  }, [owner]);
  useTopicCallback('prefs', enabled, invalidate);

  useLayoutEffect(() => {
    owner.mounted = true;
    if (enabled) void refresh();
    return () => {
      owner.mounted = false;
      owner.revision++;
      owner.abort?.abort();
      // A normal host unmount may flush the editor's last guarded write.
      // Scope changes already fail current() through the newer owner identity.
    };
  }, [owner, enabled, refresh]);

  const data = current() && record?.owner === owner ? record.data : null;
  const epoch = data?.epoch;
  const isCurrent = useCallback(() => current() && owner.epoch === epoch, [current, owner, epoch]);
  const scope: TypeReactiveScope = { key: `${owner.id}:${profileKey}:${epoch ?? ''}`, epoch, isCurrent };
  const scopeFor = (device: KeyReactiveDevice): TypeReactiveScope => {
    const capturedKey = deviceKey(device);
    return { ...scope, key: `${scope.key}:${capturedKey}`, layoutRevision: device.layoutRevision ?? undefined,
      isCurrent: () => isCurrent() && owner.devices.some(candidate => deviceKey(candidate) === capturedKey) };
  };
  return { data, scope, scopeFor, refresh, loading: enabled && record?.owner !== owner };
}
