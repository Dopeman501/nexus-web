import { useEffect, useRef } from 'react';
import { postAudioTriggerPreview } from '../../api/panelAudioTriggerPreview';
import { readD215PanelBackground, type D215PanelBackground } from '../d215/d215PanelBackground';

const RENEW_MS = 2000;
const COALESCE_MS = 40;
const REQUEST_TIMEOUT_MS = 3000;

/** One in-flight request and one latest pending snapshot, including final release. */
function publisher(deviceId: string) {
  const sessionId = crypto.randomUUID();
  let sequence = 0;
  let latest: D215PanelBackground | null = null;
  let pending: D215PanelBackground | null | undefined;
  let sending = false;
  let disposed = false;
  let scheduled: number | undefined;
  const flush = async () => {
    if (sending || pending === undefined) return;
    const background = pending;
    pending = undefined;
    sending = true;
    const abort = new AbortController();
    const timeout = window.setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
    try {
      await postAudioTriggerPreview(deviceId, { sessionId, sequence: ++sequence, background }, abort.signal);
    } catch {
      // The next bounded renewal retries; receivers expire if the host is unavailable.
    } finally {
      window.clearTimeout(timeout);
      sending = false;
      if (pending !== undefined) void flush();
    }
  };
  const timer = window.setInterval(() => { pending = latest; void flush(); }, RENEW_MS);
  return {
    update(background: D215PanelBackground) {
      if (disposed) return;
      const normalized = readD215PanelBackground({ ...background, slideshow: false });
      latest = !normalized || (normalized.mode === 'media' && (!normalized.mediaId || !normalized.mediaType)) ? null : normalized;
      pending = latest;
      if (scheduled !== undefined) return;
      scheduled = window.setTimeout(() => { scheduled = undefined; void flush(); }, COALESCE_MS);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      window.clearInterval(timer);
      window.clearTimeout(scheduled);
      pending = null;
      void flush();
    },
  };
}

/** Selection, rather than Audio Trigger's enabled flag, owns the temporary preview. */
export function useAudioTriggerPreviewPublisher(deviceId: string | null | undefined, background: D215PanelBackground | null) {
  const active = !!deviceId && background !== null;
  const channel = useRef<ReturnType<typeof publisher> | null>(null);
  useEffect(() => {
    if (!active || !deviceId) return;
    const next = publisher(deviceId);
    channel.current = next;
    return () => { channel.current = null; next.dispose(); };
  }, [deviceId, active]);
  useEffect(() => { if (background) channel.current?.update(background); }, [background, deviceId, active]);
}
