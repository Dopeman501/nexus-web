import { useContext, useEffect, useMemo, useState } from 'react';
import { MultiplexContext } from '../../hooks/useMultiplexSocket';
import { AUDIO_TRIGGER_PREVIEW_LEASE_MS, AUDIO_TRIGGER_PREVIEW_TOPIC, fetchAudioTriggerPreview, readAudioTriggerPreview } from '../../api/panelAudioTriggerPreview';
import type { D215PanelBackground } from '../d215/d215PanelBackground';

/** Shared by streamed and windowed local panels; no preview state is persisted. */
export function useAudioTriggerPreview(deviceId: string | null | undefined, enabled: boolean): D215PanelBackground | null {
  const ctx = useContext(MultiplexContext);
  const subscribe = ctx?.subscribe;
  const unsubscribe = ctx?.unsubscribe;
  const active = enabled && !!deviceId && !!ctx?.connected;
  const generation = useMemo(() => ({ deviceId, active, subscribe, unsubscribe }), [deviceId, active, subscribe, unsubscribe]);
  const [selection, setSelection] = useState<{ generation: object; background: D215PanelBackground } | null>(null);
  useEffect(() => {
    if (!active || !deviceId || !subscribe || !unsubscribe) return;
    let live = true;
    let revision = -1;
    let timer: number | undefined;
    const abort = new AbortController();
    const accept = (raw: unknown) => {
      if (!live) return;
      const frame = readAudioTriggerPreview(raw);
      if (!frame || frame.deviceId !== deviceId || frame.revision <= revision) return;
      revision = frame.revision;
      window.clearTimeout(timer);
      const remaining = Math.min(AUDIO_TRIGGER_PREVIEW_LEASE_MS, frame.expiresAtUnixMs - Date.now());
      setSelection(frame.background && remaining > 0 ? { generation, background: frame.background } : null);
      if (frame.background && remaining > 0) timer = window.setTimeout(() => setSelection(null), remaining);
    };
    subscribe(AUDIO_TRIGGER_PREVIEW_TOPIC, accept);
    // Subscribe first: revision ordering prevents a late GET replacing a newer push.
    void fetchAudioTriggerPreview(deviceId, abort.signal).then(accept).catch(() => {
      // With no current lease, the normal renderer remains the fallback.
    });
    return () => { live = false; abort.abort(); window.clearTimeout(timer); unsubscribe(AUDIO_TRIGGER_PREVIEW_TOPIC, accept); };
  }, [active, deviceId, subscribe, unsubscribe, generation]);
  return active && selection?.generation === generation ? selection.background : null;
}
