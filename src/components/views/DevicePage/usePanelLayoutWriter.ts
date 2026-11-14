import { useCallback, useEffect, useRef } from 'react';
import type { PanelDevicePatch } from '../../../api/panel';

type Send = (id: string, patch: PanelDevicePatch) => Promise<boolean>;
interface Batch {
  id: string;
  patch: PanelDevicePatch;
  promise: Promise<boolean>;
  resolve(ok: boolean): void;
}

/** One in-flight write and one coalesced pending snapshot, owned by this editor. */
export function usePanelLayoutWriter(owner: string | null, send: Send): Send {
  const sendRef = useRef(send);
  useEffect(() => { sendRef.current = send; }, [send]);
  const state = useRef({ generation: 0, live: true, active: false, pending: null as Batch | null });
  useEffect(() => {
    const current = state.current;
    current.live = true;
    return () => {
      current.live = false;
      current.generation += 1;
      current.pending?.resolve(false);
      current.pending = null;
    };
  }, [owner]);

  return useCallback((id, patch) => {
    const current = state.current;
    if (!current.live) return Promise.resolve(false);
    // A newly allocated record may be written before its React owner updates.
    // Never merge pending snapshots for different devices.
    if (current.pending?.id !== id) {
      current.pending?.resolve(false);
      current.pending = null;
    }
    if (current.pending) {
      const pending = current.pending;
      current.pending = { ...pending, patch: { ...pending.patch, ...patch } };
      return pending.promise;
    }
    let resolve!: (ok: boolean) => void;
    const promise = new Promise<boolean>(done => { resolve = done; });
    const batch: Batch = { id, patch, promise, resolve };
    const run = async (next: Batch): Promise<void> => {
      const generation = current.generation;
      current.active = true;
      let ok = false;
      try { ok = await sendRef.current(next.id, next.patch); } catch { /* caller reports failed writes */ }
      next.resolve(ok && current.live && current.generation === generation);
      current.active = false;
      const pending = current.pending;
      current.pending = null;
      if (pending && current.live) void run(pending);
      else pending?.resolve(false);
    };
    if (current.active) current.pending = batch;
    else void run(batch);
    return promise;
  }, []);
}
