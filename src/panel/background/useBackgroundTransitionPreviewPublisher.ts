import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { postTransitionPreview, readTransitionPreview, type TransitionPreviewSelection } from '../../api/panelTransitionPreview';
import { isPictureTransitionEffect } from './transitions/catalogue';

/** One accepted click at a time, one replaceable pending intent and an ordered release. */
function publisher(deviceId: string, status: (error: boolean) => void) {
  const sessionId = crypto.randomUUID();
  let sequence = 0;
  let pending: TransitionPreviewSelection | null | undefined;
  let scheduled: number | undefined;
  let sending = false;
  let submitted = false;
  let disposed = false;
  const flush = async () => {
    if (sending || pending === undefined) return;
    const preview = pending; pending = undefined; sending = true; submitted = true;
    const body = { sessionId, sequence: ++sequence, preview };
    const abort = new AbortController();
    let timeout: number | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => { abort.abort(); reject(new Error('Preview request timed out.')); }, 3000);
      });
      const reply = readTransitionPreview(await Promise.race([postTransitionPreview(deviceId, body, abort.signal), deadline]));
      if (!disposed) status(!reply || reply.sessionId !== sessionId || reply.sequence !== body.sequence
        || reply.deviceId !== deviceId || reply.preview?.previewId !== preview?.previewId);
    } catch {
      if (!disposed) status(true);
    } finally {
      window.clearTimeout(timeout); sending = false;
      if (pending !== undefined) void flush();
    }
  };
  return {
    preview(effect: string, durationMs: number) {
      if (disposed) return;
      if (!isPictureTransitionEffect(effect) || !Number.isInteger(durationMs) || durationMs < 80 || durationMs > 5000) { status(true); return; }
      status(false);
      pending = { previewId: crypto.randomUUID(), effect, durationMs };
      if (scheduled !== undefined) return;
      scheduled = window.setTimeout(() => { scheduled = undefined; void flush(); }, 40);
    },
    dispose() {
      if (disposed) return;
      disposed = true; window.clearTimeout(scheduled);
      pending = submitted ? null : undefined;
      if (pending === null) void flush();
    },
  };
}

/** Opening the picker acquires no media and sends nothing until an explicit tile click. */
export function useBackgroundTransitionPreviewPublisher(deviceId: string | null | undefined, open: boolean) {
  const generation = useMemo(() => ({ deviceId, open }), [deviceId, open]);
  const channel = useRef<{ generation: object; owner: ReturnType<typeof publisher> } | null>(null);
  const [failure, setFailure] = useState<object | null>(null);
  useEffect(() => {
    if (!deviceId || !open) return;
    const owner = publisher(deviceId, error => {
      if (channel.current?.owner === owner) setFailure(error ? generation : null);
    });
    channel.current = { generation, owner };
    return () => { channel.current = null; owner.dispose(); };
  }, [deviceId, open, generation]);
  const preview = useCallback((effect: string, durationMs: number) => {
    if (channel.current?.generation === generation) channel.current.owner.preview(effect, durationMs);
  }, [generation]);
  return { preview, error: failure === generation };
}
