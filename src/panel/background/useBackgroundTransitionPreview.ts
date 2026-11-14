import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { MultiplexContext } from '../../hooks/useMultiplexSocket';
import { BACKGROUND_TRANSITION_PREVIEW_MAX_LEASE_MS, BACKGROUND_TRANSITION_PREVIEW_TOPIC,
  fetchTransitionPreview, readTransitionPreview, type TransitionPreviewFrame } from '../../api/panelTransitionPreview';

// Page-scoped tombstones prevent reconnect/remount GETs replaying a completed click.
const completed = new Map<string, number>();
const keyOf = (frame: TransitionPreviewFrame) => `${frame.deviceId}/${frame.preview?.previewId}`;
function remember(frame: TransitionPreviewFrame) {
  for (const [key, expiry] of completed) if (expiry <= Date.now()) completed.delete(key);
  if (completed.size >= 64) completed.delete(completed.keys().next().value!);
  completed.set(keyOf(frame), frame.expiresAtUnixMs);
}

export function useBackgroundTransitionPreview(deviceId: string | null | undefined, enabled: boolean) {
  const context = useContext(MultiplexContext);
  const subscribe = context?.subscribe; const unsubscribe = context?.unsubscribe;
  const active = !!deviceId && enabled && !!context?.connected;
  const generation = useMemo(() => ({ deviceId, active, subscribe, unsubscribe }), [deviceId, active, subscribe, unsubscribe]);
  const current = useRef<{ generation: object; frame: TransitionPreviewFrame } | null>(null);
  const [selection, setSelection] = useState<typeof current.current>(null);
  const complete = useCallback((previewId: string) => {
    const value = current.current;
    if (value?.frame.preview?.previewId !== previewId) return;
    remember(value.frame); current.current = null; setSelection(null);
  }, []);
  useEffect(() => {
    if (!active || !deviceId || !subscribe || !unsubscribe) return;
    let live = true; let revision = -1; let expiry: number | undefined;
    const abort = new AbortController();
    const readDeadline = window.setTimeout(() => abort.abort(), 3000);
    const accept = (raw: unknown) => {
      if (!live) return;
      const frame = readTransitionPreview(raw);
      if (!frame || frame.deviceId !== deviceId || frame.revision <= revision) return;
      revision = frame.revision;
      window.clearTimeout(expiry);
      const remaining = Math.min(BACKGROUND_TRANSITION_PREVIEW_MAX_LEASE_MS, frame.expiresAtUnixMs - Date.now());
      const retired = (completed.get(keyOf(frame)) ?? 0) > Date.now();
      if (!frame.preview || remaining <= 0 || retired) {
        current.current = null; setSelection(null); return;
      }
      // A newer envelope for the same click may not restart its GPU clock.
      if (current.current?.generation !== generation || current.current.frame.preview?.previewId !== frame.preview.previewId) {
        current.current = { generation, frame }; setSelection(current.current);
      }
      expiry = window.setTimeout(() => complete(frame.preview!.previewId), remaining);
    };
    subscribe(BACKGROUND_TRANSITION_PREVIEW_TOPIC, accept);
    void fetchTransitionPreview(deviceId, abort.signal).then(accept).catch(() => {
      // No lease is the normal fallback; a POST failure is reported by the picker.
    }).finally(() => window.clearTimeout(readDeadline));
    return () => {
      live = false; abort.abort(); window.clearTimeout(readDeadline); window.clearTimeout(expiry);
      if (current.current?.generation === generation) { remember(current.current.frame); current.current = null; }
      unsubscribe(BACKGROUND_TRANSITION_PREVIEW_TOPIC, accept);
    };
  }, [active, deviceId, subscribe, unsubscribe, generation, complete]);
  return { frame: active && selection?.generation === generation ? selection.frame : null, complete };
}
