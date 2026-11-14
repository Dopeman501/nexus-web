import { clampProgress, type AdapterFactory, type TransitionAdapter } from './adapter';

interface Clock {
  request(callback: FrameRequestCallback): number;
  cancel(id: number): void;
  now(): number;
}

/** One current renderer, one frame callback and no queued beat selections. */
export function createTransitionController(stage: HTMLElement, clock: Clock = {
  request: callback => requestAnimationFrame(callback),
  cancel: id => cancelAnimationFrame(id),
  now: () => performance.now(),
}) {
  let generation = 0;
  let disposed = false;
  let active: { adapter: TransitionAdapter; layer: HTMLElement } | null = null;
  let pending: AbortController | null = null;
  let pendingLayer: HTMLElement | null = null;
  let pendingDisposal: (() => Promise<void>) | null = null;
  let frame = 0;
  let progress = 0;
  let error = '';
  let releasing = Promise.resolve();
  let drawnFrames = 0;
  const intervals: number[] = [];
  let onChange = () => {};
  const stop = () => { if (frame) clock.cancel(frame); frame = 0; };
  const release = () => {
    const previous = active;
    active = null;
    if (previous) {
      const attempt = releasing.then(async () => {
        try { await previous.adapter.dispose(); } finally { previous.layer.remove(); }
      });
      // The caller receives this failure; later independent mounts may recover.
      releasing = attempt.catch(() => {});
      return attempt;
    }
    return releasing;
  };
  const retirePending = () => {
    const abort = pending, layer = pendingLayer, cleanup = pendingDisposal;
    pending = null; pendingLayer = null; pendingDisposal = null;
    // A standalone demo must acknowledge worker/GPU cleanup before its realm
    // is removed. Its factory bounds this wait; ordinary pending output detaches now.
    if (layer && cleanup) { layer.style.visibility = 'hidden'; layer.inert = true; }
    abort?.abort();
    if (!cleanup) { layer?.remove(); return undefined; }
    const attempt = releasing.then(async () => { try { await cleanup(); } finally { layer?.remove(); } });
    releasing = attempt.catch(() => {});
    return attempt;
  };
  const seek = (value: number) => {
    progress = clampProgress(value);
    try { active?.adapter.seek(progress); } catch (failure) {
      stop();
      error = failure instanceof Error ? failure.message : 'Sample renderer failed';
      const failedGeneration = generation;
      const originalFailure = error;
      void release().catch(cleanup => {
        if (generation !== failedGeneration || disposed) return;
        error = `${originalFailure}; cleanup: ${String(cleanup)}`;
        onChange();
      });
    }
    onChange();
  };
  const clear = async () => {
    generation++;
    error = '';
    const retiring = retirePending();
    stop();
    const retiringActive = release();
    await (retiring ? Promise.all([retiring, retiringActive]) : retiringActive);
    onChange();
  };
  return {
    async mount(factory: AdapterFactory, from: HTMLImageElement, to: HTMLImageElement) {
      if (disposed) throw new Error('Transition controller is disposed');
      const epoch = ++generation;
      error = '';
      const retiring = retirePending();
      const abort = new AbortController();
      pending = abort;
      stop();
      const retiringActive = release();
      await (retiring ? Promise.all([retiring, retiringActive]) : retiringActive);
      if (epoch !== generation || disposed) return false;
      const layer = document.createElement('div');
      layer.className = 'transition-layer';
      stage.append(layer);
      pendingLayer = layer;
      try {
        const adapter = await factory({ stage: layer, from, to, signal: abort.signal,
          onPendingDispose: cleanup => { if (pending === abort) pendingDisposal = cleanup; } });
        if (epoch !== generation || disposed) {
          await adapter.dispose();
          layer.remove();
          return false;
        }
        active = { adapter, layer };
        pending = null;
        pendingLayer = null;
        pendingDisposal = null;
        intervals.length = 0;
        drawnFrames = 0;
        seek(0);
        return active !== null && !error;
      } catch (error) {
        layer.remove();
        if (epoch !== generation || disposed) return false;
        pending = null;
        pendingLayer = null;
        pendingDisposal = null;
        throw error;
      }
    },
    seek,
    play(durationMs: number) {
      stop();
      if (!active || disposed) return;
      const duration = Number.isFinite(durationMs) ? Math.max(80, Math.min(5000, durationMs)) : 800;
      const start = clock.now();
      let last = start;
      seek(0);
      const tick: FrameRequestCallback = now => {
        frame = 0;
        if (!active || disposed) return;
        if (now > last) { intervals.push(now - last); if (intervals.length > 600) intervals.shift(); }
        last = now;
        drawnFrames++;
        seek((now - start) / duration);
        if (progress < 1 && active) frame = clock.request(tick);
      };
      frame = clock.request(tick);
    },
    stop,
    clear,
    async dispose() { disposed = true; await clear(); },
    subscribe(callback: () => void) { onChange = callback; return () => { onChange = () => {}; }; },
    snapshot() {
      const sorted = [...intervals].sort((a, b) => a - b);
      return { activeAdapters: active ? 1 : 0, pendingFrames: frame ? 1 : 0, progress, error,
        drawnFrames, p95FrameMs: sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.95)] : 0 };
    },
  };
}
